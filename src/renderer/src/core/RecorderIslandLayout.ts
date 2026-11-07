/**
 * 录制胶囊的窗口布局 —— Swift RecorderIslandLayout.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/RecorderIslandLayout.swift（32 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - compact(_ size:)                        L9-11
 *   - morph(from:to:retaining:)：取三者最大    L18-22
 *   - canvas 放大（弹簧过冲 + 6pt 模糊留白）    L24-29
 *   - placementSize = peak                    L30
 *
 * 原注释：胶囊静止时保持紧凑；SwiftUI 弹簧期间原生窗口只提供**绘制空间**，
 * 它既不做动画也不裁剪胶囊。因此 canvas 必须一次放大到位，之后只增不减 ——
 * 重新指向（retarget）时若把 canvas 缩小，正在跑的弹簧会被裁边。
 */

export interface IslandSize {
  readonly width: number
  readonly height: number
}

export interface RecorderIslandLayout {
  /** 原生窗口的绘制空间（不小于任何一帧的内容）。 */
  readonly canvasWidth: number
  readonly canvasHeight: number
  /** 内容摆放尺寸（弹簧当前目标）。 */
  readonly placementWidth: number
  readonly placementHeight: number
}

/** Swift `RecorderIslandLayout.compact(_:)`：静止态 canvas == 内容。 */
export function compactIslandLayout(size: IslandSize): RecorderIslandLayout {
  return {
    canvasWidth: size.width,
    canvasHeight: size.height,
    placementWidth: size.width,
    placementHeight: size.height,
  }
}

/** 内容模糊自身的扩散半径（原注释的 "6 pt blur"），按短边留白的一半估算进 canvas。 */
export const ISLAND_CONTENT_BLUR = 6

/** canvas 宽度留白下限：`max(16, ceil(peak.width * 0.05))`。 */
export function islandCanvasHorizontalMargin(peakWidth: number): number {
  return Math.max(16, Math.ceil(peakWidth * 0.05))
}

/** canvas 高度固定多留 32pt（上下各 16）。 */
export const ISLAND_CANVAS_VERTICAL_SLACK = 32

/**
 * Swift `morph(from:to:retaining:)`。
 *
 * `peak` 取「旧尺寸 / 新尺寸 / 当前摆放尺寸」三者的逐轴最大 —— 因为一次重指向
 * 可能发生在上一段弹簧还没结束的时候，此时内容仍可能比两端都大。
 */
export function morphIslandLayout(
  oldSize: IslandSize,
  newSize: IslandSize,
  current: RecorderIslandLayout
): RecorderIslandLayout {
  const peakWidth = Math.max(oldSize.width, newSize.width, current.placementWidth)
  const peakHeight = Math.max(oldSize.height, newSize.height, current.placementHeight)
  const margin = islandCanvasHorizontalMargin(peakWidth)
  return {
    canvasWidth: Math.max(current.canvasWidth, peakWidth + 2 * margin),
    canvasHeight: Math.max(current.canvasHeight, peakHeight + ISLAND_CANVAS_VERTICAL_SLACK),
    placementWidth: peakWidth,
    placementHeight: peakHeight,
  }
}
