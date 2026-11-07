/**
 * FrameScene —— 一帧画面的完整不可变解释（预览与导出共用同一份契约）。
 *
 * Swift source: Sources/RecorderCore/FrameScene.swift @ laogou717/dogsc 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct CompositionSize                      L4-14   → CompositionSize
 *   - enum FrameColorSpace / FrameColorContract   L18-43  → FrameColorSpace / FrameColorContract
 *   - struct FrameShadow                          L45-63  → FrameShadow
 *   - struct FrameBackgroundScene                 L65-83  → FrameBackgroundScene
 *   - enum FrameScreenChromeKind                  L85-108 → FrameScreenChromeKind
 *   - struct FrameScreenChromeScene               L113-157→ FrameScreenChromeScene
 *   - enum FrameScreenDecoration                  L161-171→ FrameScreenDecoration
 *   - struct FrameMosaicScene                     L173-203→ FrameMosaicScene
 *   - struct FrameScreenScene                     L205-256→ FrameScreenScene
 *   - struct FrameCameraScene                     L258-287→ FrameCameraScene
 *   - enum FrameCursorAttachment                  L289-293→ FrameCursorAttachment
 *   - struct FrameCursorScene                     L295-346→ FrameCursorScene
 *   - struct FrameStickerScene                    L348-372→ FrameStickerScene
 *   - enum FrameLayerRole                         L374-381→ FrameLayerRole
 *   - struct FrameScene                           L385-420→ FrameScene
 *   - struct FrameRenderPlan                      L423-440→ FrameRenderPlan
 *   - enum FrameSceneEvaluator                    L444-1284→ FrameSceneEvaluator
 *
 * 契约：渲染器只能读「媒体帧句柄 + 本值」，绝不直接读 RecorderProject；
 * 装饰、打码、光标、贴图全部在这里求值完毕，渲染后端不自行挑选视觉预设。
 * 坐标使用左上原点。
 */

import type { NormalizedPoint, TimeInterval, ZoomAnimationClip, ZoomAnimationTrack } from './ZoomAnimation'
import {
  ZOOM_VIEWPORT,
  activeClipAt,
  adjacentPreviousClip,
  constrainPoint,
  makeTrack,
  trackBounded,
} from './ZoomAnimation'
import type { CompositionPoint, CompositionRect } from './CompositionGeometry'
import { rectMidX, rectMidY } from './CompositionGeometry'
import { projectScreen, type ProjectedScreenQuad } from './ScreenProjection'
import { HexColor } from './HexColor'
import {
  CURSOR_ASSET_AUTOMATIC,
  CURSOR_ASSET_SYSTEM_ARROW,
  OPENING_MINIMUM_ELEMENT_DURATION,
  clampedCrop,
  type NormalizedCrop,
  maximumOpeningStagger,
  participatingOpeningElements,
  type BackgroundSource,
  type OpeningSequence,
  type OpeningSequenceElement,
  type ScreenFrameStyle,
} from './ProjectModel'
import { canonicalStyleScale, compositionSceneEvaluate, decorationInsetsAtScaleOne } from './CompositionScene'
import type { ScreenSceneEvaluation, CameraSceneEvaluation } from './CompositionScene'
import { elementMotionProgress } from './ElementMotion'
import { ScreenMotionTrack } from './ScreenMotion'
import type { CameraMotionTrack } from './CameraMotion'
import type { PointerSample, PointerTrackEvaluation } from './PointerTrack'
import type { ProjectPointerTrack } from './ProjectPointerTrack'
import { cursorRenderLayout, type CursorAssetMetrics, type CursorRenderLayout } from './CursorRenderGeometry'
import { focusEffectScene, type FrameFocusScene } from './FocusEffect'
import { FrameStickerBackdropScene, StickerTransitionTrack } from './StickerTransition'
import type { StickerAnimationPreset, NormalizedOverlayRect } from './OverlayTimeline'
import { clampedOverlayRect, overlayContains } from './OverlayTimeline'
import type { MosaicEffectStyle, MosaicTransitionStyle, OverlayTiming } from './OverlayTimeline'
import { cameraContentFillLayout, type CameraContentFillLayout } from './CameraContentFill'
import { screenFrameDefaultContentRadius, screenFrameDefaultOuterRadius } from './ScreenFrameDefaults'
import type { RecorderProject } from './ProjectMediaModel'
import type { TimelineMediaPlan } from './TimelineMediaPlan'
import type { MotionStyle } from './MotionStyle'

// ---------------------------------------------------------------- 尺寸与色彩

/** Swift CompositionSize（L4-14）。 */
export interface CompositionSize {
  width: number
  height: number
}

export function compositionSize(width: number, height: number): CompositionSize {
  return { width, height }
}

/** Swift CompositionSize.shortEdge。 */
export function compositionSizeShortEdge(size: CompositionSize): number {
  return Math.min(size.width, size.height)
}

/** Swift FrameColorSpace（L18-21）。 */
export type FrameColorSpace = 'linearSRGB' | 'sRGB'

/**
 * Swift FrameColorContract（L23-43）。每个预览/导出帧都显式声明色彩意图：
 * 后端 API 可以不同，但不许自行选择依赖设备的缺省值。
 */
export interface FrameColorContract {
  workingSpace: FrameColorSpace
  outputSpace: FrameColorSpace
  isHDR: boolean
}

/**
 * 桌面 SDR 由 ScreenCaptureKit 显式 sRGB 转换采集。Rec.709 与 sRGB 共享
 * 基色但不共享传输曲线，因此传输意图不能塌缩成 "Rec.709" 再由元数据修改。
 */
export const FRAME_COLOR_SDR_DESKTOP: FrameColorContract = {
  workingSpace: 'linearSRGB',
  outputSpace: 'sRGB',
  isHDR: false,
}

// ---------------------------------------------------------------- 阴影/背景

/** Swift FrameShadow（L45-63）。offset 为左上原点画布坐标，正 Y 向下。 */
export interface FrameShadow {
  color: HexColor
  opacity: number
  radius: number
  offset: CompositionPoint
}

export function makeFrameShadow(init: {
  opacity: number
  radius: number
  offset: CompositionPoint
  color?: HexColor
}): FrameShadow {
  return {
    color: init.color ?? HexColor.black,
    opacity: Math.min(Math.max(init.opacity, 0), 1),
    radius: Math.max(init.radius, 0),
    offset: init.offset,
  }
}

/** Swift FrameBackgroundScene（L65-83）。blurRadius 以输出画布像素为单位。 */
export interface FrameBackgroundScene {
  source: BackgroundSource
  blurRadius: number
  patternScale: number
  patternOpacity: number
}

export function makeFrameBackgroundScene(init: {
  source: BackgroundSource
  blurRadius: number
  patternScale?: number
  patternOpacity?: number
}): FrameBackgroundScene {
  return {
    source: init.source,
    blurRadius: Math.max(init.blurRadius, 0),
    patternScale: Math.max(init.patternScale ?? 1, 0.1),
    patternOpacity: Math.min(Math.max(init.patternOpacity ?? 1, 0), 1),
  }
}

// ---------------------------------------------------------------- 屏幕框装饰

/** Swift FrameScreenChromeKind（L85-108）。 */
export type FrameScreenChromeKind =
  | 'window'
  | 'browser'
  | 'devicePhonePortrait'
  | 'devicePhoneLandscape'
  | 'deviceTabletPortrait'
  | 'deviceTabletLandscape'

export function chromeKindIsDevice(kind: FrameScreenChromeKind): boolean {
  return kind !== 'window' && kind !== 'browser'
}

export function chromeKindIsPhone(kind: FrameScreenChromeKind): boolean {
  return kind === 'devicePhonePortrait' || kind === 'devicePhoneLandscape'
}

export function chromeKindIsPortrait(kind: FrameScreenChromeKind): boolean {
  return kind === 'devicePhonePortrait' || kind === 'deviceTabletPortrait'
}

/**
 * Swift FrameScreenChromeScene（L113-157）：完全求值后的矢量装饰。
 * 几何与屏幕共用同一套左上原点坐标，因此单一渲染器可以在对屏幕做 3D
 * 投影之前先把它画出来。
 */
export interface FrameScreenChromeScene {
  kind: FrameScreenChromeKind
  outerRect: CompositionRect
  toolbarRect: CompositionRect
  contentRect: CompositionRect
  outerCornerRadius: number
  contentCornerRadius: number
  surfaceColor: HexColor
  toolbarColor: HexColor
  separatorColor: HexColor
  fieldColor: HexColor
  glyphColor: HexColor
  title: string
  browserAddress: string
}

/** Swift FrameScreenDecoration（L161-171）。 */
export type FrameScreenDecoration =
  | { readonly type: 'none' }
  | { readonly type: 'chrome'; readonly chrome: FrameScreenChromeScene }

export const FRAME_SCREEN_DECORATION_NONE: FrameScreenDecoration = { type: 'none' }

export function frameScreenDecorationProjectionRect(
  decoration: FrameScreenDecoration
): CompositionRect | null {
  return decoration.type === 'chrome' ? decoration.chrome.outerRect : null
}

// ---------------------------------------------------------------- 打码

/** Swift FrameMosaicScene（L173-203）。 */
export interface FrameMosaicScene {
  sourceRect: NormalizedOverlayRect
  cornerRadius: number
  style: MosaicEffectStyle
  intensity: number
  spotlightDimming: number
  /** 区间两端共用的缓动可见度（模糊或聚焦压暗）。 */
  transitionProgress: number
}

export function makeFrameMosaicScene(init: {
  sourceRect: NormalizedOverlayRect
  cornerRadius: number
  style: MosaicEffectStyle
  intensity: number
  spotlightDimming?: number
  transitionProgress?: number
}): FrameMosaicScene {
  const finiteOr = (value: number, fallback: number): number =>
    Number.isFinite(value) ? value : fallback
  return {
    sourceRect: clampedOverlayRect(init.sourceRect),
    cornerRadius: Math.min(Math.max(finiteOr(init.cornerRadius, 0), 0), 0.5),
    style: init.style,
    intensity: Math.min(Math.max(finiteOr(init.intensity, 0.5), 0), 1),
    spotlightDimming: Math.min(Math.max(finiteOr(init.spotlightDimming ?? 0.22, 0.22), 0), 0.75),
    transitionProgress: Math.min(Math.max(finiteOr(init.transitionProgress ?? 1, 1), 0), 1),
  }
}

// ---------------------------------------------------------------- 屏幕层

/** Swift FrameScreenScene（L205-256）。 */
export interface FrameScreenScene {
  sourceCrop: NormalizedCrop
  fittedRect: CompositionRect
  baseRect: CompositionRect
  finalRect: CompositionRect
  projectedQuad: ProjectedScreenQuad
  cornerRadius: number
  borderWidth: number
  borderColor: HexColor
  borderOpacity: number
  shadow: FrameShadow | null
  decoration: FrameScreenDecoration
  mosaics: FrameMosaicScene[]
  focusEffect: FrameFocusScene | null
  opacity: number
}

/** Swift projectionRect 计算属性（L221-223）。 */
export function frameScreenProjectionRect(screen: FrameScreenScene): CompositionRect {
  return frameScreenDecorationProjectionRect(screen.decoration) ?? screen.finalRect
}

// ---------------------------------------------------------------- 相机层

/** Swift FrameCameraScene（L258-287）。 */
export interface FrameCameraScene {
  rect: CompositionRect
  contentFill: CameraContentFillLayout | null
  cornerRadius: number
  borderWidth: number
  borderColor: HexColor
  shadow: FrameShadow | null
  opacity: number
  isMirrored: boolean
}

// ---------------------------------------------------------------- 光标层

/**
 * Swift FrameCursorAttachment（L289-293）：光标以录屏坐标系创作，必须与
 * 该装饰层一起变换（含未来的 3D 运动）。
 */
export type FrameCursorAttachment = 'screen'

/** Swift FrameCursorScene（L295-346）。 */
export interface FrameCursorScene {
  assetID: string
  metrics: CursorAssetMetrics
  /** 投影前、已裁剪屏幕内的位置。 */
  normalizedScreenPosition: NormalizedPoint
  /** 标准 2D 布局；后端把光标贴到投影屏幕纹理时也用它取局部尺寸/热点。 */
  layout: CursorRenderLayout
  isClicking: boolean
  clickPhase: PointerSample['clickPhase']
  clickStyle: import('./ProjectModel').CursorClickEffectStyle
  clickColor: HexColor | null
  clickOpacity: number
  clickScale: number
  rotationRadians: number
  shadow: FrameShadow | null
  attachment: FrameCursorAttachment
}

/** Swift effectiveClickColor（L313-315）。 */
export function frameCursorEffectiveClickColor(scene: FrameCursorScene): HexColor {
  return scene.clickColor ?? scene.metrics.clickColor
}

// ---------------------------------------------------------------- 贴图层

/** Swift FrameStickerScene（L348-372）。 */
export interface FrameStickerScene {
  id: string
  relativePath: string
  position: NormalizedPoint
  width: number
  rotationRadians: number
  opacity: number
  scale: number
  offset: NormalizedPoint
  cornerRadius: number
  borderWidth: number
  borderColor: HexColor
  shadowOpacity: number
  shadowRadius: number
  shadowOffset: CompositionPoint
  backdropBlur: number
  backdropBlurIncludesCamera: boolean
  hidesScreen: boolean
  hidesCamera: boolean
  /**
   * 用户创作的贴图不透明度生效之前的出入场可见度。合体的背景处理单独
   * 放在 frame backdrop 里，这样两张半可见的图不会露出录制画面。
   */
  transitionProgress: number
  layerIndex: number
}

/** Swift FrameLayerRole（L374-381）。 */
export type FrameLayerRole = 'background' | 'screen' | 'cursor' | 'spotlight' | 'camera' | 'stickers'

// ---------------------------------------------------------------- 场景

/** Swift FrameScene（L385-420）。 */
export interface FrameScene {
  time: TimeInterval
  canvasSize: CompositionSize
  color: FrameColorContract
  background: FrameBackgroundScene
  screen: FrameScreenScene
  camera: FrameCameraScene | null
  cursor: FrameCursorScene | null
  stickers: FrameStickerScene[]
  stickerBackdrop: FrameStickerBackdropScene
  layerOrder: FrameLayerRole[]
}

/** Swift FrameRenderPlan（L423-440）：一次输出帧请求。 */
export interface FrameRenderPlan {
  presentationTime: TimeInterval
  outputDuration: TimeInterval
  frameRate: number
  scene: FrameScene
}

// ---------------------------------------------------------------- 私有小工具

const clampUnit = (value: number): number => Math.min(Math.max(value, 0), 1)

/** Swift smootherStep（L1080-1083）：五次平滑。 */
export function smootherStep(value: number): number {
  const x = clampUnit(value)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

/** Swift overlayEffectProgress（L1089-1119）。 */
export function overlayEffectProgress(
  timing: OverlayTiming,
  style: MosaicTransitionStyle,
  enterDuration: TimeInterval,
  exitDuration: TimeInterval,
  time: TimeInterval
): number {
  if (!(timing.duration > 0)) return 0
  if (style === 'none') return 1
  const elapsed = Math.max(time - timing.startTime, 0)
  const remaining = Math.max(timing.startTime + timing.duration - time, 0)
  const linearEnter = enterDuration > 0 ? Math.min(Math.max(elapsed / enterDuration, 0), 1) : 1
  const linearExit = exitDuration > 0 ? Math.min(Math.max(remaining / exitDuration, 0), 1) : 1
  let enter: number
  let exit: number
  switch (style) {
    case 'linear':
      enter = linearEnter
      exit = linearExit
      break
    case 'smooth':
      enter = smootherStep(linearEnter)
      exit = smootherStep(linearExit)
      break
    default:
      return 1
  }
  return Math.min(enter, exit)
}

/** Swift stickerAnimationTransform（L882-932）。 */
export function stickerAnimationTransform(
  preset: StickerAnimationPreset,
  progress: number,
  position: NormalizedPoint,
  width: number
): { scale: number; offset: NormalizedPoint } {
  const p = clampUnit(progress)
  const travel = 1 - p
  // 普通贴图保留历史「大幅出画」行程；用户把卡片做得异常宽时再延长，
  // 保证 progress 为零时任何边缘都不露。
  const halfExtent = Math.max(width, 0.02) / 2
  const outsideLeading = Math.min(-0.85, -halfExtent - 0.06)
  const outsideTrailing = Math.max(1.85, 1 + halfExtent + 0.06)
  const left = outsideLeading - position.x
  const right = outsideTrailing - position.x
  const top = outsideLeading - position.y
  const bottom = outsideTrailing - position.y
  const offset: NormalizedPoint = { x: 0, y: 0 }
  let scale = 1.0
  switch (preset) {
    case 'none':
    case 'fade':
      break
    case 'pop':
      // 目标原地不动，卡片从更小尺度加速出现；smootherStep 避免旧的线性
      // 观感，并让末帧精确停在 1×。
      scale = 0.72 + p * 0.28
      break
    case 'slideLeft':
      offset.x = left * travel
      break
    case 'slideRight':
      offset.x = right * travel
      break
    case 'slideUp':
      offset.y = top * travel
      break
    case 'slideDown':
      offset.y = bottom * travel
      break
    case 'slideTopLeft':
      offset.x = left * travel
      offset.y = top * travel
      break
    case 'slideTopRight':
      offset.x = right * travel
      offset.y = top * travel
      break
    case 'slideBottomLeft':
      offset.x = left * travel
      offset.y = bottom * travel
      break
    case 'slideBottomRight':
      offset.x = right * travel
      offset.y = bottom * travel
      break
  }
  return { scale, offset }
}

/** Swift FrameSceneEvaluator.OpeningSample（L934-952）。 */
interface OpeningSample {
  opacity: number
  scale: number
  offset: CompositionPoint
  rotationX: number
  rotationY: number
  perspective: number
  remaining: number
}

const OPENING_IDENTITY: OpeningSample = {
  opacity: 1,
  scale: 1,
  offset: { x: 0, y: 0 },
  rotationX: 0,
  rotationY: 0,
  perspective: 0,
  remaining: 0,
}

/** Swift openingSample(for:sequence:activeElements:at:canvasWidth:canvasHeight:)（L954-1064）。 */
export function openingSample(
  element: OpeningSequenceElement,
  sequence: OpeningSequence,
  activeElements: readonly OpeningSequenceElement[],
  time: TimeInterval,
  canvasWidth: number,
  canvasHeight: number
): OpeningSample {
  const index = activeElements.indexOf(element)
  if (!sequence.isEnabled || !(time < sequence.duration) || index < 0) return OPENING_IDENTITY
  const effectiveStagger = Math.min(
    sequence.stagger,
    maximumOpeningStagger(sequence, activeElements.length)
  )
  const lastDelay = effectiveStagger * Math.max(activeElements.length - 1, 0)
  const itemDuration = Math.max(
    sequence.duration - lastDelay,
    OPENING_MINIMUM_ELEMENT_DURATION
  )
  const start = effectiveStagger * index
  const linear = Math.min(Math.max((time - start) / itemDuration, 0), 1)
  const eased = elementMotionProgress(linear, sequence.motionCurve)
  const opacity = elementMotionProgress(Math.min(linear * 1.65, 1), sequence.motionCurve)
  const remaining = 1 - eased
  // 位移收敛得足够快以显得跟手，而 3D 姿态需要在卡片入画后仍可见：
  // 原先共用的四次衰减会让第一个可用帧之前倾斜就几乎归零。
  const rotationRemaining = Math.pow(1 - linear, 1.5)
  const overshoot = 1 + 1.35 * Math.pow(linear - 1, 3) + 0.35 * Math.pow(linear - 1, 2)
  let scaleStart: number
  let initialOffset: CompositionPoint
  let rotationX = 0
  let rotationY = 0
  let perspective = 0
  switch (`${sequence.preset}|${element}`) {
    case '聚拢|屏幕':
      scaleStart = 0.72
      initialOffset = { x: -canvasWidth * 1.05, y: -canvasHeight * 0.62 }
      break
    case '聚拢|摄像头':
      scaleStart = 0.58
      initialOffset = { x: canvasWidth * 1.12, y: canvasHeight * 0.72 }
      break
    case '聚拢|贴图':
      scaleStart = 0.62
      initialOffset = { x: -canvasWidth * 1.3, y: -canvasHeight * 0.7 }
      break
    case '侧滑|屏幕':
      scaleStart = 0.94
      initialOffset = { x: -canvasWidth * 1.12, y: 0 }
      break
    case '侧滑|摄像头':
      scaleStart = 0.88
      initialOffset = { x: canvasWidth * 1.15, y: 0 }
      break
    case '侧滑|贴图':
      scaleStart = 0.9
      initialOffset = { x: -canvasWidth * 1.35, y: 0 }
      break
    case '轻 3D|屏幕':
      scaleStart = 0.8
      initialOffset = { x: -canvasWidth * 1.05, y: canvasHeight * 0.08 }
      rotationX = 9 * rotationRemaining
      rotationY = -22 * rotationRemaining
      perspective = 0.72 * rotationRemaining
      break
    case '轻 3D|摄像头':
      scaleStart = 0.72
      initialOffset = { x: canvasWidth * 1.1, y: canvasHeight * 0.16 }
      break
    case '轻 3D|贴图':
      scaleStart = 0.76
      initialOffset = { x: -canvasWidth * 1.3, y: -canvasHeight * 0.12 }
      break
    default:
      scaleStart = 1
      initialOffset = { x: 0, y: 0 }
      break
  }
  const settledScale = Math.min(Math.max(overshoot, 0), 1.04)
  return {
    opacity,
    scale: scaleStart + (settledScale - scaleStart) * eased,
    offset: { x: initialOffset.x * remaining, y: initialOffset.y * remaining },
    rotationX,
    rotationY,
    perspective,
    remaining,
  }
}

/** Swift openingRect(_:sample:)（L1066-1078）。 */
export function openingRect(rect: CompositionRect, sample: OpeningSample): CompositionRect {
  const width = rect.width * sample.scale
  const height = rect.height * sample.scale
  return {
    x: rectMidX(rect) - width / 2 + sample.offset.x,
    y: rectMidY(rect) - height / 2 + sample.offset.y,
    width,
    height,
  }
}

/** 把 Swift 的 ScreenFrameStyle 映射成 chrome kind（L1173-1186）。 */
export function screenChromeKindFor(
  style: ScreenFrameStyle,
  finalRect: CompositionRect
): FrameScreenChromeKind {
  const landscape = finalRect.width >= finalRect.height
  switch (style) {
    case 'browserLight':
    case 'browserDark':
      return 'browser'
    case 'devicePhone':
      return landscape ? 'devicePhoneLandscape' : 'devicePhonePortrait'
    case 'deviceTablet':
      return landscape ? 'deviceTabletLandscape' : 'deviceTabletPortrait'
    case 'devicePhonePortrait':
      return 'devicePhonePortrait'
    case 'devicePhoneLandscape':
      return 'devicePhoneLandscape'
    case 'deviceTabletPortrait':
      return 'deviceTabletPortrait'
    case 'deviceTabletLandscape':
      return 'deviceTabletLandscape'
    default:
      return 'window'
  }
}

/** Swift screenDecoration(...)（L1121-1230）。 */
export function screenDecoration(options: {
  style: ScreenFrameStyle
  frameScale: number
  toolbarScale: number
  outerCornerRadius: number | null
  contentCornerRadius: number | null
  title: string
  browserAddress: string
  geometry: ScreenSceneEvaluation
  styleScale: number
  groupScale?: number
}): FrameScreenDecoration {
  const { style, geometry, styleScale } = options
  if (style === 'none') return FRAME_SCREEN_DECORATION_NONE
  const authoredFrameScale = Math.min(Math.max(options.frameScale, 0.6), 1.6)
  const groupScale = options.groupScale ?? 1
  const motionScale = Math.max(
    geometry.manualScale * geometry.viewport.scale * groupScale,
    0.000_1
  )
  const scale = Math.max(styleScale * motionScale * authoredFrameScale, 0.000_1)
  const authoredInsets = decorationInsetsAtScaleOne(
    style,
    options.frameScale,
    options.toolbarScale,
    geometry.fittedRect.width,
    geometry.fittedRect.height,
    styleScale
  )
  const topInset = authoredInsets.top * motionScale
  const rightInset = authoredInsets.right * motionScale
  const bottomInset = authoredInsets.bottom * motionScale
  const leftInset = authoredInsets.left * motionScale
  const outerRect: CompositionRect = {
    x: geometry.finalRect.x - leftInset,
    y: geometry.finalRect.y - topInset,
    width: geometry.finalRect.width + leftInset + rightInset,
    height: geometry.finalRect.height + topInset + bottomInset,
  }
  // 轻微重叠可填住源画面圆角上缘的缺口，同时保持内容矩形与裁剪计算不变。
  const toolbarRect: CompositionRect = {
    x: outerRect.x,
    y: outerRect.y,
    width: outerRect.width,
    height: topInset + Math.min(2 * scale, topInset * 0.08),
  }
  const isDark =
    style === 'windowDark' ||
    style === 'browserDark' ||
    style.startsWith('devicePhone') ||
    style.startsWith('deviceTablet')
  const kind = screenChromeKindFor(style, geometry.finalRect)
  const device = chromeKindIsDevice(kind)
  const authoredOuterRadius = Math.min(
    Math.max(
      options.outerCornerRadius ??
        (device
          ? (Math.min(outerRect.width, outerRect.height) *
              (chromeKindIsPhone(kind) ? 0.11 : 0.065)) /
            Math.max(scale, 0.0001)
          : screenFrameDefaultOuterRadius(style)),
      0
    ),
    160
  )
  const outerCornerRadius = Math.min(
    authoredOuterRadius * scale,
    Math.min(outerRect.width, outerRect.height) / 2
  )
  const authoredContentRadius = Math.min(
    Math.max(
      options.contentCornerRadius ??
        (device
          ? Math.max(outerCornerRadius - Math.min(topInset, leftInset), 0) / Math.max(scale, 0.0001)
          : screenFrameDefaultContentRadius(style)),
      0
    ),
    160
  )
  const contentCornerRadius = Math.min(
    authoredContentRadius * scale,
    Math.min(geometry.finalRect.width, geometry.finalRect.height) / 2
  )
  const chrome: FrameScreenChromeScene = {
    kind,
    outerRect,
    toolbarRect,
    contentRect: geometry.finalRect,
    outerCornerRadius,
    contentCornerRadius,
    surfaceColor: HexColor.fromRgb24(isDark ? 0x22_23_27 : 0xec_ed_f0),
    toolbarColor: HexColor.fromRgb24(isDark ? 0x31_32_38 : 0xf4_f4_f6),
    separatorColor: HexColor.fromRgb24(isDark ? 0x4b_4d_55 : 0xc9_ca_ce),
    fieldColor: HexColor.fromRgb24(isDark ? 0x1b_1c_20 : 0xff_ff_ff),
    glyphColor: HexColor.fromRgb24(isDark ? 0xa9_ab_b3 : 0x7a_7c_84),
    title: options.title.slice(0, 120),
    browserAddress: options.browserAddress.slice(0, 240),
  }
  return { type: 'chrome', chrome }
}

/** Swift stickerScenes(_:at:suppressesInitialEntry:)（L835-877）。 */
export function stickerScenes(
  track: StickerTransitionTrack,
  time: TimeInterval,
  suppressesInitialEntry = false
): { stickers: FrameStickerScene[]; backdrop: FrameStickerBackdropScene } {
  const sample = track.sample(time, suppressesInitialEntry)
  const stickers = sample.stickers.map((entry) => {
    const clip = entry.clip
    const visibility = entry.visibility
    const transform = stickerAnimationTransform(
      entry.preset,
      entry.progress,
      clip.position,
      clip.width
    )
    return {
      id: clip.id,
      relativePath: clip.relativePath,
      position: clip.position,
      width: Math.min(Math.max(clip.width, 0.02), 2),
      rotationRadians: (clip.rotationDegrees * Math.PI) / 180,
      opacity: Math.min(Math.max(clip.opacity, 0), 1) * visibility,
      scale: transform.scale,
      offset: transform.offset,
      cornerRadius: Math.max(clip.cornerRadius, 0),
      borderWidth: Math.max(clip.borderWidth, 0),
      borderColor: clip.borderColor,
      shadowOpacity: Math.min(Math.max(clip.shadowOpacity, 0), 1),
      shadowRadius: Math.max(clip.shadowRadius, 0),
      shadowOffset: { x: clip.shadowOffsetX, y: clip.shadowOffsetY },
      backdropBlur: Math.max(clip.backdropBlur, 0) * visibility,
      backdropBlurIncludesCamera: clip.backdropBlurIncludesCamera,
      hidesScreen: clip.hidesScreen,
      hidesCamera: clip.hidesCamera,
      transitionProgress: visibility,
      layerIndex: clip.layerIndex,
    } satisfies FrameStickerScene
  })
  return { stickers, backdrop: sample.backdrop }
}

/** Swift cursorScene(sample:project:metrics:metricsByAssetID:screen:canvasSize:)（L1232-1282）。 */
export function frameCursorScene(options: {
  sample: PointerSample | null
  project: RecorderProject
  metrics: CursorAssetMetrics | null
  metricsByAssetID: Record<string, CursorAssetMetrics>
  screen: FrameScreenScene
  canvasSize: CompositionSize
}): FrameCursorScene | null {
  const { sample, project, screen, canvasSize } = options
  if (!sample) return null
  const style = project.cursorStyle
  const assetID =
    style.assetID === CURSOR_ASSET_AUTOMATIC
      ? (sample.recordedCursorAssetID ?? CURSOR_ASSET_SYSTEM_ARROW)
      : style.assetID
  const metrics = options.metricsByAssetID[assetID] ?? options.metrics
  if (!metrics) return null
  const crop = clampedCrop(screen.sourceCrop)
  const local: NormalizedPoint = {
    x: (sample.location.x - crop.x) / crop.width,
    y: (sample.location.y - crop.y) / crop.height,
  }
  if (!(local.x >= 0 && local.x <= 1) || !(local.y >= 0 && local.y <= 1)) return null
  const point: CompositionPoint = {
    x: screen.finalRect.x + local.x * screen.finalRect.width,
    y: screen.finalRect.y + local.y * screen.finalRect.height,
  }
  const layout = cursorRenderLayout(
    point,
    compositionSizeShortEdge(canvasSize),
    style.size,
    metrics
  )
  if (!layout) return null
  return {
    assetID,
    metrics,
    normalizedScreenPosition: local,
    layout,
    isClicking: sample.isClicking,
    clickPhase: sample.clickPhase,
    clickStyle: style.clickEffectStyle,
    clickColor: style.clickColor ? HexColor.parse(style.clickColor) : null,
    clickOpacity: Math.min(Math.max(style.clickOpacity, 0.05), 1.0),
    clickScale: Math.min(Math.max(style.clickScale, 0.4), 3.0),
    rotationRadians: Number.isFinite(sample.rotationRadians) ? sample.rotationRadians : 0,
    shadow: makeFrameShadow({
      opacity: 0.42,
      radius: Math.max((layout.clickEffectHeight * 1.5) / 44, 0.5),
      offset: { x: 0, y: Math.max(layout.clickEffectHeight / 44, 0.5) },
    }),
    attachment: 'screen',
  }
}

// ---------------------------------------------------------------- Evaluator

export interface FrameSceneOptions {
  project: RecorderProject
  time: TimeInterval
  outputDuration?: TimeInterval | null
  canvasSize: CompositionSize
  sourceAspectRatio: number
  cameraSourceSize?: CompositionSize | null
  pointerTrack?: ProjectPointerTrack | null
  pointerEvaluation?: PointerTrackEvaluation | null
  cursorMetrics?: CursorAssetMetrics | null
  cursorMetricsByAssetID?: Record<string, CursorAssetMetrics>
  zoomTrack?: ZoomAnimationTrack | null
  screenMotionTrack?: ScreenMotionTrack | null
  cameraMotionTrack?: CameraMotionTrack | null
  stickerTrack?: StickerTransitionTrack | null
  color?: FrameColorContract
}

export interface FrameRenderPlanOptions extends FrameSceneOptions {
  presentationTime: TimeInterval
  outputDuration: number
  frameRate: number
  cameraTimeline?: TimelineMediaPlan | null
}

export interface RefreshingCursorOptions {
  plan: FrameRenderPlan
  presentationTime: TimeInterval
  project: RecorderProject
  pointerTrack: ProjectPointerTrack | null
  cursorMetrics: CursorAssetMetrics | null
  cursorMetricsByAssetID?: Record<string, CursorAssetMetrics>
  zoomTrack: ZoomAnimationTrack
}

/**
 * Swift FrameSceneEvaluator（L444-1284）：唯一「读工程」的逐帧解释器。
 * 渲染后端只拿到不可变计划与各自的媒体帧句柄。
 */
export const FrameSceneEvaluator = {
  /**
   * Swift refreshingCursor(in:at:...)（L449-487）：预览可以在 30/60Hz 复用
   * 昂贵的视频帧计划，但指针仍属于 display-link 时钟 —— 只对录制的路径、
   * 可见性、形状与点击相位重新求值，绝不把它们量化到被缓存的视频帧时刻。
   */
  refreshingCursor(options: RefreshingCursorOptions): FrameRenderPlan {
    const { plan, project, pointerTrack, zoomTrack } = options
    const time = Number.isFinite(options.presentationTime)
      ? Math.min(Math.max(options.presentationTime, 0), plan.outputDuration)
      : 0
    const activeClip = activeClipAt(zoomTrack, time)
    const activeAutomaticClip = activeClip && activeClip.origin === 'automatic' ? activeClip : null
    const pointer = pointerTrack
      ? pointerTrack.evaluation(time, project.motion, project.cursorStyle, activeAutomaticClip)
      : null
    const layerOrder: FrameLayerRole[] = plan.scene.layerOrder.filter(
      (role): boolean => role !== 'cursor'
    )
    const cursor = frameCursorScene({
      sample: pointer?.cursor ?? null,
      project,
      metrics: options.cursorMetrics,
      metricsByAssetID: options.cursorMetricsByAssetID ?? {},
      screen: plan.scene.screen,
      canvasSize: plan.scene.canvasSize,
    })
    if (cursor) {
      const screenIndex = layerOrder.indexOf('screen')
      if (screenIndex >= 0) layerOrder.splice(screenIndex + 1, 0, 'cursor')
    }
    // 保留缓存的视频/背景相位：在这里推进 scene.time 会让全画布动态壁纸
    // 以光标频率重绘。
    return {
      presentationTime: time,
      outputDuration: plan.outputDuration,
      frameRate: plan.frameRate,
      scene: { ...plan.scene, cursor, layerOrder },
    }
  },

  /** Swift renderPlan(project:presentationTime:...)（L489-539）。 */
  renderPlan(options: FrameRenderPlanOptions): FrameRenderPlan {
    const safeDuration = Number.isFinite(options.outputDuration)
      ? Math.max(options.outputDuration, 0)
      : 0
    const safeTime = Number.isFinite(options.presentationTime)
      ? Math.min(Math.max(options.presentationTime, 0), safeDuration)
      : 0
    // 时间线计划拥有剪切边界归属权：这里再用严格 Double 比较复核选中的
    // 切片，可能因几个 ulps 与它矛盾（计划已推进到下一段相机，而
    // `safeTime >= slice.outputStart` 为假），结果恰好丢掉一帧相机。
    const cameraIsAvailable = options.cameraTimeline
      ? options.cameraTimeline.contains(safeTime)
      : true
    const scene = FrameSceneEvaluator.scene({
      ...options,
      time: safeTime,
      outputDuration: safeDuration,
      cameraSourceSize: cameraIsAvailable ? (options.cameraSourceSize ?? null) : null,
    })
    return {
      presentationTime: safeTime,
      outputDuration: safeDuration,
      frameRate: Math.max(options.frameRate, 1),
      scene,
    }
  },

  /** Swift scene(project:time:...)（L541-833）。 */
  scene(options: FrameSceneOptions): FrameScene {
    const { project } = options
    const width = Math.max(options.canvasSize.width, 2)
    const height = Math.max(options.canvasSize.height, 2)
    const sampleTime = Number.isFinite(options.time) ? Math.max(options.time, 0) : 0
    const outputDuration = options.outputDuration ?? null
    const resolvedZoomTrack =
      (options.zoomTrack ? trackBounded(options.zoomTrack, outputDuration) : null) ??
      makeTrack(project.timeline.zoomClips, outputDuration)
    const resolvedScreenTrack =
      options.screenMotionTrack ?? new ScreenMotionTrack(project.timeline.screenMotionClips)
    const activeClip = activeClipAt(resolvedZoomTrack, sampleTime)
    const activeAutomaticClip = activeClip && activeClip.origin === 'automatic' ? activeClip : null
    const reanchorsAtCut = activeAutomaticClip
      ? (options.pointerTrack?.automaticEntryStartsAfterCut(activeAutomaticClip) ?? false)
      : false
    const pointer: PointerTrackEvaluation =
      (reanchorsAtCut ? options.pointerEvaluation : null) ??
      (options.pointerTrack
        ? options.pointerTrack.evaluation(
            sampleTime,
            project.motion,
            project.cursorStyle,
            activeAutomaticClip
          )
        : null) ?? { position: null, cursor: null }

    // CAM-001...CAM-004：点击组提供稳定的初始构图；指针活动只有在近期
    // 范围越过安全区后，才通过独立的缓存屏幕弹簧推动构图。
    const automaticCameraPosition = activeAutomaticClip
      ? (options.pointerTrack
          ? options.pointerTrack.automaticCameraFocus(
              sampleTime,
              activeAutomaticClip,
              project.motion
            )
          : null) ?? activeAutomaticClip.focus
      : null
    let inheritedAutomaticCameraPosition: NormalizedPoint | null = null
    if (activeClip) {
      const previous = adjacentPreviousClip(resolvedZoomTrack, activeClip)
      if (previous && previous.origin === 'automatic') {
        inheritedAutomaticCameraPosition = options.pointerTrack
          ? options.pointerTrack.automaticCameraFocus(
              previous.endTime,
              previous,
              project.motion
            )
          : null
        inheritedAutomaticCameraPosition ??= previous.focus
      }
    }

    const cameraSourceSize = options.cameraSourceSize ?? null
    const cameraAspect = cameraSourceSize
      ? Math.max(cameraSourceSize.width, 1) / Math.max(cameraSourceSize.height, 1)
      : null
    const styleScale = canonicalStyleScale(width, height)
    const geometry = compositionSceneEvaluate({
      project,
      time: sampleTime,
      canvasWidth: width,
      canvasHeight: height,
      sourceAspectRatio: options.sourceAspectRatio,
      cameraAspectRatio: cameraAspect,
      styleScale,
      automaticZoomFocus: automaticCameraPosition,
      inheritedAutomaticZoomFocus: inheritedAutomaticCameraPosition,
      reanchorAutomaticEntry: reanchorsAtCut,
      zoomTrack: resolvedZoomTrack,
      screenMotionTrack: resolvedScreenTrack,
      cameraMotionTrack: options.cameraMotionTrack ?? null,
    })

    // 开场花名册必须在整个时长内稳定：用当前帧的活动片段会让贴图/相机在
    // 开场中途出现时，改变先前每个元素的延迟与时长。
    const stickerClips = project.timeline.stickerClips ?? []
    const mosaicClips = project.timeline.mosaicClips ?? []
    const hasOpeningSticker = stickerClips.some(
      (clip) => clip.timing.startTime <= 0.000_1 && clip.timing.startTime + clip.timing.duration > 0.000_1
    )
    const hasOpeningCamera =
      (project.media?.camera != null || cameraSourceSize != null) && !project.camera.isHidden
    const availableElements = participatingOpeningElements(
      project.openingSequence,
      hasOpeningCamera,
      hasOpeningSticker
    )
    const screenOpening = openingSample(
      '屏幕',
      project.openingSequence,
      availableElements,
      sampleTime,
      width,
      height
    )
    const screenGeometry: ScreenSceneEvaluation = { ...geometry.screen }
    screenGeometry.finalRect = openingRect(screenGeometry.finalRect, screenOpening)
    screenGeometry.finalCornerRadius *= screenOpening.scale
    screenGeometry.finalBorderWidth *= screenOpening.scale
    screenGeometry.rotationX += screenOpening.rotationX
    screenGeometry.rotationY += screenOpening.rotationY
    screenGeometry.perspective = Math.min(
      Math.max(screenGeometry.perspective + screenOpening.perspective, 0),
      2
    )

    const screenShadow =
      project.canvas.shadowStrength > 0
        ? makeFrameShadow({
            opacity: project.canvas.shadowStrength,
            radius:
              22 *
              styleScale *
              screenGeometry.manualScale *
              screenGeometry.viewport.scale *
              screenOpening.scale,
            offset: {
              x: 0,
              y:
                12 *
                styleScale *
                screenGeometry.manualScale *
                screenGeometry.viewport.scale *
                screenOpening.scale,
            },
          })
        : null

    const decoration = screenDecoration({
      style: project.canvas.screenFrame,
      frameScale: project.canvas.screenFrameScale,
      toolbarScale: project.canvas.screenFrameToolbarScale,
      outerCornerRadius: project.canvas.screenFrameOuterCornerRadius,
      contentCornerRadius: project.canvas.screenFrameContentCornerRadius,
      title: project.canvas.screenFrameTitle,
      browserAddress: project.canvas.screenFrameBrowserAddress,
      geometry: screenGeometry,
      styleScale,
      groupScale: screenOpening.scale,
    })
    const projectionRect =
      frameScreenDecorationProjectionRect(decoration) ?? screenGeometry.finalRect
    // 检查器里的点是「录制内容」上的点：整块装饰、边框与阴影共享它的投影，
    // 但非对称装饰绝不能把 0/0 重新解释成外框工具栏的角。
    const projectionAnchor: CompositionPoint = {
      x: screenGeometry.finalRect.x + screenGeometry.finalRect.width * screenGeometry.projectionAnchor.x,
      y: screenGeometry.finalRect.y + screenGeometry.finalRect.height * screenGeometry.projectionAnchor.y,
    }
    const projectedQuad = projectScreen({
      rect: projectionRect,
      rotationX: screenGeometry.rotationX,
      rotationY: screenGeometry.rotationY,
      rotationZ: screenGeometry.rotationZ,
      perspective: screenGeometry.perspective,
      anchor: projectionAnchor,
    })

    const activeMosaics: FrameMosaicScene[] = []
    for (const clip of mosaicClips) {
      if (!overlayContains(clip.timing, sampleTime)) continue
      activeMosaics.push(
        makeFrameMosaicScene({
          sourceRect: clip.sourceRect,
          cornerRadius: clip.cornerRadius,
          style: clip.style,
          intensity: clip.intensity,
          spotlightDimming: clip.spotlightDimming,
          transitionProgress: overlayEffectProgress(
            clip.timing,
            clip.transitionStyle,
            clip.transitionInDuration,
            clip.transitionOutDuration,
            sampleTime
          ),
        })
      )
    }

    const screen: FrameScreenScene = {
      sourceCrop: project.canvas.crop,
      fittedRect: screenGeometry.fittedRect,
      baseRect: screenGeometry.baseRect,
      finalRect: screenGeometry.finalRect,
      projectedQuad,
      cornerRadius: screenGeometry.finalCornerRadius,
      borderWidth: screenGeometry.finalBorderWidth,
      borderColor: HexColor.parse(project.canvas.borderColor) ?? HexColor.white,
      borderOpacity: project.canvas.insetOpacity,
      shadow: screenShadow,
      decoration,
      mosaics: activeMosaics,
      focusEffect: focusEffectScene({
        zoom: activeClip,
        screen: resolvedScreenTrack.activeClipAt(sampleTime),
        zoomFocus: geometry.screen.zoom.focus,
        crop: project.canvas.crop,
        pointer: pointer.position,
        time: sampleTime,
        motion: project.motion,
      }),
      opacity: screenOpening.opacity,
    }

    let camera: FrameCameraScene | null = null
    if (geometry.camera) {
      const evaluation: CameraSceneEvaluation = geometry.camera
      const opening = openingSample(
        '摄像头',
        project.openingSequence,
        availableElements,
        sampleTime,
        width,
        height
      )
      const openingCameraRect = openingRect(evaluation.rect, opening)
      const visualFocus = project.camera.contentPosition
      camera = {
        rect: openingCameraRect,
        contentFill: cameraSourceSize
          ? cameraContentFillLayout(
              cameraSourceSize.width,
              cameraSourceSize.height,
              openingCameraRect,
              // 镜像在裁剪之后发生：把编辑器的水平控件解释到最终视觉方向。
              {
                x: project.camera.isMirrored ? 1 - visualFocus.x : visualFocus.x,
                y: visualFocus.y,
              },
              project.camera.contentScale
            )
          : null,
        cornerRadius: evaluation.cornerRadius * opening.scale,
        borderWidth: evaluation.borderWidth * opening.scale,
        borderColor: HexColor.white,
        shadow:
          project.camera.shadowStrength > 0
            ? makeFrameShadow({
                opacity: project.camera.shadowStrength,
                radius: 14 * styleScale,
                offset: { x: 0, y: 8 * styleScale },
              })
            : null,
        opacity: project.camera.isHidden ? 0 : evaluation.opacity * opening.opacity,
        isMirrored: project.camera.isMirrored,
      }
    }

    const cursor = frameCursorScene({
      sample: pointer.cursor,
      project,
      metrics: options.cursorMetrics ?? null,
      metricsByAssetID: options.cursorMetricsByAssetID ?? {},
      screen,
      canvasSize: compositionSize(width, height),
    })

    const stickerSample = stickerScenes(
      options.stickerTrack ?? new StickerTransitionTrack(stickerClips),
      sampleTime,
      project.openingSequence.isEnabled &&
        project.openingSequence.includedElements.includes('贴图')
    )
    const stickerOpening = openingSample(
      '贴图',
      project.openingSequence,
      availableElements,
      sampleTime,
      width,
      height
    )
    const stickers = stickerSample.stickers.map((scene) => ({
      ...scene,
      offset: {
        x: scene.offset.x + stickerOpening.offset.x / width,
        y: scene.offset.y + stickerOpening.offset.y / height,
      },
      scale: scene.scale * stickerOpening.scale,
      opacity: scene.opacity * stickerOpening.opacity,
    }))

    const order: FrameLayerRole[] = ['background', 'screen']
    if (cursor) order.push('cursor')
    // 聚焦压暗是覆盖整幅基础画面的一层，而不是分别处理壁纸与屏幕纹理。
    if (
      screen.focusEffect !== null ||
      activeMosaics.some((mosaic) => mosaic.style === 'spotlight')
    ) {
      order.push('spotlight')
    }
    if (camera && (camera.opacity ?? 0) > 0) order.push('camera')
    if (stickers.length > 0) order.push('stickers')

    return {
      time: sampleTime,
      canvasSize: compositionSize(width, height),
      color: options.color ?? FRAME_COLOR_SDR_DESKTOP,
      background: makeFrameBackgroundScene({
        source: project.canvas.backgroundSource,
        blurRadius: project.canvas.backgroundBlur * styleScale,
        patternScale: project.canvas.patternScale,
        patternOpacity: project.canvas.patternOpacity,
      }),
      screen,
      camera,
      cursor,
      stickers,
      stickerBackdrop: stickerSample.backdrop,
      layerOrder: order,
    }
  },
}

/** 供渲染器复用的常量（Swift ZoomViewportTransform.focusEdgeInset 的别名）。 */
export const FRAME_FOCUS_EDGE_INSET = ZOOM_VIEWPORT.focusEdgeInset

/** Swift NormalizedPoint.constrained 便捷包装（保持与 FrameScene 内部一致）。 */
export function frameConstrainedPoint(point: NormalizedPoint): NormalizedPoint {
  return constrainPoint(point, FRAME_FOCUS_EDGE_INSET)
}

/** Swift FrameScene 便捷构造（缺省 backdrop 由贴图推导）。 */
export function makeFrameScene(init: {
  time: TimeInterval
  canvasSize: CompositionSize
  color: FrameColorContract
  background: FrameBackgroundScene
  screen: FrameScreenScene
  camera: FrameCameraScene | null
  cursor: FrameCursorScene | null
  stickers?: FrameStickerScene[]
  stickerBackdrop?: FrameStickerBackdropScene | null
  layerOrder: FrameLayerRole[]
}): FrameScene {
  const stickers = init.stickers ?? []
  return {
    time: init.time,
    canvasSize: init.canvasSize,
    color: init.color,
    background: init.background,
    screen: init.screen,
    camera: init.camera,
    cursor: init.cursor,
    stickers,
    stickerBackdrop: init.stickerBackdrop ?? FrameStickerBackdropScene.fromStickers(stickers),
    layerOrder: init.layerOrder,
  }
}
