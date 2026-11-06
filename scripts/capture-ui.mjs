/**
 * 开发期辅助：启动应用并截取窗口画面（用于与上游原版界面比对）。
 *
 * 用法：env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS node scripts/capture-ui.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const electronBin = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const outFile = join(root, '..', 'ref', 'dogsc-win-ui.png')

// 在 Electron 主进程里跑一段临时脚本：开窗 → 等渲染完成 → 截图 → 退出
const shotScript = `
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const outFile = ${JSON.stringify(outFile)}
const root = ${JSON.stringify(root)}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(root, 'dist', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'))
  // 等字体、图标、Canvas 首帧全部绘制完成
  await new Promise(r => setTimeout(r, 2500))
  const image = await win.webContents.capturePage()
  fs.writeFileSync(outFile, image.toPNG())
  console.log('CAPTURED ' + outFile + ' ' + image.getSize().width + 'x' + image.getSize().height)
  app.quit()
})
`

const tmpScript = join(root, '.capture-boot.cjs')
writeFileSync(tmpScript, shotScript, 'utf-8')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS

const child = spawn(electronBin, [tmpScript], { cwd: root, env, stdio: 'inherit' })
child.on('close', code => {
  mkdirSync(dirname(outFile), { recursive: true })
  process.exit(code ?? 0)
})
