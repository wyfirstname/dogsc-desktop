/**
 * 导出进度中继 —— Swift ExportProgressRelay.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/ExportProgressRelay.swift（85 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐结构对照（Swift 行号 → 本文件）：
 *   - struct ExportProgressCoalescer   L7-41  → ExportProgressCoalescer
 *       · submit(_:)                            L12-18
 *       · takePendingForDelivery()              L20-29
 *       · invalidate()                          L31-35
 *       · clamped(_:)                           L37-40
 *   - final class ExportProgressRelay  L47-85 → ExportProgressRelay
 *
 * 原注释（L4-6）：
 *   Pure state machine for coalescing worker progress without losing the newest
 *   value. Keeping scheduling outside this value makes its cancellation and
 *   latest-value semantics deterministic.
 *
 * 原注释（L43-46）：
 *   The renderer may complete frames faster than real time; queuing one
 *   MainActor task per frame would make progress reporting compete with the
 *   encoder and repeatedly rebuild the complete export sheet.
 */

/** Swift L7-41。 */
export class ExportProgressCoalescer {
  private _latestValue: number | null = null
  private _deliveryIsScheduled = false
  private _isActive = true

  get latestValue(): number | null {
    return this._latestValue
  }

  get deliveryIsScheduled(): boolean {
    return this._deliveryIsScheduled
  }

  get isActive(): boolean {
    return this._isActive
  }

  /**
   * Swift L12-18：返回 true 表示「调用方需要安排一次投递」。
   * 已经安排过就不再重复安排 —— 最新值已被覆盖进 `latestValue`。
   */
  submit(value: number): boolean {
    if (!this._isActive) return false
    this._latestValue = clampProgress(value)
    if (this._deliveryIsScheduled) return false
    this._deliveryIsScheduled = true
    return true
  }

  /**
   * Swift L20-29：取出待投递值并清空。
   * 未激活或没安排投递时，顺手把残留值清掉（避免陈旧值在重新激活后漏出）。
   */
  takePendingForDelivery(): number | null {
    if (!this._isActive || !this._deliveryIsScheduled) {
      this._deliveryIsScheduled = false
      this._latestValue = null
      return null
    }
    this._deliveryIsScheduled = false
    const value = this._latestValue
    this._latestValue = null
    return value
  }

  /** Swift L31-35。 */
  invalidate(): void {
    this._isActive = false
    this._latestValue = null
    this._deliveryIsScheduled = false
  }

  /** Swift L37-40：非有限值按 0，随后夹到 [0,1]。 */
  private static clamped(value: number): number {
    return clampProgress(value)
  }
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}

/** Swift L54-64 的节流间隔（纳秒 → 毫秒）。 */
export function exportProgressDeliveryDelayNanoseconds(maximumUpdatesPerSecond: number): number {
  const updatesPerSecond = Math.max(Number.isFinite(maximumUpdatesPerSecond) ? maximumUpdatesPerSecond : 15, 1)
  return Math.round(1_000_000_000 / updatesPerSecond)
}

/** Swift L47-85。 */
export class ExportProgressRelay {
  private readonly state = new ExportProgressCoalescer()
  private readonly deliveryDelayNanoseconds: number
  private readonly delivery: (value: number) => void
  private pendingTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: {
    maximumUpdatesPerSecond?: number
    delivery: (value: number) => void
  }) {
    this.deliveryDelayNanoseconds = exportProgressDeliveryDelayNanoseconds(
      options.maximumUpdatesPerSecond ?? 15
    )
    this.delivery = options.delivery
  }

  get deliveryDelayMilliseconds(): number {
    return this.deliveryDelayNanoseconds / 1_000_000
  }

  /** Swift L66-72：只有第一个值会真正安排投递。 */
  submit(value: number): void {
    const shouldSchedule = this.state.submit(value)
    if (!shouldSchedule) return
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      this.deliverPending()
    }, this.deliveryDelayMilliseconds)
  }

  /** Swift L74-76。 */
  invalidate(): void {
    this.state.invalidate()
    if (this.pendingTimer != null) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
  }

  /** 供测试与关闭时使用：立即投递一次（不等待节流窗口）。 */
  flush(): void {
    if (this.pendingTimer != null) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
    this.deliverPending()
  }

  /** Swift L79-84。 */
  private deliverPending(): void {
    const value = this.state.takePendingForDelivery()
    if (value == null) return
    this.delivery(value)
  }
}
