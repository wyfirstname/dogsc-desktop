/**
 * 「关于」设置页 —— 岛中央的身份、三个磁贴出口、底部一条更新控件。
 *
 * Swift source: Sources/DogSCApp/AppAboutSettingsView.swift（144 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct AppAboutSettingsView                   L6-97
 *   - 应用图标（76×76 / 阴影 / 入场缩放偏移）          L14-21 → ABOUT_HERO_ICON_SIZE / aboutHeroArrival
 *   - 标题 + 副标题                                 L23-33 → ABOUT_TITLE_SIZE / ABOUT_SUBTITLE
 *   - 版本胶囊                                      L35-40 → ABOUT_VERSION_PILL
 *   - 入场动画                                      L45-47 → ABOUT_HERO_ARRIVAL_DELAY
 *   - 三个出口磁贴                                   L49-60 → ABOUT_LINK_TILES
 *   - 更新条                                        L62-91 → aboutCheckForUpdatesEnabled / aboutAutoUpdateEnabled
 *   - struct SettingsLinkTile                       L100-139 → aboutLinkTileTrailingOffset / aboutLinkTileAccessibilityIdentifier
 *   - enum AppProjectLinks                          L141-144 → APP_PROJECT_LINKS
 *
 * 迁移说明：SwiftUI 布局在 React 端由 antd 的 `<Space>`/`<Flex>` + CSS 变量承载。
 * 本文件保留三样东西：一、可从源码直接读出的设计常量；二、两个可用断言锁住的
 * 启用条件；三、hover 位移与无障碍标识的公式。
 *
 * 注意：磁贴圆角 `SettingsLayout.tileRadius` 来自设置页布局模块（尚未迁移），
 * 本文件不重复声明，由 React 侧从该模块取。
 */

import type { AppLineIconKind } from './EditorSymbol'

/** Swift L28：副标题。 */
export const ABOUT_SUBTITLE = '丝滑、优雅的高性能屏幕录制工具'

/** Swift L17：应用图标边长。 */
export const ABOUT_HERO_ICON_SIZE = 76

/** Swift L18：图标投影（radius 12、y 偏移 6）。 */
export const ABOUT_HERO_ICON_SHADOW = { radius: 12, offsetY: 6 } as const

/** Swift L19-20：入场前的缩放与竖直偏移。到位后都是「1 / 0」。 */
export const ABOUT_HERO_ENTRY_SCALE = 0.84
export const ABOUT_HERO_ENTRY_OFFSET_Y = 6

/** Swift L46：入场动画的延迟。 */
export const ABOUT_HERO_ARRIVAL_DELAY = 0.14

/** Swift L25：标题字号与字重。 */
export const ABOUT_TITLE_SIZE = 21
export const ABOUT_TITLE_WEIGHT = 'semibold' as const

/** Swift L29：副标题字号。 */
export const ABOUT_SUBTITLE_SIZE = 12

/** Swift L36-39：版本胶囊。 */
export const ABOUT_VERSION_PILL = {
  fontSize: 10.5,
  weight: 'semibold' as const,
  design: 'rounded' as const,
  horizontalPadding: 10,
  height: 22,
} as const

/** Swift L43-44：身份区块上/下内边距。 */
export const ABOUT_HERO_PADDING = { top: 24, bottom: 22 } as const

/** Swift L49：三个磁贴之间的间距。 */
export const ABOUT_LINK_TILE_SPACING = 8

/** Swift L111-129：磁贴内部度量。 */
export const ABOUT_LINK_TILE_METRICS = {
  iconSize: 22,
  trailingIconSize: 11,
  contentPadding: 12,
  minHeight: 100,
  titleSize: 12.5,
  titleWeight: 'semibold' as const,
  titleLineLimit: 2,
  pressScale: 0.97,
  /** L120：图标与标题之间的最小留白。 */
  minimumGap: 16,
} as const

/** Swift L117-118：hover 时尾部箭头的外移量（外部链接向上，其余仅向右）。 */
export const ABOUT_LINK_TILE_HOVER_OFFSET = { x: 2, y: -2 } as const

/** Swift L62-91：底部更新条度量。 */
export const ABOUT_UPDATE_BAR_METRICS = {
  spacing: 12,
  refreshIconSize: 18,
  titleSize: 12.5,
  titleWeight: 'semibold' as const,
  horizontalPadding: 14,
  minHeight: 56,
  topPadding: 8,
  /** L68：标题与控件之间的最小留白。 */
  minimumGap: 8,
} as const

/** Swift L93-94：页面级内边距。 */
export const ABOUT_PAGE_PADDING = { horizontal: 6, bottom: 6 } as const

/** Swift L65 / L84：两处文案共用同一个字符串。 */
export const ABOUT_AUTOMATIC_UPDATE_TITLE = '自动检查更新'

/** Swift L72 / L77。 */
export const ABOUT_CHECK_UPDATES_TITLE = '检查更新'
export const ABOUT_CHECK_UPDATES_HINT = '从 GitHub Release 检查并安装 DogSC 新版本'

/** Swift L141-144。 */
export const APP_PROJECT_LINKS = {
  source: 'https://github.com/laogou717/dogsc',
  feedback: 'https://github.com/laogou717/dogsc/issues',
} as const

/** 一个出口磁贴。 */
export interface AboutLinkTile {
  readonly icon: AppLineIconKind
  readonly title: string
  readonly trailingIcon: AppLineIconKind
  /** 显式无障碍标识；null 表示按标题推导。 */
  readonly accessibilityIdentifier: string | null
  readonly opensURL: string | null
}

/** Swift L50-59：三个出口。前两个开外部链接，第三个打开赞赏面板。 */
export const ABOUT_LINK_TILES: readonly AboutLinkTile[] = [
  {
    icon: 'code',
    title: '开源仓库 (GitHub)',
    trailingIcon: 'external',
    accessibilityIdentifier: null,
    opensURL: APP_PROJECT_LINKS.source,
  },
  {
    icon: 'feedback',
    title: '反馈与建议',
    trailingIcon: 'external',
    accessibilityIdentifier: null,
    opensURL: APP_PROJECT_LINKS.feedback,
  },
  {
    icon: 'cup',
    title: '自愿赞赏支持',
    trailingIcon: 'chevron',
    accessibilityIdentifier: 'settings.about.support',
    opensURL: null,
  },
]

/**
 * Swift L19-20：
 *   .scaleEffect(heroArrived || RecorderMotion.reduces ? 1 : 0.84)
 *   .offset(y: heroArrived || RecorderMotion.reduces ? 0 : 6)
 *
 * 降低动态效果时直接落位 —— 不做 0.84 → 1 的补间。
 */
export function aboutHeroArrival(input: {
  readonly heroArrived: boolean
  readonly reducesMotion: boolean
}): { readonly scale: number; readonly offsetY: number } {
  const arrived = input.heroArrived || input.reducesMotion
  return {
    scale: arrived ? 1 : ABOUT_HERO_ENTRY_SCALE,
    offsetY: arrived ? 0 : ABOUT_HERO_ENTRY_OFFSET_Y,
  }
}

/**
 * Swift L117-118：
 *   .offset(x: hovered && !RecorderMotion.reduces ? 2 : 0,
 *           y: hovered && !RecorderMotion.reduces && trailingIcon == .external ? -2 : 0)
 *
 * y 位移**只**给外部链接：chevron 表示「展开面板」，它不该有「跳出去」的手势语言。
 */
export function aboutLinkTileTrailingOffset(input: {
  readonly hovered: boolean
  readonly reducesMotion: boolean
  readonly trailingIcon: AppLineIconKind
}): { readonly x: number; readonly y: number } {
  if (!input.hovered || input.reducesMotion) return { x: 0, y: 0 }
  return {
    x: ABOUT_LINK_TILE_HOVER_OFFSET.x,
    y: input.trailingIcon === 'external' ? ABOUT_LINK_TILE_HOVER_OFFSET.y : 0,
  }
}

/**
 * Swift L137：`.accessibilityIdentifier(accessibilityIdentifier ?? "settings.about.\(title)")`。
 * 标题是中文时标识符里也是中文 —— 这是上游刻意保留的，不改写。
 */
export function aboutLinkTileAccessibilityIdentifier(
  title: string,
  explicit: string | null
): string {
  return explicit ?? `settings.about.${title}`
}

/**
 * Swift L75：`.disabled(!updateController.isFormalRelease || !updateController.isReady)`。
 * 两个条件都必需：非正式版没有更新源，未就绪时检查会撞上分发器初始化。
 */
export function aboutCheckForUpdatesEnabled(input: {
  readonly isFormalRelease: boolean
  readonly isReady: boolean
}): boolean {
  return input.isFormalRelease && input.isReady
}

/**
 * Swift L86：`.disabled(!updateController.isFormalRelease)`。
 * 自动检查开关**不**要求 isReady —— 那是一个持久偏好，不需要分发器就位。
 */
export function aboutAutoUpdateEnabled(isFormalRelease: boolean): boolean {
  return isFormalRelease
}

/** Swift L76：检查按钮的悬停提示直接取控制器的可用性描述。 */
export function aboutCheckForUpdatesHelp(availabilityDescription: string): string {
  return availabilityDescription
}
