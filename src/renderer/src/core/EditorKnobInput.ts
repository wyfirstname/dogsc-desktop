/**
 * 旋钮指针输入 —— 输入区固定为一个不缩放的命中矩形，画面在悬停/按下时长大。
 *
 * Swift source: Sources/DogSCApp/EditorKnobInput.swift（153 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorKnobPointerInput（NSViewRepresentable）  L7-27   → knobInputIsLive
 *   - updateNSView（!isEnabled → finish()）                 L19-22  → knobInputIsLive
 *   - final class InputView                                 L29-153
 *   - isFlipped / mouseDownCanMoveWindow / acceptsFirstMouse L37-39 → KNOB_INPUT_TRAITS
 *   - hitTest                                               L41-44 → knobHitTestEnabled
 *   - resetCursorRects（openHand）                           L46-48 → KNOB_CURSOR_IDLE
 *   - updateTrackingAreas                                   L50-58 → KNOB_TRACKING_OPTIONS
 *   - viewDidMoveToWindow / windowResignedKey               L60-69 → knobInputShouldFinish
 *   - mouseEntered / mouseExited                            L70-74 → knobPointerAction
 *   - mouseDown / mouseDragged / mouseUp                    L76-95 → knobPointerAction
 *   - scrollWheel                                           L97-132 → knobWheelAction / KNOB_WHEEL_IDLE_TIMEOUT_MS
 *   - finishWheel / finish                                   L134-151 → knobWheelAction
 *
 * 原注释（L4-6）：
 *   Input stays in one unscaled native rectangle while the SwiftUI artwork
 *   grows on hover/press. Wheel events are consumed only over this control;
 *   they never also scroll the inspector or create an undo step per pixel.
 *
 * 迁移说明：`NSView` 子类在 React 侧对应一个 `<div onPointerDown … onWheel …>` 的
 * 命中层；`NSTrackingArea` → `pointerenter/pointerleave`；`DispatchWorkItem` 的
 * 220ms 收尾 → `setTimeout` + 代次校验（同样必须带代次，否则连续滚动会被
 * 上一轮的超时打断）。本文件只保留判定与状态机。
 */

import { EditorKnobDragState } from './EditorKnobDrag'

/** Swift L131：停止滚动后 220ms 才结束这一轮滚轮编辑。 */
export const KNOB_WHEEL_IDLE_TIMEOUT_MS = 220

/** Swift L47：空闲光标是「张开的手」。 */
export const KNOB_CURSOR_IDLE = 'openHand'

/** Swift L81：按下并开始旋转后换成「握住的手」。 */
export const KNOB_CURSOR_ACTIVE = 'closedHand'

/** Swift L37-39：翻转坐标系、不拖动窗口、接受首点。 */
export const KNOB_INPUT_TRAITS = {
  isFlipped: true,
  mouseDownCanMoveWindow: false,
  acceptsFirstMouse: true,
} as const

/** Swift L55：跟踪区域选项。 */
export const KNOB_TRACKING_OPTIONS = [
  'mouseEnteredAndExited',
  'activeInKeyWindow',
  'inVisibleRect',
] as const

/**
 * Swift L19-22 + L41-44 + L47：
 *   if !isEnabled { view.finish() }
 *   hitTest: guard input?.isEnabled == true else { return nil }
 *   resetCursorRects: if input?.isEnabled == true { addCursorRect(…) }
 *
 * 禁用时整个视图从命中测试里消失（而不是「看得见但点不动」）——
 * 否则它会挡住底下真实可交互的控件。
 */
export function knobInputIsLive(isEnabled: boolean): boolean {
  return isEnabled
}

/** Swift L42：命中测试直接返回 nil 表示「这个点不属于我」。 */
export function knobHitTestEnabled(isEnabled: boolean): boolean {
  return isEnabled
}

/**
 * Swift L60-69：
 *   viewDidMoveToWindow：window 为 nil 时 finish()
 *   windowResignedKey → finish()
 *
 * 窗口丢焦点必须收尾，否则「一边拖旋钮一边 ⌘Tab 走」会留下一个永不结束的
 * 连续编辑（撤销栈里挂着一个没有 end 的事务）。
 */
export function knobInputShouldFinish(input: {
  readonly hasWindow: boolean
  readonly windowResignedKey: boolean
}): boolean {
  return !input.hasWindow || input.windowResignedKey
}

/** 指针事件的结论。 */
export type KnobPointerAction =
  | 'hoverIn'
  | 'hoverOut'
  | 'dragChange'
  | 'dragEnd'
  | 'ignore'

/**
 * Swift L70-95。
 *
 *   mouseDown: finishWheel() → guard enabled → rotating = onDragBegin(point, center)
 *               旋转中才 set closedHand
 *   mouseDragged: guard rotating → onDragChange(point, shift)
 *   mouseUp: guard rotating → 再发一次 onDragChange → rotating = false → onDragEnd
 *
 * 两处容易写错的细节：
 *   1. `mouseDown` 先 `finishWheel()`：按下就等于结束滚轮编辑，两者不共存。
 *   2. `mouseUp` 在 `onDragEnd` **之前**再发一次 `onDragChange` —— 松手位置才是
 *      最终值；少这一发，最后几像素的移动会丢。
 */
export function knobPointerAction(input: {
  readonly event: 'entered' | 'exited' | 'dragged' | 'up'
  readonly rotating: boolean
}): KnobPointerAction {
  switch (input.event) {
    case 'entered':
      return 'hoverIn'
    case 'exited':
      return 'hoverOut'
    case 'dragged':
      return input.rotating ? 'dragChange' : 'ignore'
    case 'up':
      return input.rotating ? 'dragEnd' : 'ignore'
  }
}

/** `mouseDown` 一次做两件事，所以单独给一个结构而不是塞进上边的枚举。 */
export interface KnobMouseDownPlan {
  /** 永远是 true：按下即结束滚轮编辑，两者不共存。 */
  readonly finishWheel: true
  /** 是否进入旋转态（`onDragBegin` 返回 true 才进）。 */
  readonly beginDrag: boolean
}

export function knobMouseDownPlan(input: {
  readonly isEnabled: boolean
  readonly dragBeginAccepted: boolean
}): KnobMouseDownPlan {
  return {
    finishWheel: true,
    beginDrag: input.isEnabled && input.dragBeginAccepted,
  }
}

/** 滚轮事件的结论。 */
export type KnobWheelAction =
  | { readonly kind: 'passThrough' }
  | { readonly kind: 'finishWheel' }
  | { readonly kind: 'begin' }
  | { readonly kind: 'begin'; readonly delta: number }
  | { readonly kind: 'change'; readonly delta: number }

/**
 * Swift L97-132，顺序即语义：
 *
 *   1. `guard isEnabled, window.isKeyWindow, !rotating, !command` 否则
 *      `super.scrollWheel(event)` —— 交还给上层（检查器继续滚动）。
 *   2. `!event.momentumPhase.isEmpty` → finishWheel 并 **return**（不消费后续惯性）。
 *      L103-104 的注释：惯性不能在手指离开触控板或移到别的旋钮后继续改参数。
 *   3. `phase` 含 `.ended` / `.cancelled` → finishWheel 并 return。
 *   4. 算 delta，为 nil 说明不是垂直滚动 → 交还上层。
 *   5. 第一次有效增量才 `onWheelBegin()`；被拒则**不消费**事件。
 */
export function knobWheelAction(input: {
  readonly isEnabled: boolean
  readonly isKeyWindow: boolean
  readonly rotating: boolean
  readonly hasCommandModifier: boolean
  readonly momentumPhaseEmpty: boolean
  readonly phaseEndedOrCancelled: boolean
  readonly vertical: number
  readonly horizontal: number
  readonly precise: boolean
  readonly inverted: boolean
  readonly fine: boolean
  readonly scrolling: boolean
  readonly wheelBeginAccepted: boolean
}): KnobWheelAction {
  if (!input.isEnabled || !input.isKeyWindow || input.rotating || input.hasCommandModifier) {
    return { kind: 'passThrough' }
  }
  if (!input.momentumPhaseEmpty) return { kind: 'finishWheel' }
  if (input.phaseEndedOrCancelled) return { kind: 'finishWheel' }
  const delta = EditorKnobDragState.wheelDelta({
    vertical: input.vertical,
    horizontal: input.horizontal,
    precise: input.precise,
    inverted: input.inverted,
    fine: input.fine,
  })
  if (delta === null) return { kind: 'passThrough' }
  if (!input.scrolling) {
    return input.wheelBeginAccepted ? { kind: 'begin', delta } : { kind: 'passThrough' }
  }
  return { kind: 'change', delta }
}

/**
 * Swift L116-120：滚轮编辑的「开始」只发生一次。
 * `onWheelBegin()` 返回 false 时直接 return —— 既不置 scrolling，也不发 change。
 */
export function knobWheelShouldBegin(input: {
  readonly scrolling: boolean
  readonly wheelBeginAccepted: boolean
}): boolean {
  if (input.scrolling) return false
  return input.wheelBeginAccepted
}

/**
 * Swift L121-131：每来一个增量就作废上一轮的收尾定时器并重新计时。
 * 代次校验（L126）保证「上一轮的定时器」不会把这一轮关掉。
 */
export function knobWheelCompletionIsCurrent(
  currentGeneration: number,
  scheduledGeneration: number
): boolean {
  return currentGeneration === scheduledGeneration
}

/**
 * Swift L134-141：`finishWheel()` 幂等。
 *   wheelGeneration += 1；取消定时器；`guard scrolling else { return }`
 * 只有真的在滚动时才发 `onWheelEnd()` —— 否则会往撤销栈里塞一个空的编辑事务。
 */
export function knobWheelEndEmitsEnd(scrolling: boolean): boolean {
  return scrolling
}

/**
 * Swift L143-151：`finish()` 是三条收尾的合并入口。
 * 顺序：先结束滚轮、再结束旋转、最后一定要发 hoverOut。
 * （禁用态与窗口失焦都走这里，所以 hover 一定会被清掉，不会卡在「亮着」的状态。）
 */
export interface KnobFinishPlan {
  readonly finishWheel: boolean
  readonly endDrag: boolean
  readonly setHoverOut: boolean
  readonly invalidateCursorRects: boolean
}

export function knobFinishPlan(input: {
  readonly scrolling: boolean
  readonly rotating: boolean
}): KnobFinishPlan {
  return {
    finishWheel: input.scrolling,
    endDrag: input.rotating,
    setHoverOut: true,
    invalidateCursorRects: true,
  }
}
