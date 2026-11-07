/**
 * 导出活动看门狗 —— Swift ExportActivityWatchdog.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/ExportActivityWatchdog.swift（54 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - init(timeout:onStall:)        L14-26  → ExportActivityWatchdog 构造
 *   - recordProgress()              L28-32  → recordProgress
 *   - cancel()                      L34-39  → cancel
 *   - checkProgress()               L41-51  → checkProgress
 *   - deinit                        L53     → dispose
 *
 * 原注释（L3-5）：
 *   Detect a stalled media pipeline independently of its potentially blocked
 *   reader queues. Reads as well as writes count: decoding a long accelerated
 *   source interval must not be mistaken for a stuck output frame.
 *
 * 迁移说明：DispatchSourceTimer 换成可注入的 `WatchdogScheduler`（主进程用
 * setInterval，测试用假时钟）。计时基准是**单调时钟**，与 Swift 的
 * `DispatchTime.now().uptimeNanoseconds` 语义一致。
 */

/** Swift L14 默认超时。 */
export const EXPORT_WATCHDOG_DEFAULT_TIMEOUT = 120

/**
 * Swift L23：`schedule(deadline: .now() + timeout, repeating: min(timeout / 2, 2))`
 */
export function watchdogRepeatInterval(timeout: number): number {
  return Math.min(timeout / 2, 2)
}

export interface WatchdogScheduler {
  /** 单调时钟，秒。 */
  now(): number
  /** 首次延迟 `delaySeconds` 后回调，之后每 `repeatSeconds` 回调；返回取消函数。 */
  schedule(delaySeconds: number, repeatSeconds: number, callback: () => void): () => void
}

export interface ExportActivityWatchdogOptions {
  /** 秒，默认 120（Swift L15）。 */
  timeout?: number
  onStall: () => void
  scheduler: WatchdogScheduler
}

/**
 * Swift L6-54。原版 `@unchecked Sendable` + NSLock；单线程 JS 下只需保证
 * `stopped` 是**单向闩锁**：一旦置位，后续 `recordProgress` 不再复活看门狗。
 */
export class ExportActivityWatchdog {
  private readonly timeout: number
  private readonly onStall: () => void
  private readonly scheduler: WatchdogScheduler
  private lastProgress: number
  private stopped = false
  private cancelScheduled: (() => void) | null

  constructor(options: ExportActivityWatchdogOptions) {
    this.timeout = options.timeout ?? EXPORT_WATCHDOG_DEFAULT_TIMEOUT
    this.onStall = options.onStall
    this.scheduler = options.scheduler
    // L11：`lastProgress` 初始为「现在」
    this.lastProgress = this.scheduler.now()
    // L23：deadline = now + timeout；重复周期 = min(timeout/2, 2)
    this.cancelScheduled = this.scheduler.schedule(
      this.timeout,
      watchdogRepeatInterval(this.timeout),
      () => this.checkProgress()
    )
  }

  /** L28-32。读与写都算进度（解码长加速区间不能当成卡住的输出帧）。 */
  recordProgress(): void {
    this.lastProgress = this.scheduler.now()
  }

  /** L34-39。 */
  cancel(): void {
    this.stopped = true
    this.cancelTimer()
  }

  /** L53 `deinit`。 */
  dispose(): void {
    this.cancelTimer()
  }

  get isStopped(): boolean {
    return this.stopped
  }

  get lastProgressTime(): number {
    return this.lastProgress
  }

  /** L41-51。 */
  checkProgress(): void {
    const elapsed = this.scheduler.now() - this.lastProgress
    const shouldStop = !this.stopped && elapsed >= this.timeout
    if (shouldStop) this.stopped = true
    if (shouldStop) {
      this.cancelTimer()
      this.onStall()
    }
  }

  private cancelTimer(): void {
    if (this.cancelScheduled) {
      this.cancelScheduled()
      this.cancelScheduled = null
    }
  }
}

/** 基于 setInterval 的默认调度器（主进程用）。 */
export function intervalWatchdogScheduler(): WatchdogScheduler {
  const started = performance.now()
  return {
    now: () => (performance.now() - started) / 1000,
    schedule: (delaySeconds, repeatSeconds, callback) => {
      let handle: ReturnType<typeof setInterval> | null = null
      const timeout = setTimeout(() => {
        callback()
        handle = setInterval(callback, Math.max(repeatSeconds, 0.001) * 1000)
      }, Math.max(delaySeconds, 0) * 1000)
      return () => {
        clearTimeout(timeout)
        if (handle != null) clearInterval(handle)
      }
    }
  }
}
