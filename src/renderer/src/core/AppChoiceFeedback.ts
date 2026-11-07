/**
 * 选择反馈 —— 原生按钮负责「触发」，这里只负责「按下的一小段视觉回应」。
 *
 * Swift source: Sources/DogSCApp/AppChoiceFeedback.swift（182 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct AppChoicePress（pressed / wasSelected）      L6-9   → AppChoicePress
 *   - AppChoicePressKey（EnvironmentKey）                L11-13 → 默认值
 *   - extension EnvironmentValues.appChoicePress         L15-20 → （React 用 context）
 *   - struct AppChoiceButton（Return 键 + 关闭时复位）    L24-56 → appChoiceKeyPressDecision
 *   - final class AppChoiceFeedback                       L58-128 → AppChoiceFeedback
 *     · minimumPressDuration = 0.10                      L66
 *     · trackPress(_:wasSelected:)                       L68-79 → trackPress
 *     · activate(wasSelected:)（两条到达顺序都吃掉）      L81-93 → activate
 *     · reset()                                          L95-102 → reset
 *     · begin / release（不足 0.10 秒则补足）             L104-127 → begin / release
 *   - struct AppChoicePressStyle.PressBody               L138-156 → 禁用时 0.45 透明度
 *   - AppChoiceContentFeedback（已选中 → 0.96）          L160-169 → appChoiceContentScale
 *   - AppChoiceIconFeedback（未选中 → 0.90）             L173-182 → appChoiceIconScale
 *
 * 原注释（L22-23）：
 *   A native Button owns activation; the feedback joins a short tap and a held
 *   press into one response without delaying or duplicating the actual action.
 *
 * 原注释（L119-120）：
 *   Only the visual release waits. Long holds release immediately;
 *   short presses get enough visible time to reach the same light dip.
 *
 * 迁移说明：`ProcessInfo.systemUptime` 由调用方传 `now`；`Task.sleep` 换成
 * 「记录一个 `releaseAt` 时间戳 + `settle(now)`」，语义等价但可断言（不需要
 * 等真实的 100 ms）。`@Published` 换成 React 的外部 store 通知。
 */

/** Swift L66：按下反馈的最短可见时长（秒）。 */
export const APP_CHOICE_MINIMUM_PRESS_DURATION = 0.1

/**
 * Swift L85：`now - nativeReleaseTime < 0.05`。
 *
 * 按钮的 action 与 `isPressed=false` 的观察可能以任意顺序到达，
 * 用 50 ms 这个窗口把「刚刚松手」认出来，避免同一次点击触发两遍反馈。
 */
export const APP_CHOICE_ACTIVATION_RELEASE_WINDOW = 0.05

/** Swift L147：禁用态整体透明度。 */
export const APP_CHOICE_DISABLED_OPACITY = 0.45

/** Swift L166 / L179：按压缩放（已选中 / 未选中）。 */
export const APP_CHOICE_CONTENT_PRESSED_SCALE = 0.96
export const APP_CHOICE_ICON_PRESSED_SCALE = 0.9

/** Swift L167 / L180：按下与回弹的动画时长。 */
export const APP_CHOICE_PRESS_ANIMATION_SECONDS = 0.09

/** Swift L6-9：反馈状态。 */
export interface AppChoicePress {
  readonly pressed: boolean
  readonly wasSelected: boolean
}

export const APP_CHOICE_PRESS_DEFAULT: AppChoicePress = { pressed: false, wasSelected: false }

/**
 * Swift L48-54：Return 键的行为。
 *
 * 三条规则：
 *   - 控件禁用时**忽略**（不是 hide）
 *   - 带 ⌘/⌃/⌥/⇧ 任一模态键一律忽略（让系统快捷键优先）
 *   - 否则触发一次并「已处理」
 */
export function appChoiceKeyPressDecision(input: {
  readonly key: string
  readonly isEnabled: boolean
  readonly modifiers: readonly ('command' | 'control' | 'option' | 'shift')[]
}): 'ignored' | 'handled' {
  if (!input.isEnabled) return 'ignored'
  if (input.key !== 'return') return 'ignored'
  if (input.modifiers.length > 0) return 'ignored'
  return 'handled'
}

/**
 * Swift L104-127 的可断言版本。
 *
 * 状态机只有四个字段：
 *   - `nativeIsPressed`：按钮当前是否物理按下
 *   - `nativeReleaseTime`：最近一次松手时刻
 *   - `nativeActivationHandled`：这次按下是否已经被 action 消费过
 *   - `pressedUntil`：反馈高亮的结束时刻（null 表示已结束）
 */
export class AppChoiceFeedback {
  private pressValue: AppChoicePress = APP_CHOICE_PRESS_DEFAULT
  private nativeIsPressed = false
  private nativeReleaseTime: number | null = null
  private nativeActivationHandled = false
  private feedbackStartedAt = 0
  private pressedUntil: number | null = null

  get press(): AppChoicePress {
    return this.pressValue
  }

  /**
   * Swift L68-79：只在**状态翻转**时动作（`guard pressed != nativeIsPressed`）。
   *
   * SwiftUI 的 `onChange(of: isPressed)` 本身不会重复发，但关掉再打开同一控件
   * 时会漏掉一次 `false`，所以这个守卫必须留着。
   */
  trackPress(now: number, pressed: boolean, wasSelected: boolean): void {
    if (pressed === this.nativeIsPressed) return
    this.nativeIsPressed = pressed
    if (pressed) {
      this.nativeReleaseTime = null
      this.nativeActivationHandled = false
      this.begin(now, wasSelected)
    } else {
      this.nativeReleaseTime = now
      this.release(now)
    }
  }

  /**
   * Swift L81-93：action 触发时的处理。
   *
   * 关键分支：如果这次按下**还没**被消费过，且按钮还按着（或刚松手 50 ms 内），
   * 就只标记「已消费」然后返回 —— 因为 `trackPress` 已经把高亮打开过了，
   * 这里再 `begin` 一次会把 `feedbackStartedAt` 推后，导致松开时多亮了 100 ms。
   */
  activate(now: number, wasSelected: boolean): void {
    const justReleased =
      this.nativeReleaseTime != null &&
      now - this.nativeReleaseTime < APP_CHOICE_ACTIVATION_RELEASE_WINDOW
    if (!this.nativeActivationHandled && (this.nativeIsPressed || justReleased)) {
      this.nativeActivationHandled = true
      return
    }
    this.nativeActivationHandled = true
    this.begin(now, wasSelected)
    this.release(now)
  }

  /** Swift L95-102。 */
  reset(): void {
    this.pressedUntil = null
    this.nativeIsPressed = false
    this.nativeReleaseTime = null
    this.nativeActivationHandled = false
    this.pressValue = APP_CHOICE_PRESS_DEFAULT
  }

  /**
   * Swift L111-127：松手后**至少**亮满 0.10 秒。
   *
   * 长按（已超过 0.10 秒）立即释放；短按补足到 0.10 秒，让「轻点」和「按住」
   * 得到同一个明暗凹坑，而不是轻点几乎没有反馈。
   */
  private release(now: number): void {
    const remaining = APP_CHOICE_MINIMUM_PRESS_DURATION - (now - this.feedbackStartedAt)
    if (!(remaining > 0)) {
      this.pressedUntil = null
      this.pressValue = { ...this.pressValue, pressed: false }
      return
    }
    this.pressedUntil = now + remaining
  }

  private begin(now: number, wasSelected: boolean): void {
    this.feedbackStartedAt = now
    this.pressedUntil = null
    this.pressValue = { pressed: true, wasSelected }
  }

  /** 定时器到期：Swift 里是 `Task.sleep` 之后把 `pressed` 置回 false。 */
  settle(now: number): boolean {
    if (this.pressedUntil == null) return false
    if (now < this.pressedUntil) return false
    this.pressedUntil = null
    this.pressValue = { ...this.pressValue, pressed: false }
    return true
  }

  /** 距离高亮结束还剩多少秒（供宿主排定时器；null 表示不需要定时器）。 */
  pendingReleaseDelay(now: number): number | null {
    if (this.pressedUntil == null) return null
    const remaining = this.pressedUntil - now
    return remaining > 0 ? remaining : 0
  }
}

/**
 * Swift L164-167：**已选中**的控件按下时整组内容一起缩。
 *
 * 已选中的是「当前选项」，用户点它是「再看一眼」，整块给出回应最自然。
 */
export function appChoiceContentScale(input: {
  readonly press: AppChoicePress
  readonly reduceMotion: boolean
}): number {
  const engaged = input.press.pressed && input.press.wasSelected
  return engaged && !input.reduceMotion ? APP_CHOICE_CONTENT_PRESSED_SCALE : 1
}

/**
 * Swift L177-180：**未选中**的控件只让图标缩。
 *
 * 未选中的是「候选」，只动图标是为了让文字保持可读 —— 整块缩放会让文字
 * 在按下瞬间抖动，视觉上像布局出错。
 */
export function appChoiceIconScale(input: {
  readonly press: AppChoicePress
  readonly reduceMotion: boolean
}): number {
  const engaged = input.press.pressed && !input.press.wasSelected
  return engaged && !input.reduceMotion ? APP_CHOICE_ICON_PRESSED_SCALE : 1
}
