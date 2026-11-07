/**
 * 权限引导页 —— 首帧起就把「真实的权限页」垫在引导动画下面。
 *
 * Swift source: Sources/DogSCApp/PermissionOnboardingContent.swift（293 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - enum PermissionOnboardingStyle                            L4-12
 *     · size 640×460 / background / ink / muted / line 0.08     L5-9  → PERMISSION_ONBOARDING_*
 *     · brandInset (36, 34) / brandSize 32                      L10-11 → PERMISSION_BRAND_*
 *   - struct RequiredRecordingPermissionView                     L16-202
 *     · 品牌行（间距 9、opacity 随 isIntroAnimating 归零）       L27-34 → permissionHeaderOpacity
 *     · 标题区（26 / 14、spacing 5、上下 padding 18）            L36-43 → PERMISSION_HEADER_*
 *     · 两行权限卡（圆角 15、阴影 0.875/14/6、描边 1）           L45-70 → PERMISSION_CARD_*
 *     · 说明行（ViewThatFits 横/竖两版、间距 20 / 6）            L136-152 → PERMISSION_NOTES_*
 *     · permissionRow（行高 76、图标 40/11/0.07、按钮 92×34）    L162-201 → permissionRow*
 *     · 主按钮（高 34、圆角 10、scale 0.98）                     L76-93 → permissionAction*
 *   - struct PermissionIntroReveal（offset 16、0.62/0.86/0.07）  L207-219 → permissionIntro*
 *   - struct PermissionActionButtonStyle                         L221-247 → permissionButton*
 *   - struct PermissionDragAssistantView                         L249-285 → PERMISSION_DRAG_ASSISTANT_*
 *   - extension AppModel.permissionTourAccess                    L287-293 → permissionOnboardingTourAccess
 *
 * 原注释（L14-15）：
 *   The same live permission page sits underneath the introduction from its
 *   first frame. The animation never renders or owns a second set of controls.
 *
 * 原注释（L204-206）：
 *   Page content waits beneath the opening title, then rises in reading order
 *   as the brand docks into the header. Offsets never change the laid-out
 *   frames that the first-use tour measures.
 *
 * 原注释（L100-103）：
 *   The AppKit window uses a full-size content view. Its fixed page already
 *   reserves the titlebar in brandInset; applying that safe area again pushes
 *   the page below its frame and clips footer space.
 *
 * 迁移说明：SwiftUI View → React 组件（由 Inspector 侧组装）。这里只保留
 * 「看起来对不对」的常量与几何：固定页尺寸、内缩、卡片圆角与阴影、
 * 入场错峰淡入、按钮三种交互态的透明度阶梯，以及两行说明在横向放不下时
 * 的折行判定。
 */

// ---------------------------------------------------------------- 页面尺寸

/** Swift L5：固定页尺寸。AppKit 窗口用 full-size contentView，所以页尺寸就是窗口内容区尺寸。 */
export const PERMISSION_ONBOARDING_WIDTH = 640
export const PERMISSION_ONBOARDING_HEIGHT = 460

/** Swift L10-11：品牌行内缩 —— x 是左右页边距，y 是给标题栏预留的高度。 */
export const PERMISSION_BRAND_INSET_X = 36
export const PERMISSION_BRAND_INSET_Y = 34

/** Swift L11：应用图标边长。 */
export const PERMISSION_BRAND_SIZE = 32

/** Swift L9：分隔线透明度（`chrome.opacity(0.08)`）。 */
export const PERMISSION_LINE_ALPHA = 0.08

/** Swift L27：品牌图标与文字间距。 */
export const PERMISSION_HEADER_SPACING = 9

/** Swift L31：品牌字号 15。 */
export const PERMISSION_BRAND_FONT_SIZE = 15

/** Swift L42：标题区距品牌行的上边距。 */
export const PERMISSION_HEADER_TOP_PADDING = 18

/** Swift L36：标题与副标题间距。 */
export const PERMISSION_TITLE_SPACING = 5

/** Swift L37 / L39：标题 26、副标题 14。 */
export const PERMISSION_TITLE_FONT_SIZE = 26
export const PERMISSION_SUBTITLE_FONT_SIZE = 14

/** Swift L69：权限卡距标题区的上边距。 */
export const PERMISSION_CARD_TOP_PADDING = 22

/** Swift L53：权限卡圆角。 */
export const PERMISSION_CARD_CORNER_RADIUS = 15

/** Swift L55：卡片阴影 —— 不透明度 0.875、模糊 14、y 偏移 6。 */
export const PERMISSION_CARD_SHADOW_ALPHA = 0.875
export const PERMISSION_CARD_SHADOW_RADIUS = 14
export const PERMISSION_CARD_SHADOW_OFFSET_Y = 6

/** Swift L58-66：卡片描边宽 1（上亮下暗的线性渐变）。 */
export const PERMISSION_CARD_BORDER_WIDTH = 1

/** Swift L48：两行之间的分隔线高 0.5，左右各缩 18。 */
export const PERMISSION_SEPARATOR_HEIGHT = 0.5
export const PERMISSION_SEPARATOR_INSET = 18

/** Swift L72：说明区距卡片的下边距。 */
export const PERMISSION_NOTES_TOP_PADDING = 20

/** Swift L95-97：页面左内边距用 brandInset.x，上内边距用 brandInset.y，下内边距 28。 */
export const PERMISSION_PAGE_BOTTOM_PADDING = 28

/** Swift L75：页脚之前的弹性空间下限 —— 保证主按钮不会贴住说明行。 */
export const PERMISSION_FOOTER_SPACER_MIN = 18

// ---------------------------------------------------------------- 权限行

/** Swift L198：单行高度。 */
export const PERMISSION_ROW_HEIGHT = 76

/** Swift L164：行内三块（图标 / 文本 / 动作）的间距。 */
export const PERMISSION_ROW_SPACING = 14

/** Swift L198：行左右内边距。 */
export const PERMISSION_ROW_HORIZONTAL_PADDING = 18

/** Swift L166-169：图标 40 见方、圆角 11、底色 `chrome.opacity(0.07)`。 */
export const PERMISSION_ROW_ICON_SIZE = 40
export const PERMISSION_ROW_ICON_CORNER_RADIUS = 11
export const PERMISSION_ROW_ICON_ALPHA = 0.07

/** Swift L170：标题与用途说明的间距。 */
export const PERMISSION_ROW_TEXT_SPACING = 5

/** Swift L171 / L173：行内标题 14、用途 12。 */
export const PERMISSION_ROW_TITLE_FONT_SIZE = 14
export const PERMISSION_ROW_PURPOSE_FONT_SIZE = 12

/** Swift L176：文本块与动作按钮之间的最小间距。 */
export const PERMISSION_ROW_ACTION_SPACER_MIN = 12

/** Swift L181 / L191：动作区（已授权标签 / 打开设置按钮）固定 92×34。 */
export const PERMISSION_ROW_ACTION_WIDTH = 92
export const PERMISSION_ROW_ACTION_HEIGHT = 34

/** Swift L182：授权成功时标签从 0.86 缩放淡入。 */
export const PERMISSION_GRANTED_SCALE = 0.86

/** Swift L199：授权状态变化用 `SpringMotion.fluid`。 */
export const PERMISSION_ROW_ANIMATION = { response: 0.4, dampingFraction: 0.86 } as const

// ---------------------------------------------------------------- 主按钮

/** Swift L87：主按钮高 34（与权限行的动作区等高，视觉上对齐）。 */
export const PERMISSION_ACTION_HEIGHT = 34

/** Swift L233 / L236：按钮圆角 10。 */
export const PERMISSION_ACTION_CORNER_RADIUS = 10

/** Swift L82：主按钮内「文字 + 箭头」的间距。 */
export const PERMISSION_ACTION_SPACING = 8

/** Swift L86：主按钮字号 13。 */
export const PERMISSION_ACTION_FONT_SIZE = 13

/** Swift L83：复审模式下的按钮文案；否则是「进入 DogSC」。 */
export const PERMISSION_ACTION_TITLE_REVIEW = '完成'
export const PERMISSION_ACTION_TITLE_ENTRY = '进入 DogSC'

// ---------------------------------------------------------------- 入场错峰

/** Swift L215：未展开时向下偏移 16 —— 位移不改变布局帧，所以引导测量的位置仍然有效。 */
export const PERMISSION_INTRO_OFFSET_Y = 16

/** Swift L216-217：`spring(response: 0.62, dampingFraction: 0.86)`，每级延迟 0.07 秒。 */
export const PERMISSION_INTRO_RESPONSE = 0.62
export const PERMISSION_INTRO_DAMPING = 0.86
export const PERMISSION_INTRO_DELAY_PER_ORDER = 0.07

/**
 * Swift L214-215：是否已展开。
 *
 * Swift 是 `.opacity(isShown ? 1 : 0)` + `.offset(y: isShown ? 0 : 16)`，
 * 两个值都由同一个 `isShown` 驱动，所以这里合成一个判定。
 */
export function permissionIntroIsShown(introStageReachedSettling: boolean): boolean {
  return introStageReachedSettling
}

/** Swift L214：展开后的不透明度。 */
export function permissionIntroOpacity(shown: boolean): number {
  return shown ? 1 : 0
}

/** Swift L215：展开后的 y 偏移 —— 未展开时下移 16。 */
export function permissionIntroOffsetY(shown: boolean): number {
  return shown ? 0 : PERMISSION_INTRO_OFFSET_Y
}

/**
 * Swift L217：第 `order` 级的延迟。
 *
 * 顺序号从 0 开始（标题 0、卡片 1、说明 2、主按钮 3），所以第 4 个元素延迟
 * 0.21 秒 —— 整串入场在 0.62 + 0.21 ≈ 0.83 秒内读完，比一次性淡入更有引导感。
 */
export function permissionIntroDelay(order: number): number {
  const safe = Number.isFinite(order) ? Math.max(order, 0) : 0
  return safe * PERMISSION_INTRO_DELAY_PER_ORDER
}

/**
 * Swift L216-217：是否挂动画。
 *
 * `animates` 是 `presentation.animatesIntro`。Swift 写成 `animates ? .spring(...) : nil`，
 * `nil` 在 SwiftUI 里表示「不插值，直接到终态」。
 */
export function permissionIntroAnimates(animates: boolean): boolean {
  return animates
}

/** Swift L34：品牌行在入场动画期间完全透明（它由动画本身接管位置）。 */
export function permissionHeaderOpacity(isIntroAnimating: boolean): number {
  return isIntroAnimating ? 0 : 1
}

/**
 * Swift L99：入场动画期间整页不接收点击。
 *
 * 这一条不能省：动画中途点「打开设置」会让 AppKit 在窗口还在变形时抢焦点，
 * 结果是设置面板打开、引导页却没退出。
 */
export function permissionPageAcceptsHitTesting(isIntroAnimating: boolean): boolean {
  return !isIntroAnimating
}

// ---------------------------------------------------------------- 按钮交互态

/**
 * Swift L231：主按钮填充不透明度 —— 按下 0.82、悬停 1.0、常态 0.94。
 *
 * 注意常态是 0.94 而不是 1：主色是纯红，压到 0.94 之后在白底上不会「跳」出来，
 * 悬停才提到满值。按下反而降透明度是 macOS 的习惯（按下去像被压暗）。
 */
export function permissionPrimaryFillAlpha(pressed: boolean, hovered: boolean): number {
  if (pressed) return 0.82
  return hovered ? 1.0 : 0.94
}

/** Swift L232：次要按钮填充 —— 按下 0.16、悬停 0.14、常态 0.08。 */
export function permissionSecondaryFillAlpha(pressed: boolean, hovered: boolean): number {
  if (pressed) return 0.16
  return hovered ? 0.14 : 0.08
}

/** Swift L237-238：焦点描边颜色（主按钮在非焦点态不描边，靠填充区分）。 */
export function permissionFocusStrokeAlpha(focused: boolean, primary: boolean): number {
  if (focused) return 0.6
  return primary ? 0 : 0.12
}

/** Swift L238：焦点时 1.5，否则 0.75 —— 焦点环要比普通描边粗一倍才看得出来。 */
export function permissionFocusLineWidth(focused: boolean): number {
  return focused ? 1.5 : 0.75
}

/** Swift L240：按下时收掉投影（`opacity(isPressed ? 0 : 0.2)`）。 */
export function permissionPressShadowAlpha(pressed: boolean): number {
  return pressed ? 0 : 0.2
}

/** Swift L240：投影半径 3、y 偏移 1。 */
export const PERMISSION_PRESS_SHADOW_RADIUS = 3
export const PERMISSION_PRESS_SHADOW_OFFSET_Y = 1

/** Swift L241：按下缩到 0.98（降低动态效果时不动）。 */
export function permissionPressScale(pressed: boolean, reduceMotion: boolean): number {
  return pressed && !reduceMotion ? 0.98 : 1
}

/** Swift L244-245：悬停 0.14 秒、按下 0.12 秒。 */
export const PERMISSION_HOVER_DURATION = 0.14
export const PERMISSION_PRESS_DURATION = 0.12

// ---------------------------------------------------------------- 文案

/** Swift L155 / L159：两条页脚说明。 */
export const PERMISSION_NOTE_LABELS = ['返回后自动检查', '摄像头和麦克风在启用时再授权'] as const

/** Swift L155 / L159：两条说明的 SF Symbol 名。 */
export const PERMISSION_NOTE_SYMBOLS = ['checkmark.circle', 'video'] as const

/** Swift L138：横向排列时两条说明的间距。 */
export const PERMISSION_NOTES_HORIZONTAL_SPACING = 20

/** Swift L143：折成竖排时的行距。 */
export const PERMISSION_NOTES_VERTICAL_SPACING = 6

/** Swift L149：说明文字字号 12。 */
export const PERMISSION_NOTES_FONT_SIZE = 12

/** Swift L178 / L190：两个动作标签。 */
export const PERMISSION_GRANTED_LABEL = '已授权'
export const PERMISSION_OPEN_SETTINGS_LABEL = '打开设置'

/** Swift L263：拖拽助手标题。 */
export const PERMISSION_DRAG_ASSISTANT_TITLE = '找不到 DogSC？'

/**
 * Swift L83：主按钮文案。
 *
 * `isReview` 为真时是「完成」（从设置里回来复审），否则是「进入 DogSC」
 * （首次引导的最后一步）。
 */
export function permissionActionTitle(isReview: boolean): string {
  return isReview ? PERMISSION_ACTION_TITLE_REVIEW : PERMISSION_ACTION_TITLE_ENTRY
}

/**
 * Swift L195：动作按钮的无障碍标签。
 *
 * 只有「打开设置」有自定义标签，「已授权」直接用 Label 自身的文字。
 */
export function permissionOpenSettingsAccessibilityLabel(title: string): string {
  return `打开${title}设置`
}

/** Swift L45：居中按钮的无障碍标签（`居中%@`）。 */
export function permissionCenterAccessibilityLabel(title: string): string {
  return `居中${title}`
}

/**
 * Swift L265：拖拽助手说明文字。
 *
 * 原文用 `String(format:)` 把权限对应的设置列表名插进「把图标拖入“%@”列表，再打开开关。」
 * 列表名随权限不同（录屏是「屏幕录制」、辅助功能是「辅助功能」）。
 */
export function permissionDragAssistantMessage(listName: string): string {
  return `把图标拖入“${listName}”列表，再打开开关。`
}

// ---------------------------------------------------------------- 引导目标

/**
 * Swift L47 / L50 / L91：三个首用引导锚点。
 *
 * `permission.screen` 与 `permission.pointer` 的高亮圆角是 15 且只圆上半/下半 ——
 * 两行拼起来才是一个完整的圆角卡片，各自圆全部四角会在中间出现缝。
 */
export const PERMISSION_TOUR_TARGET_SCREEN = 'permission.screen'
export const PERMISSION_TOUR_TARGET_POINTER = 'permission.pointer'
export const PERMISSION_TOUR_TARGET_FINISH = 'permission.finish'

/** Swift L47 / L50：两行的高亮圆角与生效边。 */
export const PERMISSION_ROW_TOUR_RADIUS = 15
export const PERMISSION_FINISH_TOUR_RADIUS = 10

// ---------------------------------------------------------------- 轮询

/**
 * Swift L125：权限轮询间隔 1 秒。
 *
 * 用 `Task.sleep` 而不是 Timer：`Task` 随视图生命周期取消，用户关掉窗口后
 * 不会留下一个一直在查权限的循环。
 */
export const PERMISSION_POLL_INTERVAL_SECONDS = 1

/**
 * Swift L113-128：轮询在什么阶段继续。
 *
 * 三条分支：`.setup` 阶段主动校验（这是从系统设置返回的路径）、复审模式只刷新
 * 不做校验、其他阶段直接退出循环。注释（L122-124）强调：校验可以更新可见状态，
 * 但**绝不能**在「系统设置持有焦点」时激活录制器 —— 交接权属于就绪页的 Continue。
 */
export function permissionPollingContinues(input: {
  readonly phaseIsSetup: boolean
  readonly isReview: boolean
}): boolean {
  return input.phaseIsSetup || input.isReview
}

/**
 * Swift L117-121：这一轮该做什么。
 *
 * `verify` 会真的去问系统；`refresh` 只读缓存（复审时系统设置可能刚被关掉，
 * 此时再弹一次授权请求会重复打扰）。`stop` 表示退出循环。
 */
export function permissionPollingAction(input: {
  readonly phaseIsSetup: boolean
  readonly isReview: boolean
}): 'verify' | 'refresh' | 'stop' {
  if (input.phaseIsSetup) return 'verify'
  if (input.isReview) return 'refresh'
  return 'stop'
}

// ---------------------------------------------------------------- 拖拽助手

/**
 * Swift L257-272：图标 72 见方、卡片高 116、圆角 18、左右内边距 22。
 *
 * 卡片比图标高 44：这是留给两行文字（15 + 13 + 7 行距）的呼吸空间。
 */
export const PERMISSION_DRAG_ICON_SIZE = 72
export const PERMISSION_DRAG_CARD_HEIGHT = 116
export const PERMISSION_DRAG_CARD_CORNER_RADIUS = 18
export const PERMISSION_DRAG_CARD_PADDING = 22
export const PERMISSION_DRAG_SPACING = 18

/** Swift L259：图标底板悬停 0.14、常态 0.07。 */
export function permissionDragIconAlpha(hovered: boolean): number {
  return hovered ? 0.14 : 0.07
}

/** Swift L259：图标底板圆角 15。 */
export const PERMISSION_DRAG_ICON_CORNER_RADIUS = 15

/** Swift L260 / L282：图标投影 6/3、卡片投影 10/4。 */
export const PERMISSION_DRAG_ICON_SHADOW_RADIUS = 6
export const PERMISSION_DRAG_ICON_SHADOW_OFFSET_Y = 3
export const PERMISSION_DRAG_CARD_SHADOW_RADIUS = 10
export const PERMISSION_DRAG_CARD_SHADOW_OFFSET_Y = 4

/** Swift L279：卡片描边 `chrome.opacity(0.12)`、宽 1。 */
export const PERMISSION_DRAG_CARD_BORDER_ALPHA = 0.12
export const PERMISSION_DRAG_CARD_BORDER_WIDTH = 1

/** Swift L262：标题与说明的间距。 */
export const PERMISSION_DRAG_TEXT_SPACING = 7

/** Swift L263 / L266：标题 15、说明 13。 */
export const PERMISSION_DRAG_TITLE_FONT_SIZE = 15
export const PERMISSION_DRAG_MESSAGE_FONT_SIZE = 13

// ---------------------------------------------------------------- 引导访问态

/**
 * Swift L289-292：把两个布尔权限折成引导流程的访问态。
 *
 * 注意传入的第一个字段名是 `hasScreenRecordingPermissionForOnboarding` ——
 * 它和运行期的 `hasScreenRecordingPermission` **不是**同一个判定：引导页要区分
 * 「系统已授权但应用还没重启」这种情况，所以用的是另一个会检查进程首次授权时间的值。
 */
export function permissionOnboardingTourAccess(input: {
  readonly screenRecordingPermissionForOnboarding: boolean
  readonly accessibilityPermission: boolean
}): { readonly screen: boolean; readonly accessibility: boolean } {
  return {
    screen: input.screenRecordingPermissionForOnboarding,
    accessibility: input.accessibilityPermission,
  }
}

/**
 * Swift L76：主按钮只在两个权限都拿到后才出现。
 *
 * 不是「禁用」而是「不存在」：引导页上不该出现一个按不动的按钮，
 * 用户会一直点它而不是去开权限。
 */
export function permissionEntryButtonVisible(hasRequiredPermissions: boolean): boolean {
  return hasRequiredPermissions
}

/** Swift L109：整页的无障碍标识。 */
export const PERMISSION_ACCESSIBILITY_IDENTIFIER = 'permission.gate'

/**
 * Swift L48 / L53：两行卡片拼合后的视觉边界。
 *
 * 分隔线要在两行中间，所以它占的变化量是 0.5 而不是 0 —— 两行高度之和加 0.5
 * 才是卡片的真实高度，取整会让底边少半个像素。
 */
export function permissionCardHeight(rowHeight: number, rowCount: number): number {
  const rows = Math.max(Math.trunc(Number.isFinite(rowCount) ? rowCount : 0), 0)
  if (rows === 0) return 0
  const separators = Math.max(rows - 1, 0) * PERMISSION_SEPARATOR_HEIGHT
  return rows * rowHeight + separators
}
