/**
 * 复现用户 bug：同一播放头位置连续两次分割 → 黑屏？
 * 用真实 UI 驱动，抓 renderer 崩溃/控制台错误 + 截图。
 */
import { spawn } from 'node:child_process'
import { writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const electronBin = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const refDir = join(root, '..', 'ref')

const recordingsDir = join(process.env.USERPROFILE ?? '', 'Videos', 'DogSC')
const existing = existsSync(recordingsDir)
  ? readdirSync(recordingsDir).filter(f => f.endsWith('.mp4')).map(f => join(recordingsDir, f))
  : []

const script = `
const path = require('node:path')
const fs = require('node:fs')
const root = ${JSON.stringify(root)}
const refDir = ${JSON.stringify(refDir)}
require(path.join(root, 'dist', 'main', 'index.js'))
const { app, BrowserWindow } = require('electron')
const log = (...a) => console.log('[repro]', ...a)
const wait = ms => new Promise(r => setTimeout(r, ms))

app.whenReady().then(async () => {
  await wait(2200)
  const win = BrowserWindow.getAllWindows()[0]
  win.setSize(1440, 900)
  await wait(800)
  win.webContents.on('render-process-gone', (_e, d) => log('RENDER-GONE', JSON.stringify(d)))
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) log('CONSOLE', msg.slice(0, 300)) })
  const run = c => win.webContents.executeJavaScript(c, true)
  const wait2 = ms => wait(ms)

  let mediaPath = ${JSON.stringify(existing[0] ?? null)}
  if (!mediaPath) { log('FAIL 无素材'); app.exit(1); return }
  const desc = await run('window.dogsc.describeMedia(' + JSON.stringify(mediaPath) + ')')
  await run('window.__dogscDebug.loadAsset(' + JSON.stringify({
    id: 'repro', path: mediaPath, name: desc.name, duration: desc.duration,
    width: desc.width, height: desc.height, fps: desc.fps, size: desc.size,
    origin: 'import', createdAt: Date.now(), thumbnails: desc.thumbnails,
  }) + ')')
  await wait(1200)

  const D = desc.duration
  const t = D * 0.5
  const state = () => run('window.__dogscDebug.state()')

  // 模拟用户：暂停视频，seek 到中点，同一时间连按两次 S
  await run('window.__dogscDebug.seek(' + t + ')')
  await wait(300)
  log('--- 第 1 次 S（同一 currentTime）')
  try {
    await run('window.__dogscDebug.split(' + t + ')')
  } catch (e) { log('split1 threw', String(e).slice(0, 200)) }
  await wait(250)
  let s = await state()
  log('after1:', s.segments.length, '段', s.segments.map(x => x.sourceStart.toFixed(3) + '+' + x.sourceDuration.toFixed(3)).join(' | '))
  let img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(refDir, 'repro-1.png'), img.toPNG())

  log('--- 第 2 次 S（同一 currentTime）')
  try {
    await run('window.__dogscDebug.split(' + t + ')')
    log('split2 did NOT throw')
  } catch (e) { log('split2 threw（应被 runEdit 捕获为警告）:', String(e).slice(0, 200)) }
  await wait(250)
  s = await state()
  log('after2:', s.segments.length, '段', s.segments.map(x => x.sourceStart.toFixed(3) + '+' + x.sourceDuration.toFixed(3)).join(' | '))
  img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(refDir, 'repro-2.png'), img.toPNG())

  // 连按两次 S 键（真实键盘事件路径，模拟极快双击）
  log('--- 键盘 S x2（间隔 60ms）')
  await run(\`(async () => {
    const kd = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    kd('s'); await new Promise(r => setTimeout(r, 60)); kd('s')
  })()\`)
  await wait(400)
  s = await state()
  log('after keys:', s.segments.length, '段', s.segments.map(x => x.sourceStart.toFixed(3) + '+' + x.sourceDuration.toFixed(3)).join(' | '))
  img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(refDir, 'repro-3.png'), img.toPNG())

  // 播放 2 秒穿过微段
  log('--- 播放 2s')
  await run(\`(async () => { const v = document.querySelector('video'); v && v.play() })()\`)
  await wait(2000)
  s = await state()
  log('after play: currentTime', s.currentTime?.toFixed?.(3), 'segs', s.segments.length)
  img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(refDir, 'repro-4.png'), img.toPNG())
  log('DONE')
  app.exit(0)
}).catch(e => { log('EXCEPTION', (e && e.stack) || e); app.exit(1) })
`

const tmp = join(root, '.repro-split-ui.cjs')
writeFileSync(tmp, script, 'utf-8')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS
const child = spawn(electronBin, [tmp], { cwd: root, env, stdio: 'inherit' })
child.on('close', code => process.exit(code ?? 1))
