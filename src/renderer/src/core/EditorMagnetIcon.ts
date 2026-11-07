/**
 * 吸附图标 —— Swift EditorMagnetIcon.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorMagnetIcon.swift（13 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - AppLineIcon(kind: .magnet, size: min(w, h) * 1.15)  L7-9
 *   - frame(width:height:)                                L9
 *   - accessibilityHidden(true)                           L11
 *
 * 迁移说明：Swift 用 GeometryReader 把「18pt 线性图标」按代理尺寸放大 15% 再塞回
 * 原框架；React 侧只需算出同一个数值。原注释说明它「以前是更重的实心形状」，
 * 现在与其它编辑器图标共用 AppLineIcon 的 18pt 线网格 —— 因此倍数 1.15 不是随手取的，
 * 是让线性笔画在视觉上补齐实心时期的分量。
 */

/** AppLineIcon 的基准绘制网格。 */
export const EDITOR_ICON_LINE_GRID = 18

/** 图标相对可用区域的放大倍数（线性笔画比实心形状显轻，需要补 15%）。 */
export const EDITOR_MAGNET_ICON_SCALE = 1.15

/** Swift `min(proxy.size.width, proxy.size.height) * 1.15`。 */
export function editorMagnetIconGlyphSize(width: number, height: number): number {
  return Math.min(width, height) * EDITOR_MAGNET_ICON_SCALE
}

export interface EditorMagnetIconLayout {
  /** 外层框架（= 代理尺寸，图标不撑破父视图）。 */
  readonly frameWidth: number
  readonly frameHeight: number
  /** 实际绘制尺寸（基准网格 × 1.15 的等效值）。 */
  readonly glyphSize: number
}

/** Swift body 的完整几何结果。 */
export function editorMagnetIconLayout(width: number, height: number): EditorMagnetIconLayout {
  return {
    frameWidth: width,
    frameHeight: height,
    glyphSize: editorMagnetIconGlyphSize(width, height),
  }
}

/** 纯装饰图标，必须从无障碍树里摘掉（否则 VoiceOver 会念出无意义的「图像」）。 */
export const EDITOR_MAGNET_ICON_ACCESSIBILITY_HIDDEN = true

/** 对应 `AppLineIcon.Kind.magnet`。 */
export const EDITOR_MAGNET_ICON_KIND = 'magnet' as const
