/**
 * ZoomAnimation — 缩放动画领域模型（归一化坐标、贝塞尔缓动、片段轨道、插值器）。
 *
 * Swift source: Sources/RecorderCore/ZoomAnimation.swift @ laogou717/dogsc 567fd6e
 * 依赖：MotionStyle（Sources/RecorderCore/ProjectModel.swift）
 *
 * 转写对照：
 *   NormalizedPoint                  → NormalizedPoint
 *   PointerClick / PointerEventKind  → 同名类型
 *   PointerModifier / PointerEventRecord → 同名类型
 *   ZoomKeyframeOrigin / ZoomEasingPreset → 同名（中文 rawValue 保留）
 *   ZoomBezierCurve                  → ZoomBezierCurve（Newton-Raphson + 二分）
 *   ZoomAnimationClip / ZoomKeyframe → 同名
 *   ManualZoomViewportTransition / ZoomSample → 同名
 *   ZoomViewportTransform            → 同名（含 focusEdgeInset 等常量）
 *   ZoomAnimationTrack / ZoomInterpolator → 同名
 *   ZoomTrackCacheStore（NSLock + 4 条 LRU）→ 简单 Map 缓存（JS 单线程无锁）
 *
 * FocusEffect / NormalizedCrop / CompositionRect 属于其他 Swift 文件，
 * 本文件以最小桩类型占位；TimelineTrackOrdering / ZoomTransitionResolution
 * 已各自完成转写（同目录同名 ts 文件），此处直接引用。
 */

import { MotionStyle, makeMotionStyle } from './MotionStyle'
import { resolveZoomTransitions } from './ZoomTransitionResolution'
import { zoomAnimationsNeedRepair } from './TimelineTrackOrdering'

export type TimeInterval = number

// ---------------------------------------------------------------- NormalizedPoint

export interface NormalizedPoint {
  x: number
  y: number
}

export function makePoint(x: number, y: number): NormalizedPoint {
  return { x, y }
}

/** 对应 Swift NormalizedPoint.constrained(to:)：夹取到 [inset, 1-inset]。 */
export function constrainPoint(point: NormalizedPoint, safeInset: number): NormalizedPoint {
  const inset = Math.min(Math.max(safeInset, 0), 0.5)
  return {
    x: Math.min(Math.max(point.x, inset), 1 - inset),
    y: Math.min(Math.max(point.y, inset), 1 - inset),
  }
}

// ---------------------------------------------------------------- Pointer events

export interface PointerClick {
  time: TimeInterval
  location: NormalizedPoint
}

export type PointerEventKind = 'move' | 'leftClick' | 'rightClick'

export type PointerModifier =
  | 'command' | 'option' | 'control' | 'shift' | 'capsLock' | 'function'

/**
 * Swift 的 CursorAssetID 是 RawRepresentable 结构体（底层字符串），
 * TS 侧直接用字符串别名，序列化格式不变。
 */
export type CursorAssetID = string

export interface PointerEventRecord {
  time: TimeInterval
  location: NormalizedPoint
  kind: PointerEventKind
  modifiers: PointerModifier[]
  /** 该时刻系统光标是否可见。旧工程缺省 → 继续渲染手选光标。 */
  cursorAssetID?: CursorAssetID | null
}

// ---------------------------------------------------------------- Easing presets

export type ZoomKeyframeOrigin = 'automatic' | 'manual'

/**
 * Swift 枚举的 rawValue 就是中文（用于项目文件持久化与 UI 显示），
 * 这里直接以中文串为联合类型成员，JSON 兼容。
 */
export type ZoomEasingPreset =
  | '线性' | '二次方缓动' | '三次方缓动' | '五次平滑' | '弹簧' | '自定义曲线'

export const ZOOM_EASING_PRESETS: readonly ZoomEasingPreset[] = [
  '线性', '二次方缓动', '三次方缓动', '五次平滑', '弹簧', '自定义曲线',
]

export function easingShortName(preset: ZoomEasingPreset): string {
  switch (preset) {
    case '线性': return '线性'
    case '二次方缓动': return '二次'
    case '三次方缓动': return '三次'
    case '五次平滑': return '五次'
    case '弹簧': return '弹簧'
    case '自定义曲线': return '自定义'
  }
}

export function easingCurve(preset: ZoomEasingPreset): ZoomBezierCurve {
  switch (preset) {
    case '线性': return ZOOM_BEZIER.linear
    case '二次方缓动': return ZOOM_BEZIER.quadratic
    case '三次方缓动': return ZOOM_BEZIER.cubic
    case '五次平滑': return ZOOM_BEZIER.quintic
    case '弹簧':
    case '自定义曲线': return ZOOM_BEZIER.cubic
  }
}

// ---------------------------------------------------------------- Bezier curve

export interface ZoomBezierCurve {
  x1: number
  y1: number
  x2: number
  y2: number
}

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1)
}

function makeCurve(x1: number, y1: number, x2: number, y2: number): ZoomBezierCurve {
  return { x1: clamp01(x1), y1: clamp01(y1), x2: clamp01(x2), y2: clamp01(y2) }
}

export const ZOOM_BEZIER = {
  linear: makeCurve(0, 0, 1, 1),
  quadratic: makeCurve(0.45, 0, 0.55, 1),
  cubic: makeCurve(0.65, 0, 0.35, 1),
  quintic: makeCurve(0.82, 0, 0.18, 1),
} as const

/** 三次贝塞尔在参数 t 处的 (x, y)。对应 Swift point(at:)。 */
export function bezierPoint(curve: ZoomBezierCurve, parameter: number): NormalizedPoint {
  const t = clamp01(parameter)
  const inverse = 1 - t
  const x =
    3 * inverse * inverse * t * curve.x1 +
    3 * inverse * t * t * curve.x2 +
    t * t * t
  const y =
    3 * inverse * inverse * t * curve.y1 +
    3 * inverse * t * t * curve.y2 +
    t * t * t
  return { x, y }
}

/** 贝塞尔 x(t) 的导数。对应 Swift xDerivative(at:)（private）。 */
function bezierXDerivative(curve: ZoomBezierCurve, parameter: number): number {
  const t = clamp01(parameter)
  const inverse = 1 - t
  return (
    3 * inverse * inverse * curve.x1 +
    6 * inverse * t * (curve.x2 - curve.x1) +
    3 * t * t * (1 - curve.x2)
  )
}

/**
 * 由归一化时间 (x) 反求曲线 y 值。
 * Newton-Raphson 处理常规情形；对极平的手绘柄用二分兜底。
 * 对应 Swift value(at:)，迭代次数与阈值逐行一致。
 */
export function bezierValue(curve: ZoomBezierCurve, normalizedTime: number): number {
  const targetX = clamp01(normalizedTime)
  if (targetX <= 0 || targetX >= 1) return targetX
  let parameter = targetX

  for (let i = 0; i < 7; i++) {
    const point = bezierPoint(curve, parameter)
    const error = point.x - targetX
    if (Math.abs(error) < 0.00001) return point.y
    const derivative = bezierXDerivative(curve, parameter)
    if (Math.abs(derivative) < 0.00001) break
    const next = parameter - error / derivative
    if (next < 0 || next > 1) break
    parameter = next
  }

  let lower = 0
  let upper = 1
  parameter = targetX
  for (let i = 0; i < 18; i++) {
    const point = bezierPoint(curve, parameter)
    if (Math.abs(point.x - targetX) < 0.00001) return point.y
    if (point.x < targetX) lower = parameter
    else upper = parameter
    parameter = (lower + upper) / 2
  }
  return bezierPoint(curve, parameter).y
}

// ---------------------------------------------------------------- Stub types
// 以下类型在 Swift 中定义于其他 RecorderCore 文件，先行最小占位。

/** Swift: NormalizedCrop（crop 相关文件）——full 表示全画面。 */
export interface NormalizedCrop {
  x: number
  y: number
  width: number
  height: number
  clamped(): NormalizedCrop
}

export const FULL_CROP: NormalizedCrop = {
  x: 0, y: 0, width: 1, height: 1,
  clamped(this: NormalizedCrop): NormalizedCrop {
    const cx = Math.min(Math.max(this.x, 0), 1)
    const cy = Math.min(Math.max(this.y, 0), 1)
    return {
      x: cx,
      y: cy,
      width: Math.min(Math.max(this.width, 0), 1 - cx),
      height: Math.min(Math.max(this.height, 0), 1 - cy),
      clamped: this.clamped,
    }
  },
}

/** Swift: CompositionRect（合成矩形）。 */
export interface CompositionRect {
  x: number
  y: number
  width: number
  height: number
}

/** Swift: FocusEffect —— 焦点虚化效果，待转写后替换。 */
export interface FocusEffect {
  [key: string]: unknown
}

// ---------------------------------------------------------------- Clip

export interface ZoomAnimationClip {
  id: string
  startTime: TimeInterval
  endTime: TimeInterval
  scale: number
  focus: NormalizedPoint
  origin: ZoomKeyframeOrigin
  easing: ZoomEasingPreset
  customCurve: ZoomBezierCurve
  enterDuration: TimeInterval
  exitDuration: TimeInterval
  /** Ripple-cut 延续相位。0 表示普通手授片段。 */
  enterProgressOffset: number
  exitProgressOffset: number
  focusEffect?: FocusEffect | null
  /** 用户意图在 ripple 编辑与临时邻接约束下保留。 */
  preferredEnterDuration?: TimeInterval | null
  preferredExitDuration?: TimeInterval | null
}

export interface ZoomClipOptions {
  id?: string
  startTime: TimeInterval
  endTime: TimeInterval
  scale?: number
  focus?: NormalizedPoint
  origin?: ZoomKeyframeOrigin
  easing?: ZoomEasingPreset
  customCurve?: ZoomBezierCurve
  enterDuration?: TimeInterval
  exitDuration?: TimeInterval
  enterProgressOffset?: number
  exitProgressOffset?: number
  focusEffect?: FocusEffect | null
  preferredEnterDuration?: TimeInterval | null
  preferredExitDuration?: TimeInterval | null
}

const FOCUS_EDGE_INSET_CONST = 0.0 // 见 ZoomViewportTransform.focusEdgeInset

export function makeClip(opts: ZoomClipOptions): ZoomAnimationClip {
  const startTime = Math.max(opts.startTime, 0)
  return {
    id: opts.id ?? cryptoRandomUUID(),
    startTime,
    endTime: Math.max(opts.endTime, startTime),
    scale: Math.max(opts.scale ?? 1.6, 1),
    focus: constrainPoint(opts.focus ?? { x: 0.5, y: 0.5 }, FOCUS_EDGE_INSET_CONST),
    origin: opts.origin ?? 'manual',
    easing: opts.easing ?? '三次方缓动',
    customCurve: opts.customCurve ?? ZOOM_BEZIER.cubic,
    enterDuration: Math.min(Math.max(opts.enterDuration ?? 0.7, 0), 5),
    exitDuration: Math.min(Math.max(opts.exitDuration ?? 0.7, 0), 5),
    enterProgressOffset: Math.min(Math.max(opts.enterProgressOffset ?? 0, 0), 1),
    exitProgressOffset: Math.min(Math.max(opts.exitProgressOffset ?? 0, 0), 1),
    focusEffect: opts.focusEffect ?? null,
    preferredEnterDuration: opts.preferredEnterDuration ?? null,
    preferredExitDuration: opts.preferredExitDuration ?? null,
  }
}

export function clipDuration(clip: ZoomAnimationClip): TimeInterval {
  return Math.max(clip.endTime - clip.startTime, 0)
}

export function clipEffectEndTime(clip: ZoomAnimationClip): TimeInterval {
  return clip.endTime + clip.exitDuration
}

/** 进入过渡时长：优先用户手授值。对应 Swift requestedEnterDuration。 */
export function requestedEnterDuration(clip: ZoomAnimationClip): TimeInterval {
  return clip.preferredEnterDuration ?? clip.enterDuration
}

/**
 * 回落过渡时长：优先用户手授值，否则用当前值（> 0）或默认过渡。
 * 对应 Swift requestedExitDuration(defaultTransition:)。
 */
export function requestedExitDuration(
  clip: ZoomAnimationClip,
  defaultTransition = 0.7
): TimeInterval {
  return (
    clip.preferredExitDuration ??
    (clip.exitDuration > 0.0001 ? clip.exitDuration : Math.max(defaultTransition, 0))
  )
}

/**
 * 固化为可变片段，避免旧数据没有 preferred 字段时被后续 ripple 覆盖。
 * 对应 Swift TransitionTiming / ZoomAnimationClip 的 preserveTransitionIntent()。
 */
export function withPreservedTransitionIntent(
  clip: ZoomAnimationClip,
  defaultTransition = 0.7
): ZoomAnimationClip {
  return {
    ...clip,
    preferredEnterDuration: clip.preferredEnterDuration ?? clip.enterDuration,
    preferredExitDuration:
      clip.preferredExitDuration ?? requestedExitDuration(clip, defaultTransition),
  }
}

function cryptoRandomUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // 兜底（Node 16.7- / 老渲染器）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomUUID } = require('node:crypto') as { randomUUID(): string }
  return randomUUID()
}

// ---------------------------------------------------------------- Keyframe

export interface ZoomKeyframe {
  id: string
  time: TimeInterval
  scale: number
  focus: NormalizedPoint
  origin: ZoomKeyframeOrigin
}

/**
 * 旧版 keyframe 工程迁移为 clip 数组。
 * 对应 Swift ZoomAnimationClip.migrating(keyframes:defaultEasing:baseScale:)。
 */
export function migratingKeyframes(
  keyframes: ZoomKeyframe[],
  defaultEasing: ZoomEasingPreset = '三次方缓动',
  baseScale = 1
): ZoomAnimationClip[] {
  const ordered = keyframes
    .filter(k => Number.isFinite(k.time) && k.time >= 0)
    .sort((lhs, rhs) =>
      lhs.time === rhs.time
        ? (lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0)
        : lhs.time - rhs.time
    )
  if (ordered.length === 0) return []

  const threshold = baseScale + 0.0001
  const result: ZoomAnimationClip[] = []
  let index = 0
  while (index < ordered.length) {
    if (!(ordered[index].scale > threshold)) {
      index += 1
      continue
    }
    const firstZoomedIndex = index
    let lastZoomedIndex = index
    while (
      lastZoomedIndex + 1 < ordered.length &&
      ordered[lastZoomedIndex + 1].scale > threshold
    ) {
      lastZoomedIndex += 1
    }
    const startIndex = Math.max(firstZoomedIndex - 1, 0)
    const start = ordered[startIndex].time
    const end =
      lastZoomedIndex + 1 < ordered.length
        ? ordered[lastZoomedIndex + 1].time
        : Math.max(ordered[lastZoomedIndex].time + 0.6, start + 0.6)
    const frames = ordered.slice(firstZoomedIndex, lastZoomedIndex + 1)
    const representative =
      frames.reduce((best, f) => {
        if (f.scale === best.scale) return f.time > best.time ? f : best
        return f.scale > best.scale ? f : best
      }, frames[0]) ?? ordered[firstZoomedIndex]
    const origin: ZoomKeyframeOrigin = frames.some(f => f.origin === 'manual')
      ? 'manual'
      : 'automatic'
    if (end - start > 0.01) {
      result.push(
        makeClip({
          startTime: start,
          endTime: end,
          scale: representative.scale,
          focus: representative.focus,
          origin,
          easing: defaultEasing,
        })
      )
    }
    index = lastZoomedIndex + 1
  }
  return result
}

// ---------------------------------------------------------------- Sample

/**
 * 手授交接在两个完整取景视口之间移动。先插值源焦点会中途越过取景夹取，
 * 即使缓动平滑也会改变视觉上的镜头速度/方向。
 */
export interface ManualZoomViewportTransition {
  fromScale: number
  fromFocus: NormalizedPoint
  toScale: number
  toFocus: NormalizedPoint
  progress: number
}

export interface ZoomSample {
  scale: number
  focus: NormalizedPoint
  framingProgress: number
  targetScale: number
  manualViewportTransition?: ManualZoomViewportTransition | null
}

export function makeZoomSample(
  scale: number,
  focus: NormalizedPoint,
  framingProgress?: number,
  targetScale?: number,
  manualViewportTransition?: ManualZoomViewportTransition | null
): ZoomSample {
  return {
    scale,
    focus,
    framingProgress: clamp01(framingProgress ?? (scale > 1.0001 ? 1 : 0)),
    targetScale: Math.max(targetScale ?? scale, 1),
    manualViewportTransition: manualViewportTransition ?? null,
  }
}

// ---------------------------------------------------------------- Viewport transform

export interface ZoomViewportTransform {
  scale: number
  translation: NormalizedPoint
}

/**
 * Swift 类型属性逐一对应：
 *  - focusEdgeInset = 0.0  手授锚点描述源图，可到达每个真实边缘角落
 *  - compositionGuideInset = 0.12  焦点拾取器的建议参考线
 *  - framingTargetInset = 0.30  全缩放时边缘目标构图的落点区域
 */
export const ZOOM_VIEWPORT = {
  focusEdgeInset: 0.0,
  compositionGuideInset: 0.12,
  framingTargetInset: 0.3,
} as const

/**
 * 预览与导出共用的归一化（左上原点）视口变换。
 * 把点映射集中在此，避免光标等覆盖层因渲染后端坐标系不同而漂移。
 */
export function applyTransform(t: ZoomViewportTransform, point: NormalizedPoint): NormalizedPoint {
  return {
    x: 0.5 + t.scale * (point.x - 0.5) + t.translation.x,
    y: 0.5 + t.scale * (point.y - 0.5) + t.translation.y,
  }
}

/**
 * `visibleRect` 是未缩放、crop 本地屏幕坐标下的画布。
 * 仅当基础画面已覆盖整个画布时提供。
 * 对应 Swift ZoomViewportTransform.make(from:crop:covering:)。
 */
export function makeViewportTransform(
  sample: ZoomSample,
  crop: NormalizedCrop = FULL_CROP,
  visibleRect?: CompositionRect | null
): ZoomViewportTransform {
  if (sample.manualViewportTransition) {
    const transition = sample.manualViewportTransition
    const from = makeViewportTransform(
      makeZoomSample(transition.fromScale, transition.fromFocus, 1),
      crop,
      visibleRect
    )
    const to = makeViewportTransform(
      makeZoomSample(transition.toScale, transition.toFocus, 1),
      crop,
      visibleRect
    )
    // 先取景两个端点再插值。只夹取插值路径会让边缘到边缘的交接
    // 在边界停留后突然开始移动。
    const progress = clamp01(transition.progress)
    return {
      scale: from.scale + (to.scale - from.scale) * progress,
      translation: {
        x: from.translation.x + (to.translation.x - from.translation.x) * progress,
        y: from.translation.y + (to.translation.y - from.translation.y) * progress,
      },
    }
  }
  const scale = Math.min(Math.max(sample.scale, 1), 6)
  const safeCrop = crop.clamped()
  // focus 是源图归一化坐标，crop 编辑可能把裁切区移到焦点之外：
  // 不夹取会让 localFocus 越出 [0,1]²，缩放画面被推出画布数倍宽度。
  // 夹取后源空间锚点自动吸附到 crop 边缘，行为安全。
  const localFocus = constrainPoint(
    {
      x: Math.min(Math.max((sample.focus.x - safeCrop.x) / safeCrop.width, 0), 1),
      y: Math.min(Math.max((sample.focus.y - safeCrop.y) / safeCrop.height, 0), 1),
    },
    ZOOM_VIEWPORT.focusEdgeInset
  )
  const destination = constrainPoint(localFocus, ZOOM_VIEWPORT.framingTargetInset)
  const progress = clamp01(sample.framingProgress)
  const desiredPoint = {
    x: localFocus.x + (destination.x - localFocus.x) * progress,
    y: localFocus.y + (destination.y - localFocus.y) * progress,
  }
  const scaledPoint = {
    x: 0.5 + scale * (localFocus.x - 0.5),
    y: 0.5 + scale * (localFocus.y - 0.5),
  }

  // 缩放与镜头位移共用一个进度值：从手选锚点出发，
  // 落在可读的安全构图上，两个片段相接时保持连续。
  let translation = {
    x: desiredPoint.x - scaledPoint.x,
    y: desiredPoint.y - scaledPoint.y,
  }
  if (visibleRect) {
    // 变换后的源画面区间是 [0.5 - scale/2 + translation, 0.5 + scale/2 + translation]。
    // 保证画布两个边缘都落在其中。
    translation = {
      x: Math.min(
        Math.max(
          translation.x,
          visibleRect.x + visibleRect.width - 0.5 - scale / 2
        ),
        visibleRect.x - 0.5 + scale / 2
      ),
      y: Math.min(
        Math.max(
          translation.y,
          visibleRect.y + visibleRect.height - 0.5 - scale / 2
        ),
        visibleRect.y - 0.5 + scale / 2
      ),
    }
  }
  return { scale, translation }
}

// ---------------------------------------------------------------- Track

export interface ZoomAnimationTrack {
  readonly animations: readonly ZoomAnimationClip[]
  readonly outputDuration: TimeInterval | null
}

interface TrackInternals extends ZoomAnimationTrack {
  readonly authoredAnimations: readonly ZoomAnimationClip[]
  readonly animationIndicesByID: Map<string, number>
  /** 前缀最大 effectEnd：即使轨道未校验重叠也保持 last-active-wins 行为。 */
  readonly prefixMaximumEffectEnd: number[]
}

/**
 * Swift: ZoomTransitionResolution.resolve —— 定义于其他文件，先透传。
 */
function resolveTransitions(
  animations: ZoomAnimationClip[],
  outputDuration: TimeInterval
): ZoomAnimationClip[] {
  // ZoomTransitionResolution.swift 已转写（core/ZoomTransitionResolution.ts）
  return resolveZoomTransitions(animations, outputDuration)
}

/**
 * Swift: TimelineTrackOrdering.zoomAnimationsNeedRepair —— 定义于其他文件，先透传。
 */
function needsRepair(animations: ZoomAnimationClip[]): boolean {
  // TimelineTrackOrdering.swift 已转写（core/TimelineTrackOrdering.ts）
  return zoomAnimationsNeedRepair(animations)
}

export function makeTrack(
  authoredAnimations: ZoomAnimationClip[],
  outputDuration: TimeInterval | null = null
): ZoomAnimationTrack {
  const animations = outputDuration != null
    ? resolveTransitions(authoredAnimations, outputDuration)
    : authoredAnimations

  let finalAnimations: ZoomAnimationClip[]
  if (needsRepair(animations)) {
    finalAnimations = animations
      .filter(c => clipDuration(c) > 0.001)
      .sort((lhs, rhs) =>
        lhs.startTime === rhs.startTime
          ? (lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0)
          : lhs.startTime - rhs.startTime
      )
  } else {
    finalAnimations = animations
  }

  const indicesByID = new Map<string, number>()
  for (let i = 0; i < finalAnimations.length; i++) {
    const id = finalAnimations[i].id
    if (!indicesByID.has(id)) indicesByID.set(id, i) // 保留 firstIndex 语义
  }
  let maximumEffectEnd = -Infinity
  const prefixMaximumEffectEnd = finalAnimations.map(a => {
    maximumEffectEnd = Math.max(maximumEffectEnd, clipEffectEndTime(a))
    return maximumEffectEnd
  })

  return {
    animations: finalAnimations,
    outputDuration,
    authoredAnimations,
    animationIndicesByID: indicesByID,
    prefixMaximumEffectEnd,
  } as TrackInternals
}

/** 对应 Swift bounded(to:)：换一个输出时长重建轨道。 */
export function trackBounded(
  track: ZoomAnimationTrack,
  duration: TimeInterval | null
): ZoomAnimationTrack {
  if (duration == null || duration === track.outputDuration) return track
  return makeTrack((track as TrackInternals).authoredAnimations.slice(), duration)
}

export function trackSample(
  track: ZoomAnimationTrack,
  time: TimeInterval,
  motion: MotionStyle = makeMotionStyle(),
  automaticFocus?: NormalizedPoint | null,
  inheritedAutomaticFocus?: NormalizedPoint | null,
  reanchorAutomaticEntry = false
): ZoomSample {
  return interpolateTrackSample(
    track.animations,
    activeClipIndex(track as TrackInternals, time),
    time,
    motion,
    automaticFocus ?? null,
    inheritedAutomaticFocus ?? null,
    reanchorAutomaticEntry
  )
}

/** 该输出时刻焦点策略生效的片段。与 sample 共用同一条 last-active-wins 规则。 */
export function activeClipAt(
  track: ZoomAnimationTrack,
  time: TimeInterval
): ZoomAnimationClip | null {
  const index = activeClipIndex(track as TrackInternals, time)
  return index == null ? null : track.animations[index]
}

export function activeAutomaticClipAt(
  track: ZoomAnimationTrack,
  time: TimeInterval
): ZoomAnimationClip | null {
  const clip = activeClipAt(track, time)
  return clip && clip.origin === 'automatic' ? clip : null
}

/**
 * 返回 `clip` 需要继承其持定相机状态的相邻前一片段。
 * 查询走已排序轨道，让预览与导出不重排即可解析同一边界状态。
 */
export function adjacentPreviousClip(
  track: ZoomAnimationTrack,
  clip: ZoomAnimationClip
): ZoomAnimationClip | null {
  const internals = track as TrackInternals
  const index = internals.animationIndicesByID.get(clip.id)
  if (index == null || index <= 0) return null
  const previous = track.animations[index - 1]
  if (Math.abs(previous.endTime - clip.startTime) > ZOOM_INTERP.adjacencyTolerance) {
    return null
  }
  return previous
}

/** 二分定位 + 前缀最大值回溯。对应 Swift activeClipIndex(at:)（private）。 */
function activeClipIndex(track: TrackInternals, time: TimeInterval): number | null {
  const animations = track.animations
  if (!Number.isFinite(time) || animations.length === 0) return null
  let lower = 0
  let upper = animations.length
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2)
    if (animations[middle].startTime <= time) lower = middle + 1
    else upper = middle
  }
  if (lower <= 0) return null
  let index = lower - 1
  for (;;) {
    const clip = animations[index]
    if (time >= clip.startTime && time <= clipEffectEndTime(clip)) return index
    if (index <= 0 || track.prefixMaximumEffectEnd[index - 1] < time) return null
    index -= 1
  }
}

// ---------------------------------------------------------------- Interpolator

export const ZOOM_INTERP = {
  /** 两段缩放"相接"的最大间隙；相接时后段从前段状态过渡，前段退出被休眠。 */
  adjacencyTolerance: 1.0 / 120.0,
} as const

export function zoomSampleForAnimations(
  animations: ZoomAnimationClip[],
  time: TimeInterval,
  motion: MotionStyle = makeMotionStyle(),
  automaticFocus?: NormalizedPoint | null,
  inheritedAutomaticFocus?: NormalizedPoint | null,
  reanchorAutomaticEntry = false
): ZoomSample {
  return interpolateTrackSample(
    trackCacheTrack(animations).animations,
    activeClipIndex(trackCacheTrack(animations) as TrackInternals, time),
    time,
    motion,
    automaticFocus ?? null,
    inheritedAutomaticFocus ?? null,
    reanchorAutomaticEntry
  )
}

function interpolateTrackSample(
  ordered: readonly ZoomAnimationClip[],
  clipIndex: number | null,
  time: TimeInterval,
  motion: MotionStyle,
  automaticFocus: NormalizedPoint | null,
  inheritedAutomaticFocus: NormalizedPoint | null,
  reanchorAutomaticEntry: boolean
): ZoomSample {
  const center = { x: 0.5, y: 0.5 }
  if (clipIndex == null || clipIndex < 0 || clipIndex >= ordered.length) {
    return makeZoomSample(1, center, 0, 1)
  }
  const clip = ordered[clipIndex]
  const targetFocus = automaticTargetFocus(clip, automaticFocus)

  // 相接片段构成一个连续镜头运动：共享边界处，下一段从前一段的持定状态
  // 出发，同时缓动 scale 与 focus 到自己的目标。
  const previous = clipIndex > 0 ? ordered[clipIndex - 1] : null
  const adjacentPrevious =
    previous && Math.abs(previous.endTime - clip.startTime) <= ZOOM_INTERP.adjacencyTolerance
      ? previous
      : null
  const inheritedStart = adjacentPrevious
    ? makeZoomSample(
        // 剪切可替换下一段目标并重启入场时钟，但交接必须从前一镜头位置开始。
        // 这里若用 targetFocus 会让等 scale 片段瞬间跳变。
        adjacentPrevious.scale,
        automaticTargetFocus(adjacentPrevious, inheritedAutomaticFocus),
        1,
        adjacentPrevious.scale
      )
    : null

  let zoomProgress: number
  let requestedEnterDuration: TimeInterval
  if (inheritedStart != null && clip.enterDuration <= 0.001) {
    // 旧的分裂片段以零入场时长持久化。保留工程但改用当前默认时长，
    // 避免单帧跳变。
    requestedEnterDuration = motion.defaultZoomTransitionDuration
  } else {
    requestedEnterDuration = clip.enterDuration
  }
  const effectiveEnterDuration = Math.min(requestedEnterDuration, clipDuration(clip))
  if (effectiveEnterDuration > 0.001 && time < clip.startTime + effectiveEnterDuration) {
    const local = (time - clip.startTime) / effectiveEnterDuration
    const offset = reanchorAutomaticEntry ? 0 : clip.enterProgressOffset
    const linear = offset + (1 - offset) * local
    zoomProgress = easedProgress(linear, clip.easing, clip.customCurve, motion)
  } else if (time <= clip.endTime) {
    // 时间线紫色片段代表焦点/持定区间，其尾缘之后才开始回落。
    zoomProgress = 1
  } else if (clip.exitDuration > 0.001) {
    const local = (time - clip.endTime) / clip.exitDuration
    const linear = clip.exitProgressOffset + (1 - clip.exitProgressOffset) * local
    zoomProgress = 1 - easedProgress(linear, clip.easing, clip.customCurve, motion)
  } else {
    zoomProgress = 0
  }

  if (inheritedStart != null && time <= clip.endTime) {
    // 手授运动从上一片段渲染出的视口出发，无论其是手授还是自动。
    // 在取景/夹取到达边缘之前混合焦点会过早触边。
    const manualTransition: ManualZoomViewportTransition | null =
      clip.origin === 'manual'
        ? {
            fromScale: inheritedStart.scale,
            fromFocus: inheritedStart.focus,
            toScale: clip.scale,
            toFocus: clip.focus,
            progress: zoomProgress,
          }
        : null
    return makeZoomSample(
      lerp(inheritedStart.scale, clip.scale, zoomProgress),
      {
        x: lerp(inheritedStart.focus.x, targetFocus.x, zoomProgress),
        y: lerp(inheritedStart.focus.y, targetFocus.y, zoomProgress),
      },
      1,
      lerp(inheritedStart.scale, clip.scale, zoomProgress),
      manualTransition
    )
  }
  return makeZoomSample(
    lerp(1, clip.scale, zoomProgress),
    // 入场、持定、退场共用同一锚点；把焦点从中心挪开会造成旧的
    // "先居中再滑动"的缩放。
    targetFocus,
    zoomProgress,
    clip.scale
  )
}

/**
 * 调用方提供 click-group 规划器授权的稳定焦点。
 * 指针重建刻意独立：在交互区内移动光标不得重新锁定或抖动镜头。
 */
export function automaticTargetFocus(
  clip: ZoomAnimationClip,
  automaticFocus: NormalizedPoint | null
): NormalizedPoint {
  const base = constrainPoint(clip.focus, ZOOM_VIEWPORT.focusEdgeInset)
  if (clip.origin !== 'automatic' || !automaticFocus) return base
  return constrainPoint(automaticFocus, ZOOM_VIEWPORT.focusEdgeInset)
}

export function easedProgress(
  value: number,
  preset: ZoomEasingPreset,
  customCurve: ZoomBezierCurve = ZOOM_BEZIER.cubic,
  motion: MotionStyle = makeMotionStyle()
): number {
  const t = clamp01(value)
  switch (preset) {
    case '线性': return bezierValue(ZOOM_BEZIER.linear, t)
    case '二次方缓动': return bezierValue(ZOOM_BEZIER.quadratic, t)
    case '三次方缓动': return bezierValue(ZOOM_BEZIER.cubic, t)
    case '五次平滑': return bezierValue(ZOOM_BEZIER.quintic, t)
    case '弹簧':
      return springProgress(
        t,
        motion.screenSpringMass,
        motion.screenSpringStiffness,
        motion.screenSpringDamping
      )
    case '自定义曲线': return bezierValue(customCurve, t)
  }
}

/** 旧版 keyframe 工程的直接采样路径。对应 Swift ZoomInterpolator.sample(keyframes:at:motion:)。 */
export function sampleKeyframes(
  keyframes: ZoomKeyframe[],
  time: TimeInterval,
  motion: MotionStyle = makeMotionStyle()
): ZoomSample {
  const ordered = keyframes.slice().sort((a, b) => a.time - b.time)
  const first = ordered[0]
  if (!first) {
    return makeZoomSample(1, { x: 0.5, y: 0.5 }, 0, 1)
  }
  if (time <= first.time) {
    return makeZoomSample(
      first.scale,
      first.focus,
      first.scale > 1.0001 ? 1 : 0,
      first.scale
    )
  }
  const last = ordered[ordered.length - 1]
  if (!last || time >= last.time) {
    const finalScale = last?.scale ?? 1
    return makeZoomSample(
      finalScale,
      last?.focus ?? first.focus,
      finalScale > 1.0001 ? 1 : 0,
      finalScale
    )
  }

  const upperIndex = ordered.findIndex(k => k.time >= time)
  if (upperIndex <= 0) {
    return makeZoomSample(first.scale, first.focus, first.scale > 1.0001 ? 1 : 0, first.scale)
  }

  const lower = ordered[upperIndex - 1]
  const upper = ordered[upperIndex]
  const duration = Math.max(upper.time - lower.time, Number.MIN_VALUE)
  const linearProgress = clamp01((time - lower.time) / duration)
  let progress: number
  if (motion.screen === '聚焦') {
    progress = springProgress(
      linearProgress,
      motion.screenSpringMass,
      motion.screenSpringStiffness,
      motion.screenSpringDamping
    )
  } else {
    const t = linearProgress
    progress = t * t * t * (t * (t * 6 - 15) + 10)
  }

  const sampledScale = lerp(lower.scale, upper.scale, progress)
  const segmentTargetScale = Math.max(lower.scale, upper.scale)
  const framingProgress =
    segmentTargetScale > 1.0001
      ? clamp01((sampledScale - 1) / (segmentTargetScale - 1))
      : 0
  return makeZoomSample(
    sampledScale,
    {
      x: lerp(lower.focus.x, upper.focus.x, progress),
      y: lerp(lower.focus.y, upper.focus.y, progress),
    },
    framingProgress,
    segmentTargetScale
  )
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

/**
 * 面向此编辑器的归一化欠阻尼弹簧。归一化响应保证每个关键帧段
 * 精确落在端点。对应 Swift springProgress(_:mass:stiffness:damping:)。
 */
export function springProgress(
  value: number,
  mass: number,
  stiffness: number,
  damping: number
): number {
  const t = clamp01(value)
  if (t <= 0 || t >= 1) return t
  const safeMass = Math.max(mass, 0.01)
  const safeStiffness = Math.max(stiffness, 0.01)
  const safeDamping = Math.max(damping, 0.01)
  const omega0 = Math.sqrt(safeStiffness / safeMass)
  const zeta = Math.min(safeDamping / (2 * Math.sqrt(safeStiffness * safeMass)), 0.9999)
  const omegaD = omega0 * Math.sqrt(Math.max(1 - zeta * zeta, Number.MIN_VALUE))
  const duration = 0.72

  const response = (seconds: number): number => {
    const envelope = Math.exp(-zeta * omega0 * seconds)
    const oscillation =
      Math.cos(omegaD * seconds) + (zeta * omega0 / omegaD) * Math.sin(omegaD * seconds)
    return 1 - envelope * oscillation
  }

  return clamp01(response(t * duration) / response(duration))
}

// ---------------------------------------------------------------- Track cache

/**
 * Swift ZoomTrackCacheStore（NSLock + 最多 4 条的 LRU）。
 * JS 单线程事件循环无并发写，直接用 Map 记录最近 4 条即可。
 */
const trackCacheEntries: Array<{
  key: readonly ZoomAnimationClip[]
  track: ZoomAnimationTrack
}> = []

function trackCacheTrack(animations: readonly ZoomAnimationClip[]): ZoomAnimationTrack {
  const hit = trackCacheEntries.find(e => e.key === animations)
  if (hit) return hit.track
  const track = makeTrack(animations.slice())
  trackCacheEntries.unshift({ key: animations, track })
  if (trackCacheEntries.length > 4) trackCacheEntries.pop()
  return track
}
