/**
 * Swift source: Sources/DogSCApp/EditorTimelineClipChrome.swift（129 行）@ 567fd6e
 *
 * L5-79   → EditorTimelineClipEmphasis：四态 + 五张数值表
 * L81-97  → 效果片段用轨道色 wash，主录屏卡片保持中性石墨
 * L99-129 → editorTimelineClipChrome：静止态细描边 / 选中态 1.5pt 实环
 *
 * 原文：时间线片段只使用一套视觉强调层级。它不参与命中、时间换算或手势分发，
 * 只负责让默认、悬停、选中和正在编辑四种状态清楚且**互不叠加**。
 */

export type EditorTimelineClipEmphasis = 'idle' | 'hovered' | 'selected' | 'editing'

/**
 * 四态解析（Swift L11-20）：优先级 editing > selected > hovered > idle。
 *
 * 顺序不能换：正在编辑的片段必然也是选中的，若先判 selected 就会丢掉「编辑中」
 * 更强的描边，用户在拖动时看不出自己拖的是哪一个。
 */
export function resolveTimelineClipEmphasis(input: {
  readonly isEditing: boolean
  readonly isSelected: boolean
  readonly isHovered: boolean
}): EditorTimelineClipEmphasis {
  if (input.isEditing) return 'editing'
  if (input.isSelected) return 'selected'
  if (input.isHovered) return 'hovered'
  return 'idle'
}

const EMPHASIS_TABLE: Readonly<
  Record<
    EditorTimelineClipEmphasis,
    {
      strokeOpacity: number
      strokeWidth: number
      handleOpacity: number
      trackLightFillOpacity: number
      trackDarkFillOpacity: number
      primaryNeutralFillOpacity: number
    }
  >
> = {
  idle: {
    strokeOpacity: 0.08,
    strokeWidth: 0.65,
    handleOpacity: 0,
    trackLightFillOpacity: 0.26,
    trackDarkFillOpacity: 0.22,
    primaryNeutralFillOpacity: 0.035,
  },
  hovered: {
    strokeOpacity: 0.3,
    strokeWidth: 0.9,
    handleOpacity: 1,
    trackLightFillOpacity: 0.34,
    trackDarkFillOpacity: 0.3,
    primaryNeutralFillOpacity: 0.05,
  },
  selected: {
    strokeOpacity: 0.9,
    strokeWidth: 1.45,
    handleOpacity: 1,
    trackLightFillOpacity: 0.46,
    trackDarkFillOpacity: 0.4,
    primaryNeutralFillOpacity: 0.065,
  },
  editing: {
    strokeOpacity: 1,
    strokeWidth: 1.5,
    handleOpacity: 1,
    trackLightFillOpacity: 0.5,
    trackDarkFillOpacity: 0.44,
    primaryNeutralFillOpacity: 0.07,
  },
}

/** 只有 idle 不显示两端手柄。 */
export function timelineClipShowsHandles(emphasis: EditorTimelineClipEmphasis): boolean {
  return emphasis !== 'idle'
}

/** 四态的全部数值（供断言与 UI 取值）。 */
export function timelineClipEmphasisMetrics(emphasis: EditorTimelineClipEmphasis): (typeof EMPHASIS_TABLE)[EditorTimelineClipEmphasis] {
  return EMPHASIS_TABLE[emphasis]
}

/** 效果片段底色：沿轨道色的 wash，浅色 / 深色两套 alpha。 */
export function timelineClipSurface(
  emphasis: EditorTimelineClipEmphasis,
  appearance: 'light' | 'dark'
): { source: 'trackWash'; opacity: number } {
  const metrics = EMPHASIS_TABLE[emphasis]
  return {
    source: 'trackWash',
    opacity: appearance === 'light' ? metrics.trackLightFillOpacity : metrics.trackDarkFillOpacity,
  }
}

/**
 * 主录屏卡片底色：中性石墨（`EditorTheme.chrome(alpha)`）。
 * 缩略图与波形才是内容，卡片本身不该抢色。
 */
export function primaryTimelineSurface(emphasis: EditorTimelineClipEmphasis): {
  source: 'chrome'
  opacity: number
} {
  return { source: 'chrome', opacity: EMPHASIS_TABLE[emphasis].primaryNeutralFillOpacity }
}

export interface TimelineClipChromeStyle {
  readonly ringSource: 'tint' | 'selectionTint' | 'defaultRing'
  readonly strokeWidth: number
  readonly opacity: number
}

/**
 * 描边样式（Swift L104-127）。
 *
 * 两套静止态不透明度：有轨道色时 0.45（悬停 0.7），没有轨道色（中性主录屏卡）
 * 时 0.1（悬停 0.2）—— 中性卡上 0.45 会显得像被选中。
 * 选中/编辑时描边换成实环并加粗到 1.5，透明度直接 1。
 */
export function timelineClipChromeStyle(input: {
  readonly emphasis: EditorTimelineClipEmphasis
  readonly hasTint: boolean
  readonly hasSelectionRing: boolean
}): TimelineClipChromeStyle {
  const active = input.emphasis === 'selected' || input.emphasis === 'editing'
  const restOpacity = input.hasTint
    ? input.emphasis === 'hovered'
      ? 0.7
      : 0.45
    : input.emphasis === 'hovered'
      ? 0.2
      : 0.1
  return {
    ringSource: input.hasTint ? 'tint' : input.hasSelectionRing ? 'selectionTint' : 'defaultRing',
    strokeWidth: active ? 1.5 : 0.75,
    opacity: active ? 1 : restOpacity,
  }
}

/** 只有墨色淡入淡出，几何与媒体不动（Swift L121-124）。 */
export const TIMELINE_CLIP_CHROME_ANIMATION = { kind: 'easeOut', duration: 0.14 } as const

/** 描边层永不参与命中。 */
export const TIMELINE_CLIP_CHROME_HIT_TESTING = false
