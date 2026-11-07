/**
 * Swift source（三个文件合并，均属「时间线几何 / 标尺 / 帧吸附」纯计算）：
 *   Sources/DogSCApp/EditorTimelineClipGeometry.swift @ 567fd6e
 *     · contentInset / waveformBandFraction        L5-6
 *     · interactionRange                           L11-20
 *     · waveformBand                               L22-26
 *   Sources/DogSCApp/EditorTimelineView.swift @ 567fd6e
 *     · EditorTimelineRulerScaleLayer              L217-222
 *     · EditorTimelineRulerPresentation.majorStep  L225-240
 *     · scaleLayers（1/2/5 分级交叉淡化）           L247-283
 *     · visibleTicks（只生成视口内刻度）            L288-314
 *     · nextFinerStep                              L316-325
 *   Sources/DogSCApp/EditorTimelineLayout.swift @ 567fd6e
 *     · EditorRulerTicks.label（"0:18" / "0:18.50"）L1472-1480
 *   Sources/DogSCApp/EditorTimelineTransportUtilities.swift @ 567fd6e
 *     · timelineCanvasHeight 等行高                 L8-43
 *     · timelineFrameDuration / snappedToProjectFrame L51-59
 *     · snappedTimelineTime / snappedEditableTime    L64-84
 *
 * UI 载体在 Electron 里是 React（TimelineView.tsx），但上述取值/公式与
 * SwiftUI 版逐字一致 —— 渲染层只负责画，这里负责算。
 */

export type TimeInterval = number

// ---------------------------------------------------------------- 片段几何

/** Swift EditorTimelineClipGeometry（L5-6）。 */
export const CLIP_CONTENT_INSET = 3
export const CLIP_WAVEFORM_BAND_FRACTION = 0.26

export interface ClosedRange {
  start: number
  end: number
}

/**
 * Swift interactionRange（L11-20）—— 片段内可接收指针输入的局部坐标范围。
 *
 * 放大后一段长片段可能有几万点宽；它的**视觉边界**不能同时变成一个
 * 巨大的手势平面，所以交互面被裁到文档可见范围。
 */
export function clipInteractionRange(
  segmentOriginX: number,
  segmentWidth: number,
  documentRange: ClosedRange
): ClosedRange {
  const width = Math.max(segmentWidth, 0)
  const start = Math.min(Math.max(documentRange.start - segmentOriginX, 0), width)
  const end = Math.min(Math.max(documentRange.end - segmentOriginX, start), width)
  return { start, end }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Swift waveformBand(in:)（L22-26）—— 波形带贴在片段底部。 */
export function clipWaveformBand(rect: Rect): Rect {
  const contentY = rect.y + CLIP_CONTENT_INSET
  const contentHeight = Math.max(rect.height - CLIP_CONTENT_INSET * 2, 0)
  const height = contentHeight * CLIP_WAVEFORM_BAND_FRACTION
  return { x: rect.x, y: contentY + contentHeight - height, width: rect.width, height }
}

// ---------------------------------------------------------------- 标尺分级

/** Swift EditorTimelineRulerScaleLayer（L217-222）。 */
export interface EditorTimelineRulerScaleLayer {
  majorStep: TimeInterval
  opacity: number
}

/** Swift EditorTimelineRulerTick。 */
export interface EditorTimelineRulerTick {
  time: TimeInterval
  isMajor: boolean
}

/**
 * Swift majorStep（L225-240）—— 取 1/2/5×10ⁿ 中第一个不小于
 * 「每 128pt 一格」的步长。
 */
export function rulerMajorStep(
  duration: TimeInterval,
  width: number,
  targetSpacing = 128
): TimeInterval {
  if (!Number.isFinite(duration) || !(duration > 0)) return 1
  if (!Number.isFinite(width) || !(width > 0)) return 1
  const rawStep = duration / Math.max(width / Math.max(targetSpacing, 1), 1)
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 0.000_1))))
  const normalized = rawStep / magnitude
  let nice: number
  if (normalized <= 1) nice = 1
  else if (normalized <= 2) nice = 2
  else if (normalized <= 5) nice = 5
  else nice = 10
  return nice * magnitude
}

/** Swift nextFinerStep（L316-325）。 */
export function nextFinerRulerStep(step: TimeInterval): TimeInterval {
  if (!Number.isFinite(step) || !(step > 0)) return 0.5
  const magnitude = Math.pow(10, Math.floor(Math.log10(step)))
  const normalized = step / magnitude
  if (normalized <= 1.000_001) return (5 * magnitude) / 10
  if (normalized <= 2.000_001) return magnitude
  return 2 * magnitude
}

/**
 * Swift scaleLayers（L247-283）—— 标尺需要可读的 1/2/5 分隔，但
 * 「到边界就整套换掉刻度」会让连续缩放看起来像跳了一下。这里在整个
 * 尺度区间内交叉淡化相邻两级：细刻度渐入、粗刻度以同样速率退出。
 */
export function rulerScaleLayers(
  duration: TimeInterval,
  width: number,
  targetSpacing = 128
): EditorTimelineRulerScaleLayer[] {
  if (!Number.isFinite(duration) || !(duration > 0)) return []
  if (!Number.isFinite(width) || !(width > 0)) return []
  const rawStep = duration / Math.max(width / Math.max(targetSpacing, 1), 1)
  const coarseStep = rulerMajorStep(duration, width, targetSpacing)
  const fineStep = nextFinerRulerStep(coarseStep)
  const denominator = Math.log(coarseStep / fineStep)
  const rawProgress =
    denominator > 0 ? Math.log(coarseStep / Math.max(rawStep, fineStep)) / denominator : 0
  const progress = Math.min(Math.max(rawProgress, 0), 1)
  if (progress <= 0.001) return [{ majorStep: coarseStep, opacity: 1 }]
  if (progress >= 0.999) return [{ majorStep: fineStep, opacity: 1 }]
  return [
    { majorStep: coarseStep, opacity: 1 - progress },
    { majorStep: fineStep, opacity: progress },
  ]
}

/**
 * Swift visibleTicks（L288-314）—— 只构造缓冲视口内的刻度。
 *
 * 这消除了旧实现「每到一个标尺级别就替换整份文档数组」的开销，
 * 让同步 Canvas 在多小时、120× 的工程里依然便宜。
 * 次刻度步长固定为主刻度的一半，偶数索引才是主刻度。
 */
export function rulerVisibleTicks(opts: {
  majorStep: TimeInterval
  duration: TimeInterval
  width: number
  visibleRange: ClosedRange
  guardBand?: number
}): EditorTimelineRulerTick[] {
  const { majorStep, duration, width, visibleRange } = opts
  const guardBand = opts.guardBand ?? 80
  if (!Number.isFinite(majorStep) || !(majorStep > 0)) return []
  if (!Number.isFinite(duration) || !(duration > 0)) return []
  if (!Number.isFinite(width) || !(width > 0)) return []
  const lower = Math.max(visibleRange.start - Math.max(guardBand, 0), 0)
  const upper = Math.min(visibleRange.end + Math.max(guardBand, 0), width)
  const lowerTime = duration * (lower / width)
  const upperTime = duration * (upper / width)
  const minorStep = majorStep / 2
  const firstIndex = Math.max(Math.floor(lowerTime / minorStep) - 1, 0)
  const finalIndex = Math.min(
    Math.ceil(upperTime / minorStep) + 1,
    Math.floor(duration / minorStep)
  )
  if (!(finalIndex >= firstIndex)) return []
  const ticks: EditorTimelineRulerTick[] = []
  for (let index = firstIndex; index <= finalIndex; index += 1) {
    ticks.push({
      time: Math.min(index * minorStep, duration),
      isMajor: index % 2 === 0,
    })
  }
  return ticks
}

/**
 * Swift EditorRulerTicks.label（L1472-1480）—— 整百分秒省略小数：
 * "0:18"，但 "0:18.50"。负值归零。
 */
export function rulerLabel(time: TimeInterval): string {
  const centiseconds = Math.max(Math.round((Number.isFinite(time) ? time : 0) * 100), 0)
  const minutes = Math.floor(centiseconds / 6_000)
  const seconds = Math.floor(centiseconds / 100) % 60
  const fraction = centiseconds % 100
  const pad2 = (value: number): string => String(value).padStart(2, '0')
  return fraction === 0
    ? `${minutes}:${pad2(seconds)}`
    : `${minutes}:${pad2(seconds)}.${pad2(fraction)}`
}

// ---------------------------------------------------------------- 行高几何

/** Swift transport 里 layout.value(regular:compact:) 的等价物。 */
export interface TimelineLayoutMetrics {
  compact: boolean
}

function layoutValue(compact: boolean, regular: number, compactValue: number): number {
  return compact ? compactValue : regular
}

export interface TimelineLaneVisibility {
  showsZoomTimeline: boolean
  showsCameraSyncTimeline: boolean
  showsScreenMotionTimeline: boolean
  showsCameraMotionTimeline: boolean
  showsOverlayTimeline: boolean
  overlayTimelineRowCount: number
}

export interface TimelineGeometry {
  timelineRulerHeight: number
  primaryVideoHeight: number
  primaryTimelineHeight: number
  waveformContentHeight: number
  cameraSyncTimelineHeight: number
  motionTimelineHeight: number
  zoomTimelineHeight: number
  zoomBarHeight: number
  overlayTimelineHeight: number
  timelineCanvasHeight: number
  timelineControlsHeight: number
  timelineOverviewHeight: number
  timelineDividerHeight: number
  timelineLabelWidth: number
  preferredPanelHeight: number
}

/**
 * Swift EditorTimelineTransportUtilities L8-43 —— 全部行高。
 *
 * 关键约定：
 *   · compact 窗口用**同一套**行高画图、排版标签、做命中测试；
 *   · 「画面 / 波形」显示模式只换内容，从不改写工作区几何；
 *   · 叠加轨高度取「行数 × 34 + 16」与运动轨高度中的较大者。
 */
export function timelineGeometry(
  layout: TimelineLayoutMetrics,
  visibility: TimelineLaneVisibility,
  labelsCollapsed: boolean
): TimelineGeometry {
  const baseline = (regular: number, compactValue: number): number =>
    layoutValue(layout.compact, regular, compactValue)
  const timelineRulerHeight = baseline(32, 28)
  const primaryVideoHeight = baseline(64, 52)
  const primaryTimelineHeight = primaryVideoHeight + 12
  const waveformContentHeight = primaryVideoHeight
  const cameraSyncTimelineHeight = 62
  const motionTimelineHeight = baseline(44, 40)
  const zoomTimelineHeight = baseline(44, 40)
  const zoomBarHeight = baseline(30, 28)
  const overlayTimelineHeight = Math.max(
    Math.max(visibility.overlayTimelineRowCount, 1) * 34 + 16,
    motionTimelineHeight
  )
  const timelineCanvasHeight =
    timelineRulerHeight +
    primaryTimelineHeight +
    (visibility.showsZoomTimeline ? zoomTimelineHeight : 0) +
    (visibility.showsCameraSyncTimeline ? cameraSyncTimelineHeight : 0) +
    (visibility.showsScreenMotionTimeline ? motionTimelineHeight : 0) +
    (visibility.showsCameraMotionTimeline ? motionTimelineHeight : 0) +
    (visibility.showsOverlayTimeline ? overlayTimelineHeight : 0)
  const timelineControlsHeight = baseline(44, 40)
  const timelineOverviewHeight = baseline(20, 16)
  const timelineDividerHeight = 1
  const timelineLabelWidth = labelsCollapsed ? 52 : baseline(156, 128)
  return {
    timelineRulerHeight,
    primaryVideoHeight,
    primaryTimelineHeight,
    waveformContentHeight,
    cameraSyncTimelineHeight,
    motionTimelineHeight,
    zoomTimelineHeight,
    zoomBarHeight,
    overlayTimelineHeight,
    timelineCanvasHeight,
    timelineControlsHeight,
    timelineOverviewHeight,
    timelineDividerHeight,
    timelineLabelWidth,
    preferredPanelHeight:
      timelineCanvasHeight +
      timelineControlsHeight +
      timelineOverviewHeight +
      timelineDividerHeight,
  }
}

/** Swift timelineViewportHeight（L39-41）：至少 80pt 可用。 */
export function timelineViewportHeight(panelHeight: number, geometry: TimelineGeometry): number {
  return Math.max(
    panelHeight -
      geometry.timelineControlsHeight -
      geometry.timelineOverviewHeight -
      geometry.timelineDividerHeight,
    80
  )
}

/** Swift timelineDocumentHeight（L42）。 */
export function timelineDocumentHeight(
  panelHeight: number,
  geometry: TimelineGeometry
): number {
  return Math.max(geometry.timelineCanvasHeight, timelineViewportHeight(panelHeight, geometry))
}

// ---------------------------------------------------------------- 帧吸附

/**
 * Swift timelineFrameDuration（L51-54）。
 * captureFrameRate ≤ 0 时按 1fps 兜底（避免除零），与 Swift `max(..., 1)` 一致。
 */
export function timelineFrameDuration(captureFrameRate: number): TimeInterval {
  const frameRate = Math.max(Number.isFinite(captureFrameRate) ? captureFrameRate : 1, 1)
  return 1 / frameRate
}

/** Swift snappedToProjectFrame（L56-59）：四舍五入到帧格。 */
export function snappedToProjectFrame(time: TimeInterval, frameDuration: TimeInterval): TimeInterval {
  if (!Number.isFinite(time)) return 0
  if (!Number.isFinite(frameDuration) || !(frameDuration > 0)) return time
  return Math.round(time / frameDuration) * frameDuration
}

/**
 * Swift snappedTimelineTime（L64-71）。
 *
 * 普通播放头/编辑位置对齐到工程帧格，但**保留媒体的精确最终时长** ——
 * 素材长度往往不是标称帧间隔的整数倍。因此落在首/尾半帧内的位置直接
 * 归到 0 / duration，而不是被四舍五入吸走。
 */
export function snappedTimelineTime(
  time: TimeInterval,
  duration: TimeInterval,
  frameDuration: TimeInterval
): TimeInterval {
  const safeDuration = Number.isFinite(duration) ? duration : 0
  const clamped = Math.min(Math.max(Number.isFinite(time) ? time : 0, 0), safeDuration)
  const halfFrame = frameDuration / 2
  if (clamped <= halfFrame) return 0
  if (safeDuration - clamped <= halfFrame) return safeDuration
  return Math.min(Math.max(snappedToProjectFrame(clamped, frameDuration), 0), safeDuration)
}

/** Swift snappedEditableTime（L73-84）：同一套规则，但边界由调用方给出。 */
export function snappedEditableTime(
  time: TimeInterval,
  lowerBound: TimeInterval,
  upperBound: TimeInterval,
  frameDuration: TimeInterval
): TimeInterval {
  const lower = Math.min(lowerBound, upperBound)
  const upper = Math.max(lowerBound, upperBound)
  const clamped = Math.min(Math.max(time, lower), upper)
  const halfFrame = frameDuration / 2
  if (clamped - lower <= halfFrame) return lower
  if (upper - clamped <= halfFrame) return upper
  return Math.min(Math.max(snappedToProjectFrame(clamped, frameDuration), lower), upper)
}

/** Swift stepTimeline(byFrames:)（L147-149）。 */
export function steppedTimelineTime(
  playbackTime: TimeInterval,
  frames: number,
  frameDuration: TimeInterval
): TimeInterval {
  return playbackTime + frames * frameDuration
}
