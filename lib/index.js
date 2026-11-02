/* ============================================================================
 * dsh-startup-elisa — Host 半侧
 * ----------------------------------------------------------------------------
 * 1) 提供 /dsh-elisa 下的 splash.css / splash.js / preview / config / assets
 * 2) 在 index.html 首屏注入启动层、配置、真实宿主 facts 与看门狗
 * 3) 把配置原子写入 ~/.dsh/dsh-startup-elisa.json
 *
 * 浏览器侧的视觉与交互仍在 preview/index.html；本文件只负责把宿主页面、
 * 素材路由和真实 facts 接起来。
 * ========================================================================== */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CONFIG_FILE = path.join(DSH_HOME, 'dsh-startup-elisa.json')
const ASSET_ROOT = path.join(PACKAGE_ROOT, 'lib', 'assets')

const NS = 'dsh-startup-elisa'
const ROUTE_BASE = '/dsh-elisa'

const PLUGIN_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    return String(pkg.version || '').trim() || '0.0.0'
  } catch (err) {
    return '0.0.0'
  }
})()

const DEFAULTS = {
  enabled: true,
  mode: 'session',
  allowSkip: true,
  reducedMotion: false,
  sound: true,
  volume: 65,
  skin: 'glass',
  skinTheme: 'aurora',
  skinMotion: true,
  glassTransparency: 50,
  splashSpeed: 80
}

const BOOL_KEYS = ['enabled', 'allowSkip', 'reducedMotion', 'sound', 'skinMotion']
const ENUMS = {
  mode: ['session', 'daily', 'always'],
  skin: ['off', 'accent', 'full', 'glass'],
  skinTheme: ['aurora', 'deepsea', 'violet']
}
/* v0.5：glassTransparency 0..100（50=标准），splashSpeed 50..150（百分比，100=v0.4 原速） */
const NUMBERS = {
  volume: { min: 0, max: 100 },
  glassTransparency: { min: 0, max: 100 },
  splashSpeed: { min: 50, max: 150 }
}

function normalize(input) {
  const out = { ...DEFAULTS }
  const src = input && typeof input === 'object' ? input : {}
  for (const key of Object.keys(DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(src, key) || src[key] === undefined || src[key] === null) continue
    const value = src[key]
    if (BOOL_KEYS.includes(key)) {
      out[key] = value === true || value === 'true' || value === 1 || value === '1'
    } else if (ENUMS[key]) {
      out[key] = ENUMS[key].includes(value) ? value : DEFAULTS[key]
    } else if (NUMBERS[key]) {
      const range = NUMBERS[key]
      const n = Math.round(Number(value))
      out[key] = Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : DEFAULTS[key]
    }
  }
  return out
}

function readConfig() {
  try {
    return normalize(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')))
  } catch (err) {
    return { ...DEFAULTS }
  }
}

function writeConfig(next) {
  const cfg = normalize(next)
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  const tmp = CONFIG_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  fs.renameSync(tmp, CONFIG_FILE)
  return cfg
}

function makeReader(rel) {
  let cache = null
  return function read() {
    const file = path.join(PACKAGE_ROOT, rel)
    try {
      const st = fs.statSync(file)
      if (!cache || cache.mtimeMs !== st.mtimeMs || cache.size !== st.size) {
        cache = { mtimeMs: st.mtimeMs, size: st.size, text: fs.readFileSync(file, 'utf8') }
      }
      return cache.text
    } catch (err) {
      cache = null
      return ''
    }
  }
}

const readSplashCss = makeReader('lib/splash.css')
const readSplashJs = makeReader('lib/splash.js')
const readPreviewHtml = makeReader('preview/index.html')
const readAudioJs = makeReader('lib/audio.js')
const readSkinCss = makeReader('lib/skin.css')

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

const CRITICAL_CSS = [
  'html.elisa-lock,html.elisa-lock body{overflow:hidden!important}',
  '#dsh-elisa-root{position:fixed;inset:0;z-index:2147483000;background:#050508}'
].join('')

const BOOTSTRAP_JS = `(function(){try{
var c=window.__DSH_ELISA__||{};
var root=document.getElementById('dsh-elisa-root');
function seen(store,key,val){try{var s=window[store];return !!s&&s.getItem(key)===val}catch(e){return false}}
function mark(store,key,val){try{var s=window[store];if(s)s.setItem(key,val)}catch(e){}}
var off=!c.enabled;
if(!off&&c.mode==='session'&&seen('sessionStorage','dsh-startup-elisa:shown','1'))off=true;
if(!off&&c.mode==='daily'&&seen('localStorage','dsh-startup-elisa:day',new Date().toISOString().slice(0,10)))off=true;
if(off){window.__DSH_ELISA_SKIP__=true;if(root&&root.parentNode)root.parentNode.removeChild(root);}
else{
var sp=Math.max(50,Math.min(150,Number(c.splashSpeed)||80))/100;
var slow=1/sp;
var bootMs=Math.round(4000+7200*slow+850*Math.sqrt(slow))+3000;
if(bootMs>60000)bootMs=60000;
document.documentElement.classList.add('elisa-lock');
if(c.mode==='session')mark('sessionStorage','dsh-startup-elisa:shown','1');
if(c.mode==='daily')mark('localStorage','dsh-startup-elisa:day',new Date().toISOString().slice(0,10));
setTimeout(function(){try{
var r=document.getElementById('dsh-elisa-root');
if(r&&r.className&&r.className.indexOf('elisa-boot')!==-1){
if(r.parentNode)r.parentNode.removeChild(r);
document.documentElement.classList.remove('elisa-lock');
if(document.body)document.body.style.overflow='';
window.__DSH_ELISA_FAILED__=true;
}
}catch(e){}},bootMs);
}
}catch(e){} })()`

const MIME = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav'
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim())
  if (!m) return null
  if (m[1] === '' && m[2] === '') return { invalid: true }
  if (!Number.isFinite(size) || size <= 0) return { invalid: true }
  let start
  let end
  if (m[1] === '') {
    const n = Number(m[2])
    if (!Number.isFinite(n) || n <= 0) return { invalid: true }
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Number(m[2])
    if (end > size - 1) end = size - 1
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) {
    return { invalid: true }
  }
  return { start, end }
}

function readAssetSlice(file, start, end) {
  const length = end - start + 1
  const buf = Buffer.alloc(length)
  const fd = fs.openSync(file, 'r')
  try {
    let offset = 0
    while (offset < length) {
      const n = fs.readSync(fd, buf, offset, length - offset, start + offset)
      if (n <= 0) break
      offset += n
    }
    return offset === length ? buf : buf.subarray(0, offset)
  } finally {
    try { fs.closeSync(fd) } catch (err) { /* noop */ }
  }
}

function shortHash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).toUpperCase().padStart(8, '0')
}

const factsCache = { value: null, started: false }

function collectFacts(ctx) {
  if (factsCache.started) return factsCache.value
  factsCache.started = true
  const facts = { ready: false }
  factsCache.value = facts
  const get = (name) => {
    try { return typeof ctx.get === 'function' ? ctx.get(name) : undefined } catch (err) { return undefined }
  }

  ;(async () => {
    try {
      const pc = get('profileContext') || {}
      facts.profile = pc.name ? String(pc.name).toUpperCase() : null
      facts.workspace = pc.cwd ? String(pc.cwd).split(/[\\/]/).filter(Boolean).pop() : null
      facts.bundleCount = Array.isArray(pc.startedBundles) ? pc.startedBundles.length : null
    } catch (err) { /* noop */ }

    try {
      const sp = get('sandboxPolicy')
      let mode = sp && sp.defaultMode
      if (!mode && sp && typeof sp.resolve === 'function') {
        const r = sp.resolve()
        mode = r && r.mode
      }
      facts.sandbox = mode ? String(mode) : null
    } catch (err) { /* noop */ }

    try {
      const md = get('agentDefaultModel')
      if (md && typeof md.currentSelection === 'function') {
        const sel = await md.currentSelection()
        facts.model = sel && sel.model ? String(sel.model) : null
      }
    } catch (err) { /* noop */ }

    try {
      const pm = get('pluginManager')
      if (pm && typeof pm.listBundles === 'function') {
        const list = await pm.listBundles()
        if (Array.isArray(list) && list.length) {
          facts.bundleCount = list.length
          const base = list.find((b) => b && /dsh-base$/.test(String(b.name || '')))
          const core = base || list[0]
          if (core && core.version) facts.version = String(core.version).replace(/^v/, '')
        }
      }
    } catch (err) { /* noop */ }

    try {
      const inv = get('pluginInventory')
      if (inv && typeof inv.list === 'function') {
        const r = await inv.list()
        const entries = r && Array.isArray(r.entries) ? r.entries : (Array.isArray(r) ? r : [])
        if (entries.length) {
          facts.plugins = entries.length
          facts.activePlugins = entries.filter((e) => e && e.fiberPhase === 'active').length
        }
      }
    } catch (err) { /* noop */ }

    try {
      const s = get('sessions')
      if (s && typeof s.list === 'function') {
        const r = await s.list()
        if (Array.isArray(r)) facts.sessions = r.length
      }
    } catch (err) { /* noop */ }

    facts.hash = shortHash([
      facts.profile, facts.version, facts.model, facts.sandbox,
      facts.plugins, facts.bundleCount, facts.workspace
    ].map((x) => (x === null || x === undefined) ? '-' : String(x)).join('|'))
    facts.ready = true
  })().catch(() => { facts.ready = true })

  return facts
}

const name = NS
const inject = ['webServer', 'connection']

function resolveWebServer(ctx) {
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
    if (viaGet) return viaGet
  } catch (err) { /* noop */ }
  return ctx.webServer
}

function hasRoutes(server) {
  return !!server && typeof server.register === 'function' && typeof server.tapIndex === 'function'
}

function apply(ctx) {
  try { collectFacts(ctx) } catch (err) { /* noop */ }
  const disposers = []
  const warned = new Set()
  const webServer = resolveWebServer(ctx)

  function warnOnce(key, message) {
    if (warned.has(key)) return
    warned.add(key)
    try { ctx.logger?.warn?.('[' + NS + '] ' + message) } catch (err) { /* noop */ }
  }

  if (!hasRoutes(webServer)) {
    warnOnce('no-webserver', '当前 profile 没有 webServer；Host 半侧跳过路由与注入，改由客户端自举。')
    return
  }

  function rejected(req, res) {
    try {
      const conn = (typeof ctx.get === 'function' ? ctx.get('connection') : undefined) || ctx.connection
      if (!conn || typeof conn.requestRejection !== 'function') return false
      const code = conn.requestRejection(req)
      if (code === undefined || code === null || code === false) return false
      res.statusCode = typeof code === 'number' ? code : 403
      res.end()
      return true
    } catch (err) {
      return false
    }
  }

  function registerRoute(route) {
    const inner = route && route.handler
    const wrapped = Object.assign({}, route, {
      handler: async (req, res) => {
        if (rejected(req, res)) return
        return inner(req, res)
      }
    })
    return webServer.register(wrapped)
  }

  function sendJson(res, code, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length)
    })
    res.end(body)
  }

  function sendText(res, type, text, code = 200) {
    const body = Buffer.from(text, 'utf8')
    res.writeHead(code, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length)
    })
    res.end(body)
  }

  function readBody(req, limit = 64 * 1024) {
    return new Promise((resolve) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) {
          try { req.destroy?.() } catch (err) { /* noop */ }
          resolve('')
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', () => resolve(''))
    })
  }

  function sendAsset(req, res) {
    const method = String(req.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end()
      return
    }
    const prefix = ROUTE_BASE + '/lib/assets/'
    const pathname = String(req.url || '').split('?')[0].split('#')[0]
    if (!pathname.startsWith(prefix)) {
      res.writeHead(404)
      res.end()
      return
    }
    let rel
    try {
      rel = decodeURIComponent(pathname.slice(prefix.length))
    } catch (err) {
      res.writeHead(404)
      res.end()
      return
    }
    if (!rel || rel.includes('..') || rel.includes('\\')) {
      res.writeHead(404)
      res.end()
      return
    }
    const file = path.resolve(ASSET_ROOT, rel)
    if (!file.startsWith(ASSET_ROOT + path.sep)) {
      res.writeHead(404)
      res.end()
      return
    }
    const type = MIME[path.extname(file).toLowerCase()]
    if (!type) {
      res.writeHead(404)
      res.end()
      return
    }
    let size
    try {
      const st = fs.statSync(file)
      if (!st.isFile()) throw new Error('not a file')
      size = st.size
    } catch (err) {
      res.writeHead(404)
      res.end()
      return
    }

    const rangeHeader = req.headers ? (req.headers.range || req.headers.Range) : ''
    const range = rangeHeader ? parseRange(rangeHeader, size) : null
    if (range && range.invalid) {
      res.writeHead(416, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Range': 'bytes */' + size,
        'Content-Length': '0'
      })
      res.end()
      return
    }

    const headOnly = method === 'HEAD'
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400'
    }
    if (!range) {
      headers['Content-Length'] = String(size)
      if (headOnly) {
        res.writeHead(200, headers)
        res.end()
        return
      }
      let bytes
      try {
        bytes = fs.readFileSync(file)
      } catch (err) {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, headers)
      res.end(bytes)
      return
    }

    let bytes
    try {
      bytes = headOnly ? null : readAssetSlice(file, range.start, range.end)
    } catch (err) {
      res.writeHead(404)
      res.end()
      return
    }
    headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + size
    headers['Content-Length'] = String(range.end - range.start + 1)
    res.writeHead(206, headers)
    res.end(bytes === null ? undefined : bytes)
  }

  disposers.push(registerRoute({
    kind: 'exact',
    path: ROUTE_BASE + '/splash.css',
    handler: (req, res) => {
      const text = readSplashCss()
      if (!text) warnOnce('splash-css', 'lib/splash.css 读取失败。')
      sendText(res, 'text/css; charset=utf-8', text)
    }
  }))

  disposers.push(registerRoute({
    kind: 'exact',
    path: ROUTE_BASE + '/splash.js',
    handler: (req, res) => {
      const text = readSplashJs()
      if (!text) warnOnce('splash-js', 'lib/splash.js 读取失败。')
      sendText(res, 'application/javascript; charset=utf-8', text)
    }
  }))

  disposers.push(registerRoute({
    kind: 'exact',
    path: ROUTE_BASE + '/lib/audio.js',
    handler: (req, res) => {
      const text = readAudioJs()
      if (!text) warnOnce('audio-js', 'lib/audio.js 读取失败。')
      sendText(res, 'application/javascript; charset=utf-8', text)
    }
  }))

  disposers.push(registerRoute({
    kind: 'exact',
    path: ROUTE_BASE + '/skin.css',
    handler: (req, res) => {
      const text = readSkinCss()
      if (!text) warnOnce('skin-css', 'lib/skin.css 读取失败。')
      sendText(res, 'text/css; charset=utf-8', text)
    }
  }))

  disposers.push(registerRoute({
    kind: 'exact',
    path: ROUTE_BASE + '/preview/index.html',
    handler: (req, res) => {
      const html = readPreviewHtml()
      if (!html) {
        sendText(res, 'text/plain; charset=utf-8', 'preview not found', 404)
        return
      }
      sendText(res, 'text/html; charset=utf-8', html)
    }
  }))

  disposers.push(registerRoute({
    kind: 'prefix',
    path: ROUTE_BASE + '/lib/assets',
    handler: sendAsset
  }))

  disposers.push(registerRoute({
    kind: 'exact',
    path: ROUTE_BASE + '/config',
    handler: async (req, res) => {
      const method = String(req.method || 'GET').toUpperCase()
      if (method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          version: PLUGIN_VERSION,
          config: readConfig(),
          defaults: DEFAULTS,
          facts: factsCache.value || { ready: false },
          file: CONFIG_FILE
        })
        return
      }
      if (method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const text = await readBody(req)
      let payload = {}
      try {
        payload = text ? JSON.parse(text) : {}
      } catch (err) {
        sendJson(res, 400, { ok: false, error: 'invalid json' })
        return
      }
      try {
        if (payload && payload.action === 'reset') {
          sendJson(res, 200, {
            ok: true,
            version: PLUGIN_VERSION,
            config: writeConfig(DEFAULTS),
            defaults: DEFAULTS
          })
          return
        }
        const current = readConfig()
        const patch = payload && typeof payload.patch === 'object' && payload.patch ? payload.patch : payload
        sendJson(res, 200, {
          ok: true,
          version: PLUGIN_VERSION,
          config: writeConfig({ ...current, ...patch }),
          defaults: DEFAULTS
        })
      } catch (err) {
        sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    }
  }))

  disposers.push(webServer.tapIndex((html) => {
    if (typeof html !== 'string' || html.includes(ROUTE_BASE + '/splash.js')) return html
    const facts = factsCache.value || { ready: false }
    const cfg = { ...readConfig(), facts }
    const head =
      '<link rel="stylesheet" href="' + ROUTE_BASE + '/splash.css">' +
      '<style id="dsh-elisa-critical">' + CRITICAL_CSS + '</style>'
    const body =
      '<div id="dsh-elisa-root" class="elisa-root elisa-boot"></div>' +
      '<script>window.__DSH_ELISA_BOOT__="index";' +
      'window.__DSH_ELISA_VERSION__=' + safeJson(PLUGIN_VERSION) + ';' +
      'window.__DSH_ELISA_FACTS__=' + safeJson(facts) + ';' +
      'window.__DSH_ELISA__=' + safeJson(cfg) + ';' + BOOTSTRAP_JS + '</script>' +
      '<script defer src="' + ROUTE_BASE + '/splash.js"></script>'

    let out = html
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, head + '</head>')
    else out = head + out
    if (/<body[^>]*>/i.test(out)) out = out.replace(/<body[^>]*>/i, (tag) => tag + body)
    else if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, body + '</body>')
    else out = out + body
    return out
  }))

  const disposeAll = () => {
    for (const dispose of disposers) {
      try { dispose() } catch (err) { /* noop */ }
    }
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => disposeAll)
}

export { apply, inject, name }
