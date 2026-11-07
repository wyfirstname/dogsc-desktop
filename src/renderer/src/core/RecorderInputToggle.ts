/**
 * Swift source: Sources/DogSCApp/RecorderInputToggle.swift（92 行）@ 567fd6e
 *
 * L4-31   → ToggleStyle 外壳：标题 + 弹性空隙 + 原生开关 + 键盘焦点胶囊
 * L33-66  → RecorderInputSwitch：`focusRingType = .none`，焦点由自绘胶囊表达
 * L68-92  → 焦点回报延到下一个运行循环，读当前 firstResponder
 *
 * 原注释：SwiftUI 根部的 focus-effect 策略压不住 NSSwitch 自带的 AppKit 焦点环，
 * 所以保留原生开关与响应者，改用与其他录制控件一致的中性、仅键盘可见的胶囊提示。
 */

/** 行内间距与最小空隙（Swift L20-21）。 */
export const INPUT_TOGGLE_SPACING = 8
export const INPUT_TOGGLE_MINIMUM_SPACER = 8

/** 键盘焦点胶囊的描边不透明度（`RecorderStyle.ink.opacity(0.40)`）。 */
export const INPUT_TOGGLE_FOCUS_RING_OPACITY = 0.4

/** 原生焦点环一律关闭 —— 否则会和自绘胶囊重叠成双层环。 */
export const INPUT_TOGGLE_NATIVE_FOCUS_RING = 'none'

/** 开关状态映射：`sender.state == .on`。 */
export function inputToggleIsOn(controlState: 'on' | 'off' | 'mixed'): boolean {
  return controlState === 'on'
}

/** 因为控件是原生开关，标题对无障碍隐藏（由开关自己带上 label）。 */
export const INPUT_TOGGLE_LABEL_ACCESSIBILITY_HIDDEN = true

/**
 * 焦点回报（Swift L83-91）。
 *
 * 两个必须点：
 * 1. **延到下一个运行循环**再回报 —— 在原生视图更新期间发布 SwiftUI 状态会触发
 *    「Modifying state during view update」；
 * 2. 送达时**重新读**当前 firstResponder，而不是用事件时刻的快照 ——
 *    否则快速 Tab 会把过期状态写回去，或凭空造出第二个焦点目标。
 */
export function inputToggleFocusReport(isCurrentFirstResponder: boolean): boolean {
  return isCurrentFirstResponder
}

/** 焦点胶囊是否可见：仅当自绘的 `hasFocus` 为真。 */
export function inputToggleFocusCueVisible(hasFocus: boolean, isEnabled: boolean): boolean {
  return hasFocus && isEnabled
}

/**
 * 行布局：标题占满剩余宽度，开关保持固有尺寸。
 * 标题本身 `accessibilityHidden`，所以读屏只会念一次开关上的 label。
 */
export function inputToggleRowLayout(input: {
  readonly availableWidth: number
  readonly switchWidth: number
}): { readonly labelWidth: number; readonly switchWidth: number } {
  const labelWidth = Math.max(
    input.availableWidth - input.switchWidth - INPUT_TOGGLE_SPACING - INPUT_TOGGLE_MINIMUM_SPACER,
    INPUT_TOGGLE_MINIMUM_SPACER
  )
  return { labelWidth, switchWidth: input.switchWidth }
}
