/**
 * 端到端验证：录制 → 自动导入 → 时间线缩略图 → 画布可播放。
 *
 * 用法：node scripts/verify-import.mjs
 *
 * 覆盖点：
 *   1. 录 3 秒并落盘
 *   2. describeMedia 返回正确元数据（时长/分辨率/帧率）
 *   3. 生成 12 张胶片缩略图
 *   4. 渲染进程里 <video> 能加载该文件（file:// 可播放）
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const electronBin = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

const script = `
const path = require('node:path')
const fs = require('node:fs')
const root = ${JSON.stringify(root)}

require(path.join(root, 'dist', 'main', 'index.js'))

const { app, BrowserWindow } = require('electron')
const log = (...a) => console.log('[verify]', ...a)
const wait = ms => new Promise(r => setTimeout(r, ms))

app.whenReady().then(async () => {
  await wait(2000)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) { log('FAIL 主窗口未创建'); app.exit(1); return }
  const run = c => win.webContents.executeJavaScript(c, true)

  // ---- 1. 录制 3 秒
  const sources = await run('window.dogsc.listCaptureSources({ withThumbnails: false })')
  const screen = sources.find(s => s.type === 'screen')
  const cap = await run(\`
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: \${JSON.stringify(screen.id)},
            maxFrameRate: 30, minFrameRate: 1
          } }
        })
        const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 5000000 })
        const chunks = []
        rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
        const done = new Promise(res => { rec.onstop = res })
        rec.start(1000)
        await new Promise(r => setTimeout(r, 3000))
        rec.stop()
        await done
        stream.getTracks().forEach(t => t.stop())
        window.__blob = new Blob(chunks, { type: 'video/webm' })
        return { size: window.__blob.size }
      } catch (e) { return { error: String((e && e.message) || e) } }
    })()
  \`)
  if (cap.error || !cap.size) { log('FAIL 采集:', cap.error); app.exit(1); return }
  log('capture:', cap.size, 'bytes')

  const saved = await run(\`
    (async () => {
      const buf = await window.__blob.arrayBuffer()
      return await window.dogsc.saveRecording(buf, 'verify-import')
    })()
  \`)
  log('webm saved:', saved.path)

  const exp = await run('window.dogsc.exportToMp4({ input: ' + JSON.stringify(saved.path) + ', fps: 30 })')
  if (exp.code !== 0) { log('FAIL 转码:', exp.stderr); app.exit(1); return }
  log('mp4:', exp.output, fs.statSync(exp.output).size, 'bytes')

  // ---- 2. describeMedia 元数据
  const t0 = Date.now()
  const desc = await run('window.dogsc.describeMedia(' + JSON.stringify(exp.output) + ')')
  log('describe in', Date.now() - t0, 'ms')
  if (!desc.ok) { log('FAIL describe:', desc.error); app.exit(1); return }
  log('  duration:', desc.duration?.toFixed(2), 's')
  log('  size:', desc.width + 'x' + desc.height, '@', desc.fps?.toFixed(0), 'fps')
  log('  name:', desc.name)

  if (!(desc.duration > 2 && desc.duration < 5)) { log('FAIL 时长异常'); app.exit(1); return }
  if (desc.width < 100 || desc.height < 100) { log('FAIL 分辨率异常'); app.exit(1); return }

  // ---- 3. 缩略图
  log('  thumbnails:', desc.thumbnails?.length ?? 0)
  if (!desc.thumbnails || desc.thumbnails.length < 10) { log('FAIL 缩略图不足'); app.exit(1); return }

  // ---- 4. 渲染进程能否播放（file:// 解码）
  const playable = await run(\`
    (async () => {
      const v = document.createElement('video')
      v.src = 'file:///' + \${JSON.stringify(exp.output.replace(/\\\\/g, '/'))}
      v.muted = true
      const ok = await new Promise(res => {
        v.onloadedmetadata = () => res({ ok: true, d: v.duration, w: v.videoWidth, h: v.videoHeight })
        v.onerror = () => res({ ok: false, err: v.error && v.error.message })
        setTimeout(() => res({ ok: false, err: 'timeout' }), 8000)
      })
      return ok
    })()
  \`)
  log('video element:', JSON.stringify(playable))
  if (!playable.ok) { log('FAIL 无法解码播放'); app.exit(1); return }

  // ---- 清理
  try { fs.unlinkSync(saved.path); fs.unlinkSync(exp.output) } catch {}
  log('ALL OK — 录制自动导入链路可用')
  app.exit(0)
}).catch(e => { log('EXCEPTION', (e && e.stack) || e); app.exit(1) })
`

const tmp = join(root, '.verify-import.cjs')
writeFileSync(tmp, script, 'utf-8')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS

const child = spawn(electronBin, [tmp], { cwd: root, env, stdio: 'inherit' })
child.on('close', code => process.exit(code ?? 1))
