/**
 * 录制标记列表 —— 无边框子面板，不用 NSMenu / NSPopover 换皮。
 *
 * Swift source: Sources/DogSCApp/EditorMarkerListControl.swift（239 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorMarkerListControl                       L5-84
 *     · 入口按钮（高 30、水平内边距 8、圆角 8）              L13-23  → EDITOR_MARKER_ENTRY_*
 *     · card 头部（标题 14、计数等宽 11）                    L35-53
 *     · 空态文案                                          L54-57  → EDITOR_MARKER_EMPTY_HINT
 *     · 列表高度公式                                       L71     → editorMarkerListHeight
 *     · 底部提示                                          L75-77  → EDITOR_MARKER_FOOTER_HINT
 *     · 卡片圆角 16、描边 1、chrome 0.09                    L79-82  → EDITOR_MARKER_CARD_*
 *   - struct EditorMarkerListRow                          L86-127
 *     · 行高 41、标签/时间戳/箭头                           L95-107
 *     · 悬停擦除按钮 24×30、透明度 0.28 → 0.55              L113-122 → editorMarkerTrashAlpha
 *   - struct EditorMarkerCardAnchor                       L129-137
 *   - final class EditorMarkerCardPresenter               L140-234
 *     · toggle（面板层级 = owner + 1）                      L156-197 → editorMarkerPanelLevel
 *     · updatePlacement（宽度 304、内缩 12、间隙 8）         L199-214 → editorMarkerPanelFrame
 *     · dismiss（先摘父窗口再 orderOut）                     L216-227 → editorMarkerDismissOrder
 *   - final class EditorMarkerPanel（canBecomeKey 真）      L236-239
 *
 * 原注释（L4）：
 *   The marker list uses a borderless child panel, not an NSMenu/NSPopover skin.
 *
 * 迁移说明：`NSPanel` 子窗口 → 一个绝对定位的浮层（同一 BrowserWindow 内）。
 * 保留两处真正的算术：列表高度公式（四条 min/max 嵌套）与浮层定位
 * （宽度 304、屏幕内缩 12、与锚点的间隙 8、放下方不够就翻上方）。
 */

/** Swift L19：入口按钮高度。 */
export const EDITOR_MARKER_ENTRY_HEIGHT = 30

/** Swift L19：入口按钮水平内边距。 */
export const EDITOR_MARKER_ENTRY_HORIZONTAL_PADDING = 8

/** Swift L21：入口按钮圆角。 */
export const EDITOR_MARKER_ENTRY_CORNER_RADIUS = 8

/** Swift L81：卡片圆角 16。 */
export const EDITOR_MARKER_CARD_CORNER_RADIUS = 16

/** Swift L82：卡片描边宽度与透明度。 */
export const EDITOR_MARKER_CARD_BORDER_WIDTH = 1
export const EDITOR_MARKER_CARD_BORDER_ALPHA = 0.09

/** Swift L107：行高。 */
export const EDITOR_MARKER_ROW_HEIGHT = 41

/** Swift L60：行间距 3。 */
export const EDITOR_MARKER_ROW_SPACING = 3

/** Swift L71：列表高度公式里的四个数字。 */
export const EDITOR_MARKER_ROW_STRIDE = 44
export const EDITOR_MARKER_LIST_MINIMUM_HEIGHT = 44
export const EDITOR_MARKER_LIST_MAXIMUM_HEIGHT = 261
export const EDITOR_MARKER_LIST_CHROME_HEIGHT = 120

/** Swift L54：空态文案。 */
export const EDITOR_MARKER_EMPTY_HINT = '标记所在素材已被剪掉，恢复剪辑后可重新定位'

/** Swift L51：副标题与底部提示。 */
export const EDITOR_MARKER_SUBTITLE = '快速找回重点与重录位置'
export const EDITOR_MARKER_FOOTER_HINT = '点击定位 · 点删除图标移除'

/** Swift L116：擦除按钮尺寸与两档透明度。 */
export const EDITOR_MARKER_TRASH_WIDTH = 24
export const EDITOR_MARKER_TRASH_HEIGHT = 30
export const EDITOR_MARKER_TRASH_ALPHA_IDLE = 0.28
export const EDITOR_MARKER_TRASH_ALPHA_HOVERED = 0.55

/** Swift L203：面板宽度上限。 */
export const EDITOR_MARKER_PANEL_MAXIMUM_WIDTH = 304

/** Swift L202：屏幕可视区的内缩。 */
export const EDITOR_MARKER_PANEL_SCREEN_INSET = 12

/** Swift L211：与锚点的垂直间隙。 */
export const EDITOR_MARKER_PANEL_ANCHOR_GAP = 8

/** Swift L208：面板高度下限。 */
export const EDITOR_MARKER_PANEL_MINIMUM_HEIGHT = 100

/** Swift L164：面板标识。 */
export const EDITOR_MARKER_PANEL_IDENTIFIER = 'editor.recording-markers'

/** Swift L176：Esc 键码。 */
export const EDITOR_MARKER_ESCAPE_KEY_CODE = 53

/**
 * Swift L71：列表高度。
 *
 * `min(count * 44 − 3, max(44, min(261, maxHeight − 120)))`
 *
 * 三层嵌套的顺序不能动：
 *   - 内层 `min(261, maxHeight − 120)`：给头部/底栏留 120，且不超过 261
 *   - 中层 `max(44, …)`：至少显示一行（否则空列表会变成 0 高）
 *   - 外层 `min(count * 44 − 3, …)`：不超过内容实际需要
 *
 * `−3` 是为了让 n 行 + (n−1) 个 3 pt 间距刚好装下（`n*44 − 3` 而不是 `n*44`）。
 */
export function editorMarkerListHeight(markerCount: number, maxHeight: number): number {
  const target = Math.max(
    EDITOR_MARKER_LIST_MINIMUM_HEIGHT,
    Math.min(EDITOR_MARKER_LIST_MAXIMUM_HEIGHT, maxHeight - EDITOR_MARKER_LIST_CHROME_HEIGHT)
  )
  return Math.min(markerCount * EDITOR_MARKER_ROW_STRIDE - 3, target)
}

/** Swift L113-115：擦除按钮的透明度。 */
export function editorMarkerTrashAlpha(hovered: boolean): number {
  return hovered ? EDITOR_MARKER_TRASH_ALPHA_HOVERED : EDITOR_MARKER_TRASH_ALPHA_IDLE
}

/** Swift L162：子面板层级 = 宿主窗口层级 + 1。 */
export function editorMarkerPanelLevel(ownerLevel: number): number {
  return ownerLevel + 1
}

/** 一个屏幕矩形。 */
export interface EditorMarkerRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Swift L199-214 的输出。 */
export interface EditorMarkerPanelFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** 是否翻到锚点上方（下方放不下时）。 */
  readonly placedAbove: boolean
}

/**
 * Swift L199-214：浮层定位。
 *
 * 三个顺序相关的步骤：
 *   1. 可视区先内缩 12，宽度 `min(304, visible.width)`
 *   2. x 夹在 `[visible.minX, visible.maxX − width]`（先夹左再夹右）
 *   3. y：优先放**下方**（`anchorRect.minY − height − 8`，坐标原点在左下），
 *      放不下才翻到上方 `min(anchorRect.maxY + 8, visible.maxY − height)`
 *
 * 第 3 步的上方分支还要再夹一次 `visible.maxY − height` —— 翻上去之后若仍然
 * 顶出屏幕，就贴着上沿，而不是继续往上跑。
 */
export function editorMarkerPanelFrame(input: {
  readonly visibleFrame: EditorMarkerRect
  readonly anchorRect: EditorMarkerRect
  readonly contentHeight: number
}): EditorMarkerPanelFrame {
  const inset = EDITOR_MARKER_PANEL_SCREEN_INSET
  const visible: EditorMarkerRect = {
    x: input.visibleFrame.x + inset,
    y: input.visibleFrame.y + inset,
    width: input.visibleFrame.width - inset * 2,
    height: input.visibleFrame.height - inset * 2,
  }
  const width = Math.min(EDITOR_MARKER_PANEL_MAXIMUM_WIDTH, visible.width)
  const height = Math.min(
    Math.max(input.contentHeight, EDITOR_MARKER_PANEL_MINIMUM_HEIGHT),
    visible.height
  )
  const x = Math.min(
    Math.max(input.anchorRect.x, visible.x),
    visible.x + visible.width - width
  )
  const below = input.anchorRect.y - height - EDITOR_MARKER_PANEL_ANCHOR_GAP
  const placedAbove = below < visible.y
  const y = placedAbove
    ? Math.min(
        input.anchorRect.y + input.anchorRect.height + EDITOR_MARKER_PANEL_ANCHOR_GAP,
        visible.y + visible.height - height
      )
    : below
  return { x, y, width, height, placedAbove }
}

/**
 * Swift L216-227：关闭顺序。
 *
 * 必须**先**从父窗口摘掉子窗口，再 `orderOut` / `close`。
 * 反过来会让父窗口保留一个已关闭的子窗口引用，切回该窗口时崩溃。
 */
export const EDITOR_MARKER_DISMISS_ORDER = [
  'removeMonitors',
  'removeObservers',
  'removeChildWindow',
  'orderOut',
  'clearContentViewController',
  'close',
  'restoreFocus',
] as const

/**
 * Swift L173-184：本地事件监视器的判定。
 *
 * 四态：
 *   - Esc → `dismissRestoreFocus`（消费事件）
 *   - 点在面板内 → `passThrough`
 *   - 点在锚点按钮上 → `dismissRestoreFocus`（消费：这是「再点一次收起」）
 *   - 其它窗口 → `dismiss`（不恢复焦点，也不消费事件）
 */
export type EditorMarkerEventDecision = 'dismissRestoreFocus' | 'dismiss' | 'passThrough'

export function editorMarkerEventDecision(input: {
  readonly isKeyDown: boolean
  readonly keyCode: number
  readonly isPanelWindow: boolean
  readonly isAnchorWindow: boolean
  readonly isInsideAnchorBounds: boolean
}): EditorMarkerEventDecision {
  if (input.isKeyDown) {
    return input.keyCode === EDITOR_MARKER_ESCAPE_KEY_CODE ? 'dismissRestoreFocus' : 'passThrough'
  }
  if (input.isPanelWindow) return 'passThrough'
  if (input.isAnchorWindow && input.isInsideAnchorBounds) return 'dismissRestoreFocus'
  return 'dismiss'
}

/**
 * Swift L140-234 的呈现状态机。
 *
 * `dismiss(restoreFocus:)` 里 `if isPresented { isPresented = false }` 这一层
 * 判断是为了避免无意义的发布 —— 面板从没打开过时调 dismiss 不该触发重绘。
 */
export class EditorMarkerCardPresenter {
  private presented = false
  private panelLevelValue = 0
  private readonly onPresentedChanged: (presented: boolean) => void

  constructor(onPresentedChanged: (presented: boolean) => void = () => {}) {
    this.onPresentedChanged = onPresentedChanged
  }

  get isPresented(): boolean {
    return this.presented
  }

  get panelLevel(): number {
    return this.panelLevelValue
  }

  /** Swift L156-159：已打开 → 收起；否则要求有锚点窗口。 */
  toggle(ownerLevel: number | null): 'dismissed' | 'presented' | 'rejected' {
    if (this.presented) {
      this.dismiss(true)
      return 'dismissed'
    }
    if (ownerLevel == null) return 'rejected'
    this.panelLevelValue = editorMarkerPanelLevel(ownerLevel)
    this.presented = true
    this.onPresentedChanged(true)
    return 'presented'
  }

  /** Swift L216-227。 */
  dismiss(restoreFocus = false): boolean {
    const changed = this.presented
    this.presented = false
    this.panelLevelValue = 0
    if (changed) this.onPresentedChanged(false)
    return changed
  }

  /** Swift L229-233。 */
  detach(): void {
    this.dismiss()
  }
}
