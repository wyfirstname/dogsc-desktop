/**
 * 裁切模式的呈现适配 —— Swift EditorCropPresentation.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorCropPresentation.swift（87 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - 三个模式枚举（工具栏 / 检查器 / 画布）           L6-19
 *   - 六个工具栏动作                                  L21-28
 *   - init(interaction:)：工具与选择同时为 crop 才进入  L38-54
 *   - isActive / permits(_:) 同步闸门矩阵              L56-80
 *
 * 原注释：这是**纯呈现适配器**，自己不持有任何布尔量或草稿 ——
 * `EditorInteractionDraft` 始终是唯一真相来源。三个表面各自是独立取值，
 * 因此「呈现漂移」（工具栏已切、画布没切）可以被断言抓到。
 *
 * `permits` 是同步闸门：可见控件与它们的动作共用同一判据，阻止一个排队中的
 * 常规动作在裁切已经开始之后才执行 —— 不引入焦点态、不防抖、不延迟。
 */

import { clampedCrop, type NormalizedCrop } from './ProjectModel'

export type EditorCropToolbarMode = 'standardControls' | 'cropControls'
export type EditorCropInspectorMode = 'selectedInspector' | 'cropInspector'
export type EditorCropCanvasMode = 'composition' | 'cropEditor'

export type EditorCropToolbarAction =
  | 'changeCanvasAspectRatio'
  | 'beginCrop'
  | 'openScreenAppearance'
  | 'resetCrop'
  | 'cancelCrop'
  | 'confirmCrop'

export const EDITOR_CROP_TOOLBAR_ACTIONS: readonly EditorCropToolbarAction[] = [
  'changeCanvasAspectRatio',
  'beginCrop',
  'openScreenAppearance',
  'resetCrop',
  'cancelCrop',
  'confirmCrop',
]

/** 进入裁切的三个动作（常规工具栏里可用）。 */
export const EDITOR_STANDARD_TOOLBAR_ACTIONS: readonly EditorCropToolbarAction[] = [
  'changeCanvasAspectRatio',
  'beginCrop',
  'openScreenAppearance',
]

/** 只在裁切工具栏里可用的三个动作。 */
export const EDITOR_CROP_ONLY_ACTIONS: readonly EditorCropToolbarAction[] = [
  'resetCrop',
  'cancelCrop',
  'confirmCrop',
]

/** 进入裁切所需的交互草稿（`EditorInteractionDraft` 的最小子集）。 */
export interface EditorCropInteractionLike {
  readonly tool: string
  readonly selection: string
  /** 当前预览工程的裁切值（尚未 clamp）。 */
  readonly crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}


export interface EditorCropPresentation {
  readonly toolbarMode: EditorCropToolbarMode
  readonly inspectorMode: EditorCropInspectorMode
  readonly canvasMode: EditorCropCanvasMode
  readonly draft: NormalizedCrop | null
}

/**
 * Swift init：**工具与选择必须同时是 crop**。
 * 只判工具会在「工具已切到 crop 但选择还是片段」的瞬间误进裁切模式。
 */
export function editorCropPresentation(
  interaction: EditorCropInteractionLike | null
): EditorCropPresentation {
  if (interaction == null || interaction.tool !== 'crop' || interaction.selection !== 'crop') {
    return {
      toolbarMode: 'standardControls',
      inspectorMode: 'selectedInspector',
      canvasMode: 'composition',
      draft: null,
    }
  }
  return {
    toolbarMode: 'cropControls',
    inspectorMode: 'cropInspector',
    canvasMode: 'cropEditor',
    draft: clampedCrop(interaction.crop),
  }
}

/** Swift `isActive`：只看工具栏模式（三个模式恒同步，判一个即可）。 */
export function editorCropPresentationIsActive(presentation: EditorCropPresentation): boolean {
  return presentation.toolbarMode === 'cropControls'
}

/** Swift `permits(_:)` 的完整矩阵。 */
export function editorCropToolbarPermits(
  mode: EditorCropToolbarMode,
  action: EditorCropToolbarAction
): boolean {
  const standardAction = EDITOR_STANDARD_TOOLBAR_ACTIONS.includes(action)
  if (mode === 'standardControls') return standardAction
  return !standardAction
}
