# 00 · 给 DSH 代理：安装「ELISA 启动动画 + UI 皮肤」组合包

> **触发条件**：用户把这个压缩包拖进 DSH 对话框，并说「帮我安装这个插件」这类话时，按本文件执行。
> **目标机器**：Windows x64，已安装 DeepSeek Harness 桌面版（本机路径 `<DSH 安装目录>`；其他安装位置由脚本自动探测，或按 §3 指定）。
> **本包是什么**：`dsh-startup-elisa` **v0.6.0（代号 FLOW，2026-11-02）运行时包**——包内 tgz 含代码、文档、测试、程序化音轨（boot.wav / chime.wav）、四档皮肤、三套主题、设置页与全部文档。**不是裁剪版、不是演示版**：公开 source 包不含第三方人物素材，装完功能与工作树一致（素材按自备流程补齐）；本地完整包（自备素材后 `npm run build:full`）才会含人物视频、海报与图层。tgz 的文件数 / 大小 / SHA256 以包内 `校验清单.sha256` 为准。

## 0. 包内清单

| 文件 | 作用 |
|---|---|
| `dsh-startup-elisa-0.6.0.tgz` | 插件安装包（文件数 / 大小 / SHA256 见 `校验清单.sha256`） |
| `tools\install-elisa.ps1` | 一键无损安装器（校验 → 备份 → 安装 → 6 项验收；已装时自动先卸载再重装） |
| `tools\verify-elisa.ps1` | 只读完整性核验器 |
| `校验清单.sha256` | 包内全部文件逐一 SHA256 + tgz 基线 |
| `01-使用说明与排错.md` | 人读：功能、配置、排错、回滚、已知限制 |
| 本文件 | 你（DSH 代理）的执行说明 |

---

## 1. 一句话目标

把包内 `dsh-startup-elisa-0.6.0.tgz` 装进本机 DSH 的 `desktop` profile：**先校验、再备份、后安装、装完逐项验收**；完成后提示用户「完全退出 DSH（含托盘）再重开」即可生效。**安装期间 DSH 可以继续开着**（不必退出，退出反而会中断当前会话），但**重启后**才会看到动画与皮肤；若安装命令报文件占用，再让用户完全退出 DSH 后重跑。

## 2. 最短路径（推荐）

### 2.1 解压压缩包

```powershell
$zip   = "<本压缩包的绝对路径>"          # 用户消息里的附件路径；不知道见 §2.3
$stage = Join-Path $env:TEMP ("elisa-pkg-" + (Get-Date -Format yyyyMMdd-HHmmss))
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $stage, [System.Text.Encoding]::UTF8)
$root  = Join-Path $stage "Elisa启动动画+UI皮肤组合包"
Get-ChildItem $root   # 应看到 dsh-startup-elisa-0.6.0.tgz、校验清单.sha256、tools\
```

### 2.2 执行安装（核心命令，1 条）

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "tools\install-elisa.ps1")
```

脚本依次完成：定位压缩包 → 校验 tgz 与包内 包内全部文件 → 检查 profile/CLI → 全量备份 → 暂存 tgz → `dsh plugin add`（已装时先 `remove` 再 `add`，确保是真正重装而不是 pnpm 的 `Already up to date`）→ 装后 6 项验收。
**退出码：0 = PASS；1 = 验收 FAIL；2 = 前置条件不满足（未做任何改动）。** PASS 后把脚本打印的 `[1/6]…[6/6]`、验收表格、备份目录路径回报用户，并说：

> **「请完全退出 DSH（含托盘图标）后重新打开，启动动画与皮肤在重开后生效。」**

**不要**自己重启或关闭 DSH（会中断当前会话），也**不要**替用户改设置。

### 2.3 不知道 zip 落在哪时

先按路径找，再按名字找；都没有就请用户把压缩包另存到桌面/下载后重试：

```powershell
# a) 用户消息里给了路径 → 直接用
# b) 只知道文件名 → 在常见目录按名字找
Get-ChildItem -Path "$env:USERPROFILE\Desktop","$env:USERPROFILE\Downloads","$env:TEMP",(Get-Location).Path `
  -Filter "*组合包*.zip" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName,Length,LastWriteTime
```

- 找到后回到 §2.1。
- 若把 `tools\install-elisa.ps1` 单独放到别处（旁边没有 tgz/校验清单），可省略 `-ZipPath`，让安装器自己去上述目录与 `~\.dsh\attachments` 附件库按「PK 头 + 包内 tgz 名 + 6–13 MB」定位压缩包并自动解压。
- 都找不到：把压缩包保存到 `%USERPROFILE%\Desktop` 再跑；不要凭文件名猜一个不存在的路径。

## 3. 参数（按需）

| 需求 | 追加参数 |
|---|---|
| 已装且文件被改坏 → 强制重装/修复 | `-Force`（内部先 `remove` 再 `add`；普通重跑也走同样流程，`-Force` 用于「已完整但仍想重装」） |
| 装到别的 profile（如 `web`） | `-Profile web` |
| 只打印计划、不落盘 | `-DryRun` |
| `DSH_HOME` 不是默认 `~\.dsh` | `-DshHome "D:\somewhere"`（核验命令同样要带） |
| DSH CLI 不在 `<DSH 安装目录>\...` | `-DshCli "<安装目录>\resources\runtime\cli\bin\dsh.cmd"`（脚本也会自动探测 `<DSH 安装目录>`、`D:\dsh`、`C:\dsh`、`PATH`、`%LOCALAPPDATA%\Programs` 等） |
| 只想核验、不安装 | `& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "tools\verify-elisa.ps1")`；非默认 `DSH_HOME`/profile 时加 `-DshHome ... -Profile ...` |
| 显式指定压缩包（包内已有 tgz 时也生效，不再是静默忽略） | `-ZipPath "D:\...\Elisa启动动画+UI皮肤组合包.zip"` |

## 4. 脚本做了什么（可直接向用户解释）

1. **定位压缩包**：`-ZipPath` 显式指定优先（会校验并解压）；否则包内已有 tgz 就用包内；再否则在桌面 / 下载 / 当前目录 / 附件库自动找。
2. **校验 tgz**：SHA256 必须等于 `校验清单中记录的值`、大小 `tgz 实际大小`。
3. **校验 包内全部文件**：解出 tgz，按 `校验清单.sha256` 逐文件比对 → 证明包完整、没被裁剪或损坏。
4. **检查 profile / CLI**：确认 `~\.dsh\profiles\desktop` 已初始化（未初始化时见 §6）；记录安装前版本、依赖、配置哈希。
5. **全量备份**（无损前提）：`~\.dsh\_backups\elisa-install-<时间戳>\` 内备份 profile 的 `package.json` / `pnpm-lock.yaml` / `cordis.patch.yml`、已装 `node_modules\dsh-startup-elisa`、用户配置 `~\.dsh\dsh-startup-elisa.json`。
6. **暂存**：tgz 复制到 `~\.dsh\_packages\dsh-startup-elisa-0.6.0.tgz`（稳定路径，临时目录被清也不影响以后重装）。
7. **安装**：`dsh plugin --profile desktop add <暂存 tgz>`（DSH 官方 CLI，等价 `pnpm add <tgz>`；插件无外部依赖，**离线可装**）。**已装过则先 `remove` 再 `add`**：pnpm 对「同版本且已存在」会判 `Already up to date`，不先卸载就修不好被改坏的文件。脚本会让 CLI 与本脚本使用同一个 `DSH_HOME`，不会装错位置。
8. **装后验收 6 项**：
   - 版本 = `0.6.0`
   - 安装目录 **全部文件** 文件 SHA256 全一致（无缺失、无多余）
   - `plugin list` 含 `dsh-startup-elisa@0.6.0`
   - profile `package.json` 的 `dsh.profile.bundles` 含 `dsh-startup-elisa`
   - 用户配置 `~\.dsh\dsh-startup-elisa.json` 哈希未变（不动用户设置）
   - 其它依赖（如 `dsh-ops`）未变化（不误伤现有插件）

## 5. 手动等价步骤（脚本被沙箱/策略拦住时照抄）

**先确认是「权限被拒」而不是「安装失败」**。若 shell 被沙箱限制写 `~\.dsh`，不要绕沙箱：把下面整段交给用户，请用户在 PowerShell 里执行（用户自己执行不受代理沙箱限制）。

```powershell
# ── 0) 参数（注意：不要用 $home，它是 PowerShell 只读自动变量）──
$zip     = "<本压缩包绝对路径>"
$dsh     = "<DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd"
$dshHome = Join-Path $env:USERPROFILE ".dsh"
$prof    = "desktop"
$stage   = Join-Path $env:TEMP ("elisa-pkg-" + (Get-Date -Format yyyyMMdd-HHmmss))

# ── 1) 解压 ──
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $stage, [System.Text.Encoding]::UTF8)
$root = Join-Path $stage "Elisa启动动画+UI皮肤组合包"
$tgz  = Join-Path $root "dsh-startup-elisa-0.6.0.tgz"

# ── 2) 校验 tgz（期望 校验清单中记录的值）──
(Get-FileHash -LiteralPath $tgz -Algorithm SHA256).Hash.ToLower()

# ── 3) 备份 ──
$pp = Join-Path $dshHome "profiles\$prof"
$bk = Join-Path $dshHome ("_backups\elisa-install-" + (Get-Date -Format yyyyMMdd-HHmmss))
New-Item -ItemType Directory -Force -Path $bk | Out-Null
Copy-Item -LiteralPath "$pp\package.json","$pp\pnpm-lock.yaml","$pp\cordis.patch.yml" -Destination $bk -ErrorAction SilentlyContinue
Copy-Item -LiteralPath (Join-Path $dshHome "dsh-startup-elisa.json") -Destination $bk -ErrorAction SilentlyContinue
if (Test-Path "$pp\node_modules\dsh-startup-elisa") {
  Copy-Item -LiteralPath "$pp\node_modules\dsh-startup-elisa" -Destination (Join-Path $bk "dsh-startup-elisa") -Recurse
}

# ── 4) 暂存 + 已装则先卸载 + 安装 ──
$store = Join-Path $dshHome "_packages"
New-Item -ItemType Directory -Force -Path $store | Out-Null
Copy-Item -LiteralPath $tgz -Destination (Join-Path $store "dsh-startup-elisa-0.6.0.tgz") -Force
$env:DSH_HOME = $dshHome
if (Test-Path "$pp\node_modules\dsh-startup-elisa") {
  & $dsh plugin --profile $prof remove dsh-startup-elisa
}
& $dsh plugin --profile $prof add (Join-Path $store "dsh-startup-elisa-0.6.0.tgz")

# ── 5) 复核 ──
& $dsh plugin --profile $prof list
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "tools\verify-elisa.ps1") -DshHome $dshHome -Profile $prof

# ── 6) 清理临时解压目录 ──
Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
```

## 6. 失败与边界

| 现象 | 处理 |
|---|---|
| `Open DeepSeek Harness Desktop once to initialize its profile...` | `desktop` profile 还没初始化。让用户**打开一次 DSH 桌面版**（进到主界面）→ **完全退出**（含托盘）→ 重跑脚本。 |
| 写 `~\.dsh` 被沙箱/策略拒绝 | 不要绕。把 §5 整段交给用户手动执行；执行完再让用户重开 DSH。 |
| tgz SHA256 不符 | 立即停止，不要安装。向用户报告实测哈希；让用户重新传压缩包（可能传输损坏）。 |
| `ERR_PNPM_*` / store 相关报错 | 用 `-Force` 重试 1 次；仍失败则把脚本输出的原始错误贴给用户，**不要**自行删 store、改 pnpm 配置或手工改 profile。 |
| 装完 `verify-elisa.ps1` FAIL（文件被改坏/装不完整） | 重跑安装器即可（内部会先 remove 再 add）；仍 FAIL 就把明细回报用户，回滚命令见 §7。**不要**只在原文件上覆盖改写。 |
| 用户还装着别的启动插件（nostromo / yomi / screen / moss） | 同一 profile **只能启用一个启动插件**。先问用户是否卸载旧的，再装本包。 |
| 本机已经是 0.6.0 且完整 | 脚本自动跳过安装并报「已安装且完整」（无损、不折腾）。用户若要修复/重装：`-Force`。 |
| 用户问「会不会动我的设置/别的插件」 | 不会：脚本先校验、再备份，只增装本插件；`~\.dsh\dsh-startup-elisa.json` 原样保留；其它依赖做前后比对。 |
| 用户问装没装/装得全不全 | 跑 `tools\verify-elisa.ps1`，看 4/4 PASS 与「全部文件哈希一致」即可。 |

## 7. 回滚（用户说「卸掉/还原」时）

**首选**：卸载后再装回旧版（若需要），而不是手工拷文件：

```powershell
$env:DSH_HOME = Join-Path $env:USERPROFILE ".dsh"
& "<DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove dsh-startup-elisa
```

若 remove 失败：退出 DSH 后，把安装时生成的备份目录 `<备份目录>` 里的 `package.json`、`pnpm-lock.yaml`、`cordis.patch.yml` 拷回 `~\.dsh\profiles\desktop\`，并把备份里的 `dsh-startup-elisa\` 拷到 **`~\.dsh\profiles\desktop\node_modules\dsh-startup-elisa\`**（注意是 `node_modules` 里面，不是 profile 根目录），再重开 DSH。**不要硬删备份目录。**

## 8. 禁止事项

- 不要把 `dsh-startup-elisa-0.6.0.tgz` 解压后手工覆盖 profile（会破坏 pnpm 依赖关系；只走 `dsh plugin add`）。
- 不要在原文件上覆盖改写来"修"插件（pnpm 用硬链接共享 store，原位改写会污染共享内容）；修复一律走「重跑安装器 / 先 remove 再 add」。
- 不要改版本号、不要用别的版本号覆盖安装。
- 不要上传/公开分发包内人物素材（仅限本机自用；音轨为本项目合成）。
- 不要删除 `~\.dsh\dsh-startup-elisa.json`（用户设置，含速度/通透度/主题）。
- 不要在安装前删除 `~\.dsh\_backups\elisa-install-*` 历史备份。
- 不要自行重启/关闭 DSH，也不要替用户改设置项。
