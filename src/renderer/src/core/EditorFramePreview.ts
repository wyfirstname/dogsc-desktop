/**
 * Swift source: Sources/DogSCApp/EditorFramePreview.swift（120 行）@ 567fd6e
 *
 * L8-40   → 组件外壳：高度 146，壁纸层 + 屏幕层，各控件变化都走 settle 弹簧
 * L42-43  → frame / isDark
 * L45-94  → screen(in:)：边距、标题条、机身、缩放、可用区、位置
 * L96-99  → radius（none 用 canvas.cornerRadius，其余用内容圆角）
 * L101-119→ chromeBar：三个信号灯 + 浏览器地址条
 *
 * 原注释：每个「画面」页的顶部都是工程自己的画面 —— 用实时边距、圆角、描边、
 * 阴影与样机画出来，让用户拧旋钮时看到的是**图**而不是数字。
 */

import {
  isBrowserFrame,
  isDeviceFrame,
  isWindowFrame,
  type CanvasStyle,
  type ScreenFrameStyle,
} from './ProjectModel'
import { screenFrameDefaultContentRadius } from './ScreenFrameDefaults'

/** 预览高度（Swift `var height: CGFloat = 146`）。 */
export const FRAME_PREVIEW_HEIGHT = 146

/** 边距公式常量（Swift L46-49）。 */
export const FRAME_PREVIEW_MARGIN_BASE = 14
export const FRAME_PREVIEW_MARGIN_PADDING_LIMIT = 360
export const FRAME_PREVIEW_MARGIN_STAGE_FRACTION = 0.26
export const FRAME_PREVIEW_MARGIN_LIMIT_FRACTION = 0.42

/** 标题条 / 机身厚度。 */
export const FRAME_PREVIEW_CHROME_BAR_HEIGHT = 11
export const FRAME_PREVIEW_DEVICE_BEZEL = 4.5

/** 缩放夹取范围。 */
export const FRAME_PREVIEW_SCALE_MIN = 0.6
export const FRAME_PREVIEW_SCALE_MAX = 1.6

/** 内容最小尺寸（Swift `max(..., 20)`）。 */
export const FRAME_PREVIEW_MINIMUM_CONTENT_SIDE = 20

/** 内容圆角：3 + (clamp(radius, 0, 160) / 160) × 9。 */
export const FRAME_PREVIEW_CONTENT_RADIUS_BASE = 3
export const FRAME_PREVIEW_CONTENT_RADIUS_LIMIT = 160
export const FRAME_PREVIEW_CONTENT_RADIUS_GAIN = 9

/** 外框圆角：设备 bezel×3，none 用内容圆角，其余 6。 */
export const FRAME_PREVIEW_OUTER_RADIUS = 6

/** 描边宽度系数（`min(max(borderWidth,0),40) * 0.3`）。 */
export const FRAME_PREVIEW_BORDER_GAIN = 0.3
export const FRAME_PREVIEW_BORDER_LIMIT = 40

/** 阴影：0.18 + 0.4 × clamp(shadowStrength, 0, 1)，radius 9、y 5。 */
export const FRAME_PREVIEW_SHADOW_BASE = 0.18
export const FRAME_PREVIEW_SHADOW_GAIN = 0.4
export const FRAME_PREVIEW_SHADOW_RADIUS = 9
export const FRAME_PREVIEW_SHADOW_Y = 5

/** 壁纸模糊：`min(max(backgroundBlur, 0), 40) × 0.25`；叠一层 6% 黑。 */
export const FRAME_PREVIEW_BLUR_LIMIT = 40
export const FRAME_PREVIEW_BLUR_GAIN = 0.25
export const FRAME_PREVIEW_SCRIM_OPACITY = 0.06

/** 标题条三个信号灯（macOS 红黄绿）与浏览器地址条。 */
export const FRAME_PREVIEW_TRAFFIC_LIGHTS = [
  { red: 1, green: 0.37, blue: 0.34 },
  { red: 1, green: 0.74, blue: 0.18 },
  { red: 0.16, green: 0.78, blue: 0.25 },
] as const
export const FRAME_PREVIEW_TRAFFIC_LIGHT_DIAMETER = 4
export const FRAME_PREVIEW_TRAFFIC_LIGHT_SPACING = 3

/** 深色窗框判定（Swift L43）。 */
export function framePreviewIsDark(frame: ScreenFrameStyle): boolean {
  return frame === 'windowDark' || frame === 'browserDark'
}

/**
 * 屏幕区域几何（Swift L45-71）。
 *
 * `margin` 同时受「设置里的边距」与「舞台自身大小」夹取：小舞台里边距按比例缩，
 * 但不超过短边的 42% —— 否则画面会被边距挤成一条缝。
 */
export function framePreviewScreenGeometry(input: {
  readonly stageWidth: number
  readonly stageHeight: number
  readonly canvas: Pick<
    CanvasStyle,
    'padding' | 'cornerRadius' | 'borderWidth' | 'shadowStrength' | 'screenFrame' | 'screenFrameScale'
  > & { readonly screenFrameContentCornerRadius?: number | null }
  readonly baseWidth: number
  readonly baseHeight: number
}): {
  margin: number
  bar: number
  bezel: number
  scale: number
  availableWidth: number
  availableHeight: number
  contentWidth: number
  contentHeight: number
  contentRadius: number
  totalWidth: number
  totalHeight: number
  freeWidth: number
  freeHeight: number
  outerRadius: number
  borderWidth: number
  shadowOpacity: number
  contentInsetRadius: number
} {
  const frame = input.canvas.screenFrame
  const padding = Math.min(Math.max(input.canvas.padding, 0), FRAME_PREVIEW_MARGIN_PADDING_LIMIT)
  const margin = Math.min(
    FRAME_PREVIEW_MARGIN_BASE +
      (padding / FRAME_PREVIEW_MARGIN_PADDING_LIMIT) *
        (input.stageHeight * FRAME_PREVIEW_MARGIN_STAGE_FRACTION),
    Math.min(input.stageWidth, input.stageHeight) * FRAME_PREVIEW_MARGIN_LIMIT_FRACTION
  )
  const bar = isWindowFrame(frame) || isBrowserFrame(frame) ? FRAME_PREVIEW_CHROME_BAR_HEIGHT : 0
  const bezel = isDeviceFrame(frame) ? FRAME_PREVIEW_DEVICE_BEZEL : 0
  const scale =
    frame === 'none'
      ? 1
      : Math.min(Math.max(input.canvas.screenFrameScale, FRAME_PREVIEW_SCALE_MIN), FRAME_PREVIEW_SCALE_MAX)

  const availableWidth = Math.max(
    input.stageWidth - margin * 2 - bezel * 2,
    FRAME_PREVIEW_MINIMUM_CONTENT_SIDE
  )
  const availableHeight = Math.max(
    input.stageHeight - margin * 2 - bar - bezel * 2,
    FRAME_PREVIEW_MINIMUM_CONTENT_SIDE
  )

  const contentWidth = Math.min(input.baseWidth * scale, availableWidth)
  const contentHeight = Math.min(input.baseHeight * scale, availableHeight)

  const radius =
    frame === 'none'
      ? input.canvas.cornerRadius
      : (input.canvas.screenFrameContentCornerRadius ?? screenFrameDefaultContentRadius(frame))
  const contentRadius =
    FRAME_PREVIEW_CONTENT_RADIUS_BASE +
    (Math.min(Math.max(radius, 0), FRAME_PREVIEW_CONTENT_RADIUS_LIMIT) /
      FRAME_PREVIEW_CONTENT_RADIUS_LIMIT) *
      FRAME_PREVIEW_CONTENT_RADIUS_GAIN

  const totalWidth = contentWidth + bezel * 2
  const totalHeight = contentHeight + bar + bezel * 2

  return {
    margin,
    bar,
    bezel,
    scale,
    availableWidth,
    availableHeight,
    contentWidth,
    contentHeight,
    contentRadius,
    totalWidth,
    totalHeight,
    freeWidth: Math.max(input.stageWidth - totalWidth, 0),
    freeHeight: Math.max(input.stageHeight - totalHeight, 0),
    outerRadius:
      isDeviceFrame(frame)
        ? bezel * 3
        : frame === 'none'
          ? contentRadius
          : FRAME_PREVIEW_OUTER_RADIUS,
    borderWidth:
      Math.min(Math.max(input.canvas.borderWidth, 0), FRAME_PREVIEW_BORDER_LIMIT) *
      FRAME_PREVIEW_BORDER_GAIN,
    shadowOpacity:
      FRAME_PREVIEW_SHADOW_BASE +
      FRAME_PREVIEW_SHADOW_GAIN * Math.min(Math.max(input.canvas.shadowStrength, 0), 1),
    // Swift L74：none 用内容圆角，设备 3，窗口/浏览器 0
    contentInsetRadius: frame === 'none' ? contentRadius : isDeviceFrame(frame) ? 3 : 0,
  }
}

/**
 * 画面在舞台里的位置（Swift L90-93）：先居中所占方块，再按 contentPosition（0..1）
 * 在剩余空白里滑动。0.5 就是正中，1 是右下角。
 */
export function framePreviewScreenPosition(input: {
  readonly stageWidth: number
  readonly stageHeight: number
  readonly totalWidth: number
  readonly totalHeight: number
  readonly contentPosition: { readonly x: number; readonly y: number }
}): { x: number; y: number } {
  const freeWidth = Math.max(input.stageWidth - input.totalWidth, 0)
  const freeHeight = Math.max(input.stageHeight - input.totalHeight, 0)
  return {
    x: input.totalWidth / 2 + freeWidth * Math.min(Math.max(input.contentPosition.x, 0), 1),
    y: input.totalHeight / 2 + freeHeight * Math.min(Math.max(input.contentPosition.y, 0), 1),
  }
}

/** 壁纸层模糊半径（Swift L21）。 */
export function framePreviewWallpaperBlur(backgroundBlur: number): number {
  return Math.min(Math.max(backgroundBlur, 0), FRAME_PREVIEW_BLUR_LIMIT) * FRAME_PREVIEW_BLUR_GAIN
}

/** 地址条颜色：深色窗框 12% 白，浅色 7% 黑。 */
export function framePreviewAddressBarColor(isDark: boolean): { white: number; opacity: number } {
  return isDark ? { white: 1, opacity: 0.12 } : { white: 0, opacity: 0.07 }
}

/** 标题条底色：深色 0.17 白，浅色 0.96 白。 */
export function framePreviewChromeBarBackground(isDark: boolean): number {
  return isDark ? 0.17 : 0.96
}
