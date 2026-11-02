# ============================================================================
#  dsh-startup-elisa 0.6.0 —— 安装完整性核验器（「Elisa启动动画+UI皮肤组合包」内）
#
#  用法：
#    powershell -NoProfile -ExecutionPolicy Bypass -File verify-elisa.ps1
#    powershell -NoProfile -ExecutionPolicy Bypass -File verify-elisa.ps1 -DshHome "%USERPROFILE%\.dsh" -Profile desktop
#    powershell -NoProfile -ExecutionPolicy Bypass -File verify-elisa.ps1 -Json
#
#  只读：不修改任何文件。退出码 0 = PASS，1 = FAIL，2 = 前置条件不满足。
#  核验口径：版本 0.6.0 / 包内全部文件 SHA256 与 校验清单.sha256 逐一一致 / profile bundles 含插件。
# ============================================================================
[CmdletBinding()]
param(
  [string]$DshHome,
  [string]$Profile = 'desktop',
  [string]$ManifestPath,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$PkgName         = 'dsh-startup-elisa'
$ExpectedVersion = '0.6.0'
$ExpectedFiles   = 0

function Die2([string]$msg, [int]$code = 2) {
  if (-not $Json) { Write-Host ("结论: FAIL — " + $msg) -ForegroundColor Red }
  exit $code
}
function Get-Sha256([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function Get-RelPath([string]$base, [string]$full) {
  return ($full.Substring($base.Length)).TrimStart('\', '/').Replace('\', '/')
}
function Read-JsonFile([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) { return $null }
  $raw = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return ($raw | ConvertFrom-Json)
}
function Read-Manifest([string]$path) {
  $files = @{}
  foreach ($line in [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::UTF8)) {
    $t = $line.Trim()
    if ($t.Length -eq 0 -or $t.StartsWith('#')) { continue }
    $parts = $t -split '\s+', 2
    if ($parts.Count -lt 2) { continue }
    $h = $parts[0].ToLowerInvariant()
    $f = $parts[1].Trim().TrimStart('*').Trim().Replace('\', '/')
    if ($f.StartsWith('./')) { $f = $f.Substring(2) }
    if ($f.Length -gt 0) { $files[$f] = $h }
  }
  return [pscustomobject]@{ Files = $files; Count = $files.Count }
}

if ([string]::IsNullOrEmpty($DshHome)) {
  if ($env:DSH_HOME) { $DshHome = $env:DSH_HOME } else { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
}
$DshHome = [System.IO.Path]::GetFullPath($DshHome)
$profileDir = Join-Path $DshHome ("profiles\" + $Profile)
$installedDir = Join-Path $profileDir ("node_modules\" + $PkgName)

if ([string]::IsNullOrEmpty($ManifestPath)) {
  $ManifestPath = Join-Path (Split-Path $PSScriptRoot -Parent) '校验清单.sha256'
}
if (-not (Test-Path -LiteralPath $ManifestPath)) {
  Die2 "找不到 校验清单.sha256：$ManifestPath（请用 -ManifestPath 指定）"
}
$manifest = Read-Manifest $ManifestPath
if ($manifest.Count -le 0) { Die2 "校验清单为空或格式不正确：$ManifestPath" }
$ExpectedFiles = $manifest.Count

$checks = New-Object System.Collections.ArrayList
function Add-Check([string]$name, [bool]$ok, [string]$detail) {
  [void]$checks.Add([pscustomobject]@{ name = $name; ok = $ok; detail = $detail })
}

# 1) 安装目录 + 版本
$version = $null
if (Test-Path -LiteralPath (Join-Path $installedDir 'package.json')) {
  $ip = Read-JsonFile (Join-Path $installedDir 'package.json')
  if ($ip) { $version = [string]$ip.version }
}
Add-Check '安装目录存在' (Test-Path -LiteralPath $installedDir) $installedDir
Add-Check '版本' ($version -eq $ExpectedVersion) ("期望 " + $ExpectedVersion + "，实际 " + $version)

# 2) 全部文件哈希
$missing = New-Object System.Collections.ArrayList
$mismatch = New-Object System.Collections.ArrayList
$extra = New-Object System.Collections.ArrayList
$count = 0
if (Test-Path -LiteralPath $installedDir) {
  $actual = @{}
  foreach ($fi in (Get-ChildItem -LiteralPath $installedDir -Recurse -File -Force -ErrorAction Stop)) {
    $actual[(Get-RelPath $installedDir $fi.FullName)] = (Get-Sha256 $fi.FullName)
  }
  $count = $actual.Count
  foreach ($k in $manifest.Files.Keys) {
    if (-not $actual.ContainsKey($k)) { [void]$missing.Add($k) }
    elseif ($actual[$k] -ne $manifest.Files[$k]) { [void]$mismatch.Add($k) }
  }
  foreach ($k in $actual.Keys) { if (-not $manifest.Files.ContainsKey($k)) { [void]$extra.Add($k) } }
}
$filesOk = ($missing.Count -eq 0 -and $mismatch.Count -eq 0 -and $extra.Count -eq 0 -and $count -eq $ExpectedFiles)
Add-Check '文件完整性' $filesOk ("实际 " + $count + "/" + $ExpectedFiles + "；缺失 " + $missing.Count + " / 不一致 " + $mismatch.Count + " / 多余 " + $extra.Count)

# 3) profile bundles
$bundles = @()
$pj = Read-JsonFile (Join-Path $profileDir 'package.json')
if ($pj -and $pj.dsh -and $pj.dsh.profile -and $pj.dsh.profile.bundles) { $bundles = @($pj.dsh.profile.bundles) }
Add-Check 'profile bundles' ($bundles -contains $PkgName) ("bundles 含 " + $PkgName + "：" + ($bundles -contains $PkgName))

$okAll = (@($checks | Where-Object { -not $_.ok }).Count -eq 0)

if ($Json) {
  $out = [pscustomobject]@{
    ok = $okAll
    version = $version
    installed_dir = $installedDir
    files = $count
    expected_files = $ExpectedFiles
    missing = @($missing)
    mismatch = @($mismatch)
    extra = @($extra)
    checks = @($checks)
  }
  ($out | ConvertTo-Json -Depth 6)
} else {
  Write-Host "================================================================" -ForegroundColor Cyan
  Write-Host (" dsh-startup-elisa 0.6.0 安装核验  [" + $Profile + "]  " + $installedDir) -ForegroundColor Cyan
  Write-Host "================================================================" -ForegroundColor Cyan
  foreach ($c in $checks) {
    if ($c.ok) { Write-Host ("  [PASS] " + $c.name + " — " + $c.detail) -ForegroundColor Green }
    else { Write-Host ("  [FAIL] " + $c.name + " — " + $c.detail) -ForegroundColor Red }
  }
  foreach ($x in @($missing + $mismatch + $extra | Select-Object -First 10)) { Write-Host ("         缺失/异常文件: " + $x) -ForegroundColor Yellow }
  Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
  if ($okAll) { Write-Host ("结论: PASS（" + @($checks).Count + "/" + @($checks).Count + "）") -ForegroundColor Green }
  else { Write-Host ("结论: FAIL（" + (@($checks | Where-Object { $_.ok }).Count) + "/" + @($checks).Count + "）") -ForegroundColor Red }
  Write-Host "================================================================" -ForegroundColor Cyan
}

if ($okAll) { exit 0 } else { exit 1 }
