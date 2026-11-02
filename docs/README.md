# 文档索引

本目录是 v0.1.5 – v0.6.0 的设计与验收记录公开镜像，已脱敏本机路径与用户名。

| 路径 | 内容 |
|---|---|
| `design/design-spec-v6.md` | **v0.6.0 设计规格（唯一权威源）**：背景呼吸 v2 + composer 整圈流动光边框 |
| `design/plan-v6.md` | v0.6.0 实施计划与任务分解 |
| `design/review-v1.md` / `review-v2.md` | 两轮独立设计评审（对照 v0.5，含逐项判定） |
| `design/reference-research.md` | 外部参考与观感基准研究 |
| `verify/qa-report-v6.md` | v0.6.0 独立 QA 报告：30 项矩阵、定量指标、未验证假设 |
| `history/P2-交互预览.md` | v0.1.5 交互预览与布局基线 |
| `history/P3-宿主接入.md` | 宿主接入方案与真实宿主验收 |
| `history/P4-优化与验收.md` | v0.2.0：全屏自适应、HUD 叙事、交互补齐 |
| `history/P5-优化与验收.md` | v0.3.0 CURTAIN：交接转场、ACT 0、音轨、三档皮肤 |
| `history/P6-优化与验收.md` | v0.4.0 GLASS：毛玻璃 + 动态主题背景 |
| `history/P7-优化与验收.md` | v0.5.0 BREATH：通透度、速度、呼吸背景、composer 流光 |
| `history/P8-优化与验收.md` | v0.6.0 FLOW：呼吸 v2、整圈光边框、验收回填 |
| `screenshots/glass-empty-g100.png` | 玻璃皮肤空会话截图（不含人物） |
| `screenshots/composer-flow.png` | 输入框流动光边框 8 个相位拼图 |

## 阅读顺序

1. 先读 `design/design-spec-v6.md` 了解当前设计口径；
2. 再看 `verify/qa-report-v6.md` 的结论摘要与未验证假设；
3. 历史版本按 `history/P2 → P8` 顺序读。

## 关于本机路径

原文中的 `_pN/`、`_p8/`、`_build/`、`_shots-*`、`releases/_superseded/`、
维护者本机项目卡与开工简报等是维护者本机目录，**未随公开仓库分发**；
对应的公开证据（截图、设计规格、QA 报告）已整理到本目录。原文中的本机绝对路径
已替换为仓库相对路径、`%USERPROFILE%` 或占位说明。
