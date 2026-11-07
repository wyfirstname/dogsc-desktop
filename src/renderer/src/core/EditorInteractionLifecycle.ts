/**
 * 编辑器交互生命周期 —— Swift EditorInteractionLifecycle.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorInteractionLifecycle.swift（29 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - enum EditorExternalAction              L5-17  → EditorExternalAction + 策略
 *   - enum EditorInteractionEndPolicy        L19-21 → 'cancel'
 *   - enum EditorExternalActionPreparation   L25-29 → 准备结果联合
 *
 * 原注释（L3-4）：
 *   System or editor-shell actions that must not observe a transient gesture
 *   preview as if it were persisted project state.
 */

/** Swift L5-10：外部动作。 */
export type EditorExternalAction =
  | 'export'
  | 'windowDeactivation'
  | 'windowClosing'
  | 'projectReplacement'

export const EDITOR_EXTERNAL_ACTIONS: readonly EditorExternalAction[] = [
  'export',
  'windowDeactivation',
  'windowClosing',
  'projectReplacement'
]

/** Swift L19-21：目前只有一种策略。 */
export type EditorInteractionEndPolicy = 'cancel'

/**
 * Swift L11-16：
 *   Auto-committing before mouse-up would turn an accidental interruption into
 *   a persisted edit. The store first resolves controls with an explicit
 *   autosave policy; this fallback applies to transient drags.
 *
 * 即：鼠标抬起前自动提交会把「误触中断」变成持久化编辑 —— 瞬时拖动一律取消。
 */
export function interactionEndPolicy(_action: EditorExternalAction): EditorInteractionEndPolicy {
  return 'cancel'
}

/** Swift L25-29：store 在放行外部动作之前做了什么。 */
export type EditorExternalActionPreparation = 'ready' | 'committedDraft' | 'cancelledDraft'

/**
 * Swift 语义：用 `interactionEndPolicy` 处理瞬时手势草稿，返回是否发生了变化。
 * 输入控件（有显式自动保存策略）由调用方自己处理，不走这里。
 */
export function prepareExternalAction(
  action: EditorExternalAction,
  hasTransientDraft: boolean
): EditorExternalActionPreparation {
  const policy = interactionEndPolicy(action)
  if (!hasTransientDraft) return 'ready'
  return policy === 'cancel' ? 'cancelledDraft' : 'committedDraft'
}

/**
 * 外部动作是否允许立即继续。
 *
 * 三种准备结果都放行 —— 区别只在于「期间发生了什么」：`ready` 原本没有草稿，
 * `committedDraft` 已提交，`cancelledDraft` 已丢弃。外部动作本身从不被它拦住，
 * 拦住的是「拿着半成品草稿去导出/关窗」这件事。
 */
export function preparationAllowsProceeding(
  _preparation: EditorExternalActionPreparation
): boolean {
  return true
}
