/**
 * 遗留运镜默认值升级 —— Swift AppModel.swift 中 `enum LegacyMotionDefaultsUpgrade` 的转写。
 *
 * Swift source: Sources/DogSCApp/AppModel.swift（L99-139）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 原注释（L99-102）：
 *   Upgrades only the untouched legacy motion preset. User-authored spring
 *   values remain authoritative. The new values form separate near-critically
 *   damped cursor and screen systems, so the cursor can lead while the camera
 *   settles without oscillation or locking onto each input sample.
 *
 * 即：**只升级未被用户改动过的旧预设**，任何一项对不上就整块保持原样。
 */

import type { MotionStyle } from './MotionStyle'

/** Swift 容差 `0.000_001`。 */
export const LEGACY_MOTION_UPGRADE_TOLERANCE = 0.000001

/** 旧默认 → 新默认：屏幕弹簧（1/180/24 → 2.4/210/42）。 */
export const LEGACY_SCREEN_SPRING = {
  mass: 1,
  stiffness: 180,
  damping: 24
} as const
export const UPGRADED_SCREEN_SPRING = {
  mass: 2.4,
  stiffness: 210,
  damping: 42
} as const

/** 旧默认 → 新默认：光标弹簧（1/260/30 → 2.8/450/66）。 */
export const LEGACY_CURSOR_SPRING = {
  mass: 1,
  stiffness: 260,
  damping: 30
} as const
export const UPGRADED_CURSOR_SPRING = {
  mass: 2.8,
  stiffness: 450,
  damping: 66
} as const

/** Swift `abs(a - b) < tolerance` */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) < LEGACY_MOTION_UPGRADE_TOLERANCE
}

/**
 * Swift L108-138 `upgraded(_:)` 的逐行移植。
 *
 * 三条独立规则：
 *   1. 屏幕弹簧仍是 1/180/24 → 2.4/210/42；
 *   2. 光标弹簧仍是 1/260/30 → 2.8/450/66；
 *   3. `三次方缓动 + 0.55s` → `弹簧 + 0.7s`；
 *      否则 `弹簧 + 0.6s` → 仅把时长改成 0.7s（升级紧邻的上一代默认，
 *      不动任何用户手写的时长）。
 *
 * 返回新对象，不修改入参（Swift 里是 `var result = motion` 的副本）。
 */
export function upgradeLegacyMotionDefaults(motion: MotionStyle): MotionStyle {
  const result: MotionStyle = { ...motion }

  if (
    near(motion.screenSpringMass, LEGACY_SCREEN_SPRING.mass) &&
    near(motion.screenSpringStiffness, LEGACY_SCREEN_SPRING.stiffness) &&
    near(motion.screenSpringDamping, LEGACY_SCREEN_SPRING.damping)
  ) {
    result.screenSpringMass = UPGRADED_SCREEN_SPRING.mass
    result.screenSpringStiffness = UPGRADED_SCREEN_SPRING.stiffness
    result.screenSpringDamping = UPGRADED_SCREEN_SPRING.damping
  }

  if (
    near(motion.cursorSpringMass, LEGACY_CURSOR_SPRING.mass) &&
    near(motion.cursorSpringStiffness, LEGACY_CURSOR_SPRING.stiffness) &&
    near(motion.cursorSpringDamping, LEGACY_CURSOR_SPRING.damping)
  ) {
    result.cursorSpringMass = UPGRADED_CURSOR_SPRING.mass
    result.cursorSpringStiffness = UPGRADED_CURSOR_SPRING.stiffness
    result.cursorSpringDamping = UPGRADED_CURSOR_SPRING.damping
  }

  if (motion.defaultZoomEasing === '三次方缓动' && near(motion.defaultZoomTransitionDuration, 0.55)) {
    result.defaultZoomEasing = '弹簧'
    result.defaultZoomTransitionDuration = 0.7
  } else if (motion.defaultZoomEasing === '弹簧' && near(motion.defaultZoomTransitionDuration, 0.6)) {
    result.defaultZoomTransitionDuration = 0.7
  }

  return result
}

/** Swift 值语义的相等判断（用于「是否真的升级了」的分支）。 */
export function motionStyleEquals(a: MotionStyle, b: MotionStyle): boolean {
  return (
    a.screenSpringMass === b.screenSpringMass &&
    a.screenSpringStiffness === b.screenSpringStiffness &&
    a.screenSpringDamping === b.screenSpringDamping &&
    a.cursorSpringMass === b.cursorSpringMass &&
    a.cursorSpringStiffness === b.cursorSpringStiffness &&
    a.cursorSpringDamping === b.cursorSpringDamping &&
    a.defaultZoomEasing === b.defaultZoomEasing &&
    a.defaultZoomTransitionDuration === b.defaultZoomTransitionDuration
  )
}
