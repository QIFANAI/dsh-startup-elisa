# v0.6.0 独立验收报告（QA · qa-eng）


> **仓库说明**：本文是开发期记录的公开镜像，已脱敏本机路径与用户名。文中 `_pN/`、`_p8/`、`_build/`、`_shots-*`、`releases/_superseded/` 等为维护者本机目录，未随公开仓库分发；设计规格、评审与 QA 报告已单独放入 `docs/`。


> 独立 QA 证据链报告。被测对象 = 隔离 DSH web 宿主上的 `dsh-startup-elisa@0.6.0`；全部数字由 `_p8/qa/` 下脚本真宿主实测，未使用 Lead 自测数字。
> 数据源：`_p8/qa/qa-report-data.json`；成片：`_p8/demo/`；截图：`_p8/shots/`、`_p8/shots/v6/`。
> 生成时间：2026-11-02 03:3x（Asia/Shanghai）。

## 0. 结论摘要

- **功能/对比度/回归/npm 门禁通过**：对比度 9 组最差帧 0 失败（最差 5.77:1 ≥4.5）；真宿主功能/降级/零位移/backdrop 计数全对；off/accent/full 与 v0.5 **逐像素一致**（meanAbsDiff 0.0000，maxDiff 0）；`npm test` 497/497（独立复跑 EXIT=0）。
- **⚠ 性能门禁新增 FAIL（发布前必须裁决）**：软光栅口径 TaskDuration **v0.6 g100 1.1195s vs v0.5 0.4100s（+173%）**、g50 +185%，远超 plan §2.3「不劣于 v0.5 +15%」预算；v0.5 复测两次（0.41/0.42s）确认非偶然。FPS 未见下降（144.2 vs 144.4，off 基线）。怀疑来源：`.ea-dim`/`.ea-rim` 两个全屏 opacity 动画层 + composer `::after` 全宽 blur(7px) 泛光（v0.5 只是 110×2px 小光段）+ @property conic 主线程重绘（待 Lead 定位）。
- **用户点名的两件事都产生可量化改善**：
  - 背景呼吸：3s 间隔帧平均差 0.665→**2.945/255（4.4×）**；背景亮度峰谷比 1.110→**1.393**；固定采样点整周期 ratio≥1.35 的占比 5.0%→**71.4%**；1/4 周期块差 p90 0.542→**2.962**。
  - composer 边框：环带 luma p50 峰谷比 1.087–1.149→**1.87–2.22（≥1.8 判据通过）**；泛光呼吸比 1.19→**1.90**；整圈旋转周期 5.38s（小光点 offset-path）→**7.86–8.00s**，方向单调一致性 1.000；1s 内变化覆盖角 30°→**76–94°**（2.6–3.1×，不再是「一个点」）；`offset-path` 光点已删除（DOM 实测 `offset-path: none`）。
- **未达 plan 绝对阈值 2 项（如实报）**：背景 3s 帧差 2.95 < 6；64×64 块 1/4 周期 p90 2.96 < 6、可见区均值 1.80 < 3.5（Lead 自测 p90 4.53，口径差异见 §5.3）。**这 2 项是「量级提升已确认、绝对值未达标」**，不是功能缺失。
- **H1 伪影**：1600×1020 无内溢（卡内 2–8px Δluma 0.5/蓝偏 1.74 ≤阈值 2）；1536/DPR1.25 仅 CSS 第 2 行 +12.6 luma（1 CSS px，环 AA 尾），第 3–8 行 Δ≤1 → 按 Lead 裁决接受，报告中记为「已知 AA 尾，非内溢」。
- 共 **30 项矩阵：PASS 23 / PARTIAL 2 / FAIL 3 / NOT_VERIFIED 1**；未验证假设 12 条（§7），其中未实测项一律不标 ✅。FAIL 三项 = B1/B4（呼吸绝对值未达 plan 阈值）+ **P2（TaskDuration +173%，性能回归）**。

## 1. 被测对象与哈希

| 项 | 值 |
|---|---|
| 被测 runtime 包 | `releases/dsh-startup-elisa-0.6.0.tgz`，6,490,246 B / 42 files / **SHA256 `4e2ecbba96678f4cdd149bcc1634fa7c6b95ab0478fd2b3255ed01d2a5cf8d2c`** |
| 最终发布包（Lead 回填文档后 pack） | 6,495,716 B / 43 files / **SHA256 `3f789b8cfe0dd7f0937ac320fe7dba93f27750665b5c2667ac10e30ac75cbe61`** |
| 运行时等价性 | Lead 预校验 + 本报告采信：两包 7 个运行时文件（lib/index.js、client.js、skin.css、splash.js、splash.css、audio.js）+ cordis.patch.yml SHA256 逐一相同；差异仅 `package.json` 的 files 列表与 P8/README/INSTALL 文档 → **被测 runtime = 4e2ecbba，发布包 = 3f789b8c，运行时等价，无需重跑**（该等价性由 Lead 预校验提供，本报告未二次解包核对） |
| 隔离宿主 | `node _integration/host-v3.mjs --home _p8/qa-home-v6 --run _p8/qa-run-v6 --install-tgz …`（DSH_HOME 隔离，未碰用户 `~/.dsh`，未动 Lead 宿主） |
| 浏览器 | Edge headless(new) + 手写 CDP；1600×1020 DPR1 与 1536×864 DPR1.25 |

## 2. 方法与证据链（可复跑）

| 环节 | 脚本 | 产物 |
|---|---|---|
| 隔离宿主 | `_integration/host-v3.mjs`（复用） | `_p8/qa-run-v6/web-url.txt` |
| 功能/伪元素/降级/12 子层 | `_p8/qa/probe-functional.mjs` | `_p8/qa/v6/functional-v6.json` |
| 对比度 9 组最差帧 | `_p8/qa/run-contrast-v6.sh`（复用 `_p7/qa/measure-live-v5.mjs` + `_p7/qa/contrast.py`） | `_p8/qa/v6/worstcase/`、`worstcase-summary.json`、`_p8/shots/v6/worstcase/` |
| 定量抓帧 | `_p8/qa/capture-shots.mjs`（`Page.captureScreenshot`+`optimizeForSpeed`，尺寸锁死；**实测 5.96–6.08fps@1600、4.1–4.4fps@1920×1080**） | `_p8/qa/frames-v6/*`、`_p8/qa/v6/v6-*-capture.json` |
| 像素指标 | `_p8/qa/frames-metrics.py`（自检 13 项反向验证 + cv2 交叉复核 PASS） | `_p8/qa/v6/metrics/*.json` |
| H1 伪影 | `_p8/qa/h1-artifact.py`（CSS 行带采样，环本体行剔除） | `_p8/qa/v6/h1-1600.json`、`h1-1536.json` |
| 性能 | `_p8/qa/perf.mjs`（off/glass-g50/glass-g100 交错 3 窗口） | `_p8/qa/v6/perf-v6.json`、`_p8/qa/baseline-v5/perf-v5.json` |
| 回归 | `_p8/qa/regression.mjs` + `_p7/qa/pixdiff.py` | `_p8/shots/regress-v5|v6/`、`_p8/qa/v6/pixdiff-*.json` |
| 60fps 素材 | `_p8/qa/capture-60fps.mjs`（screencast jpeg，3s，**源推帧 239 帧/79.7fps**） | `_p8/qa/frames-60fps/v6-empty/` |
| 成片 | `_p8/qa/make-video.py`（PyAV h264） | `_p8/demo/` |

**抓帧口径说明（重要）**：本机 Edge headless 的 `Page.startScreencast` 帧尺寸会在运行中漂移（1600×1020 ↔ 1574×846 等，均为同一渲染的左上角裁切）。为保证像素坐标体系可信，定量抓帧改用 `Page.captureScreenshot`（尺寸硬校验，不符即中止），代价是采样率 ~6fps（1600）/4.4fps（1920×1080）。对周期 ≥5.6s 的呼吸与 8s 整圈旋转（45°/s，每帧 ≈7.5°）满足采样需要；**60fps 平滑度素材单独用 screencast 采集**（80fps 源帧，不受此限）。

## 3. PASS/FAIL 矩阵

| ID | 项 | 判据 | 实测（v0.6） | 结论 |
|---|---|---|---|---|
| F1 | 版本 | ==0.6.0 | 0.6.0 | ✅ PASS |
| F2 | ambient 子层 | 11 层（base/b1-b4/sheen/breath/grain/vignette/dim/rim） | 11 层、顺序一致 | ✅ PASS |
| F3 | composer 结构 | ::before 1.6px conic+8s spin+6.4s ring breath；::after inset-4/pad4/r24/blur(7)/6.4s halo；无 offset-path 光点 | 全部一致，`offset-path: none` | ✅ PASS |
| F4 | 光场旋转生效 | --ea-flow-angle 两次采样变化 | 239.998deg → 变化（连续采样） | ✅ PASS |
| F5 | composer rect 零位移 | 轮询唯一值=1 | unique=1，16/16 相同 | ✅ PASS |
| F6 | backdrop-filter 计数 | ≤3 | empty=1、settings=3 | ✅ PASS |
| F7 | static/paused 降级 | static 伪元素 animation:none；paused play-state:paused | 均生效（paused 为 DOM 注入类验证规则） | ✅ PASS |
| F8 | console | 0 error/exception | 0/0（两视口） | ✅ PASS |
| C1 | 对比度 9 组最差帧 | 每帧失败=0 且 ≥4.5 | 18 帧/1208 矩形，fail=0，最差 5.77 | ✅ PASS |
| H1 | H1 内溢 1600×1020 | 卡内 2–8px 与背景一致 | Δluma 0.5、Δ蓝偏 1.74（≤2） | ✅ PASS |
| H1-1536 | H1 内溢 1536/DPR1.25 | 同上 | CSS 第 2 行 +12.6 luma（1px AA 尾），3–8 行 Δ≤1 | ◐ PARTIAL（Lead 裁决接受） |
| B1 | 背景 3s 帧差 | ≥6/255 | **2.945**（v5 0.665） | ❌ FAIL（未达 6，提升 4.4×） |
| B2 | 背景亮度峰谷比 | region ratio ≥1.35 | all **1.393**、sidebar **1.407**、edges **1.497**、header 1.233 | ✅ PASS（all/sidebar/edges） |
| B3 | 固定采样点整周期 ratio≥1.35 | 本报告口径 ≥50% 采样点 | **71.4%**（343 点），p95 **2.713**（v5 5.0%） | ✅ PASS |
| B4 | 64×64 块 1/4 周期帧差 | p90≥6 且可见区均值≥3.5 | p90 **2.962**、均值 **1.796**（v5 0.542/0.394） | ❌ FAIL（未达阈值，提升 5.5×/4.6×） |
| D1 | 环带 luma p50 峰谷比 | ≥1.8 | **1.958**（四组 1.87–2.22；mean 口径 1.74） | ✅ PASS |
| D2 | 亮头角位移单调/周期 | 7–9s/圈、方向单调 | 周期 **7.86–8.00s**、方向一致性 **1.000** | ✅ PASS |
| D3 | 亮弧角宽（非小光点） | spec ≥25°；plan ≥60° | 泛光带剖面 **43–48°**（≥25° ✅）；1.6px 环带剖面 6–7.75°（亚像素噪声，不作判据）；1s 变化覆盖角 **76–94°**（v5 29–30°） | ◐ PARTIAL（25° 口径通过；60° 口径按环带剖面不成立，按变化覆盖角 88° 成立） |
| D4 | 环/泛光相位差 | ≈0 | 3/4 组 lag=0ms；session-1536 249ms（噪声级） | ✅ PASS |
| D5 | 泛光亮度呼吸 | >1 | **1.90**（v5 1.19） | ✅ PASS |
| D6 | 布局零位移 | maxDelta=0 | 0（四组） | ✅ PASS |
| D7 | 注入前后 rect 一致 | delta=0 | off/glass 同视口 rect 完全一致，v0.5 与 v0.6 rect 相同；动画期间 16 次轮询 unique=1 | ✅ PASS |
| D8 | 不新增 backdrop | ≤3 | empty=1、settings=3（≤3） | ✅ PASS |
| P1 | FPS | ≥95% of off | 144.2 vs 144.4（-0.1%） | ✅ PASS |
| P2 | TaskDuration v6 vs v5 | 不劣于 +15% | g100 **1.1195s** vs v5 **0.4100s（复测 0.4200）** = **+173%**；g50 1.1401 vs 0.4000 = +185%；相对 off 基线：v5 +273%、v6 +1017% | ❌ **FAIL**（远超 +15% 预算） |
| R1 | off/accent/full 像素回归 | ≤0.01 | **0.0000**（6 组全 0，maxDiff 0） | ✅ PASS |
| R2 | 三主题/浅色宿主/滑块回归 | — | 本轮未独立实测 | — NOT_VERIFIED |
| N1 | npm test | 全绿 | **497/497**（host123+splash/audio164+speed90+client80+skin40），EXIT=0 | ✅ PASS |
| V1 | 成片 | 1x+2x+composer+60fps | 全部产出，见 §6 | ✅ PASS |

> 图例：✅ PASS（实测达标）/ ◐ PARTIAL（部分口径达标或已裁决接受）/ ❌ FAIL（实测未达标）/ — NOT_VERIFIED（未实测，禁止标 ✅）。

## 4. 关键对比：v0.5.0 → v0.6.0（同脚本同宿主口径，1600×1020 empty，g=100）

| 指标 | v0.5.0 | v0.6.0 | 变化 |
|---|---|---|---|
| 背景 3s 帧差 meanAbsDiff | 0.665 | **2.945** | 4.4× |
| 背景亮度峰谷比（all） | 1.110 | **1.393** | +25% |
| 固定点整周期 ratio≥1.35 占比 | 5.0% | **71.4%** | 14× |
| 64×64 块 1/4 周期 p90 / 均值 | 0.542 / 0.394 | **2.962 / 1.796** | 5.5× / 4.6× |
| 环带 luma 峰谷比（mean / p50） | 1.116 / 1.149 | **1.739 / 1.958** | +56% / +70% |
| 泛光呼吸比 | 1.186 | **1.904** | +61% |
| 整圈旋转周期 | 5.38s（110×2px 光点 offset-path） | **7.96s（整圈 conic 旋转）** | 光点→整圈 |
| 1s 变化覆盖角（P50） | 29–30° | **76–88°** | 2.6–3.0× |
| 环带剖面角宽（1.6px 环，辅助） | 8.0° | 7.75° | 同口径不可判（亚像素噪声） |
| composer rect | 零位移 | 零位移 | 一致 |
| **TaskDuration（glass g100，3s 窗口）** | **0.4100s（复测 0.4200）** | **1.1195s** | **+173%（性能回归，见 §5.5）** |
| FPS（rAF，相对 off） | 144.35 / off 144.55 | 144.2 / off 144.4 | 无下降 |

## 5. 详细发现与口径分歧

### 5.1 背景呼吸（B1/B4 未达 plan 绝对值）
- 量级提升明确（4.4×/5.5×），且固定采样点 71.4% 达到 1.35、p95 2.71，肉眼在 `_p8/demo/v6-1x.mp4` 与 `v6-2x.mp4` 可辨。
- 但 plan §2.1 的两个绝对阈值（3s 帧差 ≥6/255、块 p90 ≥6、可见区均值 ≥3.5）本报告口径下**未达标**。若 Lead 决定按「提升倍数 + 主观可辨」验收，应在 P8 文档中改口径；若坚持 6/255，需要继续加幅度（会触碰 D1/对比度余量）。

### 5.2 composer 流光（D3 口径分歧）
- `offset-path` 光点已删除（F3 DOM 证据），旋转为整圈 conic 渐变（D2：8.00s/圈、方向一致性 1.000）。
- 「亮弧角宽」三种口径结论不同：泛光带剖面 P50 43–48°（≥25° 通过）；1.6px 环带剖面仅 6–7.75°（环太薄，luma 受亚像素覆盖强噪声，**不宜作判据**）；1s 内变化覆盖角（最能代表"整圈在流动"）P50 76–88°，v5 仅 29–30°。
- 建议 P8 文档把判据改写为「1s 变化覆盖角 ≥60°」或「泛光带半高角 ≥25°」，两者都有独立实测支撑。

### 5.3 与 Lead 自测数字的口径差异
| 指标 | Lead 自测 | 本报告 | 差异原因（待对齐） |
|---|---|---|---|
| 64×64 块 p90 | 4.53 | 2.96 | 块均值按掩码内像素、区块白名单/对齐、1.7s 最近帧对容差、是否含文字排除区——未逐项对齐 |
| 暖白芯覆盖角 | 半高 30° | 泛光带 43–48° / 环带 6–7.75° | 采样带不同（环 vs 泛光）、半高基准不同 |
| 环带峰谷比 | 目标 ≥1.8 | p50 1.87–2.22 ✓ / mean 1.63–1.85 | 统计量（p50 vs mean）、环带宽度（±3px）差异 |
- 结论：**方向与量级一致**（呼吸/流光都显著增强且不是点），绝对数字因口径未对齐存在差异，已在 §7 列为未验证/待对齐项。

### 5.4 H1 伪影
- 1600×1020：卡内 CSS 行 2–8 luma 19.73 vs 卡内背景 20.23（Δ0.5），蓝偏 Δ1.74 → 无内溢；v0.5 基线同口径 Δluma 0.6/蓝偏 0.13（v0.6 略蓝但阈值内）。
- 1536×864/DPR1.25：CSS 行 2 luma 34.15 vs 21.54（+12.6）、蓝偏 +2.9；行 3–8 Δ≤1 → 1.6px 环在 1.25 DPR 的亚像素 AA 尾（1 CSS px），非 2–8px 宽内溢。Lead 2026-11-02 裁决：接受不修。放大图：`_p8/shots/v6-1600-full-h1-zoom.png`、`_p8/shots/v6-1536-dpr125-full-h1-zoom.png`。

### 5.5 性能回归（新增 FAIL，需 Lead 裁决）
- 同机同脚本顺序测量：v0.5 glass g100 TaskDuration 0.41s/3s 窗口（复测 0.42s，两次一致）；v0.6 1.1195s/3s 窗口 → **+173%**；g50 同样 +185%。v0.5 相对 off 基线 +273%，v0.6 相对 off +1017%。
- FPS 未见下降（144.2 vs 144.4，rAF 未被 CPU 打满），但主线程 TaskDuration 已占 3s 窗口的 37%，软件光栅下是明确恶化。
- 归因线索（未经 Lead 确认，仅供参考）：新 `.ea-dim`/`.ea-rim` 全屏 opacity 动画 + composer `::after` 的 `blur(7px)` 全宽泛光 + `@property` conic 主线程重绘；v0.5 同位置仅是 110×2px 小光段。
- 口径限制：headless 软件光栅 ≠ Electron GPU 合成，绝对差值在实机可能不同；但**同一环境下跨版本对比是公平的**，且 v0.5 复测两次稳定 → 判定为真实回归，需在发布说明/项目卡中记录，并建议 Lead 在 Electron 实机复测 TaskDuration 后再决定是否作为发布阻塞项（本条列入未验证）。
- 证据：`_p8/qa/v6/perf-v6.json`、`_p8/qa/baseline-v5/perf-v5.json`、`_p8/qa/baseline-v5/perf-v5-repeat.json`。

## 6. 成片与截图（`_p8/demo/`）

| 文件 | 内容 |
|---|---|
| `v6-1x.mp4` | 全页 1x（12s，30fps 容器，源 72 帧/5.96fps 重采样），背景呼吸 + 边框流光 |
| `v6-2x.mp4` | 同上 2x（6s） |
| `v6-composer-2x.mp4` | composer 局部放大 2×、2x 速度 |
| `v6-composer-60fps.mp4` | composer 局部 2.97s@60fps（screencast 源 239 帧/79.7fps 重采样，clip 1017×254@428,433） |
| `contact-v6.png` / `contact-v6-composer.png` / `contact-v6-60fps.png` | 12 帧联系表（全页 / composer 局部 / 60fps 源） |
| `v5-1x.mp4` / `v5-2x.mp4` / `v5-composer-2x.mp4` / `contact-v5*.png` | v0.5 同口径对照成片 |
| `_p8/shots/v6/*-brightest.png`、`*-darkest.png` | 背景亮峰/暗谷帧（四组配置） |
| `_p8/shots/v6-1600-full.png`、`v6-1600-composer.png`、`v6-1536-dpr125-full.png` | 功能态截图 |

## 7. 未验证假设（禁止对这些项标 ✅）

1. **Electron 实机**（`dsh-app://`，GPU 合成）观感与流畅度：本报告全部为 Edge headless 软件光栅口径，未在用户桌面 App 实机验证。
2. **60fps 段的主观平滑度**：素材已交付（80fps 源→60fps 编码），但未由人眼/design-review 判读，不能断言"顺滑"。
3. **150%/200% DPI**：仅覆盖用户 1536×864@DPR1.25，更高 DPI 未测。
4. **noblur 降级**（无 backdrop-filter 环境）：未实测渲染，仅有 CSS 规则存在性。
5. **24h 连续动画功耗/温度**：未观测。
6. **mode=daily 跨天行为、看门狗故障注入**：本轮未重测。
7. **paused 降级**：用 DOM 注入 html 类验证 CSS 规则，未用真实页面隐藏（visibilitychange）触发。
8. **三主题可辨、浅色宿主强制深色、滑块/清理回归**：本轮未独立实测（v0.6 未改相关代码，P7 已测）。
9. **呼吸/流光口径**：1.6px 环带剖面角宽受亚像素噪声影响仅作辅助；判定改用泛光带与 1s 变化覆盖角。
10. **与 Lead 自测数字的口径对齐**：64×64 块 p90（4.53 vs 2.96）、暖白芯覆盖角（30° vs 43–48°）、环带统计量未逐项对齐。
11. **最终发布包与 runtime 等价性**：由 Lead 预校验提供（7 运行时文件 SHA256 相同），本报告未二次解包逐文件核对。
12. **TaskDuration 性能回归的实机影响**：headless 软光栅口径确认 +173%，但 Electron GPU 合成下的真实主线程占用未测；也未做归因实验（逐层关闭 dim/rim/泛光）验证来源。

## 8. 复跑命令

```powershell
node _integration/host-v3.mjs --home _p8/qa-home-v6 --run _p8/qa-run-v6 --install-tgz releases/dsh-startup-elisa-0.6.0.tgz --profile web
node _p8/qa/probe-functional.mjs
bash _p8/qa/run-contrast-v6.sh
node _p8/qa/capture-shots.mjs --tag v6-empty-g100-1600 --out-dir _p8/qa/frames-v6/empty-g100-1600 --seconds 12 --rate 6 --state empty --config '{"glassTransparency":100}' --layout-ms 4000 --expect-version 0.6.0
python _p8/qa/frames-metrics.py --tag v6-empty-g100-1600 --frames _p8/qa/frames-v6/empty-g100-1600 --meta _p8/qa/v6/v6-empty-g100-1600-capture.json --geometry _p8/qa/v6/v6-empty-g100-1600-geometry.json --out _p8/qa/v6/metrics/empty-g100-1600.json --plots --crosscheck
node _p8/qa/perf.mjs --tag v6 --out _p8/qa/v6/perf-v6.json
node _p8/qa/regression.mjs --tag v6 --out-dir _p8/shots/regress-v6 --out _p8/qa/v6/regression-v6.json
node _p8/qa/capture-60fps.mjs --tag v6-empty-60fps --out-dir _p8/qa/frames-60fps/v6-empty --seconds 3 --state empty
python _p8/qa/make-video.py --tag v6 --frames _p8/qa/frames-v6/empty-g100-1600 --meta _p8/qa/v6/v6-empty-g100-1600-capture.json --geometry _p8/qa/v6/v6-empty-g100-1600-geometry.json --screencast-json _p8/qa/v6/v6-empty-60fps-screencast.json --out-dir _p8/demo
python _p8/qa/build-report-data.py
```
