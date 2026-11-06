/**
 * 把指针录制器独立的宿主时钟摆放烘焙进保存的事件时刻。
 *
 * Swift source: Sources/RecorderCore/PointerTimelineAlignment.swift @ laogou717/dogsc 567fd6e
 *
 * 指针事件流可能恰好在第一帧视频之前开始；此时最后一个 pre-roll 位置
 * 成为 t=0 处的非点击种子，而不是把整条路径后移、或凭空造出一次点击。
 */

import type { PointerEventRecord, TimeInterval } from './ZoomAnimation'
import { normalizedPointerEvents } from './PointerEventTimelineOrdering'

export function alignPointerEvents(
  events: PointerEventRecord[],
  startOffset: TimeInterval,
  sourceStartTime: TimeInterval
): PointerEventRecord[] {
  const shift = Math.max(startOffset, 0) - Math.max(sourceStartTime, 0)
  if (shift === 0) return normalizedPointerEvents(events)

  let lastPreRoll: PointerEventRecord | null = null
  const aligned: PointerEventRecord[] = []

  // 实时录制器与工程加载器已保持单调顺序。正常情况共享同一份存储；
  // 只有导入或损坏的轨道才付出修复排序的代价。
  for (const event of normalizedPointerEvents(events)) {
    const time = event.time + shift
    if (time < 0) {
      lastPreRoll = event
      continue
    }
    if (aligned.length === 0 && lastPreRoll && time > 0.000001) {
      aligned.push({
        time: 0,
        location: lastPreRoll.location,
        kind: 'move',
        modifiers: lastPreRoll.modifiers,
        cursorAssetID: lastPreRoll.cursorAssetID,
      })
    }
    aligned.push({
      time: Math.max(time, 0),
      location: event.location,
      kind: event.kind,
      modifiers: event.modifiers,
      cursorAssetID: event.cursorAssetID,
    })
  }

  if (aligned.length === 0 && lastPreRoll) {
    aligned.push({
      time: 0,
      location: lastPreRoll.location,
      kind: 'move',
      modifiers: lastPreRoll.modifiers,
      cursorAssetID: lastPreRoll.cursorAssetID,
    })
  }
  return aligned
}
