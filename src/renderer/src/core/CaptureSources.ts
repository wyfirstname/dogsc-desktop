/**
 * 采集源选择器的共享材质与原生按钮交互 —— AppKit 侧的悬停抬升 / 按下回落。
 *
 * Swift source: Sources/DogSCApp/CaptureSources.swift（310 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - 五个颜色常量（accent / ink / surface / raised / platinum）    L11-21 → CAPTURE_SELECTION_*
 *   - class CaptureSelectionNativeButton                          L27-274
 *     · configureCaptureInteraction（两层 CAShapeLayer、z 1/2）    L53-77  → CAPTURE_LAYER_Z_*
 *     · updateCaptureKeyboardFocusTracking（acquire / release）    L112-120 → captureKeyboardFocusTracking
 *     · updateCaptureKeyboardFocusAppearance（四条件）             L127-135 → captureKeyboardFocusVisible
 *     · updateCaptureInteractionShape（inset / radius / path）     L150-166 → captureKeyboardFocus*
 *     · updateTrackingAreas（mouseEnteredAndExited 三项）          L172-185 → CAPTURE_TRACKING_AREA_OPTIONS
 *     · refreshCapturePointerState（五道闸 + 圆角命中）             L206-219 → capturePointerHovering
 *     · refreshSiblingPointerStates                               L221-229 → captureShouldRefreshSiblings
 *     · updateCaptureInteractionAppearance（scale / shade / 时）    L233-273 → captureButton*
 *   - struct CaptureSelectionCardSurface（圆角 24）               L276-280 → CAPTURE_SELECTION_CARD_RADIUS
 *   - struct CaptureSelectionPrimaryButtonStyle（0.8 / 12 / 0.4） L283-293 → capturePrimaryFillAlpha
 *   - struct CaptureSelectionSecondaryButtonStyle                 L295-304 → CAPTURE_SECONDARY_*
 *
 * 原注释（L9-10）：
 *   Whatever is being framed for capture is outlined in plain white: it reads on
 *   any content and leaves colour to the take itself.
 *
 * 原注释（L14-16）：
 *   AppKit-drawn capture controls match the recorder's night glass. Their cards
 *   are nearly opaque so arbitrary desktop content cannot reduce label contrast;
 *   desktop dimming is a separate overlay.
 *
 * 原注释（L23-26）：
 *   AppKit-backed capture selectors cannot use SwiftUI ButtonStyle, but they
 *   should still share the same short hover lift and pressed settle as the
 *   display/device selectors.
 *
 * 原注释（L203-205）：
 *   Moving a toolbar can move a tracking area away from a stationary pointer
 *   without delivering mouseExited. Read geometry after placement, and reconcile
 *   siblings on native input instead of retaining old events.
 *
 * 迁移说明：`NSButton` 子类 + CAShapeLayer → DOM 元素 + CSS transform。
 * 保留三件纯逻辑：三态缩放、三态遮罩、焦点环的内缩圆角与可见性判定。
 * 指针命中的「圆角矩形包含点」判定也保留 —— 直角矩形命中会让凸角区域误亮。
 */

// ---------------------------------------------------------------- 颜色

/**
 * Swift L11-12：取景边框永远是纯白。
 *
 * 注释（L9-10）说明了理由：白色在任何内容上都读得出来（深色桌面、浅色文档、
 * 彩色照片），而彩色边框会和素材自身的颜色打架 —— 用户会以为那个颜色是录进去的。
 */
export const CAPTURE_SELECTION_ACCENT_WHITE = 1

/** Swift L21：开始录制的唯一红色动作 —— RGB(1.0, 0.27, 0.23)。 */
export const CAPTURE_SELECTION_PLATINUM = { r: 1.0, g: 0.27, b: 0.23, a: 1 } as const

/** Swift L19：抬升面用 `chrome.withAlphaComponent(0.1)`。 */
export const CAPTURE_SELECTION_RAISED_ALPHA = 0.1

/**
 * Swift L14-18：卡片几乎不透明。
 *
 * 注释说的是「任意桌面内容都不能降低标签对比度」—— 所以卡片底色用基色而不是
 * 半透明玻璃；桌面压暗是另一层独立叠层，不靠卡片透明度实现。
 */
export const CAPTURE_SELECTION_CARD_OPAQUE = true

/** Swift L278：选择器卡片圆角 24。 */
export const CAPTURE_SELECTION_CARD_RADIUS = 24

// ---------------------------------------------------------------- 图层

/**
 * Swift L56-60：两个 CAShapeLayer 的层级 —— 交互遮罩 1、焦点环 2。
 *
 * 焦点环必须在遮罩之上：遮罩是 0.1 透明度的深色覆盖，如果它在上面，
 * 焦点环会被整体压暗 10%，在浅色卡片上就看不清了。
 */
export const CAPTURE_LAYER_Z_SHADE = 1
export const CAPTURE_LAYER_Z_FOCUS = 2

/** Swift L36-40：焦点环默认颜色 `chrome.opacity(0.62)`、线宽 1.5。 */
export const CAPTURE_KEYBOARD_FOCUS_ALPHA = 0.62
export const CAPTURE_KEYBOARD_FOCUS_LINE_WIDTH = 1.5

// ---------------------------------------------------------------- 三态缩放

/**
 * Swift L237-241：三态缩放 —— 按下 0.985、悬停 1.008、常态 1。
 *
 * 幅度都很小（1.5% / 0.8%），这是 macOS 控件的手感：大到 5% 会像 iOS 的
 * 「弹一下」，放在桌面工具栏里显得吵。悬停**放大**而不是提亮，因为卡片底色
 * 已经接近不透明，再提亮就看不出差异了。
 *
 * 不可用或降低动态效果时恒为 1 —— 后者是必要的：前庭功能敏感的用户会因为
 * 每次划过按钮的缩放而头晕。
 */
export function captureButtonScale(input: {
  readonly isEnabled: boolean
  readonly pressed: boolean
  readonly hovering: boolean
  readonly reduceMotion: boolean
}): number {
  if (!input.isEnabled || input.reduceMotion) return 1
  if (input.pressed) return 0.985
  return input.hovering ? 1.008 : 1
}

/**
 * Swift L243：交互遮罩的透明度 —— 按下 0.1、悬停 0.05、常态 0。
 *
 * 遮罩是深色（chrome）覆盖，所以这三个值都是「压暗」而不是「提亮」。
 * 按下比悬停深一倍，配合缩小的 1.5%，让点击有明确的落点感。
 */
export function captureButtonShadeAlpha(pressed: boolean, hovering: boolean): number {
  if (pressed) return 0.1
  return hovering ? 0.05 : 0
}

/**
 * Swift L246：动画时长 —— 按下 0.09 秒，其他（悬停/松开）0.15 秒。
 *
 * 按下要快（让用户立刻感到"按到了"），松开要慢一点（回弹得柔和）。
 */
export function captureButtonAnimationDuration(pressed: boolean): number {
  return pressed ? 0.09 : 0.15
}

/** Swift L263 / L269：动画曲线固定 easeOut。 */
export const CAPTURE_BUTTON_ANIMATION_CURVE = 'easeOut' as const

/**
 * Swift L234-236：两个交互态都要求可用。
 *
 * 不可用的按钮仍然会收到 `isHighlighted`（AppKit 在禁用时也会跟踪按下），
 * 不夹这一道会让禁用按钮按下去仍然变暗。
 */
export function captureButtonInteractionState(input: {
  readonly isEnabled: boolean
  readonly isHighlighted: boolean
  readonly isPointerInside: boolean
}): { readonly pressed: boolean; readonly hovering: boolean } {
  return {
    pressed: input.isEnabled && input.isHighlighted,
    hovering: input.isEnabled && input.isPointerInside,
  }
}

// ---------------------------------------------------------------- 焦点环

/**
 * Swift L128-129：焦点环可见的四个条件。
 *
 * `isEnabled`、`hasNativeFocus`、`window.isKeyWindow`、全局键盘导航可见性 ——
 * 四个都要成立。
 *
 * 第三条（窗口是否为 key）常被漏掉：两个采集器窗口同时存在时，非 key 的那个
 * 里如果还画着焦点环，用户会分不清焦点在哪个窗口。
 */
export function captureKeyboardFocusVisible(input: {
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
 * Swift L64-66：`@Published` 在存储值变化**之前**发出。
 *
 * 注释（L62-63）解释了为什么必须用发出的值而不是读 `shared.isVisible`：
 * 用户点击按钮时 AppKit 会先把键盘导航可见性置为 false，如果用读值的方式，
 * 这一帧读到的还是 true，焦点环会在点击后残留到下一帧。
 */
export function captureKeyboardFocusUsesEmittedValue(): boolean {
  return true
}

/**
 * Swift L157：焦点环的内缩量 = 线宽的一半。
 *
 * 描边是以路径为中心向两侧各画半个线宽，所以路径内缩 `lineWidth / 2` 之后，
 * 描边的外沿才正好贴着 bounds 内边 —— 不内缩会被 layer 边界裁掉一半。
 */
export function captureKeyboardFocusInset(lineWidth: number): number {
  const safe = Number.isFinite(lineWidth) ? Math.max(lineWidth, 0) : 0
  return safe / 2
}

/**
 * Swift L158：内缩后的圆角 `max(0, cornerRadius - inset)`。
 *
 * 必须同步减小圆角，否则内缩后的路径在四角会「顶出去」——
 * 圆角半径不变但矩形变小，角上的弧会超出外轮廓。
 */
export function captureKeyboardFocusRadius(cornerRadius: number, lineWidth: number): number {
  const radius = Number.isFinite(cornerRadius) ? cornerRadius : 0
  return Math.max(0, radius - captureKeyboardFocusInset(lineWidth))
}

/**
 * Swift L161-164：尺寸不足时干脆不画路径。
 *
 * 条件是小宽高都大于 `inset * 2`（即大于线宽）。比线宽还窄的按钮内缩后
 * 会得到一个负尺寸矩形，CGPath 在负尺寸下的行为未定义（可能画出一个翻转的框）。
 */
export function captureKeyboardFocusPathAllowed(input: {
  readonly width: number
  readonly height: number
  readonly lineWidth: number
}): boolean {
  const inset = captureKeyboardFocusInset(input.lineWidth)
  return input.width > inset * 2 && input.height > inset * 2
}

/**
 * Swift L113：只有「有窗口且可用」时才持有键盘导航的观察者。
 *
 * `acquire` / `release` 是引用计数式的：每个按钮在移出窗口或禁用时释放，
 * 全部释放后全局的离散输入观察者才停掉 —— 否则采集器隐藏后还在监听按键。
 */
export function captureKeyboardFocusTracking(input: {
  readonly hasWindow: boolean
  readonly isEnabled: boolean
}): boolean {
  return input.hasWindow && input.isEnabled
}

/** Swift L122-124：只响应自己窗口的 key 状态变化。 */
export function captureKeyboardWindowStateMatches(input: {
  readonly changedWindowIsOwn: boolean
}): boolean {
  return input.changedWindowIsOwn
}

// ---------------------------------------------------------------- 指针命中

/**
 * Swift L208-215：指针是否落在按钮的圆角矩形内。
 *
 * 五道闸：可用、不是隐藏（含祖先隐藏）、有窗口、窗口可见、窗口不忽略鼠标。
 *
 * 最后一条 `ignoresMouseEvents` 挡的是「采集器窗口在录制中变成点击穿透」这种情况：
 * 此时指针确实在按钮上方，但按钮收不到事件，显示悬停态会误导用户。
 *
 * 命中判定用**圆角**矩形而不是 bounds 矩形：圆角按钮的凸角区域在视觉上不属于按钮，
 * 那里亮起来会让人觉得判定错位。
 */
export function capturePointerHovering(input: {
  readonly isEnabled: boolean
  readonly isHiddenOrHasHiddenAncestor: boolean
  readonly hasWindow: boolean
  readonly windowIsVisible: boolean
  readonly windowIgnoresMouseEvents: boolean
  readonly pointInsideRoundedBounds: boolean
}): boolean {
  const reachable =
    input.isEnabled &&
    !input.isHiddenOrHasHiddenAncestor &&
    input.hasWindow &&
    input.windowIsVisible &&
    !input.windowIgnoresMouseEvents
  return reachable && input.pointInsideRoundedBounds
}

/**
 * Swift L216-219：状态没变就不重画。
 *
 * 这一条挡的是 `updateTrackingAreas` 的高频调用 —— 每次布局都会重建跟踪区，
 * 不比较的话每次布局都会触发一次 CALayer 事务。
 */
export function capturePointerStateChanged(previous: boolean, next: boolean): boolean {
  return previous !== next
}

/**
 * Swift L221-229：兄弟按钮一起刷新。
 *
 * 注释（L203-205）讲了根因：移动工具栏会把跟踪区从静止的指针下方挪走，
 * 而 AppKit **不会**为此发出 `mouseExited`。所以每次 `mouseEntered` / `mouseExited` /
 * `highlight` 都要让同一父视图下的所有采集按钮重算一次命中 ——
 * 只更新自己会让「指针已经在 A 上、B 还亮着」的状态残留。
 */
export function captureShouldRefreshSiblings(hasSuperview: boolean): boolean {
  return hasSuperview
}

/** Swift L179：跟踪区的三个选项。 */
export const CAPTURE_TRACKING_AREA_OPTIONS = [
  'mouseEnteredAndExited',
  'activeAlways',
  'inVisibleRect',
] as const

/**
 * `inVisibleRect` 与 `activeAlways` 的配合要点：前者让跟踪区随滚动自动对齐可见区域
 * （不必手工重算 rect），后者让窗口不在前台时也能收到进出事件 ——
 * 少任何一个，采集器在后台时悬停态就会卡住。
 */
export function captureTrackingAreaNeedsManualRect(): boolean {
  return false
}

// ---------------------------------------------------------------- 按钮样式

/** Swift L288 / L300 / L301：两套样式的圆角都是 12。 */
export const CAPTURE_BUTTON_CORNER_RADIUS = 12

/**
 * Swift L288：主按钮填充 —— 按下 0.8、常态 1。
 *
 * 主按钮是纯红实心，按下变到 0.8 相当于在红底上盖一层 20% 的底色，
 * 观感比「变亮」更符合 macOS 的按下语义。
 */
export function capturePrimaryFillAlpha(pressed: boolean): number {
  return pressed ? 0.8 : 1
}

/** Swift L289 / L301：两套样式的焦点环都是 `chrome.opacity(0.65)`。 */
export const CAPTURE_BUTTON_FOCUS_ALPHA = 0.65

/** Swift L291：主按钮禁用时整体 0.4（次要按钮不禁用）。 */
export const CAPTURE_PRIMARY_DISABLED_OPACITY = 0.4

/** Swift L287 / L298：两套样式的前景色（主按钮白字、次要按钮墨色）。 */
export const CAPTURE_PRIMARY_FOREGROUND = 'white'
export const CAPTURE_SECONDARY_FOREGROUND = 'ink'

/**
 * Swift L283-293：主按钮是「每个源选择器里唯一的红色动作」。
 *
 * 注释（L282）强调这一点的原因：源选择器上还有「取消」「刷新」等按钮，
 * 如果它们也有红色元素，「开始录制」就不再是唯一显眼的那个。
 */
export function captureSelectionHasSinglePrimaryAction(): boolean {
  return true
}
