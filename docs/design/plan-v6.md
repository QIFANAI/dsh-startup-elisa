# P8 · v0.6.0 计划与团队分工（Lead 权威计划，代号 FLOW）


> **仓库说明**：本文是开发期记录的公开镜像，已脱敏本机路径与用户名。文中 `_pN/`、`_p8/`、`_build/`、`_shots-*`、`releases/_superseded/` 等为维护者本机目录，未随公开仓库分发；设计规格、评审与 QA 报告已单独放入 `docs/`。


> 本文件是 P8 阶段的团队工作入口。实现以 `_p8/design-spec-v6.md` 为唯一权威源；本文件只定方向、指标与分工。

## 0. 用户诉求（原话，2026-11-02 02:32）

> 你看我给你录得视频，背景还是没有呼吸的动态效果，聊天框边框也不是呼吸动态效果，并且流光效果是边框本身的动态环绕，不是找一个光点在那里转圈，看起来很廉价，别的问题不大。你如果没有这种设计能力或者工具你就去下载安装调用它，别自己硬磨了。

- 视频：`%USERPROFILE%\Desktop\毛玻璃透明度与启动动画优化 — DeepSeek Harness 2026-11-02 02-26-24.mp4`（9.0s，1550×830，桌面 Electron 实机）
- 用户配置：`~/.dsh/dsh-startup-elisa.json` → `skin=glass, skinTheme=aurora, skinMotion=true, glassTransparency=100, splashSpeed=50`
  - **关键**：用户跑的是**最通透档 100**；所有呼吸/流光的对比度与观感以 100 档为准；50 档也要回归。

## 1. 现状量化（Lead 从视频测得的证据）

| 项 | 实测 | 结论 |
|---|---|---|
| 背景呼吸 | 0.5s→9.0s 全图平均像素差 1.815/255；>2 像素仅 25%；侧栏 1.055 | 幅度太小，肉眼读作静止 |
| composer 边框 | 视频帧可见：暗粉 1px 环 + 一个 110×2px 小光点沿边框转 | 用户读作「一个光点转圈，很廉价」 |
| 现状实现 | `lib/skin.css` 4.8：::before 静态 conic 环（opacity 0.78→1.0）+ ::after offset-path 小光段 | 方向错误，需重做 |

## 2. v0.6.0 目标（只做用户点名的两件事，其余不破坏）

### 2.1 背景「呼吸」可感知

- 呼吸层重新设计：主呼吸 `.ea-breath`（放大镜式）、边缘呼吸 `.ea-rim`（新增）、极光斑 glow 幅度加大、极光漂移保持。
- 判据（以 100 档实渲染为准）：
  - 背景区域（侧栏/顶栏/边缘，排除文字）3s 间隔帧平均差 **≥ 6/255**（现状 1.0–1.8）；
  - 亮度时间序列峰谷比 **≥ 1.35**（同一采样点，一个呼吸周期内）；
  - 录制成片里 2 倍速播放时肉眼可辨。
- 对比度硬约束：g=100 与 g=50 的正文对比度仍 **≥4.5:1**（沿用 P7 的 9 组最差帧矩阵；不够就压 ambient 峰值或加 header 兜底）。

### 2.2 composer 边框 = 边框本身在呼吸 + 流光沿边框环绕

- **删掉小光点**。改为：
  - `::before`：整圈 conic 渐变环，**角度持续旋转**（`@property --ea-flow-angle`），至少 2 段宽光弧（含白热前缘 + 主题色长尾），读作「光在边框里流动」；
  - `::after`：同角度渐变的**模糊泛光**（blur 6–8px，贴边放大）→ 边框外缘有呼吸的光晕，亮度随呼吸起伏；
  - 呼吸：整环亮度/泛光强度 5.6–6.4s 一个周期起伏；旋转 7–9s 一圈（与呼吸错相）；
  - 聚焦时整体提亮；static/paused/noblur 降级保留静态光边；零布局位移、pointer-events:none。
- 判据：
  - 亮部沿周长移动：连续帧亮区质心角位移单调；一圈内亮弧角宽 ≥60°（不是点）；
  - 呼吸：环区域平均亮度一个周期峰谷比 ≥1.8；
  - 布局：composer rect 注入前后一致；`backdrop-filter` 不新增（≤3）。

### 2.3 不破坏

- `off/accent/full` 三档与 v0.5 像素级一致；三主题可辨；浅色宿主仍强制深色；启动动画/音轨/速度/通透度滑块全部不受影响。
- `npm test` 全绿（需同步更新 smoke-client/smoke-skin 的契约断言）。
- 性能：headless 软件光栅下 FPS ≥95%，TaskDuration 不劣于 v0.5 的 +15%（v0.5 已知 +41.5%/+50.4% 风险项，不要求本版解决，但不得恶化）。

## 3. 交付物

1. `releases/dsh-startup-elisa-0.6.0.tgz`（升版本，不覆盖旧包）
2. 安装到 `%USERPROFILE%\.dsh\profiles\desktop`（先备份），用户重启 DSH 后生效
3. 证据：`_p8/qa/`（真宿主截图 + 呼吸/流光像素测量 + 对比度 + 性能 + 回归）、`_p8/shots/`（前后对比 + 联系表）、`_p8/demo/`（**成片 mp4**：2 倍速展示背景呼吸 + 边框流光，供用户直接看效果）
4. 文档：`P8-优化与验收.md`（结论/证据/未验证）、`_p8/design-spec-v6.md`（唯一权威源）、更新 维护者本机项目卡（未随仓库分发） / `README.md` / `INSTALL.md`
5. 独立验收：`_p8/verify/qa-report-v6.md`

## 4. 团队分工与写入范围（并发安全）

| 成员 | 负责 | 写入范围 | 禁止 |
|---|---|---|---|
| **Lead** | 设计结果 + `lib/skin.css`/`lib/client.js`/`lib/index.js`/`package.json` + 文档 | `lib/`, `package.json`, `P8-*.md`, `_p8/design-spec-v6.md`, `_p8/lead-*`, `_p8/demo/` | 不碰 QA 队友脚本目录 |
| **qa-eng** | 独立 QA 链路：隔离宿主 + Edge headless CDP 抓帧、呼吸/流光/对比度/性能/回归测量、成片渲染；产出 `qa-report` 证据 | `_p8/qa/`, `_p8/shots/`, `_p8/qa-home*`, `_p8/qa-run*`, `_p8/demo/`（成片由 qa-eng 出） | 不改 `lib/`、不改用户 `~/.dsh`、不重启用户桌面 App |
| **design-review** | ① 外部参考检索（高级玻璃呼吸/边框流光实现与观感标准）② 对 Lead 交付的渲染帧做独立观感评审，给具体 CSS 数值建议 | `_p8/design/` | 不改 `lib/`，不跑宿主 |

- 协调：Lead 完成第一版构建后 `send_message` 通知 qa-eng 与 design-review；两边各自独立跑，不改对方文件。
- 隔离宿主命令（qa-eng 用）：
  `node _integration/host-v3.mjs --home _p8/qa-home-v6 --run _p8/qa-run-v6 --install-tgz releases/dsh-startup-elisa-0.6.0.tgz --profile web`
- 停宿主：`node _integration/host-v3.mjs --kill _p8/qa-run-v6`

## 5. 时间线（单批次推进）

1. Lead：改 CSS/JS → `npm test` → 打包 v0.6.0 → 自测（隔离宿主抓帧，快速判断观感）→ 通知队友
2. qa-eng：独立全量 QA（功能/呼吸/流光/对比度/性能/回归/成片）
3. design-review：参考检索 → 评审 Lead 的渲染帧 → 输出改进清单
4. Lead：按评审与 QA 结果返工 1–2 轮 → 终验 → 安装 desktop → 维护者本机项目卡 更新 → 交付
