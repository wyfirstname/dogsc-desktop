/**
 * TimelineMediaPlan —— 由唯一权威 TimelineMap 生成的最终时钟媒体摆放。
 *
 * Swift source: Sources/RecorderCore/TimelineMediaPlan.swift @ laogou717/dogsc 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct TimelineMediaSlice                     L5-45   → TimelineMediaSlice
 *   - struct TimelineMediaPlan（两个 init + 查询）   L50-231 → TimelineMediaPlan
 *   - struct ProjectTimelineMediaPlan               L238-350→ ProjectTimelineMediaPlan
 *   - enum AuxiliaryMediaClockAlignment             L355-375→ auxiliaryMediaClockAlignment
 *
 * 预览合成与导出读取器共用同一份计划：任何实现都不允许在此之后自造偏移
 * 或剪切映射。
 */

import type { TimeInterval } from './ZoomAnimation'
import type { PointerEventRecord } from './ZoomAnimation'
import { MediaSyncAnchorCurve, MediaTimelinePlacement } from './MediaTimeline'
import type { MediaSyncAnchor, ProjectMediaManifest, ProjectMediaReference } from './ProjectMediaModel'
import type { MediaTimeRange } from './MediaTimeRange'
import type { RecorderProject } from './ProjectMediaModel'
import type { SourceSequence } from './ProjectTimeline'
import { TimelineMap, resolvedOutputDuration, resolvedOutputEnd, resolvedSourceEnd } from './TimelineMap'
import { ProjectPointerTrack } from './ProjectPointerTrack'
import { alignPointerEvents } from './PointerTimelineAlignment'

/**
 * 只用于把算术结果吸附回已创作的主剪切点，远小于任何一帧媒体，
 * 因此真实的相机/音频缺口仍然是缺口。
 */
const NUMERICAL_BOUNDARY_TOLERANCE = 0.000_000_001

export function isSameBoundary(lhs: TimeInterval, rhs: TimeInterval): boolean {
  return Math.abs(lhs - rhs) <= NUMERICAL_BOUNDARY_TOLERANCE
}

/** Swift TimelineMediaSlice（L5-45）。 */
export interface TimelineMediaSlice {
  id: string
  segmentID: string
  outputStart: TimeInterval
  sourceStart: TimeInterval
  duration: TimeInterval
  sourceTimeScale: number
}

export function sliceOutputEnd(slice: TimelineMediaSlice): TimeInterval {
  return slice.outputStart + slice.duration
}

export function sliceSourceEnd(slice: TimelineMediaSlice): TimeInterval {
  return slice.sourceStart + slice.duration * slice.sourceTimeScale
}

/**
 * Swift TimelineMediaSlice.sourceTime(atOutputTime:)（L33-44）。
 * `slice(atOutputTime:)` 可能故意把比作者剪切点低几个 ulps 的时间点分给下一片；
 * 这里把纯表示误差夹回片头，避免第二次严格比较把选中的片变成空洞。
 */
export function sliceSourceTime(
  slice: TimelineMediaSlice,
  time: TimeInterval
): TimeInterval | null {
  if (
    !Number.isFinite(time) ||
    !(time > slice.outputStart || isSameBoundary(time, slice.outputStart)) ||
    !(time < sliceOutputEnd(slice))
  ) {
    return null
  }
  const elapsed = Math.max(time - slice.outputStart, 0)
  return slice.sourceStart + elapsed * slice.sourceTimeScale
}

/** Swift TimelineMediaPlan（L50-231）。 */
export class TimelineMediaPlan {
  readonly outputDuration: TimeInterval
  readonly slices: TimelineMediaSlice[]

  private constructor(outputDuration: TimeInterval, slices: TimelineMediaSlice[]) {
    this.outputDuration = outputDuration
    this.slices = slices
  }

  /**
   * Swift init(primary:)（L59-71）：主视频与输出时钟 1:1 对应。
   */
  static fromPrimary(timelineMap: TimelineMap): TimelineMediaPlan {
    return new TimelineMediaPlan(
      timelineMap.outputDuration,
      timelineMap.segments.map((segment) => ({
        id: segment.id,
        segmentID: segment.id,
        outputStart: segment.outputStart,
        sourceStart: segment.sourceStart,
        duration: resolvedOutputDuration(segment),
        sourceTimeScale: segment.playbackRate,
      }))
    )
  }

  /**
   * Swift init(timelineMap:auxiliary:syncAnchors:sourceAvailableRange:)（L76-190）。
   * 把辅助相机/麦克风摆放与每个保留的主片段求交：缺口仍是缺口，
   * 存活切片与录屏共用同一条输出时钟。
   */
  static fromAuxiliary(
    timelineMap: TimelineMap,
    placement: MediaTimelinePlacement,
    syncAnchors: readonly MediaSyncAnchor[] = [],
    sourceAvailableRange: MediaTimeRange | null = null
  ): TimelineMediaPlan {
    const outputDuration = timelineMap.outputDuration
    if (syncAnchors.length === 0) {
      const slices: TimelineMediaSlice[] = []
      for (const segment of timelineMap.segments) {
        const segmentSourceEnd = resolvedSourceEnd(segment)
        const retainedStart = Math.max(segment.sourceStart, placement.timelineStart)
        const retainedEnd = Math.min(segmentSourceEnd, placement.timelineEnd)
        const startsAtPrimaryBoundary = isSameBoundary(retainedStart, segment.sourceStart)
        const endsAtPrimaryBoundary = isSameBoundary(retainedEnd, segmentSourceEnd)
        const outputStart = startsAtPrimaryBoundary
          ? segment.outputStart
          : segment.outputStart + (retainedStart - segment.sourceStart) / segment.playbackRate
        let duration: TimeInterval
        if (startsAtPrimaryBoundary && endsAtPrimaryBoundary) {
          // 直接复用主片段时长。重算 `(sourceStart + duration) - sourceStart`
          // 可能少几个 ulps，在剪切点留下微孔，60fps 落在孔里就丢相机。
          duration = resolvedOutputDuration(segment)
        } else {
          const outputEnd = endsAtPrimaryBoundary
            ? resolvedOutputEnd(segment)
            : segment.outputStart + (retainedEnd - segment.sourceStart) / segment.playbackRate
          duration = outputEnd - outputStart
        }
        if (!(duration > 0)) continue
        slices.push({
          id: segment.id,
          segmentID: segment.id,
          outputStart,
          sourceStart: placement.sourceTimeAt(retainedStart) ?? placement.sourceStart,
          duration,
          sourceTimeScale: placement.sourceTimeScale * segment.playbackRate,
        })
      }
      return new TimelineMediaPlan(outputDuration, slices)
    }

    const curve = new MediaSyncAnchorCurve([...syncAnchors])
    const availableStart = sourceAvailableRange ? sourceAvailableRange.start : 0
    const availableEnd = sourceAvailableRange ? sourceAvailableRange.end : Number.MAX_VALUE
    const slices: TimelineMediaSlice[] = []
    for (const segment of timelineMap.segments) {
      const segmentSourceEnd = resolvedSourceEnd(segment)
      const retainedStart = Math.max(segment.sourceStart, placement.timelineStart)
      const retainedEnd = Math.min(segmentSourceEnd, placement.timelineEnd)
      if (!(retainedEnd - retainedStart > 0.000_001)) continue

      const boundaries: TimeInterval[] = [retainedStart]
      for (const anchor of syncAnchors) {
        if (
          anchor.sourceTime > retainedStart + 0.000_001 &&
          anchor.sourceTime < retainedEnd - 0.000_001
        ) {
          boundaries.push(anchor.sourceTime)
        }
      }
      boundaries.push(retainedEnd)
      boundaries.sort((lhs, rhs) => lhs - rhs)

      for (let index = 0; index + 1 < boundaries.length; index += 1) {
        const primaryStart = boundaries[index]
        const primaryEnd = boundaries[index + 1]
        const startsAtPrimaryBoundary = isSameBoundary(primaryStart, segment.sourceStart)
        const endsAtPrimaryBoundary = isSameBoundary(primaryEnd, segmentSourceEnd)
        const outputStart = startsAtPrimaryBoundary
          ? segment.outputStart
          : segment.outputStart + (primaryStart - segment.sourceStart) / segment.playbackRate
        const outputEnd = endsAtPrimaryBoundary
          ? resolvedOutputEnd(segment)
          : segment.outputStart + (primaryEnd - segment.sourceStart) / segment.playbackRate
        const duration =
          startsAtPrimaryBoundary && endsAtPrimaryBoundary
            ? resolvedOutputDuration(segment)
            : outputEnd - outputStart
        if (!(duration > 0.000_001)) continue

        const baseStart =
          placement.sourceStart +
          (primaryStart - placement.timelineStart) * placement.sourceTimeScale
        const baseEnd =
          placement.sourceStart +
          (primaryEnd - placement.timelineStart) * placement.sourceTimeScale
        const correctedStart = Math.min(
          Math.max(baseStart + curve.offsetAt(primaryStart), availableStart),
          availableEnd
        )
        const correctedEnd = Math.min(
          Math.max(baseEnd + curve.offsetAt(primaryEnd), availableStart),
          availableEnd
        )
        const correctedDuration = correctedEnd - correctedStart
        if (!(correctedDuration > 0.000_001)) continue

        slices.push({
          id: segment.id,
          segmentID: segment.id,
          outputStart,
          sourceStart: correctedStart,
          duration,
          sourceTimeScale: correctedDuration / duration,
        })
      }
    }
    return new TimelineMediaPlan(outputDuration, slices)
  }

  /** Swift playableDuration（L192-194）。 */
  get playableDuration(): TimeInterval {
    return this.slices.reduce((sum, slice) => sum + slice.duration, 0)
  }

  /** Swift sourceTime(atOutputTime:)（L196-199）。 */
  sourceTimeAt(time: TimeInterval): TimeInterval | null {
    const slice = this.sliceAt(time)
    return slice ? sliceSourceTime(slice, time) : null
  }

  /** Swift contains(outputTime:)（L201-203）。 */
  contains(outputTime: TimeInterval): boolean {
    return this.sourceTimeAt(outputTime) !== null
  }

  /** Swift slice(atOutputTime:)（L205-223）：二分找第一片 outputEnd >= time。 */
  sliceAt(time: TimeInterval): TimelineMediaSlice | null {
    if (!Number.isFinite(time) || time < 0) return null
    let lower = 0
    let upper = this.slices.length
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2)
      const end = sliceOutputEnd(this.slices[middle])
      if (end < time || isSameBoundary(end, time)) {
        lower = middle + 1
      } else {
        upper = middle
      }
    }
    if (lower >= this.slices.length) return null
    const candidate = this.slices[lower]
    return time > candidate.outputStart || isSameBoundary(time, candidate.outputStart)
      ? candidate
      : null
  }
}

/**
 * Swift ProjectTimelineMediaPlan（L238-350）：所有带时间的源都解析到同一条
 * 最终输出时钟，预览/导出/指针求值/辅助可用性因此共享完全一致的剪切边界。
 */
export class ProjectTimelineMediaPlan {
  readonly timelineMap: TimelineMap
  readonly primary: TimelineMediaPlan
  readonly systemAudio: TimelineMediaPlan | null
  readonly camera: TimelineMediaPlan | null
  readonly microphone: TimelineMediaPlan | null
  readonly pointer: ProjectPointerTrack
  readonly primarySourceTimeOffset: TimeInterval

  private constructor(init: {
    timelineMap: TimelineMap
    primary: TimelineMediaPlan
    systemAudio: TimelineMediaPlan | null
    camera: TimelineMediaPlan | null
    microphone: TimelineMediaPlan | null
    pointer: ProjectPointerTrack
    primarySourceTimeOffset: TimeInterval
  }) {
    this.timelineMap = init.timelineMap
    this.primary = init.primary
    this.systemAudio = init.systemAudio
    this.camera = init.camera
    this.microphone = init.microphone
    this.pointer = init.pointer
    this.primarySourceTimeOffset = init.primarySourceTimeOffset
  }

  static fromProject(
    project: RecorderProject,
    primaryVideoRange: MediaTimeRange,
    systemAudioRange: MediaTimeRange | null = null,
    cameraRange: MediaTimeRange | null = null,
    microphoneRange: MediaTimeRange | null = null,
    sourcePointerEvents: PointerEventRecord[] = []
  ): ProjectTimelineMediaPlan {
    return ProjectTimelineMediaPlan.build(
      project.timeline.sourceSequence,
      project.media,
      primaryVideoRange,
      systemAudioRange,
      cameraRange,
      microphoneRange,
      sourcePointerEvents
    )
  }

  /**
   * Swift init(sourceSequence:mediaManifest:...)（L269-326）。只用带媒体的字段
   * 构建权威时钟，视觉样式与音量不会意外成为资源缓存键。
   */
  static build(
    sourceSequence: SourceSequence,
    mediaManifest: ProjectMediaManifest | null,
    primaryVideoRange: MediaTimeRange,
    systemAudioRange: MediaTimeRange | null = null,
    cameraRange: MediaTimeRange | null = null,
    microphoneRange: MediaTimeRange | null = null,
    sourcePointerEvents: PointerEventRecord[] = []
  ): ProjectTimelineMediaPlan {
    const map = new TimelineMap(sourceSequence, primaryVideoRange.end - primaryVideoRange.start)
    const primary = TimelineMediaPlan.fromPrimary(map)
    const primaryDuration = primaryVideoRange.end - primaryVideoRange.start

    let systemAudio: TimelineMediaPlan | null = null
    if (systemAudioRange) {
      const sharedSourceStart = Math.max(systemAudioRange.start, primaryVideoRange.start)
      const placement = new MediaTimelinePlacement(
        {
          relativePath: mediaManifest?.screen.relativePath ?? 'screen',
          startOffset: Math.max(systemAudioRange.start - primaryVideoRange.start, 0),
          sourceStartTime: sharedSourceStart,
          sourceTimeScale: null,
          sourceEndTime: null,
          syncAnchors: [],
        } as ProjectMediaReference,
        systemAudioRange.end - systemAudioRange.start,
        primaryDuration,
        systemAudioRange.start
      )
      systemAudio = TimelineMediaPlan.fromAuxiliary(map, placement)
    }

    const camera = ProjectTimelineMediaPlan.auxiliaryPlan(
      mediaManifest?.camera ?? null,
      cameraRange,
      map,
      primaryDuration
    )
    const microphone = ProjectTimelineMediaPlan.auxiliaryPlan(
      mediaManifest?.microphone ?? null,
      microphoneRange,
      map,
      primaryDuration
    )
    const pointer = new ProjectPointerTrack(
      map,
      // 先回到原始录制时钟校准，再做保留剪切与变速：挪动输出播放头会采样到
      // 已删除的区间，或提前一拍进入下一段。
      alignPointerEvents(
        sourcePointerEvents,
        mediaManifest?.pointerEvents?.startOffset ?? 0,
        mediaManifest?.pointerEvents?.sourceStartTime ?? 0
      )
    )

    return new ProjectTimelineMediaPlan({
      timelineMap: map,
      primary,
      systemAudio,
      camera,
      microphone,
      pointer,
      primarySourceTimeOffset: primaryVideoRange.start,
    })
  }

  /** Swift outputDuration（L328）。 */
  get outputDuration(): TimeInterval {
    return this.primary.outputDuration
  }

  private static auxiliaryPlan(
    reference: ProjectMediaReference | null,
    availableRange: MediaTimeRange | null,
    timelineMap: TimelineMap,
    timelineDuration: TimeInterval
  ): TimelineMediaPlan | null {
    if (!reference || !availableRange) return null
    const placement = new MediaTimelinePlacement(
      reference,
      availableRange.end - availableRange.start,
      timelineDuration,
      availableRange.start
    )
    return TimelineMediaPlan.fromAuxiliary(
      timelineMap,
      placement,
      reference.syncAnchors,
      availableRange
    )
  }
}

/**
 * Swift AuxiliaryMediaClockAlignment（L355-375）。为老工程推断两端对齐的
 * 时钟速率：固定起点裁剪治不了漂移，而定稿后的源/主时长提供了稳定的第二锚点。
 */
export function inferredSourceTimeScale(
  reference: ProjectMediaReference,
  availableRange: MediaTimeRange,
  timelineDuration: TimeInterval
): number | null {
  const sourceStart = Math.min(
    Math.max(reference.sourceStartTime, availableRange.start),
    availableRange.end
  )
  const sourceSpan = availableRange.end - sourceStart
  const timelineSpan = timelineDuration - Math.max(reference.startOffset, 0)
  if (
    !Number.isFinite(sourceSpan) ||
    !Number.isFinite(timelineSpan) ||
    !(sourceSpan > 0.1) ||
    !(timelineSpan > 0.1)
  ) {
    return null
  }
  const scale = sourceSpan / timelineSpan
  // 断开/截断的辅助轨必须保持可见的不完整，而不是被拉伸到覆盖大半个工程。
  if (!(scale >= 0.9) || !(scale <= 1.0 + 0.1)) return null
  return scale
}
