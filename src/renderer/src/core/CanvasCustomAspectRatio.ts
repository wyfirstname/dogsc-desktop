/**
 * CanvasCustomAspectRatio — 自定义画布宽高比。
 *
 * Swift source: Sources/RecorderCore/CanvasCustomAspectRatio.swift @ laogou717/dogsc 567fd6e
 *   - struct CanvasCustomAspectRatio (L3)
 *   - extension CanvasStyle.resolvedFixedAspectRatio (L17)
 */

export interface CanvasCustomAspectRatio {
  width: number
  height: number
}

export function makeCustomAspectRatio(
  width = 16,
  height = 9
): CanvasCustomAspectRatio {
  return { width, height }
}

/** Swift `value`：非有限或非正数回落 16:9，商夹取到 [0.1, 10]。 */
export function customAspectRatioValue(ratio: CanvasCustomAspectRatio): number {
  const { width, height } = ratio
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 16 / 9
  }
  return Math.min(Math.max(width / height, 0.1), 10)
}

export function decodeCanvasCustomAspectRatio(raw: unknown): CanvasCustomAspectRatio {
  const obj = (raw ?? {}) as Record<string, unknown>
  return makeCustomAspectRatio(
    typeof obj.width === 'number' ? obj.width : 16,
    typeof obj.height === 'number' ? obj.height : 9
  )
}

// -------------------------------------------------------------- resolvedFixedAspectRatio

/**
 * extension CanvasStyle.resolvedFixedAspectRatio。
 * typeOnly 导入避免运行时循环依赖。
 */
import type { CanvasStyle } from './ProjectModel'

export function resolvedFixedAspectRatio(style: CanvasStyle): number | null {
  switch (style.aspectRatio) {
    case '适应': return null
    case '16:9': return 16 / 9
    case '9:16': return 9 / 16
    case '4:3': return 4 / 3
    case '3:4': return 3 / 4
    case '2.39:1': return 2.39
    case '1:2.39': return 1 / 2.39
    case '1:1': return 1
    case '自定义': return customAspectRatioValue(style.customAspectRatio)
  }
}
