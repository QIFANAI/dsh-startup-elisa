/* 浏览器半侧（设置页）冒烟 v0.3：ModuleLoader 形状、设置页注册、皮肤三档运行时逻辑、
 * 皮肤样式注入 / token 作用域、设置页新分组与 serializeConfig 脏检测、桌面端自举路径。
 * 运行：node test/smoke-client.mjs（由 npm test 串联）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const CODE = fs.readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

let pass = 0
function check(label, fn) {
  fn()
  pass++
  console.log('  ok   ' + label)
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

/* ------------------------------------------------------------ mock DOM */
class ClassList {
  constructor(el) { this.el = el; this.set = new Set() }
  add(c) { this.set.add(c); this.el.className = [...this.set].join(' ') }
  remove(c) { this.set.delete(c); this.el.className = [...this.set].join(' ') }
  contains(c) { return this.set.has(c) }
}
class Elem {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parentNode = null
    this.dataset = {}
    this.style = {
      setProperty(k, v) { this[k] = String(v) },
      removeProperty(k) { delete this[k] },
      getPropertyValue(k) { return this[k] === undefined ? '' : String(this[k]) },
    }
    this.className = ''
    this.textContent = ''
    this.listeners = {}
    this.id = ''
    this.innerHTML = ''
    this.classList = new ClassList(this)
  }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child }
  get firstChild() { return this.children[0] || null }
  insertBefore(child, ref) {
    const i = ref ? this.children.indexOf(ref) : -1
    if (i >= 0) this.children.splice(i, 0, child); else this.children.push(child)
    child.parentNode = this
    return child
  }
  removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentNode = null; return child }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn) }
  dispatch(type) { for (const fn of this.listeners[type] || []) fn({ type }) }
  setAttribute(k, v) { this[k] = String(v); if (k === 'id') this.id = String(v) }
  removeAttribute(k) { delete this[k] }
  getAttribute(k) { return this[k] }
  focus() {}
}
const walk = (node, id, out = null) => {
  if (node.id === id) return node
  for (const child of node.children) { const found = walk(child, id, out); if (found) return found }
  return out
}

function makeReact() {
  return {
    createElement(type, props) {
      return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
    },
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
  }
}

/**
 * 构造一个 client.js 运行环境。
 * opts: { config(注入 window.__DSH_ELISA__), version(注入 __DSH_ELISA_VERSION__), fetchImpl, markSession }
 */
function makeEnv(opts = {}) {
  const head = new Elem('head')
  const body = new Elem('body')
  const html = new Elem('html')
  const document = {
    head, body, documentElement: html,
    hidden: false,
    querySelector: () => null,
    createElement: (tag) => new Elem(tag),
    getElementById: (id) => walk(body, id) || walk(head, id),
    addEventListener() {},
  }
  const loaded = []
  const warns = []
  const errors = []
  const store = {}
  const session = {}
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) }, removeItem: (k) => { delete store[k] } }
  const sessionStorage = { getItem: (k) => (k in session ? session[k] : null), setItem: (k, v) => { session[k] = String(v) }, removeItem: (k) => { delete session[k] } }
  if (opts.markSession) session['dsh-startup-elisa:shown'] = '1'
  const fetched = []
  const fetchImpl = opts.fetchImpl || ((url) => {
    fetched.push(String(url))
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        version: '0.6.0',
        config: Object.assign({ enabled: false, mode: 'session', allowSkip: true, reducedMotion: false, sound: true, volume: 65, skin: 'glass', skinTheme: 'aurora', skinMotion: true, glassTransparency: 50, splashSpeed: 80 }, opts.configPayload || {}),
        facts: { profile: 'WEB', ready: true },
        file: 'X',
      }),
    })
  })
  const window = {
    document,
    location: { href: 'http://127.0.0.1:3080/', reload() {} },
    addEventListener() {},
    setTimeout: (fn, ms) => { schedules.push({ fn, ms }); return schedules.length },
    clearTimeout() {},
    fetch: fetchImpl,
    sessionStorage, localStorage,
    __ModuleLoader__: { load: (entry) => loaded.push(entry) },
  }
  const schedules = []
  if (opts.bootFlag) window.__DSH_ELISA_BOOT__ = opts.bootFlag
  if (opts.config) window.__DSH_ELISA__ = opts.config
  if (opts.version) window.__DSH_ELISA_VERSION__ = opts.version
  window.window = window
  const context = {
    window, document, console: { warn: (...a) => warns.push(a.join(' ')), error: (...a) => errors.push(a.join(' ')), log() {} },
    fetch: fetchImpl, Promise, Object, Array, JSON, String, Number, Math, Date, Error, Symbol, isFinite,
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, Audio: function Audio() { this.paused = true; this.play = () => Promise.reject(new Error('no audio')); this.pause = () => {} },
  }
  vm.createContext(context)
  vm.runInContext(CODE, context, { filename: 'client.js' })
  const mod = loaded[0].factory((name) => {
    if (name === 'react') return makeReact()
    throw new Error('unexpected require: ' + name)
  })
  return { window, document, head, body, html, loaded, mod, warns, errors, fetched, schedules, sessionStorage, localStorage }
}

function mountClient(env, opts = {}) {
  const registrations = []
  let injected = 0
  const ctx = {
    slots: {
      inject(name, fn) {
        injected++
        assert.equal(name, 'settings.section')
        fn()
      },
      register(options, render) { registrations.push({ options, render }); return { dispose() {} } },
    },
  }
  env.mod.apply(ctx)
  return { registrations, injected }
}

const findLink = (env) => walk(env.head, 'dsh-elisa-skin-css')
const src = CODE

console.log('[1] ModuleLoader 形状')
let env = makeEnv()
check('注册一次', () => assert.equal(env.loaded.length, 1))
check('id 正确', () => assert.equal(env.loaded[0].id, 'dsh-startup-elisa'))
check('factory 是函数', () => assert.equal(typeof env.loaded[0].factory, 'function'))
check('factory 返回模块', () => assert.ok(env.mod && typeof env.mod.apply === 'function'))
check('inject=[slots]', () => assert.deepEqual([...env.mod.inject], ['slots']))

console.log('[2] 设置页注册与面板')
env = makeEnv()
let mount = mountClient(env)
check('settings.section 注入一次', () => assert.equal(mount.injected, 1))
check('注册一个设置段', () => assert.equal(mount.registrations.length, 1))
check('设置段 id', () => assert.equal(mount.registrations[0].options.id, 'startup-elisa'))
check('设置段 label', () => assert.equal(mount.registrations[0].options.label, 'ELISA 启动动画'))
check('设置段 order', () => assert.equal(mount.registrations[0].options.order, 27))
const hostTree = mount.registrations[0].render()
const tree = typeof hostTree.type === 'function' ? hostTree.type(hostTree.props) : hostTree
check('Panel 可渲染（loading 分支）', () => assert.equal(typeof tree, 'object'))
check('Panel 含标题', () => assert.match(JSON.stringify(tree), /ELISA 启动动画/))
check('Panel 版本 chip v0.6.0', () => assert.match(JSON.stringify(tree), /v0\.6\.0/))

console.log('[3] 皮肤：hint 同步 / config 异步 / 四档 class / glass 背景层')
env = makeEnv({ config: { enabled: true, skin: 'glass', skinTheme: 'deepsea', skinMotion: true } })
mountClient(env)
check('hint skin=glass 同步加 html class', () => assert.equal(env.html.classList.contains('dsh-elisa-skin'), true))
check('hint glass → dsh-elisa-skin--glass', () => assert.equal(env.html.classList.contains('dsh-elisa-skin--glass'), true))
check('hint glass → 主题 class（deepsea）', () => assert.equal(env.html.classList.contains('dsh-elisa-skin--theme-deepsea'), true))
check('hint glass → data-elisa-theme', () => assert.equal(env.html['data-elisa-theme'], 'deepsea'))
check('hint glass → 注入 #dsh-elisa-ambient', () => assert.ok(walk(env.body, 'dsh-elisa-ambient')))
check('ambient 结构完整（11 个子层，含 v0.6 暗帘/边缘呼吸层）', () => {
  const amb = walk(env.body, 'dsh-elisa-ambient')
  assert.match(String(amb.innerHTML), /ea-base/)
  assert.match(String(amb.innerHTML), /ea-b1/)
  assert.match(String(amb.innerHTML), /ea-b4/)
  assert.match(String(amb.innerHTML), /ea-sheen/)
  assert.match(String(amb.innerHTML), /ea-breath/)
  assert.match(String(amb.innerHTML), /ea-grain/)
  assert.match(String(amb.innerHTML), /ea-vignette/)
  assert.match(String(amb.innerHTML), /ea-dim/)
  assert.match(String(amb.innerHTML), /ea-rim/)
})
check('hint glass 写入 --elisa-glass-a=1（通透度 50 基准）', () => {
  assert.equal(env.html.style.getPropertyValue('--elisa-glass-a'), '1')
})
check('皮肤样式 link 注入', () => {
  const link = findLink(env)
  assert.ok(link)
  assert.match(link.href, /\/dsh-elisa\/skin\.css\?v=0\.6\.0/)
  assert.equal(link.rel, 'stylesheet')
})
check('__DSH_ELISA_SKIN__ 状态发布（glass）', () => {
  assert.equal(env.window.__DSH_ELISA_SKIN__.mode, 'glass')
  assert.equal(env.window.__DSH_ELISA_SKIN__.applied, true)
  assert.equal(env.window.__DSH_ELISA_SKIN__.theme, 'deepsea')
  assert.equal(env.window.__DSH_ELISA_SKIN__.ambient, true)
  assert.equal(env.window.__DSH_ELISA_SKIN__.glassTransparency, 50)
  assert.equal(env.window.__DSH_ELISA_SKIN__.glassAlpha, 1)
})
check('皮肤样式只注入一次', () => {
  env.un?.(null)
  mountClient(env)
  assert.equal(env.head.children.filter((x) => x.id === 'dsh-elisa-skin-css').length, 1)
})

env = makeEnv({ configPayload: { skin: 'accent' } })
mountClient(env)
await flush()
check('config accent 异步生效', () => assert.equal(env.html.classList.contains('dsh-elisa-skin--accent'), true))
check('config accent 不含 --full', () => assert.equal(env.html.classList.contains('dsh-elisa-skin--full'), false))
check('__DSH_ELISA_SKIN__.class 含 accent', () => assert.match(String(env.window.__DSH_ELISA_SKIN__.class), /dsh-elisa-skin--accent/))

env = makeEnv({ configPayload: { skin: 'off' } })
mountClient(env)
await flush()
check('config off 不加 class', () => assert.equal(env.html.classList.contains('dsh-elisa-skin'), false))
check('config off 不注入皮肤 link', () => assert.equal(findLink(env), null))
check('config off applied=false', () => assert.equal(env.window.__DSH_ELISA_SKIN__.applied, false))

env = makeEnv({ configPayload: { skin: 'bogus' } })
mountClient(env)
await flush()
check('非法 skin 归 off', () => assert.equal(env.html.classList.contains('dsh-elisa-skin'), false))

env = makeEnv({ fetchImpl: () => Promise.reject(new Error('network down')) })
mountClient(env)
await flush()
check('config 读取失败 → 默认 glass 兜底', () => assert.equal(env.html.classList.contains('dsh-elisa-skin--glass'), true))
check('config 读取失败只 warn', () => assert.ok(env.warns.some((w) => /皮肤配置失败/.test(w)), env.warns))
check('config 读取失败无 console.error', () => assert.equal(env.errors.length, 0))

env = makeEnv()
mountClient(env)
await flush()
const linkErr = findLink(env)
check('皮肤 css 元素存在可测', () => assert.ok(linkErr))
linkErr.dispatch('error')
await flush()
check('css 加载失败只 warn 不抛', () => assert.ok(env.warns.some((w) => /皮肤样式加载失败/.test(w)), env.warns))

env = makeEnv({ config: { enabled: false, skin: 'accent' } })
mountClient(env)
check('启动动画禁用时皮肤仍应用', () => assert.equal(env.html.classList.contains('dsh-elisa-skin--accent'), true))

console.log('[3b] glass 降级与清理')
env = makeEnv({ config: { enabled: true, skin: 'glass', skinMotion: false } })
mountClient(env)
check('skinMotion=false → --static 类', () => assert.equal(env.html.classList.contains('dsh-elisa-skin--static'), true))
check('static 时仍保留背景层', () => assert.ok(walk(env.body, 'dsh-elisa-ambient')))
env = makeEnv({ config: { enabled: true, skin: 'glass', reducedMotion: true } })
mountClient(env)
check('reducedMotion=true → 动态背景强制静态', () => assert.equal(env.html.classList.contains('dsh-elisa-skin--static'), true))
env = makeEnv({ configPayload: { skin: 'glass', skinTheme: 'violet' } })
mountClient(env)
await flush()
check('config violet 主题生效', () => assert.equal(env.html.classList.contains('dsh-elisa-skin--theme-violet'), true))
check('data-elisa-theme=violet', () => assert.equal(env.html['data-elisa-theme'], 'violet'))
env = makeEnv({ configPayload: { skin: 'accent' } })
mountClient(env)
await flush()
check('切离 glass 移除背景层', () => assert.equal(walk(env.body, 'dsh-elisa-ambient'), null))
check('切离 glass 移除主题属性', () => assert.equal(env.html['data-elisa-theme'], undefined))
check('切离 glass 移除主题 class', () => assert.equal(env.html.classList.contains('dsh-elisa-skin--theme-aurora'), false))
check('切离 glass 移除 --elisa-glass-a', () => assert.equal(env.html.style.getPropertyValue('--elisa-glass-a'), ''))
env = makeEnv({ configPayload: { skin: 'off' } })
mountClient(env)
await flush()
check('off 移除背景层', () => assert.equal(walk(env.body, 'dsh-elisa-ambient'), null))
check('off 移除玻璃 class', () => assert.equal(env.html.classList.contains('dsh-elisa-skin--glass'), false))

console.log('[3c] v0.5 玻璃通透度映射')
env = makeEnv({ config: { enabled: true, skin: 'glass', glassTransparency: 100 } })
mountClient(env)
check('通透度 100 → alpha 0.55', () => assert.equal(env.html.style.getPropertyValue('--elisa-glass-a'), '0.55'))
check('通透度 100 状态发布', () => {
  assert.equal(env.window.__DSH_ELISA_SKIN__.glassTransparency, 100)
  assert.equal(env.window.__DSH_ELISA_SKIN__.glassAlpha, 0.55)
})
env = makeEnv({ config: { enabled: true, skin: 'glass', glassTransparency: 0 } })
mountClient(env)
check('通透度 0 → alpha 1.45', () => assert.equal(env.html.style.getPropertyValue('--elisa-glass-a'), '1.45'))
env = makeEnv({ config: { enabled: true, skin: 'glass', glassTransparency: 33 } })
mountClient(env)
check('通透度 33 → alpha 1.153', () => assert.equal(env.html.style.getPropertyValue('--elisa-glass-a'), '1.153'))
env = makeEnv({ configPayload: { skin: 'glass', glassTransparency: 75 } })
mountClient(env)
await flush()
check('异步 config 通透度生效（75 → 0.775）', () => assert.equal(env.html.style.getPropertyValue('--elisa-glass-a'), '0.775'))

console.log('[4] 设置页 v0.5 文本契约（serializeConfig / 声音 / 外观皮肤 / 主题 / 动效 / 速度 / 通透度）')
check('FALLBACK_VERSION=0.6.0', () => assert.match(src, /FALLBACK_VERSION = '0\.6\.0'/))
check('FALLBACK 含 sound/volume/skin/theme/motion/glassTransparency/splashSpeed', () => {
  assert.match(src, /sound:\s*true/)
  assert.match(src, /volume:\s*65/)
  assert.match(src, /skin:\s*'glass'/)
  assert.match(src, /skinTheme:\s*'aurora'/)
  assert.match(src, /skinMotion:\s*true/)
  assert.match(src, /glassTransparency:\s*GLASS_TRANSPARENCY_DEFAULT/)
  assert.match(src, /splashSpeed:\s*SPLASH_SPEED_DEFAULT/)
})
check('声音分组与控件', () => {
  assert.match(src, /'声音'/)
  assert.match(src, /'启动音效'/)
  assert.match(src, /'音量'/)
  assert.match(src, /'试听'/)
  assert.match(src, /playAudition/)
})
check('外观皮肤分组与四档', () => {
  assert.match(src, /'外观皮肤'/)
  assert.match(src, /'皮肤档位'/)
  assert.match(src, /'关闭'/)
  assert.match(src, /'主题点缀'/)
  assert.match(src, /'完整皮肤'/)
  assert.match(src, /'毛玻璃'/)
  assert.match(src, /SKIN_HINT/)
})
check('主题背景与动态背景设置项', () => {
  assert.match(src, /'主题背景'/)
  assert.match(src, /'绯红极光'/)
  assert.match(src, /'深海蓝调'/)
  assert.match(src, /'紫夜霓虹'/)
  assert.match(src, /'动态背景'/)
  assert.match(src, /skinTheme/)
  assert.match(src, /skinMotion/)
})
check('v0.5 新增启动动画速度滑块', () => {
  assert.match(src, /'启动动画速度'/)
  assert.match(src, /set\('splashSpeed', value\)/)
  assert.match(src, /min: 50/)
  assert.match(src, /max: 150/)
  assert.match(src, /splashDurationFor/)
})
check('v0.5 新增玻璃通透度滑块', () => {
  assert.match(src, /'玻璃通透度'/)
  assert.match(src, /set\('glassTransparency', value\)/)
  assert.match(src, /min: 0/)
  assert.match(src, /max: 100/)
  assert.match(src, /glassAlphaFor/)
  assert.match(src, /--elisa-glass-a/)
})
check('serializeConfig 覆盖 sound/volume/skin/theme/motion/glassTransparency/splashSpeed', () => {
  assert.match(src, /config\.sound === false \? '0' : '1'/)
  assert.match(src, /clampVolume\(config\.volume\)/)
  assert.match(src, /normalizeSkin\(config\.skin\)/)
  assert.match(src, /normalizeTheme\(config\.skinTheme\)/)
  assert.match(src, /normalizeMotion\(config\.skinMotion\)/)
  assert.match(src, /normalizeGlassTransparency\(config\.glassTransparency\)/)
  assert.match(src, /normalizeSplashSpeed\(config\.splashSpeed\)/)
})
check('保存后立即应用皮肤（含通透度）', () => {
  const n = (src.match(/applySkin\(next\.skin, next\.skinTheme, next\.skinMotion, next\.reducedMotion, next\.glassTransparency\)/g) || []).length
  assert.ok(n >= 3, 'applySkin 调用次数 ' + n)
})
check('保存提示区分外观立即生效', () => assert.match(src, /外观与玻璃通透度已生效；启动动画设置（速度\/声音等）下次启动生效/))
check('内嵌预览 URL 携带 speed', () => {
  assert.match(src, /url \+= '&speed=' \+ normalizeSplashSpeed/)
})
check('宿主兜底计时按速度公式', () => {
  assert.match(src, /function bootFallbackMsFor/)
  assert.match(src, /4000 \+ SPLASH_BASE_MS \* slow \+ 850 \* Math\.sqrt\(slow\)/)
  assert.match(src, /SPLASH_BASE_MS = 7200/)
})
check('试听使用 boot.wav 且 4 秒', () => {
  assert.match(src, /AUDIO_ROUTE = BOOT_ROUTE \+ '\/lib\/assets\/audio\/'/)
  assert.match(src, /AUDITION_MS = 4000/)
  assert.match(src, /auditionSrc\(\)[\s\S]{0,120}boot\.wav/)
})
check('皮肤路由 /dsh-elisa/skin.css', () => assert.match(src, /SKIN_ROUTE = BOOT_ROUTE \+ '\/skin\.css'/))
check('皮肤 class 常量四档 + 主题', () => {
  assert.match(src, /SKIN_CLASS = 'dsh-elisa-skin'/)
  assert.match(src, /accent: 'dsh-elisa-skin--accent'/)
  assert.match(src, /full: 'dsh-elisa-skin--full'/)
  assert.match(src, /glass: 'dsh-elisa-skin--glass'/)
  assert.match(src, /aurora: 'dsh-elisa-skin--theme-aurora'/)
  assert.match(src, /deepsea: 'dsh-elisa-skin--theme-deepsea'/)
  assert.match(src, /violet: 'dsh-elisa-skin--theme-violet'/)
})
check('glass 背景层与降级常量', () => {
  assert.match(src, /AMBIENT_ID = 'dsh-elisa-ambient'/)
  assert.match(src, /SKIN_STATIC_CLASS = 'dsh-elisa-skin--static'/)
  assert.match(src, /SKIN_PAUSED_CLASS = 'dsh-elisa-skin--paused'/)
  assert.match(src, /SKIN_NOBLUR_CLASS = 'dsh-elisa-skin--noblur'/)
  assert.match(src, /function ensureAmbient/)
  assert.match(src, /function removeAmbient/)
  assert.match(src, /visibilitychange/)
})

console.log('[5] 桌面端自举路径')
env = makeEnv({ configPayload: { enabled: false } })
mountClient(env)
await flush()
check('disabled 不建 root', () => assert.equal(env.body.children.filter((x) => x.id === 'dsh-elisa-root').length, 0))
check('自举标记 client', () => assert.equal(env.window.__DSH_ELISA_BOOT__, 'client'))

env = makeEnv({ configPayload: { enabled: true, mode: 'session', allowSkip: true, reducedMotion: false } })
mountClient(env)
await flush()
const bootRoot = env.body.children.find((x) => x.id === 'dsh-elisa-root')
check('enabled 时自举 root', () => assert.ok(bootRoot))
check('自举锁定滚动', () => assert.equal(env.html.classList.contains('elisa-lock'), true))
check('自举注入 __DSH_ELISA__', () => assert.equal(env.window.__DSH_ELISA__.enabled, true))
const cssLink = env.head.children.find((x) => /\/dsh-elisa\/splash\.css/.test(String(x.href)))
check('自举加载 splash.css', () => assert.ok(cssLink))
cssLink.dispatch('load')
await flush()
check('自举加载 splash.js', () => assert.ok(env.head.children.some((x) => /\/dsh-elisa\/splash\.js/.test(String(x.src)))))
check('自举兜底按速度公式（默认 80% → 16950ms）', () => assert.ok(env.schedules.some((s) => s.ms === 16950), env.schedules.map((s) => s.ms)))

env = makeEnv({ configPayload: { enabled: true, splashSpeed: 50 } })
mountClient(env)
await flush()
check('自举兜底随速度变化（50% → 22602ms）', () => assert.ok(env.schedules.some((s) => s.ms === 22602), env.schedules.map((s) => s.ms)))

env = makeEnv({ configPayload: { enabled: true }, markSession: true })
mountClient(env)
await flush()
check('session 已标记不重播', () => assert.equal(env.body.children.filter((x) => x.id === 'dsh-elisa-root').length, 0))

env = makeEnv({ configPayload: { enabled: true }, bootFlag: 'index' })
mountClient(env)
await flush()
check('已有 BOOT 标记不重复自举', () => assert.equal(env.body.children.filter((x) => x.id === 'dsh-elisa-root').length, 0))
check('全程无 console.error', () => assert.equal(env.errors.length, 0))

console.log(`\nSMOKE CLIENT PASS ${pass}`)
