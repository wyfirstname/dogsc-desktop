/**
 * 播放时间线观察者 —— Swift EditorPlaybackTimelineObserver.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorPlaybackTimelineObserver.swift（63 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - struct EditorPlaybackTimelineSnapshot   L4-9   → EditorPlaybackTimelineSnapshot
 *   - protocol EditorPlaybackTimelineObserver L11-14 → EditorPlaybackTimelineObserver
 *   - class EditorPlaybackTimelineObserverHub  L16-62 → EditorPlaybackTimelineObserverHub
 *
 * 原注释（L42-47）：
 *   Observers each wrap their layer changes in a CATransaction. Called from the
 *   display link there is no enclosing transaction, so every observer's commit
 *   was a top-level commit that ran AppKit's whole display cycle over the window
 *   (measured: ~44% of the main thread during playback). One enclosing
 *   transaction makes theirs nested: the window commits once per tick.
 *
 * 迁移说明：CATransaction 在 Electron 侧没有对应物，用 `beginBatch/endBatch`
 * 注入（React 侧可对应 `unstable_batchedUpdates`）。**同一 tick 只提交一次**这条
 * 语义必须保留 —— 这就是 44% 主线程的来历。
 */

/** Swift L4-9。 */
export interface EditorPlaybackTimelineSnapshot {
  readonly outputTime: number
  readonly duration: number
  readonly isPlaying: boolean
  /** `var allowsViewportReveal = true`：滚动跟随是否允许。 */
  readonly allowsViewportReveal: boolean
}

export function makeEditorPlaybackTimelineSnapshot(
  fields: Partial<EditorPlaybackTimelineSnapshot> & {
    outputTime: number
    duration: number
    isPlaying: boolean
  }
): EditorPlaybackTimelineSnapshot {
  return {
    outputTime: fields.outputTime,
    duration: fields.duration,
    isPlaying: fields.isPlaying,
    allowsViewportReveal: fields.allowsViewportReveal ?? true
  }
}

/** Swift L11-14。 */
export interface EditorPlaybackTimelineObserver {
  editorPlaybackTimelineDidUpdate(snapshot: EditorPlaybackTimelineSnapshot): void
}

/** 批量提交端口（对应 CATransaction.begin / setDisableActions / commit）。 */
export interface TimelineBatchTransaction {
  begin(): void
  end(): void
}

/** Swift L17-62。 */
export class EditorPlaybackTimelineObserverHub {
  private readonly boxes: { ref: { deref(): EditorPlaybackTimelineObserver | null } }[] = []

  constructor(
    private readonly transaction: TimelineBatchTransaction = {
      begin: () => {},
      end: () => {}
    }
  ) {}

  get observerCount(): number {
    return this.boxes.length
  }

  /** Swift L28-35：先移除旧注册，再立即推送当前快照。 */
  add(
    observer: EditorPlaybackTimelineObserver,
    current: EditorPlaybackTimelineSnapshot,
    makeRef?: (observer: EditorPlaybackTimelineObserver) => { deref(): EditorPlaybackTimelineObserver | null }
  ): void {
    this.remove(observer)
    this.boxes.push({ ref: (makeRef ?? defaultRef)(observer) })
    observer.editorPlaybackTimelineDidUpdate(current)
  }

  /** Swift L37-39：顺手清掉已失效的弱引用。 */
  remove(observer: EditorPlaybackTimelineObserver): void {
    for (let index = this.boxes.length - 1; index >= 0; index--) {
      const value = this.boxes[index].ref.deref()
      if (value == null || value === observer) this.boxes.splice(index, 1)
    }
  }

  /** Swift L41-62：整批包在一个事务里，最后统一清理过期观察者。 */
  publish(snapshot: EditorPlaybackTimelineSnapshot): void {
    this.transaction.begin()
    try {
      let containsExpiredObserver = false
      for (const box of this.boxes) {
        const observer = box.ref.deref()
        if (observer != null) {
          observer.editorPlaybackTimelineDidUpdate(snapshot)
        } else {
          containsExpiredObserver = true
        }
      }
      if (containsExpiredObserver) {
        for (let index = this.boxes.length - 1; index >= 0; index--) {
          if (this.boxes[index].ref.deref() == null) this.boxes.splice(index, 1)
        }
      }
    } finally {
      this.transaction.end()
    }
  }
}

/** 有 WeakRef 就用真的弱引用；宿主已回收时自动退化为强引用（测试环境安全）。 */
function defaultRef(observer: EditorPlaybackTimelineObserver): {
  deref(): EditorPlaybackTimelineObserver | null
} {
  if (typeof WeakRef === 'function') {
    const ref = new WeakRef(observer)
    return { deref: () => ref.deref() ?? null }
  }
  return { deref: () => observer }
}
