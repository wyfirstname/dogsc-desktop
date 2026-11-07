/**
 * Swift source: Sources/DogSCApp/EditorWindowChromeInteraction.swift（91 行）@ 567fd6e
 *
 * L7-38 → 空白 chrome 的点击语义（接受首点、双击走系统偏好、单击拖动窗口）
 * L40-52 → EditorWindowTitlebarDoubleClickAction.perform
 * L54-90 → EditorTitlebarDoubleClickPreference.current（新版字符串 + 旧版布尔）
 *
 * 原注释：在编辑器自定义的全高工具栏里恢复原生标题栏行为。控件仍叠在这层之上
 * 并有自己的命中区，只有**其余空白 chrome** 会落到这一层。
 *
 * Windows 侧：`NSWindow.performDrag` / `performZoom` / `performMiniaturize` 分别对应
 * 主进程的 `-webkit-app-region: drag`、最大化切换与最小化；偏好读取换成
 * 「读取应用自己的设置项」，回退语义保持一致。
 */

export type TitlebarDoubleClickAction = 'zoom' | 'minimize' | 'none'

/** 新系统存的字符串 → 动作。判定前先 trim + 小写（Swift L66-68）。 */
export const TITLEBAR_DOUBLE_CLICK_TOKENS: Readonly<Record<string, TitlebarDoubleClickAction>> = {
  minimize: 'minimize',
  miniaturize: 'minimize',
  none: 'none',
  'do nothing': 'none',
  donothing: 'none',
  maximize: 'zoom',
  zoom: 'zoom',
  fill: 'zoom',
}

/**
 * 双击标题栏空白处的动作（Swift L63-90）。
 *
 * 三级回退，顺序不能换：
 * 1. 新版 `AppleActionOnDoubleClick` 字符串认得 → 用它；
 * 2. 认不得 → 旧版布尔 `AppleMiniaturizeOnDoubleClick` 存在则 true=minimize / false=zoom；
 * 3. 两者都没有 → AppKit 的长期默认是 **zoom**（不是 none）。
 */
export function titlebarDoubleClickAction(input: {
  readonly actionString?: string | null
  readonly miniaturizeOnDoubleClick?: boolean | null
}): TitlebarDoubleClickAction {
  const raw = input.actionString?.trim().toLowerCase()
  if (raw) {
    const mapped = TITLEBAR_DOUBLE_CLICK_TOKENS[raw]
    if (mapped) return mapped
  }
  if (input.miniaturizeOnDoubleClick !== null && input.miniaturizeOnDoubleClick !== undefined) {
    return input.miniaturizeOnDoubleClick ? 'minimize' : 'zoom'
  }
  return 'zoom'
}

/** 单击语义：单击数 ≥2 才算双击，其余一律拖动窗口（Swift L24-36）。 */
export type ChromeClickKind = 'doubleClick' | 'drag'

export function chromeClickKind(clickCount: number): ChromeClickKind {
  return clickCount === 2 ? 'doubleClick' : 'drag'
}

/**
 * 命中层的两个布尔（Swift L20-22）。
 * `acceptsFirstResponder = false`：这一层永不抢键盘焦点；
 * `acceptsFirstMouse = true`：窗口未激活时的第一下点击也照常生效。
 */
export const EDITOR_CHROME_ACCEPTS_FIRST_RESPONDER = false
export const EDITOR_CHROME_ACCEPTS_FIRST_MOUSE = true

/** 双击动作 → 要调用的窗口操作名（`none` 什么都不做）。 */
export function titlebarDoubleClickEffect(action: TitlebarDoubleClickAction): 'zoom' | 'minimize' | null {
  return action === 'none' ? null : action
}
