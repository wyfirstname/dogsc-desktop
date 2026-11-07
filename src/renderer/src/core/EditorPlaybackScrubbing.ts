/**
 * Swift source: Sources/DogSCApp/EditorPlaybackScrubbing.swift（90 行）@ 567fd6e
 *
 * L10-30 → EditorScrubbingSession.begin
 * L32-45 → update
 * L47-53 → end
 * L55-81 → scheduleScrubSeekIfNeeded（单飞 + 三重代次校验）
 * L83-89 → cancelScrubScheduling
 *
 * 原注释：标尺 / 总览 / 修剪手柄的拖动刷帧机器，为满足架构行数预算从
 * `EditorPlaybackController.swift` 拆出。指针运动持有一个**便宜的逻辑时钟**：
 * 原生播放头层跟随每一次更新，而昂贵的精确 seek 等上一次完成后再追最新目标；
 * 松手那一下才是精确的。
 *
 * Windows 侧：`AVPlayer.seekTransport` 对应主进程 ffmpeg 解码器 / `<video>.currentTime`，
 * 这里用注入的 port 表达，机器本身保持纯逻辑（并发行为可断言）。
 */

/** seek 使用的时间基（Swift `preferredTimescale: 60_000`）。 */
export const SCRUB_SEEK_TIMESCALE = 60_000

/** 播放时钟夹取：非有限值归 0（Swift `EditorPlaybackClockPolicy.clampedTime`）。 */
export function playbackClampedTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0
  return Math.min(Math.max(time, 0), Math.max(duration, 0))
}

/**
 * 目标合并器：拖动期间指针每帧都来一个目标，但只保留最新的那一个。
 *
 * `takePending()` 取出即清 —— 这样 seek 完成后再次调度时，「没有新目标」
 * 就等于「追上了」，可以停手。
 */
export class ScrubSeekCoalescer {
  private target: number | null = null

  get pendingTarget(): number | null {
    return this.target
  }

  update(target: number): void {
    this.target = target
  }

  takePending(): number | null {
    const value = this.target
    this.target = null
    return value
  }

  cancel(): void {
    this.target = null
  }
}

export interface ScrubTransportPort {
  pauseTransport(): void
  cancelPendingSeeks(): void
  /** 返回是否真正完成（被取消 / 失败返回 false）。 */
  seekTransport(seconds: number): Promise<boolean>
}

export interface ScrubbingSessionOptions {
  readonly primaryPlayer?: ScrubTransportPort | null
  readonly cameraPlayer?: ScrubTransportPort | null
  /** 当前输出时间（进入拖动时的起点）。 */
  readonly outputTime: () => number
  /** 拖动前先让悬浮预览让位。 */
  readonly endHoverPreview: (restoreTransport: boolean) => void
  /** 拖动开始时清掉过期的暂停帧图，避免盖住刚落地的 scrub 帧。 */
  readonly clearPausedFrames: () => void
  /** 取消暂停帧解码。 */
  readonly cancelPausedFrameDecode: () => void
  readonly resetPlaybackAnchor: (time: number) => void
  readonly synchronizeCamera: (time: number, force: boolean) => void
  readonly advanceDiscontinuity: () => void
  /** 松手后的精确跳转。 */
  readonly seekFinally: (time: number, pausing: boolean, loadsPausedFrame: boolean) => void
}

export interface ScrubbingSessionState {
  readonly isScrubbing: boolean
  readonly latestOutputTime: number
  readonly previewTime: number | null
  readonly pendingSeek: number | null
  readonly seekInFlight: boolean
  readonly generation: number
}

/**
 * 拖动刷帧状态机。
 *
 * 三条不变量（对应 Swift L39-45 / L64-72）：
 * 1. 指针时钟**从不等待解码** —— `latestOutputTime` 立刻前进；
 * 2. 一次只允许一个 seek 在飞 —— 固定 33ms 的「取消再 seek」会把解码器
 *    饿死在密集录制上；
 * 3. 落地前必须三重校验（会话代次 / 媒体代次 / seek token），任一不符就丢弃。
 */
export class EditorScrubbingSession {
  private readonly options: ScrubbingSessionOptions
  private readonly coalescer = new ScrubSeekCoalescer()
  private active = false
  private generation_ = 0
  private seekToken_ = 0
  private latestOutputTime_ = 0
  private previewTime: number | null = null
  private seekInFlight = false
  private ended = false

  constructor(options: ScrubbingSessionOptions) {
    this.options = options
  }

  get state(): ScrubbingSessionState {
    return {
      isScrubbing: this.active,
      latestOutputTime: this.latestOutputTime_,
      previewTime: this.previewTime,
      pendingSeek: this.coalescer.pendingTarget,
      seekInFlight: this.seekInFlight,
      generation: this.generation_,
    }
  }

  /** 按下拖动（标尺 / 总览 / 裁剪手柄）：接管传输层，悬浮预览立即让位。 */
  begin(): void {
    const primary = this.options.primaryPlayer
    if (this.active || !primary) return
    this.options.endHoverPreview(false)
    this.seekToken_ += 1
    this.seekInFlight = false
    this.options.cameraPlayer?.cancelPendingSeeks()
    this.cancelScrubScheduling()
    this.active = true
    this.previewTime = this.options.outputTime()
    this.latestOutputTime_ = this.previewTime
    primary.pauseTransport()
    this.options.cameraPlayer?.pauseTransport()
    primary.cancelPendingSeeks()
    this.options.cancelPausedFrameDecode()
    // 实时输出帧继续充当视觉兜底；过期的精确暂停帧必须清掉，
    // 否则它会盖住刚落地的 scrub 帧。
    this.options.clearPausedFrames()
  }

  /** 指针移动：夹取目标 → 逻辑时钟前进 → 合并 → 按需发起单飞 seek。 */
  update(requestedTime: number, duration: number): void {
    if (!this.options.primaryPlayer) return
    if (!this.active) this.begin()
    const target = playbackClampedTime(requestedTime, duration)
    this.latestOutputTime_ = target
    this.options.resetPlaybackAnchor(target)
    this.coalescer.update(target)
    void this.scheduleSeekIfNeeded()
  }

  /** 松手：以最后一次待办目标（没有则当前输出时间）做精确 seek。 */
  end(): void {
    if (!this.active) return
    const finalTime = this.coalescer.pendingTarget ?? this.latestOutputTime_
    this.active = false
    this.cancelScrubScheduling()
    this.options.seekFinally(finalTime, true, true)
  }

  private cancelScrubScheduling(): void {
    this.generation_ += 1
    this.previewTime = null
    this.seekInFlight = false
    this.coalescer.cancel()
  }

  private async scheduleSeekIfNeeded(): Promise<void> {
    const primary = this.options.primaryPlayer
    if (!this.active || this.seekInFlight || !primary) return
    const target = this.coalescer.takePending()
    if (target === null) return
    const session = this.generation_
    this.seekToken_ += 1
    const token = this.seekToken_
    this.seekInFlight = true
    const finished = await primary.seekTransport(target)
    if (this.generation_ !== session) return
    this.seekInFlight = false
    if (!this.active || this.seekToken_ !== token) return
    if (finished) {
      this.previewTime = target
      this.options.synchronizeCamera(target, true)
      this.options.advanceDiscontinuity()
    }
    await this.scheduleSeekIfNeeded()
  }
}
