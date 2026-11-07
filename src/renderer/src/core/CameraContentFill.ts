/**
 * CameraContentFill —— 把摄像头像素放进用户创作形状的几何契约。
 *
 * Swift source: Sources/RecorderCore/CameraContentFill.swift @ laogou717/dogsc 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - enum CameraContentFill（edgeOverscanScale / layout）  L6-68  → CAMERA_CONTENT_FILL_EDGE_OVERSCAN / cameraContentFillLayout
 *   - struct CameraContentFillLayout（含 mirrorAxisX / destinationPoint）
 *                                                     L70-110 → CameraContentFillLayout
 *
 * 形状本身稍后作为遮罩应用；本契约只描述遮罩背后的矩形内容孔径。
 * 坐标使用左上原点。
 */

import type { CompositionPoint, CompositionRect } from './CompositionGeometry'

/** Swift CameraContentFill.edgeOverscanScale（L10）：抹掉孔径取整造成的一像素接缝。 */
export const CAMERA_CONTENT_FILL_EDGE_OVERSCAN_SCALE = 1.01

/** Swift CameraContentFillLayout（L70-110）。 */
export interface CameraContentFillLayout {
  source: CompositionRect
  target: CompositionRect
  /** 经 aspect-fill 与 overscan 之后的源尺寸矩形。 */
  destination: CompositionRect
  /** 通过 target 仍可见的那部分源。 */
  visibleSource: CompositionRect
  scale: number
}

const midX = (rect: CompositionRect): number => rect.x + rect.width / 2

/**
 * Swift CameraContentFill.layout(sourceWidth:sourceHeight:target:focus:contentScale:)（L12-67）。
 * 任一非有限或非正值都返回 null —— 由调用方决定退化表现，而不是在这里猜。
 */
export function cameraContentFillLayout(
  sourceWidth: number,
  sourceHeight: number,
  target: CompositionRect,
  focus: CompositionPoint = { x: 0.5, y: 0.5 },
  contentScale = 1
): CameraContentFillLayout | null {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    !Number.isFinite(target.x) ||
    !Number.isFinite(target.y) ||
    !Number.isFinite(target.width) ||
    !Number.isFinite(target.height) ||
    !(sourceWidth > 0) ||
    !(sourceHeight > 0) ||
    !(target.width > 0) ||
    !(target.height > 0)
  ) {
    return null
  }

  const sourceZoom = Math.min(Math.max(Number.isFinite(contentScale) ? contentScale : 1, 1), 4)
  const scale =
    Math.max(target.width / sourceWidth, target.height / sourceHeight) *
    CAMERA_CONTENT_FILL_EDGE_OVERSCAN_SCALE *
    sourceZoom
  const destinationWidth = sourceWidth * scale
  const destinationHeight = sourceHeight * scale
  const visibleSourceWidth = target.width / scale
  const visibleSourceHeight = target.height / scale
  const focusX = Math.min(Math.max(Number.isFinite(focus.x) ? focus.x : 0.5, 0), 1)
  const focusY = Math.min(Math.max(Number.isFinite(focus.y) ? focus.y : 0.5, 0), 1)
  const visibleSource: CompositionRect = {
    x: (sourceWidth - visibleSourceWidth) * focusX,
    y: (sourceHeight - visibleSourceHeight) * focusY,
    width: visibleSourceWidth,
    height: visibleSourceHeight,
  }
  const destination: CompositionRect = {
    x: target.x - visibleSource.x * scale,
    y: target.y - visibleSource.y * scale,
    width: destinationWidth,
    height: destinationHeight,
  }

  return {
    source: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
    target,
    destination,
    visibleSource,
    scale,
  }
}

/**
 * Swift mirrorAxisX（L96）：水平镜像在内容填充之后围绕孔径中心求值，
 * 这样被镜像的主体保持同样的裁剪，也不会因绕全局原点翻转而平移跳变。
 */
export function cameraContentFillMirrorAxisX(layout: CameraContentFillLayout): number {
  return midX(layout.target)
}

/** Swift destinationPoint(forSourcePoint:mirroredHorizontally:)（L98-109）。 */
export function cameraContentFillDestinationPoint(
  layout: CameraContentFillLayout,
  point: CompositionPoint,
  mirroredHorizontally: boolean
): CompositionPoint {
  const sourceX = mirroredHorizontally
    ? layout.source.x + layout.source.width - (point.x - layout.source.x)
    : point.x
  return {
    x: layout.destination.x + (sourceX - layout.source.x) * layout.scale,
    y: layout.destination.y + (point.y - layout.source.y) * layout.scale,
  }
}
