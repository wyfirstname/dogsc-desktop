/**
 * 3D 倾斜板 —— 竖直拖动改 X 倾角、水平拖动改 Y 倾角。
 *
 * Swift source: Sources/DogSCApp/EditorTiltPad.swift（238 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorTiltPad                                  L6-238
 *   - maximumX 28 / maximumY 32                             L20-21  → TILT_PAD_MAXIMUM_X / Y
 *   - header（标题 11、归零按钮）                            L25-48
 *   - tiltSurface（面板 184×126、inset 12）                  L78-202 → TILT_PAD_*
 *     · 外层圆角 12、内层圆角 9、内边距 24/18                L85-132 → TILT_PAD_PLATE_*
 *     · 内层按 0.55 倍角度做 3D 预览、透视 0.72               L133-142 → tiltPadPlateRotation
 *     · 十字虚线 0.13、激活细线 0.27                          L145-169 → TILT_PAD_CROSS_ALPHA
 *     · 把手 24/28 外圈、14/16 内圈                           L171-182 → tiltPadHandleSize
 *     · DragGesture(minimumDistance: 0)                       L187-195
 *   - isNeutral（0.0005 阈值）                              L204-206 → tiltPadIsNeutral
 *   - handlePoint(in:inset:)                                L208-217 → tiltPadHandlePoint
 *   - tilt(at:in:inset:)（含 1.4° 死区吸附）                 L219-233 → tiltPadTiltAt
 *   - clamped(_:to:)（非有限 → 0）                          L235-237 → tiltPadClamped
 *
 * 原注释（L3-5）：
 *   Direct 3D orientation control for the screen-motion target. Vertical drag
 *   controls X tilt, horizontal drag controls Y tilt; exact angles live beside the
 *   same surface and share its draft/commit lifecycle.
 *
 * 迁移说明：`GeometryReader` + `DragGesture` → 一个 div + pointer 事件。
 * 保留三件纯逻辑：把手位置映射（角度 → 归一化坐标）、拖拽反解（坐标 → 角度）、
 * 以及 1.4° 死区吸附。死区是「放手时略微歪一点就自动归零」的手感来源，
 * 阈值写成 1.5 会让 28° 量程上的 5% 无法微调。
 */

/** Swift L20-21：两个方向的最大倾角（度）。 */
export const TILT_PAD_MAXIMUM_X = 28
export const TILT_PAD_MAXIMUM_Y = 32

/** Swift L199：面板尺寸。 */
export const TILT_PAD_WIDTH = 184
export const TILT_PAD_HEIGHT = 126

/** Swift L80：把手可移动区域的内缩。 */
export const TILT_PAD_INSET = 12

/** Swift L85 / L106：内外两层圆角。 */
export const TILT_PAD_OUTER_CORNER_RADIUS = 12
export const TILT_PAD_PLATE_CORNER_RADIUS = 9

/** Swift L131-132：内层板的内边距。 */
export const TILT_PAD_PLATE_HORIZONTAL_PADDING = 24
export const TILT_PAD_PLATE_VERTICAL_PADDING = 18

/** Swift L134 / L139：3D 预览的角速度系数与透视。 */
export const TILT_PAD_PREVIEW_ROTATION_SCALE = 0.55
export const TILT_PAD_PREVIEW_PERSPECTIVE = 0.72

/** Swift L152 / L165：十字虚线两档透明度。 */
export const TILT_PAD_CROSS_ALPHA = 0.13
export const TILT_PAD_ACTIVE_CROSS_ALPHA = 0.27

/** Swift L173-177：把手内圈/外圈尺寸（静止与激活）。 */
export const TILT_PAD_HANDLE_INNER_IDLE = 14
export const TILT_PAD_HANDLE_INNER_ACTIVE = 16
export const TILT_PAD_HANDLE_OUTER_IDLE = 24
export const TILT_PAD_HANDLE_OUTER_ACTIVE = 28

/** Swift L230-231：角度死区（度）。 */
export const TILT_PAD_DEAD_ZONE_DEGREES = 1.4

/** Swift L205：归零判定的阈值。 */
export const TILT_PAD_NEUTRAL_EPSILON = 0.0005

/** Swift L58：读数单位与位数。 */
export const TILT_PAD_READOUT_UNIT = '°'
export const TILT_PAD_READOUT_DIGITS = 1

/** Swift L235-237：非有限值一律当 0，其余夹到区间。 */
export function tiltPadClamped(value: number, lower: number, upper: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, lower), upper)
}

/** Swift L204-206：两个方向都接近 0 时才禁用「归零」。 */
export function tiltPadIsNeutral(rotationX: number, rotationY: number): boolean {
  return (
    Math.abs(rotationX) < TILT_PAD_NEUTRAL_EPSILON &&
    Math.abs(rotationY) < TILT_PAD_NEUTRAL_EPSILON
  )
}

/**
 * Swift L208-217：角度 → 把手坐标。
 *
 * 两处刻意的不对称：
 *   - x 用 `rotationY / (maxY*2) + 0.5`（向右为正）
 *   - y 用 `0.5 − rotationX / (maxX*2)`（**向上**为正，屏幕 y 向下）
 * 如果把 y 也写成 `+`，向上拖动会让画面向下倾。
 */
export function tiltPadHandlePoint(input: {
  readonly rotationX: number
  readonly rotationY: number
  readonly size: { readonly width: number; readonly height: number }
  readonly inset: number
}): { readonly x: number; readonly y: number } {
  const width = Math.max(input.size.width - input.inset * 2, 1)
  const height = Math.max(input.size.height - input.inset * 2, 1)
  const normalizedX =
    tiltPadClamped(input.rotationY, -TILT_PAD_MAXIMUM_Y, TILT_PAD_MAXIMUM_Y) /
      (TILT_PAD_MAXIMUM_Y * 2) +
    0.5
  const normalizedY =
    0.5 -
    tiltPadClamped(input.rotationX, -TILT_PAD_MAXIMUM_X, TILT_PAD_MAXIMUM_X) /
      (TILT_PAD_MAXIMUM_X * 2)
  return {
    x: input.inset + normalizedX * width,
    y: input.inset + normalizedY * height,
  }
}

/**
 * Swift L219-233：拖拽坐标 → 角度。
 *
 * 先归一化到 [0,1]（用 `min/max` 夹住越出面板的拖动），再线性映射，
 * 最后过 1.4° 死区：`abs(x) <= 1.4 → 0`。
 *
 * 注意死区是**软吸附**而不是「累积到 1.4 才生效」——
 * 用户拖到 1.3° 时读数直接跳 0，这是上游的取舍。
 */
export function tiltPadTiltAt(input: {
  readonly location: { readonly x: number; readonly y: number }
  readonly size: { readonly width: number; readonly height: number }
  readonly inset: number
}): { readonly x: number; readonly y: number } {
  const width = Math.max(input.size.width - input.inset * 2, 1)
  const height = Math.max(input.size.height - input.inset * 2, 1)
  const horizontal = Math.min(Math.max((input.location.x - input.inset) / width, 0), 1)
  const vertical = Math.min(Math.max((input.location.y - input.inset) / height, 0), 1)
  let x = (0.5 - vertical) * TILT_PAD_MAXIMUM_X * 2
  let y = (horizontal - 0.5) * TILT_PAD_MAXIMUM_Y * 2
  if (Math.abs(x) <= TILT_PAD_DEAD_ZONE_DEGREES) x = 0
  if (Math.abs(y) <= TILT_PAD_DEAD_ZONE_DEGREES) y = 0
  return { x, y }
}

/** Swift L133-142：内层板的 3D 预览角度。 */
export function tiltPadPlateRotation(input: {
  readonly rotationX: number
  readonly rotationY: number
}): { readonly x: number; readonly y: number } {
  return {
    x:
      tiltPadClamped(input.rotationX, -TILT_PAD_MAXIMUM_X, TILT_PAD_MAXIMUM_X) *
      TILT_PAD_PREVIEW_ROTATION_SCALE,
    y:
      tiltPadClamped(input.rotationY, -TILT_PAD_MAXIMUM_Y, TILT_PAD_MAXIMUM_Y) *
      TILT_PAD_PREVIEW_ROTATION_SCALE,
  }
}

/** Swift L171-182：把手两圈的直径。 */
export function tiltPadHandleSize(active: boolean): {
  readonly inner: number
  readonly outer: number
} {
  return {
    inner: active ? TILT_PAD_HANDLE_INNER_ACTIVE : TILT_PAD_HANDLE_INNER_IDLE,
    outer: active ? TILT_PAD_HANDLE_OUTER_ACTIVE : TILT_PAD_HANDLE_OUTER_IDLE,
  }
}

/** Swift L82：`isDragging || isAngleEditing`。 */
export function tiltPadIsActive(input: {
  readonly isDragging: boolean
  readonly isAngleEditing: boolean
}): boolean {
  return input.isDragging || input.isAngleEditing
}

/**
 * Swift L196：编辑角度文本时关掉面板的命中测试。
 *
 * 否则在输入框里点一下会被 DragGesture 抢走焦点，输入框立刻失焦。
 */
export function tiltPadAllowsHitTesting(isAngleEditing: boolean): boolean {
  return !isAngleEditing
}

/**
 * Swift L191-193 / L34-37 的拖动状态机（含归零）。
 *
 * 归零走的是「先 `onChanged(0, 0)` 再 `onEnded()`」——必须成对，只发
 * `onEnded` 会让上一次的倾角留在草稿里。
 */
export class TiltPadDragState {
  private dragging = false
  private rotationXValue: number
  private rotationYValue: number
  private readonly onChanged: (x: number, y: number) => void
  private readonly onEnded: () => void

  constructor(input: {
    readonly rotationX: number
    readonly rotationY: number
    readonly onChanged: (x: number, y: number) => void
    readonly onEnded: () => void
  }) {
    this.rotationXValue = input.rotationX
    this.rotationYValue = input.rotationY
    this.onChanged = input.onChanged
    this.onEnded = input.onEnded
  }

  get isDragging(): boolean {
    return this.dragging
  }

  get rotation(): { readonly x: number; readonly y: number } {
    return { x: this.rotationXValue, y: this.rotationYValue }
  }

  dragChanged(location: { readonly x: number; readonly y: number }, input: {
    readonly size: { readonly width: number; readonly height: number }
    readonly inset: number
  }): { readonly x: number; readonly y: number } {
    this.dragging = true
    const tilt = tiltPadTiltAt({ location, size: input.size, inset: input.inset })
    this.rotationXValue = tilt.x
    this.rotationYValue = tilt.y
    this.onChanged(tilt.x, tilt.y)
    return tilt
  }

  dragEnded(): void {
    this.dragging = false
    this.onEnded()
  }

  /** Swift L34-37：归零按钮。 */
  resetToNeutral(): void {
    this.rotationXValue = 0
    this.rotationYValue = 0
    this.onChanged(0, 0)
    this.onEnded()
  }
}
