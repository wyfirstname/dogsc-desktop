/**
 * 端到端验证：录屏 → 写盘 → ffmpeg 转 mp4 → 校验。
 *
 * 用法：node scripts/verify-recording.mjs
 *
 * 关键点：必须先 require 真实主进程（注册全部 IPC handler），
 * 否则 window.dogsc 调用的通道会报 "No handler registered"。
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

// 先加载真实主进程：它会注册全部 IPC handler 并创建主窗口
require(path.join(root, 'dist', 'main', 'index.js'))

const { app, BrowserWindow } = require('electron')
const log = (...a) => console.log('[verify]', ...a)

const wait = ms => new Promise(r => setTimeout(r, ms))

app.whenReady().then(async () => {
  await wait(2000)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) { log('FAIL 主窗口未创建'); app.exit(1); return }

  const run = code => win.webContents.executeJavaScript(code, true)

  // 1) 枚举录制源（不带缩略图，测最快路径）
  const t0 = Date.now()
  const sources = await run('window.dogsc.listCaptureSources({ withThumbnails: false })')
  log('sources:', sources.length, 'in', Date.now() - t0, 'ms')
  const screen = sources.find(s => s.type === 'screen')
  if (!screen) { log('FAIL 没有屏幕源'); app.exit(1); return }
  log('picked:', screen.id, '|', screen.name)

  // 2) 采集 3 秒
  const cap = await run(\`
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: \${JSON.stringify(screen.id)},
              maxFrameRate: 30,
              minFrameRate: 1
            }
          }
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
        return { size: window.__blob.size, chunks: chunks.length }
      } catch (e) { return { error: String((e && e.message) || e) } }
    })()
  \`)
  log('capture:', JSON.stringify(cap))
  if (cap.error || !cap.size) { log('FAIL 采集失败'); app.exit(1); return }

  // 3) ArrayBuffer 交主进程落盘
  const saved = await run(\`
    (async () => {
      const buf = await window.__blob.arrayBuffer()
      return await window.dogsc.saveRecording(buf, 'verify-e2e')
    })()
  \`)
  log('saved:', saved.path)
  log('  size:', saved.size, 'bytes | onDisk:', fs.existsSync(saved.path))
  if (!fs.existsSync(saved.path)) { log('FAIL 文件未落盘'); app.exit(1); return }

  // 4) 转 mp4
  const t1 = Date.now()
  const exp = await run('window.dogsc.exportToMp4({ input: ' + JSON.stringify(saved.path) + ', fps: 30 })')
  log('export: code=' + exp.code, 'in', Date.now() - t1, 'ms')
  if (exp.code !== 0) { log('FAIL 转码失败:', exp.stderr); app.exit(1); return }

  const st = fs.statSync(exp.output)
  log('mp4:', exp.output)
  log('  size:', st.size, 'bytes')
  if (st.size < 1000) { log('FAIL mp4 过小'); app.exit(1); return }

  // 5) 清理
  try { fs.unlinkSync(saved.path); fs.unlinkSync(exp.output) } catch {}
  log('ALL OK — 整条链路可用')
  app.exit(0)
}).catch(e => { log('EXCEPTION', (e && e.stack) || e); app.exit(1) })
`

const tmp = join(root, '.verify-boot.cjs')
writeFileSync(tmp, script, 'utf-8')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS

const child = spawn(electronBin, [tmp], { cwd: root, env, stdio: 'inherit' })
child.on('close', code => process.exit(code ?? 1))
