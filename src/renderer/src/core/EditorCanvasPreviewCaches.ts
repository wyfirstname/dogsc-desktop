/**
 * 画布预览缓存 —— 播放轨道、效果预热计划、裁切源帧、动画帧计划四层。
 *
 * Swift source: Sources/DogSCApp/EditorCanvasPreviewCaches.swift（335 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorCanvasPlaybackTracks                      L11-16  → EditorCanvasPlaybackTracks
 *   - class EditorCanvasPlaybackTrackCache                   L18-66
 *     · 四条轨道各自「片段变了才重建」                        L41-58  → editorCanvasTrackNeedsRebuild
 *     · zoom 额外看 outputDuration                            L42-46  → editorCanvasZoomTrackNeedsRebuild
 *   - class EditorCanvasEffectPrewarmPlanCache               L70-90  → editorCanvasPrewarmPlanCount
 *   - class EditorCanvasCropSourceFrameCache                 L96-126 → editorCanvasCropFrameReusable
 *   - class EditorCanvasPlaybackPlanCache                    L136-334
 *     · prepare（播放/交互时停手但保留句柄）                  L161-202 → editorCanvasShouldStopPreparation
 *     · frame（代数校验 + 时间取整到帧号）                     L204-214 → editorCanvasFrameIndex
 *     · startPreparation（180ms 静默门 + 8 帧一批）            L224-278 → EDITOR_CANVAS_PLAN_*
 *     · install / finishPreparation（双条件校验）              L280-299 → editorCanvasInstallAllowed
 *     · animationFrameRange（8s 地平线 + 0.2 提前 + 2.5 上限） L301-333 → editorCanvasAnimationFrameRange
 *
 * 原注释（L4-10）：
 *   Keeps the indexed playback tracks coherent with one exact project
 *   snapshot without publishing another SwiftUI state change. The previous
 *   `onChange` chain rendered once with the new project plus stale tracks, then
 *   rebuilt each changed track and rendered a second time. Timeline gestures
 *   therefore paid two layout/render passes and could briefly evaluate a mixed
 *   frame.
 *
 * 原注释（L68-69）：
 *   Cache only a few semantic plans, never decoded frames or full-size pixels.
 *
 * 原注释（L128-135）：
 *   A bounded, cancellable cache for the exact scene plans needed by the next
 *   authored animation interval. It deliberately caches no decoded media and no
 *   full-canvas pixel buffers: a handful of 5K BGRA frames would consume
 *   hundreds of megabytes.
 *
 * 原注释（L158-160）：
 *   Prepare only while the editor is stationary. Starting playback keeps
 *   already completed entries but immediately stops background work, so the
 *   cache can never compete with a frame that has to be shown now.
 *
 * 原注释（L323-325）：
 *   Most authored enters/returns complete within a second. A 2.5-second hard cap
 *   covers the expensive transition and nearby overlap without turning this
 *   lightweight plan cache into an unbounded timeline copy.
 *
 * 迁移说明：`@MainActor final class` → 普通类 + 显式代数。这里保留六件纯逻辑：
 * 四条轨道的重建判定、帧号换算、安装前的双条件校验、
 * 动画帧区间的三档夹取、以及「播放中保留句柄但不推进」的决策。
 */

// ---------------------------------------------------------------- 播放轨道

/** Swift L11-16：一次求值要的四条索引轨道。 */
export interface EditorCanvasPlaybackTracks {
  readonly zoom: unknown
  readonly screenMotion: unknown
  readonly cameraMotion: unknown
  readonly stickers: unknown
}

/**
 * Swift L42：缩放轨道必须同时看片段与**输出时长**。
 *
 * 片段没变但时长变了（比如删掉了最后一段视频）时，`ZoomAnimationTrack`
 * 里的「片段落在第几秒」索引会全部错位，所以必须重建。
 * 其余三条轨道只看片段本身，因为它们的索引不依赖总时长。
 */
export function editorCanvasZoomTrackNeedsRebuild(input: {
  readonly clipsChanged: boolean
  readonly durationChanged: boolean
}): boolean {
  return input.clipsChanged || input.durationChanged
}

/**
 * Swift L47-58：其余三条轨道只看片段是否变化。
 *
 * 贴图轨道尤其贵：注释（L55 附近）说明 `StickerTransitionTrack` 的构造要
 * 扫描全部片段建立进入时间索引，每帧重建会让 60 Hz 预览明显变慢。
 */
export function editorCanvasTrackNeedsRebuild(clipsChanged: boolean): boolean {
  return clipsChanged
}

/** Swift L41：四条轨道的重建顺序（与 `EditorCanvasPlaybackTracks` 的字段顺序一致）。 */
export const EDITOR_CANVAS_TRACK_ORDER = ['zoom', 'screenMotion', 'cameraMotion', 'stickers'] as const

// ---------------------------------------------------------------- 预热计划

/**
 * Swift L86：预热计划 = 每个预热时刻一个渲染计划。
 *
 * `PreviewAnimationPreparation.prewarmTimes(...)` 决定取哪些时刻，
 * 这里只负责把它们的数量对齐到计划的条数 —— 两者必须相等，
 * 否则调用方按下标取计划会错位。
 */
export function editorCanvasPrewarmPlanCount(times: readonly number[]): number {
  return times.length
}

/**
 * Swift L85：输入（求值上下文 + 时刻数组）相等就复用上一份计划。
 *
 * 复用是必须的：悬停/焦点变化会频繁重建 body，如果每次都重新求值
 * 场景图，鼠标在面板上划过就会掉帧。
 */
export function editorCanvasPrewarmReuses(input: {
  readonly contextEqual: boolean
  readonly timesEqual: boolean
}): boolean {
  return input.contextEqual && input.timesEqual
}

// ---------------------------------------------------------------- 裁切源帧

/**
 * Swift L113-120：裁切源帧的复用三条件 —— 归一化工程、尺寸、源比例。
 *
 * 归一化工程里已经把裁切草稿剥掉了（所以拖动把手不会让这份缓存失效），
 * 但尺寸与源比例变了必须重建：同样的工程在 800×450 与 1600×900 上
 * 产出的源帧像素不同。
 */
export function editorCanvasCropFrameReusable(input: {
  readonly projectEqual: boolean
  readonly sizeEqual: boolean
  readonly aspectEqual: boolean
  readonly hasCachedFrame: boolean
}): boolean {
  return input.projectEqual && input.sizeEqual && input.aspectEqual && input.hasCachedFrame
}

// ---------------------------------------------------------------- 帧计划缓存

/**
 * Swift L237：启动前先静默 180 毫秒。
 *
 * 注释（L234-236）解释：不要对每个检查器的微小改动都反应。短暂的静默门
 * 让用户先完成手势或直接按播放 —— 这两种动作都会在任务消耗 CPU 之前取消它。
 */
export const EDITOR_CANVAS_PLAN_IDLE_GATE_MS = 180

/** Swift L244 / L255：每批 8 帧，装完让出一次。 */
export const EDITOR_CANVAS_PLAN_BATCH_SIZE = 8

/**
 * Swift L308：只看未来 8 秒内的动画区间。
 *
 * 8 秒足够覆盖用户「看着画面等下一段动画」的耐心，同时把一次预热的帧数
 * 限制在 8 × 60 = 480 帧以内 —— 再多就会和实时出帧抢 CPU。
 */
export const EDITOR_CANVAS_PLAN_HORIZON_SECONDS = 8

/** Swift L322：区间起点前 0.20 秒就开始预热（进入动画的前摇）。 */
export const EDITOR_CANVAS_PLAN_LEAD_SECONDS = 0.2

/** Swift L328：区间终点后也留 0.20 秒（返回动画的余波）。 */
export const EDITOR_CANVAS_PLAN_TRAIL_SECONDS = 0.2

/** Swift L328：最短跨度 0.50 秒（太短的区间也至少预热半秒，够画一次淡入）。 */
export const EDITOR_CANVAS_PLAN_MINIMUM_SPAN_SECONDS = 0.5

/** Swift L328：最长跨度 2.50 秒的硬上限（注释 L323-325）。 */
export const EDITOR_CANVAS_PLAN_MAXIMUM_SPAN_SECONDS = 2.5

/**
 * Swift L204-213：输出时刻 → 帧号。
 *
 * `round(max(t, 0) × max(fr, 1))` —— 负数夹到 0、帧率下限 1。
 *
 * 负数夹到 0 而不是保留负号：负时刻在时间线上是「片段之前的空白」，
 * 那里没有帧可读，夹到第 0 帧至少能显示首帧。
 */
export function editorCanvasFrameIndex(outputTime: number, frameRate: number): number {
  if (!Number.isFinite(outputTime)) return 0
  const rate = Number.isFinite(frameRate) ? Math.max(frameRate, 1) : 1
  return Math.round(Math.max(outputTime, 0) * rate)
}

/**
 * Swift L208：句柄的代数必须与当前代数一致。
 *
 * 代数在每次 `invalidate` / `startPreparation` 时自增，所以一个旧句柄
 * 在新一轮准备开始后立刻失效 —— 调用方不会读到上一轮残留的帧。
 */
export function editorCanvasHandleIsCurrent(handleGeneration: number, currentGeneration: number): boolean {
  return handleGeneration === currentGeneration
}

/**
 * Swift L161-202：准备阶段的三种走法。
 *
 *   - 上下文变了 → 先全清（`invalidate`）
 *   - 正在播放或正在交互 → 取消后台任务；有可用的旧帧就返回句柄，否则 null
 *   - 都不是 → 按需启动准备
 *
 * 「播放中保留句柄」这一段（L184-192）是刻意的：播放头前进会改变
 * **预期**的缓存区间，但已经准备好的条目仍然有效。丢掉句柄会让刚准备好的
 * 那批帧白费，而播放本身就会消耗它们。
 */
export type EditorCanvasPreparationStep =
  | 'invalidate-then-stop'
  | 'keep-handle-while-playing'
  | 'stop-without-handle'
  | 'start-preparation'

export function editorCanvasPreparationStep(input: {
  readonly contextChanged: boolean
  readonly isPlaying: boolean
  readonly isInteracting: boolean
  readonly hasUsableFrames: boolean
}): EditorCanvasPreparationStep {
  const busy = input.isPlaying || input.isInteracting
  if (input.contextChanged && busy) return 'invalidate-then-stop'
  if (busy) return input.hasUsableFrames ? 'keep-handle-while-playing' : 'stop-without-handle'
  return 'start-preparation'
}

/** Swift L177-180 / L246：播放或交互时必须停掉后台任务。 */
export function editorCanvasShouldStopPreparation(input: {
  readonly isPlaying: boolean
  readonly isInteracting: boolean
}): boolean {
  return input.isPlaying || input.isInteracting
}

/** Swift L188：播放中要复用句柄，还要求求值上下文仍然一致。 */
export function editorCanvasCanKeepHandleWhileBusy(input: {
  readonly contextStillMatches: boolean
  readonly frameCount: number
}): boolean {
  return input.contextStillMatches && input.frameCount > 0
}

/**
 * Swift L195：什么时候需要（重新）启动准备。
 *
 * 两个条件：输入变了，或者「没有任务在跑但帧数还不够」。
 *
 * 第二个条件补的是「上次任务被取消」这种情况 —— 取消后 `preparationTask`
 * 为 nil，但帧只装了一半，此时不重新启动就永远缺那几帧。
 */
export function editorCanvasShouldStartPreparation(input: {
  readonly inputChanged: boolean
  readonly taskIsNil: boolean
  readonly frameCount: number
  readonly requestedFrameCount: number
}): boolean {
  if (input.inputChanged) return true
  return input.taskIsNil && input.frameCount < input.requestedFrameCount
}

/**
 * Swift L285-286 / L296-297：安装与收尾的双条件校验。
 *
 * 代数要对（这一轮还是这一轮），输入也要对（区间没被换掉）。
 * 只校验代数会漏掉「同一代数内输入变了」的情况，只校验输入会漏掉
 * 「另一轮恰好用同一份输入」的情况。
 */
export function editorCanvasInstallAllowed(input: {
  readonly requestedGeneration: number
  readonly currentGeneration: number
  readonly inputMatches: boolean
}): boolean {
  return input.requestedGeneration === input.currentGeneration && input.inputMatches
}

/**
 * Swift L228：输入变了才清空帧；输入没变就保留已完成的。
 *
 * `removeAll(keepingCapacity: true)` 与 `false` 的差别只是内存，
 * 但保不保留内容决定了「改了一点点参数要不要从头预热」。
 */
export function editorCanvasClearsFramesOnStart(inputChanged: boolean): boolean {
  return inputChanged
}

/** Swift L230：已完成的下标集合 —— 跳过它们，只补缺的。 */
export function editorCanvasCompletedIndices(indices: readonly number[]): Set<number> {
  return new Set(indices)
}

/** Swift L248：已完成的下标要跳过（不然重复求值一遍场景图）。 */
export function editorCanvasShouldDecodeIndex(index: number, completed: ReadonlySet<number>): boolean {
  return !completed.has(index)
}

/** Swift L249：帧号 → 时刻 `index / frameRate`。 */
export function editorCanvasFrameTime(index: number, frameRate: number): number {
  const rate = Number.isFinite(frameRate) ? Math.max(frameRate, 1) : 1
  return index / rate
}

/** Swift L266：最后一批只在「非空且未被取消」时才安装。 */
export function editorCanvasShouldInstallFinalBatch(input: {
  readonly batchCount: number
  readonly cancelled: boolean
}): boolean {
  return input.batchCount > 0 && !input.cancelled
}

/**
 * Swift L216-222：`invalidate()` 的四步。
 *
 * 代数自增、取消任务、清输入、清帧。顺序上代数先增 —— 这样即使取消
 * 有延迟，已经在途的安装也会被代数校验挡掉。
 */
export const EDITOR_CANVAS_INVALIDATE_ORDER = [
  'bumpGeneration',
  'cancelPreparation',
  'clearInput',
  'removeFrames',
] as const

/**
 * Swift L207-214：`frames[index]` 直接取，取不到返回 nil。
 *
 * 不做「就近取一帧」的回退：预热的语义是「这一段要连续出帧」，
 * 就近回退会在区间边界上突然跳一下，比缺失更难察觉。
 */
export function editorCanvasFrameOrNothing<T>(
  frames: ReadonlyMap<number, T>,
  index: number
): T | null {
  const frame = frames.get(index)
  return frame === undefined ? null : frame
}

// ---------------------------------------------------------------- 帧区间

/**
 * Swift L301-333：算出「接下来该预热的帧号区间」。
 *
 * 五步：
 *   1. 时长非正 → 没有区间
 *   2. 当前时刻夹到 `[0, duration]`（非有限按 0）
 *   3. 地平线 `min(now + 8, duration)`
 *   4. 在所有区间里找「第一个与 `(now, horizon]` 相交的」，按起点升序、
 *      起点相同按终点升序
 *   5. 起点 = `max(now, interval.start - 0.2)`；终点 =
 *      `min(duration, clamp(interval.end + 0.2, start + 0.5, start + 2.5))`
 *
 * 第 4 步的 `end > now` 用严格大于：正好在 `now` 结束的区间已经没有
 * 可预热的余量了。`start <= horizonEnd` 用小于等于：正好从地平线开始的
 * 区间仍然值得准备（用户可能马上拖到那儿）。
 */
export function editorCanvasAnimationFrameRange(input: {
  readonly requestedTime: number
  readonly duration: number
  readonly intervals: readonly { readonly start: number; readonly end: number }[]
  readonly frameRate: number
}): { readonly firstFrame: number; readonly lastFrame: number } | null {
  const duration = Number.isFinite(input.duration) ? Math.max(input.duration, 0) : 0
  if (!(duration > 0)) return null

  const requested = Number.isFinite(input.requestedTime) ? input.requestedTime : 0
  const now = Math.min(Math.max(requested, 0), duration)
  const horizonEnd = Math.min(now + EDITOR_CANVAS_PLAN_HORIZON_SECONDS, duration)

  const interval = editorCanvasSelectInterval(input.intervals, now, horizonEnd)
  if (interval === null) return null

  const frameRate = Number.isFinite(input.frameRate) ? Math.max(input.frameRate, 1) : 1
  const frameDuration = 1 / frameRate
  const start = Math.max(now, interval.start - EDITOR_CANVAS_PLAN_LEAD_SECONDS)
  const end = Math.min(
    duration,
    Math.min(
      Math.max(interval.end + EDITOR_CANVAS_PLAN_TRAIL_SECONDS, start + EDITOR_CANVAS_PLAN_MINIMUM_SPAN_SECONDS),
      start + EDITOR_CANVAS_PLAN_MAXIMUM_SPAN_SECONDS
    )
  )
  const firstFrame = Math.max(Math.floor(start / frameDuration), 0)
  const lastFrame = Math.max(Math.ceil(end / frameDuration), firstFrame)
  return { firstFrame, lastFrame }
}

/**
 * Swift L312-317：挑出要预热的那个区间。
 *
 * 过滤条件 + `min(by:)`：先按起点升序，起点相同再按终点升序。
 * 取最早的那个是因为它最可能是用户「马上就要看到」的动画。
 */
export function editorCanvasSelectInterval(
  intervals: readonly { readonly start: number; readonly end: number }[],
  now: number,
  horizonEnd: number
): { readonly start: number; readonly end: number } | null {
  let best: { readonly start: number; readonly end: number } | null = null
  for (const interval of intervals) {
    if (!(interval.end > now)) continue
    if (!(interval.start <= horizonEnd)) continue
    if (best === null) {
      best = interval
      continue
    }
    if (interval.start < best.start) {
      best = interval
    } else if (interval.start === best.start && interval.end < best.end) {
      best = interval
    }
  }
  return best
}

/** Swift L332 / L195：区间的帧数（闭区间，含两端）。 */
export function editorCanvasFrameRangeCount(range: {
  readonly firstFrame: number
  readonly lastFrame: number
}): number {
  return Math.max(range.lastFrame - range.firstFrame + 1, 0)
}

/** Swift L195：`frames.count < nextInput.frameRange.count` 这个比较用的是闭区间帧数。 */
export function editorCanvasFramesIncomplete(input: {
  readonly frameCount: number
  readonly firstFrame: number
  readonly lastFrame: number
}): boolean {
  return input.frameCount < editorCanvasFrameRangeCount(input)
}

/**
 * 这个缓存的边界说明（注释 L68-69 / L128-135）：只缓存语义计划，
 * 永不缓存解码后的整幅像素。
 *
 * 一张 5K BGRA 帧约 100 MB，几十帧就是几个 GB；而这套缓存的实际收益
 * 来自「省掉项目/轨道/运动的重复求值」，与像素无关。
 */
export const EDITOR_CANVAS_PLAN_CACHES_PIXELS = false
