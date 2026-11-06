/**
 * DogSC for Windows — Electron 主进程
 *
 * 职责：窗口管理、录屏源枚举、录制落盘、ffmpeg 导出子进程。
 * 渲染进程只做 UI，不碰文件系统与子进程。
 *
 * Swift source: Sources/DogSCApp/AppModel+CaptureLifecycle.swift @ laogou717/dogsc 567fd6e
 */
import { app, BrowserWindow, Menu, ipcMain, desktopCapturer, shell, dialog } from 'electron'
import path from 'node:path'
import { spawn, ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
// ffmpeg-static 只在开发期使用，且必须延迟 require：
// 打包配置排除 node_modules，静态 import 会让绿色包启动即报「缺少模块」。
type FfmpegStatic = string | null
function requireFfmpegStatic(): FfmpegStatic {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('ffmpeg-static') as FfmpegStatic
  } catch {
    return null
  }
}

let mainWindow: BrowserWindow | null = null

/** 录制产物目录：<用户视频库>/DogSC，与 macOS 版 Recordings 语义对齐。 */
function recordingsDir(): string {
  return path.join(app.getPath('videos'), 'DogSC')
}

function createWindow(): void {
  // 隐藏 Electron 默认菜单栏（File/Edit/View/Window/Help）。
  // setApplicationMenu(null) 彻底移除；autoHideMenuBar 兜底防 Alt 唤出。
  Menu.setApplicationMenu(null)
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    title: 'DogSC',
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 开发时加载 Vite dev server；生产加载构建产物
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())

// ---------------------------------------------------------------- IPC

/**
 * 枚举可采集的屏幕与窗口。
 *
 * 性能要点：缩略图抓取是这里最慢的一步（要逐窗口截图）。
 * 支持传入 thumbnailSize=0 跳过缩略图，让渲染进程先拿到列表立即开框，
 * 缩略图再用第二通道补。
 */
ipcMain.handle(
  'capture:sources',
  async (_e, opts?: { withThumbnails?: boolean; thumbnailWidth?: number }) => {
    const withThumbnails = opts?.withThumbnails !== false
    const width = Math.max(0, opts?.thumbnailWidth ?? 320)
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: withThumbnails ? { width, height: Math.round((width * 9) / 16) } : { width: 0, height: 0 },
      fetchWindowIcons: withThumbnails
    })
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      type: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: withThumbnails && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null,
      appIcon: withThumbnails && s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
    }))
  }
)

/** 单独补一次屏幕缩略图（窗口缩略图量大，按需再取）。 */
ipcMain.handle('capture:thumbnails', async (_e, width = 320) => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height: Math.round((width * 9) / 16) },
    fetchWindowIcons: false
  })
  return sources.map(s => ({
    id: s.id,
    thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL()
  }))
})

/**
 * 把渲染进程录好的 webm 落盘。
 *
 * 渲染进程通过 IPC 传 ArrayBuffer，主进程写到 Recordings 目录。
 * 返回绝对路径，供后续 ffmpeg 使用。
 */
ipcMain.handle('recording:save', async (_e, payload: { data: ArrayBuffer; name?: string }) => {
  const dir = recordingsDir()
  await fs.mkdir(dir, { recursive: true })
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19)
  const base = payload.name?.trim() || `DogSC_${stamp}`
  const target = path.join(dir, `${sanitizeFileName(base)}.webm`)
  await fs.writeFile(target, Buffer.from(payload.data))
  return { path: target, dir, size: payload.data.byteLength }
})

/**
 * 启动 ffmpeg 导出：把落盘的 webm 转成 mp4。
 * 失败时返回非 0 code 与 stderr 尾部，便于界面展示真实原因。
 */
ipcMain.handle(
  'export:toMp4',
  async (_e, opts: { input: string; output?: string; fps?: number }) => {
    try {
      if (!opts?.input) throw new Error('缺少输入文件路径')

      // 防御：渲染进程传来的必须是绝对路径且文件存在
      if (!path.isAbsolute(opts.input)) {
        throw new Error(`输入路径不是绝对路径：${opts.input}`)
      }
      const stat = await fs.stat(opts.input).catch(() => null)
      if (!stat || stat.size === 0) {
        throw new Error(`输入文件不存在或为空：${opts.input}`)
      }

      const output = opts.output ?? opts.input.replace(/\.webm$/i, '.mp4')
      const bin = resolveFfmpegPath()
      const binExist = await fs.stat(bin).catch(() => null)
      if (!binExist) throw new Error(`未找到 ffmpeg：${bin}`)

      const result = await runFfmpeg([
        '-y',
        '-i', opts.input,
        '-r', String(opts.fps ?? 60),
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        output
      ])

      if (result.code !== 0) {
        return { code: result.code, output, stderr: tail(result.stderr, 2000) }
      }
      return { code: 0, output, dir: path.dirname(output), stderr: '' }
    } catch (err) {
      return {
        code: -1,
        output: '',
        stderr: err instanceof Error ? err.message : String(err)
      }
    }
  }
)

/**
 * 按剪辑后的时间线导出成片（TimelineMap → ffmpeg trim/setpts/concat）。
 *
 * 对照上游：DirectExportPipeline.swift / TimelineCompositionBuilder.swift 的
 * 「保留片段顺序拼接」语义；背景/光标/转场合成待 FrameScene 转写后接入。
 * 进度通过 'export:progress' 推给渲染进程（0~100）。
 */
ipcMain.handle(
  'export:timeline',
  async (
    _e,
    opts: {
      input: string
      segments: { sourceStart: number; sourceDuration: number; playbackRate: number }[]
      output?: string
    }
  ) => {
    const win = BrowserWindow.getAllWindows()[0]
    const report = (pct: number) => {
      try { win?.webContents.send('export:progress', Math.min(Math.max(Math.round(pct), 0), 100)) } catch { /* 窗口已关 */ }
    }
    try {
      if (!opts?.input || !path.isAbsolute(opts.input)) throw new Error('缺少输入文件路径')
      const stat = await fs.stat(opts.input).catch(() => null)
      if (!stat || stat.size === 0) throw new Error(`输入文件不存在：${opts.input}`)
      const segments = (opts.segments ?? []).filter(s => s.sourceDuration > 0.001)
      if (segments.length === 0) throw new Error('时间线为空：没有可导出的片段')

      // 输出路径：未指定时弹保存框，默认存到录制目录
      let output = opts.output ?? ''
      if (!output) {
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
        const picked = await dialog.showSaveDialog(win, {
          title: '导出成片',
          defaultPath: path.join(recordingsDir(), `DogSC_导出_${stamp}.mp4`),
          filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
        })
        if (picked.canceled || !picked.filePath) return { code: -2, output: '', stderr: '已取消' }
        output = picked.filePath
      }

      // 探测音频流（决定滤镜是否接音频支路）
      const probe = await runFfmpeg(['-hide_banner', '-i', opts.input])
      const withAudio = hasAudioStream(probe.stderr)

      // 构建 filter_complex：每段 trim + setpts 变速，最后 concat
      const n = segments.length
      const filters: string[] = []
      for (let i = 0; i < n; i++) {
        const s = segments[i]
        const start = Math.max(s.sourceStart, 0).toFixed(3)
        const end = (Math.max(s.sourceStart, 0) + s.sourceDuration).toFixed(3)
        const rate = Math.min(Math.max(s.playbackRate, 0.0625), 100)
        filters.push(
          `[0:v]trim=start=${start}:end=${end},setpts=(PTS-STARTPTS)/${rate.toFixed(4)}[v${i}]`
        )
        if (withAudio) {
          // atempo 只支持 0.5~2（整段），链式拆解变速因子
          const tempos: string[] = []
          let f = rate
          while (f > 2) { tempos.push('atempo=2.0'); f /= 2 }
          while (f < 0.5) { tempos.push('atempo=0.5'); f *= 2 }
          tempos.push(`atempo=${f.toFixed(4)}`)
          filters.push(
            `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,${tempos.join(',')}[a${i}]`
          )
        }
      }
      const concatInputs = segments.map((_, i) => (withAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join('')
      filters.push(
        withAudio
          ? `${concatInputs}concat=n=${n}:v=1:a=1[vout][aout]`
          : `${concatInputs}concat=n=${n}:v=1:a=0[vout]`
      )

      const expectedDuration = segments.reduce((t, s) => t + s.sourceDuration / s.playbackRate, 0)
      let lastPct = -1
      const args = [
        '-y',
        '-i', opts.input,
        '-filter_complex', filters.join(';'),
        '-map', '[vout]',
        ...(withAudio ? ['-map', '[aout]'] : []),
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        ...(withAudio ? ['-c:a', 'aac', '-b:a', '160k'] : []),
        '-movflags', '+faststart',
        output,
      ]
      report(0)
      const result = await runFfmpeg(args, chunk => {
        // ffmpeg 进度：time=00:00:12.34
        const m = chunk.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
        if (m && expectedDuration > 0) {
          const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
          const pct = (t / expectedDuration) * 100
          if (Math.round(pct) > lastPct) { lastPct = Math.round(pct); report(pct) }
        }
      })
      report(100)

      if (result.code !== 0) {
        return { code: result.code, output, stderr: tail(result.stderr, 2000) }
      }
      return { code: 0, output, dir: path.dirname(output), stderr: '' }
    } catch (err) {
      return {
        code: -1,
        output: '',
        stderr: err instanceof Error ? err.message : String(err),
      }
    }
  }
)

/** 在资源管理器中定位文件。 */
ipcMain.handle('shell:revealFile', async (_e, filePath: string) => {  if (!filePath) return false
  shell.showItemInFolder(filePath)
  return true
})

/** 打开录制目录。 */
ipcMain.handle('shell:openRecordings', async () => {
  const dir = recordingsDir()
  await fs.mkdir(dir, { recursive: true })
  await shell.openPath(dir)
  return dir
})

// ---------------------------------------------------------------- 媒体资产

/**
 * 探测媒体元数据（时长/分辨率/帧率）。
 * 用 ffmpeg -i 解析 stderr，避免额外依赖 ffprobe。
 */
async function probeMedia(filePath: string): Promise<{
  duration: number
  width: number
  height: number
  fps: number
}> {
  const r = await runFfmpeg(['-hide_banner', '-i', filePath])
  const text = r.stderr

  // Duration: 00:00:03.04, start: 0.000000, bitrate: 2401 kb/s
  let duration = 0
  const dm = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (dm) {
    duration = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3])
  }

  // Video: h264 ..., 1920x1080 [SAR 1:1 DAR 16:9], 2401 kb/s, 30 fps
  let width = 0
  let height = 0
  let fps = 0
  const vm = text.match(/Video:.*?(\d{2,5})x(\d{2,5})/)
  if (vm) {
    width = Number(vm[1])
    height = Number(vm[2])
  }
  const fm = text.match(/(\d+(?:\.\d+)?)\s*fps/)
  if (fm) fps = Number(fm[1])

  return { duration, width, height, fps }
}

/**
 * 从视频均匀抽 N 帧，返回 data URL 数组，用于时间线胶片条。
 *
 * 用单次 ffmpeg 调用的 fps 滤镜一次性抽帧，而非 N 次 -ss 寻址
 * （后者每个点都要重新 seek，12 帧约 4 秒；一次调用约 0.3 秒）。
 */
async function extractThumbnails(filePath: string, count = 12, width = 160): Promise<string[]> {
  const tmpDir = path.join(os.tmpdir(), `dogsc-thumb-${Date.now()}`)
  await fs.mkdir(tmpDir, { recursive: true })
  try {
    const meta = await probeMedia(filePath)
    const duration = meta.duration > 0 ? meta.duration : 1
    // 目标：在 duration 内均匀取 count 帧
    const fps = count / duration

    const pattern = path.join(tmpDir, 'f%03d.jpg')
    await runFfmpeg([
      '-hide_banner',
      '-i', filePath,
      '-vf', `fps=${fps.toFixed(4)},scale=${width}:-2`,
      '-frames:v', String(count),
      '-q:v', '7',
      '-y', pattern,
    ])

    const files = (await fs.readdir(tmpDir))
      .filter(f => f.endsWith('.jpg'))
      .sort()
      .slice(0, count)

    const results: string[] = []
    for (const f of files) {
      const buf = await fs.readFile(path.join(tmpDir, f))
      results.push(`data:image/jpeg;base64,${buf.toString('base64')}`)
    }
    return results
  } catch {
    return []
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** 按绝对路径读取完整媒体信息 + 缩略图。 */
ipcMain.handle('media:describe', async (_e, filePath: string) => {
  try {
    if (!filePath || !path.isAbsolute(filePath)) {
      throw new Error(`需要绝对路径：${filePath}`)
    }
    const stat = await fs.stat(filePath)
    const meta = await probeMedia(filePath)
    const thumbnails = await extractThumbnails(filePath, 12)
    return {
      ok: true as const,
      path: filePath,
      name: path.basename(filePath, path.extname(filePath)),
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      size: stat.size,
      thumbnails,
    }
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
  }
})

/** 弹出文件选择框导入视频，返回选中文件的描述信息。 */
ipcMain.handle('media:import', async () => {
  const win = BrowserWindow.getAllWindows()[0]
  const picked = await dialog.showOpenDialog(win, {
    title: '导入视频',
    properties: ['openFile'],
    filters: [
      { name: '视频', extensions: ['mp4', 'webm', 'mov', 'mkv', 'avi'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (picked.canceled || picked.filePaths.length === 0) {
    return { ok: false as const, canceled: true }
  }
  const filePath = picked.filePaths[0]
  const stat = await fs.stat(filePath)
  const meta = await probeMedia(filePath)
  const thumbnails = await extractThumbnails(filePath, 12)
  return {
    ok: true as const,
    path: filePath,
    name: path.basename(filePath, path.extname(filePath)),
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    size: stat.size,
    thumbnails,
  }
})

/**
 * 选择背景媒体（EditorBackgroundInspector 的壁纸页签）。
 * 图片 → systemImage，视频 → systemVideo；只回路径，不复制进工程。
 */
ipcMain.handle('media:pickBackground', async () => {
  const win = BrowserWindow.getAllWindows()[0]
  const picked = await dialog.showOpenDialog(win, {
    title: '选择背景媒体',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      { name: '视频', extensions: ['mp4', 'webm', 'mov', 'mkv'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (picked.canceled || picked.filePaths.length === 0) {
    return { ok: false as const, canceled: true }
  }
  const filePath = picked.filePaths[0]
  const kind = /\.(png|jpe?g|webp|gif|bmp)$/i.test(filePath) ? 'image' : 'video'
  return { ok: true as const, kind, path: filePath }
})

/** 列出录制目录下已有的视频（供「最近录制」入口）。 */
ipcMain.handle('media:listRecordings', async () => {
  const dir = recordingsDir()
  try {
    const names = await fs.readdir(dir)
    const videos = names.filter(n => /\.(mp4|webm)$/i.test(n))
    const items = await Promise.all(
      videos.map(async name => {
        const full = path.join(dir, name)
        const st = await fs.stat(full).catch(() => null)
        if (!st) return null
        return {
          path: full,
          name: path.basename(name, path.extname(name)),
          size: st.size,
          createdAt: st.mtimeMs,
        }
      })
    )
    return items
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
})

/** 用系统默认播放器打开视频（作为兜底预览）。 */
ipcMain.handle('shell:openFile', async (_e, filePath: string) => {
  if (!filePath) return false
  await shell.openPath(filePath)
  return true
})

/** 把外部视频复制进录制目录，让工程引用统一。 */
ipcMain.handle('media:adopt', async (_e, filePath: string) => {
  try {
    if (!path.isAbsolute(filePath)) throw new Error('需要绝对路径')
    const dir = recordingsDir()
    await fs.mkdir(dir, { recursive: true })
    const already = path.dirname(filePath).toLowerCase() === dir.toLowerCase()
    if (already) return { ok: true as const, path: filePath }

    const ext = path.extname(filePath)
    const base = path.basename(filePath, ext)
    let target = path.join(dir, `${base}${ext}`)
    let n = 1
    while (true) {
      const exists = await fs.stat(target).catch(() => null)
      if (!exists) break
      target = path.join(dir, `${base} (${n})${ext}`)
      n += 1
    }
    await fs.copyFile(filePath, target)
    return { ok: true as const, path: target }
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
  }
})

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
}

function tail(text: string, max: number): string {
  return text.length <= max ? text : text.slice(text.length - max)
}

function resolveFfmpegPath(): string {
  // 打包后 ffmpeg 由 extraResources 放到 resources/ffmpeg/ffmpeg.exe，
  // 开发期则直接用 node_modules 里 ffmpeg-static 下载的二进制。
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe')
  }
  return requireFfmpegStatic() || 'ffmpeg'
}

function runFfmpeg(
  args: string[],
  onStderr?: (chunk: string) => void
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const bin = resolveFfmpegPath()
    const proc: ChildProcess = spawn(bin, args)
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
      onStderr?.(d.toString())
    })
    proc.on('close', code => resolve({ code: code ?? -1, stderr }))
    proc.on('error', reject)
  })
}

/** 是否含音频流（决定导出滤镜是否接音频支路）。 */
function hasAudioStream(probeText: string): boolean {
  return /Stream #\d+:\d+.*: Audio:/.test(probeText)
}
