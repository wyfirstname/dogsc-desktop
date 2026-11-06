/**
 * 媒体时间区间 —— Swift MediaTimeRange 的 TypeScript 转写。
 *
 * Swift source: Sources/RecorderCore/MediaTimeRange.swift
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 语义与原实现逐行对应：区间为 [start, end)，含边界校验。
 * 所有导出函数均为纯函数，可单测。
 */

export interface MediaTimeRange {
  /** 起点，秒。恒 >= 0 */
  readonly start: number
  /** 终点，秒。恒 > start */
  readonly end: number
}

export function makeRange(start: number, end: number): MediaTimeRange {
  if (start < 0) throw new RangeError(`start 不能为负：${start}`)
  if (end <= start) throw new RangeError(`end 必须大于 start：${end} <= ${start}`)
  return { start, end }
}

/** 区间时长 */
export function duration(r: MediaTimeRange): number {
  return r.end - r.start
}

/** 两区间是否重叠（相邻不算重叠） */
export function intersects(a: MediaTimeRange, b: MediaTimeRange): boolean {
  return a.start < b.end && b.start < a.end
}

/** 交集；不相交时返回 null */
export function intersection(a: MediaTimeRange, b: MediaTimeRange): MediaTimeRange | null {
  if (!intersects(a, b)) return null
  return { start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) }
}

/** 并集；不相交时返回 null（原版语义：不自动桥接间隙） */
export function union(a: MediaTimeRange, b: MediaTimeRange): MediaTimeRange | null {
  if (!intersects(a, b)) return null
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) }
}

/** t 是否落在区间内（含头不含尾） */
export function contains(r: MediaTimeRange, t: number): boolean {
  return t >= r.start && t < r.end
}

/** 把 t 裁剪进区间 */
export function clamp(r: MediaTimeRange, t: number): number {
  return Math.min(Math.max(t, r.start), r.end)
}

/** 按比例 t∈[0,1] 取区间内一点 */
export function lerp(r: MediaTimeRange, t: number): number {
  return r.start + (r.end - r.start) * Math.min(Math.max(t, 0), 1)
}

/** 时间格式化 00:00.00（与原版播放器显示一致） */
export function formatClock(t: number): string {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.floor((s * 100) % 100)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}
