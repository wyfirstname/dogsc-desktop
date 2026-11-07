/**
 * 摄像头素材黑边检测与裁剪 —— Swift CameraLetterboxAnalysis.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/CameraLetterboxAnalysis.swift（335 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐结构对照（Swift 行号 → 本文件）：
 *   - struct CameraLetterboxMediaVersion   (L6-21)   → CameraLetterboxMediaVersion
 *   - actor CameraLetterboxAnalysisCache   (L27-48)  → CameraLetterboxCache（LRU 8 条）
 *   - enum CameraLetterboxAnalysis         (L53-335)
 *       · normalizedContentCrop(for:)              L59-61   → cache.get
 *       · analyzeUncached(for:)                    L63-96   → 采样循环抽到 sampleFractions
 *       · contentBounds(in:)                       L101-215 → contentBounds
 *       · centralDetailedBand(_:)                  L221-265 → centralDetailedBand
 *       · stableCrop(from:)                        L270-299 → stableCrop
 *       · medianArea(_:)                           L301-305 → medianArea
 *       · cropped(_:to:)                           L309-314 → cropRect 由 coreImageCropRect 给出
 *       · coreImageCropRect(sourceExtent:crop:)    L318-328 → coreImageCropRect
 *       · croppedDisplaySize(_:crop:)              L331-334 → croppedDisplaySize
 *
 * 迁移说明：
 *   原文件用 CGImage / CGContext 做「下采样到 360 宽网格」。Electron 侧位图是
 *   RGBA 字节数组，故把入参换成 `RasterImage`，下采样用等权箱式平均重建
 *   （CGContext 的 .high 插值在 360 宽网格下与箱式平均差异远小于阈值 8.0）。
 *   **检测算法本身（阈值、间隙、聚类、y 轴翻转）逐行照搬，未做任何简化。**
 *
 * 原文件顶部注释（L50-52）：
 *   竖屏模式的运动相机/手机会把横向感光画面装进带上下黑边的竖向画框（或反之），
 *   直接进 PIP 后近乎全黑。这里按内容亮度估计真实画面包围盒，预览与导出共用同一份
 *   检测结果把黑边裁掉。
 */

import { clampedCrop, type NormalizedCrop } from './ProjectModel'

// ------------------------------------------------- CameraLetterboxMediaVersion

/**
 * Swift L6-21：缓存键。
 *
 * 只变时钟（sync-point 编辑）不改像素，因此同一份媒体文件在多次合成生成之间
 * 共享首次三帧黑边分析结果。文件系统身份 + 大小 + 修改时间足以区分「同一个路径
 * 被换成了另一份文件」。
 */
export interface CameraLetterboxMediaVersion {
  readonly path: string
  readonly fileSystemNumber: bigint | null
  readonly fileNumber: bigint | null
  readonly fileSize: bigint | null
  readonly modificationDate: number | null
}

/** Swift L13-20 的可序列化等价物；`attributes` 由调用方（主进程 stat）提供。 */
export function cameraLetterboxMediaVersion(
  path: string,
  attributes?: {
    systemNumber?: bigint | null
    systemFileNumber?: bigint | null
    size?: bigint | null
    modificationDate?: number | null
  } | null
): CameraLetterboxMediaVersion {
  return {
    path,
    fileSystemNumber: attributes?.systemNumber ?? null,
    fileNumber: attributes?.systemFileNumber ?? null,
    fileSize: attributes?.size ?? null,
    modificationDate: attributes?.modificationDate ?? null
  }
}

export function cameraLetterboxMediaVersionKey(v: CameraLetterboxMediaVersion): string {
  return [
    v.path,
    v.fileSystemNumber?.toString() ?? '-',
    v.fileNumber?.toString() ?? '-',
    v.fileSize?.toString() ?? '-',
    v.modificationDate?.toString() ?? '-'
  ].join('|')
}

// ------------------------------------------------------ CameraLetterboxCache

/**
 * Swift L27-48 `actor CameraLetterboxAnalysisCache` 的等价物。
 *
 * 原版把 `Task<NormalizedCrop?, Never>` 存进字典 —— **连 nil 结果也缓存**
 * （L26 注释：Keeping the completed Task also caches a legitimate nil result）。
 * 这里用「Promise 槽位」表达同一语义：进行中的任务共享同一个 Promise，
 * 完成后的 null 结果同样命中缓存。容量上限 8，超限时按插入顺序淘汰最早一条。
 */
export class CameraLetterboxCache {
  private readonly slots = new Map<string, Promise<NormalizedCrop | null>>()
  private readonly order: string[] = []

  constructor(private readonly capacity: number = 8) {}

  get size(): number {
    return this.slots.size
  }

  /** Swift L31-47。`analyze` 只在缓存未命中时调用一次。 */
  value(
    version: CameraLetterboxMediaVersion,
    analyze: () => Promise<NormalizedCrop | null>
  ): Promise<NormalizedCrop | null> {
    const key = cameraLetterboxMediaVersionKey(version)
    const existing = this.slots.get(key)
    if (existing) return existing

    const task = analyze()
    this.slots.set(key, task)
    this.order.push(key)
    if (this.order.length > this.capacity) {
      const expired = this.order.shift()
      if (expired !== undefined) this.slots.delete(expired)
    }
    return task
  }

  /** 测试与项目关闭时用。原版无此方法（actor 随进程存活）。 */
  clear(): void {
    this.slots.clear()
    this.order.length = 0
  }
}

/** Swift L54：进程级单例（容量 8 写在 L42）。 */
export const cameraLetterboxCache = new CameraLetterboxCache(8)

// ---------------------------------------------------------------- RasterImage

/** RGBA8 位图，行优先，`pixels.length === width * height * 4`。 */
export interface RasterImage {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8ClampedArray
}

/**
 * Swift L103-107 的网格尺寸：
 *   gridWidth  = min(image.width, 360)
 *   gridHeight = max(round(Double(image.height) / Double(image.width) * gridWidth), 1)
 *
 * 原注释（L70-73）：早先把 1080x1920 母片压到 90x160，一个检测格代表约 12 个
 * 源像素，边界插值足以在 PIP 底部留下整条黑缝；改用 640 长边 + 360 宽网格保留
 * 边界精度。`round` 走 Swift 的「四舍五入远离零」，此处用 Math.round（非负输入等价）。
 */
export function letterboxGridDimension(
  width: number,
  height: number
): { gridWidth: number; gridHeight: number } | null {
  if (!(width > 0) || !(height > 0)) return null
  const gridWidth = Math.min(width, 360)
  const gridHeight = Math.max(Math.round((height / width) * gridWidth), 1)
  return { gridWidth, gridHeight }
}

/**
 * 等权箱式下采样到网格（等价于 `context.draw(image, in: CGRect(0,0,gridWidth,gridHeight))` 的
 * high 插值近似）。返回 RGBA8 网格。
 */
export function downsampleToLetterboxGrid(
  image: RasterImage,
  gridWidth: number,
  gridHeight: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gridWidth * gridHeight * 4)
  for (let gy = 0; gy < gridHeight; gy++) {
    const y0 = Math.floor((gy * image.height) / gridHeight)
    const y1 = Math.max(Math.floor(((gy + 1) * image.height) / gridHeight), y0 + 1)
    for (let gx = 0; gx < gridWidth; gx++) {
      const x0 = Math.floor((gx * image.width) / gridWidth)
      const x1 = Math.max(Math.floor(((gx + 1) * image.width) / gridWidth), x0 + 1)
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let count = 0
      for (let y = y0; y < Math.min(y1, image.height); y++) {
        const rowBase = y * image.width * 4
        for (let x = x0; x < Math.min(x1, image.width); x++) {
          const o = rowBase + x * 4
          r += image.pixels[o]
          g += image.pixels[o + 1]
          b += image.pixels[o + 2]
          a += image.pixels[o + 3]
          count++
        }
      }
      const o = (gy * gridWidth + gx) * 4
      if (count > 0) {
        out[o] = Math.round(r / count)
        out[o + 1] = Math.round(g / count)
        out[o + 2] = Math.round(b / count)
        out[o + 3] = Math.round(a / count)
      }
    }
  }
  return out
}

// ------------------------------------------------------------ 亮度统计

/** Swift L129-131 的 luma 权重（Rec.709）。 */
export const LETTERBOX_LUMA_R = 0.2126
export const LETTERBOX_LUMA_G = 0.7152
export const LETTERBOX_LUMA_B = 0.0722

export interface LetterboxLumaProfile {
  readonly gridWidth: number
  readonly gridHeight: number
  readonly rowLuma: number[]
  readonly colLuma: number[]
  readonly rowDetail: number[]
}

/**
 * Swift L122-144：逐格算 luma，累加到行/列均值；行内相邻差累加成 `rowDetail`
 * （用于竖屏「纹理带」检测 —— 纯色亮填充和绿色错帧都纹理极低）。
 */
export function letterboxLumaProfile(
  grid: Uint8ClampedArray,
  gridWidth: number,
  gridHeight: number
): LetterboxLumaProfile {
  const rowLuma = new Array<number>(gridHeight).fill(0)
  const colLuma = new Array<number>(gridWidth).fill(0)
  const rowDetail = new Array<number>(gridHeight).fill(0)

  for (let y = 0; y < gridHeight; y++) {
    let previousLuma: number | null = null
    for (let x = 0; x < gridWidth; x++) {
      const offset = (y * gridWidth + x) * 4
      const luma =
        LETTERBOX_LUMA_R * grid[offset] +
        LETTERBOX_LUMA_G * grid[offset + 1] +
        LETTERBOX_LUMA_B * grid[offset + 2]
      rowLuma[y] += luma
      colLuma[x] += luma
      if (previousLuma != null) {
        rowDetail[y] += Math.abs(luma - previousLuma)
      }
      previousLuma = luma
    }
  }
  for (let y = 0; y < gridHeight; y++) {
    rowLuma[y] /= gridWidth
    rowDetail[y] /= Math.max(gridWidth - 1, 1)
  }
  for (let x = 0; x < gridWidth; x++) colLuma[x] /= gridHeight

  return { gridWidth, gridHeight, rowLuma, colLuma, rowDetail }
}

// -------------------------------------------------------- centralDetailedBand

export interface IndexRange {
  readonly first: number
  readonly last: number
}

/**
 * Swift L221-265：找靠近中心的那一条连续「有纹理」水平带。
 *
 * 脸/背景内部的短低纹理间隙会被桥接（allowedGap），大片均匀黑/灰留白仍在带外；
 * 整帧都损坏且纹理丰富时会得到一条近乎满幅的带，由调用方的 80% 上限拒绝。
 */
export function centralDetailedBand(rowDetail: readonly number[]): IndexRange | null {
  if (rowDetail.length < 8) return null
  const radius = 2
  const smoothed = rowDetail.map((_, index) => {
    const lower = Math.max(index - radius, 0)
    const upper = Math.min(index + radius, rowDetail.length - 1)
    let sum = 0
    for (let i = lower; i <= upper; i++) sum += rowDetail[i]
    return sum / (upper - lower + 1)
  })
  const sorted = [...smoothed].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const threshold = Math.max(2.2, median * 0.45)
  const active = smoothed.map((v) => v >= threshold)
  const allowedGap = Math.max(Math.trunc(active.length * 0.012), 2)

  const runs: IndexRange[] = []
  let start: number | null = null
  let lastActive: number | null = null
  for (let index = 0; index < active.length; index++) {
    if (!active[index]) continue
    if (lastActive != null && index - lastActive - 1 > allowedGap && start != null) {
      runs.push({ first: start, last: lastActive })
      start = null
    }
    if (start == null) start = index
    lastActive = index
  }
  if (start != null && lastActive != null) runs.push({ first: start, last: lastActive })
  if (runs.length === 0) return null

  const centre = (active.length - 1) / 2
  const minimumLength = Math.trunc(active.length * 0.08)
  const candidates = runs.filter((r) => r.last - r.first + 1 >= minimumLength)
  let best: IndexRange | null = null
  for (const candidate of candidates) {
    if (best == null) {
      best = candidate
      continue
    }
    // Swift `min(by:)`：areInIncreasingOrder(candidate, best) 为真才替换。
    const lhsDistance = Math.abs((candidate.first + candidate.last) / 2 - centre)
    const rhsDistance = Math.abs((best.first + best.last) / 2 - centre)
    const isSmaller =
      Math.abs(lhsDistance - rhsDistance) > 0.001
        ? lhsDistance < rhsDistance
        : candidate.last - candidate.first > best.last - best.first
    if (isSmaller) best = candidate
  }
  return best
}

// ------------------------------------------------------- conservativeBounds

export interface NormalizedSpan {
  readonly start: number
  readonly end: number
}

/**
 * Swift L195-206。
 *
 * 下采样后检出的第一/最后一行仍可能是「黑边与内容」的插值混合行。对确认存在
 * 黑边的一侧**内收一个高精度取样格**；满幅边仍保留到 0 / 1。
 * 这里宁可少不到 3 个源像素，也不能让解码缩放把混合行拉成可见黑缝。
 */
export function conservativeBounds(range: IndexRange, count: number): NormalizedSpan {
  const start = range.first === 0 ? 0 : (range.first + 1) / count
  const end = range.last === count - 1 ? 1 : range.last / count
  return { start, end }
}

// ------------------------------------------------------------ contentBounds

/**
 * Swift L101-215：从单张位图估计内容包围盒（归一化、左上角原点）。
 *
 * 行/列平均亮度超过阈值即视为内容；只有黑边至少占某一维 3%、且内容保留至少
 * 20% 时才认为存在黑边，避免误裁暗场素材。
 */
export function contentBounds(image: RasterImage): NormalizedCrop | null {
  if (!(image.width > 0) || !(image.height > 0)) return null
  const grid = letterboxGridDimension(image.width, image.height)
  if (grid == null) return null
  const { gridWidth, gridHeight } = grid
  if (image.pixels.length < gridWidth * gridHeight * 4 && image.pixels.length < image.width * image.height * 4) {
    return null
  }

  const downsampled =
    image.width === gridWidth && image.height === gridHeight
      ? image.pixels
      : downsampleToLetterboxGrid(image, gridWidth, gridHeight)
  const profile = letterboxLumaProfile(downsampled, gridWidth, gridHeight)
  const { rowLuma, colLuma, rowDetail } = profile

  // L146-166：竖屏容器可能同时有一条真实的横向摄像头画面带 + 黑/灰留白。
  // 亮的留白和绿色错帧都不是摄像头内容，优先取穿过画面中心的有纹理带；
  // 老亮度检测留作合成/纯色内容与 pillarbox 的回退。
  if (gridHeight > gridWidth) {
    const band = centralDetailedBand(rowDetail)
    if (band != null) {
      const bars = band.first + (gridHeight - 1 - band.last)
      const contentHeight = band.last - band.first + 1
      if (
        contentHeight >= Math.ceil(gridHeight * 0.2) &&
        contentHeight <= Math.floor(gridHeight * 0.8) &&
        bars >= gridHeight * 0.03
      ) {
        const vertical = conservativeBounds(band, gridHeight)
        return clampedCrop({
          x: 0,
          y: vertical.start,
          width: 1,
          height: vertical.end - vertical.start
        })
      }
    }
  }

  // L168-173
  const threshold = 8.0
  const contentRange = (luma: readonly number[]): IndexRange | null => {
    let first = -1
    let last = -1
    for (let i = 0; i < luma.length; i++) {
      if (luma[i] > threshold) {
        if (first < 0) first = i
        last = i
      }
    }
    if (first < 0) return null
    return { first, last }
  }
  // L174-179：行/列均值会互相稀释 —— 竖向黑边（内容带矮）把每一列的均值拉低，
  // 横向黑边（内容柱窄）把每一行的均值拉低。任一轴检出内容即可，未检出的轴
  // 视为满幅；两轴都失败才是真的没有内容。
  const rows = contentRange(rowLuma)
  const cols = contentRange(colLuma)
  if (rows == null && cols == null) return null

  const rowRange: IndexRange = rows ?? { first: 0, last: gridHeight - 1 }
  const colRange: IndexRange = cols ?? { first: 0, last: gridWidth - 1 }
  const contentWidth = colRange.last - colRange.first + 1
  const contentHeight = rowRange.last - rowRange.first + 1
  const horizontalBars = colRange.first + (gridWidth - 1 - colRange.last)
  const verticalBars = rowRange.first + (gridHeight - 1 - rowRange.last)
  if (
    !(
      contentWidth >= Math.ceil(gridWidth * 0.2) &&
      contentHeight >= Math.ceil(gridHeight * 0.2) &&
      (horizontalBars >= gridWidth * 0.03 || verticalBars >= gridHeight * 0.03)
    )
  ) {
    return null
  }

  const horizontal = conservativeBounds(colRange, gridWidth)
  const vertical = conservativeBounds(rowRange, gridHeight)
  return clampedCrop({
    x: horizontal.start,
    y: vertical.start,
    width: horizontal.end - horizontal.start,
    height: vertical.end - vertical.start
  })
}

// --------------------------------------------------------------- stableCrop

/**
 * Swift L301-305：中位面积（用于「同样大的簇里挑更保守的那个」）。
 * 空数组返回 Infinity（原版 `.infinity`）。
 */
export function medianArea(crops: readonly NormalizedCrop[]): number {
  if (crops.length === 0) return Infinity
  const areas = crops.map((c) => c.width * c.height).sort((a, b) => a - b)
  return areas[Math.floor(areas.length / 2)]
}

/**
 * Swift L270-299：把几乎相同的裁剪结果聚类，取最大簇的中位数。
 *
 * 这样单帧损坏/过暗不会把整个项目的摄像头取景带跑。原注释（L267-269）：
 * 不能取简单并集 —— 一帧亮绿色错帧就会把全片裁切区扩张到损坏区。
 */
export function stableCrop(candidates: readonly NormalizedCrop[]): NormalizedCrop | null {
  if (candidates.length === 0) return null
  const tolerance = 0.065
  let best: NormalizedCrop[] = []
  for (const reference of candidates) {
    const cluster = candidates.filter(
      (candidate) =>
        Math.abs(candidate.x - reference.x) <= tolerance &&
        Math.abs(candidate.y - reference.y) <= tolerance &&
        Math.abs(candidate.width - reference.width) <= tolerance &&
        Math.abs(candidate.height - reference.height) <= tolerance
    )
    if (cluster.length > best.length) {
      best = cluster
    } else if (cluster.length === best.length && medianArea(cluster) < medianArea(best)) {
      best = cluster
    }
  }
  if (best.length === 0) return null
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  return clampedCrop({
    x: median(best.map((c) => c.x)),
    y: median(best.map((c) => c.y)),
    width: median(best.map((c) => c.width)),
    height: median(best.map((c) => c.height))
  })
}

/**
 * Swift L84-95 的采样流程骨架：按 0.1…0.9 九等分时间点求候选裁剪，
 * 再交给 stableCrop。解码取帧由调用方提供（原版是 AVAssetImageGenerator，
 * maximumSize 640x640、时间容差 0.12s / timescale 600）。
 */
export const LETTERBOX_SAMPLE_FRACTIONS: readonly number[] = (() => {
  const fractions: number[] = []
  for (let i = 1; i <= 9; i++) fractions.push(i / 10)
  return fractions
})()

export function letterboxSampleTimes(
  duration: number,
  fractions: readonly number[] = LETTERBOX_SAMPLE_FRACTIONS
): number[] {
  return fractions.map((fraction) => duration * fraction)
}

/**
 * Swift L63-96 `analyzeUncached`：时长必须有限且 > 0.2s（否则直接放弃）。
 */
export const LETTERBOX_MINIMUM_DURATION = 0.2

export async function analyzeCameraLetterbox(
  duration: number,
  frameBounds: (time: number) => Promise<RasterImage | null | undefined> | RasterImage | null | undefined,
  options?: { isCancelled?: () => boolean; fractions?: readonly number[] }
): Promise<NormalizedCrop | null> {
  if (!Number.isFinite(duration) || !(duration > LETTERBOX_MINIMUM_DURATION)) return null
  const fractions = options?.fractions ?? LETTERBOX_SAMPLE_FRACTIONS
  const candidates: NormalizedCrop[] = []
  for (const fraction of fractions) {
    if (options?.isCancelled?.()) return null
    const image = await frameBounds(duration * fraction)
    if (image == null) continue
    const bounds = contentBounds(image)
    if (bounds == null) continue
    candidates.push(bounds)
  }
  return stableCrop(candidates)
}

// ------------------------------------------------------- Core Image 裁剪几何

/** 矩形（等价于 CGRect；Coordinate Space 为「原点在左下」的 Core Image 空间）。 */
export interface RectGeometry {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Swift L318-328：`NormalizedCrop` 约定左上角原点，Core Image 使用左下角原点。
 * 非对称黑边若不翻转 y，会裁错一边，并在画中画顶部留缝。
 */
export function coreImageCropRect(sourceExtent: RectGeometry, crop: NormalizedCrop): RectGeometry {
  return {
    x: sourceExtent.x + sourceExtent.width * crop.x,
    y: sourceExtent.y + sourceExtent.height * (1 - crop.y - crop.height),
    width: sourceExtent.width * crop.width,
    height: sourceExtent.height * crop.height
  }
}

/**
 * Swift L309-314 `cropped(_:to:)` 的纯几何部分：
 * 先按 rect 裁剪，再把原点平移回 (0,0)，保证下游用 extent 推导的几何
 * （PIP 宽高比、aspect-fill）一致。
 */
export function croppedOriginTranslation(sourceExtent: RectGeometry, crop: NormalizedCrop): RectGeometry {
  const rect = coreImageCropRect(sourceExtent, crop)
  return { x: -rect.x, y: -rect.y, width: rect.width, height: rect.height }
}

/**
 * Swift L331-334：检测后的显示尺寸 —— 几何求值（PIP 宽高比）必须使用裁掉黑边后的尺寸。
 */
export function croppedDisplaySize(
  size: { readonly width: number; readonly height: number } | null,
  crop: NormalizedCrop | null
): { readonly width: number; readonly height: number } | null {
  if (size == null || crop == null) return size
  return { width: size.width * crop.width, height: size.height * crop.height }
}
