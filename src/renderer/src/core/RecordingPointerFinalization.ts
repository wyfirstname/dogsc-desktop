/**
 * 录制指针收尾 —— Swift RecordingPointerFinalization.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/RecordingPointerFinalization.swift（49 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - struct RecordingPointerFinalizationResult  L8-11  → RecordingPointerFinalizationResult
 *   - prepare(...)                               L14-39 → prepareRecordingPointerFinalization
 *   - persist(_:session:)                        L41-48 → persistRecordingPointerEvents
 *
 * 原注释（L4-7）：
 *   Immutable result of the CPU-heavy pointer work performed after all capture
 *   tracks have stopped. Keeping this outside AppModel makes it safe to execute
 *   on a detached user-initiated task without publishing half-finished editor
 *   state through MainActor.
 *
 * 即：所有采集轨停止后的重活都在后台跑，结果整块带回，绝不把半成品发布到 UI。
 */

import type { PointerEventRecord, TimeInterval, ZoomAnimationClip, ZoomEasingPreset } from './ZoomAnimation'
import { alignPointerEvents } from './PointerTimelineAlignment'
import { makeAutoZoomAnimations } from './AutoZoomPlanner'

/** Swift L8-11。 */
export interface RecordingPointerFinalizationResult {
  readonly events: PointerEventRecord[]
  readonly automaticZoomAnimations: ZoomAnimationClip[]
}

/**
 * Swift L14-39。
 *
 * 三步，三步之间各一次取消检查（大事件轨的对齐与自动运镜规划都可能要几百毫秒）。
 * `createsAutomaticZooms == false` 时把事件传空数组 —— 对齐仍要做，规划直接跳过。
 */
export function prepareRecordingPointerFinalization(
  events: readonly PointerEventRecord[],
  options: {
    startOffset: TimeInterval
    sourceStartTime: TimeInterval
    createsAutomaticZooms: boolean
    easing: ZoomEasingPreset
    transitionDuration: TimeInterval
    checkCancellation?: () => void
  }
): RecordingPointerFinalizationResult {
  options.checkCancellation?.()
  const aligned = alignPointerEvents([...events], options.startOffset, options.sourceStartTime)
  options.checkCancellation?.()
  const animations = makeAutoZoomAnimations(options.createsAutomaticZooms ? aligned : [], {
    easing: options.easing,
    transitionDuration: options.transitionDuration
  })
  options.checkCancellation?.()
  return { events: aligned, automaticZoomAnimations: animations }
}

/** `ProjectStore.savePointerEvents` 的最小端口（主进程实现）。 */
export interface PointerEventStore {
  savePointerEvents(events: readonly PointerEventRecord[], session: unknown): void | Promise<void>
}

/**
 * Swift L41-48：写盘前后各一次取消检查 —— 取消必须能打断一次大文件写。
 */
export async function persistRecordingPointerEvents(
  events: readonly PointerEventRecord[],
  session: unknown,
  store: PointerEventStore,
  options?: { checkCancellation?: () => void }
): Promise<void> {
  options?.checkCancellation?.()
  await store.savePointerEvents(events, session)
  options?.checkCancellation?.()
}
