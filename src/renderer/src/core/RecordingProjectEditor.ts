/**
 * Swift source: Sources/DogSCApp/RecordingProjectEditor.swift（130 行）@ 567fd6e
 *
 * L8-13   → 持有的单一模型 + 保存屏障标志
 * L15-18  → presentedModel：只有 phase == .editor 才呈现
 * L20-47  → openProject：已有模型时先过三道闸，否则新建
 * L51-71  → closeForReplacement：新录制完成、要用它替换旧编辑器
 * L75-94  → flushForTermination：退出前落盘但**不**解绑，取消退出还能回来
 * L102-112→ canCrossSaveBarrier
 * L114-120→ restoreEditor：失败文案 `保存项目失败：%@`
 *
 * 原注释：录制器保留自己的文档、运行与设备租约；现有单一编辑器窗口呈现这个模型，
 * 但不会启动任何实时输入。
 */

export const EDITOR_BUSY_MESSAGE = '请先完成当前项目的打开、保存或导出操作。'

/** `保存项目失败：%@` 的格式化（Swift L115）。 */
export function projectSaveFailureMessage(reason: string): string {
  return `保存项目失败：${reason}`
}

export type EditorPhase = 'setup' | 'editor' | 'finishing'

export interface EditorModelLike {
  readonly phase: EditorPhase
  readonly isExporting: boolean
  readonly isMediaExchangeRunning: boolean
  readonly hasSession: boolean
  readonly errorMessage?: string | null
}

/**
 * 能否跨越保存屏障（Swift L102-112）。
 *
 * 五条同时成立才可以：没有正在进行的换挡、处于编辑器阶段、有活跃会话、
 * 不在导出、不在媒体交换。任何一条不满足都报同一句话 —— 对用户来说
 * 「现在不能动」比「因为某某原因不能动」更有用。
 */
export function canCrossSaveBarrier(input: {
  readonly isCrossingSaveBarrier: boolean
  readonly model: EditorModelLike | null
}): boolean {
  if (input.isCrossingSaveBarrier) return false
  const model = input.model
  if (!model) return false
  return model.phase === 'editor' && model.hasSession && !model.isExporting && !model.isMediaExchangeRunning
}

/** 打开项目的前置判定（Swift L21-31）：已有模型时只允许在这些条件下切换。 */
export type OpenProjectDecision =
  | { readonly kind: 'ignore' }
  | { readonly kind: 'reuseModel' }
  | { readonly kind: 'createModel' }
  | { readonly kind: 'reject'; readonly message: string }

export function openProjectDecision(input: {
  readonly isCrossingSaveBarrier: boolean
  readonly hasModel: boolean
  readonly model: EditorModelLike | null
}): OpenProjectDecision {
  if (input.isCrossingSaveBarrier) return { kind: 'ignore' }
  if (!input.hasModel || input.model === null) return { kind: 'createModel' }
  const model = input.model
  const reusable = model.phase === 'editor' && !model.isExporting && !model.isMediaExchangeRunning
  return reusable ? { kind: 'reuseModel' } : { kind: 'reject', message: EDITOR_BUSY_MESSAGE }
}

/**
 * 阶段观察回调（Swift L38-44）：模型回到 `setup` 说明项目已被关闭/失败，
 * 于是把错误抛给宿主并释放模型；任何阶段变化都要通知呈现层。
 */
export type PhaseObservationAction =
  | { readonly kind: 'releaseWithError'; readonly message: string }
  | { readonly kind: 'release' }
  | { readonly kind: 'notifyOnly' }

export function phaseObservationAction(input: {
  readonly isCurrentModel: boolean
  readonly phase: EditorPhase
  readonly errorMessage?: string | null
}): PhaseObservationAction {
  if (!input.isCurrentModel) return { kind: 'notifyOnly' }
  if (input.phase !== 'setup') return { kind: 'notifyOnly' }
  return input.errorMessage
    ? { kind: 'releaseWithError', message: input.errorMessage }
    : { kind: 'release' }
}

export type SaveBarrierOutcome =
  | { readonly ok: true; readonly action: 'closeProject' | 'stayOpen' }
  | { readonly ok: false; readonly message: string }

/**
 * 替换 / 退出两条落盘路径的共同结构（Swift L51-94）：
 * 先抬屏障 → 记快照 → 进入 `finishing` → flush → 成功后按用途决定是否解绑。
 *
 * 差别只有一处：替换会 `flushAndInvalidate`（并关闭项目），退出只 `flush`
 * 且必须回到 `editor` —— 因为取消退出的用户还要继续编辑。
 */
export function saveBarrierOutcome(input: {
  readonly purpose: 'replacement' | 'termination'
  readonly flushReturnedReceipt: boolean
  readonly failureReason?: string | null
}): SaveBarrierOutcome {
  if (!input.flushReturnedReceipt) {
    return {
      ok: false,
      // Swift 用 CocoaError(.fileWriteUnknown) 兜住「flush 返回 nil」
      message: projectSaveFailureMessage(input.failureReason ?? '未能写入项目文件。'),
    }
  }
  if (input.purpose === 'replacement') return { ok: true, action: 'closeProject' }
  return { ok: true, action: 'stayOpen' }
}

/** 失败恢复时设置的三件事（Swift L114-120）。 */
export function restoreEditorState(message: string): {
  errorMessage: string
  phase: EditorPhase
  transitionStage: 'idle'
} {
  return { errorMessage: message, phase: 'editor', transitionStage: 'idle' }
}
