/**
 * 指针事件时间线排序：规范化导入的指针事件，同时让常规录制路径零复制。
 *
 * Swift source: Sources/RecorderCore/PointerEventTimelineOrdering.swift @ laogou717/dogsc 567fd6e
 *
 * Quartz 事件流与工程 JSONL 本来就保持单调顺序，因此重建编辑计划时不该
 * 反复复制并排序一条本就满足求值器契约的长轨道。
 */

import type { PointerEventRecord, TimeInterval } from './ZoomAnimation'

export function pointerEventsNormalized(events: PointerEventRecord[]): boolean {
  let previousTime: TimeInterval | null = null
  for (const event of events) {
    if (!Number.isFinite(event.time)) return false
    if (previousTime !== null && event.time < previousTime) return false
    previousTime = event.time
  }
  return true
}

/**
 * 未排序时才复制 + 排序；已排序的输入原样返回（Swift 的 copy-on-write
 * 语义在 JS 里天然等价于「同一引用」）。
 */
export function normalizedPointerEvents(events: PointerEventRecord[]): PointerEventRecord[] {
  if (pointerEventsNormalized(events)) return events
  return events
    .filter(e => Number.isFinite(e.time))
    .sort((a, b) => a.time - b.time)
}
