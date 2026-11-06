/**
 * 录制标记：锚定在**原始录制**上的编辑注记，不是渲染轨道。
 *
 * Swift source: Sources/RecorderCore/RecordingMarker.swift @ laogou717/dogsc 567fd6e
 * 保留源锚点让波纹剪辑、变速与撤销共享同一份真相。
 */

import type { TimeInterval } from './ZoomAnimation'

export interface RecordingMarker {
  id: string
  sourceTime: TimeInterval
  number: number
}

export function makeRecordingMarker(opts: {
  id?: string
  sourceTime: TimeInterval
  number: number
}): RecordingMarker {
  return {
    id: opts.id ?? (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `marker-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    sourceTime: Number.isFinite(opts.sourceTime) ? Math.max(opts.sourceTime, 0) : 0,
    number: Math.max(opts.number, 1),
  }
}
