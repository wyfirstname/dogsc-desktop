/**
 * Swift source: Sources/DogSCApp/EditorTimelineAuthoredOrder.swift @ 567fd6e
 *
 * 逐结构对照：
 *   normalize(_ clips: inout [ZoomAnimationClip])    L9-15
 *   normalize(_ clips: inout [ScreenMotionClip])     L18-24
 *   normalize(_ clips: inout [CameraMotionClip])     L27-33
 *   normalize<Element>(_:by:)                        L35-45
 *
 * 手授时间线数组始终按「起始时刻」确定有序。拖动约束保证片段不会越过
 * 任一邻居，所以常见的指针移动路径只需要一次**线性逆序检查**；
 * 真正来自旧工程或畸形数据的逆序仍会得到原本的稳定排序修复。
 *
 * TS 版按约定返回**新数组 + 是否发生排序**，避免 inout 语义在 React
 * 不可变状态里产生意外原地改写。
 */

import type { ZoomAnimationClip } from './ZoomAnimation'
import type { ScreenMotionClip } from './ProjectTimeline'
import type { CameraMotionClip } from './CameraMotion'

export interface NormalizedOrder<T> {
  items: T[]
  /** true 表示发生过重排（对应 Swift 的 @discardableResult 返回值）。 */
  didSort: boolean
}

/** Swift L35-45 —— 单次线性扫描判定是否已有序。 */
function normalizeBy<T>(values: T[], precedes: (lhs: T, rhs: T) => boolean): NormalizedOrder<T> {
  if (values.length <= 1) return { items: values, didSort: false }
  for (let index = 1; index < values.length; index += 1) {
    if (precedes(values[index], values[index - 1])) {
      return { items: [...values].sort((lhs, rhs) => (precedes(lhs, rhs) ? -1 : 1)), didSort: true }
    }
  }
  return { items: values, didSort: false }
}

/** Swift L9-15。 */
export function normalizeZoomClipOrder(clips: ZoomAnimationClip[]): NormalizedOrder<ZoomAnimationClip> {
  return normalizeBy(clips, (lhs, rhs) =>
    lhs.startTime === rhs.startTime ? lhs.id < rhs.id : lhs.startTime < rhs.startTime
  )
}

/** Swift L18-24。 */
export function normalizeScreenMotionClipOrder(
  clips: ScreenMotionClip[]
): NormalizedOrder<ScreenMotionClip> {
  return normalizeBy(clips, (lhs, rhs) =>
    lhs.timing.startTime === rhs.timing.startTime
      ? lhs.id < rhs.id
      : lhs.timing.startTime < rhs.timing.startTime
  )
}

/** Swift L27-33。 */
export function normalizeCameraMotionClipOrder(
  clips: CameraMotionClip[]
): NormalizedOrder<CameraMotionClip> {
  return normalizeBy(clips, (lhs, rhs) =>
    lhs.timing.startTime === rhs.timing.startTime
      ? lhs.id < rhs.id
      : lhs.timing.startTime < rhs.timing.startTime
  )
}

/** 泛型入口（供尚未有专用包装的轨道类型使用）。 */
export function normalizeAuthoredOrderBy<T>(
  values: T[],
  precedes: (lhs: T, rhs: T) => boolean
): NormalizedOrder<T> {
  return normalizeBy(values, precedes)
}
