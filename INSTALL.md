# dsh-startup-elisa 安装与排错（v0.6.0）

## 适用范围

- Windows 11 + DeepSeek Harness `0.2.1-rc.5`（rc.3 兼容，API 未变）；web profile 与
  Electron desktop 通用。
- 公开 Release 是 **source 包**：代码、测试、文档、程序化音轨；**不含人物视频、海报与图层**。
  人物素材只限本机自用，禁止上传或公开分发（见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)）。
- 同一 profile 只能启用一个启动插件；安装前确认 nostromo / yomi / screen 等已卸载或停用。

## 安装前备份（可选但推荐）

```powershell
$p = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$b = Join-Path $env:USERPROFILE ('.dsh\_backups\elisa-install-' + (Get-Date -Format yyyyMMdd-HHmmss))
New-Item -ItemType Directory -Force -Path $b | Out-Null
Copy-Item -LiteralPath "$p\package.json","$p\pnpm-lock.yaml","$p\cordis.patch.yml" -Destination $b
Copy-Item -LiteralPath "$p\node_modules\dsh-startup-elisa" -Destination "$b\dsh-startup-elisa" -Recurse
```

## 安装

1. **完全退出 DSH**，包括托盘进程。
2. 从 [Releases](https://github.com/QIFANAI/dsh-startup-elisa/releases) 下载
   `dsh-startup-elisa-0.6.0.tgz` 与 `SHA256SUMS`，先校验：

   ```powershell
   # Windows
   (Get-FileHash .\dsh-startup-elisa-0.6.0.tgz -Algorithm SHA256).Hash.ToLower()
   # 与 SHA256SUMS 里第一列一致
   ```

3. 安装（`dsh` 不在 PATH 时用 DSH 安装目录下的 `resources/runtime/cli/bin/dsh.cmd`）：

   ```powershell
   dsh plugin --profile desktop add .\dsh-startup-elisa-0.6.0.tgz
   dsh plugin --profile desktop list
   ```

   也可让脚本下载并校验安装：

   ```powershell
   node scripts/install.mjs --profile desktop --version 0.6.0 --dry-run
   node scripts/install.mjs --profile desktop --version 0.6.0
   ```

4. 应看到 `dsh-startup-elisa@0.6.0`，且 profile 的 `dsh.profile.bundles` 含
   `dsh-startup-elisa`。
5. 重新打开 DSH。默认 80% 速度下的时序（动画秒是契约值，墙钟 = 动画秒 ÷ 0.8）：

   | 墙钟（默认 80%） | 动画秒 | 内容 |
   |---|---|---|
   | 0–1.44s | 0–1.15s | 黑幕开幕（DEEPSEEK HARNESS 字标 + 终端行 + 幕布拉开） |
   | 1.44–9.00s | 1.15–7.20s | ELISA 冷启动 HUD（任意键 / 点击 / `Esc` / 「跳过 SKIP」可跳过） |
   | 9.00–9.95s | 7.20–8.05s | 交接转场（幕布合拢到绯红光缝 → 主界面「通电」显影，950ms） |
   | 之后 | — | 主界面默认「毛玻璃」皮肤：呼吸动态主题背景 + 整窗模糊 + 输入框整圈流动光边框 |

   - 速度 100% 时总墙钟 7.2s；50% 时约 14.4s；150% 时约 4.8s。
   - 启动时长、交接时长、看门狗与宿主兜底计时按同一套速度公式换算，调慢不会误触看门狗。

## 素材

公开包没有人物素材时：启动层自动走 `no-video` 静帧分支，HUD、交接、音轨、皮肤与设置
全部正常，不报错。要还原完整观感，请按 [lib/assets/README.md](lib/assets/README.md)
自备**你有权使用**的 `hero-loop.mp4` / `hero-poster.webp` / `archive-poster.webp` /
`layers/*.webp`，再重新构建安装包。

## 配置

配置文件：`~/.dsh/dsh-startup-elisa.json`（Windows：`%USERPROFILE%\.dsh\dsh-startup-elisa.json`）。
各键取值与生效时机见 [README.md](README.md#配置)。设置页入口：
DSH 设置 →「ELISA 启动动画」，分组为播放 / 声音 / 外观皮肤 / 预览。

## 隔离测试

不要拿正在使用的 desktop 做安装测试。用临时 `DSH_HOME`：

```powershell
$env:DSH_HOME = "$env:TEMP\dsh-elisa-test"
dsh plugin --profile web add .\releases\dsh-startup-elisa-0.6.0.tgz
dsh web    # 用完后删除该目录
```

离线预览（不需要 DSH，也不需要素材）：

```text
file:///<仓库路径>/preview/index.html
```

## 声音排错

- **完全没声音**：确认 `sound=true` 且 `volume>0`；再确认系统与 DSH 未静音。
- **有画面没声音（Web 宿主）**：浏览器策略可能拦截自动播放。插件会静音降级，并在
  **首次点击/按键**后从当前进度补播；Electron desktop 默认允许自动播放。
- **声音比画面晚**：手势补播会按已播秒数对齐，不会从头错位；明显不同步时检查系统负载。
- **调慢速度后声音变长/变低沉**：预期是变长但**音高不变**（`preservesPitch` 时间伸缩）；
  若音高也变了，说明浏览器不支持，属环境限制。
- **试听按钮提示「音频未生成」**：安装包缺少 `lib/assets/audio/boot.wav`，重装完整 tgz。

## 皮肤排错

- **看不到皮肤差异**：确认档位为「毛玻璃」（默认）；`off` 恢复宿主原样、`accent` 只换配色、
  `full` 为 v0.3 完整皮肤。
- **想临时还原原版**：设置页切「关闭」保存即可立即还原，无需重启；或把 `skin` 改成 `"off"`。
- **玻璃太厚/太透**：调「玻璃通透度」（50 = 标准，越大越透），弹窗与账号菜单同步变化。
- **对比度/阅读不适**：降低通透度、切 `accent` 或 `off`；毛玻璃不改字号、行高、布局与字体栈；
  也可关闭「动态背景」或换更冷色的主题。
- **背景不呼吸/不流动**：检查「动态背景」开关；「减弱动态」会强制静态；页面切后台自动暂停；
  低配（≤4 线程）或无 `backdrop-filter` 环境自动静态，属预期行为。
- **输入框边框没有流光**：确认皮肤为「毛玻璃」且未开「减弱动态」；静态降级下保留固定细光边；
  宿主升级改版导致 CSS Modules 后缀变化时可能降级（console 会 warn）。
- **毛玻璃变「实心」**：远程桌面 / 无 GPU / 浏览器不支持 `backdrop-filter` 时自动降级，属预期。
- **皮肤没加载**：检查 `/dsh-elisa/skin.css` 是否 200；客户端只 warn
  `[dsh-startup-elisa] 皮肤样式加载失败`，不阻塞宿主。
- **玻璃背景层残留在关闭后**：切 `off`/`accent`/`full` 会移除 `#dsh-elisa-ambient` 与
  `--elisa-glass-a`；若仍存在，检查是否有其他插件样式冲突。

## 卸载 / 回滚

```powershell
dsh plugin --profile desktop remove dsh-startup-elisa
```

回滚 profile：退出 DSH 后把备份目录里的 `package.json`、`pnpm-lock.yaml`、
`cordis.patch.yml` 与 `dsh-startup-elisa` 目录拷回 `~/.dsh/profiles/desktop`，
再运行 `pnpm install --offline`。也可直接装回上一版 Release 的 tgz。

## 排错

- **黑屏超过兜底时间**：宿主 `BOOTSTRAP_JS` 兜底强制放行（`__DSH_ELISA_FAILED__=true`）；
  默认 80% 时约 17s，50% 时约 22.6s。检查 DSH 日志里 `[dsh-startup-elisa]` 的 warn。
- **交接处突然变黑/闪退感**：交接为「幕布合拢 → 光缝 → UI 通电」；默认 80% 时约 950ms。
  若仍硬切，确认 `lib/splash.css` 的 `.elisa-handoff` / `.elisa-enter` 未被其他主题覆盖，
  且没有第二个启动插件同时注入。
- **视频缺失/解码失败**：离线预览页自动改用静帧并继续时间轴；宿主侧 iframe 异常时看门狗
  放行，不会卡死。视频在动画 6.0s 处冻结最后一帧，属设计行为。
- **播放两个启动动画**：同一 profile 还有 nostromo / yomi / screen；先卸载其他启动插件。
- **iframe 不显示**：确认 `/dsh-elisa/preview/index.html` 返回 200、`/dsh-elisa/lib/audio.js`、
  `/dsh-elisa/skin.css` 返回 200；`/dsh-elisa/lib/assets/hero-loop.mp4` 在自备素材后应返回 200
  且支持 Range。
- **HUD 字段是 `—` 或短暂 `SYNCING`**：对应宿主 facts 未提供；启动层会在 3 秒内轮询
  `/dsh-elisa/config`，取不到就保持 `—`，不影响播放。
- **desktop 出现 `Web authentication failed`**：与插件无关，是 Electron 默认会话 cookie
  陈旧。完全退出 DSH，备份并移除 `%APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies`
  与 `Cookies-journal`，再启动。
