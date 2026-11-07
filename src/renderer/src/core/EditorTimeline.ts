/**
 * Swift source: Sources/RecorderCore/EditorTimeline.swift @ 567fd6e
 *
 * 逐结构对照：
 *   TimelineZoomSegment                          L3-35
 *   ZoomTrackHitZone                             L37-41
 *   EditorTimelineMath
 *     · fitZoomAnimation                         L47-111
 *     · manualZoomAnimation                      L113-141
 *     · manualZoomRangeKeyframes                 L143-169
 *     · clampedTime / xPosition                  L171-187
 *     · zoomSegments(from:animations)            L189-211
 *     · split                                    L213-234
 *     · zoomSequenceIsValid                      L239-250
 *     · effectiveExitDuration                    L253-258
 *     · exitNormalizations                       L265-306
 *     · moving                                   L308-359
 *     · resizing                                 L361-428
 *     · zoomHitZone                              L434-485
 *     · motionHitZone（tuple / 泛型两版）         L489-595
 *     · fitMotionTiming（两版）                   L599-685
 *     · creationNeighbours                       L691-735
 *     · lastItemStartingAtOrBefore               L737-753
 *     · motionItemPrecedes                       L755-766
 *     · motionReturnNormalizations（两版）        L772-834
 *     · zoomAnimationNeighbours                  L836-853
 *     · zoomAnimationPrecedes                    L855-862
 *     · motionTimingPrecedes                     L864-871
 *     · zoomSegments(from:keyframes)             L873-937
 *
 * 共同主题：时间线上「什么时候可以在两段之间下手」。所有创建/移动/调整函数
 * 都遵守同一条不变量 ——
 *   相邻两段要么**相接**（间隙在容差内，前段退出过渡休眠、后段从前段状态起步），
 *   要么给前段留**完整**的退出回落窗口。
 * 落在窗口中间（既没接上也没让开）会在视觉上把回落拦腰切断，因此一律被
 * 吸附到最近的合法位置，而不是硬夹。
 */

import {
  ZOOM_INTERP,
  clipDuration,
  clipEffectEndTime,
  makeClip,
  makeKeyframe,
  requestedExitDuration,
  withPreservedTransitionIntent,
  type NormalizedPoint,
  type ZoomAnimationClip,
  type ZoomEasingPreset,
  type ZoomKeyframe,
  type ZoomKeyframeOrigin,
} from './ZoomAnimation'
import {
  makeTransitionTiming,
  requestedReturnDuration,
  timingEffectEndTime,
  timingEndTime,
  withPreservedTimingIntent,
  type TransitionTiming,
} from './ProjectTimeline'

export type TimeInterval = number

const EPSILON = 0.000_1

// ---------------------------------------------------------------- Segment

/** Swift TimelineZoomSegment（L3-35）—— 时间线渲染用的只读段。 */
export interface TimelineZoomSegment {
  id: string
  startTime: TimeInterval
  endTime: TimeInterval
  scale: number
  origin: ZoomKeyframeOrigin
  representativeKeyframeID: string
  easing: ZoomEasingPreset
  enterDuration: TimeInterval
  exitDuration: TimeInterval
}

export interface TimelineZoomSegmentOptions {
  id: string
  startTime: TimeInterval
  endTime: TimeInterval
  scale: number
  origin: ZoomKeyframeOrigin
  representativeKeyframeID: string
  easing?: ZoomEasingPreset
  enterDuration?: TimeInterval
  exitDuration?: TimeInterval
}

export function makeTimelineZoomSegment(
  opts: TimelineZoomSegmentOptions
): TimelineZoomSegment {
  return {
    id: opts.id,
    startTime: opts.startTime,
    endTime: opts.endTime,
    scale: opts.scale,
    origin: opts.origin,
    representativeKeyframeID: opts.representativeKeyframeID,
    easing: opts.easing ?? '三次方缓动',
    enterDuration: opts.enterDuration ?? 0.7,
    exitDuration: opts.exitDuration ?? 0.7,
  }
}

/** Swift ZoomTrackHitZone（L37-41）。 */
export type ZoomTrackHitZone =
  | { kind: 'empty' }
  | { kind: 'move'; id: string }
  | { kind: 'resize'; id: string; leading: boolean }

export const EMPTY_HIT_ZONE: ZoomTrackHitZone = { kind: 'empty' }

// ---------------------------------------------------------------- 创建拟合

/**
 * Swift L47-111 —— 把一次拖动/点选的范围拟合进两段之间的空隙。
 *
 * 落进回落窗口的「洞口」时吸到与前段相接；间隙再小也尽量放下
 * （贴合两侧、按剩余间隙缩短回落窗口、最短 0.08s）；
 * 只有完全没有空隙时才拒绝创建。
 */
export function fitZoomAnimation(opts: {
  start: TimeInterval
  end: TimeInterval
  animations: ZoomAnimationClip[]
  duration: TimeInterval
  scale?: number
  focus?: NormalizedPoint
  origin?: ZoomKeyframeOrigin
  easing?: ZoomEasingPreset
  transitionDuration?: TimeInterval
}): ZoomAnimationClip | null {
  const { start, end, animations, duration } = opts
  const scale = opts.scale ?? 1.6
  const focus = opts.focus ?? { x: 0.5, y: 0.5 }
  const origin = opts.origin ?? 'automatic'
  const easing = opts.easing ?? '三次方缓动'
  const transitionDuration = opts.transitionDuration ?? 0.7

  if (!Number.isFinite(duration) || !(duration > 0)) return null
  const rawStart = Math.min(Math.max(Math.min(start, end), 0), duration)
  const neighbours = creationNeighbours(
    rawStart,
    animations,
    (clip) => clip.startTime,
    false
  )
  const previous = neighbours.previous
  const next = neighbours.next
  const lowerTouch = previous ? previous.endTime : 0
  const lowerClear = previous
    ? previous.endTime + effectiveExitDuration(previous, transitionDuration)
    : 0
  const upper = next ? next.startTime : duration
  if (!(upper - lowerTouch > 0.001)) return null

  const minimumDuration = 0.08
  let s = Math.min(Math.max(Math.min(start, end), lowerTouch), upper)
  // 起点落入洞口：吸到与前一段相接。
  if (s < lowerClear) s = lowerTouch
  const isClick = Math.abs(end - start) < 0.08
  const requestedLength = isClick
    ? Math.min(1.5, Math.max(duration * 0.2, 0.6))
    : Math.max(Math.abs(end - start), minimumDuration)

  let e = s + requestedLength
  if (e > upper) {
    e = upper
    // 保持长度优先：整段左移进空隙；空隙连最短时长都放不下时缩成刚好填满。
    const shifted = Math.max(e - requestedLength, lowerTouch)
    if (upper - shifted >= minimumDuration) {
      s = shifted
    } else {
      s = lowerTouch
    }
  }
  if (!(e - s >= minimumDuration - EPSILON) || !(e - s > 0.001)) return null
  // 回落窗口适配剩余间隙（可短，不留就相接下一段）。
  const fittedExit = Math.min(transitionDuration, Math.max(upper - e, 0))
  return makeClip({
    startTime: s,
    endTime: e,
    scale,
    focus,
    origin,
    easing,
    enterDuration: transitionDuration,
    exitDuration: fittedExit,
    preferredEnterDuration: transitionDuration,
    preferredExitDuration: transitionDuration,
  })
}

/** Swift L113-141 —— 手动画笔（不吸附邻居，只夹进 [0, duration]）。 */
export function manualZoomAnimation(opts: {
  start: TimeInterval
  end: TimeInterval
  duration: TimeInterval
  scale?: number
  focus?: NormalizedPoint
  easing?: ZoomEasingPreset
  transitionDuration?: TimeInterval
}): ZoomAnimationClip | null {
  const { start, end, duration } = opts
  const scale = opts.scale ?? 1.6
  const focus = opts.focus ?? { x: 0.5, y: 0.5 }
  const easing = opts.easing ?? '三次方缓动'
  const transitionDuration = opts.transitionDuration ?? 0.7

  if (!Number.isFinite(duration) || !(duration > 0)) return null
  const rawStart = Math.min(Math.max(Math.min(start, end), 0), duration)
  const draggedDuration = Math.abs(end - start)
  const requestedEnd =
    draggedDuration < 0.08
      ? Math.min(rawStart + Math.min(1.5, Math.max(duration * 0.2, 0.6)), duration)
      : Math.min(Math.max(Math.max(start, end), 0), duration)
  const minimumDuration = Math.min(0.24, Math.max(duration - rawStart, 0))
  const rangeEnd = Math.min(Math.max(requestedEnd, rawStart + minimumDuration), duration)
  if (!(rangeEnd - rawStart > 0.01)) return null
  return makeClip({
    startTime: rawStart,
    endTime: rangeEnd,
    scale,
    focus,
    origin: 'manual',
    easing,
    enterDuration: transitionDuration,
    exitDuration: transitionDuration,
  })
}

/**
 * Swift L143-169 —— 手动区间的关键帧形态。
 * 注意这里的最短时长是 0.6（比片段版的 0.24 长），且进入/回落各占 30%
 * 上限 0.28s，四个关键帧严格 1 → scale → scale → 1。
 */
export function manualZoomRangeKeyframes(opts: {
  start: TimeInterval
  end: TimeInterval
  duration: TimeInterval
  scale?: number
  focus?: NormalizedPoint
}): ZoomKeyframe[] {
  const { start, end, duration } = opts
  const scale = opts.scale ?? 1.6
  const focus = opts.focus ?? { x: 0.5, y: 0.5 }

  if (!Number.isFinite(duration) || !(duration > 0)) return []
  const rawStart = Math.min(Math.max(Math.min(start, end), 0), duration)
  const draggedDuration = Math.abs(end - start)
  const requestedEnd =
    draggedDuration < 0.08
      ? Math.min(rawStart + Math.min(1.5, Math.max(duration * 0.2, 0.6)), duration)
      : Math.min(Math.max(Math.max(start, end), 0), duration)
  const minimumDuration = Math.min(0.6, Math.max(duration - rawStart, 0))
  const rangeEnd = Math.min(Math.max(requestedEnd, rawStart + minimumDuration), duration)
  if (!(rangeEnd - rawStart > 0.01)) return []

  const transition = Math.min(0.28, (rangeEnd - rawStart) * 0.3)
  const zoomInTime = rawStart + transition
  const zoomOutTime = Math.max(rangeEnd - transition, zoomInTime + 0.001)
  return [
    makeKeyframe({ time: rawStart, scale: 1, focus, origin: 'manual' }),
    makeKeyframe({ time: zoomInTime, scale: Math.max(scale, 1), focus, origin: 'manual' }),
    makeKeyframe({ time: zoomOutTime, scale: Math.max(scale, 1), focus, origin: 'manual' }),
    makeKeyframe({ time: rangeEnd, scale: 1, focus, origin: 'manual' }),
  ]
}

// ---------------------------------------------------------------- 坐标换算

/** Swift L171-178 —— X 像素 → 时间（夹到 [0,1] 后乘时长）。 */
export function clampedTime(x: number, width: number, duration: TimeInterval): TimeInterval {
  if (!Number.isFinite(width) || !(width > 0)) return 0
  if (!Number.isFinite(duration) || !(duration > 0)) return 0
  return Math.min(Math.max(x / width, 0), 1) * duration
}

/** Swift L180-187 —— 时间 → X 像素。 */
export function xPosition(time: TimeInterval, width: number, duration: TimeInterval): number {
  if (!Number.isFinite(width) || !(width > 0)) return 0
  if (!Number.isFinite(duration) || !(duration > 0)) return 0
  return Math.min(Math.max(time / duration, 0), 1) * width
}

// ---------------------------------------------------------------- 段表

/** Swift L189-211 —— 片段 → 时间线渲染段。 */
export function zoomSegmentsFromAnimations(
  animations: ZoomAnimationClip[],
  duration: TimeInterval
): TimelineZoomSegment[] {
  if (!Number.isFinite(duration) || !(duration > 0)) return []
  return animations
    .filter(
      (clip) => Number.isFinite(clip.startTime) && Number.isFinite(clip.endTime) && clip.endTime > clip.startTime
    )
    .map((clip) =>
      makeTimelineZoomSegment({
        id: clip.id,
        startTime: Math.min(Math.max(clip.startTime, 0), duration),
        endTime: Math.min(Math.max(clip.endTime, 0), duration),
        scale: clip.scale,
        origin: clip.origin,
        representativeKeyframeID: clip.id,
        easing: clip.easing,
        enterDuration: clip.enterDuration,
        exitDuration: clip.exitDuration,
      })
    )
    .filter((segment) => segment.endTime - segment.startTime > 0.001)
    .sort((lhs, rhs) => lhs.startTime - rhs.startTime)
}

// ---------------------------------------------------------------- 拆分

/**
 * Swift L213-234 —— 在 time 处把一段拆成两段。
 *
 * 右段保留至少 0.15s 的进入过渡：拆分产生两个相接的相机状态，
 * 编辑右段焦点时需要真实的交接时长才能平滑推拉，否则剪切点上是瞬时跳变。
 */
export function splitZoomAnimation(
  animation: ZoomAnimationClip,
  time: TimeInterval,
  minimumDuration = 0.16
): [ZoomAnimationClip, ZoomAnimationClip] | null {
  const splitTime = Math.min(Math.max(time, animation.startTime), animation.endTime)
  if (!(splitTime - animation.startTime >= minimumDuration)) return null
  if (!(animation.endTime - splitTime >= minimumDuration)) return null

  const left = withPreservedTransitionIntent(animation)
  left.endTime = splitTime
  left.exitDuration = 0

  const right = withPreservedTransitionIntent(animation)
  right.id = cryptoId()
  right.startTime = splitTime
  right.enterDuration = Math.max(animation.enterDuration, 0.15)
  return [left, right]
}

function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `clip-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

// ---------------------------------------------------------------- 邻接合法性

/**
 * Swift L239-250 —— 相邻两段缩放的合法关系。
 * 片段区间不重叠，且要么相接（前段退出休眠、后段接着过渡），
 * 要么给前段留足整个退出回落窗口。
 */
export function zoomSequenceIsValid(
  previous: ZoomAnimationClip,
  next: ZoomAnimationClip,
  previousExit: TimeInterval | null = null
): boolean {
  if (!(next.startTime >= previous.endTime - EPSILON)) return false
  if (next.startTime - previous.endTime > ZOOM_INTERP.adjacencyTolerance) {
    const exit = previousExit ?? previous.exitDuration
    return next.startTime >= previous.endTime + exit - EPSILON
  }
  return true
}

/** Swift L253-258 —— 没有显式退出时长的片段作为结尾时按默认过渡计。 */
export function effectiveExitDuration(
  clip: ZoomAnimationClip,
  defaultExit: TimeInterval
): TimeInterval {
  return requestedExitDuration(clip, defaultExit)
}

/**
 * Swift L265-306 —— 拖动/调整一段缩放后修复退出时长。
 *
 * 被编辑片段及其前驱一旦不再与后一段相接就成为「结尾」：退出时长为 0 时
 * 补上默认过渡，避免结尾瞬跳回 1×。补上的时长按剩余间隙封顶 —— 超出间隙
 * 会让 effectEndTime 越过邻居起点，提交校验失败、整个拖动被回滚
 * （用户看到的是「松手又缩回去了」）。仍相接的片段保持不变。
 */
export function exitNormalizations(
  afterEditingID: string,
  animations: ZoomAnimationClip[],
  defaultExit: TimeInterval
): ZoomAnimationClip[] {
  const edited = animations.find((clip) => clip.id === afterEditingID)
  if (!edited) return []
  let predecessor: ZoomAnimationClip | null = null
  let successor: ZoomAnimationClip | null = null
  for (const candidate of animations) {
    if (candidate.id === afterEditingID) continue
    if (zoomAnimationPrecedes(candidate, edited)) {
      if (predecessor === null || zoomAnimationPrecedes(predecessor, candidate)) {
        predecessor = candidate
      }
    } else if (successor === null || zoomAnimationPrecedes(candidate, successor)) {
      successor = candidate
    }
  }

  const patches: ZoomAnimationClip[] = []
  const appendPatch = (clip: ZoomAnimationClip, next: ZoomAnimationClip | null): void => {
    const touchesSuccessor =
      next !== null &&
      Math.abs(next.startTime - clip.endTime) <= ZOOM_INTERP.adjacencyTolerance
    if (touchesSuccessor) return
    const requested = requestedExitDuration(clip, defaultExit)
    const available = next !== null ? next.startTime - clip.endTime : requested
    const patched = withPreservedTransitionIntent(clip, defaultExit)
    patched.exitDuration = Math.min(requested, Math.max(available, 0))
    if (patched.exitDuration > clip.exitDuration + 0.000_001) {
      patched.exitProgressOffset = 0
    }
    if (!zoomClipEquals(patched, clip)) patches.push(patched)
  }
  if (predecessor !== null) appendPatch(predecessor, edited)
  appendPatch(edited, successor)
  return patches
}

function zoomClipEquals(lhs: ZoomAnimationClip, rhs: ZoomAnimationClip): boolean {
  return (
    lhs.id === rhs.id &&
    lhs.startTime === rhs.startTime &&
    lhs.endTime === rhs.endTime &&
    lhs.scale === rhs.scale &&
    lhs.focus.x === rhs.focus.x &&
    lhs.focus.y === rhs.focus.y &&
    lhs.origin === rhs.origin &&
    lhs.easing === rhs.easing &&
    lhs.enterDuration === rhs.enterDuration &&
    lhs.exitDuration === rhs.exitDuration &&
    lhs.enterProgressOffset === rhs.enterProgressOffset &&
    lhs.exitProgressOffset === rhs.exitProgressOffset &&
    lhs.preferredEnterDuration === rhs.preferredEnterDuration &&
    lhs.preferredExitDuration === rhs.preferredExitDuration
  )
}

// ---------------------------------------------------------------- 移动 / 调整

/**
 * Swift L308-359 —— 平移一段缩放。
 *
 * 合法位置集合是两条区间：贴着前一段（或让开它的回落窗口）×
 * 贴着后一段（或留足自己的回落）。落在「洞口」时吸附到最近的合法位置
 * （磁吸相接），而不是硬夹到一个视觉上断裂的点。
 */
export function movingZoomAnimation(
  animation: ZoomAnimationClip,
  proposedStart: TimeInterval,
  animations: ZoomAnimationClip[],
  duration: TimeInterval,
  defaultExit: TimeInterval = 0.7
): ZoomAnimationClip {
  const { previous, next } = zoomAnimationNeighbours(animation, animations)
  const previousEnd = previous ? previous.endTime : 0
  const previousClear =
    previousEnd + (previous ? effectiveExitDuration(previous, defaultExit) : 0)
  const nextStart = next ? next.startTime : duration
  const ownExit = effectiveExitDuration(animation, defaultExit)
  const ownDuration = clipDuration(animation)
  const touchStart = nextStart - ownDuration
  // 间隙连片段区间本身都放不下（贴住两侧也不够长）：拒绝移动。
  if (!(touchStart >= previousEnd - EPSILON)) return animation

  const isValid = (start: TimeInterval): boolean => {
    const touchesPrevious = start <= previousEnd + ZOOM_INTERP.adjacencyTolerance
    const clearsPrevious = start >= previousClear - EPSILON
    const end = start + ownDuration
    const touchesNext = nextStart - end <= ZOOM_INTERP.adjacencyTolerance
    const clearsNext = end + ownExit <= nextStart + EPSILON
    return (touchesPrevious || clearsPrevious) && (touchesNext || clearsNext)
  }

  let start = Math.min(Math.max(proposedStart, previousEnd), touchStart)
  if (!isValid(start)) {
    const candidates = [previousEnd, previousClear, touchStart, touchStart - ownExit].filter(
      (candidate) =>
        isValid(candidate) && candidate >= previousEnd - EPSILON && candidate <= touchStart + EPSILON
    )
    if (candidates.length === 0) return animation
    start = candidates.reduce((best, candidate) =>
      Math.abs(candidate - proposedStart) < Math.abs(best - proposedStart) ? candidate : best
    )
  }
  const moved: ZoomAnimationClip = { ...animation }
  moved.startTime = start
  moved.endTime = start + ownDuration
  if (Math.abs(start - animation.startTime) > 0.000_001) {
    const preserved = withPreservedTransitionIntent(moved, defaultExit)
    preserved.enterProgressOffset = 0
    preserved.exitProgressOffset = 0
    return preserved
  }
  return moved
}

/** Swift L361-428 —— 拖左端/右端调整一段缩放，规则与移动同源。 */
export function resizingZoomAnimation(opts: {
  animation: ZoomAnimationClip
  proposedStart?: TimeInterval | null
  proposedEnd?: TimeInterval | null
  animations: ZoomAnimationClip[]
  duration: TimeInterval
  minimumDuration?: TimeInterval
  defaultExit?: TimeInterval
}): ZoomAnimationClip {
  const { animation, animations, duration } = opts
  const proposedStart = opts.proposedStart ?? null
  const proposedEnd = opts.proposedEnd ?? null
  const minimumDuration = opts.minimumDuration ?? 0.16
  const defaultExit = opts.defaultExit ?? 0.7

  const { previous, next } = zoomAnimationNeighbours(animation, animations)
  const previousEnd = previous ? previous.endTime : 0
  const previousClear =
    previousEnd + (previous ? effectiveExitDuration(previous, defaultExit) : 0)
  const nextStart = next ? next.startTime : duration
  const ownExit = effectiveExitDuration(animation, defaultExit)
  const resized: ZoomAnimationClip = { ...animation }

  if (proposedStart !== null) {
    const lowerBound = previousEnd
    const upperBound = animation.endTime - minimumDuration
    const isValid = (start: TimeInterval): boolean => {
      if (!(start <= upperBound + EPSILON)) return false
      return start <= previousEnd + ZOOM_INTERP.adjacencyTolerance || start >= previousClear - EPSILON
    }
    let start = Math.min(Math.max(proposedStart, lowerBound), Math.max(upperBound, lowerBound))
    if (!isValid(start)) {
      const candidates = [previousEnd, previousClear, upperBound].filter(
        (candidate) => isValid(candidate) && candidate >= lowerBound - EPSILON
      )
      if (candidates.length === 0) return animation
      start = candidates.reduce((best, candidate) =>
        Math.abs(candidate - proposedStart) < Math.abs(best - proposedStart) ? candidate : best
      )
    }
    resized.startTime = start
    if (Math.abs(start - animation.startTime) > 0.000_001) {
      const preserved = withPreservedTransitionIntent(resized, defaultExit)
      preserved.enterProgressOffset = 0
      resized.startTime = preserved.startTime
      resized.endTime = preserved.endTime
      resized.enterProgressOffset = preserved.enterProgressOffset
      resized.preferredEnterDuration = preserved.preferredEnterDuration
      resized.preferredExitDuration = preserved.preferredExitDuration
    }
  }

  if (proposedEnd !== null) {
    const lowerBound = animation.startTime + minimumDuration
    const upperBound = nextStart
    const isValid = (end: TimeInterval): boolean => {
      if (!(end >= lowerBound - EPSILON)) return false
      return nextStart - end <= ZOOM_INTERP.adjacencyTolerance || end + ownExit <= nextStart + EPSILON
    }
    let end = Math.min(Math.max(proposedEnd, lowerBound), Math.max(upperBound, lowerBound))
    if (!isValid(end)) {
      const candidates = [nextStart, nextStart - ownExit, lowerBound].filter(
        (candidate) => isValid(candidate) && candidate <= upperBound + EPSILON
      )
      if (candidates.length === 0) return animation
      end = candidates.reduce((best, candidate) =>
        Math.abs(candidate - proposedEnd) < Math.abs(best - proposedEnd) ? candidate : best
      )
    }
    resized.endTime = end
    if (Math.abs(end - animation.endTime) > 0.000_001) {
      const preserved = withPreservedTransitionIntent(resized, defaultExit)
      resized.exitProgressOffset = preserved.exitProgressOffset
      resized.preferredEnterDuration = preserved.preferredEnterDuration
      resized.preferredExitDuration = preserved.preferredExitDuration
    }
  }
  return resized
}

// ---------------------------------------------------------------- 命中测试

/**
 * Swift L434-485 —— 缩放轨道的指针命中测试。
 *
 * 与 `zoomTimeline` 的布局公式保持一致：片段条垂直居中、最短渲染宽度 14pt、
 * 手柄仅对选中/悬停片段出现。唯一消费者是轨道级单一拖动手势 —— 不再把
 * 创建/移动/调整拆成三个相互竞争的手势（兄弟手势竞争曾让空白创建手势
 * 抢走片段上的每一次按下）。
 */
export function zoomHitZone(opts: {
  x: number
  y: number
  segments: TimelineZoomSegment[]
  width: number
  duration: TimeInterval
  selectedID: string | null
  hoveredID: string | null
  trackHeight?: number
  barHeight?: number
  minimumSegmentWidth?: number
  segmentsAreOrdered?: boolean
}): ZoomTrackHitZone {
  const {
    x,
    y,
    segments,
    width,
    duration,
    selectedID,
    hoveredID,
  } = opts
  const trackHeight = opts.trackHeight ?? 56
  const barHeight = opts.barHeight ?? 42
  const minimumSegmentWidth = opts.minimumSegmentWidth ?? 14
  const segmentsAreOrdered = opts.segmentsAreOrdered ?? false

  if (!Number.isFinite(width) || !(width > 0)) return EMPTY_HIT_ZONE
  if (!Number.isFinite(duration) || !(duration > 0)) return EMPTY_HIT_ZONE
  if (!Number.isFinite(x) || !Number.isFinite(y)) return EMPTY_HIT_ZONE
  const barMinY = (trackHeight - barHeight) / 2
  const barMaxY = barMinY + barHeight
  if (!(y >= barMinY) || !(y <= barMaxY)) return EMPTY_HIT_ZONE

  const zoneFor = (segment: TimelineZoomSegment): ZoomTrackHitZone | null => {
    const startX = (segment.startTime / duration) * width
    const segmentWidth = Math.max(
      ((segment.endTime - segment.startTime) / duration) * width,
      minimumSegmentWidth
    )
    if (!(x >= startX) || !(x <= startX + segmentWidth)) return null
    if (segment.id === selectedID || segment.id === hoveredID) {
      const handleHalfWidth = Math.min(9, segmentWidth * 0.35)
      if (x - startX <= handleHalfWidth) {
        return { kind: 'resize', id: segment.id, leading: true }
      }
      if (startX + segmentWidth - x <= handleHalfWidth) {
        return { kind: 'resize', id: segment.id, leading: false }
      }
    }
    return { kind: 'move', id: segment.id }
  }

  if (segmentsAreOrdered) {
    const index = lastItemStartingAtOrBefore(x, segments, (segment) =>
      (segment.startTime / duration) * width
    )
    if (index === null) return EMPTY_HIT_ZONE
    return zoneFor(segments[index]) ?? EMPTY_HIT_ZONE
  }

  // 后声明的片段渲染在更上层；命中测试也从最上层开始。
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const hit = zoneFor(segments[index])
    if (hit !== null) return hit
  }
  return EMPTY_HIT_ZONE
}

/** Swift `(id: UUID, timing: TransitionTiming)` 元组载体。 */
export interface MotionTimingItem {
  id: string
  timing: TransitionTiming
}

/** Swift L489-517 —— tuple 版便捷包装（泛型版的柯里化调用）。 */
export function motionHitZone(opts: {
  x: number
  y: number
  timings: MotionTimingItem[]
  width: number
  duration: TimeInterval
  selectedID: string | null
  hoveredID: string | null
  trackHeight?: number
  barHeight?: number
  minimumClipWidth?: number
  itemsAreOrdered?: boolean
}): ZoomTrackHitZone {
  return motionHitZoneOf({
    ...opts,
    items: opts.timings,
    id: (item: MotionTimingItem) => item.id,
    timing: (item: MotionTimingItem) => item.timing,
  })
}

/**
 * Swift L522-595 —— 泛型快路径。编辑器已排序的表现片段可直接传入，
 * 避免每次 hover 都把整条轨道映射成临时元组；无序输入仍得到确定的 z 序。
 */
export function motionHitZoneOf<T>(opts: {
  x: number
  y: number
  items: T[]
  id: (item: T) => string
  timing: (item: T) => TransitionTiming
  width: number
  duration: TimeInterval
  selectedID: string | null
  hoveredID: string | null
  trackHeight?: number
  barHeight?: number
  minimumClipWidth?: number
  itemsAreOrdered?: boolean
}): ZoomTrackHitZone {
  const { x, y, items, id, timing, width, duration, selectedID, hoveredID } = opts
  const trackHeight = opts.trackHeight ?? 46
  const barHeight = opts.barHeight ?? 36
  const minimumClipWidth = opts.minimumClipWidth ?? 7
  const itemsAreOrdered = opts.itemsAreOrdered ?? false

  if (!Number.isFinite(width) || !(width > 0)) return EMPTY_HIT_ZONE
  if (!Number.isFinite(duration) || !(duration > 0)) return EMPTY_HIT_ZONE
  if (!Number.isFinite(x) || !Number.isFinite(y)) return EMPTY_HIT_ZONE
  const barMinY = (trackHeight - barHeight) / 2
  const barMaxY = barMinY + barHeight
  if (!(y >= barMinY) || !(y <= barMaxY)) return EMPTY_HIT_ZONE

  const zoneFor = (item: T): ZoomTrackHitZone | null => {
    const clipID = id(item)
    const clipTiming = timing(item)
    const startX = (clipTiming.startTime / duration) * width
    const clipWidth = Math.max(
      ((clipTiming.startTime + clipTiming.duration - clipTiming.startTime) / duration) * width,
      minimumClipWidth
    )
    if (!(x >= startX) || !(x <= startX + clipWidth)) return null
    if (clipID === selectedID || clipID === hoveredID) {
      const handleHalfWidth = Math.min(8, clipWidth * 0.35)
      if (x - startX <= handleHalfWidth) return { kind: 'resize', id: clipID, leading: true }
      if (startX + clipWidth - x <= handleHalfWidth) {
        return { kind: 'resize', id: clipID, leading: false }
      }
    }
    return { kind: 'move', id: clipID }
  }

  if (itemsAreOrdered) {
    const index = lastItemStartingAtOrBefore(x, items, (item) =>
      (timing(item).startTime / duration) * width
    )
    if (index === null) return EMPTY_HIT_ZONE
    return zoneFor(items[index]) ?? EMPTY_HIT_ZONE
  }

  let isOrdered = true
  for (let index = 1; index < items.length; index += 1) {
    if (motionItemPrecedes(items[index], items[index - 1], id, timing)) {
      isOrdered = false
      break
    }
  }
  if (isOrdered) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const hit = zoneFor(items[index])
      if (hit !== null) return hit
    }
    return EMPTY_HIT_ZONE
  }

  const orderedIndices = items
    .map((_, index) => index)
    .sort((lhs, rhs) => (motionItemPrecedes(items[lhs], items[rhs], id, timing) ? -1 : 1))
  for (let cursor = orderedIndices.length - 1; cursor >= 0; cursor -= 1) {
    const hit = zoneFor(items[orderedIndices[cursor]])
    if (hit !== null) return hit
  }
  return EMPTY_HIT_ZONE
}

// ---------------------------------------------------------------- 运动创建拟合

/** Swift L599-620 —— tuple/timing 数组便捷包装。 */
export function fitMotionTiming(opts: {
  start: TimeInterval
  end: TimeInterval
  timings: TransitionTiming[]
  duration: TimeInterval
  easing?: ZoomEasingPreset
  returnDuration: TimeInterval
  leadInDuration?: TimeInterval | null
  itemsAreOrdered?: boolean
}): TransitionTiming | null {
  return fitMotionTimingOf({
    start: opts.start,
    end: opts.end,
    items: opts.timings,
    timing: (item: TransitionTiming) => item,
    duration: opts.duration,
    easing: opts.easing,
    returnDuration: opts.returnDuration,
    leadInDuration: opts.leadInDuration ?? null,
    itemsAreOrdered: opts.itemsAreOrdered ?? false,
  })
}

/**
 * Swift L624-685 —— 运动片段的创建拟合，与缩放创建同思路：
 * 起点落入前一段回落窗口「洞口」时吸到相接，小间隙贴合两侧并适配回落窗口，
 * 完全没有空隙才返回 null。
 *
 * 与缩放版的三个差异：最短时长 0.16、点击默认长度 `max(15% 时长, 0.5)` 上限 1.2、
 * 进入过渡上限是片段长度本身（而不是固定过渡时长）。
 */
export function fitMotionTimingOf<T>(opts: {
  start: TimeInterval
  end: TimeInterval
  items: T[]
  timing: (item: T) => TransitionTiming
  duration: TimeInterval
  easing?: ZoomEasingPreset
  returnDuration: TimeInterval
  leadInDuration?: TimeInterval | null
  itemsAreOrdered?: boolean
}): TransitionTiming | null {
  const { start, end, items, timing, duration, returnDuration } = opts
  const easing = opts.easing ?? '三次方缓动'
  const leadInDuration = opts.leadInDuration ?? null
  const itemsAreOrdered = opts.itemsAreOrdered ?? false

  if (!Number.isFinite(duration) || !(duration > 0)) return null
  const rawStart = Math.min(Math.max(Math.min(start, end), 0), duration)
  const neighbours = creationNeighbours(rawStart, items, (item) => timing(item).startTime, itemsAreOrdered)
  const previous = neighbours.previous !== null ? timing(neighbours.previous) : null
  const next = neighbours.next !== null ? timing(neighbours.next) : null
  const lowerTouch = previous ? timingEndTime(previous) : 0
  const lowerClear = previous
    ? timingEndTime(previous) +
      (previous.returnDuration > 0.000_1 ? previous.returnDuration : returnDuration)
    : 0
  const upper = next ? next.startTime : duration
  if (!(upper - lowerTouch > 0.001)) return null

  const minimumDuration = 0.16
  let s = Math.min(Math.max(Math.min(start, end), lowerTouch), upper)
  if (s < lowerClear) s = lowerTouch
  const isClick = Math.abs(end - start) < 0.08
  const requestedLength = isClick
    ? Math.min(1.2, Math.max(duration * 0.15, 0.5))
    : Math.max(Math.abs(end - start), minimumDuration)
  let e = s + requestedLength
  if (e > upper) {
    e = upper
    const shifted = Math.max(e - requestedLength, lowerTouch)
    if (upper - shifted >= minimumDuration) {
      s = shifted
    } else {
      s = lowerTouch
    }
  }
  if (!(e - s >= minimumDuration - EPSILON) || !(e - s > 0.001)) return null
  const fittedReturn = Math.min(returnDuration, Math.max(upper - e, 0))
  // 进入过渡按传入速度（默认整段），不超过整段时长，其余为保持
  const fittedLeadIn = Math.min(Math.max(leadInDuration ?? e - s, 0), e - s)
  return makeTransitionTiming({
    startTime: s,
    duration: e - s,
    leadInDuration: fittedLeadIn,
    easing,
    returnDuration: fittedReturn,
    preferredLeadInDuration: Math.min(Math.max(leadInDuration ?? e - s, 0), 5),
    preferredReturnDuration: Math.min(Math.max(returnDuration, 0), 5),
  })
}

// ---------------------------------------------------------------- 邻居查找

/**
 * Swift L691-735 —— 找出紧邻请求起点之前的元素及其直接后继，
 * 不排序、不再实体化第二个数组。规范有序轨道走二分；两次有界扫描
 * 保留对历史无序工程输入的支持。
 */
function creationNeighbours<T>(
  rawStart: TimeInterval,
  items: T[],
  startTime: (item: T) => TimeInterval,
  itemsAreOrdered: boolean
): { previous: T | null; next: T | null } {
  if (itemsAreOrdered) {
    let lower = 0
    let upper = items.length
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2)
      if (startTime(items[middle]) <= rawStart + EPSILON) {
        lower = middle + 1
      } else {
        upper = middle
      }
    }
    return {
      previous: lower > 0 ? items[lower - 1] : null,
      next: lower < items.length ? items[lower] : null,
    }
  }

  let previous: T | null = null
  let previousStart = Number.NEGATIVE_INFINITY
  for (const item of items) {
    const candidateStart = startTime(item)
    if (!(candidateStart <= rawStart + EPSILON)) continue
    if (!(candidateStart >= previousStart)) continue
    previous = item
    previousStart = candidateStart
  }

  const threshold = previous !== null ? startTime(previous) : -1
  let next: T | null = null
  let nextStart = Number.POSITIVE_INFINITY
  for (const item of items) {
    const candidateStart = startTime(item)
    if (!(candidateStart > threshold + EPSILON)) continue
    if (!(candidateStart < nextStart)) continue
    next = item
    nextStart = candidateStart
  }
  return { previous, next }
}

/** Swift L737-753 —— 最后一个 startX <= x 的下标（二分）。 */
function lastItemStartingAtOrBefore<T>(
  x: number,
  items: T[],
  startX: (item: T) => number
): number | null {
  let lower = 0
  let upper = items.length
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2)
    if (startX(items[middle]) <= x) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }
  return lower > 0 ? lower - 1 : null
}

/** Swift L755-766 —— 起点相同则按 id 字典序，保证确定 z 序。 */
function motionItemPrecedes<T>(
  lhs: T,
  rhs: T,
  id: (item: T) => string,
  timing: (item: T) => TransitionTiming
): boolean {
  const lhsTiming = timing(lhs)
  const rhsTiming = timing(rhs)
  return lhsTiming.startTime === rhsTiming.startTime
    ? id(lhs) < id(rhs)
    : lhsTiming.startTime < rhsTiming.startTime
}

// ---------------------------------------------------------------- 运动回落归一

/** Swift L772-784 —— tuple 版包装。 */
export function motionReturnNormalizations(
  afterEditingID: string,
  timings: MotionTimingItem[],
  defaultReturn: TimeInterval
): MotionTimingItem[] {
  return motionReturnNormalizationsOf(
    afterEditingID,
    timings,
    (item: MotionTimingItem) => item.id,
    (item: MotionTimingItem) => item.timing,
    defaultReturn
  )
}

/**
 * Swift L789-834 —— 运动片段回落归一。
 *
 * 被编辑片段及其前驱一旦不再与后一段相接就成为「结尾」：回落时长为 0 时
 * 补上默认回落（避免结尾永久保持目标状态）。与缩放同一规则：补上的时长按
 * 剩余间隙封顶，否则提交校验失败、拖动被整体回滚。
 */
export function motionReturnNormalizationsOf<T>(
  editedID: string,
  items: T[],
  id: (item: T) => string,
  timing: (item: T) => TransitionTiming,
  defaultReturn: TimeInterval
): MotionTimingItem[] {
  const editedItem = items.find((item) => id(item) === editedID)
  if (editedItem === undefined) return []
  const edited: MotionTimingItem = { id: id(editedItem), timing: timing(editedItem) }
  let predecessor: MotionTimingItem | null = null
  let successor: MotionTimingItem | null = null
  for (const item of items) {
    if (id(item) === editedID) continue
    const candidate: MotionTimingItem = { id: id(item), timing: timing(item) }
    if (motionTimingPrecedes(candidate, edited)) {
      if (predecessor === null || motionTimingPrecedes(predecessor, candidate)) {
        predecessor = candidate
      }
    } else if (successor === null || motionTimingPrecedes(candidate, successor)) {
      successor = candidate
    }
  }

  const patches: MotionTimingItem[] = []
  const appendPatch = (clip: MotionTimingItem, next: MotionTimingItem | null): void => {
    const touchesSuccessor =
      next !== null &&
      Math.abs(next.timing.startTime - timingEndTime(clip.timing)) <= ZOOM_INTERP.adjacencyTolerance
    if (touchesSuccessor) return
    const patched = withPreservedTimingIntent(clip.timing, defaultReturn)
    const requested = requestedReturnDuration(patched, defaultReturn)
    const available =
      next !== null ? next.timing.startTime - timingEndTime(clip.timing) : requested
    patched.returnDuration = Math.min(requested, Math.max(available, 0))
    if (patched.returnDuration > clip.timing.returnDuration + 0.000_001) {
      patched.returnProgressOffset = 0
    }
    if (!transitionTimingEquals(patched, clip.timing)) patches.push({ id: clip.id, timing: patched })
  }
  if (predecessor !== null) appendPatch(predecessor, edited)
  appendPatch(edited, successor)
  return patches
}

function transitionTimingEquals(lhs: TransitionTiming, rhs: TransitionTiming): boolean {
  return (
    lhs.startTime === rhs.startTime &&
    lhs.duration === rhs.duration &&
    lhs.leadInDuration === rhs.leadInDuration &&
    lhs.leadInProgressOffset === rhs.leadInProgressOffset &&
    lhs.easing === rhs.easing &&
    lhs.returnDuration === rhs.returnDuration &&
    lhs.returnProgressOffset === rhs.returnProgressOffset &&
    lhs.preferredLeadInDuration === rhs.preferredLeadInDuration &&
    lhs.preferredReturnDuration === rhs.preferredReturnDuration
  )
}

// ---------------------------------------------------------------- 排序辅助

/**
 * Swift L836-853 —— 缩放邻居。
 * 注意「前驱」判据是 `startTime < self.startTime`，而「后继」判据是
 * `startTime >= self.endTime`；起点相同但更早的片段不算前驱。
 */
function zoomAnimationNeighbours(
  animation: ZoomAnimationClip,
  animations: ZoomAnimationClip[]
): { previous: ZoomAnimationClip | null; next: ZoomAnimationClip | null } {
  let previous: ZoomAnimationClip | null = null
  let next: ZoomAnimationClip | null = null
  for (const candidate of animations) {
    if (candidate.id === animation.id) continue
    if (candidate.startTime < animation.startTime - EPSILON) {
      if (previous === null || zoomAnimationPrecedes(previous, candidate)) previous = candidate
    } else if (candidate.startTime >= animation.endTime - EPSILON) {
      if (next === null || zoomAnimationPrecedes(candidate, next)) next = candidate
    }
  }
  return { previous, next }
}

/** Swift L855-862。 */
function zoomAnimationPrecedes(lhs: ZoomAnimationClip, rhs: ZoomAnimationClip): boolean {
  return lhs.startTime === rhs.startTime ? lhs.id < rhs.id : lhs.startTime < rhs.startTime
}

/** Swift L864-871。 */
function motionTimingPrecedes(lhs: MotionTimingItem, rhs: MotionTimingItem): boolean {
  return lhs.timing.startTime === rhs.timing.startTime
    ? lhs.id < rhs.id
    : lhs.timing.startTime < rhs.timing.startTime
}

// ---------------------------------------------------------------- 关键帧段表

/**
 * Swift L873-937 —— 旧版关键帧轨道 → 渲染段。
 *
 * 连续「scale > baseScale」的关键帧视为一个放大区间；段起点取**前一个**
 * 关键帧的时间（即开始爬升的那一刻），终点取区间后第一个关键帧的时间。
 * 代表关键帧是区间内 scale 最大者（同 scale 取最晚的）。
 */
export function zoomSegmentsFromKeyframes(
  keyframes: ZoomKeyframe[],
  duration: TimeInterval,
  baseScale = 1
): TimelineZoomSegment[] {
  if (!Number.isFinite(duration) || !(duration > 0)) return []
  const ordered = keyframes
    .filter((frame) => Number.isFinite(frame.time) && frame.time >= 0 && frame.time <= duration)
    .sort((lhs, rhs) =>
      lhs.time === rhs.time ? (lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0) : lhs.time - rhs.time
    )
  if (ordered.length === 0) return []

  const zoomThreshold = baseScale + EPSILON
  const segments: TimelineZoomSegment[] = []
  let index = 0
  while (index < ordered.length) {
    if (!(ordered[index].scale > zoomThreshold)) {
      index += 1
      continue
    }

    const firstZoomedIndex = index
    const startIndex = Math.max(firstZoomedIndex - 1, 0)
    let endIndex = firstZoomedIndex
    while (endIndex + 1 < ordered.length && ordered[endIndex + 1].scale > zoomThreshold) {
      endIndex += 1
    }

    const startTime = Math.min(Math.max(ordered[startIndex].time, 0), duration)
    const rawEndTime = endIndex + 1 < ordered.length ? ordered[endIndex + 1].time : duration
    const endTime = Math.min(Math.max(rawEndTime, startTime), duration)
    const zoomedFrames = ordered.slice(firstZoomedIndex, endIndex + 1)
    let representative = ordered[firstZoomedIndex]
    for (const frame of zoomedFrames) {
      if (frame.scale === representative.scale) {
        if (frame.time > representative.time) representative = frame
      } else if (frame.scale > representative.scale) {
        representative = frame
      }
    }
    const origin: ZoomKeyframeOrigin = zoomedFrames.some((frame) => frame.origin === 'manual')
      ? 'manual'
      : 'automatic'

    if (endTime - startTime > 0.001) {
      segments.push(
        makeTimelineZoomSegment({
          id: representative.id,
          startTime,
          endTime,
          scale: representative.scale,
          origin,
          representativeKeyframeID: representative.id,
          easing: '三次方缓动',
          enterDuration: 0.55,
          exitDuration: 0.55,
        })
      )
    }
    index = endIndex + 1
  }
  return segments
}

// ---------------------------------------------------------------- 聚合导出

/**
 * Swift `enum EditorTimelineMath` 的命名空间等价物。
 * 便于按 Swift 结构逐项断言，也是调用点的统一入口。
 */
export const EditorTimelineMath = {
  fitZoomAnimation,
  manualZoomAnimation,
  manualZoomRangeKeyframes,
  clampedTime,
  xPosition,
  zoomSegmentsFromAnimations,
  splitZoomAnimation,
  zoomSequenceIsValid,
  effectiveExitDuration,
  exitNormalizations,
  movingZoomAnimation,
  resizingZoomAnimation,
  zoomHitZone,
  motionHitZone,
  motionHitZoneOf,
  fitMotionTiming,
  fitMotionTimingOf,
  motionReturnNormalizations,
  motionReturnNormalizationsOf,
  zoomSegmentsFromKeyframes,
} as const

/** 便捷再导出：编辑器里常用但不属于 Swift 原文件的辅助。 */
export { clipEffectEndTime, timingEffectEndTime }
