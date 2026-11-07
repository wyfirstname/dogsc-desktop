/**
 * Swift source: Sources/DogSCApp/EditorInspectorTabBar.swift（99 行）@ 567fd6e
 *
 * L7      → 高度 60
 * L18-30  → 间距 2 + 内边距 4；裁切期间整条禁用并降到 0.45
 * L32-79  → 单个页签：44pt 命中、选中才显示名字、胶囊指示器滑行
 * L81-88  → isAvailable
 * L90-98  → help（不可用时给出「为什么没有」）
 *
 * 原注释：与设置页导航岛同一套文法 —— 44pt 目标、只有当前任务显示名字、
 * 一个胶囊在它们之间滑行。
 *
 * 页签定义来自 RecorderViews.swift L422-443（`InspectorTab`），顺序即
 * `CaseIterable` 顺序：画面 → 开场 → 运镜 → 光标 → 摄像头 → 声音。
 */

export const INSPECTOR_TAB_BAR_HEIGHT = 60
export const INSPECTOR_TAB_BAR_SPACING = 2
export const INSPECTOR_TAB_BAR_PADDING = 4
export const INSPECTOR_TAB_MINIMUM_TARGET = 44
export const INSPECTOR_TAB_ICON_SIZE = 17
export const INSPECTOR_TAB_LABEL_FONT_SIZE = 13
export const INSPECTOR_TAB_LABEL_GAP = 7
export const INSPECTOR_TAB_SELECTED_LEADING = 14
export const INSPECTOR_TAB_SELECTED_TRAILING = 16
export const INSPECTOR_TAB_ICON_LABEL_LEADING = 0
export const INSPECTOR_TAB_ICON_LABEL_TRAILING = 0
/** 裁切期间整条的不透明度。 */
export const INSPECTOR_TAB_BAR_DISABLED_OPACITY = 0.45
/** 单个页签不可用的不透明度。 */
export const INSPECTOR_TAB_UNAVAILABLE_OPACITY = 0.35

export type InspectorTabKey = 'frame' | 'opening' | 'zoom' | 'cursor' | 'camera' | 'audio'

export interface InspectorTabDefinition {
  readonly key: InspectorTabKey
  /** `id` 即 rawValue（中文），无障碍标识符里会用到。 */
  readonly id: string
  readonly label: string
  readonly icon: string
}

export const INSPECTOR_TABS: readonly InspectorTabDefinition[] = [
  { key: 'frame', id: '画面', label: '画面', icon: 'photo.on.rectangle.angled' },
  { key: 'opening', id: '开场', label: '开场', icon: 'sparkles.rectangle.stack' },
  { key: 'zoom', id: '运镜', label: '运镜', icon: 'viewfinder' },
  { key: 'cursor', id: '光标', label: '光标', icon: 'cursorarrow.motionlines' },
  { key: 'camera', id: '摄像头', label: '摄像头', icon: 'video' },
  { key: 'audio', id: '声音', label: '声音', icon: 'speaker.wave.2' },
]

/** 哪些页签在当前工程里可用（Swift L81-88）。 */
export function inspectorTabAvailable(
  tab: InspectorTabKey,
  availability: { readonly cameraAvailable: boolean; readonly audioAvailable: boolean; readonly cursorAvailable: boolean }
): boolean {
  switch (tab) {
    case 'camera':
      return availability.cameraAvailable
    case 'audio':
      return availability.audioAvailable
    case 'cursor':
      return availability.cursorAvailable
    case 'frame':
    case 'opening':
    case 'zoom':
      return true
  }
}

export const INSPECTOR_TAB_UNAVAILABLE_HELP = {
  camera: '当前项目没有摄像头素材',
  audio: '当前项目没有系统声音或麦克风素材',
  cursor: '当前项目没有记录鼠标事件',
} as const

/** 悬停提示：可用时就是页签名，不可用时说明缺什么（Swift L90-98）。 */
export function inspectorTabHelp(
  tab: InspectorTabKey,
  available: boolean
): string {
  if (available) {
    return INSPECTOR_TABS.find((definition) => definition.key === tab)?.label ?? ''
  }
  if (tab === 'camera' || tab === 'audio' || tab === 'cursor') {
    return INSPECTOR_TAB_UNAVAILABLE_HELP[tab]
  }
  const definition = INSPECTOR_TABS.find((item) => item.key === tab)
  return definition?.label ?? ''
}

/** 无障碍标识符：`editor.workspace.tool.<rawValue>`（中文原样）。 */
export function inspectorTabAccessibilityIdentifier(tab: InspectorTabKey): string {
  const definition = INSPECTOR_TABS.find((item) => item.key === tab)
  return `editor.workspace.tool.${definition?.id ?? tab}`
}

export interface InspectorTabPresentation {
  readonly key: InspectorTabKey
  readonly selected: boolean
  readonly hovered: boolean
  readonly available: boolean
  readonly showsLabel: boolean
  readonly leadingPadding: number
  readonly trailingPadding: number
  readonly opacity: number
}

/**
 * 整条页签栏的呈现态。
 *
 * 两条细节：
 * - `hovered` 只在**非选中**时成立（选中态已由胶囊表达，再加 hover 底会脏）；
 * - 裁切期间整条 `.disabled(isCropping)` + 0.45，且每个页签自己还按可用性降到 0.35，
 *   两档透明度会相乘 —— 这里是乘法而不是取最小，与 SwiftUI 的叠加一致。
 */
export function inspectorTabPresentations(input: {
  readonly selection: InspectorTabKey
  readonly hoveredTab: InspectorTabKey | null
  readonly isCropping: boolean
  readonly cameraAvailable: boolean
  readonly audioAvailable: boolean
  readonly cursorAvailable: boolean
}): InspectorTabPresentation[] {
  const barOpacity = input.isCropping ? INSPECTOR_TAB_BAR_DISABLED_OPACITY : 1
  return INSPECTOR_TABS.map((definition) => {
    const available = inspectorTabAvailable(definition.key, input)
    const selected = input.selection === definition.key
    return {
      key: definition.key,
      selected,
      hovered: input.hoveredTab === definition.key && !selected,
      available,
      showsLabel: selected,
      leadingPadding: selected ? INSPECTOR_TAB_SELECTED_LEADING : INSPECTOR_TAB_ICON_LABEL_LEADING,
      trailingPadding: selected ? INSPECTOR_TAB_SELECTED_TRAILING : INSPECTOR_TAB_ICON_LABEL_TRAILING,
      opacity: barOpacity * (available ? 1 : INSPECTOR_TAB_UNAVAILABLE_OPACITY),
    }
  })
}

/** 点击是否真的切换：点当前页签是空操作（Swift L36 `guard selection != tab`）。 */
export function inspectorTabSelectionChanges(current: InspectorTabKey, next: InspectorTabKey): boolean {
  return current !== next
}
