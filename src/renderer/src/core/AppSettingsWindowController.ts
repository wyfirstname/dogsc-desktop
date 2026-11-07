/**
 * 设置窗口控制器 —— 全应用复用同一个原生设置窗口。
 *
 * Swift source: Sources/DogSCApp/AppSettingsWindowController.swift（237 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - final class AppSettingsWindowController                     L9-170
 *     · contentWidth 560 / max 640 / initial 540                  L10-12 → SETTINGS_WINDOW_*
 *     · windowIdentifier                                          L14-16 → SETTINGS_WINDOW_IDENTIFIER
 *     · pendingPresentation / presentationRequest 代次             L25-26  → 展示代次
 *     · finishPresentation（等激活 + 菜单收起两个事件）             L51-63  → settingsFinishPresentationPlan
 *     · show(section:)（高度上限、居中、首次清焦点）                L65-93  → settingsShowPlan
 *     · hideForFirstLaunchGuide                                   L95-98
 *     · makeController（窗口属性表）                               L100-141 → SETTINGS_WINDOW_STYLE
 *     · followContentHeight（240…640，四舍五入）                   L151-169 → settingsTargetHeight
 *   - private final class WindowHeightSpring                      L176-237 → WindowHeightSpring
 *     · 120 Hz 采样                                               L196    → SETTINGS_HEIGHT_SPRING_INTERVAL
 *     · retarget（差 > 0.5 才改，续接速度）                        L203-211 → retarget
 *     · tick（到 settlingDuration 直接落到目标）                   L218-228
 *     · apply（顶边固定，宽度不变）                                L230-236 → windowHeightSpringFrame
 *
 * 原注释（L4-7）：
 *   Presents one reusable native settings window regardless of which DogSC
 *   surface is active. The app does not own a SwiftUI WindowGroup, so relying on
 *   the Settings scene's responder-chain action leaves the standard menu item
 *   disabled while the editor's AppKit window is key.
 *
 * 原注释（L52-53）：
 *   Activation and the menu's dismissal are separate AppKit events. Finish after
 *   both, without a guessed delay or a floating window level.
 *
 * 原注释（L149-150）：
 *   Keeps the window exactly as tall as the page needs. Visible changes travel on
 *   the island's morph spring with the top edge held in place.
 *
 * 迁移说明：`NSWindow` → `BrowserWindow`。`RecorderMotion.morphSpring` 未转写，
 * 这里用 `SettingsHeightSpringPort` 注入（`value(target:initialVelocity:time:)`
 * / `velocity(...)` / `settlingDuration`）。窗口弹簧的**三次重定目标**逻辑
 * 是真正的难点：每次重定都要从「当前高度 + 当前速度」续接，否则连续翻页时
 * 窗口会跳一下。
 */

/** Swift L10-12：窗口尺寸三常量。 */
export const SETTINGS_WINDOW_CONTENT_WIDTH = 560
export const SETTINGS_WINDOW_MAXIMUM_CONTENT_HEIGHT = 640
export const SETTINGS_WINDOW_INITIAL_CONTENT_HEIGHT = 540

/** Swift L136：最小内容高度。 */
export const SETTINGS_WINDOW_MINIMUM_CONTENT_HEIGHT = 240

/** Swift L72：屏幕可视高度减去 100，下限 420。 */
export const SETTINGS_WINDOW_SCREEN_HEIGHT_RESERVE = 100
export const SETTINGS_WINDOW_MINIMUM_LIMIT = 420

/** Swift L14-16：窗口标识。 */
export const SETTINGS_WINDOW_IDENTIFIER = 'cn.laogou.dogsc.settings-window'

/** Swift L196：帧定时器 120 Hz。 */
export const SETTINGS_HEIGHT_SPRING_INTERVAL = 1 / 120

/** Swift L59 / L164 / L203：小于这个差值就当没变（0.5 pt）。 */
export const SETTINGS_HEIGHT_EPSILON = 0.5

/** Swift L100-141：窗口的固定属性（Windows 侧映射为 BrowserWindow 选项）。 */
export const SETTINGS_WINDOW_STYLE = {
  identifier: SETTINGS_WINDOW_IDENTIFIER,
  width: SETTINGS_WINDOW_CONTENT_WIDTH,
  initialHeight: SETTINGS_WINDOW_INITIAL_CONTENT_HEIGHT,
  minimumHeight: SETTINGS_WINDOW_MINIMUM_CONTENT_HEIGHT,
  maximumHeight: SETTINGS_WINDOW_MAXIMUM_CONTENT_HEIGHT,
  /** L126-127：设置窗随应用窗口层级，不置顶。 */
  alwaysOnTop: false,
  /** L128：失焦即隐藏（设置不是常驻面板）。 */
  hidesOnDeactivate: true,
  /** L129：不参与会话恢复 —— 设置是显式用户动作。 */
  restorable: false,
  /** L130：禁止标签页合并。 */
  tabbingMode: 'disallowed',
  /** L138：禁用缩放按钮（高度由内容驱动）。 */
  resizableWidth: false,
  resizableHeight: false,
  /** L117：宿主控制器不得自己限制尺寸（高度由 `followContentHeight` 驱动）。 */
  contentSizingOptions: 'none',
  /** L122-126：透明标题栏 + 隐藏标题 + 无分隔线。 */
  titlebarAppearsTransparent: true,
  titleVisibility: 'hidden',
  titlebarSeparator: 'none',
} as const

/**
 * Swift L72：可用高度上限。
 *
 * `min(640, max(screenVisibleHeight − 100, 420))`。
 * 下限 420 在**内层**：先保证不小于 420，再与 640 取小。
 * 写成 `max(420, min(640, h − 100))` 在 h−100 = 700 时结果相同，
 * 但 h−100 = 400 时会得到 420（而不是 min(640,420)=420）—— 两者等价，
 * 真正会出错的是漏掉内层下限：小屏上高度会掉到 300 出头，页面被截断。
 */
export function settingsHeightLimit(screenVisibleHeight: number): number {
  return Math.min(
    SETTINGS_WINDOW_MAXIMUM_CONTENT_HEIGHT,
    Math.max(screenVisibleHeight - SETTINGS_WINDOW_SCREEN_HEIGHT_RESERVE, SETTINGS_WINDOW_MINIMUM_LIMIT)
  )
}

/**
 * Swift L73：打开时的初始高度。
 *
 * `min(lastPreferredHeight ?? 540, limit)` —— 记住上次用户看到的高度，
 * 但不超过当前屏幕允许的上限。
 */
export function settingsInitialHeight(input: {
  readonly lastPreferredHeight: number | null
  readonly limit: number
}): number {
  return Math.min(input.lastPreferredHeight ?? SETTINGS_WINDOW_INITIAL_CONTENT_HEIGHT, input.limit)
}

/**
 * Swift L80-81：居中公式。
 *
 * `y = bounds.midY + typical / 2 − window.frame.height`
 *
 * `typical` 是「标准页」(560×540) 换算出的**含标题栏**高度。
 * 这一项是让「标准页看起来居中」：小页时窗口从标准页的顶部往下缩，
 * 而不是从中心向上长。去掉 `typical / 2` 会让设置窗一开始就偏上。
 */
export function settingsWindowOrigin(input: {
  readonly visibleBounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly windowWidth: number
  readonly windowHeight: number
  readonly typicalFrameHeight: number
}): { readonly x: number; readonly y: number } {
  return {
    x: input.visibleBounds.x + input.visibleBounds.width / 2 - input.windowWidth / 2,
    y: input.visibleBounds.y + input.visibleBounds.height / 2 + input.typicalFrameHeight / 2 - input.windowHeight,
  }
}

/**
 * Swift L51-63：`show()` 之后到底要不要把窗口抬到前面。
 *
 * 三个条件：代次仍是最新（中途又被 show 过一次就放弃）、应用已激活、
 * 窗口存在。任一不满足就什么都不做 —— 绝不用「猜一个延迟」或把窗口
 * 提到浮动层级来绕过这个问题。
 */
export interface SettingsFinishPresentationPlan {
  readonly shouldPresent: boolean
  readonly shouldClearFirstResponder: boolean
}

export function settingsFinishPresentationPlan(input: {
  readonly isLatestRequest: boolean
  readonly applicationIsActive: boolean
  readonly hasWindow: boolean
  readonly clearsInitialFocus: boolean
}): SettingsFinishPresentationPlan {
  if (!input.isLatestRequest || !input.applicationIsActive || !input.hasWindow) {
    return { shouldPresent: false, shouldClearFirstResponder: false }
  }
  return { shouldPresent: true, shouldClearFirstResponder: input.clearsInitialFocus }
}

/**
 * Swift L151-169：内容高度 → 窗口目标高度。
 *
 * 夹到 [240, 640] 后 `rounded()`。四舍五入是必须的：内容高度来自
 * SwiftUI 的浮点测量，直接用会出现 540.0000001 这种目标值，窗口
 * 每次翻页都判「变了」并重启动画。
 */
export function settingsTargetHeight(contentHeight: number): number {
  return Math.round(
    Math.min(
      Math.max(contentHeight, SETTINGS_WINDOW_MINIMUM_CONTENT_HEIGHT),
      SETTINGS_WINDOW_MAXIMUM_CONTENT_HEIGHT
    )
  )
}

/**
 * Swift L155-159：该走瞬时应用还是弹簧。
 *
 * 窗口不可见或降低动态效果时**瞬时**应用（并把在飞的弹簧停掉）——
 * 不可见的窗口跑 120 Hz 定时器纯粹是浪费。
 */
export function settingsHeightAppliesImmediately(input: {
  readonly windowIsVisible: boolean
  readonly reduceMotion: boolean
}): boolean {
  return !input.windowIsVisible || input.reduceMotion
}

/** Swift L230-236：顶边固定、宽度不变的窗口 frame。 */
export function windowHeightSpringFrame(input: {
  readonly currentFrame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly width: number
  readonly contentHeight: number
  /** `frameRect(forContentRect:)` 的结果高度（含标题栏）。 */
  readonly frameHeightForContent: number
}): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const top = input.currentFrame.y + input.currentFrame.height
  return {
    x: input.currentFrame.x,
    y: top - input.frameHeightForContent,
    width: input.width,
    height: input.frameHeightForContent,
  }
}

/** 弹簧 port（对应 `RecorderMotion.morphSpring`）。 */
export interface SettingsHeightSpringPort {
  readonly settlingDuration: number
  value(target: number, initialVelocity: number, time: number): number
  velocity(target: number, initialVelocity: number, time: number): number
}

/**
 * Swift L176-237：窗口高度的弹簧动画器。
 *
 * 三处关键语义：
 *   1. `retarget` 只在差值 > 0.5 时动作，并从「当前值 + 当前速度」续接
 *   2. `tick` 到 `settlingDuration` 时**直接落到目标**（不再取样）
 *   3. 窗口消失时 `tick` 自己停表（`guard let window else { stop() }`）
 */
export class WindowHeightSpring {
  private from: number
  private to: number
  private initialVelocity = 0
  private startTime = 0
  private running = false
  private windowPresent = true
  private readonly spring: SettingsHeightSpringPort
  private readonly setHeight: (height: number) => void

  constructor(input: {
    readonly spring: SettingsHeightSpringPort
    readonly from: number
    readonly to: number
    readonly now: number
    readonly setHeight: (height: number) => void
  }) {
    this.spring = input.spring
    this.from = input.from
    this.to = input.to
    this.startTime = input.now
    this.setHeight = input.setHeight
  }

  get isRunning(): boolean {
    return this.running
  }

  get currentFrom(): number {
    return this.from
  }

  get currentTo(): number {
    return this.to
  }

  get currentVelocity(): number {
    return this.initialVelocity
  }

  start(): void {
    this.running = true
  }

  /** Swift L203-211。 */
  retarget(target: number, now: number): boolean {
    if (!(Math.abs(target - this.to) > SETTINGS_HEIGHT_EPSILON)) return false
    const elapsed = now - this.startTime
    const current =
      this.from + this.spring.value(this.to - this.from, this.initialVelocity, elapsed)
    this.initialVelocity = this.spring.velocity(this.to - this.from, this.initialVelocity, elapsed)
    this.from = current
    this.to = target
    this.startTime = now
    return true
  }

  /** 窗口被撤掉时由宿主调用。 */
  detachWindow(): void {
    this.windowPresent = false
  }

  /** Swift L218-228。返回是否仍在运行。 */
  tick(now: number): boolean {
    if (!this.windowPresent) {
      this.stop()
      return false
    }
    const elapsed = now - this.startTime
    if (elapsed >= this.spring.settlingDuration) {
      this.setHeight(this.to)
      this.stop()
      return false
    }
    this.setHeight(this.from + this.spring.value(this.to - this.from, this.initialVelocity, elapsed))
    return true
  }

  stop(): void {
    this.running = false
  }
}

/**
 * 一个理想化的临界阻尼弹簧（仅用于断言与测试；真实观感由
 * `SettingsHeightSpringPort` 的实现决定）。
 *
 * 解析解：`x(t) = target · (1 − (1 + ωt)·e^(−ωt))`，`settlingDuration ≈ 4/ω`。
 */
export function settingsReferenceSpring(stiffness = 260, damping = 26): SettingsHeightSpringPort {
  const omega = Math.sqrt(stiffness)
  const settlingDuration = 4 / (damping / 2)
  return {
    settlingDuration,
    value(target: number, initialVelocity: number, time: number): number {
      const decay = Math.exp(-omega * time)
      const base = target * (1 - (1 + omega * time) * decay)
      return base + initialVelocity * time * decay
    },
    velocity(target: number, initialVelocity: number, time: number): number {
      const decay = Math.exp(-omega * time)
      const derivative = target * omega * omega * time * decay
      return derivative + initialVelocity * decay * (1 - omega * time)
    },
  }
}
