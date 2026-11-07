/**
 * 场景预设弹窗 —— 保存/更新一套呈现配置，以及应用前的裁切适配预览。
 *
 * Swift source: Sources/DogSCApp/EditorScenePresetSheet.swift（179 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorScenePresetSheet                 L5-94
 *   - 标题（更新/保存两种）、副标题                  L19-24  → scenePresetSheetTitle / SCENE_PRESET_SHEET_SUBTITLE
 *   - 名称行（12 medium / 圆角边框 / 保存中禁用）    L25-30  → SCENE_PRESET_NAME_ROW
 *   - 重名提示                                      L31-35  → SCENE_PRESET_CONFLICT_HINT
 *   - 四行配置说明                                  L37-49  → SCENE_PRESET_CONFIGURATION_ROWS
 *   - 底部说明                                      L52-55  → SCENE_PRESET_FOOTNOTE
 *   - 保存中指示                                    L60-63  → SCENE_PRESET_SAVING_LABEL
 *   - 两个按钮与保存闸门                            L64-75  → scenePresetSaveEnabled
 *   - configurationRow(_:_:_:)                     L85-93  → SCENE_PRESET_CONFIGURATION_ROWS
 *   - struct EditorScenePresetPreview                L96-169 → scenePresetPreviewSize / sceneCropSummary
 *   - sceneCropSummary(_:size:)                     L171-178 → sceneCropSummary
 *
 * 迁移说明：SwiftUI 的 sheet 在 React 侧用 antd Modal 承载；`@FocusState` →
 * autoFocus，`interactiveDismissDisabled` → maskClosable={false}。
 * 保留的是文案、度量、保存闸门与两个公式（预览尺寸、裁切摘要）。
 */

import type { NormalizedCrop } from './ProjectModel'
import { NORMALIZED_CROP_FULL, clampedCrop, cropBottom, cropLeft, cropRight, cropTop } from './ProjectModel'

/** Swift L20：标题。 */
export function scenePresetSheetTitle(isUpdating: boolean): string {
  return isUpdating ? '更新场景预设' : '保存场景预设'
}

/** Swift L70：主按钮文案。 */
export function scenePresetSaveTitle(isUpdating: boolean): string {
  return isUpdating ? '更新预设' : '保存预设'
}

/** Swift L22。 */
export const SCENE_PRESET_SHEET_SUBTITLE = '把这套配置留给下一次录制。'

/** Swift L26：名称行标签。 */
export const SCENE_PRESET_NAME_LABEL = '预设名称'

/** Swift L27：输入框占位。 */
export const SCENE_PRESET_NAME_PLACEHOLDER = '例如：全屏上下裁切'

/** Swift L32：重名提示。 */
export const SCENE_PRESET_CONFLICT_HINT =
  '这个名称已存在，请换一个名称；更新已有预设请使用“更新此预设”。'

/** Swift L52-53。 */
export const SCENE_PRESET_FOOTNOTE =
  '保留当前项目的素材、剪辑、分段声音和时间线动画。新录制默认场景可在预设菜单中单独选择。'

/** Swift L62。 */
export const SCENE_PRESET_SAVING_LABEL = '正在保存背景与配置…'

/** Swift L65 / L154：取消按钮文案。 */
export const SCENE_PRESET_CANCEL_LABEL = '取消'

/** Swift L155：预览页主按钮。 */
export const SCENE_PRESET_APPLY_LABEL = '应用预设'

/** Swift L77：弹窗宽度 480、内边距 24。 */
export const SCENE_PRESET_SHEET_WIDTH = 480
export const SCENE_PRESET_SHEET_PADDING = 24

/** Swift L78 / L159：预览弹窗宽 500。 */
export const SCENE_PRESET_PREVIEW_WIDTH = 500

/** Swift L18-19：外层间距 20、标题区块 6。 */
export const SCENE_PRESET_SHEET_SPACING = 20
export const SCENE_PRESET_HEADER_SPACING = 6

/** Swift L25：名称区块间距 7；L37：配置区块间距 13；L50：配置块内边距 16。 */
export const SCENE_PRESET_NAME_SPACING = 7
export const SCENE_PRESET_CONFIGURATION_SPACING = 13
export const SCENE_PRESET_CONFIGURATION_PADDING = 16

/** Swift L26 / L89 / L90 的字号。 */
export const SCENE_PRESET_NAME_FONT_SIZE = 12
export const SCENE_PRESET_ROW_TITLE_SIZE = 12
export const SCENE_PRESET_ROW_DETAIL_SIZE = 11
export const SCENE_PRESET_ROW_ICON_SIZE = 14
export const SCENE_PRESET_ROW_ICON_WIDTH = 18
/** Swift L86：图标与文字的间距 10；L88：标题与详情 3。 */
export const SCENE_PRESET_ROW_SPACING = 10
export const SCENE_PRESET_ROW_TEXT_SPACING = 3

/** Swift L38-48：四行配置说明（顺序即渲染顺序）。 */
export interface ScenePresetConfigurationRow {
  readonly icon: string
  readonly title: string
  readonly detail: string
}

export const SCENE_PRESET_CONFIGURATION_ROWS: readonly ScenePresetConfigurationRow[] = [
  {
    icon: 'rectangle.inset.filled',
    title: '画布与屏幕',
    detail: '比例、大小、位置、裁切、样机、描边与阴影',
  },
  {
    icon: 'person.crop.rectangle',
    title: '摄像头',
    detail: '显隐、布局、形状、外观与蒙版取景',
  },
  {
    icon: 'cursorarrow.motionlines',
    title: '光标与运镜',
    detail: '光标效果、开场与新动画默认值',
  },
  {
    icon: 'speaker.wave.2',
    title: '声音与背景',
    detail: '全片音量、静音和背景资源副本',
  },
]

/**
 * Swift L74：
 *   .disabled(isSaving || nameConflict || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
 *
 * 三个条件都要挡：正在保存（重复提交）、重名（会覆盖别人的预设）、
 * 只有空白（存下去就是个没法辨认的预设）。
 */
export function scenePresetSaveEnabled(input: {
  readonly isSaving: boolean
  readonly nameConflict: boolean
  readonly name: string
}): boolean {
  if (input.isSaving) return false
  if (input.nameConflict) return false
  return input.name.trim() !== ''
}

/**
 * Swift L142-143：预览画框尺寸。
 *   width  = min(452, 260 × 源宽 / 源高)
 *   height = min(260, 452 × 源高 / 源宽)
 *
 * 两式互为倒数，取 min 保证宽高都不超过 452×260；宽高比由源素材决定。
 * 源尺寸为 0 时按 1 处理（`max(…, 1)`）。
 */
export function scenePresetPreviewSize(sourceSize: {
  readonly width: number
  readonly height: number
}): { readonly width: number; readonly height: number } {
  const width = Math.max(sourceSize.width, 1)
  const height = Math.max(sourceSize.height, 1)
  return {
    width: Math.min(452, (260 * width) / height),
    height: Math.min(260, (452 * height) / width),
  }
}

/** Swift L109 / L158-159：预览弹窗的内外边距与圆角。 */
export const SCENE_PRESET_PREVIEW_LAYOUT = {
  spacing: 18,
  headerSpacing: 5,
  padding: 24,
  cornerRadius: 10,
  /** L130：裁切外遮罩的不透明度。 */
  maskOpacity: 0.6,
  /** L131：亮框描边宽度。 */
  outlineWidth: 2,
} as const

/** Swift L116 / L135 / L150 的三条文案。 */
export const SCENE_PRESET_PREVIEW_TEXTS = {
  title: '检查裁切适配',
  cropNotice: '录制尺寸不同，裁切将按比例适配。亮框内的画面会保留。',
  thumbnailUnavailable: '预览暂不可用，可取消后稍后重试。',
  undoNotice: '应用后可一次撤销，素材与时间线片段保持原样。',
} as const

/** Swift L146：预览的无障碍标签。 */
export const SCENE_PRESET_PREVIEW_ACCESSIBILITY_LABEL = '裁切适配预览'

/** Swift L113：尺寸换算说明。 */
export function scenePresetDimensionSummary(input: {
  readonly sourceDimensions: { readonly width: number; readonly height: number } | null
  readonly currentSize: { readonly width: number; readonly height: number }
}): string | null {
  if (input.sourceDimensions === null) return null
  return `${input.sourceDimensions.width} × ${input.sourceDimensions.height} → ${Math.trunc(input.currentSize.width)} × ${Math.trunc(input.currentSize.height)}`
}

/**
 * Swift L171-178：
 *   let crop = value.clamped()
 *   if crop == .full { return appLocalized("完整画面") }
 *   return "上 \(Int((crop.top × size.height).rounded())) · 下 … · 左 … · 右 … px"
 *
 * 四个值都是**像素**、都取四舍五入。顺序固定为 上/下/左/右 —— 与面板里
 * 四个输入框的物理位置一致，不按字母序也不按数值大小。
 */
export function sceneCropSummary(
  crop: NormalizedCrop,
  size: { readonly width: number; readonly height: number },
  translate: (key: string) => string = (key) => key
): string {
  const clamped = clampedCrop(crop)
  if (normalizedCropIsFull(clamped)) return translate('完整画面')
  const part = (label: string, value: number): string =>
    `${translate(label)} ${Math.round(value)}`
  return [
    part('上', cropTop(clamped) * size.height),
    part('下', cropBottom(clamped) * size.height),
    part('左', cropLeft(clamped) * size.width),
    part('右', cropRight(clamped) * size.width),
  ].join(' · ') + ' px'
}

/** Swift L173：`crop == .full`。 */
export function normalizedCropIsFull(crop: NormalizedCrop): boolean {
  return (
    crop.x === NORMALIZED_CROP_FULL.x &&
    crop.y === NORMALIZED_CROP_FULL.y &&
    crop.width === NORMALIZED_CROP_FULL.width &&
    crop.height === NORMALIZED_CROP_FULL.height
  )
}

/**
 * Swift L119-121：预览里亮框的矩形（相对画框）。
 *   x = crop.x × 宽，y = crop.y × 高，w = crop.width × 宽，h = crop.height × 高
 */
export function scenePresetOutlineRect(
  crop: NormalizedCrop,
  size: { readonly width: number; readonly height: number }
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const clamped = clampedCrop(crop)
  return {
    x: clamped.x * size.width,
    y: clamped.y * size.height,
    width: clamped.width * size.width,
    height: clamped.height * size.height,
  }
}
