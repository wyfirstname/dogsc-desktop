/**
 * 缩略图并发许可 —— Swift EditorThumbnailPermits.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorThumbnailPermits.swift（49 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - init(limit:)     L11     → 构造
 *   - acquire()        L13-32  → acquire
 *   - release()        L34-43  → release
 *   - cancel(_:)       L45-48  → cancel
 *
 * 原注释（L3-4）：
 *   Suspends excess thumbnail work without timers. Cancellation removes queued
 *   work immediately so toggling display mode never waits for a batch to drain.
 *
 * 关键语义：`release()` 是「**转移**许可」而不是「归还计数」—— 有等待者时直接把
 * 许可交给队首，`active` 不变；只有队列空了才 `active -= 1`。
 */

/** Swift `CancellationError()`。 */
export class ThumbnailPermitCancelledError extends Error {
  constructor() {
    super('缩略图任务已取消。')
    this.name = 'ThumbnailPermitCancelledError'
  }
}

interface Waiter {
  readonly id: number
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

export interface ThumbnailPermitAcquireOptions {
  /** Swift `Task.isCancelled`。 */
  isCancelled?: () => boolean
  /** Swift `withTaskCancellationHandler` 的 onCancel 注册。 */
  registerCancellation?: (cancel: () => void) => void
}

/** Swift L5-49。 */
export class EditorThumbnailPermits {
  private active = 0
  private order: number[] = []
  private readonly waiting = new Map<number, Waiter>()
  private nextID = 1

  constructor(private readonly limit: number) {}

  get activeCount(): number {
    return this.active
  }

  get waitingCount(): number {
    return this.order.length
  }

  get permitLimit(): number {
    return this.limit
  }

  /** Swift L13-32。 */
  async acquire(options?: ThumbnailPermitAcquireOptions): Promise<void> {
    if (options?.isCancelled?.()) throw new ThumbnailPermitCancelledError()
    // L15-18：还有余量直接拿走
    if (this.active < this.limit) {
      this.active += 1
      return
    }
    const id = this.nextID++
    return new Promise<void>((resolve, reject) => {
      // L22-25：入队前再检查一次取消
      if (options?.isCancelled?.()) {
        reject(new ThumbnailPermitCancelledError())
        return
      }
      this.order.push(id)
      this.waiting.set(id, { id, resolve, reject })
      // L29-31：取消时把排队项立即摘掉，不必等整批跑完
      options?.registerCancellation?.(() => this.cancel(id))
    })
  }

  /** Swift L34-43：优先把许可转交给队首等待者。 */
  release(): void {
    while (this.order.length > 0) {
      const id = this.order.shift() as number
      const waiter = this.waiting.get(id)
      if (waiter != null) {
        this.waiting.delete(id)
        waiter.resolve()
        return
      }
    }
    this.active = Math.max(this.active - 1, 0)
  }

  /** Swift L45-48。 */
  private cancel(id: number): void {
    this.order = this.order.filter((candidate) => candidate !== id)
    const waiter = this.waiting.get(id)
    if (waiter != null) {
      this.waiting.delete(id)
      waiter.reject(new ThumbnailPermitCancelledError())
    }
  }
}
