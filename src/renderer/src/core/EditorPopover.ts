/**
 * 编辑器弹出菜单 —— Swift EditorPopover.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorPopover.swift（89 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - editorPopoverKeyboardEntry：只在 Return / ↓ 的 down 阶段、且无修饰键   L30-44
 *   - editorPopover：面板底色用编辑器自己的面板色                              L14-28
 *   - 焦点入口：1×1 透明视图抢焦点，内容本身不是控件                          L46-75
 *   - NSEvent.targetsPresentedContent：事件窗口 ≠ 响应者所在窗口              L77-89
 *
 * 原注释：**空格键仍然是工作区的走带键** —— 只有聚焦的菜单触发器处理 Return/↓，
 * 不新增任何窗口级快捷键。焦点入口用 1×1 透明可聚焦视图而不是让内容变成控件，
 * 因为嵌套输入框必须保留自己的响应者。
 */

/** 弹出层键盘入口处理的按键。 */
export const POPOVER_ENTRY_KEYS = ['return', 'downArrow'] as const

export interface PopoverKeyPress {
  readonly key: string
  readonly modifiers: readonly ('meta' | 'control' | 'alt' | 'shift' | 'command')[]
}

/**
 * Swift L35-42：只有「启用 + 无任何修饰键 + 是 Return/↓ 的按下」才算入口。
 *
 * 任一修饰键存在就 `.ignored` —— 否则 ⌘↓（跳到末尾）会被菜单吃掉。
 * 注意空格不在此列：空格必须留给走带。
 */
export function popoverKeyboardEntryHandles(
  press: PopoverKeyPress,
  isEnabled: boolean
): boolean {
  if (!isEnabled) return false
  const blocked = press.modifiers.some(
    (modifier) => modifier === 'command' || modifier === 'control' || modifier === 'alt' || modifier === 'shift'
  )
  if (blocked) return false
  return (POPOVER_ENTRY_KEYS as readonly string[]).includes(press.key)
}

/** 空白键必须继续冒泡给工作区走带。 */
export const POPOVER_PASSES_SPACEBAR_TO_WORKSPACE = true

/** 焦点入口视图尺寸（1×1 透明，仅用来接收焦点）。 */
export const POPOVER_ENTRY_VIEW_SIZE = 1

/** Escape 关闭弹出层。 */
export const POPOVER_EXIT_KEY = 'escape'

/**
 * Swift `targetsPresentedContent`：AppKit 可能把弹出层的按键投递到它的**宿主窗口**，
 * 而第一响应者属于被呈现的窗口。工作区的事件监视器遇到这种情况必须让路，
 * 否则用户在菜单里按空格会同时触发播放。
 */
export function eventTargetsPresentedContent(input: {
  readonly hasEventWindow: boolean
  readonly hasResponderView: boolean
  readonly responderHasWindow: boolean
  readonly responderWindowIsEventWindow: boolean
}): boolean {
  if (!input.hasEventWindow) return false
  if (!input.hasResponderView) return false
  if (!input.responderHasWindow) return false
  return !input.responderWindowIsEventWindow
}
