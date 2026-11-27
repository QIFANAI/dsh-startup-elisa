#!/usr/bin/env node
/**
 * 构建可复现的发布包。
 *
 * 自 0.6.1 起仓库本身包含完整人物素材（16 个文件），source 模式复制 git 已跟踪文件
 * 即为完整版，公开 Release 与仓库逐字节一致；full 模式保留作兼容，从工作区 files
 * 白名单重建 -full 包。
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const VERSION = PKG.version
const NAME = PKG.name
const REPO = 'QIFANAI/dsh-startup-elisa'
const FIXED_TIME = new Date('1985-10-26T08:15:00.000Z')
const MEDIA_FILES = [
  'lib/assets/hero-loop.mp4',
  'lib/assets/hero-poster.webp',
  'lib/assets/archive-poster.webp',
  'lib/assets/layers/feather_1.webp',
  'lib/assets/layers/feather_2.webp',
  'lib/assets/layers/guide_1.webp',
  'lib/assets/layers/guide_2.webp',
  'lib/assets/layers/guide_3.webp',
  'lib/assets/layers/halo.webp',
  'lib/assets/layers/spiral_1.webp',
  'lib/assets/layers/spiral_2.webp',
  'lib/assets/layers/spiral_line.webp',
  'lib/assets/layers/star.webp',
  'lib/assets/layers/sword_flare.webp',
  'lib/assets/layers/wing_1.webp',
  'lib/assets/layers/wing_2.webp',
]

function parseArgs (argv) {
  const out = { mode: 'source', writeManifest: false, verifyManifest: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--mode') out.mode = argv[++i]
    else if (arg === '--write-manifest') out.writeManifest = true
    else if (arg === '--verify-manifest') out.verifyManifest = true
    else if (arg === '--json') out.json = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else throw new Error('未知参数: ' + arg)
  }
  if (!['source', 'full'].includes(out.mode)) throw new Error('--mode 只能是 source 或 full')
  return out
}

function npmInvocation () {
  if (process.env.npm_execpath) {
    return { command: process.execPath, prefix: [process.env.npm_execpath] }
  }
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    prefix: [],
  }
}

function runNpm (args, cwd) {
  const { command, prefix } = npmInvocation()
  return execFileSync(command, [...prefix, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command),
  })
}

function trackedFiles () {
  const raw = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return raw.toString('utf8').split('\0').filter(Boolean)
}

/**
 * source 模式复制 git 已跟踪文件，并把文本行尾统一成 LF（与 git blob 一致）：
 * 自 0.6.1 起素材已入库，source 包必须包含全部人物素材；Windows 本地构建与
 * Linux CI 的产物保持一致。
 */
function exportHead (stage) {
  const files = trackedFiles()
  if (files.length === 0) {
    throw new Error('git 里还没有跟踪文件；先 git add / commit，再构建 source 包')
  }
  const binary = /\.(?:png|jpe?g|webp|gif|wav|mp3|mp4|webm|woff2?|zip|tgz)$/i
  for (const rel of files) {
    const src = path.join(ROOT, rel)
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue
    const dst = path.join(stage, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    const raw = fs.readFileSync(src)
    const out = binary.test(rel) || raw.includes(0)
      ? raw
      : Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
    fs.writeFileSync(dst, out)
    fs.utimesSync(dst, FIXED_TIME, FIXED_TIME)
  }
  if (!fs.existsSync(path.join(stage, 'package.json'))) {
    throw new Error('git 里没有 package.json；先提交仓库再构建')
  }
}

function packageFilesFromDryRun () {
  const output = runNpm(['pack', '--dry-run', '--json'], ROOT)
  const info = JSON.parse(output)
  return info[0].files.map((file) => file.path)
}

function copyIntoStage (stage, files) {
  const all = new Set([...files, 'package.json'])
  for (const rel of all) {
    const src = path.join(ROOT, rel)
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue
    const dst = path.join(stage, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
    fs.utimesSync(dst, FIXED_TIME, FIXED_TIME)
  }
}

function hashFile (file, algorithm) {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex')
}

function normalizeRelease (manifest) {
  return {
    schemaVersion: 1,
    name: NAME,
    version: VERSION,
    tag: 'v' + VERSION,
    asset: `${NAME}-${VERSION}.tgz`,
    size: manifest.size,
    sha256: manifest.sha256,
    sha512: manifest.sha512,
    url: `https://github.com/${REPO}/releases/download/v${VERSION}/${NAME}-${VERSION}.tgz`,
    mediaIncluded: true,
    install: {
      node: PKG.engines?.node || '>=20',
      profiles: ['desktop', 'web'],
    },
  }
}

function assertHasAllMedia (files) {
  const paths = new Set(files.map((entry) => entry.path))
  const missing = MEDIA_FILES.filter((file) => !paths.has(file))
  if (missing.length) {
    throw new Error('发布包缺少人物素材（必须 16 个）: ' + missing.join(', '))
  }
}

function main () {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log('用法: node scripts/build-release.mjs [--mode source|full] [--write-manifest] [--verify-manifest]')
    console.log('  source  打包 git 已跟踪文件（公开 Release 用，含完整人物素材）')
    console.log('  full    从工作区 files 白名单重建 -full 包（兼容保留，内容与 source 相同）')
    return
  }

  const outDir = path.join(ROOT, 'releases')
  fs.mkdirSync(outDir, { recursive: true })
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-elisa-pack-'))
  try {
    if (opts.mode === 'source') {
      exportHead(stage)
    } else {
      copyIntoStage(stage, packageFilesFromDryRun())
    }

    const packDir = path.join(stage, '_pack')
    fs.mkdirSync(packDir, { recursive: true })
    const output = runNpm(['pack', '--pack-destination', packDir, '--json'], stage)
    const info = JSON.parse(output)[0]
    const generated = path.join(packDir, info.filename)
    const targetName = opts.mode === 'source'
      ? `${NAME}-${VERSION}.tgz`
      : `${NAME}-${VERSION}-full.tgz`
    const target = path.join(outDir, targetName)

    assertHasAllMedia(info.files)

    fs.rmSync(target, { force: true })
    fs.copyFileSync(generated, target)

    const sha256 = hashFile(target, 'sha256')
    const sha512 = hashFile(target, 'sha512')
    const size = fs.statSync(target).size
    const sumName = opts.mode === 'source' ? 'SHA256SUMS' : 'SHA256SUMS.full'
    const sum512Name = opts.mode === 'source' ? 'SHA512SUMS' : 'SHA512SUMS.full'
    fs.writeFileSync(path.join(outDir, sumName), `${sha256}  ${targetName}\n`, 'utf8')
    fs.writeFileSync(path.join(outDir, sum512Name), `${sha512}  ${targetName}\n`, 'utf8')

    const manifest = { size, sha256, sha512 }
    if (opts.verifyManifest) {
      const manifestPath = path.join(ROOT, 'release.json')
      if (!fs.existsSync(manifestPath)) throw new Error('release.json 不存在')
      const current = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      if (current.version !== VERSION || current.asset !== targetName ||
          current.size !== size || current.sha256 !== sha256) {
        throw new Error(
          'release.json 与重建结果不一致：\n' +
          `  manifest version=${current.version} size=${current.size} sha256=${current.sha256}\n` +
          `  actual   version=${VERSION} size=${size} sha256=${sha256}\n` +
          '请运行 npm run build -- --write-manifest 后提交 release.json'
        )
      }
    }
    if (opts.writeManifest) {
      if (opts.mode !== 'source') throw new Error('只有 source 包可以写 release.json')
      fs.writeFileSync(
        path.join(ROOT, 'release.json'),
        JSON.stringify(normalizeRelease(manifest), null, 2) + '\n',
        'utf8'
      )
    }

    const summary = {
      mode: opts.mode,
      file: target,
      bytes: size,
      files: info.files.length,
      sha256,
      sha512,
      manifest: opts.writeManifest ? 'release.json' : undefined,
      verified: opts.verifyManifest ? true : undefined,
    }
    if (opts.json) console.log(JSON.stringify(summary, null, 2))
    else {
      console.log(`[OK] ${path.relative(ROOT, target)}`)
      console.log(`  ${size} B / ${info.files.length} files`)
      console.log(`  sha256 ${sha256}`)
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }
}

main()
