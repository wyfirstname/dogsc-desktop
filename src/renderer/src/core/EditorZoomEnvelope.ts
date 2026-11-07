/**
 * 缩放包络编辑器 —— Swift EditorZoomEnvelope.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorZoomEnvelope.swift（345 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - 尺寸常量 height / plotInsets / maxScale / minimumPeak   L29-32 → 同名常量
 *   - total / curveDuration / effectiveEnter / visibleNodes   L37-50 → 同名函数
 *   - plotRect(in:)                                           L128-134
 *   - x(_:plot:) / y(_:plot:)                                 L136-143
 *   - time(atX:plot:) / magnification(atY:plot:)              L145-151
 *   - position(of:plot:) / nearestNode(to:within:)            L153-172
 *   - move(_:to:plot:)                                        L174-194
 *   - magnificationAt(_:) / curvePoints(plot:)                L198-221
 *   - drawing(plot:)（playhead + rules + 节点）               L223-238
 *   - axisLabels(plot:)（>30pt 才显示阶段名）                 L240-264
 *   - EnvelopeCurveCache.Key                                 L269-281
 *
 * 原注释（L4-8）：
 *   The shape of one zoom, drawn the way a synthesiser draws an envelope:
 *   time runs right, magnification rises (on a log scale, so 2× and 4× feel
 *   equally far apart). Drag the first node to set how long the push-in takes
 *   and how far it goes, the middle node to set how far, and the last node to
 *   set how long the pull-out takes. The dot follows the playhead.
 *
 * 迁移说明：Canvas 绘制与 HUD 文案属于视图层（React 侧实现）；本文件只保留
 * 几何、命中测试、拖拽夹取与曲线采样 —— 也就是「画在哪里、拖到几倍」的全部决策。
 */

import { clipDuration, type ZoomAnimationClip } from './ZoomAnimation'

/** Swift L29-32。 */
export const ENVELOPE_HEIGHT = 156
export const ENVELOPE_PLOT_INSETS = { top: 16, leading: 12, bottom: 26, trailing: 12 } as const
export const ENVELOPE_MAX_SCALE = 6
export const ENVELOPE_MINIMUM_PEAK = 1.05

/** Swift L66-69：悬停 22pt、开始拖拽 26pt。 */
export const ENVELOPE_HOVER_RADIUS = 22
export const ENVELOPE_DRAG_RADIUS = 26

/** Swift L231 / L247：倍数参考线（y 轴 1× 2× 3× 4× 6×）。 */
export const ENVELOPE_RULE_LEVELS = [1, 2, 3, 4, 6] as const

/** Swift L255：阶段名只在跨度 > 30pt 时显示，避免挤在一起。 */
export const ENVELOPE_MINIMUM_SPAN_LABEL_WIDTH = 30

export interface EnvelopeRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface EnvelopePoint {
  readonly x: number
  readonly y: number
}

/** Swift L27：三个可拖节点。 */
export type EnvelopeNode = 'enterEnd' | 'holdEnd' | 'exitEnd'

export const ENVELOPE_NODES: readonly EnvelopeNode[] = ['enterEnd', 'holdEnd', 'exitEnd']

/** Swift L41：`animation.duration + animation.exitDuration`。 */
export function envelopeCurveDuration(clip: ZoomAnimationClip): number {
  return clipDuration(clip) + clip.exitDuration
}

/** Swift L37-39：`frozenTotal ?? max(curveDuration, 0.001)` —— 拖动期间总时长冻结。 */
export function envelopeTotal(curveDuration: number, frozenTotal: number | null): number {
  return frozenTotal ?? Math.max(curveDuration, 0.001)
}

/**
 * Swift L42-47：
 * 进入时长为 0 且**左侧有相邻片段**时，用工程默认过渡时长（说明是延续过来的一段，
 * 不是用户真的设了 0），但不允许超过片段自身时长。
 */
export function envelopeEffectiveEnter(
  clip: ZoomAnimationClip,
  hasAdjacentPreviousClip: boolean,
  defaultZoomTransitionDuration: number
): number {
  if (clip.enterDuration <= 0.001 && hasAdjacentPreviousClip) {
    return Math.min(defaultZoomTransitionDuration, clipDuration(clip))
  }
  return clip.enterDuration
}

/** Swift L48-50：没有退出段时只画前两个节点。 */
export function envelopeVisibleNodes(clip: ZoomAnimationClip): EnvelopeNode[] {
  return clip.exitDuration > 0.001 ? [...ENVELOPE_NODES] : ['enterEnd', 'holdEnd']
}

/** Swift L128-134：绘图区最小 1pt。 */
export function envelopePlotRect(size: { width: number; height: number }): EnvelopeRect {
  return {
    x: ENVELOPE_PLOT_INSETS.leading,
    y: ENVELOPE_PLOT_INSETS.top,
    width: Math.max(size.width - ENVELOPE_PLOT_INSETS.leading - ENVELOPE_PLOT_INSETS.trailing, 1),
    height: Math.max(size.height - ENVELOPE_PLOT_INSETS.top - ENVELOPE_PLOT_INSETS.bottom, 1)
  }
}

/** Swift L136-138：时间 → x，先夹到 [0,1] 再乘宽度。 */
export function envelopeX(time: number, total: number, plot: EnvelopeRect): number {
  return plot.x + Math.min(Math.max(time / total, 0), 1) * plot.width
}

/**
 * Swift L140-143：倍数 → y，**对数刻度**（2× 与 4× 在屏幕上等距）。
 * 倍数先夹到 [0.9, maxScale + 0.4]，避免超出绘图区。
 */
export function envelopeY(magnification: number, plot: EnvelopeRect): number {
  const clamped = Math.min(Math.max(magnification, 0.9), ENVELOPE_MAX_SCALE + 0.4)
  return plot.y + plot.height - (Math.log(clamped) / Math.log(ENVELOPE_MAX_SCALE)) * plot.height
}

/** Swift L145-147。 */
export function envelopeTimeAtX(x: number, total: number, plot: EnvelopeRect): number {
  return ((x - plot.x) / plot.width) * total
}

/** Swift L149-151：y → 倍数（envelopeY 的逆）。 */
export function envelopeMagnificationAtY(y: number, plot: EnvelopeRect): number {
  return Math.exp(((plot.y + plot.height - y) / plot.height) * Math.log(ENVELOPE_MAX_SCALE))
}

/** 曲线采样回调（Swift `track.sample(at:motion:).scale`）。 */
export type EnvelopeScaleSampler = (relativeTime: number) => number

/** Swift L198-205：采样区间夹在 [0, curveDuration]，起点是片段自身的 startTime。 */
export function envelopeMagnificationAt(
  t: number,
  clip: ZoomAnimationClip,
  curveDuration: number,
  sampler: EnvelopeScaleSampler
): number {
  return sampler(clip.startTime + Math.min(Math.max(t, 0), curveDuration))
}

/** Swift L153-162。 */
export function envelopeNodePoint(
  node: EnvelopeNode,
  clip: ZoomAnimationClip,
  effectiveEnter: number,
  total: number,
  plot: EnvelopeRect,
  curveDuration: number,
  sampler: EnvelopeScaleSampler
): EnvelopePoint {
  const duration = clipDuration(clip)
  switch (node) {
    case 'enterEnd':
      return {
        x: envelopeX(effectiveEnter, total, plot),
        y: envelopeY(envelopeMagnificationAt(effectiveEnter, clip, curveDuration, sampler), plot)
      }
    case 'holdEnd':
      return {
        x: envelopeX(duration, total, plot),
        y: envelopeY(envelopeMagnificationAt(duration, clip, curveDuration, sampler), plot)
      }
    case 'exitEnd':
      return {
        x: envelopeX(duration + clip.exitDuration, total, plot),
        y: envelopeY(1, plot)
      }
  }
}

/** Swift L164-172：半径内取最近的可见节点（并列时保留先到的）。 */
export function envelopeNearestNode(
  point: EnvelopePoint,
  candidates: readonly { node: EnvelopeNode; point: EnvelopePoint }[],
  radius: number
): EnvelopeNode | null {
  let best: { node: EnvelopeNode; distance: number } | null = null
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y)
    if (distance <= radius && distance < (best?.distance ?? Infinity)) {
      best = { node: candidate.node, distance }
    }
  }
  return best?.node ?? null
}

/** Swift L174-194 的夹取结果（HUD 文案由视图层拼）。 */
export interface EnvelopeMoveResult {
  readonly enter?: number
  readonly exit?: number
  readonly scale?: number
}

/**
 * Swift L174-194：
 *   peak = clamp(magnification(atY:), 1.05, 6)
 *   enterEnd → enter = clamp(t, 0, min(duration, 3))；peak 同时写入 scale
 *   holdEnd  → 只改 scale
 *   exitEnd  → exit = clamp(t - duration, 0, 3)
 *
 * 注意「进入」的上界是 `min(片段时长, 3)`，「退出」的上界固定 3 —— 两者不对称，
 * 因为进入不能超过本体，而退出本来就是追加的一段。
 */
export function envelopeMoveResult(
  node: EnvelopeNode,
  point: EnvelopePoint,
  clip: ZoomAnimationClip,
  total: number,
  plot: EnvelopeRect
): EnvelopeMoveResult {
  const peak = Math.min(Math.max(envelopeMagnificationAtY(point.y, plot), ENVELOPE_MINIMUM_PEAK), ENVELOPE_MAX_SCALE)
  const t = envelopeTimeAtX(point.x, total, plot)
  switch (node) {
    case 'enterEnd':
      return { enter: Math.min(Math.max(t, 0), Math.min(clipDuration(clip), 3)), scale: peak }
    case 'holdEnd':
      return { scale: peak }
    case 'exitEnd':
      return { exit: Math.min(Math.max(t - clipDuration(clip), 0), 3) }
  }
}

/** Swift L208：采样步数 `max(宽度/3, 24)`。 */
export function envelopeCurveSteps(plotWidth: number): number {
  return Math.max(Math.trunc(plotWidth / 3), 24)
}

/** Swift L214-217：按步数均匀采样整段曲线。 */
export function envelopeCurvePoints(
  clip: ZoomAnimationClip,
  total: number,
  steps: number,
  plot: EnvelopeRect,
  curveDuration: number,
  sampler: EnvelopeScaleSampler
): EnvelopePoint[] {
  const points: EnvelopePoint[] = []
  for (let step = 0; step <= steps; step++) {
    const t = (step / steps) * curveDuration
    points.push({
      x: envelopeX(t, total, plot),
      y: envelopeY(envelopeMagnificationAt(t, clip, curveDuration, sampler), plot)
    })
  }
  return points
}

/** Swift L224-227：播放头只在片段区间内才画。 */
export function envelopePlayheadPoint(
  playbackTime: number,
  clip: ZoomAnimationClip,
  total: number,
  plot: EnvelopeRect,
  curveDuration: number,
  sampler: EnvelopeScaleSampler
): EnvelopePoint | null {
  const relative = playbackTime - clip.startTime
  if (relative < 0 || relative > curveDuration) return null
  return {
    x: envelopeX(relative, total, plot),
    y: envelopeY(envelopeMagnificationAt(relative, clip, curveDuration, sampler), plot)
  }
}

/** Swift L231：五条参考线的 y。 */
export function envelopeRuleLines(plot: EnvelopeRect): number[] {
  return ENVELOPE_RULE_LEVELS.map((level) => envelopeY(level, plot))
}

/** Swift L241-245：进入 / 保持 / 退出三段标签的位置。 */
export interface EnvelopeAxisSpan {
  readonly label: '进入' | '保持' | '退出'
  readonly start: number
  readonly end: number
  readonly midpoint: number
  readonly visible: boolean
}

export function envelopeAxisSpans(
  clip: ZoomAnimationClip,
  effectiveEnter: number,
  total: number,
  plot: EnvelopeRect
): EnvelopeAxisSpan[] {
  const duration = clipDuration(clip)
  const raw: { label: '进入' | '保持' | '退出'; start: number; end: number }[] = [
    { label: '进入', start: envelopeX(0, total, plot), end: envelopeX(effectiveEnter, total, plot) },
    { label: '保持', start: envelopeX(effectiveEnter, total, plot), end: envelopeX(duration, total, plot) },
    { label: '退出', start: envelopeX(duration, total, plot), end: envelopeX(duration + clip.exitDuration, total, plot) }
  ]
  return raw.map((span) => ({
    ...span,
    midpoint: (span.start + span.end) / 2,
    visible: span.end - span.start > ENVELOPE_MINIMUM_SPAN_LABEL_WIDTH
  }))
}

/**
 * Swift L269-281 的缓存键。
 *
 * 缓存的意义（L267-268）：采样已解析轨道是最贵的一步，片段、邻接关系与绘图区
 * 都没变时不必重采样。
 */
export interface EnvelopeCurveCacheKey {
  readonly trackID: string
  readonly animationID: string
  readonly motionKey: string
  readonly steps: number
  readonly plot: EnvelopeRect
  readonly total: number
}

export function envelopeCurveCacheKeyEquals(
  a: EnvelopeCurveCacheKey | null,
  b: EnvelopeCurveCacheKey | null
): boolean {
  if (a == null || b == null) return a === b
  return (
    a.trackID === b.trackID &&
    a.animationID === b.animationID &&
    a.motionKey === b.motionKey &&
    a.steps === b.steps &&
    a.total === b.total &&
    a.plot.x === b.plot.x &&
    a.plot.y === b.plot.y &&
    a.plot.width === b.plot.width &&
    a.plot.height === b.plot.height
  )
}
