/**
 * 叠加层时间线：马赛克剪辑与贴图剪辑的模型与编解码。
 *
 * Swift source: Sources/RecorderCore/OverlayTimeline.swift @ laogou717/dogsc 567fd6e
 * 逐结构对照：
 *   - NormalizedOverlayRect（L10-34）
 *   - OverlayTiming（L40-50）
 *   - MosaicEffectStyle（含 v9 像素块预设迁移，L56-68）
 *   - MosaicTransitionStyle（L76-80）
 *   - MosaicClip（完整解码/编码，L94-172）
 *   - StickerAnimationPreset + automaticExit（L179-205）
 *   - StickerClip（完整解码/编码，L208-393）
 */
import type { ElementMotionCurve } from './ElementMotion'
import type { NormalizedPoint } from './ZoomAnimation'
import { HexColor } from './HexColor'

// ---------------------------------------------------------------- NormalizedOverlayRect

/** 预览上直接创作的归一化、左上原点矩形。 */
export interface NormalizedOverlayRect {
  x: number
  y: number
  width: number
  height: number
}

export const OVERLAY_RECT_CENTERED: NormalizedOverlayRect = {
  x: 0.35,
  y: 0.39,
  width: 0.3,
  height: 0.22,
}

export function makeOverlayRect(overrides: Partial<NormalizedOverlayRect> = {}): NormalizedOverlayRect {
  return { ...OVERLAY_RECT_CENTERED, ...overrides }
}

/** Swift: clamped()。非有限值回落各自默认，宽高至少 0.01。 */
export function clampedOverlayRect(rect: NormalizedOverlayRect): NormalizedOverlayRect {
  const safeWidth = Math.min(Math.max(Number.isFinite(rect.width) ? rect.width : 0.3, 0.01), 1)
  const safeHeight = Math.min(Math.max(Number.isFinite(rect.height) ? rect.height : 0.22, 0.01), 1)
  return {
    x: Math.min(Math.max(Number.isFinite(rect.x) ? rect.x : 0.35, 0), 1 - safeWidth),
    y: Math.min(Math.max(Number.isFinite(rect.y) ? rect.y : 0.39, 0), 1 - safeHeight),
    width: safeWidth,
    height: safeHeight,
  }
}

// ---------------------------------------------------------------- OverlayTiming

export interface OverlayTiming {
  startTime: number
  duration: number
}

export function makeOverlayTiming(startTime: number, duration = 3): OverlayTiming {
  return { startTime, duration }
}

export const overlayEndTime = (t: OverlayTiming): number => t.startTime + t.duration

export const overlayContains = (t: OverlayTiming, time: number): boolean =>
  time >= t.startTime && time < overlayEndTime(t)

// ---------------------------------------------------------------- Mosaic

export type MosaicEffectStyle = 'blur' | 'spotlight'
export const MOSAIC_EFFECT_STYLES: readonly MosaicEffectStyle[] = ['blur', 'spotlight']

/**
 * Swift 自定义解码（L60）：v9 曾短暂暴露像素块预设，
 * 有意迁移到普通柔化而不是永远保留隐藏渲染分支。
 */
export function decodeMosaicEffectStyle(raw: unknown): MosaicEffectStyle {
  return String(raw) === 'spotlight' ? 'spotlight' : 'blur'
}

export type MosaicTransitionStyle = 'none' | 'linear' | 'smooth'
export const MOSAIC_TRANSITION_STYLES: readonly MosaicTransitionStyle[] = [
  'none', 'linear', 'smooth',
]

export interface MosaicClip {
  id: string
  timing: OverlayTiming
  sourceRect: NormalizedOverlayRect
  /** 相对马赛克矩形短边归一化。 */
  cornerRadius: number
  style: MosaicEffectStyle
  /** 产品向 0...1 强度；渲染器负责换算成像素。 */
  intensity: number
  /** 聚光灯焦点外的压暗。普通 blur 忽略。 */
  spotlightDimming: number
  transitionStyle: MosaicTransitionStyle
  transitionInDuration: number
  transitionOutDuration: number
}

export function makeMosaicClip(overrides: Partial<MosaicClip> = {}): MosaicClip {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    timing: overrides.timing ?? makeOverlayTiming(0),
    sourceRect: overrides.sourceRect ?? { ...OVERLAY_RECT_CENTERED },
    cornerRadius: overrides.cornerRadius ?? 0.08,
    style: overrides.style ?? 'blur',
    intensity: overrides.intensity ?? 0.55,
    spotlightDimming: overrides.spotlightDimming ?? 0.22,
    transitionStyle: overrides.transitionStyle ?? 'none',
    transitionInDuration: overrides.transitionInDuration ?? 0.3,
    transitionOutDuration: overrides.transitionOutDuration ?? 0.3,
  }
}

/** 解码（L135-158）：transitionStyle 缺省按 style 推导（spotlight → smooth）。 */
export function decodeMosaicClip(raw: unknown): MosaicClip {
  const obj = (raw ?? {}) as Record<string, unknown>
  const style = decodeMosaicEffectStyle(obj.style)
  return makeMosaicClip({
    id: String(obj.id ?? ''),
    timing: obj.timing as OverlayTiming,
    sourceRect: (obj.sourceRect ?? undefined) as NormalizedOverlayRect | undefined,
    cornerRadius: typeof obj.cornerRadius === 'number' ? obj.cornerRadius : 0.08,
    style,
    intensity: typeof obj.intensity === 'number' ? obj.intensity : 0.55,
    spotlightDimming: typeof obj.spotlightDimming === 'number' ? obj.spotlightDimming : 0.22,
    transitionStyle:
      obj.transitionStyle !== undefined && obj.transitionStyle !== null
        ? (obj.transitionStyle as MosaicTransitionStyle)
        : style === 'spotlight'
          ? 'smooth'
          : 'none',
    transitionInDuration: typeof obj.transitionInDuration === 'number' ? obj.transitionInDuration : 0.3,
    transitionOutDuration: typeof obj.transitionOutDuration === 'number' ? obj.transitionOutDuration : 0.3,
  })
}

export function encodeMosaicClip(clip: MosaicClip): Record<string, unknown> {
  return {
    id: clip.id,
    timing: clip.timing,
    sourceRect: clip.sourceRect,
    cornerRadius: clip.cornerRadius,
    style: clip.style,
    intensity: clip.intensity,
    spotlightDimming: clip.spotlightDimming,
    transitionStyle: clip.transitionStyle,
    transitionInDuration: clip.transitionInDuration,
    transitionOutDuration: clip.transitionOutDuration,
  }
}

// ---------------------------------------------------------------- Sticker

export type StickerAnimationPreset =
  | 'none' | 'fade' | 'pop'
  | 'slideLeft' | 'slideRight' | 'slideUp' | 'slideDown'
  | 'slideTopLeft' | 'slideTopRight' | 'slideBottomLeft' | 'slideBottomRight'

export const STICKER_ANIMATION_PRESETS: readonly StickerAnimationPreset[] = [
  'none', 'fade', 'pop',
  'slideLeft', 'slideRight', 'slideUp', 'slideDown',
  'slideTopLeft', 'slideTopRight', 'slideBottomLeft', 'slideBottomRight',
]

/** Swift: automaticExit —— 滑入方向的反向即出场方向。 */
export function stickerAutomaticExit(preset: StickerAnimationPreset): StickerAnimationPreset {
  switch (preset) {
    case 'slideLeft': return 'slideRight'
    case 'slideRight': return 'slideLeft'
    case 'slideUp': return 'slideDown'
    case 'slideDown': return 'slideUp'
    case 'slideTopLeft': return 'slideBottomRight'
    case 'slideTopRight': return 'slideBottomLeft'
    case 'slideBottomLeft': return 'slideTopRight'
    case 'slideBottomRight': return 'slideTopLeft'
    case 'none': case 'fade': case 'pop': return preset
  }
}

/** 工程包内、位于合成录制画面之上的静态图片剪辑。 */
export interface StickerClip {
  id: string
  timing: OverlayTiming
  relativePath: string
  position: NormalizedPoint
  /** 相对输出画布的宽度；高度跟随图片宽高比。 */
  width: number
  rotationDegrees: number
  opacity: number
  cornerRadius: number
  borderWidth: number
  borderColor: HexColor
  shadowOpacity: number
  shadowRadius: number
  shadowOffsetX: number
  shadowOffsetY: number
  animation: StickerAnimationPreset
  /** 入场/出场共用的非线性时序；视觉路径由 animation/exitAnimation 独立选择。 */
  animationCurve: ElementMotionCurve
  /** null 跟随 animation 的互补方向。 */
  exitAnimation: StickerAnimationPreset | null
  enterDuration: number
  exitDuration: number
  backdropBlur: number
  /** 贴图的背景模糊是否也作用于独立摄像头层；屏幕/背景默认保持目标。 */
  backdropBlurIncludesCamera: boolean
  /** 贴图可见期间临时只显示画布背景（跟随贴图自身出入场曲线）。 */
  hidesScreen: boolean
  /** 贴图可见期间临时抑制摄像头。 */
  hidesCamera: boolean
  layerIndex: number
}

export function makeStickerClip(overrides: Partial<StickerClip> = {}): StickerClip {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    timing: overrides.timing ?? makeOverlayTiming(0),
    relativePath: overrides.relativePath ?? '',
    position: overrides.position ?? { x: 0.5, y: 0.5 },
    width: overrides.width ?? 0.38,
    rotationDegrees: overrides.rotationDegrees ?? 0,
    opacity: overrides.opacity ?? 1,
    cornerRadius: overrides.cornerRadius ?? 18,
    borderWidth: overrides.borderWidth ?? 0,
    borderColor: overrides.borderColor ?? HexColor.white,
    shadowOpacity: overrides.shadowOpacity ?? 0.28,
    shadowRadius: overrides.shadowRadius ?? 24,
    shadowOffsetX: overrides.shadowOffsetX ?? 0,
    shadowOffsetY: overrides.shadowOffsetY ?? 10,
    animation: overrides.animation ?? 'pop',
    animationCurve: overrides.animationCurve ?? 'swift',
    exitAnimation: overrides.exitAnimation ?? null,
    enterDuration: overrides.enterDuration ?? 0.7,
    exitDuration: overrides.exitDuration ?? 0.22,
    backdropBlur: overrides.backdropBlur ?? 20,
    backdropBlurIncludesCamera: overrides.backdropBlurIncludesCamera ?? false,
    hidesScreen: overrides.hidesScreen ?? false,
    hidesCamera: overrides.hidesCamera ?? false,
    layerIndex: overrides.layerIndex ?? 0,
  }
}

/** 解码（L322-360）：animationCurve/exitAnimation/backdropBlurIncludesCamera/hidesScreen/hidesCamera 为可选字段。 */
export function decodeStickerClip(raw: unknown): StickerClip {
  const obj = (raw ?? {}) as Record<string, unknown>
  const borderColorRaw = obj.borderColor
  const borderColorHex =
    typeof borderColorRaw === 'string'
      ? borderColorRaw
      : typeof (borderColorRaw as { hexString?: string } | null)?.hexString === 'string'
        ? (borderColorRaw as { hexString: string }).hexString
        : undefined
  const borderColor = (borderColorHex ? HexColor.parse(borderColorHex) : null) ?? HexColor.white
  return makeStickerClip({
    id: String(obj.id ?? ''),
    timing: obj.timing as OverlayTiming,
    relativePath: String(obj.relativePath ?? ''),
    position: (obj.position ?? undefined) as NormalizedPoint | undefined,
    width: typeof obj.width === 'number' ? obj.width : 0.38,
    rotationDegrees: typeof obj.rotationDegrees === 'number' ? obj.rotationDegrees : 0,
    opacity: typeof obj.opacity === 'number' ? obj.opacity : 1,
    cornerRadius: typeof obj.cornerRadius === 'number' ? obj.cornerRadius : 18,
    borderWidth: typeof obj.borderWidth === 'number' ? obj.borderWidth : 0,
    borderColor,
    shadowOpacity: typeof obj.shadowOpacity === 'number' ? obj.shadowOpacity : 0.28,
    shadowRadius: typeof obj.shadowRadius === 'number' ? obj.shadowRadius : 24,
    shadowOffsetX: typeof obj.shadowOffsetX === 'number' ? obj.shadowOffsetX : 0,
    shadowOffsetY: typeof obj.shadowOffsetY === 'number' ? obj.shadowOffsetY : 10,
    animation: (obj.animation as StickerAnimationPreset) ?? 'pop',
    animationCurve: (obj.animationCurve as ElementMotionCurve) ?? 'swift',
    exitAnimation: (obj.exitAnimation as StickerAnimationPreset | undefined) ?? null,
    enterDuration: typeof obj.enterDuration === 'number' ? obj.enterDuration : 0.7,
    exitDuration: typeof obj.exitDuration === 'number' ? obj.exitDuration : 0.22,
    backdropBlur: typeof obj.backdropBlur === 'number' ? obj.backdropBlur : 20,
    backdropBlurIncludesCamera: obj.backdropBlurIncludesCamera === true,
    hidesScreen: obj.hidesScreen === true,
    hidesCamera: obj.hidesCamera === true,
    layerIndex: typeof obj.layerIndex === 'number' ? obj.layerIndex : 0,
  })
}

/** 编码（L367-392）：exitAnimation 仅在非 null 时写出。 */
export function encodeStickerClip(clip: StickerClip): Record<string, unknown> {
  return {
    id: clip.id,
    timing: clip.timing,
    relativePath: clip.relativePath,
    position: clip.position,
    width: clip.width,
    rotationDegrees: clip.rotationDegrees,
    opacity: clip.opacity,
    cornerRadius: clip.cornerRadius,
    borderWidth: clip.borderWidth,
    borderColor: clip.borderColor.hexString,
    shadowOpacity: clip.shadowOpacity,
    shadowRadius: clip.shadowRadius,
    shadowOffsetX: clip.shadowOffsetX,
    shadowOffsetY: clip.shadowOffsetY,
    animation: clip.animation,
    animationCurve: clip.animationCurve,
    ...(clip.exitAnimation !== null ? { exitAnimation: clip.exitAnimation } : {}),
    enterDuration: clip.enterDuration,
    exitDuration: clip.exitDuration,
    backdropBlur: clip.backdropBlur,
    backdropBlurIncludesCamera: clip.backdropBlurIncludesCamera,
    hidesScreen: clip.hidesScreen,
    hidesCamera: clip.hidesCamera,
    layerIndex: clip.layerIndex,
  }
}
