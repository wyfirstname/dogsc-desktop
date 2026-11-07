/**
 * 录制窗口的颜色桥 —— Swift RecorderViewStyle.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/RecorderViewStyle.swift（27 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - init(hex: HexColor)                     L9-16
 *   - var hexColor: HexColor（sRGB 往返）      L18-26
 *
 * 迁移说明：Swift 这两段是 `Color` ↔ `HexColor` 的双向桥。React 侧不需要 NSColor，
 * 但**量化规则必须一致** —— 取色器把浮点分量写回 `HexColor` 时若用截断或 floor，
 * 用户选的颜色会比显示的颜色暗一档，而且每次往返都会继续变暗。
 *
 * 规则：sRGB 分量先夹到 [0,1]，再乘 255 并 **四舍五入**；色彩空间转换失败时退回白色。
 */

import { HexColor } from './HexColor'

/** 单通道浮点 → 0..255 整数（夹取 + 四舍五入）。 */
export function colorChannelByte(component: number): number {
  if (!Number.isFinite(component)) return 0
  const clamped = Math.min(Math.max(component, 0), 1)
  return Math.round(clamped * 255)
}

/** Swift L9-16：`Color(hex:)` 取的是 `HexColor.components`（0..1 三通道）。 */
export function cssColorFromHexColor(hex: HexColor): string {
  const components = hex.components
  const red = colorChannelByte(components.red)
  const green = colorChannelByte(components.green)
  const blue = colorChannelByte(components.blue)
  return `rgb(${red}, ${green}, ${blue})`
}

/**
 * Swift L18-26：`NSColor(self).usingColorSpace(.sRGB)` → 夹取 → 四舍五入 → 组 24 位。
 * 通道顺序固定 R<<16 | G<<8 | B（与 HexColor.rgb24 一致）。
 */
export function hexColorFromRgbComponents(red: number, green: number, blue: number): HexColor {
  return HexColor.fromRgb24(
    (colorChannelByte(red) << 16) | (colorChannelByte(green) << 8) | colorChannelByte(blue)
  )
}

/** Swift L19 的 `guard let … else { return .white }`：色彩空间转换失败时的兜底。 */
export const RECORDER_VIEW_FALLBACK_HEX_COLOR = HexColor.white

/**
 * 一次完整往返（`Color` → `HexColor` → CSS）。用于断言量化是幂等的：
 * 把同一颜色反复写入读出不应该持续漂移。
 */
export function recorderViewStyleRoundTrip(hex: HexColor): HexColor {
  const components = hex.components
  return hexColorFromRgbComponents(components.red, components.green, components.blue)
}
