/**
 * 本地绝对路径 → file:// URL（组件共享版）。
 * 与 CanvasPreview 内联实现等价；抽出以复用。
 */
export function toFileUrl(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `file://${encodeURI(withSlash)}`
}
