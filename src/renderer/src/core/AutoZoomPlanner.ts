/**
 * Swift source: Sources/RecorderCore/AutoZoomPlanner.swift @ 567fd6e
 *
 * 逐结构对照：
 *   makeAnimations(for pointerEvents:...)                 L4-28
 *   repairingLegacyAutomaticAnimations(_:for:...)         L34-141
 *   makePerClickLegacyAnimations                          L146-194
 *   matchesLegacyPlan                                     L196-210
 *   matchesSourceClampedAutomaticPlan                     L217-239
 *   extendingAutomaticHoldsThroughPointerActivity         L245-305
 *   orderedValidClicks                                    L307-325
 *   lastIndex(atOrBefore:in:)                             L327-342
 *   firstIndex(after:in:)                                 L344-359
 *   mergingConnectedAutomaticEnvelopes                    L372-402
 *   makeAnimations(for clicks:...)                        L408-479
 *   SpatialFocusGroup / spatialFocusGroups                L481-541
 *   clipped(_:to:)（片段 / 关键帧两版）                    L543-580
 *   makeKeyframes(for:...)（两版）                         L582-647
 *
 * 这套规划器的设计意图（CAM-001...CAM-005）：
 *   · 一次「短促连续交互爆发」应当拥有**一个**缩放包络和**一台**持续运镜控制器。
 *   · 时间上相邻、且累积包围盒仍能舒适落进放大视口内的点击，视为同一
 *     「相机区域」—— 同一区域内的按钮/输入框/列表项只应移动光标，而不是
 *     整屏跟着晃。
 *   · 只有缺口、回落过渡、不同视觉策略或任何手动片段才切开新的包络。
 */

import {
  ZOOM_INTERP,
  clipEffectEndTime,
  constrainPoint,
  makeClip,
  makeKeyframe,
  sampleKeyframes,
  type NormalizedPoint,
  type PointerClick,
  type PointerEventRecord,
  type ZoomAnimationClip,
  type ZoomEasingPreset,
  type ZoomKeyframe,
} from './ZoomAnimation'
import { normalizedPointerEvents } from './PointerEventTimelineOrdering'
import type { MotionStyle } from './MotionStyle'
import { makeMotionStyle } from './MotionStyle'

export type TimeInterval = number

const EPSILON = 0.000_001

/** Swift AutoZoomPlanner 各入口共用的可调参数。 */
export interface AutoZoomPlanOptions {
  zoomScale?: number
  enterDuration?: number
  holdDuration?: number
  exitDuration?: number
  /** repairingLegacyAutomaticAnimations 的当前过渡时长（进入=回落）。 */
  transitionDuration?: number
  clickGroupGap?: number
  safeInset?: number
  easing?: ZoomEasingPreset
}

// ---------------------------------------------------------------- 指针 → 点击

/** Swift 三处重复的 `compactMap { kind == .leftClick || .rightClick }`。 */
export function pointerClicks(pointerEvents: PointerEventRecord[]): PointerClick[] {
  const clicks: PointerClick[] = []
  for (const event of pointerEvents) {
    if (event.kind !== 'leftClick' && event.kind !== 'rightClick') continue
    clicks.push({ time: event.time, location: { x: event.location.x, y: event.location.y } })
  }
  return clicks
}

// ---------------------------------------------------------------- 指针事件入口

/**
 * Swift L4-28。
 *
 * 三步流水：
 *   1. 按点击生成基础包络（同区域点击分组）
 *   2. 用指针活动延长每个包络的「保持」——点击只是开始，指针停手才该走
 *   3. 把首尾相接、策略一致的自动包络折成一个，避免每次点击都从零速度重启缓动
 */
export function makeAutoZoomAnimations(
  pointerEvents: PointerEventRecord[],
  options: AutoZoomPlanOptions = {}
): ZoomAnimationClip[] {
  const clicks = pointerClicks(pointerEvents)
  // Swift L14：过渡时长夹到 0...5
  const duration = Math.min(Math.max(options.enterDuration ?? 0.7, 0), 5)
  const planned = makeAutoZoomAnimationsFromClicks(clicks, {
    zoomScale: options.zoomScale ?? 1.6,
    enterDuration: duration,
    exitDuration: duration,
    easing: options.easing ?? '弹簧',
  })
  const extended = extendingAutomaticHoldsThroughPointerActivity(planned, clicks, pointerEvents)
  return mergingConnectedAutomaticEnvelopes(extended)
}

/**
 * Swift L34-141 —— 只修复「上一代规划器产出的、完全自动的整轨」，
 * 绝不碰用户编辑过或手动补过片段的轨道。
 *
 * 判据是「与已知历史输出逐字段一致」，因此：
 *   · 当前版本重跑能复现 → 直接折叠存储的片段（保留源素材裁剪后的真实边界）
 *   · 命中历史版本配方 → 用当前默认重置生成
 *   · 都不命中 → 原样返回
 */
export function repairingLegacyAutomaticAnimations(
  animations: ZoomAnimationClip[],
  pointerEvents: PointerEventRecord[],
  options: AutoZoomPlanOptions = {}
): ZoomAnimationClip[] {
  const easing = options.easing ?? '三次方缓动'
  const transitionDuration = options.transitionDuration ?? options.enterDuration ?? 0.7
  if (animations.length === 0) return animations
  if (!animations.every((clip) => clip.origin === 'automatic')) return animations

  const clicks = pointerClicks(pointerEvents)
  // 上一次启动可能已把工程全局默认升级为弹簧，而旧自动片段仍是三次方。
  // 两个都认，然后用下面的当前默认重生成。
  const legacyEasings: ZoomEasingPreset[] = [easing]
  if (easing !== '三次方缓动') legacyEasings.push('三次方缓动')

  const currentDuration = Math.min(Math.max(transitionDuration, 0), 5)
  const matchesExpectedPlan = (expected: ZoomAnimationClip[]): boolean => {
    if (expected.length !== animations.length) return false
    const pairwise = animations.every((candidate, index) =>
      matchesLegacyPlan(candidate, expected[index])
    )
    return pairwise || matchesSourceClampedAutomaticPlan(animations, expected)
  }

  // 紧邻的上一代规划器已经用了当前弹簧与时长，但把每个空间焦点组都持久化成
  // 一个「相接」片段。直接折叠已存片段，这样源素材裁剪后的末段保留真实录制边界。
  const currentSegmentedPlans: ZoomAnimationClip[][] = []
  for (const legacyEasing of legacyEasings) {
    const currentSegmented = makeAutoZoomAnimationsFromClicks(clicks, {
      enterDuration: currentDuration,
      exitDuration: currentDuration,
      easing: legacyEasing,
    })
    const activityExtended = extendingAutomaticHoldsThroughPointerActivity(
      currentSegmented,
      clicks,
      pointerEvents
    )
    currentSegmentedPlans.push(currentSegmented, activityExtended)
  }
  if (currentSegmentedPlans.some(matchesExpectedPlan)) {
    return mergingConnectedAutomaticEnvelopes(animations).map((clip) => ({
      ...clip,
      easing,
    }))
  }

  const knownLegacyPlans: ZoomAnimationClip[][] = []
  for (const legacyEasing of legacyEasings) {
    const currentLegacy = makeAutoZoomAnimationsFromClicks(clicks, {
      enterDuration: 0.42,
      exitDuration: 0.44,
      easing: legacyEasing,
    })
    const perClickLegacy = makePerClickLegacyAnimations(clicks, { easing: legacyEasing })
    // 录制器在保存前也会按连续指针活动延长旧版保持。这些片段可能正好结束在
    // 下一个自动区域开始处（退出过渡长度为 0），所以只跟「纯点击输出」比对
    // 会漏掉真实的未改动工程。
    const activityExtendedCurrentLegacy = extendingAutomaticHoldsThroughPointerActivity(
      currentLegacy,
      clicks,
      pointerEvents
    )
    const activityExtendedPerClickLegacy = extendingAutomaticHoldsThroughPointerActivity(
      perClickLegacy,
      clicks,
      pointerEvents
    )
    knownLegacyPlans.push(
      currentLegacy,
      activityExtendedCurrentLegacy,
      perClickLegacy,
      activityExtendedPerClickLegacy
    )
  }
  const matchesKnownAutomaticPlanner = knownLegacyPlans.some(matchesExpectedPlan)
  if (!matchesKnownAutomaticPlanner) return animations

  // 只重生成「可识别的、未改动的自动轨」——把旧的「一点击一片段」升级为稳定的
  // 空间点击组，同时逐字保留每一条手动/编辑过的轨道。
  const regrouped = makeAutoZoomAnimationsFromClicks(clicks, {
    enterDuration: currentDuration,
    exitDuration: currentDuration,
    easing,
  })
  const extended = extendingAutomaticHoldsThroughPointerActivity(
    regrouped,
    clicks,
    pointerEvents
  )
  return mergingConnectedAutomaticEnvelopes(extended)
}

/**
 * Swift L146-194 —— v5 之前的历史规划器：一次点击一个自动片段，
 * 同一时间组内的片段直接相邻。
 */
export function makePerClickLegacyAnimations(
  clicks: PointerClick[],
  options: AutoZoomPlanOptions = {}
): ZoomAnimationClip[] {
  const zoomScale = options.zoomScale ?? 1.6
  const enterDuration = options.enterDuration ?? 0.42
  const holdDuration = options.holdDuration ?? 0.9
  const exitDuration = options.exitDuration ?? 0.44
  const clickGroupGap = options.clickGroupGap ?? 1.4
  const safeInset = options.safeInset ?? 0.12
  const easing = options.easing ?? '三次方缓动'

  const ordered = orderedValidClicks(clicks)
  const groups: PointerClick[][] = []
  for (const click of ordered) {
    const lastGroup = groups[groups.length - 1]
    const previous = lastGroup ? lastGroup[lastGroup.length - 1] : undefined
    if (previous !== undefined && click.time - previous.time <= clickGroupGap) {
      lastGroup.push(click)
    } else {
      groups.push([click])
    }
  }

  const result: ZoomAnimationClip[] = []
  let earliestNextStart: TimeInterval = 0
  for (const group of groups) {
    const first = group[0]
    const last = group[group.length - 1]
    if (!first || !last) continue
    const starts: TimeInterval[] = [
      Math.max(first.time - enterDuration * 0.18, earliestNextStart, 0),
    ]
    for (const click of group.slice(1)) {
      starts.push(Math.max(click.time - enterDuration, (starts[starts.length - 1] ?? 0) + 0.16))
    }
    for (let index = 0; index < group.length; index += 1) {
      const isLast = index === group.length - 1
      const end = isLast
        ? Math.max(last.time + holdDuration, starts[index] + enterDuration)
        : starts[index + 1]
      result.push(
        makeClip({
          startTime: starts[index],
          endTime: end,
          scale: zoomScale,
          focus: constrainPoint(group[index].location, safeInset),
          origin: 'automatic',
          easing,
          enterDuration,
          exitDuration: isLast ? exitDuration : 0,
        })
      )
    }
    const lastClip = result[result.length - 1]
    earliestNextStart = lastClip ? clipEffectEndTime(lastClip) : last.time
  }
  return result
}

/** Swift L196-210 —— 字段级逐项比对（1e-6 容差）。 */
function matchesLegacyPlan(candidate: ZoomAnimationClip, expected: ZoomAnimationClip): boolean {
  return (
    Math.abs(candidate.startTime - expected.startTime) <= EPSILON &&
    Math.abs(candidate.endTime - expected.endTime) <= EPSILON &&
    Math.abs(candidate.scale - expected.scale) <= EPSILON &&
    Math.abs(candidate.focus.x - expected.focus.x) <= EPSILON &&
    Math.abs(candidate.focus.y - expected.focus.y) <= EPSILON &&
    candidate.easing === expected.easing &&
    bezierEquals(candidate.customCurve, expected.customCurve) &&
    Math.abs(candidate.enterDuration - expected.enterDuration) <= EPSILON &&
    Math.abs(candidate.exitDuration - expected.exitDuration) <= EPSILON
  )
}

function bezierEquals(
  lhs: { x1: number; y1: number; x2: number; y2: number },
  rhs: { x1: number; y1: number; x2: number; y2: number }
): boolean {
  return lhs.x1 === rhs.x1 && lhs.y1 === rhs.y1 && lhs.x2 === rhs.x2 && lhs.y2 === rhs.y2
}

/**
 * Swift L217-239 —— 录制可能在最后一个自动包络还在保持或回落时停止。
 * 工程终结会把最后一段夹到源素材时长，并去掉越界的退出过渡。
 * 之前的片段仍与规划器逐字节一致，所以只认这一种「窄定义」的末段差异。
 */
function matchesSourceClampedAutomaticPlan(
  candidates: ZoomAnimationClip[],
  expected: ZoomAnimationClip[]
): boolean {
  if (candidates.length !== expected.length) return false
  const candidateLast = candidates[candidates.length - 1]
  const expectedLast = expected[expected.length - 1]
  if (!candidateLast || !expectedLast) return false
  const headCandidates = candidates.slice(0, -1)
  const headExpected = expected.slice(0, -1)
  if (headCandidates.length !== headExpected.length) return false
  if (!headCandidates.every((clip, index) => matchesLegacyPlan(clip, headExpected[index]))) {
    return false
  }

  return (
    Math.abs(candidateLast.startTime - expectedLast.startTime) <= EPSILON &&
    candidateLast.endTime > candidateLast.startTime &&
    candidateLast.endTime < clipEffectEndTime(expectedLast) - EPSILON &&
    Math.abs(candidateLast.scale - expectedLast.scale) <= EPSILON &&
    Math.abs(candidateLast.focus.x - expectedLast.focus.x) <= EPSILON &&
    Math.abs(candidateLast.focus.y - expectedLast.focus.y) <= EPSILON &&
    candidateLast.easing === expectedLast.easing &&
    bezierEquals(candidateLast.customCurve, expectedLast.customCurve) &&
    Math.abs(candidateLast.enterDuration - expectedLast.enterDuration) <= EPSILON &&
    candidateLast.exitDuration <= EPSILON
  )
}

/**
 * Swift L245-305 —— CAM-001/CAM-003：点击启动自动相机，但「何时可以安全离开」
 * 由指针活动决定。让每个点击组最后的稳定区域随连续指针活动继续存在，
 * 之后留一小段 settle 再走手授的回落过渡。
 *
 * 注意 L291-302 的边界修正：`endTime` 是保持结束，不是视觉结束。
 * 只延长保持却不缩短回落，会让 effectEndTime 越过下一段起点 —— 那是非法工程。
 */
export function extendingAutomaticHoldsThroughPointerActivity(
  planned: ZoomAnimationClip[],
  clicks: PointerClick[],
  pointerEvents: PointerEventRecord[],
  activityIdleGap = 1.4,
  settleHold = 0.55
): ZoomAnimationClip[] {
  if (planned.length === 0 || clicks.length === 0) return planned
  const normalizedEvents = normalizedPointerEvents(pointerEvents)
  const orderedEvents = normalizedEvents.every((event) => event.time >= 0)
    ? normalizedEvents
    : normalizedEvents.filter((event) => event.time >= 0)
  const orderedClicks = orderedValidClicks(clicks)
  // Swift 值类型数组在循环里逐元素改写；这里同样复制后按索引写回
  const result = planned.map((clip) => ({ ...clip }))

  for (let index = 0; index < result.length; index += 1) {
    if (!(result[index].exitDuration > 0.001)) continue
    const clip = result[index]
    const lastClickIndex = lastIndexAtOrBefore(clip.endTime + 0.000_1, orderedClicks)
    if (lastClickIndex === null) continue
    const lastClick = orderedClicks[lastClickIndex]
    if (!(lastClick.time >= clip.startTime - 0.000_1)) continue

    const nextStart =
      index + 1 < result.length ? result[index + 1].startTime : Number.POSITIVE_INFINITY
    let previousActivityTime = lastClick.time
    let activityEndTime = lastClick.time
    let eventIndex = firstIndexAfter(lastClick.time, orderedEvents)
    while (eventIndex < orderedEvents.length) {
      const event = orderedEvents[eventIndex]
      if (!(event.time < nextStart - 0.000_1)) break
      if (!(event.time - previousActivityTime <= activityIdleGap)) break
      previousActivityTime = event.time
      activityEndTime = event.time
      eventIndex += 1
    }

    if (!(activityEndTime > lastClick.time + 0.000_1)) continue
    const extendedEnd = Math.min(
      Math.max(clip.endTime, activityEndTime + settleHold),
      nextStart
    )
    if (!(extendedEnd > clip.endTime + 0.000_1)) continue
    result[index].endTime = extendedEnd
    if (Number.isFinite(nextStart)) {
      result[index].exitDuration = Math.min(
        result[index].exitDuration,
        Math.max(nextStart - extendedEnd, 0)
      )
    }
  }
  return result
}

/** Swift L307-325 —— 已排序就零拷贝直返，否则过滤非法时间再稳定排序。 */
export function orderedValidClicks(clicks: PointerClick[]): PointerClick[] {
  let previousTime: TimeInterval | null = null
  let isAlreadyOrdered = true
  for (const click of clicks) {
    if (!Number.isFinite(click.time) || click.time < 0) {
      isAlreadyOrdered = false
      break
    }
    if (previousTime !== null && click.time < previousTime) {
      isAlreadyOrdered = false
      break
    }
    previousTime = click.time
  }
  if (isAlreadyOrdered) return clicks
  return clicks
    .filter((click) => Number.isFinite(click.time) && click.time >= 0)
    .sort((lhs, rhs) => lhs.time - rhs.time)
}

/** Swift L327-342 —— 最后一个 time <= 目标 的下标（二分），无则 null。 */
function lastIndexAtOrBefore(time: TimeInterval, clicks: PointerClick[]): number | null {
  let lower = 0
  let upper = clicks.length
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2)
    if (clicks[middle].time <= time) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }
  return lower === 0 ? null : lower - 1
}

/** Swift L344-359 —— 第一个 time > 目标 的下标（二分），可能等于 length。 */
function firstIndexAfter(time: TimeInterval, events: PointerEventRecord[]): number {
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
  return lower
}

/**
 * Swift L372-402。
 *
 * 只折叠「严格符合规划器形状」的自动邻居。长录制仍会产出多个可编辑包络：
 * 时间缺口、回落过渡、不同视觉策略、或任何手动片段都会切开新动画。
 */
export function mergingConnectedAutomaticEnvelopes(
  animations: ZoomAnimationClip[]
): ZoomAnimationClip[] {
  const ordered = [...animations].sort((lhs, rhs) =>
    lhs.startTime === rhs.startTime
      ? lhs.id < rhs.id
        ? -1
        : lhs.id > rhs.id
          ? 1
          : 0
      : lhs.startTime - rhs.startTime
  )
  const result: ZoomAnimationClip[] = []

  for (const animation of ordered) {
    const previous = result[result.length - 1]
    const foldable =
      previous !== undefined &&
      previous.origin === 'automatic' &&
      animation.origin === 'automatic' &&
      previous.exitDuration <= ZOOM_INTERP.adjacencyTolerance &&
      Math.abs(previous.endTime - animation.startTime) <= ZOOM_INTERP.adjacencyTolerance &&
      Math.abs(previous.scale - animation.scale) <= EPSILON &&
      previous.easing === animation.easing &&
      bezierEquals(previous.customCurve, animation.customCurve)
    if (!foldable) {
      result.push({ ...animation })
      continue
    }
    result[result.length - 1] = {
      ...previous,
      endTime: Math.max(previous.endTime, animation.endTime),
      exitDuration: animation.exitDuration,
    }
  }
  return result
}

// ---------------------------------------------------------------- 点击入口

/**
 * Swift L408-479 —— 直接构建当前可编辑动画模型。
 *
 * 历史 keyframe 迁移路径刻意保持独立：让新录制走那条路会把多个点击焦点
 * 折叠成一个，并且把回落过渡算两遍。
 */
export function makeAutoZoomAnimationsFromClicks(
  clicks: PointerClick[],
  options: AutoZoomPlanOptions = {}
): ZoomAnimationClip[] {
  const zoomScale = options.zoomScale ?? 1.6
  const enterDuration = options.enterDuration ?? 0.7
  const holdDuration = options.holdDuration ?? 0.9
  const exitDuration = options.exitDuration ?? 0.7
  const clickGroupGap = options.clickGroupGap ?? 1.4
  const safeInset = options.safeInset ?? 0.12
  const easing = options.easing ?? '弹簧'

  const ordered = orderedValidClicks(clicks)
  const temporalGroups: PointerClick[][] = []
  for (const click of ordered) {
    const lastGroup = temporalGroups[temporalGroups.length - 1]
    const previous = lastGroup ? lastGroup[lastGroup.length - 1] : undefined
    if (previous !== undefined && click.time - previous.time <= clickGroupGap) {
      lastGroup.push(click)
    } else {
      temporalGroups.push([click])
    }
  }

  const animations: ZoomAnimationClip[] = []
  let earliestNextStart: TimeInterval = 0
  for (const temporalGroup of temporalGroups) {
    const first = temporalGroup[0]
    const last = temporalGroup[temporalGroup.length - 1]
    if (!first || !last) continue

    // 邻近点击形成一个相机区域。保持该区域稳定比居中每个单独点击更重要。
    // 只有当累积点击包围盒不再舒适地落进放大视口时，才创建新区域。
    const visibleExtent = 1 / Math.max(zoomScale, 1)
    const focusGroups = spatialFocusGroups(
      temporalGroup,
      visibleExtent * 0.5,
      visibleExtent * 0.7
    )
    if (focusGroups.length === 0) continue

    const starts: TimeInterval[] = [Math.max(first.time - enterDuration * 0.18, earliestNextStart, 0)]
    for (const focusGroup of focusGroups.slice(1)) {
      const minimumStart = (starts[starts.length - 1] ?? 0) + 0.16
      starts.push(Math.max(focusGroup.firstTime - enterDuration, minimumStart))
    }

    for (let index = 0; index < focusGroups.length; index += 1) {
      const start = starts[index]
      const isLast = index === focusGroups.length - 1
      const end = isLast
        ? Math.max(last.time + holdDuration, start + enterDuration)
        : starts[index + 1]
      // Swift L462：太短的片段直接丢弃，不写入轨道
      if (!(end - start > 0.01)) continue
      animations.push(
        makeClip({
          startTime: start,
          endTime: end,
          scale: zoomScale,
          focus: constrainPoint(spatialFocusGroupFocus(focusGroups[index]), safeInset),
          origin: 'automatic',
          easing,
          enterDuration,
          exitDuration: isLast ? exitDuration : 0,
        })
      )
    }
    const lastAnimation = animations[animations.length - 1]
    earliestNextStart = lastAnimation ? clipEffectEndTime(lastAnimation) : last.time
  }
  return animations
}

// ---------------------------------------------------------------- 空间分组

/** Swift SpatialFocusGroup L481-520。 */
export interface SpatialFocusGroup {
  firstTime: TimeInterval
  minimumX: number
  maximumX: number
  minimumY: number
  maximumY: number
}

export function makeSpatialFocusGroup(click: PointerClick): SpatialFocusGroup {
  return {
    firstTime: click.time,
    minimumX: click.location.x,
    maximumX: click.location.x,
    minimumY: click.location.y,
    maximumY: click.location.y,
  }
}

/** Swift SpatialFocusGroup.focus：包围盒中心。 */
export function spatialFocusGroupFocus(group: SpatialFocusGroup): NormalizedPoint {
  return { x: (group.minimumX + group.maximumX) / 2, y: (group.minimumY + group.maximumY) / 2 }
}

/** Swift canInclude(_:maximumSpanX:maximumSpanY:)。 */
export function spatialFocusGroupCanInclude(
  group: SpatialFocusGroup,
  click: PointerClick,
  maximumSpanX: number,
  maximumSpanY: number
): boolean {
  return (
    Math.max(group.maximumX, click.location.x) - Math.min(group.minimumX, click.location.x) <=
      maximumSpanX &&
    Math.max(group.maximumY, click.location.y) - Math.min(group.minimumY, click.location.y) <=
      maximumSpanY
  )
}

export function spatialFocusGroupAppend(group: SpatialFocusGroup, click: PointerClick): void {
  group.minimumX = Math.min(group.minimumX, click.location.x)
  group.maximumX = Math.max(group.maximumX, click.location.x)
  group.minimumY = Math.min(group.minimumY, click.location.y)
  group.maximumY = Math.max(group.maximumY, click.location.y)
}

/** Swift spatialFocusGroups L522-541。 */
export function spatialFocusGroups(
  clicks: PointerClick[],
  maximumSpanX: number,
  maximumSpanY: number
): SpatialFocusGroup[] {
  const groups: SpatialFocusGroup[] = []
  for (const click of clicks) {
    const last = groups[groups.length - 1]
    if (last !== undefined && spatialFocusGroupCanInclude(last, click, maximumSpanX, maximumSpanY)) {
      spatialFocusGroupAppend(last, click)
    } else {
      groups.push(makeSpatialFocusGroup(click))
    }
  }
  return groups
}

// ---------------------------------------------------------------- 裁剪

/**
 * Swift L543-558 —— 把片段裁到录制时长内。
 * 关键：被裁短后，退出过渡也要按剩余间隙收缩，否则 effectEndTime 越界。
 */
export function clippedZoomAnimations(
  animations: ZoomAnimationClip[],
  duration: TimeInterval
): ZoomAnimationClip[] {
  if (!Number.isFinite(duration) || !(duration > 0)) return []
  const result: ZoomAnimationClip[] = []
  for (const animation of animations) {
    if (!(animation.startTime < duration)) continue
    const clipped: ZoomAnimationClip = {
      ...animation,
      endTime: Math.min(animation.endTime, duration),
    }
    clipped.exitDuration = Math.min(
      animation.exitDuration,
      Math.max(duration - clipped.endTime, 0)
    )
    if (clipped.endTime - clipped.startTime > 0.01) result.push(clipped)
  }
  return result
}

/**
 * Swift L560-580 —— 旧版关键帧轨道的裁剪：在裁点处补一个采样出的关键帧，
 * 保证裁完的动画与原轨在边界处连续。
 */
export function clippedZoomKeyframes(
  keyframes: ZoomKeyframe[],
  duration: TimeInterval,
  motion: MotionStyle = makeMotionStyle()
): ZoomKeyframe[] {
  if (!Number.isFinite(duration) || !(duration > 0)) return []
  const endSample = sampleKeyframes(keyframes, duration, motion)
  const clipped = keyframes.filter((frame) => frame.time >= 0 && frame.time < duration)
  clipped.push(
    makeKeyframe({
      time: duration,
      scale: endSample.scale,
      focus: { x: endSample.focus.x, y: endSample.focus.y },
    })
  )
  return clipped.sort((lhs, rhs) => lhs.time - rhs.time)
}

// ---------------------------------------------------------------- 关键帧

/** Swift L582-592（指针事件入口）。 */
export function makeAutoZoomKeyframes(
  pointerEvents: PointerEventRecord[],
  baseScale = 1,
  zoomScale = 1.6
): ZoomKeyframe[] {
  return makeAutoZoomKeyframesFromClicks(pointerClicks(pointerEvents), baseScale, zoomScale)
}

/**
 * Swift L594-647 —— v4 及更早的关键帧模型。
 *
 * 每个点击组固定 4+N 个关键帧：起跳点、进入完成点、组内每次点击、
 * 释放点、回落到 1× 的终点。
 */
export function makeAutoZoomKeyframesFromClicks(
  clicks: PointerClick[],
  baseScale = 1,
  zoomScale = 1.6,
  enterDuration: TimeInterval = 0.42,
  holdDuration: TimeInterval = 0.9,
  exitDuration: TimeInterval = 0.44,
  clickGroupGap: TimeInterval = 1.4,
  safeInset = 0.12
): ZoomKeyframe[] {
  const center: NormalizedPoint = { x: 0.5, y: 0.5 }
  const keyframes: ZoomKeyframe[] = [
    makeKeyframe({ time: 0, scale: baseScale, focus: center }),
  ]

  const orderedClicks = [...clicks].sort((lhs, rhs) => lhs.time - rhs.time)
  const groups: PointerClick[][] = []
  for (const click of orderedClicks) {
    const lastGroup = groups[groups.length - 1]
    const previous = lastGroup ? lastGroup[lastGroup.length - 1] : undefined
    if (previous !== undefined && click.time - previous.time <= clickGroupGap) {
      lastGroup.push(click)
    } else {
      groups.push([click])
    }
  }

  for (const group of groups) {
    const first = group[0]
    const last = group[group.length - 1]
    if (!first || !last) continue
    const firstFocus = constrainPoint(first.location, safeInset)
    const start = Math.max(first.time - enterDuration * 0.18, 0)
    const zoomed = start + enterDuration
    const release = Math.max(last.time + holdDuration, zoomed + holdDuration)

    keyframes.push(makeKeyframe({ time: start, scale: baseScale, focus: firstFocus }))
    keyframes.push(makeKeyframe({ time: zoomed, scale: zoomScale, focus: firstFocus }))
    for (const click of group.slice(1)) {
      keyframes.push(
        makeKeyframe({
          time: Math.max(click.time, zoomed),
          scale: zoomScale,
          focus: constrainPoint(click.location, safeInset),
        })
      )
    }
    keyframes.push(
      makeKeyframe({
        time: release,
        scale: zoomScale,
        focus: constrainPoint(last.location, safeInset),
      })
    )
    keyframes.push(makeKeyframe({ time: release + exitDuration, scale: baseScale, focus: center }))
  }

  return keyframes.sort((lhs, rhs) => lhs.time - rhs.time)
}
