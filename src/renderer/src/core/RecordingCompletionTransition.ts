/**
 * 录制完成过渡 —— 一条有限时钟同时驱动窗口轮廓与两层页面。
 *
 * Swift source: Sources/DogSCApp/RecordingCompletionTransition.swift（137 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - final class RecordingCompletionTransition        L9-86
 *   - start(window:surface:from:to:targetFrame:…)      L16-68 → completionTransitionDuration / …Geometry / …Frame
 *   - stop()                                           L70-75 → 状态清理
 *   - @objc tick(_:)                                   L77-85 → completionTransitionTick
 *   - final class RecordingCompletionSurfaceView       L91-137 → RECORDING_COMPLETION_CARD_RADIUS / layoutCards
 *   - setDecisionView(_:)                              L116-121 → 单张决策页
 *   - layoutCards()                                    L128-136 → recordingCompletionCardOrigins
 *
 * 原注释（L5-7）：
 *   One finite clock drives both the window contour and the two page layers.
 *   A fixed, monotonic ease accelerates then settles once. Both pages overlap
 *   throughout the handoff; there is no empty frame or spring tail.
 *
 * 迁移说明：`CADisplayLink` + `NSWindow.setFrame` + `NSView.alphaValue` 在 Windows
 * 由 `requestAnimationFrame` + `BrowserWindow.setBounds` + CSS opacity 实现。
 * 这里保留三件纯逻辑：时长决策、进度曲线、帧插值。窗口阴影失效
 * （`window.invalidateShadow()`）在 Electron 侧无对应操作，属宿主职责。
 */

/** Swift L12：默认时长。 */
export const RECORDING_COMPLETION_DURATION = 0.32

/** Swift L22：降低动态效果时的时长。 */
export const RECORDING_COMPLETION_REDUCED_DURATION = 0.14

/** Swift L93 / L102：卡片圆角。背景层与裁剪视口共用同一个值。 */
export const RECORDING_COMPLETION_CARD_RADIUS = 28

/**
 * Swift L21-22：
 *   let reducesMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
 *   duration = reducesMotion ? 0.14 : 0.32
 */
export function completionTransitionDuration(reducesMotion: boolean): number {
  return reducesMotion ? RECORDING_COMPLETION_REDUCED_DURATION : RECORDING_COMPLETION_DURATION
}

/**
 * Swift L40-44：
 *   let time = CGFloat(min(max(elapsed / transitionDuration, 0), 1))
 *   let remaining = 1 - time
 *   let progress = 1 - remaining^4 * (1 + 4 * time)
 *
 * 这是 1 - (1-t)^4(1+4t)。导数 20t(1-t)^3 非负、在 t=1/4 处最大、
 * 两端都为零 —— 加速后恰好停住，没有过冲也没有回摆。
 * 注释 L42-43 明确写出了这个性质，属于行为契约，不是实现细节。
 */
export function completionTransitionProgress(time: number): number {
  const t = clampUnit(time)
  const remaining = 1 - t
  return 1 - remaining * remaining * remaining * remaining * (1 + 4 * t)
}

/**
 * Swift L45：`let geometry = reducesMotion ? 1 : progress`。
 * 降低动态效果时几何**瞬间**到位，只有透明度仍然渐变。
 */
export function completionTransitionGeometry(time: number, reducesMotion: boolean): number {
  if (reducesMotion) return 1
  return completionTransitionProgress(time)
}

/** Swift L78：`min(max(CACurrentMediaTime() - startedAt, 0), duration)`。 */
export function completionTransitionElapsed(
  startedAt: number,
  now: number,
  duration: number
): number {
  const raw = now - startedAt
  if (!Number.isFinite(raw)) return 0
  const upper = Number.isFinite(duration) ? duration : RECORDING_COMPLETION_DURATION
  return Math.min(Math.max(raw, 0), upper)
}

/** 归一化到 [0, 1] 的进度时间。 */
export function completionTransitionTime(elapsed: number, duration: number): number {
  if (!(duration > 0)) return 1
  return clampUnit(elapsed / duration)
}

export interface CompletionTransitionRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Swift L46-50：四边同时插值。
 *   x: start.minX + (target.minX - start.minX) * geometry
 *   …（y / width / height 同形）
 */
export function completionTransitionFrame(
  start: CompletionTransitionRect,
  target: CompletionTransitionRect,
  geometry: number
): CompletionTransitionRect {
  const g = Number.isFinite(geometry) ? geometry : 0
  return {
    x: start.x + (target.x - start.x) * g,
    y: start.y + (target.y - start.y) * g,
    width: start.width + (target.width - start.width) * g,
    height: start.height + (target.height - start.height) * g,
  }
}

/**
 * Swift L56-57：两层页面始终互补。
 *   outgoing.alphaValue = 1 - progress
 *   incoming.alphaValue = progress
 * 两条不透明度之和恒为 1 —— 交接期间没有空帧，这与几何是否被缩短（降低动态效果）无关。
 */
export function completionTransitionAlphas(progress: number): {
  readonly outgoing: number
  readonly incoming: number
} {
  const p = clampUnit(progress)
  return { outgoing: 1 - p, incoming: p }
}

/** 一帧的完整计算结果。 */
export interface CompletionTransitionFrame {
  readonly elapsed: number
  readonly time: number
  readonly progress: number
  readonly geometry: number
  readonly frame: CompletionTransitionRect
  readonly outgoingAlpha: number
  readonly incomingAlpha: number
  /** Swift L80：`if elapsed >= duration` → 调 completion 并 stop()。 */
  readonly finished: boolean
}

/** Swift L38-60 + L77-85 的一帧。 */
export function completionTransitionFrameAt(input: {
  readonly elapsed: number
  readonly duration: number
  readonly reducesMotion: boolean
  readonly startFrame: CompletionTransitionRect
  readonly targetFrame: CompletionTransitionRect
}): CompletionTransitionFrame {
  const duration = input.duration > 0 ? input.duration : RECORDING_COMPLETION_DURATION
  const time = completionTransitionTime(input.elapsed, duration)
  const progress = completionTransitionProgress(time)
  const geometry = input.reducesMotion ? 1 : progress
  const alphas = completionTransitionAlphas(progress)
  return {
    elapsed: Math.min(Math.max(input.elapsed, 0), duration),
    time,
    progress,
    geometry,
    frame: completionTransitionFrame(input.startFrame, input.targetFrame, geometry),
    outgoingAlpha: alphas.outgoing,
    incomingAlpha: alphas.incoming,
    finished: input.elapsed >= duration,
  }
}

/**
 * Swift L28-32：起始状态。
 * outgoing 完全可见、incoming 完全透明，两者都在位（isHidden = false）——
 * 否则第一次布局就会露出空白。
 */
export const COMPLETION_TRANSITION_INITIAL_STATE = {
  outgoingAlpha: 1,
  incomingAlpha: 0,
  outgoingHidden: false,
  incomingHidden: false,
} as const

/**
 * Swift L128-136：
 *   background.frame = bounds
 *   viewport.frame = bounds
 *   resultView.setFrameOrigin(.zero)
 *   decisionView?.setFrameOrigin(.zero)
 *
 * 两张页面都贴**底边**对齐、各用自己的自然高度：展开时预览向上长出来，
 * 而不是把动作按钮沿页面上沿移动的下边缘拖拽/裁切。
 */
export function recordingCompletionCardOrigins(input: {
  readonly bounds: CompletionTransitionRect
}): { readonly background: CompletionTransitionRect; readonly viewport: CompletionTransitionRect; readonly resultOrigin: { x: 0; y: 0 } } {
  const frame: CompletionTransitionRect = {
    x: input.bounds.x,
    y: input.bounds.y,
    width: input.bounds.width,
    height: input.bounds.height,
  }
  return { background: frame, viewport: { ...frame }, resultOrigin: { x: 0, y: 0 } }
}

/** Swift L63-67：run loop 模式。描述性常量，供宿主决定 timer 归属。 */
export const COMPLETION_TRANSITION_RUN_LOOP_MODES: readonly string[] = ['common', 'modalPanel']

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}
