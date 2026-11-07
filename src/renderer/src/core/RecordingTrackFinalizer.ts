/**
 * 录制轨道收尾器 —— 只负责「多轨停止」这一个边界。
 *
 * Swift source: Sources/DogSCApp/RecordingTrackFinalizer.swift（294 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - enum RecordingTrackFinalizationIntent                    L4-8   → RecordingTrackFinalizationIntent
 *   - struct RecordingTrackFinalizationRequest                 L10-14 → RecordingTrackFinalizationRequest
 *   - enum RecordingTrackStopTarget（+ displayName）            L16-30 → RECORDING_TRACK_STOP_TARGETS
 *   - struct RecordingTrackStopFailure（+ errorDescription）    L32-49 → recordingTrackStopFailureMessage
 *   - struct RecordingPreparationRollbackError                  L51-64 → recordingPreparationRollbackMessage
 *   - struct RecordingTrackStopOutcome                          L66-70 → RecordingTrackStopOutcome
 *   - struct RecordingTrackFinalizationResult                   L72-84 → recordingTrackFinalization*
 *   - enum RecordingTrackFinalizerError                         L86-105 → RECORDING_TRACK_FINALIZER_ERRORS
 *   - struct RecordingTrackFinalizerOperations                  L107-130 → RecordingTrackFinalizerOperations
 *   - final class RecordingTrackFinalizer                       L136-294
 *     · finalize（四道前置判定）                                L156-191 → recordingTrackFinalizerDecision
 *     · 冻结光标 + 建 Task                                     L193-206 → recordingTrackFinalizerFreezesPointer
 *     · perform（三路 async let）                              L215-239 → recordingTrackFinalizerOutcomeTargets
 *     · stopPrimary（device 优先于 screen）                    L241-261 → recordingTrackFinalizerPrimaryTarget
 *     · stopAuxiliary / stop（错误转 outcome，不抛）            L263-293 → recordingTrackStopOutcome
 *
 * 原注释（L132-135）：
 *   Owns only the multi-track stop boundary. Project persistence and App phase
 *   routing remain outside this type. Its unstructured task is deliberately
 *   shared by every same-run/same-intent caller and is never replaced or
 *   cancelled by a duplicate request.
 *
 * 原注释（L193-194）：
 *   This is the capture boundary: remove the global event monitor and freeze
 *   pointer records before creating a task or reaching any await.
 *
 * 迁移说明：`actor`/`@MainActor class` 的状态机在 Electron 主进程里由
 * `RecordingTrackFinalizer` 类承担；这里把四道前置判定、三路停止的目标选择、
 * 以及错误 → outcome 的转换抽成纯函数，断言可以完全脱离 async 运行时。
 */

// ---------------------------------------------------------------- 意图

/**
 * Swift L4-8：这次收尾要做什么。
 *
 * `discard(restart:)` 带一个布尔 —— 丢弃后是否立刻重开一次录制。把它放在 intent
 * 里而不是外部标志位，是为了让「同一 run 同一 intent 复用同一个 Task」这条规则成立：
 * 重开与不重开是两种不同的收尾，混用会复用到一半被改掉。
 */
export type RecordingTrackFinalizationIntent =
  | { readonly kind: 'commit' }
  | { readonly kind: 'discard'; readonly restart: boolean }
  | { readonly kind: 'rollbackFailedPreparation' }

/** Swift L4-8：三种意图的稳定标识（用于相等比较与日志）。 */
export function recordingTrackFinalizationIntentKey(
  intent: RecordingTrackFinalizationIntent
): string {
  switch (intent.kind) {
    case 'commit':
      return 'commit'
    case 'discard':
      return intent.restart ? 'discard:restart' : 'discard:hold'
    case 'rollbackFailedPreparation':
      return 'rollback'
  }
}

/**
 * Swift L10-14：一次收尾请求。
 *
 * `startedTracks` 是「这次录制真的启动过哪些轨道」——不是「配置了哪些」。
 * 没启动的轨道不能去 stop，否则会拿到一个「没有该轨道」的错误，而这个错误
 * 会被当成真失败报给用户。
 */
export interface RecordingTrackFinalizationRequest {
  readonly runID: string
  readonly startedTracks: number
  readonly intent: RecordingTrackFinalizationIntent
}

// ---------------------------------------------------------------- 轨道目标

/** Swift L16-20：四个可停止的轨道。 */
export type RecordingTrackStopTarget = 'screen' | 'iosDevice' | 'camera' | 'microphone'

/** Swift L16-20：四个轨道的稳定顺序。 */
export const RECORDING_TRACK_STOP_TARGETS: readonly RecordingTrackStopTarget[] = [
  'screen',
  'iosDevice',
  'camera',
  'microphone',
]

/**
 * Swift L22-29：轨道的中文名。
 *
 * `iosDevice` 写成「iPhone/iPad」而不是「设备」：错误消息里「设备轨道停止失败」
 * 用户不知道指哪个，「iPhone/iPad 轨道停止失败」他知道该去拔哪根线。
 */
export function recordingTrackStopTargetDisplayName(target: RecordingTrackStopTarget): string {
  switch (target) {
    case 'screen':
      return '屏幕'
    case 'iosDevice':
      return 'iPhone/iPad'
    case 'camera':
      return '摄像头'
    case 'microphone':
      return '麦克风'
  }
}

/**
 * Swift L38-44：把底层错误压成一个可序列化的失败记录。
 *
 * 保留 `domain` / `code` 两个原始字段，因为收尾失败多半发生在 ffmpeg 子进程退出码上，
 * 只有 `localizedDescription` 时排查要靠猜。
 */
export interface RecordingTrackStopFailure {
  readonly target: RecordingTrackStopTarget
  readonly domain: string
  readonly code: number
  readonly message: string
}

/** Swift L46-48：失败消息格式 —— 「<轨道名>轨道停止失败：<原始描述>」。 */
export function recordingTrackStopFailureMessage(
  target: RecordingTrackStopTarget,
  message: string
): string {
  return `${recordingTrackStopTargetDisplayName(target)}轨道停止失败：${message}`
}

/** Swift L32-49：构造一条失败记录。 */
export function recordingTrackStopFailure(input: {
  readonly target: RecordingTrackStopTarget
  readonly domain: string
  readonly code: number
  readonly message: string
}): RecordingTrackStopFailure {
  return {
    target: input.target,
    domain: input.domain,
    code: input.code,
    message: input.message,
  }
}

/**
 * Swift L60-63：回滚失败的合成消息。
 *
 * 起始失败的描述放在最前，后面用「；」接上各轨道的清理失败 —— 清理失败是次要信息，
 * 但它不能丢：用户看到的第一个错往往是「起不来」，而真正需要人工处理的是
 * 「停不掉」的那一半（文件句柄还开着，下次录制会撞上）。
 */
export function recordingPreparationRollbackMessage(input: {
  readonly startFailureMessage: string
  readonly stopFailures: readonly RecordingTrackStopFailure[]
}): string {
  const cleanup = input.stopFailures
    .map((failure) => recordingTrackStopFailureMessage(failure.target, failure.message))
    .join('；')
  return cleanup.length === 0 ? input.startFailureMessage : `${input.startFailureMessage}；${cleanup}`
}

/** Swift L66-70：单轨的停止结果 —— 成功时带输出 URL，失败时带失败记录。 */
export interface RecordingTrackStopOutcome {
  readonly target: RecordingTrackStopTarget
  readonly outputURL: string | null
  readonly failure: RecordingTrackStopFailure | null
}

/**
 * Swift L276-293：错误不向上抛，而是转成 outcome。
 *
 * 三路是并发跑的（`async let`），任何一路抛出都会让 `await` 整体抛错，
 * 于是另外两路的结果就丢了 —— 包括已经写好的文件 URL。所以每一路内部
 * 自己吞掉错误，最后统一汇总。
 */
export function recordingTrackStopOutcome(input: {
  readonly target: RecordingTrackStopTarget
  readonly outputURL: string | null
  readonly failure: RecordingTrackStopFailure | null
}): RecordingTrackStopOutcome {
  return { target: input.target, outputURL: input.outputURL, failure: input.failure }
}

/** Swift L77-79：从全部结果里挑出失败项。 */
export function recordingTrackFinalizationFailures(
  outcomes: readonly RecordingTrackStopOutcome[]
): RecordingTrackStopFailure[] {
  const failures: RecordingTrackStopFailure[] = []
  for (const outcome of outcomes) {
    if (outcome.failure !== null) failures.push(outcome.failure)
  }
  return failures
}

/**
 * Swift L81-83：按轨道取输出 URL。
 *
 * 用 `first(where:)` 而不是字典 —— 同一个轨道理论上只出现一次，
 * 用 `first` 就算出现两次也不会抛（字典构造会）。
 */
export function recordingTrackFinalizationOutputURL(
  outcomes: readonly RecordingTrackStopOutcome[],
  target: RecordingTrackStopTarget
): string | null {
  for (const outcome of outcomes) {
    if (outcome.target === target) return outcome.outputURL
  }
  return null
}

// ---------------------------------------------------------------- 错误

/** Swift L86-93：三种收尾错误。 */
export type RecordingTrackFinalizerErrorKind =
  | 'stale-run'
  | 'intent-conflict'
  | 'another-run-finalizing'

/**
 * Swift L95-104：三种错误的中文描述。
 *
 * 三条都在解释「为什么不能这么做」而不是「失败了」：收尾冲突是**拒绝**而不是故障，
 * 用户/上层需要知道的是当前状态，重试没有意义。
 */
export const RECORDING_TRACK_FINALIZER_ERRORS: Readonly<
  Record<RecordingTrackFinalizerErrorKind, string>
> = {
  'stale-run': '这次录制已结束或已被替换，不能再停止它的轨道。',
  'intent-conflict': '这次录制已经按另一种方式结束，不能在写入过程中改变结束意图。',
  'another-run-finalizing': '另一次录制仍在结束写入，不能同时停止新的录制。',
}

/** Swift L95-104：按错误种类取描述。 */
export function recordingTrackFinalizerErrorDescription(
  kind: RecordingTrackFinalizerErrorKind
): string {
  return RECORDING_TRACK_FINALIZER_ERRORS[kind]
}

// ---------------------------------------------------------------- 前置判定

/**
 * Swift L156-191：`finalize` 的六种走向。
 *
 * 判定顺序**就是**语义，不能重排：
 *   1. `completed` 里已有同 run → 意图相同直接复用结果（幂等），不同报冲突
 *   2. `active` 里已有进行中的收尾 → 同 run 同意图**加入**它的 Task，同 run 异意图报冲突，
 *      异 run 报「另一个还在收尾」
 *   3. 都不是 → 校验 `currentRunID`，不匹配报 stale
 *   4. 全过 → `start`
 *
 * 第 1 步放在第 2 步之前是必须的：完成记录存在时说明那次收尾已经结束，
 * 此时再去 join 一个不存在的 active 会白等。
 */
export type RecordingTrackFinalizerDecision =
  | 'reuse-completed'
  | 'intent-conflict-completed'
  | 'join-active'
  | 'intent-conflict-active'
  | 'another-run-finalizing'
  | 'stale-run'
  | 'start'

export function recordingTrackFinalizerDecision(input: {
  readonly requestRunID: string
  readonly requestIntentKey: string
  readonly completedRunID: string | null
  readonly completedIntentKey: string | null
  readonly activeRunID: string | null
  readonly activeIntentKey: string | null
  readonly currentRunID: string | null
}): RecordingTrackFinalizerDecision {
  if (input.completedRunID !== null && input.completedRunID === input.requestRunID) {
    return input.completedIntentKey === input.requestIntentKey
      ? 'reuse-completed'
      : 'intent-conflict-completed'
  }
  if (input.activeRunID !== null) {
    if (input.activeRunID !== input.requestRunID) return 'another-run-finalizing'
    return input.activeIntentKey === input.requestIntentKey ? 'join-active' : 'intent-conflict-active'
  }
  return input.currentRunID === input.requestRunID ? 'start' : 'stale-run'
}

/**
 * Swift L195-197：只有当这次录制启动过光标轨道时才去冻结。
 *
 * 冻结动作要在**建 Task 之前、任何 await 之前**完成（注释 L193-194）：
 * 它做的是「移除全局事件监听器」这个同步动作，一旦先 await，监听器还会在
 * 这段时间里继续收事件，写进文件的指针记录就会超出录制时长。
 */
export function recordingTrackFinalizerFreezesPointer(startedTracks: number): boolean {
  return recordingTrackFinalizationTrackStarted(startedTracks, 'pointer')
}

/**
 * Swift L160 / L208-211：收尾结束后是否把 active 清空并写入 completed。
 *
 * `active?.request == request` 这个比较不能省：如果期间另一个 run 的收尾
 * 已经把 active 换掉了，这里就不能把它清掉，否则会抹掉别人的进行中记录。
 */
export function recordingTrackFinalizerClearsActive(input: {
  readonly activeRunID: string | null
  readonly activeIntentKey: string | null
  readonly requestRunID: string
  readonly requestIntentKey: string
}): boolean {
  return (
    input.activeRunID === input.requestRunID && input.activeIntentKey === input.requestIntentKey
  )
}

// ---------------------------------------------------------------- 停止计划

/**
 * Swift L245-260：主轨道只停一个 —— 设备（iOS）优先于屏幕。
 *
 * 这两个是互斥的采集源：连着 iPhone 录的时候屏幕录制不启动，所以那个分支
 * 只是「万一两个标记都为真」时的兜底，取设备更符合用户的直觉（他刚刚插的线）。
 */
export function recordingTrackFinalizerPrimaryTarget(input: {
  readonly startedTracks: number
  readonly deviceTrackBit: number
  readonly screenTrackBit: number
}): RecordingTrackStopTarget | null {
  if ((input.startedTracks & input.deviceTrackBit) !== 0) return 'iosDevice'
  if ((input.startedTracks & input.screenTrackBit) !== 0) return 'screen'
  return null
}

/**
 * Swift L220-238：三路并发停止的固定顺序（主 / 摄像头 / 麦克风）。
 *
 * 顺序固定是为了让 outcome 数组的顺序可预测 —— UI 的错误列表按这个顺序显示，
 * 不然每次报错的排列都会变。
 */
export const RECORDING_TRACK_FINALIZER_OUTCOME_TARGETS = ['primary', 'camera', 'microphone'] as const

/** Swift L263-274：辅助轨道（摄像头 / 麦克风）在启动过时才停。 */
export function recordingTrackFinalizerAuxiliaryTargets(startedTracks: number): RecordingTrackStopTarget[] {
  const targets: RecordingTrackStopTarget[] = []
  if ((startedTracks & RECORDING_TRACK_BIT.camera) !== 0) targets.push('camera')
  if ((startedTracks & RECORDING_TRACK_BIT.microphone) !== 0) targets.push('microphone')
  return targets
}

/**
 * Swift RecordingRun.swift 里 `RecordingStartedTracks` 的位定义。
 *
 * 与 RecordingRun.ts 的同名常量保持一致：这里是收尾器侧的局部别名，
 * 避免两个模块互相 import（主进程与渲染进程的依赖方向是单向的）。
 */
export const RECORDING_TRACK_BIT = {
  screen: 1,
  device: 2,
  camera: 4,
  microphone: 8,
  pointer: 16,
} as const

/** 判断某个轨道位是否置起。 */
export function recordingTrackFinalizationTrackStarted(startedTracks: number, track: keyof typeof RECORDING_TRACK_BIT): boolean {
  return (startedTracks & RECORDING_TRACK_BIT[track]) !== 0
}

/**
 * Swift L234-238：把三路结果按「主 → 摄像头 → 麦克风」拼起来，并丢掉 nil。
 *
 * `compactMap { $0 }` 会丢掉「没启动所以没停」的那两路 —— 它们既不是成功也不是失败，
 * 留在结果里会让「0 个失败」和「2 个轨道没启动」难以区分。
 */
export function recordingTrackFinalizationOutcomes(input: {
  readonly primary: RecordingTrackStopOutcome | null
  readonly camera: RecordingTrackStopOutcome | null
  readonly microphone: RecordingTrackStopOutcome | null
}): RecordingTrackStopOutcome[] {
  const outcomes: RecordingTrackStopOutcome[] = []
  for (const candidate of [input.primary, input.camera, input.microphone]) {
    if (candidate !== null) outcomes.push(candidate)
  }
  return outcomes
}

/**
 * Swift L280-292：操作成功时 URL 可能为 nil（摄像头/麦克风没有独立输出文件）。
 *
 * 这一条决定了「成功」不能写成 `outputURL !== null`：辅助轨道永远拿不到 URL，
 * 那样会把每一次正常收尾都判成失败。
 */
export function recordingTrackStopSucceeded(outcome: RecordingTrackStopOutcome): boolean {
  return outcome.failure === null
}

/**
 * Swift L195-197 / L220：这次收尾一共有几路要等。
 *
 * 1（主，可能为 0）+ 摄像头 + 麦克风。用于判断「全部完成」的进度显示 ——
 * 主轨道没启动时不能算进去，否则进度条永远停在 2/3。
 */
export function recordingTrackFinalizerPendingCount(startedTracks: number): number {
  const hasPrimary =
    (startedTracks & RECORDING_TRACK_BIT.device) !== 0 || (startedTracks & RECORDING_TRACK_BIT.screen) !== 0
  let count = hasPrimary ? 1 : 0
  if ((startedTracks & RECORDING_TRACK_BIT.camera) !== 0) count += 1
  if ((startedTracks & RECORDING_TRACK_BIT.microphone) !== 0) count += 1
  return count
}
