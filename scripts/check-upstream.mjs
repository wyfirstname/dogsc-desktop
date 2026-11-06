#!/usr/bin/env node
/**
 * 上游更新对比脚本
 *
 * 用法：
 *   node scripts/check-upstream.mjs                # 拉取上游并列出待同步变更
 *   node scripts/check-upstream.mjs --fetch        # 先 fetch 再对比（默认）
 *   node scripts/check-upstream.mjs --no-fetch     # 只做本地 diff，不联网
 *   node scripts/check-upstream.mjs --json         # 输出 JSON（供 CI 用）
 *
 * 工作原理：
 *   1. 在 upstream-dogsc/（原项目 git 克隆）里 fetch 上游
 *   2. 找出「基线 commit → 上游最新」之间变更过的 Swift 文件
 *   3. 查 mappings.json（转写时自动维护的来源映射）定位每个 Swift 文件
 *      对应本仓库的 TS/TSX 文件
 *   4. 输出更新清单：原文件改了什么、本仓库要动哪些文件、是否有新增/删除
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const UPSTREAM_DIR = path.join(ROOT, '..', 'upstream-dogsc')
const MAPPINGS = path.join(ROOT, 'mappings.json')

// ---------------------------------------------------------------- 参数

const args = process.argv.slice(2)
const doFetch = !args.includes('--no-fetch')
const asJson = args.includes('--json')

// ---------------------------------------------------------------- 基线

/**
 * 基线 commit 记录在 mappings.json 里。
 * 首次转写时锁定当时的上游 commit；每次完成一轮同步后用 --bump 更新它。
 */
function loadMappings() {
  if (!fs.existsSync(MAPPINGS)) {
    console.error('未找到 mappings.json。首次运行前需要先跑一次转写登记。')
    console.error('格式：{ "baseline": "<commit>", "files": { "Sources/...swift": "src/renderer/src/..." } }')
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(MAPPINGS, 'utf-8'))
}

// ---------------------------------------------------------------- git 工具

function git(cwd, cmd) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8' }).trim()
}

function safeGit(cwd, cmd) {
  try { return git(cwd, cmd) } catch { return null }
}

// ---------------------------------------------------------------- 主流程

const mappings = loadMappings()
const baseline = mappings.baseline

if (!baseline) {
  console.error('mappings.json 缺少 baseline 字段（转写基线 commit）')
  process.exit(1)
}

if (!fs.existsSync(path.join(UPSTREAM_DIR, '.git'))) {
  console.error(`未找到上游克隆目录：${UPSTREAM_DIR}`)
  console.error('请先执行：git clone https://github.com/laogou717/dogsc.git ' + UPSTREAM_DIR)
  process.exit(1)
}

console.log(`基线 commit : ${baseline}`)
console.log(`上游        : ${UPSTREAM_DIR}`)

if (doFetch) {
  console.log('拉取上游…')
  safeGit(UPSTREAM_DIR, 'fetch origin') ?? console.warn('  fetch 失败，使用本地已有数据')
}

const head = git(UPSTREAM_DIR, 'rev-parse --short origin/main')
console.log(`上游最新    : ${head}`)

if (head === baseline) {
  console.log('\n✓ 上游无更新，本地转写与原项目一致。')
  process.exit(0)
}

// 变更文件清单：A=新增 M=修改 D=删除 R=改名
const diffRaw = git(UPSTREAM_DIR, `diff --name-status ${baseline}..origin/main -- Sources/`)
const changes = diffRaw
  .split('\n')
  .filter(Boolean)
  .map(line => {
    const [status, ...rest] = line.split('\t')
    return { status: status[0], file: rest[rest.length - 1], oldFile: rest.length > 1 ? rest[0] : null }
  })

// 映射到本地文件
const report = changes.map(c => {
  const mapped = mappings.files[c.file] ?? null
  const mappedOld = c.oldFile ? mappings.files[c.oldFile] ?? null : null
  return { ...c, localFile: mapped, oldLocalFile: mappedOld }
})

// ---------------------------------------------------------------- 输出

const counts = { A: 0, M: 0, D: 0, R: 0 }
for (const r of report) counts[r.status] = (counts[r.status] ?? 0) + 1

if (asJson) {
  console.log(JSON.stringify({ baseline, head, counts, changes: report }, null, 2))
} else {
  console.log(`\n上游有更新：${baseline} → ${head}`)
  console.log(`新增 ${counts.A ?? 0} · 修改 ${counts.M ?? 0} · 删除 ${counts.D ?? 0} · 改名 ${counts.R ?? 0}\n`)

  for (const r of report) {
    const tag = { A: '新增', M: '修改', D: '删除', R: '改名' }[r.status] ?? r.status
    if (r.status === 'D') {
      console.log(`  [${tag}] ${r.file}`)
      console.log(`          → 本地需删除：${r.localFile ?? '（无映射，可能是未转写文件）'}`)
    } else if (r.status === 'R') {
      console.log(`  [${tag}] ${r.oldFile} → ${r.file}`)
      console.log(`          → 本地需重命名：${r.oldLocalFile ?? '?'} → ${r.localFile ?? '?'}`)
    } else {
      console.log(`  [${tag}] ${r.file}`)
      console.log(`          → 本地需更新：${r.localFile ?? '⚠ 尚未转写，需先补映射'}`)
    }
  }

  const unmapped = report.filter(r => !r.localFile && r.status !== 'D')
  if (unmapped.length) {
    console.log(`\n⚠ ${unmapped.length} 个上游文件在 mappings.json 中没有映射，`)
    console.log('  说明它们是在基线之后新增、本地尚未转写的。请先转写再更新基线。')
  }

  console.log('\n完成一轮同步后，运行以下命令推进基线：')
  console.log(`  node scripts/check-upstream.mjs --bump ${head}`)
}

// --bump <commit>：完成同步后把基线推进到新 commit
const bumpIdx = args.indexOf('--bump')
if (bumpIdx !== -1 && args[bumpIdx + 1]) {
  const newBase = args[bumpIdx + 1]
  mappings.baseline = newBase
  fs.writeFileSync(MAPPINGS, JSON.stringify(mappings, null, 2))
  console.log(`\n基线已推进到 ${newBase}`)
}
