/**
 * Swift source: Sources/DogSCApp/EditorInspectorScopeControls.swift（97 行）@ 567fd6e
 *
 * L5-12  → backgroundBlurSection（仅壁纸媒体源显示背景模糊）
 * L14-38 → zoomTransitionAvailability（0.001 容差判定「已按可用时间适配」）
 * L40-89 → selectedAudioContext（继承 / 已覆盖两态、定位按钮、恢复继承）
 * L91-96 → segmentAudioSourceDetail
 *
 * 这一层是检查器的「派生文案与可见性」，不含控制器：调参数走 canvasBinding、
 * 改时间线走 replaceTimeline，都带 actionName 进撤销栈。
 */

import { formatTimecode } from './MediaAsset'
import { backgroundSourceUsesWallpaperMedia, type BackgroundSource } from './ProjectModel'

/** 背景模糊滑块区间（Swift `range: 0...80`，单位 pt）。 */
export const BACKGROUND_BLUR_RANGE = { lower: 0, upper: 80 } as const

/** 只有「壁纸媒体」（图片 / 视频背景）才有背景模糊。 */
export function backgroundBlurSectionVisible(source: BackgroundSource): boolean {
  return backgroundSourceUsesWallpaperMedia(source)
}

/** 判定「实际值 vs 请求值」是否算被约束的容差（Swift L19 `.001`）。 */
export const ZOOM_TRANSITION_TOLERANCE = 0.001

export interface ResolvedZoomPhase {
  readonly enterDuration: number
  readonly exitDuration: number
  readonly endTime: number
}

export interface RequestedZoomPhase {
  readonly enterDuration: number
  readonly exitDuration: number
  readonly endTime: number
}

export type ZoomTransitionAvailability =
  | { readonly kind: 'constrained'; readonly resolved: ResolvedZoomPhase }
  | { readonly kind: 'fits' }

/**
 * 运镜时长是否被可用时间挤压（Swift L19-22）。
 *
 * 三项任一超差即视为「已适配」：进入、退出、以及**结束时刻**。
 * 只比前两项会漏掉「末段被整体提前」的情况 —— 那时用户看到的动画确实短了，
 * 但两个时长本身没变。
 */
export function zoomTransitionAvailability(
  resolved: ResolvedZoomPhase | null,
  requested: RequestedZoomPhase
): ZoomTransitionAvailability {
  if (resolved === null) return { kind: 'fits' }
  const constrained =
    Math.abs(resolved.enterDuration - requested.enterDuration) > ZOOM_TRANSITION_TOLERANCE ||
    Math.abs(resolved.exitDuration - requested.exitDuration) > ZOOM_TRANSITION_TOLERANCE ||
    Math.abs(resolved.endTime - requested.endTime) > ZOOM_TRANSITION_TOLERANCE
  return constrained ? { kind: 'constrained', resolved } : { kind: 'fits' }
}

export const ZOOM_TRANSITION_TEXTS = {
  constrainedTitle: '已按可用时间适配',
  constrainedDetailPrefix: '实际进入',
  constrainedDetailSeparator: ' · 退出 ',
  constrainedNote: '保留上方设定；片尾前完成退出，相邻动画紧接时连续衔接。',
  fits: '设定时长均可完整播放。',
} as const

/** 「实际进入 a · 退出 b」——两段都用滑块同款秒格式。 */
export function zoomTransitionConstrainedLine(phase: ResolvedZoomPhase): string {
  return `${ZOOM_TRANSITION_TEXTS.constrainedDetailPrefix} ${zoomPhaseSecondsText(
    phase.enterDuration
  )}${ZOOM_TRANSITION_TEXTS.constrainedDetailSeparator}${zoomPhaseSecondsText(phase.exitDuration)}`
}

/** 秒值文本：与 `EditorSliderValueFormat.seconds` 一致（两位小数 + `s`）。 */
export function zoomPhaseSecondsText(seconds: number): string {
  const safe = Number.isFinite(seconds) ? seconds : 0
  return `${safe.toFixed(2)}s`
}

export const SEGMENT_AUDIO_TEXTS = {
  inherits: '继承全片声音设置',
  overrides: '已覆盖此段的声音设置',
  locate: '定位到此段',
  restoreInheritance: '恢复继承',
  outsideWarning: '播放头在其他位置，当前调整仍只作用于选中片段。',
  inheritDetail: '继承全片设置',
  customDetail: '仅此片段，自定义设置',
} as const

/** 「继承 / 已覆盖」两态（`overrides?.isEmpty ?? true` 视为继承）。 */
export function segmentAudioScopeText(hasOverrides: boolean): string {
  return hasOverrides ? SEGMENT_AUDIO_TEXTS.overrides : SEGMENT_AUDIO_TEXTS.inherits
}

/** 段标题：紧凑布局只留一行状态文案，常规布局先显示「第 N 段」。 */
export function segmentAudioHeader(input: {
  readonly index: number
  readonly hasOverrides: boolean
  readonly compact: boolean
}): string {
  if (input.compact) return segmentAudioScopeText(input.hasOverrides)
  return `第 ${input.index + 1} 段`
}

/** 段的时间范围文本：`mm:ss.cc – mm:ss.cc`（两位小数，等宽显示）。 */
export function segmentAudioRangeText(outputStart: number, outputEnd: number): string {
  return `${formatTimecode(outputStart)} – ${formatTimecode(outputEnd)}`
}

/**
 * 「恢复继承」按钮是否需要出现：只有已被覆盖才给这个出口。
 * 没覆盖时显示它会让用户以为「点了会改回去」，其实是空操作。
 */
export function segmentAudioRestoreVisible(hasOverrides: boolean): boolean {
  return hasOverrides
}

/** 播放头不在选中段内时提示「调整只作用于选中片段」。 */
export function segmentAudioOutsideWarningVisible(input: {
  readonly playbackTime: number
  readonly outputStart: number
  readonly outputEnd: number
}): boolean {
  return input.playbackTime < input.outputStart || input.playbackTime >= input.outputEnd
}

/** 声源来源说明：“继承全片设置” / “仅此片段，自定义设置”。 */
export function segmentAudioSourceDetail(input: {
  readonly volume: number | null | undefined
  readonly mute: boolean | null | undefined
}): string {
  return input.volume === null || input.volume === undefined
    ? input.mute === null || input.mute === undefined
      ? SEGMENT_AUDIO_TEXTS.inheritDetail
      : SEGMENT_AUDIO_TEXTS.customDetail
    : input.mute === null || input.mute === undefined
      ? SEGMENT_AUDIO_TEXTS.inheritDetail
      : SEGMENT_AUDIO_TEXTS.customDetail
}

/** 紧凑布局下垂直内边距为 0，常规为 4。 */
export function selectedAudioContextVerticalPadding(compact: boolean): number {
  return compact ? 0 : 4
}

/** 紧凑布局下行间距 6，常规 9。 */
export function selectedAudioContextRowSpacing(compact: boolean): number {
  return compact ? 6 : 9
}
