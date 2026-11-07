/**
 * Swift source: Sources/DogSCApp/EditorZoomPhaseBar.swift（70 行）@ 567fd6e
 *
 * L7-46  → ZoomPhaseAnimation / zoomPhaseSegments / zoomPhaseGradientStops / 常量
 * L50-54 → zoomPhaseSeamVisible
 * L56-69 → zoomPhaseLabelVisible / zoomPhaseLabelFrame
 *
 * 一条连续胶囊概括「进入 / 保持 / 退出」三段的实际时长占比；下面的时长滑块才是
 * 真正的编辑入口（含短片段的过渡解析）。段宽随共享 settle 弹簧变化。
 *
 * UI 载体（Capsule + LinearGradient）由 React 实现，这里只搬几何与绘制参数。
 */

/** 条带高度（Swift `.frame(height: 28)`）。 */
export const ZOOM_PHASE_BAR_HEIGHT = 28

/** 段间缝线高度（Swift `.frame(width: 1, height: 14)`）。 */
export const ZOOM_PHASE_SEAM_HEIGHT = 14

/** 图标尺寸（`EditorSymbol(icon, size: 11.5)`）。 */
export const ZOOM_PHASE_LABEL_ICON_SIZE = 11.5

/** 图标字重字号（`.font(.appUI(size: 10, weight: .semibold))`）。 */
export const ZOOM_PHASE_LABEL_ICON_FONT_SIZE = 10

/** 文案字号（`.font(.appUI(size: 11, weight: .semibold))`）。 */
export const ZOOM_PHASE_LABEL_FONT_SIZE = 11

/** 段宽超过该值才显示文案（`width > 58`），否则只留渐变。 */
export const ZOOM_PHASE_LABEL_MINIMUM_WIDTH = 58

/** 胶囊两端渐隐的不透明度（`surface.opacity(0.28)`）。 */
export const ZOOM_PHASE_EDGE_OPACITY = 0.28

/** 描边不透明度（`timelineZoomInk.opacity(0.12)`，0.5pt 发丝线）。 */
export const ZOOM_PHASE_BORDER_OPACITY = 0.12
export const ZOOM_PHASE_BORDER_WIDTH = 0.5

/** 缝线不透明度（`timelineZoomInk.opacity(0.22)`）。 */
export const ZOOM_PHASE_SEAM_OPACITY = 0.22

/** 文案前景不透明度（`timelineZoomInk.opacity(0.85)`）。 */
export const ZOOM_PHASE_LABEL_OPACITY = 0.85

/** 三段文案与图标（顺序即绘制顺序）。 */
export const ZOOM_PHASE_LABELS = [
  { title: '进入', icon: 'arrow.down.right' },
  { title: '保持', icon: 'viewfinder' },
  { title: '退出', icon: 'arrow.up.left' },
] as const

export interface ZoomPhaseAnimation {
  /** 保持段时长（Swift `animation.duration`）。 */
  readonly duration: number
  /** 进入段时长。 */
  readonly enterDuration: number
  /** 退出段时长。 */
  readonly exitDuration: number
}

export interface ZoomPhaseSegments {
  readonly total: number
  readonly enter: number
  readonly hold: number
  readonly exit: number
}

/**
 * 三段像素宽度（Swift L12-16）。
 *
 * `total = max(duration + exitDuration, 0.001)` —— 0.001 是除零保护：
 * 新建的运镜片段可能三个时长都是 0，此时条带退化为一条等分的细线而不是 NaN。
 * `hold` 单独取 `max(duration - enterDuration, 0)`：进入段被时长挤压时保持段
 * 必须归零，不能出现负宽；`exit` 用剩余量兜底，保证三段之和恒等于总宽。
 */
export function zoomPhaseSegments(width: number, animation: ZoomPhaseAnimation): ZoomPhaseSegments {
  const total = Math.max(animation.duration + animation.exitDuration, 0.001)
  const enter = width * Math.min(animation.enterDuration / total, 1)
  const hold = (width * Math.max(animation.duration - animation.enterDuration, 0)) / total
  return { total, enter, hold, exit: Math.max(width - enter - hold, 0) }
}

export interface ZoomPhaseGradientStop {
  readonly opacity: number
  readonly location: number
}

/**
 * 渐变停靠点（Swift L21-29）：两端 0.28 渐隐，进入段末尾与保持段末尾满色。
 *
 * 位置 clamp 到 1，因为 `enter + hold` 可能因浮点误差略超总宽；不 clamp
 * 会让渐变提前结束，胶囊右端出现一条硬边。
 */
export function zoomPhaseGradientStops(
  width: number,
  segments: ZoomPhaseSegments
): ZoomPhaseGradientStop[] {
  const denominator = Math.max(width, 1)
  return [
    { opacity: ZOOM_PHASE_EDGE_OPACITY, location: 0 },
    { opacity: 1, location: Math.min(segments.enter / denominator, 1) },
    { opacity: 1, location: Math.min((segments.enter + segments.hold) / denominator, 1) },
    { opacity: ZOOM_PHASE_EDGE_OPACITY, location: 1 },
  ]
}

/** 缝线可见性：两侧段都非空才画（Swift L36/L38）。 */
export function zoomPhaseSeamVisible(leftWidth: number, rightWidth: number): boolean {
  return leftWidth > 0 && rightWidth > 0
}

/** 段文案是否显示（Swift L66 `opacity(width > 58 ? 1 : 0)`）。 */
export function zoomPhaseLabelVisible(segmentWidth: number): boolean {
  return segmentWidth > ZOOM_PHASE_LABEL_MINIMUM_WIDTH
}

/** 文案容器宽度（Swift L67 `max(width - 1, 0)`，为缝线让出 1pt）。 */
export function zoomPhaseLabelFrame(segmentWidth: number): number {
  return Math.max(segmentWidth - 1, 0)
}
