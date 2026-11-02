#!/usr/bin/env node
/**
 * 公开仓库门禁：本机路径、凭据、第三方媒体、内部产物、版本漂移、断链。
 * 需要在 git 仓库内运行（CI 在 checkout 后执行）。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const VERSION = PKG.version

let passed = 0
const failures = []

function ok (name, fn) {
  try {
    fn()
    passed++
    console.log('PASS ' + name)
  } catch (error) {
    failures.push(name + ': ' + error.message)
    console.error('FAIL ' + name + ': ' + error.message)
  }
}

function trackedFiles () {
  try {
    const raw = execFileSync('git', ['ls-files', '-z'], {
      cwd: ROOT,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return raw.toString('utf8').split('\0').filter(Boolean)
  } catch (error) {
    throw new Error('需要 git 仓库（git ls-files 失败）：' + error.message)
  }
}

const tracked = trackedFiles()
const textExtensions = /\.(?:md|json|js|mjs|css|html|yml|yaml|py|cmd|ps1|txt|gitignore|gitattributes|editorconfig)$/i
const textFiles = tracked
  .filter((file) => !['scripts/check-public.mjs', '.gitignore'].includes(file))
  .filter((file) => textExtensions.test(file) || ['LICENSE', 'NOTICE'].includes(file))

const PRIVATE_PATTERNS = [
  [/E:\\dshdesign/i, '本机 E 盘项目路径'],
  [/C:\\Users\\[^\\\s]+/i, '本机用户目录'],
  [/26547/, '本机用户名'],
  [/C:\\Users\\26547/i, '本机用户目录'],
  [/_旧版本归档_/, '旧版本归档'],
  [/_开工简报/, '开工简报'],
  [/_项目卡/, '项目卡'],
  [/_install-verify-/, '本地安装验收记录'],
  [/ghp_[A-Za-z0-9]{20,}/, '疑似 GitHub PAT'],
  [/github_pat_[A-Za-z0-9_]{20,}/, '疑似 GitHub 细粒度 PAT'],
  [/sk-[A-Za-z0-9]{20,}/, '疑似 API key'],
]

ok('没有把本机路径/用户名/凭据写进公开文件', () => {
  for (const file of textFiles) {
    const content = fs.readFileSync(path.join(ROOT, file), 'utf8')
    for (const [pattern, label] of PRIVATE_PATTERNS) {
      if (pattern.test(content)) throw new Error(`${file} 命中 ${label}`)
    }
  }
})

ok('没有跟踪第三方人物素材（程序化音频除外）', () => {
  const mediaPattern = /^lib\/assets\/(?!audio\/)[^/]+\.(?:mp4|webm|webp|jpg|jpeg|png|mp3|woff2|gif)$/i
  const layersPattern = /^lib\/assets\/layers\//i
  const found = tracked.filter((file) => mediaPattern.test(file) || layersPattern.test(file))
  if (found.length) throw new Error(found.join(', '))
})

ok('没有跟踪内部开发目录', () => {
  const internal = tracked.filter((file) =>
    /^(?:_p\d+|_shots[^/]*|_build|_integration|_backup|_notes|_work)\//.test(file) ||
    /^_(?:开工简报|项目卡)/.test(file) ||
    /^(?:node_modules|\.pnpm-store)\//.test(file)
  )
  if (internal.length) throw new Error(internal.join(', '))
})

ok('版本号在 package / release / 文档 / 测试之间一致', () => {
  const manifestPath = path.join(ROOT, 'release.json')
  if (!fs.existsSync(manifestPath)) throw new Error('release.json 不存在')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.version !== VERSION) throw new Error('release.json version 不一致')
  if (manifest.tag !== 'v' + VERSION) throw new Error('release.json tag 不一致')
  if (manifest.name !== PKG.name) throw new Error('release.json name 不一致')
  if (manifest.asset !== `${PKG.name}-${VERSION}.tgz`) throw new Error('release.json asset 不一致')
  if (manifest.mediaIncluded !== false) throw new Error('release.json 必须声明 mediaIncluded=false')

  const splashTest = fs.readFileSync(path.join(ROOT, 'test/smoke-splash.mjs'), 'utf8')
  if (!splashTest.includes(`version ${VERSION}`) || !splashTest.includes(`iframe v=${VERSION}`)) {
    throw new Error('smoke-splash 的版本断言未同步')
  }
  for (const file of ['README.md', 'INSTALL.md', 'CHANGELOG.md']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    if (!text.includes(VERSION)) throw new Error(`${file} 未出现当前版本 ${VERSION}`)
  }
})

ok('package.json 指向公开仓库与 Release', () => {
  if (!PKG.repository?.url?.includes('github.com/QIFANAI/dsh-startup-elisa')) {
    throw new Error('repository.url 不是公开仓库')
  }
  if (PKG.bugs?.url !== 'https://github.com/QIFANAI/dsh-startup-elisa/issues') {
    throw new Error('bugs.url 不正确')
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'release.json'), 'utf8'))
  const expected = `https://github.com/QIFANAI/dsh-startup-elisa/releases/download/v${VERSION}/${PKG.name}-${VERSION}.tgz`
  if (manifest.url !== expected) throw new Error('release.json 下载地址不正确')
})

ok('package.json files 覆盖运行时与文档', () => {
  const required = ['lib', 'preview', 'test', 'docs', 'cordis.patch.yml', 'README.md', 'INSTALL.md']
  const files = PKG.files || []
  for (const entry of required) {
    if (!files.includes(entry)) throw new Error(`files 缺少 ${entry}`)
  }
})

ok('install.mjs 指向同一仓库与包名', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/install.mjs'), 'utf8')
  if (!source.includes("const REPO = 'QIFANAI/dsh-startup-elisa'")) throw new Error('install.mjs REPO 不一致')
  if (!source.includes(`const NAME = '${PKG.name}'`)) throw new Error('install.mjs NAME 不一致')
})

ok('README / INSTALL 的相对链接都存在', () => {
  const files = ['README.md', 'INSTALL.md', 'CONTRIBUTING.md', 'MAINTAIN.md', 'THIRD-PARTY-NOTICES.md']
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1])
    for (const link of links) {
      if (/^(?:https?:|mailto:|#)/.test(link)) continue
      const clean = decodeURIComponent(link.split('#')[0])
      if (!clean) continue
      const target = path.resolve(ROOT, path.dirname(file), clean)
      if (!fs.existsSync(target)) throw new Error(`${file} 断链：${link}`)
    }
  }
})

ok('程序化音频文件存在且非空', () => {
  for (const file of ['lib/assets/audio/boot.wav', 'lib/assets/audio/chime.wav']) {
    const full = path.join(ROOT, file)
    if (!fs.existsSync(full)) throw new Error('缺少 ' + file)
    if (fs.statSync(full).size < 100 * 1024) throw new Error(file + ' 体积异常')
  }
})

ok('README 引用的截图存在', () => {
  const text = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
  const images = [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => match[1])
  if (!images.length) throw new Error('README 没有截图')
  for (const image of images) {
    if (/^https?:/.test(image)) continue
    if (!fs.existsSync(path.join(ROOT, image))) throw new Error('缺图：' + image)
  }
})

ok('公开文件没有私钥/证书', () => {
  for (const file of textFiles) {
    const content = fs.readFileSync(path.join(ROOT, file), 'utf8')
    if (/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(content)) {
      throw new Error(file + ' 含私钥')
    }
  }
})

ok('source 包不夹带人物素材（构建脚本含断言）', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/build-release.mjs'), 'utf8')
  if (!source.includes('assertSourceHasNoMedia')) throw new Error('build-release.mjs 缺少素材断言')
})

ok('仓库字节数在合理范围（< 40 MB）', () => {
  let total = 0
  for (const file of tracked) total += fs.statSync(path.join(ROOT, file)).size
  if (total > 40 * 1024 * 1024) throw new Error(`跟踪文件 ${total} B 超过 40 MB`)
})

console.log(`\nPUBLIC CHECK ${passed} PASS / ${failures.length} FAIL`)
if (failures.length) {
  for (const failure of failures) console.error('  - ' + failure)
  process.exit(1)
}
