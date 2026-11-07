/**
 * 首帧等待器 —— Swift EditorPlaybackInitialFrameWaiter.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorPlaybackInitialFrameWaiter.swift（72 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - class InitialFrameMediaDataWaiter
 *       · wait(timeout:advanceInterval:)     L24-54
 *       · outputMediaDataWillChange(_:)      L56-60 → notifyMediaDataWillChange
 *       · finish(_:)                         L62-71
 *
 * 原注释（L3-8）：
 *   One-shot bridge for AVPlayerItemVideoOutput's pull notification.
 *   `requestNotificationOfMediaDataChange` has no effect unless the output has a
 *   pull delegate. Keeping the bridge on MainActor gives cancellation, timeout
 *   and delegate cleanup one serial owner without waking the editor on an 8 ms
 *   polling timer while AVFoundation prepares the first frame.
 *
 * 迁移说明：Electron 侧没有 AVPlayerItemVideoOutput，对应能力是
 * `requestVideoFrameCallback` 或主进程解码首帧回调；这里保留**一次性桥接**的语义：
 * 结果只定一次、超时与取消都收敛到同一条 `finish(false)`、完成后立刻摘掉监听。
 */

/** Swift L26 默认推进间隔。 */
export const INITIAL_FRAME_DEFAULT_ADVANCE_INTERVAL = 0.005

/** Swift L14-16：被等待的输出端口。 */
export interface InitialFrameOutputPort {
  /** 注册数据变更回调（Swift `setDelegate(_:queue:)`）；null 表示摘除。 */
  setDelegate(callback: (() => void) | null): void
  /** Swift `requestNotificationOfMediaDataChange(withAdvanceInterval:)`。 */
  requestNotificationOfMediaDataChange(advanceInterval: number): void
}

export interface InitialFrameWaiterOptions {
  output: InitialFrameOutputPort
  /** 超时计时器（注入以便测试）。返回取消函数。 */
  scheduleTimeout?: (seconds: number, callback: () => void) => () => void
  /** 取消注册（Swift `withTaskCancellationHandler` 的 onCancel）。 */
  registerCancellation?: (cancel: () => void) => void
}

/** Swift L10-72。 */
export class InitialFrameMediaDataWaiter {
  private readonly output: InitialFrameOutputPort
  private readonly scheduleTimeout: (seconds: number, callback: () => void) => () => void
  private resolvedValue: boolean | null = null
  private resolve: ((value: boolean) => void) | null = null
  private cancelTimeout: (() => void) | null = null

  constructor(options: InitialFrameWaiterOptions) {
    this.output = options.output
    this.scheduleTimeout =
      options.scheduleTimeout ??
      ((seconds, callback) => {
        const handle = setTimeout(callback, Math.max(seconds, 0) * 1000)
        return () => clearTimeout(handle)
      })
    options.registerCancellation?.(() => this.finish(false))
  }

  /** 已解析结果（Swift `resolvedValue`）。 */
  get value(): boolean | null {
    return this.resolvedValue
  }

  /**
   * Swift L24-54：超时返回 false；数据变更返回 true；取消同样返回 false。
   * 结果一旦定下就不会被后续通知改写（L63 的 guard）。
   */
  wait(
    timeoutSeconds: number,
    advanceInterval: number = INITIAL_FRAME_DEFAULT_ADVANCE_INTERVAL
  ): Promise<boolean> {
    if (this.resolvedValue != null) return Promise.resolve(this.resolvedValue)
    return new Promise<boolean>((resolve) => {
      if (this.resolvedValue != null) {
        resolve(this.resolvedValue)
        return
      }
      this.resolve = resolve
      this.output.setDelegate(() => this.notifyMediaDataWillChange())
      this.output.requestNotificationOfMediaDataChange(Math.max(advanceInterval, 0))
      this.cancelTimeout = this.scheduleTimeout(timeoutSeconds, () => this.finish(false))
    })
  }

  /** Swift L56-60：输出侧通知「媒体数据将要变化」。 */
  notifyMediaDataWillChange(): void {
    this.finish(true)
  }

  /** Swift L62-71：只定一次；定完立刻摘监听、清计时器。 */
  private finish(value: boolean): void {
    if (this.resolvedValue != null) return
    this.resolvedValue = value
    this.cancelTimeout?.()
    this.cancelTimeout = null
    this.output.setDelegate(null)
    const resolve = this.resolve
    this.resolve = null
    resolve?.(value)
  }

  /** 测试与清理用：强制按超时处理。 */
  cancel(): void {
    this.finish(false)
  }
}
