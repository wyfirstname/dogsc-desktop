/**
 * 编辑器动作菜单 —— 应用自绘的可读卡片；弹出位置、焦点与外部点击仍由宿主负责。
 *
 * Swift source: Sources/DogSCApp/EditorActionMenu.swift（159 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorActionMenu                         L5-125
 *   - body（按钮 + 焦点 + popover）                    L11-19  → EDITOR_ACTION_MENU_BUTTON_RADIUS
 *   - popover 内容（标题 / 分隔 / 信息 / 动作）          L20-88  → EDITOR_ACTION_MENU_LAYOUT / editorActionRowMinHeight
 *   - performAction(_:)                              L90-93  → editorActionMenuPerformPlan
 *   - menuWidth                                      L95-113 → editorActionMenuWidth
 *   - menuContentHeight                              L115-123 → editorActionMenuContentHeight
 *   - struct EditorActionRowStyle                    L127-159 → editorActionRowForeground / …Fill / …Border
 *   - Row（hover / pressed / selected）               L132-158 → editorActionRowOffset / …Scale
 *
 * 原注释（L3-4）：
 *   The editor uses its own readable action cards; AppKit still owns popover
 *   placement, focus and outside-click dismissal.
 *
 * 迁移说明：`ButtonStyle` / `@State hovered` 在 React 侧由 `<ActionRow>` +
 * CSS 与 `onPointerEnter` 承担。宽度公式依赖字体量宽（`AppTypography.regularTextWidth`
 * 尚未迁移），因此这里把 `measure` 作为参数注入 —— 与快捷键面板同一做法。
 */

import type { AppLineIconKind } from './EditorSymbol'

/** Swift L95-97 等的取值来源：`RecorderMenuItem.kind`。 */
export type RecorderMenuItemKind = 'separator' | 'info' | 'action'

export interface RecorderMenuItem {
  readonly kind: RecorderMenuItemKind
  readonly title: string
  readonly detail?: string | null
  readonly systemImage?: string | null
  readonly isOn?: boolean
  readonly isEnabled?: boolean
}

/** Swift L112：`min(360, max(270, ceil(contentWidth) + 2))`。 */
export const EDITOR_ACTION_MENU_MIN_WIDTH = 270
export const EDITOR_ACTION_MENU_MAX_WIDTH = 360
/** Swift L87 的 `+ 2`：给圆角描边留的余量。 */
export const EDITOR_ACTION_MENU_WIDTH_SLACK = 2

/** Swift L122：内容区最高 360。 */
export const EDITOR_ACTION_MENU_MAX_CONTENT_HEIGHT = 360

/** Swift L101 / L105：信息行与详情行的量宽字号。 */
export const EDITOR_ACTION_MENU_INFO_FONT_SIZE = 12
export const EDITOR_ACTION_MENU_TITLE_FONT_SIZE = 13

/** Swift L101：信息行 `+ 36`（左右各 10 内边距 + 余量）。 */
export const EDITOR_ACTION_MENU_INFO_SLACK = 36

/** Swift L109：动作行 `+ 88`（左侧内边距、尾部对勾、间距）。 */
export const EDITOR_ACTION_MENU_ACTION_SLACK = 88

/** Swift L109：有图标时再预留的 22pt 列 + 间距。 */
export const EDITOR_ACTION_MENU_ICON_COLUMN = 34

/** Swift L118-120：分隔行 15、信息行 40、动作行 40/56。 */
export const EDITOR_ACTION_MENU_ROW_HEIGHTS = {
  separator: 15,
  info: 40,
  actionCompact: 40,
  actionWithDetail: 56,
} as const

/** Swift L33：分隔行的实际绘制高度（比计高小，留出视觉呼吸）。 */
export const EDITOR_ACTION_MENU_SEPARATOR_HEIGHT = 6

/** Swift L20 / L29：行间距与卡片内边距。 */
export const EDITOR_ACTION_MENU_LAYOUT = {
  outerSpacing: 4,
  rowSpacing: 4,
  cardPadding: 8,
  headerHorizontalPadding: 12,
  headerTopPadding: 6,
  headerBottomPadding: 4,
  headerTracking: 0.5,
  rowHorizontalPadding: 12,
  iconTileSize: 30,
  iconGlyphSize: 15,
  rowTitleSize: 13,
  rowDetailSize: 12,
  rowTitleDetailSpacing: 3,
  checkmarkSize: 15.5,
  infoPadding: 10,
  /** L41 / L57：图标列与标题之间的间距、尾部留白。 */
  iconGap: 12,
  trailingMinimumGap: 12,
  /** L45 / L64：图标瓦片底色与最小行高计算依据。 */
  iconTileChrome: 0.06,
  minHeightCompact: 36,
  minHeightWithDetail: 52,
} as const

/** Swift L14：`Capsule(style: .continuous)` —— 按钮本身是胶囊形焦点环。 */
export const EDITOR_ACTION_MENU_BUTTON_RADIUS = 'capsule'

/** 量宽注入点：`(text, size) => px`。 */
export type TextMeasure = (text: string, size: number) => number

/**
 * Swift L95-113。
 *
 *   separator → 0
 *   info      → regularTextWidth(title, 12) + 36
 *   action    → max(regularTextWidth(title, 13), regularTextWidth(detail, 12))
 *               + 88 + (systemImage == nil ? 0 : 34)
 *   取 max，再 min(360, max(270, ceil(max) + 2))
 *
 * 分隔行贡献 0 而不是参与取 max —— 否则一个只有分隔行的菜单会得到宽度 2。
 */
export function editorActionMenuWidth(
  items: readonly RecorderMenuItem[],
  measure: TextMeasure
): number {
  let contentWidth = 0
  for (const item of items) {
    let width = 0
    switch (item.kind) {
      case 'separator':
        width = 0
        break
      case 'info':
        width = measure(item.title, EDITOR_ACTION_MENU_INFO_FONT_SIZE) + EDITOR_ACTION_MENU_INFO_SLACK
        break
      case 'action': {
        const titleWidth = measure(item.title, EDITOR_ACTION_MENU_TITLE_FONT_SIZE)
        const detailWidth =
          item.detail === undefined || item.detail === null
            ? 0
            : measure(item.detail, EDITOR_ACTION_MENU_INFO_FONT_SIZE)
        width =
          Math.max(titleWidth, detailWidth) +
          EDITOR_ACTION_MENU_ACTION_SLACK +
          (item.systemImage === undefined || item.systemImage === null
            ? 0
            : EDITOR_ACTION_MENU_ICON_COLUMN)
        break
      }
    }
    if (width > contentWidth) contentWidth = width
  }
  return Math.min(
    EDITOR_ACTION_MENU_MAX_WIDTH,
    Math.max(EDITOR_ACTION_MENU_MIN_WIDTH, Math.ceil(contentWidth) + EDITOR_ACTION_MENU_WIDTH_SLACK)
  )
}

/**
 * Swift L115-123：计高后夹到 360。
 * 夹的是**内容区**高度，卡片本身还有 8pt 内边距，所以最坏情况菜单比 360 略高。
 */
export function editorActionMenuContentHeight(items: readonly RecorderMenuItem[]): number {
  let total = 0
  for (const item of items) {
    switch (item.kind) {
      case 'separator':
        total += EDITOR_ACTION_MENU_ROW_HEIGHTS.separator
        break
      case 'info':
        total += EDITOR_ACTION_MENU_ROW_HEIGHTS.info
        break
      case 'action':
        total +=
          item.detail === undefined || item.detail === null
            ? EDITOR_ACTION_MENU_ROW_HEIGHTS.actionCompact
            : EDITOR_ACTION_MENU_ROW_HEIGHTS.actionWithDetail
        break
    }
  }
  return Math.min(total, EDITOR_ACTION_MENU_MAX_CONTENT_HEIGHT)
}

/** Swift L64：`frame(minHeight: item.detail == nil ? 36 : 52)`。 */
export function editorActionRowMinHeight(item: RecorderMenuItem): number {
  return item.detail === undefined || item.detail === null
    ? EDITOR_ACTION_MENU_LAYOUT.minHeightCompact
    : EDITOR_ACTION_MENU_LAYOUT.minHeightWithDetail
}

/** Swift L63：图标瓦片只在有 `systemImage` 时出现。 */
export function editorActionRowShowsIcon(item: RecorderMenuItem): boolean {
  return item.systemImage !== undefined && item.systemImage !== null
}

/** Swift L61：对勾的透明度就是选中态本身（占位常驻，避免行内元素跳动）。 */
export function editorActionRowCheckmarkOpacity(isOn: boolean): number {
  return isOn ? 1 : 0
}

/** Swift L140：`EditorTheme.chrome(isEnabled ? (lit ? 0.96 : 0.86) : 0.32)`。 */
export function editorActionRowForeground(input: {
  readonly isEnabled: boolean
  readonly hovered: boolean
}): number {
  if (!input.isEnabled) return 0.32
  return input.hovered ? 0.96 : 0.86
}

/** Swift L138：`lit = isEnabled && hovered`。 */
export function editorActionRowIsLit(input: {
  readonly isEnabled: boolean
  readonly hovered: boolean
}): boolean {
  return input.isEnabled && input.hovered
}

/** 底色来源。`pressed` / `hover` 的具体不透明度定义在 EditorStateWash（尚未迁移）。 */
export type EditorActionRowFill =
  | { readonly kind: 'pressed' }
  | { readonly kind: 'hover' }
  | { readonly kind: 'selected'; readonly opacity: number }
  | { readonly kind: 'none' }

/** Swift L145：`EditorTheme.chrome(isEnabled && isPressed ? pressed : lit ? hover : selected ? 0.045 : 0)`。 */
export const EDITOR_ACTION_ROW_SELECTED_FILL = 0.045

export function editorActionRowFill(input: {
  readonly isEnabled: boolean
  readonly isPressed: boolean
  readonly hovered: boolean
  readonly selected: boolean
}): EditorActionRowFill {
  if (input.isEnabled && input.isPressed) return { kind: 'pressed' }
  if (editorActionRowIsLit(input)) return { kind: 'hover' }
  if (input.selected) return { kind: 'selected', opacity: EDITOR_ACTION_ROW_SELECTED_FILL }
  return { kind: 'none' }
}

/** Swift L148：`strokeBorder(EditorTheme.chrome(lit ? 0.06 : 0), lineWidth: 0.5)`。 */
export function editorActionRowBorderOpacity(lit: boolean): number {
  return lit ? 0.06 : 0
}

/** Swift L148：描边宽度是固定的 0.5，不随状态变。 */
export const EDITOR_ACTION_ROW_BORDER_WIDTH = 0.5

/** Swift L141：`offset(x: lit && !RecorderMotion.reduces ? 2 : 0)`。 */
export function editorActionRowOffset(input: {
  readonly isEnabled: boolean
  readonly hovered: boolean
  readonly reducesMotion: boolean
}): number {
  return editorActionRowIsLit(input) && !input.reducesMotion ? 2 : 0
}

/** Swift L153：按下时 0.985（降低动态效果则不动）。 */
export function editorActionRowScale(input: {
  readonly isEnabled: boolean
  readonly isPressed: boolean
  readonly reducesMotion: boolean
}): number {
  return input.isEnabled && input.isPressed && !input.reducesMotion ? 0.985 : 1
}

/** Swift L72-79：Return 键执行动作，但带任何修饰键都不算。 */
export function editorActionMenuReturnKeyAction(input: {
  readonly isEnabled: boolean
  readonly modifiers: readonly string[]
}): 'perform' | 'ignored' {
  if (!input.isEnabled) return 'ignored'
  if (input.modifiers.length > 0) return 'ignored'
  return 'perform'
}

/** Swift L90-93：先收菜单再执行 —— 反过来的话动作里若报错，弹窗会盖住提示。 */
export function editorActionMenuPerformPlan(): { readonly dismissFirst: true } {
  return { dismissFirst: true }
}

/**
 * Swift L42-46：动作行的图标来自 `EditorSymbol` 目录（15pt 字号）。
 * 这里只标注类型，实际绘制在 React 组件里。
 */
export type EditorActionMenuGlyph = AppLineIconKind

/** Swift L77：`accessibilityAddTraits(item.isOn ? .isSelected : [])` 的映射。 */
export function editorActionRowAccessibilityTraits(isOn: boolean): readonly string[] {
  return isOn ? ['selected'] : []
}

/** Swift L71：悬停提示优先用 detail，没有才用标题。 */
export function editorActionRowHelpText(item: RecorderMenuItem): string {
  return item.detail === undefined || item.detail === null ? item.title : item.detail
}
