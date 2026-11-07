/**
 * 旋钮拖拽 —— Swift EditorKnobDrag.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorKnobDrag.swift（55 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - struct EditorKnobDragState   L7-55
 *       · sweepAngle / startAngle   L8-9    → KNOB_SWEEP_ANGLE / KNOB_START_ANGLE
 *       · init(fraction:point:center:)  L14-18
 *       · update(point:fine:)           L20-34
 *       · wheelDelta(...)               L36-43
 *       · clamp(_:)                     L45-47
 *       · angle(_:center:)              L49-54
 *
 * 原注释（L4-6）：
 *   Pointer angles use the same clockwise, twelve-o'clock origin as the drawn
 *   needle. Each step takes the shortest signed angular difference, so the
 *   bottom seam and Shift changes never reinterpret previous travel.
 *
 * 关键：角度以「12 点方向为 0、顺时针为正」（`atan2(x, -y)`），每步只取**最短有向差**
 * （>180 减 360、<−180 加 360），所以跨过底部的接缝与按下 Shift 都不会把之前的位移
 * 重新解释成反向。
 */

export interface KnobPoint {
  readonly x: number
  readonly y: number
}

/** Swift L8-9。 */
export const KNOB_SWEEP_ANGLE = 270.0
export const KNOB_START_ANGLE = -135.0

/** Swift L52：指针离圆心小于 6pt 时角度无意义。 */
export const KNOB_DEAD_ZONE_RADIUS = 6

/** Swift L32 / L42：按住 Shift 的精细倍率。 */
export const KNOB_FINE_MULTIPLIER = 0.2

/** Swift L41：滚轮每格基数（精确设备 600 / 普通设备 50）与单次上限。 */
export const KNOB_WHEEL_PRECISE_DIVISOR = 600
export const KNOB_WHEEL_DIVISOR = 50
export const KNOB_WHEEL_MAXIMUM_DELTA = 0.08

/** Swift L45-47：非有限值按 0。 */
export function clampKnobFraction(fraction: number): number {
  return Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0
}

/**
 * Swift L49-54：`atan2(x, -y) * 180 / π`，死区内返回 null。
 * 12 点方向 → 0°，3 点方向 → 90°（顺时针为正）。
 */
export function knobAngle(point: KnobPoint, center: KnobPoint): number | null {
  const x = point.x - center.x
  const y = point.y - center.y
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (Math.hypot(x, y) < KNOB_DEAD_ZONE_RADIUS) return null
  return (Math.atan2(x, -y) * 180) / Math.PI
}

/** Swift L7-55。 */
export class EditorKnobDragState {
  private readonly center: KnobPoint
  private previousAngle: number | null
  private _fraction: number

  /** Swift L14-18。 */
  constructor(fraction: number, point: KnobPoint, center: KnobPoint) {
    this._fraction = clampKnobFraction(fraction)
    this.center = center
    this.previousAngle = knobAngle(point, center)
  }

  get fraction(): number {
    return this._fraction
  }

  /**
   * Swift L20-34。
   * 跨过圆心时锚点清空，等离开死区后再重新锚定 —— 否则会一次跳半圈。
   */
  update(point: KnobPoint, fine: boolean): number {
    const angle = knobAngle(point, this.center)
    if (angle == null) {
      this.previousAngle = null
      return this._fraction
    }
    const previousAngle = this.previousAngle
    this.previousAngle = angle
    if (previousAngle == null) return this._fraction

    let delta = angle - previousAngle
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    this._fraction = clampKnobFraction(
      this._fraction + (delta / KNOB_SWEEP_ANGLE) * (fine ? KNOB_FINE_MULTIPLIER : 1)
    )
    return this._fraction
  }

  /**
   * Swift L36-43：垂直滚动为主（`|v| > 0.0001` 且 `|v| >= |h|`）才算旋钮输入；
   * 结果夹到 ±0.08，避免一次大力滚动把值推到底。
   */
  static wheelDelta(options: {
    vertical: number
    horizontal: number
    precise: boolean
    inverted: boolean
    fine: boolean
  }): number | null {
    const { vertical, horizontal } = options
    if (!Number.isFinite(vertical) || !Number.isFinite(horizontal)) return null
    if (!(Math.abs(vertical) > 0.0001)) return null
    if (!(Math.abs(vertical) >= Math.abs(horizontal))) return null
    const physicalDelta = options.inverted ? -vertical : vertical
    const divisor = options.precise ? KNOB_WHEEL_PRECISE_DIVISOR : KNOB_WHEEL_DIVISOR
    const delta = Math.min(Math.max(physicalDelta / divisor, -KNOB_WHEEL_MAXIMUM_DELTA), KNOB_WHEEL_MAXIMUM_DELTA)
    return delta * (options.fine ? KNOB_FINE_MULTIPLIER : 1)
  }
}

/**
 * 由比例反推指针角度（Swift `startAngle + sweepAngle * fraction`），
 * 供 React 侧直接给 SVG 指针做旋转变换。
 */
export function knobNeedleAngle(fraction: number): number {
  return KNOB_START_ANGLE + KNOB_SWEEP_ANGLE * clampKnobFraction(fraction)
}
