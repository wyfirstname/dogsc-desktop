/**
 * CompositionScene —— SwiftUI 预览与 Core Image 导出共享的纯场景几何。
 *
 * Swift source: Sources/RecorderCore/CompositionScene.swift @ laogou717/dogsc 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct CompositionRect             L3-18   → CompositionGeometry.CompositionRect
 *   - struct CompositionPoint            L20-28  → CompositionGeometry.CompositionPoint
 *   - struct ScreenSceneEvaluation       L30-65  → ScreenSceneEvaluation
 *   - struct ScreenDecorationInsets      L67-81  → ScreenDecorationInsets
 *   - enum ScreenFrameGeometry           L86-121 → ScreenFrameGeometry
 *   - struct CameraSceneEvaluation       L123-130 → CameraSceneEvaluation
 *   - struct CompositionSceneEvaluation  L132-135 → CompositionSceneEvaluation
 *   - enum CompositionSceneEvaluator     L141-467 → compositionSceneEvaluate 等
 *   - class MotionTrackCacheStore        L473-501 → motionTrackCache（JS 单线程 → 简单 Map）
 *
 * 坐标使用左上原点；渲染器只做最终 Y 轴转换。所有布局决策集中在此，
 * 防止预览/导出随编辑控件演化而漂移。
 */

import type { NormalizedPoint, TimeInterval } from './ZoomAnimation'
import type { ZoomSample } from './ZoomAnimation'
import { makeViewportTransform, trackSample, zoomSampleForAnimations, type ZoomAnimationTrack, type ZoomViewportTransform } from './ZoomAnimation'
import { type CompositionPoint, type CompositionRect, rectMidX, rectMidY } from './CompositionGeometry'
import { projectScreen, type ProjectedScreenQuad } from './ScreenProjection'
import type { ScreenFrameStyle, CanvasStyle, CameraStyle } from './ProjectModel'
import { clampedCrop, type NormalizedCrop } from './ProjectModel'
import type { RecorderProject } from './ProjectMediaModel'
import { ScreenMotionTrack, type ScreenMotionSample, type ScreenAnchorViewport } from './ScreenMotion'
import type { ScreenMotionState } from './ScreenTransform'
import { CameraMotionTrack, type CameraMotionSample, type CameraMotionState } from './CameraMotion'
import type { CameraMotionClip } from './CameraMotion'
import type { ScreenMotionClip } from './ProjectTimeline'
import type { MotionStyle } from './MotionStyle'

// ---------------------------------------------------------------- ScreenSceneEvaluation

/** Swift ScreenSceneEvaluation（L30-65）。 */
export interface ScreenSceneEvaluation {
  fittedRect: CompositionRect
  baseRect: CompositionRect
  finalRect: CompositionRect
  manualScale: number
  manualOffset: CompositionPoint
  rotationX: number
  rotationY: number
  rotationZ: number
  perspective: number
  projectionAnchor: NormalizedPoint
  baseCornerRadius: number
  baseBorderWidth: number
  finalCornerRadius: number
  finalBorderWidth: number
  zoom: ZoomSample
  viewport: ZoomViewportTransform
}

/** Swift projectedQuad 计算属性（L48-64）。 */
export function projectedQuad(screen: ScreenSceneEvaluation): ProjectedScreenQuad {
  // 创作的 3D 目标选择录屏内的一个点。边框/装饰随该屏幕移动，但不得
  // 因它们的 inset 不同而把枢轴从所选内容上移开。
  const anchor = {
    x: screen.finalRect.x + screen.finalRect.width * screen.projectionAnchor.x,
    y: screen.finalRect.y + screen.finalRect.height * screen.projectionAnchor.y,
  }
  return projectScreen({
    rect: screen.finalRect,
    rotationX: screen.rotationX,
    rotationY: screen.rotationY,
    rotationZ: screen.rotationZ,
    perspective: screen.perspective,
    anchor,
  })
}

// ---------------------------------------------------------------- 装饰 inset

/** Swift ScreenDecorationInsets（L67-81）。 */
export interface ScreenDecorationInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export const SCREEN_DECORATION_ZERO: ScreenDecorationInsets = { top: 0, right: 0, bottom: 0, left: 0 }

/**
 * Swift ScreenFrameGeometry.decorationInsetsAtScaleOne（L87-119）。
 * motion 布局与最终矢量装饰都用同一份屏幕框测量，锚点与渲染一致。
 *
 * 注意：TS ScreenFrameStyle 目前只定义了 6 个值；deviceTablet* /
 * devicePhonePortrait 等按名称前缀兼容（行为与 Swift 逐 case 一致）。
 */
export function decorationInsetsAtScaleOne(
  style: ScreenFrameStyle,
  frameScale: number,
  toolbarScale: number,
  fittedWidth: number,
  fittedHeight: number,
  styleScale: number
): ScreenDecorationInsets {
  if (style === 'none') return SCREEN_DECORATION_ZERO
  const safeStyleScale = Math.max(styleScale, 0.000_1)
  const authoredFrameScale = Math.min(Math.max(frameScale, 0.6), 1.6)
  const authoredToolbarScale = Math.min(Math.max(toolbarScale, 0.65), 1.6)
  const visualScale = safeStyleScale * authoredFrameScale
  if (style.startsWith('window') || style.startsWith('browser')) {
    const idealHeight = 46 * visualScale * authoredToolbarScale
    return {
      top: Math.min(
        Math.max(idealHeight, 4 * safeStyleScale),
        Math.max(Math.max(fittedHeight, 0) * 0.25, 4 * safeStyleScale)
      ),
      right: 0,
      bottom: 0,
      left: 0,
    }
  }
  // devicePhone*（bezel 系数 0.026 / 上限 0.07）与 deviceTablet*（0.035 / 0.08）
  const shortEdge = Math.max(Math.min(fittedWidth, fittedHeight), 1)
  const phone = style.startsWith('devicePhone')
  const bezel = Math.min(
    Math.max(shortEdge * (phone ? 0.026 : 0.035) * authoredFrameScale, 2 * safeStyleScale),
    shortEdge * (phone ? 0.07 : 0.08)
  )
  return { top: bezel, right: bezel, bottom: bezel, left: bezel }
}

// ---------------------------------------------------------------- Camera evaluation

/** Swift CameraSceneEvaluation（L123-130）。 */
export interface CameraSceneEvaluation {
  rect: CompositionRect
  cornerRadius: number
  borderWidth: number
  zoomScale: number
  opacity: number
  fullscreenProgress: number
}

/** Swift CompositionSceneEvaluation（L132-135）。 */
export interface CompositionSceneEvaluation {
  screen: ScreenSceneEvaluation
  camera: CameraSceneEvaluation | null
}

// ---------------------------------------------------------------- 求值选项

/**
 * Swift CompositionSceneEvaluator.evaluate 的参数表（L160-174）。
 * Swift 用默认参数；TS 用选项对象（全部可选，除 project/time/画布/源宽高比）。
 */
export interface CompositionSceneOptions {
  project: RecorderProject
  time: TimeInterval
  canvasWidth: number
  canvasHeight: number
  sourceAspectRatio: number
  cameraAspectRatio?: number | null
  styleScale?: number
  automaticZoomFocus?: NormalizedPoint | null
  inheritedAutomaticZoomFocus?: NormalizedPoint | null
  reanchorAutomaticEntry?: boolean
  zoomTrack?: ZoomAnimationTrack | null
  screenMotionTrack?: ScreenMotionTrack | null
  cameraMotionTrack?: CameraMotionTrack | null
}

// ---------------------------------------------------------------- motion 轨道缓存

/**
 * Swift MotionTrackCacheStore（L473-501）：排序轨道的精确匹配缓存。
 * JS 单线程无需 NSLock；≤4 条目的有界线性扫描远比为每个 motion-blur
 * 样本重排轨道便宜。
 */
class MotionTrackCacheStore {
  private screenEntries: Array<{ key: string; track: ScreenMotionTrack }> = []
  private cameraEntries: Array<{ key: string; track: CameraMotionTrack }> = []

  private static serialize(clips: unknown[]): string {
    return JSON.stringify(clips)
  }

  screenTrack(clips: ScreenMotionClip[]): ScreenMotionTrack {
    const key = MotionTrackCacheStore.serialize(clips)
    const hit = this.screenEntries.find((entry) => entry.key === key)
    if (hit) return hit.track
    const track = new ScreenMotionTrack(clips)
    this.screenEntries.unshift({ key, track })
    if (this.screenEntries.length > 4) this.screenEntries.pop()
    return track
  }

  cameraTrack(clips: CameraMotionClip[]): CameraMotionTrack {
    const key = MotionTrackCacheStore.serialize(clips)
    const hit = this.cameraEntries.find((entry) => entry.key === key)
    if (hit) return hit.track
    const track = new CameraMotionTrack(clips)
    this.cameraEntries.unshift({ key, track })
    if (this.cameraEntries.length > 4) this.cameraEntries.pop()
    return track
  }
}

const motionTrackCache = new MotionTrackCacheStore()

// ---------------------------------------------------------------- Evaluator

/**
 * 视觉测量以 1080 像素短边为基准创作（L146-151）。用输出短边缩放它们，
 * padding/圆角/边框/模糊/阴影在 1080p、4K 和任意预览尺寸下构图一致。
 */
export function canonicalStyleScale(canvasWidth: number, canvasHeight: number): number {
  return Math.max(Math.min(canvasWidth, canvasHeight), 1) / 1080
}

/** Swift CompositionSceneEvaluator.evaluate(project:time:...)（L160-359）。 */
export function compositionSceneEvaluate(options: CompositionSceneOptions): CompositionSceneEvaluation {
  const {
    project,
    time,
    sourceAspectRatio,
    cameraAspectRatio = null,
    styleScale = 1,
    automaticZoomFocus = null,
    inheritedAutomaticZoomFocus = null,
    reanchorAutomaticEntry = false,
    zoomTrack = null,
    screenMotionTrack = null,
    cameraMotionTrack = null,
  } = options
  const width = Math.max(options.canvasWidth, 2)
  const height = Math.max(options.canvasHeight, 2)
  const scale = Math.max(styleScale, 0.000_1)
  const crop: NormalizedCrop = clampedCrop(project.canvas.crop)
  // ZoomAnimation.NormalizedCrop 自带 clamped() 方法；此处 crop 已经是
  // clampedCrop 的产物，提供一个自引用的 clamped 兜底即可。
  const zoomCrop = { ...crop, clamped: () => zoomCrop }
  const croppedAspect = Math.max((sourceAspectRatio * crop.width) / crop.height, 0.01)
  const maximumPadding = Math.min(width, height) * 0.42
  const padding = Math.min(Math.max(project.canvas.padding * scale, 0), maximumPadding)
  const availableWidth = Math.max(width - padding * 2, 2)
  const availableHeight = Math.max(height - padding * 2, 2)
  const fittedSize = aspectFit(croppedAspect, availableWidth, availableHeight)
  const fittedRect: CompositionRect = {
    x: (width - fittedSize.width) / 2,
    y: (height - fittedSize.height) / 2,
    width: fittedSize.width,
    height: fittedSize.height,
  }

  const sampleTime = Number.isFinite(time) ? Math.max(time, 0) : 0
  const baseScreenMotion: ScreenMotionState = {
    position: project.canvas.contentPosition,
    scale: project.canvas.contentScale,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    perspective: 0,
  }
  const borderWidthAtScaleOne = Math.min(Math.max(project.canvas.borderWidth, 0), 60) * scale
  const decorationInsets = decorationInsetsAtScaleOne(
    project.canvas.screenFrame,
    project.canvas.screenFrameScale,
    project.canvas.screenFrameToolbarScale,
    fittedRect.width,
    fittedRect.height,
    scale
  )
  const resolvedScreenMotionTrack =
    screenMotionTrack ?? motionTrackCache.screenTrack(project.timeline.screenMotionClips)
  const anchorViewport: ScreenAnchorViewport = {
    canvasWidth: width,
    canvasHeight: height,
    fittedWidth: fittedRect.width,
    fittedHeight: fittedRect.height,
    borderWidthAtScaleOne,
    decorationTopAtScaleOne: decorationInsets.top,
    decorationRightAtScaleOne: decorationInsets.right,
    decorationBottomAtScaleOne: decorationInsets.bottom,
    decorationLeftAtScaleOne: decorationInsets.left,
  }
  const screenMotionSample: ScreenMotionSample = resolvedScreenMotionTrack.sampleLayout(
    sampleTime,
    baseScreenMotion,
    project.motion,
    anchorViewport
  )
  const screenMotion = screenMotionSample.state
  const manualScale = Math.min(Math.max(screenMotion.scale, 0.2), 4)
  // 采样值不做 0...1 钳制：rect 线性过渡的中间态 pos 可能超出
  // （偏移公式对任意实数 pos 成立；持久化目标值已在入库校验 0...1）。
  const positionX = Number.isFinite(screenMotion.position.x) ? screenMotion.position.x : 0.5
  const positionY = Number.isFinite(screenMotion.position.y) ? screenMotion.position.y : 0.5
  const scaledWidth = fittedRect.width * manualScale
  const scaledHeight = fittedRect.height * manualScale
  const baseBorderWidth = borderWidthAtScaleOne * manualScale
  // MOT-001：定位完整创作的屏幕卡片，包括外边框。此前 position 0/1 把
  // 内容边缘对齐画布边缘，把整个外边框放到画布之外；3D 过渡落到边缘
  // 时看起来像切换了渲染路径并删掉了边框。居中对齐不变；边缘对齐现在
  // 把近侧边框留在画布内。
  const decoratedWidth = scaledWidth + baseBorderWidth * 2
  const decoratedHeight = scaledHeight + baseBorderWidth * 2
  const offsetX =
    screenMotionSample.manualOffset?.x ?? (positionX - 0.5) * (width - decoratedWidth)
  const offsetY =
    screenMotionSample.manualOffset?.y ?? (positionY - 0.5) * (height - decoratedHeight)
  const baseRect: CompositionRect = {
    x: rectMidX(fittedRect) - (fittedRect.width * manualScale) / 2 + offsetX,
    y: rectMidY(fittedRect) - (fittedRect.height * manualScale) / 2 + offsetY,
    width: fittedRect.width * manualScale,
    height: fittedRect.height * manualScale,
  }

  const zoom = zoomTrack
    ? trackSample(
        zoomTrack,
        sampleTime,
        project.motion,
        automaticZoomFocus,
        inheritedAutomaticZoomFocus,
        reanchorAutomaticEntry
      )
    : zoomSampleForAnimations(
        project.timeline.zoomClips,
        sampleTime,
        project.motion,
        automaticZoomFocus,
        inheritedAutomaticZoomFocus,
        reanchorAutomaticEntry
      )
  // 已覆盖画布的屏幕在该视口内缩放。仅凭 padding 无法选定这条规则：
  // aspect-fit 仍可能留缝，而手动放大的屏幕可以覆盖带 padding 的画布。
  // 创作的屏幕卡片 motion 与边框装饰保持各自的取景（L273-276）。
  const coverageTolerance = Math.max(width, height) * 0.000_000_001
  const keepsCanvasCovered =
    project.canvas.screenFrame === 'none' &&
    resolvedScreenMotionTrack.activeClipAt(sampleTime) === null &&
    baseRect.x <= coverageTolerance &&
    baseRect.y <= coverageTolerance &&
    baseRect.x + baseRect.width >= width - coverageTolerance &&
    baseRect.y + baseRect.height >= height - coverageTolerance
  const visibleRect: CompositionRect | null = keepsCanvasCovered
    ? {
        x: -baseRect.x / baseRect.width,
        y: -baseRect.y / baseRect.height,
        width: width / baseRect.width,
        height: height / baseRect.height,
      }
    : null
  const viewport = makeViewportTransform(zoom, zoomCrop, visibleRect)
  // 摆放使完整卡片居中。放大时保持同一中心：非对称装饰（如浏览器工具栏）
  // 不得从已居中的内容矩形外扩。源空间焦点仍提供创作的视口移动（L293-296）。
  const decorationGrowth = (manualScale * (viewport.scale - 1)) / 2
  const finalRect: CompositionRect = {
    x:
      rectMidX(baseRect) -
      (baseRect.width * viewport.scale) / 2 +
      viewport.translation.x * baseRect.width +
      (decorationInsets.left - decorationInsets.right) * decorationGrowth,
    y:
      rectMidY(baseRect) -
      (baseRect.height * viewport.scale) / 2 +
      viewport.translation.y * baseRect.height +
      (decorationInsets.top - decorationInsets.bottom) * decorationGrowth,
    width: baseRect.width * viewport.scale,
    height: baseRect.height * viewport.scale,
  }
  const screen: ScreenSceneEvaluation = {
    fittedRect,
    baseRect,
    finalRect,
    manualScale,
    manualOffset: { x: offsetX, y: offsetY },
    rotationX: Math.min(Math.max(screenMotion.rotationX, -89), 89),
    rotationY: Math.min(Math.max(screenMotion.rotationY, -89), 89),
    rotationZ: screenMotion.rotationZ,
    perspective: Math.min(Math.max(screenMotion.perspective, 0), 2),
    projectionAnchor: screenMotionSample.projectionAnchor,
    baseCornerRadius: Math.max(project.canvas.cornerRadius, 0) * scale * manualScale,
    baseBorderWidth,
    // 全画布内容没有内嵌卡片镂空。工程保留创作的圆角，布局有边距时恢复。
    finalCornerRadius: keepsCanvasCovered
      ? 0
      : Math.max(project.canvas.cornerRadius, 0) * scale * manualScale * viewport.scale,
    finalBorderWidth: baseBorderWidth * viewport.scale,
    zoom,
    viewport,
  }

  const camera =
    cameraAspectRatio !== null && cameraAspectRatio !== undefined
      ? evaluateCameraWithTrack(
          project.camera,
          project.camera.shape,
          project.camera.position,
          project.camera.size,
          project.camera.roundness,
          cameraMotionTrack ??
            motionTrackCache.cameraTrack(project.timeline.cameraMotionClips ?? []),
          cameraAspectRatio,
          zoom.scale,
          width,
          height,
          scale,
          project.motion
        )
      : null
  return { screen, camera }
}

/** L332-357 内联的相机求值路径（带轨道采样）。 */
function evaluateCameraWithTrack(
  style: CameraStyle,
  shape: CameraStyle['shape'],
  position: NormalizedPoint,
  size: number,
  roundness: number,
  track: CameraMotionTrack,
  cameraAspectRatio: number,
  screenZoomScale: number,
  canvasWidth: number,
  canvasHeight: number,
  styleScale: number,
  motion: MotionStyle
): CameraSceneEvaluation {
  const baseCameraMotion: CameraMotionState = {
    layout: { kind: 'shape', shape },
    position,
    size,
    roundness,
    opacity: 1,
  }
  const cameraMotion = track.sample(
    0,
    baseCameraMotion,
    cameraAspectRatio,
    Math.max(canvasWidth, 2) / Math.max(canvasHeight, 2),
    motion
  )
  return evaluateCamera(style, cameraMotion, screenZoomScale, canvasWidth, canvasHeight, styleScale)
}

/** Swift evaluateCamera(style:cameraAspectRatio:...)（L361-390）。 */
export function evaluateCameraStatic(
  style: CameraStyle,
  cameraAspectRatio: number,
  screenZoomScale: number,
  canvasWidth: number,
  canvasHeight: number,
  styleScale = 1
): CameraSceneEvaluation {
  const base: CameraMotionState = {
    layout: { kind: 'shape', shape: style.shape },
    position: style.position,
    size: style.size,
    roundness: style.roundness,
    opacity: 1,
  }
  const sample = new CameraMotionTrack([]).sample(
    0,
    base,
    cameraAspectRatio,
    Math.max(canvasWidth, 2) / Math.max(canvasHeight, 2)
  )
  return evaluateCamera(style, sample, screenZoomScale, canvasWidth, canvasHeight, styleScale)
}

/**
 * L395-450：把连续的相机 motion 样本解析为最终画布几何。形状变化与
 * 全屏过渡因此在预览与导出中使用同一 rect/圆角/边框/不透明度契约。
 */
export function evaluateCamera(
  style: CameraStyle,
  motion: CameraMotionSample,
  screenZoomScale: number,
  canvasWidth: number,
  canvasHeight: number,
  styleScale = 1
): CameraSceneEvaluation {
  const width = Math.max(canvasWidth, 2)
  const height = Math.max(canvasHeight, 2)
  const base = Math.min(width, height)
  const zoomProgress = Math.min(Math.max((screenZoomScale - 1) / 0.565, 0), 1)
  const zoomScale = 1 + (style.scaleDuringZoom - 1) * zoomProgress
  const preferredCameraHeight = Math.min(
    Math.max(base * motion.size * zoomScale, 72 * Math.max(styleScale, 0.000_1)),
    // 大目标可以到角：上限放宽到画布的 1.2 倍（此前 0.8 会把
    // "大目标+角落"裁掉，两边的屏幕始终露出来）。
    base * 1.2
  )
  const preferredCameraWidth = preferredCameraHeight * Math.max(motion.aspectRatio, 0.01)
  const fitScale = Math.min(
    1,
    (width * 1.2) / Math.max(preferredCameraWidth, 0.000_1),
    (height * 1.2) / Math.max(preferredCameraHeight, 0.000_1)
  )
  const cameraWidth = preferredCameraWidth * fitScale
  const cameraHeight = preferredCameraHeight * fitScale
  const positionX = Math.min(Math.max(motion.position.x, 0), 1)
  const positionY = Math.min(Math.max(motion.position.y, 0), 1)
  // 超出画布的相机允许贴着两侧停靠（x 可为负），大目标才能真正覆盖角落。
  const shapedRect: CompositionRect = {
    x: positionX * (width - cameraWidth),
    y: positionY * (height - cameraHeight),
    width: cameraWidth,
    height: cameraHeight,
  }
  const fullscreenProgress = Math.min(Math.max(motion.fullscreenProgress, 0), 1)
  const rect: CompositionRect = {
    x: mix(shapedRect.x, 0, fullscreenProgress),
    y: mix(shapedRect.y, 0, fullscreenProgress),
    width: mix(shapedRect.width, width, fullscreenProgress),
    height: mix(shapedRect.height, height, fullscreenProgress),
  }
  const radius =
    Math.min(rect.width, rect.height) * Math.min(Math.max(motion.cornerFraction, 0), 0.5)
  return {
    rect,
    cornerRadius: radius,
    borderWidth:
      Math.min(Math.max(style.borderWidth, 0), 18) *
      Math.max(styleScale, 0.000_1) *
      (1 - fullscreenProgress),
    zoomScale,
    opacity: Math.min(Math.max(motion.opacity, 0), 1),
    fullscreenProgress,
  }
}

function mix(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

/** L456-466。 */
function aspectFit(
  aspectRatio: number,
  width: number,
  height: number
): { width: number; height: number } {
  const safeAspect = Math.max(aspectRatio, 0.01)
  if (width / Math.max(height, 1) > safeAspect) {
    return { width: height * safeAspect, height }
  }
  return { width, height: width / safeAspect }
}

// CanvasStyle 仅用于类型引用兜底（project.canvas 已在 evaluate 内直接消费）
export type { CanvasStyle }
