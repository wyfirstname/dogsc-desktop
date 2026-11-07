/**
 * 运行时应用身份 —— Swift AppIdentity.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/AppIdentity.swift（15 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - Bundle.main CFBundleDisplayName 读取  L9-11
 *   - 去空白 + 空串归一 + "DogSC" 兜底      L12-13
 *
 * 原注释：本地开发与正式发布**故意**使用不同的显示名与 bundle id，因此所有用户可见的
 * 窗口标题必须读 bundle，而不是硬编码发布名。Windows 侧等价来源是
 * `app.getName()` / `package.json productName`，由主进程注入；本模块只负责
 * 「拿到什么就用什么，拿不到（或拿到空白）就退回 DogSC」这条判定。
 */

/** 兜底显示名。 */
export const APP_IDENTITY_FALLBACK_DISPLAY_NAME = 'DogSC'

/**
 * Swift `trimmingCharacters(in: .whitespacesAndNewlines)` 的等价实现。
 * JS 的 `String.prototype.trim` 覆盖的字符集是 `WhiteSpace` + `LineTerminator`，
 * 与 Foundation 那两个字符集在本项目的实际输入（ASCII 空白与换行）上一致。
 */
export function appDisplayName(configured: string | null | undefined): string {
  const trimmed = configured == null ? '' : configured.trim()
  return trimmed === '' ? APP_IDENTITY_FALLBACK_DISPLAY_NAME : trimmed
}
