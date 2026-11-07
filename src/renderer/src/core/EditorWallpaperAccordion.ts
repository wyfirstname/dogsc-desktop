/**
 * Swift source: Sources/DogSCApp/EditorWallpaperAccordion.swift（88 行）@ 567fd6e
 *
 * L15-16 → 间距 / 高度常量
 * L19-27 → 权重 → 可用宽 → 每片宽
 * L28-29 → 弹簧（reduce motion 时退化为无动画）
 * L38-42 → weight(for:)
 * L46-74 → slice 的展开态：显隐、偏移、透明度、描边
 *
 * 原注释：壁纸排成一列细条；指针下的那条张开露脸，指针离开后**已选中的那条**
 * 保持张开。所以「张开」有两个来源：hover 优先，其次才是选中。
 *
 * UI 载体（HStack + Button + 缩略图）由 React 实现，这里只搬布局与呈现判定。
 */

export const WALLPAPER_ACCORDION_SPACING = 4
export const WALLPAPER_ACCORDION_HEIGHT = 124

/** 指针下的切片权重。 */
export const WALLPAPER_HOVER_WEIGHT = 5
/** 无 hover 时选中切片的权重。 */
export const WALLPAPER_SELECTED_WEIGHT = 3.4
/** 其余切片的权重。 */
export const WALLPAPER_IDLE_WEIGHT = 1

export const WALLPAPER_SLICE_CORNER_RADIUS = 14
/** 展开且宽度超过该值才显示标题胶囊。 */
export const WALLPAPER_LABEL_MINIMUM_WIDTH = 72
export const WALLPAPER_LABEL_HEIGHT = 22
export const WALLPAPER_LABEL_HORIZONTAL_PADDING = 9
export const WALLPAPER_LABEL_PADDING = 7
export const WALLPAPER_LABEL_BACKGROUND_OPACITY = 0.42
/** 收起时标题下沉的距离。 */
export const WALLPAPER_LABEL_HIDDEN_OFFSET = 5

export const WALLPAPER_OPEN_OPACITY = 1
export const WALLPAPER_IDLE_OPACITY = 0.82
export const WALLPAPER_SELECTED_BORDER_WIDTH = 2
export const WALLPAPER_IDLE_BORDER_WIDTH = 0.75
export const WALLPAPER_IDLE_BORDER_OPACITY = 0.08

/** 展开/收起共用的弹簧（Swift `.spring(response: 0.55, dampingFraction: 0.82)`）。 */
export const WALLPAPER_ACCORDION_SPRING = { response: 0.55, dampingFraction: 0.82 } as const

/**
 * 每片权重（Swift L38-42）。
 *
 * 注意顺序：hover 优先级**高于**选中，且 hover 存在时选中片不再享受 3.4 ——
 * 否则指针扫过时会出现两条同时张开的切片，用户分不清哪条是「将选中」。
 */
export function wallpaperAccordionWeight(input: {
  readonly id: string
  readonly hoveredID: string | null
  readonly selectedGroupID: string | null
}): number {
  if (input.hoveredID === input.id) return WALLPAPER_HOVER_WEIGHT
  if (input.hoveredID === null && input.selectedGroupID === input.id) {
    return WALLPAPER_SELECTED_WEIGHT
  }
  return WALLPAPER_IDLE_WEIGHT
}

export interface WallpaperAccordionLayout {
  readonly available: number
  readonly totalWeight: number
  readonly widths: number[]
}

/**
 * 切片宽度分配（Swift L20-25）。
 *
 * `available` 先扣掉 `(count-1) × spacing` —— 间距只出现在切片之间，
 * 两端不留空；`totalWeight` 兜 1 防全零。
 */
export function wallpaperAccordionLayout(input: {
  readonly width: number
  readonly ids: readonly string[]
  readonly hoveredID: string | null
  readonly selectedGroupID: string | null
}): WallpaperAccordionLayout {
  const weights = input.ids.map((id) =>
    wallpaperAccordionWeight({ id, hoveredID: input.hoveredID, selectedGroupID: input.selectedGroupID })
  )
  const totalWeight = Math.max(weights.reduce((sum, value) => sum + value, 0), 1)
  const available = Math.max(
    input.width - WALLPAPER_ACCORDION_SPACING * Math.max(input.ids.length - 1, 0),
    1
  )
  return {
    available,
    totalWeight,
    widths: weights.map((weight) => (available * weight) / totalWeight),
  }
}

export interface WallpaperSliceState {
  readonly isSelected: boolean
  readonly isOpen: boolean
  readonly showsLabel: boolean
  readonly labelOffsetY: number
  readonly opacity: number
  readonly borderWidth: number
  readonly borderIsAccent: boolean
}

/**
 * 单片呈现态（Swift L47-74）。
 *
 * `isOpen = 被 hover 或（无人 hover 且被选中）`；标题还额外要求宽度 > 72 ——
 * 细条上放标题会溢出成两个字，所以宁可不显示。
 */
export function wallpaperSliceState(input: {
  readonly id: string
  readonly width: number
  readonly hoveredID: string | null
  readonly selectedGroupID: string | null
}): WallpaperSliceState {
  const isSelected = input.selectedGroupID === input.id
  const isOpen = input.hoveredID === input.id || (input.hoveredID === null && isSelected)
  return {
    isSelected,
    isOpen,
    showsLabel: isOpen && input.width > WALLPAPER_LABEL_MINIMUM_WIDTH,
    labelOffsetY: isOpen ? 0 : WALLPAPER_LABEL_HIDDEN_OFFSET,
    opacity: isOpen ? WALLPAPER_OPEN_OPACITY : WALLPAPER_IDLE_OPACITY,
    borderWidth: isSelected ? WALLPAPER_SELECTED_BORDER_WIDTH : WALLPAPER_IDLE_BORDER_WIDTH,
    borderIsAccent: isSelected,
  }
}
