/**
 * 线性对焦旋转手柄 —— Swift EditorLinearFocusRotationHandle.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorLinearFocusRotationHandle.swift（24 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - EditorSymbol("arrow.triangle.2.circlepath", size: 17)  L10
 *   - font .system(size: 13, weight: .semibold)              L11
 *   - rotationEffect(.degrees(rotation))                     L12
 *   - frame 28×28 + Circle 底色/描边                          L14-21
 *   - shadow(black 0.24, radius 2, y 1)                      L22
 *
 * 原注释：**只有字形转，圆形底盘与既有命中区域不动**。这是手柄能被反复抓住的前提 ——
 * 圆盘一旦跟着转，指针进入/离开的判定边界会在拖动中变形。
 */

/** 圆盘与命中区域尺寸（恒定，不随旋转变化）。 */
export const ROTATION_HANDLE_SIZE = 28

/** 字形绘制尺寸。 */
export const ROTATION_HANDLE_GLYPH_SIZE = 17

/** 字形字号与字重（semibold 用数值表达，React 侧直接写 `fontWeight: 600`）。 */
export const ROTATION_HANDLE_FONT_SIZE = 13
export const ROTATION_HANDLE_FONT_WEIGHT = 600

/** SF Symbol 名（Windows 侧映射到等价矢量图标，名字保留用于查表）。 */
export const ROTATION_HANDLE_SYMBOL = 'arrow.triangle.2.circlepath'

export const ROTATION_HANDLE_SHADOW = {
  color: 'black',
  opacity: 0.24,
  radius: 2,
  offsetY: 1,
} as const

export interface RotationHandleSurface {
  /** 圆盘灰度（0..1）：激活时更深，让白色字形对比更强。 */
  readonly white: number
  readonly opacity: number
  /** 描边灰度与线宽。 */
  readonly strokeWhite: number
  readonly strokeWidth: number
}

/** Swift L17-19。激活态：底色 0.13 / 描边 0.85；常态：0.19 / 0.6。 */
export function rotationHandleSurface(isActive: boolean): RotationHandleSurface {
  return {
    white: isActive ? 0.13 : 0.19,
    opacity: 0.94,
    strokeWhite: isActive ? 0.85 : 0.6,
    strokeWidth: 0.75,
  }
}

/**
 * Swift `rotationEffect(.degrees(rotation))` 的等价取值。
 * 只有字形用这个角度，圆盘恒 0 —— 因此这里不接受「是否激活」参数。
 */
export function rotationHandleGlyphRotation(degrees: number): number {
  return Number.isFinite(degrees) ? degrees : 0
}
