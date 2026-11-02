/* 皮肤样式契约冒烟（v0.6 FLOW）：skin.css 通透度变量 / 背景呼吸 / composer 呼吸流光 / 降级 / 性能约束。
 * 静态文本契约断言（不依赖宿主）：node test/smoke-skin.mjs（由 npm test 串联）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const CSS_PATH = fileURLToPath(new URL('../lib/skin.css', import.meta.url))
const css = fs.readFileSync(CSS_PATH, 'utf8')

let pass = 0
function check(label, fn) {
  fn()
  pass++
  console.log('  ok   ' + label)
}

/** 取「选择器以 sel 开头」的规则块（含嵌套 @supports 内的规则，用宽松匹配） */
function rulesFor(sel) {
  const out = []
  const re = /([^{}]*)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const norm = (x) => x.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim()
    const head = norm(m[1])
    if (head === norm(sel)) out.push({ sel: head, body: m[2] })
  }
  return out
}
function bodyOf(sel) {
  const rs = rulesFor(sel)
  assert.ok(rs.length > 0, '未找到规则: ' + sel)
  return rs.map((r) => r.body).join('\n')
}
function countMatches(re) {
  return (css.match(re) || []).length
}

console.log('[1] 文件与语法基线')
check('skin.css 存在且 ≥30KB', () => assert.ok(css.length >= 30000))
check('大括号配平', () => {
  let depth = 0
  for (const ch of css) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
    if (depth < 0) break
  }
  assert.equal(depth, 0)
})
check('v0.4 整窗毛玻璃规则保留', () => {
  assert.match(css, /html\.dsh-elisa-skin--glass #root \{[\s\S]*?backdrop-filter: blur\(26px\) saturate\(150%\) brightness\(0\.96\)/)
})
check('v0.4 ambient 子层保留（base/blob/sheen/grain/vignette）', () => {
  for (const sel of ['#dsh-elisa-ambient .ea-base', '#dsh-elisa-ambient .ea-blob', '#dsh-elisa-ambient .ea-sheen', '#dsh-elisa-ambient .ea-grain', '#dsh-elisa-ambient .ea-vignette']) {
    assert.ok(css.includes(sel), '缺少 ' + sel)
  }
})
check('三主题调色板保留', () => {
  assert.match(css, /html\.dsh-elisa-skin--glass\[data-elisa-theme="deepsea"\]/)
  assert.match(css, /html\.dsh-elisa-skin--glass\[data-elisa-theme="violet"\]/)
})

console.log('[2] 通透度：--elisa-glass-a 接入玻璃表面')
check('变量使用 ≥12 处（实测 29）', () => assert.ok(countMatches(/var\(--elisa-glass-a, 1\)/g) >= 12, 'count=' + countMatches(/var\(--elisa-glass-a, 1\)/g)))
check('所有 var(--elisa-glass-a) 都带默认值 1', () => {
  const uses = countMatches(/var\(--elisa-glass-a/g)
  const withFallback = countMatches(/var\(--elisa-glass-a, 1\)/g)
  assert.equal(uses, withFallback)
})
check('19 个玻璃令牌均为 rgba(calc(base*var))', () => {
  const tokens = [
    '--dsw-alias-bg-base', '--dsw-alias-bg-document-preview', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2',
    '--dsw-alias-bg-layer-3', '--dsw-specific-sidebar-fill', '--dsw-specific-input-major', '--dsw-specific-menu',
    '--dsw-alias-settings-card-fill', '--dsw-alias-button-floating-fill', '--dsw-alias-bg-multi-select',
    '--dsw-alias-button-elevated-fill', '--dsw-alias-interactive-bg-hover-solid', '--dsw-alias-bg-module-platform',
    '--dsw-alias-menu-surface-fill', '--dsw-alias-menu-group-header-fill', '--dsw-alias-toast-bg',
    '--dsw-alias-tooltip-bg', '--dsw-alias-onboarding-card-fill',
  ]
  for (const t of tokens) {
    const re = new RegExp('\\' + t + ': rgba\\(\\d+, \\d+, \\d+, calc\\([\\d.]+ \\* var\\(--elisa-glass-a, 1\\)\\)\\)')
    assert.match(css, re, t + ' 未接入通透度变量')
  }
})
check('旧硬编码玻璃 alpha 已移除', () => {
  for (const old of [
    '--dsw-alias-bg-base: rgba(9, 7, 13, 0.22);',
    '--dsw-specific-sidebar-fill: rgba(8, 6, 12, 0.42);',
    '--dsw-specific-input-major: rgba(30, 24, 38, 0.52);',
    '--dsw-alias-menu-surface-fill: rgba(20, 16, 27, 0.72);',
  ]) {
    assert.ok(!css.includes(old), '仍存在旧值: ' + old)
  }
})
check('模态面板 background-color 乘通透度变量', () => {
  const body = bodyOf('html.dsh-elisa-skin--glass :where([class*="_overlay" i]) :where([class*="_panel" i])')
  assert.match(body, /background-color: rgba\(20, 17, 27, calc\(0\.82 \* var\(--elisa-glass-a, 1\)\)\)/)
  assert.match(body, /backdrop-filter: blur\(28px\) saturate\(150%\)/) // 模糊半径保持 v0.4
})
check('模态遮罩 background-color 乘通透度变量', () => {
  const body = bodyOf('html.dsh-elisa-skin--glass :where([class*="_mask" i])')
  assert.match(body, /background-color: rgba\(4, 3, 8, calc\(0\.55 \* var\(--elisa-glass-a, 1\)\)\)/)
  assert.match(body, /backdrop-filter: blur\(8px\)/)
})
check('账号菜单 surface/material 填充（§4.7 #43454a73 → calc）', () => {
  assert.match(css, /--dsw-menu-surface-fill: rgba\(67, 69, 74, calc\(0\.45 \* var\(--elisa-glass-a, 1\)\)\)/)
  assert.ok(!css.includes('--dsw-menu-surface-fill: #43454a73'))
  assert.match(css, /--dsw-alias-interactive-bg-hover: rgba\(255, 255, 255, calc\(0\.08 \* var\(--elisa-glass-a, 1\)\)\)/)
})
check('--noblur 降级值同样乘通透度变量（≥6 处）', () => {
  const seg = css.slice(css.indexOf('dsh-elisa-skin--noblur'), css.indexOf('/* ── 4.5'))
  const n = (seg.match(/calc\(0\.\d+ \* var\(--elisa-glass-a, 1\)\)/g) || []).length
  assert.ok(n >= 6, 'noblur calc count=' + n)
})

console.log('[3] 背景呼吸 v2（可感知 + 对比度安全）')
check('.ea-breath 单层加大振幅（8.4s 单频完整周期 / transform+opacity）', () => {
  assert.match(css, /#dsh-elisa-ambient \.ea-breath \{[\s\S]*?animation: ea-breath-x 8\.4s cubic-bezier\(0\.45, 0, 0\.55, 1\) infinite/)
  const body = bodyOf('#dsh-elisa-ambient .ea-breath')
  assert.match(body, /radial-gradient/)
})
check('ea-breath-x 关键帧 scale 0.92→1.10 / opacity 0.10→0.44（0%/100%↔50%）', () => {
  assert.match(css, /@keyframes ea-breath-x \{[\s\S]*?scale\(0\.92\)[^}]*?\}[\s\S]*?scale\(1\.10\)/)
  assert.match(css, /@keyframes ea-breath-x \{[\s\S]*?opacity: 0\.10;[\s\S]*?opacity: 0\.44;/)
})
check('屏幕混合只用于 blob/sheen（呼吸/暗帘/边缘光不叠加 mix-blend-mode）', () => {
  for (const sel of ['#dsh-elisa-ambient .ea-breath', '#dsh-elisa-ambient .ea-dim', '#dsh-elisa-ambient .ea-rim']) {
    assert.ok(!/mix-blend-mode/.test(bodyOf(sel)), sel + ' 不应含 mix-blend-mode')
  }
  assert.match(bodyOf('#dsh-elisa-ambient .ea-blob'), /mix-blend-mode: screen/)
  assert.match(bodyOf('#dsh-elisa-ambient .ea-sheen'), /mix-blend-mode: screen/)
})
check('极光斑漂移加速 22/26/24/30s + 错相 glow 7.2/8.4/6.8/9.6s（0.45–0.55→1 谷值下压）', () => {
  assert.match(css, /ea-drift-b1 22s ease-in-out infinite alternate/)
  assert.match(css, /ea-drift-b2 26s ease-in-out infinite alternate/)
  assert.match(css, /ea-drift-b3 24s ease-in-out infinite alternate/)
  assert.match(css, /ea-drift-b4 30s ease-in-out infinite alternate/)
  assert.match(css, /ea-blob-glow-1 7\.2s/)
  assert.match(css, /ea-blob-glow-2 8\.4s/)
  assert.match(css, /ea-blob-glow-3 6\.8s/)
  assert.match(css, /ea-blob-glow-4 9\.6s/)
  assert.match(css, /@keyframes ea-blob-glow-1 \{ 0% \{ opacity: 0\.55; \} 100% \{ opacity: 1; \} \}/)
  assert.match(css, /@keyframes ea-blob-glow-3 \{ 0% \{ opacity: 0\.45; \} 100% \{ opacity: 1; \} \}/)
})
check('暗帘呼吸层 .ea-dim（8.4s 单频，0.76↔0.10，同相叠加；只含暗色）', () => {
  const body = bodyOf('#dsh-elisa-ambient .ea-dim')
  assert.match(body, /animation: ea-dim-breath 8\.4s ease-in-out infinite/)
  assert.match(body, /radial-gradient/)
  assert.match(css, /@keyframes ea-dim-breath \{\s*0%, 100% \{ opacity: 0\.76; \}\s*50% \{ opacity: 0\.10; \}/)
  const rgbs = [...body.matchAll(/rgba\((\d+), (\d+), (\d+),/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])])
  assert.ok(rgbs.length > 0, '.ea-dim 应有暗色渐变')
  for (const c of rgbs) assert.ok(Math.max(c[0], c[1], c[2]) <= 8, '暗帘颜色应接近黑: ' + JSON.stringify(c))
})
check('边缘呼吸光 .ea-rim（8.4s 同频，opacity 0.10↔0.38）', () => {
  const body = bodyOf('#dsh-elisa-ambient .ea-rim')
  assert.match(body, /animation: ea-rim-breath 8\.4s ease-in-out infinite/)
  assert.match(css, /@keyframes ea-rim-breath \{ 0%, 100% \{ opacity: 0\.10; \} 50% \{ opacity: 0\.38; \}/)
})
check('柔光扫过 22s + sheen 不透明度 0.6', () => {
  assert.match(css, /animation: ea-sheen 22s linear infinite/)
  assert.ok(!css.includes('ea-sheen 38s'))
  assert.match(bodyOf('#dsh-elisa-ambient .ea-sheen'), /opacity: 0\.6/)
})

const CARD_BEFORE = 'html.dsh-elisa-skin--glass :where([class*="composerSeat" i], [class*="composerStack" i]) :where([class*="_card"])::before'
const CARD_AFTER = 'html.dsh-elisa-skin--glass :where([class*="composerSeat" i], [class*="composerStack" i]) :where([class*="_card"])::after'

console.log('[4] composer 整圈流动光边框（v0.6：环 + 相位锁定泛光，删除光点）')
check('@property --ea-flow-angle 注册（角度可插值）；旧 --ea-border-angle 清除', () => {
  assert.match(css, /@property --ea-flow-angle \{\s*syntax: '<angle>';\s*inherits: false;\s*initial-value: 0deg;\s*\}/)
  assert.ok(!css.includes('--ea-border-angle'))
})
check('::before 1.6px 主题环：旋转 conic + mask-composite exclude（含 -webkit）', () => {
  const body = bodyOf(CARD_BEFORE)
  assert.match(body, /padding: 1\.6px/)
  assert.match(body, /conic-gradient\(from var\(--ea-flow-angle, 0deg\)/)
  assert.match(body, /conic-gradient\(from var\(--ea-flow-angle, 0deg\) in oklab/)
  assert.match(body, /mask-composite: exclude/)
  assert.match(body, /-webkit-mask-composite: xor/)
  assert.match(body, /pointer-events: none/)
  assert.match(body, /border-radius: inherit/)
  assert.match(body, /offset-path: none/)
  assert.ok(!css.includes('offset-path: rect('), 'v0.5 小光段 offset-path 必须删除')
})
check('::before 动画：8s linear 旋转 + 6.4s 环呼吸（opacity 0.50→1）', () => {
  const body = bodyOf(CARD_BEFORE)
  assert.match(body, /ea-flow-spin 8s linear infinite/)
  assert.match(body, /ea-ring-breath 6\.4s ease-in-out infinite alternate/)
  assert.match(css, /@keyframes ea-ring-breath \{\s*0% \{ opacity: 0\.58; \}\s*100% \{ opacity: 1; \}/)
})
check('::before 底环 alpha 可见（0.17–0.26）+ 暖白前缘（0.72@66°）+ 副弧（0.38@196°）+ 宽主弧', () => {
  const body = bodyOf(CARD_BEFORE)
  assert.match(body, /rgba\(var\(--ea-c1\), 0\.17\) 0deg/)
  assert.match(body, /rgba\(var\(--ea-c1\), 0\.26\) 24deg/)
  assert.match(body, /rgba\(255, 242, 236, 0\.72\) 66deg/)
  assert.match(body, /rgba\(var\(--ea-c3\), 0\.38\) 196deg/)
})
check('::after 泛光：同角度/同 8s/同 6.4s 相位锁定 + blur(7px) 静态声明 + 光带全在卡外', () => {
  const body = bodyOf(CARD_AFTER)
  assert.match(body, /conic-gradient\(from var\(--ea-flow-angle, 0deg\)/)
  assert.match(body, /ea-flow-spin 8s linear infinite/)
  assert.match(body, /ea-halo-breath 6\.4s ease-in-out infinite alternate/)
  assert.match(body, /filter: blur\(7px\)/)
  assert.match(body, /padding: 4px/)
  assert.match(body, /inset: -4px/)
  assert.match(body, /border-radius: 24px/)
  assert.match(body, /pointer-events: none/)
  assert.match(css, /@keyframes ea-halo-breath \{\s*0% \{ opacity: 0\.18; \}\s*100% \{ opacity: 0\.55; \}/)
})
check('关键帧齐全且旧光点关键帧已删除', () => {
  assert.match(css, /@keyframes ea-flow-spin \{\s*0% \{ --ea-flow-angle: 0deg; \}\s*100% \{ --ea-flow-angle: 360deg; \}\s*\}/)
  assert.ok(!css.includes('ea-composer-orbit'), '旧光点关键帧必须删除')
  assert.ok(!css.includes('offset-distance: 100%'), '旧 offset-distance 动画必须删除')
})
check('blur/filter 不参与逐帧动画（@keyframes 内无 filter/backdrop-filter）', () => {
  const kfs = []
  const re = /@keyframes\s+[\w-]+\s*\{/g
  let m
  while ((m = re.exec(css))) {
    let i = re.lastIndex
    let depth = 1
    while (i < css.length && depth > 0) {
      const ch = css[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }
    kfs.push(css.slice(m.index, i))
  }
  assert.ok(kfs.length >= 12, '@keyframes 数量=' + kfs.length)
  for (const k of kfs) {
    assert.ok(!/(?:^|[;\s])filter\s*:/.test(k), '@keyframes 内出现 filter: ' + k.slice(0, 60))
    assert.ok(!/backdrop-filter/.test(k), '@keyframes 内出现 backdrop-filter')
  }
})
check('聚焦提亮（:focus-within 环 brightness 1.15 / 泛光 blur(7px)+brightness 1.2）', () => {
  assert.match(css, /:where\(\[class\*="_card"\]\):focus-within::before \{\s*filter: brightness\(1\.15\) saturate\(1\.06\);/)
  assert.match(css, /:where\(\[class\*="_card"\]\):focus-within::after \{\s*filter: blur\(7px\) brightness\(1\.2\) saturate\(1\.1\);/)
})
check('回退：无 mask-composite → 1px 实色描边 + 泛光隐藏（不再有 offset-path 分支）', () => {
  assert.match(css, /@supports not \(\(mask-composite: exclude\) or \(-webkit-mask-composite: xor\)\)/)
  const m = css.slice(css.indexOf('@supports not ((mask-composite'))
  assert.match(m, /border: 1px solid rgba\(var\(--ea-c1\), 0\.42\)/)
  assert.match(m, /content: none/)
  assert.ok(!css.includes('@supports not (offset-path'))
})
check('composer 卡片本身不新增 position（零布局位移）', () => {
  assert.doesNotMatch(css, /:where\(\[class\*="_card"\]\)\s*\{[^}]*position:/)
})


console.log('[5] 降级（static / paused）')
check('static：ambient 全部动画 none', () => {
  assert.match(css, /html\.dsh-elisa-skin--glass\.dsh-elisa-skin--static #dsh-elisa-ambient \*,\s*html\.dsh-elisa-skin--glass\.dsh-elisa-skin--static #dsh-elisa-ambient \{\s*animation: none !important;/)
})
check('static：composer 两段动画 none + 保留静态环/弱泛光（v0.6 opacity 0.85/0.3）', () => {
  const a = css.slice(css.indexOf('/* 降级①：静态背景'))
  assert.match(a, /\.dsh-elisa-skin--static[\s\S]*?_card"\]\)::before \{[\s\S]*?animation: none;[\s\S]*?opacity: 0\.85;/)
  assert.match(a, /\.dsh-elisa-skin--static[\s\S]*?_card"\]\)::after \{[\s\S]*?animation: none;[\s\S]*?opacity: 0\.3;/)
})
check('paused：ambient + composer 两段 animation-play-state paused', () => {
  assert.match(css, /\.dsh-elisa-skin--paused #dsh-elisa-ambient \*[\s\S]*?animation-play-state: paused !important;/)
  assert.match(css, /\.dsh-elisa-skin--paused[\s\S]*?_card"\]\)::before,[\s\S]*?_card"\]\)::after \{\s*animation-play-state: paused;/)
})
check('ea-in 交接显影保留', () => {
  assert.match(css, /@keyframes ea-in/)
  assert.match(css, /html\.dsh-elisa-skin--glass\.elisa-enter #dsh-elisa-ambient \{ animation: ea-in 900ms ease-out both; \}/)
})

console.log('[6] 性能约束')
check('未新增 backdrop-filter（标准声明数仍为 4：整窗/无模糊降级/遮罩/模态面板）', () => {
  const n = countMatches(/(?:^|[;{\s])backdrop-filter\s*:/gm)
  assert.equal(n, 4, 'backdrop-filter 声明数=' + n + '（应保持 v0.4 的 4 个）')
  const blurs = css.match(/(?:^|[;{\s])backdrop-filter: blur\(([\d.]+)px\)/gm) || []
  const radii = blurs.map((x) => Number(x.match(/([\d.]+)px/)[1])).sort((a, b) => a - b)
  assert.deepEqual(radii, [8, 26, 28], 'blur 半径集合变化: ' + JSON.stringify(radii))
})
check('-webkit-backdrop-filter 声明数为 4', () => {
  const n = countMatches(/-webkit-backdrop-filter\s*:/g)
  assert.equal(n, 4, '-webkit-backdrop-filter 声明数=' + n)
})
check('composer 段不新增 backdrop-filter', () => {
  const seg = css.slice(css.indexOf('4.8 composer'))
  assert.ok(!/backdrop-filter\s*:/.test(seg), 'composer 段出现 backdrop-filter')
})
check('流光不使用 filter 大面积重绘的逐帧阴影动画（无 animation: *shadow*）', () => {
  assert.ok(!/@keyframes [\w-]*shadow/i.test(css))
})
check('header 局部深色兜底（对比度修复，floor 0.40 + 通透度变量）', () => {
  assert.match(css, /html\.dsh-elisa-skin--glass #root header \{\s*box-shadow: inset 0 -1px 0 rgba\(255, 255, 255, 0\.06\);\s*background-color: rgba\(7, 5, 10, max\(0\.40, 0\.22 \* var\(--elisa-glass-a, 1\)\)\);\s*\}/)
  const seg = css.slice(css.indexOf('html.dsh-elisa-skin--glass #root header {'))
  assert.ok(!/backdrop-filter/.test(seg.slice(0, 400)), 'header 兜底不得新增 backdrop-filter')
})
check('玻璃令牌 alpha 全部 <1 且不出现 >1 硬编码', () => {
  const bad = css.match(/rgba\(\d+, \d+, \d+, \d\.\d+\)/g) || []
  for (const c of bad) {
    const a = Number(c.slice(c.lastIndexOf(',') + 1, -1))
    assert.ok(a >= 0 && a <= 1, '非法 alpha: ' + c)
  }
})

console.log(`\nSMOKE SKIN PASS ${pass}`)
