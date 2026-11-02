/* ============================================================================
 * dsh-startup-elisa — 宿主侧启动层（v0.3.0 · HANDOFF 交接转场）
 * ----------------------------------------------------------------------------
 * 1) 宿主注入 #dsh-elisa-root 后创建全屏 iframe，加载 preview/index.html?embed=1
 *    并透传 sound / volume / reduced / allowSkip / v（spec §4.4）。
 * 2) 动画在 7.20s 幕布合拢到光缝后发送 done，本文件执行设计化交接（spec §3.2）：
 *    黑场+光缝 → 光缝增亮展开 → 通电扫描 → 宿主 UI 交叉显影（850ms），无黑场硬切。
 * 3) 对外 API：window.__DSH_ELISA_API__ = { replay, skip, finish, state, progress,
 *    ready, facts, handoffMs, config, speed, totalWallMs, watchdogMs }
 *
 * 协议：
 *   iframe → 宿主  { type:'dsh-startup-elisa:ready' }                     首帧就绪
 *   iframe → 宿主  { type:'dsh-startup-elisa:progress', t, phase }        进度（节流 200ms；t 为动画秒）
 *   iframe → 宿主  { type:'dsh-startup-elisa:done', reason }              自然结束 / skip / reduced
 *
 * 时间常量（_p5/design-spec-v3.md §1 + _p7/design-spec-v5.md §2.4）：
 *   SPEED = clamp(splashSpeed,50,150)/100      速度百分比（默认 80）
 *   IMPACT = 1/sqrt(SPEED)                     冲击动作倍率 I（交接与 CSS 一次性冲击）
 *   HANDOFF_MS = round(850*I)                   done 起算的交接总时长（80% → 950ms）
 *   HANDOFF_SKIP_MS = round(480*I)              skip 时缩短版（80% → 537ms）
 *   HANDOFF_REDUCED_MS = 300 固定               reduced（减弱动态）与速度解耦
 *   HANDOFF_ERROR_MS = 40 固定                  timeout / error 快速释放（保留原兜底语义）
 *   WATCHDOG_MS = clamp(round(4000 + 7200/SPEED + HANDOFF_MS), 8000, 30000)   iframe 看门狗
 *   TOTAL_WALL_MS = round(7200/SPEED)           动画契约总墙钟（动画秒 TOTAL = 7.2 不变）
 *   --elisa-k = clamp(ms / 850, 0.02, 1.5)     交接 CSS 过渡缩放（分母固定 850 基线，
 *                                              自然交接 ≈ I，故视觉与清理时刻同步拉伸）
 * ========================================================================== */
(function () {
  'use strict'

  if (window.__DSH_ELISA_BOOTED__) return
  window.__DSH_ELISA_BOOTED__ = true

  var ROOT_ID = 'dsh-elisa-root'
  var ROUTE = '/dsh-elisa'
  var PREVIEW = ROUTE + '/preview/index.html'
  var HANDOFF_BASE_MS = 850      // 交接基准：--elisa-k 分母固定用 850（v0.4 基线行为）
  var HANDOFF_SKIP_BASE_MS = 480
  var HANDOFF_REDUCED_MS = 300   // 减弱动态固定时长（与速度解耦）
  var HANDOFF_ERROR_MS = 40      // timeout / error 快速释放（固定）
  var PREVIEW_TOTAL = 7.2        // 动画契约总长（动画秒，不随速度变）
  var SPEED_MIN = 50
  var SPEED_MAX = 150
  var SPEED_DEFAULT = 80
  // 下列派生量在 cfg 解析后重算（保留默认值便于静态断言/无配置场景）
  var HANDOFF_MS = HANDOFF_BASE_MS
  var HANDOFF_SKIP_MS = HANDOFF_SKIP_BASE_MS
  var WATCHDOG_MS = 12000
  var SPEED = 1
  var IMPACT = 1
  var TOTAL_WALL_MS = Math.round(PREVIEW_TOTAL * 1000)
  var DEFAULTS = {
    enabled: true, mode: 'session', allowSkip: true, reducedMotion: false, sound: true, volume: 65,
    splashSpeed: SPEED_DEFAULT
  }

  function bool(value, fallback) {
    if (value === false || value === 'false' || value === 0 || value === '0') return false
    if (value === true || value === 'true' || value === 1 || value === '1') return true
    return fallback
  }

  function int(value, min, max, fallback) {
    var n = typeof value === 'number' ? value : parseInt(value, 10)
    if (!isFinite(n)) return fallback
    n = Math.round(n)
    return n < min ? min : (n > max ? max : n)
  }

  function clampNum(value, min, max) {
    if (!isFinite(value)) return min
    return value < min ? min : (value > max ? max : value)
  }

  function normalize(input) {
    var src = input && typeof input === 'object' ? input : {}
    return {
      enabled: bool(src.enabled, DEFAULTS.enabled),
      mode: (src.mode === 'session' || src.mode === 'daily' || src.mode === 'always') ? src.mode : DEFAULTS.mode,
      allowSkip: bool(src.allowSkip, DEFAULTS.allowSkip),
      reducedMotion: bool(src.reducedMotion, DEFAULTS.reducedMotion),
      sound: bool(src.sound, DEFAULTS.sound),
      volume: int(src.volume, 0, 100, DEFAULTS.volume),
      splashSpeed: int(src.splashSpeed, SPEED_MIN, SPEED_MAX, DEFAULTS.splashSpeed)
    }
  }

  var injected = window.__DSH_ELISA__ || {}
  var cfg = normalize(injected)

  /* 速度派生量（_p7/design-spec-v5.md §2.4）：SPEED / I / 交接 / 看门狗 / 总墙钟 */
  SPEED = cfg.splashSpeed / 100
  IMPACT = 1 / Math.sqrt(SPEED)
  HANDOFF_MS = Math.round(HANDOFF_BASE_MS * IMPACT)
  HANDOFF_SKIP_MS = Math.round(HANDOFF_SKIP_BASE_MS * IMPACT)
  WATCHDOG_MS = clampNum(
    Math.round(4000 + (PREVIEW_TOTAL * 1000) / SPEED + HANDOFF_MS),
    8000,
    30000
  )
  TOTAL_WALL_MS = Math.round((PREVIEW_TOTAL * 1000) / SPEED)
  var facts = window.__DSH_ELISA_FACTS__ || injected.facts || {}
  var previewT = Number(window.__DSH_ELISA_PREVIEW_T__)
  var previewFreeze = isFinite(previewT) && previewT >= 0
  var forceMotion = window.__DSH_ELISA_FORCE_MOTION__ === true ||
    /(?:[?&#])motion=1(?:&|$)/.test(
      window.location ? String(window.location.search || '') + String(window.location.hash || '') : ''
    )
  var reduced = forceMotion ? false : cfg.reducedMotion

  var root = document.getElementById(ROOT_ID)
  if (!root) {
    if (window.__DSH_ELISA_SKIP__ || !cfg.enabled) return
    root = document.createElement('div')
    root.id = ROOT_ID
    if (document.body) document.body.appendChild(root)
  }

  var finished = false
  var ready = false
  var watchdog = 0
  var frame = null
  var state = 'boot'
  var progress = 0
  var lastHandoffMs = 0
  var handoffTimers = []
  var handoffNodes = []
  var replaying = false

  function lock(on) {
    try {
      document.documentElement.classList.toggle('elisa-lock', !!on)
      if (document.body && document.body.style) document.body.style.overflow = on ? 'hidden' : ''
    } catch (err) { /* noop */ }
  }

  function clearWatchdog() {
    if (watchdog) {
      clearTimeout(watchdog)
      watchdog = 0
    }
  }

  function clearHandoffTimers() {
    for (var i = 0; i < handoffTimers.length; i++) {
      try { clearTimeout(handoffTimers[i]) } catch (err) { /* noop */ }
    }
    handoffTimers = []
  }

  function later(fn, ms) {
    handoffTimers.push(window.setTimeout(fn, ms))
  }

  /* ---------------------------------------------------------------- 交接装饰 */

  function removeDecorations() {
    for (var i = 0; i < handoffNodes.length; i++) {
      try {
        if (handoffNodes[i] && handoffNodes[i].parentNode) handoffNodes[i].parentNode.removeChild(handoffNodes[i])
      } catch (err) { /* noop */ }
    }
    handoffNodes = []
  }

  function prepareDecorations(host) {
    removeDecorations()
    if (!host || !host.appendChild) return
    try {
      var seam = document.createElement('div')
      seam.className = 'elisa-seam'
      seam.setAttribute('aria-hidden', 'true')
      host.appendChild(seam)
      var wash = document.createElement('div')
      wash.className = 'elisa-wash'
      wash.setAttribute('aria-hidden', 'true')
      host.appendChild(wash)
      handoffNodes = [seam, wash]
    } catch (err) { handoffNodes = [] }
  }

  function cleanupHandoff(reason) {
    clearHandoffTimers()
    var current = root
    try {
      removeDecorations()
      if (current && current.parentNode) current.parentNode.removeChild(current)
      if (root === current) root = null
    } catch (err) { /* noop */ }
    try { document.documentElement.classList.remove('elisa-enter') } catch (err) { /* noop */ }
    try { document.documentElement.style.removeProperty('--elisa-k') } catch (err) { /* noop */ }
    lock(false)
    window.__DSH_ELISA_FAILED__ = reason !== 'natural' && reason !== 'skip' && reason !== 'reduced'
    state = 'done'
  }

  /* ---------------------------------------------------------------- 交接主流程 */

  function handoff(reason, ms) {
    var current = root
    lastHandoffMs = ms
    if (!current) {
      lock(false)
      state = 'done'
      return
    }
    var html = document.documentElement
    // 分母固定 HANDOFF_BASE_MS=850：自然交接 k≈I（视觉与清理时刻同步拉伸），
    // skip/reduced/error 相对基准同比缩短；上限放宽到 1.5（I 最大 1.414）。
    var k = Math.max(0.02, Math.min(1.5, ms / HANDOFF_BASE_MS))
    try { html.style.setProperty('--elisa-k', String(k)) } catch (err) { /* noop */ }
    prepareDecorations(current)
    // 0ms：iframe 仍显示黑场+光缝，root 背景 #06060a；随后 CSS 过渡按 --elisa-k 缩放
    //  120ms：root 背景 380ms 变透明；iframe 420ms 淡出（delay 120ms）
    //  120ms：.elisa-seam 亮度提升后横向展开 360ms
    try { current.classList.add('elisa-handoff') } catch (err) { /* noop */ }

    // timeout / error：40ms 快速释放，保留原兜底语义
    if (ms <= HANDOFF_ERROR_MS) {
      later(function () { cleanupHandoff(reason) }, HANDOFF_ERROR_MS)
      return
    }
    // 240ms：宿主 UI 通电显影（只动 opacity）
    later(function () {
      try { html.classList.add('elisa-enter') } catch (err) { /* noop */ }
    }, Math.round(240 * k))
    // 260ms：通电扫描亮层从顶部扫到下部
    later(function () {
      for (var i = 0; i < handoffNodes.length; i++) {
        var node = handoffNodes[i]
        if (node && /elisa-wash/.test(String(node.className || ''))) {
          try { node.classList.add('go') } catch (err) { /* noop */ }
        }
      }
    }, Math.round(260 * k))
    // 850ms：移除 root、撤 html.elisa-enter、解锁滚动、清理装饰与计时器
    later(function () { cleanupHandoff(reason) }, ms)
  }

  function release(reason) {
    if (finished) return
    finished = true
    state = 'done'
    progress = 1
    clearWatchdog()
    try { window.removeEventListener('message', onMessage) } catch (err) { /* noop */ }
    var ms = HANDOFF_MS
    if (reason === 'skip') ms = HANDOFF_SKIP_MS
    else if (reason === 'timeout' || reason === 'error') ms = HANDOFF_ERROR_MS
    else if (reduced) ms = HANDOFF_REDUCED_MS
    handoff(reason, ms)
  }

  /* ------------------------------------------------------------------ iframe */

  function iframeUrl() {
    var version = window.__DSH_ELISA_VERSION__ || '0.6.0'
    var qs = [
      'embed=1',
      'v=' + encodeURIComponent(version),
      'sound=' + (cfg.sound ? '1' : '0'),
      'volume=' + cfg.volume,
      'speed=' + cfg.splashSpeed
    ]
    if (previewFreeze) qs.push('t=' + encodeURIComponent(String(previewT)))
    if (forceMotion) qs.push('reduced=0')
    else if (reduced) qs.push('reduced=1')
    if (!cfg.allowSkip) qs.push('allowSkip=0')
    qs.push('_=' + Date.now())
    return PREVIEW + '?' + qs.join('&')
  }

  function onMessage(event) {
    try {
      if (!frame || event.source !== frame.contentWindow) return
      var data = event.data
      if (!data || typeof data.type !== 'string') return
      if (data.type === 'dsh-startup-elisa:ready') {
        ready = true
        clearWatchdog()
        try { if (root) root.classList.remove('elisa-boot') } catch (err) { /* noop */ }
        return
      }
      if (data.type === 'dsh-startup-elisa:progress') {
        if (typeof data.t === 'number') progress = Math.max(0, Math.min(1, data.t / PREVIEW_TOTAL))
        if (data.phase) state = String(data.phase)
        return
      }
      if (data.type === 'dsh-startup-elisa:done') {
        var reason = data.reason === 'skip' ? 'skip' : (data.reason === 'reduced' ? 'reduced' : 'natural')
        release(reason)
      }
    } catch (err) { /* noop */ }
  }

  function mount() {
    finished = false
    ready = false
    state = 'running'
    progress = 0
    lastHandoffMs = 0
    clearHandoffTimers()
    removeDecorations()
    try {
      document.documentElement.classList.remove('elisa-enter')
      document.documentElement.style.removeProperty('--elisa-k')
    } catch (err) { /* noop */ }
    if (!root || root.isConnected === false || !root.parentNode) {
      root = document.createElement('div')
      root.id = ROOT_ID
      if (document.body) document.body.appendChild(root)
    }
    root.className = 'elisa-root elisa-boot'
    root.innerHTML = ''
    lock(true)

    frame = document.createElement('iframe')
    frame.className = 'elisa-frame'
    frame.title = 'DSH startup animation'
    frame.setAttribute('allow', 'autoplay')
    frame.setAttribute('scrolling', 'no')
    frame.setAttribute('tabindex', '-1')
    frame.src = iframeUrl()
    frame.addEventListener('error', function () { release('error') })
    root.appendChild(frame)

    window.addEventListener('message', onMessage)
    clearWatchdog()
    watchdog = window.setTimeout(function () { release('timeout') }, WATCHDOG_MS)
  }

  function replay() {
    if (replaying) return
    replaying = true
    try {
      clearWatchdog()
      finished = true
      try { window.removeEventListener('message', onMessage) } catch (err) { /* noop */ }
      if (frame && frame.parentNode) frame.parentNode.removeChild(frame)
      frame = null
      if (root) { try { root.innerHTML = '' } catch (err) { /* noop */ } }
      try {
        document.documentElement.classList.remove('elisa-enter')
        document.documentElement.style.removeProperty('--elisa-k')
      } catch (err) { /* noop */ }
      removeDecorations()
      mount()
    } finally {
      replaying = false
    }
  }

  function skip() {
    if (cfg.allowSkip) release('skip')
  }

  window.__DSH_ELISA_API__ = {
    replay: replay,
    skip: skip,
    finish: function () { release('natural') },
    get state() { return state },
    get progress() { return progress },
    get ready() { return ready },
    get facts() { return facts },
    get handoffMs() { return lastHandoffMs },
    get speed() { return cfg.splashSpeed },
    get totalWallMs() { return TOTAL_WALL_MS },
    get watchdogMs() { return WATCHDOG_MS },
    get config() { return cfg }
  }

  if (window.__DSH_ELISA_SKIP__ || !cfg.enabled) {
    try {
      if (root && root.parentNode) root.parentNode.removeChild(root)
      if (root === document.getElementById(ROOT_ID)) root = null
    } catch (err) { /* noop */ }
    lock(false)
    window.__DSH_ELISA_FAILED__ = false
    state = 'done'
    return
  }

  mount()
})();
