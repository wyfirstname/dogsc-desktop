/**
 * 选区出现过渡 —— Swift CaptureAreaSelectionMotion.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/CaptureAreaSelectionMotion.swift（38 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - class CaptureAreaSelectionMotion   L6-38
 *       · duration               L11    → CAPTURE_AREA_SELECTION_MOTION_DURATION
 *       · start(in:update:)      L13-21 → start
 *       · stop()                 L23-27 → stop
 *       · tick(_:)               L29-37 → tick / selectionMotionProgress
 *
 * 原注释（L4-5）：
 *   A short, interruptible presentation transition. Capture geometry is owned by
 *   the selector; this clock only moves its visible frame and toolbar.
 *
 * 迁移说明：CADisplayLink 换成可注入的 `onFrame`（Electron 侧用
 * requestAnimationFrame）。`NSWorkspace.shared.accessibilityDisplayShouldReduceMotion`
 * 换成注入的 `reduceMotion`，为真时直接跳到 1 —— 不播动画。
 */

/** Swift L11：0.32s。 */
export const CAPTURE_AREA_SELECTION_MOTION_DURATION = 0.32

/**
 * Swift L30-33：`min(max((now - start) / duration, 0), 1)`，
 * 然后 ease-out cubic `1 - (1 - t)^3`；reduceMotion 时进度恒为 1。
 *
 * 原注释（L31）：Ease out without overshoot —— 选区边缘必须留在屏幕上，
 * 所以不能用带回弹的弹簧。
 */
export function selectionMotionProgress(
  elapsed: number,
  duration: number = CAPTURE_AREA_SELECTION_MOTION_DURATION,
  reduceMotion = false
): number {
  const time = Math.min(Math.max(duration === 0 ? 1 : elapsed / duration, 0), 1)
  if (reduceMotion) return 1
  return 1 - Math.pow(1 - time, 3)
}

/** 过渡是否结束（Swift L35：`progress >= 1` 时 stop）。 */
export function selectionMotionIsComplete(progress: number): boolean {
  return progress >= 1
}

/**
 * Swift L6-38 的时钟部分。原版 start 会先 stop 掉上一轮（可中断）。
 */
export class CaptureAreaSelectionMotion {
  private startedAt: number
  private update: ((progress: number) => void) | null = null
  private cancelFrame: (() => void) | null = null

  constructor(private readonly reduceMotion: () => boolean = () => false) {
    this.startedAt = 0
  }

  get isRunning(): boolean {
    return this.update != null
  }

  /**
   * Swift L13-21。
   * `nextFrame` 由调用方提供（返回取消函数），默认用 requestAnimationFrame。
   */
  start(
    update: (progress: number) => void,
    options?: {
      now?: () => number
      nextFrame?: (callback: () => void) => () => void
    }
  ): void {
    this.stop()
    this.update = update
    const now = options?.now ?? (() => performance.now() / 1000)
    this.startedAt = now()
    const nextFrame =
      options?.nextFrame ??
      ((callback: () => void) => {
        if (typeof requestAnimationFrame !== 'function') {
          // 无 rAF 的环境（主进程/测试）直接给出终态
          const handle = setTimeout(callback, 16)
          return () => clearTimeout(handle)
        }
        const handle = requestAnimationFrame(callback)
        return () => cancelAnimationFrame(handle)
      })

    // L20：立刻先推一帧 0，避免首帧闪到终态位置
    update(0)

    const loop = (): void => {
      if (this.update == null) return
      const progress = this.tick(now())
      if (this.update == null) return
      this.cancelFrame = nextFrame(loop)
      void progress
    }
    this.cancelFrame = nextFrame(loop)
  }

  /** Swift L23-27。 */
  stop(): void {
    this.cancelFrame?.()
    this.cancelFrame = null
    this.update = null
  }

  /**
   * Swift L29-37：算出进度、在进度到 1 时先 stop 再回调，
   * 保证最后一次回调拿到的是恰好 1。
   */
  tick(now: number): number {
    const progress = selectionMotionProgress(
      now - this.startedAt,
      CAPTURE_AREA_SELECTION_MOTION_DURATION,
      this.reduceMotion()
    )
    const update = this.update
    if (selectionMotionIsComplete(progress)) this.stop()
    update?.(progress)
    return progress
  }
}
