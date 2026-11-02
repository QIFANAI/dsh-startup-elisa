/* ============================================================================
 * dsh-startup-elisa — 浏览器内音轨播放引擎（v0.6.0 · B audio-v4）
 * ----------------------------------------------------------------------------
 * 契约（_p5/design-spec-v3.md §4.3 + _p7/design-spec-v5.md §2.4）：
 *   window.ELISA_AUDIO = {
 *     init(opts)  { src, enabled, volume(0..1), reduced, chimeSrc, rate(0.5..1.5) }
 *     start()     与动画 t0 同步，currentTime 从 0 开始
 *     sync(t)     手势补播 / 漂移校正时对齐到动画已播秒数（元素时间 = 动画秒）
 *     stop(ms)    淡出（默认 180ms），不抛异常
 *     state()     { enabled, playing, blocked, volume, currentTime, duration, mode, rate, preservesPitch }
 *   }
 *
 * 速度（v0.5 · splashSpeed）：
 *   rate 默认 1，clamp 0.5..1.5（= preview 的 SPEED）。boot 元素 playbackRate=rate，
 *   preservesPitch=true（含 webkit/moz 前缀）：音高不变、墙钟时长按 1/rate 伸缩，与动画同速；
 *   chime 固定 1.0（减弱动态路径与速度解耦）。sync(t) 语义不变：t 仍是动画秒。
 *
 * 降级语义：
 *   1) 自动播放被拒（NotAllowedError）→ blocked=true，挂一次性 pointerdown/keydown
 *      监听；手势后从最近一次 sync(t) 的动画秒数补播；再失败则静默（只 warn 一次）。
 *   2) 资源 404 / 解码失败 → console.warn 一次，静音继续，不阻塞时间轴；绝不 console.error。
 *   3) enabled=false → 不播放（元素仍创建，便于 QA 读 duration）；reduced → 只播 chime。
 *   4) 音量钳制 0..1；start/stop 幂等；重复 init 会重建。
 *   5) rate 非法/缺失回 1；越界钳制；不支持 playbackRate 的降级环境静默忽略（try/catch）。
 *
 * state().mode：'boot'（正常声轨）| 'chime'（减弱动态）| 'silent'（禁用/资源失败）。
 *
 * 不依赖 DOM 结构；隐藏 <audio data-elisa-audio="boot|chime"> 挂在 body 上便于排查。
 * ========================================================================== */
(function () {
  'use strict'

  if (typeof window === 'undefined') return
  if (window.ELISA_AUDIO && window.ELISA_AUDIO.__elisaAudio) return

  var VERSION = '0.6.0'
  var DEFAULT_VOLUME = 0.65
  var DEFAULT_RATE = 1
  var RATE_MIN = 0.5
  var RATE_MAX = 1.5
  var DEFAULT_FADE_MS = 180
  var FADE_STEP_MS = 16
  var SYNC_DRIFT = 0.5          // 播放中漂移超过该秒数才 seek，避免频繁抖动
  var SEEK_END_GUARD = 0.05     // 靠近结尾时不补播尾音，避免 30ms 反复触发

  var cfg = { src: null, chimeSrc: null, enabled: true, volume: DEFAULT_VOLUME, reduced: false, rate: DEFAULT_RATE }
  var bootEl = null
  var chimeEl = null
  var userVolume = DEFAULT_VOLUME
  var enabled = true
  var reduced = false
  var rate = DEFAULT_RATE

  var failed = false
  var blocked = false
  var started = false
  var stopped = false
  var pendingT = 0
  var gestureBound = false
  var gestureHandler = null
  var gestureRetried = false
  var fadeTimer = 0
  var warned = {}

  function now() {
    try {
      if (window.performance && typeof window.performance.now === 'function') return window.performance.now()
    } catch (err) { /* noop */ }
    return Date.now()
  }

  function clamp(value, min, max) {
    if (!isFinite(value)) return min
    return value < min ? min : (value > max ? max : value)
  }

  function warnOnce(key, message) {
    if (warned[key]) return
    warned[key] = true
    try { console.warn('[elisa-audio] ' + message) } catch (err) { /* noop */ }
  }

  /* 音高保持：Chromium 支持 preservesPitch，历史前缀 webkit/moz 一并写入 */
  function setPreservesPitch(el, on) {
    if (!el) return
    try { el.preservesPitch = on } catch (err) { /* noop */ }
    try { el.webkitPreservesPitch = on } catch (err) { /* noop */ }
    try { el.mozPreservesPitch = on } catch (err) { /* noop */ }
  }

  function readPreservesPitch(el) {
    if (!el) return true
    try {
      if (typeof el.preservesPitch === 'boolean') return el.preservesPitch
      if (typeof el.webkitPreservesPitch === 'boolean') return el.webkitPreservesPitch
    } catch (err) { /* noop */ }
    return true
  }

  function applyRate(el, value) {
    if (!el) return
    try { el.playbackRate = value } catch (err) { /* noop */ }
  }

  function readPlaybackRate(el) {
    try {
      if (el && isFinite(el.playbackRate) && el.playbackRate > 0) return el.playbackRate
    } catch (err) { /* noop */ }
    return rate
  }

  function normalize(opts) {
    var source = opts && typeof opts === 'object' ? opts : {}
    return {
      src: typeof source.src === 'string' && source.src ? source.src : null,
      chimeSrc: typeof source.chimeSrc === 'string' && source.chimeSrc ? source.chimeSrc : null,
      enabled: !(source.enabled === false || source.enabled === 0 || source.enabled === '0' || source.enabled === 'false'),
      volume: source.volume === undefined || source.volume === null ? DEFAULT_VOLUME : source.volume,
      reduced: !!(source.reduced || source.reduced === 1 || source.reduced === '1' || source.reduced === 'true'),
      rate: source.rate === undefined || source.rate === null ? DEFAULT_RATE : source.rate
    }
  }

  function activeEl() {
    return reduced ? chimeEl : bootEl
  }

  /* ------------------------------------------------------------------ 元素 */

  function detach(el) {
    if (!el) return
    try { el.pause() } catch (err) { /* noop */ }
    try {
      if (el.parentNode) el.parentNode.removeChild(el)
    } catch (err) { /* noop */ }
    try {
      el.removeAttribute('src')
      el.load()
    } catch (err) { /* noop */ }
  }

  function makeElement(kind, src) {
    var el = new window.Audio()
    el.setAttribute('data-elisa-audio', kind)
    el.setAttribute('aria-hidden', 'true')
    el.setAttribute('preload', 'auto')
    el.loop = false
    el.volume = userVolume
    try { el.style.display = 'none' } catch (err) { /* noop */ }
    el.addEventListener('error', function () { onMediaError(kind) })
    el.addEventListener('playing', function () {
      if (activeEl() === el && !stopped) {
        blocked = false
      }
    })
    el.addEventListener('ended', function () {
      if (activeEl() === el) {
        started = false
      }
    })
    try { el.src = src } catch (err) { /* noop */ }
    try {
      var host = document.body || document.documentElement
      if (host) host.appendChild(el)
    } catch (err) { /* noop */ }
    return el
  }

  function onMediaError(kind) {
    var el = kind === 'chime' ? chimeEl : bootEl
    var code = el && el.error ? el.error.code : 0
    warnOnce('media-' + kind, kind + ' audio failed to load/decode (MediaError code=' + code + '); continuing silent')
    failed = true
    cancelFade()
    try { if (el) el.pause() } catch (err) { /* noop */ }
  }

  /* ------------------------------------------------------------ 播放/拒绝 */

  function playFrom(seek) {
    if (!enabled || failed || stopped) return
    var el = activeEl()
    if (!el || !el.src) return
    var target = Number(seek)
    if (!isFinite(target) || target < 0) target = 0
    var duration = el.duration
    if (isFinite(duration) && duration > 0) {
      target = Math.min(target, Math.max(0, duration - SEEK_END_GUARD))
    }
    try { el.currentTime = target } catch (err) { /* metadata 未就绪时忽略 */ }

    var promise
    try {
      promise = el.play()
    } catch (err) {
      onPlayRejected(err)
      return
    }
    if (promise && typeof promise.then === 'function') {
      promise.then(function () {
        if (stopped) {
          try { el.pause() } catch (err) { /* noop */ }
          return
        }
        blocked = false
      }, function (err) {
        onPlayRejected(err)
      })
    }
  }

  function onPlayRejected(err) {
    if (stopped) return
    var name = err && err.name ? String(err.name) : ''
    if (name === 'AbortError') return // 被 pause()/src 变更打断，不算失败
    if (failed) return // 资源/解码错误已 warn 过一次，不重复告警
    if (name === 'NotAllowedError') {
      if (gestureRetried) {
        // 手势后仍被拒：静默降级，只 warn 一次
        blocked = true
        failed = true
        warnOnce('autoplay-retry', 'autoplay still blocked after user gesture; continuing silent')
        return
      }
      blocked = true
      bindGesture()
      return
    }
    // 解码/资源/其他错误：静音继续，不阻塞时间轴
    failed = true
    warnOnce('play-' + name, 'playback failed (' + (name || 'Error') + '); continuing silent')
  }

  /* -------------------------------------------------------------- 手势补播 */

  function bindGesture() {
    if (gestureBound || typeof document === 'undefined') return
    gestureBound = true
    gestureHandler = function () {
      unbindGesture()
      resumeFromGesture()
    }
    try {
      document.addEventListener('pointerdown', gestureHandler, { capture: true, passive: true })
      document.addEventListener('keydown', gestureHandler, { capture: true })
    } catch (err) {
      try {
        document.addEventListener('pointerdown', gestureHandler, true)
        document.addEventListener('keydown', gestureHandler, true)
      } catch (err2) { /* noop */ }
    }
  }

  function unbindGesture() {
    if (!gestureBound) return
    gestureBound = false
    try { document.removeEventListener('pointerdown', gestureHandler, true) } catch (err) { /* noop */ }
    try { document.removeEventListener('keydown', gestureHandler, true) } catch (err) { /* noop */ }
    gestureHandler = null
  }

  function resumeFromGesture() {
    if (stopped || !started || !enabled || failed) return
    gestureRetried = true
    playFrom(pendingT)
  }

  /* ------------------------------------------------------------------ 淡出 */

  function cancelFade() {
    if (fadeTimer) {
      try { clearInterval(fadeTimer) } catch (err) { /* noop */ }
      fadeTimer = 0
    }
  }

  function finishFade() {
    cancelFade()
    var all = [bootEl, chimeEl]
    for (var i = 0; i < all.length; i++) {
      var el = all[i]
      if (!el) continue
      try { el.pause() } catch (err) { /* noop */ }
      try { el.volume = userVolume } catch (err) { /* noop */ }
    }
  }

  function fadeOut(ms) {
    cancelFade()
    var targets = []
    if (bootEl && !bootEl.paused) targets.push(bootEl)
    if (chimeEl && !chimeEl.paused) targets.push(chimeEl)
    if (!targets.length) { finishFade(); return }
    if (!ms) { finishFade(); return }
    var startVols = []
    for (var i = 0; i < targets.length; i++) startVols.push(targets[i].volume)
    var t0 = now()
    fadeTimer = setInterval(function () {
      var k = clamp((now() - t0) / ms, 0, 1)
      for (var j = 0; j < targets.length; j++) {
        try { targets[j].volume = clamp(startVols[j] * (1 - k), 0, 1) } catch (err) { /* noop */ }
      }
      if (k >= 1) finishFade()
    }, FADE_STEP_MS)
  }

  /* ------------------------------------------------------------------- API */

  function init(opts) {
    cfg = normalize(opts)
    enabled = cfg.enabled
    reduced = cfg.reduced
    userVolume = clamp(Number(cfg.volume), 0, 1)
    var cfgRate = Number(cfg.rate)
    rate = isFinite(cfgRate) ? clamp(cfgRate, RATE_MIN, RATE_MAX) : DEFAULT_RATE
    failed = false
    blocked = false
    started = false
    stopped = false
    pendingT = 0
    gestureRetried = false
    warned = {}
    cancelFade()
    unbindGesture()
    detach(bootEl)
    detach(chimeEl)
    bootEl = null
    chimeEl = null
    if (cfg.src) bootEl = makeElement('boot', cfg.src)
    if (cfg.chimeSrc) chimeEl = makeElement('chime', cfg.chimeSrc)
    // 静音/禁用时也让音量保持钳制值，便于外部读取
    if (bootEl) {
      try { bootEl.volume = userVolume } catch (err) { /* noop */ }
      applyRate(bootEl, rate)
      setPreservesPitch(bootEl, true)
    }
    if (chimeEl) {
      try { chimeEl.volume = userVolume } catch (err) { /* noop */ }
      applyRate(chimeEl, 1) // chime 固定原速（减弱动态与速度解耦）
      setPreservesPitch(chimeEl, true)
    }
  }

  function start() {
    started = true
    stopped = false
    pendingT = 0
    cancelFade()
    if (!enabled || failed) { finishFade(); return }
    var el = activeEl()
    if (!el) { finishFade(); return }
    try { el.volume = userVolume } catch (err) { /* noop */ }
    applyRate(el, reduced ? 1 : rate)
    try { el.currentTime = 0 } catch (err) { /* noop */ }
    playFrom(0)
  }

  function sync(t) {
    var time = Number(t)
    if (!isFinite(time) || time < 0) time = 0
    pendingT = time
    if (!started || stopped || !enabled || failed) return
    var el = activeEl()
    if (!el) return
    if (blocked) return // 等一次性手势后从 pendingT 补播
    if (el.paused || el.ended) {
      var duration = el.duration
      if (isFinite(duration) && duration > 0 && time >= duration - SEEK_END_GUARD) return
      playFrom(time)
      return
    }
    var total = el.duration
    if (isFinite(total) && total > 0) {
      var target = Math.min(time, total - SEEK_END_GUARD)
      if (Math.abs(el.currentTime - target) > SYNC_DRIFT) {
        try { el.currentTime = target } catch (err) { /* noop */ }
      }
    }
  }

  function stop(ms) {
    started = false
    stopped = true
    unbindGesture()
    var fadeMs = (typeof ms === 'number' && isFinite(ms)) ? clamp(ms, 0, 2000) : DEFAULT_FADE_MS
    fadeOut(fadeMs)
  }

  function state() {
    var playing = false
    var current = 0
    var duration = 0
    var el = activeEl()
    if (bootEl && !bootEl.paused && !bootEl.ended) playing = true
    if (chimeEl && !chimeEl.paused && !chimeEl.ended) playing = true
    if (el) {
      if (isFinite(el.currentTime)) current = el.currentTime
      if (isFinite(el.duration)) duration = el.duration
    }
    return {
      enabled: enabled,
      playing: playing,
      blocked: blocked,
      volume: userVolume,
      currentTime: current,
      duration: duration,
      mode: mode(),
      reduced: reduced,
      failed: failed,
      rate: rate,
      preservesPitch: readPreservesPitch(el),
      // 墙钟时长 = 元素时长 / 元素实际 playbackRate（rate 1 时等于 duration；reduced 的 chime 固定 1.0）
      wallDuration: isFinite(duration) && duration > 0 ? duration / readPlaybackRate(el) : 0
    }
  }

  function mode() {
    if (!enabled || failed) return 'silent'
    if (reduced) return chimeEl ? 'chime' : 'silent'
    return bootEl ? 'boot' : 'silent'
  }

  function dispose() {
    started = false
    stopped = true
    cancelFade()
    unbindGesture()
    detach(bootEl)
    detach(chimeEl)
    bootEl = null
    chimeEl = null
  }

  window.ELISA_AUDIO = {
    __elisaAudio: true,
    version: VERSION,
    init: init,
    start: start,
    sync: sync,
    stop: stop,
    state: state,
    dispose: dispose
  }
})();
