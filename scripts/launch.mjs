/**
 * 启动器：绕开 ELECTRON_RUN_AS_NODE 干扰。
 *
 * 某些开发环境（含 IDE 内嵌终端、部分 Agent 宿主）会注入
 * ELECTRON_RUN_AS_NODE=1，让 electron.exe 退化成纯 Node 运行时，
 * 此时 require('electron') 返回的是可执行文件路径字符串而不是 API，
 * 主进程会报 "Cannot read properties of undefined (reading 'whenReady')"。
 *
 * 这里在子进程中剥离该变量后启动，保证 npm start / npm run dev 开箱可用。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const electronBin = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

if (!existsSync(electronBin)) {
  console.error('[launch] 未找到 electron.exe，请先执行：npm install')
  console.error(`[launch] 期望路径：${electronBin}`)
  process.exit(1)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS

// 透传额外参数：npm start -- --inspect 之类
const extraArgs = process.argv.slice(2)
const child = spawn(electronBin, ['.', ...extraArgs], {
  cwd: root,
  env,
  stdio: 'inherit',
})
child.on('close', code => process.exit(code ?? 0))
