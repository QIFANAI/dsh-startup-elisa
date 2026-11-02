# ============================================================================
#  构建「Elisa启动动画+UI皮肤组合包」对话安装包（v0.6.0）
#
#  输入：releases\dsh-startup-elisa-<ver>.tgz（不得改动，唯一发布产物）
#        combo\ 下的源文件（00/01 说明 + tools\*.ps1）
#  输出：<项目根>\Elisa启动动画+UI皮肤组合包.zip
#
#  工序：读取 tgz 哈希（可选用 -ExpectedSha256 对照发布页）→ 组装暂存目录
#        → 由 tgz 生成 校验清单.sha256 → 统一 .ps1 为 UTF-8 with BOM
#        → 7z 打包（-mcu=on 强制 UTF-8 文件名；无 7z 时回落 .NET ZipFile）
#        → 复核 zip 结构/条目/tgz 哈希
#
#  用法：
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-combo-package.ps1
#    powershell ... -File scripts\make-combo-package.ps1 -Version 0.6.0
#    powershell ... -File scripts\make-combo-package.ps1 -ExpectedSha256 <发布页记录的SHA256>
#    powershell ... -File scripts\make-combo-package.ps1 -OutFile D:\tmp\test.zip
#  退出码：0 = OK；非 0 = 失败
# ============================================================================
[CmdletBinding()]
param(
  [string]$Version = '0.6.0',
  [string]$OutFile,
  [string]$WorkRoot,
  [string]$ExpectedSha256,
  [switch]$KeepStage
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
Add-Type -AssemblyName System.IO.Compression.FileSystem

$PkgFolderName = 'Elisa启动动画+UI皮肤组合包'
$TgzName = "dsh-startup-elisa-$Version.tgz"

# 完整性基线由输入 tgz 自身计算；如需外部锚点，用 -ExpectedSha256 传入发布页记录值
$Base = [pscustomobject]@{ Sha256 = $null; Size = 0; Files = 0 }

$Root = Split-Path $PSScriptRoot -Parent
$Tgz = Join-Path $Root ("releases\" + $TgzName)
$Combo = Join-Path $Root 'combo'
if ([string]::IsNullOrEmpty($OutFile)) { $OutFile = Join-Path $Root ($PkgFolderName + '.zip') }
if ([string]::IsNullOrEmpty($WorkRoot)) { $WorkRoot = Join-Path $Root '_work\pkg' }
$Stage = Join-Path $WorkRoot $PkgFolderName

function Get-Sha256([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function Get-RelPath([string]$base, [string]$full) {
  return ($full.Substring($base.Length)).TrimStart('\', '/').Replace('\', '/')
}
# GNU tar 会把 "E:\..." 当成远程主机；--force-local 关闭该语义（bsdtar 不需要也不支持）
function Invoke-TarExtract([string]$archive, [string]$destination) {
  $tarVersion = (& tar --version 2>&1 | Select-Object -First 1)
  $arch = $archive.Replace('\', '/')
  $dest = $destination.Replace('\', '/')
  $tarArgs = @('-xzf', $arch, '-C', $dest)
  if ("$tarVersion" -match 'GNU tar') { $tarArgs = @('--force-local') + $tarArgs }
  & tar @tarArgs
}

# ── 1) 读取发布 tgz 基线 ───────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $Tgz)) { throw "缺少发布包：$Tgz（先运行 npm run build）" }
$tgzSize = (Get-Item -LiteralPath $Tgz).Length
$tgzSha = Get-Sha256 $Tgz
$Base.Sha256 = $tgzSha
$Base.Size = $tgzSize
if ($ExpectedSha256 -and $ExpectedSha256.ToLowerInvariant() -ne $tgzSha) {
  throw "tgz SHA256 与 -ExpectedSha256 不符：期望 $($ExpectedSha256.ToLowerInvariant())，实际 $tgzSha"
}
Write-Host "[1/6] 发布 tgz 读取 OK  $tgzSha  ($tgzSize B)" -ForegroundColor Green

# ── 2) 组装暂存目录 ────────────────────────────────────────────────────────
if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $Stage 'tools') | Out-Null
Copy-Item -LiteralPath $Tgz -Destination (Join-Path $Stage $TgzName) -Force
foreach ($f in @('00-给DSH的安装说明.md', '01-使用说明与排错.md')) {
  $src = Join-Path $Combo $f
  if (-not (Test-Path -LiteralPath $src)) { throw "缺少 combo 源文件：$src" }
  Copy-Item -LiteralPath $src -Destination (Join-Path $Stage $f) -Force
}
foreach ($f in @('install-elisa.ps1', 'verify-elisa.ps1')) {
  $src = Join-Path $Combo ("tools\" + $f)
  if (-not (Test-Path -LiteralPath $src)) { throw "缺少 combo 源文件：$src" }
  Copy-Item -LiteralPath $src -Destination (Join-Path $Stage ("tools\" + $f)) -Force
}
Write-Host "[2/6] 暂存目录组装 OK  $Stage" -ForegroundColor Green

# ── 3) 解出 tgz 并生成 校验清单.sha256 ─────────────────────────────────────
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("elisa-combo-" + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  Invoke-TarExtract $Tgz $tmp
  if ($LASTEXITCODE -ne 0) { throw "解包 tgz 失败（tar 退出码 $LASTEXITCODE）" }
  $pkgDir = Join-Path $tmp 'package'
  $files = Get-ChildItem -LiteralPath $pkgDir -Recurse -File | ForEach-Object {
    [pscustomobject]@{ rel = (Get-RelPath $pkgDir $_.FullName); hash = (Get-Sha256 $_.FullName) }
  }
  $files = @($files | Sort-Object -Property rel)
  $Base.Files = @($files).Count
  if ($Base.Files -le 0) { throw "tgz 内没有文件" }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("# dsh-startup-elisa $Version 完整性清单（包内 $($Base.Files) 个文件的 SHA256，路径相对包根）")
  [void]$sb.AppendLine("# tgz_sha256=$($Base.Sha256)")
  [void]$sb.AppendLine("# tgz_size=$($Base.Size)")
  [void]$sb.AppendLine("# file_count=$($Base.Files)")
  foreach ($f in $files) { [void]$sb.AppendLine($f.hash + '  ' + $f.rel) }
  $manifestPath = Join-Path $Stage '校验清单.sha256'
  [System.IO.File]::WriteAllText($manifestPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "[3/6] 生成 校验清单.sha256 OK  $($Base.Files) 条" -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ── 4) 统一 .ps1 为 UTF-8 with BOM（PowerShell 5.1 读中文必需）────────────
$enc = New-Object System.Text.UTF8Encoding($true)
foreach ($f in (Get-ChildItem -LiteralPath (Join-Path $Stage 'tools') -Filter '*.ps1' -File)) {
  $text = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
  if ($text.Length -gt 0 -and [int]$text[0] -eq 0xFEFF) { $text = $text.Substring(1) }
  [System.IO.File]::WriteAllText($f.FullName, $text, $enc)
}
Write-Host "[4/6] .ps1 统一为 UTF-8 BOM OK" -ForegroundColor Green

# ── 5) 打包 zip（UTF-8 文件名）────────────────────────────────────────────
if (Test-Path -LiteralPath $OutFile) { Remove-Item -LiteralPath $OutFile -Force }
$sevenCandidates = @(
  (Join-Path ${env:ProgramFiles} '7-Zip\7z.exe'),
  (Join-Path ${env:ProgramFiles(x86)} '7-Zip\7z.exe'),
  'C:\Program Files\7-Zip\7z.exe'
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$seven = @($sevenCandidates | Select-Object -First 1)
Push-Location $WorkRoot
try {
  if ($seven.Count -gt 0) {
    & $seven[0] a -tzip -mx=5 -mcu=on -y $OutFile ('.' + [System.IO.Path]::DirectorySeparatorChar + $PkgFolderName) | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "7z 打包失败（退出码 $LASTEXITCODE）" }
    $tool = '7z'
  } else {
    # 无 7z 时的兜底：把暂存目录挪进只含它的临时父目录，用 .NET 打包（UTF-8 条目名）
    $zipEnc = New-Object System.Text.UTF8Encoding($false)
    $zipRoot = Join-Path $WorkRoot ('_ziproot-' + (Get-Date -Format 'yyyyMMddHHmmssfff'))
    New-Item -ItemType Directory -Force -Path $zipRoot | Out-Null
    $moved = Join-Path $zipRoot $PkgFolderName
    Move-Item -LiteralPath $Stage -Destination $moved -Force
    try {
      [System.IO.Compression.ZipFile]::CreateFromDirectory($zipRoot, $OutFile, [System.IO.Compression.CompressionLevel]::Optimal, $true, $zipEnc)
    } finally {
      if (Test-Path -LiteralPath $moved) { Move-Item -LiteralPath $moved -Destination $Stage -Force }
      Remove-Item -LiteralPath $zipRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    $tool = '.NET'
  }
} finally { Pop-Location }
Write-Host "[5/6] 打包 OK  $OutFile  ($tool)" -ForegroundColor Green

# ── 6) 复核 zip 结构 ───────────────────────────────────────────────────────
$zip = [System.IO.Compression.ZipFile]::OpenRead($OutFile)
try {
  $names = @($zip.Entries | ForEach-Object { $_.FullName })
  $expect = @(
    "$PkgFolderName/",
    "$PkgFolderName/00-给DSH的安装说明.md",
    "$PkgFolderName/01-使用说明与排错.md",
    "$PkgFolderName/$TgzName",
    "$PkgFolderName/tools/",
    "$PkgFolderName/tools/install-elisa.ps1",
    "$PkgFolderName/tools/verify-elisa.ps1",
    "$PkgFolderName/校验清单.sha256"
  )
  foreach ($e in $expect) { if ($names -notcontains $e) { throw "zip 缺少条目：$e" } }
  $extra = @($names | Where-Object { $expect -notcontains $_ })
  if ($extra.Count -gt 0) { throw ("zip 存在多余条目：" + ($extra -join ', ')) }
  $tgzEntry = $zip.GetEntry("$PkgFolderName/$TgzName")
  if (-not $tgzEntry) { throw '找不到内嵌 tgz' }
  $tmpHashFile = Join-Path ([System.IO.Path]::GetTempPath()) ("elisa-combo-check-" + (Get-Date -Format 'yyyyMMddHHmmssfff') + '.tgz')
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($tgzEntry, $tmpHashFile, $true)
  try {
    $innerSha = Get-Sha256 $tmpHashFile
    if ($innerSha -ne $Base.Sha256) { throw "zip 内 tgz 哈希不符：$innerSha" }
  } finally { Remove-Item -LiteralPath $tmpHashFile -Force -ErrorAction SilentlyContinue }
} finally { $zip.Dispose() }
$zipItem = Get-Item -LiteralPath $OutFile
Write-Host "[6/6] zip 复核 OK  条目 8 / 内嵌 tgz 哈希一致" -ForegroundColor Green
Write-Host ''
Write-Host ('产物: ' + $zipItem.FullName) -ForegroundColor Cyan
Write-Host ('大小: ' + $zipItem.Length + ' B') -ForegroundColor Cyan
Write-Host ('SHA256: ' + (Get-Sha256 $OutFile)) -ForegroundColor Cyan
if (-not $KeepStage) {
  Write-Host '暂存目录保留（供抽查）；如需清理请手工删除：' -ForegroundColor DarkGray
  Write-Host $Stage -ForegroundColor DarkGray
}
exit 0
