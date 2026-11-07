/**
 * 赞赏支持面板 —— Swift AppSupportSheet.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/AppSupportSheet.swift（53 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - 资源定位 Support/AppreciationCode.jpg            L8-10
 *   - 标题 16 medium + 关闭按钮 28×28（xmark 12）        L15-23
 *   - 图片 400×400、圆角 8、0.75pt 发丝边框              L26-36
 *   - 缺失时同位占位文案                                L37-41
 *   - 页脚 12 号次要色 / 外层 padding 24、宽 448         L43-51
 *
 * 原注释：两个支持入口都**原样显示作者提供的图片**（不裁切、不改色）。
 * 迁移说明：RemoteImage/BundleImage 的读取由主进程完成，这里只搬「尺寸、圆角、
 * 缺失兜底文案」这些会被人一眼看出来的数字。
 */

/** 资源相对 `Resources/` 的路径。 */
export const SUPPORT_APPRECIATION_IMAGE_RESOURCE = {
  subdirectory: 'Support',
  name: 'AppreciationCode',
  extension: 'jpg',
} as const

export const SUPPORT_SHEET_TITLE = '请我喝杯咖啡'
export const SUPPORT_SHEET_FOOTER = '免费开源 · 自愿支持'
export const SUPPORT_SHEET_MISSING_IMAGE_TEXT = '赞赏码暂时无法显示'

export const SUPPORT_SHEET_METRICS = {
  width: 448,
  padding: 24,
  sectionSpacing: 16,
  titleSize: 16,
  footerSize: 12,
  closeButtonSize: 28,
  closeGlyphSize: 12,
  imageSize: 400,
  imageCornerRadius: 8,
  imageBorderWidth: 0.75,
} as const

export const SUPPORT_SHEET_ACCESSIBILITY = {
  closeLabel: '关闭赞赏码',
  imageLabel: '赞赏码',
  imageHint: '使用手机扫描图片中的赞赏码',
} as const

/** 图片按 `scaledToFit` 显示：等比缩放，**不裁切**（赞赏码被裁掉一角就扫不出来）。 */
export const SUPPORT_IMAGE_CONTENT_MODE = 'contain'

/**
 * 面板内容三态：有图 / 无图（同尺寸占位，避免弹窗高度跳动）/ 加载中。
 * Swift 用 `if let image` 直接分两支；多出的 loading 态是 Windows 侧异步读盘所需，
 * 但尺寸与兜底文案完全一致。
 */
export type SupportImageState =
  | { readonly kind: 'ready'; readonly source: string; readonly size: number }
  | { readonly kind: 'missing'; readonly text: string; readonly size: number }
  | { readonly kind: 'loading'; readonly size: number }

export function supportImageState(source: string | null): SupportImageState {
  const size = SUPPORT_SHEET_METRICS.imageSize
  if (source == null) {
    return { kind: 'missing', text: SUPPORT_SHEET_MISSING_IMAGE_TEXT, size }
  }
  return { kind: 'ready', source, size }
}
