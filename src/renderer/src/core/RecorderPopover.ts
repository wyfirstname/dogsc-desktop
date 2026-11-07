/**
 * RecorderPopover —— 录制前那一排浮层的宿主与排版。
 *
 * Swift source: Sources/DogSCApp/RecorderPopover.swift（272 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L6-95    RecorderPopoverPresenter（panel / identifier / 两个事件监视器 / 观察者）
 *   L15-69   toggle(id:anchor:content:width:) —— 定位、建面板、挂监视器
 *   L20-21   可见区域先内缩 12 点，最大高度 = 可见高 − 16
 *   L24-29   内容变高时重排（差值 > 1 才动）
 *   L31-35   初始高度与位置
 *   L42-43   层级 = 宿主窗口 + 1；三个 collectionBehavior
 *   L52-63   本地 / 全局鼠标监视
 *   L64-68   宿主移动/关闭时收起
 *   L71-82   dismiss —— 摘监视器、摘子窗口、关面板
 *   L86-94   dismissAndPerform —— 先收面板再动工作区
 *   L97-117  RecorderPopoverViewport（宽固定、高夹到最大）
 *   L119-122 RecorderConfigurationPanel（可成为 key，不可成为 main）
 *   L124-147 RecorderPopoverButton
 *   L149-186 RecorderPopoverTrigger（NSViewRepresentable + Coordinator）
 *   L188-201 RecorderPopoverSurface（fade in + 上浮 6 点）
 *   L205-249 RecorderChoiceRow（radio / checkmark 两种标记）
 *   L251-272 RecorderActionList
 *
 * 迁移说明：
 *   浮层宿主在 Web 侧由绝对定位的 `<div>` 承担。保留的纯逻辑：
 *     1. 定位：优先放在锚点**下方**，下方放不下才翻到上方，且翻上去后再夹
 *        一次上沿 —— 否则会顶出屏幕
 *     2. 单击同一触发器应当是「关」而不是「关一次再开一次」
 *     3. 本地监视器的五种结果：Esc 吞掉、点面板内放过、点锚点吞掉、点别处
 *        「关但放过事件」、其余放过
 *     4. 内容变高的重排只在差值 > 1 点时执行（避免抖动）
 */

/** Swift L20：可见区域先内缩 12 点。 */
export const RECORDER_POPOVER_SCREEN_INSET = 12
/** Swift L21 / L26 / L27：上下各留 16 点。 */
export const RECORDER_POPOVER_EDGE_GAP = 16
/** Swift L31：高度下限 80 点。 */
export const RECORDER_POPOVER_MINIMUM_HEIGHT = 80
/** Swift L129 / L181：默认面板宽 290。 */
export const RECORDER_POPOVER_DEFAULT_WIDTH = 290
/** Swift L114：圆角 18。 */
export const RECORDER_POPOVER_CORNER_RADIUS = 18
/** Swift L193：内容内边距 10。 */
export const RECORDER_POPOVER_CONTENT_PADDING = 10
/** Swift L102：内容高度初值 300（布局前的占位）。 */
export const RECORDER_POPOVER_INITIAL_CONTENT_HEIGHT = 300
/** Swift L25：高度变化超过 1 点才重排。 */
export const RECORDER_POPOVER_RESIZE_EPSILON = 1
/** Swift L53：Esc 的键码。 */
export const RECORDER_POPOVER_ESCAPE_KEY_CODE = 53
/** Swift L198：入场时上浮 6 点。 */
export const RECORDER_POPOVER_ARRIVAL_OFFSET = -6
/** Swift L46：面板标识前缀。 */
export const RECORDER_POPOVER_IDENTIFIER_PREFIX = 'recorder.popover.'
/** Swift L176：触发器标识前缀。 */
export const RECORDER_POPOVER_TRIGGER_IDENTIFIER_PREFIX = 'recorder.config.'
/** Swift L43：三个 collectionBehavior。 */
export const RECORDER_POPOVER_COLLECTION_BEHAVIOR: readonly string[] = [
  'canJoinAllSpaces',
  'fullScreenAuxiliary',
  'ignoresCycle',
]
/** Swift L64：收起浮层的两个通知。 */
export const RECORDER_POPOVER_DISMISS_NOTIFICATIONS: readonly string[] = [
  'NSWindow.didMoveNotification',
  'NSWindow.willCloseNotification',
]
/** Swift L52：本地监视器监听的三类事件。 */
export const RECORDER_POPOVER_LOCAL_EVENTS: readonly string[] = [
  'leftMouseDown',
  'rightMouseDown',
  'keyDown',
]
/** Swift L61：全局监视器只监听鼠标按下。 */
export const RECORDER_POPOVER_GLOBAL_EVENTS: readonly string[] = [
  'leftMouseDown',
  'rightMouseDown',
]

export interface RecorderPopoverRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Swift L15-17：同一个 id 再点一次是**关**。
 *
 * 这是「点同一个按钮不该关掉再打开」的唯一实现位置 —— 放到按钮侧会因为
 * 事件顺序（本地监视器先触发 dismiss，再走 action 又 toggle 一次）而变成
 * 「关了立刻开」。
 */
export type RecorderPopoverToggleStep = 'dismiss' | 'replace-and-open'

export function recorderPopoverToggleStep(input: {
  readonly currentIdentifier: string | null
  readonly requestedIdentifier: string
}): RecorderPopoverToggleStep {
  return input.currentIdentifier === input.requestedIdentifier
    ? 'dismiss'
    : 'replace-and-open'
}

/** Swift L20：可见区域。 */
export function recorderPopoverVisibleFrame(screenVisibleFrame: RecorderPopoverRect): RecorderPopoverRect {
  return {
    x: screenVisibleFrame.x + RECORDER_POPOVER_SCREEN_INSET,
    y: screenVisibleFrame.y + RECORDER_POPOVER_SCREEN_INSET,
    width: Math.max(screenVisibleFrame.width - RECORDER_POPOVER_SCREEN_INSET * 2, 0),
    height: Math.max(screenVisibleFrame.height - RECORDER_POPOVER_SCREEN_INSET * 2, 0),
  }
}

/** Swift L21：最大高度 = 可见高 − 16。 */
export function recorderPopoverMaxHeight(visibleFrame: RecorderPopoverRect): number {
  return Math.max(visibleFrame.height - RECORDER_POPOVER_EDGE_GAP, 0)
}

/** Swift L31：初始高度 = `min(max(fitting, 80), maxHeight)`。 */
export function recorderPopoverInitialHeight(input: {
  readonly fittingHeight: number
  readonly maxHeight: number
}): number {
  return Math.min(
    Math.max(input.fittingHeight, RECORDER_POPOVER_MINIMUM_HEIGHT),
    input.maxHeight
  )
}

/**
 * Swift L32：水平位置 —— 以锚点中心居中，再夹进可见区域。
 *
 * 夹取的右界是 `visible.maxX − width`（不是 `maxX`）：面板整体必须留在
 * 屏幕内，所以左界要按宽度回退。
 */
export function recorderPopoverX(input: {
  readonly anchorMidX: number
  readonly width: number
  readonly visibleFrame: RecorderPopoverRect
}): number {
  return Math.min(
    Math.max(
      input.anchorMidX - input.width / 2,
      input.visibleFrame.x
    ),
    input.visibleFrame.x + input.visibleFrame.width - input.width
  )
}

/**
 * Swift L26-27 / L33-34：垂直位置。
 *
 * `below = anchor.minY − height − 16`
 *   - 放得下 → 就放下面
 *   - 放不下 → `min(anchor.maxY + 16, visible.maxY − height)`
 *
 * 翻到上方之后还要再夹一次上沿，否则高面板会顶出屏幕顶端。
 */
export function recorderPopoverY(input: {
  readonly anchorRect: RecorderPopoverRect
  readonly height: number
  readonly visibleFrame: RecorderPopoverRect
}): number {
  const visibleMinY = input.visibleFrame.y
  const visibleMaxY = input.visibleFrame.y + input.visibleFrame.height
  const below = input.anchorRect.y - input.height - RECORDER_POPOVER_EDGE_GAP
  if (below >= visibleMinY) return below
  return Math.min(
    input.anchorRect.y + input.anchorRect.height + RECORDER_POPOVER_EDGE_GAP,
    visibleMaxY - input.height
  )
}

/** Swift L24-25：内容变高时的重排门槛 —— 差值超过 1 点。 */
export function recorderPopoverResizeAccepted(input: {
  readonly currentHeight: number
  readonly newHeight: number
}): boolean {
  return Math.abs(input.currentHeight - input.newHeight) > RECORDER_POPOVER_RESIZE_EPSILON
}

/** Swift L42：面板层级永远是宿主 + 1。 */
export function recorderPopoverLevel(ownerLevel: number): number {
  return ownerLevel + 1
}

/** Swift L46：面板标识。 */
export function recorderPopoverIdentifier(id: string): string {
  return `${RECORDER_POPOVER_IDENTIFIER_PREFIX}${id}`
}

/** Swift L176：触发器标识。 */
export function recorderPopoverTriggerIdentifier(id: string): string {
  return `${RECORDER_POPOVER_TRIGGER_IDENTIFIER_PREFIX}${id}`
}

/** Swift L120-121：面板可以成为 key，永远不能成为 main。 */
export function recorderPopoverCanBecomeMain(): boolean {
  return false
}

/**
 * Swift L52-60：本地事件监视器的五种结果。
 *
 *  - `dismiss-and-consume`（Esc）—— 吞掉事件，否则 Esc 会继续传给宿主。
 *  - `pass-through`（面板内的点击 / 无关按键）—— 什么也不做。
 *  - `dismiss-click-and-consume`（点在锚点上）—— 关掉并吞掉，
 *    这样后面按钮的 action 不会再 toggle 一次。
 *  - `dismiss-click-and-pass`（点在别处）—— 关掉但让事件继续，
 *    用户点的那一下应该照常生效。
 *
 * 判「点在锚点上」用的是 `anchorRect.contains(mouseLocation)`，不是
 * `event.window === anchorWindow` —— 锚点所在的宿主窗口可能有别的控件。
 */
export type RecorderPopoverLocalEventOutcome =
  | 'dismiss-and-consume'
  | 'pass-through'
  | 'dismiss-click-and-consume'
  | 'dismiss-click-and-pass'

export function recorderPopoverLocalEvent(input: {
  readonly isKeyDown: boolean
  readonly keyCode: number
  readonly eventWindowIsPanel: boolean
  readonly anchorRectContainsMouse: boolean
}): RecorderPopoverLocalEventOutcome {
  if (input.isKeyDown) {
    return input.keyCode === RECORDER_POPOVER_ESCAPE_KEY_CODE
      ? 'dismiss-and-consume'
      : 'pass-through'
  }
  if (input.eventWindowIsPanel) return 'pass-through'
  return input.anchorRectContainsMouse
    ? 'dismiss-click-and-consume'
    : 'dismiss-click-and-pass'
}

/**
 * Swift L86-94：`dismissAndPerform` 的三步。
 *
 * 先记下宿主窗口（面板一关 `parent` 就没了），再收起面板，最后**异步**
 * 激活 App 并执行 action —— 同步执行会让触发用的那次 mouse-up 还压在
 * 事件队列里，焦点切换会被吞掉。
 */
export const RECORDER_DISMISS_AND_PERFORM_ORDER: readonly string[] = [
  'capture-owner-window',
  'dismiss-panel',
  'activate-application',
  'restore-owner-key-window',
  'perform-action',
]

/** Swift L91：宿主仍可见才抢回 key —— 已关闭的窗口不该被叫回来。 */
export function recorderDismissRestoresOwnerKey(input: {
  readonly ownerIsVisible: boolean
}): boolean {
  return input.ownerIsVisible
}

/**
 * Swift L71-82：`dismiss` 的清理顺序。
 *
 * 监视器必须在关闭面板**之前**摘掉 —— 否则 `orderOut` 引发的窗口变化
 * 又会被监视器当成一次「点了别处」，递归 dismiss。
 */
export const RECORDER_POPOVER_DISMISS_ORDER: readonly string[] = [
  'remove-local-monitor',
  'remove-global-monitor',
  'remove-notification-observers',
  'clear-panel-and-identifier',
  'remove-child-window',
  'order-out',
  'clear-content-view-controller',
  'close',
]

/** Swift L113：视口高度 = `min(内容高, 最大高)`。 */
export function recorderPopoverViewportHeight(input: {
  readonly contentHeight: number
  readonly maxHeight: number
}): number {
  return Math.min(input.contentHeight, input.maxHeight)
}

/** Swift L106-107：内容高度按**向上取整**上报。 */
export function recorderPopoverMeasuredHeight(rawHeight: number): number {
  return Math.ceil(rawHeight)
}

/** Swift L107-108：高度为 0 的上报直接忽略（布局还没完成）。 */
export function recorderPopoverAcceptsMeasuredHeight(height: number): boolean {
  return height > 0
}

/**
 * Swift L133：按钮圆角 —— 正方形就是整体二分之一（做圆），否则用组圆角。
 */
export function recorderPopoverButtonCornerRadius(input: {
  readonly width: number
  readonly height: number
  readonly groupRadius: number
}): number {
  return input.width === input.height ? input.height / 2 : input.groupRadius
}

/**
 * Swift L198：入场位移。
 *
 * `arrived || reducesMotion ? 0 : -6` —— 降低动态效果时**不做**那 6 点
 * 上浮，但仍会从 opacity 0 淡入。
 */
export function recorderPopoverSurfaceOffset(input: {
  readonly arrived: boolean
  readonly reducesMotion: boolean
}): number {
  return input.arrived || input.reducesMotion ? 0 : RECORDER_POPOVER_ARRIVAL_OFFSET
}

/** Swift L197：入场透明度。 */
export function recorderPopoverSurfaceOpacity(arrived: boolean): number {
  return arrived ? 1 : 0
}

/** Swift L244：禁用行的整体透明度。 */
export function recorderChoiceRowAlpha(enabled: boolean): number {
  return enabled ? 1 : 0.4
}

/**
 * Swift L228：标题颜色。
 *
 * `selected || !isAlternative ? ink : muted` —— 菜单式行（非备选）永远是
 * 主文字色，因为它表示一个动作而不是一个选项。
 */
export function recorderChoiceRowTone(input: {
  readonly selected: boolean
  readonly isAlternative: boolean
}): 'ink' | 'muted' {
  return input.selected || !input.isAlternative ? 'ink' : 'muted'
}

/** Swift L226：选中行用 medium 字重。 */
export function recorderChoiceRowFontWeight(selected: boolean): 'medium' | 'regular' {
  return selected ? 'medium' : 'regular'
}

/** Swift L233-235：菜单式的勾选标记 —— 透明 + 缩放 0.4 的未选中态。 */
export function recorderChoiceRowCheckmark(selected: boolean): {
  readonly opacity: number
  readonly scale: number
} {
  return { opacity: selected ? 1 : 0, scale: selected ? 1 : 0.4 }
}

/**
 * Swift L219-221：备选式的单选标记。
 *
 * 内圈 `scaleEffect(selected ? 1 : 0.01)` —— 用 0.01 而不是 0，因为
 * `scaleEffect(0)` 在某些路径上会留下一个 0 尺寸图层反而拖慢渲染。
 */
export function recorderChoiceRowRadio(selected: boolean): {
  readonly innerScale: number
  readonly innerOpacity: number
  readonly borderTone: 'ink' | 'faint'
} {
  return {
    innerScale: selected ? 1 : 0.01,
    innerOpacity: selected ? 1 : 0,
    borderTone: selected ? 'ink' : 'faint',
  }
}

/** Swift L247：无障碍值。 */
export function recorderChoiceRowAccessibilityValue(selected: boolean): string {
  return selected ? '已选择' : ''
}

/** Swift L223 / L223：标记 15×15，内圈内边距 4。 */
export const RECORDER_CHOICE_ROW_RADIO_SIZE = 15
export const RECORDER_CHOICE_ROW_RADIO_INNER_PADDING = 4
/** Swift L238：行内边距与最小高度。 */
export const RECORDER_CHOICE_ROW_HORIZONTAL_PADDING = 10
export const RECORDER_CHOICE_ROW_VERTICAL_PADDING = 7
export const RECORDER_CHOICE_ROW_MINIMUM_HEIGHT = 36
export const RECORDER_CHOICE_ROW_CORNER_RADIUS = 10
export const RECORDER_CHOICE_ROW_SPACING = 11

/** Swift L260-267：三种列表项。 */
export type RecorderActionListItemKind = 'separator' | 'info' | 'action'

export function recorderActionListItemKind(kind: string): RecorderActionListItemKind {
  if (kind === 'separator') return 'separator'
  if (kind === 'info') return 'info'
  return 'action'
}

/** Swift L261：分隔线 1 点高。 */
export const RECORDER_ACTION_LIST_SEPARATOR_HEIGHT = 1
/** Swift L256：列表项间距 2。 */
export const RECORDER_ACTION_LIST_SPACING = 2
