# 更新日志

版本号遵循语义化版本；`v0.6.0` 起在本仓库公开发布。完整设计与验收记录见
`docs/design/` 与 `docs/history/`。

## 0.6.1 · 2026-11-27 · 完整素材开源版

- 仓库与官方 Release 改为**完整人物素材开源**：`hero-loop.mp4`（3.99 MB）/
  `hero-poster.webp`（383 KB）/ `archive-poster.webp`（192 KB）与 `layers/` 下 13 个 WebP
  （翼光 2、羽毛 2、引导线 3、螺旋 3、光环、星点、剑光）共 **16 个文件 / 5,122,255 B**
  随仓库提交，与维护者本机完整包逐字节一致；
- `.gitignore` 不再排除 `lib/assets/*`（改为只忽略本机目录 `_video/` 与根目录演示视频）；
  `check-public` 删除「未跟踪第三方媒体」门禁，改为校验 16 个素材全部入库；
  `build-release` 的 source 包改为**必须包含全部 16 个素材**，`release.json` 声明
  `mediaIncluded=true`；
- README / INSTALL / THIRD-PARTY-NOTICES / `lib/assets/README.md` / MAINTAIN / CONTRIBUTING /
  combo 文档与 `cordis.patch.yml` 同步完整开源口径：素材随仓库与 Release 完整发布，
  权利归各自权利人，代码 MIT 不覆盖素材，再分发前自行确认授权，权利人异议可开 Issue；
- 素材缺失时的降级链保持不变（静帧 / 无视频分支），无素材环境仍可完整运行；
- 版本引用同步到 0.6.1：`package.json` / README / INSTALL / 预览默认版本 /
  客户端与音轨版本常量 / 测试断言；
- 验证：`npm test`（123 + 164 + 90 + 80 + 40 = 497 PASS）、`npm run check`、
  `npm run build -- --write-manifest`；`tar -tzf` 确认 tgz 含全部 16 个素材文件。

## 0.6.0 · FLOW（2026-11-02）

- **背景呼吸 v2**：ambient 由 9 层增至 **11 层**（新增 `.ea-dim` 暗帘呼吸 + `.ea-rim`
  边缘呼吸光）；`breath/dim/rim` 统一 **8.4s 单频同相叠加**（亮相更亮、暗相更暗）；
  `.ea-breath` opacity .10→.44 / scale .92→1.10；极光斑 glow .45–.55→1（错相
  7.2/8.4/6.8/9.6s）、漂移 22/26/24/30s、位移 10–16vmax。暗帘只压暗不抬亮 → 对比度安全。
- **composer 整圈流动光边框**：删除 v0.5 的「静态 1px 环 + `offset-path` 小光点」；
  改为 `::before` 1.6px 主题环 + **8s/圈旋转 conic 光场**（暖白前缘 + 主/副弧 + 完整底环）
  + `::after` **同角度/同周期 blur(7px) 外缘泛光** + **6.4s 呼吸相位锁定**；
  无新增 `backdrop-filter`、零布局位移。
- 保留 v0.5 全部能力（通透度、启动速度、三主题、交互层玻璃、固定深色语义）。

## 0.5.0 · BREATH（2026-11-01）

- 新增 `glassTransparency`（0–100，默认 50）：32 处玻璃 alpha 统一映射，主界面、
  设置弹窗、账号菜单同步，保存立即生效。
- 新增 `splashSpeed`（50–150%，默认 80% = 9.0s）：叙事/冲击/氛围三层节奏模型，
  视频与音轨同速（音高不变），看门狗与交接同步换算。
- 背景呼吸：极光斑漂移 26/32/28/36s + 错相亮度呼吸 + 全屏 `ea-breath` 9.2s。
- 交互层玻璃：设置弹窗、账号菜单随通透度同步。
- 输入框流光（v0.5 版）：静态环 + 小光点，v0.6 已替换为整圈光场。

## 0.4.0 · GLASS（2026-10-31）

- 新增第 4 档 **glass（毛玻璃）** 并设为默认：整窗 `backdrop-filter: blur(26px) saturate(150%)`
  + 半透明玻璃令牌 + 1px 高光描边。
- 新增全屏动态主题背景 `#dsh-elisa-ambient`：base 渐变 + 4 个极光斑 + 柔光扫过 + 噪点
  + 暗角；三套主题 aurora / deepsea / violet；`skinMotion` 开关与静态降级。
- `off/accent/full` 与 v0.3 行为一致（像素回归通过）。

## 0.3.0 · CURTAIN（2026-10-29）

- 新增 850ms 设计化交接转场，消除 v0.2.0 的黑场硬切。
- 新增 ACT 0 黑幕开幕（DEEPSEEK HARNESS 字标、终端启动行、绯红光缝、幕布拉开）。
- 新增程序化音轨：7.8s 主声轨（19 个 cue）+ 1.35s chime；设置页可开关/调音量/试听；
  自动播放被拦时静音降级、首次手势补播。
- 新增三档皮肤 `off / accent / full`，覆盖 65 个宿主 token 与 7 处档案终端细节。

## 0.2.0（2026-10-28）

- 舞台由固定 1920×1080 缩放改为全屏自适应，HUD 小字可读。
- 启动序列改为「HUD 叙事 + 光扫/粒子/锁定框/剑光切场」，退场改为 320ms 交叉淡化。
- 交互补齐：点击任意处 / 终帧自动退出 / 禁用跳过 / 减弱动态；facts 就绪轮询逐项锁定。
- 设置页新增内嵌预览。

## 0.1.5（2026-10-28）

- 修复 desktop 只显示静态终帧：不再跟随系统 `prefers-reduced-motion`，只有配置
  `reducedMotion=true` 才走静态分支。

## 0.1.0 – 0.1.4（2026-10-28）

- 首个可安装版本：宿主内全屏 iframe 启动层、ready/progress/done 协议、看门狗、
  跳过与重播；逐步补齐音频、皮肤雏形与设置页。
