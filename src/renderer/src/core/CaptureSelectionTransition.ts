/**
 * 采集选择窗口的过渡 —— 位置立刻生效，只有透明度做动画。
 *
 * Swift source: Sources/DogSCApp/CaptureSelectionTransition.swift（217 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - final class CaptureSelectionTransition              L8-93   → CaptureSelectionWindowTransition
 *     · present(_:)                                       L16-21  → present
 *     · retire(_:animated:)                               L23-36  → retire
 *     · finishImmediately()                               L38-45  → finishImmediately
 *     · settlePresentation(_:)                            L47-52  → settlePresentation
 *     · interrupt / settleAlpha / close                   L54-69  → interrupt / close
 *     · fade(_:to:retiring:)（0.16 / 0.18 + easeOut）      L71-92  → captureSelectionFadePlan
 *   - final class CaptureSelectionCardTransition          L98-200 → CaptureSelectionCardTransition
 *     · show(_:at:)（先定尺寸再显形）                      L104-124 → captureSelectionCardShowPlan
 *     · hide(_:animated:)                                 L126-144 → captureSelectionCardHidePlan
 *     · stop()                                            L146-150 → stop
 *     · interrupt（读 presentation().opacity）             L156-167 → interrupt
 *     · animate(_:alpha:duration:hideOnCompletion:)       L169-199 → captureSelectionCardAnimatePlan
 *   - struct CaptureSelectionCardMotion（offset 6 / 0.985） L204-217 → captureSelectionCardMotion
 *
 * 原注释（L5-6）：
 *   Owns windows until their presentation or retirement finishes. Retired
 *   windows never reach back into a selector's current window collection.
 *
 * 原注释（L95-96）：
 *   Placement follows the chosen target immediately. Only opacity is animated;
 *   a fresh card can never travel from an old or uncommitted layer frame.
 *
 * 原注释（L202-203）：
 *   Panel opacity owns the fade; this modifier adds only the card's small
 *   spatial movement, avoiding a second opacity animation on the same card.
 *
 * 迁移说明：`NSWindow` / `NSAnimationContext` / `CATransaction` 在 Windows 侧
 * 对应 `BrowserWindow` + CSS 过渡。这里保留三件可断言的事：
 *   1. 淡入 0.18 秒、淡出 0.16 秒（**淡出比淡入快**，关闭要利索）
 *   2. 降低动态效果时**完全不动画**，且淡出仍然要 `close`
 *   3. 窗口/卡片的 frame 在动画之外直接赋值（`setDisableActions(true)`），
 *      指针跟踪不能等布局过渡
 */

/** Swift L82 / L123：淡入时长。 */
export const CAPTURE_SELECTION_PRESENT_FADE_SECONDS = 0.18

/** Swift L82 / L141：淡出时长（比淡入短 0.02 秒）。 */
export const CAPTURE_SELECTION_RETIRE_FADE_SECONDS = 0.16

/** Swift L141：卡片隐藏的默认时长。 */
export const CAPTURE_SELECTION_CARD_HIDE_SECONDS = 0.14

/** Swift L212：卡片的微位移与微缩放。 */
export const CAPTURE_SELECTION_CARD_OFFSET_Y = 6
export const CAPTURE_SELECTION_CARD_SCALE = 0.985

/** Swift L214：卡片出现的时长（比消退略长）。 */
export const CAPTURE_SELECTION_CARD_MOTION_SECONDS = 0.2

/** Swift L71-92：一次淡入/淡出要做什么。 */
export interface CaptureSelectionFadePlan {
  readonly duration: number
  /** 淡出完成后必须关闭窗口；淡入永不关闭。 */
  readonly closeOnCompletion: boolean
  /** 降低动态效果时为 true —— 直接赋 alpha，不进动画组。 */
  readonly immediate: boolean
  readonly targetAlpha: number
}

/**
 * Swift L71-92。
 *
 * 注意 `immediate` 分支里仍然有 `if retiring { close(window) }`：
 * 不动画 ≠ 不关闭。漏掉这一句会让关闭的窗口永久留在屏幕上。
 */
export function captureSelectionFadePlan(input: {
  readonly retiring: boolean
  readonly reduceMotion: boolean
}): CaptureSelectionFadePlan {
  const targetAlpha = input.retiring ? 0 : 1
  if (input.reduceMotion) {
    return {
      duration: 0,
      closeOnCompletion: input.retiring,
      immediate: true,
      targetAlpha,
    }
  }
  return {
    duration: input.retiring
      ? CAPTURE_SELECTION_RETIRE_FADE_SECONDS
      : CAPTURE_SELECTION_PRESENT_FADE_SECONDS,
    closeOnCompletion: input.retiring,
    immediate: false,
    targetAlpha,
  }
}

/** Swift L18：`present` 时的初始 alpha。 */
export function captureSelectionPresentStartAlpha(reduceMotion: boolean): number {
  return reduceMotion ? 1 : 0
}

/** Swift L23-36：退役前必须先摘掉的三件事。 */
export const CAPTURE_SELECTION_RETIRE_PREREQUISITES = [
  'ignoresMouseEvents',
  'makeFirstResponderNil',
  'resignKey',
  'resignMain',
] as const

/**
 * 一扇窗口在过渡表里的登记项。
 *
 * `id` 用于识别「回来的 completionHandler 是不是我自己那一次」——
 * 快速连开连关时，上一轮的淡出完成回调不能关掉新一轮的窗口。
 */
export interface CaptureSelectionTransitionEntry {
  readonly id: number
  readonly windowKey: string
}

/**
 * Swift L8-93 的窗口过渡表（无真实动画，只维护「谁欠一个关闭」）。
 *
 * 与 Swift 的等价关系：
 *   - `interrupt` 一定先把登记项摘掉再结算 alpha，否则 completionHandler
 *     会二次 `close`
 *   - `finishImmediately` 先取快照再清表，遍历时不能改表
 *   - 关闭前的 `settleAlpha` 用 0 时长动画把当前值钉住，避免回弹
 */
export class CaptureSelectionWindowTransition {
  private readonly transitions = new Map<string, CaptureSelectionTransitionEntry>()
  private nextId = 0
  private readonly reduceMotion: () => boolean
  private readonly closeWindow: (windowKey: string) => void
  private readonly setAlpha: (windowKey: string, alpha: number) => void

  constructor(input: {
    readonly reduceMotion: () => boolean
    readonly closeWindow: (windowKey: string) => void
    readonly setAlpha: (windowKey: string, alpha: number) => void
  }) {
    this.reduceMotion = input.reduceMotion
    this.closeWindow = input.closeWindow
    this.setAlpha = input.setAlpha
  }

  /** 当前有多少扇窗口在过渡中（供断言）。 */
  get pendingCount(): number {
    return this.transitions.size
  }

  /** Swift L16-21。 */
  present(windowKey: string): CaptureSelectionFadePlan {
    const plan = captureSelectionFadePlan({ retiring: false, reduceMotion: this.reduceMotion() })
    this.fade(windowKey, plan)
    return plan
  }

  /** Swift L23-36：`animated` 为假时走「中断 + 立即关闭」。 */
  retire(windowKeys: readonly string[], animated: boolean): void {
    for (const windowKey of windowKeys) {
      if (animated) {
        this.fade(windowKey, captureSelectionFadePlan({
          retiring: true,
          reduceMotion: this.reduceMotion(),
        }))
      } else {
        this.interrupt(windowKey)
        this.close(windowKey)
      }
    }
  }

  /** Swift L38-45。 */
  finishImmediately(): void {
    const interrupted = [...this.transitions.values()]
    this.transitions.clear()
    for (const entry of interrupted) {
      this.close(entry.windowKey)
    }
  }

  /** Swift L47-52：进入前台时把所有在飞的淡出钉到 1，不关闭。 */
  settlePresentation(windowKeys: readonly string[]): void {
    for (const windowKey of windowKeys) {
      this.interrupt(windowKey)
      this.setAlpha(windowKey, 1)
    }
  }

  /** Swift L71-92。 */
  private fade(windowKey: string, plan: CaptureSelectionFadePlan): void {
    this.interrupt(windowKey)
    if (plan.immediate) {
      this.setAlpha(windowKey, plan.targetAlpha)
      if (plan.closeOnCompletion) this.close(windowKey)
      return
    }
    this.nextId += 1
    const id = this.nextId
    this.transitions.set(windowKey, { id, windowKey })
    // 动画完成：只有登记项还是自己那一次才收尾。
    queueMicrotask(() => {
      const current = this.transitions.get(windowKey)
      if (current == null || current.id !== id) return
      this.transitions.delete(windowKey)
      this.setAlpha(windowKey, plan.targetAlpha)
      if (plan.closeOnCompletion) this.close(windowKey)
    })
  }

  /** Swift L54-57：摘登记项；没登记过就什么都不做。 */
  private interrupt(windowKey: string): void {
    this.transitions.delete(windowKey)
  }

  /** Swift L66-69。 */
  private close(windowKey: string): void {
    this.closeWindow(windowKey)
  }
}

/** Swift L104-124：卡片 show 的决策。 */
export interface CaptureSelectionCardShowPlan {
  /** 是否为「首次出现」—— 只有首次才播淡入。 */
  readonly entering: boolean
  /** 是否需要把 frame 改成新值。 */
  readonly updateFrame: boolean
}

/**
 * Swift L105：`guard !isPresented || targetFrame != target else { return }`。
 *
 * 已经显示且目标 frame 没变 → 完全不动（避免每帧重设 frame 抖动指针命中区）。
 */
export function captureSelectionCardShowPlan(input: {
  readonly isPresented: boolean
  readonly targetFrame: NormalizedFrameLike | null
  readonly target: NormalizedFrameLike
}): CaptureSelectionCardShowPlan {
  if (input.isPresented && input.targetFrame != null && framesEqual(input.targetFrame, input.target)) {
    return { entering: false, updateFrame: false }
  }
  return { entering: !input.isPresented, updateFrame: true }
}

/** 帧的等值比较（Swift 的 `CGRect !=`）。 */
export interface NormalizedFrameLike {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function framesEqual(a: NormalizedFrameLike, b: NormalizedFrameLike): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** Swift L126-144：卡片 hide 的决策。 */
export interface CaptureSelectionCardHidePlan {
  readonly duration: number
  readonly hideOnCompletion: boolean
  /** 从未显示过且不要求动画 → 直接置 alpha 0 并隐藏。 */
  readonly immediate: boolean
}

/**
 * Swift L126-144。
 *
 * `isPresented == false` 且 `animated == true` 时是**完全 no-op**（`guard` 后直接返回）——
 * 这条容易被误删：此时卡片还没出现在屏幕上，播放一次淡出会让它闪一下。
 */
export function captureSelectionCardHidePlan(input: {
  readonly isPresented: boolean
  readonly animated: boolean
  readonly reduceMotion: boolean
}): CaptureSelectionCardHidePlan | null {
  if (!input.isPresented) {
    if (input.animated) return null
    return { duration: 0, hideOnCompletion: true, immediate: true }
  }
  const duration =
    input.animated && !input.reduceMotion ? CAPTURE_SELECTION_CARD_HIDE_SECONDS : 0
  return { duration, hideOnCompletion: true, immediate: duration === 0 }
}

/** Swift L169-199：`animate` 的三条提前返回。 */
export interface CaptureSelectionCardAnimatePlan {
  readonly duration: number
  readonly animate: boolean
  readonly hideOnCompletion: boolean
}

/**
 * Swift L175-184：
 *   - 时长 ≤ 0 或降低动态效果 → 直接赋值
 *   - `initialAlpha == alpha` → 不动画，但仍要设置 `isHidden`
 *
 * 第二条是隐藏路径的关键：alpha 已经是 0 时不会有动画回调，
 * 如果这里也返回「什么都不做」，卡片就永远不会真正 hidden。
 */
export function captureSelectionCardAnimatePlan(input: {
  readonly initialAlpha: number
  readonly alpha: number
  readonly duration: number
  readonly reduceMotion: boolean
  readonly hideOnCompletion: boolean
}): CaptureSelectionCardAnimatePlan {
  if (!(input.duration > 0) || input.reduceMotion) {
    return { duration: 0, animate: false, hideOnCompletion: input.hideOnCompletion }
  }
  if (input.initialAlpha === input.alpha) {
    return { duration: 0, animate: false, hideOnCompletion: input.hideOnCompletion }
  }
  return { duration: input.duration, animate: true, hideOnCompletion: input.hideOnCompletion }
}

/** Swift L204-217：卡片空间运动的最终取值。 */
export interface CaptureSelectionCardMotion {
  readonly offsetY: number
  readonly scale: number
  readonly duration: number | null
}

/**
 * Swift L209-215。
 *
 * 只有「已出现且未退役」才回到原位；降低动态效果时永远在原位。
 * 注意 `visible || reduceMotion ? 0 : 6` 的写法 —— 降低动态效果时
 * offset 和 scale 都直接取终值，不做动画。
 */
export function captureSelectionCardMotion(input: {
  readonly appeared: boolean
  readonly retiring: boolean
  readonly reduceMotion: boolean
}): CaptureSelectionCardMotion {
  const visible = input.appeared && !input.retiring
  if (input.reduceMotion) {
    return { offsetY: 0, scale: 1, duration: null }
  }
  return {
    offsetY: visible ? 0 : CAPTURE_SELECTION_CARD_OFFSET_Y,
    scale: visible ? 1 : CAPTURE_SELECTION_CARD_SCALE,
    duration: input.retiring
      ? CAPTURE_SELECTION_RETIRE_FADE_SECONDS
      : CAPTURE_SELECTION_CARD_MOTION_SECONDS,
  }
}

/**
 * Swift L98-200 的卡片过渡表（只维护代次，不跑真实动画）。
 *
 * 代次的作用：`interrupt()` 换代次后，上一轮 `animate` 的完成回调
 * 看到代次不符就直接返回，不会把刚打开的新一轮又关掉。
 */
export class CaptureSelectionCardTransition {
  private isPresentedValue = false
  private targetFrameValue: NormalizedFrameLike | null = null
  private generation = 0
  private animatedKey: string | null = null

  get isPresented(): boolean {
    return this.isPresentedValue
  }

  get targetFrame(): NormalizedFrameLike | null {
    return this.targetFrameValue
  }

  get generationValue(): number {
    return this.generation
  }

  /** Swift L104-124。 */
  show(viewKey: string, target: NormalizedFrameLike): CaptureSelectionCardShowPlan {
    const plan = captureSelectionCardShowPlan({
      isPresented: this.isPresentedValue,
      targetFrame: this.targetFrameValue,
      target,
    })
    if (!plan.updateFrame) return plan
    const entering = plan.entering
    this.isPresentedValue = true
    this.targetFrameValue = target
    if (!entering) return plan
    this.interrupt()
    this.animatedKey = viewKey
    return plan
  }

  /** Swift L126-144。 */
  hide(animated: boolean, reduceMotion: boolean): CaptureSelectionCardHidePlan | null {
    const plan = captureSelectionCardHidePlan({
      isPresented: this.isPresentedValue,
      animated,
      reduceMotion,
    })
    if (plan == null) return null
    this.interrupt()
    this.isPresentedValue = false
    this.targetFrameValue = null
    return plan
  }

  /** Swift L146-150。 */
  stop(): void {
    this.interrupt()
    this.isPresentedValue = false
    this.targetFrameValue = null
  }

  /** Swift L156-167：中断并换代次，返回中断前的可见透明度（没有则为 null）。 */
  interrupt(): number | null {
    this.generation += 1
    if (this.animatedKey == null) return null
    this.animatedKey = null
    return null
  }
}

/** 中断并换代次后，返回中断前的可见透明度（没有在飞的动画则为 null）。 */
