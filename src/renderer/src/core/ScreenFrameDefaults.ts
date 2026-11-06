/**
 * ScreenFrameDefaults — 屏幕框样式预设。
 *
 * Swift source: Sources/RecorderCore/ScreenFrameDefaults.swift @ laogou717/dogsc 567fd6e
 *   - struct ScreenFrameDefaults            (L6)
 *   - extension ScreenFrameStyle.defaults   (L20)
 *   - extension CanvasStyle.applyScreenFrameStyle (L46)
 *
 * 依据标准 1080 短边手工调校；选择不同样式时从该样式的设计出发，
 * 而不是携带另一款样式的覆盖值。
 */

import type { ScreenFrameStyle } from './ProjectModel'
import { HexColor } from './HexColor'

export interface ScreenFrameDefaults {
  frameScale: number
  toolbarScale: number
  outerRadius: number
  contentRadius: number
  shadowStrength: number
  borderWidth: number
  borderColor: string
}

function makeDefaults(
  outerRadius: number,
  contentRadius: number,
  overrides: Partial<ScreenFrameDefaults> = {}
): ScreenFrameDefaults {
  return {
    frameScale: 1,
    toolbarScale: 1,
    outerRadius,
    contentRadius,
    shadowStrength: 0.24,
    borderWidth: 0,
    borderColor: HexColor.white.hexString,
    ...overrides,
  }
}

export function screenFrameDefaults(style: ScreenFrameStyle): ScreenFrameDefaults {
  switch (style) {
    case 'none':
      return makeDefaults(24, 24, { shadowStrength: 0.28 })
    case 'windowLight':
      return makeDefaults(18, 0, { toolbarScale: 0.9, shadowStrength: 0.22 })
    case 'windowDark':
      return makeDefaults(18, 0, { toolbarScale: 0.9, shadowStrength: 0.3 })
    case 'browserLight':
      return makeDefaults(22, 0, { toolbarScale: 1.08, shadowStrength: 0.22 })
    case 'browserDark':
      return makeDefaults(22, 0, { toolbarScale: 1.08, shadowStrength: 0.3 })
    case 'devicePhone': case 'devicePhonePortrait': case 'devicePhoneLandscape':
      return makeDefaults(64, 40, { frameScale: 0.9 })
    case 'deviceTablet': case 'deviceTabletPortrait': case 'deviceTabletLandscape':
      return makeDefaults(48, 24)
  }
}

/** Swift defaultOuterCornerRadius / defaultContentCornerRadius 计算属性。 */
export const screenFrameDefaultOuterRadius = (style: ScreenFrameStyle): number =>
  screenFrameDefaults(style).outerRadius

export const screenFrameDefaultContentRadius = (style: ScreenFrameStyle): number =>
  screenFrameDefaults(style).contentRadius

/**
 * extension CanvasStyle.applyScreenFrameStyle。
 * 标题/地址是手授内容而非几何预设；裁切、摆放、画布比例与背景属于其他工具。
 */
import type { CanvasStyle } from './ProjectModel'

export function applyScreenFrameStyle(canvas: CanvasStyle, style: ScreenFrameStyle): void {
  const preset = screenFrameDefaults(style)
  canvas.screenFrame = style
  canvas.screenFrameScale = preset.frameScale
  canvas.screenFrameToolbarScale = preset.toolbarScale
  canvas.screenFrameOuterCornerRadius = preset.outerRadius
  canvas.screenFrameContentCornerRadius = preset.contentRadius
  canvas.cornerRadius = preset.contentRadius
  canvas.borderWidth = preset.borderWidth
  canvas.borderColor = preset.borderColor
  canvas.shadowStrength = preset.shadowStrength
}
