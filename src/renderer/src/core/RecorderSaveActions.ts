/**
 * 录制保存面板的行样式 —— Swift RecorderSaveActions.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/RecorderSaveActions.swift（62 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - RecorderSaveActionRow 几何（36 高 / 图标 18 / 间距 10 / 左右 8）  L16-28
 *   - 按下缩放 0.98 + easeOut 0.13                                      L29-30
 *   - 视觉层关闭命中与无障碍，整行由 RecorderActionTrigger 承担           L31-33
 *   - 禁用时整体 0.4 透明度                                             L36
 *   - RecorderSaveToggleRow（34 高 / switch / mint 着色）                L47-61
 *
 * 原注释：与录制工具栏共用同一个「全宽原生首点目标」—— 标签与图标只负责好看，
 * 整行只有一个真正的点击目标。这样做是为了让第一次点击**一定**落在这一行上，
 * 而不是被文字或图标截胡（macOS 上首点常被吞掉，原生控件才能既保住首点又保住无障碍语义）。
 *
 * 迁移说明：React 侧不需要 AppKit 的首点魔法，但行高与「禁用 0.4」这两条必须一致 ——
 * 保存面板里相邻行的高度差 2pt 会让人一眼看出错位。
 */

export const SAVE_ACTION_ROW_HEIGHT = 36
export const SAVE_ACTION_ROW_HORIZONTAL_PADDING = 8
export const SAVE_ACTION_ROW_SPACING = 10
export const SAVE_ACTION_ICON_WIDTH = 18
export const SAVE_ACTION_ICON_SIZE = 13
export const SAVE_ACTION_TITLE_SIZE = 13
export const SAVE_ACTION_DETAIL_SIZE = 11
export const SAVE_ACTION_CHEVRON_SIZE = 9
export const SAVE_ACTION_PRESSED_SCALE = 0.98
export const SAVE_ACTION_PRESS_ANIMATION_DURATION = 0.13
export const SAVE_ACTION_DISABLED_OPACITY = 0.4
export const SAVE_ACTION_CORNER_RADIUS = 9
export const SAVE_ACTION_HIGHLIGHT_OPACITY = 0.05

export const SAVE_TOGGLE_ROW_HEIGHT = 34

export interface SaveActionRowInput {
  readonly title: string
  readonly symbol: string
  readonly detail: string | null
  readonly enabled: boolean
  readonly showsChevron: boolean
  readonly pressed: boolean
}

export type SaveActionTrailing = 'detail' | 'chevron' | 'none'

/**
 * Swift L21-25 的三分支：**detail 优先于 chevron** —— 有说明文案时不再画箭头，
 * 否则右侧会同时出现「12 MB」和「›」，看起来像可展开的两级菜单。
 */
export function saveActionTrailing(
  detail: string | null,
  showsChevron: boolean
): SaveActionTrailing {
  if (detail != null && detail !== '') return 'detail'
  return showsChevron ? 'chevron' : 'none'
}

export interface SaveActionRowLayout {
  readonly height: number
  readonly horizontalPadding: number
  readonly spacing: number
  readonly iconWidth: number
  readonly scale: number
  readonly opacity: number
  readonly pressedAnimation: { readonly kind: 'easeOut'; readonly duration: number }
  readonly trailing: SaveActionTrailing
}

/** 由「按下/禁用/有无说明」推出整行的可绘制属性。 */
export function saveActionRowLayout(input: SaveActionRowInput): SaveActionRowLayout {
  return {
    height: SAVE_ACTION_ROW_HEIGHT,
    horizontalPadding: SAVE_ACTION_ROW_HORIZONTAL_PADDING,
    spacing: SAVE_ACTION_ROW_SPACING,
    iconWidth: SAVE_ACTION_ICON_WIDTH,
    scale: input.pressed ? SAVE_ACTION_PRESSED_SCALE : 1,
    opacity: input.enabled ? 1 : SAVE_ACTION_DISABLED_OPACITY,
    pressedAnimation: { kind: 'easeOut', duration: SAVE_ACTION_PRESS_ANIMATION_DURATION },
    trailing: saveActionTrailing(input.detail, input.showsChevron),
  }
}

/** 开关行的固定几何（行高比动作行低 2pt，因为开关自身有内边距）。 */
export const SAVE_TOGGLE_ROW_LAYOUT = {
  height: SAVE_TOGGLE_ROW_HEIGHT,
  horizontalPadding: SAVE_ACTION_ROW_HORIZONTAL_PADDING,
  spacing: SAVE_ACTION_ROW_SPACING,
  controlSize: 'small',
  tint: 'mint',
} as const
