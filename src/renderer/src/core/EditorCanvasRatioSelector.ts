/**
 * 画布比例选择器 —— 预设、方向、自定义输入共用一个弹出面板。
 *
 * Swift source: Sources/DogSCApp/EditorCanvasRatioSelector.swift（225 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorCanvasRatioSelector                   L5-225
 *   - presets（六个预设）                                L16     → EDITOR_CANVAS_RATIO_PRESETS
 *   - portrait（由解析后比例判方向）                      L17     → editorCanvasIsPortrait
 *   - selectedPreset（竖版折回横版）                      L18-26  → editorCanvasSelectedPreset
 *   - valueLabel                                         L27-31  → 直接用 aspectRatio 原值
 *   - customValue（0.1…10 的商约束）                      L32-37  → editorCanvasCustomAspectRatio
 *   - prepareFields（编辑态与文本回填）                   L43-47  → editorCanvasRatioFields
 *   - entryLabel / panel（320 宽、16 内边距）              L65-88  → EDITOR_CANVAS_RATIO_PANEL
 *   - controls（3 列网格、间距 8、项高 68）               L90-125 → EDITOR_CANVAS_RATIO_GRID
 *   - customRatioField（无障碍标识）                      L127-142 → editorCanvasCustomFieldID
 *   - presetButton（缩略比例尺寸）                        L144-190 → editorCanvasPresetThumbSize
 *   - orientationButton                                  L192-210
 *   - oriented(_:portrait:)（四个折返）                   L212-220 → editorCanvasOrientedRatio
 *   - number（%.3f 去尾零）                              L222-224 → editorCanvasRatioNumberText
 *
 * 原注释（L28-29）：
 *   Keep even very large user-entered pairs inside the popover; the toolbar must
 *   never grow wider because of the authored ratio text.
 *
 * 原注释（L130-131）：
 *   The workspace's pale graphite tint makes selected white text disappear in
 *   Dark Aqua. Text editing uses the system highlight.
 *
 * 迁移说明：SwiftUI 的 `@State`/`@FocusState` → React state；`matchedGeometryEffect`
 * → CSS 过渡。保留的纯逻辑是四张映射表：方向判定、选中项折返（竖版折回横版）、
 * 方向的四个折返对、以及 `%.3f` 去尾零的数字格式。
 */

import type { CanvasAspectRatio } from './ProjectModel'
import type { CanvasCustomAspectRatio } from './CanvasCustomAspectRatio'
import { resolvedFixedAspectRatio } from './CanvasCustomAspectRatio'

/** Swift L16：六个预设（顺序即面板里的排列）。 */
export const EDITOR_CANVAS_RATIO_PRESETS: readonly CanvasAspectRatio[] = [
  '适应',
  '16:9',
  '4:3',
  '2.39:1',
  '1:1',
  '自定义',
]

/** Swift L35：自定义比例的商必须落在 [0.1, 10]（即 1:10 至 10:1）。 */
export const EDITOR_CANVAS_CUSTOM_RATIO_MIN = 0.1
export const EDITOR_CANVAS_CUSTOM_RATIO_MAX = 10

/** Swift L86：面板宽度 320、内边距 16。 */
export const EDITOR_CANVAS_RATIO_PANEL_WIDTH = 320
export const EDITOR_CANVAS_RATIO_PANEL_PADDING = 16

/** Swift L92-93 / L171：三列网格、间距 8、每项高 68。 */
export const EDITOR_CANVAS_RATIO_GRID_COLUMNS = 3
export const EDITOR_CANVAS_RATIO_GRID_SPACING = 8
export const EDITOR_CANVAS_RATIO_ITEM_HEIGHT = 68

/** Swift L165：缩略框的最大边长 24 与包围盒 32。 */
export const EDITOR_CANVAS_RATIO_THUMB_MAX_EDGE = 24
export const EDITOR_CANVAS_RATIO_THUMB_BOX = 32

/** Swift L73：面板标题字号与关闭按钮字形。 */
export const EDITOR_CANVAS_RATIO_PANEL_TITLE_SIZE = 14
export const EDITOR_CANVAS_RATIO_CLOSE_GLYPH_SIZE = 14

/** Swift L113：自定义输入下方的说明文案。 */
export const EDITOR_CANVAS_RATIO_CUSTOM_HINT = '输入宽高比例，例如 3:2（支持 1:10 至 10:1）'

/** Swift L17：竖版判定 —— 用**解析后**的比例，不是选中的预设。 */
export function editorCanvasIsPortrait(resolvedAspectRatio: number | null): boolean {
  return (resolvedAspectRatio ?? 1) < 1
}

/**
 * Swift L18-26：选中项。
 *
 * 三层折返：
 *   1. 正在编辑自定义 → 恒为「自定义」
 *   2. `9:16` → `16:9`、`3:4` → `4:3`、`1:2.39` → `2.39:1`
 *      （竖版预设没有独立按钮，都挂在横版按钮上，方向由下面的方向开关决定）
 *   3. 其余原样
 */
export function editorCanvasSelectedPreset(input: {
  readonly aspectRatio: CanvasAspectRatio
  readonly editingCustom: boolean
}): CanvasAspectRatio {
  if (input.editingCustom) return '自定义'
  switch (input.aspectRatio) {
    case '9:16':
      return '16:9'
    case '3:4':
      return '4:3'
    case '1:2.39':
      return '2.39:1'
    default:
      return input.aspectRatio
  }
}

/**
 * Swift L32-37：自定义比例是否可用。
 *
 * 六条都要：宽高都能解析成有限数、都 > 0、商在 [0.1, 10]。
 * 注意这个校验与 `customAspectRatioValue` 的「夹取」不同 —— 这里**不夹**，
 * 越界就返回 null 让「应用」按钮禁用，用户能看到自己的输入被判无效。
 */
export function editorCanvasCustomAspectRatio(
  widthText: string,
  heightText: string
): CanvasCustomAspectRatio | null {
  const width = Number(widthText)
  const height = Number(heightText)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (!(width > 0) || !(height > 0)) return null
  const quotient = width / height
  if (quotient < EDITOR_CANVAS_CUSTOM_RATIO_MIN || quotient > EDITOR_CANVAS_CUSTOM_RATIO_MAX) {
    return null
  }
  return { width, height }
}

/**
 * Swift L222-224：`String(format: "%.3f", value)` 后去掉尾部的
 * 「可选点 + 连续的零」。
 *
 * `16` → `"16.000"` → `"16"`；`3.5` → `"3.500"` → `"3.5"`；
 * `0.3333` → `"0.333"`（三位小数后不再截断）。
 */
export function editorCanvasRatioNumberText(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const formatted = value.toFixed(3)
  const trimmed = formatted.replace(/\.?0+$/, '')
  return trimmed.length === 0 ? '0' : trimmed
}

/** Swift L43-47：打开面板时回填的两个字段。 */
export interface EditorCanvasRatioFields {
  readonly editingCustom: boolean
  readonly widthText: string
  readonly heightText: string
}

export function editorCanvasRatioFields(input: {
  readonly aspectRatio: CanvasAspectRatio
  readonly customAspectRatio: CanvasCustomAspectRatio
}): EditorCanvasRatioFields {
  return {
    editingCustom: input.aspectRatio === '自定义',
    widthText: editorCanvasRatioNumberText(input.customAspectRatio.width),
    heightText: editorCanvasRatioNumberText(input.customAspectRatio.height),
  }
}

/**
 * Swift L212-220：方向折返。
 *
 * 只对三个有竖版对应物的预设生效；`1:1` / `自定义` / `适应` 折返后不变。
 */
export function editorCanvasOrientedRatio(
  ratio: CanvasAspectRatio,
  portrait: boolean
): CanvasAspectRatio {
  if (!portrait) return ratio
  switch (ratio) {
    case '16:9':
      return '9:16'
    case '4:3':
      return '3:4'
    case '2.39:1':
      return '1:2.39'
    default:
      return ratio
  }
}

/** Swift L146-151：预设按钮里的缩略框比例。 */
export function editorCanvasPresetAspectValue(ratio: CanvasAspectRatio): number {
  switch (ratio) {
    case '16:9':
      return 16 / 9
    case '4:3':
      return 4 / 3
    case '2.39:1':
      return 2.39
    default:
      return 1
  }
}

/**
 * Swift L165：`min(24, 32 / aspect) * aspect` 宽、`min(24, 32 / aspect)` 高。
 *
 * 两个尺寸都用同一个 `min(24, 32 / aspect)` 基数，所以宽高比严格等于 `aspect`，
 * 且最长边不超过 32 —— 而不是「宽夹 24、高夹 24」那种会变形写法。
 */
export function editorCanvasPresetThumbSize(ratio: CanvasAspectRatio): {
  readonly width: number
  readonly height: number
} {
  const aspect = editorCanvasPresetAspectValue(ratio)
  const base = Math.min(EDITOR_CANVAS_RATIO_THUMB_MAX_EDGE, EDITOR_CANVAS_RATIO_THUMB_BOX / aspect)
  return { width: base * aspect, height: base }
}

/** Swift L141：自定义输入框的无障碍标识。 */
export function editorCanvasCustomFieldID(field: 'width' | 'height'): string {
  return field === 'width' ? 'editor.canvas.custom.width' : 'editor.canvas.custom.height'
}

/** Swift L160-162 / L167：这两个预设用图标而不是缩略框。 */
export function editorCanvasPresetUsesIcon(ratio: CanvasAspectRatio): boolean {
  return ratio === '自定义' || ratio === '适应'
}

/** Swift L161：图标名。 */
export function editorCanvasPresetSymbol(ratio: CanvasAspectRatio): string | null {
  if (ratio === '自定义') return 'slider.horizontal.3'
  if (ratio === '适应') return 'arrow.up.left.and.arrow.down.right'
  return null
}

/**
 * Swift L115：方向开关只在「非适应、非正方形」时出现。
 *
 * `1:1` 没有方向，`适应` 跟着源素材走 —— 两个都不该给方向开关。
 */
export function editorCanvasShowsOrientationControl(input: {
  readonly editingCustom: boolean
  readonly selectedPreset: CanvasAspectRatio
}): boolean {
  if (input.editingCustom) return false
  return input.selectedPreset !== '适应' && input.selectedPreset !== '1:1'
}

/**
 * Swift L167：电影比例的显示名特殊（`电影` 而不是 `2.39:1`）。
 *
 * 其它预设直接用 `rawValue` 作为翻译键。
 */
export function editorCanvasPresetTitleKey(ratio: CanvasAspectRatio): string {
  return ratio === '2.39:1' ? '电影' : ratio
}

/**
 * Swift L27-31：工具栏上的值标签。
 *
 * **只显示 `aspectRatio` 原值**，哪怕当前是「自定义 1234:567」。注释写得很明白：
 * 工具栏绝不能因为用户输入的超长比例而变宽。所以这里刻意不去拼真实数字。
 */
export function editorCanvasRatioValueLabel(aspectRatio: CanvasAspectRatio): string {
  return aspectRatio
}

/** Swift L17 的便捷包装：直接从 CanvasStyle 判方向。 */
export function editorCanvasStyleIsPortrait(style: Parameters<typeof resolvedFixedAspectRatio>[0]): boolean {
  return editorCanvasIsPortrait(resolvedFixedAspectRatio(style))
}
