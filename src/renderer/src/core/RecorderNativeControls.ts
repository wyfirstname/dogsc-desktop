/**
 * 录制器原生控件 —— 菜单按钮的 AppKit 交互垫片与动作触发器。
 *
 * Swift source: Sources/DogSCApp/RecorderNativeControls.swift（326 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct RecorderMenuItem（action / info / separator）       L6-47  → RecorderMenuItemKind
 *   - class RecorderMenuButtonNSView                            L49-263
 *     · draw 空实现（画面归 SwiftUI）、mouseDown 回落            L55-62  → recorderMenuPressChangeEnabled
 *     · configureKeyboardFocusCue（0.62 / 1.5）                 L88-101 → RECORDER_MENU_FOCUS_*
 *     · updateKeyboardFocusTracking（acquire / release）         L119-127 → recorderMenuFocusTracking
 *     · updateKeyboardFocusCue（四条件）                         L134-141 → recorderMenuFocusVisible
 *     · updateHoverShape（圆 / 连续的判定、内缩 0.75）            L158-173 → recorderMenuCircleCorner
 *     · updateTrackingAreas（四项，含 enabledDuringMouseDrag）    L175-193 → RECORDER_MENU_TRACKING_AREA_OPTIONS
 *     · viewDidMoveToWindow（共享 hover 观察的挂摘）              L195-208 → recorderMenuHoverObservationNeeded
 *     · mouseEntered / mouseExited / observeSharedHover           L215-234 → RECORDER_MENU_HOVER_NOTIFICATION
 *     · refreshHoverState / setHoverAppearance（α×1.6、0.14s）   L236-262 → recorderMenuHoverAlpha
 *   - struct RecorderActionTrigger（NSViewRepresentable）        L265-325 → RECORDER_ACTION_TRIGGER_*
 *
 * 原注释（L55）：
 *   Artwork belongs to SwiftUI; AppKit owns first-click and mouse tracking only.
 *
 * 原注释（L210-211）：
 *   A missed exit event must not leave a control lit. Whenever the pointer
 *   crosses any of these controls, all of them re-read where it really is.
 *
 * 原注释（L249-250）：
 *   The hover wash is light on the dark glass, and a little stronger than it
 *   was on white so it reads at the same strength.
 *
 * 原注释（L286-287）：
 *   A selector overlay may become key immediately after this action. Send only
 *   on mouse-up so the opening click cannot be stolen mid gesture.
 *
 * 迁移说明：`NSButton` 子类 → DOM 元素。保留四件纯逻辑：焦点环的
 * 四条件与内缩、悬停洗色的 ×1.6 增益、圆形/连续圆角的判定、
 * 以及「所有同类控件共享一次 hover 重读」的通知机制。
 */

// ---------------------------------------------------------------- 菜单项

/**
 * Swift L7-11：三种菜单项。
 *
 * `info` 是不可点的说明行（灰字），`separator` 是分隔线 —— 它们都不是
 * `action`，所以 `isEnabled` 恒为 false 且 `handler` 为 null。
 */
export type RecorderMenuItemKind = 'action' | 'separator' | 'info'

/** Swift L6-19：一个菜单项。 */
export interface RecorderMenuItem {
  readonly kind: RecorderMenuItemKind
  readonly title: string
  readonly systemImage: string | null
  readonly detail: string | null
  readonly isOn: boolean
  readonly isEnabled: boolean
}

/**
 * Swift L21-38：可点项的构造。
 *
 * `detail` 会过一层本地化（`detail.map { appLocalized($0) }`），而
 * `systemImage` 不过 —— 图标名是固定的 SF Symbol 标识，翻译了会找不到图标。
 */
export function recorderMenuActionItem(input: {
  readonly title: string
  readonly systemImage?: string | null
  readonly detail?: string | null
  readonly isOn?: boolean
  readonly isEnabled?: boolean
}): RecorderMenuItem {
  return {
    kind: 'action',
    title: input.title,
    systemImage: input.systemImage ?? null,
    detail: input.detail ?? null,
    isOn: input.isOn ?? false,
    isEnabled: input.isEnabled ?? true,
  }
}

/** Swift L40-42：说明项 —— `isOn`/`isEnabled` 恒 false，`handler` 为 nil。 */
export function recorderMenuInfoItem(title: string): RecorderMenuItem {
  return { kind: 'info', title, systemImage: null, detail: null, isOn: false, isEnabled: false }
}

/** Swift L44-46：分隔线 —— 标题为空串。 */
export const RECORDER_MENU_SEPARATOR_TITLE = ''

export function recorderMenuSeparatorItem(): RecorderMenuItem {
  return {
    kind: 'separator',
    title: RECORDER_MENU_SEPARATOR_TITLE,
    systemImage: null,
    detail: null,
    isOn: false,
    isEnabled: false,
  }
}

/**
 * Swift L58：只有 `action` 项能被点。
 *
 * 这一条决定 `<button disabled>` 的取值：`info` 项在视觉上是一行灰字，
 * 它连焦点都不该拿。
 */
export function recorderMenuItemIsInteractive(kind: RecorderMenuItemKind): boolean {
  return kind === 'action'
}

/** Swift L15-18：菜单项是否该显示（分隔线在没有相邻项时可以跳过）。 */
export function recorderMenuItemIsVisible(kind: RecorderMenuItemKind): boolean {
  return kind !== 'separator'
}

// ---------------------------------------------------------------- 焦点环

/** Swift L90-91：焦点环颜色 `chrome.opacity(0.62)`、线宽 1.5。 */
export const RECORDER_MENU_FOCUS_ALPHA = 0.62
export const RECORDER_MENU_FOCUS_LINE_WIDTH = 1.5

/**
 * Swift L134-136：焦点环可见的四个条件。
 *
 * 与采集器按钮完全同构（可用 / 有原生焦点 / 窗口是 key / 全局键盘导航可见）。
 * 第四条用的是 `navigationIsVisible ?? shared.isVisible` —— 优先用调用方
 * 传进来的快照值，因为 `@Published` 在存储值变化前就先发了。
 */
export function recorderMenuFocusVisible(input: {
  readonly isEnabled: boolean
  readonly hasNativeFocus: boolean
  readonly isKeyWindow: boolean
  readonly navigationIsVisible: boolean
}): boolean {
  return (
    input.isEnabled && input.hasNativeFocus && input.isKeyWindow && input.navigationIsVisible
  )
}

/**
 * Swift L166：焦点环的内缩固定 0.75（不是线宽的一半）。
 *
 * 采集器那边是 `lineWidth / 2`（因为线宽可配置），这里是常量 0.75，
 * 对应 1.5 线宽的一半，但写成常量省掉一次计算。
 */
export const RECORDER_MENU_FOCUS_INSET = 0.75

/** Swift L167：内缩后的圆角 `max(0, cornerRadius - 0.75)`。 */
export function recorderMenuFocusRadius(cornerRadius: number): number {
  const radius = Number.isFinite(cornerRadius) ? cornerRadius : 0
  return Math.max(0, radius - RECORDER_MENU_FOCUS_INSET)
}

/** Swift L168：尺寸不足时不画焦点环路径。 */
export function recorderMenuFocusPathAllowed(width: number, height: number): boolean {
  return width > RECORDER_MENU_FOCUS_INSET * 2 && height > RECORDER_MENU_FOCUS_INSET * 2
}

/** Swift L120：只有「有窗口且可用」时持有键盘导航观察者。 */
export function recorderMenuFocusTracking(input: {
  readonly hasWindow: boolean
  readonly isEnabled: boolean
}): boolean {
  return input.hasWindow && input.isEnabled
}

/** Swift L130：只响应自己窗口的 key 变化。 */
export function recorderMenuWindowMatches(changedWindowIsOwn: boolean): boolean {
  return changedWindowIsOwn
}

// ---------------------------------------------------------------- 圆角与形状

/** Swift L64 / L67：悬停圆角默认 10、洗色不透明度默认 0.065。 */
export const RECORDER_MENU_HOVER_CORNER_RADIUS = 10
export const RECORDER_MENU_HOVER_OPACITY = 0.065

/**
 * Swift L160-162：是否是正圆。
 *
 * 三个条件：宽大于 0、宽高差小于 0.5（浮点误差容限）、且圆角不小于高度的一半。
 *
 * 判定「圆」是为了换 `cornerCurve`：`continuous`（iOS 那种连续曲率）用在
 * 正圆上会在接缝处留下细微的棱，正圆必须用 `circular`。
 */
export function recorderMenuIsCircle(input: {
  readonly width: number
  readonly height: number
  readonly cornerRadius: number
}): boolean {
  if (!(input.width > 0)) return false
  if (Math.abs(input.width - input.height) >= 0.5) return false
  return input.cornerRadius >= input.height / 2
}

/** Swift L162：按是否正圆选曲率。 */
export function recorderMenuCornerCurve(isCircle: boolean): 'circular' | 'continuous' {
  return isCircle ? 'circular' : 'continuous'
}

/** Swift L73-74 / L82-83：图层裁剪到圆角内。 */
export function recorderMenuMasksToBounds(): boolean {
  return true
}

// ---------------------------------------------------------------- 悬停

/**
 * Swift L212：共享的悬停变更通知名。
 *
 * 这条通知是本类的核心技巧：AppKit 会漏发 `mouseExited`（比如窗口在指针
 * 下方被移走），所以每次进出都广播一次，让所有同类控件重新算一遍
 * 「指针到底在不在我身上」。重读是幂等的，所以广播方自己也参与。
 */
export const RECORDER_MENU_HOVER_NOTIFICATION = 'cn.laogou.dogsc.recorder-hover-changed'

/** Swift L213：通知在 .main 队列上投递。 */
export const RECORDER_MENU_HOVER_NOTIFICATION_QUEUE = 'main'

/**
 * Swift L248-252：悬停洗色的最终透明度 = `hoverHighlightOpacity × 1.6`。
 *
 * 注释（L249-250）解释了这个 1.6：深色玻璃上同样的透明度看起来比白底弱，
 * 所以统一放大 1.6 倍才能在两种底上强度一致。
 *
 * 不可用时恒为 0 —— 悬停在禁用控件上不该亮。
 */
export function recorderMenuHoverAlpha(input: {
  readonly hovering: boolean
  readonly isEnabled: boolean
  readonly highlightOpacity: number
}): number {
  if (!input.hovering || !input.isEnabled) return 0
  return input.highlightOpacity * RECORDER_MENU_HOVER_GAIN
}

/** Swift L251：洗色的放大系数 1.6。 */
export const RECORDER_MENU_HOVER_GAIN = 1.6

/** Swift L258：洗色动画 0.14 秒；降低动态效果时 0。 */
export function recorderMenuHoverDuration(reduceMotion: boolean): number {
  return reduceMotion ? 0 : RECORDER_MENU_HOVER_DURATION
}

export const RECORDER_MENU_HOVER_DURATION = 0.14

/** Swift L259：曲线固定 easeOut（出现要快、消失要缓）。 */
export const RECORDER_MENU_HOVER_CURVE = 'easeOut' as const

/** Swift L260：动画键名（同一键重复添加会替换，不会堆积）。 */
export const RECORDER_MENU_HOVER_ANIMATION_KEY = 'recorderMenuHover'

/**
 * Swift L253：颜色没变就不重画。
 *
 * `layer.backgroundColor != targetColor` 这个比较挡的是 `refreshHoverState`
 * 的高频调用 —— 每次通知都会让所有控件重读一次，不比较的话每次都要
 * 起一个 CABasicAnimation。
 */
export function recorderMenuHoverStyleChanged(previous: string, next: string): boolean {
  return previous !== next
}

/** Swift L237-240：没有窗口就直接判为「不在悬停」。 */
export function recorderMenuHovering(input: {
  readonly hasWindow: boolean
  readonly boundsContainsPointer: boolean
}): boolean {
  if (!input.hasWindow) return false
  return input.boundsContainsPointer
}

/**
 * Swift L199-204 / L226-227：什么时候需要挂共享 hover 观察者。
 *
 * 有窗口才挂（窗口为 nil 时摘掉），且已经挂过就不重复挂 ——
 * `observeSharedHover` 里的 `guard hoverObservation == nil else { return }`
 * 保证每个控件最多一条观察。
 */
export function recorderMenuHoverObservationNeeded(input: {
  readonly hasWindow: boolean
  readonly alreadyObserving: boolean
}): boolean {
  return input.hasWindow && !input.alreadyObserving
}

/** Swift L176-177：窗口消失时要摘掉观察者（否则控件已释放还在收通知）。 */
export function recorderMenuShouldRemoveHoverObservation(input: {
  readonly hasWindow: boolean
  readonly alreadyObserving: boolean
}): boolean {
  return !input.hasWindow && input.alreadyObserving
}

// ---------------------------------------------------------------- 鼠标事件

/**
 * Swift L179-186：跟踪区四项。
 *
 * `enabledDuringMouseDrag` 是这里的特殊项：菜单按钮在拖拽中也要继续
 * 收进出事件，否则用户按住按钮拖出再拖回时悬停态会丢。
 */
export const RECORDER_MENU_TRACKING_AREA_OPTIONS = [
  'mouseEnteredAndExited',
  'activeAlways',
  'inVisibleRect',
  'enabledDuringMouseDrag',
] as const

/** Swift L180：`inVisibleRect` 让跟踪区自动跟随可见区域，rect 传 `.zero` 即可。 */
export const RECORDER_MENU_TRACKING_AREA_USES_ZERO_RECT = true

/**
 * Swift L143：第一次点击直接接收。
 *
 * AppKit 默认要求窗口先成为 key 才把点击交给控件（第一击只用来激活窗口）。
 * 菜单按钮要的是「一点就开」，所以显式打开。
 */
export function recorderMenuAcceptsFirstMouse(): boolean {
  return true
}

/**
 * Swift L57-61：按下回调只在可用时发出，且一定成对。
 *
 * `defer { onPressChange?(false) }` 保证抬起时必然发一次 false ——
 * 中间如果 `super.mouseDown` 抛了异常（很少见但可能），defer 仍然会跑。
 */
export function recorderMenuPressChangeEnabled(isEnabled: boolean): boolean {
  return isEnabled
}

/** Swift L198：窗口要接收 mouseMoved 事件才能持续跟踪（拖拽中尤其需要）。 */
export function recorderMenuRequiresMouseMovedEvents(): boolean {
  return true
}

// ---------------------------------------------------------------- 动作触发器

/** Swift L271 / L272：圆角默认 10、洗色默认 0.075。 */
export const RECORDER_ACTION_TRIGGER_CORNER_RADIUS = 10
export const RECORDER_ACTION_TRIGGER_HIGHLIGHT_OPACITY = 0.075

/**
 * Swift L288：只在鼠标抬起时发动作（`.leftMouseUp`）。
 *
 * 注释（L286-287）讲了原因：动作可能立刻弹出一个选择器覆盖层并抢走 key，
 * 如果在 mouseDown 就发，这个覆盖层会在用户还没松手时出现，
 * 那一次点击的 mouseUp 就落到了覆盖层上。
 */
export const RECORDER_ACTION_TRIGGER_SEND_ON = 'leftMouseUp'

/** Swift L283：焦点环交给自己的图层画（不用系统的那一圈）。 */
export const RECORDER_ACTION_TRIGGER_FOCUS_RING = 'none'

/** Swift L281-282：无边框、无标题。 */
export const RECORDER_ACTION_TRIGGER_IS_BORDERED = false
export const RECORDER_ACTION_TRIGGER_TITLE = ''

/**
 * Swift L300-312：`updateNSView` 每次都重设全部可变字段。
 *
 * 包括 `isEnabled` 与无障碍标签 —— SwiftUI 的 representable 没有
 * 增量更新通知，只能整体覆盖；漏掉任何一项都会表现为「属性改了界面没变」。
 */
export const RECORDER_ACTION_TRIGGER_UPDATE_FIELDS = [
  'action',
  'onPressChange',
  'cornerRadius',
  'highlightOpacity',
  'isEnabled',
  'accessibilityLabel',
  'accessibilityIdentifier',
] as const

/**
 * Swift L294-296：`identifier` 与 `accessibilityIdentifier` 用同一个值。
 *
 * 前者给 AppKit 的视图查找（自动化脚本用），后者给无障碍。
 * 两者分开设是因为它们是两套独立机制，只设一个会导致其中一方查不到。
 */
export function recorderActionTriggerIdentifier(identifier: string | null): string | null {
  return identifier
}
