/**
 * 输出时钟域的指针评估器。
 *
 * Swift source: Sources/RecorderCore/ProjectPointerTrack.swift @ laogou717/dogsc 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct ProjectPointerTrackSegment    L6-31    → ProjectPointerTrackSegment
 *   - struct AutomaticCameraFocusCacheKey  L33-46   → 缓存键（模板字符串）
 *   - struct AutomaticCameraFocusSample    L48-51   → AutomaticCameraFocusSample
 *   - struct ProjectPointerTrack           L59-469  → class ProjectPointerTrack
 *
 * `TimelineMap` 先把源事件映射进保留片段时钟并在每个剪辑处注入位置种子；
 * 本包装把平滑与可见性委托给 `PointerTrack`，再在剪辑处叠加一段短的
 * 输出时钟端点桥接，使合成光标不在保留片段之间瞬移。
 */

import type { NormalizedPoint, PointerEventKind, PointerEventRecord, TimeInterval } from './ZoomAnimation'
import type { ZoomAnimationClip } from './ZoomAnimation'
import { ZOOM_VIEWPORT, constrainPoint } from './ZoomAnimation'
import type { MediaTimeRange } from './MediaTimeRange'
import { makeMotionStyle, type MotionStyle } from './MotionStyle'
import { makeCursorStyle, type CursorStyle } from './ProjectModel'
import { BoundedMemoizationCache } from './BoundedMemoizationCache'
import type { TimelineMap } from './TimelineMap'
import {
  PointerTrack,
  type PointerTrackEvaluation,
  type PointerSample,
} from './PointerTrack'

// ---------------------------------------------------------------- Segment

/** Swift ProjectPointerTrackSegment（L6-31）。 */
export class ProjectPointerTrackSegment {
  readonly id: string
  readonly outputRange: MediaTimeRange
  readonly track: PointerTrack
  /**
   * 保留片段构建时缓存一次（L11-13）。剪辑桥接评估对每个预览/导出帧
   * 运行，不得为了找出第一次点击而重扫长事件数组。
   */
  readonly firstClickTime: TimeInterval | null
  readonly startsAfterSourceDiscontinuity: boolean

  constructor(
    id: string,
    outputRange: MediaTimeRange,
    track: PointerTrack,
    startsAfterSourceDiscontinuity = false
  ) {
    this.id = id
    this.outputRange = outputRange
    this.track = track
    this.startsAfterSourceDiscontinuity = startsAfterSourceDiscontinuity
    this.firstClickTime =
      track.events.find(
        (event) =>
          event.time >= outputRange.start &&
          (event.kind === 'leftClick' || event.kind === 'rightClick')
      )?.time ?? null
  }
}

// ---------------------------------------------------------------- 缓存键

interface AutomaticCameraFocusSample {
  time: TimeInterval
  focus: NormalizedPoint
}

/** Swift AutomaticCameraFocusCacheKey（L33-46），序列化为稳定字符串。 */
function focusCacheKey(
  clip: ZoomAnimationClip,
  baseFocus: NormalizedPoint,
  motion: MotionStyle
): string {
  return [
    clip.id,
    clip.startTime,
    clip.endTime,
    clip.scale,
    baseFocus.x,
    baseFocus.y,
    clip.enterDuration,
    clip.enterProgressOffset,
    motion.screen,
    motion.screenSpringMass,
    motion.screenSpringStiffness,
    motion.screenSpringDamping,
  ].join('|')
}

// ---------------------------------------------------------------- ProjectPointerTrack

/**
 * Swift ProjectPointerTrack（L59-469）。
 */
export class ProjectPointerTrack {
  /**
   * CUR-005（L63-64）：长到足以读作一次刻意移动，短到不遮住保留片段里
   * 的第一个动作。窗口内的点击会缩短桥接，使其记录位置保持精确。
   */
  private static readonly CUT_BRIDGE_DURATION: TimeInterval = 0.28
  private static readonly ENDPOINT_EPSILON: TimeInterval = 1.0 / 10_000.0

  readonly segments: ProjectPointerTrackSegment[]
  private readonly cursorActivityTimes: TimeInterval[]
  /**
   * 播放通常需要活动片段及其前驱。四个 LRU 条目在丢弃检查器连续编辑
   * 产生的瞬时弹簧变体的同时保留该局部性（L68-70）。
   */
  private readonly automaticCameraFocusCache: BoundedMemoizationCache<
    string,
    AutomaticCameraFocusSample[]
  >

  constructor(timelineMap: TimelineMap, sourceEvents: PointerEventRecord[]) {
    // L77-83：源不连续（剪辑间隙）标记。
    const discontinuities = new Set<string>()
    const mappedSegments = timelineMap.segments
    for (let index = 0; index < mappedSegments.length; index += 1) {
      const segment = mappedSegments[index]
      const previousEnd = index > 0 ? mappedSegments[index - 1].sourceStart + mappedSegments[index - 1].sourceDuration : 0
      if (Math.abs(segment.sourceStart - previousEnd) > ProjectPointerTrack.ENDPOINT_EPSILON) {
        discontinuities.add(segment.id)
      }
    }
    this.segments = timelineMap.mapPointerEventSegments(sourceEvents).map(
      (mapped) =>
        new ProjectPointerTrackSegment(
          mapped.id,
          mapped.outputRange,
          new PointerTrack(mapped.events),
          discontinuities.has(mapped.id)
        )
    )
    // L92-110：剪辑种子定位指针但不是新的物理活动。一次性构建输出时钟
    // 活动索引；帧评估为 O(log n)。
    const activity: TimeInterval[] = []
    let previous: NormalizedPoint | null = null
    let previousEnd: TimeInterval | null = null
    for (const segment of this.segments) {
      if (previousEnd !== null && segment.outputRange.start > previousEnd + ProjectPointerTrack.ENDPOINT_EPSILON) {
        previous = null
      }
      for (const event of segment.track.events) {
        if (event.time < segment.outputRange.start) continue
        const moved =
          previous === null ||
          Math.abs(previous.x - event.location.x) > 0.000_001 ||
          Math.abs(previous.y - event.location.y) > 0.000_001
        if (moved || event.kind !== 'move') activity.push(event.time)
        previous = event.location
      }
      previousEnd = segment.outputRange.end
    }
    this.cursorActivityTimes = activity
    this.automaticCameraFocusCache = new BoundedMemoizationCache(4)
  }

  /** L114-116：segments 相等即相等。 */
  equals(other: ProjectPointerTrack): boolean {
    if (this.segments.length !== other.segments.length) return false
    for (let i = 0; i < this.segments.length; i += 1) {
      const a = this.segments[i]
      const b = other.segments[i]
      if (
        a.id !== b.id ||
        a.outputRange.start !== b.outputRange.start ||
        a.outputRange.end !== b.outputRange.end ||
        a.startsAfterSourceDiscontinuity !== b.startsAfterSourceDiscontinuity ||
        !a.track.equals(b.track)
      ) {
        return false
      }
    }
    return true
  }

  /** L120-126：在显示链接索要首个指针样本之前于后台准备弹簧路径。 */
  prewarmCursorSpring(motion: MotionStyle): void {
    if (motion.cursor !== '平滑') return
    for (const segment of this.segments) {
      segment.track.prewarmCursorSpring(motion)
    }
  }

  /** L128-173。 */
  evaluation(
    outputTime: TimeInterval,
    motion: MotionStyle = makeMotionStyle(),
    style: CursorStyle = makeCursorStyle(),
    automaticEntry: ZoomAnimationClip | null = null
  ): PointerTrackEvaluation {
    const segmentIndex = this.segmentIndexAt(outputTime)
    if (segmentIndex === null) {
      return { position: null, cursor: null }
    }
    const segment = this.segments[segmentIndex]
    const segmentStyle: CursorStyle = { ...style, hideWhenIdle: false }
    const current = segment.track.evaluation(outputTime, motion, segmentStyle)
    if (style.hideWhenIdle) {
      // 二分查找最近一次光标活动（L142-150）。
      let lo = 0
      let hi = this.cursorActivityTimes.length
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (this.cursorActivityTimes[mid] <= outputTime) lo = mid + 1
        else hi = mid
      }
      if (lo > 0 && outputTime - this.cursorActivityTimes[lo - 1] > style.idleDelay) {
        current.cursor = null
      }
    }
    // 全新自动场景已经瞄准保留的指针。在同一瞬间使用前一场景的光标
    // 桥接会把光标放到新放大视口之外（L151-157）。
    if (
      automaticEntry &&
      this.automaticEntryStartsAfterCut(automaticEntry) &&
      Math.abs(automaticEntry.startTime - segment.outputRange.start) <=
        ProjectPointerTrack.ENDPOINT_EPSILON
    ) {
      return current
    }
    const bridgedPosition =
      segmentIndex > 0
        ? this.cutBridgePosition(outputTime, segmentIndex, motion, style)
        : null
    if (!bridgedPosition) return current
    const bridgedCursor: PointerSample | null = current.cursor
      ? { ...current.cursor, location: bridgedPosition }
      : null
    return { position: bridgedPosition, cursor: bridgedCursor }
  }

  /** L175-181。 */
  sample(
    outputTime: TimeInterval,
    motion: MotionStyle = makeMotionStyle(),
    style: CursorStyle = makeCursorStyle()
  ): PointerSample | null {
    return this.evaluation(outputTime, motion, style).cursor
  }

  /** L183-189。 */
  automaticEntryStartsAfterCut(clip: ZoomAnimationClip): boolean {
    if (clip.origin !== 'automatic') return false
    const index = this.segmentIndexAt(clip.startTime)
    if (index === null) return false
    const segment = this.segments[index]
    return (
      segment.startsAfterSourceDiscontinuity &&
      Math.abs(segment.outputRange.start - clip.startTime) <=
        ProjectPointerTrack.ENDPOINT_EPSILON
    )
  }

  /**
   * L194-231：稳定区域相机跟随。指针停留在中央静止区内时相机保持最新
   * 目标；只有真实离开才更新受影响的轴，过渡由屏幕弹簧负责。
   */
  automaticCameraFocus(
    outputTime: TimeInterval,
    clip: ZoomAnimationClip,
    motion: MotionStyle = makeMotionStyle()
  ): NormalizedPoint {
    const baseFocus = constrainPoint(clip.focus, ZOOM_VIEWPORT.focusEdgeInset)
    if (
      clip.origin !== 'automatic' ||
      !Number.isFinite(outputTime) ||
      !(clip.endTime > clip.startTime)
    ) {
      return baseFocus
    }
    const key = focusCacheKey(clip, baseFocus, motion)
    const samples = this.automaticCameraFocusCache.value(key, () =>
      this.makeAutomaticCameraFocusSamples(
        clip,
        this.automaticEntryFocus(clip, baseFocus),
        motion
      )
    )
    return interpolatedAutomaticCameraFocus(
      Math.min(Math.max(outputTime, clip.startTime), clip.endTime),
      samples,
      baseFocus
    )
  }

  /** L233-260。 */
  private automaticEntryFocus(
    clip: ZoomAnimationClip,
    fallback: NormalizedPoint
  ): NormalizedPoint {
    // 在保留源内保留真实延续。暴露新起点的剪辑必须解析该源的焦点，
    // 即使较旧的工程仍带着部分进入相位（L237-239）。
    const segmentIndex =
      clip.enterProgressOffset <= ProjectPointerTrack.ENDPOINT_EPSILON ||
      this.automaticEntryStartsAfterCut(clip)
        ? this.segmentIndexAt(clip.startTime)
        : null
    if (segmentIndex === null) return fallback
    const segment = this.segments[segmentIndex]
    const entryEnd = Math.min(
      clip.startTime + Math.min(Math.max(clip.enterDuration, 0), clip.endTime - clip.startTime),
      segment.outputRange.end
    )
    // 预判引发自动缩放的操作，但绝不跨剪辑看向另一段保留录制片段。
    const entryClick = segment.track
      .eventsBetween(clip.startTime, entryEnd)
      .find(
        (event) =>
          event.time < segment.outputRange.end &&
          (event.kind === 'leftClick' || event.kind === 'rightClick')
      )
    const focus = entryClick
      ? entryClick.location
      : interpolatedRawPosition(clip.startTime, segment.track.events)
    // 使用保留的原始位置，而不是光标的剪辑桥接——后者暂时起始于
    // 前一片段（无关）的位置。
    return focus ? constrainPoint(focus, ZOOM_VIEWPORT.focusEdgeInset) : fallback
  }

  /** L262-323。 */
  private makeAutomaticCameraFocusSamples(
    clip: ZoomAnimationClip,
    baseFocus: NormalizedPoint,
    motion: MotionStyle
  ): AutomaticCameraFocusSample[] {
    const interval = 1.0 / 120.0
    const clipDuration = clip.endTime - clip.startTime
    const visibleHalfSpan = 1 / (2 * Math.max(clip.scale, 1))
    const restAreaInsetRatio = 0.22
    const restAreaHalfSpan = Math.max(
      visibleHalfSpan - 2 * visibleHalfSpan * restAreaInsetRatio,
      0.01
    )
    const followStart = Math.min(
      clip.startTime + Math.min(Math.max(clip.enterDuration, 0), clipDuration),
      clip.endTime
    )
    const mass = Math.max(motion.screenSpringMass, 0.01)
    const stiffness = Math.max(motion.screenSpringStiffness, 0.01)
    const damping = Math.max(motion.screenSpringDamping, 0.01)

    let position = baseFocus
    let target = baseFocus
    let velocityX = 0
    let velocityY = 0
    const clipEvents = this.eventsBetween(clip.startTime, clip.endTime)
    let sampleTime = clip.startTime
    const result: AutomaticCameraFocusSample[] = [{ time: sampleTime, focus: position }]

    while (sampleTime < clip.endTime) {
      const nextTime = Math.min(sampleTime + interval, clip.endTime)
      if (nextTime >= followStart) {
        const cursor = interpolatedRawPosition(nextTime, clipEvents)
        if (cursor) {
          if (cursor.x < target.x - restAreaHalfSpan || cursor.x > target.x + restAreaHalfSpan) {
            target = { ...target, x: cursor.x }
          }
          if (cursor.y < target.y - restAreaHalfSpan || cursor.y > target.y + restAreaHalfSpan) {
            target = { ...target, y: cursor.y }
          }
          target = constrainPoint(target, ZOOM_VIEWPORT.focusEdgeInset)
        }
      }

      const deltaTime = Math.max(nextTime - sampleTime, 0)
      const accelerationX = (stiffness * (target.x - position.x) - damping * velocityX) / mass
      const accelerationY = (stiffness * (target.y - position.y) - damping * velocityY) / mass
      velocityX += accelerationX * deltaTime
      velocityY += accelerationY * deltaTime
      position = constrainPoint(
        { x: position.x + velocityX * deltaTime, y: position.y + velocityY * deltaTime },
        ZOOM_VIEWPORT.focusEdgeInset
      )
      sampleTime = nextTime
      result.push({ time: sampleTime, focus: position })
    }
    return result
  }

  /** L390-400：跨片段收集窗口内事件。 */
  private eventsBetween(start: TimeInterval, end: TimeInterval): PointerEventRecord[] {
    const result: PointerEventRecord[] = []
    for (const segment of this.segments) {
      result.push(...segment.track.eventsBetween(start, end))
    }
    return result
  }

  // ------------------------------------------------ cut bridge（CUR-005）

  /**
   * L406-450：只连接保留的端点。被删除的源路径保持缺席，与在原始源
   * 时钟上做朴素插值不同。五次 smootherstep 在两端速度与加速度均为零，
   * 避免刺眼的匀速剪辑过渡。
   */
  private cutBridgePosition(
    time: TimeInterval,
    segmentIndex: number,
    motion: MotionStyle,
    style: CursorStyle
  ): NormalizedPoint | null {
    const segment = this.segments[segmentIndex]
    const start = segment.outputRange.start
    if (time < start) return null

    const availableUntilClick =
      segment.firstClickTime !== null ? Math.max(segment.firstClickTime - start, 0) : null
    const duration = Math.min(
      Math.min(
        ProjectPointerTrack.CUT_BRIDGE_DURATION,
        availableUntilClick ?? ProjectPointerTrack.CUT_BRIDGE_DURATION
      ),
      segment.outputRange.end - segment.outputRange.start
    )
    if (!(duration > ProjectPointerTrack.ENDPOINT_EPSILON) || time >= start + duration) {
      return null
    }

    const previous = this.segments[segmentIndex - 1]
    const previousTime = Math.max(
      previous.outputRange.start,
      previous.outputRange.end - ProjectPointerTrack.ENDPOINT_EPSILON
    )
    const from = previous.track.evaluation(previousTime, motion, style).position
    const to = segment.track.evaluation(start + duration, motion, style).position
    if (!from || !to) return null

    const linear = Math.min(Math.max((time - start) / duration, 0), 1)
    const eased = linear * linear * linear * (linear * (linear * 6 - 15) + 10)
    return {
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased,
    }
  }

  /** L452-468。 */
  private segmentIndexAt(time: TimeInterval): number | null {
    if (!Number.isFinite(time) || time < 0) return null
    let lower = 0
    let upper = this.segments.length
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2)
      if (this.segments[middle].outputRange.end <= time) {
        lower = middle + 1
      } else {
        upper = middle
      }
    }
    if (lower >= this.segments.length) return null
    const candidate = this.segments[lower]
    if (time < candidate.outputRange.start) return null
    return lower
  }
}

// ---------------------------------------------------------------- 文件级助手

/**
 * L328-357：对记录事件流的原始线性插值。点击与移动样本都携带真实指针
 * 位置；样本之间是直线斜坡，绝不重放过期事件。
 */
export function interpolatedRawPosition(
  time: TimeInterval,
  events: PointerEventRecord[]
): NormalizedPoint | null {
  const first = events[0]
  if (!first) return null
  if (time <= first.time) return first.location
  const last = events[events.length - 1]
  if (!last || time >= last.time) return last?.location ?? null

  let lower = 0
  let upper = events.length
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2)
    if (events[middle].time <= time) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }
  const upperIndex = Math.min(lower, events.length - 1)
  const lowerIndex = Math.max(upperIndex - 1, 0)
  const a = events[lowerIndex]
  const b = events[upperIndex]
  const duration = Math.max(b.time - a.time, Number.MIN_VALUE)
  const progress = Math.min(Math.max((time - a.time) / duration, 0), 1)
  return {
    x: a.location.x + (b.location.x - a.location.x) * progress,
    y: a.location.y + (b.location.y - a.location.y) * progress,
  }
}

/** L359-388。 */
function interpolatedAutomaticCameraFocus(
  time: TimeInterval,
  samples: AutomaticCameraFocusSample[],
  fallback: NormalizedPoint
): NormalizedPoint {
  const first = samples[0]
  if (!first) return fallback
  if (time <= first.time) return first.focus
  const last = samples[samples.length - 1]
  if (!last || time >= last.time) return last?.focus ?? fallback

  let lower = 0
  let upper = samples.length
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2)
    if (samples[middle].time <= time) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }
  const upperIndex = Math.min(lower, samples.length - 1)
  const lowerIndex = Math.max(upperIndex - 1, 0)
  const a = samples[lowerIndex]
  const b = samples[upperIndex]
  const duration = Math.max(b.time - a.time, Number.MIN_VALUE)
  const progress = Math.min(Math.max((time - a.time) / duration, 0), 1)
  return {
    x: a.focus.x + (b.focus.x - a.focus.x) * progress,
    y: a.focus.y + (b.focus.y - a.focus.y) * progress,
  }
}
