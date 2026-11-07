/**
 * 录制面板显隐过渡 —— Swift RecorderPanelTransition.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/RecorderPanelTransition.swift（57 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - show(_:animated:)     L11-19
 *   - hide(_:animated:)     L21-38
 *   - animate(...)          L40-56 → panelTransitionDuration / PanelWindowPort
 *
 * 原注释（L4-5）：
 *   One owner for recorder-window opacity. A cancelled fade may finish late,
 *   but only the latest visibility request can order the window out.
 *
 * 即：窗口透明度只有一个所有者；被取消的淡出可以晚到，但**只有最新一次可见性
 * 请求**才有权把窗口送出屏幕（revision 比对）。
 */

/** Swift L49：reduce motion 时 0.10s，否则 0.18s；非动画 0。 */
export const PANEL_FADE_DURATION = 0.18
export const PANEL_FADE_DURATION_REDUCED_MOTION = 0.1

export function panelTransitionDuration(animated: boolean, reduceMotion: boolean): number {
  if (!animated) return 0
  return reduceMotion ? PANEL_FADE_DURATION_REDUCED_MOTION : PANEL_FADE_DURATION
}

/** 窗口端口（AppKit NSWindow / Electron BrowserWindow 的等价子集）。 */
export interface PanelWindowPort {
  readonly isVisible: boolean
  setAlpha(value: number): void
  orderFront(): void
  orderOut(): void
  setPointerInteractionEnabled(enabled: boolean): void
}

/** 动画器：把 alpha 从当前值推到目标值，结束时回调。 */
export interface PanelAnimator {
  animate(targetAlpha: number, durationSeconds: number, completion: () => void): void
}

/** Swift L7-57。 */
export class RecorderPanelTransition {
  private revision = 0
  private wantsVisible = false

  constructor(
    private readonly animator: PanelAnimator,
    private readonly reduceMotion: () => boolean = () => false
  ) {}

  get wantsPanelVisible(): boolean {
    return this.wantsVisible
  }

  get currentRevision(): number {
    return this.revision
  }

  /** Swift L11-19：已经可见且想要可见 → 空操作。 */
  show(window: PanelWindowPort, animated: boolean): void {
    if (this.wantsVisible && window.isVisible) return
    this.revision += 1
    this.wantsVisible = true
    window.setPointerInteractionEnabled(true)
    if (!window.isVisible) window.setAlpha(animated ? 0 : 1)
    window.orderFront()
    this.animate(window, 1, animated)
  }

  /** Swift L21-38。 */
  hide(window: PanelWindowPort, animated: boolean): void {
    window.setPointerInteractionEnabled(false)
    if (!this.wantsVisible && animated) return
    this.revision += 1
    this.wantsVisible = false
    const retiringRevision = this.revision
    if (!animated || !window.isVisible) {
      window.orderOut()
      window.setAlpha(1)
      return
    }
    this.animate(window, 0, true, () => {
      // L33-34：过期或被新的 show 抢走 → 不送窗口
      if (this.revision !== retiringRevision) return
      if (this.wantsVisible) return
      window.orderOut()
      window.setAlpha(1)
    })
  }

  /** Swift L40-56。 */
  private animate(
    window: PanelWindowPort,
    targetAlpha: number,
    animated: boolean,
    completion?: () => void
  ): void {
    const duration = panelTransitionDuration(animated, this.reduceMotion())
    this.animator.animate(targetAlpha, duration, () => {
      completion?.()
    })
  }
}
