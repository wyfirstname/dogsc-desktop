/**
 * 画布休眠遮罩呈现 —— Swift EditorCanvasSleepPresentation.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorCanvasSleepPresentation.swift（46 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - class EditorCanvasSleepPresentation
 *       · opacity / animationRevision / isAnimating / pendingCompletion  L7-10
 *       · setCovered(_:reducesMotion:completion:)                        L12-33
 *       · invalidate()                                                   L35-39
 *       · finishPendingCompletion()                                      L41-45
 *
 * 原注释（L3-4）：
 *   Owns only the sleep cover animation. Playback and Metal retirement stay
 *   with their native owners; the completion releases a frozen drawable.
 *
 * 迁移说明：`withAnimation(completion:)` 换成可注入的 `FadeAnimator`
 * （React 侧用 CSS transition + transitionend，测试用同步假件）。
 * 关键不变量：**只有最新一次淡入淡出能决定 completion 何时跑**（revision 比对）。
 */

/** Swift L25：0.26s easeInOut。 */
export const CANVAS_SLEEP_FADE_DURATION = 0.26

export interface FadeAnimator {
  /**
   * 启动一次不透明度过渡；返回取消函数。
   * `durationSeconds === 0` 表示立即生效（reduce motion 时 Swift 传 nil 动画）。
   */
  animate(from: number, to: number, durationSeconds: number, completion: () => void): () => void
}

/** 默认动画器：用 requestAnimationFrame 走线性插值（视图层可直接替换成 CSS）。 */
export function rafFadeAnimator(): FadeAnimator {
  return {
    animate: (_from, _to, durationSeconds, completion) => {
      if (!(durationSeconds > 0)) {
        completion()
        return () => {}
      }
      const handle = setTimeout(completion, durationSeconds * 1000)
      return () => clearTimeout(handle)
    }
  }
}

/** Swift L5-46。 */
export class EditorCanvasSleepPresentation {
  private _opacity = 0
  private animationRevision = 0
  private isAnimating = false
  private pendingCompletion: (() => void) | null = null
  private cancelAnimation: (() => void) | null = null

  constructor(private readonly animator: FadeAnimator = rafFadeAnimator()) {}

  get opacity(): number {
    return this._opacity
  }

  get animating(): boolean {
    return this.isAnimating
  }

  /** Swift L12-33。 */
  setCovered(covered: boolean, reducesMotion: boolean, completion: () => void): void {
    this.pendingCompletion = completion
    const target = covered ? 1.0 : 0.0
    if (target === this._opacity) {
      // 同一次淡入淡出期间的第二次失焦会替换 native completion，
      // 但必须等这次淡入淡出真正结束（L16-19）。
      if (!this.isAnimating) this.finishPendingCompletion()
      return
    }

    this.animationRevision = this.animationRevision + 1
    const revision = this.animationRevision
    this.isAnimating = true
    this.cancelAnimation?.()
    const duration = reducesMotion ? 0 : CANVAS_SLEEP_FADE_DURATION
    const from = this._opacity
    this._opacity = target
    this.cancelAnimation = this.animator.animate(from, target, duration, () => {
      // L29：只有最新一次过渡的回调有效
      if (this.animationRevision !== revision) return
      this.isAnimating = false
      this.cancelAnimation = null
      this.finishPendingCompletion()
    })
  }

  /** Swift L35-39：作废在途过渡并丢弃 completion。 */
  invalidate(): void {
    this.animationRevision = this.animationRevision + 1
    this.pendingCompletion = null
    this.isAnimating = false
    this.cancelAnimation?.()
    this.cancelAnimation = null
  }

  /** Swift L41-45。 */
  private finishPendingCompletion(): void {
    const completion = this.pendingCompletion
    this.pendingCompletion = null
    completion?.()
  }
}
