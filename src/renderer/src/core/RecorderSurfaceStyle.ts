/**
 * 录制器与设置共用的不透明面层 —— 色板、动效、面形、按钮权重、
 * 取景框路径与按压反馈。
 *
 * Swift source: Sources/DogSCApp/RecorderSurfaceStyle.swift（336 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - enum RecorderStyle（22 个颜色令牌）                      L8-54
 *     · adaptive(_:_:) / chromeNSColor / inkNSColor            L9-15
 *     · baseNSColor / canvasNSColor                            L16-21
 *     · ink / chrome / muted / faint / mint                    L22-27
 *     · positiveInk / mintWash / silver / well                 L28-33
 *     · selection / line / lift / recording                    L34-38
 *     · destructiveInk / amberInk / base                       L39-45
 *     · mediaOverlay / mediaInk / primaryFill / onPrimary      L46-51
 *     · edgeTop / edgeBottom                                   L52-53
 *   - enum RecorderMotion                                      L58-71
 *   - struct RecorderSurface（ViewModifier）                    L74-81
 *   - struct RecorderSurfaceShape（圆角 + 上缘描边 + 阴影）      L83-97
 *   - extension View.recorderSurface                           L99-103
 *   - struct RecorderPillButtonStyle（record/primary/soft/quiet）L107-153
 *   - struct RecorderKeyHint                                   L156-163
 *   - struct CaptureViewfinder（四角取景框 Shape）               L167-194
 *   - struct RecorderRaisedSurface                             L198-207
 *   - struct RecorderButtonStyle                               L209-224
 *   - struct RecorderPlainPressButtonStyle                     L228-237
 *   - struct RecorderPressFeedback                             L241-255
 *   - struct RecorderNativeActionButton                        L259-287
 *   - struct RecorderSelectionEntrance                         L289-298
 *   - func animateRecorderOverlayIn                            L300-309
 *   - struct RecorderCirclePressStyle                          L311-335
 *
 * 原注释（L5-7）：
 *   Shared opaque surfaces for the recorder and settings. The same shapes and
 *   interactions use paper/graphite in Aqua and ink/silver in Dark Aqua.
 *   Native colours stay dynamic; layers resolve them in their view's appearance.
 *
 * 原注释（L26）：
 *   Live indicators retain green; text/icons use a darker green on paper.
 *
 * 原注释（L46-47）：
 *   Small controls sit over arbitrary camera/recording pixels. Their own
 *   contrasting backdrop adapts; the media itself is never recoloured.
 *
 * 原注释（L56-57）：
 *   Shared timing. Shapes travel on a soft spring; content follows a beat later
 *   so a surface never arrives empty.
 *
 * 原注释（L73）：
 *   The one surface: a solid shape with a machined top edge.
 *
 * 原注释（L76-77）：
 *   A surface inside a larger transparent window draws its own shadow.
 *
 * 原注释（L105-106）：
 *   The three weights of action on an island: the take itself, an ordinary
 *   confirmation, and everything quieter.
 *
 * 原注释（L165-166）：
 *   Four open corners of a camera viewfinder, inset from the edges of the
 *   thing being framed. The inset animates, so the frame can close in.
 *
 * 原注释（L196-197）：
 *   The few controls that keep a fill use one quiet tone, with no outline and
 *   no drop shadow.
 *
 * 原注释（L211-212）：
 *   The primary action starts a take: the one red button on the glass.
 *
 * 原注释（L226-227）：
 *   Keep compact configuration actions inside their existing hit bounds while
 *   sharing the toolbar's short pressed settle and reduced-motion behavior.
 *
 * 原注释（L239-240）：
 *   Artwork reacts inside its existing native hit target. The inset edge and
 *   shade remain visible when accessibility settings suppress physical motion.
 *
 * 原注释（L257-258）：
 *   Each action keeps its press state through updates to the recording bar.
 *   The original AppKit control still owns mouse-up actions and accessibility.
 *
 * 迁移说明：`Color` / `NSColor` 的动态外观 → 显式浅/深二元组，用
 * `scheme` 解析；`ButtonStyle` / `ViewModifier` → 纯函数，返回一组
 * 可套到 DOM 元素上的样式数值。保留四件容易改坏的东西：
 *   1) 药丸按钮三档填充的**具体 alpha**（静止/悬停/按下各不相同，
 *      且 `primary` 的静止是 0.96 而不是 1）；
 *   2) 取景框四角的 `addArc(tangent1End:tangent2End:radius:)` 语义；
 *   3) 按压反馈「缩放 0.92、透明度 0.62」这一对必须同时出现；
 *   4) 减弱动态时**保留**缩放抑制但保留透明度变化之外的其它一切。
 */

import { colorToCSS, colorWithOpacity, type RecorderRGBA } from './EditorDesignTokens'

/** 外观。与 `EditorDesignTokens` 的 `EditorColorScheme` 同构。 */
export type RecorderAppearance = 'light' | 'dark'

/**
 * Swift L9-13：`RecorderStyle.adaptive(_:_:)`。
 *
 * 注意判定方向：`appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua`
 * —— 在 Aqua（浅色）下取第一个参数，Dark Aqua 取第二个。
 */
export function recorderAdaptive(light: RecorderRGBA, dark: RecorderRGBA): (appearance: RecorderAppearance) => RecorderRGBA {
  return (appearance) => (appearance === 'dark' ? dark : light)
}

function rgba(r: number, g: number, b: number, a = 1): RecorderRGBA {
  return { r, g, b, a }
}

function gray(white: number, a = 1): RecorderRGBA {
  return { r: white, g: white, b: white, a }
}

function black(a: number): RecorderRGBA {
  return { r: 0, g: 0, b: 0, a }
}

function white(a = 1): RecorderRGBA {
  return { r: 1, g: 1, b: 1, a }
}

// ---------------------------------------------------------------- 颜色令牌

/** Swift L14：`chromeNSColor` —— 浅色黑、深色白。 */
export const RECORDER_CHROME = recorderAdaptive(black(1), white(1))

/** Swift L15：`inkNSColor` —— 浅色 10% 黑，深色 96% 白。 */
export const RECORDER_INK = recorderAdaptive(gray(0.1), white(0.96))

/** Swift L16-18：`baseNSColor` —— 面的底色。 */
export const RECORDER_BASE = recorderAdaptive(rgba(0.992, 0.992, 0.996), rgba(0.063, 0.065, 0.072))

/** Swift L19-21：`canvasNSColor` —— 画布底。 */
export const RECORDER_CANVAS = recorderAdaptive(rgba(0.925, 0.929, 0.937), rgba(0.028, 0.029, 0.033))

/**
 * Swift L24：`muted` —— 次级文字。
 *
 * 浅色 36% 灰、深色 56% 白。两者不是同一个「亮度」，是各自调的。
 */
export const RECORDER_MUTED = recorderAdaptive(gray(0.36), white(0.56))

/** Swift L25：`faint` —— 三级文字 / 图标。 */
export const RECORDER_FAINT = recorderAdaptive(gray(0.5), white(0.32))

/**
 * Swift L26-27：`mint` —— 活的指示器。
 *
 * 注释说得很清楚：只有「活的」指示器保留这个绿；文字与图标走
 * `positiveInk`（浅色下更深的绿，保证对比度）。
 */
export const RECORDER_MINT = rgba(0.3, 0.85, 0.55)

/** Swift L28-30：`positiveInk` —— 浅色深绿，深色回落到 mint。 */
export const RECORDER_POSITIVE_INK = recorderAdaptive(rgba(0.1, 0.46, 0.28), rgba(0.3, 0.85, 0.55))

/** Swift L31：`mintWash` = mint × 0.18。 */
export const RECORDER_MINT_WASH_ALPHA = 0.18

/** Swift L32：`silver` = chrome × 0.06。 */
export const RECORDER_SILVER_ALPHA = 0.06

/** Swift L33：`well` = chrome × 0.08。 */
export const RECORDER_WELL_ALPHA = 0.08

/** Swift L34：`selectionNSColor` —— 浅色黑 7.5%，深色白 14%。 */
export const RECORDER_SELECTION = recorderAdaptive(black(0.075), white(0.14))

/** Swift L36：`line` = chrome × 0.09。 */
export const RECORDER_LINE_ALPHA = 0.09

/** Swift L37：`lift` —— 阴影色。浅色黑 14%，深色黑 40%。 */
export const RECORDER_LIFT = recorderAdaptive(black(0.14), black(0.4))

/** Swift L38：`recording` —— 录制红。 */
export const RECORDER_RECORDING = rgba(1.0, 0.27, 0.23)

/** Swift L39-41：`destructiveInk` —— 危险动作的文字色。 */
export const RECORDER_DESTRUCTIVE_INK = recorderAdaptive(rgba(0.76, 0.16, 0.13), rgba(1.0, 0.27, 0.23))

/** Swift L42-44：`amberInk` —— 警告文字色。 */
export const RECORDER_AMBER_INK = recorderAdaptive(rgba(0.55, 0.34, 0.08), rgba(0.95, 0.68, 0.28))

/** Swift L48：`mediaOverlay` —— 压在任何画面上的小控件底。 */
export const RECORDER_MEDIA_OVERLAY = recorderAdaptive(gray(0.99, 0.94), black(0.55))

/** Swift L49：`mediaInk` —— 画面上的图标色。 */
export const RECORDER_MEDIA_INK = recorderAdaptive(gray(0.1), white(1))

/** Swift L50：`primaryFill` —— 主填充。 */
export const RECORDER_PRIMARY_FILL = recorderAdaptive(gray(0.12), white(1))

/** Swift L51：`onPrimary` —— 主填充上的前景。 */
export const RECORDER_ON_PRIMARY = recorderAdaptive(white(1), gray(0.08))

/** Swift L52：`edgeTop` —— 上缘高光。 */
export const RECORDER_EDGE_TOP = recorderAdaptive(white(1), white(0.17))

/** Swift L53：`edgeBottom` —— 下缘暗边。 */
export const RECORDER_EDGE_BOTTOM = recorderAdaptive(black(0.07), white(0.04))

/** Swift L31-33、L36-37、L48：这些「派生令牌」的 alpha 一览。 */
export const RECORDER_DERIVED_ALPHAS = {
  mintWash: RECORDER_MINT_WASH_ALPHA,
  silver: RECORDER_SILVER_ALPHA,
  well: RECORDER_WELL_ALPHA,
  line: RECORDER_LINE_ALPHA,
} as const

/**
 * Swift L22-53：全部令牌的查询表。
 *
 * 表里的每一项都是「外观 → 颜色」的函数，这样同一个令牌在切换主题时
 * 不需要重建任何图层。
 */
export const RECORDER_STYLE_TOKENS = {
  chrome: RECORDER_CHROME,
  ink: RECORDER_INK,
  base: RECORDER_BASE,
  canvas: RECORDER_CANVAS,
  muted: RECORDER_MUTED,
  faint: RECORDER_FAINT,
  positiveInk: RECORDER_POSITIVE_INK,
  selection: RECORDER_SELECTION,
  lift: RECORDER_LIFT,
  destructiveInk: RECORDER_DESTRUCTIVE_INK,
  amberInk: RECORDER_AMBER_INK,
  mediaOverlay: RECORDER_MEDIA_OVERLAY,
  mediaInk: RECORDER_MEDIA_INK,
  primaryFill: RECORDER_PRIMARY_FILL,
  onPrimary: RECORDER_ON_PRIMARY,
  edgeTop: RECORDER_EDGE_TOP,
  edgeBottom: RECORDER_EDGE_BOTTOM,
} as const

/** 令牌名。 */
export type RecorderStyleTokenName = keyof typeof RECORDER_STYLE_TOKENS

/** 取一个令牌的颜色。 */
export function recorderStyleColor(name: RecorderStyleTokenName, appearance: RecorderAppearance): RecorderRGBA {
  return RECORDER_STYLE_TOKENS[name](appearance)
}

/**
 * Swift L31-37：把「基色 × alpha」这类派生令牌解析成实际颜色。
 *
 * 单独抽成函数是因为 `chrome` 在浅色下是黑、深色下是白，
 * 乘 alpha 之后两者的观感完全相反 —— 不能只算一次就缓存。
 */
export function recorderDerived(
  base: 'chrome',
  alpha: number,
  appearance: RecorderAppearance
): RecorderRGBA {
  return colorWithOpacity(RECORDER_CHROME(appearance), alpha)
}

/** 直接给出 CSS 颜色串，省掉调用方每次自己拼。 */
export function recorderStyleCSS(name: RecorderStyleTokenName, appearance: RecorderAppearance): string {
  return colorToCSS(recorderStyleColor(name, appearance))
}

// ---------------------------------------------------------------- 动效

/**
 * Swift L58-71：`RecorderMotion`。
 *
 * `morphSpring` 是面形变化的弹簧（0.5 / 0.82），`settleSpring` 是内容
 * 落定的弹簧（0.36 / 0.84）。后者的 response 更短、阻尼更高 ——
 * 内容比外壳更快更稳。
 */
export const RECORDER_MORPH_SPRING = { response: 0.5, dampingFraction: 0.82 } as const
export const RECORDER_SETTLE_SPRING = { response: 0.36, dampingFraction: 0.84 } as const

/** Swift L69：`quick` —— 直接写死的 0.26 / 0.86，不复用上面两个。 */
export const RECORDER_QUICK_SPRING = { response: 0.26, dampingFraction: 0.86 } as const

/** Swift L70：`fade` —— 0.18 秒缓出，且**不**受减弱动态影响（返回值非可选）。 */
export const RECORDER_FADE_DURATION = 0.18

/** 动效种类。`fade` 是唯一在减弱动态下仍然存在的。 */
export type RecorderMotionKind = 'morph' | 'settle' | 'quick' | 'fade'

/** 动画描述。 */
export type RecorderAnimation =
  | { readonly kind: 'spring'; readonly response: number; readonly dampingFraction: number }
  | { readonly kind: 'easeOut'; readonly duration: number }

/**
 * Swift L63-70：按种类取动画。
 *
 * 减弱动态时前三种返回 null（SwiftUI 里 `Animation?` 为 nil = 不加动画），
 * `fade` 始终返回 0.18 秒缓出。
 */
export function recorderMotion(kind: RecorderMotionKind, reduces: boolean): RecorderAnimation | null {
  if (kind === 'fade') return { kind: 'easeOut', duration: RECORDER_FADE_DURATION }
  if (reduces) return null
  switch (kind) {
    case 'morph':
      return { kind: 'spring', ...RECORDER_MORPH_SPRING }
    case 'settle':
      return { kind: 'spring', ...RECORDER_SETTLE_SPRING }
    case 'quick':
    default:
      return { kind: 'spring', ...RECORDER_QUICK_SPRING }
  }
}

// ---------------------------------------------------------------- 面形

/**
 * Swift L83-97：`RecorderSurfaceShape`。
 *
 * 一个连续圆角矩形 + 一层竖直渐变描边（1pt，上 `edgeTop` 下 `edgeBottom`），
 * 外加一个「只有需要时才画」的阴影。
 */
export const RECORDER_SURFACE_EDGE_WIDTH = 1

/** Swift L89：阴影半径 22、y 偏移 10。 */
export const RECORDER_SURFACE_SHADOW_RADIUS = 22
export const RECORDER_SURFACE_SHADOW_Y = 10

/**
 * Swift L89：阴影透明度。
 *
 * 注意是 `castsShadow ? 0.85 : 0` —— 不投影时是**完全透明**，
 * 而不是「换一个更淡的阴影」。所以不需要投影的面不会有任何阴影开销。
 */
export const RECORDER_SURFACE_SHADOW_ALPHA = 0.85

/** Swift L78-80、L99-103：`recorderSurface(radius:castsShadow:)` 的参数。 */
export interface RecorderSurfaceSpec {
  readonly radius: number
  readonly castsShadow: boolean
}

/** Swift L100：默认 `castsShadow = false`。 */
export function recorderSurfaceSpec(radius: number, castsShadow = false): RecorderSurfaceSpec {
  return { radius, castsShadow }
}

/** Swift L87-95：解析出一层可绘制的面（填充 + 描边 + 阴影）。 */
export interface RecorderSurfaceStyleResult {
  readonly radius: number
  readonly fill: string
  readonly strokeWidth: number
  readonly strokeTop: string
  readonly strokeBottom: string
  readonly shadowRadius: number
  readonly shadowY: number
  readonly shadowAlpha: number
  readonly shadowColor: string
}

export function recorderSurfaceStyle(spec: RecorderSurfaceSpec, appearance: RecorderAppearance): RecorderSurfaceStyleResult {
  return {
    radius: spec.radius,
    fill: colorToCSS(RECORDER_BASE(appearance)),
    strokeWidth: RECORDER_SURFACE_EDGE_WIDTH,
    strokeTop: colorToCSS(RECORDER_EDGE_TOP(appearance)),
    strokeBottom: colorToCSS(RECORDER_EDGE_BOTTOM(appearance)),
    shadowRadius: RECORDER_SURFACE_SHADOW_RADIUS,
    shadowY: RECORDER_SURFACE_SHADOW_Y,
    shadowAlpha: spec.castsShadow ? RECORDER_SURFACE_SHADOW_ALPHA : 0,
    shadowColor: colorToCSS(RECORDER_LIFT(appearance)),
  }
}

// ---------------------------------------------------------------- 药丸按钮

/**
 * Swift L107-153：岛屿上的四档动作权重。
 *
 * `record` 是那一次「开拍」，`primary` 是普通确认，`soft` 是次级，
 * `quiet` 是最静的一档（无底，只有按下/悬停时才有色）。
 */
export type RecorderPillKind = 'record' | 'primary' | 'soft' | 'quiet'

/** Swift L108：四种。 */
export const RECORDER_PILL_KINDS: readonly RecorderPillKind[] = ['record', 'primary', 'soft', 'quiet'] as const

/** Swift L124：药丸高度恒为 44。 */
export const RECORDER_PILL_HEIGHT = 44

/** Swift L121：字号 13、半粗。 */
export const RECORDER_PILL_FONT_SIZE = 13
export const RECORDER_PILL_FONT_WEIGHT = 600

/**
 * Swift L123：左右内衬。
 *
 * `quiet` 是 14，其它三档是 18 —— 最静的那一档文字更靠边，
 * 因为它没有底色，靠留白界定自己的范围。
 */
export function recorderPillHorizontalPadding(kind: RecorderPillKind): number {
  return kind === 'quiet' ? 14 : 18
}

/**
 * Swift L128：按下缩放。
 *
 * 只有「按下且启用且未减弱动态」时才缩到 0.96。
 */
export const RECORDER_PILL_PRESS_SCALE = 0.96

/** Swift L129：禁用时整体 0.4 不透明。 */
export const RECORDER_PILL_DISABLED_OPACITY = 0.4

/**
 * Swift L135-142：前景色。
 *
 * `record` 永远是纯白（压在红上）；`primary` 用 `onPrimary`（随主题反转）；
 * `soft` 用 `ink`；`quiet` 的 ink 再乘 0.78。
 */
export function recorderPillForeground(kind: RecorderPillKind, appearance: RecorderAppearance): RecorderRGBA {
  switch (kind) {
    case 'record':
      return white(1)
    case 'primary':
      return RECORDER_ON_PRIMARY(appearance)
    case 'soft':
      return RECORDER_INK(appearance)
    case 'quiet':
    default:
      return colorWithOpacity(RECORDER_INK(appearance), 0.78)
  }
}

/**
 * Swift L144-151：填充色。
 *
 * 这一段的 alpha 是**逐档不同**的三元组，照抄：
 *   record  —— 0.78 / 0.9 / 1
 *   primary —— 0.78 / 0.9 / 0.96
 *   soft    —— 0.2 / 0.15 / 0.1
 *   quiet   —— 0.14 / 0.09 / 0
 *
 * `soft` 与 `quiet` 是「按下更深」，`record` 与 `primary` 是「按下更淡」——
 * 方向相反，因为浅底上的按压应该凹陷、深底上的按压应该被压暗。
 */
export function recorderPillFillAlpha(kind: RecorderPillKind, hovered: boolean, pressed: boolean): number {
  switch (kind) {
    case 'record':
      return pressed ? 0.78 : hovered ? 0.9 : 1
    case 'primary':
      return pressed ? 0.78 : hovered ? 0.9 : 0.96
    case 'soft':
      return pressed ? 0.2 : hovered ? 0.15 : 0.1
    case 'quiet':
    default:
      return pressed ? 0.14 : hovered ? 0.09 : 0
  }
}

/** Swift L144-151：填充基色。 */
export function recorderPillFillBase(kind: RecorderPillKind, appearance: RecorderAppearance): RecorderRGBA {
  switch (kind) {
    case 'record':
      return RECORDER_RECORDING
    case 'primary':
      return RECORDER_PRIMARY_FILL(appearance)
    case 'soft':
    case 'quiet':
    default:
      return RECORDER_CHROME(appearance)
  }
}

/** Swift L125：实际填充色 = 基色 × 三元组 alpha。 */
export function recorderPillFill(kind: RecorderPillKind, hovered: boolean, pressed: boolean, appearance: RecorderAppearance): RecorderRGBA {
  return colorWithOpacity(recorderPillFillBase(kind, appearance), recorderPillFillAlpha(kind, hovered, pressed))
}

/**
 * Swift L127：焦点环颜色。
 *
 * `primary` 用 `onPrimary`、其它用 `chrome`，两者都再乘 0.7。
 * 为什么 primary 要用 onPrimary：它的底接近实心强调色，
 * 如果用 chrome 描边，浅色主题下黑描黑几乎不可见。
 */
export function recorderPillFocusColor(kind: RecorderPillKind, appearance: RecorderAppearance): RecorderRGBA {
  const base = kind === 'primary' ? RECORDER_ON_PRIMARY(appearance) : RECORDER_CHROME(appearance)
  return colorWithOpacity(base, 0.7)
}

/** Swift L118-133：一次药丸渲染所需的全部量。 */
export interface RecorderPillRender {
  readonly height: number
  readonly horizontalPadding: number
  readonly fontSize: number
  readonly fontWeight: number
  readonly foreground: string
  readonly fill: string
  readonly focusColor: string
  readonly scale: number
  readonly opacity: number
  readonly animation: RecorderAnimation | null
}

export function recorderPillRender(
  kind: RecorderPillKind,
  state: { hovered: boolean; pressed: boolean; enabled: boolean; reduces: boolean },
  appearance: RecorderAppearance
): RecorderPillRender {
  const pressed = state.pressed && state.enabled
  return {
    height: RECORDER_PILL_HEIGHT,
    horizontalPadding: recorderPillHorizontalPadding(kind),
    fontSize: RECORDER_PILL_FONT_SIZE,
    fontWeight: RECORDER_PILL_FONT_WEIGHT,
    foreground: colorToCSS(recorderPillForeground(kind, appearance)),
    fill: colorToCSS(recorderPillFill(kind, state.hovered && state.enabled, pressed, appearance)),
    focusColor: colorToCSS(recorderPillFocusColor(kind, appearance)),
    scale: pressed && !state.reduces ? RECORDER_PILL_PRESS_SCALE : 1,
    opacity: state.enabled ? 1 : RECORDER_PILL_DISABLED_OPACITY,
    animation: pressed ? recorderMotion('quick', state.reduces) : recorderMotion('fade', state.reduces),
  }
}

// ---------------------------------------------------------------- 键位提示

/**
 * Swift L156-163：跟着动作走的小键位图例。
 *
 * 0.62 的不透明度是「能看见但不抢戏」的分寸；同时它对无障碍完全隐藏 ——
 * 键位信息在提示气泡（help）里已经有了，读屏重复念一遍是噪音。
 */
export const RECORDER_KEY_HINT_SIZE = 10.5
export const RECORDER_KEY_HINT_OPACITY = 0.62
export const RECORDER_KEY_HINT_HIDDEN_FROM_AX = true

// ---------------------------------------------------------------- 取景框

/**
 * Swift L167-194：相机取景框的四角。
 *
 * 每条边都是「从角上一点出发，沿圆角折过去，再画一段直线到臂末端」。
 * 四角的 `dx` / `dy` 符号决定了两条臂往哪个方向伸：
 *   左上 (1,1)、右上 (−1,1)、右下 (−1,−1)、左下 (1,−1)。
 */
export const CAPTURE_VIEWFINDER_CORNER_RADIUS = 16

/** 一个角的路径段：起点、圆角切点、终点。 */
export interface ViewfinderCorner {
  readonly index: number
  readonly start: readonly [number, number]
  readonly tangent: readonly [number, number]
  readonly end: readonly [number, number]
}

/**
 * Swift L180-185：四角的坐标表（相对于内缩后的矩形）。
 *
 * 顺序固定为 左上 → 右上 → 右下 → 左下，与 Swift 里的元组顺序一致。
 */
export function captureViewfinderCorners(inset: number, arm: number, bounds: { width: number; height: number }): ViewfinderCorner[] {
  const minX = inset
  const minY = inset
  const maxX = bounds.width - inset
  const maxY = bounds.height - inset
  const corners: [number, number, number, number][] = [
    [minX, minY, 1, 1],
    [maxX, minY, -1, 1],
    [maxX, maxY, -1, -1],
    [minX, maxY, 1, -1],
  ]
  return corners.map(([x, y, dx, dy], index) => ({
    index,
    start: [x, y + arm * dy] as const,
    tangent: [x, y] as const,
    end: [x + arm * dx, y] as const,
  }))
}

/** 取景框路径指令（`M` 移动到圆弧起点，`Q` 代替 `addArc`，`L` 到臂末端）。 */
export interface ViewfinderCommand {
  readonly op: 'M' | 'Q' | 'L'
  readonly points: readonly [number, number][]
}

/**
 * Swift L177-193：把四角展开成路径。
 *
 * `addArc(tangent1End:tangent2End:radius:)` 在 90° 折角上等价于一段
 * 二次贝塞尔，控制点就是那个折角顶点本身。所以这里用 `Q` 表达，
 * 但**必须**把半径夹到不超过臂长，否则圆弧会把整条臂吃掉。
 */
export function captureViewfinderCommands(
  inset: number,
  arm: number,
  bounds: { width: number; height: number },
  radius = CAPTURE_VIEWFINDER_CORNER_RADIUS
): ViewfinderCommand[] {
  const corners = captureViewfinderCorners(inset, arm, bounds)
  const r = Math.min(Math.max(radius, 0), Math.max(arm, 0))
  const out: ViewfinderCommand[] = []
  for (const corner of corners) {
    // 圆弧起点：从切点沿第一条臂往回退 r。
    const [sx, sy] = corner.start
    const [tx, ty] = corner.tangent
    const len = Math.hypot(sx - tx, sy - ty)
    const k = len === 0 ? 0 : r / len
    const arcStart: [number, number] = [sx + (tx - sx) * k, sy + (ty - sy) * k]
    out.push({ op: 'M', points: [arcStart] })
    // 拷贝成可变元组：`ViewfinderCommand.points` 用 `readonly [number, number][]`，
    // 但 Swift 侧的元组是可变的，这里显式重建一次，避免把只读引用混进去。
    out.push({ op: 'Q', points: [[corner.tangent[0], corner.tangent[1]], [corner.end[0], corner.end[1]]] })
  }
  return out
}

/**
 * 取景框臂长不得越过矩形中线。
 *
 * 两条相对的臂各占一半时正好交接；超过就会互相穿过，
 * 视觉上从「取景框」变成「叉」。
 */
export function captureViewfinderArmFits(arm: number, bounds: { width: number; height: number }, inset: number): boolean {
  const halfW = Math.max((bounds.width - inset * 2) / 2, 0)
  const halfH = Math.max((bounds.height - inset * 2) / 2, 0)
  return arm <= Math.min(halfW, halfH)
}

// ---------------------------------------------------------------- 抬起面 / 按钮

/**
 * Swift L198-207：只保留填充、没有描边也没有投影的「抬起面」。
 *
 * 只有少数控件用它（例如分段选择器的选中格）。默认圆角是
 * `EditorInterfaceRadius.group`（12），选中时用 `selection`，否则 `well`。
 */
export const RECORDER_RAISED_RADIUS = 12

/** Swift L204：选中 → `selection`，未选中 → `well`。 */
export function recorderRaisedFill(selected: boolean, appearance: RecorderAppearance): RecorderRGBA {
  return selected
    ? RECORDER_SELECTION(appearance)
    : colorWithOpacity(RECORDER_CHROME(appearance), RECORDER_WELL_ALPHA)
}

/**
 * Swift L209-224：`RecorderButtonStyle`。
 *
 * 与药丸不同，这里按下时固定乘 0.8（不是三元组）：
 *   records  → recording × (pressed ? 0.8 : 1)
 *   primary  → primaryFill × (pressed ? 0.8 : 0.95)
 *   其它     → well
 */
export const RECORDER_BUTTON_PRESS_ALPHA = 0.8
export const RECORDER_BUTTON_PRIMARY_ALPHA = 0.95

/** Swift L217：前景色。 */
export function recorderButtonForeground(primary: boolean, records: boolean, appearance: RecorderAppearance): RecorderRGBA {
  if (!primary) return RECORDER_INK(appearance)
  return records ? white(1) : RECORDER_ON_PRIMARY(appearance)
}

/** Swift L218-219：填充色。 */
export function recorderButtonFill(primary: boolean, records: boolean, pressed: boolean, appearance: RecorderAppearance): RecorderRGBA {
  if (!primary) return colorWithOpacity(RECORDER_CHROME(appearance), RECORDER_WELL_ALPHA)
  if (records) {
    return colorWithOpacity(RECORDER_RECORDING, pressed ? RECORDER_BUTTON_PRESS_ALPHA : 1)
  }
  return colorWithOpacity(RECORDER_PRIMARY_FILL(appearance), pressed ? RECORDER_BUTTON_PRESS_ALPHA : RECORDER_BUTTON_PRIMARY_ALPHA)
}

/** Swift L220-221：焦点环 = chrome × 0.65。 */
export const RECORDER_BUTTON_FOCUS_ALPHA = 0.65

/** Swift L228-237：`RecorderPlainPressButtonStyle` 的默认圆角。 */
export const RECORDER_PLAIN_PRESS_CORNER_RADIUS = 10

// ---------------------------------------------------------------- 按压反馈

/**
 * Swift L241-255：`RecorderPressFeedback`。
 *
 * 三条同时生效：
 *   - 缩放 0.92（减弱动态时不缩）；
 *   - 透明度 0.62（**减弱动态时仍然降**——它是明暗而不是位移）；
 *   - 弹簧 response 按下 0.14、松开 0.3，阻尼 0.7。
 *
 * 原注释（L239-240）解释了为什么透明度必须留着：减弱动态只抑制
 * **物理位移**，不抑制明暗反馈，否则用户按下去会完全没有回应。
 */
export const RECORDER_PRESS_SCALE = 0.92
export const RECORDER_PRESS_OPACITY = 0.62
export const RECORDER_PRESS_SPRING_DOWN = 0.14
export const RECORDER_PRESS_SPRING_UP = 0.3
export const RECORDER_PRESS_SPRING_DAMPING = 0.7

/** Swift L248-253：解析出缩放 / 透明度 / 动画。 */
export interface RecorderPressFeedback {
  readonly scale: number
  readonly opacity: number
  readonly animation: { response: number; dampingFraction: number } | null
}

export function recorderPressFeedback(pressed: boolean, enabled: boolean, reduces: boolean): RecorderPressFeedback {
  const active = pressed && enabled
  return {
    scale: active && !reduces ? RECORDER_PRESS_SCALE : 1,
    opacity: active ? RECORDER_PRESS_OPACITY : 1,
    animation: reduces
      ? null
      : {
          response: active ? RECORDER_PRESS_SPRING_DOWN : RECORDER_PRESS_SPRING_UP,
          dampingFraction: RECORDER_PRESS_SPRING_DAMPING,
        },
  }
}

/**
 * Swift L259-287：包一层原生动作触发器的按钮。
 *
 * 默认 `highlightOpacity = 0.04`（非常淡，几乎只有 4% 的一层）。
 */
export const RECORDER_NATIVE_ACTION_HIGHLIGHT_OPACITY = 0.04

/** Swift L284：禁用时 0.4 不透明。 */
export const RECORDER_NATIVE_ACTION_DISABLED_OPACITY = 0.4

/**
 * Swift L271-286：图层顺序与可见性。
 *
 * 标签层先画（`accessibilityHidden(true)`），动作触发器盖在上面。
 * 这样 AppKit 那层负责点击与无障碍，SwiftUI 只负责画面。
 */
export const RECORDER_NATIVE_ACTION_LAYER_ORDER = ['label', 'trigger'] as const

/** 标签层对无障碍隐藏 —— 因为它只是同一份文案的重复。 */
export const RECORDER_NATIVE_ACTION_LABEL_HIDDEN_FROM_AX = true

// ---------------------------------------------------------------- 入场 / 淡入

/**
 * Swift L289-298：选择项的入场。
 *
 * 从下方 7pt、0.985 缩放淡入，用 0.2 秒缓出（减弱动态时 0.1 秒且
 * 不做位移与缩放）。注意是 `easeOut` 不是弹簧 —— 入场是「出现」，
 * 不该有回弹。
 */
export const RECORDER_SELECTION_ENTRANCE_OFFSET = 7
export const RECORDER_SELECTION_ENTRANCE_SCALE = 0.985
export const RECORDER_SELECTION_ENTRANCE_DURATION = 0.2
export const RECORDER_SELECTION_ENTRANCE_REDUCED_DURATION = 0.1

/** Swift L293-296：解析出入场的三个量。 */
export function recorderSelectionEntrance(reduces: boolean): { offsetY: number; scale: number; duration: number } {
  return {
    offsetY: reduces ? 0 : RECORDER_SELECTION_ENTRANCE_OFFSET,
    scale: reduces ? 1 : RECORDER_SELECTION_ENTRANCE_SCALE,
    duration: reduces ? RECORDER_SELECTION_ENTRANCE_REDUCED_DURATION : RECORDER_SELECTION_ENTRANCE_DURATION,
  }
}

/**
 * Swift L300-309：悬浮窗整体淡入。
 *
 * 先把 `alphaValue` 置 0，再用 0.18 秒缓出推到 1。减弱动态时直接返回 ——
 * 窗口保持不透明，没有任何过渡。
 */
export const RECORDER_OVERLAY_FADE_IN_DURATION = 0.18

/** Swift L302：是否应当执行淡入。 */
export function recorderOverlayShouldAnimate(reduces: boolean): boolean {
  return !reduces
}

/**
 * Swift L311-335：圆形按压样式。
 *
 * 圆角固定 18；悬停时叠一层 chrome × 0.1，用 0.14 秒缓出。
 * 只有「启用 且 悬停 且 未按下」才出这层 —— 按下时已经有按压反馈，
 * 再叠悬停色会重。
 */
export const RECORDER_CIRCLE_PRESS_RADIUS = 18
export const RECORDER_CIRCLE_PRESS_HOVER_ALPHA = 0.1
export const RECORDER_CIRCLE_PRESS_HOVER_DURATION = 0.14

/** Swift L325：悬停层的透明度。 */
export function recorderCircleHoverAlpha(enabled: boolean, hovered: boolean, pressed: boolean): number {
  return enabled && hovered && !pressed ? RECORDER_CIRCLE_PRESS_HOVER_ALPHA : 0
}
