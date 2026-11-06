/**
 * 媒体资产与项目数据模型。
 *
 * Swift source: Sources/RecorderCore/ProjectModel.swift @ laogou717/dogsc 567fd6e
 *
 * 原项目语义：录制完成 → 立即成为「项目」（Recording → Project），
 * 而非把视频「导入」进一个已存在的时间线。因此这里的 MediaAsset
 * 既是录制产物，也是导入产物，二者走同一条数据通路。
 */

/** 一条媒体资产（录屏或导入的视频）。 */
export interface MediaAsset {
  /** 稳定 ID，用于 React key 与工程引用。 */
  id: string
  /** 绝对路径（磁盘上的 mp4）。 */
  path: string
  /** 展示名（不含扩展名）。 */
  name: string
  /** 时长（秒）。 */
  duration: number
  width: number
  height: number
  fps: number
  /** 文件字节数。 */
  size: number
  /** 来源：录制 or 本地导入。 */
  origin: 'recording' | 'import'
  /** 生成时间戳（ms）。 */
  createdAt: number
  /** 时间线缩略图（data URL，由 ffmpeg 抽帧得到）。 */
  thumbnails?: string[]
}

/** 打开一个项目的来源：两者都落到同一份 EditorProject。 */
export type ProjectOrigin = 'record' | 'import' | 'empty'

export interface EditorProject {
  title: string
  origin: ProjectOrigin
  asset: MediaAsset | null
}

export function makeEmptyProject(): EditorProject {
  return { title: '未命名项目', origin: 'empty', asset: null }
}

export function makeProjectFromAsset(asset: MediaAsset): EditorProject {
  return {
    title: asset.name,
    origin: asset.origin === 'recording' ? 'record' : 'import',
    asset,
  }
}

/** 秒 → 00:00.00 显示格式（与原版时间码一致）。 */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(seconds, 0) : 0
  const m = Math.floor(safe / 60)
  const s = Math.floor(safe % 60)
  const cs = Math.floor((safe % 1) * 100)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** 字节 → 人类可读大小。 */
export function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}
