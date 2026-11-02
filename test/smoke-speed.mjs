/* 速度系统冒烟 v0.5（纯静态文本契约，不依赖浏览器）：
 *  [P] preview/index.html —— 主时钟 t_anim = wall*SPEED、契约常量不动、?speed= 读入/钳制、
 *       --elisa-sp 冲击层缩放清单（缩放/不缩放）、phaseLog[].wall、video.playbackRate/不循环、
 *       音频 rate=SPEED、preview API（params.speed/totalWall、phaseLog[].wall、audio.rate）
 *  [S] lib/splash.js —— splashSpeed 归一、HANDOFF/WATCHDOG/TOTAL_WALL 公式、iframe URL speed=、
 *       --elisa-k 分母固定 850、API speed/totalWallMs/watchdogMs
 *  [A] lib/audio.js —— rate 归一（0.5..1.5）、boot playbackRate/preservesPitch、chime 固定 1.0
 * 运行：node test/smoke-speed.mjs（由 npm test 串联；无浏览器/无网络）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const PREVIEW = read('../preview/index.html')
const SPLASH = read('../lib/splash.js')
const AUDIO = read('../lib/audio.js')

let pass = 0
function check(label, fn) {
  fn()
  pass++
  console.log('  ok   ' + label)
}

/* 从多行 HTML/CSS 中取包含某标记的声明行（用于区分「缩放」与「不缩放」） */
function lineOf(text, marker) {
  const lines = text.split(/\r?\n/)
  const hit = lines.filter((l) => l.includes(marker))
  assert.ok(hit.length > 0, '未找到标记: ' + marker)
  return hit.join('\n')
}

/* =========================================================== [P] preview/index.html */
console.log('[P1] 契约时间轴常量不随速度改变（叙事层 D 由主时钟映射，常量不动）')
check('T_OPEN = 1.15', () => assert.match(PREVIEW, /var T_OPEN = 1\.15/))
check('T_ELISA = 2.25', () => assert.match(PREVIEW, /var T_ELISA = 2\.25/))
check('T_HANDSHAKE = 4.30', () => assert.match(PREVIEW, /var T_HANDSHAKE = 4\.30/))
check('T_CUT = 5.35', () => assert.match(PREVIEW, /var T_CUT = 5\.35/))
check('T_ONLINE = 5.77', () => assert.match(PREVIEW, /var T_ONLINE = 5\.77/))
check('HINT_AT = 6.28', () => assert.match(PREVIEW, /var HINT_AT = 6\.28/))
check('EXIT_AT = 6.62', () => assert.match(PREVIEW, /var EXIT_AT = 6\.62/))
check('SHUTTER_AT = 6.78', () => assert.match(PREVIEW, /var SHUTTER_AT = 6\.78/))
check('TOTAL = 7.20', () => assert.match(PREVIEW, /var TOTAL = 7\.20/))
check('timeline API 暴露 TOTAL 7.2', () => assert.match(PREVIEW, /T_OPEN: T_OPEN, T_ELISA: T_ELISA/))

console.log('[P2] ?speed= 读入 / 缺省 100 / 钳制 50–150 / SPEED 与 I 映射')
check('读 q.speed', () => assert.match(PREVIEW, /q\.has\('speed'\)/))
check('缺省 100（离线预览 = v0.4 原速）', () => assert.match(PREVIEW, /clampInt\(speedRaw, 50, 150, 100\)/))
check('SPEED = splashSpeed / 100', () => assert.match(PREVIEW, /var SPEED = splashSpeed \/ 100/))
check('IMPACT = 1 / sqrt(SPEED)', () => assert.match(PREVIEW, /var IMPACT = 1 \/ Math\.sqrt\(SPEED\)/))
check('TOTAL_WALL = round(TOTAL/SPEED, ms)', () => assert.match(PREVIEW, /var TOTAL_WALL = Math\.round\(TOTAL \/ SPEED \* 1000\) \/ 1000/))
check('--elisa-sp 写入 documentElement', () => assert.match(PREVIEW, /setProperty\('--elisa-sp', IMPACT\.toFixed\(5\)\)/))
check('--elisa-sp 默认值 1（JS 未执行时兜底）', () => assert.match(PREVIEW, /--elisa-sp:1;/))

console.log('[P3] 主时钟映射：t_anim = wall_elapsed * SPEED')
check('tick 用墙钟 × SPEED', () => assert.match(PREVIEW, /var t = wall \* SPEED\s*\/\/ 主时钟/))
check('tick 超过 TOTAL 收束到终帧', () => assert.match(PREVIEW, /if \(t >= TOTAL\) \{ update\(TOTAL\); finish\('natural'\); return \}/))
check('wallNow 记录真实墙钟', () => assert.match(PREVIEW, /var wallNow = 0/))
check('reduced 静态终帧墙钟 = REDUCED_T/SPEED', () => assert.match(PREVIEW, /wallNow = REDUCED_T \/ SPEED/))
check('?t= 定格墙钟 = t_anim/SPEED', () => assert.match(PREVIEW, /wallNow = t \/ SPEED/))
check('点击阈值按动画秒（0.35 契约值不变）', () => assert.match(PREVIEW, /\* SPEED\s*\/\/ 点击阈值按动画秒判定（0\.35 契约值不变）/))
check('autoskip 保持墙钟调试语义（文档口径：N 秒后跳过）', () => assert.match(PREVIEW, /setTimeout\(function \(\) \{ skip\('skip'\) \}, autoskip \* 1000\)/))

console.log('[P4] CSS 冲击层缩放清单（--elisa-sp = I，duration+delay 同乘）')
for (const marker of ['sweepGo ', 'flareGo ', 'bladeGo ', 'flashGo ', 'ringPulse ']) {
  check('缩放 ' + marker.trim() + '（一次性冲击）', () => {
    const line = lineOf(PREVIEW, 'animation:' + marker)
    assert.match(line, /var\(--elisa-sp,1\)/, line)
  })
}
check('缩放 tbIn 系列 5 条（标题逐行进场）', () => {
  const hits = PREVIEW.split(/\r?\n/).filter((l) => l.includes('animation:tbIn'))
  assert.equal(hits.length, 5, 'tbIn 规则数=' + hits.length)
  for (const l of hits) assert.match(l, /var\(--elisa-sp,1\)/, l)
})
check('tbIn delay 也同乘 --elisa-sp', () => {
  const line = lineOf(PREVIEW, 'animation:tbIn calc(.58s * var(--elisa-sp,1))')
  assert.match(line, /calc\(\.04s \* var\(--elisa-sp,1\)\)/)
})
check('缩放 valIn（遥测值锁定）', () => {
  const line = lineOf(PREVIEW, 'animation:valIn')
  assert.match(line, /var\(--elisa-sp,1\)/, line)
})

console.log('[P5] 氛围/循环层保持 1x（不乘 --elisa-sp）')
check('drift 羽毛（无限循环）不缩放', () => assert.doesNotMatch(lineOf(PREVIEW, 'animation:drift'), /--elisa-sp/))
check('dustUp 尘埃不缩放', () => assert.doesNotMatch(lineOf(PREVIEW, 'animation:dustUp'), /--elisa-sp/))
check('emberUp 火星不缩放', () => assert.doesNotMatch(lineOf(PREVIEW, 'animation:emberUp'), /--elisa-sp/))
check('twinkle 闪烁不缩放', () => assert.doesNotMatch(lineOf(PREVIEW, 'animation:twinkle'), /--elisa-sp/))
check('haloSpin 光环不缩放', () => assert.doesNotMatch(lineOf(PREVIEW, 'animation:haloSpin'), /--elisa-sp/))
check('pulse 状态点不缩放', () => assert.doesNotMatch(lineOf(PREVIEW, 'animation:pulse'), /--elisa-sp/))
check('seamBreath 光缝呼吸不缩放', () => assert.doesNotMatch(lineOf(PREVIEW, 'animation:seamBreath'), /--elisa-sp/))
check('opCaret 开场光标不缩放', () => assert.doesNotMatch(lineOf(PREVIEW, 'animation:opCaret'), /--elisa-sp/))

console.log('[P6] 一次性 UI/退场过渡按审计不缩放（理由见 speed-report）')
check('reticle 覆盖层过渡不缩放（UI 响应感恒定）', () => assert.doesNotMatch(lineOf(PREVIEW, 'transition:opacity .55s ease'), /--elisa-sp/))
check('ambient/glints 氛围淡入不缩放（氛围层 1x）', () => assert.doesNotMatch(lineOf(PREVIEW, 'transition:opacity 1.1s ease'), /--elisa-sp/))
check('rail/corners/grid HUD 框淡入不缩放', () => assert.doesNotMatch(lineOf(PREVIEW, 'transition:opacity .6s ease'), /--elisa-sp/))
check('offline finishing 退场不缩放（与 setTimeout 墙钟耦合）', () => assert.doesNotMatch(lineOf(PREVIEW, '.stage.finishing .splash'), /--elisa-sp/))

console.log('[P7] 视频：playbackRate=SPEED / muted / 不循环（结尾停最后一帧）')
check('applyVideoRate 设置 playbackRate=SPEED', () => assert.match(PREVIEW, /video\.playbackRate = SPEED/))
check('video.loop=false（不循环）', () => assert.match(PREVIEW, /video\.loop = false/))
check('<video> 标签无 loop 属性（不循环）', () => {
  const tag = PREVIEW.match(/<video[^>]*>/)
  assert.ok(tag, '未找到 <video>')
  assert.doesNotMatch(tag[0], /\sloop(?=[\s>=/])/, tag[0])
})
check('<video> 带 muted', () => assert.match(PREVIEW, /<video[^>]*muted/))
check('收尾暂停视频（停最后一帧）', () => assert.match(PREVIEW, /try \{ video\.pause\(\) \} catch/))

console.log('[P8] 音频：rate=SPEED / sync(t) 语义不变')
check('preview initAudio 传 rate: SPEED', () => assert.match(PREVIEW, /rate: SPEED\s*\/\/ 音轨与主时钟同速/))
check('preview audio 状态回退含 rate/preservesPitch', () => assert.match(PREVIEW, /rate: SPEED, preservesPitch: true, wallDuration: 0/))
check('audio state 透传（preview audio.rate）', () => assert.match(PREVIEW, /var st = audioApi\.state\(\) \|\| \{\}/))

console.log('[P9] phaseLog[].wall 与 preview API')
check('phaseLog 条目含 wall（真实墙钟秒）', () => assert.match(PREVIEW, /var entry = \{ key: act\.key, t: Math\.round\(lastT \* 1000\) \/ 1000, wall: Math\.round\(wallNow \* 1000\) \/ 1000 \}/))
check('API 顶层 wall getter', () => assert.match(PREVIEW, /get wall\(\) \{/))
check('API 顶层 totalWall getter', () => assert.match(PREVIEW, /get totalWall\(\) \{ return TOTAL_WALL \}/))
check('API 顶层 doneWall getter（结束墙钟，供 QA 测总时长）', () => assert.match(PREVIEW, /get doneWall\(\) \{ return doneWall \}/))
check('API 顶层 speed getter', () => assert.match(PREVIEW, /get speed\(\) \{ return splashSpeed \}/))
check('API t 为动画秒（?t= 定格直接返回）', () => assert.match(PREVIEW, /get t\(\) \{\s*\n\s*\/\/ 动画秒/))
check('params.speed / params.totalWall 暴露', () => assert.match(PREVIEW, /speed: splashSpeed, totalWall: TOTAL_WALL/))
check('phaseLog 暴露完整条目', () => assert.match(PREVIEW, /get phaseLog\(\) \{ return phaseLog\.slice\(\) \}/))

/* =============================================================== [S] lib/splash.js */
console.log('[S1] splashSpeed 归一 / 速度派生量')
check('SPEED_MIN = 50', () => assert.match(SPLASH, /var SPEED_MIN = 50/))
check('SPEED_MAX = 150', () => assert.match(SPLASH, /var SPEED_MAX = 150/))
check('SPEED_DEFAULT = 80', () => assert.match(SPLASH, /var SPEED_DEFAULT = 80/))
check('normalize 增 splashSpeed（非法/缺失回默认）', () => assert.match(SPLASH, /splashSpeed: int\(src\.splashSpeed, SPEED_MIN, SPEED_MAX, DEFAULTS\.splashSpeed\)/))
check('SPEED = cfg.splashSpeed / 100', () => assert.match(SPLASH, /SPEED = cfg\.splashSpeed \/ 100/))
check('IMPACT = 1 / sqrt(SPEED)', () => assert.match(SPLASH, /IMPACT = 1 \/ Math\.sqrt\(SPEED\)/))

console.log('[S2] 交接 / 看门狗 / 总墙钟公式（spec §2.4 表）')
check('HANDOFF_BASE_MS = 850（--elisa-k 分母）', () => assert.match(SPLASH, /var HANDOFF_BASE_MS = 850/))
check('HANDOFF_SKIP_BASE_MS = 480', () => assert.match(SPLASH, /var HANDOFF_SKIP_BASE_MS = 480/))
check('HANDOFF_MS = round(850 * I)', () => assert.match(SPLASH, /HANDOFF_MS = Math\.round\(HANDOFF_BASE_MS \* IMPACT\)/))
check('HANDOFF_SKIP_MS = round(480 * I)', () => assert.match(SPLASH, /HANDOFF_SKIP_MS = Math\.round\(HANDOFF_SKIP_BASE_MS \* IMPACT\)/))
check('HANDOFF_REDUCED_MS = 300 固定', () => assert.match(SPLASH, /var HANDOFF_REDUCED_MS = 300/))
check('HANDOFF_ERROR_MS = 40 固定', () => assert.match(SPLASH, /var HANDOFF_ERROR_MS = 40/))
check('WATCHDOG = clamp(round(4000 + 7200/SPEED + HANDOFF), 8000, 30000)', () => {
  assert.match(SPLASH, /Math\.round\(4000 \+ \(PREVIEW_TOTAL \* 1000\) \/ SPEED \+ HANDOFF_MS\)/)
  assert.match(SPLASH, /8000,\s*\n\s*30000/)
})
check('TOTAL_WALL_MS = round(7200 / SPEED)', () => assert.match(SPLASH, /TOTAL_WALL_MS = Math\.round\(\(PREVIEW_TOTAL \* 1000\) \/ SPEED\)/))
check('--elisa-k = clamp(ms/850, 0.02, 1.5)（分母固定基线，自然交接≈I）', () => {
  assert.match(SPLASH, /var k = Math\.max\(0\.02, Math\.min\(1\.5, ms \/ HANDOFF_BASE_MS\)\)/)
})

console.log('[S3] iframe URL / API 暴露')
check('iframe URL 追加 speed=<int>', () => assert.match(SPLASH, /'speed=' \+ cfg\.splashSpeed/))
check('API speed getter', () => assert.match(SPLASH, /get speed\(\) \{ return cfg\.splashSpeed \}/))
check('API totalWallMs getter', () => assert.match(SPLASH, /get totalWallMs\(\) \{ return TOTAL_WALL_MS \}/))
check('API watchdogMs getter', () => assert.match(SPLASH, /get watchdogMs\(\) \{ return WATCHDOG_MS \}/))
check('DEFAULTS 含 splashSpeed: 80', () => assert.match(SPLASH, /splashSpeed: SPEED_DEFAULT/))

/* ================================================================ [A] lib/audio.js */
console.log('[A1] rate 归一与透传')
check('DEFAULT_RATE = 1', () => assert.match(AUDIO, /var DEFAULT_RATE = 1/))
check('RATE_MIN = 0.5 / RATE_MAX = 1.5', () => {
  assert.match(AUDIO, /var RATE_MIN = 0\.5/)
  assert.match(AUDIO, /var RATE_MAX = 1\.5/)
})
check('normalize 增 rate（缺省默认 1）', () => assert.match(AUDIO, /rate: source\.rate === undefined \|\| source\.rate === null \? DEFAULT_RATE : source\.rate/))
check('init 内 rate clamp 到 0.5..1.5', () => assert.match(AUDIO, /rate = isFinite\(cfgRate\) \? clamp\(cfgRate, RATE_MIN, RATE_MAX\) : DEFAULT_RATE/))
check('boot 元素 playbackRate=rate', () => assert.match(AUDIO, /applyRate\(bootEl, rate\)/))
check('boot preservesPitch=true（含 webkit/moz 前缀）', () => {
  assert.match(AUDIO, /setPreservesPitch\(bootEl, true\)/)
  assert.match(AUDIO, /el\.webkitPreservesPitch = on/)
  assert.match(AUDIO, /el\.mozPreservesPitch = on/)
})
check('chime 固定 1.0', () => assert.match(AUDIO, /applyRate\(chimeEl, 1\)/))
check('start 时保持 rate（reduced 用 1）', () => assert.match(AUDIO, /applyRate\(el, reduced \? 1 : rate\)/))
check('state 暴露 rate / preservesPitch / wallDuration', () => {
  assert.match(AUDIO, /rate: rate,/)
  assert.match(AUDIO, /preservesPitch: readPreservesPitch\(el\)/)
  assert.match(AUDIO, /wallDuration: isFinite\(duration\) && duration > 0 \? duration \/ readPlaybackRate\(el\) : 0/)
})
check('sync(t) 语义不变（元素时间 = 动画秒，无 rate 乘除）', () => {
  const fn = AUDIO.match(/function sync\(t\) \{[\s\S]*?\n  \}/)
  assert.ok(fn, '未找到 sync 函数')
  assert.doesNotMatch(fn[0], /playbackRate|\* rate|\/ rate/, fn[0])
})

console.log(`\nSMOKE SPEED PASS ${pass}`)
