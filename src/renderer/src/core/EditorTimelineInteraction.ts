/**
 * Swift source（两个文件合并，均为编辑器时间线的**纯决策层**）：
 *
 *   Sources/DogSCApp/EditorTimelineInteraction.swift @ 567fd6e
 *     · PrimarySegmentReorderDraft                L37-83
 *     · PrimarySegmentTrimDraft                   L85-108
 *     · PrimarySegmentRetimeDraft                 L110-114
 *     · EditorTimelineSegmentJunction             L116-133
 *     · EditorTimelineLeadingGap / TrailingGap    L135-149
 *     · EditorPrimaryTimelinePresentation         L155-458
 *         - leadingGap / trailingGap / segmentJunctions   L156-201
 *         - displaySegments（修剪/变速草稿叠加）          L215-274
 *         - trimDraftOrigin（手势起点一次性取源素材余量）  L276-300
 *         - snappedCutX（切点磁吸）                      L306-343
 *         - trimOutputTime（translation 版）             L345-374
 *         - trimPreviewTime（预览相位）                   L376-411
 *         - trimOutputTime（pointerX 绝对位置版）         L415-455
 *     · EditorTimelineZoomAnchor                  L461-491
 *     · EditorTimelineZoomPolicy                  L495-509
 *     · EditorTimelineZoomInputCoalescer          L511-580
 *     · EditorMotionTimeline* 类型族               L582-635
 *     · EditorOverlayTimelineKind / Drag           L637-665
 *     · EditorTimelineSelectionPresentation        L669-694
 *     · EditorTimelineDeleteTarget / SplitTarget   L696-745
 *     · EditorTimelineSelectionReveal              L748-800
 *     · EditorTimelineGestureIntent / Ownership    L803-843
 *
 *   Sources/DogSCApp/EditorTimelineZoomTransport.swift @ 567fd6e
 *     · zoomTimeline 的锚点计算（L1095-1130 的纯数学部分）
 *
 * 设计意图（原文注释的要点）：primary 轨的「布局/修剪预览/指针时钟换算」
 * 刻意与 SwiftUI 分离，这样不启动编辑器窗口也能测。
 * Electron 侧由 React 持有视图状态，本文件只提供可断言的纯函数与状态机。
 */

import {
  TimelineMap,
  resolvedOutputDuration,
  resolvedSourceEnd,
  type ResolvedRecordingSegment,
} from './TimelineMap'
import {
  MAXIMUM_PLAYBACK_RATE,
  MINIMUM_PLAYBACK_RATE,
  FULL_RECORDING_SEGMENT_ID,
  overlayEndTime,
  timingEndTime,
  timingLeadInEndTime,
  type OverlayTiming,
  type ProjectTimeline,
  type ScreenMotionClip,
  type TransitionTiming,
} from './ProjectTimeline'
import type { CameraMotionClip } from './CameraMotion'
import {
  clipEffectEndTime,
  type ZoomAnimationClip,
  type TimeInterval,
} from './ZoomAnimation'
import { resolveZoomTransitions } from './ZoomTransitionResolution'
import type { RecorderProject } from './ProjectMediaModel'
import type { MosaicClip, StickerClip } from './OverlayTimeline'

/** Swift RecordingSegmentTrimEdge。 */
export type RecordingSegmentTrimEdge = 'left' | 'right'

/** Swift 里反复出现的 1/120000 秒保护阈值（约 120fps 的 1/1000）。 */
const PROTECTED_TICK_EPSILON = 1.0 / 120_000.0
/** Swift 多处使用的通用比较容差。 */
const EPSILON = 0.000_001

// ---------------------------------------------------------------- 重排草稿

/**
 * Swift PrimarySegmentReorderDraft（L37-83）。
 *
 * 重排几何是**手势内预览**，落手才真正改工程。阈值基于原始轨道计算，
 * 因此移动中的邻居无法把自己的命中区挪回指针下方、让顺序来回震荡。
 */
export class PrimarySegmentReorderDraft {
  readonly segmentID: string
  readonly originalSegments: ResolvedRecordingSegment[]
  readonly originalIndex: number
  private _destination: number
  private _segments: ResolvedRecordingSegment[]

  private constructor(
    segmentID: string,
    originalSegments: ResolvedRecordingSegment[],
    originalIndex: number
  ) {
    this.segmentID = segmentID
    this.originalSegments = originalSegments
    this.originalIndex = originalIndex
    this._destination = originalIndex
    this._segments = originalSegments
  }

  /** Swift init?(segmentID:segments:)（L46-56）：找不到片段返回 null。 */
  static make(
    segmentID: string,
    segments: ResolvedRecordingSegment[]
  ): PrimarySegmentReorderDraft | null {
    const index = segments.findIndex((segment) => segment.id === segmentID)
    if (index < 0) return null
    return new PrimarySegmentReorderDraft(segmentID, segments, index)
  }

  get destination(): number {
    return this._destination
  }

  get segments(): ResolvedRecordingSegment[] {
    return this._segments
  }

  get original(): ResolvedRecordingSegment {
    return this.originalSegments[this.originalIndex]
  }

  /** Swift insertionTime（L59）：落点片段的输出起点。 */
  get insertionTime(): TimeInterval {
    return this._segments[this._destination].outputStart
  }

  /**
   * Swift update(translation:)（L61-78）。
   *
   * 落点用「被拖片段中心」与**原始**各片段中心比较：统计有多少片段的
   * 中心在它左边，就是目标下标。随后按新顺序重排并重算 outputStart。
   */
  update(translation: TimeInterval): void {
    if (!Number.isFinite(translation)) return
    const center =
      this.original.outputStart + resolvedOutputDuration(this.original) / 2 + translation
    let next = 0
    for (const segment of this.originalSegments) {
      if (segment.id === this.segmentID) continue
      if (segment.outputStart + resolvedOutputDuration(segment) / 2 < center) next += 1
    }
    if (next === this._destination) return
    this._destination = next
    const order = [...this.originalSegments]
    const moved = order.splice(this.originalIndex, 1)[0]
    order.splice(next, 0, moved)
    let start: TimeInterval = 0
    this._segments = order.map((segment) => {
      const placed: ResolvedRecordingSegment = {
        id: segment.id,
        sourceStart: segment.sourceStart,
        sourceDuration: segment.sourceDuration,
        playbackRate: segment.playbackRate,
        outputStart: start,
      }
      start += resolvedOutputDuration(placed)
      return placed
    })
  }

  /**
   * Swift floatingTranslation(...)（L80-82）—— 浮动片段要额外偏移
   * 「原位置 − 落点位置」，让它跟着指针走而不是瞬移到落点。
   */
  floatingTranslation(
    translation: number,
    laneWidth: number,
    duration: TimeInterval
  ): number {
    return (
      translation +
      ((this.original.outputStart - this.insertionTime) / Math.max(duration, 0.001)) *
        laneWidth
    )
  }
}

// ---------------------------------------------------------------- 修剪草稿

/** Swift PrimarySegmentTrimDraft（L85-108）。 */
export interface PrimarySegmentTrimDraft {
  segmentID: string
  edge: RecordingSegmentTrimEdge
  original: ResolvedRecordingSegment
  /**
   * 指针手势开始时**一次性**捕获的可还原上限。
   * 草稿移动期间它们不变，因此热路径不必为每个鼠标事件重扫整个工程。
   */
  minimumOutputTime: TimeInterval
  maximumOutputTime: TimeInterval
  proposedOutputTime: TimeInterval
}

export function makePrimarySegmentTrimDraft(opts: {
  segmentID: string
  edge: RecordingSegmentTrimEdge
  original: ResolvedRecordingSegment
  minimumOutputTime?: TimeInterval | null
  maximumOutputTime?: TimeInterval | null
  proposedOutputTime: TimeInterval
}): PrimarySegmentTrimDraft {
  return {
    segmentID: opts.segmentID,
    edge: opts.edge,
    original: opts.original,
    minimumOutputTime: opts.minimumOutputTime ?? opts.original.outputStart,
    maximumOutputTime: opts.maximumOutputTime ?? opts.original.outputStart + opts.original.sourceDuration / opts.original.playbackRate,
    proposedOutputTime: opts.proposedOutputTime,
  }
}

/** Swift PrimarySegmentRetimeDraft（L110-114）。 */
export interface PrimarySegmentRetimeDraft {
  segmentID: string
  original: ResolvedRecordingSegment
  proposedRate: number
}

// ---------------------------------------------------------------- 缝隙

/** Swift EditorTimelineSegmentJunction（L116-133）。 */
export interface EditorTimelineSegmentJunction {
  previousSegmentID: string
  nextSegmentID: string
  outputTime: TimeInterval
  removedSourceStart: TimeInterval
  removedDuration: TimeInterval
}

/** Swift `id { nextSegmentID }` —— 只要右侧保留片段还在，接缝就还在。 */
export function junctionID(junction: EditorTimelineSegmentJunction): string {
  return junction.nextSegmentID
}

/** Swift hasRemovedSourceGap（L128）：超过 1/120000 才算真有删除。 */
export function junctionHasRemovedSourceGap(junction: EditorTimelineSegmentJunction): boolean {
  return junction.removedDuration > PROTECTED_TICK_EPSILON
}

/** Swift EditorTimelineLeadingGap（L135-143）。 */
export interface EditorTimelineLeadingGap {
  nextSegmentID: string
  removedDuration: TimeInterval
}

/** Swift EditorTimelineTrailingGap（L145-153）。 */
export interface EditorTimelineTrailingGap {
  previousSegmentID: string
  outputTime: TimeInterval
  removedDuration: TimeInterval
}

// ---------------------------------------------------------------- 主轨呈现

/**
 * Swift EditorPrimaryTimelinePresentation（L155-458）。
 *
 * 全部为无状态纯函数：Ripple 布局、修剪预览、指针时钟换算都可单测。
 */

/**
 * Swift leadingGap（L156-165）。
 *
 * 只有当**所有**片段都在首片段起点之后（或就是首片段）时才算开头缺口 ——
 * 乱序/倒回剪切的工程不显示「开头还原」。
 */
export function primaryLeadingGap(map: TimelineMap): EditorTimelineLeadingGap | null {
  const segments = map.segments
  const first = segments[0]
  if (!first) return null
  const monotone = segments.every(
    (segment) => segment.id === first.id || segment.sourceStart >= first.sourceStart
  )
  if (!monotone) return null
  if (!(first.sourceStart > PROTECTED_TICK_EPSILON)) return null
  return { nextSegmentID: first.id, removedDuration: first.sourceStart }
}

/** Swift trailingGap（L167-180）。 */
export function primaryTrailingGap(map: TimelineMap): EditorTimelineTrailingGap | null {
  const segments = map.segments
  const last = segments[segments.length - 1]
  if (!last) return null
  const monotone = segments.every(
    (segment) => segment.id === last.id || resolvedSourceEnd(segment) <= resolvedSourceEnd(last)
  )
  if (!monotone) return null
  const removedDuration = map.fullSourceDuration - resolvedSourceEnd(last)
  if (!(removedDuration > PROTECTED_TICK_EPSILON)) return null
  return {
    previousSegmentID: last.id,
    outputTime: map.outputDuration,
    removedDuration,
  }
}

/**
 * Swift segmentJunctions（L182-201）。
 *
 * 倒回/重排过的接缝是真实的编辑边界，但无法用「前向源区间」合并或填回，
 * 因此直接跳过。
 */
export function primarySegmentJunctions(map: TimelineMap): EditorTimelineSegmentJunction[] {
  const segments = map.segments
  if (segments.length <= 1) return []
  const junctions: EditorTimelineSegmentJunction[] = []
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1]
    const next = segments[index]
    const previousSourceEnd = resolvedSourceEnd(previous)
    if (!(next.sourceStart >= previousSourceEnd - PROTECTED_TICK_EPSILON)) continue
    junctions.push({
      previousSegmentID: previous.id,
      nextSegmentID: next.id,
      outputTime: previous.outputStart + resolvedOutputDuration(previous),
      removedSourceStart: previousSourceEnd,
      removedDuration: Math.max(next.sourceStart - previousSourceEnd, 0),
    })
  }
  return junctions
}

/** Swift timelineMap(fullSourceDuration:project:)（L203-210）。 */
export function primaryTimelineMap(
  fullSourceDuration: TimeInterval,
  project: RecorderProject
): TimelineMap {
  return new TimelineMap(project.timeline.sourceSequence, fullSourceDuration)
}

/**
 * Swift displaySegments（L215-274）—— 把修剪/变速**草稿**叠加到已提交的
 * 段表上，得到「松手后会长成什么样」。
 *
 * 左侧修剪：被剪掉的是输出时长，换算成源时长要乘 playbackRate；
 * 并且 Ripple 修剪保持手授编辑点连续 —— 修剪后的片段从上一段结束处开始，
 * 后续片段整体左移，所以悬停引导线仍跟指针走、松手不会突然往左跳。
 */
export function primaryDisplaySegments(
  map: TimelineMap,
  trimDraft: PrimarySegmentTrimDraft | null,
  retimeDraft: PrimarySegmentRetimeDraft | null
): ResolvedRecordingSegment[] {
  const hasTrimDraft =
    trimDraft !== null && map.segments.some((segment) => segment.id === trimDraft.segmentID)
  const hasRetimeDraft =
    retimeDraft !== null && map.segments.some((segment) => segment.id === retimeDraft.segmentID)
  if (!hasTrimDraft && !hasRetimeDraft) return map.segments

  let outputStart: TimeInterval = 0
  return map.segments.map((segment) => {
    let sourceStart = segment.sourceStart
    let sourceDuration = segment.sourceDuration
    let playbackRate = segment.playbackRate
    if (trimDraft !== null && segment.id === trimDraft.segmentID) {
      if (trimDraft.edge === 'left') {
        const removedOutputDuration = trimDraft.proposedOutputTime - segment.outputStart
        const removedSourceDuration = removedOutputDuration * segment.playbackRate
        sourceStart += removedSourceDuration
        sourceDuration -= removedSourceDuration
      } else {
        sourceDuration =
          (trimDraft.proposedOutputTime - segment.outputStart) * segment.playbackRate
      }
    }
    if (retimeDraft !== null && segment.id === retimeDraft.segmentID) {
      playbackRate = Math.min(
        Math.max(retimeDraft.proposedRate, MINIMUM_PLAYBACK_RATE),
        MAXIMUM_PLAYBACK_RATE
      )
    }
    const displayed: ResolvedRecordingSegment = {
      id: segment.id,
      sourceStart,
      sourceDuration: Math.max(sourceDuration, 0),
      playbackRate,
      outputStart,
    }
    outputStart += resolvedOutputDuration(displayed)
    return displayed
  })
}

/**
 * Swift trimDraftOrigin（L276-300）—— 手势起点一次性算出「这一段左右
 * 各还有多少源素材可还原」。
 *
 * 算法：在其余片段里找**完全在左侧**的最远源结束点、**完全在右侧**的
 * 最近源起点，再把源时长换算成输出时长（除以 playbackRate）。
 */
export function primaryTrimDraftOrigin(opts: {
  segmentID: string
  edge: RecordingSegmentTrimEdge
  map: TimelineMap
  fullSourceDuration: TimeInterval
}): PrimarySegmentTrimDraft | null {
  const { segmentID, edge, map, fullSourceDuration } = opts
  const segment = map.segments.find((candidate) => candidate.id === segmentID)
  if (!segment) return null
  const segmentSourceEnd = resolvedSourceEnd(segment)
  let previousSourceEnd: TimeInterval = 0
  let nextSourceStart = fullSourceDuration
  for (const candidate of map.segments) {
    if (candidate.id === segmentID) continue
    const candidateSourceEnd = resolvedSourceEnd(candidate)
    if (candidateSourceEnd <= segment.sourceStart + EPSILON) {
      previousSourceEnd = Math.max(previousSourceEnd, candidateSourceEnd)
    }
    if (candidate.sourceStart >= segmentSourceEnd - EPSILON) {
      nextSourceStart = Math.min(nextSourceStart, candidate.sourceStart)
    }
  }
  const outputStart = segment.outputStart
  const outputEnd = outputStart + resolvedOutputDuration(segment)
  const minimumOutputTime =
    outputStart - Math.max(segment.sourceStart - previousSourceEnd, 0) / segment.playbackRate
  const maximumOutputTime =
    outputEnd + Math.max(nextSourceStart - segmentSourceEnd, 0) / segment.playbackRate
  return {
    segmentID,
    edge,
    original: segment,
    minimumOutputTime,
    maximumOutputTime,
    proposedOutputTime: edge === 'left' ? outputStart : outputEnd,
  }
}

/**
 * Swift snappedCutX（L306-343）—— 切点线的磁吸。
 *
 * 片段输出起点构成有序边界索引：命中 7pt 内的**第一个**片段边界优先，
 * 否则回落到播放头位置，都不命中就返回原始指针 X。
 * 用二分而不是扫全部端点。
 */
export function primarySnappedCutX(opts: {
  pointerX: number
  width: number
  duration: TimeInterval
  segments: ResolvedRecordingSegment[]
  playbackTime: TimeInterval
  tolerance?: number
}): number {
  const { pointerX, width, duration, segments, playbackTime } = opts
  const tolerance = opts.tolerance ?? 7
  if (!Number.isFinite(pointerX)) return pointerX
  if (!Number.isFinite(width) || !(width > 0)) return pointerX
  if (!Number.isFinite(duration) || !(duration > 0)) return pointerX
  const safeTolerance = Math.max(Number.isFinite(tolerance) ? tolerance : 0, 0)
  const lowerTime = duration * ((pointerX - safeTolerance) / width)
  const upperX = pointerX + safeTolerance

  let lower = 0
  let upper = segments.length
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    if (segments[middle].outputStart < lowerTime) lower = middle + 1
    else upper = middle
  }
  if (lower < segments.length) {
    const boundaryX = width * (segments[lower].outputStart / duration)
    if (boundaryX <= upperX) return boundaryX
  } else {
    const last = segments[segments.length - 1]
    if (last) {
      const boundaryX = width * (resolvedOutputEnd(last) / duration)
      if (boundaryX >= pointerX - safeTolerance && boundaryX <= upperX) return boundaryX
    }
  }

  const playbackX = width * (playbackTime / duration)
  if (Number.isFinite(playbackX) && Math.abs(playbackX - pointerX) <= safeTolerance) {
    return playbackX
  }
  return pointerX
}

function resolvedOutputEnd(segment: ResolvedRecordingSegment): TimeInterval {
  return segment.outputStart + resolvedOutputDuration(segment)
}

/**
 * Swift trimOutputTime(for:edge:translation:...)（L345-374）—— 拖手柄的
 * 增量版本。保留时长 `max(minimumSegmentDuration, 1e-6)` 但不许超过整段，
 * 从而短片段仍可拖动。
 */
export function trimOutputTimeFromTranslation(opts: {
  segment: ResolvedRecordingSegment
  edge: RecordingSegmentTrimEdge
  translation: number
  laneWidth: number
  outputDuration: TimeInterval
  minimumSegmentDuration: TimeInterval
  minimumOutputTime?: TimeInterval | null
  maximumOutputTime?: TimeInterval | null
}): TimeInterval {
  const { segment, edge, translation, laneWidth, outputDuration, minimumSegmentDuration } = opts
  const outputStart = segment.outputStart
  const outputEnd = outputStart + resolvedOutputDuration(segment)
  if (!Number.isFinite(laneWidth) || !(laneWidth > 0)) return edge === 'left' ? outputStart : outputEnd
  if (!Number.isFinite(outputDuration) || !(outputDuration > 0)) {
    return edge === 'left' ? outputStart : outputEnd
  }
  const delta = (translation / laneWidth) * outputDuration
  const retainedDuration = Math.min(
    Math.max(minimumSegmentDuration, 0.000_001),
    resolvedOutputDuration(segment)
  )
  if (edge === 'left') {
    const lower = Math.min(opts.minimumOutputTime ?? outputStart, outputStart)
    return Math.min(Math.max(outputStart + delta, lower), outputEnd - retainedDuration)
  }
  const upper = Math.max(opts.maximumOutputTime ?? outputEnd, outputEnd)
  return Math.max(Math.min(outputEnd + delta, upper), outputStart + retainedDuration)
}

/**
 * Swift trimPreviewTime（L376-411）—— 拖动预览留在**已安装**的合成上：
 * 左边缘显示第一个保留帧，右边缘显示最后一个保留帧。
 *
 * 还原到当前媒体计划之外的内容在落手前一直停在最近的既有边界，
 * 因为只有最后那一次提交才会装上扩展后的计划。
 */
export function trimPreviewTime(
  draft: PrimarySegmentTrimDraft,
  frameDuration: TimeInterval
): TimeInterval {
  const original = draft.original
  const outputStart = original.outputStart
  const outputEnd = outputStart + resolvedOutputDuration(original)
  const frame = Math.max(Number.isFinite(frameDuration) ? frameDuration : 0, PROTECTED_TICK_EPSILON)
  const lastVisibleFrame = Math.max(outputEnd - frame, outputStart)
  if (draft.edge === 'left') {
    return Math.min(Math.max(draft.proposedOutputTime, outputStart), lastVisibleFrame)
  }
  return Math.min(
    Math.max(draft.proposedOutputTime - frame, outputStart),
    lastVisibleFrame
  )
}

/**
 * Swift trimOutputTime(for:edge:pointerX:...)（L415-455）—— 用指针在时间线
 * 文档里的**绝对位置**换算，而不是手柄局部增量：被修剪片段自己改宽度时，
 * 局部增量会跟着漂移，绝对位置不会。
 */
export function trimOutputTimeFromPointerX(opts: {
  segment: ResolvedRecordingSegment
  edge: RecordingSegmentTrimEdge
  pointerX: number
  laneWidth: number
  outputDuration: TimeInterval
  minimumSegmentDuration: TimeInterval
  minimumOutputTime?: TimeInterval | null
  maximumOutputTime?: TimeInterval | null
}): TimeInterval {
  const { segment, edge, pointerX, laneWidth, outputDuration, minimumSegmentDuration } = opts
  const outputStart = segment.outputStart
  const outputEnd = outputStart + resolvedOutputDuration(segment)
  if (!Number.isFinite(laneWidth) || !(laneWidth > 0)) return edge === 'left' ? outputStart : outputEnd
  if (!Number.isFinite(pointerX)) return edge === 'left' ? outputStart : outputEnd
  if (!Number.isFinite(outputDuration) || !(outputDuration > 0)) {
    return edge === 'left' ? outputStart : outputEnd
  }
  const pointerTime = (pointerX / laneWidth) * outputDuration
  const retainedDuration = Math.min(
    Math.max(minimumSegmentDuration, 0.000_001),
    resolvedOutputDuration(segment)
  )
  if (edge === 'left') {
    const lower = Math.min(opts.minimumOutputTime ?? outputStart, outputStart)
    return Math.min(Math.max(pointerTime, lower), outputEnd - retainedDuration)
  }
  const upper = Math.max(opts.maximumOutputTime ?? outputEnd, outputEnd)
  return Math.max(Math.min(pointerTime, upper), outputStart + retainedDuration)
}

// ---------------------------------------------------------------- 缩放锚点

/**
 * Swift EditorTimelineZoomAnchor（L461-491）。
 *
 * 缩放时 SwiftUI 会改文档宽度；一串滚轮事件可能在 NSScrollView 连第一次
 * 新宽度都还没布局完就到达了。因此必须让**指针下的语义时刻**跨整串事件
 * 存活，而不是记住一个会失效的像素偏移。
 */
export class EditorTimelineZoomAnchor {
  readonly contentFraction: number
  readonly viewportX: number
  readonly targetContentWidth: number

  constructor(opts: {
    pointerViewportX: number
    contentOffsetX: number
    contentWidth: number
    targetContentWidth: number
  }) {
    const safeWidth = Math.max(opts.contentWidth, 1)
    this.contentFraction = Math.min(
      Math.max((opts.contentOffsetX + opts.pointerViewportX) / safeWidth, 0),
      1
    )
    this.viewportX = Math.max(opts.pointerViewportX, 0)
    this.targetContentWidth = Math.max(opts.targetContentWidth, 1)
  }

  /** Swift scrollOffset(viewportWidth:)（L480-488）。 */
  scrollOffset(viewportWidth: number): number {
    const maximumOffset = Math.max(this.targetContentWidth - Math.max(viewportWidth, 0), 0)
    return Math.min(
      Math.max(this.contentFraction * this.targetContentWidth - this.viewportX, 0),
      maximumOffset
    )
  }
}

// ---------------------------------------------------------------- 缩放策略

/**
 * Swift EditorTimelineZoomPolicy（L495-509）。
 *
 * 上限从固定的 480× 提到 4096×：480× 会把 30 分钟 60fps 的录制在笔记本
 * 视口里压到约每帧 7pt。时间线是视口虚拟化的，因此文档可以安全地宽到
 * 支持逐帧边界操作，而不必物化整条波形。
 */
export const EDITOR_TIMELINE_MINIMUM_ZOOM = 1.0
export const EDITOR_TIMELINE_MAXIMUM_ZOOM = 4_096.0

export function clampedTimelineZoom(value: number): number {
  return Math.min(
    Math.max(Number.isFinite(value) ? value : EDITOR_TIMELINE_MINIMUM_ZOOM, EDITOR_TIMELINE_MINIMUM_ZOOM),
    EDITOR_TIMELINE_MAXIMUM_ZOOM
  )
}

/** Swift targetZoom(from:deltaY:)（L530-536）：每单位 deltaY 缩放 1.24 倍。 */
export function timelineZoomTargetFromWheel(currentZoom: number, deltaY: number): number {
  return clampedTimelineZoom(currentZoom * Math.pow(1.24, deltaY))
}

/**
 * Swift EditorTimelineZoomInputCoalescer（L511-580）的**纯状态机**部分。
 *
 * 触控板一帧内可能送来多个滚轮/放大事件。立刻应用每个事件会让 SwiftUI
 * 重建整条时间线、在一帧都还没画出来之前多次改 NSScrollView 尺寸。
 * 这里保留精确的累计缩放目标，但每显示帧最多发布一次。
 *
 * TS 版把「每帧发布」交给调用方的调度器（requestAnimationFrame），
 * 状态机本身仍与 Swift 逐字段一致，可单测。
 */
export interface ZoomInputPending {
  targetZoom: number
  pointerViewportX: number | null
}

export class EditorTimelineZoomInputCoalescer {
  private pendingTargetZoom: number | null = null
  private latestPointerViewportX: number | null = null
  private scheduled = false

  /** 是否已有一个待发布的目标。 */
  get hasPending(): boolean {
    return this.pendingTargetZoom !== null
  }

  /** Swift enqueue(currentZoom:deltaY:...)（L538-549）：累计而非替换。 */
  enqueueWheel(
    currentZoom: number,
    deltaY: number,
    pointerViewportX: number | null,
    schedule: () => void
  ): void {
    const baseZoom = this.pendingTargetZoom ?? currentZoom
    this.pendingTargetZoom = timelineZoomTargetFromWheel(baseZoom, deltaY)
    this.latestPointerViewportX = pointerViewportX
    this.requestSchedule(schedule)
  }

  /** Swift enqueue(targetZoom:...)（L553-561）：滑杆给绝对目标，也走同一闸门。 */
  enqueueTarget(targetZoom: number, pointerViewportX: number | null, schedule: () => void): void {
    this.pendingTargetZoom = clampedTimelineZoom(targetZoom)
    this.latestPointerViewportX = pointerViewportX
    this.requestSchedule(schedule)
  }

  private requestSchedule(schedule: () => void): void {
    if (this.scheduled) return
    this.scheduled = true
    schedule()
  }

  /**
   * Swift flush()（L565-580）。
   *
   * 鼠标松开不能让拖动的最后一小段继续等显示闸门；同步应用也保证
   * 交互结束时滑杆位置与最终文档缩放一致。
   */
  flush(): ZoomInputPending | null {
    this.scheduled = false
    const targetZoom = this.pendingTargetZoom
    const pointerViewportX = this.latestPointerViewportX
    this.pendingTargetZoom = null
    this.latestPointerViewportX = null
    if (targetZoom === null) return null
    return { targetZoom, pointerViewportX }
  }

  /** Swift cancel()（L582-587）。 */
  cancel(): void {
    this.scheduled = false
    this.pendingTargetZoom = null
    this.latestPointerViewportX = null
  }
}

/**
 * Swift EditorTimelineZoomTransport 的缩放锚点计算（L1095-1130 纯数学部分）。
 *
 * 目标文档宽度由「视口宽 × 缩放」直接给出，**不**再从上一帧的原生宽反推 ——
 * 那样会产生第二个所有者：拖动过程中舍入/布局延迟累积，随后 SwiftUI
 * 又把文档拉回它认为的标准宽度。
 */
export function timelineZoomTargetScrollOffset(opts: {
  requestedZoom: number
  viewportWidth: number
  currentContentWidth: number
  currentContentOffsetX: number
  pointerViewportX: number | null
}): { zoom: number; targetContentWidth: number; scrollOffsetX: number } | null {
  const zoom = clampedTimelineZoom(opts.requestedZoom)
  const viewportWidth = Math.max(opts.viewportWidth, 1)
  const currentWidth = Math.max(opts.currentContentWidth, viewportWidth)
  const targetContentWidth = viewportWidth * zoom
  const resolvedViewportX =
    opts.pointerViewportX ??
    fallbackTimelineZoomViewportX({
      contentWidth: currentWidth,
      viewportWidth,
      contentOffset: opts.currentContentOffsetX,
    })
  const anchor = new EditorTimelineZoomAnchor({
    pointerViewportX: resolvedViewportX,
    contentOffsetX: opts.currentContentOffsetX,
    contentWidth: currentWidth,
    targetContentWidth,
  })
  return { zoom, targetContentWidth, scrollOffsetX: anchor.scrollOffset(viewportWidth) }
}

/**
 * Swift fallbackTimelineZoomViewportX —— 没有指针位置时（按钮/滑杆缩放），
 * 以当前视口中心作为锚点。
 */
export function fallbackTimelineZoomViewportX(opts: {
  contentWidth: number
  viewportWidth: number
  contentOffset: number
}): number {
  return Math.max(
    Math.min(
      (opts.contentOffset + opts.viewportWidth / 2) * (opts.viewportWidth / Math.max(opts.contentWidth, 1)),
      opts.viewportWidth
    ),
    0
  )
}

// ---------------------------------------------------------------- 运动轨类型

/** Swift EditorMotionTimelineTrack（L582-585）。 */
export type EditorMotionTimelineTrack = 'screen' | 'camera'

/** Swift EditorMotionTimelineEditMode（L587-591）。 */
export type EditorMotionTimelineEditMode = 'move' | 'leading' | 'trailing'

/** Swift EditorMotionTimelineClip（L593-600）。 */
export interface EditorMotionTimelineClip {
  id: string
  timing: TransitionTiming
  track: EditorMotionTimelineTrack
  /** 跨轨道配对 ID（组合布局预设成对插入）；拖动/缩放时同组片段跟随。 */
  groupID?: string | null
}

/** Swift EditorMotionTimelineBounds（L602-606）。 */
export interface EditorMotionTimelineBounds {
  previousEnd: TimeInterval
  previousClear: TimeInterval
  nextStart: TimeInterval
}

/** Swift EditorMotionPartnerOrigin（L628-631）。 */
export interface EditorMotionPartnerOrigin {
  id: string
  timing: TransitionTiming
}

/** Swift EditorMotionTimelineGestureOrigin（L609-626）。 */
export interface EditorMotionTimelineGestureOrigin {
  clip: EditorMotionTimelineClip
  mode: EditorMotionTimelineEditMode
  bounds: EditorMotionTimelineBounds
  /**
   * 拖动开始时同组配对片段的持久态快照。联动跟随必须从这里计算，
   * 否则每一帧都会在伙伴已移动的位置上再叠加一次总位移（越拖越乱）。
   */
  partnerOrigins: EditorMotionPartnerOrigin[]
}

// ---------------------------------------------------------------- 叠加轨类型

/** Swift EditorOverlayTimelineKind（L637-658）。 */
export type EditorOverlayTimelineKind = 'mosaic' | 'sticker'

/** Swift moveActionName（L647-653）。 */
export function overlayMoveActionName(kind: EditorOverlayTimelineKind): string {
  return kind === 'mosaic' ? '移动打码' : '移动贴图'
}

/** Swift resizeActionName（L655-657）。 */
export function overlayResizeActionName(kind: EditorOverlayTimelineKind): string {
  return kind === 'mosaic' ? '调整打码时长' : '调整贴图时长'
}

/** Swift EditorOverlayTimelineDrag（L660-665）。 */
export interface EditorOverlayTimelineDrag {
  kind: EditorOverlayTimelineKind
  id: string
  mode: EditorMotionTimelineEditMode
  original: OverlayTiming
}

// ---------------------------------------------------------------- 选择策略

/** Swift EditorSelection 在时间线语境里的子集（React 侧用同一联合类型）。 */
export type EditorSelection =
  | { kind: 'canvas' }
  | { kind: 'primarySegment'; id: string }
  | { kind: 'screenMotion'; id: string }
  | { kind: 'cameraMotion'; id: string }
  | { kind: 'zoom'; id: string }
  | { kind: 'zoomTrack' }
  | { kind: 'screenMotionTrack' }
  | { kind: 'mosaic'; id: string }
  | { kind: 'sticker'; id: string }

/**
 * Swift EditorTimelineSelectionPresentation（L669-694）。
 * 片段身份来自已持久化的源序列，永不依赖异步重建的媒体计划。
 */
export function primarySegmentIDFromSelection(
  selection: EditorSelection | null
): string | null {
  if (selection === null || selection.kind !== 'primarySegment') return null
  return selection.id
}

/** Swift primarySegmentIDs(in:)（L675-682）。 */
export function primarySegmentIDs(timeline: ProjectTimeline): string[] {
  const sequence = timeline.sourceSequence
  return sequence.kind === 'fullRecording'
    ? [FULL_RECORDING_SEGMENT_ID]
    : sequence.segments.map((segment) => segment.id)
}

/**
 * Swift reconcilingPrimarySelection（L684-693）。
 *
 * 被删掉的时间线片段已经失去自己的编辑上下文，此时回退到中性画布，
 * 而不是激活屏幕变换 —— **时间选择绝不能隐含空间操作**。
 */
export function reconcilingPrimarySelection(
  selection: EditorSelection | null,
  timeline: ProjectTimeline
): EditorSelection | null {
  const id = primarySegmentIDFromSelection(selection)
  if (id === null) return selection
  return primarySegmentIDs(timeline).includes(id) ? selection : { kind: 'canvas' }
}

/** Swift EditorTimelineDeleteTarget（L696-720）。 */
export type EditorTimelineDeleteTarget =
  | { kind: 'primarySegment'; id: string }
  | { kind: 'screenMotion'; id: string }
  | { kind: 'cameraMotion'; id: string }
  | { kind: 'zoom'; id: string }
  | { kind: 'mosaic'; id: string }
  | { kind: 'sticker'; id: string }

export function timelineDeleteTarget(
  selection: EditorSelection | null
): EditorTimelineDeleteTarget | null {
  if (selection === null) return null
  switch (selection.kind) {
    case 'primarySegment':
    case 'screenMotion':
    case 'cameraMotion':
    case 'zoom':
    case 'mosaic':
    case 'sticker':
      return { kind: selection.kind, id: selection.id }
    default:
      return null
  }
}

/** Swift EditorTimelineSplitTarget（L727-745）。 */
export type EditorTimelineSplitTarget =
  | { kind: 'zoom'; id: string }
  | { kind: 'screenMotion'; id: string }
  | { kind: 'cameraMotion'; id: string }
  | { kind: 'mosaic'; id: string }
  | { kind: 'sticker'; id: string }

export function timelineSplitTarget(
  selection: EditorSelection | null
): EditorTimelineSplitTarget | null {
  if (selection === null) return null
  switch (selection.kind) {
    case 'zoom':
    case 'screenMotion':
    case 'cameraMotion':
    case 'mosaic':
    case 'sticker':
      return { kind: selection.kind, id: selection.id }
    default:
      return null
  }
}

/**
 * Swift EditorTimelineSelectionReveal.time（L748-800）。
 *
 * 时间选择必须在监看器上保持可检查：在播放头已经落在片段内时选中该片段，
 * **保留用户当前帧**；在别处选中则跳到第一个有意义的创作状态，而不是把
 * 选中检查器挂在一个看不见的对象上。
 *
 * 返回 null 表示「不需要移动播放头」。
 */
export function timelineSelectionRevealTime(opts: {
  selection: EditorSelection
  project: RecorderProject
  currentTime: TimeInterval
  outputDuration?: TimeInterval | null
}): TimeInterval | null {
  const { selection, project, currentTime } = opts
  const outputDuration = opts.outputDuration ?? null
  let interval: { start: number; end: number; preferred: number } | null = null

  switch (selection.kind) {
    case 'zoom': {
      const zooms =
        outputDuration !== null
          ? resolveZoomTransitions(project.timeline.zoomClips, outputDuration)
          : project.timeline.zoomClips
      const clip = zooms.find((candidate) => candidate.id === selection.id)
      if (clip) {
        interval = {
          start: clip.startTime,
          end: Math.min(clipEffectEndTime(clip), outputDuration ?? clipEffectEndTime(clip)),
          preferred:
            clip.startTime + Math.min(clip.enterDuration, clip.endTime - clip.startTime),
        }
      }
      break
    }
    case 'screenMotion': {
      const clip = project.timeline.screenMotionClips.find(
        (candidate) => candidate.id === selection.id
      )
      if (clip) {
        interval = {
          start: clip.timing.startTime,
          end: timingEndTime(clip.timing),
          preferred: timingLeadInEndTime(clip.timing),
        }
      }
      break
    }
    case 'cameraMotion': {
      const clips = project.timeline.cameraMotionClips ?? []
      const clip = clips.find((candidate) => candidate.id === selection.id)
      if (clip) {
        interval = {
          start: clip.timing.startTime,
          end: timingEndTime(clip.timing),
          preferred: timingLeadInEndTime(clip.timing),
        }
      }
      break
    }
    case 'mosaic': {
      const clips = project.timeline.mosaicClips ?? []
      const clip: MosaicClip | undefined = clips.find(
        (candidate) => candidate.id === selection.id
      )
      if (clip) {
        interval = {
          start: clip.timing.startTime,
          end: overlayEndTime(clip.timing),
          preferred: clip.timing.startTime,
        }
      }
      break
    }
    case 'sticker': {
      const clips = project.timeline.stickerClips ?? []
      const clip: StickerClip | undefined = clips.find(
        (candidate) => candidate.id === selection.id
      )
      if (clip) {
        interval = {
          start: clip.timing.startTime,
          end: overlayEndTime(clip.timing),
          preferred: clip.timing.startTime,
        }
      }
      break
    }
    default:
      interval = null
  }

  if (interval === null) return null
  const start = Math.max(interval.start, 0)
  const end = Math.max(interval.end, start)
  if (currentTime >= start && currentTime < end) return null
  if (!(end > start)) return start
  return Math.min(Math.max(interval.preferred, start), end - 0.001)
}

// ---------------------------------------------------------------- 手势意图

/**
 * Swift EditorTimelineGestureIntent（L803-828）。
 *
 * 一次 mouse-down 锁死到一个语义目标，直到 mouse-up。
 * 它刻意不持有工程或播放状态 —— 具体编辑仍由各轨自己的命中区完成。
 */
export type EditorTimelineGestureIntent =
  | { kind: 'scrub' }
  | { kind: 'primaryTrim'; id: string; edge: RecordingSegmentTrimEdge }
  | { kind: 'primaryRetime'; id: string }
  | { kind: 'zoomCreate' }
  | { kind: 'zoomMove'; id: string }
  | { kind: 'zoomResize'; id: string; leading: boolean }
  | { kind: 'motionCreate'; track: EditorMotionTimelineTrack }
  | { kind: 'motion'; track: EditorMotionTimelineTrack; id: string; mode: EditorMotionTimelineEditMode }
  | { kind: 'overlayCreate' }
  | { kind: 'overlay'; overlay: EditorOverlayTimelineKind; id: string; mode: EditorMotionTimelineEditMode }

/** Swift seeksDuringDrag（L830-837）：这三类手势在拖动中要驱动播放头。 */
export function gestureSeeksDuringDrag(intent: EditorTimelineGestureIntent): boolean {
  return intent.kind === 'scrub' || intent.kind === 'primaryTrim' || intent.kind === 'primaryRetime'
}

/** Swift 的 Equatable 语义（用于 begin 里的「同一意图」判定）。 */
export function gestureIntentEquals(
  lhs: EditorTimelineGestureIntent | null,
  rhs: EditorTimelineGestureIntent | null
): boolean {
  if (lhs === null || rhs === null) return lhs === rhs
  if (lhs.kind !== rhs.kind) return false
  switch (lhs.kind) {
    case 'scrub':
    case 'zoomCreate':
    case 'overlayCreate':
      return true
    case 'primaryTrim':
      return rhs.kind === 'primaryTrim' && lhs.id === rhs.id && lhs.edge === rhs.edge
    case 'primaryRetime':
      return rhs.kind === 'primaryRetime' && lhs.id === rhs.id
    case 'zoomMove':
      return rhs.kind === 'zoomMove' && lhs.id === rhs.id
    case 'zoomResize':
      return rhs.kind === 'zoomResize' && lhs.id === rhs.id && lhs.leading === rhs.leading
    case 'motionCreate':
      return rhs.kind === 'motionCreate' && lhs.track === rhs.track
    case 'motion':
      return (
        rhs.kind === 'motion' &&
        lhs.track === rhs.track &&
        lhs.id === rhs.id &&
        lhs.mode === rhs.mode
      )
    case 'overlay':
      return (
        rhs.kind === 'overlay' &&
        lhs.overlay === rhs.overlay &&
        lhs.id === rhs.id &&
        lhs.mode === rhs.mode
      )
  }
}

/**
 * Swift EditorTimelineGestureOwnership（L839-859）。
 *
 * `begin` 的契约：已有意图时不抢占，只有**同一意图**才能继续（返回 true）。
 * 这条规则是「兄弟手势竞争」那类 bug 的根治手段 —— 空白区域的创建手势
 * 无法从片段上抢走按下事件。
 */
export class EditorTimelineGestureOwnership {
  private _activeIntent: EditorTimelineGestureIntent | null = null

  get activeIntent(): EditorTimelineGestureIntent | null {
    return this._activeIntent
  }

  begin(intent: EditorTimelineGestureIntent): boolean {
    if (this._activeIntent !== null) {
      return gestureIntentEquals(this._activeIntent, intent)
    }
    this._activeIntent = intent
    return true
  }

  end(intent: EditorTimelineGestureIntent): void {
    if (!gestureIntentEquals(this._activeIntent, intent)) return
    this._activeIntent = null
  }

  cancel(): void {
    this._activeIntent = null
  }
}
