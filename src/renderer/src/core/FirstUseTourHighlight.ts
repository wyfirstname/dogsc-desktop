/**
 * 首次使用引导的高亮形状 —— Swift FirstUseTourHighlight.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/FirstUseTourHighlight.swift（41 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - struct 字段与 Corners 枚举                     L5-12
 *   - rounded(_:corners:)                           L14-16
 *   - recorderSources / recorderInputs 两个预设      L18-19
 *   - path(in:)：inset → 按段等分 → 每段一个圆角矩形  L21-35
 *   - 上下翻转 transform（AppKit 原点在左下）         L36-39
 *
 * 原注释：形状走的是与「录制源表面」相同的 SwiftUI 路径；权限行共用一张分组卡片，
 * 因此**只有外侧两个角**是圆的（`corners: .top` / `.bottom`）。
 *
 * 迁移说明：Windows 侧没有 CGPath 也没有坐标系翻转，但「按 segments 等分 + 逐角设置
 * 圆角」这套几何必须原样保留 —— 高亮框与真实控件差 1pt，用户就会觉得引导在指别的地方。
 * 段宽公式是 `(宽 - (段数-1) × 间距) / 段数`：间距只出现在段**之间**，两端不预留。
 */

export type TourHighlightCorners = 'all' | 'top' | 'bottom'

export interface TourHighlightSpec {
  readonly radius: number
  readonly corners: TourHighlightCorners
  /** 连续曲率（squircle）；录制源预设故意关掉，因为卡片本身是直角圆角矩形。 */
  readonly continuous: boolean
  readonly segments: number
  readonly spacing: number
  readonly inset: number
}

export function tourHighlightRounded(
  radius: number,
  corners: TourHighlightCorners = 'all'
): TourHighlightSpec {
  return { radius, corners, continuous: true, segments: 1, spacing: 0, inset: 0 }
}

/** Swift L18：四个源行共用一张卡片 —— 4 段、段间 2pt、整体内缩 2pt、非连续曲率。 */
export const TOUR_HIGHLIGHT_RECORDER_SOURCES: TourHighlightSpec = {
  radius: 20,
  corners: 'all',
  continuous: false,
  segments: 4,
  spacing: 2,
  inset: 2,
}

/** Swift L19：三个输入行共用一张卡片，段间不留缝。 */
export const TOUR_HIGHLIGHT_RECORDER_INPUTS: TourHighlightSpec = {
  radius: 20,
  corners: 'all',
  continuous: false,
  segments: 3,
  spacing: 0,
  inset: 2,
}

export interface TourHighlightCornerRadii {
  readonly topLeading: number
  readonly bottomLeading: number
  readonly bottomTrailing: number
  readonly topTrailing: number
}

export interface TourHighlightSegment {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly cornerRadii: TourHighlightCornerRadii
}

export interface TourHighlightBounds {
  readonly minX: number
  readonly minY: number
  readonly width: number
  readonly height: number
}

/**
 * Swift L28-33：`.top` 只圆上两角、`.bottom` 只圆下两角、`.all` 四角全圆。
 * 注意 bottom 时 `topLeading/topTrailing` 归零，因此「只圆下角」的卡片上边缘是直角 ——
 * 这正是权限分组卡片首行/末行的外观。
 */
export function tourHighlightCornerRadii(
  radius: number,
  corners: TourHighlightCorners
): TourHighlightCornerRadii {
  const top = corners === 'bottom' ? 0 : radius
  const bottom = corners === 'top' ? 0 : radius
  return { topLeading: top, bottomLeading: bottom, bottomTrailing: bottom, topTrailing: top }
}

/** Swift `bounds.insetBy(dx: inset, dy: inset)`：负 inset 会外扩，与 CoreGraphics 一致。 */
export function tourHighlightInsetRect(
  bounds: TourHighlightBounds,
  inset: number
): TourHighlightBounds {
  return {
    minX: bounds.minX + inset,
    minY: bounds.minY + inset,
    width: bounds.width - 2 * inset,
    height: bounds.height - 2 * inset,
  }
}

/**
 * Swift `path(in:)` 的段划分。返回每段的矩形与逐角半径，调用方负责把它们画成
 * DOM / Canvas 圆角矩形。
 */
export function tourHighlightSegments(
  spec: TourHighlightSpec,
  bounds: TourHighlightBounds
): readonly TourHighlightSegment[] {
  const rect = tourHighlightInsetRect(bounds, spec.inset)
  const segments = Math.max(1, Math.trunc(spec.segments))
  const segmentWidth = (rect.width - (segments - 1) * spec.spacing) / segments
  const cornerRadii = tourHighlightCornerRadii(spec.radius, spec.corners)
  const result: TourHighlightSegment[] = []
  for (let index = 0; index < segments; index += 1) {
    result.push({
      x: rect.minX + index * (segmentWidth + spec.spacing),
      y: rect.minY,
      width: segmentWidth,
      height: rect.height,
      cornerRadii,
    })
  }
  return result
}

/**
 * Swift L36-39 的翻转：`y' = bounds.minY + bounds.maxY - y`。
 * 只有「上/下角分别圆」时才有区别 —— 忘了翻转会让 `.top` 的圆角跑到下边。
 */
export function flipTourHighlightY(y: number, bounds: TourHighlightBounds): number {
  return bounds.minY + (bounds.minY + bounds.height) - y
}
