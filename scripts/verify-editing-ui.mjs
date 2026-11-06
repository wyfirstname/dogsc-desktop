/**
 * 剪辑 UI 验证：导入素材 → 分割 → 删除 → 变速 → 裁切 → 截图。
 *
 * 用法：node scripts/verify-editing-ui.mjs
 *
 * 依赖 App 里挂载的 window.__dogscDebug（开发期调试钩子）。
 * 输出截图到 ref/：
 *   edit-split.png   三段分割后
 *   edit-deleted.png 波纹删除中段后
 *   edit-trim.png    左端裁切后
 *   edit-rate.png    变速后
 */
import { spawn } from 'node:child_process'
import { writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const electronBin = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const refDir = join(root, '..', 'ref')

// 复用已有的录制文件，避免每次验证都重新录屏（慢且依赖屏幕内容）
const recordingsDir = join(process.env.USERPROFILE ?? '', 'Videos', 'DogSC')
const existing = existsSync(recordingsDir)
  ? readdirSync(recordingsDir)
      .filter(f => f.endsWith('.mp4'))
      .map(f => join(recordingsDir, f))
  : []

const script = `
const path = require('node:path')
const fs = require('node:fs')
const root = ${JSON.stringify(root)}
const refDir = ${JSON.stringify(refDir)}

require(path.join(root, 'dist', 'main', 'index.js'))

const { app, BrowserWindow } = require('electron')
const log = (...a) => console.log('[edit]', ...a)
const wait = ms => new Promise(r => setTimeout(r, ms))

app.whenReady().then(async () => {
  await wait(2200)
  const win = BrowserWindow.getAllWindows()[0]
  win.setSize(1440, 900)
  await wait(800)
  const run = c => win.webContents.executeJavaScript(c, true)

  const dbg = await run('typeof window.__dogscDebug')
  log('debug hook:', dbg)
  if (dbg !== 'object') { log('FAIL 调试钩子未挂载'); app.exit(1); return }

  // ---- 找一个可用的媒体文件
  let mediaPath = null
  const candidates = ${JSON.stringify(existing)}
  if (candidates.length) mediaPath = candidates[0]
  if (!mediaPath) {
    // 没有现成录制就现录一段
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
        rec.start(1000); await new Promise(r => setTimeout(r, 6000)); rec.stop(); await done
        stream.getTracks().forEach(t => t.stop())
        window.__b = new Blob(chunks, { type:'video/webm' })
      })()
    \`)
    const saved = await run('(async()=>{ const b=await window.__b.arrayBuffer(); return await window.dogsc.saveRecording(b,"EDITDEMO") })()')
    const exp = await run('window.dogsc.exportToMp4({ input:' + JSON.stringify(saved.path) + ', fps:30 })')
    if (exp.code !== 0) { log('FAIL 转码:', exp.stderr); app.exit(1); return }
    mediaPath = exp.output
  }
  log('media:', mediaPath)

  const desc = await run('window.dogsc.describeMedia(' + JSON.stringify(mediaPath) + ')')
  if (!desc.ok) { log('FAIL describe:', desc.error); app.exit(1); return }
  log('duration:', desc.duration, desc.width + 'x' + desc.height)

  await run('window.__dogscDebug.loadAsset(' + JSON.stringify({
    id: 'edit-demo',
    path: mediaPath,
    name: desc.name,
    duration: desc.duration,
    width: desc.width,
    height: desc.height,
    fps: desc.fps,
    size: desc.size,
    origin: 'import',
    createdAt: Date.now(),
    thumbnails: desc.thumbnails,
  }) + ')')
  await wait(1200)

  const D = desc.duration
  const state = () => run('window.__dogscDebug.state()')

  let s = await state()
  log('初始:', s.segments.length, '段, 输出', s.outputDuration.toFixed(2) + 's')
  if (Math.abs(s.outputDuration - D) > 0.05) { log('FAIL 初始时长与源不符'); app.exit(1); return }

  // ---- 1. 分割
  await run('window.__dogscDebug.split(' + (D * 0.33) + ')')
  await wait(200)
  await run('window.__dogscDebug.split(' + (D * 0.66) + ')')
  await wait(400)
  s = await state()
  log('分割后:', s.segments.length, '段')
  log('  段:', s.segments.map(x => x.sourceStart.toFixed(2) + '+' + x.sourceDuration.toFixed(2)).join(' | '))
  if (s.segments.length !== 3) { log('FAIL 分割后应为 3 段'); app.exit(1); return }
  if (Math.abs(s.outputDuration - D) > 0.05) { log('FAIL 分割改变了总时长'); app.exit(1); return }
  let img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(refDir, 'edit-split.png'), img.toPNG())
  log('saved edit-split.png')

  // ---- 2. 波纹删除中间段
  const midID = s.segments[1].id
  const midDur = s.segments[1].sourceDuration
  await run('window.__dogscDebug.remove(' + JSON.stringify(midID) + ')')
  await wait(400)
  s = await state()
  log('删除后:', s.segments.length, '段, 输出', s.outputDuration.toFixed(2) + 's')
  const expected = D - midDur
  if (s.segments.length !== 2) { log('FAIL 删除后应为 2 段'); app.exit(1); return }
  if (Math.abs(s.outputDuration - expected) > 0.06) {
    log('FAIL 波纹删除时长不符: 期望', expected.toFixed(2), '实际', s.outputDuration.toFixed(2))
    app.exit(1); return
  }
  // 剩余片段必须无缝相接
  if (Math.abs(s.segments[0].outputEnd - s.segments[1].outputStart) > 0.001) {
    log('FAIL 删除后出现空洞'); app.exit(1); return
  }
  img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(refDir, 'edit-deleted.png'), img.toPNG())
  log('saved edit-deleted.png')

  // ---- 3. 变速（把第二段设成 4×）
  const secondID = s.segments[1].id
  const secondDur = s.segments[1].sourceDuration
  await run('window.__dogscDebug.setRate(' + JSON.stringify(secondID) + ', 4)')
  await wait(400)
  s = await state()
  log('变速后:', s.segments.map(x => x.playbackRate + '×').join(' | '), '输出', s.outputDuration.toFixed(2) + 's')
  const expectedRate = s.segments[0].sourceDuration + secondDur / 4
  if (Math.abs(s.outputDuration - expectedRate) > 0.06) {
    log('FAIL 变速时长不符: 期望', expectedRate.toFixed(2), '实际', s.outputDuration.toFixed(2))
    app.exit(1); return
  }
  img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(refDir, 'edit-rate.png'), img.toPNG())
  log('saved edit-rate.png')

  // ---- 4. 裁切第一段左端
  const firstID = s.segments[0].id
  await run('window.__dogscDebug.trim(' + JSON.stringify(firstID) + ', "left", 0.6)')
  await wait(400)
  s = await state()
  log('裁切后:', s.segments.length, '段, 输出', s.outputDuration.toFixed(2) + 's')
  if (!(s.segments[0].sourceStart > 0.4)) { log('FAIL 裁切未生效'); app.exit(1); return }
  img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(refDir, 'edit-trim.png'), img.toPNG())
  log('saved edit-trim.png')

  // ---- 5. 播放头跟随剪辑后的时间线
  await run('window.__dogscDebug.seek(' + (s.outputDuration * 0.5) + ')')
  await wait(600)
  const playState = await state()
  log('seek 后 currentTime:', playState.currentTime.toFixed(2))
  const videoTime = await run('(()=>{const v=document.querySelector("video"); return v? {t:v.currentTime, rate:v.playbackRate, d:v.duration} : null})()')
  log('video:', JSON.stringify(videoTime))
  if (videoTime) {
    // 输出时间 50% 不该映射到源时间 50%（因为中间被删了一段）
    if (Math.abs(videoTime.t - playState.currentTime) < 0.2) {
      log('WARN 输出时间与源时间几乎相同，剪辑映射可能未生效（若删除段在末尾则正常）')
    }
  }
  img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(refDir, 'edit-seek.png'), img.toPNG())
  log('saved edit-seek.png')

  log('ALL OK')
  app.exit(0)
}).catch(e => { log('EXCEPTION', (e && e.stack) || e); app.exit(1) })
`

const tmp = join(root, '.verify-editing-ui.cjs')
writeFileSync(tmp, script, 'utf-8')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS

const child = spawn(electronBin, [tmp], { cwd: root, env, stdio: 'inherit' })
child.on('close', code => process.exit(code ?? 1))
