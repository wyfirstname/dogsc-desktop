/**
 * SharedFrameOverlayRenderer —— 把编辑器创作的叠加效果降成图像层。
 *
 * Swift source: Sources/DogSCApp/SharedFrameOverlayRenderer.swift（232 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L9       enum SharedFrameOverlayRenderer
 *   L11-55   applyingMosaics(_:to:) —— 高斯模糊马赛克
 *   L18-20   只处理 `style === 'blur'` 且进度 > 0.001
 *   L21-29   归一化矩形 → 像素矩形（y 翻转），并要求宽高 > 1
 *   L30       radius = (4 + intensity × 44) × progress
 *   L35-36    采样框 = 外扩 3 倍半径后再与 extent 求交
 *   L37-52    裁剪 → clamp → 高斯 → 裁剪 → 圆角蒙版 → CIBlendWithMask
 *   L57-166  renderSticker(source:scene:over:canvasRect:)
 *   L63-66   三道前置（不透明度 / 归一化后宽高为正）
 *   L67-69   width = max(canvasW × width × scale, 2)，height 按源图宽高比
 *   L70-73   中心点 y 翻转
 *   L83-103  缩放平移到目标矩形 + 圆角蒙版
 *   L104-120 边框 = 外圈蒙版减内圈蒙版（CISourceOutCompositing）
 *   L121-139 阴影 = 蒙版平移 + 高斯（y 取反）
 *   L140-156 旋转（数学角取反）
 *   L157-164 不透明度（CIColorMatrix 的 inputAVector）
 *   L168-231 normalized / roundedMask / coloredLayer / ringMask / color
 *
 * 迁移说明：
 *   Core Image 在 Web 侧由 Canvas2D + CSS filter 承担，所以这里不实现滤镜，
 *   只保留**几何与阈值**——它们才是效果看得对不对的决定因素：
 *     1. 归一化矩形到像素矩形时的 y 翻转（Core Image 原点在左下）
 *     2. 马赛克半径随进度插值（`4 + intensity × 44`，intensity ∈ [0,1]）
 *     3. 采样框外扩 3 倍半径 —— 局部柔化不该跑全画幅高斯
 *     4. 贴图宽度下限 2，高度按源图宽高比推
 *     5. 圆角半径按 1920 基准缩放并夹到短边一半
 *     6. 阴影 y 偏移取反、旋转数学角取反（两处坐标系差异）
 */

import type { HexColor } from './HexColor'

/** Swift L20：进度小于千分之一就不画（入场动画的第一帧）。 */
export const OVERLAY_TRANSITION_MINIMUM_PROGRESS = 0.001

/** Swift L30：模糊半径 = `(4 + intensity × 44) × progress`。 */
export const MOSAIC_BLUR_BASE_RADIUS = 4
export const MOSAIC_BLUR_INTENSITY_RADIUS = 44

/** Swift L35：采样框外扩 `radius × 3`。 */
export const MOSAIC_SAMPLE_EXPANSION_FACTOR = 3

/** Swift L29 / L67：像素矩形与贴图宽度的下限。 */
export const OVERLAY_MINIMUM_RECT_EDGE = 1
export const OVERLAY_MINIMUM_STICKER_WIDTH = 2

/** Swift L93 / L105 / L123：设计基准宽度，所有「按画布缩放」都以它为分母。 */
export const OVERLAY_DESIGN_REFERENCE_WIDTH = 1_920

/** Swift L105：边框宽度下限 0.5 像素。 */
export const OVERLAY_MINIMUM_BORDER_WIDTH = 0.5

/** Swift L122 / L140 / L157：三个阈值。 */
export const OVERLAY_SHADOW_MINIMUM_OPACITY = 0.001
export const OVERLAY_ROTATION_MINIMUM_RADIANS = 0.000_1
export const OVERLAY_OPACITY_MAXIMUM = 0.999

export interface OverlayRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface OverlaySize {
  readonly width: number
  readonly height: number
}

/** Swift L18-20：`style === 'blur'` 且进度超过阈值。 */
export function mosaicBlurShouldApply(input: {
  readonly style: string
  readonly transitionProgress: number
}): boolean {
  if (input.style !== 'blur') return false
  return input.transitionProgress > OVERLAY_TRANSITION_MINIMUM_PROGRESS
}

/**
 * Swift L21-29：归一化矩形 → 像素矩形。
 *
 * y 的换算 **不是** `minY + height × ny`，而是 `minY + height × (1 − ny − nh)`：
 * 归一化坐标以左上为原点，Core Image 的 extent 以左下为原点。漏掉这一步，
 * 马赛克会上下颠倒地盖在画面上。
 *
 * 之后还要与 extent 求交 —— 归一化矩形可以部分出界（用户把马赛克拖到画布外），
 * 出界部分没有像素可模糊。
 */
export function mosaicBlurRect(input: {
  readonly extent: OverlayRect
  readonly sourceRect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}): OverlayRect | null {
  const rect: OverlayRect = {
    x: input.extent.x + input.extent.width * input.sourceRect.x,
    y:
      input.extent.y +
      input.extent.height * (1 - input.sourceRect.y - input.sourceRect.height),
    width: input.extent.width * input.sourceRect.width,
    height: input.extent.height * input.sourceRect.height,
  }
  const clipped = intersectRects(rect, input.extent)
  if (clipped == null) return null
  if (clipped.width <= OVERLAY_MINIMUM_RECT_EDGE) return null
  if (clipped.height <= OVERLAY_MINIMUM_RECT_EDGE) return null
  return clipped
}

/** Swift L30：模糊半径随入场进度线性插值。 */
export function mosaicBlurRadius(input: {
  readonly intensity: number
  readonly transitionProgress: number
}): number {
  return (
    (MOSAIC_BLUR_BASE_RADIUS + input.intensity * MOSAIC_BLUR_INTENSITY_RADIUS) *
    input.transitionProgress
  )
}

/**
 * Swift L35-36：采样框 = 矩形外扩 `3 × radius` 后再与 extent 求交。
 *
 * 只对采样框跑高斯，是「用户在 5K 工程里拖一个马赛克」不至于每次都全画幅
 * 模糊一遍的原因。外扩 3 倍是因为高斯核的有效半径约等于 3σ。
 */
export function mosaicSampleRect(input: {
  readonly rect: OverlayRect
  readonly radius: number
  readonly extent: OverlayRect
}): OverlayRect | null {
  const expanded = insetRect(
    input.rect,
    -input.radius * MOSAIC_SAMPLE_EXPANSION_FACTOR
  )
  return intersectRects(expanded, input.extent)
}

/** Swift L44：圆角半径 = 短边 × 归一化圆角系数。 */
export function mosaicCornerRadius(input: {
  readonly rect: OverlayRect
  readonly cornerRadius: number
}): number {
  return Math.min(input.rect.width, input.rect.height) * input.cornerRadius
}

/**
 * Swift L63-69：贴图的目标矩形。
 *
 *  - 宽度下限 2（`max(canvasW × width × scale, 2)`）。
 *  - **高度由源图宽高比推出**，不是独立字段：`height = width × 源高 / 源宽`。
 *    这样贴图永远不会被拉伸变形，改 `width` 就等于改缩放。
 *  - 中心点 y 翻转：`canvasH × (1 − position.y − offset.y)`。
 */
export function stickerTargetRect(input: {
  readonly canvasRect: OverlaySize
  readonly position: { readonly x: number; readonly y: number }
  readonly offset: { readonly x: number; readonly y: number }
  readonly width: number
  readonly scale: number
  readonly sourceSize: OverlaySize
}): OverlayRect {
  const width = Math.max(
    input.canvasRect.width * input.width * input.scale,
    OVERLAY_MINIMUM_STICKER_WIDTH
  )
  const height = (width * input.sourceSize.height) / input.sourceSize.width
  const center = {
    x: input.canvasRect.width * (input.position.x + input.offset.x),
    y: input.canvasRect.height * (1 - input.position.y - input.offset.y),
  }
  return {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  }
}

/**
 * Swift L92-95：贴图圆角。
 *
 * `min(max(cornerRadius × width / 1920, 0), min(w, h) / 2)` —— 三层：
 * 按画布缩放、不允许负数、不允许超过短边一半（超过就是「胶囊」而不是圆角）。
 * 注意除数是**贴图宽度**而不是画布宽度：素材越大，圆角也按比例变大。
 */
export function stickerCornerRadius(input: {
  readonly cornerRadius: number
  readonly width: number
  readonly height: number
}): number {
  return Math.min(
    Math.max(
      (input.cornerRadius * input.width) / OVERLAY_DESIGN_REFERENCE_WIDTH,
      0
    ),
    Math.min(input.width, input.height) / 2
  )
}

/**
 * Swift L105：边框宽度 = `max(borderWidth × canvasW / 1920, 0.5)`。
 *
 * 下限 0.5 而不是 1：细边框在 1x 屏上要能画出一条抗锯齿的灰线，
 * 卡到 1 会让「无边框」看起来厚了一倍。
 */
export function stickerBorderWidth(input: {
  readonly borderWidth: number
  readonly canvasWidth: number
}): number {
  return Math.max(
    (input.borderWidth * input.canvasWidth) / OVERLAY_DESIGN_REFERENCE_WIDTH,
    OVERLAY_MINIMUM_BORDER_WIDTH
  )
}

/** Swift L108：外圈圆角 = 内圈圆角 + 边框宽。 */
export function stickerOuterCornerRadius(input: {
  readonly cornerRadius: number
  readonly borderWidth: number
}): number {
  return input.cornerRadius + input.borderWidth
}

/** Swift L123：阴影半径按画布宽度缩放。 */
export function stickerShadowRadius(input: {
  readonly shadowRadius: number
  readonly canvasWidth: number
}): number {
  return (input.shadowRadius * input.canvasWidth) / OVERLAY_DESIGN_REFERENCE_WIDTH
}

/**
 * Swift L126-127：阴影偏移平移。
 *
 * x 按画布宽度缩放，y **取反**（`-shadowOffset.y`）—— 归一化坐标的 y
 * 向下为正，Core Image 向上为正。
 */
export function stickerShadowTranslation(input: {
  readonly offset: { readonly x: number; readonly y: number }
  readonly canvasWidth: number
}): { readonly x: number; readonly y: number } {
  return {
    x: (input.offset.x * input.canvasWidth) / OVERLAY_DESIGN_REFERENCE_WIDTH,
    y: (-input.offset.y * input.canvasWidth) / OVERLAY_DESIGN_REFERENCE_WIDTH,
  }
}

/** Swift L122：阴影只在 `shadowOpacity > 0.001` 时才合成。 */
export function stickerShadowShouldApply(shadowOpacity: number): boolean {
  return shadowOpacity > OVERLAY_SHADOW_MINIMUM_OPACITY
}

/**
 * Swift L140-156：旋转。
 *
 * 数学角**取反**：贴图授权用左上原点的画布约定（正角 = 顺时针），
 * Core Image 的坐标系是左下原点（正角 = 逆时针）。不取反的话，
 * 用户往右转、预览往左转 —— 这是直接操作类 bug 里最刺眼的一种。
 *
 * 旋转围绕 `center`，三步变换：平移到原点 → 旋转 → 平移回去。
 */
export function stickerRotationApplies(rotationRadians: number): boolean {
  return Math.abs(rotationRadians) > OVERLAY_ROTATION_MINIMUM_RADIANS
}

export function stickerRotationCoreImageRadians(rotationRadians: number): number {
  return -rotationRadians
}

/** Swift L157-163：不透明度只在 `opacity < 0.999` 时才挂颜色矩阵。 */
export function stickerOpacityApplies(opacity: number): boolean {
  return opacity < OVERLAY_OPACITY_MAXIMUM
}

/** Swift L161：`inputAVector = (0, 0, 0, opacity)` —— 只改 alpha 通道。 */
export function stickerOpacityVector(opacity: number): {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly w: number
} {
  return { x: 0, y: 0, z: 0, w: opacity }
}

/**
 * Swift L190-193 / L210-213：画布裁剪。
 *
 * 图层自己的边框/阴影不该因为加了一张透明背景就变成全画布中间产物，
 * 所以先用 `canvasRect ∩ mask.extent` 求交；交集为空或为 null 时
 * 返回零矩形（一个空图层），而不是原样返回未裁剪的图层。
 */
export function overlayClippedExtent(input: {
  readonly canvasRect: OverlayRect
  readonly maskExtent: OverlayRect | null
}): OverlayRect | null {
  if (input.maskExtent == null) return null
  const clipped = intersectRects(input.canvasRect, input.maskExtent)
  if (clipped == null) return null
  if (clipped.width <= 0 || clipped.height <= 0) return null
  return clipped
}

/** Swift L168-173：把图像平移到原点（`-extent.minX/minY`）。 */
export function overlayNormalizingTranslation(extent: OverlayRect): {
  readonly x: number
  readonly y: number
} {
  return { x: -extent.x, y: -extent.y }
}

/**
 * Swift L6-9 / L31-34：为什么聚光效果**不在**这里。
 *
 * 聚光属于「已经合成好的基础画面」，不是原始屏幕源；把它放进这一层会让
 * 压暗范围跟着马赛克/贴图的顺序漂。注释里明确写了 `Spotlight is
 * intentionally absent`。
 */
export const OVERLAY_RENDERER_EXCLUDES_SPOTLIGHT = true

// ---------------------------------------------------------------- 矩形工具

/** 两矩形求交；无交集返回 null（对应 Swift 的 null extent 判定）。 */
export function intersectRects(a: OverlayRect, b: OverlayRect): OverlayRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

/** Swift `insetBy(dx: d, dy: d)`：正数内缩，负数外扩。 */
export function insetRect(rect: OverlayRect, delta: number): OverlayRect {
  return {
    x: rect.x + delta,
    y: rect.y + delta,
    width: rect.width - delta * 2,
    height: rect.height - delta * 2,
  }
}

/** Swift L224-230：把十六进制色转成 [0,1] 的 RGBA 分量并附上 alpha。 */
export function overlayColorComponents(
  color: HexColor,
  alpha = 1
): { readonly red: number; readonly green: number; readonly blue: number; readonly alpha: number } {
  return {
    red: color.components.red,
    green: color.components.green,
    blue: color.components.blue,
    alpha,
  }
}
