/**
 * EditorHexColorInput —— 十六进制颜色输入（色块 + 取色器 + 文本草稿）。
 *
 * Swift source: Sources/DogSCApp/EditorHexColorInput.swift（282 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L5-40    struct HexColorDraft（committed / text / parsed / isValid /
 *            isDirty / updateText / cancel / rebase）
 *   L45-225  struct EditorHexColorInput（六个 @State + 五个转移函数）
 *   L143-148 只在「脏且无效」时显示格式提示
 *   L150-158 外部值变化 → 是否 rebase
 *   L159-166 取色器开关 → begin / rebase + end
 *   L172-175 presentColorPicker
 *   L181-187 submitTextDraft
 *   L189-197 finishTextEditing
 *   L199-205 updateTextDraft
 *   L207-212 previewPickerColor
 *   L214-224 begin / endColorInteraction
 *   L229-282 struct EditorTransactionalColorInput
 *
 * 迁移说明：
 *   核心是**两份颜色值**（`draft.committed` 与 `pickerDraft`）与**一个布尔**
 *   （`interactionIsActive`）三者之间的时序。三处容易写错的地方：
 *     1. Esc 先把 `pickerDraft` 回滚到 `committed`，再 `draft.cancel()`，
 *        最后还要 `onPreview(committed)` —— 少最后一步画面上会留着草稿色。
 *     2. 失焦时若文本解析失败，是**回填 pickerDraft 的文本**而不是报错：
 *        用户把输入框清空再点别处，不该看到一条红色错误留在那里。
 *     3. `onChange(of: value)` 里 `!interactionIsActive || newValue != pickerDraft`
 *        才 rebase —— 自己触发的 preview 不能把基线改掉，否则 Esc 回不到原来。
 */

import { HexColor } from './HexColor'

/**
 * Swift L5-40：文本草稿。
 *
 * `isDirty` 比的是**文本**与 `committed.hexString`，不是解析结果与
 * `committed` —— 用户把 `#D8B26A` 打成小写 `#d8b26a` 也算脏（提示会消失，
 * 但 `isDirty` 为真、`isValid` 为真，所以不显示错误）。
 */
export class HexColorDraft {
  committed: HexColor
  text: string

  constructor(committed: HexColor) {
    this.committed = committed
    this.text = committed.hexString
  }

  /** Swift L14-16：每次现算，不缓存。 */
  get parsed(): HexColor | null {
    return HexColor.parse(this.text)
  }

  get isValid(): boolean {
    return this.parsed != null
  }

  get isDirty(): boolean {
    return this.text !== this.committed.hexString
  }

  /** Swift L26-28：只改文本，不动基线。 */
  updateText(value: string): void {
    this.text = value
  }

  /** Swift L30-32：回滚到基线。 */
  cancel(): void {
    this.text = this.committed.hexString
  }

  /**
   * Swift L36-39：接收外部变更（撤销、预设、切项目）。
   *
   * 同时替换 `committed` 与 `text` —— 只换 `committed` 会让文本停在旧值，
   * 只换 `text` 会让 Esc 回滚到更旧的颜色。
   */
  rebase(value: HexColor): void {
    this.committed = value
    this.text = value.hexString
  }
}

/** Swift L143：校验提示文案。 */
export const HEX_COLOR_INPUT_INVALID_MESSAGE = '请输入 6 位十六进制颜色，例如 #D8B26A'

/** Swift L84-89：色块 32×26，容器 36×30。 */
export const HEX_COLOR_SWATCH_WIDTH = 32
export const HEX_COLOR_SWATCH_HEIGHT = 26
export const HEX_COLOR_SWATCH_CONTAINER_WIDTH = 36
export const HEX_COLOR_SWATCH_CONTAINER_HEIGHT = 30
export const HEX_COLOR_SWATCH_CORNER_RADIUS = 5
export const HEX_COLOR_SWATCH_HIT_RADIUS = 7

/** Swift L110-121：文本框。 */
export const HEX_COLOR_FIELD_HEIGHT = 30
export const HEX_COLOR_FIELD_HORIZONTAL_PADDING = 9
export const HEX_COLOR_FIELD_CORNER_RADIUS = 7
export const HEX_COLOR_FIELD_FOCUSED_BORDER_WIDTH = 1
export const HEX_COLOR_FIELD_IDLE_BORDER_WIDTH = 0.75
export const HEX_COLOR_FIELD_FOCUSED_BORDER_ALPHA = 0.24
export const HEX_COLOR_FIELD_IDLE_BORDER_ALPHA = 0.085

/** Swift L82：色块描边透明度。 */
export const HEX_COLOR_SWATCH_BORDER_ALPHA = 0.24

/**
 * Swift L143：`draft.isDirty && !draft.isValid`。
 *
 * 两个条件都要：不脏（文本仍是基线）就没什么可提示的；脏但有效说明用户
 * 正在打一个合法的颜色，不该被打断。
 */
export function hexColorInputShowsValidation(draft: HexColorDraft): boolean {
  return draft.isDirty && !draft.isValid
}

/** Swift L83：色块填充色 —— 草稿有效就用草稿，否则退到基线。 */
export function hexColorInputSwatchColor(draft: HexColorDraft): HexColor {
  return draft.parsed ?? draft.committed
}

/**
 * Swift L199-205：改文本时立刻预览。
 *
 * 解析失败就**什么都不做**（不预览、不开始交互）—— 用户打到一半的
 * `#D8B2` 不该被当成一次编辑，否则撤销栈里会多出空命令。
 */
export function hexColorInputTextDraftUpdate(input: {
  readonly draft: HexColorDraft
  readonly text: string
}): {
  readonly color: HexColor | null
  readonly beginsInteraction: boolean
  readonly previewsColor: boolean
} {
  input.draft.updateText(input.text)
  const color = input.draft.parsed
  if (color == null) {
    return { color: null, beginsInteraction: false, previewsColor: false }
  }
  return { color, beginsInteraction: true, previewsColor: true }
}

/**
 * Swift L181-187：回车提交。
 *
 * 无效时**不提交也不失焦**：让用户还留在输入框里改。
 */
export function hexColorInputSubmit(draft: HexColorDraft): {
  readonly color: HexColor | null
  readonly rebases: boolean
  readonly blurs: boolean
} {
  const color = draft.parsed
  if (color == null) return { color: null, rebases: false, blurs: false }
  draft.rebase(color)
  return { color, rebases: true, blurs: true }
}

/**
 * Swift L189-197：失焦收尾。
 *
 * 无效时**回填 `pickerDraft.hexString`**（而不是保留用户输入的乱码，也不是
 * 报错）—— 这一条是「点走之后输入框自动恢复成上一个合法颜色」的来源。
 */
export type HexColorBlurAction = 'revert-text-to-picker' | 'accept-color'

export function hexColorInputBlurAction(input: {
  readonly draft: HexColorDraft
  readonly pickerDraft: HexColor
}): HexColorBlurAction {
  return input.draft.parsed == null
    ? 'revert-text-to-picker'
    : 'accept-color'
}

export function hexColorInputApplyBlur(input: {
  readonly draft: HexColorDraft
  readonly pickerDraft: HexColor
}): HexColor | null {
  const action = hexColorInputBlurAction(input)
  if (action === 'revert-text-to-picker') {
    input.draft.updateText(input.pickerDraft.hexString)
    return null
  }
  const color = input.draft.parsed!
  input.draft.rebase(color)
  return color
}

/**
 * Swift L125-130：Esc 的四个动作，顺序固定。
 *
 * ① `pickerDraft = draft.committed` —— 先回滚取色器草稿
 * ② `draft.cancel()` —— 文本回到基线
 * ③ `onPreview(draft.committed)` —— **必须**通知宿主回到基线色
 * ④ `textIsFocused = false` —— 最后才失焦（否则失焦回调又会跑一遍收尾）
 */
export const HEX_COLOR_ESCAPE_STEP_ORDER: readonly string[] = [
  'reset-picker-draft',
  'cancel-text-draft',
  'preview-committed',
  'blur-field',
]

/**
 * Swift L150-158：外部值变化时要不要 rebase。
 *
 * `!interactionIsActive || newValue != pickerDraft` 才 rebase。
 *
 * 直觉上「正在交互就别动」是错的：撤销/别的控件改色时必须覆盖当前草稿，
 * 否则失焦会把旧颜色又写回去、盖掉那次修改。所以只有「自己刚 preview 出去
 * 的那个值」才跳过。
 */
export function hexColorInputShouldRebase(input: {
  readonly interactionIsActive: boolean
  readonly newValueEqualsPickerDraft: boolean
}): boolean {
  if (!input.interactionIsActive) return true
  return !input.newValueEqualsPickerDraft
}

/** Swift L159-166：取色器开 → begin；关 → rebase 到 pickerDraft 再 end。 */
export type HexColorPickerToggleAction = 'begin-interaction' | 'rebase-and-end'

export function hexColorPickerToggleAction(input: {
  readonly isPresented: boolean
}): HexColorPickerToggleAction {
  return input.isPresented ? 'begin-interaction' : 'rebase-and-end'
}

/**
 * Swift L172-175：打开取色器前把 `pickerDraft` 同步成「当前能解析的颜色」。
 *
 * 用 `draft.parsed ?? draft.committed`：用户可能正在输入一个还没打完的
 * 十六进制串，此时取色器应该显示上一个有效颜色而不是空白。
 */
export function hexColorPickerInitialDraft(draft: HexColorDraft): HexColor {
  return draft.parsed ?? draft.committed
}

/**
 * Swift L214-224：交互的 begin / end 都是**幂等**的。
 *
 * 拖色块、打字、开关取色器三条路都会调 `beginColorInteraction`，
 * 不加 `guard !interactionIsActive` 会让宿主收到一串 `true`。
 */
export type HexColorInteractionStep = 'begin' | 'noop-begin' | 'end' | 'noop-end'

export function hexColorInteractionStep(input: {
  readonly action: 'begin' | 'end'
  readonly interactionIsActive: boolean
}): HexColorInteractionStep {
  if (input.action === 'begin') {
    return input.interactionIsActive ? 'noop-begin' : 'begin'
  }
  return input.interactionIsActive ? 'end' : 'noop-end'
}

/**
 * Swift L207-212：取色器预览。
 *
 * 与文本输入不同，取色器给的永远是合法色，所以这条路径**直接**写文本、
 * 开交互、预览 —— 不需要解析校验。
 */
export function hexColorInputPickerPreview(input: {
  readonly draft: HexColorDraft
  readonly color: HexColor
}): { readonly beginsInteraction: boolean; readonly text: string } {
  input.draft.updateText(input.color.hexString)
  return { beginsInteraction: true, text: input.draft.text }
}

/**
 * Swift L260-280：事务化包装的提交条件。
 *
 * 三条同时成立才提交：借出过交互 id、那个 id 仍是当前的、命令作用域也还是
 * 自己的。第二条防「别的控件接管了交互」，第三条防「作用域被切换了」。
 */
export function hexColorTransactionalCommitAllowed(input: {
  readonly ownedInteractionID: string | null
  readonly currentInteractionID: string | null
  readonly ownedScope: string
  readonly currentScope: string | null
}): boolean {
  if (input.ownedInteractionID == null) return false
  if (input.currentInteractionID !== input.ownedInteractionID) return false
  return input.currentScope === input.ownedScope
}

/** Swift L260-268：`presentsPalette` 为真时用 `onAppear` / `onDisappear` 包交互。 */
export function hexColorUsesPaletteLifecycle(presentsPalette: boolean): boolean {
  return presentsPalette
}
