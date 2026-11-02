/* ============================================================================
 * dsh-startup-elisa — 浏览器半侧
 * ----------------------------------------------------------------------------
 * 1) DSH 设置页「ELISA 启动动画」：播放/预览/保存，页内 iframe 预览
 * 2) Host 的 tapIndex 不生效时（file:// + IPC），由这里自举启动层
 *
 * 配置走插件自带 HTTP API /dsh-elisa/config，不依赖 dsh-settings 版本。
 * 预览只读草稿：不写配置、不动 sessionStorage，关闭时彻底清理遮罩/iframe。
 * ========================================================================== */
window.__ModuleLoader__.load({
  id: 'dsh-startup-elisa',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement
    var API = '/dsh-elisa/config'
    var BOOT_ROUTE = '/dsh-elisa'
    var PREVIEW_ROUTE = BOOT_ROUTE + '/preview/index.html'
    var ROOT_ID = 'dsh-elisa-root'
    var FALLBACK_VERSION = '0.6.0'
    var PREVIEW_TIMEOUT = 1500

    /* v0.4 皮肤（四档 / 三主题）/ 声音 */
    var SKIN_ROUTE = BOOT_ROUTE + '/skin.css'
    var SKIN_CSS_ID = 'dsh-elisa-skin-css'
    var SKIN_CLASS = 'dsh-elisa-skin'
    var SKIN_MODE_CLASS = { accent: 'dsh-elisa-skin--accent', full: 'dsh-elisa-skin--full', glass: 'dsh-elisa-skin--glass' }
    var SKIN_THEME_CLASS = {
      aurora: 'dsh-elisa-skin--theme-aurora',
      deepsea: 'dsh-elisa-skin--theme-deepsea',
      violet: 'dsh-elisa-skin--theme-violet'
    }
    var SKIN_STATIC_CLASS = 'dsh-elisa-skin--static'
    var SKIN_PAUSED_CLASS = 'dsh-elisa-skin--paused'
    var SKIN_NOBLUR_CLASS = 'dsh-elisa-skin--noblur'
    var AMBIENT_ID = 'dsh-elisa-ambient'
    var SKIN_MODES = [
      ['off', '关闭'],
      ['accent', '主题点缀'],
      ['full', '完整皮肤'],
      ['glass', '毛玻璃']
    ]
    var SKIN_THEMES = [
      ['aurora', '绯红极光'],
      ['deepsea', '深海蓝调'],
      ['violet', '紫夜霓虹']
    ]
    var SKIN_THEME_HINTS = {
      aurora: '绯红与紫罗兰极光，与启动动画同一世界；默认。',
      deepsea: '青蓝与靛蓝冷光，适合长时间工作。',
      violet: '紫与品红霓虹，夜间高对比。'
    }
    var SKIN_HINT = '立即生效；只改配色与装饰，不改布局与字号。毛玻璃=动态主题背景+整窗背景模糊+可调通透度，低配/远程桌面自动降级为静态。'
    var GLASS_ALPHA_DEFAULT = 1
    var GLASS_TRANSPARENCY_DEFAULT = 50
    var SPLASH_SPEED_DEFAULT = 80
    var SPLASH_BASE_MS = 7200
    var GLASS_HINT = '50 = 标准（v0.4 观感）；数值越大越通透、主题背景越明显；越小越厚重。主题弹窗、菜单与主界面同步生效，保存后立即生效。'
    var AUDIO_ROUTE = BOOT_ROUTE + '/lib/assets/audio/'
    var AUDITION_MS = 4000

    var FALLBACK = {
      enabled: true,
      mode: 'session',
      allowSkip: true,
      reducedMotion: false,
      sound: true,
      volume: 65,
      skin: 'glass',
      skinTheme: 'aurora',
      skinMotion: true,
      glassTransparency: GLASS_TRANSPARENCY_DEFAULT,
      splashSpeed: SPLASH_SPEED_DEFAULT
    }

    var MODES = [
      ['session', '每个会话一次'],
      ['daily', '每天一次'],
      ['always', '每次打开']
    ]

    var MODE_HINTS = {
      session: '同一浏览器会话只播放一次，刷新页面不会重播。',
      daily: '每天第一次打开 DSH 时播放，当天其余时间跳过。',
      always: '每次打开或刷新 DSH 都播放。'
    }

    /* ── 样式（注入 <style data-plugin-css="dsh-startup-elisa/main.css">）── */
    var CSS = [
      '.__me_root{max-width:700px;display:flex;flex-direction:column;gap:14px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}',
      '.__me_head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
      '.__me_headMain{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.__me_title{font-size:14px;font-weight:600;letter-spacing:.01em;display:flex;align-items:center;gap:8px}',
      '.__me_sub{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.__me_chip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-family:ui-monospace,Consolas,monospace;font-size:11px;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.__me_chipDot{width:6px;height:6px;border-radius:50%;background:#e01b2f;box-shadow:0 0 6px rgba(224,27,47,.65)}',
      '.__me_group{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
      '.__me_groupHead{display:flex;align-items:center;justify-content:space-between;gap:10px}',
      '.__me_groupTitle{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
      '.__me_groupNote{font-size:11px;color:var(--dsw-alias-label-tertiary);opacity:.85}',
      '.__me_rows{display:flex;flex-direction:column}',
      '.__me_row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.__me_rowFirst{border-top:0;padding-top:2px}',
      '.__me_rowMain{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.__me_label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.__me_hint{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}',
      '.__me_rowCtl{flex:none;display:flex;align-items:center;gap:8px}',
      '.__me_seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}',
      '.__me_segBtn{border:0;border-left:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;padding:5px 10px;cursor:pointer;white-space:nowrap;transition:background .15s ease,color .15s ease}',
      '.__me_segBtn:first-child{border-left:0}',
      '.__me_segBtn:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:rgba(127,127,127,.10)}',
      '.__me_segBtnOn,.__me_segBtnOn:hover:not(:disabled){color:var(--dsw-alias-label-primary-foreground,#0f1115);background:var(--dsw-alias-state-business-primary,#3964fe)}',
      '.__me_switch{position:relative;width:36px;height:20px;padding:0;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);cursor:pointer;transition:background .15s ease,border-color .15s ease}',
      '.__me_switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3964fe);outline-offset:2px}',
      '.__me_switchKnob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:transform .15s ease,background .15s ease}',
      '.__me_switchOn{border-color:var(--dsw-alias-state-business-primary,#3964fe);background:var(--dsw-alias-state-business-primary,#3964fe)}',
      '.__me_switchOn .__me_switchKnob{transform:translateX(16px);background:#fff}',
      '.__me_rangeWrap{display:flex;align-items:center;gap:10px}',
      '.__me_range{-webkit-appearance:none;appearance:none;width:132px;height:18px;margin:0;padding:0;background:transparent;cursor:pointer}',
      '.__me_range::-webkit-slider-runnable-track{height:3px;border-radius:2px;background:var(--dsw-alias-border-l3,rgba(255,255,255,.16))}',
      '.__me_range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;margin-top:-5.5px;border-radius:50%;border:0;background:var(--dsw-alias-state-business-primary,#3964fe)}',
      '.__me_range:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3964fe);outline-offset:2px}',
      '.__me_range:disabled{opacity:.5;cursor:default}',
      '.__me_rangeVal{font-family:ui-monospace,Consolas,monospace;font-size:11px;min-width:44px;text-align:right;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.__me_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;line-height:1.4;cursor:pointer;transition:border-color .15s ease,background .15s ease,filter .15s ease}',
      '.__me_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary,#3964fe)}',
      '.__me_btn:disabled{opacity:.5;cursor:default}',
      '.__me_btnPrimary{border-color:var(--dsw-alias-button-primary-fill,#f9fafb);background:var(--dsw-alias-button-primary-fill,#f9fafb);color:var(--dsw-alias-label-primary-foreground,#0f1115)}',
      '.__me_btnPrimary:hover:not(:disabled){border-color:var(--dsw-alias-button-primary-hover,#ebeef2);background:var(--dsw-alias-button-primary-hover,#ebeef2);filter:none;}',
      '.__me_actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:2px}',
      '.__me_status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-tertiary);min-height:17px}',
      '.__me_ok{color:var(--dsw-alias-state-business-primary,#3964fe)}',
      '.__me_err{color:var(--dsw-alias-state-error-primary,#f85149)}',
      '.__me_previewRow{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}',
      '.__me_previewText{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 260px}',
      '.__me_foot{display:flex;flex-direction:column;gap:3px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary);opacity:.85;margin-top:2px}',
      '.__me_path{font-family:ui-monospace,Consolas,monospace;font-size:11px;word-break:break-all;color:var(--dsw-alias-label-tertiary)}',
      '.__me_hidden{display:none!important}',
      '.__me_overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(4,4,8,.80);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);animation:__me_overlayIn .16s ease-out}',
      '.__me_overlayFrame{position:relative;display:flex;flex-direction:column;width:min(1280px,94vw,calc((92vh - 46px) * 1.7778));max-width:100%;border:1px solid rgba(242,240,234,.16);border-radius:12px;overflow:hidden;background:#06060a;box-shadow:0 30px 90px rgba(0,0,0,.62);animation:__me_frameIn .2s ease-out}',
      '.__me_overlayBar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 10px 7px 14px;border-bottom:1px solid rgba(242,240,234,.10);background:#0a0a10;color:rgba(242,240,234,.70);font-size:11px}',
      '.__me_overlayBarText{font-family:"Cascadia Mono",Consolas,ui-monospace,monospace;letter-spacing:.10em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.__me_overlayClose{border:1px solid rgba(242,240,234,.18);background:transparent;color:rgba(242,240,234,.72);border-radius:6px;padding:3px 10px;font:inherit;font-size:11px;cursor:pointer}',
      '.__me_overlayClose:hover{border-color:#e01b2f;color:#f2f0ea}',
      '.__me_overlayClose:focus-visible{outline:2px solid #e01b2f;outline-offset:2px}',
      '.__me_overlayStage{position:relative;width:100%;aspect-ratio:16/9;max-height:calc(92vh - 46px);background:#06060a;overflow:hidden}',
      '.__me_overlayIframe{position:absolute;inset:0;z-index:1;width:100%;height:100%;border:0;background:#06060a;opacity:0;transition:opacity .24s ease}',
      '.__me_overlayIframe.__me_ready{opacity:1}',
      '.__me_overlayStatus{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;color:rgba(242,240,234,.50);font-size:12px;letter-spacing:.16em;text-transform:uppercase;pointer-events:none}',
      '.__me_overlayError{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:28px;text-align:center;background:rgba(6,6,10,.94)}',
      '.__me_overlayErrorText{font-size:12px;line-height:1.6;color:rgba(242,240,234,.66);max-width:430px}',
      '.__me_overlayErrorActions{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}',
      '@keyframes __me_overlayIn{from{opacity:0}to{opacity:1}}',
      '@keyframes __me_frameIn{from{opacity:0;transform:translateY(6px) scale(.995)}to{opacity:1;transform:none}}',
      '@media (max-width:720px){.__me_row{flex-direction:column;align-items:flex-start;gap:6px}.__me_segBtn{padding:5px 8px}.__me_overlayBarText{display:none}}'
    ].join('')

    var tagId = 'dsh-startup-elisa/main.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
      var cssTag = document.createElement('style')
      cssTag.dataset.plugin = 'dsh-startup-elisa'
      cssTag.dataset.pluginCss = tagId
      cssTag.textContent = CSS
      document.head.appendChild(cssTag)
    }

    /* ── 通用 DOM 小工具 ─────────────────────────────────────────────────── */

    function createNode(tag, className) {
      var node = document.createElement(tag)
      if (className) node.className = className
      return node
    }

    function toggleClass(node, className, enabled) {
      if (!node) return
      if (node.classList && typeof node.classList.add === 'function') {
        if (enabled) node.classList.add(className)
        else node.classList.remove(className)
        return
      }
      var parts = String(node.className || '').split(' ')
      var next = []
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] && parts[i] !== className) next.push(parts[i])
      }
      if (enabled) next.push(className)
      node.className = next.join(' ')
    }

    /* ── 预览地址 ────────────────────────────────────────────────────────── */

    function clampVolume(value) {
      var n = Number(value)
      if (!Number.isFinite(n)) return FALLBACK.volume
      return Math.max(0, Math.min(100, Math.round(n)))
    }

    function clampIntRange(value, min, max, fallback) {
      var n = Number(value)
      if (!Number.isFinite(n)) return fallback
      return Math.max(min, Math.min(max, Math.round(n)))
    }

    function normalizeGlassTransparency(value) {
      return clampIntRange(value, 0, 100, GLASS_TRANSPARENCY_DEFAULT)
    }

    function normalizeSplashSpeed(value) {
      return clampIntRange(value, 50, 150, SPLASH_SPEED_DEFAULT)
    }

    /* 通透度 → 玻璃 alpha 倍率：0→1.45、50→1.00、100→0.55（规格 §1；100 档上限受对比度预算约束） */
    function glassAlphaFor(transparency) {
      var t = normalizeGlassTransparency(transparency)
      var alpha = 1 + (50 - t) * 0.009
      return Math.round(Math.max(0.55, Math.min(1.45, alpha)) * 1000) / 1000
    }

    /* 启动速度 → 墙钟总时长（ms），用于设置页提示 */
    function splashDurationFor(speed) {
      return Math.round(SPLASH_BASE_MS / (normalizeSplashSpeed(speed) / 100))
    }

    /* 宿主兜底计时 = iframe 看门狗 + 3000（与 splash.js / index.js 同公式，规格 §2.4） */
    function bootFallbackMsFor(speed) {
      var slow = 1 / (normalizeSplashSpeed(speed) / 100)
      return Math.min(60000, Math.round(4000 + SPLASH_BASE_MS * slow + 850 * Math.sqrt(slow)) + 3000)
    }

    function buildPreviewUrl(draft) {
      var url = PREVIEW_ROUTE + '?embed=1&preview=1&_=' + Date.now()
      if (draft && draft.reducedMotion === true) url += '&reduced=1'
      if (draft && draft.allowSkip === false) url += '&allowSkip=0'
      url += draft && draft.sound === false ? '&sound=0' : '&sound=1'
      url += '&volume=' + clampVolume(draft && draft.volume)
      url += '&speed=' + normalizeSplashSpeed(draft && draft.splashSpeed)
      return url
    }

    /* 宿主内重播：splash.js 暴露 __DSH_ELISA_API__ 时优先用它，否则整页刷新 */
    function preview() {
      try {
        var api = window.__DSH_ELISA_API__
        if (api && typeof api.replay === 'function') {
          api.replay()
          return true
        }
      } catch (err) { /* noop */ }
      try {
        window.location.reload()
        return true
      } catch (err) {
        return false
      }
    }

    /* ── 内嵌预览遮罩 ────────────────────────────────────────────────────── */

    function createPreviewOverlay(draft, onDone) {
      var doc = typeof document !== 'undefined' ? document : null
      var win = typeof window !== 'undefined' ? window : null
      if (!doc || !doc.body || !win) {
        preview()
        try { onDone() } catch (err) { /* noop */ }
        return { dispose: function () {} }
      }

      var previousOverflow = doc.body.style ? (doc.body.style.overflow || '') : ''
      var previousFocus = doc.activeElement || null
      var disposed = false
      var loaded = false
      var timer = null
      var iframe = null

      var overlay = createNode('div', '__me_overlay')
      overlay.setAttribute('role', 'dialog')
      overlay.setAttribute('aria-modal', 'true')
      overlay.setAttribute('aria-label', 'ELISA 启动动画预览')

      var frame = createNode('div', '__me_overlayFrame')
      var bar = createNode('div', '__me_overlayBar')
      var barText = createNode('span', '__me_overlayBarText')
      barText.textContent = 'ELISA BOOT · 内嵌预览 · 草稿参数'
      var closeBtn = createNode('button', '__me_overlayClose')
      closeBtn.type = 'button'
      closeBtn.textContent = '关闭（Esc）'
      bar.appendChild(barText)
      bar.appendChild(closeBtn)

      var stage = createNode('div', '__me_overlayStage')
      var status = createNode('div', '__me_overlayStatus')
      status.textContent = '加载预览…'
      var errorBox = createNode('div', '__me_overlayError __me_hidden')
      var errorText = createNode('div', '__me_overlayErrorText')
      var errorActions = createNode('div', '__me_overlayErrorActions')
      var retryBtn = createNode('button', '__me_btn')
      retryBtn.type = 'button'
      retryBtn.textContent = '重试'
      var hostBtn = createNode('button', '__me_btn')
      hostBtn.type = 'button'
      hostBtn.textContent = '在宿主内重播'
      errorActions.appendChild(retryBtn)
      errorActions.appendChild(hostBtn)
      errorBox.appendChild(errorText)
      errorBox.appendChild(errorActions)
      stage.appendChild(status)
      stage.appendChild(errorBox)
      frame.appendChild(bar)
      frame.appendChild(stage)
      overlay.appendChild(frame)

      function clearTimer() {
        if (timer === null) return
        try { win.clearTimeout(timer) } catch (err) { /* noop */ }
        timer = null
      }

      function setReady(ready) {
        if (iframe) toggleClass(iframe, '__me_ready', ready)
      }

      function showLoading() {
        toggleClass(status, '__me_hidden', false)
        toggleClass(errorBox, '__me_hidden', true)
        setReady(false)
      }

      function showError(message) {
        clearTimer()
        errorText.textContent = message
        toggleClass(status, '__me_hidden', true)
        toggleClass(errorBox, '__me_hidden', false)
        setReady(false)
      }

      function markLoaded() {
        if (disposed || loaded) return
        loaded = true
        clearTimer()
        toggleClass(status, '__me_hidden', true)
        toggleClass(errorBox, '__me_hidden', true)
        setReady(true)
      }

      function onIframeError() {
        if (disposed || loaded) return
        showError('预览页加载失败（iframe error）。可重试，或在宿主内重播。')
      }

      function removeIframe() {
        if (!iframe) return
        try { iframe.removeEventListener('load', markLoaded) } catch (err) { /* noop */ }
        try { iframe.removeEventListener('error', onIframeError) } catch (err) { /* noop */ }
        try { iframe.src = 'about:blank' } catch (err) { /* noop */ }
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
        iframe = null
      }

      function startTimer() {
        clearTimer()
        timer = win.setTimeout(function () {
          if (disposed || loaded) return
          showError('预览页在 1.5 秒内未加载完成；素材缺失或预览页未就绪。可重试，或在宿主内重播。')
        }, PREVIEW_TIMEOUT)
      }

      function mountIframe() {
        iframe = createNode('iframe', '__me_overlayIframe')
        iframe.setAttribute('title', 'ELISA 启动动画预览')
        iframe.setAttribute('allow', 'autoplay; fullscreen')
        iframe.addEventListener('load', markLoaded)
        iframe.addEventListener('error', onIframeError)
        iframe.src = buildPreviewUrl(draft)
        stage.appendChild(iframe)
        showLoading()
        startTimer()
      }

      function retry() {
        if (disposed) return
        loaded = false
        removeIframe()
        mountIframe()
      }

      function dispose() {
        if (disposed) return
        disposed = true
        clearTimer()
        try { win.removeEventListener('message', onMessage) } catch (err) { /* noop */ }
        try { win.removeEventListener('keydown', onKeyDown, true) } catch (err) { /* noop */ }
        try { overlay.removeEventListener('click', onOverlayClick) } catch (err) { /* noop */ }
        try { closeBtn.removeEventListener('click', onCloseClick) } catch (err) { /* noop */ }
        try { retryBtn.removeEventListener('click', retry) } catch (err) { /* noop */ }
        try { hostBtn.removeEventListener('click', onHostReplay) } catch (err) { /* noop */ }
        removeIframe()
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
        try {
          if (doc.body && doc.body.style) doc.body.style.overflow = previousOverflow
        } catch (err) { /* noop */ }
        try {
          if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus()
        } catch (err) { /* noop */ }
      }

      function close() {
        if (disposed) return
        dispose()
        try { onDone() } catch (err) { /* noop */ }
      }

      function onCloseClick() { close() }

      function onHostReplay() {
        close()
        preview()
      }

      function onOverlayClick(event) {
        if (event && event.target === overlay) close()
      }

      function onMessage(event) {
        if (disposed) return
        var data = event && event.data
        if (!data || typeof data !== 'object') return
        if (data.type !== 'dsh-startup-elisa:done') return
        close()
      }

      function onKeyDown(event) {
        if (disposed) return
        var key = event && (event.key || event.keyCode)
        if (key !== 'Escape' && key !== 'Esc' && key !== 27) return
        if (event.preventDefault) event.preventDefault()
        if (event.stopPropagation) event.stopPropagation()
        close()
      }

      closeBtn.addEventListener('click', onCloseClick)
      retryBtn.addEventListener('click', retry)
      hostBtn.addEventListener('click', onHostReplay)
      overlay.addEventListener('click', onOverlayClick)
      win.addEventListener('message', onMessage)
      win.addEventListener('keydown', onKeyDown, true)
      try {
        if (doc.body.style) doc.body.style.overflow = 'hidden'
      } catch (err) { /* noop */ }
      doc.body.appendChild(overlay)
      mountIframe()

      return {
        dispose: dispose,
        close: close,
        overlay: overlay,
        iframe: function () { return iframe }
      }
    }

    /* ── 设置页 UI 原子 ──────────────────────────────────────────────────── */

    function Row(props) {
      return h('div', { className: '__me_row' + (props.first ? ' __me_rowFirst' : '') },
        h('div', { className: '__me_rowMain' },
          h('div', { className: '__me_label' }, props.label),
          props.hint ? h('div', { className: '__me_hint' }, props.hint) : null
        ),
        h('div', { className: '__me_rowCtl' }, props.children)
      )
    }

    function Switch(props) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': props.checked ? 'true' : 'false',
        'aria-label': props.label || '',
        className: '__me_switch' + (props.checked ? ' __me_switchOn' : ''),
        disabled: !!props.disabled,
        onClick: function () { props.onChange(!props.checked) }
      }, h('span', { className: '__me_switchKnob' }))
    }

    function Segmented(props) {
      return h('div', { className: '__me_seg', role: 'group', 'aria-label': props.label || '' },
        props.options.map(function (option) {
          var active = props.value === option[0]
          return h('button', {
            key: option[0],
            type: 'button',
            className: '__me_segBtn' + (active ? ' __me_segBtnOn' : ''),
            'aria-pressed': active ? 'true' : 'false',
            disabled: !!props.disabled,
            onClick: function () { props.onChange(option[0]) }
          }, option[1])
        })
      )
    }

    function Range(props) {
      var min = typeof props.min === 'number' ? props.min : 0
      var max = typeof props.max === 'number' ? props.max : 100
      var step = typeof props.step === 'number' ? props.step : 1
      var fallback = typeof props.fallback === 'number' ? props.fallback : min
      var value = clampIntRange(props.value, min, max, fallback)
      var shown = typeof props.format === 'function' ? props.format(value) : String(value)
      return h('div', { className: '__me_rangeWrap' },
        h('input', {
          className: '__me_range',
          type: 'range',
          min: min,
          max: max,
          step: step,
          value: value,
          disabled: !!props.disabled,
          'aria-label': props.label || '',
          onChange: function (event) { props.onChange(clampIntRange(event.target.value, min, max, fallback)) }
        }),
        h('span', { className: '__me_rangeVal' }, shown)
      )
    }

    function auditionLabel(status) {
      if (status === 'playing') return '停止试听'
      if (status === 'loading') return '检查音频…'
      return '试听 4 秒'
    }

    function readInjectedVersion() {
      try {
        return window.__DSH_ELISA_VERSION__ ? String(window.__DSH_ELISA_VERSION__) : ''
      } catch (err) {
        return ''
      }
    }

    function warn(message) {
      try {
        if (typeof console !== 'undefined' && console.warn) console.warn('[dsh-startup-elisa] ' + message)
      } catch (err) { /* noop */ }
    }

    /* ── 皮肤（v0.4）：四档 + 三主题 + 动态背景层 ──────────────────────────
     * off    → 移除全部皮肤 class（html 无 .dsh-elisa-skin → skin.css 零生效）
     * accent → html.dsh-elisa-skin + html.dsh-elisa-skin--accent
     * full   → html.dsh-elisa-skin + html.dsh-elisa-skin--full
     * glass  → accent token 基础 + --glass + 主题 class + #dsh-elisa-ambient 背景层
     * 加载失败只 console.warn，宿主保持原样，绝不阻塞 UI。
     * 与启动动画是否启用无关：enabled=false 时照样应用皮肤。
     * ---------------------------------------------------------------------- */

    function normalizeSkin(mode) {
      if (mode === 'accent' || mode === 'full' || mode === 'glass') return mode
      return 'off'
    }

    function normalizeTheme(theme) {
      return SKIN_THEME_CLASS[theme] ? theme : 'aurora'
    }

    function normalizeMotion(value) {
      return value === false || value === 'false' || value === 0 || value === '0' ? false : true
    }

    function supportsBackdrop() {
      try {
        if (typeof CSS === 'undefined' || !CSS.supports) return true
        return !!(CSS.supports('backdrop-filter', 'blur(2px)') || CSS.supports('-webkit-backdrop-filter', 'blur(2px)'))
      } catch (err) {
        return true
      }
    }

    /* 低配判定：≤4 线程按低配处理，毛玻璃背景改为静态（规格 §6） */
    function prefersCalm() {
      try {
        var cores = Number(navigator.hardwareConcurrency || 8)
        return cores > 0 && cores <= 4
      } catch (err) {
        return false
      }
    }

    /* 宿主首屏注入的 window.__DSH_ELISA__ 已带真实 config（Lead 侧），先同步套一版减少闪烁 */
    function hintedSkinState() {
      try {
        var injected = window.__DSH_ELISA__
        if (!injected || typeof injected !== 'object') return null
        if (injected.skin === undefined) return null
        return {
          skin: normalizeSkin(injected.skin),
          theme: normalizeTheme(injected.skinTheme),
          motion: normalizeMotion(injected.skinMotion),
          reducedMotion: injected.reducedMotion === true,
          glassTransparency: normalizeGlassTransparency(injected.glassTransparency)
        }
      } catch (err) {
        return null
      }
    }

    var skinCssPromise = null

    function loadSkinCss() {
      if (skinCssPromise) return skinCssPromise
      if (typeof document === 'undefined') return Promise.resolve()
      var existing = null
      try { existing = document.getElementById(SKIN_CSS_ID) } catch (err) { existing = null }
      if (existing) {
        skinCssPromise = Promise.resolve()
        return skinCssPromise
      }
      skinCssPromise = new Promise(function (resolve, reject) {
        var link = document.createElement('link')
        link.id = SKIN_CSS_ID
        link.rel = 'stylesheet'
        link.href = SKIN_ROUTE + '?v=' + encodeURIComponent(readInjectedVersion() || FALLBACK_VERSION)
        link.dataset.plugin = 'dsh-startup-elisa'
        link.addEventListener('load', function () { resolve() }, { once: true })
        link.addEventListener('error', function () { reject(new Error('skin.css load failed')) }, { once: true })
        ;(document.head || document.documentElement).appendChild(link)
      }).catch(function (err) {
        /* 允许下次（例如插件升级后）重试；失败只 warn，不影响宿主 */
        skinCssPromise = null
        warn('皮肤样式加载失败，宿主保持原样：' + String(err && err.message ? err.message : err))
      })
      return skinCssPromise
    }

    /* ── 动态主题背景层（仅 glass 档）────────────────────────────────────── */
    /* v0.6 FLOW：新增 .ea-dim（暗帘呼吸，只降不抬）与 .ea-rim（边缘呼吸光）；
     * 顺序固定：base → b1..b4 → sheen → breath → grain → vignette → dim → rim，
     * 与 skin.css「4.3 动态主题背景层」一一对应（smoke-client 断言 11 层）。 */
    function ambientMarkup() {
      return '<span class="ea-base"></span>' +
        '<span class="ea-blob ea-b1"></span><span class="ea-blob ea-b2"></span>' +
        '<span class="ea-blob ea-b3"></span><span class="ea-blob ea-b4"></span>' +
        '<span class="ea-sheen"></span><span class="ea-breath"></span>' +
        '<span class="ea-grain"></span><span class="ea-vignette"></span>' +
        '<span class="ea-dim"></span><span class="ea-rim"></span>'
    }

    function ensureAmbient() {
      try {
        if (typeof document === 'undefined' || !document.body) return null
        var existing = document.getElementById(AMBIENT_ID)
        if (existing) return existing
        var node = document.createElement('div')
        node.id = AMBIENT_ID
        node.setAttribute('aria-hidden', 'true')
        node.setAttribute('data-plugin', 'dsh-startup-elisa')
        node.innerHTML = ambientMarkup()
        document.body.insertBefore(node, document.body.firstChild)
        return node
      } catch (err) {
        return null
      }
    }

    function removeAmbient() {
      try {
        if (typeof document === 'undefined') return
        var node = document.getElementById(AMBIENT_ID)
        if (node && node.parentNode) node.parentNode.removeChild(node)
      } catch (err) { /* noop */ }
    }

    var visibilityBound = false
    function bindVisibility() {
      if (visibilityBound) return
      visibilityBound = true
      try {
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
        document.addEventListener('visibilitychange', function () {
          try {
            var html = document.documentElement
            if (!html || !html.classList.contains(SKIN_CLASS)) return
            toggleClass(html, SKIN_PAUSED_CLASS, document.hidden === true)
          } catch (err) { /* noop */ }
        })
      } catch (err) { /* noop */ }
    }

    function publishSkinState(state) {
      try {
        var classText = state.skin === 'off' ? '' : SKIN_CLASS + ' ' + SKIN_MODE_CLASS[state.skin]
        if (state.skin === 'glass') {
          classText += ' ' + SKIN_THEME_CLASS[state.theme]
          if (state.static) classText += ' ' + SKIN_STATIC_CLASS
          if (state.noblur) classText += ' ' + SKIN_NOBLUR_CLASS
        }
        window.__DSH_ELISA_SKIN__ = {
          mode: state.skin,
          theme: state.theme,
          motion: state.motion,
          static: !!state.static,
          noblur: !!state.noblur,
          ambient: state.skin === 'glass',
          applied: state.skin !== 'off',
          glassTransparency: state.glassTransparency,
          glassAlpha: state.glassAlpha,
          class: classText
        }
      } catch (err) { /* noop */ }
    }

    var lastReducedMotion = false
    var skinState = { skin: 'off', theme: 'aurora', motion: true, static: false, noblur: false, glassTransparency: GLASS_TRANSPARENCY_DEFAULT, glassAlpha: GLASS_ALPHA_DEFAULT }

    /* applySkin(mode, theme, motion, reducedMotion, glassTransparency)
     *   mode             : off | accent | full | glass
     *   theme            : aurora | deepsea | violet（glass 档生效）
     *   motion           : 是否允许动态背景（glass 档生效）
     *   reducedMotion    : 全局「减弱动态」开启时，动态背景强制静态
     *   glassTransparency: 0..100 通透度（glass 档生效，写入 --elisa-glass-a）
     * 幂等：可反复调用；切离 glass 时移除背景层、行内变量与相关 class。 */
    function applySkin(mode, theme, motion, reducedMotion, glassTransparency) {
      var next = normalizeSkin(mode)
      var nextTheme = normalizeTheme(theme)
      var nextMotion = normalizeMotion(motion)
      var nextTransparency = normalizeGlassTransparency(glassTransparency === undefined ? FALLBACK.glassTransparency : glassTransparency)
      var nextAlpha = glassAlphaFor(nextTransparency)
      if (reducedMotion !== undefined) lastReducedMotion = reducedMotion === true
      try {
        if (typeof document === 'undefined' || !document.documentElement) return next
        var html = document.documentElement
        toggleClass(html, SKIN_CLASS, false)
        toggleClass(html, SKIN_MODE_CLASS.accent, false)
        toggleClass(html, SKIN_MODE_CLASS.full, false)
        toggleClass(html, SKIN_MODE_CLASS.glass, false)
        toggleClass(html, SKIN_THEME_CLASS.aurora, false)
        toggleClass(html, SKIN_THEME_CLASS.deepsea, false)
        toggleClass(html, SKIN_THEME_CLASS.violet, false)
        toggleClass(html, SKIN_STATIC_CLASS, false)
        toggleClass(html, SKIN_PAUSED_CLASS, false)
        toggleClass(html, SKIN_NOBLUR_CLASS, false)
        if (next !== 'off') {
          toggleClass(html, SKIN_CLASS, true)
          toggleClass(html, SKIN_MODE_CLASS[next], true)
          loadSkinCss()
        }
        var state = { skin: next, theme: nextTheme, motion: nextMotion, static: false, noblur: false, glassTransparency: nextTransparency, glassAlpha: nextAlpha }
        if (next === 'glass') {
          toggleClass(html, SKIN_THEME_CLASS[nextTheme], true)
          html.setAttribute('data-elisa-theme', nextTheme)
          try { html.style.setProperty('--elisa-glass-a', String(nextAlpha)) } catch (err) { /* noop */ }
          ensureAmbient()
          state.static = !nextMotion || lastReducedMotion === true || prefersCalm()
          state.noblur = !supportsBackdrop()
          toggleClass(html, SKIN_STATIC_CLASS, state.static)
          toggleClass(html, SKIN_NOBLUR_CLASS, state.noblur)
          bindVisibility()
        } else {
          html.removeAttribute('data-elisa-theme')
          try { html.style.removeProperty('--elisa-glass-a') } catch (err) { /* noop */ }
          removeAmbient()
        }
        skinState = state
        publishSkinState(state)
      } catch (err) {
        warn('应用皮肤失败（已忽略）：' + String(err && err.message ? err.message : err))
      }
      return next
    }

    var skinConfigPromise = null

    function applySkinConfig(config, fallbackHint) {
      var source = config || {}
      var hint = fallbackHint || null
      return applySkin(
        source.skin !== undefined ? source.skin : (hint ? hint.skin : FALLBACK.skin),
        source.skinTheme !== undefined ? source.skinTheme : (hint ? hint.theme : FALLBACK.skinTheme),
        source.skinMotion !== undefined ? source.skinMotion : (hint ? hint.motion : FALLBACK.skinMotion),
        source.reducedMotion !== undefined ? source.reducedMotion === true : (hint ? hint.reducedMotion : false),
        source.glassTransparency !== undefined ? source.glassTransparency : (hint ? hint.glassTransparency : FALLBACK.glassTransparency)
      )
    }

    /* 读取 /dsh-elisa/config 并应用皮肤；失败时用 FALLBACK（默认 glass）兜底 */
    function ensureSkin() {
      var hint = hintedSkinState()
      if (hint) applySkinConfig(hint, hint)
      if (skinConfigPromise) return skinConfigPromise
      skinConfigPromise = Promise.resolve()
        .then(function () {
          return fetch(API, { headers: { Accept: 'application/json' } })
        })
        .then(function (response) { return response.json() })
        .then(function (payload) {
          if (!payload || payload.ok !== true) throw new Error('config not ok')
          var config = Object.assign({}, FALLBACK, payload.config)
          applySkinConfig(config, hint)
          return config
        })
        .catch(function (err) {
          warn('读取皮肤配置失败，按默认皮肤处理：' + String(err && err.message ? err.message : err))
          applySkinConfig(null, hint)
          return Object.assign({}, FALLBACK, {
            skin: hint ? hint.skin : FALLBACK.skin,
            skinTheme: hint ? hint.theme : FALLBACK.skinTheme,
            skinMotion: hint ? hint.motion : FALLBACK.skinMotion,
            glassTransparency: hint ? hint.glassTransparency : FALLBACK.glassTransparency
          })
        })
      return skinConfigPromise
    }

    /* ── 试听（设置页「声音」分组）：boot.wav 前 4 秒，再点/结束自动停 ───── */
    var auditionAudio = null
    var auditionTimer = null

    function auditionSrc() {
      return AUDIO_ROUTE + 'boot.wav?v=' + encodeURIComponent(readInjectedVersion() || FALLBACK_VERSION)
    }

    function stopAudition() {
      if (auditionTimer !== null) {
        try { window.clearTimeout(auditionTimer) } catch (err) { /* noop */ }
        auditionTimer = null
      }
      if (auditionAudio) {
        var audio = auditionAudio
        auditionAudio = null
        try { audio.pause() } catch (err) { /* noop */ }
        try { audio.currentTime = 0 } catch (err) { /* noop */ }
      }
    }

    /* onState(status, message)：
     *   'loading' | 'playing' | 'idle' | 'missing'（音频未生成/解码失败）| 'blocked'（浏览器拦截）
     * 注意：headless / 无音频输出设备时 audio.play() 返回的 Promise 可能长期不 settle，
     * 所以「开始播放」以 !audio.paused 乐观判定，play() 的 rejection 再降级为 blocked。 */
    function playAudition(volume, onState) {
      stopAudition()
      var done = typeof onState === 'function' ? onState : function () {}
      var settled = false
      function finish(status, message) {
        if (settled) return
        settled = true
        stopAudition()
        done(status, message)
      }
      done('loading')
      var src = auditionSrc()
      var head
      try {
        head = fetch(src, { method: 'HEAD', cache: 'no-store' })
      } catch (err) {
        head = Promise.reject(err)
      }
      head
        .then(function (response) {
          if (!response || !response.ok) throw new Error('audio missing')
          var audio = new Audio()
          auditionAudio = audio
          audio.preload = 'auto'
          audio.volume = Math.max(0, Math.min(1, clampVolume(volume) / 100))
          audio.addEventListener('error', function () {
            finish('missing', '音频未生成（boot.wav 解码失败）。等声轨生成后重试。')
          })
          audio.addEventListener('ended', function () {
            if (settled) return
            settled = true
            stopAudition()
            done('idle')
          })
          var attempt = null
          try {
            attempt = audio.play()
          } catch (err) {
            attempt = null
            finish('blocked', '浏览器拦截了播放：点一下页面后再试听。')
            return
          }
          if (attempt && typeof attempt.catch === 'function') {
            attempt.catch(function (err) {
              if (settled) return
              if (err && err.name === 'NotAllowedError') {
                finish('blocked', '浏览器拦截了自动播放：点一下页面后再试听。')
              } else {
                finish('blocked', '试听失败（' + String(err && err.message ? err.message : err) + '）。')
              }
            })
          }
          var playing = false
          try { playing = audio.paused === false } catch (err) { playing = false }
          if (!playing) {
            try { audio.load() } catch (err) { /* noop */ }
            try { playing = audio.paused === false } catch (err) { playing = false }
          }
          if (playing) {
            done('playing')
            auditionTimer = window.setTimeout(function () {
              if (settled) return
              settled = true
              stopAudition()
              done('idle')
            }, AUDITION_MS)
          } else {
            finish('blocked', '浏览器暂未允许播放：点一下页面后再试听。')
          }
        })
        .catch(function (err) {
          if (String(err && err.message ? err.message : err).indexOf('audio missing') !== -1) {
            finish('missing', '音频未生成：/dsh-elisa/lib/assets/audio/boot.wav 还不存在，等声轨生成后再试。')
          } else if (err && err.name === 'NotAllowedError') {
            finish('blocked', '浏览器拦截了自动播放：点一下页面后再试听。')
          } else {
            finish('blocked', '试听失败（' + String(err && err.message ? err.message : err) + '）。')
          }
        })
    }

    function serializeConfig(config) {
      if (!config) return ''
      return [
        config.enabled === false ? '0' : '1',
        String(config.mode || ''),
        config.allowSkip === false ? '0' : '1',
        config.reducedMotion === true ? '1' : '0',
        config.sound === false ? '0' : '1',
        String(clampVolume(config.volume)),
        String(normalizeSkin(config.skin)),
        String(normalizeTheme(config.skinTheme)),
        normalizeMotion(config.skinMotion) ? '1' : '0',
        String(normalizeGlassTransparency(config.glassTransparency)),
        String(normalizeSplashSpeed(config.splashSpeed))
      ].join('|')
    }

    /* ── 设置页面板 ──────────────────────────────────────────────────────── */

    function Panel() {
      var draftState = react.useState(null)
      var draft = draftState[0]
      var setDraft = draftState[1]
      var fileState = react.useState('')
      var file = fileState[0]
      var setFile = fileState[1]
      var versionState = react.useState(readInjectedVersion)
      var version = versionState[0]
      var setVersion = versionState[1]
      var errorState = react.useState(null)
      var error = errorState[0]
      var setError = errorState[1]
      var noticeState = react.useState(null)
      var notice = noticeState[0]
      var setNotice = noticeState[1]
      var busyState = react.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var cleanState = react.useState('')
      var clean = cleanState[0]
      var setClean = cleanState[1]
      var overlayState = react.useState(null)
      var overlayReq = overlayState[0]
      var setOverlayReq = overlayState[1]
      var auditionState = react.useState({ status: 'idle', message: '' })
      var audition = auditionState[0]
      var setAudition = auditionState[1]

      function load(options) {
        var successNotice = options && options.notice
        setError(null)
        setNotice(null)
        return fetch(API, { headers: { Accept: 'application/json' } })
          .then(function (response) { return response.json() })
          .then(function (payload) {
            if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || 'load failed')
            var next = Object.assign({}, FALLBACK, payload.config)
            setDraft(next)
            setClean(serializeConfig(next))
            setFile(payload.file || '')
            if (payload.version) setVersion(String(payload.version))
            applySkin(next.skin, next.skinTheme, next.skinMotion, next.reducedMotion, next.glassTransparency)
            if (successNotice) setNotice(successNotice)
          })
          .catch(function (err) {
            setError('读取配置失败：' + String(err && err.message ? err.message : err))
          })
      }

      react.useEffect(function () { load() }, [])

      /* 关闭设置页时停掉试听，避免离开页面后还在响 */
      react.useEffect(function () {
        return function () { stopAudition() }
      }, [])

      react.useEffect(function () {
        var request = overlayReq
        if (!request) return undefined
        var handle = createPreviewOverlay(request.draft, function () { setOverlayReq(null) })
        return function () {
          if (handle && typeof handle.dispose === 'function') handle.dispose()
        }
      }, [overlayReq])

      function set(key, value) {
        setNotice(null)
        setDraft(function (current) {
          if (!current) return current
          var next = Object.assign({}, current)
          next[key] = value
          return next
        })
      }

      function save() {
        if (!draft) return
        setBusy(true)
        setNotice(null)
        setError(null)
        fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch: draft })
        })
          .then(function (response) { return response.json() })
          .then(function (payload) {
            if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || 'save failed')
            var next = Object.assign({}, FALLBACK, payload.config || draft)
            setDraft(next)
            setClean(serializeConfig(next))
            applySkin(next.skin, next.skinTheme, next.skinMotion, next.reducedMotion, next.glassTransparency)
            setNotice('已保存：外观与玻璃通透度已生效；启动动画设置（速度/声音等）下次启动生效。')
          })
          .catch(function (err) {
            setError('保存失败：' + String(err && err.message ? err.message : err))
          })
          .then(function () { setBusy(false) })
      }

      function reset() {
        setBusy(true)
        setNotice(null)
        setError(null)
        fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset' })
        })
          .then(function (response) { return response.json() })
          .then(function (payload) {
            if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || 'reset failed')
            var next = Object.assign({}, FALLBACK, payload.config)
            setDraft(next)
            setClean(serializeConfig(next))
            applySkin(next.skin, next.skinTheme, next.skinMotion, next.reducedMotion, next.glassTransparency)
            setNotice('已恢复默认配置（外观已立即生效）。')
          })
          .catch(function (err) {
            setError('恢复默认失败：' + String(err && err.message ? err.message : err))
          })
          .then(function () { setBusy(false) })
      }

      function discard() {
        load({ notice: '已放弃修改，已重新读取配置。' })
      }

      function openPreview() {
        if (!draft) return
        setOverlayReq({ token: Date.now(), draft: Object.assign({}, draft) })
      }

      function toggleAudition() {
        if (audition.status === 'playing' || audition.status === 'loading') {
          stopAudition()
          setAudition({ status: 'idle', message: '' })
          return
        }
        playAudition(draft && draft.volume, function (status, message) {
          setAudition({ status: status, message: message || '' })
        })
      }

      var dirty = !!draft && serializeConfig(draft) !== clean
      var activeVersion = version || FALLBACK_VERSION
      var chip = h('span', { className: '__me_chip', title: 'dsh-startup-elisa 插件版本' },
        h('span', { className: '__me_chipDot' }),
        'v' + activeVersion
      )

      if (!draft) {
        return h('div', { className: '__me_root' },
          h('div', { className: '__me_head' },
            h('div', { className: '__me_headMain' },
              h('div', { className: '__me_title' }, 'ELISA 启动动画'),
              h('div', { className: '__me_sub' }, '冷启动 HUD · 本地素材 · 不联网')
            ),
            chip
          ),
          h('div', { className: '__me_status' }, error || '正在读取配置…'),
          h('div', { className: '__me_hint' }, '加载完成后可调整播放选项，并在页内预览启动动画。'),
          error ? h('div', { className: '__me_actions' },
            h('button', { className: '__me_btn', type: 'button', onClick: function () { load() } }, '重试')
          ) : null
        )
      }

      return h('div', { className: '__me_root' },
        h('div', { className: '__me_head' },
          h('div', { className: '__me_headMain' },
            h('div', { className: '__me_title' }, 'ELISA 启动动画'),
            h('div', { className: '__me_sub' }, '冷启动 HUD · 本地素材 · 不联网')
          ),
          chip
        ),

        h('div', { className: '__me_group' },
          h('div', { className: '__me_groupHead' },
            h('div', { className: '__me_groupTitle' }, '播放'),
            h('div', { className: '__me_groupNote' }, '保存后下次启动生效')
          ),
          h('div', { className: '__me_rows' },
            h(Row, {
              label: '启用启动动画',
              hint: '打开 DSH 时播放 ELISA 冷启动，当前速度下约 ' + (splashDurationFor(draft.splashSpeed) / 1000).toFixed(1) + ' 秒（含开场）；终帧或跳过后进入宿主。',
              first: true
            }, h(Switch, {
              label: '启用启动动画',
              checked: draft.enabled !== false,
              onChange: function (value) { set('enabled', value) }
            })),
            h(Row, {
              label: '播放时机',
              hint: MODE_HINTS[draft.mode] || MODE_HINTS.session
            }, h(Segmented, {
              label: '播放时机',
              value: draft.mode,
              options: MODES,
              onChange: function (value) { set('mode', value) }
            })),
            h(Row, {
              label: '允许跳过',
              hint: '显示右上角「跳过 SKIP」，并允许 Esc / 点击画面；关闭后只能等自然结束。'
            }, h(Switch, {
              label: '允许跳过',
              checked: draft.allowSkip !== false,
              onChange: function (value) { set('allowSkip', value) }
            })),
            h(Row, {
              label: '减弱动态',
              hint: '不播放人物视频与粒子，静态终帧停留约 1.1 秒后淡出。'
            }, h(Switch, {
              label: '减弱动态',
              checked: draft.reducedMotion === true,
              onChange: function (value) { set('reducedMotion', value) }
            })),
            h(Row, {
              label: '启动动画速度',
              hint: '100% = v0.4 原速（7.2 秒）；当前 ' + (splashDurationFor(draft.splashSpeed) / 1000).toFixed(1) + ' 秒。越小越舒缓：相位停留变长，冲击动作只温和放慢，音轨同步伸缩且音高不变；保存后下次启动生效。'
            }, h(Range, {
              label: '启动动画速度',
              min: 50,
              max: 150,
              step: 5,
              fallback: SPLASH_SPEED_DEFAULT,
              value: normalizeSplashSpeed(draft.splashSpeed),
              format: function (value) { return value + '%' },
              onChange: function (value) { set('splashSpeed', value) }
            }))
          )
        ),

        h('div', { className: '__me_group' },
          h('div', { className: '__me_groupHead' },
            h('div', { className: '__me_groupTitle' }, '声音'),
            h('div', { className: '__me_groupNote' }, '保存后下次启动生效')
          ),
          h('div', { className: '__me_rows' },
            h(Row, {
              label: '启动音效',
              hint: '程序化开机声轨（BGM + 音效），随启动速度同步伸缩且音高不变；自动播放被系统拦截时静音降级，点击画面后补播。',
              first: true
            }, h(Switch, {
              label: '启动音效',
              checked: draft.sound !== false,
              onChange: function (value) { set('sound', value) }
            })),
            h(Row, {
              label: '音量',
              hint: '0–100；与「启动音效」一起保存，下次启动生效。'
            }, h(Range, {
              label: '音量',
              min: 0,
              max: 100,
              step: 1,
              fallback: FALLBACK.volume,
              value: clampVolume(draft.volume),
              onChange: function (value) { set('volume', value) }
            })),
            h(Row, {
              label: '试听',
              hint: audition.message || '按当前草稿音量播放 boot.wav 4 秒后自动停止；再点一次可提前停止。'
            }, h('button', {
              className: '__me_btn',
              type: 'button',
              disabled: audition.status === 'loading',
              onClick: toggleAudition
            }, auditionLabel(audition.status)))
          )
        ),

        h('div', { className: '__me_group' },
          h('div', { className: '__me_groupHead' },
            h('div', { className: '__me_groupTitle' }, '外观皮肤'),
            h('div', { className: '__me_groupNote' }, '保存后立即生效 · 无需重启')
          ),
          h('div', { className: '__me_rows' },
            h(Row, {
              label: '皮肤档位',
              hint: SKIN_HINT,
              first: true
            }, h(Segmented, {
              label: '皮肤档位',
              value: normalizeSkin(draft.skin),
              options: SKIN_MODES,
              onChange: function (value) { set('skin', value) }
            })),
            h(Row, {
              label: '主题背景',
              hint: (normalizeSkin(draft.skin) === 'glass'
                ? (SKIN_THEME_HINTS[normalizeTheme(draft.skinTheme)] || '')
                : '仅毛玻璃档生效；先选「毛玻璃」。')
            }, h(Segmented, {
              label: '主题背景',
              value: normalizeTheme(draft.skinTheme),
              options: SKIN_THEMES,
              disabled: normalizeSkin(draft.skin) !== 'glass',
              onChange: function (value) { set('skinTheme', value) }
            })),
            h(Row, {
              label: '动态背景',
              hint: normalizeSkin(draft.skin) !== 'glass'
                ? '仅毛玻璃档生效；极光背景带呼吸节律缓慢流动。'
                : (draft.reducedMotion === true
                  ? '已因「减弱动态」强制静态（背景呼吸与漂移停用）。'
                  : '极光背景带呼吸节律缓慢流动；关闭后改为静态主题背景，更省电。')
            }, h(Switch, {
              label: '动态背景',
              checked: normalizeMotion(draft.skinMotion),
              disabled: normalizeSkin(draft.skin) !== 'glass' || draft.reducedMotion === true,
              onChange: function (value) { set('skinMotion', value) }
            })),
            h(Row, {
              label: '玻璃通透度',
              hint: normalizeSkin(draft.skin) !== 'glass'
                ? '仅毛玻璃档生效；先选「毛玻璃」。'
                : GLASS_HINT
            }, h(Range, {
              label: '玻璃通透度',
              min: 0,
              max: 100,
              step: 5,
              fallback: GLASS_TRANSPARENCY_DEFAULT,
              value: normalizeGlassTransparency(draft.glassTransparency),
              disabled: normalizeSkin(draft.skin) !== 'glass',
              onChange: function (value) { set('glassTransparency', value) }
            }))
          )
        ),

        h('div', { className: '__me_group' },
          h('div', { className: '__me_groupHead' },
            h('div', { className: '__me_groupTitle' }, '预览'),
            h('div', { className: '__me_groupNote' }, '按当前草稿播放，不写配置')
          ),
          h('div', { className: '__me_previewRow' },
            h('div', { className: '__me_previewText' },
              h('div', { className: '__me_label' }, '内嵌预览'),
              h('div', { className: '__me_hint' }, '在设置页内播放一次启动动画，实时套用上方草稿（减弱动态 / 允许跳过 / 声音与音量 / 启动速度）。不会写入配置，也不会标记「本次会话已播放」。按 Esc、点关闭或播放结束即返回。')
            ),
            h('button', {
              className: '__me_btn __me_btnPrimary',
              type: 'button',
              disabled: !!overlayReq,
              onClick: openPreview
            }, '预览启动动画')
          )
        ),

        h('div', { className: '__me_actions' },
          h('button', {
            className: '__me_btn __me_btnPrimary',
            type: 'button',
            disabled: busy || !dirty,
            onClick: save
          }, busy ? '处理中…' : '保存'),
          h('button', {
            className: '__me_btn',
            type: 'button',
            disabled: busy,
            onClick: reset
          }, '恢复默认'),
          h('button', {
            className: '__me_btn',
            type: 'button',
            disabled: busy || !dirty,
            onClick: discard
          }, '放弃修改')
        ),

        h('div', { className: '__me_status' },
          notice ? h('span', { className: '__me_ok' }, notice) : null,
          error ? h('span', { className: '__me_err' }, error) : null,
          (!notice && !error) ? h('span', null, dirty ? '有未保存的修改' : '已与配置文件同步') : null
        ),

        h('div', { className: '__me_foot' },
          file ? h('div', { className: '__me_path', title: file }, '配置文件：' + file) : null,
          h('div', null, 'dsh-startup-elisa v' + activeVersion + ' · © 沈宏宏 (QIFANAI) · MIT · 人物视频与海报为本机素材，仅限自用；公开包不含这些素材。')
        )
      )
    }

    /* ── 桌面端自举 ───────────────────────────────────────────────────────── */

    function readFlag(store, key) {
      try {
        var area = window[store]
        return area ? area.getItem(key) : null
      } catch (err) {
        return null
      }
    }

    function writeFlag(store, key, value) {
      try {
        var area = window[store]
        if (area) area.setItem(key, value)
      } catch (err) { /* noop */ }
    }

    function loadCss(href) {
      return new Promise(function (resolve, reject) {
        var link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = href
        link.addEventListener('load', function () { resolve() }, { once: true })
        link.addEventListener('error', function () { reject(new Error('css load failed: ' + href)) }, { once: true })
        ;(document.head || document.documentElement).appendChild(link)
      })
    }

    function loadScript(src) {
      return new Promise(function (resolve, reject) {
        var script = document.createElement('script')
        script.src = src
        script.async = false
        script.addEventListener('load', function () { resolve() }, { once: true })
        script.addEventListener('error', function () { reject(new Error('script load failed: ' + src)) }, { once: true })
        ;(document.head || document.documentElement).appendChild(script)
      })
    }

    function releaseBoot() {
      try {
        var root = document.getElementById(ROOT_ID)
        if (root && root.parentNode) root.parentNode.removeChild(root)
        document.documentElement.classList.remove('elisa-lock')
        if (document.body && document.body.style) document.body.style.overflow = ''
        window.__DSH_ELISA_FAILED__ = true
      } catch (err) { /* noop */ }
    }

    function injectBoot(config, facts) {
      var root = document.getElementById(ROOT_ID)
      if (!root) {
        root = document.createElement('div')
        root.id = ROOT_ID
        if (document.body) document.body.appendChild(root)
      }
      root.className = 'elisa-root elisa-boot'
      document.documentElement.classList.add('elisa-lock')
      if (document.body && document.body.style) document.body.style.overflow = 'hidden'

      window.__DSH_ELISA__ = Object.assign({}, config, { facts: facts || {} })
      window.__DSH_ELISA_FACTS__ = facts || {}

      window.setTimeout(function () {
        try {
          var current = document.getElementById(ROOT_ID)
          if (current && current.className && current.className.indexOf('elisa-boot') !== -1) releaseBoot()
        } catch (err) { /* noop */ }
      }, bootFallbackMsFor(config && config.splashSpeed))

      return loadCss(BOOT_ROUTE + '/splash.css')
        .then(function () { return loadScript(BOOT_ROUTE + '/splash.js?t=' + Date.now()) })
        .catch(function (err) {
          releaseBoot()
          try {
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[dsh-startup-elisa] 启动层自举失败，已放开页面：' + err.message)
            }
          } catch (e) { /* noop */ }
        })
    }

    function selfBoot() {
      try {
        if (typeof window === 'undefined' || typeof document === 'undefined') return
        if (!document.body) return
        if (window.__DSH_ELISA_BOOT__) return
        if (window.__DSH_ELISA__) return
        if (window.__DSH_ELISA_SKIP__) return
        if (window.__DSH_ELISA_FAILED__ === true) return
        if (document.getElementById(ROOT_ID)) return
        window.__DSH_ELISA_BOOT__ = 'client'

        var fallback = Object.assign({}, FALLBACK)
        window.fetch(API, { headers: { Accept: 'application/json' } })
          .then(function (response) { return response.json() })
          .then(function (payload) {
            if (!payload || payload.ok !== true) return { config: fallback, facts: {} }
            return {
              config: Object.assign({}, fallback, payload.config),
              facts: payload.facts || {}
            }
          })
          .catch(function () { return { config: fallback, facts: {} } })
          .then(function (result) {
            var config = result.config
            var today = new Date().toISOString().slice(0, 10)
            if (config.enabled === false) return
            if (config.mode === 'session' && readFlag('sessionStorage', 'dsh-startup-elisa:shown') === '1') return
            if (config.mode === 'daily' && readFlag('localStorage', 'dsh-startup-elisa:day') === today) return
            if (config.mode === 'session') writeFlag('sessionStorage', 'dsh-startup-elisa:shown', '1')
            if (config.mode === 'daily') writeFlag('localStorage', 'dsh-startup-elisa:day', today)
            return injectBoot(config, result.facts)
          })
          .catch(function () { /* 自举失败不拖垮宿主 */ })
      } catch (err) { /* noop */ }
    }

    var inject = ['slots']

    function apply(ctx) {
      /* v0.3 皮肤：与启动动画是否启用无关，先按 /dsh-elisa/config 应用（失败只 warn） */
      try {
        ensureSkin()
      } catch (err) {
        warn('皮肤初始化失败（已忽略）：' + String(err && err.message ? err.message : err))
      }
      selfBoot()
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          { name: 'settings.section', id: 'startup-elisa', order: 27, label: 'ELISA 启动动画' },
          function () { return h(Panel, {}) }
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
