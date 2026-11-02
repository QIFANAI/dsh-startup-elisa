# P8 · 外部参考检索：高级「呼吸背景 + 流动光边框」（design-review 阶段 1）


> **仓库说明**：本文是开发期记录的公开镜像，已脱敏本机路径与用户名。文中 `_pN/`、`_p8/`、`_build/`、`_shots-*`、`releases/_superseded/` 等为维护者本机目录，未随公开仓库分发；设计规格、评审与 QA 报告已单独放入 `docs/`。


> 产出：可落 CSS 的技法清单 + 廉价/高级判定清单 + 本项目数值建议表 + 降级性能坑。
> 服务对象：v0.6.0 只做两件事（背景呼吸可辨、composer 边框整圈流动光）。
> 现状判定依据：`lib/skin.css` §4.3 ambient / §4.8 composer + `_p8/plan.md`。

## 0. 结论摘要

1. 用户要的「边框本身在流动」= **整圈 conic 光场连续旋转 + 外缘泛光（bloom）**，业界成熟结构就是 `@property --angle` 角度旋转 + `mask-composite: exclude` 抠环 + 第二伪元素 blur 泛光（Apple Intelligence 同款）；**小光点/短光段是 loading 语义，必须删**，不是调参能救。
2. 现有 composer =「静态 1px 环 + 110×2px 光段 + steps(48)」= 双结构冲突 + 小光点 + 分段跳动，三个廉价信号叠加，方向必须整体替换为「环 + 泛光」两段式。
3. 现有背景呼吸有效变化仅 1.8/255：幅度低（opacity .19→.36）、周期长（9.2s）、无空间位移；呼吸要「局部可辨」，全屏均匀明暗变化会被视觉忽略（change blindness）。
4. 提亮上限被 4.5:1 对比度预算锁死 → 呼吸不能抬峰值，要靠「**压低谷值 + 双相位交叉 + 边缘 bloom + 漂移加速**」在峰值不变前提下放大差值。
5. 性能：注册自定义属性的角度动画**不是合成层动画**（Chromium 每帧重绘），但绘制面积只有 composer 两个伪元素；blur/filter 必须是静态声明，绝不参与逐帧动画。

## 1. 来源清单（均于 2026-11-02 检索）

| # | 来源 | 关键价值 |
|---|---|---|
| S1 | <https://artofstyleframe.com/blog/apple-intelligence-gradient-css/> | Apple Intelligence 环+泛光完整配方：2px 环、1.8s/圈、halo padding 8px+blur 12px≈1.5×带宽、环与 halo 必须同周期、<200px 元件不要 halo |
| S2 | <https://www.bram.us/2021/01/29/animating-a-css-gradient-border/> | `@property` + `conic-gradient(from var(--angle))` 是可插值旋转的正解；`border-image` 不支持 `border-radius` |
| S3 | <https://dev.to/ericwoooo_kr/css-animated-gradient-borders-without-a-single-line-of-javascript-2k> | 旋转渐变每帧重绘 vs `transform:rotate()` 合成层的取舍；racing stripe 光弧；接缝必须重复首色；旋转只可 `linear`，任何 easing 都像 bug |
| S4 | <https://css-tricks.com/gradient-borders-in-css/> | 渐变边框四种实现与 z-index/overflow 坑；`border-image` 无圆角，圆角必须走 mask/padding 方案 |
| S5 | <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/mask-composite> | `mask-composite: exclude` 语义与 Baseline（2023-12 起 Widely available） |
| S6 | <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@property> | `@property` 三描述符必填、Baseline 2024；缺失/不支持时回退静态渐变 |
| S7 | <https://effect-labs.com/en/pages/blog/backgrounds-animes-css.html> | 极光分层（水平椭圆、双层负 delay 错相、微旋转+缩放）、grain、orb blur(60px) 与性能提醒、只用 transform/opacity |
| S8 | <https://www.joshwcomeau.com/css/make-beautiful-gradients/> | 「灰死区」成因与 oklab/oklch 插值；多 stop 手动插值可修彩带（banding） |
| S9 | <https://web.developers.google.cn/articles/stick-to-compositor-only-properties-and-manage-layer-count> | 只有 transform/opacity 是合成层属性；图层内存有成本；合成预算 4–5ms |
| S10 | <https://www.nngroup.com/articles/animation-duration/> | 动效要克制、频率越高越短越轻、必须尊重 reduced-motion；闪烁是可访问性问题 |
| S11 | <https://motion.svelte.page/examples/ai-glow-border> | Siri 光边解剖：薄环带 + conic 转子 + 位移波动 + 外圈 blob 光，是「高级」的当代基准 |

## 2. 可直接落 CSS 的技法（7 种）

| # | 技法 | 关键属性/选择器 | 推荐周期·缓动·幅度 | 性能与降级坑 |
|---|---|---|---|---|
| T1 | **conic 环角度旋转**（边框流动基座） | `@property --a{syntax:'<angle>';inherits:false;initial-value:0deg}`；`::before{inset:0;padding:1.5px;border-radius:inherit;background:conic-gradient(from var(--a),…);mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;animation:spin 8s linear infinite}` | 7–9s/圈，`linear` 恒定；角度差 = 光弧宽度 | 角度动画=每帧重绘；不支持 `@property` 时静环仍可读（S2/S6）；`border-image` 无圆角不可用（S2/S4） |
| T2 | **第二伪元素模糊泛光（bloom）** | `::after{inset:-1px;padding:4px;…同 conic；filter:blur(6px);opacity:.2–.55;mix-blend-mode:screen}`；**与 T1 同角度变量、同周期**（相位锁定） | blur ≈1.3–1.6×光带宽度；opacity 呼吸 2.2–2.8 峰谷比 | 静态 blur 形成合成层；blur 不可参与逐帧动画；环与 halo 不同周期会被读成渲染 bug（S1） |
| T3 | **旋转超大 conic 元素**（合成层友好的替代） | `::before{inset:-2px;background:conic-gradient(…);transform:rotate(var(--a))}`；父级 `overflow:hidden`+圆角裁切，靠卡片实心背景盖住内部 | 7–9s linear | 非正方形/非圆时旋转会让四角渐变角度歪斜；半透明玻璃卡内部会透出渐变，本项目 composer 不适用，仅作低配降级备选（S3） |
| T4 | **单元素双背景 / `border-image`** | `background:linear-gradient(#000,#000) padding-box, conic-gradient(…) border-box; border:1.5px solid transparent`；或 `border-image:conic-gradient(from var(--a),…) 1` | 同上 | `border-image` 忽略 `border-radius`（S2/S4）；单元素版要求卡片不透明，玻璃卡不可直接用 |
| T5 | **多段光弧分布**（2 主弧+长尾） | conic stops：底色 0.04–0.07 全程；主光弧 60–110°（前缘白热 6–12°→主题色→120–200° 指数衰减尾）；副光弧 25–50°，与主弧错开 ≥90°，中间留 ≥60° 纯透明/低光区 | 亮度比主:副 ≈1.6–2.2:1 | 弧数 >3 或两弧等亮对称 → 廉价「双环」；stops 之间要 6–10 个过渡点做角向柔化，不要靠整体 blur（S1/S3） |
| T6 | **全屏极光分层漂移** | 大水平椭圆 `radial-gradient(ellipse 120% 70% at …)` ×2–3 层；每层 `transform:translate3d()/rotate(±3deg)/scale(1→1.1–1.2)`，`animation-delay` 负值错相 | 漂移 18–40s，层间错相 1/4–1/2 周期；速度 ≥8–12px/s 才可感知 | 大层数吃合成层内存（S9）；`filter:blur(60px)` orb 最贵，优先用软 radial-gradient 边缘代替 blur（S7） |
| T7 | **双相位呼吸（antiphase crossfade）+ rim bloom** | 两个全屏呼吸层 A/B 位置错开：A `opacity .40→.12`，B `.12→.40`，同 duration（如 6.8s）delay 差半周期；`.ea-rim` 用反向暗角 `radial-gradient(…transparent 55%,theme 100%)` opacity `.10→.38` | 5.6–8s，`ease-in-out`；幅度按峰值不变、谷值下压设计 | 每层都是全屏合成层；峰值不升高 → 对比度预算安全；A/B 位置重叠过大时局部会叠加超预算 |

## 2.1 两段可直接抄的骨架

```css
/* composer：环 + 泛光（T1+T2+T5），φ=flow angle，θ=呼吸 */
@property --ea-flow-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.card::before {                                    /* 1.5px 主环 */
  content: ""; position: absolute; inset: 0; padding: 1.5px; border-radius: inherit;
  pointer-events: none; z-index: 1;
  background: conic-gradient(from var(--ea-flow-angle),
    rgba(255,255,255,.05) 0deg, rgba(var(--ea-c2),.40) 34deg, rgba(var(--ea-c1),.72) 56deg,
    rgba(255,255,255,.92) 66deg,                    /* 白热前缘 ≤10° */
    rgba(var(--ea-c1),.52) 84deg, rgba(var(--ea-c2),.10) 120deg,
    rgba(255,255,255,.05) 170deg, rgba(var(--ea-c3),.38) 208deg,
    rgba(var(--ea-c3),.10) 232deg, rgba(255,255,255,.05) 360deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  animation: ea-flow 8s linear infinite, ea-breathe-ring 6.4s ease-in-out infinite alternate;
}
.card::after {                                     /* 泛光：同角度、同 8s，相位锁定 */
  content: ""; position: absolute; inset: -1px; padding: 4px; border-radius: 21px;
  pointer-events: none; z-index: 0;
  background: conic-gradient(from var(--ea-flow-angle), /* 与 ::before 同一串 stops */);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude; -webkit-mask-composite: xor;
  filter: blur(6px); opacity: .2;
  animation: ea-flow 8s linear infinite, ea-breathe-halo 6.4s ease-in-out infinite alternate;
}
@keyframes ea-flow { to { --ea-flow-angle: 360deg; } }
@keyframes ea-breathe-ring { from { opacity: .58; } to { opacity: 1; } }      /* 峰谷比 1.72 */
@keyframes ea-breathe-halo { from { opacity: .20; } to { opacity: .55; } }    /* 峰谷比 2.75 */
```

```css
/* ambient：峰值不变、谷值下压的双相位呼吸（T6+T7） */
.ea-breath-a {                                     /* 左下 + 右侧大椭圆 */
  position: absolute; inset: -12%; pointer-events: none;
  background:
    radial-gradient(ellipse 95% 75% at 22% 62%, rgba(var(--ea-c1),.26) 0%, transparent 68%),
    radial-gradient(ellipse 75% 65% at 82% 34%, rgba(var(--ea-c2),.22) 0%, transparent 70%);
  animation: ea-breathe-a 6.8s ease-in-out infinite alternate, ea-drift-a 22s ease-in-out infinite alternate;
}
.ea-breath-b {                                     /* 左上 + 中下，与 A 反相 */
  position: absolute; inset: -12%; pointer-events: none;
  background:
    radial-gradient(ellipse 80% 70% at 12% 18%, rgba(var(--ea-c2),.20) 0%, transparent 66%),
    radial-gradient(ellipse 90% 55% at 55% 92%, rgba(var(--ea-c1),.18) 0%, transparent 72%);
  animation: ea-breathe-b 6.8s ease-in-out infinite alternate,
             ea-drift-b 26s ease-in-out infinite alternate;
  animation-delay: -3.4s, 0s;                      /* 反相 */
}
@keyframes ea-breathe-a { from { opacity: .12; transform: scale(.92); } to { opacity: .44; transform: scale(1.10); } }
@keyframes ea-breathe-b { from { opacity: .44; transform: scale(1.10); } to { opacity: .12; transform: scale(.92); } }
```

## 3. 「廉价 vs 高级」判定清单（评审直接打分用）

| 维度 | 廉价（判死/扣分） | 高级（目标） | 本项目目标值 |
|---|---|---|---|
| 光带宽度 | 亮点/短光段 <3% 周长（≈<60px）；单点转圈=loading | 2 弧，主 60–110°+副 25–50°，亮区合计 20–40% 周长 | composer 周长 ≈1960px → 亮区 ≥390px/≥72° |
| 柔化/尾巴 | 亮段等宽等亮、硬边、两端突然截断 | 白热前缘 6–12°，尾巴 120–200° 指数衰减，前短后长（彗星形） | stops 8–12 个过渡点，尾部 3 段递减 |
| 弧数与位置 | 1 个光点；或 2 弧等亮对称（双环冲突） | 主副亮度比 1.6–2.2:1，错开 ≥90°，间隔 ≥60° | 主弧 66° 白热 + 副弧 208° 青 |
| 色温/亮度层次 | 单一色相、全弧同 alpha、泛光纯白 | 白热芯（≤15°）→主题 c1 →辅 c2/c3 尾；泛光取主题色 | 白热 alpha .92，尾衰到 .10 |
| 旋转速度 | <3s/圈（spinner）、>12s（读作静止）、steps 可辨 | 7–9s linear，恒定角速度 | 8.0s linear |
| 呼吸节奏 | 与其它元素同周期同相（机械）；幅度 <20% 或 >65%（闪） | 5.6–6.8s ease-in-out，峰谷比 1.8–2.8；与旋转周期互质；多层错相 | 6.4s / 8.0s（比 1.25，合成 32s） |
| 泛光 bloom | 无 bloom 硬边；或大面积纯白 bloom 冲淡文字 | 2 层：紧 bloom 6–8px/opacity .4–.55，宽 bloom 18–26px/.08–.16；与主环相位锁定 | ::after blur 6px，opacity .20–.55 |
| 整体观感 | 静态环+移动光段双结构；整卡 rotate 四角歪；过曝泛白；色带 banding | 单一光源叙事：环、泛光、背景辉光同色温；静止时仍是完整光边；grain 抗 banding | 删掉光段/offset-path；保留静态完整环 |
| 背景廉价信号 | 全屏均匀 opacity 淡入淡出（无空间结构）；大圆形硬边色斑；彩虹多色；26s+ 位移 <100px（读作静止） | 2–3 个尺度色场 + 边缘 bloom + grain + 暗角；局部亮度变化可辨而整体不闪 | 局部 ≥6/255，全屏均值 2.5–4/255 |

## 4. CSS 数值建议表

### 4.1 composer 边框（卡片 ≈860×120，圆角 20px，逻辑 1x；Electron/Win11）

| 项 | 建议值 | 说明 |
|---|---|---|
| 环厚 | **1.5px**（1–2px；≤2px） | 2px 是 Apple 基准；再宽会抢内容 |
| `inset/padding` | `inset:0; padding:1.5px; border-radius:inherit` | 环画在盒内，rect 注入前后零变化 |
| 圆角 | 伪元素 `border-radius:inherit`（20px）；泛光层外扩 1px 用 21px | 内外半径差 = 环厚，否则角部挤压（S1/S3） |
| conic stop 布局 | 底光 0.05；主弧 0.05→0.40(34°)→0.72(56°)→**0.92 白热(66°)**→0.52(84°)→0.10(120°)；透明区 120–190°；副弧 0.38(208°)→0.10(232°)；回底光 | 主弧头尾方向：角度增大方向为运动方向（顺时针） |
| 旋转时长 | **8.0s/圈，linear infinite** | 7–9s 区间；周长 1960px → 245px/s |
| 呼吸时长 | **6.4s ease-in-out infinite alternate**（与 8s 互质，合成 32s 才重复） | 环 opacity .58→1（1.72）；halo .20→.55（2.75） |
| 泛光参数 | `::after{inset:-1px;padding:4px;filter:blur(6px);opacity:.20→.55}`；blur≈1.5×4px | blur 静态；随环同角度旋转 |
| 聚焦态 | 静态 `filter:brightness(1.12) saturate(1.05)`（不新开动画） | — |
| 颜色插值 | `conic-gradient(from var(--a) in oklab, …)` 可选 | 防红↔紫 sRGB 灰死区（S8） |
| 静止/暂停 | 环 from 0deg + opacity .85；泛光 opacity .3；动画 none/paused | 保留完整静态光边 |

### 4.2 全屏背景（1536×864 逻辑，Win11/Electron；峰值受 4.5:1 锁死）

| 项 | 现状 | 建议值 |
|---|---|---|
| 呼吸层振幅 | `.ea-breath` opacity .19→.36，scale .94→1.06，9.2s | **双相位 A/B**：A .44→.12、B .12→.44，6.8s，反相；scale A .92→1.10 / B 相反（合成使局部变化≈2.4×现状） |
| 极光斑呼吸 | opacity .80→1.0（仅 20%） | **.55→1.0**（谷值下压，峰值不变 → 对比度不退化），周期 7.2/9.6/8.4/10.8s，负 delay 保持错相 |
| 漂移速度 | 26–36s，位移 8–10vmax（≈4–6px/s） | 位移 13–16vmax、周期 20–26s（≈10–13px/s）；scale 幅度 .18→.26 |
| 边缘呼吸 `.ea-rim` | 无 | 反向暗角 `radial-gradient(140% 120% at 50% 42%, transparent 54%, rgba(c1,.22) 88%, rgba(c2,.28) 100%)`，opacity .10→.38，8.4s；避开顶部 header 文字区（header 已有 0.40 兜底） |
| 呼吸周期 | 9.2s | 6.4–6.8s；背景与 composer 呼吸建议同相位族（6.4/6.8） |
| grain | opacity .05 | 保持 .04–.06；呼吸渐变若起 banding → 加 2–3 个中间 stop（S8） |
| 暗角 | 0.42 | 0.36–0.42；勿与 rim 叠加过黑 |
| 合成层数 | ambient 7 个动画层 | 建议 ≤8 个动画层（新增 A/B/rim 后为核心动效层 7 个）；软件光栅 QA 关注 layer 内存（S9） |

## 5. 降级与性能注意事项

- **@property**：Baseline 2024（Chromium 85+/Safari 16.4+/FF 128+）；不支持时 `conic-gradient(from var(--a))` 仍渲染但**不转**（静态多色环），无需 @supports 分支（S2/S6）。DSH desktop 是 Electron，Chromium 版本满足；`npm test` 静态断言需保留。
- **角度动画不是合成层动画**：Chromium 对注册自定义属性走主线程重绘（S3/S9）。composer 每帧重绘面积 ≈2×(860×120) = 0.21MP，可接受；**绝不要把 blur/filter/mask 放进 @keyframes**，它们在动画里会放大数倍成本。
- **mask-composite**：`exclude`/`-webkit-mask-composite:xor` 均 Baseline 2023-12；旧内核回退 1px 实色描边（现有降级逻辑保留）。
- **offset-path / steps 光段方案整体删除**：`offset-distance` 同样非合成属性，且 steps(48) 的分段感在慢速下有可辨跳步；换成 T1+T2 后不再需要该降级分支。
- **blur 泛光是独立合成层**：每个 `filter:blur()` 元素提升一层；本项目 composer 只保留 1 个泛光层，ambient 不要用 `filter:blur(60px)` 的 orb（S7）。
- **reduced-motion / static / paused**：沿用现有三态；reduced-motion 下保留静态完整环（信息不丢，仅去运动）（S10）。
- **软件光栅 ≠ Electron GPU**：headless QA 的 TaskDuration 只作回归对比；若 composer 双伪元素超预算，优先减小 bloom 带厚/降 opacity，不要退回到光点方案。

## 6. 对现状的直接判读（供阶段 2 评审对照）

1. **背景**：单层 `.ea-breath` 幅度小+周期长+无位移，叠加 blob 呼吸（仅 20% 幅度）→ 实测 1.8/255，用户合理读作「静止」。修法见 §4.2，不需要重做 ambient。
2. **composer**：`::before` 静态 conic 环（只呼吸 opacity）+ `::after` 110×2px offset-path 光段 → 用户看到「一个光点沿边框转」，且 1px 环与光段形成双结构。**方向错误，需整体替换为 T1+T2**（环旋转 + 同角度泛光），不是把光段调大。
3. **呼吸配合**：现状 composer 环呼吸 .78→1.0（22%）几乎不可辨；plan 的峰谷比 ≥1.8 需要环+影一起呼吸（§4.1），且呼吸周期要与旋转互质，避免每圈同位置同步闪。

## 7. 建议的量化验收口径（比「全屏平均像素差」更能代表肉眼观感）

- **背景**：同一采样点整周期亮度序列 max/min ≥1.35（全亮度）；局部 64×64 块在 1/4 周期（1.7s）间隔的平均差 p90 ≥6/255、可见区均值 ≥3.5/255；2 倍速回放能读出 2–3 个呼吸节拍。
- **composer**：环带（外扩 3px 的环岛）亮度峰谷比 ≥1.8；亮区（alpha > 中位 1.3×）面积 ≥18% 环带（≈≥65°）；连续 5 帧亮区质心角位移单调；无「双环」——环与泛光相位差恒为 0。
- **反作弊**：小光点也能让质心单调，因此必须同时看亮区面积/宽度；只测全屏均值会漏掉「局部呆板、整屏闪」的反向失败。
