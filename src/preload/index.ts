/**
 * 预加载脚本：向渲染进程暴露最小必要的 API。
 * 不暴露 nodeIntegration，只开白名单通道。
 */
import { contextBridge, ipcRenderer } from 'electron'

export interface CaptureSource {
  id: string
  name: string
  type: 'screen' | 'window'
  thumbnail: string | null
  appIcon?: string | null
}

export interface SaveRecordingResult {
  path: string
  dir: string
  size: number
}

export interface ExportResult {
  code: number
  output: string
  dir?: string
  stderr: string
}

/** 媒体元数据（探测 + 缩略图）。 */
export interface MediaDescription {
  ok: boolean
  path?: string
  name?: string
  duration?: number
  width?: number
  height?: number
  fps?: number
  size?: number
  thumbnails?: string[]
  error?: string
  canceled?: boolean
}

export interface RecordingListItem {
  path: string
  name: string
  size: number
  createdAt: number
}

contextBridge.exposeInMainWorld('dogsc', {
  /** 列出录制源。withThumbnails=false 可跳过耗时的缩略图抓取。 */
  listCaptureSources: (opts?: { withThumbnails?: boolean; thumbnailWidth?: number }) =>
    ipcRenderer.invoke('capture:sources', opts) as Promise<CaptureSource[]>,

  /** 单独补屏幕缩略图（窗口缩略图量大，按需再取）。 */
  loadThumbnails: (width?: number) =>
    ipcRenderer.invoke('capture:thumbnails', width) as Promise<
      { id: string; thumbnail: string | null }[]
    >,

  /** 把录好的 webm 数据落盘，返回绝对路径。 */
  saveRecording: (data: ArrayBuffer, name?: string) =>
    ipcRenderer.invoke('recording:save', { data, name }) as Promise<SaveRecordingResult>,

  /** webm → mp4。 */
  exportToMp4: (opts: { input: string; output?: string; fps?: number }) =>
    ipcRenderer.invoke('export:toMp4', opts) as Promise<ExportResult>,

  /** 按剪辑时间线导出成片；进度经 onExportProgress 推送（0~100）。 */
  exportTimeline: (opts: {
    input: string
    segments: { sourceStart: number; sourceDuration: number; playbackRate: number }[]
    output?: string
  }) => ipcRenderer.invoke('export:timeline', opts) as Promise<ExportResult & { code: number }>,

  /** 订阅导出进度。 */
  onExportProgress: (cb: (pct: number) => void) => {
    const listener = (_e: unknown, pct: number) => cb(pct)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },

  /** 在资源管理器中定位文件。 */
  revealFile: (filePath: string) => ipcRenderer.invoke('shell:revealFile', filePath) as Promise<boolean>,

  /** 打开录制目录。 */
  openRecordings: () => ipcRenderer.invoke('shell:openRecordings') as Promise<string>,

  // ------------------------------------------------------------ 媒体资产

  /** 读取某个视频的元数据与缩略图（录制完成后自动导入用）。 */
  describeMedia: (filePath: string) =>
    ipcRenderer.invoke('media:describe', filePath) as Promise<MediaDescription>,

  /** 弹窗选择一个视频并导入。 */
  importMedia: () => ipcRenderer.invoke('media:import') as Promise<MediaDescription>,

  /** 列出录制目录下已有视频。 */
  listRecordings: () => ipcRenderer.invoke('media:listRecordings') as Promise<RecordingListItem[]>,

  /** 用系统默认播放器打开。 */
  openFile: (filePath: string) => ipcRenderer.invoke('shell:openFile', filePath) as Promise<boolean>,

  /** 把外部视频复制进录制目录。 */
  adoptMedia: (filePath: string) =>
    ipcRenderer.invoke('media:adopt', filePath) as Promise<{ ok: boolean; path?: string; error?: string }>,

  /** 弹窗选择背景媒体（图片或视频），返回绝对路径与类型。 */
  pickBackgroundMedia: () =>
    ipcRenderer.invoke('media:pickBackground') as Promise<{
      ok: boolean
      canceled?: boolean
      kind?: 'image' | 'video'
      path?: string
      error?: string
    }>
})
