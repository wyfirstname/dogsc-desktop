/**
 * 滑块键盘桥 —— Swift EditorSliderKeyboardBridge.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorSliderKeyboardBridge.swift（87 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - requestsFocus / isEnabled / 回调                   L8-11
 *   - updateNSView：只在「刚请求焦点」时抢占第一响应者      L21-24
 *   - 禁用即释放焦点                                     L25
 *   - acceptsFirstResponder = isEnabled                  L42
 *   - becomeFirstResponder：异步回报焦点 + 装鼠标监视器     L44-61
 *   - resignFirstResponder：摘监视器 + 异步回报失焦        L63-67
 *   - keyDown：无 cmd/ctrl/option 且是方向键才步进          L69-77
 *
 * 原注释：时间线有一个**窗口级**的方向键监视器。正在编辑的滑块必须是一个真正的
 * 第一响应者，那个监视器才会让位给控件 —— 否则用户调参数时电影会跟着走一帧。
 *
 * 迁移说明：Windows 侧没有第一响应者链，等价物是「聚焦元素 + 键盘事件优先级」。
 * 这里搬三件事：方向键到步进的映射、修饰键让位规则、失焦条件（点到控件之外）。
 */

/** 方向键虚拟键码（macOS）：左 123、右 124、下 125、上 126。 */
export const SLIDER_KEY_CODE_LEFT = 123
export const SLIDER_KEY_CODE_RIGHT = 124
export const SLIDER_KEY_CODE_DOWN = 125
export const SLIDER_KEY_CODE_UP = 126

export const SLIDER_ARROW_KEY_CODES: readonly number[] = [
  SLIDER_KEY_CODE_LEFT,
  SLIDER_KEY_CODE_RIGHT,
  SLIDER_KEY_CODE_DOWN,
  SLIDER_KEY_CODE_UP,
]

/**
 * Swift L72：右/上 = +1，左/下 = −1。
 * 上下与左右同义是上游的选择（滑块的上下也被当成「增/减」）。
 */
export function sliderStepDirection(keyCode: number): number {
  return keyCode === SLIDER_KEY_CODE_RIGHT || keyCode === SLIDER_KEY_CODE_UP ? 1 : -1
}

export interface SliderKeyboardStep {
  readonly direction: number
  /** Shift 表示精细调整（步长由调用方决定）。 */
  readonly fine: boolean
  readonly keyCode: number
}

/**
 * Swift L70-76：只要按下了 **command / control / option** 之一就交还给系统
 * （这些组合是菜单快捷键的领地）；只有方向键 + 无修饰（或仅 shift）才算滑块步进。
 * 返回 null 表示「不处理，继续冒泡」。
 */
export function sliderKeyboardStep(
  keyCode: number,
  modifiers: { readonly shift: boolean; readonly command: boolean; readonly control: boolean; readonly option: boolean },
  isEnabled: boolean
): SliderKeyboardStep | null {
  if (!isEnabled) return null
  if (modifiers.command || modifiers.control || modifiers.option) return null
  if (!SLIDER_ARROW_KEY_CODES.includes(keyCode)) return null
  return { direction: sliderStepDirection(keyCode), fine: modifiers.shift, keyCode }
}

/** Swift `acceptsFirstResponder = isEnabled`。 */
export function sliderAcceptsFocus(isEnabled: boolean): boolean {
  return isEnabled
}

/**
 * Swift L21-24：**只在从「未请求」变成「请求」的那一帧**抢占焦点。
 * 每帧都抢会让用户无法用 Tab 离开滑块。
 */
export function sliderShouldRequestFocus(requestsFocus: boolean, wasRequestingFocus: boolean): boolean {
  return requestsFocus && !wasRequestingFocus
}

/** Swift L54-56：点到别的窗口、或点在控件 bounds 之外 → 释放焦点。 */
export function sliderMouseDownReleasesFocus(eventWindowIsOwn: boolean, pointInsideBounds: boolean): boolean {
  return !eventWindowIsOwn || !pointInsideBounds
}

/** Swift L46-49 / L65：焦点变化是**异步**回报的（等第一响应者真正切换完）。 */
export const SLIDER_FOCUS_DELEGATES_ASYNC = true
