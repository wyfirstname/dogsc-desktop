/**
 * 调色面板 —— 一个弹窗里完成色相/饱和/亮度/十六进制四种输入。
 *
 * Swift source: Sources/DogSCApp/EditorColorPalette.swift（178 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorColorPalette                      L7-178
 *   - init（由 HexColor 反推 HSB）                    L18-28  → hsbFromRgb
 *   - 头部（标题 13 / 关闭按钮 24×24）                L32-42  → COLOR_PALETTE_HEADER
 *   - 十六进制行（色块 32、HEX 10、输入 32 高）        L47-70  → COLOR_PALETTE_HEX_ROW
 *   - 非法色值提示                                    L71-74  → colorPaletteHexIsValid
 *   - 面板宽度 272 / 内边距 16                         L76     → COLOR_PALETTE_WIDTH / …PADDING
 *   - 饱和亮度面（164 高、拇指 16、内缩 8）             L85-118 → colorPalettePlanePoint / …PlaneDragValue
 *   - 色相条（内缩 8、高 10、拇指 16、行高 20）         L120-150 → colorPaletteHueThumbOffset / …HueDragValue
 *   - publishColor / rebase / clamp                  L152-171 → colorPaletteRebase / hsbToRgb
 *
 * 原注释（L5-6）：
 *   A complete color editor in one popover. The owning input groups this session
 *   into one undo command, including both dragging and hex entry.
 *
 * 原注释（L162-163）：
 *   Black and gray have no meaningful hue. Retain the user's hue so
 *   increasing brightness/saturation does not unexpectedly jump to red.
 *
 * 迁移说明：`Color(hue:saturation:brightness:)` 与 `NSColor.hueComponent` 在 Web 侧
 * 对应自算的 HSV ⇄ RGB。这里保留三条纯逻辑：反推时的色相保留规则、两个拖拽面
 * 的像素↔取值映射、以及面板的全部设计常量。
 */

import { HexColor } from './HexColor'
import type { RgbComponents } from './HexColor'

/** Swift L76：面板固定宽度 272、内边距 16。 */
export const COLOR_PALETTE_WIDTH = 272
export const COLOR_PALETTE_PADDING = 16

/** Swift L31：区块间距 14。 */
export const COLOR_PALETTE_SECTION_SPACING = 14

/** Swift L32-42：标题字号 13 semibold；关闭按钮 24×24、字形 13、字号 10。 */
export const COLOR_PALETTE_HEADER = {
  titleSize: 13,
  titleWeight: 'semibold',
  closeButtonSize: 24,
  closeGlyphSize: 13,
  closeFontSize: 10,
} as const

/** Swift L47-70：十六进制行的度量。 */
export const COLOR_PALETTE_HEX_ROW = {
  spacing: 10,
  swatchSize: 32,
  labelSize: 10,
  fieldSize: 12,
  fieldHorizontalPadding: 10,
  fieldHeight: 32,
} as const

/** Swift L72：非法值提示的文案与字号。 */
export const COLOR_PALETTE_INVALID_HINT = '请输入六位色值，例如 #EDA647'
export const COLOR_PALETTE_HINT_SIZE = 10

/** Swift L108：饱和亮度面高 164。 */
export const COLOR_PALETTE_PLANE_HEIGHT = 164

/** Swift L94 / L130：两个面的拇指直径 16，因此半径 8。 */
export const COLOR_PALETTE_THUMB_SIZE = 16
export const COLOR_PALETTE_THUMB_RADIUS = COLOR_PALETTE_THUMB_SIZE / 2

/** Swift L122：色相条两端内缩 8，轨道高 10，整行高 20。 */
export const COLOR_PALETTE_HUE_STRIP_INSET = 8
export const COLOR_PALETTE_HUE_STRIP_TRACK_HEIGHT = 10
export const COLOR_PALETTE_HUE_STRIP_HEIGHT = 20

/** Swift L113 / L147：无障碍增减步长（亮度 0.05、色相 0.025）。 */
export const COLOR_PALETTE_BRIGHTNESS_STEP = 0.05
export const COLOR_PALETTE_SATURATION_STEP = 0.05
export const COLOR_PALETTE_HUE_STEP = 0.025

/**
 * Swift L164：`if hsb.saturation > 0.0001 { hue = hsb.hue }`。
 * 这条阈值就是「黑/灰没有有意义色相」的判据。
 */
export const COLOR_PALETTE_HUE_RETAIN_THRESHOLD = 0.0001

/** HSV 三元组（全部 0..1）。 */
export interface HsbComponents {
  readonly hue: number
  readonly saturation: number
  readonly brightness: number
}

/** HSV → RGB（Swift `Color(hue:saturation:brightness:)` 的等价实现）。 */
export function hsbToRgb(hsb: HsbComponents): RgbComponents {
  const hue = wrapUnit(hsb.hue) * 6
  const saturation = clampUnit(hsb.saturation)
  const brightness = clampUnit(hsb.brightness)
  const sector = Math.floor(hue)
  const fraction = hue - sector
  const p = brightness * (1 - saturation)
  const q = brightness * (1 - saturation * fraction)
  const t = brightness * (1 - saturation * (1 - fraction))
  switch (sector % 6) {
    case 0:
      return { red: brightness, green: t, blue: p }
    case 1:
      return { red: q, green: brightness, blue: p }
    case 2:
      return { red: p, green: brightness, blue: t }
    case 3:
      return { red: p, green: q, blue: brightness }
    case 4:
      return { red: t, green: p, blue: brightness }
    default:
      return { red: brightness, green: p, blue: q }
  }
}

/**
 * RGB → HSV（Swift `NSColor.hueComponent` / `saturationComponent` / `brightnessComponent`）。
 * 灰色（max == min）时色相为 0 —— 调用方必须靠
 * `COLOR_PALETTE_HUE_RETAIN_THRESHOLD` 决定要不要采用它。
 */
export function hsbFromRgb(rgb: RgbComponents): HsbComponents {
  const red = clampUnit(rgb.red)
  const green = clampUnit(rgb.green)
  const blue = clampUnit(rgb.blue)
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const delta = maximum - minimum
  const brightness = maximum
  const saturation = maximum === 0 ? 0 : delta / maximum
  let hue = 0
  if (delta !== 0) {
    if (maximum === red) {
      hue = ((green - blue) / delta) / 6
    } else if (maximum === green) {
      hue = (2 + (blue - red) / delta) / 6
    } else {
      hue = (4 + (red - green) / delta) / 6
    }
    if (hue < 0) hue += 1
  }
  return { hue, saturation, brightness }
}

/** 由 HexColor 反推 HSB（Swift L173-177）。 */
export function hsbFromHexColor(color: HexColor): HsbComponents {
  return hsbFromRgb(color.components)
}

/**
 * Swift L160-169：
 *   if hsb.saturation > 0.0001 { hue = hsb.hue }
 *   saturation = hsb.saturation
 *   brightness = hsb.brightness
 *   lastPreview = color; hexText = color.hexString
 *
 * 「保留用户色相」是这里唯一有产品含义的一步：用户拖到纯黑再拖回来，
 * 应该回到原来的颜色，而不是红色。
 */
export function colorPaletteRebase(
  current: HsbComponents,
  incoming: HsbComponents
): HsbComponents {
  const hue =
    incoming.saturation > COLOR_PALETTE_HUE_RETAIN_THRESHOLD ? incoming.hue : current.hue
  return { hue, saturation: incoming.saturation, brightness: incoming.brightness }
}

/**
 * Swift L95-98：拇指在面内的位置。
 *   x = clamp(width × saturation, 8, width − 8)
 *   y = clamp(height × (1 − brightness), 8, height − 8)
 * `1 − brightness` 因为 SwiftUI 的 y 轴向下：越亮越靠上。
 */
export function colorPalettePlanePoint(input: {
  readonly saturation: number
  readonly brightness: number
  readonly width: number
  readonly height: number
}): { readonly x: number; readonly y: number } {
  const radius = COLOR_PALETTE_THUMB_RADIUS
  return {
    x: clampRange(input.width * input.saturation, radius, input.width - radius),
    y: clampRange(input.height * (1 - input.brightness), radius, input.height - radius),
  }
}

/**
 * Swift L103-104：拖动 → 取值。分母用 `max(size, 1)` 防零宽。
 *   saturation = clamp(x / width)
 *   brightness = 1 − clamp(y / height)
 */
export function colorPalettePlaneDragValue(input: {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}): { readonly saturation: number; readonly brightness: number } {
  const width = Math.max(input.width, 1)
  const height = Math.max(input.height, 1)
  return {
    saturation: clampUnit(input.x / width),
    brightness: 1 - clampUnit(input.y / height),
  }
}

/**
 * Swift L122-123 + L133：
 *   travel = max(width − inset × 2, 1)
 *   拇指 offset.x = hue × travel
 *   拖动 → hue = clamp((x − inset) / travel)
 */
export function colorPaletteHueTravel(width: number): number {
  return Math.max(width - COLOR_PALETTE_HUE_STRIP_INSET * 2, 1)
}

export function colorPaletteHueThumbOffset(hue: number, width: number): number {
  return wrapUnit(hue) * colorPaletteHueTravel(width)
}

export function colorPaletteHueDragValue(x: number, width: number): number {
  return clampUnit((x - COLOR_PALETTE_HUE_STRIP_INSET) / colorPaletteHueTravel(width))
}

/** Swift L126：色相条渐变取 0…6 共七档（含两端 1.0，让红色收尾闭合）。 */
export const COLOR_PALETTE_HUE_GRADIENT_STOPS = 7

export function colorPaletteHueGradientHues(): number[] {
  return Array.from({ length: COLOR_PALETTE_HUE_GRADIENT_STOPS }, (_, index) => index / 6)
}

/**
 * Swift L64-68：
 *   guard let color = HexColor(text), color != lastPreview else { return }
 *   rebase(color); onPreview(color)
 *
 * 非法输入**不预览**也不改 lastPreview —— 用户正在打第 3 个字符时，
 * 面板不该闪成黑色。
 */
export function colorPaletteHexIsValid(text: string): boolean {
  return HexColor.parse(text) !== null
}

/** 输入合法时才产生预览色。 */
export function colorPaletteHexPreview(text: string): HexColor | null {
  return HexColor.parse(text)
}

/** Swift L69：回车把输入框恢复成当前真实色值（清掉打了一半的内容）。 */
export function colorPaletteSubmitText(lastPreview: HexColor): string {
  return lastPreview.hexString
}

/** Swift L111：`饱和度 %d%%，亮度 %d%%`。 */
export function colorPalettePlaneAccessibilityValue(hsb: HsbComponents): string {
  return `饱和度 ${Math.trunc(hsb.saturation * 100)}%，亮度 ${Math.trunc(hsb.brightness * 100)}%`
}

/** Swift L145：`%d 度`（色相 0..1 映射到 0..360）。 */
export function colorPaletteHueAccessibilityValue(hue: number): string {
  return `${Math.trunc(wrapUnit(hue) * 360)} 度`
}

/** Swift L63：`"%@十六进制值"`。 */
export function colorPaletteHexAccessibilityLabel(
  title: string,
  translate: (key: string) => string = (key) => key
): string {
  return `${translate(title)}${translate('十六进制值')}`
}

/** Swift L153：`Color(hue:saturation:brightness:).hexColor`。 */
export function colorPaletteHexFromHsb(hsb: HsbComponents): HexColor {
  const rgb = hsbToRgb(hsb)
  const channel = (value: number): number => Math.round(clampUnit(value) * 255)
  return HexColor.fromRgb24((channel(rgb.red) << 16) | (channel(rgb.green) << 8) | channel(rgb.blue))
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}

/**
 * 色相环绕：`1.25` → `0.25`、`-0.1` → `0.9`。
 *
 * 注意：**不能**用于饱和度/亮度/RGB 分量。`x % 1` 会把 `1` 折成 `0`，
 * 于是纯红 `(1,0,0)` 会变成全黑 —— 这个坑在本批次踩过并已修。
 */
function wrapUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  const wrapped = value % 1
  return wrapped < 0 ? wrapped + 1 : wrapped
}

function clampRange(value: number, lower: number, upper: number): number {
  if (!(lower <= upper)) return (lower + upper) / 2
  return Math.min(Math.max(value, lower), upper)
}
