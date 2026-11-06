/**
 * ProjectModel — 工程持久化模型（枚举 / 开场序列 / 背景来源 / 光标 / 裁切 / 画布风格）。
 *
 * Swift source: Sources/RecorderCore/ProjectModel.swift @ laogou717/dogsc 567fd6e
 *   逐项对照（按源文件行号）：
 *   - enum ProjectSchema / ProjectSchemaError            (L6/L43)
 *   - enum CanvasAspectRatio / CanvasResolution          (L65/L79)
 *   - enum ScreenFrameStyle（含退役值解码映射）           (L100)
 *   - enum OpeningSequencePreset / Element / OpeningSequence (L177/L185/L193)
 *   - enum BackgroundPatternPreset / DynamicBackgroundPreset / BackgroundSource (L308/L318/L364)
 *   - enum CameraShape                                    (L467)
 *   - struct CursorAssetID / CursorClickEffectStyle / CursorStyle (L516/L554/L582)
 *   - struct NormalizedCrop                               (L777)
 *   - struct CanvasStyle（24 字段 + 解码兜底 + encode）    (L830)
 *   - struct CanvasDimensions + CanvasStyle.pixelDimensions (L1038/L1048)
 *   - struct AudioStyle / CameraStyle                     (L1134/L1179)
 *   （struct MotionStyle 见 MotionStyle.ts，同属本 Swift 文件 L1248）
 *
 * 平台差异说明：
 *   · Swift HexColor（Codable 结构体）→ TS 侧以 '#RRGGBB' 字符串持久化，
 *     解析用 HexColor.parse；语义（严格 6 位十六进制）一致。
 *   · Swift 的 DecodingError → 这里抛 Error（消息文本对齐）。
 */

import { HexColor } from './HexColor'
import type { ElementMotionCurve } from './ElementMotion'
import type { NormalizedPoint } from './ZoomAnimation'
import {
  customAspectRatioValue,
  decodeCanvasCustomAspectRatio,
  resolvedFixedAspectRatio,
  type CanvasCustomAspectRatio,
} from './CanvasCustomAspectRatio'
import type { MotionStyle } from './MotionStyle'

export type TimeInterval = number

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const finiteOr = (v: number | undefined, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

// ---------------------------------------------------------------- ProjectSchema

export const PROJECT_SCHEMA_MINIMUM_SUPPORTED_VERSION = 23
/** 24 加入自定画布比例；27 持久化录制标记，老版本不得静默丢弃。 */
export const PROJECT_SCHEMA_CURRENT_VERSION = 27

export type ProjectSchemaErrorKind =
  | 'unsupportedLegacyVersion'
  | 'unsupportedFutureVersion'
  | 'refusingToEncodeUnsupportedVersion'
  | 'refusingToEncodeFutureVersion'

export class ProjectSchemaError extends Error {
  constructor(
    readonly kind: ProjectSchemaErrorKind,
    readonly found: number,
    readonly bound: number
  ) {
    super(projectSchemaErrorMessage(kind, found, bound))
    this.name = 'ProjectSchemaError'
  }
}

/** 对齐 Swift LocalizedError.errorDescription 的中文文案。 */
export function projectSchemaErrorMessage(
  kind: ProjectSchemaErrorKind,
  found: number,
  bound: number
): string {
  switch (kind) {
    case 'unsupportedLegacyVersion':
      return `项目版本 ${found} 过旧；当前应用最低支持版本 ${bound}。`
    case 'unsupportedFutureVersion':
      return `项目版本 ${found} 来自更新的应用；当前应用只支持到版本 ${bound}，为避免损坏项目已停止打开。`
    case 'refusingToEncodeUnsupportedVersion':
      return `拒绝写入项目版本 ${found}；可写入版本范围为 ${bound}...${PROJECT_SCHEMA_CURRENT_VERSION}。`
    case 'refusingToEncodeFutureVersion':
      return `拒绝用当前应用覆盖未来项目版本 ${found}；当前应用只支持到版本 ${bound}。`
  }
}

export const ProjectSchema = {
  validateForDecoding(version: number): void {
    if (version < PROJECT_SCHEMA_MINIMUM_SUPPORTED_VERSION) {
      throw new ProjectSchemaError(
        'unsupportedLegacyVersion',
        version,
        PROJECT_SCHEMA_MINIMUM_SUPPORTED_VERSION
      )
    }
    if (version > PROJECT_SCHEMA_CURRENT_VERSION) {
      throw new ProjectSchemaError(
        'unsupportedFutureVersion',
        version,
        PROJECT_SCHEMA_CURRENT_VERSION
      )
    }
  },
  validateForEncoding(version: number): void {
    if (version < PROJECT_SCHEMA_MINIMUM_SUPPORTED_VERSION) {
      throw new ProjectSchemaError(
        'refusingToEncodeUnsupportedVersion',
        version,
        PROJECT_SCHEMA_MINIMUM_SUPPORTED_VERSION
      )
    }
    if (version > PROJECT_SCHEMA_CURRENT_VERSION) {
      throw new ProjectSchemaError(
        'refusingToEncodeFutureVersion',
        version,
        PROJECT_SCHEMA_CURRENT_VERSION
      )
    }
  },
}

// ---------------------------------------------------------------- Canvas enums

export type CanvasAspectRatio =
  | '适应' | '16:9' | '4:3' | '9:16' | '1:1' | '3:4' | '2.39:1' | '1:2.39' | '自定义'

export const CANVAS_ASPECT_RATIOS: readonly CanvasAspectRatio[] = [
  '适应', '16:9', '4:3', '9:16', '1:1', '3:4', '2.39:1', '1:2.39', '自定义',
]

export type CanvasResolution = '原始素材' | '1080p' | '1440p' | '4K'

export const CANVAS_RESOLUTIONS: readonly CanvasResolution[] = [
  '原始素材', '1080p', '1440p', '4K',
]

/** Swift 私有 presetEdges。source 无预设短边。 */
export function canvasResolutionPresetEdges(
  resolution: CanvasResolution
): { short: number; long: number } | null {
  switch (resolution) {
    case '原始素材': return null
    case '1080p': return { short: 1080, long: 1920 }
    case '1440p': return { short: 1440, long: 2560 }
    case '4K': return { short: 2160, long: 3840 }
  }
}

// ---------------------------------------------------------------- ScreenFrameStyle

/**
 * 稳定的工程侧屏幕框标识；渲染器拿到的是完整求值后的装饰场景，
 * 自己不解释这些存储值。
 */
export type ScreenFrameStyle =
  | 'none' | 'windowLight' | 'windowDark' | 'browserLight' | 'browserDark'
  | 'devicePhone' | 'deviceTablet' | 'devicePhonePortrait'
  | 'devicePhoneLandscape' | 'deviceTabletPortrait' | 'deviceTabletLandscape'

/** 收窄后的 allCases：一个自适应设备条目，旧朝向值共享同一张选择卡。 */
export const SCREEN_FRAME_STYLES: readonly ScreenFrameStyle[] = [
  'none', 'windowLight', 'windowDark', 'browserLight', 'browserDark', 'devicePhone',
]

export function isDeviceFrame(style: ScreenFrameStyle): boolean {
  return style.startsWith('device')
}

export const isBrowserFrame = (style: ScreenFrameStyle): boolean =>
  style === 'browserLight' || style === 'browserDark'

export const isWindowFrame = (style: ScreenFrameStyle): boolean =>
  style === 'windowLight' || style === 'windowDark'

/**
 * 自定义解码（L122-148）：退役值映射。
 * 不支持的值抛错，与 Swift dataCorrupted 一致。
 */
export function decodeScreenFrameStyle(raw: unknown): ScreenFrameStyle {
  const value = String(raw)
  switch (value) {
    case 'none': case 'windowLight': case 'windowDark':
    case 'browserLight': case 'browserDark':
    case 'devicePhone': case 'deviceTablet': case 'devicePhonePortrait':
    case 'devicePhoneLandscape': case 'deviceTabletPortrait': case 'deviceTabletLandscape':
      return value as ScreenFrameStyle
    // 已移除的本地设计：无 chrome，仅保留安全解码。
    case 'paperWhite': case 'graphite':
      return 'none'
    // 仅存在于未提交本地设计稿的实验值，映射到最接近的核心样式。
    case 'cyberNeon': case 'titaniumBevel': case 'studioRim':
      return 'windowDark'
    case 'frostedGlass': case 'vintageMac': case 'galleryArt':
      return 'windowLight'
    default:
      throw new Error(`Unsupported screen frame style: ${value}`)
  }
}

// ---------------------------------------------------------------- OpeningSequence

export type OpeningSequencePreset = '聚拢' | '侧滑' | '轻 3D'
export type OpeningSequenceElement = '屏幕' | '摄像头' | '贴图'

export const OPENING_SEQUENCE_ELEMENTS: readonly OpeningSequenceElement[] = [
  '屏幕', '摄像头', '贴图',
]
const OPENING_DEFAULT_ORDER: readonly OpeningSequenceElement[] = ['屏幕', '摄像头', '贴图']

/** 每个参与元素在声明的开场总时长内至少保留这么多自主动作。 */
export const OPENING_MINIMUM_ELEMENT_DURATION = 0.18

export interface OpeningSequence {
  isEnabled: boolean
  preset: OpeningSequencePreset
  motionCurve: ElementMotionCurve
  duration: TimeInterval
  stagger: TimeInterval
  includedElements: OpeningSequenceElement[]
  elementOrder: OpeningSequenceElement[]
}

export function makeOpeningSequence(
  overrides: Partial<OpeningSequence> = {}
): OpeningSequence {
  const seq: OpeningSequence = {
    isEnabled: false,
    preset: '轻 3D',
    motionCurve: 'swift',
    duration: 2.2,
    stagger: 0.16,
    includedElements: [...OPENING_SEQUENCE_ELEMENTS],
    elementOrder: [...OPENING_DEFAULT_ORDER],
    ...overrides,
  }
  seq.duration = clamp(finiteOr(seq.duration, 2.2), 0.4, 8)
  seq.stagger = clamp(finiteOr(seq.stagger, 0.16), 0, 1.2)
  seq.includedElements = normalizeOpeningElements(seq.includedElements, false)
  seq.elementOrder = normalizeOpeningElements(seq.elementOrder, true)
  normalizeOpeningTiming(seq)
  return seq
}

export function maximumOpeningStagger(seq: OpeningSequence, elementCount: number): number {
  const gapCount = Math.max(elementCount - 1, 0)
  // 零或一个参与者时没有可约束的活动间隔；保留用户的节奏值。
  if (gapCount <= 0) return 1.2
  return Math.min(1.2, Math.max(seq.duration - OPENING_MINIMUM_ELEMENT_DURATION, 0) / gapCount)
}

/** 开场花名册在整个时长内保持稳定；仅首帧即存在的贴图参与。 */
export function availableOpeningElements(
  seq: OpeningSequence,
  hasCamera: boolean,
  hasOpeningSticker: boolean
): OpeningSequenceElement[] {
  return seq.elementOrder.filter((element) => {
    switch (element) {
      case '屏幕': return true
      case '摄像头': return hasCamera
      case '贴图': return hasOpeningSticker
    }
  })
}

export function participatingOpeningElements(
  seq: OpeningSequence,
  hasCamera: boolean,
  hasOpeningSticker: boolean
): OpeningSequenceElement[] {
  return availableOpeningElements(seq, hasCamera, hasOpeningSticker).filter((e) =>
    seq.includedElements.includes(e)
  )
}

export function normalizeOpeningTiming(seq: OpeningSequence): void {
  seq.duration = clamp(finiteOr(seq.duration, 2.2), 0.4, 8)
  const maximum = maximumOpeningStagger(seq, seq.includedElements.length)
  seq.stagger = clamp(finiteOr(seq.stagger, 0.16), 0, maximum)
}

export function decodeOpeningSequence(raw: unknown): OpeningSequence {
  const obj = (raw ?? {}) as Record<string, unknown>
  return makeOpeningSequence({
    isEnabled: typeof obj.isEnabled === 'boolean' ? obj.isEnabled : false,
    preset: (obj.preset as OpeningSequencePreset) ?? '轻 3D',
    motionCurve: (obj.motionCurve as ElementMotionCurve) ?? 'swift',
    duration: typeof obj.duration === 'number' ? obj.duration : 2.2,
    stagger: typeof obj.stagger === 'number' ? obj.stagger : 0.16,
    includedElements: Array.isArray(obj.includedElements)
      ? (obj.includedElements as OpeningSequenceElement[])
      : [...OPENING_SEQUENCE_ELEMENTS],
    elementOrder: Array.isArray(obj.elementOrder)
      ? (obj.elementOrder as OpeningSequenceElement[])
      : [...OPENING_DEFAULT_ORDER],
  })
}

function normalizeOpeningElements(
  elements: OpeningSequenceElement[],
  appendingMissing: boolean
): OpeningSequenceElement[] {
  const seen = new Set<OpeningSequenceElement>()
  const result = elements.filter((e) => (seen.has(e) ? false : (seen.add(e), true)))
  if (appendingMissing) {
    result.push(...OPENING_SEQUENCE_ELEMENTS.filter((e) => !seen.has(e)))
  }
  return result
}

// ---------------------------------------------------------------- Background presets

export type BackgroundPatternPreset =
  | '黑曜石网格' | '工程白网格' | '暗夜星阵' | '建筑极简点' | '立体等角网'

export const BACKGROUND_PATTERN_PRESETS: readonly BackgroundPatternPreset[] = [
  '黑曜石网格', '工程白网格', '暗夜星阵', '建筑极简点', '立体等角网',
]

export type DynamicBackgroundPreset = '赛博微流网格' | '星辉漫步点阵' | '极光流体星云'

export const DYNAMIC_BACKGROUND_PRESETS: readonly DynamicBackgroundPreset[] = [
  '赛博微流网格', '星辉漫步点阵', '极光流体星云',
]

/** 持久化 rawValue 保持稳定，可见名称描述当前的成片观感。 */
export function dynamicBackgroundDisplayName(preset: DynamicBackgroundPreset): string {
  switch (preset) {
    case '赛博微流网格': return '流金缓移网格'
    case '星辉漫步点阵': return '暖星漫步点阵'
    case '极光流体星云': return '蓝白流体云幕'
  }
}

/** 自定义解码：仅在某个本地开发候选中存在过的「旋转十字星阵」回落到赛博微流网格。 */
export function decodeDynamicBackgroundPreset(raw: unknown): DynamicBackgroundPreset {
  const value = String(raw)
  if (value === '旋转十字星阵') return '赛博微流网格'
  if ((DYNAMIC_BACKGROUND_PRESETS as readonly string[]).includes(value)) {
    return value as DynamicBackgroundPreset
  }
  throw new Error(`Unsupported dynamic background preset: ${value}`)
}

// ---------------------------------------------------------------- BackgroundSource

/** 画布的唯一活动背景来源；工程相对媒体与系统绝对壁纸引用保持区分。 */
export type BackgroundSource =
  | { kind: 'pattern'; patternPreset: BackgroundPatternPreset }
  | { kind: 'dynamicFlow'; dynamicPreset: DynamicBackgroundPreset }
  | { kind: 'projectImage'; relativePath: string }
  | { kind: 'systemImage'; absolutePath: string }
  | { kind: 'projectVideo'; relativePath: string }
  | { kind: 'systemVideo'; absolutePath: string }

export const BACKGROUND_SOURCE_SAFE_FALLBACK: BackgroundSource = {
  kind: 'pattern',
  patternPreset: '黑曜石网格',
}

export function backgroundSourceIsImage(source: BackgroundSource): boolean {
  return source.kind === 'projectImage' || source.kind === 'systemImage'
}

export function backgroundSourceIsVideo(source: BackgroundSource): boolean {
  return source.kind === 'projectVideo' || source.kind === 'systemVideo'
}

export const backgroundSourceUsesWallpaperMedia = (source: BackgroundSource): boolean =>
  backgroundSourceIsImage(source) || backgroundSourceIsVideo(source)

export function decodeBackgroundSource(raw: unknown): BackgroundSource {
  const obj = (raw ?? {}) as Record<string, unknown>
  switch (obj.kind) {
    case 'pattern':
      return { kind: 'pattern', patternPreset: obj.patternPreset as BackgroundPatternPreset }
    case 'dynamicFlow':
      return {
        kind: 'dynamicFlow',
        dynamicPreset: decodeDynamicBackgroundPreset(obj.dynamicPreset),
      }
    case 'projectImage':
      return { kind: 'projectImage', relativePath: String(obj.relativePath ?? '') }
    case 'systemImage':
      return { kind: 'systemImage', absolutePath: String(obj.absolutePath ?? '') }
    case 'projectVideo':
      return { kind: 'projectVideo', relativePath: String(obj.relativePath ?? '') }
    case 'systemVideo':
      return { kind: 'systemVideo', absolutePath: String(obj.absolutePath ?? '') }
    default:
      throw new Error(`Unsupported background source kind: ${String(obj.kind)}`)
  }
}

// ---------------------------------------------------------------- CameraShape

export type CameraShape = '方形' | '横向' | '纵向' | '原始比例' | '圆形'

export const CAMERA_SHAPES: readonly CameraShape[] = [
  '方形', '横向', '纵向', '原始比例', '圆形',
]

/** 自定义解码：兼容「圆角矩形」→横向、「连续圆角」→方形；未知值回落方形（不抛错）。 */
export function decodeCameraShape(raw: unknown): CameraShape {
  const value = String(raw)
  if (value === '圆角矩形') return '横向'
  if (value === '连续圆角') return '方形'
  return (CAMERA_SHAPES as readonly string[]).includes(value)
    ? (value as CameraShape)
    : '方形'
}

// ---------------------------------------------------------------- Cursor

/** Swift CursorAssetID 是 RawRepresentable 字符串结构体；TS 侧直接用字符串。 */

export const CURSOR_ASSET_SYSTEM_ARROW = 'system.arrow'
export const CURSOR_ASSET_AUTOMATIC = 'system.automatic'
export const CURSOR_ASSET_SYSTEM_POINTING_HAND = 'system.pointing-hand'
export const CURSOR_ASSET_SYSTEM_CROSSHAIR = 'system.crosshair'
export const CURSOR_ASSET_SYSTEM_IBEAM = 'system.ibeam'
export const CURSOR_ASSET_SYSTEM_OPEN_HAND = 'system.open-hand'
export const CURSOR_ASSET_SYSTEM_CLOSED_HAND = 'system.closed-hand'
export const CURSOR_ASSET_SYSTEM_NOT_ALLOWED = 'system.not-allowed'
export const CURSOR_ASSET_TOUCH_DOT = 'system.touch-dot'
export const CURSOR_ASSET_HIDDEN = 'system.hidden'

// 已退役的生成样式 ID：仅供旧项目解码，解析时统一回落到系统箭头。
export const RETIRED_CURSOR_ASSETS: readonly string[] = [
  'cursor.classic-lavender',
  'cursor.violet-glass',
  'cursor.graphite-ivory',
  'cursor.cream-coral',
]

export type CursorAppearance = '系统箭头' | '指向手势' | '十字准星' | '隐藏'
export const CURSOR_APPEARANCES: readonly CursorAppearance[] = [
  '系统箭头', '指向手势', '十字准星', '隐藏',
]

export type CursorClickEffectStyle = 'ripple' | 'glow' | 'pulse' | 'burst' | 'none'
export const CURSOR_CLICK_EFFECT_STYLES: readonly CursorClickEffectStyle[] = [
  'ripple', 'glow', 'pulse', 'burst', 'none',
]

export function cursorClickEffectDisplayName(style: CursorClickEffectStyle): string {
  switch (style) {
    case 'ripple': return '涟漪扩散'
    case 'glow': return '柔和光晕'
    case 'pulse': return '弹性双环'
    case 'burst': return '聚焦微闪'
    case 'none': return '无效果'
  }
}

export function cursorClickEffectDuration(style: CursorClickEffectStyle): number {
  switch (style) {
    case 'ripple': return 0.36
    case 'glow': return 0.32
    case 'pulse': return 0.38
    case 'burst': return 0.22
    case 'none': return 0.0
  }
}

export interface CursorStyle {
  assetID: string
  size: number
  hideWhenIdle: boolean
  idleDelay: number
  clickEffectStyle: CursorClickEffectStyle
  /** Swift HexColor? → '#RRGGBB' 字符串或 null。 */
  clickColor: string | null
  clickOpacity: number
  clickScale: number
  /** 热点锚定光标摆动强度；motion style 的「无」是唯一显式关闭方式。 */
  motionTiltStrength: number
}

export function makeCursorStyle(overrides: Partial<CursorStyle> = {}): CursorStyle {
  const style: CursorStyle = {
    assetID: CURSOR_ASSET_AUTOMATIC,
    size: 1.25,
    hideWhenIdle: false,
    idleDelay: 1.2,
    clickEffectStyle: 'ripple',
    clickColor: null,
    clickOpacity: 0.8,
    clickScale: 1.0,
    motionTiltStrength: 2.0,
    ...overrides,
  }
  style.assetID = style.assetID === '' ? CURSOR_ASSET_SYSTEM_ARROW : style.assetID
  style.size = clamp(style.size, 0.25, 6)
  style.idleDelay = clamp(style.idleDelay, 0.2, 8)
  style.clickOpacity = clamp(style.clickOpacity, 0.05, 1.0)
  style.clickScale = clamp(style.clickScale, 0.4, 3.0)
  style.motionTiltStrength = clamp(style.motionTiltStrength, 2, 4)
  return style
}

/** Swift showsClickEffect 计算属性。 */
export function cursorShowsClickEffect(style: CursorStyle): boolean {
  return style.clickEffectStyle !== 'none'
}

export function setCursorShowsClickEffect(style: CursorStyle, value: boolean): void {
  if (!value) {
    style.clickEffectStyle = 'none'
  } else if (style.clickEffectStyle === 'none') {
    style.clickEffectStyle = 'ripple'
  }
}

/** 兼容旧代码的 appearance 视图；新持久化与渲染必须用 assetID。 */
export function cursorAppearance(style: CursorStyle): CursorAppearance {
  switch (style.assetID) {
    case CURSOR_ASSET_SYSTEM_POINTING_HAND: return '指向手势'
    case CURSOR_ASSET_SYSTEM_CROSSHAIR: return '十字准星'
    case CURSOR_ASSET_HIDDEN: return '隐藏'
    default: return '系统箭头'
  }
}

function cursorAssetIDForAppearance(appearance: CursorAppearance): string {
  switch (appearance) {
    case '系统箭头': return CURSOR_ASSET_SYSTEM_ARROW
    case '指向手势': return CURSOR_ASSET_SYSTEM_POINTING_HAND
    case '十字准星': return CURSOR_ASSET_SYSTEM_CROSSHAIR
    case '隐藏': return CURSOR_ASSET_HIDDEN
  }
}

/**
 * 自定义解码（L712-749）：assetID 与 legacy appearance 二选一；
 * clickEffectStyle 与 legacy showsClickEffect 二选一。
 */
export function decodeCursorStyle(raw: unknown): CursorStyle {
  const obj = (raw ?? {}) as Record<string, unknown>
  const decodedAssetID = typeof obj.assetID === 'string' ? obj.assetID : undefined
  const legacyAppearance = CURSOR_APPEARANCES.includes(obj.appearance as CursorAppearance)
    ? (obj.appearance as CursorAppearance)
    : undefined
  let effectiveStyle: CursorClickEffectStyle
  if (
    typeof obj.clickEffectStyle === 'string' &&
    (CURSOR_CLICK_EFFECT_STYLES as readonly string[]).includes(obj.clickEffectStyle)
  ) {
    effectiveStyle = obj.clickEffectStyle as CursorClickEffectStyle
  } else if (typeof obj.showsClickEffect === 'boolean') {
    effectiveStyle = obj.showsClickEffect ? 'ripple' : 'none'
  } else {
    effectiveStyle = 'ripple'
  }
  return makeCursorStyle({
    assetID: decodedAssetID ?? cursorAssetIDForAppearance(legacyAppearance ?? '系统箭头'),
    size: typeof obj.size === 'number' ? obj.size : 1.25,
    hideWhenIdle: obj.hideWhenIdle === true,
    idleDelay: typeof obj.idleDelay === 'number' ? obj.idleDelay : 1.2,
    clickEffectStyle: effectiveStyle,
    clickColor: typeof obj.clickColor === 'string' ? obj.clickColor : null,
    clickOpacity: typeof obj.clickOpacity === 'number' ? obj.clickOpacity : 0.8,
    clickScale: typeof obj.clickScale === 'number' ? obj.clickScale : 1.0,
    motionTiltStrength: typeof obj.motionTiltStrength === 'number' ? obj.motionTiltStrength : 2.0,
  })
}

/** 编码（L751-762）：不写 motionTiltStrength（与 Swift encode 一致）。 */
export function encodeCursorStyle(style: CursorStyle): Record<string, unknown> {
  const out: Record<string, unknown> = {
    assetID: style.assetID,
    size: style.size,
    hideWhenIdle: style.hideWhenIdle,
    idleDelay: style.idleDelay,
    showsClickEffect: cursorShowsClickEffect(style),
    clickEffectStyle: style.clickEffectStyle,
    clickOpacity: style.clickOpacity,
    clickScale: style.clickScale,
  }
  if (style.clickColor !== null) out.clickColor = style.clickColor
  return out
}

// ---------------------------------------------------------------- NormalizedCrop

/** 归一化裁切矩形，原点在源左上角；与输出分辨率解耦，改画布尺寸/导出分辨率时保持稳定。 */
export interface NormalizedCrop {
  x: number
  y: number
  width: number
  height: number
}

export const NORMALIZED_CROP_FULL: NormalizedCrop = { x: 0, y: 0, width: 1, height: 1 }

export const cropLeft = (c: NormalizedCrop) => c.x
export const cropTop = (c: NormalizedCrop) => c.y
export const cropRight = (c: NormalizedCrop) => 1 - c.x - c.width
export const cropBottom = (c: NormalizedCrop) => 1 - c.y - c.height

export function clampedCrop(c: NormalizedCrop, minimumSize = 0.02): NormalizedCrop {
  const minimum = Math.min(Math.max(minimumSize, 0.001), 1)
  const safeX = clamp(c.x, 0, 1 - minimum)
  const safeY = clamp(c.y, 0, 1 - minimum)
  return {
    x: safeX,
    y: safeY,
    width: clamp(c.width, minimum, 1 - safeX),
    height: clamp(c.height, minimum, 1 - safeY),
  }
}

export function cropFromEdges(
  left: number,
  right: number,
  top: number,
  bottom: number,
  minimumSize = 0.02
): NormalizedCrop {
  const minimum = Math.min(Math.max(minimumSize, 0.001), 1)
  const safeLeft = clamp(left, 0, 1 - minimum)
  const safeTop = clamp(top, 0, 1 - minimum)
  const safeRight = clamp(right, 0, 1 - safeLeft - minimum)
  const safeBottom = clamp(bottom, 0, 1 - safeTop - minimum)
  return {
    x: safeLeft,
    y: safeTop,
    width: 1 - safeLeft - safeRight,
    height: 1 - safeTop - safeBottom,
  }
}

export function decodeNormalizedCrop(raw: unknown): NormalizedCrop {
  const obj = (raw ?? {}) as Record<string, unknown>
  return clampedCrop({
    x: typeof obj.x === 'number' ? obj.x : 0,
    y: typeof obj.y === 'number' ? obj.y : 0,
    width: typeof obj.width === 'number' ? obj.width : 1,
    height: typeof obj.height === 'number' ? obj.height : 1,
  })
}

// ---------------------------------------------------------------- CanvasStyle

export interface CanvasStyle {
  aspectRatio: CanvasAspectRatio
  customAspectRatio: CanvasCustomAspectRatio
  backgroundSource: BackgroundSource
  padding: number
  contentScale: number
  contentPosition: NormalizedPoint
  crop: NormalizedCrop
  cornerRadius: number
  borderWidth: number
  /** Swift HexColor → '#RRGGBB' 字符串。 */
  borderColor: string
  shadowStrength: number
  backgroundBlur: number
  insetOpacity: number
  screenFrame: ScreenFrameStyle
  /** 缩放屏幕框的自成工具栏/边框测量，不改变录制内容本身。 */
  screenFrameScale: number
  /** 独立缩放窗口/浏览器工具栏，不影响设备边框与内容矩形。 */
  screenFrameToolbarScale: number
  /** 手授外/内圆角覆盖；null 保留样式原生几何，老项目剪影不变。 */
  screenFrameOuterCornerRadius: number | null
  screenFrameContentCornerRadius: number | null
  /** 文本是屏幕框装饰的一部分，共享屏幕 3D/开场运动/预览/导出。 */
  screenFrameTitle: string
  screenFrameBrowserAddress: string
  /** 缩放背景网格与点阵的密度/间距/尺寸。 */
  patternScale: number
  /** 控制背景图案与动态流的不透明度/强度。 */
  patternOpacity: number
}

export function makeCanvasStyle(overrides: Partial<CanvasStyle> = {}): CanvasStyle {
  const style: CanvasStyle = {
    aspectRatio: '适应',
    customAspectRatio: { width: 16, height: 9 },
    backgroundSource: BACKGROUND_SOURCE_SAFE_FALLBACK,
    padding: 100,
    contentScale: 1,
    contentPosition: { x: 0.5, y: 0.5 },
    crop: NORMALIZED_CROP_FULL,
    cornerRadius: 24,
    borderWidth: 0,
    borderColor: HexColor.white.hexString,
    shadowStrength: 0.28,
    backgroundBlur: 0,
    insetOpacity: 0.125,
    screenFrame: 'none',
    screenFrameScale: 1,
    screenFrameToolbarScale: 1,
    screenFrameOuterCornerRadius: null,
    screenFrameContentCornerRadius: null,
    screenFrameTitle: '',
    screenFrameBrowserAddress: '',
    patternScale: 1,
    patternOpacity: 1,
    ...overrides,
  }
  style.crop = clampedCrop(style.crop)
  style.screenFrameScale = clamp(style.screenFrameScale, 0.6, 1.6)
  style.screenFrameToolbarScale = clamp(style.screenFrameToolbarScale, 0.65, 1.6)
  style.screenFrameOuterCornerRadius =
    style.screenFrameOuterCornerRadius === null
      ? null
      : clamp(style.screenFrameOuterCornerRadius, 0, 160)
  style.screenFrameContentCornerRadius =
    style.screenFrameContentCornerRadius === null
      ? null
      : clamp(style.screenFrameContentCornerRadius, 0, 160)
  style.screenFrameTitle = style.screenFrameTitle.slice(0, 120)
  style.screenFrameBrowserAddress = style.screenFrameBrowserAddress.slice(0, 240)
  style.patternScale = clamp(style.patternScale, 0.4, 6.0)
  style.patternOpacity = clamp(style.patternOpacity, 0.0, 1.0)
  return style
}

/** 自定义解码（L948-1002）：缺字段兜底逐项与 Swift init(from:projectSchemaVersion:) 一致。 */
export function decodeCanvasStyle(raw: unknown): CanvasStyle {
  const obj = (raw ?? {}) as Record<string, unknown>
  return makeCanvasStyle({
    aspectRatio: (obj.aspectRatio as CanvasAspectRatio) ?? '适应',
    customAspectRatio: decodeCanvasCustomAspectRatio(obj.customAspectRatio),
    backgroundSource:
      obj.backgroundSource !== undefined
        ? decodeBackgroundSource(obj.backgroundSource)
        : BACKGROUND_SOURCE_SAFE_FALLBACK,
    padding: typeof obj.padding === 'number' ? obj.padding : 100,
    contentScale: typeof obj.contentScale === 'number' ? obj.contentScale : 1,
    contentPosition:
      obj.contentPosition !== undefined
        ? (obj.contentPosition as NormalizedPoint)
        : { x: 0.5, y: 0.5 },
    crop: obj.crop !== undefined ? decodeNormalizedCrop(obj.crop) : NORMALIZED_CROP_FULL,
    cornerRadius: typeof obj.cornerRadius === 'number' ? obj.cornerRadius : 24,
    borderWidth: typeof obj.borderWidth === 'number' ? obj.borderWidth : 0,
    borderColor:
      typeof obj.borderHex === 'string'
        ? obj.borderHex
        : HexColor.white.hexString,
    shadowStrength: typeof obj.shadowStrength === 'number' ? obj.shadowStrength : 0.28,
    backgroundBlur: typeof obj.backgroundBlur === 'number' ? obj.backgroundBlur : 0,
    insetOpacity: typeof obj.insetOpacity === 'number' ? obj.insetOpacity : 0.125,
    screenFrame:
      obj.screenFrame !== undefined ? decodeScreenFrameStyle(obj.screenFrame) : 'none',
    screenFrameScale: typeof obj.screenFrameScale === 'number' ? obj.screenFrameScale : 1,
    screenFrameToolbarScale:
      typeof obj.screenFrameToolbarScale === 'number' ? obj.screenFrameToolbarScale : 1,
    screenFrameOuterCornerRadius:
      typeof obj.screenFrameOuterCornerRadius === 'number'
        ? obj.screenFrameOuterCornerRadius
        : null,
    screenFrameContentCornerRadius:
      typeof obj.screenFrameContentCornerRadius === 'number'
        ? obj.screenFrameContentCornerRadius
        : null,
    screenFrameTitle: typeof obj.screenFrameTitle === 'string' ? obj.screenFrameTitle : '',
    screenFrameBrowserAddress:
      typeof obj.screenFrameBrowserAddress === 'string' ? obj.screenFrameBrowserAddress : '',
    patternScale: typeof obj.patternScale === 'number' ? obj.patternScale : 1,
    patternOpacity: typeof obj.patternOpacity === 'number' ? obj.patternOpacity : 1,
  })
}

/** 编码（L1004-1034）：持久化键 borderHex；crop 编码前重新夹取。 */
export function encodeCanvasStyle(style: CanvasStyle): Record<string, unknown> {
  const out: Record<string, unknown> = {
    aspectRatio: style.aspectRatio,
    customAspectRatio: style.customAspectRatio,
    backgroundSource: style.backgroundSource,
    padding: style.padding,
    contentScale: style.contentScale,
    contentPosition: style.contentPosition,
    crop: clampedCrop(style.crop),
    cornerRadius: style.cornerRadius,
    borderWidth: style.borderWidth,
    borderHex: style.borderColor,
    shadowStrength: style.shadowStrength,
    backgroundBlur: style.backgroundBlur,
    insetOpacity: style.insetOpacity,
    screenFrame: style.screenFrame,
    screenFrameScale: style.screenFrameScale,
    screenFrameToolbarScale: style.screenFrameToolbarScale,
    screenFrameTitle: style.screenFrameTitle,
    screenFrameBrowserAddress: style.screenFrameBrowserAddress,
    patternScale: style.patternScale,
    patternOpacity: style.patternOpacity,
  }
  if (style.screenFrameOuterCornerRadius !== null) {
    out.screenFrameOuterCornerRadius = style.screenFrameOuterCornerRadius
  }
  if (style.screenFrameContentCornerRadius !== null) {
    out.screenFrameContentCornerRadius = style.screenFrameContentCornerRadius
  }
  return out
}

// ---------------------------------------------------------------- CanvasDimensions

export interface CanvasDimensions {
  width: number
  height: number
}

function evenFloat(value: number): number {
  return Math.max(Math.round(value / 2) * 2, 2)
}

function evenInt(value: number): number {
  return Math.max(value - (value % 2), 2)
}

/**
 * extension CanvasStyle.pixelDimensions（L1048-1132）。
 * 从实际录制像素解析全质量画布；裁切产生相应更小的原生画布，
 * 固定宽高比在该裁切像素包络内适配，绝不放大它。
 */
export function canvasPixelDimensions(
  style: CanvasStyle,
  resolution: CanvasResolution,
  sourceAspectRatio?: number | null,
  sourcePixelSize?: CanvasDimensions | null
): CanvasDimensions {
  if (resolution === '原始素材') {
    return sourcePixelDimensions(style, sourcePixelSize)
  }
  const preset = canvasResolutionPresetEdges(resolution)
  if (preset === null) {
    return sourcePixelDimensions(style, sourcePixelSize)
  }
  const shortEdge = preset.short
  switch (style.aspectRatio) {
    case '适应': {
      const ratio = Math.min(Math.max(sourceAspectRatio ?? 16 / 9, 0.2), 5)
      const longEdge = preset.long
      if (ratio >= 1) {
        return { width: evenInt(longEdge), height: evenFloat(longEdge / ratio) }
      }
      return { width: evenFloat(longEdge * ratio), height: evenInt(longEdge) }
    }
    case '16:9':
      return { width: (shortEdge * 16) / 9, height: shortEdge }
    case '4:3':
      return { width: (shortEdge * 4) / 3, height: shortEdge }
    case '9:16':
      return { width: shortEdge, height: (shortEdge * 16) / 9 }
    case '1:1':
      return { width: shortEdge, height: shortEdge }
    case '3:4':
      return { width: shortEdge, height: (shortEdge * 4) / 3 }
    case '2.39:1': case '1:2.39': case '自定义': {
      const ratio = resolvedFixedAspectRatio(style) ?? 1
      const long = preset.long
      return ratio >= 1
        ? { width: evenInt(long), height: evenFloat(long / ratio) }
        : { width: evenFloat(long * ratio), height: evenInt(long) }
    }
  }
}

function sourcePixelDimensions(
  style: CanvasStyle,
  sourcePixelSize?: CanvasDimensions | null
): CanvasDimensions {
  const source = sourcePixelSize ?? { width: 1920, height: 1080 }
  const crop = clampedCrop(style.crop)
  const croppedWidth = Math.max(source.width * crop.width, 2)
  const croppedHeight = Math.max(source.height * crop.height, 2)

  if (style.aspectRatio === '适应') {
    return { width: evenFloat(croppedWidth), height: evenFloat(croppedHeight) }
  }

  const targetRatio = resolvedFixedAspectRatio(style) ?? croppedWidth / croppedHeight
  if (croppedWidth / croppedHeight >= targetRatio) {
    return {
      width: evenFloat(croppedHeight * targetRatio),
      height: evenFloat(croppedHeight),
    }
  }
  return { width: evenFloat(croppedWidth), height: evenFloat(croppedWidth / targetRatio) }
}

// ---------------------------------------------------------------- AudioStyle

export interface AudioStyle {
  isSystemMuted: boolean
  isMicrophoneMuted: boolean
  systemVolume: number
  microphoneVolume: number
}

export function makeAudioStyle(overrides: Partial<AudioStyle> = {}): AudioStyle {
  const style: AudioStyle = {
    systemVolume: 0.82,
    microphoneVolume: 0.9,
    isSystemMuted: false,
    isMicrophoneMuted: false,
    ...overrides,
  }
  // 对应 Swift didSet 的写入期夹取。
  style.systemVolume = clamp(style.systemVolume, 0, 1)
  style.microphoneVolume = clamp(style.microphoneVolume, 0, 1)
  return style
}

export function decodeAudioStyle(raw: unknown): AudioStyle {
  const obj = (raw ?? {}) as Record<string, unknown>
  return makeAudioStyle({
    systemVolume: typeof obj.systemVolume === 'number' ? obj.systemVolume : 0.82,
    microphoneVolume: typeof obj.microphoneVolume === 'number' ? obj.microphoneVolume : 0.9,
    isSystemMuted: obj.isSystemMuted === true,
    isMicrophoneMuted: obj.isMicrophoneMuted === true,
  })
}

// ---------------------------------------------------------------- CameraStyle

export interface CameraStyle {
  shape: CameraShape
  position: NormalizedPoint
  size: number
  borderWidth: number
  shadowStrength: number
  roundness: number
  isMirrored: boolean
  isHidden: boolean
  scaleDuringZoom: number
  /** 摄像头遮罩内的视觉焦点；(0.5, 0.5) 是旧的居中 aspect-fill；与 position 刻意独立。 */
  contentPosition: NormalizedPoint
  /** 遮罩内的额外源缩放；绝不改变遮罩的画布矩形。 */
  contentScale: number
}

export function makeCameraStyle(overrides: Partial<CameraStyle> = {}): CameraStyle {
  return {
    shape: '方形',
    position: { x: 0.96, y: 0.47 },
    size: 0.29,
    borderWidth: 3,
    shadowStrength: 0.25,
    roundness: 0.5,
    isMirrored: true,
    isHidden: false,
    scaleDuringZoom: 0.7,
    contentPosition: { x: 0.5, y: 0.5 },
    contentScale: 1,
    ...overrides,
  }
}

export function decodeCameraStyle(raw: unknown): CameraStyle {
  const obj = (raw ?? {}) as Record<string, unknown>
  return makeCameraStyle({
    shape: obj.shape !== undefined ? decodeCameraShape(obj.shape) : '方形',
    position:
      obj.position !== undefined ? (obj.position as NormalizedPoint) : { x: 0.96, y: 0.47 },
    size: typeof obj.size === 'number' ? obj.size : 0.29,
    borderWidth: typeof obj.borderWidth === 'number' ? obj.borderWidth : 3,
    shadowStrength: typeof obj.shadowStrength === 'number' ? obj.shadowStrength : 0.25,
    roundness: typeof obj.roundness === 'number' ? obj.roundness : 0.5,
    isMirrored: obj.isMirrored !== false,
    isHidden: obj.isHidden === true,
    scaleDuringZoom: typeof obj.scaleDuringZoom === 'number' ? obj.scaleDuringZoom : 0.7,
    contentPosition:
      obj.contentPosition !== undefined
        ? (obj.contentPosition as NormalizedPoint)
        : { x: 0.5, y: 0.5 },
    contentScale: typeof obj.contentScale === 'number' ? obj.contentScale : 1,
  })
}

// ---------------------------------------------------------------- MotionStyle（见 MotionStyle.ts）

export type { MotionStyle }
