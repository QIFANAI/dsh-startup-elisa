#!/usr/bin/env node
/**
 * 下载指定 GitHub Release，校验 SHA-256/512，再交给 dsh 安装。
 * 不执行远程脚本；Node 20+ 自带 fetch。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const REPO = 'QIFANAI/dsh-startup-elisa'
const NAME = 'dsh-startup-elisa'

function usage () {
  console.log(`用法: node scripts/install.mjs [选项]
  --profile desktop|web   目标 profile（默认 desktop）
  --version latest|0.6.0  指定版本（默认 latest）
  --tgz <路径>            安装本地 tgz（需 --sha256 或 --allow-unverified）
  --sha256 <哈希>         本地 tgz 的 SHA-256
  --allow-unverified      允许安装未校验的本地 tgz
  --dsh <路径>            指定 dsh 可执行文件
  --dry-run               只下载并校验，不安装
  --cache <目录>          下载缓存目录（默认 ~/.dsh/cache/dsh-startup-elisa）
  --keep                  额外复制一份 tgz 到当前目录
  --remove                卸载插件
  --help                  显示本帮助`)
}

function parseArgs (argv) {
  const out = { profile: 'desktop', version: 'latest' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--profile') out.profile = argv[++i]
    else if (arg === '--version') out.version = argv[++i]
    else if (arg === '--tgz') out.tgz = argv[++i]
    else if (arg === '--sha256') out.sha256 = argv[++i]
    else if (arg === '--allow-unverified') out.allowUnverified = true
    else if (arg === '--dsh') out.dsh = argv[++i]
    else if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--cache') out.cache = argv[++i]
    else if (arg === '--keep') out.keep = true
    else if (arg === '--remove') out.remove = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else throw new Error('未知参数: ' + arg)
  }
  if (!['desktop', 'web'].includes(out.profile)) throw new Error('--profile 只能是 desktop 或 web')
  return out
}

function normalizeVersion (value) {
  if (!value || value === 'latest') return 'latest'
  return value.replace(/^v/, '')
}

async function getJson (url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': NAME + '-installer',
    },
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`请求失败 ${response.status}: ${url}`)
  return response.json()
}

async function getText (url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': NAME + '-installer' },
    signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) throw new Error(`下载失败 ${response.status}: ${url}`)
  return response.text()
}

async function download (url, file) {
  const response = await fetch(url, {
    headers: { 'User-Agent': NAME + '-installer' },
    signal: AbortSignal.timeout(180000),
  })
  if (!response.ok || !response.body) throw new Error(`下载失败 ${response.status}: ${url}`)
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file))
}

function hashFile (file, algorithm) {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex')
}

function parseChecksums (text) {
  const map = new Map()
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64,128})\s+\*?(.+)$/i)
    if (match) map.set(match[2].trim(), match[1].toLowerCase())
  }
  return map
}

function findDsh (explicit) {
  if (explicit) return explicit
  if (process.env.DSH_BIN) return process.env.DSH_BIN
  const finder = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    const output = execFileSync(finder, ['dsh'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    if (first) return first
  } catch {}
  throw new Error('找不到 dsh 命令。请把 DSH 的 bin 目录加入 PATH，或用 --dsh <路径> 指定。')
}

function runDsh (dsh, args) {
  const isCmd = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(dsh)
  const result = spawnSync(dsh, args, {
    stdio: 'inherit',
    shell: isCmd,
    windowsHide: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`dsh 退出码 ${result.status}`)
}

function installLocal (opts) {
  const file = path.resolve(opts.tgz)
  if (!fs.existsSync(file)) throw new Error('tgz 不存在: ' + file)
  const actual = hashFile(file, 'sha256')
  if (opts.sha256) {
    if (actual !== opts.sha256.toLowerCase()) {
      throw new Error(`SHA-256 不一致\n  期望 ${opts.sha256.toLowerCase()}\n  实际 ${actual}`)
    }
  } else if (!opts.allowUnverified) {
    throw new Error('本地包未校验；请传 --sha256 <哈希>，或明确使用 --allow-unverified')
  }
  console.log(`[OK] 本地包校验通过 (${actual})`)
  if (opts.dryRun) return
  const dsh = findDsh(opts.dsh)
  console.log('[..] 正在调用 dsh plugin ...')
  runDsh(dsh, ['plugin', '--profile', opts.profile, 'add', file])
  console.log('[OK] 安装完成；请完全重启 DeepSeek Harness。')
}

async function installRemote (opts) {
  const version = normalizeVersion(opts.version)
  const url = version === 'latest'
    ? `https://api.github.com/repos/${REPO}/releases/latest`
    : `https://api.github.com/repos/${REPO}/releases/tags/v${version}`
  const release = await getJson(url)
  const assets = release.assets || []
  const asset = assets.find((entry) => entry.name.endsWith('.tgz') && !entry.name.includes('-full'))
  if (!asset) throw new Error('该 Release 没有 tgz 资产')
  const manifestAsset = assets.find((entry) => entry.name === 'release.json')
  const sumsAsset = assets.find((entry) => entry.name === 'SHA256SUMS')

  let manifest = null
  if (manifestAsset) {
    manifest = JSON.parse(await getText(manifestAsset.browser_download_url))
    if (manifest.asset !== asset.name) throw new Error('release.json 与 Release 资产不一致')
    if (manifest.mediaIncluded !== false) {
      console.warn('[!] 该 Release 声明包含本地素材；请确认你有权使用')
    }
  }
  let sums = null
  if (sumsAsset) sums = parseChecksums(await getText(sumsAsset.browser_download_url))

  const expected = manifest?.sha256 || sums?.get(asset.name) ||
    (asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null)
  if (!expected) throw new Error('Release 未提供可校验的 SHA-256')
  if (manifest?.sha256 && sums?.get(asset.name) && manifest.sha256 !== sums.get(asset.name)) {
    throw new Error('release.json 与 SHA256SUMS 不一致')
  }

  const cacheDir = opts.cache
    ? path.resolve(opts.cache)
    : path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'cache', NAME)
  fs.mkdirSync(cacheDir, { recursive: true })
  const file = path.join(cacheDir, asset.name)
  const part = file + '.part'
  try {
    console.log(`[..] 下载 ${asset.name} (${release.tag_name || version})`)
    await download(asset.browser_download_url, part)
    const size = fs.statSync(part).size
    const actual = hashFile(part, 'sha256')
    if (actual !== expected.toLowerCase()) {
      throw new Error(`SHA-256 不一致\n  期望 ${expected.toLowerCase()}\n  实际 ${actual}`)
    }
    if (manifest?.size && manifest.size !== size) {
      throw new Error(`文件大小不一致：期望 ${manifest.size}，实际 ${size}`)
    }
    fs.rmSync(file, { force: true })
    fs.renameSync(part, file)
    console.log(`[OK] SHA-256 ${actual}`)
    console.log(`     文件 ${size} B`)
    console.log(`     缓存 ${file}`)
    if (opts.dryRun) {
      console.log('[OK] dry-run：只校验，不安装')
      return
    }
    const dsh = findDsh(opts.dsh)
    console.log('[..] 正在调用 dsh plugin ...')
    runDsh(dsh, ['plugin', '--profile', opts.profile, 'add', file])
    console.log('[OK] 安装完成；请完全重启 DeepSeek Harness。')
    if (opts.keep) {
      const keep = path.join(process.cwd(), asset.name)
      fs.copyFileSync(file, keep)
      console.log('     已复制 ' + keep)
    }
  } finally {
    fs.rmSync(part, { force: true })
  }
}

async function main () {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) return usage()
  if (opts.remove) {
    const dsh = findDsh(opts.dsh)
    runDsh(dsh, ['plugin', '--profile', opts.profile, 'remove', NAME])
    console.log('[OK] 已卸载；配置 ~/.dsh/' + NAME + '.json 可留可删。')
    return
  }
  if (opts.tgz) return installLocal(opts)
  await installRemote(opts)
}

main().catch((error) => {
  console.error('[X] ' + error.message)
  process.exit(1)
})
