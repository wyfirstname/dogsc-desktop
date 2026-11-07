/**
 * FocusEffect —— 每段动画可选的空间聚焦（径向/线性虚化 + 压暗）。
 *
 * Swift source: Sources/RecorderCore/FocusEffect.swift @ laogou717/dogsc 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - enum FocusEffectTarget / FocusEffectShape   L3-7   → FocusEffectTarget / FocusEffectShape
 *   - struct FocusEffect                          L11-45 → FocusEffect / makeFocusEffect
 *   - struct FrameFocusScene                      L47-51 → FrameFocusScene
 *   - enum FocusEffectEvaluator                   L53-118 → focusEffectScene
 *
 * 缺省值表示「什么都不做」，而不是一个隐藏的默认效果：没有 focusEffect
 * 就返回 null。所有坐标仍在源屏幕空间。
 */

import type { NormalizedPoint, TimeInterval } from './ZoomAnimation'
import type { NormalizedCrop } from './ProjectModel'
import type { ZoomAnimationClip, ZoomEasingPreset, ZoomBezierCurve } from './ZoomAnimation'
import { ZOOM_BEZIER, easedProgress } from './ZoomAnimation'
import { constrainPoint } from './ZoomAnimation'
import type { MotionStyle } from './MotionStyle'
import type { ScreenMotionClip, TransitionTiming } from './ProjectTimeline'

export type FocusEffectTarget = 'animation' | 'pointer' | 'fixed'
export type FocusEffectShape = 'radial' | 'linear'

export const FOCUS_EFFECT_TARGETS: readonly FocusEffectTarget[] = ['animation', 'pointer', 'fixed']
export const FOCUS_EFFECT_SHAPES: readonly FocusEffectShape[] = ['radial', 'linear']

/** Swift FocusEffect（L11-45）。 */
export interface FocusEffect {
  shape: FocusEffectShape | null
  angleDegrees: number | null
  target: FocusEffectTarget
  center: NormalizedPoint
  size: number
  blur: number
  softness: number
  dimming: number
}

export interface FocusEffectOptions {
  shape?: FocusEffectShape | null
  angleDegrees?: number | null
  target?: FocusEffectTarget
  center?: NormalizedPoint
  size?: number
  blur?: number
  softness?: number
  dimming?: number
  /** Swift init(linear:)：一次性给出线性聚焦的整套刻意缺省值。 */
  linear?: boolean
}

/** Swift FocusEffect.init(linear:)（L21-29）+ 缺省值。 */
export function makeFocusEffect(options: FocusEffectOptions = {}): FocusEffect {
  if (options.linear) {
    return {
      shape: options.shape ?? 'linear',
      angleDegrees: options.angleDegrees ?? 0,
      target: options.target ?? 'fixed',
      center: options.center ?? { x: 0.5, y: 0.5 },
      size: options.size ?? 0.32,
      blur: options.blur ?? 0.35,
      softness: options.softness ?? 0.5,
      dimming: options.dimming ?? 0,
    }
  }
  return {
    shape: options.shape ?? null,
    angleDegrees: options.angleDegrees ?? null,
    target: options.target ?? 'animation',
    center: options.center ?? { x: 0.5, y: 0.5 },
    size: options.size ?? 0.45,
    blur: options.blur ?? 0.35,
    softness: options.softness ?? 0.5,
    dimming: options.dimming ?? 0.18,
  }
}

/** Swift normalizedAngle(_:)（L31-34）：把角度折回 [0, 360)。 */
export function normalizedAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0
  const result = degrees % 360
  return result < 0 ? result + 360 : result
}

/** Swift clearHalfWidth(shortEdge:)（L36）。 */
export function focusEffectClearHalfWidth(effect: FocusEffect, shortEdge: number): number {
  return (shortEdge * effect.size) / 2
}

/** Swift featherWidth(shortEdge:)（L37）。 */
export function focusEffectFeatherWidth(effect: FocusEffect, shortEdge: number): number {
  return Math.max(shortEdge * effect.softness * 0.4, 1)
}

const inUnit = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= 1

/** Swift FocusEffect.isValid（L39-44）。 */
export function focusEffectIsValid(effect: FocusEffect): boolean {
  if (
    !inUnit(effect.center.x) ||
    !inUnit(effect.center.y) ||
    !inUnit(effect.blur) ||
    !inUnit(effect.softness) ||
    !inUnit(effect.dimming)
  ) {
    return false
  }
  if (
    effect.angleDegrees !== null &&
    !(Number.isFinite(effect.angleDegrees) && effect.angleDegrees >= 0 && effect.angleDegrees <= 360)
  ) {
    return false
  }
  return Number.isFinite(effect.size) && effect.size >= 0.1 && effect.size <= 1
}

/** Swift FrameFocusScene（L47-51）。 */
export interface FrameFocusScene {
  effect: FocusEffect
  center: NormalizedPoint
  progress: number
}

export interface FocusEffectSceneOptions {
  zoom: ZoomAnimationClip | null
  screen: ScreenMotionClip | null
  zoomFocus: NormalizedPoint
  crop: NormalizedCrop
  pointer: NormalizedPoint | null
  time: TimeInterval
  motion: MotionStyle
}

/**
 * Swift FocusEffectEvaluator.scene(zoom:screen:zoomFocus:crop:pointer:time:motion:)（L54-96）。
 *
 * 两条轨道重叠时，显式开启的 3D 聚焦独占唯一效果 —— 绝不意外叠两层全屏虚化。
 */
export function focusEffectScene(options: FocusEffectSceneOptions): FrameFocusScene | null {
  const { zoom, screen, zoomFocus, crop, pointer, time, motion } = options
  let effect: FocusEffect
  let anchor: NormalizedPoint
  let timing: TransitionTiming
  let holds: boolean

  if (screen && screen.focusEffect) {
    const selected: FocusEffect = { ...screen.focusEffect }
    // 设备运镜的聚焦缺 shape 时按线性、固定目标、不压暗解释。
    if (selected.shape === null) {
      selected.shape = 'linear'
      selected.target = 'fixed'
      selected.dimming = 0
    }
    effect = selected
    anchor = {
      x: crop.x + screen.target.position.x * crop.width,
      y: crop.y + screen.target.position.y * crop.height,
    }
    timing = screen.timing
    holds = timing.returnDuration === 0
  } else if (zoom && zoom.focusEffect) {
    effect = zoom.focusEffect
    anchor = zoomFocus
    timing = {
      startTime: zoom.startTime,
      duration: zoom.endTime - zoom.startTime,
      leadInDuration: zoom.enterDuration,
      leadInProgressOffset: zoom.enterProgressOffset,
      easing: zoom.easing,
      customCurve: zoom.customCurve,
      returnDuration: zoom.exitDuration,
      returnProgressOffset: zoom.exitProgressOffset,
    }
    holds = false
  } else {
    return null
  }

  if (!focusEffectIsValid(effect) || !(effect.blur > 0 || effect.dimming > 0)) return null
  const amount = focusEffectProgress(timing, time, holds, motion)
  if (!(amount > 0)) return null
  let center: NormalizedPoint
  switch (effect.target) {
    case 'animation':
      center = anchor
      break
    case 'pointer':
      center = pointer ?? anchor
      break
    case 'fixed':
      center = effect.center
      break
  }
  return { effect, center: constrainPoint(center, 0), progress: amount }
}

/** Swift FocusEffectEvaluator.progress(timing:at:holds:motion:)（L98-117）。 */
export function focusEffectProgress(
  timing: TransitionTiming,
  time: TimeInterval,
  holds: boolean,
  motion: MotionStyle
): number {
  if (time < timing.startTime) return 0
  const enter = Math.min(timing.leadInDuration, timing.duration)
  let linear: number
  let exiting: boolean
  if (enter > 0 && time < timing.startTime + enter) {
    linear =
      timing.leadInProgressOffset +
      ((1 - timing.leadInProgressOffset) * (time - timing.startTime)) / enter
    exiting = false
  } else if (time < timing.startTime + timing.duration) {
    return 1
  } else if (timing.returnDuration > 0) {
    linear =
      timing.returnProgressOffset +
      ((1 - timing.returnProgressOffset) * (time - (timing.startTime + timing.duration))) /
        timing.returnDuration
    exiting = true
  } else {
    return holds ? 1 : 0
  }
  const eased = easedProgress(
    Math.min(Math.max(linear, 0), 1),
    timing.easing as ZoomEasingPreset,
    (timing.customCurve ?? ZOOM_BEZIER.cubic) as ZoomBezierCurve,
    motion
  )
  return Math.min(Math.max(exiting ? 1 - eased : eased, 0), 1)
}

// ---------------------------------------------------------------- 编解码

/** 缺省/非法值统一落到「不做任何事」。 */
export function decodeFocusEffect(raw: unknown): FocusEffect | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const shapeRaw = typeof obj.shape === 'string' ? obj.shape : null
  const shape: FocusEffectShape | null =
    shapeRaw === 'linear' || shapeRaw === 'radial' ? shapeRaw : null
  const targetRaw = typeof obj.target === 'string' ? obj.target : 'animation'
  const target: FocusEffectTarget =
    targetRaw === 'pointer' || targetRaw === 'fixed' || targetRaw === 'animation'
      ? targetRaw
      : 'animation'
  const centerRaw = (obj.center ?? {}) as Record<string, unknown>
  const angleRaw = obj.angleDegrees
  return {
    shape,
    angleDegrees:
      typeof angleRaw === 'number' && Number.isFinite(angleRaw) ? angleRaw : null,
    target,
    center: { x: num(centerRaw.x, 0.5), y: num(centerRaw.y, 0.5) },
    size: num(obj.size, 0.45),
    blur: num(obj.blur, 0.35),
    softness: num(obj.softness, 0.5),
    dimming: num(obj.dimming, 0.18),
  }
}

export function encodeFocusEffect(effect: FocusEffect | null): Record<string, unknown> | null {
  if (!effect) return null
  return {
    shape: effect.shape,
    angleDegrees: effect.angleDegrees,
    target: effect.target,
    center: { x: effect.center.x, y: effect.center.y },
    size: effect.size,
    blur: effect.blur,
    softness: effect.softness,
    dimming: effect.dimming,
  }
}
