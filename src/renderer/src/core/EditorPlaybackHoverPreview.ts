/**
 * 时间线悬浮预览轴（EDT-030）—— 暂停时指针扫过时间线，画布实时显示所指帧。
 *
 * Swift source: Sources/DogSCApp/EditorPlaybackHoverPreview.swift（147 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - extension EditorPlaybackController                     L13-147
 *   - var hoverRenderTick                                    L16-30 → hoverRenderTick
 *   - updateHoverPreview(to:)                                L35-43 → canStartHoverPreview / hoverPreviewTarget
 *   - endHoverPreview()                                      L47-49 → hoverPreviewEndPlan(restoreTransport: true)
 *   - endHoverPreview(restoreTransport:)                     L54-96 → hoverPreviewEndPlan
 *   - scheduleHoverSeekIfNeeded()                            L98-108 → shouldScheduleHoverSeek
 *   - performHoverSeek(to:)                                  L110-146 → hoverSeekResultShouldPublish
 *
 * 原注释（L3-8）：
 *   暂停时指针扫过时间线任意位置（包括片段元素上方），画布实时显示所指帧；
 *   逻辑时钟（`latestOutputTime`、紫色播放头、时间码、总览）全程不动。只有
 *   传输层被物理 seek 到所指帧，悬浮结束时再异步归还播放头——下一次播放、
 *   精确暂停帧和导出位置都不被悬浮污染。
 *
 * 迁移说明：`AVPlayer.seekTransport` 对应渲染进程的 `<video>.currentTime` 或主进程
 * ffmpeg 解码器，由 port 注入；`CADisplayLink` 只在宿主侧存在。这里保留三条
 * 可断言的规则：何时允许悬浮、何时允许调度、以及一次 seek 结果是否可以发布。
 */

import { playbackClampedTime } from './EditorPlaybackScrubbing'

/** Swift L26 等多处：`preferredTimescale: 60_000`。 */
export const HOVER_SEEK_TIMESCALE = 60_000

/** 画布渲染时钟（Swift `EditorPlaybackRenderTick`）。 */
export interface EditorPlaybackRenderTick {
  readonly mediaGeneration: number
  readonly discontinuityID: number
  readonly outputTime: number
  readonly itemTime: { readonly seconds: number; readonly timescale: number }
  /** 摄像头在该时刻是否还有画面（超出自身时长即为 false）。 */
  readonly cameraIsAvailable: boolean
  readonly isPlaying: boolean
}

/**
 * Swift L16-30：
 *   guard let endpoints, let hoverPreviewTime else { return nil }
 *   let time = EditorPlaybackClockPolicy.clampedTime(hoverPreviewTime, duration: duration)
 *   return EditorPlaybackRenderTick(..., isPlaying: false)
 *
 * 只有画布消费这个时刻；播放头／时间码／总览仍读 `outputTime`。
 * `isPlaying` 恒为 false 是刻意写死的 —— 悬浮预览只可能发生在暂停态。
 */
export function hoverRenderTick(input: {
  readonly hasEndpoints: boolean
  readonly mediaGeneration: number
  readonly discontinuityID: number
  readonly hoverPreviewTime: number | null
  readonly duration: number
  readonly cameraIsAvailable: boolean
}): EditorPlaybackRenderTick | null {
  if (!input.hasEndpoints) return null
  if (input.hoverPreviewTime === null) return null
  const time = playbackClampedTime(input.hoverPreviewTime, input.duration)
  return {
    mediaGeneration: input.mediaGeneration,
    discontinuityID: input.discontinuityID,
    outputTime: time,
    itemTime: { seconds: time, timescale: HOVER_SEEK_TIMESCALE },
    cameraIsAvailable: input.cameraIsAvailable,
    isPlaying: false,
  }
}

/**
 * Swift L36：
 *   guard !isPlaying, !scrubIsActive, primaryPlayer != nil else { return }
 *
 * 播放中由播放时钟独占画布；拖动刷帧期间悬浮预览必须让位（否则两个来源
 * 抢同一个传输层）；没有播放器时无从 seek。
 */
export function canStartHoverPreview(input: {
  readonly isPlaying: boolean
  readonly scrubIsActive: boolean
  readonly hasPrimaryPlayer: boolean
}): boolean {
  return !input.isPlaying && !input.scrubIsActive && input.hasPrimaryPlayer
}

/** Swift L37-40：目标先夹到 [0, duration]，再进合并器。 */
export function hoverPreviewTarget(requestedTime: number, duration: number): number {
  return playbackClampedTime(requestedTime, duration)
}

/**
 * Swift L99-100：
 *   guard hoverSeekTask == nil, hoverSeekInFlightCount == 0,
 *         !isPlaying, !scrubIsActive else { return }
 *
 * 单飞 + 追最新：在飞的那一次落地后会再调一次这个函数，届时合并器里若还有
 * 新目标才继续。所以「没有新目标」等于「追上了」。
 */
export function shouldScheduleHoverSeek(input: {
  readonly hoverSeekTaskRunning: boolean
  readonly hoverSeekInFlightCount: number
  readonly isPlaying: boolean
  readonly scrubIsActive: boolean
}): boolean {
  if (input.hoverSeekTaskRunning) return false
  if (input.hoverSeekInFlightCount !== 0) return false
  return !input.isPlaying && !input.scrubIsActive
}

/** Swift L54-96 的结论。 */
export interface HoverPreviewEndPlan {
  /** 是否真的需要做点什么（否则直接 return，不碰任何状态）。 */
  readonly shouldInvalidate: boolean
  /** 此前确实在预览（`hoverPreviewTime != nil`）。 */
  readonly wasPreviewing: boolean
  /** 传输层当前物理位置偏离播放头，必须归还。 */
  readonly needsTransportRestore: boolean
  /** 还需要真的发起一次「seek 回播放头」。 */
  readonly shouldRestoreTransport: boolean
}

/**
 * Swift L55-73：
 *   wasPreviewing      = hoverPreviewTime != nil
 *   needsTransportRestore = wasPreviewing || hoverSeekInFlightCount > 0
 *   hasScheduledHover  = hoverSeekTask != nil || coalescer.pendingTarget != nil
 *   guard needsTransportRestore || hasScheduledHover else { return }
 *   … 作废代次、取消任务、清空合并器与在飞计数 …
 *   guard needsTransportRestore, let primaryPlayer else { return }
 *   primaryPlayer.cancelPendingSeeks()
 *   guard restoreTransport else { return }
 *
 * 注释（L60-62）说明了为什么即使 `hoverPreviewTime` 还没发布也必须作废代次：
 * 关闭悬浮后落地的结果会「复活」一帧没有参考线的悬浮画面。
 *
 * `restoreTransport: false` 由显式 seek / 按下拖动 / 起播 / 媒体重建调用 ——
 * 那些路径自己决定物理位置，悬浮预览只让位，不再归还。
 */
export function hoverPreviewEndPlan(input: {
  readonly hoverPreviewTime: number | null
  readonly hoverSeekInFlightCount: number
  readonly hoverSeekTaskRunning: boolean
  readonly coalescerPendingTarget: number | null
  readonly hasPrimaryPlayer: boolean
  readonly restoreTransport: boolean
}): HoverPreviewEndPlan {
  const wasPreviewing = input.hoverPreviewTime !== null
  const needsTransportRestore = wasPreviewing || input.hoverSeekInFlightCount > 0
  const hasScheduledHover =
    input.hoverSeekTaskRunning || input.coalescerPendingTarget !== null
  const shouldInvalidate = needsTransportRestore || hasScheduledHover
  return {
    shouldInvalidate,
    wasPreviewing,
    needsTransportRestore,
    shouldRestoreTransport:
      shouldInvalidate && needsTransportRestore && input.hasPrimaryPlayer && input.restoreTransport,
  }
}

/** 归还 seek 的目标：`clampedTime(outputTime, duration:)`（Swift L76-79）。 */
export function hoverRestoreTarget(outputTime: number, duration: number): number {
  return playbackClampedTime(outputTime, duration)
}

/**
 * Swift L128-132 + L136-139：
 *   belongsToCurrentHoverSession = hoverSeekGeneration == requestedHoverGeneration
 *   guard belongsToCurrentHoverSession, seekToken == requestedSeek,
 *         endpoints?.generation == requestedGeneration, finished else { return }
 *
 * 三重代次 + 一次落地校验。任一门不过就丢弃这次结果 —— 包括「seek 完成但
 * 期间换了媒体」这种最隐蔽的情形。
 */
export function hoverSeekResultShouldPublish(input: {
  readonly belongsToCurrentHoverSession: boolean
  readonly seekTokenMatches: boolean
  readonly generationMatches: boolean
  readonly finished: boolean
}): boolean {
  return (
    input.belongsToCurrentHoverSession &&
    input.seekTokenMatches &&
    input.generationMatches &&
    input.finished
  )
}

/**
 * Swift L131：`hoverSeekInFlightCount = max(hoverSeekInFlightCount - 1, 0)`。
 * 只有属于当前会话的落地才递减；跨会话的落地会把计数减成负数，之后
 * 调度会被永久挡住。
 */
export function hoverInFlightCountAfterLanding(
  current: number,
  belongsToCurrentSession: boolean
): number {
  if (!belongsToCurrentSession) return current
  return Math.max(current - 1, 0)
}

/** 悬浮预览的可注入宿主（对应 Swift 里的 primaryPlayer / cameraPlayer / endpoints）。 */
export interface HoverPreviewHost {
  isPlaying(): boolean
  scrubIsActive(): boolean
  duration(): number
  outputTime(): number
  cancelPendingSeeks(): void
  seekTransport(seconds: number): Promise<boolean>
}

/** 悬浮预览的小状态机（Swift L13-147 中与播放器无关的那部分）。 */
export class EditorHoverPreview {
  private previewTime: number | null = null
  private pendingTarget: number | null = null
  private inFlight = 0
  private taskRunning = false
  private generation = 0

  get hoverPreviewTime(): number | null {
    return this.previewTime
  }

  get pendingHoverTarget(): number | null {
    return this.pendingTarget
  }

  get inFlightCount(): number {
    return this.inFlight
  }

  get hoverGeneration(): number {
    return this.generation
  }

  /** Swift L35-43：进合并器（后到覆盖先到）。返回是否真的排上了。 */
  request(time: number, duration: number, host: HoverPreviewHost): boolean {
    if (!canStartHoverPreview({
      isPlaying: host.isPlaying(),
      scrubIsActive: host.scrubIsActive(),
      hasPrimaryPlayer: true,
    })) {
      return false
    }
    this.pendingTarget = hoverPreviewTarget(time, duration)
    this.taskRunning = shouldScheduleHoverSeek({
      hoverSeekTaskRunning: false,
      hoverSeekInFlightCount: this.inFlight,
      isPlaying: host.isPlaying(),
      scrubIsActive: host.scrubIsActive(),
    })
    return this.taskRunning
  }

  /** 取出待办目标（取出即清）。 */
  takePending(): number | null {
    const target = this.pendingTarget
    this.pendingTarget = null
    this.taskRunning = false
    return target
  }

  beginSeek(): number {
    this.inFlight += 1
    return this.generation
  }

  land(requestedGeneration: number): number {
    this.inFlight = hoverInFlightCountAfterLanding(
      this.inFlight,
      this.generation === requestedGeneration
    )
    return this.inFlight
  }

  publish(time: number): void {
    this.previewTime = time
  }

  /** Swift L54-96：按计划作废代次并清场。返回是否清掉了预览时刻。 */
  end(restoreTransport: boolean, host: HoverPreviewHost): HoverPreviewEndPlan {
    const plan = hoverPreviewEndPlan({
      hoverPreviewTime: this.previewTime,
      hoverSeekInFlightCount: this.inFlight,
      hoverSeekTaskRunning: this.taskRunning,
      coalescerPendingTarget: this.pendingTarget,
      hasPrimaryPlayer: true,
      restoreTransport,
    })
    if (!plan.shouldInvalidate) return plan
    this.generation += 1
    this.taskRunning = false
    this.pendingTarget = null
    this.inFlight = 0
    if (plan.wasPreviewing) this.previewTime = null
    if (plan.needsTransportRestore) host.cancelPendingSeeks()
    return plan
  }
}
