/**
 * 合成几何基础类型。
 *
 * Swift source: Sources/RecorderCore/ProjectModel.swift @ laogou717/dogsc 567fd6e
 *   - struct CompositionPoint
 *   - struct CompositionRect
 */

/** 画布空间中的一个点（左上原点，像素或归一化单位由调用方约定）。 */
export interface CompositionPoint {
  x: number
  y: number
}

/** 画布空间中的一个矩形。 */
export interface CompositionRect {
  x: number
  y: number
  width: number
  height: number
}

export function makePoint(x: number, y: number): CompositionPoint {
  return { x, y }
}

export function makeRect(x: number, y: number, width: number, height: number): CompositionRect {
  return { x, y, width, height }
}

export function rectMidX(rect: CompositionRect): number {
  return rect.x + rect.width / 2
}

export function rectMidY(rect: CompositionRect): number {
  return rect.y + rect.height / 2
}

export function rectMid(rect: CompositionRect): CompositionPoint {
  return { x: rectMidX(rect), y: rectMidY(rect) }
}
