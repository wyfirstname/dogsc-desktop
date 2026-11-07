/**
 * Swift source: Sources/DogSCApp/EscapeDismissibleWindow.swift（13 行）@ 567fd6e
 *
 * L5-12 → escapeDismissalAction
 *
 * 原注释：辅助窗口与关闭按钮共享同一个 delegate 与持久化路径；字段编辑器与
 * 附着的 sheet 在窗口响应者之前处理 Escape。
 *
 * Windows 侧：AppKit 的 `cancelOperation(_:)` 是窗口级 ESC 处理钩子，对应到
 * Electron 主进程的 `before-input-event` 加渲染层的 Escape 监听。这里只保留
 * 判定本身（有没有附着面板决定 ESC 的归属），UI 载体由 React 实现。
 */

export type EscapeDismissalAction = 'deferToSuper' | 'close'

/**
 * 有附着 sheet 时把 ESC 交还响应链（先关 sheet），否则关闭窗口。
 *
 * 顺序不可颠倒：先把 ESC 交给父类/上层，才能让「Esc 关 sheet」而不是
 * 「Esc 连窗口一起关」—— 后者会让用户丢掉 sheet 里的未保存输入。
 */
export function escapeDismissalAction(hasAttachedSheet: boolean): EscapeDismissalAction {
  return hasAttachedSheet ? 'deferToSuper' : 'close'
}
