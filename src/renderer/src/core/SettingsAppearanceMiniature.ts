/**
 * 外观偏好缩略图 —— Swift SettingsAppearanceMiniature.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/SettingsAppearanceMiniature.swift（35 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - ZStack：深/浅缩略图 + 「跟随系统」再叠一张深色并右半遮罩  L8-14
 *   - clipShape(RoundedRectangle(6)) / 0.5pt 黑边 / 阴影        L15-17
 *   - 侧栏 30 宽、padding 7、圆点 5、条 7 高                     L22-27
 *   - 内容区三条 5 高胶囊、行距 5、右侧 padding 8                 L28-32
 *
 * 原注释：这是**按几何画出来的小界面**，不是截图也不是运行时预览 —— 所以它跟主题
 * 同步变化而无需等窗口渲染。React 侧照同一套数字画 DOM 即可。
 */

/** 缩略图视觉常量。 */
export const MINIATURE_CORNER_RADIUS = 6
export const MINIATURE_BORDER = { white: 0, opacity: 0.1, lineWidth: 0.5 } as const
export const MINIATURE_SHADOW = { white: 0, opacity: 0.07, radius: 4, offsetY: 2 } as const

/** 侧栏 / 内容区的内部几何。 */
export const MINIATURE_GEOMETRY = {
  rowSpacing: 8,
  sidebarWidth: 30,
  sidebarPadding: 7,
  sidebarSpacing: 6,
  sidebarDotSize: 5,
  sidebarBarHeight: 7,
  contentSpacing: 5,
  contentBarHeight: 5,
  contentRowCount: 3,
  contentTrailingPadding: 8,
} as const

/** 深色/浅色两套灰阶（白度值，0 = 黑，1 = 白）。 */
export const MINIATURE_PALETTE = {
  sidebarDark: 0.15,
  sidebarLight: 0.94,
  barDark: 0.23,
  barLight: 0.92,
  canvasDark: 0.1,
  canvasLight: 1,
  glyphOpacity: 0.3,
} as const

export type MiniaturePreference = 'system' | 'light' | 'dark'

export interface MiniatureLayer {
  /** 该层画深色版还是浅色版。 */
  readonly dark: boolean
  /** 右半遮罩宽度占比；0 表示整层可见。 */
  readonly trailingMaskFraction: number
}

/**
 * Swift L9-13 的 ZStack 叠放顺序：
 * - light / dark：只有一层；
 * - system：底层浅色 + 顶层深色（右半遮罩），于是左浅右深 —— 「跟随系统」在缩略图里
 *   同时展示两种结果，而不是二选一。
 */
export function miniatureLayers(preference: MiniaturePreference): readonly MiniatureLayer[] {
  if (preference === 'system') {
    return [
      { dark: false, trailingMaskFraction: 0 },
      { dark: true, trailingMaskFraction: 0.5 },
    ]
  }
  return [{ dark: preference === 'dark', trailingMaskFraction: 0 }]
}

/** 内容区胶囊的可见条数（`ForEach(0..<3)`）。 */
export function miniatureContentRowCount(): number {
  return MINIATURE_GEOMETRY.contentRowCount
}
