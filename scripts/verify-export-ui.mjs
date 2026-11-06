/**
 * 端到端验证导出管线：真实 UI 加载素材 → 分割 + 删除制造剪辑 →
 * window.dogsc.exportTimeline 导出 → 校验输出文件时长 ≈ 剪辑后期望时长。
 */
import { spawn } from 'node:child_process'
import { writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const electronBin = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

const recordingsDir = join(process.env.USERPROFILE ?? '', 'Videos', 'DogSC')
const existing = existsSync(recordingsDir)
  ? readdirSync(recordingsDir).filter(f => f.endsWith('.mp4')).map(f => join(recordingsDir, f))
  : []

const outPath = join(recordingsDir, `DogSC_导出_verify_${Date.now()}.mp4`)
try { rmSync(outPath, { force: true }) } catch { /* 不存在 */ }

const script = `
const path = require('node:path')
const fs = require('node:fs')
const root = ${JSON.stringify(root)}
const OUT = ${JSON.stringify(outPath)}
require(path.join(root, 'dist', 'main', 'index.js'))
const { app, BrowserWindow } = require('electron')
const log = (...a) => console.log('[export-ui]', ...a)
const wait = ms => new Promise(r => setTimeout(r, ms))

app.whenReady().then(async () => {
  await wait(2200)
  const win = BrowserWindow.getAllWindows()[0]
  win.setSize(1280, 820)
  await wait(600)
  let errors = 0
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) { errors++; log('CONSOLE', msg.slice(0, 200)) } })
  const run = c => win.webContents.executeJavaScript(c, true)

  let mediaPath = ${JSON.stringify(existing[0] ?? null)}
  if (!mediaPath) { log('FAIL 无素材'); app.exit(1); return }
  const desc = await run('window.dogsc.describeMedia(' + JSON.stringify(mediaPath) + ')')
  await run('window.__dogscDebug.loadAsset(' + JSON.stringify({
    id: 'export-ui', path: mediaPath, name: desc.name, duration: desc.duration,
    width: desc.width, height: desc.height, fps: desc.fps, size: desc.size,
    origin: 'import', createdAt: Date.now(), thumbnails: desc.thumbnails,
  }) + ')')
  await wait(1000)

  const D = desc.duration
  // 剪辑：中点分割，删掉后半段 → 期望输出 ≈ D/2
  await run('window.__dogscDebug.split(' + D / 2 + ')')
  await wait(300)
  const st = await run('window.__dogscDebug.state()')
  const expected = st.segments.reduce((t, s) => t + s.sourceDuration / s.playbackRate, 0)
  log('期望输出时长:', expected.toFixed(3), 's，片段数:', st.segments.length)

  // 直接走 IPC 导出（跳过保存对话框，指定输出路径）
  const exportOpts = JSON.stringify({
    input: mediaPath,
    segments: st.segments.map(s => ({
      sourceStart: s.sourceStart,
      sourceDuration: s.sourceDuration,
      playbackRate: s.playbackRate,
    })),
    output: OUT,
  })
  const r = await run('window.dogsc.exportTimeline(' + exportOpts + ')')
  log('export code:', r.code, r.code !== 0 ? r.stderr.slice(0, 300) : '')

  if (r.code !== 0) { log('FAIL 导出失败'); app.exit(1); return }
  const out = r.output
  const ok = fs.existsSync(out) && fs.statSync(out).size > 10000
  log('输出存在:', ok, ok ? (fs.statSync(out).size / 1e6).toFixed(1) + 'MB' : '')
  const od = await run('window.dogsc.describeMedia(' + JSON.stringify(out) + ')')
  log('输出时长:', (od.duration ?? 0).toFixed(3), 's 期望:', expected.toFixed(3), 's')
  const diff = Math.abs((od.duration ?? 0) - expected)
  log(diff < 0.35 ? 'PASSED (时长误差 ' + diff.toFixed(3) + 's, console errors ' + errors + ')' : 'FAIL 时长偏差 ' + diff.toFixed(3) + 's')
  app.exit(diff < 0.35 && ok && errors === 0 ? 0 : 1)
}).catch(e => { log('EXCEPTION', (e && e.stack) || e); app.exit(1) })
`

const tmp = join(root, '.export-ui.cjs')
writeFileSync(tmp, script, 'utf-8')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS
const child = spawn(electronBin, [tmp], { cwd: root, env, stdio: 'inherit' })
child.on('close', code => process.exit(code ?? 1))
