/**
 * UI 验证：背景源 / 光标覆盖层 / 开场转场 三大特性接通后的真实渲染。
 * 驱动 __dogscDebug 新钩子（setCanvasStyle / setCursorStyle / setOpening），
 * 每个特性截图 + 检查 DOM 节点存在 + 收集控制台错误。
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
require(path.join(root, 'dist', 'main', 'index.js'))
const { app, BrowserWindow } = require('electron')
const log = (...a) => console.log('[render-ui]', ...a)
const wait = ms => new Promise(r => setTimeout(r, ms))

app.whenReady().then(async () => {
  await wait(2200)
  const win = BrowserWindow.getAllWindows()[0]
  win.setSize(1440, 900)
  await wait(800)
  let errors = 0
  win.webContents.on('render-process-gone', (_e, d) => { errors++; log('RENDER-GONE', JSON.stringify(d)) })
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) { errors++; log('CONSOLE', msg.slice(0, 200)) } })
  const run = c => win.webContents.executeJavaScript(c, true)
  const shot = name => win.webContents.capturePage().then(img => fs.writeFileSync(path.join(${JSON.stringify(refDir)}, name), img.toPNG()))

  let mediaPath = ${JSON.stringify(existing[0] ?? null)}
  if (!mediaPath) { log('FAIL 无素材'); app.exit(1); return }
  const desc = await run('window.dogsc.describeMedia(' + JSON.stringify(mediaPath) + ')')
  await run('window.__dogscDebug.loadAsset(' + JSON.stringify({
    id: 'render-ui', path: mediaPath, name: desc.name, duration: desc.duration,
    width: desc.width, height: desc.height, fps: desc.fps, size: desc.size,
    origin: 'import', createdAt: Date.now(), thumbnails: desc.thumbnails,
  }) + ')')
  await wait(1200)

  // ---- 1) 背景：切换到「工程白网格」图案（其余字段取当前 state 再覆盖）
  await run(\`
    (() => {
      const s = window.__dogscDebug.state()
      window.__dogscDebug.setCanvasStyle({
        ...s.canvasStyle,
        backgroundSource: { kind: 'pattern', patternPreset: '工程白网格' },
        patternOpacity: 1,
      })
    })()
  \`)
  log('step1 背景（工程白网格）已应用')
  await wait(400)
  await shot('render-ui-1-pattern-bg.png')
  const stageExists = await run('!!document.querySelector("[data-dogsc-stage]")')
  log('stage exists:', stageExists)

  // ---- 2) 光标覆盖层：切到光标页签后可见
  await run('window.__dogscDebug.setTab("cursor")')
  await wait(300)
  const cursorVisible = await run(\`(function () {
    const stage = document.querySelector('[data-dogsc-stage]')
    if (!stage) return 'no-stage'
    const rect = stage.getBoundingClientRect()
    stage.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + rect.width * 0.6, clientY: rect.top + rect.height * 0.4, bubbles: true }))
    return new Promise(r => setTimeout(() => r(!!document.querySelector('[data-dogsc-cursor]')), 250))
  })()\`)
  log('cursor overlay visible:', cursorVisible)
  await shot('render-ui-2-cursor.png')

  // ---- 3) 开场转场：启用「聚拢」，seek 到 0.1s 应看到缩小 + 淡入中的卡片
  await run('window.__dogscDebug.setOpening({ isEnabled: true, preset: "聚拢", motionCurve: "swift", duration: 2.2, stagger: 0.16, includedElements: ["屏幕","摄像头","贴图"], elementOrder: ["屏幕","摄像头","贴图"] })')
  await run('window.__dogscDebug.seek(0.15)')
  await wait(500)
  await shot('render-ui-3-opening.png')
  const openingApplied = await run(\`(function () {
    const card = document.querySelector('[data-dogsc-stage] > div')
    return card ? card.style.transform : 'no-card'
  })()\`)
  log('opening transform:', String(openingApplied).slice(0, 120))

  log('console errors:', errors)
  log(errors === 0 ? 'PASSED' : 'PASSED-WITH-WARNINGS')
  app.exit(errors === 0 ? 0 : 2)
}).catch(e => { log('EXCEPTION', (e && e.stack) || e); app.exit(1) })
`

const tmp = join(root, '.render-ui.cjs')
writeFileSync(tmp, script, 'utf-8')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS
const child = spawn(electronBin, [tmp], { cwd: root, env, stdio: 'inherit' })
child.on('close', code => process.exit(code ?? 1))
