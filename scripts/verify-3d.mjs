/**
 * 3D 运镜视觉验证：录制 → 载入 → 应用 3D 旋转 → 截图。
 *
 * 用法：node scripts/verify-3d.mjs
 *
 * 依赖 App 里挂载的 window.__dogscDebug（开发期调试钩子）。
 * 输出三张截图到 ref/：
 *   3d-front.png   正面（无变换）
 *   3d-side.png    侧倾（rotationY = 35°）
 *   3d-tilt.png    复合倾斜（X12 Y-18 Z-6）
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const electronBin = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const refDir = join(root, '..', 'ref')

const script = `
const path = require('node:path')
const fs = require('node:fs')
const root = ${JSON.stringify(root)}
const refDir = ${JSON.stringify(refDir)}

require(path.join(root, 'dist', 'main', 'index.js'))

const { app, BrowserWindow } = require('electron')
const log = (...a) => console.log('[3d]', ...a)
const wait = ms => new Promise(r => setTimeout(r, ms))

app.whenReady().then(async () => {
  await wait(2200)
  const win = BrowserWindow.getAllWindows()[0]
  win.setSize(1440, 900)
  await wait(600)
  const run = c => win.webContents.executeJavaScript(c, true)

  const dbg = await run('typeof window.__dogscDebug')
  log('debug hook:', dbg)
  if (dbg !== 'object') { log('FAIL 调试钩子未挂载'); app.exit(1); return }

  // 录 3 秒并落盘
  const sources = await run('window.dogsc.listCaptureSources({ withThumbnails: false })')
  const screen = sources.find(s => s.type === 'screen')
  await run(\`
    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ mandatory:{
        chromeMediaSource:'desktop', chromeMediaSourceId:\${JSON.stringify(screen.id)},
        maxFrameRate:30, minFrameRate:1 } } })
      const rec = new MediaRecorder(stream, { mimeType:'video/webm;codecs=vp9', videoBitsPerSecond:4000000 })
      const chunks = []
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      const done = new Promise(r => rec.onstop = r)
      rec.start(1000); await new Promise(r => setTimeout(r, 2500)); rec.stop(); await done
      stream.getTracks().forEach(t => t.stop())
      window.__b = new Blob(chunks, { type:'video/webm' })
    })()
  \`)
  const saved = await run('(async()=>{ const b=await window.__b.arrayBuffer(); return await window.dogsc.saveRecording(b,"DEMO3D") })()')
  const exp = await run('window.dogsc.exportToMp4({ input:' + JSON.stringify(saved.path) + ', fps:30 })')
  if (exp.code !== 0) { log('FAIL 转码:', exp.stderr); app.exit(1); return }
  log('mp4:', exp.output)

  const desc = await run('window.dogsc.describeMedia(' + JSON.stringify(exp.output) + ')')
  if (!desc.ok) { log('FAIL describe:', desc.error); app.exit(1); return }

  // 注入资产并切到运镜页
  await run('window.__dogscDebug.loadAsset(' + JSON.stringify({
    id: 'dbg-1',
    path: exp.output,
    name: desc.name,
    duration: desc.duration,
    width: desc.width,
    height: desc.height,
    fps: desc.fps,
    size: desc.size,
    origin: 'recording',
    createdAt: Date.now(),
    thumbnails: desc.thumbnails,
  }) + ')')
  await run('window.__dogscDebug.setTab("motion")')
  await wait(1200)

  const shots = [
    ['3d-front.png', { rotationX:0, rotationY:0, rotationZ:0, perspective:0.65, scale:1, position:{x:0.5,y:0.5} }],
    ['3d-side.png',  { rotationX:0, rotationY:35, rotationZ:0, perspective:0.65, scale:1, position:{x:0.5,y:0.5} }],
    ['3d-top.png',   { rotationX:30, rotationY:0, rotationZ:0, perspective:0.65, scale:1, position:{x:0.5,y:0.5} }],
    ['3d-tilt.png',  { rotationX:12, rotationY:-18, rotationZ:-6, perspective:0.8, scale:1.1, position:{x:0.5,y:0.5} }],
  ]

  for (const [name, motion] of shots) {
    await run('window.__dogscDebug.setMotion(' + JSON.stringify(motion) + ')')
    await wait(500)
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(refDir, name), img.toPNG())
    log('saved', name)
  }

  try { fs.unlinkSync(saved.path); fs.unlinkSync(exp.output) } catch {}
  log('ALL OK')
  app.exit(0)
}).catch(e => { log('EXCEPTION', (e && e.stack) || e); app.exit(1) })
`

const tmp = join(root, '.verify-3d.cjs')
writeFileSync(tmp, script, 'utf-8')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS

const child = spawn(electronBin, [tmp], { cwd: root, env, stdio: 'inherit' })
child.on('close', code => process.exit(code ?? 1))
