/* Host 半侧冒烟 v0.3：7 条路由、config 新键与钳制、音频/皮肤路由、首屏注入、Range 资源、清理。
 * 运行：node test/smoke-host.mjs（由 npm test 串联）
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SMOKE_HOME = path.join(os.tmpdir(), 'dsh-elisa-smoke-' + Date.now())
fs.mkdirSync(SMOKE_HOME, { recursive: true })
process.env.DSH_HOME = SMOKE_HOME
const CONFIG_FILE = path.join(SMOKE_HOME, 'dsh-startup-elisa.json')

let pass = 0
function check(label, fn) {
  fn()
  pass++
  console.log('  ok   ' + label)
}

const ROUTES = new Map()
const TAPS = []
let effects = 0
let rejectNext
let effectCleanup = null

const ctx = {
  webServer: {
    register(route) {
      const key = route.kind + ' ' + route.path
      if (ROUTES.has(key)) throw new Error('duplicate route ' + key)
      ROUTES.set(key, route)
      return () => ROUTES.delete(key)
    },
    tapIndex(fn) {
      TAPS.push(fn)
      return () => TAPS.splice(TAPS.indexOf(fn), 1)
    },
  },
  get(name) {
    if (name === 'connection') return { requestRejection() { return rejectNext } }
    if (name === 'profileContext') return { name: 'desktop', cwd: 'C:\\workspace', startedBundles: ['dsh-base', 'dsh-web-app'] }
    if (name === 'sandboxPolicy') return { defaultMode: 'workspace-write' }
    if (name === 'agentDefaultModel') return { currentSelection: async () => ({ model: 'deepseek-flash' }) }
    if (name === 'pluginManager') return { listBundles: async () => [{ name: '@deepseek-ai/dsh-base', version: '0.2.1-rc.5' }] }
    if (name === 'pluginInventory') return { list: async () => ({ entries: [{ fiberPhase: 'active' }, { fiberPhase: 'active' }, { fiberPhase: 'idle' }] }) }
    if (name === 'sessions') return { list: async () => [{}, {}] }
    return undefined
  },
  effect(fn) {
    effects++
    const cleanup = fn()
    if (typeof cleanup === 'function') effectCleanup = cleanup
    return () => {}
  },
}

class FakeReq extends EventEmitter {
  constructor(method, body, url, headers) {
    super()
    this.method = method
    this.headers = Object.assign({ host: '127.0.0.1:3080' }, headers || {})
    this.url = url || '/'
    process.nextTick(() => {
      if (body !== undefined) this.emit('data', Buffer.from(body))
      this.emit('end')
    })
  }
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(code, headers) {
      this.statusCode = code
      this.headers = headers || {}
      return this
    },
    end(buf) {
      this.body = buf === undefined ? Buffer.alloc(0) : Buffer.from(buf)
    },
  }
}

async function call(key, method = 'GET', body, url, headers) {
  const route = ROUTES.get(key)
  if (!route) throw new Error('route missing: ' + key)
  const res = fakeRes()
  await route.handler(new FakeReq(method, body, url, headers), res)
  return res
}

const mod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'lib', 'index.js')).href)

console.log('[1] 导出形状')
check('name', () => assert.equal(mod.name, 'dsh-startup-elisa'))
check('inject', () => assert.deepEqual(mod.inject, ['webServer', 'connection']))
check('apply', () => assert.equal(typeof mod.apply, 'function'))
check('无 default', () => assert.equal(mod.default, undefined))
check('无 Config', () => assert.equal(mod.Config, undefined))

console.log('[2] apply 注册路由')
mod.apply(ctx)
check('7 条路由', () => assert.equal(ROUTES.size, 7))
check('1 个 tapIndex', () => assert.equal(TAPS.length, 1))
check('ctx.effect', () => assert.equal(effects, 1))
await new Promise((r) => setTimeout(r, 30))

console.log('[3] 静态路由（v0.3 新增 audio.js / skin.css）')
let r = await call('exact /dsh-elisa/splash.css')
check('splash.css 200', () => assert.equal(r.statusCode, 200))
check('splash.css MIME', () => assert.match(r.headers['Content-Type'], /text\/css/))
check('splash.css 含 iframe 样式', () => assert.match(r.body.toString('utf8'), /elisa-frame/))
check('splash.css 含交接层样式', () => {
  const css = r.body.toString('utf8')
  assert.match(css, /elisa-seam/)
  assert.match(css, /elisa-wash/)
  assert.match(css, /elisa-handoff/)
})
r = await call('exact /dsh-elisa/splash.js')
check('splash.js 200', () => assert.equal(r.statusCode, 200))
check('splash.js 含 done 协议', () => assert.match(r.body.toString('utf8'), /dsh-startup-elisa:done/))
check('splash.js 含交接常量', () => {
  const js = r.body.toString('utf8')
  assert.match(js, /HANDOFF_MS/)
  assert.match(js, /HANDOFF_SKIP_MS/)
  assert.match(js, /HANDOFF_REDUCED_MS/)
  assert.match(js, /WATCHDOG/)
  assert.match(js, /splashSpeed/)
})
r = await call('exact /dsh-elisa/lib/audio.js')
check('audio.js 200', () => assert.equal(r.statusCode, 200))
check('audio.js MIME', () => assert.match(r.headers['Content-Type'], /javascript/))
check('audio.js 契约', () => {
  const js = r.body.toString('utf8')
  assert.match(js, /window\.ELISA_AUDIO/)
  assert.match(js, /function init/)
  assert.match(js, /function sync/)
  assert.match(js, /function stop/)
  assert.match(js, /NotAllowedError/)
  assert.match(js, /boot\.wav|src/)
})
r = await call('exact /dsh-elisa/skin.css')
check('skin.css 200', () => assert.equal(r.statusCode, 200))
check('skin.css MIME', () => assert.match(r.headers['Content-Type'], /text\/css/))
check('skin.css 作用域与 token 映射', () => {
  const css = r.body.toString('utf8')
  assert.match(css, /html\.dsh-elisa-skin,/)
  assert.match(css, /html\.dsh-elisa-skin--full/)
  assert.match(css, /html\.dsh-elisa-skin--glass/)
  assert.match(css, /#dsh-elisa-ambient/)
  assert.match(css, /backdrop-filter: blur\(26px\)/)
  assert.match(css, /data-elisa-theme="deepsea"/)
  assert.match(css, /html\.dsh-elisa-skin--glass\.dsh-elisa-skin--static/)
  assert.match(css, /--dsw-static-neutral-bluish-950:\s*#0d0d11/i)
  assert.match(css, /--dsw-static-deepseek-400:\s*#ff6675/i)
  assert.match(css, /pointer-events:\s*none/)
})
check('skin.css v0.6 通透度/呼吸/流光契约', () => {
  const css = r.body.toString('utf8')
  assert.match(css, /--elisa-glass-a/)
  assert.ok((css.match(/--elisa-glass-a/g) || []).length >= 12, '--elisa-glass-a 使用次数 ≥12')
  assert.match(css, /\.ea-breath/)
  assert.match(css, /\.ea-dim/)
  assert.match(css, /\.ea-rim/)
  assert.match(css, /@property\s+--ea-flow-angle/)
  assert.match(css, /ea-flow-spin/)
  assert.match(css, /ea-ring-breath/)
  assert.match(css, /ea-halo-breath/)
  assert.ok(!/offset-path: rect\(/.test(css), 'v0.6 不应残留 offset-path 小光段')
})
r = await call('exact /dsh-elisa/preview/index.html')
check('preview 200', () => assert.equal(r.statusCode, 200))
check('preview MIME', () => assert.match(r.headers['Content-Type'], /text\/html/))
check('preview 含 embed 与宿主配置', () => {
  const html = r.body.toString('utf8')
  assert.match(html, /q\.get\('embed'\)/)
  assert.match(html, /\/dsh-elisa\/config/)
})
check('preview 为 v0.3 时间轴', () => {
  const html = r.body.toString('utf8')
  assert.match(html, /var T_OPEN = 1\.15/)
  assert.match(html, /var TOTAL = 7\.20/)
  assert.match(html, /var SHUTTER_AT = 6\.78/)
  assert.match(html, /__DSH_ELISA_PREVIEW__/)
  assert.match(html, /opening/)
  assert.match(html, /ELISA_AUDIO/)
})
check('preview v0.5 速度契约', () => {
  const html = r.body.toString('utf8')
  assert.match(html, /q\.get\('speed'\)/)
  assert.match(html, /--elisa-sp/)
  assert.match(html, /totalWall/)
  assert.match(html, /phaseLog/)
})

console.log('[4] 配置默认值与新键')
r = await call('exact /dsh-elisa/config')
let payload = JSON.parse(r.body.toString('utf8'))
let cfg = payload.config
check('config ok', () => assert.equal(payload.ok, true))
check('版本 0.6.0', () => assert.equal(payload.version, '0.6.0'))
check('默认 enabled', () => assert.equal(cfg.enabled, true))
check('默认 mode', () => assert.equal(cfg.mode, 'session'))
check('默认 allowSkip', () => assert.equal(cfg.allowSkip, true))
check('默认 reducedMotion', () => assert.equal(cfg.reducedMotion, false))
check('默认 sound=true', () => assert.equal(cfg.sound, true))
check('默认 volume=65', () => assert.equal(cfg.volume, 65))
check('默认 skin=glass', () => assert.equal(cfg.skin, 'glass'))
check('默认 skinTheme=aurora', () => assert.equal(cfg.skinTheme, 'aurora'))
check('默认 skinMotion=true', () => assert.equal(cfg.skinMotion, true))
check('默认 glassTransparency=50', () => assert.equal(cfg.glassTransparency, 50))
check('默认 splashSpeed=80', () => assert.equal(cfg.splashSpeed, 80))
check('defaults 镜像', () => assert.deepEqual(payload.defaults, { enabled: true, mode: 'session', allowSkip: true, reducedMotion: false, sound: true, volume: 65, skin: 'glass', skinTheme: 'aurora', skinMotion: true, glassTransparency: 50, splashSpeed: 80 }))
check('profile fact', () => assert.equal(payload.facts.profile, 'DESKTOP'))
check('model fact', () => assert.equal(payload.facts.model, 'deepseek-flash'))
check('sandbox fact', () => assert.equal(payload.facts.sandbox, 'workspace-write'))
check('bundleCount fact', () => assert.equal(payload.facts.bundleCount, 1))
check('sessions fact', () => assert.equal(payload.facts.sessions, 2))
check('version fact', () => assert.equal(payload.facts.version, '0.2.1-rc.5'))
check('config file under DSH_HOME', () => assert.ok(payload.file.startsWith(SMOKE_HOME)))

console.log('[5] 配置新键校验与钳制')
r = await call('exact /dsh-elisa/config', 'POST', JSON.stringify({ patch: { sound: 'false', volume: 150, skin: 'accent' } }))
payload = JSON.parse(r.body.toString('utf8'))
cfg = payload.config
check('sound 字符串 false 转布尔', () => assert.equal(cfg.sound, false))
check('volume 150 钳到 100', () => assert.equal(cfg.volume, 100))
check('skin accent 写入', () => assert.equal(cfg.skin, 'accent'))
check('新配置落盘', () => {
  const disk = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  assert.equal(disk.sound, false)
  assert.equal(disk.volume, 100)
  assert.equal(disk.skin, 'accent')
})
r = await call('exact /dsh-elisa/config', 'POST', JSON.stringify({ patch: { volume: -20, skin: 'bogus' } }))
cfg = JSON.parse(r.body.toString('utf8')).config
check('volume 负数钳到 0', () => assert.equal(cfg.volume, 0))
check('非法 skin 回 glass', () => assert.equal(cfg.skin, 'glass'))
r = await call('exact /dsh-elisa/config', 'POST', JSON.stringify({ patch: { volume: 'abc' } }))
check('非法 volume 回 65', () => assert.equal(JSON.parse(r.body.toString('utf8')).config.volume, 65))
r = await call('exact /dsh-elisa/config', 'POST', JSON.stringify({ patch: { volume: 33.7 } }))
check('volume 33.7 取整 34', () => assert.equal(JSON.parse(r.body.toString('utf8')).config.volume, 34))
r = await call('exact /dsh-elisa/config', 'POST', JSON.stringify({ patch: { sound: 0, skin: 'off' } }))
cfg = JSON.parse(r.body.toString('utf8')).config
check('sound 数字 0 转布尔 false', () => assert.equal(cfg.sound, false))
check('skin off 写入', () => assert.equal(cfg.skin, 'off'))
r = await call('exact /dsh-elisa/config', 'POST', JSON.stringify({ patch: { skinTheme: 'deepsea', skinMotion: '0', skin: 'glass' } }))
cfg = JSON.parse(r.body.toString('utf8')).config
check('skin glass 写入', () => assert.equal(cfg.skin, 'glass'))
check('skinTheme deepsea 写入', () => assert.equal(cfg.skinTheme, 'deepsea'))
check('skinMotion 字符串 0 转 false', () => assert.equal(cfg.skinMotion, false))
r = await call('exact /dsh-elisa/config', 'POST', JSON.stringify({ patch: { skinTheme: 'bogus', skinMotion: 1 } }))
cfg = JSON.parse(r.body.toString('utf8')).config
check('非法 skinTheme 回 aurora', () => assert.equal(cfg.skinTheme, 'aurora'))
check('skinMotion 数字 1 转 true', () => assert.equal(cfg.skinMotion, true))

/* v0.5 新键：glassTransparency 0..100 / splashSpeed 50..150 */
r = await call('exact /dsh-elisa/config', 'POST', JSON.stringify({ patch: { glassTransparency: 0, splashSpeed: 150 } }))
cfg = JSON.parse(r.body.toString('utf8')).config
check('glassTransparency 0 写入', () => assert.equal(cfg.glassTransparency, 0))
check('splashSpeed 150 写入', () => assert.equal(cfg.splashSpeed, 150))
r = await call('exact /dsh-elisa/config', 'POST', JSON.stringify({ patch: { glassTransparency: 150, splashSpeed: 10 } }))
cfg = JSON.parse(r.body.toString('utf8')).config
check('glassTransparency 150 钳到 100', () => assert.equal(cfg.glassTransparency, 100))
check('splashSpeed 10 钳到 50', () => assert.equal(cfg.splashSpeed, 50))
r = await call('exact /dsh-elisa/config', 'POST', JSON.stringify({ patch: { glassTransparency: -5, splashSpeed: 999 } }))
cfg = JSON.parse(r.body.toString('utf8')).config
check('glassTransparency 负数钳到 0', () => assert.equal(cfg.glassTransparency, 0))
check('splashSpeed 999 钳到 150', () => assert.equal(cfg.splashSpeed, 150))
r = await call('exact /dsh-elisa/config', 'POST', JSON.stringify({ patch: { glassTransparency: 'abc', splashSpeed: 'xyz' } }))
cfg = JSON.parse(r.body.toString('utf8')).config
check('非法 glassTransparency 回 50', () => assert.equal(cfg.glassTransparency, 50))
check('非法 splashSpeed 回 80', () => assert.equal(cfg.splashSpeed, 80))
r = await call('exact /dsh-elisa/config', 'POST', JSON.stringify({ patch: { glassTransparency: 33.7, splashSpeed: 80.4 } }))
cfg = JSON.parse(r.body.toString('utf8')).config
check('glassTransparency 33.7 取整 34', () => assert.equal(cfg.glassTransparency, 34))
check('splashSpeed 80.4 取整 80', () => assert.equal(cfg.splashSpeed, 80))

console.log('[6] 旧配置缺键补默认 / reset / 非法输入')
fs.writeFileSync(CONFIG_FILE, JSON.stringify({ enabled: true, mode: 'always', allowSkip: false, reducedMotion: true }), 'utf8')
r = await call('exact /dsh-elisa/config')
cfg = JSON.parse(r.body.toString('utf8')).config
check('旧配置缺 sound 补 true', () => assert.equal(cfg.sound, true))
check('旧配置缺 volume 补 65', () => assert.equal(cfg.volume, 65))
check('旧配置缺 skin 补 glass', () => assert.equal(cfg.skin, 'glass'))
check('旧配置缺 skinTheme 补 aurora', () => assert.equal(cfg.skinTheme, 'aurora'))
check('旧配置缺 skinMotion 补 true', () => assert.equal(cfg.skinMotion, true))
check('旧配置缺 glassTransparency 补 50', () => assert.equal(cfg.glassTransparency, 50))
check('旧配置缺 splashSpeed 补 80', () => assert.equal(cfg.splashSpeed, 80))
check('旧配置已有键保留', () => assert.equal(cfg.mode, 'always'))
r = await call('exact /dsh-elisa/config', 'POST', JSON.stringify({ action: 'reset' }))
cfg = JSON.parse(r.body.toString('utf8')).config
check('reset 恢复全部默认', () => assert.deepEqual(cfg, { enabled: true, mode: 'session', allowSkip: true, reducedMotion: false, sound: true, volume: 65, skin: 'glass', skinTheme: 'aurora', skinMotion: true, glassTransparency: 50, splashSpeed: 80 }))
r = await call('exact /dsh-elisa/config', 'POST', 'not-json')
check('非法 JSON 400', () => assert.equal(r.statusCode, 400))
r = await call('exact /dsh-elisa/config', 'PUT')
check('PUT 405', () => assert.equal(r.statusCode, 405))

console.log('[7] 资源 Range 与目录穿越')
/* 公开仓库不带第三方人物素材：有素材时跑完整 Range 断言，无素材时验优雅 404。 */
const HAS_VIDEO = fs.existsSync(path.join(PLUGIN_ROOT, 'lib/assets/hero-loop.mp4'))
const HAS_LAYER = fs.existsSync(path.join(PLUGIN_ROOT, 'lib/assets/layers/wing_1.webp'))
if (HAS_VIDEO) {
  r = await call('prefix /dsh-elisa/lib/assets', 'HEAD', undefined, '/dsh-elisa/lib/assets/hero-loop.mp4')
  check('HEAD 视频 200', () => assert.equal(r.statusCode, 200))
  check('HEAD Accept-Ranges', () => assert.equal(r.headers['Accept-Ranges'], 'bytes'))
  const size = Number(r.headers['Content-Length'])
  check('视频大小 > 1MB', () => assert.ok(size > 1024 * 1024))

  r = await call('prefix /dsh-elisa/lib/assets', 'GET', undefined, '/dsh-elisa/lib/assets/hero-loop.mp4', { Range: 'bytes=0-99' })
  check('Range 206', () => assert.equal(r.statusCode, 206))
  check('Range 长度 100', () => assert.equal(r.body.length, 100))
  check('Content-Range', () => assert.match(r.headers['Content-Range'], /^bytes 0-99\//))

  r = await call('prefix /dsh-elisa/lib/assets', 'GET', undefined, '/dsh-elisa/lib/assets/hero-loop.mp4')
  check('完整视频 200', () => assert.equal(r.statusCode, 200))
  check('完整视频长度一致', () => assert.equal(r.body.length, size))
} else {
  r = await call('prefix /dsh-elisa/lib/assets', 'HEAD', undefined, '/dsh-elisa/lib/assets/hero-loop.mp4')
  check('无人物视频时 HEAD 优雅 404', () => assert.equal(r.statusCode, 404))
  r = await call('prefix /dsh-elisa/lib/assets', 'GET', undefined, '/dsh-elisa/lib/assets/hero-loop.mp4')
  check('无人物视频时 GET 优雅 404', () => assert.equal(r.statusCode, 404))
}

r = await call('prefix /dsh-elisa/lib/assets', 'GET', undefined, '/dsh-elisa/lib/assets/../package.json')
check('目录穿越 404', () => assert.equal(r.statusCode, 404))
r = await call('prefix /dsh-elisa/lib/assets', 'GET', undefined, '/dsh-elisa/lib/assets/nope.mp4')
check('不存在素材 404', () => assert.equal(r.statusCode, 404))
r = await call('prefix /dsh-elisa/lib/assets', 'GET', undefined, '/dsh-elisa/lib/assets/layers/wing_1.webp')
if (HAS_LAYER) {
  check('嵌套图层 200', () => assert.equal(r.statusCode, 200))
  check('图层 MIME', () => assert.equal(r.headers['Content-Type'], 'image/webp'))
} else {
  check('无图层时优雅 404', () => assert.equal(r.statusCode, 404))
}

console.log('[8] 音频资源（v0.3 新增 wav MIME）')
r = await call('prefix /dsh-elisa/lib/assets', 'HEAD', undefined, '/dsh-elisa/lib/assets/audio/boot.wav')
check('boot.wav HEAD 200', () => assert.equal(r.statusCode, 200))
check('boot.wav MIME audio/wav', () => assert.equal(r.headers['Content-Type'], 'audio/wav'))
const bootSize = Number(r.headers['Content-Length'])
check('boot.wav > 1MB（7.8s 44.1k stereo）', () => assert.ok(bootSize > 1024 * 1024, bootSize))
r = await call('prefix /dsh-elisa/lib/assets', 'HEAD', undefined, '/dsh-elisa/lib/assets/audio/chime.wav')
check('chime.wav HEAD 200', () => assert.equal(r.statusCode, 200))
check('chime.wav MIME audio/wav', () => assert.equal(r.headers['Content-Type'], 'audio/wav'))
check('chime.wav 100KB+', () => assert.ok(Number(r.headers['Content-Length']) > 100 * 1024))
r = await call('prefix /dsh-elisa/lib/assets', 'GET', undefined, '/dsh-elisa/lib/assets/audio/boot.wav', { Range: 'bytes=0-1023' })
check('wav Range 206', () => assert.equal(r.statusCode, 206))
check('wav Range 长度', () => assert.equal(r.body.length, 1024))

console.log('[9] 首屏注入（v0.5 速度兜底 / 版本）')
const base = '<!doctype html><html><head></head><body><div id="root"></div></body></html>'
const injected = TAPS[0](base)
check('注入 root', () => assert.match(injected, /id="dsh-elisa-root"/))
check('注入 splash.js', () => assert.match(injected, /\/dsh-elisa\/splash\.js/))
check('注入 splash.css', () => assert.match(injected, /\/dsh-elisa\/splash\.css/))
check('注入 config', () => assert.match(injected, /window\.__DSH_ELISA__/))
check('注入版本 0.6.0', () => assert.match(injected, /window\.__DSH_ELISA_VERSION__="0\.6\.0"/))
check('注入 config 含 sound', () => assert.match(injected, /"sound":true/))
check('注入 config 含 volume', () => assert.match(injected, /"volume":65/))
check('注入 config 含 skin', () => assert.match(injected, /"skin":"glass"/))
check('注入 config 含 skinTheme', () => assert.match(injected, /"skinTheme":"aurora"/))
check('注入 config 含 skinMotion', () => assert.match(injected, /"skinMotion":true/))
check('注入 config 含 glassTransparency', () => assert.match(injected, /"glassTransparency":50/))
check('注入 config 含 splashSpeed', () => assert.match(injected, /"splashSpeed":80/))
check('BOOTSTRAP_JS 兜底按速度公式', () => {
  assert.match(injected, /splashSpeed/)
  assert.match(injected, /bootMs/)
  assert.match(injected, /7200\*slow/)
  assert.doesNotMatch(injected, /\},14000\)/)
})
check('二次注入幂等', () => assert.equal(TAPS[0](injected), injected))

console.log('[10] 信任栅栏')
rejectNext = 403
r = await call('exact /dsh-elisa/splash.js')
check('requestRejection 403', () => assert.equal(r.statusCode, 403))
check('403 空体', () => assert.equal(r.body.length, 0))
r = await call('exact /dsh-elisa/config')
check('403 同样拦截 config', () => assert.equal(r.statusCode, 403))
rejectNext = undefined

console.log('[11] 生命周期清理')
if (typeof effectCleanup === 'function') effectCleanup()
check('清理后路由为 0', () => assert.equal(ROUTES.size, 0))
check('清理后 tapIndex 为 0', () => assert.equal(TAPS.length, 0))

console.log(`\nSMOKE HOST PASS ${pass}`)
