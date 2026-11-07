/**
 * 时间线摄像头同步 —— Swift EditorTimelineCameraSync.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorTimelineCameraSync.swift（58 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - dismissCameraSyncSelection()        L7-12   → cameraSyncDismissal
 *   - removeCameraSyncAnchor(id:)         L14-32  → removeCameraSyncAnchor
 *   - presentedCameraSyncAnchor(id:)      L34-37  → presentedCameraSyncAnchor
 *   - cameraSyncDisplayRange              L39-43  → cameraSyncDisplayRange
 *   - cameraSyncY(offset:displayRange:)   L45-53  → cameraSyncY
 *   - cameraSyncOffsetLabel(_:)           L55-57  → cameraSyncOffsetLabel
 *
 * 迁移说明：本项目其它部分（`ProjectTimelineEditing`、`TimelineMap`）已提供锚点
 * 数据操作，这里只保留**同步点轨的呈现决策**：草稿优先、删除后是否试听、y 映射。
 */

import type { MediaSyncAnchor } from './ProjectMediaModel'

/** Swift L49-50：同步点轨中心线 41、振幅 14。 */
export const CAMERA_SYNC_TRACK_CENTER_Y = 41
export const CAMERA_SYNC_TRACK_AMPLITUDE = 14

/** Swift L51：归一化时 displayRange 的下限。 */
export const CAMERA_SYNC_MINIMUM_DISPLAY_RANGE = 0.001

/** Swift L7-12：关闭同步点选择时同时要做的四件事。 */
export interface CameraSyncDismissal {
  readonly cancelAudition: true
  readonly clearAnchorDrag: true
  readonly clearSelection: true
  readonly resignFirstResponder: true
}

export const CAMERA_SYNC_DISMISSAL: CameraSyncDismissal = {
  cancelAudition: true,
  clearAnchorDrag: true,
  clearSelection: true,
  resignFirstResponder: true
}

/** Swift L34-37：拖动中的草稿优先于已提交数据。 */
export function presentedCameraSyncAnchor(
  anchorID: string,
  anchors: readonly MediaSyncAnchor[],
  drag: { readonly originalID: string; readonly draft: MediaSyncAnchor } | null
): MediaSyncAnchor | null {
  if (drag != null && drag.originalID === anchorID) return drag.draft
  return anchors.find((anchor) => anchor.id === anchorID) ?? null
}

/** Swift L39-43：呈现范围来自派生缓存。 */
export function cameraSyncDisplayRange(
  anchors: readonly MediaSyncAnchor[],
  maximumAbsoluteOffset: (anchors: readonly MediaSyncAnchor[]) => number
): number {
  return maximumAbsoluteOffset(anchors)
}

/**
 * Swift L45-53：偏移 → 轨道 y。
 * 归一化 `offset / displayRange` 夹到 ±1（超出范围不会画出轨道），
 * 再乘振幅从中心线上下对称偏移。
 */
export function cameraSyncY(offset: number, displayRange: number): number {
  const range = Math.max(displayRange, CAMERA_SYNC_MINIMUM_DISPLAY_RANGE)
  const normalized = Math.min(Math.max(offset / range, -1), 1)
  return CAMERA_SYNC_TRACK_CENTER_Y - normalized * CAMERA_SYNC_TRACK_AMPLITUDE
}

/**
 * Swift L55-57：`String(format: "%+d ms", Int((offset * 1000).rounded()))`
 * —— 恒带符号（`+` / `-`），四舍五入到毫秒。
 */
export function cameraSyncOffsetLabel(offset: number): string {
  const milliseconds = Math.trunc(Math.round(offset * 1000))
  const sign = milliseconds >= 0 ? '+' : '-'
  return `${sign}${Math.abs(milliseconds)} ms`
}

/** Swift L14-32 的决策结果：删除锚点之后要不要按时间试听。 */
export interface CameraSyncAnchorRemoval {
  readonly anchors: MediaSyncAnchor[]
  readonly removed: MediaSyncAnchor | null
  /** 删除后若该锚点被选中则清空选择。 */
  readonly clearsSelection: boolean
  /** 需要试听的输出时间（源时间能映射到时才有）。 */
  readonly auditionOutputTime: number | null
}

export function removeCameraSyncAnchor(
  anchorID: string,
  anchors: readonly MediaSyncAnchor[],
  selectedAnchorID: string | null,
  outputTimeForSourceTime: (sourceTime: number) => number | null
): CameraSyncAnchorRemoval {
  const removed = anchors.find((anchor) => anchor.id === anchorID) ?? null
  const remaining = anchors.filter((anchor) => anchor.id !== anchorID)
  const auditionOutputTime =
    removed != null ? outputTimeForSourceTime(removed.sourceTime) : null
  return {
    anchors: remaining,
    removed,
    clearsSelection: selectedAnchorID === anchorID,
    auditionOutputTime
  }
}
