/**
 * 应用级键盘焦点外观 —— 焦点环只由键盘导航触发，指针点击与自动首按钮焦点不留残影。
 *
 * Swift source: Sources/DogSCApp/AppControlFocusAppearance.swift（141 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - extension View.appControlFocusAppearance()     L8-10  → APP_CONTROL_FOCUS_ROOT_ATTRIBUTE
 *   - …appButtonKeyboardFocus(in:color:)             L14-19 → AppKeyboardFocusCueMode 'button'
 *   - …appKeyboardFocus(in:color:isFocused:)         L23-29 → AppKeyboardFocusCueMode 'explicit'
 *   - struct AppShowsKeyboardFocusKey                L32-34 → APP_SHOWS_KEYBOARD_FOCUS_DEFAULT
 *   - EnvironmentValues.appShowsKeyboardFocus        L36-41 → keyboardFocusEnvironmentValue
 *   - struct AppControlFocusAppearance               L43-63 → APP_CONTROL_FOCUS_ROOT_ATTRIBUTE
 *   - struct AppButtonKeyboardFocusCue                L65-75 → AppKeyboardFocusCueMode
 *   - struct AppKeyboardFocusCue                      L77-95 → keyboardFocusCueVisible / APP_KEYBOARD_FOCUS_CUE_LINE_WIDTH
 *   - final class AppKeyboardFocusVisibility          L101-141 → AppKeyboardFocusVisibility
 *   - 监视器回调                                      L112-126 → appKeyboardFocusEventAction
 *
 * 原注释（L4-6）：
 *   Apply at every app-owned presentation root, not at individual labels.
 *   A button's focus effect belongs to the control, outside its ButtonStyle.
 *   Text editing, the responder chain and accessibility remain native.
 *
 * 原注释（L97-99）：
 *   Observe only navigation keys and pointer-down events. Never consume an
 *   event, inspect text, monitor pointer motion, or schedule per-frame work.
 *   The one monitor lives only while an app-owned presentation is mounted.
 *
 * 迁移说明：SwiftUI 的 `ViewModifier` 与 `@Environment` 在 React 侧由
 * `<AppControlFocusRoot>` Provider + `useKeyboardFocusVisible()` 承载；
 * `NSEvent.addLocalMonitorForEvents` 对应 `window.addEventListener('keydown'/
 * 'pointerdown', …, true)`（捕获阶段、不 preventDefault）。本文件只保留判定。
 */

/**
 * Swift L118 列出的导航键码（macOS 虚拟键码）：
 *   48 = Tab，123 = ←，124 = →，125 = ↓，126 = ↑
 */
export const APP_KEYBOARD_FOCUS_NAVIGATION_KEY_CODES: readonly number[] = [48, 123, 124, 125, 126]

/** Swift L117：只有这三个修饰键会让导航键「不再是导航」。 */
export const APP_KEYBOARD_FOCUS_BLOCKING_MODIFIERS: readonly string[] = [
  'command',
  'control',
  'option',
]

/** Swift L34：环境默认值 false —— 没有根挂载时不画焦点环。 */
export const APP_SHOWS_KEYBOARD_FOCUS_DEFAULT = false

/** Swift L88：内缩描边宽度。 */
export const APP_KEYBOARD_FOCUS_CUE_LINE_WIDTH = 1.5

/** Swift L16 / L25 的默认颜色 `EditorTheme.chrome(0.40)`。 */
export const APP_KEYBOARD_FOCUS_CUE_DEFAULT_CHROME_LEVEL = 0.4

/** Swift L8：应挂在「每一个应用自有的呈现根」上，而不是单个标签。 */
export const APP_CONTROL_FOCUS_ROOT_ATTRIBUTE = 'data-app-focus-root'

/** 焦点环的两种来源。`button` 走 @FocusState，`explicit` 由调用方直接给值。 */
export type AppKeyboardFocusCueMode = 'button' | 'explicit'

/** Swift L118-123 的两种动作。 */
export type AppKeyboardFocusEventAction = 'show' | 'hide' | 'ignore'

export interface AppKeyboardFocusEvent {
  /** 'keyDown' | 'leftMouseDown' | 'rightMouseDown' | 'otherMouseDown' | 其它 */
  readonly type: string
  readonly keyCode?: number
  /** 已按 deviceIndependentFlagsMask 过滤后的修饰键集合。 */
  readonly modifiers?: readonly string[]
}

/**
 * Swift L112-126 的判定：
 *
 *   if event.type == .keyDown {
 *       let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
 *       if modifiers.isDisjoint(with: [.command, .control, .option]),
 *          [48, 123, 124, 125, 126].contains(event.keyCode) {
 *           self.setVisible(true)
 *       }
 *   } else {
 *       self.setVisible(false)
 *   }
 *
 * 注意三点：
 *   1. keyDown 但**不是**导航键（也不带修饰键）时既不开也不关 —— 打字不会把焦点环点亮。
 *   2. keyDown 带 ⌘/⌃/⌥ 时同样不动 —— ⌘Tab 是切换应用，不是应用内导航。
 *   3. 任何指针按下立刻关掉。`else` 分支覆盖了所有非 keyDown 事件。
 */
export function appKeyboardFocusEventAction(
  event: AppKeyboardFocusEvent
): AppKeyboardFocusEventAction {
  if (event.type !== 'keyDown') return 'hide'
  const modifiers = event.modifiers ?? []
  const hasBlocking = modifiers.some((modifier) =>
    APP_KEYBOARD_FOCUS_BLOCKING_MODIFIERS.includes(modifier)
  )
  if (hasBlocking) return 'ignore'
  const keyCode = event.keyCode
  if (keyCode === undefined) return 'ignore'
  return APP_KEYBOARD_FOCUS_NAVIGATION_KEY_CODES.includes(keyCode) ? 'show' : 'ignore'
}

/**
 * Swift L87：
 *   if isEnabled && (explicitFocus ?? isFocused) && showsKeyboardFocus
 *
 * 三个条件缺一不可：禁用控件不画、无焦点不画、当前不是键盘导航态不画。
 */
export function keyboardFocusCueVisible(input: {
  readonly isEnabled: boolean
  readonly isFocused: boolean
  readonly showsKeyboardFocus: boolean
  /** `explicitFocus`：给定时**取代** isFocused，而不是与之相或。 */
  readonly explicitFocus?: boolean | null
}): boolean {
  if (!input.isEnabled) return false
  const focused = input.explicitFocus === undefined || input.explicitFocus === null
    ? input.isFocused
    : input.explicitFocus
  if (!focused) return false
  return input.showsKeyboardFocus
}

/** Swift L50-51：环境值注册。Provider 缺省即 false。 */
export function keyboardFocusEnvironmentValue(showsKeyboardFocus: boolean): boolean {
  return showsKeyboardFocus
}

/**
 * Swift L101-141 的类形态。
 *
 * 引用计数而非布尔：多个应用自有呈现根同时挂载时，只有**最后一个**卸载才拆监视器。
 * `acquire()` 里 `guard monitor == nil else { return }` 说明监视器全局唯一 ——
 * 后挂载的根不会再加一个。
 */
export class AppKeyboardFocusVisibility {
  private mountedRoots = 0
  private monitorAttached = false
  private visible = false

  get isVisible(): boolean {
    return this.visible
  }

  /** 当前挂载的根数量（诊断用）。 */
  get mountedCount(): number {
    return this.mountedRoots
  }

  /** 监视器是否已挂上。 */
  get isMonitoring(): boolean {
    return this.monitorAttached
  }

  /** Swift L107-127。返回 true 表示调用方需要挂监视器，false 表示已有人挂过。 */
  acquire(): boolean {
    this.mountedRoots += 1
    // L109-111：键盘打开的呈现会继承导航态；指针事件与最后一次释放才重置，
    // 而不是另一个根挂载时重置。
    if (this.monitorAttached) return false
    this.monitorAttached = true
    return true
  }

  /** Swift L129-135。返回 true 表示调用方应当拆监视器。 */
  release(): boolean {
    this.mountedRoots = Math.max(this.mountedRoots - 1, 0)
    if (this.mountedRoots !== 0) return false
    if (!this.monitorAttached) return false
    this.monitorAttached = false
    this.setVisible(false)
    return true
  }

  /** 转发一条已发生的事件。返回 true 表示可见性发生了变化。 */
  handle(event: AppKeyboardFocusEvent): boolean {
    const action = appKeyboardFocusEventAction(event)
    if (action === 'ignore') return false
    return this.setVisible(action === 'show')
  }

  /** Swift L137-140：只在真的变化时才发布。 */
  private setVisible(visible: boolean): boolean {
    if (this.visible === visible) return false
    this.visible = visible
    return true
  }
}
