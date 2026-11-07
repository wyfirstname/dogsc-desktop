/**
 * Swift source: Sources/RecorderCore/ScreenMotionCreationStyle.swift @ 567fd6e
 *
 * 逐结构对照：
 *   ScreenMotionCreationStyle          L5-45
 *   init(clip:)                        L13-20
 *   isValid                            L22-31
 *   clip(timing:)                      L33-44
 *
 * 这是「可复用的外观与过渡设置」—— 与片段在时间线上的位置、身份、
 * 联动相机组无关，因此可以作为预设反复应用到新片段上。
 */

import type { ZoomBezierCurve, ZoomEasingPreset } from './ZoomAnimation'
import { ZOOM_BEZIER } from './ZoomAnimation'
import type { ScreenMotionState } from './ScreenTransform'
import { DEFAULT_SCREEN_MOTION } from './ScreenTransform'
import type { ScreenMotionClip, TransitionTiming } from './ProjectTimeline'
import { requestedReturnDuration, withPreservedTimingIntent } from './ProjectTimeline'
import type { FocusEffect } from './FocusEffect'
import { focusEffectIsValid } from './FocusEffect'

export interface ScreenMotionCreationStyle {
  target: ScreenMotionState
  focusEffect: FocusEffect | null
  easing: ZoomEasingPreset
  customCurve: ZoomBezierCurve
  leadInDuration: number
  returnDuration: number
}

/**
 * Swift init(clip:) L13-20 —— 从既有片段抽出可复用样式。
 * `returnDuration` 取「手授意图」而非实际生效值，所以这里用
 * requestedReturnDuration（preferredReturnDuration 优先）。
 */
export function screenMotionCreationStyleFromClip(
  clip: ScreenMotionClip
): ScreenMotionCreationStyle {
  return {
    target: {
      position: { x: clip.target.position.x, y: clip.target.position.y },
      scale: clip.target.scale,
      rotationX: clip.target.rotationX,
      rotationY: clip.target.rotationY,
      rotationZ: clip.target.rotationZ,
      perspective: clip.target.perspective,
    },
    focusEffect: clip.focusEffect ?? null,
    easing: clip.timing.easing,
    customCurve: { ...clip.timing.customCurve },
    leadInDuration: clip.timing.leadInDuration,
    returnDuration: requestedReturnDuration(clip.timing),
  }
}

/** Swift 默认构造（用于新建）。 */
export function makeScreenMotionCreationStyle(
  overrides: Partial<ScreenMotionCreationStyle> = {}
): ScreenMotionCreationStyle {
  return {
    target: overrides.target ?? {
      position: { ...DEFAULT_SCREEN_MOTION.position },
      scale: DEFAULT_SCREEN_MOTION.scale,
      rotationX: DEFAULT_SCREEN_MOTION.rotationX,
      rotationY: DEFAULT_SCREEN_MOTION.rotationY,
      rotationZ: DEFAULT_SCREEN_MOTION.rotationZ,
      perspective: DEFAULT_SCREEN_MOTION.perspective,
    },
    focusEffect: overrides.focusEffect ?? null,
    easing: overrides.easing ?? '三次方缓动',
    customCurve: overrides.customCurve ?? { ...ZOOM_BEZIER.cubic },
    leadInDuration: overrides.leadInDuration ?? 0.7,
    returnDuration: overrides.returnDuration ?? 0.7,
  }
}

/**
 * Swift isValid L22-31 —— 与 ProjectValidator 的 MotionStyle 校验同源：
 * 全部数值有限、位置在 [0,1]、scale > 0、perspective >= 0、
 * 两个过渡时长在 [0,5]、聚焦效果有效。
 *
 * 注意 `allSatisfy(\.isFinite)` 覆盖的 13 个值包含 customCurve 的四个控制点：
 * 非法贝塞尔会让缓动求值发散。
 */
export function screenMotionCreationStyleIsValid(
  style: ScreenMotionCreationStyle
): boolean {
  const values = [
    style.target.position.x,
    style.target.position.y,
    style.target.scale,
    style.target.rotationX,
    style.target.rotationY,
    style.target.rotationZ,
    style.target.perspective,
    style.leadInDuration,
    style.returnDuration,
    style.customCurve.x1,
    style.customCurve.y1,
    style.customCurve.x2,
    style.customCurve.y2,
  ]
  if (!values.every((value) => Number.isFinite(value))) return false
  if (!inRange(style.target.position.x, 0, 1)) return false
  if (!inRange(style.target.position.y, 0, 1)) return false
  if (!(style.target.scale > 0)) return false
  if (!(style.target.perspective >= 0)) return false
  if (!inRange(style.leadInDuration, 0, 5)) return false
  if (!inRange(style.returnDuration, 0, 5)) return false
  if (style.focusEffect !== null && !focusEffectIsValid(style.focusEffect)) return false
  return true
}

function inRange(value: number, lower: number, upper: number): boolean {
  return value >= lower && value <= upper
}

/**
 * Swift clip(timing:) L33-44 —— 把样式套到一个给定的时间参数上生成片段。
 *
 * 四个细节必须逐字保留：
 *   1. 过渡时长与缓动被样式覆盖（样式是唯一真相）。
 *   2. preferred* 写成样式值，从而在 ripple 编辑中存活。
 *   3. leadInDuration 按整段时长截断，但 returnDuration 取
 *      `min(样式回落, 旧回落)` —— Swift 原文如此，返回时长不允许被样式放大。
 *   4. 两个 progressOffset 归零：这是「新生片段」，不带剪切相位。
 */
export function screenMotionClipFromStyle(
  style: ScreenMotionCreationStyle,
  timing: TransitionTiming,
  id: string
): ScreenMotionClip {
  const preserved = withPreservedTimingIntent(timing)
  const nextTiming: TransitionTiming = {
    ...preserved,
    easing: style.easing,
    customCurve: { ...style.customCurve },
    preferredLeadInDuration: style.leadInDuration,
    preferredReturnDuration: style.returnDuration,
    leadInDuration: Math.min(style.leadInDuration, preserved.duration),
    returnDuration: Math.min(style.returnDuration, preserved.returnDuration),
    leadInProgressOffset: 0,
    returnProgressOffset: 0,
  }
  return {
    id,
    timing: nextTiming,
    target: {
      position: { x: style.target.position.x, y: style.target.position.y },
      scale: style.target.scale,
      rotationX: style.target.rotationX,
      rotationY: style.target.rotationY,
      rotationZ: style.target.rotationZ,
      perspective: style.target.perspective,
    },
    focusEffect: style.focusEffect === null ? null : { ...style.focusEffect },
  }
}
