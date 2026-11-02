# ============================================================================
#  dsh-startup-elisa 0.6.0 —— 无损安装器（「Elisa启动动画+UI皮肤组合包」内）
#
#  用法（普通用户 / DSH 代理都适用）：
#    powershell -NoProfile -ExecutionPolicy Bypass -File install-elisa.ps1
#    powershell -NoProfile -ExecutionPolicy Bypass -File install-elisa.ps1 -ZipPath "D:\...\Elisa启动动画+UI皮肤组合包.zip"
#    powershell -NoProfile -ExecutionPolicy Bypass -File install-elisa.ps1 -Force        # 同版本强制重装/修复（内部先 remove 再 add）
#    powershell -NoProfile -ExecutionPolicy Bypass -File install-elisa.ps1 -DryRun       # 只检查+打印计划
#
#  退出码：0 = PASS（安装成功或已安装且完整）；1 = 验收 FAIL；2 = 前置条件不满足（未做任何改动）
#  设计原则：校验 tgz 与包内全部文件哈希 → 备份 → 已装则先 remove → 官方 `dsh plugin add` → 装后 6 项验收；
#            不动用户配置（~\.dsh\dsh-startup-elisa.json）、不动其它插件、不手工覆盖 profile。
# ============================================================================
[CmdletBinding()]
param(
  [string]$ZipPath,
  [string]$DshHome,
  [string]$Profile = 'desktop',
  [string]$DshCli,
  [string]$ManifestPath,
  [string]$WorkDir,
  [switch]$Force,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$PkgName         = 'dsh-startup-elisa'
$ExpectedVersion = '0.6.0'
$TgzName         = 'dsh-startup-elisa-0.6.0.tgz'
# 期望值由包内「校验清单.sha256」提供（构建时从同一 tgz 生成）；无外部锚点时以清单为准
$ExpectedTgzSha  = $null
$ExpectedTgzSize = 0
$ExpectedFiles   = 0

$stepNo = 0
$zipFound = $null
$pkgRoot = $null
$stageCreated = $null
$checkDir = $null
$backupDir = $null
$preState = @{}
$failures = New-Object System.Collections.ArrayList

function Say([string]$text) { Write-Host $text }
function SayC([string]$text, [string]$color) { Write-Host $text -ForegroundColor $color }
function Step([string]$label, [string]$detail) {
  $script:stepNo++
  SayC ("[{0}/6] {1,-18} ... {2}" -f $script:stepNo, $label, $detail) 'Cyan'
}
function StepOk([string]$label, [string]$detail) {
  SayC ("[{0}/6] {1,-18} OK  {2}" -f $script:stepNo, $label, $detail) 'Green'
}
function Remove-TempArtifacts {
  if ($script:checkDir -and (Test-Path -LiteralPath $script:checkDir)) { Remove-Item -LiteralPath $script:checkDir -Recurse -Force -ErrorAction SilentlyContinue }
  if ($script:stageCreated -and (Test-Path -LiteralPath $script:stageCreated)) { Remove-Item -LiteralPath $script:stageCreated -Recurse -Force -ErrorAction SilentlyContinue }
}
function Die([string]$msg, [int]$code = 2) {
  Remove-TempArtifacts
  SayC ("结论: FAIL — " + $msg) 'Red'
  SayC "未对系统做任何改动（或已按 ERR 行说明处理）。" 'Yellow'
  exit $code
}
function Add-Failure([string]$msg) { [void]$failures.Add($msg); SayC ("  [FAIL] " + $msg) 'Red' }
function Add-Pass([string]$msg) { SayC ("  [PASS] " + $msg) 'Green' }

function Get-Sha256([string]$p) {
  return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Get-RelPath([string]$base, [string]$full) {
  $rel = $full.Substring($base.Length)
  return $rel.TrimStart('\', '/').Replace('\', '/')
}
function Read-JsonFile([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) { return $null }
  $raw = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return ($raw | ConvertFrom-Json)
}

function Read-Manifest([string]$path) {
  $files = @{}
  $count = 0
  $tgzSha = $null
  $tgzSize = 0
  foreach ($line in [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::UTF8)) {
    $t = $line.Trim()
    if ($t.Length -eq 0) { continue }
    if ($t.StartsWith('#')) {
      if ($t -match 'tgz_sha256=([0-9a-fA-F]{64})') { $tgzSha = $Matches[1].ToLowerInvariant() }
      if ($t -match 'tgz_size=(\d+)') { $tgzSize = [int64]$Matches[1] }
      continue
    }
    $parts = $t -split '\s+', 2
    if ($parts.Count -lt 2) { continue }
    $h = $parts[0].ToLowerInvariant()
    $f = $parts[1].Trim().TrimStart('*').Trim().Replace('\', '/')
    if ($f.StartsWith('./')) { $f = $f.Substring(2) }
    if ($f.Length -eq 0) { continue }
    $files[$f] = $h
    $count++
  }
  return [pscustomobject]@{ Files = $files; Count = $count; TgzSha256 = $tgzSha; TgzSize = $tgzSize }
}

function Compare-DirWithManifest([string]$dir, $manifest) {
  $res = [pscustomobject]@{
    DirExists = $false; Count = 0
    Missing = @(); Mismatch = @(); Extra = @(); Ok = $false
  }
  if ([string]::IsNullOrEmpty($dir) -or -not (Test-Path -LiteralPath $dir)) { return $res }
  $res.DirExists = $true
  $actual = @{}
  foreach ($fi in (Get-ChildItem -LiteralPath $dir -Recurse -File -Force -ErrorAction Stop)) {
    $actual[(Get-RelPath $dir $fi.FullName)] = (Get-Sha256 $fi.FullName)
  }
  $res.Count = $actual.Count
  $missing = New-Object System.Collections.ArrayList
  $mismatch = New-Object System.Collections.ArrayList
  $extra = New-Object System.Collections.ArrayList
  foreach ($k in $manifest.Files.Keys) {
    if (-not $actual.ContainsKey($k)) { [void]$missing.Add($k) }
    elseif ($actual[$k] -ne $manifest.Files[$k]) { [void]$mismatch.Add($k) }
  }
  foreach ($k in $actual.Keys) {
    if (-not $manifest.Files.ContainsKey($k)) { [void]$extra.Add($k) }
  }
  $res.Missing = @($missing)
  $res.Mismatch = @($mismatch)
  $res.Extra = @($extra)
  $res.Ok = ($missing.Count -eq 0 -and $mismatch.Count -eq 0 -and $extra.Count -eq 0 -and $actual.Count -eq $manifest.Count)
  return $res
}

function Test-ZipMagic([string]$p) {
  try {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { return $false }
    $fs = [System.IO.File]::OpenRead($p)
    try {
      $buf = New-Object byte[] 4
      $n = $fs.Read($buf, 0, 4)
      return ($n -eq 4 -and $buf[0] -eq 0x50 -and $buf[1] -eq 0x4B -and $buf[2] -eq 0x03 -and $buf[3] -eq 0x04)
    } finally { $fs.Dispose() }
  } catch { return $false }
}
function Test-ZipContainsTgz([string]$p) {
  try {
    $z = [System.IO.Compression.ZipFile]::OpenRead($p)
    try {
      foreach ($e in $z.Entries) { if ($e.Name -eq $TgzName) { $z.Dispose(); return $true } }
    } finally { if ($z) { $z.Dispose() } }
    return $false
  } catch { return $false }
}

function Find-PackageZip([string]$homeDir, [string]$nearDir) {
  $cands = New-Object System.Collections.ArrayList
  $probeDirs = New-Object System.Collections.ArrayList
  [void]$probeDirs.Add($nearDir)
  [void]$probeDirs.Add((Get-Location).Path)
  if ($env:USERPROFILE) {
    $desk = [Environment]::GetFolderPath('Desktop')
    if ($desk) { [void]$probeDirs.Add($desk) }
    [void]$probeDirs.Add((Join-Path $env:USERPROFILE 'Downloads'))
  }
  if ($env:TEMP) { [void]$probeDirs.Add($env:TEMP) }
  if ($homeDir) { [void]$probeDirs.Add($homeDir) }

  foreach ($d in $probeDirs) {
    if ([string]::IsNullOrEmpty($d) -or -not (Test-Path -LiteralPath $d)) { continue }
    try {
      $hits = Get-ChildItem -LiteralPath $d -File -Filter '*组合包*.zip' -ErrorAction SilentlyContinue
      foreach ($h in $hits) { if (Test-ZipContainsTgz $h.FullName) { return $h.FullName } }
    } catch { }
    try {
      $hits2 = Get-ChildItem -LiteralPath $d -File -Filter '*.zip' -ErrorAction SilentlyContinue |
               Where-Object { $_.Length -gt 6000000 -and $_.Length -lt 13000000 }
      foreach ($h in $hits2) { if ((Test-ZipMagic $h.FullName) -and (Test-ZipContainsTgz $h.FullName)) { return $h.FullName } }
    } catch { }
  }

  # DSH 附件库（内容寻址，无扩展名）：按大小 + PK 头 + 包内 tgz 名确认
  if ($homeDir) {
    $att = Join-Path $homeDir 'attachments\v1\objects'
    if (Test-Path -LiteralPath $att) {
      try {
        $objs = Get-ChildItem -LiteralPath $att -Recurse -File -ErrorAction SilentlyContinue |
                Where-Object { $_.Length -gt 6000000 -and $_.Length -lt 13000000 } |
                Sort-Object LastWriteTime -Descending
        foreach ($o in $objs) {
          if ((Test-ZipMagic $o.FullName) -and (Test-ZipContainsTgz $o.FullName)) { return $o.FullName }
        }
      } catch { }
    }
  }
  return $null
}

function Find-DshCli([string]$explicit) {
  if ($explicit) {
    if (Test-Path -LiteralPath $explicit) { return $explicit }
    Die "指定的 -DshCli 不存在：$explicit"
  }
  if ($env:DSH_CLI -and (Test-Path -LiteralPath $env:DSH_CLI)) { return $env:DSH_CLI }
  $roots = New-Object System.Collections.ArrayList
  foreach ($r in @('E:\dsh', 'D:\dsh', 'C:\dsh')) { [void]$roots.Add($r) }
  foreach ($r in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if ($r) { [void]$roots.Add((Join-Path $r 'Programs\DeepSeek Harness')); [void]$roots.Add((Join-Path $r 'DeepSeek Harness')) }
  }
  foreach ($r in $roots) {
    $p = Join-Path $r 'resources\runtime\cli\bin\dsh.cmd'
    if (Test-Path -LiteralPath $p) { return $p }
  }
  foreach ($n in @('dsh.cmd', 'dsh')) {
    try {
      $c = Get-Command $n -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($c -and $c.Path) { return $c.Path }
    } catch { }
  }
  return $null
}

function Invoke-DshCli([string]$cli, [string[]]$cliArgs, [string]$logFile) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($logFile) { & $cli @cliArgs *> $logFile } else { & $cli @cliArgs *> $null }
    return $LASTEXITCODE
  } finally { $ErrorActionPreference = $old }
}
function Get-CliText([string]$cli, [string[]]$cliArgs) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $cli @cliArgs 2>&1 | Out-String
    return $out
  } finally { $ErrorActionPreference = $old }
}

# ============================================================================
# 启动
# ============================================================================
SayC "================================================================" 'Cyan'
SayC " dsh-startup-elisa 0.6.0 无损安装器" 'Cyan'
SayC "================================================================" 'Cyan'

try { Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop } catch { }

if ([string]::IsNullOrEmpty($DshHome)) {
  if ($env:DSH_HOME) { $DshHome = $env:DSH_HOME } else { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
}
$DshHome = [System.IO.Path]::GetFullPath($DshHome)
# 让 dsh CLI 子进程与本脚本操作同一个 DSH_HOME（CLI 用 DSH_HOME 环境变量定位 profile）
$env:DSH_HOME = $DshHome
$profileDir = Join-Path $DshHome ("profiles\" + $Profile)
$installedDir = Join-Path $profileDir ("node_modules\" + $PkgName)
$userConfig = Join-Path $DshHome 'dsh-startup-elisa.json'
$scriptDir = $PSScriptRoot
$pkgRootGuess = Split-Path $scriptDir -Parent

if ([string]::IsNullOrEmpty($ManifestPath)) { $ManifestPath = Join-Path $pkgRootGuess '校验清单.sha256' }

Say ("DSH_HOME   : " + $DshHome)
Say ("profile    : " + $Profile + "  (" + $profileDir + ")")
Say ("包内目录   : " + $pkgRootGuess)
Say ""

# ── 1) 定位压缩包 / 包根 ────────────────────────────────────────────────
Step '定位压缩包' ''
$tgzLocal = Join-Path $pkgRootGuess $TgzName
$localOk = (Test-Path -LiteralPath $tgzLocal) -and (Test-Path -LiteralPath $ManifestPath)

if ($ZipPath) {
  # 显式给了 -ZipPath：优先按参数走（不静默忽略）；包已解压时也允许
  if (-not (Test-Path -LiteralPath $ZipPath)) { Die "找不到 -ZipPath 指定的压缩包：$ZipPath" }
  $zipFound = (Get-Item -LiteralPath $ZipPath).FullName
  if (-not (Test-ZipContainsTgz $zipFound)) { Die "压缩包内没有 $TgzName，可能不是本组合包：$zipFound" }
} elseif ($localOk) {
  $pkgRoot = $pkgRootGuess
  StepOk '定位压缩包' '脚本已在解压后的包内，直接使用同目录 tgz'
} else {
  $zipFound = Find-PackageZip $DshHome $pkgRootGuess
  if (-not $zipFound) {
    Die "找不到「Elisa启动动画+UI皮肤组合包.zip」。请用 -ZipPath 指定压缩包路径（用户消息里的附件路径），或先把压缩包保存到磁盘。"
  }
  if (-not (Test-ZipContainsTgz $zipFound)) { Die "压缩包内没有 $TgzName，可能不是本组合包：$zipFound" }
}

if ($zipFound) {
  if ([string]::IsNullOrEmpty($WorkDir)) {
    $WorkDir = Join-Path $env:TEMP ("elisa-pkg-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  }
  $WorkDir = [System.IO.Path]::GetFullPath($WorkDir)
  if (Test-Path -LiteralPath $WorkDir) { Remove-Item -LiteralPath $WorkDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
  $stageCreated = $WorkDir
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zipFound, $WorkDir, [System.Text.Encoding]::UTF8)
  $found = Get-ChildItem -LiteralPath $WorkDir -Recurse -File -Filter $TgzName -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $found) { Die "解压后未找到 $TgzName：$WorkDir" }
  $pkgRoot = $found.Directory.FullName
  $ManifestPath = Join-Path $pkgRoot '校验清单.sha256'
  StepOk '定位压缩包' ("已从压缩包解压到 " + $WorkDir)
}

if (-not (Test-Path -LiteralPath $ManifestPath)) { Die "缺少完整性清单 校验清单.sha256：$ManifestPath" }
$manifest = Read-Manifest $ManifestPath
if ($manifest.Count -le 0) { Die "校验清单为空或格式不正确：$ManifestPath" }
$ExpectedFiles = $manifest.Count
if ($manifest.TgzSha256) { $ExpectedTgzSha = $manifest.TgzSha256 }
if ($manifest.TgzSize -gt 0) { $ExpectedTgzSize = $manifest.TgzSize }
$tgz = Join-Path $pkgRoot $TgzName
if (-not (Test-Path -LiteralPath $tgz)) { Die "缺少安装包：$tgz" }

# ── 2) 校验 tgz + 全部文件（无损、无阉割）─────────────────────────────────
$shaShown = if ($ExpectedTgzSha) { $ExpectedTgzSha.Substring(0, 12) + '…' } else { '（清单未记录）' }
Step '校验安装包' ('SHA256 ' + $shaShown + ' / ' + $ExpectedFiles + ' 文件')
$tgzSize = (Get-Item -LiteralPath $tgz).Length
$tgzSha = Get-Sha256 $tgz
if ($ExpectedTgzSize -gt 0 -and $tgzSize -ne $ExpectedTgzSize) { Die ("tgz 大小不符：期望 " + $ExpectedTgzSize + "，实际 " + $tgzSize + "（压缩包可能不完整）") }
if ($ExpectedTgzSha -and $tgzSha -ne $ExpectedTgzSha) {
  Die ("tgz SHA256 不符：期望 " + $ExpectedTgzSha + "，实际 " + $tgzSha + "（传输损坏或被改动，请重新获取压缩包）")
}
$tar = Get-Command tar -ErrorAction SilentlyContinue | Select-Object -First 1
if ($tar) {
  $checkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("elisa-check-" + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
  New-Item -ItemType Directory -Force -Path $checkDir | Out-Null
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & tar -xzf $tgz -C $checkDir 2>&1 | Out-Null
  $tarExit = $LASTEXITCODE
  $ErrorActionPreference = $old
  if ($tarExit -ne 0) { Die "解包 tgz 失败（tar 退出码 $tarExit）" }
  $cmpTgz = Compare-DirWithManifest (Join-Path $checkDir 'package') $manifest
  if (-not $cmpTgz.Ok) {
    $detail = "缺失 " + @($cmpTgz.Missing).Count + " / 不一致 " + @($cmpTgz.Mismatch).Count + " / 多余 " + @($cmpTgz.Extra).Count
    Die ("包内容与 校验清单.sha256 不符（" + $detail + "），拒绝安装。首个不一致：" + (@($cmpTgz.Mismatch + $cmpTgz.Missing) | Select-Object -First 1))
  }
  StepOk '校验安装包' ("tgz 哈希一致；包内 " + $cmpTgz.Count + "/" + $ExpectedFiles + " 文件 SHA256 全一致（无阉割）")
} else {
  SayC "  [WARN] 未找到 tar.exe，跳过解包预检（装后仍会按清单逐文件复核）。" 'Yellow'
  StepOk '校验安装包' ("tgz 哈希一致（大小 " + $tgzSize + " B）；解包预检已跳过")
}

# ── 3) 检查 profile / CLI ────────────────────────────────────────────────
Step '检查环境' ''
$cliPath = Find-DshCli $DshCli
if (-not $cliPath) {
  Die "未找到 DSH CLI（dsh.cmd）。请用 -DshCli 指定，例如：-DshCli `"E:\dsh\resources\runtime\cli\bin\dsh.cmd`""
}
$profileExists = Test-Path -LiteralPath (Join-Path $profileDir 'package.json')
if (-not $profileExists) {
  if ($Profile -eq 'desktop') {
    Die "desktop profile 尚未初始化。请先打开一次 DSH 桌面版（进到主界面），完全退出（含托盘）后再运行本脚本。"
  } else {
    SayC ("  profile 尚未初始化，DSH CLI 将自动创建 profile '" + $Profile + "'。") 'Yellow'
  }
}
$preList = ''
if ($profileExists) { $preList = Get-CliText $cliPath @('plugin', '--profile', $Profile, 'list') }
$preJson = Read-JsonFile (Join-Path $profileDir 'package.json')
$preDeps = @()
$preBundles = @()
if ($preJson) {
  if ($preJson.dependencies) { $preDeps = @($preJson.dependencies.PSObject.Properties.Name) }
  if ($preJson.dsh -and $preJson.dsh.profile -and $preJson.dsh.profile.bundles) { $preBundles = @($preJson.dsh.profile.bundles) }
}
$preConfigSha = $null
if (Test-Path -LiteralPath $userConfig) { $preConfigSha = Get-Sha256 $userConfig }
$installedVersion = $null
if (Test-Path -LiteralPath (Join-Path $installedDir 'package.json')) {
  $ip = Read-JsonFile (Join-Path $installedDir 'package.json')
  if ($ip) { $installedVersion = [string]$ip.version }
}
$installedCmp = Compare-DirWithManifest $installedDir $manifest
$alreadyOk = ($installedVersion -eq $ExpectedVersion) -and $installedCmp.Ok -and ($preBundles -contains $PkgName)
$stateText = '未安装'
if ($installedVersion) { $stateText = '已装 ' + $installedVersion }
StepOk '检查环境' ("CLI " + $cliPath + "；profile " + $stateText)

if ($alreadyOk -and -not $Force) {
  Say ""
  SayC "已安装且完整：版本 $ExpectedVersion，$ExpectedFiles/$ExpectedFiles 文件哈希一致，profile bundles 已注册。" 'Green'
  SayC "本脚本按「无损优先」原则跳过重复安装（不折腾）。如需强制重装/修复，请加 -Force。" 'Green'
  SayC "结论: PASS（已安装且完整，未做改动）" 'Green'
  SayC "下一步: 请完全退出 DSH（含托盘图标）后重新打开。" 'Yellow'
  if ($checkDir -and (Test-Path -LiteralPath $checkDir)) { Remove-Item -LiteralPath $checkDir -Recurse -Force -ErrorAction SilentlyContinue }
  if ($stageCreated -and (Test-Path -LiteralPath $stageCreated)) { Remove-Item -LiteralPath $stageCreated -Recurse -Force -ErrorAction SilentlyContinue }
  exit 0
}

# ── 4) 备份 ──────────────────────────────────────────────────────────────
Step '备份（无损前提）' ''
$backupDir = Join-Path $DshHome ("_backups\elisa-install-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (-not $DryRun) {
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  foreach ($f in @('package.json', 'pnpm-lock.yaml', 'cordis.patch.yml')) {
    $src = Join-Path $profileDir $f
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $backupDir -Force }
  }
  if (Test-Path -LiteralPath $userConfig) { Copy-Item -LiteralPath $userConfig -Destination $backupDir -Force }
  if (Test-Path -LiteralPath $installedDir) {
    Copy-Item -LiteralPath $installedDir -Destination (Join-Path $backupDir $PkgName) -Recurse -Force
  }
  StepOk '备份（无损前提）' $backupDir
} else {
  StepOk '备份（无损前提）' ("[DryRun] 将备份到 " + $backupDir)
}

# ── 5) 暂存 + 安装 ───────────────────────────────────────────────────────
Step '安装' ("dsh plugin --profile " + $Profile + " add " + $TgzName)
$storeDir = Join-Path $DshHome '_packages'
$stagedTgz = Join-Path $storeDir $TgzName
$logFile = $null
if (-not $DryRun) {
  New-Item -ItemType Directory -Force -Path $storeDir | Out-Null
  if ((Test-Path -LiteralPath $stagedTgz) -and ((Get-Sha256 $stagedTgz) -ne $ExpectedTgzSha)) {
    $bak = $stagedTgz + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Move-Item -LiteralPath $stagedTgz -Destination $bak -Force
    SayC ("  [INFO] 暂存区已有同名但哈希不同的 tgz，已改名保留：" + $bak) 'Yellow'
  }
  if (-not (Test-Path -LiteralPath $stagedTgz)) {
    Copy-Item -LiteralPath $tgz -Destination $stagedTgz -Force
  }
  if ((Get-Sha256 $stagedTgz) -ne $ExpectedTgzSha) { Die "暂存 tgz 哈希校验失败：$stagedTgz" }
  $logFile = Join-Path $backupDir 'install.log'

  # 已装过（或 profile 里残留依赖）→ 必须先 remove 再 add：
  # pnpm 对「同版本、node_modules 已存在」会判 Already up to date，既不重装也修不好被改坏的文件。
  $preRemove = ((Test-Path -LiteralPath $installedDir) -or ($preDeps -contains $PkgName))
  if ($preRemove) {
    "=== dsh plugin --profile $Profile remove $PkgName ===" | Out-File -LiteralPath $logFile -Encoding UTF8 -Append
    $rmExit = Invoke-DshCli $cliPath @('plugin', '--profile', $Profile, 'remove', $PkgName) $logFile
    if ($rmExit -ne 0) {
      SayC ("  [WARN] 预卸载返回退出码 " + $rmExit + "，继续尝试安装（若验收失败请看日志）") 'Yellow'
    } else {
      SayC "  已预卸载旧版本（保证本次是真正重装，而不是 pnpm 的 Already up to date）" 'Gray'
    }
  }
  "=== dsh plugin --profile $Profile add $stagedTgz ===" | Out-File -LiteralPath $logFile -Encoding UTF8 -Append
  $exitCode = Invoke-DshCli $cliPath @('plugin', '--profile', $Profile, 'add', $stagedTgz) $logFile
  Say ""
  if (Test-Path -LiteralPath $logFile) { Get-Content -LiteralPath $logFile -Tail 12 -Encoding UTF8 | ForEach-Object { Say ('  | ' + $_) } }
  if ($exitCode -ne 0) {
    SayC ("  [ERR] dsh plugin add 退出码 " + $exitCode + "，日志：" + $logFile) 'Red'
    # 回滚三件配置文件（不含 node_modules；重新运行本脚本即可恢复）
    if ($backupDir) {
      foreach ($f in @('package.json', 'pnpm-lock.yaml', 'cordis.patch.yml')) {
        $src = Join-Path $backupDir $f
        if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $profileDir -Force }
      }
      SayC "  已把 profile 的 package.json / pnpm-lock.yaml / cordis.patch.yml 还原到安装前状态。" 'Yellow'
    }
    Die "安装失败，详见上方日志；重试前可加 -Force。"
  }
  $installNote = '安装命令执行完成（退出码 0）'
  if ($preRemove) { $installNote = '已预卸载旧版本 + 重新安装（退出码 0）' }
  StepOk '安装' ("dsh-startup-elisa " + $installNote)
} else {
  StepOk '安装' ("[DryRun] 将暂存到 " + $stagedTgz + "；已装则先 remove 再 add")
  Say ""
  SayC "结论: DRYRUN（仅检查，未做任何改动）" 'Yellow'
  SayC ("将安装到: " + $installedDir) 'Gray'
  SayC ("将备份到: " + $backupDir) 'Gray'
  SayC ("将暂存到: " + $stagedTgz) 'Gray'
  if ($checkDir -and (Test-Path -LiteralPath $checkDir)) { Remove-Item -LiteralPath $checkDir -Recurse -Force -ErrorAction SilentlyContinue }
  if ($stageCreated -and (Test-Path -LiteralPath $stageCreated)) { Remove-Item -LiteralPath $stageCreated -Recurse -Force -ErrorAction SilentlyContinue }
  exit 0
}

# ── 6) 验收 ──────────────────────────────────────────────────────────────
Step '验收' '6 项'
Say ""
$postJson = Read-JsonFile (Join-Path $profileDir 'package.json')
$postDeps = @(); $postBundles = @()
if ($postJson) {
  if ($postJson.dependencies) { $postDeps = @($postJson.dependencies.PSObject.Properties.Name) }
  if ($postJson.dsh -and $postJson.dsh.profile -and $postJson.dsh.profile.bundles) { $postBundles = @($postJson.dsh.profile.bundles) }
}
$postVersion = $null
if (Test-Path -LiteralPath (Join-Path $installedDir 'package.json')) {
  $ip2 = Read-JsonFile (Join-Path $installedDir 'package.json')
  if ($ip2) { $postVersion = [string]$ip2.version }
}
$postCmp = Compare-DirWithManifest $installedDir $manifest
$postConfigSha = $null
if (Test-Path -LiteralPath $userConfig) { $postConfigSha = Get-Sha256 $userConfig }

# 1 版本
if ($postVersion -eq $ExpectedVersion) { Add-Pass ("版本 " + $postVersion) }
else { Add-Failure ("版本不符：期望 " + $ExpectedVersion + "，实际 " + $postVersion) }

# 2 文件完整
if ($postCmp.Ok) { Add-Pass ("文件完整 " + $postCmp.Count + "/" + $ExpectedFiles + "（SHA256 全一致，无缺失/无多余）") }
else {
  Add-Failure ("文件完整性：缺失 " + @($postCmp.Missing).Count + " / 不一致 " + @($postCmp.Mismatch).Count + " / 多余 " + @($postCmp.Extra).Count)
  foreach ($x in (@($postCmp.Missing) + @($postCmp.Mismatch) + @($postCmp.Extra) | Select-Object -First 5)) { Say ('         ' + $x) }
}

# 3 plugin list
$postList = Get-CliText $cliPath @('plugin', '--profile', $Profile, 'list')
if ($postList -match ('dsh-startup-elisa@' + [regex]::Escape($ExpectedVersion))) { Add-Pass ("plugin list 含 dsh-startup-elisa@" + $ExpectedVersion) }
else { Add-Failure "plugin list 未显示 dsh-startup-elisa@$ExpectedVersion" }

# 4 bundles
if ($postBundles -contains $PkgName) { Add-Pass "profile dsh.profile.bundles 含 dsh-startup-elisa" }
else { Add-Failure "profile dsh.profile.bundles 未含 dsh-startup-elisa" }

# 5 用户配置未改动
if ($preConfigSha -eq $postConfigSha) { Add-Pass "用户配置 dsh-startup-elisa.json 未改动" }
else { Add-Failure ("用户配置被改动：安装前 " + $preConfigSha + " → 安装后 " + $postConfigSha) }

# 6 其它依赖未变
$preOther = @($preDeps | Where-Object { $_ -ne $PkgName } | Sort-Object)
$postOther = @($postDeps | Where-Object { $_ -ne $PkgName } | Sort-Object)
$otherChanged = (($preOther -join '|') -ne ($postOther -join '|'))
if (-not $otherChanged) {
  $otherText = (($postOther | ForEach-Object { $_ }) -join ', ')
  if ([string]::IsNullOrEmpty($otherText)) { $otherText = '无其它依赖' }
  Add-Pass ("其它依赖未变化（" + $otherText + "）")
}
else { Add-Failure ("其它依赖发生变化：" + (($preOther -join ', ') + " → " + ($postOther -join ', '))) }

# 汇总
$passCount = 6 - $failures.Count
$result = [pscustomobject]@{
  ok = ($failures.Count -eq 0)
  version = $postVersion
  files = $postCmp.Count
  expected_files = $ExpectedFiles
  tgz_sha256 = $tgzSha
  backup_dir = $backupDir
  staged_tgz = $stagedTgz
  profile = $Profile
  dsh_home = $DshHome
  installed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  failures = @($failures)
}
if (-not $DryRun -and $backupDir) {
  try {
    ($result | ConvertTo-Json -Depth 5) | Out-File -LiteralPath (Join-Path $backupDir 'install-result.json') -Encoding UTF8 -Force
    if ($logFile -and (Test-Path -LiteralPath $logFile)) { Copy-Item -LiteralPath $logFile -Destination $backupDir -Force -ErrorAction SilentlyContinue }
  } catch { }
}
Say ""
SayC "================================================================" 'Cyan'
if ($failures.Count -eq 0) {
  SayC ("结论: PASS（验收 " + $passCount + "/6）") 'Green'
  SayC ("安装目录: " + $installedDir) 'Gray'
  if ($backupDir) { SayC ("备份目录: " + $backupDir) 'Gray' }
  SayC ("暂存 tgz: " + $stagedTgz) 'Gray'
  SayC "----------------------------------------------------------------" 'Cyan'
  SayC "下一步（必须告诉用户）：" 'Yellow'
  SayC "  1) 完全退出 DSH（包括托盘图标），再重新打开。" 'Yellow'
  SayC "  2) 重开后：播放 ELISA 启动动画；主界面为毛玻璃皮肤（呼吸背景 + 输入框整圈流动光边框）。" 'Yellow'
  SayC "  3) 设置入口：设置 →「ELISA 启动动画」。" 'Yellow'
  SayC ("回滚: & `"" + $cliPath + "`" plugin --profile " + $Profile + " remove " + $PkgName) 'Gray'
} else {
  SayC ("结论: FAIL（验收 " + $passCount + "/6）") 'Red'
  SayC ("备份目录: " + $backupDir) 'Gray'
}
SayC "================================================================" 'Cyan'

if ($checkDir -and (Test-Path -LiteralPath $checkDir)) { Remove-Item -LiteralPath $checkDir -Recurse -Force -ErrorAction SilentlyContinue }
if ($stageCreated -and (Test-Path -LiteralPath $stageCreated)) { Remove-Item -LiteralPath $stageCreated -Recurse -Force -ErrorAction SilentlyContinue }

if ($failures.Count -ne 0) { exit 1 }
exit 0
