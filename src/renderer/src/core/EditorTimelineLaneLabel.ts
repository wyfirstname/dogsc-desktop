/**
 * Swift source: Sources/DogSCApp/EditorTimelineLaneLabel.swift（130 行）@ 567fd6e
 *
 * L5-58   → 轨道头：22pt 图标瓦片 + 标题 + 悬停才浮出的隐藏按钮
 * L60-84  → timelineRowGrid：标签列底色与 0.5pt 分隔线
 * L86-100 → EditorTimelineColumnLayout：把宽度本身做成可插值量
 * L102-118→ EditorTimelineSwap / timelineLane 转场
 * L120-130→ timelineRowDivider
 *
 * 原注释：所有轨道头共用同样的三列，**连空的动作位也算**；标题长短不会移动
 * 图标、动作或行边界。
 */

import { EDITOR_INTERFACE_RADIUS } from './EditorWorkspaceLayout'

/** 图标瓦片（Swift L19-22）。 */
export const LANE_LABEL_ICON_SIZE = 12
export const LANE_LABEL_TILE_SIZE = 22
export const LANE_LABEL_TILE_RADIUS = EDITOR_INTERFACE_RADIUS.compact
export const LANE_LABEL_TILE_TINT_OPACITY = 0.18

/** 行内间距与左右内边距。 */
export const LANE_LABEL_SPACING = 9
export const LANE_LABEL_HORIZONTAL_INSET = 12
/** 折叠态改为 15（图标居中于更窄的列）。 */
export const LANE_LABEL_COLLAPSED_INSET = 15

/** 标题排版。 */
export const LANE_LABEL_TITLE_FONT_SIZE = 12
export const LANE_LABEL_TITLE_MINIMUM_SCALE = 0.85
/** 折叠/展开时标题的横向位移。 */
export const LANE_LABEL_TITLE_TRANSITION_OFFSET = 6

/** 隐藏按钮（Swift L42-52）。 */
export const LANE_HIDE_BUTTON_SIZE = 24
export const LANE_HIDE_BUTTON_SYMBOL_SIZE = 13.5
export const LANE_HIDE_BUTTON_BACKGROUND_OPACITY = 0.92
export const LANE_HIDE_BUTTON_TRAILING_PADDING = 6

/** 行分隔线（Swift L122-127）。 */
export const LANE_ROW_DIVIDER_HEIGHT = 0.5
export const LANE_ROW_DIVIDER_OPACITY = 0.055
export const LANE_ROW_DIVIDER_STRONG_OPACITY = 0.085

/** 标签列右边界分隔线（Swift L77-80）。 */
export const LANE_COLUMN_DIVIDER_WIDTH = 0.5
export const LANE_COLUMN_DIVIDER_OPACITY = 0.07

/** 换轨转场（Swift L105-118）。 */
export const TIMELINE_SWAP_IN_DELAY = 0.1

export const LANE_LABEL_TEXT = {
  /** `隐藏“%@”轨道；效果仍然生效` —— 提示里要说明效果仍然生效，否则用户以为会关掉效果。 */
  hideHelpFormat: (title: string) => `隐藏“${title}”轨道；效果仍然生效`,
  /** 无障碍只需说明动作本身。 */
  hideAccessibilityFormat: (title: string) => `隐藏“${title}”轨道`,
} as const

/** 横向内边距：折叠态固定 15，展开态用调用方给的 inset。 */
export function laneLabelHorizontalPadding(collapsed: boolean, horizontalInset: number): number {
  return collapsed ? LANE_LABEL_COLLAPSED_INSET : horizontalInset
}

/**
 * 隐藏按钮是否可见（Swift L41-49）。
 *
 * 三个条件：有回调、非折叠、**指针在行上**。折叠态没有标题，按钮会盖住图标；
 * 而常驻按钮会占掉标题的宽度，所以只在悬停时浮出。
 */
export function laneHideButtonVisible(input: {
  readonly hasHideAction: boolean
  readonly collapsed: boolean
  readonly hovered: boolean
}): boolean {
  return input.hasHideAction && !input.collapsed && input.hovered
}

/** 标题是否渲染（折叠态把名字挪进 tooltip）。 */
export function laneLabelShowsTitle(collapsed: boolean): boolean {
  return !collapsed
}

/** 悬停时的标题颜色切换（primary ↔ secondary）由调用方取色，这里只给判定。 */
export function laneLabelUsesPrimaryText(hovered: boolean): boolean {
  return hovered
}

/** 行分隔线不透明度（Swift L124）。 */
export function laneRowDividerOpacity(strong: boolean): number {
  return strong ? LANE_ROW_DIVIDER_STRONG_OPACITY : LANE_ROW_DIVIDER_OPACITY
}

export interface LaneTransitionSpec {
  readonly insertion: { readonly kind: 'opacityOffset' | 'opacity'; readonly offsetY: number; readonly duration: number; readonly delay: number }
  readonly removal: { readonly kind: 'opacity'; readonly duration: number }
}

/**
 * 轨道展开/收起转场（Swift L109-118）。
 *
 * 出去的先走（0.1s 淡出），进来的后到（0.22s 淡出 + 上移 6pt，延迟 0.12s）——
 * 两者重叠时下层正在移动的行会从半透明的轨道里透出来。
 * `reduce motion` 时退化为纯透明度转场。
 */
export function laneTransitionSpec(reduceMotion: boolean): LaneTransitionSpec {
  if (reduceMotion) {
    return {
      insertion: { kind: 'opacity', offsetY: 0, duration: 0, delay: 0 },
      removal: { kind: 'opacity', duration: 0 },
    }
  }
  return {
    insertion: { kind: 'opacityOffset', offsetY: -LANE_LABEL_TITLE_TRANSITION_OFFSET, duration: 0.22, delay: 0.12 },
    removal: { kind: 'opacity', duration: 0.1 },
  }
}

/**
 * 轨道行高表（Swift L62-67）：标尺 + 主视频（+12 内边距）+ 按开关追加的效果行。
 * 只用于布局预算，行线本身由各行自己画。
 */
export function timelineRowHeights(input: {
  readonly rulerHeight: number
  readonly primaryVideoHeight: number
  readonly cameraSyncTimelineHeight: number
  readonly zoomTimelineHeight: number
  readonly motionTimelineHeight: number
  readonly overlayTimelineHeight: number
  readonly showsCameraSync: boolean
  readonly showsZoom: boolean
  readonly showsScreenMotion: boolean
  readonly showsCameraMotion: boolean
  readonly showsOverlay: boolean
}): number[] {
  const heights = [input.rulerHeight, input.primaryVideoHeight + 12]
  if (input.showsCameraSync) heights.push(input.cameraSyncTimelineHeight)
  if (input.showsZoom) heights.push(input.zoomTimelineHeight)
  if (input.showsScreenMotion) heights.push(input.motionTimelineHeight)
  if (input.showsCameraMotion) heights.push(input.motionTimelineHeight)
  if (input.showsOverlay) heights.push(input.overlayTimelineHeight)
  return heights
}
