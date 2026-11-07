/**
 * 编辑器设计令牌 —— Soft Silver / Graphite 双主题的色板、字号、留白、
 * 圆角、高度与弹簧参数。
 *
 * Swift source: Sources/DogSCApp/EditorDesignTokens.swift（359 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - enum EditorTheme                                          L6-204
 *     · backgroundDeep / panelSurface / sleepingMonitor           L10-21
 *     · panelRaised / cardElevated / cardTop / cardBottom         L22-40
 *     · chromeBar / stage / cardGradient                          L41-54
 *     · stageLight / stageVignette / accentGlow                   L55-68
 *     · platinumAccentDeep / platinumGradient / timelineClip*     L69-84
 *     · timelineZoomSurface / Accent / Ink                        L85-90
 *     · recorderSurface / mediaAccent / platinumAccent            L91-97
 *     · platinumMuted / onAccent / controlWell                    L98-110
 *     · amberAccent / success / recording                         L111-114
 *     · selectionTint / railSelectionWash / selectionWash         L116-125
 *     · hairline / controlBorder / groupSurface / cardFill        L126-131
 *     · popoverSelectionSurface / popoverSecondaryText            L132-138
 *     · topHighlight / sliderRail / sliderInk / sliderThumb       L139-154
 *     · islandOutline / contactShadow / softShadow / ambientShadow L155-173
 *     · primaryText / secondaryText / tertiaryText                L175-189
 *     · chrome(_:) / adaptive(light:dark:)                        L193-203
 *   - enum EditorStateWash                                      L210-214
 *   - enum EditorTypography                                     L218-227
 *   - enum EditorInterfaceSpacing                               L229-236
 *   - enum EditorInterfaceRadius                                L240-248
 *   - enum EditorInterfaceHeight                                L250-254
 *   - enum SpringMotion                                         L258-302
 *   - struct EditorRaisedThumb                                  L309-334
 *   - struct EditorFadingHairline                                L337-358
 *
 * 原注释（L7-9）：
 *   The media remains colour-accurate while workspace chrome follows the
 *   selected Aqua appearance. Dynamic NSColor providers also update panels
 *   already on screen when the user changes appearance in Settings.
 *
 * 原注释（L31-32）：
 *   Islands are lit from above: a touch brighter at the top edge and a
 *   touch deeper toward the workspace, so a flat slab reads as material.
 *
 * 原注释（L41-42）：
 *   Docked chrome (title bar, track header column) sits a half step below
 *   the panels it frames.
 *
 * 原注释（L206-208）：
 *   A close type scale keeps a tool dense without giving every label the
 *   weight of a heading. PuHui remains the single interface font family.
 *
 * 原注释（L216-217）：
 *   Editor text uses five sizes: 10 micro (badges, axes), 11 caption,
 *   12 label, 13 body, and headings from 14 up. Values use monospaced digits.
 *
 * 原注释（L238-239）：
 *   Radii describe nesting roles rather than individual screens. Small
 *   controls sit inside groups; only detached workspace surfaces carry the
 *   largest curve.
 *
 * 迁移说明：`NSColor(name: nil) { appearance in ... }` 这类动态颜色在
 * 浏览器里没有对应机制，改成显式的「浅色 / 深色」二元组 + `scheme` 参数。
 * 迁移时保留三件事不变：
 *   1) 每个令牌的浅/深两套 RGBA 原值（含 alpha，不预先乘算）；
 *   2) `chrome(opacity)` 这个唯一允许在运行期传入 alpha 的入口；
 *   3) 弹簧与缓动的 response / dampingFraction / duration 数值。
 */

// ---------------------------------------------------------------- 颜色模型

/** 一个 sRGB 颜色，分量 0..1，alpha 不做预乘。 */
export interface RecorderRGBA {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/** Swift L10-17：`NSColor(calibratedRed:green:blue:alpha:)` 的等价构造。 */
export function tokenRGBA(r: number, g: number, b: number, a = 1): RecorderRGBA {
  return { r, g, b, a }
}

/** Swift L18-21 等处大量使用的 `NSColor(calibratedWhite:alpha:)`。 */
export function tokenGray(white: number, a = 1): RecorderRGBA {
  return { r: white, g: white, b: white, a }
}

/** Swift L62、L163 等处的 `NSColor.black.withAlphaComponent(_:)`。 */
export function tokenBlack(a: number): RecorderRGBA {
  return { r: 0, g: 0, b: 0, a }
}

/** Swift L63、L167 等处的 `NSColor.white` / `.white.withAlphaComponent(_:)`。 */
export function tokenWhite(a = 1): RecorderRGBA {
  return { r: 1, g: 1, b: 1, a }
}

/**
 * Swift L197-203：`adaptive(light:dark:)`。
 *
 * 原实现靠 `appearance.bestMatch(from: [.darkAqua, .aqua])` 选一套；
 * 这里把「外观」抽成一个字符串，只留 `dark` 一种判定。
 */
export type EditorColorScheme = 'light' | 'dark'

export interface AdaptiveColor {
  readonly light: RecorderRGBA
  readonly dark: RecorderRGBA
}

/** Swift L197-203：构造一对动态颜色。 */
export function adaptiveColor(light: RecorderRGBA, dark: RecorderRGBA): AdaptiveColor {
  return { light, dark }
}

/** Swift L197-203：按当前外观解析出实际颜色。 */
export function resolveAdaptive(color: AdaptiveColor, scheme: EditorColorScheme): RecorderRGBA {
  return scheme === 'dark' ? color.dark : color.light
}

/**
 * 叠一层 alpha（对应 SwiftUI 的 `.opacity(_:)`）。
 *
 * 注意这里是**相乘**而不是覆盖：`chrome(0.06)` 是在已经带 alpha 的
 * 基础色上再乘 0.06，所以 `tokenWhite(1)` 乘 0.06 得到 0.06 的透明白。
 */
export function colorWithOpacity(color: RecorderRGBA, opacity: number): RecorderRGBA {
  return { r: color.r, g: color.g, b: color.b, a: color.a * opacity }
}

/** 输出成 CSS 可用的 `rgba(r, g, b, a)` 字符串（分量四舍五入到 0..255）。 */
export function colorToCSS(color: RecorderRGBA): string {
  const c = (v: number): number => Math.round(Math.min(Math.max(v, 0), 1) * 255)
  const alpha = Math.round(Math.min(Math.max(color.a, 0), 1) * 1000) / 1000
  return `rgba(${c(color.r)}, ${c(color.g)}, ${c(color.b)}, ${alpha})`
}

// ---------------------------------------------------------------- EditorTheme

/**
 * Swift L10-21：工作区的三层背景。
 *
 * `backgroundDeep` 是最远的底色，`panelSurface` 是面板，`sleepingMonitor`
 * 是画布外面那一圈「睡着的显示器」。
 */
export const EDITOR_BACKGROUND_DEEP = adaptiveColor(
  tokenRGBA(0.925, 0.929, 0.937),
  tokenRGBA(0.028, 0.029, 0.033)
)
export const EDITOR_PANEL_SURFACE = adaptiveColor(
  tokenRGBA(0.992, 0.992, 0.996),
  tokenRGBA(0.063, 0.065, 0.072)
)
export const EDITOR_SLEEPING_MONITOR = adaptiveColor(tokenGray(0.79), tokenGray(0.24))

/** Swift L22-25：抬起来一档的面板。 */
export const EDITOR_PANEL_RAISED = adaptiveColor(
  tokenRGBA(0.955, 0.957, 0.963),
  tokenRGBA(0.098, 0.1, 0.11)
)

/**
 * Swift L26-30：岛屿（island）—— 所有浮动工具面共用录制器的底色。
 */
export const EDITOR_CARD_ELEVATED = adaptiveColor(
  tokenRGBA(0.992, 0.992, 0.996),
  tokenRGBA(0.063, 0.065, 0.072)
)

/**
 * Swift L33-40：`cardTop` / `cardBottom`。
 *
 * 注意这两项在原文件里**完全等于** `cardElevated` —— 上缘提亮与下缘加深
 * 是靠 `topHighlight` + 阴影做的，而不是靠渐变两端。照抄这个「相等」，
 * 因为一旦真的给两端不同值，`cardGradient` 的行为会与原版不一致。
 */
export const EDITOR_CARD_TOP = adaptiveColor(
  tokenRGBA(0.992, 0.992, 0.996),
  tokenRGBA(0.063, 0.065, 0.072)
)
export const EDITOR_CARD_BOTTOM = adaptiveColor(
  tokenRGBA(0.992, 0.992, 0.996),
  tokenRGBA(0.063, 0.065, 0.072)
)

/** Swift L43-46：停靠的 chrome（标题栏、轨道表头列）。 */
export const EDITOR_CHROME_BAR = adaptiveColor(
  tokenRGBA(0.992, 0.992, 0.996),
  tokenRGBA(0.063, 0.065, 0.072)
)

/** Swift L48-51：画布站立的舞台。 */
export const EDITOR_STAGE = adaptiveColor(
  tokenRGBA(0.925, 0.929, 0.937),
  tokenRGBA(0.028, 0.029, 0.033)
)

/** Swift L52-54：卡片竖直渐变（上 `cardTop`、下 `cardBottom`）。 */
export interface LinearGradientSpec {
  readonly from: AdaptiveColor
  readonly to: AdaptiveColor
  readonly startPoint: 'top' | 'leading'
  readonly endPoint: 'bottom' | 'trailing'
}

export const EDITOR_CARD_GRADIENT: LinearGradientSpec = {
  from: EDITOR_CARD_TOP,
  to: EDITOR_CARD_BOTTOM,
  startPoint: 'top',
  endPoint: 'bottom',
}

/**
 * Swift L55-63：舞台上的两团光。
 *
 * `stageLight` 浅色是 0.72 的白，深色是偏蓝的 0.075 —— 同一个「光池」
 * 在深色下必须靠颜色（0.55/0.58/0.68）而不是亮度来成立。
 */
export const EDITOR_STAGE_LIGHT = adaptiveColor(
  tokenGray(1.0, 0.72),
  tokenRGBA(0.55, 0.58, 0.68, 0.075)
)
export const EDITOR_STAGE_VIGNETTE = adaptiveColor(
  tokenRGBA(0.1, 0.12, 0.18, 0.06),
  tokenBlack(0.42)
)

/** Swift L64-68：当前选择的柔和光晕。 */
export const EDITOR_ACCENT_GLOW = adaptiveColor(
  tokenRGBA(0.1, 0.12, 0.18, 0.22),
  tokenGray(1.0, 0.16)
)

/** Swift L70-73：实心铂金填充的深端。 */
export const EDITOR_PLATINUM_ACCENT_DEEP = adaptiveColor(tokenGray(0.12), tokenGray(0.97))

/** Swift L94-97：实心铂金填充的浅端（公开令牌）。 */
export const EDITOR_PLATINUM_ACCENT = adaptiveColor(tokenGray(0.12), tokenGray(0.97))

/** Swift L74-76：铂金渐变，从 `platinumAccent` 到 `platinumAccentDeep`。 */
export const EDITOR_PLATINUM_GRADIENT: LinearGradientSpec = {
  from: EDITOR_PLATINUM_ACCENT,
  to: EDITOR_PLATINUM_ACCENT_DEEP,
  startPoint: 'top',
  endPoint: 'bottom',
}

/** Swift L77-84：时间线片段的上下两档灰。 */
export const EDITOR_TIMELINE_CLIP_TOP = adaptiveColor(tokenGray(0.88), tokenGray(0.22))
export const EDITOR_TIMELINE_CLIP_BOTTOM = adaptiveColor(tokenGray(0.83), tokenGray(0.17))

/**
 * Swift L85-90：变焦轨用「运镜」任务色。
 *
 * 这三项在 Swift 里直接引用 `EditorConsole.Track.zoom` 的 soft / stroke /
 * softInk。TS 侧没有那个枚举，所以只保留**引用关系**（同一组值），
 * 值本身来自运镜轨定义：soft 是浅洗色，stroke 是环与把手，softInk 是文字。
 */
export const EDITOR_TIMELINE_ZOOM_SURFACE = adaptiveColor(
  tokenRGBA(0.1, 0.12, 0.18, 0.06),
  tokenRGBA(1, 1, 1, 0.09)
)
export const EDITOR_TIMELINE_ZOOM_ACCENT = adaptiveColor(
  tokenRGBA(0.1, 0.12, 0.18, 0.24),
  tokenRGBA(1, 1, 1, 0.34)
)
export const EDITOR_TIMELINE_ZOOM_INK = adaptiveColor(tokenGray(0.4), tokenGray(0.72))

/** Swift L91：录制器面 = 面板面。 */
export const EDITOR_RECORDER_SURFACE = EDITOR_PANEL_SURFACE

/** Swift L92：媒体用的暖白。 */
export const EDITOR_MEDIA_ACCENT = tokenRGBA(0.949, 0.941, 0.918)

/** Swift L98-101：铂金的次级文字色。 */
export const EDITOR_PLATINUM_MUTED = adaptiveColor(tokenGray(0.4), tokenGray(0.56))

/**
 * Swift L102-106：与实心强调填充配对的前景色。
 *
 * 浅色主题的实心填充是近黑（白字），深色主题是近白（黑字）——
 * 这个令牌是唯一被允许「跟随填充反转」的。
 */
export const EDITOR_ON_ACCENT = adaptiveColor(tokenGray(1.0), tokenGray(0.08))

/** Swift L107-110：控件井（凹槽）底色。 */
export const EDITOR_CONTROL_WELL = adaptiveColor(tokenBlack(0.05), tokenWhite(0.06))

/** Swift L111：琥珀强调。 */
export const EDITOR_AMBER_ACCENT = tokenRGBA(0.95, 0.68, 0.28)

/** Swift L112-113：与酸橙家族对齐的植物绿。 */
export const EDITOR_SUCCESS = tokenRGBA(0.52, 0.82, 0.26)

/** Swift L114：录制红。 */
export const EDITOR_RECORDING = tokenRGBA(1.0, 0.27, 0.23)

/** Swift L116：选择色就是铂金强调。 */
export const EDITOR_SELECTION_TINT = EDITOR_PLATINUM_ACCENT

/**
 * Swift L117-125：两处 14% 的中性抬升。
 *
 * 注给阅读者：浅色下是**黑** 0.075，深色下是**白** 0.14 —— 两者不是
 * 同一个透明度，别把 0.14 当成「统一值」来改。
 */
export const EDITOR_RAIL_SELECTION_WASH = adaptiveColor(tokenBlack(0.075), tokenWhite(0.14))
export const EDITOR_SELECTION_WASH = adaptiveColor(tokenBlack(0.075), tokenWhite(0.14))

/**
 * Swift L193-195：`chrome(_ opacity:)`。
 *
 * 浅色下是黑、深色下是白，然后整体乘透明度。这是整套令牌里唯一的
 * 函数式令牌；`hairline` / `controlBorder` / `groupSurface` / `cardFill`
 * / `sliderRail` 全部由它派生。
 */
export function editorChrome(opacity = 1): AdaptiveColor {
  return adaptiveColor(tokenBlack(opacity), tokenWhite(opacity))
}

/** Swift L126：发丝线（6%）。 */
export const EDITOR_HAIRLINE = editorChrome(0.06)
/** Swift L127：控件描边（8.5%）。 */
export const EDITOR_CONTROL_BORDER = editorChrome(0.085)
/** Swift L128：分组底（3.5%）。 */
export const EDITOR_GROUP_SURFACE = editorChrome(0.035)

/** Swift L129-131：岛屿内分组内容唯一的填充（4.5%，无描边）。 */
export const EDITOR_CARD_FILL = editorChrome(0.045)

/**
 * Swift L132-134：原生 popover 自带更亮的底，选择色相对它再乘 0.6。
 */
export const EDITOR_POPOVER_SELECTION_SURFACE: AdaptiveColor = {
  light: colorWithOpacity(EDITOR_SELECTION_WASH.light, 0.6),
  dark: colorWithOpacity(EDITOR_SELECTION_WASH.dark, 0.6),
}

/** Swift L135-138：popover 里的次级文字，必须完整可读。 */
export const EDITOR_POPOVER_SECONDARY_TEXT = adaptiveColor(tokenGray(0.32), tokenGray(0.86))

/** Swift L139-143：岛屿的机加工上缘（浅色全白，深色 17%）。 */
export const EDITOR_TOP_HIGHLIGHT = adaptiveColor(tokenWhite(1.0), tokenWhite(0.17))

/** Swift L144-154：滑块三件套。 */
export const EDITOR_SLIDER_RAIL = editorChrome(0.075)
export const EDITOR_SLIDER_INK = adaptiveColor(tokenGray(0.12), tokenGray(0.92))
export const EDITOR_SLIDER_THUMB = adaptiveColor(tokenWhite(), tokenGray(0.97))

/** Swift L155-159：每个岛屿外缘那道轮廓发丝线。 */
export const EDITOR_ISLAND_OUTLINE = adaptiveColor(
  tokenRGBA(0.1, 0.12, 0.18, 0.075),
  tokenWhite(0.07)
)

/** Swift L160-164：岛屿与工作区接触处的紧阴影（压在柔阴影下面）。 */
export const EDITOR_CONTACT_SHADOW = adaptiveColor(tokenRGBA(0.1, 0.12, 0.18, 0.06), tokenBlack(0.5))

/** Swift L165-168：柔阴影。 */
export const EDITOR_SOFT_SHADOW = adaptiveColor(tokenRGBA(0.1, 0.12, 0.18, 0.11), tokenBlack(0.42))

/** Swift L169-173：浮动岛屿下方那圈很宽的淡衰减。 */
export const EDITOR_AMBIENT_SHADOW = adaptiveColor(tokenRGBA(0.1, 0.12, 0.18, 0.07), tokenBlack(0.3))

/**
 * Swift L175-189：三级文字。
 *
 * 注释（L175-176）明确：小号辅助文字**不许**用 opacity 降级 ——
 * 所以这三个令牌是独立取值的灰，而不是某个基色乘透明度。
 */
export const EDITOR_PRIMARY_TEXT = adaptiveColor(tokenGray(0.1), tokenGray(0.96))
export const EDITOR_SECONDARY_TEXT = adaptiveColor(tokenGray(0.36), tokenGray(0.66))
export const EDITOR_TERTIARY_TEXT = adaptiveColor(tokenGray(0.52), tokenGray(0.46))

/** Swift L6-204：把全部令牌收进一张表，便于主题切换时整表重算。 */
export const EDITOR_THEME_TOKENS = {
  backgroundDeep: EDITOR_BACKGROUND_DEEP,
  panelSurface: EDITOR_PANEL_SURFACE,
  sleepingMonitor: EDITOR_SLEEPING_MONITOR,
  panelRaised: EDITOR_PANEL_RAISED,
  cardElevated: EDITOR_CARD_ELEVATED,
  cardTop: EDITOR_CARD_TOP,
  cardBottom: EDITOR_CARD_BOTTOM,
  chromeBar: EDITOR_CHROME_BAR,
  stage: EDITOR_STAGE,
  stageLight: EDITOR_STAGE_LIGHT,
  stageVignette: EDITOR_STAGE_VIGNETTE,
  accentGlow: EDITOR_ACCENT_GLOW,
  platinumAccent: EDITOR_PLATINUM_ACCENT,
  platinumAccentDeep: EDITOR_PLATINUM_ACCENT_DEEP,
  platinumMuted: EDITOR_PLATINUM_MUTED,
  onAccent: EDITOR_ON_ACCENT,
  controlWell: EDITOR_CONTROL_WELL,
  railSelectionWash: EDITOR_RAIL_SELECTION_WASH,
  selectionWash: EDITOR_SELECTION_WASH,
  popoverSelectionSurface: EDITOR_POPOVER_SELECTION_SURFACE,
  popoverSecondaryText: EDITOR_POPOVER_SECONDARY_TEXT,
  topHighlight: EDITOR_TOP_HIGHLIGHT,
  sliderInk: EDITOR_SLIDER_INK,
  sliderThumb: EDITOR_SLIDER_THUMB,
  islandOutline: EDITOR_ISLAND_OUTLINE,
  contactShadow: EDITOR_CONTACT_SHADOW,
  softShadow: EDITOR_SOFT_SHADOW,
  ambientShadow: EDITOR_AMBIENT_SHADOW,
  primaryText: EDITOR_PRIMARY_TEXT,
  secondaryText: EDITOR_SECONDARY_TEXT,
  tertiaryText: EDITOR_TERTIARY_TEXT,
} as const

/** 令牌名。用于主题表遍历与断言。 */
export type EditorThemeTokenName = keyof typeof EDITOR_THEME_TOKENS

/** 按名字 + 外观取色；名字非法时返回 null（不抛异常，界面不该因令牌名拼错崩掉）。 */
export function editorThemeColor(name: string, scheme: EditorColorScheme): RecorderRGBA | null {
  const token = (EDITOR_THEME_TOKENS as Record<string, AdaptiveColor | undefined>)[name]
  if (!token) return null
  return resolveAdaptive(token, scheme)
}

// ---------------------------------------------------------------- 状态洗色

/**
 * Swift L210-214：所有扁平控件共用的一组状态洗色。
 *
 * 悬停抬同样的量，按下再多一点，菜单展开介于两者之间。
 * 数值是**透明度**，不是颜色 —— 颜色永远是 `chrome`。
 */
export const EDITOR_STATE_WASH_HOVER = 0.07
export const EDITOR_STATE_WASH_OPEN = 0.1
export const EDITOR_STATE_WASH_PRESSED = 0.12

/** Swift L210-214：控件的四种交互态。 */
export type EditorControlState = 'idle' | 'hover' | 'open' | 'pressed'

/**
 * Swift L210-214：状态 → 洗色透明度。
 *
 * `open`（菜单展开）夹在 hover 与 pressed 之间，因为「展开」既不是
 * 悬停也不是按下。`idle` 为 0。
 */
export function editorStateWashOpacity(state: EditorControlState): number {
  switch (state) {
    case 'hover':
      return EDITOR_STATE_WASH_HOVER
    case 'open':
      return EDITOR_STATE_WASH_OPEN
    case 'pressed':
      return EDITOR_STATE_WASH_PRESSED
    default:
      return 0
  }
}

// ---------------------------------------------------------------- 字号

/**
 * Swift L218-227：五档字号。
 *
 * 10 微（徽标、坐标轴）、11 说明、12 标签、13 正文、14 起是标题。
 * 数值型内容用等宽数字（`monospacedDigit`）。
 */
export interface EditorFontSpec {
  readonly size: number
  readonly weight: 400 | 500 | 600
  readonly monospacedDigit: boolean
}

export const EDITOR_FONT_PANEL_TITLE: EditorFontSpec = { size: 15, weight: 600, monospacedDigit: false }
export const EDITOR_FONT_SECTION_TITLE: EditorFontSpec = { size: 12, weight: 600, monospacedDigit: false }
export const EDITOR_FONT_CONTROL_LABEL: EditorFontSpec = { size: 12, weight: 400, monospacedDigit: false }
export const EDITOR_FONT_CONTROL_VALUE: EditorFontSpec = { size: 12, weight: 500, monospacedDigit: false }
export const EDITOR_FONT_HELPER: EditorFontSpec = { size: 12, weight: 400, monospacedDigit: false }
export const EDITOR_FONT_CAPTION: EditorFontSpec = { size: 11, weight: 500, monospacedDigit: false }
export const EDITOR_FONT_EYEBROW: EditorFontSpec = { size: 11, weight: 600, monospacedDigit: false }

/** Swift L218-227：全部字号档。 */
export const EDITOR_TYPOGRAPHY = {
  panelTitle: EDITOR_FONT_PANEL_TITLE,
  sectionTitle: EDITOR_FONT_SECTION_TITLE,
  controlLabel: EDITOR_FONT_CONTROL_LABEL,
  controlValue: EDITOR_FONT_CONTROL_VALUE,
  helper: EDITOR_FONT_HELPER,
  caption: EDITOR_FONT_CAPTION,
  eyebrow: EDITOR_FONT_EYEBROW,
} as const

/** 字号档名。 */
export type EditorFontRole = keyof typeof EDITOR_TYPOGRAPHY

/** 取一档字号，并可选地打开等宽数字（数值读数用）。 */
export function editorFont(role: EditorFontRole, monospacedDigit = false): EditorFontSpec {
  const base = EDITOR_TYPOGRAPHY[role]
  return monospacedDigit ? { ...base, monospacedDigit: true } : base
}

/** 生成 CSS font-family / font-size / font-weight 的最小描述（不拼整串 CSS）。 */
export function editorFontCSS(role: EditorFontRole, family = 'PuHui'): string {
  const font = EDITOR_TYPOGRAPHY[role]
  return `${font.weight} ${font.size}px ${family}`
}

// ---------------------------------------------------------------- 间距

/**
 * Swift L229-236：检查器的四档间距。
 *
 * `inspectorInset` 是面板内侧留白，`sectionGap` 是节与节之间，
 * `controlGap` 是控件之间，`headingGap` 是标题与内容之间，
 * `tileInset` 是设置式磁贴的内衬。
 */
export const EDITOR_SPACING_INSPECTOR_INSET = 14
export const EDITOR_SPACING_SECTION_GAP = 16
export const EDITOR_SPACING_CONTROL_GAP = 8
export const EDITOR_SPACING_HEADING_GAP = 6
export const EDITOR_SPACING_TILE_INSET = 14

/** Swift L229-236：全部间距。 */
export const EDITOR_INTERFACE_SPACING = {
  inspectorInset: EDITOR_SPACING_INSPECTOR_INSET,
  sectionGap: EDITOR_SPACING_SECTION_GAP,
  controlGap: EDITOR_SPACING_CONTROL_GAP,
  headingGap: EDITOR_SPACING_HEADING_GAP,
  tileInset: EDITOR_SPACING_TILE_INSET,
} as const

// ---------------------------------------------------------------- 圆角

/**
 * Swift L240-248：圆角按**嵌套层级**命名，不按具体界面。
 *
 * 小控件在分组里，只有脱离工作区的浮动面才用最大的那一档。
 */
export const EDITOR_RADIUS_COMPACT = 8
export const EDITOR_RADIUS_CONTROL = 10
export const EDITOR_RADIUS_GROUP = 12
export const EDITOR_RADIUS_CARD = 14
export const EDITOR_RADIUS_FLOATING = 20
export const EDITOR_RADIUS_TILE = 18

/** Swift L240-248：全部圆角。 */
export const EDITOR_INTERFACE_RADIUS = {
  compact: EDITOR_RADIUS_COMPACT,
  control: EDITOR_RADIUS_CONTROL,
  group: EDITOR_RADIUS_GROUP,
  card: EDITOR_RADIUS_CARD,
  floating: EDITOR_RADIUS_FLOATING,
  tile: EDITOR_RADIUS_TILE,
} as const

/**
 * 圆角层级从内到外必须单调不减。
 *
 * 加这条断言函数是因为「把 card 改成比 group 小」这种手滑不会报错，
 * 但会让多层嵌套看起来像错位。
 */
export function editorRadiusOrderIsValid(): boolean {
  const order = [
    EDITOR_RADIUS_COMPACT,
    EDITOR_RADIUS_CONTROL,
    EDITOR_RADIUS_GROUP,
    EDITOR_RADIUS_CARD,
    EDITOR_RADIUS_TILE,
    EDITOR_RADIUS_FLOATING,
  ]
  for (let i = 1; i < order.length; i += 1) {
    if (order[i] < order[i - 1]) return false
  }
  return true
}

// ---------------------------------------------------------------- 高度

/** Swift L250-254：三档控件高度。 */
export const EDITOR_HEIGHT_COMPACT = 30
export const EDITOR_HEIGHT_SELECTION = 32
export const EDITOR_HEIGHT_ACTION = 32

/** Swift L250-254：全部高度。 */
export const EDITOR_INTERFACE_HEIGHT = {
  compact: EDITOR_HEIGHT_COMPACT,
  selection: EDITOR_HEIGHT_SELECTION,
  action: EDITOR_HEIGHT_ACTION,
} as const

/** 高度档名。 */
export type EditorHeightRole = keyof typeof EDITOR_INTERFACE_HEIGHT

/**
 * 圆角不得超过高度的一半，否则圆角矩形会退化（半径被夹到半高）。
 *
 * 这里提前算出「有效半径」，让调用方拿到的一定是可绘制的值。
 */
export function editorClampedRadius(radius: number, height: number): number {
  const half = Math.max(height, 0) / 2
  return Math.min(Math.max(radius, 0), half)
}

// ---------------------------------------------------------------- 弹簧

/**
 * Swift L258-302：产品级动效。
 *
 * 共同前提（L263-265）：控件要「快速落定、几乎没有过冲」——
 * 每次悬停和按下都弹一下会像玩具。面板用更慢但完全落定的弹簧。
 * 「减弱动态效果」一律返回 null（SwiftUI 里 null 表示不加动画）。
 */
export interface SpringSpec {
  readonly response: number
  readonly dampingFraction: number
}

export const SPRING_INTERACTIVE: SpringSpec = { response: 0.3, dampingFraction: 1 }
export const SPRING_FLUID: SpringSpec = { response: 0.45, dampingFraction: 1 }
export const SPRING_SNAPPY: SpringSpec = { response: 0.24, dampingFraction: 1 }
export const SPRING_GENTLE: SpringSpec = { response: 0.55, dampingFraction: 1 }
export const SPRING_SETTLE: SpringSpec = { response: 0.38, dampingFraction: 1 }
export const SPRING_LIFT: SpringSpec = { response: 0.28, dampingFraction: 1 }

/** Swift L274-277：文字交叉淡入，不缩放字形、不动基线。 */
export const SPRING_CROSSFADE_DURATION = 0.16

/** Swift L293-296：悬停的默认淡出时长；减弱动态时退化成 0.01 线性。 */
export const SPRING_HOVER_DURATION = 0.15
export const SPRING_HOVER_REDUCED_DURATION = 0.01

/** 动画描述：要么是弹簧，要么是缓出，要么不加（null）。 */
export type EditorAnimation =
  | { readonly kind: 'spring'; readonly response: number; readonly dampingFraction: number }
  | { readonly kind: 'easeOut'; readonly duration: number }
  | { readonly kind: 'linear'; readonly duration: number }

/** 把 `SpringSpec` 包成 `EditorAnimation`。 */
export function springAnimation(spec: SpringSpec): EditorAnimation {
  return { kind: 'spring', response: spec.response, dampingFraction: spec.dampingFraction }
}

/**
 * Swift L266-301：`SpringMotion` 的六档 + 两个特例。
 *
 * `reducesMotion` 为真时，除 `hover` 外全部返回 null；
 * `hover` 不退化成 null，而是变成 0.01 秒线性 —— 悬停必须有反馈，
 * 只是不再有「过程」。
 */
export type SpringMotionRole =
  | 'interactive'
  | 'fluid'
  | 'crossfade'
  | 'snappy'
  | 'gentle'
  | 'settle'
  | 'lift'
  | 'hover'

export function springMotion(role: SpringMotionRole, reducesMotion: boolean): EditorAnimation | null {
  if (role === 'hover') {
    return reducesMotion
      ? { kind: 'linear', duration: SPRING_HOVER_REDUCED_DURATION }
      : { kind: 'easeOut', duration: SPRING_HOVER_DURATION }
  }
  if (reducesMotion) return null
  switch (role) {
    case 'interactive':
      return springAnimation(SPRING_INTERACTIVE)
    case 'fluid':
      return springAnimation(SPRING_FLUID)
    case 'crossfade':
      return { kind: 'easeOut', duration: SPRING_CROSSFADE_DURATION }
    case 'snappy':
      return springAnimation(SPRING_SNAPPY)
    case 'gentle':
      return springAnimation(SPRING_GENTLE)
    case 'settle':
      return springAnimation(SPRING_SETTLE)
    case 'lift':
    default:
      return springAnimation(SPRING_LIFT)
  }
}

// ---------------------------------------------------------------- 抬起的磁贴

/**
 * Swift L306-311：当前选择所有共用的一块「抬起的板」。
 *
 * 两个分支（L317-332）：
 *   - 在检查器里（有 `consolePalette`）且 `usesAccent`：**一个纯色填充，
 *     无描边、无光晕**，只有 2pt / y1 的阴影；
 *   - 其他：填充 + 0.5pt 的 5% 描边 + 同样的阴影。
 *
 * 关键差别是描边：检查器里的选择色本身就是任务色，再叠一圈描边会脏。
 */
export interface RaisedThumbStyle {
  readonly fill: 'palette' | 'color'
  readonly strokeWidth: number
  readonly shadowRadius: number
  readonly shadowY: number
  readonly elevated: boolean
}

export function editorRaisedThumbStyle(hasPalette: boolean, usesAccent: boolean, elevated: boolean): RaisedThumbStyle {
  const accentBranch = hasPalette && usesAccent
  return {
    fill: accentBranch ? 'palette' : 'color',
    strokeWidth: accentBranch ? 0 : 0.5,
    shadowRadius: 2,
    shadowY: 1,
    elevated,
  }
}

/** Swift L322、L330：阴影透明度 = 抬起 ? 1 : 0（不是「换一个更淡的阴影」）。 */
export function editorRaisedThumbShadowOpacity(elevated: boolean): number {
  return elevated ? 1 : 0
}

// ---------------------------------------------------------------- 渐隐细线

/**
 * Swift L336-340：一条中间实、两端消失的短线。
 *
 * 四个 stop（L342-351）：0 → 透明，0.18 → 目标透明度，0.82 → 目标，
 * 1 → 透明。所以真正「实」的区间只有中间 64%。
 */
export const EDITOR_FADING_HAIRLINE_STOPS = [
  { location: 0, opacity: 0 },
  { location: 0.18, opacity: 1 },
  { location: 0.82, opacity: 1 },
  { location: 1, opacity: 0 },
] as const

/** Swift L338：默认 8%。 */
export const EDITOR_FADING_HAIRLINE_OPACITY = 0.08

/** 轴线。水平线高 1px 铺满宽度，垂直线宽 1px 铺满高度。 */
export type EditorHairlineAxis = 'horizontal' | 'vertical'

/**
 * Swift L352-355：把「1px 厚」翻译成宽高。
 *
 * 水平线：`width = null`（撑满）、`height = 1`；
 * 垂直线：`width = 1`、`height = null`。
 */
export function editorHairlineSize(axis: EditorHairlineAxis): { width: number | null; height: number | null } {
  return axis === 'vertical' ? { width: 1, height: null } : { width: null, height: 1 }
}

/** Swift L342-351：按目标透明度展开成四个 stop 的实际 alpha。 */
export function editorFadingHairlineStops(opacity: number): { location: number; alpha: number }[] {
  return EDITOR_FADING_HAIRLINE_STOPS.map((stop) => ({
    location: stop.location,
    alpha: stop.opacity * opacity,
  }))
}
