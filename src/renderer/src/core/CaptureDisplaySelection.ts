/**
 * 显示器选择器 —— 每块屏幕一个无边框面板，取景框向内收拢。
 *
 * Swift source: Sources/DogSCApp/CaptureDisplaySelection.swift（325 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - class CaptureDisplaySelector                              L8-172
 *     · start（单屏自动选中、装键盘监听）                       L21-44  → captureDisplayShouldAutoSelect
 *     · reconcilePanels（复用已有面板 / 新建）                  L46-70  → captureDisplayReconcilePlan
 *     · refreshConnectedDisplays（目标消失必须取消）             L72-85  → captureDisplayRefreshOutcome
 *     · makePointerScreenKey（指针所在屏幕取 key）              L87-97  → CAPTURE_DISPLAY_KEY_POINTER_POLICY
 *     · stop / closeSelection（摘观察者 + 退休）                 L99-117 → CAPTURE_DISPLAY_RETIRE_ORDER
 *     · select / startSelectedDisplay / cancelSelection         L119-138 → captureDisplaySelectionGuard
 *     · installKeyMonitor（esc / ⌘R）                           L140-158 → captureDisplayKeyCommand
 *   - class DisplaySelectionPanel                               L174-236
 *     · styleMask / level / collectionBehavior / sharingType     L186-205 → CAPTURE_DISPLAY_PANEL_*
 *     · canBecomeKey = !retiring / canBecomeMain = false         L207-208 → captureDisplayCanBecomeKey
 *   - struct DisplaySelectionOverlay                            L245-324 → CAPTURE_VIEWFINDER_*
 *
 * 原注释（L38-39）：
 *   With one display there is nothing to choose between: frame it at once so
 *   the island already offers the take.
 *
 * 原注释（L76）：
 *   A removed target must never silently become the built-in display.
 *
 * 原注释（L88-90）：
 *   A selector belongs over the currently visible desktop, including another
 *   app's full-screen Space. Taking key input must not activate DogSC and move
 *   the user back to the editor's Space.
 *
 * 原注释（L242-244）：
 *   Choosing a display is framing it: a viewfinder closes in from beyond the
 *   screen's edges, and a small island at the foot names the display and starts
 *   the take. Clicking anywhere on a display also chooses it.
 *
 * 迁移说明：`NSPanel` + `NSHostingView` → Electron 的每屏 BrowserWindow。
 * 这里保留五件纯逻辑：面板复用计划、目标消失的取消判定、键盘命令路由、
 * 取景框三态几何（收起 / 未选中 / 已选中）、以及岛的三段入场。
 */

// ---------------------------------------------------------------- 面板属性

/**
 * Swift L188：样式掩码 —— `borderless` + `nonactivatingPanel`。
 *
 * `nonactivatingPanel` 是关键：点选显示器时不能激活 DogSC，否则用户会
 * 被弹回编辑器所在的 Space，看不到他正在选的那块屏。
 */
export const CAPTURE_DISPLAY_PANEL_STYLE_MASK = ['borderless', 'nonactivatingPanel'] as const

/**
 * Swift L199：`canJoinAllSpaces` + `fullScreenAuxiliary` + `canJoinAllApplications` + `ignoresCycle`。
 *
 * 四项各管一件事：出现在所有 Space、能浮在别的应用全屏之上、不跟着应用切换
 * 而隐藏、不进入 ⌘` 的窗口循环。
 */
export const CAPTURE_DISPLAY_PANEL_COLLECTION_BEHAVIOR = [
  'canJoinAllSpaces',
  'fullScreenAuxiliary',
  'canJoinAllApplications',
  'ignoresCycle',
] as const

/** Swift L200：`sharingType = .readOnly` —— 选择器本身不该被别的应用录进去。 */
export const CAPTURE_DISPLAY_PANEL_SHARING_TYPE = 'readOnly'

/** Swift L194-197：透明、无阴影、失活不隐藏（选屏时焦点可能在别处）。 */
export const CAPTURE_DISPLAY_PANEL_IS_OPAQUE = false
export const CAPTURE_DISPLAY_PANEL_HAS_SHADOW = false
export const CAPTURE_DISPLAY_PANEL_HIDES_ON_DEACTIVATE = false

/** Swift L207：退休中的面板不再接受 key。 */
export function captureDisplayCanBecomeKey(retiring: boolean): boolean {
  return !retiring
}

/** Swift L208：永远不做 main 窗口（它是覆盖层，不是文档窗）。 */
export function captureDisplayCanBecomeMain(): boolean {
  return false
}

/** Swift L52：`NSScreenNumber` 这个设备描述键。 */
export const CAPTURE_DISPLAY_SCREEN_NUMBER_KEY = 'NSScreenNumber'

// ---------------------------------------------------------------- 键盘

/** Swift L144：Esc 的键码 53。 */
export const CAPTURE_DISPLAY_ESCAPE_KEY_CODE = 53

/**
 * Swift L140-158：本地键盘监听的命令路由。
 *
 * 三条分支：
 *   - 键码 53 → `cancel`（取消整次选择）
 *   - 带 ⌘ 且字符为 `r`（忽略修饰后小写） → `start`（开始录制当前选中的屏）
 *   - 其余 → `pass`（交还给系统，不吞键）
 *
 * 用 `charactersIgnoringModifiers` 而不是 `characters`：按住 ⌘ 时
 * `characters` 在部分键盘布局下会给出别的字符（比如罗马尼亚布局的 `r` 带变音），
 * 忽略修饰后的值才是用户按下的那个物理键。
 */
export function captureDisplayKeyCommand(input: {
  readonly keyCode: number
  readonly hasCommandModifier: boolean
  readonly charactersIgnoringModifiers: string | null
}): 'cancel' | 'start' | 'pass' {
  if (input.keyCode === CAPTURE_DISPLAY_ESCAPE_KEY_CODE) return 'cancel'
  const character = (input.charactersIgnoringModifiers ?? '').toLowerCase()
  if (input.hasCommandModifier && character === 'r') return 'start'
  return 'pass'
}

/**
 * Swift L145 / L146：命令命中后返回 `nil` 表示「吞掉这个事件」。
 *
 * 不吞的话 Esc 会继续往上传，可能被别的监听者再处理一次（比如退出全屏）。
 */
export function captureDisplayCommandSwallowsEvent(command: 'cancel' | 'start' | 'pass'): boolean {
  return command !== 'pass'
}

// ---------------------------------------------------------------- 面板复用

/**
 * Swift L46-70：屏幕 → 面板的复用计划。
 *
 * 三件事：
 *   1. 找得到对应 `CaptureDisplay` 的屏幕才建面板（找不到说明这块屏不在
 *      可录列表里，可能是虚拟屏或权限未覆盖）
 *   2. 上一轮已有同 display 的面板就复用（只更新 frame），否则新建
 *   3. 上一轮剩下的面板全部退休
 *
 * 复用而不是重建，是因为重建会让取景框重新播一遍入场动画 ——
 * 用户接上一块外接屏时，已有的屏不该闪一下。
 */
export function captureDisplayReconcilePlan(input: {
  readonly screenDisplayIDs: readonly (number | null)[]
  readonly availableDisplayIDs: readonly number[]
  readonly previousPanelDisplayIDs: readonly number[]
}): {
  readonly reuse: { readonly screenIndex: number; readonly panelIndex: number }[]
  readonly create: number[]
  readonly retire: number[]
} {
  const available = new Set(input.availableDisplayIDs)
  const previous = [...input.previousPanelDisplayIDs]
  const usedPanelIndices = new Set<number>()
  const reuse: { screenIndex: number; panelIndex: number }[] = []
  const create: number[] = []

  input.screenDisplayIDs.forEach((displayID, screenIndex) => {
    if (displayID === null || !available.has(displayID)) return
    const panelIndex = previous.findIndex(
      (previousID, index) => !usedPanelIndices.has(index) && previousID === displayID
    )
    if (panelIndex >= 0) {
      usedPanelIndices.add(panelIndex)
      reuse.push({ screenIndex, panelIndex })
    } else {
      create.push(screenIndex)
    }
  })

  const retire: number[] = []
  previous.forEach((_, index) => {
    if (!usedPanelIndices.has(index)) retire.push(index)
  })
  return { reuse, create, retire }
}

/**
 * Swift L40-42：只有一块面板时直接异步选中它。
 *
 * 「异步」是必要的：`start()` 里面板刚建好，此刻它的 hosting view 还没
 * 完成首次布局，同步选中会让 `update(selected:)` 重建一个尚未挂载的视图。
 */
export function captureDisplayShouldAutoSelect(panelCount: number): boolean {
  return panelCount === 1
}

/**
 * Swift L77-82：屏幕参数变化后要不要取消整次选择。
 *
 * 两个条件任一成立就取消：可录显示器列表变空、或当前选中的那块屏消失了。
 *
 * 注释（L76）说「被移除的目标绝不能悄悄变成内置屏」——如果不取消而是
 * 回退到第一块屏，用户点「开始录制」录的会是他没选过的那块屏。
 */
export function captureDisplayRefreshOutcome(input: {
  readonly displaysEmpty: boolean
  readonly selectedStillPresent: boolean
}): 'cancel' | 'reconcile' {
  if (input.displaysEmpty) return 'cancel'
  if (!input.selectedStillPresent) return 'cancel'
  return 'reconcile'
}

/**
 * Swift L119-120 / L127-129 / L135：三个动作都要校验 token。
 *
 * 每次 `start` 会生成一个新 token，旧 token 的回调（面板迟到的事件、
 * 已取消的异步任务）必须被丢弃。少了这一道，用户快速连开两次选择器时
 * 第一次的回调会把第二次的选中状态改掉。
 */
export function captureDisplaySelectionGuard(input: {
  readonly activeTokenMatches: boolean
  readonly displayStillAvailable: boolean
}): boolean {
  return input.activeTokenMatches && input.displayStillAvailable
}

/**
 * Swift L87-97：取 key 的面板是「指针所在的那块屏」，找不到就取第一块。
 *
 * 这样键盘输入（Esc / ⌘R）落在用户正在看的那块屏上，而不是按屏幕编号
 * 排序的第一块 —— 双屏时用户常常在主屏上操作但副屏在左边（编号更小）。
 */
export function captureDisplayKeyPanelIndex(input: {
  readonly pointerInsideIndices: readonly number[]
  readonly panelCount: number
}): number | null {
  if (input.panelCount <= 0) return null
  return input.pointerInsideIndices.length > 0 ? input.pointerInsideIndices[0] : 0
}

/** Swift L94-96：取完 key 之后下一帧把所有面板的 first responder 清空。 */
export function captureDisplayClearsFirstResponderAfterKey(): boolean {
  return true
}

/**
 * Swift L99-102 / L104-117：停止时的清理顺序。
 *
 * 先置空 token（挡住在途回调）、再摘屏幕参数观察者、摘键盘监听、
 * 然后才把面板丢给退休动画。顺序反了会在退休动画期间还收到屏幕变化通知，
 * 进而在一个正在消失的面板上重排。
 */
export const CAPTURE_DISPLAY_RETIRE_ORDER = [
  'clearActiveToken',
  'removeScreenParametersObserver',
  'removeKeyMonitor',
  'prepareForRetirement',
  'retirePanels',
] as const

/** Swift L101：`preservingRetiringPanels` 为真时不立即结束退休动画。 */
export function captureDisplayFinishesTransitionImmediately(preservingRetiringPanels: boolean): boolean {
  return !preservingRetiringPanels
}

/**
 * Swift L218-224：退休面板要清掉三个回调并把 `retiring` 置真。
 *
 * 回调不清的话，动画最后一帧用户点到面板边缘仍会触发「选中」，
 * 而此时选择器已经关闭，选中的状态没人接收。
 */
export const CAPTURE_DISPLAY_RETIREMENT_STEPS = [
  'markRetiring',
  'clearOnSelect',
  'clearOnStart',
  'clearOnCancel',
  'publishRetiring',
] as const

// ---------------------------------------------------------------- 取景框

/**
 * Swift L263：取景框内缩三态。
 *
 *   - 入场前 `-80`（在屏幕边缘之外，所以看起来是「从外面收进来」）
 *   - 未选中 34、已选中 20（选中后收得更紧，像真的在对焦）
 */
export function captureViewfinderInset(input: {
  readonly shown: boolean
  readonly selected: boolean
}): number {
  if (!input.shown) return CAPTURE_VIEWFINDER_HIDDEN_INSET
  return input.selected ? CAPTURE_VIEWFINDER_SELECTED_INSET : CAPTURE_VIEWFINDER_IDLE_INSET
}

/** Swift L263：三档内缩的具体值。 */
export const CAPTURE_VIEWFINDER_HIDDEN_INSET = -80
export const CAPTURE_VIEWFINDER_IDLE_INSET = 34
export const CAPTURE_VIEWFINDER_SELECTED_INSET = 20

/** Swift L263：四角「臂」的长度 —— 选中 54、未选中 38。 */
export function captureViewfinderArm(selected: boolean): number {
  return selected ? 54 : 38
}

/** Swift L264：描边不透明度 —— 选中 1、未选中 0.62。 */
export function captureViewfinderStrokeAlpha(selected: boolean): number {
  return selected ? 1 : 0.62
}

/** Swift L265：描边宽 —— 选中 3、未选中 2。 */
export function captureViewfinderLineWidth(selected: boolean): number {
  return selected ? 3 : 2
}

/** Swift L266：投影 0.4 / 半径 8（保证白色取景框在浅色桌面上也看得见）。 */
export const CAPTURE_VIEWFINDER_SHADOW_ALPHA = 0.4
export const CAPTURE_VIEWFINDER_SHADOW_RADIUS = 8

/**
 * Swift L260：遮罩三态 —— 已选中 0.08、未选中 0.26、入场前 0。
 *
 * 未选中时压得更暗，选中后迅速变亮：这是「选中」最直接的视觉反馈，
 * 比边框加粗更明显。
 */
export function captureDisplayDimAlpha(input: {
  readonly shown: boolean
  readonly selected: boolean
}): number {
  if (!input.shown) return 0
  return input.selected ? 0.08 : 0.26
}

/** Swift L262：只有未选中时点击遮罩才会「选中」，已选中时点击不动。 */
export function captureDisplayOverlayTapSelects(selected: boolean): boolean {
  return !selected
}

/** Swift L281：退休中整层不接收点击。 */
export function captureDisplayOverlayAcceptsHitTesting(retiring: boolean): boolean {
  return !retiring
}

// ---------------------------------------------------------------- 底部岛

/** Swift L274：岛距屏幕底部 132（给取景框的臂留出空间）。 */
export const CAPTURE_DISPLAY_ISLAND_BOTTOM_PADDING = 132

/** Swift L322：岛面圆角 30。 */
export const CAPTURE_DISPLAY_ISLAND_CORNER_RADIUS = 30

/** Swift L318：岛内边距 8、行内间距 6。 */
export const CAPTURE_DISPLAY_ISLAND_PADDING = 8
export const CAPTURE_DISPLAY_ISLAND_SPACING = 6

/** Swift L293：显示器名左右内边距 24 / 18（右侧多留是为了贴近按钮）。 */
export const CAPTURE_DISPLAY_ISLAND_NAME_LEADING = 24
export const CAPTURE_DISPLAY_ISLAND_NAME_TRAILING = 18

/** Swift L287：名称 14 半粗；L289-290：规格 11 等宽数字。 */
export const CAPTURE_DISPLAY_ISLAND_NAME_FONT_SIZE = 14
export const CAPTURE_DISPLAY_ISLAND_SPEC_FONT_SIZE = 11

/** Swift L287：名称与规格的行距 2。 */
export const CAPTURE_DISPLAY_ISLAND_TEXT_SPACING = 2

/** Swift L306：录制按钮里的小白点直径 8。 */
export const CAPTURE_DISPLAY_RECORD_PIP_SIZE = 8

/**
 * Swift L271-273：岛的三段入场。
 *
 * 未入场时：不透明度 0、下移 36、模糊 8、缩到 0.94。降低动态效果时
 * 位移与缩放都归零（只有淡入）—— 位移是前庭敏感用户最不适的那一项。
 */
export function captureDisplayIslandOpacity(shown: boolean): number {
  return shown ? 1 : 0
}

export function captureDisplayIslandOffsetY(shown: boolean, reduceMotion: boolean): number {
  return shown || reduceMotion ? 0 : CAPTURE_DISPLAY_ISLAND_HIDDEN_OFFSET_Y
}

export function captureDisplayIslandBlur(shown: boolean): number {
  return shown ? 0 : CAPTURE_DISPLAY_ISLAND_HIDDEN_BLUR
}

export function captureDisplayIslandScale(shown: boolean, reduceMotion: boolean): number {
  return shown || reduceMotion ? 1 : CAPTURE_DISPLAY_ISLAND_HIDDEN_SCALE
}

/** Swift L271-273：三个未入场值。 */
export const CAPTURE_DISPLAY_ISLAND_HIDDEN_OFFSET_Y = 36
export const CAPTURE_DISPLAY_ISLAND_HIDDEN_BLUR = 8
export const CAPTURE_DISPLAY_ISLAND_HIDDEN_SCALE = 0.94

/** Swift L314：未选中用 primary、选中后换成 record（红色）。 */
export function captureDisplayPrimaryButtonKind(selected: boolean): 'primary' | 'record' {
  return selected ? 'record' : 'primary'
}

/** Swift L303 / L316：按钮文案随选中态切换。 */
export function captureDisplayActionLabel(selected: boolean): string {
  return selected ? CAPTURE_DISPLAY_START_LABEL : CAPTURE_DISPLAY_SELECT_LABEL
}

/** Swift L303 / L307：两个按钮文案。 */
export const CAPTURE_DISPLAY_SELECT_LABEL = '选择此显示器'
export const CAPTURE_DISPLAY_START_LABEL = '开始录制'
export const CAPTURE_DISPLAY_CANCEL_LABEL = '取消'

/** Swift L295 / L308：两个键位提示。 */
export const CAPTURE_DISPLAY_ESCAPE_HINT = 'esc'
export const CAPTURE_DISPLAY_START_HINT = '⌘R'

/** Swift L297：取消按钮的悬停提示。 */
export const CAPTURE_DISPLAY_CANCEL_HELP = '按 Esc 取消'

/**
 * Swift L289：规格文本 `宽 × 高 · 刷新率 Hz`。
 *
 * 用 `×`（U+00D7）而不是字母 x，等宽数字下对齐才整齐。
 */
export function captureDisplaySpecText(input: {
  readonly width: number
  readonly height: number
  readonly refreshRate: number
}): string {
  return `${input.width} × ${input.height} · ${input.refreshRate} Hz`
}

/**
 * Swift L299-301：两个按钮文字都参与尺寸计算。
 *
 * 注释说的是「选择改变动作而不撑宽外岛」：两个标签叠在同一个 ZStack 里，
 * 布局按两者的最大宽度算，所以从「选择此显示器」切到「开始录制」时
 * 岛不会先收缩再展开。
 */
export function captureDisplayButtonSizesForBothLabels(): boolean {
  return true
}

/** Swift L278-279：入场用 `RecorderMotion.morph`，选中切换用 `settle`。 */
export const CAPTURE_DISPLAY_MORPH_ANIMATION = { response: 0.42, dampingFraction: 0.86 } as const
export const CAPTURE_DISPLAY_SETTLE_ANIMATION = { response: 0.3, dampingFraction: 0.88 } as const
