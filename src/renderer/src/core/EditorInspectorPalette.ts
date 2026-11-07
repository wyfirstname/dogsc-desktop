/**
 * 编辑器控制台配色 —— 每个任务一个颜色身份，检查器与画布/时间线共用。
 *
 * Swift source: Sources/DogSCApp/EditorInspectorPalette.swift（149 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorConsolePalette                        L10-28  → EditorConsolePalette
 *   - paletteRGB(_:)                                    L30-37  → paletteRGB / rgbHex
 *   - enum EditorConsole                                L39-127
 *   - scrollSpace                                       L40     → EDITOR_CONSOLE_SCROLL_SPACE
 *   - vivid(fill:lightStroke:ink:lightText:)            L42-58  → vividPalette
 *   - frame / opening / … / audio（六个页签）            L67-72  → Track.primary
 *   - enum Track（五条效果轨色）                         L76-97  → EDITOR_CONSOLE_TRACKS / TRACK_HUES
 *   - waveformInk                                       L100-103 → EDITOR_CONSOLE_WAVEFORM_INK
 *   - palette(for tab:)                                 L106-115 → consolePaletteForTab
 *   - palette(for selection:)                           L118-126 → consolePaletteForSelection
 *   - adaptiveWash(lightAlpha:darkAlpha:)               L129-136 → paletteAdaptiveWash
 *
 * 原注释（L4-9）：
 *   One colour identity per task. The same hue marks a task in the inspector
 *   (its selected key, bars, knob arcs) and the things that belong to it on
 *   the canvas and the timeline (selection outlines, handles, markers), so a
 *   selection is never just "the default black".
 *   Flat fills only: no gradients, glows or tinted backgrounds.
 *
 * 迁移说明：SwiftUI 的 `Color(nsColor:)` + `RecorderStyle.adaptive(light, dark)`
 * 在 Web 侧对应 CSS 变量。这里把每个角色同时给出 light 与 dark 两个字符串值，
 * 宿主按 `prefers-color-scheme` 选用 —— 而不是在运行时再算一遍。
 */

/** Swift L40。 */
export const EDITOR_CONSOLE_SCROLL_SPACE = 'inspector.scroll'

/** 一个「明暗自适应」的颜色：两个字符串都在构建期就定下来。 */
export interface AdaptiveColor {
  readonly light: string
  readonly dark: string
}

/**
 * Swift L10-28。
 * 六个角色依次为：实心填充 / 描边 / 填充上的前景 / 大面积淡色 / 淡色上的文字 /
 * 面板上的小字。
 */
export interface EditorConsolePalette {
  /** 实心填充，上面永远用 `ink`：选中缩略图、条。 */
  readonly fill: string
  /** 直接画在表面上的线、弧、轮廓。浅色下比 `fill` 更深以保持对比。 */
  readonly stroke: AdaptiveColor
  /** 画在 `fill` 上的前景：同色相的深色，比黑色在彩色上安静得多。 */
  readonly ink: string
  /** 大面积用的淡色洗（时间线片段）。 */
  readonly soft: AdaptiveColor
  /** 画在 `soft` 上的文字：浅色用深色、深色用本色。 */
  readonly softInk: AdaptiveColor
  /** 面板上的小字：浅色下要够 4.5:1，深色下用本色。 */
  readonly text: AdaptiveColor
}

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** Swift L30-37：`0xRRGGBB` → 0..1 三个通道。 */
export function paletteRGB(hex: number): Rgb {
  const value = hex >>> 0
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  }
}

/** 反向：给断言与 CSS 输出用。 */
export function rgbHex(rgb: Rgb): string {
  const channel = (v: number): string =>
    Math.round(Math.min(Math.max(v, 0), 1) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`
}

/** Swift L46：`blended(withFraction: 0.38, of: .white)`（线性按通道插值）。 */
export function blendTowardWhite(rgb: Rgb, fraction: number): Rgb {
  const f = Math.min(Math.max(fraction, 0), 1)
  return {
    r: rgb.r + (1 - rgb.r) * f,
    g: rgb.g + (1 - rgb.g) * f,
    b: rgb.b + (1 - rgb.b) * f,
  }
}

/** `withAlphaComponent(_:)` 的 CSS 形态。 */
export function rgbaString(rgb: Rgb, alpha: number): string {
  const a = Math.min(Math.max(alpha, 0), 1)
  const c = (v: number): number => Math.round(v * 255)
  return `rgba(${c(rgb.r)}, ${c(rgb.g)}, ${c(rgb.b)}, ${Number(a.toFixed(3))})`
}

/** Swift L44-45：深色下 `soft` 的洗更淡（0.20 而非 0.24）。 */
export const CONSOLE_SOFT_ALPHA = { light: 0.24, dark: 0.20 } as const

/** Swift L46 的混合比例。 */
export const CONSOLE_LIFTED_FILL_FRACTION = 0.38

/**
 * Swift L42-58。四条映射：
 *   stroke  = 浅色用 lightStroke、深色用本色
 *   soft    = 本色 0.24 / 0.20
 *   softInk = 浅色用 ink、深色用「本色 + 38% 白」
 *   text    = 浅色用 lightText、深色用本色
 */
export function vividPalette(input: {
  readonly fill: number
  readonly lightStroke: number
  readonly ink: number
  readonly lightText: number
}): EditorConsolePalette {
  const fillRgb = paletteRGB(input.fill)
  const lifted = blendTowardWhite(fillRgb, CONSOLE_LIFTED_FILL_FRACTION)
  const fillHex = rgbHex(fillRgb)
  return {
    fill: fillHex,
    stroke: { light: rgbHex(paletteRGB(input.lightStroke)), dark: fillHex },
    ink: rgbHex(paletteRGB(input.ink)),
    soft: {
      light: rgbaString(fillRgb, CONSOLE_SOFT_ALPHA.light),
      dark: rgbaString(fillRgb, CONSOLE_SOFT_ALPHA.dark),
    },
    softInk: { light: rgbHex(paletteRGB(input.ink)), dark: rgbHex(lifted) },
    text: { light: rgbHex(paletteRGB(input.lightText)), dark: fillHex },
  }
}

/**
 * Swift L78-86：主录屏轨 —— 石墨黑，不染色。
 *
 * 注释（L60-65）说明了配色角色：全编辑页与侧边栏统一石墨黑；只有时间线效果轨
 * 与「轨道显示」弹窗保持一轨一色（避开蓝紫）。
 */
export const EDITOR_CONSOLE_PRIMARY: EditorConsolePalette = {
  // 石墨黑主色；具体色值来自 EditorTheme.platinumAccent，在 EditorTheme.ts 里定义。
  fill: 'var(--editor-platinum-accent)',
  stroke: { light: 'var(--editor-platinum-accent)', dark: 'var(--editor-platinum-accent)' },
  ink: 'var(--editor-on-accent)',
  soft: {
    light: 'var(--editor-selection-wash)',
    dark: 'var(--editor-selection-wash)',
  },
  softInk: {
    light: 'var(--editor-primary-text)',
    dark: 'var(--editor-primary-text)',
  },
  text: {
    light: 'var(--editor-primary-text)',
    dark: 'var(--editor-primary-text)',
  },
}

/** Swift L88-96 的原始 hex 表（顺序即声明顺序）。 */
export const EDITOR_CONSOLE_TRACK_HEX = {
  zoom: { fill: 0xb5e655, lightStroke: 0x5a9e1c, ink: 0x223400, lightText: 0x2f5a05 },
  screenMotion: { fill: 0xf7c548, lightStroke: 0xb98200, ink: 0x3a2800, lightText: 0x6e4e00 },
  cameraMotion: { fill: 0xff8a5c, lightStroke: 0xdd5420, ink: 0x3d1200, lightText: 0x86300c },
  overlay: { fill: 0x45cbb8, lightStroke: 0x0f8c7a, ink: 0x00352d, lightText: 0x0a5e52 },
  cameraSync: { fill: 0xf27e9f, lightStroke: 0xd03b67, ink: 0x4a0a22, lightText: 0x9e2449 },
} as const

/**
 * Swift L74-75：五条效果轨的色相（绿 80°、琥珀 45°、珊瑚 18°、青绿 172°、玫红 340°），
 * 亮度相近、避开蓝紫，主录屏轨保持黑。
 */
export const EDITOR_CONSOLE_TRACK_HUES = {
  zoom: 80,
  screenMotion: 45,
  cameraMotion: 18,
  overlay: 172,
  cameraSync: 340,
} as const

export type EditorConsoleTrackID = keyof typeof EDITOR_CONSOLE_TRACK_HEX

/** 五条染色轨（主录屏轨不在其中，它不参与 vivid 计算）。 */
export const EDITOR_CONSOLE_TRACKS: Readonly<Record<EditorConsoleTrackID, EditorConsolePalette>> = {
  zoom: vividPalette(EDITOR_CONSOLE_TRACK_HEX.zoom),
  screenMotion: vividPalette(EDITOR_CONSOLE_TRACK_HEX.screenMotion),
  cameraMotion: vividPalette(EDITOR_CONSOLE_TRACK_HEX.cameraMotion),
  overlay: vividPalette(EDITOR_CONSOLE_TRACK_HEX.overlay),
  cameraSync: vividPalette(EDITOR_CONSOLE_TRACK_HEX.cameraSync),
}

/** Swift L100-103：主片段波形用中性石墨灰，大面积内容不染色。 */
export const EDITOR_CONSOLE_WAVEFORM_INK = {
  lightAlpha: 0.34,
  darkAlpha: 0.4,
} as const

/** 检查器页签（Swift `InspectorTab`）。 */
export type InspectorTab = 'frame' | 'opening' | 'zoom' | 'cursor' | 'camera' | 'audio'

export const INSPECTOR_TABS_ORDER: readonly InspectorTab[] = [
  'frame',
  'opening',
  'zoom',
  'cursor',
  'camera',
  'audio',
]

/**
 * Swift L67-72 + L106-115：**六个页签全部是石墨黑**。
 * 这是 UX-184 第六轮的决定（L62-63），不是漏配 —— 页签级用色已经取消。
 */
export function consolePaletteForTab(_tab: InspectorTab): EditorConsolePalette {
  return EDITOR_CONSOLE_PRIMARY
}

/** 我们这边 `EditorSelection` 联合类型出现的 kinds。 */
export type ConsoleSelectionKind =
  | 'canvas'
  | 'primarySegment'
  | 'screenMotion'
  | 'screenMotionTrack'
  | 'cameraMotion'
  | 'zoom'
  | 'zoomTrack'
  | 'mosaic'
  | 'sticker'

/**
 * Swift L118-126：被选中对象的身份色 = 它所在轨道的颜色。
 *
 * Swift 的 `case .canvas, .screen, .primarySegment, .crop, .cursor, .audio` 里
 * 有四个只存在于 SwiftUI 侧的选择态（screen / crop / cursor / audio），
 * 它们同样落到主轨黑；这里只列我们联合类型里真有的 kind。
 */
export function consolePaletteForSelection(
  selection: ConsoleSelectionKind | null
): EditorConsolePalette {
  if (selection === null) return EDITOR_CONSOLE_PRIMARY
  switch (selection) {
    case 'zoom':
    case 'zoomTrack':
      return EDITOR_CONSOLE_TRACKS.zoom
    case 'screenMotion':
    case 'screenMotionTrack':
      return EDITOR_CONSOLE_TRACKS.screenMotion
    case 'cameraMotion':
      return EDITOR_CONSOLE_TRACKS.cameraMotion
    case 'mosaic':
    case 'sticker':
      return EDITOR_CONSOLE_TRACKS.overlay
    case 'canvas':
    case 'primarySegment':
      return EDITOR_CONSOLE_PRIMARY
  }
}

/**
 * Swift L129-136：`adaptiveWash(lightAlpha:darkAlpha:)` ——
 * 同一个本色、两个不透明度，分别给浅色与深色。
 */
export function paletteAdaptiveWash(
  palette: EditorConsolePalette,
  lightAlpha: number,
  darkAlpha: number
): AdaptiveColor {
  const base = paletteRGB(parseHexOrFallback(palette.fill))
  return {
    light: rgbaString(base, lightAlpha),
    dark: rgbaString(base, darkAlpha),
  }
}

/** `fill` 可能是 CSS 变量引用；非 hex 时退回主轨石墨黑（0.12 白）。 */
function parseHexOrFallback(value: string): number {
  const match = /^#([0-9a-fA-F]{6})$/.exec(value)
  if (match === null) return 0x1f1f1f
  return Number.parseInt(match[1], 16)
}
