# P8 · v0.6.0 设计规格（FLOW：背景呼吸 v2 + 输入框整圈流动光边框）


> **仓库说明**：本文是开发期记录的公开镜像，已脱敏本机路径与用户名。文中 `_pN/`、`_p8/`、`_build/`、`_shots-*`、`releases/_superseded/` 等为维护者本机目录，未随公开仓库分发；设计规格、评审与 QA 报告已单独放入 `docs/`。


> 唯一权威源。实现与验收以本文为准；数字与选择器以真实宿主（DeepSeek Harness `0.2.1-rc.5`）实测为准，改动需在本文件留记录。

- 版本：`0.6.0`，代号 **FLOW**
- 目标宿主：DeepSeek Harness `0.2.1-rc.5`（Win11 / Electron desktop + web）
- 基线：`dsh-startup-elisa@0.5.0`（`P7-优化与验收.md`、`_p7/design-spec-v5.md`）
- 产物：`releases\dsh-startup-elisa-0.6.0.tgz`
- 用户诉求原话（2026-11-02 02:32）：「你看我给你录得视频，背景还是没有呼吸的动态效果，聊天框边框也不是呼吸动态效果，并且流光效果是边框本身的动态环绕，不是找一个光点在那里转圈，看起来很廉价，别的问题不大。」
- 用户实机口径：`skin=glass`、`skinTheme=aurora`、`skinMotion=true`、**`glassTransparency=100`（最通透档）**、`splashSpeed=50`；窗口 ≈1536×864 CSS / DPR1.25（Electron）。

## 0. 结论（一句话）

v0.5 的「静态 1px 环 + offset-path 小光点」整体替换为**整圈 conic 光场 8s 旋转 + 相位锁定外缘泛光 + 6.4s 呼吸**（删除光点与 steps 位移）；背景呼吸改为**暗帘/呼吸光/边缘光同频 8.4s 叠加**（峰值只降不升 + 呼吸光提亮），在对比度预算内把背景可感知度从 1.8/255 提到区域亮度 range 6–9.5、右缘峰谷比 2.05。

## 1. 版本与配置

配置键**不新增**（用户没要求新开关，v0.5 的 `glassTransparency` / `splashSpeed` / `skinMotion` 语义不变）：

```json
{ "enabled": true, "mode": "session", "allowSkip": true, "reducedMotion": false,
  "sound": true, "volume": 65, "skin": "glass", "skinTheme": "aurora", "skinMotion": true,
  "glassTransparency": 50, "splashSpeed": 80 }
```

- `npm test` 断言版本、会话层数（11）、composer 契约与关键帧；`skin.css` 内联版本注释、客户端 `FALLBACK_VERSION`、iframe `v=`、`audio.js VERSION` 统一 `0.6.0`。

## 2. 视觉与动效规格

### 2.1 背景呼吸 v2（修「背景还是没有呼吸的动态效果」）

- 层级（自底向上，`#dsh-elisa-ambient` 内，共 **11 个子层**）：
  `.ea-base → .ea-b1..b4 → .ea-sheen → .ea-breath → .ea-grain → .ea-vignette → .ea-dim → .ea-rim`
  （v0.6 新增 `.ea-dim`、`.ea-rim`，由 `client.js` 注入，`smoke-client` 断言 11 层）
- 核心原则：**峰值亮度不超过 v0.5 峰值**（对比度安全），呼吸差值靠「谷值下压 + 同频叠加」放大。
- 动效参数（全部只用 transform/opacity；`mix-blend-mode: screen` 仅 blob/sheen）：

| 元素 | 运动 | 周期 | 幅度 |
|---|---|---|---|
| ea-b1..b4 | 漂移 + 缩放 | 22 / 26 / 24 / 30s alternate | 位移 10–16vmax、scale 0.86–1.26 |
| ea-b1..b4 glow | opacity 呼吸（错相） | 7.2 / 8.4 / 6.8 / 9.6s alternate | 0.45–0.55 → 1（峰值不变、谷值下压） |
| ea-breath | transform（位移+scale）+ opacity | **8.4s 单频**（0%/100%↔50%） | scale 0.92→1.10、位移 ±1.5%、opacity **0.10→0.44** |
| ea-dim（新） | opacity 暗帘（只压暗不抬亮） | **8.4s 单频（与 breath 同相叠加）** | opacity **0.76↔0.10**；渐变 alpha 中心 0.10 / 58% 0.26 / 边缘 0.50 |
| ea-rim（新） | 视口边缘反向暗角光 | **8.4s 单频（同相）** | opacity **0.10↔0.38** |
| ea-sheen | 斜向柔光横扫 | 22s linear | opacity 0.6 |

- 叠加语义：50% 处 = 呼吸光最亮 + 暗帘最淡 + 边缘光最亮（整窗最亮）；0%/100% 处三者反向（整窗最暗）。
- 判据（背景可见区，排除文字/内容）：
  - 固定采样区亮度 range **≥5/255**、峰谷比 **≥1.35**；64×64 块 p90 帧差（1/4 周期）**≥4/255**（design-review 建议 ≥6 属理想值，实测 4.53，见 P8 §二）；
  - 亮峰帧整体亮度不超过 v0.5 峰值（只允许局部 ≤+3/255，用于「呼吸鼓起」）。
- 降级：`--static` 全部 `animation:none`；`--paused` 全部暂停；`skinMotion=false`/`reducedMotion=true` 走 static。

### 2.2 composer 整圈流动光边框（修「不是找光点转圈」「边框没有呼吸」）

- 结构（宿主卡片已是 `position:relative`，不写 position、不新增 DOM）：
  - `::before` = **1.6px 主题环**：旋转 conic 光场 + 底环 + 6.4s 呼吸；
  - `::after` = 同 conic 的**模糊泛光**：`inset:-4px; padding:4px; border-radius:24px; filter:blur(7px)`，光带**完全在卡片外侧**（v0.6-r2 修复内侧灰蓝溢雾），与环同角度变量/同周期/同呼吸相位锁定；
  - 删除 v0.5 的 `offset-path` 小光段、`steps(48)` 位移与 `--ea-border-angle` 回退分支。
- conic stop 布局（角度增大方向即旋转方向；sRGB 声明在前，`in oklab` 声明在后作渐进增强）：

```css
/* ::before（1.6px 环） */
conic-gradient(from var(--ea-flow-angle, 0deg),
  rgba(c1, .17)   0deg,   rgba(c1, .26)  24deg,  rgba(c1, .46)  50deg,
  rgba(255,242,236,.72) 66deg,                     /* 暖白前缘（不 clipped） */
  rgba(c1, .54)  88deg,   rgba(c1, .44) 112deg,  rgba(c2, .32) 140deg,
  rgba(c2, .24) 168deg,   rgba(c3, .38) 196deg,  rgba(c3, .18) 220deg,  /* 青副弧 */
  rgba(c2, .22) 244deg,   rgba(c1, .20) 280deg,  rgba(c1, .17) 320deg,
  rgba(c1, .17) 360deg);
/* ::after 同布局，alpha ≈ +0.06~0.08，暖白 .78 */
```

| 项 | 值 | 说明 |
|---|---|---|
| 环厚 | 1.6px（`inset:0; padding:1.6px; border-radius:inherit`） | ≤2px；100% DPR 下 2 物理 px |
| 旋转 | `@property --ea-flow-angle` 0→360deg，**8s linear infinite** | 主线程重绘，仅两个伪元素 |
| 环呼吸 | opacity **0.58→1**，6.4s ease-in-out alternate | 与 8s 互质 |
| 泛光 | padding 4px（环带宽 4px）、blur(7px)、opacity **0.18→0.55**，6.4s | 相位锁定同 8s/6.4s |
| 底环可见度 | alpha 0.17–0.26（谷相 luma≈45）、峰值 luma≈196 | 峰值不 clip 到 255 |
| 聚焦 | `:focus-within` 静态 `filter:brightness(1.15)`（环）/`blur(7px) brightness(1.2)`（泛光） | 不新增动画 |
| 布局 | 伪元素 `pointer-events:none`；显式 reset 旧 `offset-path/width/height` | 注入前后 card rect 一致 |

- 判据：环带 luma p50 峰谷比 **≥1.8**；亮头角位移单调（8s/圈 ≈45°/s，长边处因 conic 非均匀会加速，宽主弧掩盖）；暖白芯半高角覆盖 ≥25°（luma 口径；alpha 亮区更宽）；无内侧溢雾；不新增 `backdrop-filter`（≤3）。
- 降级：`--static` 动画 none（静态完整光边 + 弱泛光）；`--paused` 暂停；无 `mask-composite` → 1px 实色描边 + 泛光隐藏；无 `@property` → conic 静态（`var(...,0deg)` 兜底）不报错。

### 2.3 不破坏

- `off/accent/full` 三档逻辑与样式段不改（回归像素一致）；三主题（aurora/deepsea/violet）跟随 `--ea-c1/c2/c3`；浅色宿主仍强制深色玻璃；启动动画/音轨/速度/通透度滑块不受影响。
- 硬约束沿用：不改字号/行高/字重/字体栈、不挪布局、语义色不动、正文对实渲染背景 ≥4.5:1（P7 的 9 组最差帧矩阵）。

## 3. 验收口径（可量化）

| 项 | 判据 | 实测（Lead 隔离真宿主，1600×1020 / DPR1 empty） |
|---|---|---|
| 背景呼吸 | 区域 range ≥5、ratio ≥1.35；块 p90 ≥4 | 右缘 range 8.6 / ratio **2.053**；下缘 9.5 / 1.758；左缘 6.0 / 1.566；中心背景 6.5 / 1.387；块 p90 **4.53**、top10 块峰谷比 2.44 |
| composer 呼吸 | 环带 luma p50 峰谷比 ≥1.8 | p50 **1.81**、p90 **2.27** |
| composer 流动 | 亮头角位移单调；非光点 | 0.94s 节拍下每帧 35–45° 单调；半高角覆盖中位 30° |
| 泛光内溢 | 卡内 2–8px 无灰蓝雾 | 内带 luma 17.29（RGB 28.1,12.5,33.0）/ 外带 14.52 |
| 对比度 | g=50/100 九组最差帧 ≥4.5 | 见 P8 §二（QA 实测） |
| 性能 | FPS ≥95%、TaskDuration 不劣于 v0.5 | 见 P8 §二（QA 实测） |

## 4. 变更记录

- 2026-11-02：v0.6.0 初版（基于 v0.5.0 基线；`_p8/design/reference-research.md` 外部参考 + design-review 两轮评审；r2 返工修复泛光内溢、降低白热峰值、加宽主弧、背景改单频叠加）。
