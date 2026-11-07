/**
 * SharedPreviewWindowVisibility —— 一块预览表面的呈现许可控制器。
 *
 * Swift source: Sources/DogSCApp/SharedPreviewWindowVisibility.swift（244 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L4       typealias PreviewSleepCoverHandler
 *   L9-10    @MainActor final class SharedPreviewWindowVisibilityController
 *   L11-17   七个私有成员（displayLink / isSuspended / isAwaitingResumedFrame /
 *            transitionRevision / retirementWatchdog / hasRetiredForSuspension）
 *   L19-62   attach(to:) —— 造 display link、挂 12 个通知、强制刷新一次
 *   L64-67   updatePlaybackState —— 只有「挂起 或 没在播」才暂停 link
 *   L69-73   invalidate
 *   L75-83   stopObserving —— 代次 +1、取消看门狗、作废 link、摘全部观察者
 *   L85-87   displayLinkDidFire
 *   L89-119  windowVisibilityDidChange —— 五分派
 *   L121-129 configureCadence —— 帧率上限 min(屏上限, 预算) 且三者相等
 *   L131-148 resumePreviewPresentationForForegroundWindow —— 八项与
 *   L150-197 updatePresentationVisibility —— 挂起/恢复，含看门狗与封面
 *   L199-209 resumePresentation —— 递增代次后重建背衬图层并立刻重画
 *   L214-219 previewFrameBecameReady —— epoch 必须仍是当前的
 *   L221-235 requestSleepCover —— 异步派发 + 代次校验
 *   L237-243 finishSuspension —— 三条件与 hasRetiredForSuspension 一次性
 *
 * 迁移说明：
 *   CADisplayLink / NSNotificationCenter / NSWindow 在 Electron 里由
 *   `requestAnimationFrame` 与窗口事件取代。这里保留五件纯逻辑：
 *     1. 帧率上限的计算（含「屏幕上限未知时按 60」）
 *     2. 12 个通知 → 五种处理路径的分派表
 *     3. 前台恢复的八项与（其中三项是「任一即可」）
 *     4. 挂起时的状态清理顺序与看门狗超时（1 秒）
 *     5. 封面请求的代次校验 —— 过期通知一律丢弃
 */

/** Swift L125-126：`PreviewAnimationCadence.framesPerSecond`。 */
export const PREVIEW_ANIMATION_CADENCE_FPS = 60

/** Swift L189：看门狗只等 1 秒。 */
export const PREVIEW_RETIREMENT_WATCHDOG_SECONDS = 1

/**
 * Swift L125-128：呈现预算 = `min(max(屏上限 ?? 60, 1), 60)`。
 *
 * 注意外层是先 `max(_, 1)` 再 `min(_, budget)`：
 *   - 屏幕上限未知（null）→ 60
 *   - 屏幕上限报 0 或负数 → 抬到 1
 *   - 120 Hz / 144 Hz → 压回 60，因为全分辨率特效图不该在 120 Hz 上悄悄翻倍
 */
export function previewCadenceFramesPerSecond(input: {
  readonly screenMaximumFramesPerSecond: number | null
  readonly budgetFramesPerSecond?: number
}): number {
  const budget = input.budgetFramesPerSecond ?? PREVIEW_ANIMATION_CADENCE_FPS
  return Math.min(Math.max(input.screenMaximumFramesPerSecond ?? 60, 1), budget)
}

/**
 * Swift L127-128：`CAFrameRateRange(minimum: m, maximum: m, preferred: m)`。
 *
 * 三个值全相等 —— 这是「锁定」而不是「给区间」。给区间会让系统按负载自适应，
 * 在大项目上会掉到区间下沿。
 */
export function previewCadenceRange(input: {
  readonly screenMaximumFramesPerSecond: number | null
  readonly budgetFramesPerSecond?: number
}): { readonly minimum: number; readonly maximum: number; readonly preferred: number } {
  const fps = previewCadenceFramesPerSecond(input)
  return { minimum: fps, maximum: fps, preferred: fps }
}

/** Swift L36-57：注册的 12 个通知。 */
export const PREVIEW_VISIBILITY_WINDOW_NOTIFICATIONS: readonly string[] = [
  'NSWindow.didChangeOcclusionStateNotification',
  'NSWindow.didExposeNotification',
  'NSWindow.didUpdateNotification',
  'NSWindow.didMiniaturizeNotification',
  'NSWindow.didDeminiaturizeNotification',
  'NSWindow.didBecomeKeyNotification',
  'NSWindow.didBecomeMainNotification',
  'NSWindow.didChangeScreenNotification',
]

export const PREVIEW_VISIBILITY_APPLICATION_NOTIFICATIONS: readonly string[] = [
  'NSApplication.didBecomeActiveNotification',
  'NSApplication.didResignActiveNotification',
  'NSApplication.didHideNotification',
  'NSApplication.didUnhideNotification',
]

/**
 * Swift L89-119：一个通知落到的处理路径。
 *
 *  - `resume-explicit`            —— 视作明确的前台信号，直接尝试恢复。
 *  - `resume-implicit`            —— 不视作前台信号，要求遮挡状态/键盘/主窗口之一。
 *  - `update-then-async-resume`   —— 先按遮挡状态更新，再异步补一次明确恢复。
 *  - `update-only`                —— 只按遮挡状态更新。
 *
 * `reconfigureCadence` 只有 `didChangeScreen` 为真，且它**不 return**，
 * 会继续走到 `update-only`。
 */
export type PreviewNotificationRoute =
  | 'resume-explicit'
  | 'resume-implicit'
  | 'update-then-async-resume'
  | 'update-only'

export interface PreviewNotificationDecision {
  readonly route: PreviewNotificationRoute
  readonly reconfigureCadence: boolean
  /** true 表示处理完就 return，不再走遮挡状态更新。 */
  readonly returnsEarly: boolean
  /** `update-then-async-resume` 的异步补发用的是明确前台信号。 */
  readonly asyncResumeIsExplicit: boolean
}

export function previewVisibilityNotificationRoute(
  name: string
): PreviewNotificationDecision {
  const reconfigureCadence = name === 'NSWindow.didChangeScreenNotification'
  if (name === 'NSApplication.didBecomeActiveNotification') {
    return {
      route: 'resume-explicit',
      reconfigureCadence: false,
      returnsEarly: true,
      asyncResumeIsExplicit: false,
    }
  }
  if (name === 'NSWindow.didExposeNotification') {
    return {
      route: 'resume-explicit',
      reconfigureCadence: false,
      returnsEarly: true,
      asyncResumeIsExplicit: false,
    }
  }
  if (name === 'NSWindow.didUpdateNotification') {
    return {
      route: 'resume-implicit',
      reconfigureCadence: false,
      returnsEarly: true,
      asyncResumeIsExplicit: false,
    }
  }
  if (
    name === 'NSWindow.didDeminiaturizeNotification' ||
    name === 'NSWindow.didBecomeKeyNotification' ||
    name === 'NSWindow.didBecomeMainNotification'
  ) {
    return {
      route: 'update-then-async-resume',
      reconfigureCadence,
      returnsEarly: false,
      asyncResumeIsExplicit: true,
    }
  }
  return {
    route: 'update-only',
    reconfigureCadence,
    returnsEarly: false,
    asyncResumeIsExplicit: false,
  }
}

/**
 * Swift L134-145：前台恢复的八项与。
 *
 * 前六项是硬条件（挂起中、有 view、有 window、App 活跃、App 未隐藏、
 * 窗口可见、未最小化 —— 严格说是七项），最后一项是三条「任一即可」：
 * 明确的前台信号 / 遮挡状态含 visible / 是 key window / 是 main window。
 *
 * `didUpdate` 走的是不带明确信号的那条，因此必须靠后三条之一兜住 ——
 * 否则一次普通的布局更新就会把挂起的预览叫起来。
 */
export interface PreviewForegroundResumeFacts {
  readonly isSuspended: boolean
  readonly hasView: boolean
  readonly hasWindow: boolean
  readonly applicationIsActive: boolean
  readonly applicationIsHidden: boolean
  readonly windowIsVisible: boolean
  readonly windowIsMiniaturized: boolean
  readonly acceptsExplicitForegroundSignal: boolean
  readonly occlusionStateIsVisible: boolean
  readonly isKeyWindow: boolean
  readonly isMainWindow: boolean
}

export function previewForegroundResumeAllowed(
  facts: PreviewForegroundResumeFacts
): boolean {
  if (!facts.isSuspended) return false
  if (!facts.hasView || !facts.hasWindow) return false
  if (!facts.applicationIsActive) return false
  if (facts.applicationIsHidden) return false
  if (!facts.windowIsVisible) return false
  if (facts.windowIsMiniaturized) return false
  return (
    facts.acceptsExplicitForegroundSignal ||
    facts.occlusionStateIsVisible ||
    facts.isKeyWindow ||
    facts.isMainWindow
  )
}

/**
 * Swift L159-163：`guard force || shouldSuspend != isSuspended else { ... return }`。
 *
 * 状态没变时**只**刷新播放状态，不递增代次、不动看门狗、不发封面请求。
 * 这条早退是减少无谓重绘的主要来源。
 */
export type PreviewVisibilityUpdate =
  | 'force-apply'
  | 'state-unchanged'
  | 'apply'

export function previewVisibilityUpdateDecision(input: {
  readonly force: boolean
  readonly shouldSuspend: boolean
  readonly isSuspended: boolean
}): PreviewVisibilityUpdate {
  if (input.force) return 'force-apply'
  return input.shouldSuspend === input.isSuspended ? 'state-unchanged' : 'apply'
}

/**
 * Swift L165-178：进入挂起时要做的清理，顺序固定。
 *
 * `transitionRevision += 1` 排第一 —— 在这一刻之前派发出去的所有异步封面
 * 回调都会因为代次不符被丢弃。最后才是 `requestSleepCover(true)`。
 */
export const PREVIEW_SUSPEND_STEP_ORDER: readonly string[] = [
  'bump-transition-revision',
  'cancel-retirement-watchdog',
  'clear-awaiting-resumed-frame',
  'clear-has-retired-for-suspension',
  'pause-display-link',
  'bump-render-generation',
  'bump-presentation-epoch',
  'clear-render-dirty',
  'clear-last-submitted-signature',
  'request-sleep-cover',
]

/**
 * Swift L180-192：能不能播那个「淡出封面」的过渡。
 *
 * 四条件：有 window、window 可见、未最小化、App 未隐藏、遮挡状态含 visible，
 * 外加一个「装了封面回调」。任一不满足就直接 finishSuspension —— 否则
 * 隐藏/拆掉的 SwiftUI 动画永远不报完成，资源就一直挂着。
 */
export function previewCanShowSleepCoverTransition(input: {
  readonly windowIsVisible: boolean
  readonly windowIsMiniaturized: boolean
  readonly applicationIsHidden: boolean
  readonly occlusionStateIsVisible: boolean
  readonly hasSleepCoverHandler: boolean
}): boolean {
  if (!input.hasSleepCoverHandler) return false
  return (
    input.windowIsVisible &&
    !input.windowIsMiniaturized &&
    !input.applicationIsHidden &&
    input.occlusionStateIsVisible
  )
}

/**
 * Swift L183-192：能播过渡就挂 1 秒看门狗，不能播就立刻收尾。
 *
 * 看门狗是**兜底**而不是主路径：正常的过渡动画会在完成回调里 finish，
 * 1 秒只是「动画可能永远不回调」的上界。
 */
export type PreviewSuspensionScheduling =
  | 'finish-immediately'
  | 'wait-for-cover-handler'
  | 'start-watchdog'

export function previewSuspensionScheduling(input: {
  readonly canShowTransition: boolean
  readonly hasSleepCoverHandler: boolean
}): PreviewSuspensionScheduling {
  if (!input.canShowTransition) return 'finish-immediately'
  return input.hasSleepCoverHandler ? 'start-watchdog' : 'finish-immediately'
}

/**
 * Swift L214-219：`previewFrameBecameReady(epochID:)` 的三条件。
 *
 * 必须「没挂起」+「正在等恢复后的第一帧」+「传进来的 epoch 仍是当前的」。
 * 第三条防的是「恢复后连发两帧，第一帧的完成晚于第二帧的提交」。
 */
export function previewFrameBecameReadyAccepted(input: {
  readonly isSuspended: boolean
  readonly isAwaitingResumedFrame: boolean
  readonly epochMatches: boolean
}): boolean {
  return (
    !input.isSuspended && input.isAwaitingResumedFrame && input.epochMatches
  )
}

/**
 * Swift L221-235：封面请求的代次校验。
 *
 * 派发进主队列后**先**比对 `transitionRevision`；不符就整段丢掉。此时要么
 * 已经恢复（代次变了），要么又挂起了一次 —— 两种情况下这个回调都是过期的。
 */
export function previewSleepCoverRequestAccepted(input: {
  readonly dispatchedRevision: number
  readonly currentRevision: number
}): boolean {
  return input.dispatchedRevision === input.currentRevision
}

/**
 * Swift L237-243：`finishSuspension` 的三条件 + 一次性标记。
 *
 * 第三个条件 `!hasRetiredForSuspension` 保证**只**退役一次：过渡完成回调、
 * 看门狗、以及「没有封面回调」的立即收尾这三条路可能同时到达，只有第一条
 * 能真正执行 `suspendPreviewBackingLayer()`。
 */
export function previewFinishSuspensionAllowed(input: {
  readonly isSuspended: boolean
  readonly revisionMatches: boolean
  readonly hasRetiredForSuspension: boolean
}): boolean {
  return (
    input.isSuspended && input.revisionMatches && !input.hasRetiredForSuspension
  )
}

/**
 * Swift L64-67：display link 的暂停条件。
 *
 * 挂起时暂停，且**没在播放时也暂停** —— 静止画面没有理由每帧唤醒。
 */
export function previewDisplayLinkShouldPause(input: {
  readonly isSuspended: boolean
  readonly isPlaying: boolean
}): boolean {
  return input.isSuspended || !input.isPlaying
}

/**
 * Swift L199-209：恢复时的五步，顺序固定。
 *
 * `isAwaitingResumedFrame = true` 必须在 `renderCurrentFrame()` 之前设上，
 * 否则那一帧的 `previewFrameBecameReady` 会因为「没在等」而被丢掉，封面
 * 就永远不淡出。
 */
export const PREVIEW_RESUME_STEP_ORDER: readonly string[] = [
  'bump-transition-revision',
  'cancel-retirement-watchdog',
  'clear-suspended-flag',
  'mark-awaiting-resumed-frame',
  'install-backing-layer',
  'update-playback-state',
  'clear-last-submitted-signature',
  'render-current-frame',
]

/**
 * Swift L75-83：`stopObserving` 的代次递增与清理。
 *
 * 这里也递增 `transitionRevision`，和挂起/恢复同一个目的：任何在飞的异步
 * 回调（包括 attach 前一轮的）都必须失效。
 */
export function previewStopObservingBumpsRevision(): boolean {
  return true
}

/**
 * Swift L22-25：`attach` 时没有 window 也要强制刷一次可见性。
 *
 * 强制刷的意义在于把 `isSuspended` 从默认的 true 校正到「确实该挂起」的
 * 状态，避免下一次真实通知到来时被 `shouldSuspend == isSuspended` 早退吞掉。
 */
export function previewAttachForcesVisibilityUpdate(input: {
  readonly hasWindow: boolean
}): boolean {
  return !input.hasWindow
}
