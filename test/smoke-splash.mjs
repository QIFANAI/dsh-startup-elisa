/* 浏览器半侧冒烟 v0.5（速度系统）：
 *  [A] lib/splash.js —— normalize(sound/volume/splashSpeed)、iframe URL 透传（含 speed=）、
 *      ready/progress/done、HANDOFF 交接（随速度 I 缩放：850→950@80 等）、看门狗公式、
 *      replay、API speed/totalWallMs/watchdogMs
 *  [B] lib/audio.js —— mock HTMLAudioElement + mock 时钟：start/sync/stop/state、
 *      自动播放被拦的手势补播、404 不抛且只 warn 一次、reduced 走 chime、音量钳制、
 *      rate 透传（playbackRate/preservesPitch/state.rate/wallDuration）
 * 运行：node test/smoke-splash.mjs（由 npm test 串联）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const SPLASH_CODE = fs.readFileSync(fileURLToPath(new URL('../lib/splash.js', import.meta.url)), 'utf8')
const AUDIO_CODE = fs.readFileSync(fileURLToPath(new URL('../lib/audio.js', import.meta.url)), 'utf8')

let pass = 0
function check(label, fn) {
  fn()
  pass++
  console.log('  ok   ' + label)
}

/* ================================================================ mock DOM */
class ClassList {
  constructor(el) { this.el = el; this.set = new Set() }
  add(c) { this.set.add(c); this.el.className = [...this.set].join(' ') }
  remove(c) { this.set.delete(c); this.el.className = [...this.set].join(' ') }
  contains(c) { return this.set.has(c) }
  toggle(c, on) { if (on) this.add(c); else this.remove(c) }
}

class Style {
  constructor() { this.props = {} }
  setProperty(k, v) { this.props[k] = String(v) }
  getPropertyValue(k) { return this.props[k] || '' }
  removeProperty(k) { delete this.props[k] }
}

class Elem {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parentNode = null
    this.attrs = {}
    this.style = new Style()
    this.listeners = {}
    this.className = ''
    this.classList = new ClassList(this)
    this.id = ''
    this.src = ''
    this.isConnected = true
    if (this.tagName === 'IFRAME') this.contentWindow = {}
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    child.isConnected = true
    this.children.push(child)
    return child
  }
  removeChild(child) {
    const i = this.children.indexOf(child)
    if (i >= 0) this.children.splice(i, 1)
    child.parentNode = null
    child.isConnected = false
    return child
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v)
    if (k === 'src') this.src = String(v)
    if (k === 'id') this.id = String(v)
  }
  removeAttribute(k) { delete this.attrs[k]; if (k === 'src') this.src = '' }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn) }
  dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this }) }
  set innerHTML(v) { this.children = []; this._innerHTML = String(v) }
  get innerHTML() { return this._innerHTML || '' }
}

function makeDom(opts = {}) {
  const clock = { now: 0 }
  const timers = []
  let timerId = 0
  function schedule(fn, ms) {
    const id = ++timerId
    timers.push({ id, fn, at: clock.now + Math.max(0, Number(ms) || 0), canceled: false })
    return id
  }
  function cancel(id) { const t = timers.find((x) => x.id === id); if (t) t.canceled = true }
  function advance(ms) {
    const target = clock.now + ms
    for (let guard = 0; guard < 500; guard++) {
      const due = timers.filter((t) => !t.canceled && t.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      clock.now = due.at
      due.canceled = true
      due.fn()
    }
    clock.now = target
  }
  const body = new Elem('body')
  const head = new Elem('head')
  const html = new Elem('html')
  const document = {
    body, head, documentElement: html,
    createElement: (tag) => new Elem(tag),
    getElementById: (id) => {
      const walk = (node) => {
        if (node.id === id) return node
        for (const child of node.children) {
          const found = walk(child)
          if (found) return found
        }
        return null
      }
      return walk(body) || walk(head)
    },
  }
  if (opts.injectRoot) {
    const root = new Elem('div')
    root.id = 'dsh-elisa-root'
    root.className = 'elisa-root elisa-boot'
    body.appendChild(root)
  }
  const messages = []
  const window = {
    document,
    innerWidth: 1920,
    innerHeight: 1080,
    __DSH_ELISA__: opts.config || null,
    __DSH_ELISA_FACTS__: opts.facts || { profile: 'DESKTOP', ready: true },
    location: { search: opts.search || '', hash: '' },
    matchMedia: () => ({ matches: false }),
    addEventListener: (type, fn) => { if (type === 'message') messages.push(fn) },
    removeEventListener: (type, fn) => {
      if (type !== 'message') return
      const i = messages.indexOf(fn)
      if (i >= 0) messages.splice(i, 1)
    },
    setTimeout: schedule,
    clearTimeout: cancel,
    fetch: () => Promise.resolve({ ok: false }),
  }
  window.window = window
  if (opts.skipFlag) window.__DSH_ELISA_SKIP__ = true
  const context = {
    window, document, console,
    setTimeout: schedule, clearTimeout: cancel,
    Promise, Object, Array, String, Number, Math, Date, Error, isFinite,
    encodeURIComponent, decodeURIComponent, matchMedia: window.matchMedia,
  }
  vm.createContext(context)
  vm.runInContext(SPLASH_CODE, context, { filename: 'splash.js' })
  return { window, document, body, head, html, timers, messages, advance, clock }
}

function bootSplash(config, opts = {}) {
  const env = makeDom(Object.assign({ config }, opts))
  const root = env.document.getElementById('dsh-elisa-root')
  const frame = root ? root.children.find((c) => c.tagName === 'IFRAME') : null
  const done = (reason) => env.messages.slice().forEach((fn) => fn({ source: frame && frame.contentWindow, data: { type: 'dsh-startup-elisa:done', reason } }))
  const ready = () => env.messages.slice().forEach((fn) => fn({ source: frame && frame.contentWindow, data: { type: 'dsh-startup-elisa:ready' } }))
  const progress = (t, phase) => env.messages.slice().forEach((fn) => fn({ source: frame && frame.contentWindow, data: { type: 'dsh-startup-elisa:progress', t, phase } }))
  return Object.assign(env, { root, frame, done, ready, progress })
}

/* =========================================================== [A] splash.js */
const V3 = { enabled: true, mode: 'session', allowSkip: true, reducedMotion: false, sound: true, volume: 65 }
const urlOf = (env) => env.frame ? String(env.frame.src) : ''

/* v0.5 速度派生（_p7/design-spec-v5.md §2.4）：
 * SPEED = splashSpeed/100；I = 1/sqrt(SPEED)；HANDOFF = round(850*I)；SKIP = round(480*I)；
 * WATCHDOG = clamp(round(4000 + 7200/SPEED + HANDOFF), 8000, 30000)；TOTAL_WALL = round(7200/SPEED)。
 * 默认 splashSpeed=80（缺键）→ 950 / 537 / 13950 / 9000。 */
const speedDerived = (splashSpeed) => {
  const SPEED = splashSpeed / 100
  const impact = 1 / Math.sqrt(SPEED)
  const handoff = Math.round(850 * impact)
  const skip = Math.round(480 * impact)
  const watchdog = Math.max(8000, Math.min(30000, Math.round(4000 + 7200 / SPEED + handoff)))
  const totalWallMs = Math.round(7200 / SPEED)
  return { SPEED, impact, handoff, skip, watchdog, totalWallMs, k: handoff / 850 }
}
const D80 = speedDerived(80)
const K80 = D80.k // 950/850 = 1.117647…（--elisa-k 分母固定 850 基线，自然交接 ≈ I）

console.log('[A1] 创建 iframe 与 URL 透传')
let env = bootSplash(V3)
let root = env.root
check('root 建成', () => assert.ok(root))
check('iframe 存在', () => assert.equal(root.children.length, 1))
check('iframe 类名', () => assert.match(root.children[0].className, /elisa-frame/))
check('iframe 预览入口', () => assert.match(urlOf(env), /\/dsh-elisa\/preview\/index\.html/))
check('iframe embed=1', () => assert.match(urlOf(env), /[?&]embed=1/))
check('iframe sound=1', () => assert.match(urlOf(env), /[?&]sound=1(&|$)/))
check('iframe volume=65', () => assert.match(urlOf(env), /[?&]volume=65(&|$)/))
check('iframe speed=80（默认速度）', () => assert.match(urlOf(env), /[?&]speed=80(&|$)/))
check('iframe v=0.6.0', () => assert.match(urlOf(env), /[?&]v=0\.6\.0(&|$)/))
check('iframe _ 缓存戳', () => assert.match(urlOf(env), /[?&]_=\d+/))
check('iframe allow autoplay', () => assert.equal(root.children[0].attrs.allow, 'autoplay'))
check('锁定滚动', () => assert.equal(env.document.documentElement.className, 'elisa-lock'))
check('body overflow hidden', () => assert.equal(env.document.body.style.overflow, 'hidden'))
check('API running', () => assert.equal(env.window.__DSH_ELISA_API__.state, 'running'))
check('API handoffMs 初始 0', () => assert.equal(env.window.__DSH_ELISA_API__.handoffMs, 0))
check('API 契约形状', () => {
  const api = env.window.__DSH_ELISA_API__
  for (const k of ['replay', 'skip', 'finish']) assert.equal(typeof api[k], 'function')
  for (const k of ['state', 'progress', 'ready', 'facts', 'handoffMs', 'config', 'speed', 'totalWallMs', 'watchdogMs']) assert.notEqual(api[k], undefined)
})
check('API speed=80 / totalWallMs=9000 / watchdogMs=13950', () => {
  const api = env.window.__DSH_ELISA_API__
  assert.equal(api.speed, 80)
  assert.equal(api.totalWallMs, 9000)
  assert.equal(api.watchdogMs, 13950)
})
check('API config.splashSpeed 归一 80', () => assert.equal(env.window.__DSH_ELISA_API__.config.splashSpeed, 80))

console.log('[A2] normalize / URL 参数钳制')
root = bootSplash(Object.assign({}, V3, { sound: false, volume: '150' })).root
check('sound=false → sound=0', () => assert.match(urlOf({ frame: root.children[0] }), /[?&]sound=0(&|$)/))
check('volume 150 → 100', () => assert.match(urlOf({ frame: root.children[0] }), /[?&]volume=100(&|$)/))
check('API config.handoffMs 存在', () => assert.equal(typeof env.window.__DSH_ELISA_API__.handoffMs, 'number'))
let e2 = bootSplash(Object.assign({}, V3, { volume: -20 }))
check('volume -20 → 0', () => assert.match(urlOf(e2), /[?&]volume=0(&|$)/))
let e3 = bootSplash(Object.assign({}, V3, { volume: 'abc' }))
check('volume 非法 → 65', () => assert.match(urlOf(e3), /[?&]volume=65(&|$)/))
let e4 = bootSplash(Object.assign({}, V3, { reducedMotion: true }))
check('reducedMotion → reduced=1', () => assert.match(urlOf(e4), /[?&]reduced=1(&|$)/))
let e5 = bootSplash(Object.assign({}, V3, { allowSkip: false }))
check('allowSkip=false → allowSkip=0', () => assert.match(urlOf(e5), /[?&]allowSkip=0(&|$)/))
let e6 = bootSplash(Object.assign({}, V3))
check('默认不带 reduced 参数', () => assert.doesNotMatch(urlOf(e6), /[?&]reduced=/))
check('默认不带 allowSkip=0', () => assert.doesNotMatch(urlOf(e6), /allowSkip=0/))

console.log('[A2b] splashSpeed 归一 / 派生量 / URL speed=')
const speedBoot = (value) => {
  const cfg = Object.assign({}, V3)
  if (value !== undefined) cfg.splashSpeed = value
  return bootSplash(cfg)
}
{
  const e100 = speedBoot(100)
  check('100%：URL speed=100', () => assert.match(urlOf(e100), /[?&]speed=100(&|$)/))
  check('100%：speed/totalWallMs/watchdogMs = 100 / 7200 / 12050', () => {
    const api = e100.window.__DSH_ELISA_API__
    assert.equal(api.speed, 100)
    assert.equal(api.totalWallMs, 7200)
    assert.equal(api.watchdogMs, 12050)
  })
  e100.done('natural')
  check('100%：HANDOFF=850（= v0.4 原速基线）', () => assert.equal(e100.window.__DSH_ELISA_API__.handoffMs, 850))
  check('100%：--elisa-k=1', () => assert.equal(e100.html.style.getPropertyValue('--elisa-k'), '1'))

  const e50 = speedBoot(50)
  const a50 = e50.window.__DSH_ELISA_API__
  check('50%：URL speed=50 / speed=50 / totalWallMs=14400 / watchdogMs=19602', () => {
    assert.match(urlOf(e50), /[?&]speed=50(&|$)/)
    assert.equal(a50.speed, 50)
    assert.equal(a50.totalWallMs, 14400)
    assert.equal(a50.watchdogMs, 19602)
  })
  e50.done('skip')
  check('50%：SKIP=round(480*I)=679', () => assert.equal(e50.window.__DSH_ELISA_API__.handoffMs, 679))
  const e50n = speedBoot(50)
  e50n.done('natural')
  check('50%：HANDOFF=round(850*I)=1202', () => assert.equal(e50n.window.__DSH_ELISA_API__.handoffMs, 1202))

  const e150 = speedBoot(150)
  const a150 = e150.window.__DSH_ELISA_API__
  check('150%：URL speed=150 / totalWallMs=4800 / watchdogMs=9494', () => {
    assert.match(urlOf(e150), /[?&]speed=150(&|$)/)
    assert.equal(a150.speed, 150)
    assert.equal(a150.totalWallMs, 4800)
    assert.equal(a150.watchdogMs, 9494)
  })
  e150.done('skip')
  check('150%：SKIP=round(480*I)=392', () => assert.equal(e150.window.__DSH_ELISA_API__.handoffMs, 392))
  const e150n = speedBoot(150)
  e150n.done('natural')
  check('150%：HANDOFF=round(850*I)=694', () => assert.equal(e150n.window.__DSH_ELISA_API__.handoffMs, 694))

  const e120 = speedBoot(120)
  const a120 = e120.window.__DSH_ELISA_API__
  check('120%：totalWallMs=6000 / watchdogMs=10776', () => {
    assert.equal(a120.speed, 120)
    assert.equal(a120.totalWallMs, 6000)
    assert.equal(a120.watchdogMs, 10776)
  })
  e120.done('natural')
  check('120%：HANDOFF=round(850*I)=776', () => assert.equal(e120.window.__DSH_ELISA_API__.handoffMs, 776))

  check('49 → 钳到 50', () => assert.match(urlOf(speedBoot(49)), /[?&]speed=50(&|$)/))
  check('151 → 钳到 150', () => assert.match(urlOf(speedBoot(151)), /[?&]speed=150(&|$)/))
  check('-10 → 钳到 50', () => assert.match(urlOf(speedBoot(-10)), /[?&]speed=50(&|$)/))
  check('缺键 → 默认 80', () => assert.match(urlOf(speedBoot(undefined)), /[?&]speed=80(&|$)/))
  check('非法字符串 → 默认 80', () => assert.match(urlOf(speedBoot('abc')), /[?&]speed=80(&|$)/))
  check('80.4 → 四舍五入 80', () => assert.match(urlOf(speedBoot(80.4)), /[?&]speed=80(&|$)/))
  check('80.6 → 四舍五入 81', () => assert.match(urlOf(speedBoot(80.6)), /[?&]speed=81(&|$)/))
}

console.log('[A3] ready / progress')
env = bootSplash(V3)
root = env.root
const frame = root.children[0]
check('ready 前保留 elisa-boot 遮罩', () => assert.match(root.className, /elisa-boot/))
env.messages[0]({ source: frame.contentWindow, data: { type: 'dsh-startup-elisa:ready' } })
check('ready 后移除 elisa-boot', () => assert.equal(root.classList.contains('elisa-boot'), false))
check('ready 后 API.ready=true', () => assert.equal(env.window.__DSH_ELISA_API__.ready, true))
env.progress(3.6, 'elisa')
check('progress 3.6 → 0.5', () => assert.equal(env.window.__DSH_ELISA_API__.progress, 0.5))
check('progress 更新 state', () => assert.equal(env.window.__DSH_ELISA_API__.state, 'elisa'))
env.progress(9, 'online')
check('progress 超 TOTAL 钳到 1', () => assert.equal(env.window.__DSH_ELISA_API__.progress, 1))
check('facts 透传', () => assert.equal(env.window.__DSH_ELISA_API__.facts.profile, 'DESKTOP'))
// ready 后看门狗应被清除：advance 12s 不应释放
env.advance(12000)
check('ready 后看门狗不误触发', () => assert.ok(env.document.getElementById('dsh-elisa-root')))

console.log('[A4] 自然 done：HANDOFF 950ms @80（= round(850*I)）交接编排')
env = bootSplash(V3)
root = env.root
const f4 = root.children[0]
env.messages[0]({ source: f4.contentWindow, data: { type: 'dsh-startup-elisa:ready' } })
env.done('natural')
check('root 加 .elisa-handoff', () => assert.match(root.className, /elisa-handoff/))
check('装饰层 .elisa-seam/.elisa-wash 注入', () => {
  assert.equal(root.children.length, 3)
  assert.match(root.children[1].className, /elisa-seam/)
  assert.match(root.children[2].className, /elisa-wash/)
})
check('root 仍保留（交接中）', () => assert.ok(env.document.getElementById('dsh-elisa-root')))
check('--elisa-k≈1.1176（950/850，自然交接 ≈ I）', () => {
  const k = Number(env.html.style.getPropertyValue('--elisa-k'))
  assert.ok(Math.abs(k - K80) < 1e-9, env.html.style.getPropertyValue('--elisa-k'))
})
check('handoffMs=950（80% 速度）', () => assert.equal(env.window.__DSH_ELISA_API__.handoffMs, 950))
check('done 后 state=done', () => assert.equal(env.window.__DSH_ELISA_API__.state, 'done'))
env.advance(267)
check('268ms 前未加 elisa-enter', () => assert.equal(env.html.classList.contains('elisa-enter'), false))
env.advance(1)
check('268ms 加 html.elisa-enter（round(240*k)）', () => assert.equal(env.html.classList.contains('elisa-enter'), true))
env.advance(23)
check('291ms .elisa-wash 开始扫描（round(260*k)）', () => assert.equal(root.children[2].classList.contains('go'), true))
env.advance(659)
check('950ms 后 root 移除', () => assert.equal(env.document.getElementById('dsh-elisa-root'), null))
check('950ms 后 body 无子节点', () => assert.equal(env.body.children.length, 0))
check('html.elisa-enter 已撤', () => assert.equal(env.html.classList.contains('elisa-enter'), false))
check('--elisa-k 已清理', () => assert.equal(env.html.style.getPropertyValue('--elisa-k'), ''))
check('滚动已解锁', () => assert.equal(env.document.documentElement.classList.contains('elisa-lock'), false))
check('body overflow 还原', () => assert.equal(env.document.body.style.overflow, ''))

console.log('[A5] skip / reduced / error 的交接（skip 随 I，reduced/error 固定）')
env = bootSplash(V3)
env.done('skip')
check('skip handoffMs=537（round(480*I)@80）', () => assert.equal(env.window.__DSH_ELISA_API__.handoffMs, 537))
env = bootSplash(V3)
env.done('skip')
check('skip --elisa-k≈0.6318（537/850）', () => {
  const k = Number(env.html.style.getPropertyValue('--elisa-k'))
  assert.ok(Math.abs(k - D80.skip / 850) < 1e-9, env.html.style.getPropertyValue('--elisa-k'))
})
env.advance(537)
check('skip 537ms 完成清理', () => assert.equal(env.body.children.length, 0))

env = bootSplash(Object.assign({}, V3, { reducedMotion: true }))
env.done('reduced')
check('reduced handoffMs=300（固定，与速度解耦）', () => assert.equal(env.window.__DSH_ELISA_API__.handoffMs, 300))
check('reduced --elisa-k≈0.3529（300/850）', () => {
  const k = Number(env.html.style.getPropertyValue('--elisa-k'))
  assert.ok(Math.abs(k - 300 / 850) < 1e-9, env.html.style.getPropertyValue('--elisa-k'))
})
env.advance(300)
check('reduced 300ms 完成清理', () => assert.equal(env.body.children.length, 0))

env = bootSplash(V3)
const fErr = env.root.children[0]
fErr.dispatch('error')
check('iframe error → handoffMs=40（固定）', () => assert.equal(env.window.__DSH_ELISA_API__.handoffMs, 40))
check('error --elisa-k≈0.0471（40/850）', () => {
  const k = Number(env.html.style.getPropertyValue('--elisa-k'))
  assert.ok(Math.abs(k - 40 / 850) < 1e-9, env.html.style.getPropertyValue('--elisa-k'))
})
env.advance(40)
check('error 40ms 快速释放', () => assert.equal(env.body.children.length, 0))
check('error 标记 __DSH_ELISA_FAILED__', () => assert.equal(env.window.__DSH_ELISA_FAILED__, true))

console.log('[A6] 看门狗公式 / allowSkip / replay')
env = bootSplash(V3)
env.advance(13949)
check('13949ms 未超时', () => assert.ok(env.document.getElementById('dsh-elisa-root')))
env.advance(1)
check('13950ms 看门狗触发（clamp(round(4000+7200/SPEED+HANDOFF))@80）', () => assert.equal(env.window.__DSH_ELISA_API__.handoffMs, 40))
env.advance(40)
check('看门狗 40ms 释放', () => assert.equal(env.body.children.length, 0))
check('超时标记 FAILED', () => assert.equal(env.window.__DSH_ELISA_FAILED__, true))

env = bootSplash(Object.assign({}, V3, { splashSpeed: 50 }))
env.advance(19601)
check('50% 19601ms 未超时', () => assert.ok(env.document.getElementById('dsh-elisa-root')))
env.advance(1)
check('50% 19602ms 看门狗触发', () => assert.equal(env.window.__DSH_ELISA_API__.handoffMs, 40))
env.advance(40)
check('50% 看门狗释放', () => assert.equal(env.body.children.length, 0))

env = bootSplash(Object.assign({}, V3, { allowSkip: false }))
env.window.__DSH_ELISA_API__.skip()
check('allowSkip=false 时 skip 无效', () => assert.equal(env.window.__DSH_ELISA_API__.state, 'running'))
env.window.__DSH_ELISA_API__.finish()
env.advance(950)
check('finish 仍可释放', () => assert.equal(env.body.children.length, 0))

env = bootSplash(V3)
env.done('natural')
env.advance(950)
const oldRoot = env.document.getElementById('dsh-elisa-root')
env.window.__DSH_ELISA_API__.replay()
const newRoot = env.document.getElementById('dsh-elisa-root')
check('replay 重建 root', () => assert.ok(newRoot) && assert.notEqual(newRoot, oldRoot))
check('replay 重建 iframe', () => assert.equal(newRoot.children.filter((c) => c.tagName === 'IFRAME').length, 1))
check('replay state=running', () => assert.equal(env.window.__DSH_ELISA_API__.state, 'running'))
check('replay 后滚动重新锁定', () => assert.equal(env.document.documentElement.classList.contains('elisa-lock'), true))

console.log('[A7] 禁用 / SKIP 标记')
env = bootSplash(Object.assign({}, V3, { enabled: false }), { injectRoot: true })
env.advance(50)
check('禁用后无 root', () => assert.equal(env.document.getElementById('dsh-elisa-root'), null))
check('禁用后 API 仍存在', () => assert.equal(typeof env.window.__DSH_ELISA_API__.replay, 'function'))
env = makeDom({ config: V3, injectRoot: true, skipFlag: true })
check('SKIP 标记后无 root', () => assert.equal(env.document.getElementById('dsh-elisa-root'), null))
check('SKIP 标记后滚动解锁', () => assert.equal(env.document.documentElement.classList.contains('elisa-lock'), false))
check('SKIP 标记后 API state=done', () => assert.equal(env.window.__DSH_ELISA_API__.state, 'done'))

/* ============================================================ [B] audio.js */
const BOOT_SRC = '/dsh-elisa/lib/assets/audio/boot.wav'
const CHIME_SRC = '/dsh-elisa/lib/assets/audio/chime.wav'

function audioEnv(opts = {}) {
  const clock = { now: 0 }
  const timers = []
  let timerId = 0
  function schedule(fn, ms) {
    const id = ++timerId
    timers.push({ id, fn, at: clock.now + Math.max(0, Number(ms) || 0), ms: Number(ms) || 0, interval: false, canceled: false })
    return id
  }
  function scheduleInterval(fn, ms) {
    const id = ++timerId
    const every = Math.max(1, Number(ms) || 1)
    timers.push({ id, fn, at: clock.now + every, ms: every, interval: true, canceled: false })
    return id
  }
  function cancel(id) { const t = timers.find((x) => x.id === id); if (t) t.canceled = true }
  function advance(ms) {
    const target = clock.now + ms
    for (let guard = 0; guard < 800; guard++) {
      const due = timers.filter((t) => !t.canceled && t.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      clock.now = due.at
      if (due.interval) due.at += due.ms
      else due.canceled = true
      due.fn()
    }
    clock.now = target
  }
  const warns = []
  const errors = []
  const logs = []
  const docListeners = {}
  const body = new Elem('body')
  const html = new Elem('html')
  const document = {
    body, documentElement: html,
    addEventListener(type, fn) { (docListeners[type] || (docListeners[type] = [])).push(fn) },
    removeEventListener(type, fn) {
      const a = docListeners[type] || []
      const i = a.indexOf(fn)
      if (i >= 0) a.splice(i, 1)
    },
  }
  const audios = []
  const state = { playBehavior: opts.playBehavior || 'ok' }
  class AudioMock {
    constructor() {
      this._src = ''
      this.paused = true
      this.ended = false
      this.currentTime = 0
      this.duration = NaN
      this.volume = 1
      this.error = null
      this.listeners = {}
      this.attrs = {}
      this.parentNode = null
      this.style = {}
      this.playCalls = 0
      audios.push(this)
    }
    set src(v) {
      this._src = String(v)
      if (/chime/.test(this._src)) this.duration = 1.35
      else if (/boot/.test(this._src)) this.duration = 7.8
    }
    get src() { return this._src }
    setAttribute(k, v) { this.attrs[k] = String(v) }
    removeAttribute(k) { delete this.attrs[k] }
    addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn) }
    dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this }) }
    play() {
      this.playCalls++
      const behavior = state.playBehavior
      if (behavior === 'rejectNotAllowed') {
        const err = new Error('play() failed because the user didn\'t interact')
        err.name = 'NotAllowedError'
        return Promise.reject(err)
      }
      if (behavior === 'rejectOther') {
        const err = new Error('decode failed')
        err.name = 'NotSupportedError'
        return Promise.reject(err)
      }
      this.paused = false
      this.ended = false
      this.dispatch('playing')
      return Promise.resolve()
    }
    pause() { this.paused = true }
    load() { /* noop */ }
  }
  const window = {
    document,
    Audio: AudioMock,
    performance: { now: () => clock.now },
    _audios: audios,
  }
  window.window = window
  const context = {
    window, document, console: { warn: (...a) => warns.push(a.join(' ')), error: (...a) => errors.push(a.join(' ')), log: (...a) => logs.push(a.join(' ')) },
    setInterval: scheduleInterval, clearInterval: cancel,
    setTimeout: schedule, clearTimeout: cancel,
    Promise, Object, Array, String, Number, Math, Date, Error, isFinite,
  }
  vm.createContext(context)
  vm.runInContext(AUDIO_CODE, context, { filename: 'audio.js' })
  return { window, document, audios, clock, advance, warns, errors, logs, state, docListeners, body }
}

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

console.log('[B1] API 契约')
let ae = audioEnv()
const AUDIO = ae.window.ELISA_AUDIO
check('ELISA_AUDIO 存在', () => assert.ok(AUDIO))
check('version 0.6.0', () => assert.equal(AUDIO.version, '0.6.0'))
check('API 形状', () => {
  for (const k of ['init', 'start', 'sync', 'stop', 'state']) assert.equal(typeof AUDIO[k], 'function')
})

console.log('[B2] init / 元素 / 模式')
AUDIO.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, enabled: true, volume: 0.65, reduced: false })
check('创建 boot 元素', () => assert.equal(ae.audios.length, 2))
check('boot 元素 data 属性', () => assert.equal(ae.audios[0].attrs['data-elisa-audio'], 'boot'))
check('boot src 正确', () => assert.match(ae.audios[0].src, /boot\.wav/))
check('元素挂到 body', () => assert.equal(ae.body.children.length, 2))
check('音量写入元素', () => assert.equal(ae.audios[0].volume, 0.65))
const st0 = AUDIO.state()
check('state 形状与默认', () => {
  assert.equal(st0.enabled, true)
  assert.equal(st0.playing, false)
  assert.equal(st0.blocked, false)
  assert.equal(st0.volume, 0.65)
  assert.equal(st0.mode, 'boot')
  assert.equal(st0.duration, 7.8)
})
AUDIO.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, volume: 2 })
check('音量 >1 钳到 1', () => assert.equal(AUDIO.state().volume, 1))
AUDIO.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, volume: -1 })
check('音量 <0 钳到 0', () => assert.equal(AUDIO.state().volume, 0))
AUDIO.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, volume: '0.4' })
check('音量字符串转数值', () => assert.equal(AUDIO.state().volume, 0.4))
check('重复 init 重建元素（旧元素移除）', () => assert.equal(ae.body.children.length, 2))

console.log('[B3] start / sync / stop')
ae = audioEnv()
const A3 = ae.window.ELISA_AUDIO
A3.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, enabled: true, volume: 0.65, reduced: false })
A3.start()
await flush()
let s = A3.state()
check('start 后 playing=true', () => assert.equal(s.playing, true))
check('start 后 currentTime=0', () => assert.equal(s.currentTime, 0))
check('start 调用 play 一次', () => assert.equal(ae.audios[0].playCalls, 1))
ae.audios[0].currentTime = 1.0
A3.sync(1.2)
check('漂移 <0.5 不 seek', () => assert.equal(ae.audios[0].currentTime, 1.0))
A3.sync(3.0)
check('漂移 >0.5 对齐 seek', () => assert.equal(ae.audios[0].currentTime, 3.0))
A3.sync(7.8)
check('接近结尾不补播尾音（end guard）', () => assert.ok(ae.audios[0].currentTime <= 7.75, ae.audios[0].currentTime))
A3.stop(0)
check('stop(0) 立即暂停', () => assert.equal(ae.audios[0].paused, true))
check('stop 后 state.playing=false', () => assert.equal(A3.state().playing, false))
check('stop 后音量还原', () => assert.equal(ae.audios[0].volume, 0.65))
A3.start()
await flush()
A3.stop(180)
ae.advance(200)
check('stop(180) 淡出后暂停', () => assert.equal(ae.audios[0].paused, true))
check('stop 幂等（再次 stop 不抛）', () => { A3.stop(); A3.stop(50); ae.advance(60) })
A3.dispose()
check('dispose 移除元素', () => assert.equal(ae.body.children.length, 0))

console.log('[B4] 自动播放被拦：blocked + 手势补播')
ae = audioEnv({ playBehavior: 'rejectNotAllowed' })
const A4 = ae.window.ELISA_AUDIO
A4.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, enabled: true, volume: 0.65, reduced: false })
A4.start()
await flush()
s = A4.state()
check('被拦后 blocked=true', () => assert.equal(s.blocked, true))
check('被拦后 playing=false', () => assert.equal(s.playing, false))
check('绑定 pointerdown/keydown 手势', () => assert.ok((ae.docListeners.pointerdown || []).length >= 1 && (ae.docListeners.keydown || []).length >= 1))
A4.sync(1.5)
await flush()
check('被拦时 sync 记录待播位置（不抛）', () => assert.equal(A4.state().blocked, true))
ae.state.playBehavior = 'ok'
for (const fn of (ae.docListeners.pointerdown || []).slice()) fn({ target: ae.document })
await flush()
s = A4.state()
check('手势后补播 playing=true', () => assert.equal(s.playing, true))
check('手势后 blocked=false', () => assert.equal(s.blocked, false))
check('手势补播从同步秒数开始', () => assert.ok(ae.audios[0].currentTime >= 1.4 && ae.audios[0].currentTime <= 1.6, ae.audios[0].currentTime))
check('手势监听只触发一次', () => assert.equal((ae.docListeners.pointerdown || []).length, 0))

console.log('[B5] 手势后仍被拒 / 资源 404：warn 一次、不抛、不 console.error')
ae = audioEnv({ playBehavior: 'rejectNotAllowed' })
const A5 = ae.window.ELISA_AUDIO
A5.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, enabled: true, volume: 0.65, reduced: false })
A5.start()
await flush()
for (const fn of (ae.docListeners.pointerdown || []).slice()) fn({ target: ae.document })
await flush()
s = A5.state()
check('重试后仍被拒 → failed', () => assert.equal(s.failed, true))
check('重试后仍静默（mode silent）', () => assert.equal(s.mode, 'silent'))
check('仍被拒只 warn 一次', () => assert.ok(ae.warns.filter((w) => /autoplay/.test(w)).length === 1, ae.warns))
check('全程无 console.error', () => assert.equal(ae.errors.length, 0))

ae = audioEnv()
const A5b = ae.window.ELISA_AUDIO
A5b.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, enabled: true, volume: 0.65, reduced: false })
A5b.start()
await flush()
ae.audios[0].error = { code: 4 }
ae.audios[0].dispatch('error')
ae.audios[0].dispatch('error')
check('资源 404 后 failed=true', () => assert.equal(A5b.state().failed, true))
check('资源失败 mode=silent', () => assert.equal(A5b.state().mode, 'silent'))
check('资源失败只 warn 一次', () => assert.equal(ae.warns.filter((w) => /audio failed/.test(w)).length, 1, ae.warns))
check('资源失败不 console.error', () => assert.equal(ae.errors.length, 0))
check('资源失败不阻塞（start/sync 不抛）', () => { A5b.sync(2); A5b.stop(0) })

console.log('[B6] enabled=false / reduced 模式')
ae = audioEnv()
const A6 = ae.window.ELISA_AUDIO
A6.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, enabled: false, volume: 0.65, reduced: false })
check('enabled=false → state.enabled=false', () => assert.equal(A6.state().enabled, false))
check('enabled=false → mode silent', () => assert.equal(A6.state().mode, 'silent'))
A6.start()
await flush()
check('enabled=false 不播放', () => assert.equal(A6.state().playing, false))
check('enabled=false 不调用 play', () => assert.equal(ae.audios[0].playCalls, 0))

ae = audioEnv()
const A6b = ae.window.ELISA_AUDIO
A6b.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, enabled: true, volume: 0.65, reduced: true })
check('reduced → mode chime', () => assert.equal(A6b.state().mode, 'chime'))
check('reduced → chime duration 1.35', () => assert.equal(A6b.state().duration, 1.35))
A6b.start()
await flush()
const chimeEl = ae.audios.find((x) => x.attrs['data-elisa-audio'] === 'chime')
const bootEl = ae.audios.find((x) => x.attrs['data-elisa-audio'] === 'boot')
check('reduced 只播 chime', () => assert.equal(chimeEl.paused, false))
check('reduced 不播 boot', () => assert.equal(bootEl.paused, true))

console.log('[B7] ended / state / 版本')
ae = audioEnv()
const A7 = ae.window.ELISA_AUDIO
A7.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, enabled: true, volume: 0.65, reduced: false })
A7.start()
await flush()
ae.audios[0].paused = false
ae.audios[0].dispatch('ended')
check('ended 后 started=false（sync 不重启）', () => {
  const before = ae.audios[0].playCalls
  A7.sync(1.0)
  assert.equal(ae.audios[0].playCalls, before)
})
check('state 返回 duration/currentTime/mode', () => {
  const st = A7.state()
  assert.equal(typeof st.duration, 'number')
  assert.equal(typeof st.currentTime, 'number')
  assert.equal(typeof st.mode, 'string')
})

console.log('[B8] rate：速度透传 / playbackRate / preservesPitch / chime 固定 1.0')
ae = audioEnv()
const A8 = ae.window.ELISA_AUDIO
A8.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, enabled: true, volume: 0.65, reduced: false, rate: 0.8 })
const boot8 = ae.audios.find((x) => x.attrs['data-elisa-audio'] === 'boot')
const chime8 = ae.audios.find((x) => x.attrs['data-elisa-audio'] === 'chime')
check('boot 元素 playbackRate=0.8', () => assert.equal(boot8.playbackRate, 0.8))
check('boot preservesPitch=true', () => assert.equal(boot8.preservesPitch, true))
check('boot webkitPreservesPitch=true（含 webkit 前缀）', () => assert.equal(boot8.webkitPreservesPitch, true))
check('chime playbackRate=1.0（不随速度）', () => assert.equal(chime8.playbackRate, 1))
const st8 = A8.state()
check('state.rate=0.8', () => assert.equal(st8.rate, 0.8))
check('state.preservesPitch=true', () => assert.equal(st8.preservesPitch, true))
check('state.wallDuration = duration/rate（时长随动画伸缩）', () => {
  assert.ok(Math.abs(st8.wallDuration - st8.duration / 0.8) < 1e-9, st8.wallDuration + ' vs ' + st8.duration / 0.8)
})
A8.start()
await flush()
check('start 后 playbackRate 仍为 0.8', () => assert.equal(boot8.playbackRate, 0.8))
check('rate 下 sync(t) 语义不变（元素时间=动画秒）', () => {
  boot8.currentTime = 1.0
  A8.sync(3.0)
  assert.equal(boot8.currentTime, 3.0)
})
A8.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, enabled: true, volume: 0.65, reduced: false, rate: 2 })
check('rate 2 → 钳到 1.5', () => assert.equal(A8.state().rate, 1.5))
A8.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, enabled: true, volume: 0.65, reduced: false, rate: 0.2 })
check('rate 0.2 → 钳到 0.5', () => assert.equal(A8.state().rate, 0.5))
A8.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, enabled: true, volume: 0.65, reduced: false, rate: 'abc' })
check('rate 非法 → 默认 1', () => assert.equal(A8.state().rate, 1))
A8.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, enabled: true, volume: 0.65, reduced: false })
check('缺省 rate → 1', () => assert.equal(A8.state().rate, 1))
A8.init({ src: BOOT_SRC, chimeSrc: CHIME_SRC, enabled: true, volume: 0.65, reduced: true, rate: 0.8 })
A8.start()
await flush()
const chimeR = ae.audios.find((x) => x.attrs['data-elisa-audio'] === 'chime' && !x.paused)
check('reduced 只播 chime 且 chime playbackRate=1', () => assert.ok(chimeR) && assert.equal(chimeR.playbackRate, 1))
check('rate 不产生 console.error', () => assert.equal(ae.errors.length, 0))

console.log(`\nSMOKE SPLASH+AUDIO PASS ${pass}`)
