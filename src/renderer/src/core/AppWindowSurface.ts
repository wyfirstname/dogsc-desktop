/**
 * 宿主窗口圆角裁剪 —— Swift AppWindowSurface.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/AppWindowSurface.swift（17 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - wantsLayer = true                          L9
 *   - CATransaction 关闭隐式动画                 L10-11 / L15
 *   - cornerRadius = min(radius, min(w, h)/2)    L12
 *   - cornerCurve = .continuous                  L13
 *   - masksToBounds = true                       L14
 *
 * 原注释：必须在 WindowServer 采样窗口阴影**之前**就让原生宿主的 alpha 轮廓与
 * SwiftUI 表面一致 —— 包括拖拽改尺寸的中间帧。否则每一帧都会按「方角」算阴影，
 * 圆角边缘出现一圈脏边。
 *
 * 迁移说明：Electron 的 BrowserWindow 用 `roundedCorners` + CSS `border-radius`
 * 达成同一效果；这里搬的是「半径夹取」这条唯一会算错的地方：
 * 半径永远不能超过短边的一半，否则圆角会互相切掉变成胶囊/畸形。
 */

/** 连续曲率（Apple 的 "squircle"），与 CSS 的 `border-radius` 不同但视觉一致。 */
export const WINDOW_SURFACE_CORNER_CURVE = 'continuous'

/** 圆角必须裁剪子视图（Swift `masksToBounds`）。 */
export const WINDOW_SURFACE_MASKS_TO_BOUNDS = true

/**
 * Swift `min(radius, min(view.bounds.width, view.bounds.height) / 2)`。
 * 负半径按 0 处理（CoreAnimation 也不会画负圆角），NaN 同样归 0。
 */
export function windowSurfaceCornerRadius(radius: number, width: number, height: number): number {
  const limit = Math.min(width, height) / 2
  const clamped = Math.min(radius, limit)
  if (!Number.isFinite(clamped) || clamped < 0) return 0
  return clamped
}

export interface WindowSurfaceStyle {
  readonly cornerRadius: number
  readonly cornerCurve: string
  readonly masksToBounds: boolean
}

/** 一次性给出 `AppWindowSurface.clip(_:radius:)` 写入图层的三个属性。 */
export function appWindowSurfaceStyle(radius: number, width: number, height: number): WindowSurfaceStyle {
  return {
    cornerRadius: windowSurfaceCornerRadius(radius, width, height),
    cornerCurve: WINDOW_SURFACE_CORNER_CURVE,
    masksToBounds: WINDOW_SURFACE_MASKS_TO_BOUNDS,
  }
}
