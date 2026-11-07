/**
 * AppKeyboardFocusScrollView —— 键盘焦点滚动 + 任务切换时的滚动位置记忆。
 *
 * Swift source: Sources/DogSCApp/AppKeyboardFocusScrollView.swift（251 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L6-16    AppScrollPositionMemory<Context>（按上下文分槽）
 *   L18-21   AppScrollPosition（只有 topOffset）
 *   L25-76   AppKeyboardFocusScrollView（ScrollViewReader + 偏好值）
 *   L78-81   AppKeyboardFocusScrollRequest（target + viewportSize）
 *   L85-204  AppScrollPositionBridge / ObserverView
 *   L108     hitTest 返回 nil —— 这一层永不接收指针事件
 *   L120-127 configure(position:)
 *   L129-150 connect() —— 只观察外层 scroll view 的 clipView 与 documentView
 *   L152-156 disconnect() —— 先记住位置再摘观察者
 *   L166-174 rememberPosition()
 *   L176-202 scheduleRestore()
 *   L206-210 appKeyboardFocusScrollTarget(isFocused:)
 *   L212-229 环境键 / 偏好键
 *   L231-251 AppKeyboardFocusScrollTarget（三个开关同时成立才登记）
 *
 * 迁移说明：
 *   NSScrollView 在 Electron 里就是 `overflow: auto` 的元素。这里保留的纯逻辑：
 *     1. 位置记忆的两种刻度（flipped / 非 flipped 的 y 换算）
 *     2. 还原时对 `topOffset` 的夹取（文档变短时不能滚到空白里）
 *     3. 「滚动 → 记忆」与「焦点 → 滚动」两条路径互不干扰的四个布尔
 *     4. 焦点滚动只在「启用了本机制 + 显示键盘焦点 + 控件可用」三条同时
 *        成立时登记目标
 *     5. 降低动态效果时不播动画（但**仍然**滚动）
 */

/** Swift L66：焦点滚动的动画时长。 */
export const KEYBOARD_FOCUS_SCROLL_DURATION = 0.16

/** Swift L213：环境默认关闭 —— 只有本 ScrollView 内部才开启。 */
export const KEYBOARD_FOCUS_SCROLL_DEFAULT_ENABLED = false

/** Swift L78-81：一次焦点滚动请求的身份。 */
export interface KeyboardFocusScrollRequest {
  readonly target: string | null
  readonly viewportWidth: number
  readonly viewportHeight: number
}

/**
 * Swift L57-59：三个前置 —— 有目标、视口宽高都为正。
 *
 * 视口为 0 时滚动是无意义的（元素还没布局），且 `scrollTo` 在 0 尺寸容器里
 * 会落到错误位置。注意这里**不看**滚动偏移：焦点可能停在同一个控件上而
 * 视口变小了，那种情况恰恰需要再滚一次。
 */
export function keyboardFocusScrollRequestAccepted(
  request: KeyboardFocusScrollRequest
): boolean {
  if (request.target == null) return false
  return request.viewportWidth > 0 && request.viewportHeight > 0
}

/**
 * Swift L66：`withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16))`。
 *
 * 降低动态效果时返回 null，但**滚动本身照做** —— 返回「不滚」会让键盘用户
 * 在长列表里失去焦点位置。
 */
export function keyboardFocusScrollAnimation(
  reduceMotion: boolean
): { readonly easing: 'ease-out'; readonly duration: number } | null {
  if (reduceMotion) return null
  return { easing: 'ease-out', duration: KEYBOARD_FOCUS_SCROLL_DURATION }
}

/**
 * Swift L166-174：把当前滚动偏移记进位置对象。
 *
 * 两种刻度：
 *   flipped     → `viewport.minY − document.minY`（两者原点都在顶部）
 *   非 flipped  → `document.maxY − viewport.maxY`（原点在底部，差值才是「距顶」）
 *
 * 最后 `max(offset, 0)`：内容比视口短时上述差值为负，记成 0 才不会在
 * 切回来时还原出一个负偏移（在 macOS 上表现为整块内容被推到视口外）。
 */
export function scrollRememberedOffset(input: {
  readonly isFlipped: boolean
  readonly viewportMinY: number
  readonly viewportMaxY: number
  readonly documentMinY: number
  readonly documentMaxY: number
}): number {
  const offset = input.isFlipped
    ? input.viewportMinY - input.documentMinY
    : input.documentMaxY - input.viewportMaxY
  return Math.max(offset, 0)
}

/**
 * Swift L190-193：还原时的偏移夹取。
 *
 * `min(topOffset, max(documentHeight − clipHeight, 0))` —— 外层 `max(..., 0)`
 * 处理「文档比视口矮」（可滚距离为 0），内层 `min` 处理「文档变短了但记下的
 * 偏移还很大」。
 */
export function scrollRestoreOffset(input: {
  readonly topOffset: number
  readonly documentHeight: number
  readonly clipHeight: number
}): number {
  return Math.min(
    input.topOffset,
    Math.max(input.documentHeight - input.clipHeight, 0)
  )
}

/**
 * Swift L194-196：把偏移换算回 clipView 的 y。
 *
 * flipped 直接 `documentMinY + offset`；非 flipped 要
 * `documentMaxY − clipHeight − offset`。
 */
export function scrollRestoreY(input: {
  readonly isFlipped: boolean
  readonly documentMinY: number
  readonly documentMaxY: number
  readonly clipHeight: number
  readonly offset: number
}): number {
  return input.isFlipped
    ? input.documentMinY + input.offset
    : input.documentMaxY - input.clipHeight - input.offset
}

/**
 * Swift L176-177：还原是**一次性**的，且不允许重复排队。
 *
 * 两个布尔共同保证「一次连接只还原一次」：`needsRestore` 在真正还原后置 false，
 * `restoreIsScheduled` 防止同一轮里排两次异步任务。
 */
export function scrollRestoreCanSchedule(input: {
  readonly needsRestore: boolean
  readonly restoreIsScheduled: boolean
}): boolean {
  return input.needsRestore && !input.restoreIsScheduled
}

/** Swift L189：clip 与 document 的高度都必须为正才还原。 */
export function scrollRestoreIsReady(input: {
  readonly clipHeight: number
  readonly documentHeight: number
}): boolean {
  return input.clipHeight > 0 && input.documentHeight > 0
}

/**
 * Swift L166-168：`rememberPosition` 的四个前置。
 *
 * `!needsRestore` 排第一 —— 还没还原就先别记，否则会用「刚布局完的默认偏移」
 * 覆盖掉用户真正的记忆位置。
 */
export function scrollRememberCanRun(input: {
  readonly needsRestore: boolean
  readonly hasPosition: boolean
  readonly hasScrollView: boolean
  readonly hasDocumentView: boolean
}): boolean {
  if (input.needsRestore) return false
  return input.hasPosition && input.hasScrollView && input.hasDocumentView
}

/**
 * Swift L245：三条同时成立才把这个控件登记成焦点滚动目标。
 *
 * `isFocused && showsKeyboardFocus && isEnabled`：
 *   - `showsKeyboardFocus` 为假时（鼠标操作模式）焦点滚动不该发生 —— 否则
 *     用户点一下就整页滚一下。
 *   - `isEnabled` 为假时滚过去也没有意义（禁用控件不可聚焦）。
 */
export function keyboardFocusScrollTargetValue(input: {
  readonly isScrollEnabled: boolean
  readonly isFocused: boolean
  readonly showsKeyboardFocus: boolean
  readonly isEnabled: boolean
}): 'registered' | 'not-registered' | 'mechanism-off' {
  if (!input.isScrollEnabled) return 'mechanism-off'
  return input.isFocused && input.showsKeyboardFocus && input.isEnabled
    ? 'registered'
    : 'not-registered'
}

/**
 * Swift L226-228：`reduce` 是「后者覆盖前者」——
 * 同一层里可能有多个目标同时报偏好值，最后一个非 nil 的胜出。
 *
 * 这个方向保证「最深（最后求值）的那个焦点控件」是滚动目标，而不是
 * 最外层碰巧也处于聚焦态的那个容器。
 */
export function keyboardFocusScrollPreferenceReduce(
  current: string | null,
  next: string | null
): string | null {
  return next ?? current
}

/** Swift L108：观察层永不接收指针事件。 */
export function scrollObserverAcceptsHitTesting(): boolean {
  return false
}

/**
 * Swift L120-127：`configure(position:)` 的三步。
 *
 * 换了位置对象 → 断开旧连接、重置 `needsRestore`、再连上。
 * 如果位置没变就只是 `connect()`（幂等）。
 */
export type ScrollBridgeConfigureStep =
  | 'reconnect-and-restore'
  | 'connect-only'

export function scrollBridgeConfigureStep(input: {
  readonly samePosition: boolean
}): ScrollBridgeConfigureStep {
  return input.samePosition ? 'connect-only' : 'reconnect-and-restore'
}

/**
 * Swift L131-148：`connect()` 的两条分支。
 *
 * 外层 scroll view 变了才重新挂两个观察者：
 *   clipView 的 bounds 变化 → 记住位置
 *   documentView 的 frame 变化 → 安排还原
 *
 * 两条通知**都**在，是因为「滚轮滚动」只改 bounds、「切换任务」只改 frame；
 * 少任何一条都会让「切走再切回来位置丢了」或「滚动后位置不更新」。
 */
export function scrollBridgeNeedsReattach(input: {
  readonly currentScrollViewAttached: boolean
  readonly resolvedScrollViewChanged: boolean
}): boolean {
  if (!input.currentScrollViewAttached) return true
  return input.resolvedScrollViewChanged
}

/**
 * Swift L10-15：按上下文分槽的位置记忆。
 *
 * 每个上下文独立一个 `AppScrollPosition` 引用 —— 用引用而不是值，是因为
 * bridge 里用 `!==` 判断「换没换槽位」，值比较会让「位置刚好相同」的两个槽
 * 共用一个对象。
 */
export class AppScrollPositionMemory {
  private readonly positions = new Map<string, { topOffset: number }>()

  /** Swift L10-15：取不到就新建一个并写回（惰性建槽）。 */
  position(context: string): { topOffset: number } {
    const existing = this.positions.get(context)
    if (existing != null) return existing
    const created = { topOffset: 0 }
    this.positions.set(context, created)
    return created
  }

  get slotCount(): number {
    return this.positions.size
  }

  /** 便于断言：返回各槽的偏移快照。 */
  offsets(): Readonly<Record<string, number>> {
    const result: Record<string, number> = {}
    for (const [key, value] of this.positions) result[key] = value.topOffset
    return result
  }
}
