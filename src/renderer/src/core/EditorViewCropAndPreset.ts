/**
 * Swift source: Sources/DogSCApp/EditorViewCropAndPreset.swift（95 行）@ 567fd6e
 *
 * L7-19  → canvasBinding：写回整份 CanvasStyle（带 actionName 进撤销栈）
 * L21-27 → performEditorCommand：失败统一走 reportError
 * L29-31 → editorWindow（按窗口标识查找）
 * L33-42 → beginCrop
 * L44-55 → confirmCrop
 * L57-63 → discardCrop
 * L65-68 → resetCrop
 * L70-84 → cropDraft / cropDraftBinding
 * L86-93 → resolveExternalAction
 *
 * 原注释（L37-38）：裁切期间检查器由裁切面板接管；完成/取消后选择回到屏幕初始
 * 状态，都落在合并后的「画面」页，因此不需要在这里预设页签。
 */

import {
  editorCropPresentationIsActive,
  editorCropToolbarPermits,
  type EditorCropPresentation,
  type EditorCropToolbarAction,
} from './EditorCropPresentation'
import { clampedCrop, type NormalizedCrop } from './ProjectModel'

/** 编辑器窗口标识（Swift `cn.laogou.dogsc.editor-window`）。 */
export const EDITOR_WINDOW_IDENTIFIER = 'cn.laogou.dogsc.editor-window'

/** 裁切重置值：整幅画面。 */
export const CROP_FULL: NormalizedCrop = { x: 0, y: 0, width: 1, height: 1 }

export type CropCommandPlan =
  | { readonly kind: 'ignored' }
  | {
      readonly kind: 'run'
      /** 是否先把播放头停下并让悬浮预览让位（只有 beginCrop 需要）。 */
      readonly stopsPlayback: boolean
      /** 是否做窗口级淡化过渡（三段都做）。 */
      readonly crossfadesWindow: boolean
      /** 提交/取消后是否回到屏幕选择。 */
      readonly resetsSelectionToScreen: boolean
    }

const ignored: CropCommandPlan = { kind: 'ignored' }

/**
 * 三个裁切命令的前置闸门。
 *
 * `permits` 是**同步**闸门：裁切进行中时常规工具栏的动作全部被挡下，
 * 这样排队中的「切比例」不会在裁切开始后才执行。开始裁切还要额外停播 + 让位，
 * 否则画布上会同时出现播放头和裁切框。
 */
export function cropCommandPlan(
  presentation: EditorCropPresentation,
  action: Extract<EditorCropToolbarAction, 'beginCrop' | 'confirmCrop' | 'cancelCrop' | 'resetCrop'>
): CropCommandPlan {
  if (!editorCropToolbarPermits(presentation.toolbarMode, action)) return ignored
  switch (action) {
    case 'beginCrop':
      return {
        kind: 'run',
        stopsPlayback: true,
        crossfadesWindow: true,
        resetsSelectionToScreen: false,
      }
    case 'confirmCrop':
    case 'cancelCrop':
      return {
        kind: 'run',
        stopsPlayback: false,
        crossfadesWindow: true,
        resetsSelectionToScreen: true,
      }
    case 'resetCrop':
      return {
        kind: 'run',
        stopsPlayback: false,
        crossfadesWindow: false,
        resetsSelectionToScreen: false,
      }
  }
}

/** 当前编辑中的裁切草稿：优先呈现草稿，没有则用工程值 clamp 后顶上。 */
export function cropDraftValue(
  presentation: EditorCropPresentation,
  projectCrop: NormalizedCrop
): NormalizedCrop {
  return presentation.draft ?? clampedCrop(projectCrop)
}

/**
 * 草稿写回是否放行：**只有裁切进行中**才允许拖动改变裁切。
 * 少了这一条，普通浏览时误触画布四角也会改到工程。
 */
export function cropDraftUpdateAllowed(presentation: EditorCropPresentation): boolean {
  return editorCropPresentationIsActive(presentation)
}

/**
 * 外部动作（导出 / 失焦 / 关窗 / 换工程）之后的选择修正：
 * 原本在裁切里，就退回到屏幕选择，避免停留在一个已经不存在的编辑态。
 */
export function selectionAfterExternalAction(input: {
  readonly wasCropping: boolean
  readonly selection: string
}): string {
  if (!input.wasCropping) return input.selection
  return input.selection === 'crop' ? 'screen' : input.selection
}

/**
 * 命令包装：Swift 用 `do/catch` + `hostActions.reportError`。
 * 这里把「抛错的命令」统一收敛成一个可断言的返回值，而不是让异常穿到 UI。
 */
export function performEditorCommand(
  operation: () => void,
  reportError: (message: string) => void
): boolean {
  try {
    operation()
    return true
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error))
    return false
  }
}
