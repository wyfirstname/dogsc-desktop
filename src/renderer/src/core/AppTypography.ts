/**
 * 应用字体 —— Swift AppTypography.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/AppTypography.swift（64 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - 三个字重文件注册（55-Regular / 65-Medium / 75-SemiBold）  L9-20
 *   - font(size:weight:design:)：等宽一律用系统字体            L22-33
 *   - 字重 → 字面映射                                          L26-31
 *   - regularTextWidth（未注册时退回系统字体量宽）              L35-41
 *   - Font.appUI(size:weight:design:)                          L45-47
 *   - Font.appUI(_ style:weight:)：语义字号表                   L49-63
 *
 * 原注释：捆绑的字体**只注册一次、只对本进程生效**；资源缺失就退回系统字面。
 * 时间线时码保持系统等宽 —— 这条保证「写进成片的文字」永远不会被替换字体影响。
 *
 * 迁移说明：Electron 的字体注册走 `@font-face` + `document.fonts.check`，语义相同：
 * 注册失败（文件缺失）就用系统栈。这里搬的是**字面命名规则与字重映射**——
 * 用错字面会让「中黑」变成「常规」，整屏字重集体偏细。
 */

/** 字体家族名（注册后的 PostScript 家族）。 */
export const APP_TYPOGRAPHY_FAMILY = 'AlibabaPuHuiTi_3'

/** 随包分发的三个字重文件（文件名 → 字面后缀）。 */
export const APP_TYPOGRAPHY_FONT_FILES = [
  { file: 'AlibabaPuHuiTi-3-55-Regular.otf', face: '55_Regular' },
  { file: 'AlibabaPuHuiTi-3-65-Medium.otf', face: '65_Medium' },
  { file: 'AlibabaPuHuiTi-3-75-SemiBold.otf', face: '75_SemiBold' },
] as const

/** 资源子目录（`Bundle.main.resourceURL/Fonts`）。 */
export const APP_TYPOGRAPHY_RESOURCE_DIRECTORY = 'Fonts'

export type AppFontWeight =
  | 'ultraLight'
  | 'thin'
  | 'light'
  | 'regular'
  | 'medium'
  | 'semibold'
  | 'bold'
  | 'heavy'
  | 'black'

/**
 * Swift L27-31：**四个重字重全部落到 75_SemiBold**（随包只有三个文件）；
 * medium 用 65；其余（含 light/thin）一律 55_Regular。
 * 因此界面上「加粗」与「特粗」看起来一样 —— 这是上游的取舍，照搬。
 */
export function appTypographyFace(weight: AppFontWeight): string {
  switch (weight) {
    case 'semibold':
    case 'bold':
    case 'heavy':
    case 'black':
      return '75_SemiBold'
    case 'medium':
      return '65_Medium'
    default:
      return '55_Regular'
  }
}

/** 语义字号表（Swift L51-61）。未列出的样式按 body 处理（13）。 */
export const APP_TEXT_STYLE_SIZE: Readonly<Record<string, number>> = {
  largeTitle: 26,
  title: 22,
  title2: 18,
  title3: 16,
  headline: 13,
  body: 13,
  subheadline: 12,
  callout: 12,
  footnote: 11,
  caption: 11,
  caption2: 10,
}

export function appTextStyleSize(style: string): number {
  return APP_TEXT_STYLE_SIZE[style] ?? 13
}

export interface AppUIFont {
  /** 实际使用的字体栈；`custom` 为 true 时首项是随包字体。 */
  readonly family: string
  readonly size: number
  readonly weight: AppFontWeight
  readonly custom: boolean
}

/**
 * Swift L22-33：`design == .monospaced` 或字体未注册 → 系统字体；
 * 否则 `AlibabaPuHuiTi_3_<face>` 固定字号。
 */
export function appUIFont(
  size: number,
  weight: AppFontWeight = 'regular',
  design: 'default' | 'serif' | 'rounded' | 'monospaced' = 'default',
  registered = true
): AppUIFont {
  if (design === 'monospaced' || !registered) {
    return { family: 'system-ui', size, weight, custom: false }
  }
  return { family: `${APP_TYPOGRAPHY_FAMILY}_${appTypographyFace(weight)}`, size, weight, custom: true }
}

/** Swift L62：`.headline` 默认 semibold，其余默认 regular。 */
export function appTextStyleFont(
  style: string,
  weight: AppFontWeight | null = null,
  design: 'default' | 'serif' | 'rounded' | 'monospaced' = 'default',
  registered = true
): AppUIFont {
  const resolved = weight ?? (style === 'headline' ? 'semibold' : 'regular')
  return appUIFont(appTextStyleSize(style), resolved, design, registered)
}

/** Swift L35-41：量宽永远用 **55_Regular**（与正文一致），未注册时退回系统字体。 */
export function appRegularTextFontFamily(registered = true): string {
  return registered ? `${APP_TYPOGRAPHY_FAMILY}_55_Regular` : 'system-ui'
}

/** 时码专用字体栈：永远系统等宽，不受随包字体影响。 */
export const APP_TIMECODE_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Consolas, monospace'
