/**
 * 选区工具栏布局 —— Swift CaptureAreaSelectionLayout.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/CaptureAreaSelectionLayout.swift（26 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - scale(in:preferred:)                            L6-8  → captureAreaSelectionScale
 *   - toolbarFrame(for:in:scale:)                     L10-25 → captureAreaToolbarFrame
 *
 * 原注释（L3-4）：
 *   Toolbar geometry uses the desktop's available area. The selected recording
 *   rectangle continues to use the complete display, including menu bar/Dock.
 *
 * 即：工具栏只在**可用区**（去掉菜单栏/程序坞）里摆，但选区矩形仍按整块屏幕算。
 */

/** Swift 里的两处魔法尺寸。 */
export const CAPTURE_AREA_TOOLBAR_WIDTH = 642
export const CAPTURE_AREA_TOOLBAR_HEIGHT = 60
/** 两侧各 12pt 安全边距（`insetBy` 在算尺寸时按 24 计）。 */
export const CAPTURE_AREA_SAFE_MARGIN = 12
/** 选区与工具栏之间的间距。 */
export const CAPTURE_AREA_TOOLBAR_GAP = 14

export interface RectLike {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const rectMinY = (r: RectLike): number => r.y
export const rectMaxY = (r: RectLike): number => r.y + r.height
export const rectMinX = (r: RectLike): number => r.x
export const rectMaxX = (r: RectLike): number => r.x + r.width
export const rectMidX = (r: RectLike): number => r.x + r.width / 2

/**
 * Swift L6-8：
 *   min(preferred, available.width / (642 + 24), available.height / (60 + 24))
 */
export function captureAreaSelectionScale(available: RectLike, preferred: number): number {
  return Math.min(
    preferred,
    available.width / (CAPTURE_AREA_TOOLBAR_WIDTH + CAPTURE_AREA_SAFE_MARGIN * 2),
    available.height / (CAPTURE_AREA_TOOLBAR_HEIGHT + CAPTURE_AREA_SAFE_MARGIN * 2)
  )
}

/**
 * Swift L10-25：优先贴在选区下方，其次上方，都不行就夹进安全区并允许压在选区上。
 *
 * 坐标系与 AppKit 一致（原点左下、y 向上），"below" 指 y 更小的一侧。
 */
export function captureAreaToolbarFrame(
  selection: RectLike,
  available: RectLike,
  scale: number
): RectLike {
  const width = CAPTURE_AREA_TOOLBAR_WIDTH * scale
  const height = CAPTURE_AREA_TOOLBAR_HEIGHT * scale
  const safe = {
    x: available.x + CAPTURE_AREA_SAFE_MARGIN * scale,
    y: available.y + CAPTURE_AREA_SAFE_MARGIN * scale,
    width: Math.max(available.width - CAPTURE_AREA_SAFE_MARGIN * 2 * scale, 0),
    height: Math.max(available.height - CAPTURE_AREA_SAFE_MARGIN * 2 * scale, 0)
  }
  const safeMinY = rectMinY(safe)
  const safeMaxY = rectMaxY(safe)
  const safeMinX = rectMinX(safe)
  const safeMaxX = rectMaxX(safe)

  const below = rectMinY(selection) - height - CAPTURE_AREA_TOOLBAR_GAP * scale
  const above = rectMaxY(selection) + CAPTURE_AREA_TOOLBAR_GAP * scale

  let y: number
  if (below >= safeMinY && below + height <= safeMaxY) {
    y = below
  } else if (above >= safeMinY && above + height <= safeMaxY) {
    y = above
  } else {
    y = Math.min(Math.max(below, safeMinY), safeMaxY - height)
  }
  const x = Math.min(Math.max(rectMidX(selection) - width / 2, safeMinX), safeMaxX - width)
  return { x, y, width, height }
}
