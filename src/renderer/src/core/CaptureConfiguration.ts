/**
 * 采集配置领域模型（帧率、编解码、源、区域、诊断）。
 *
 * Swift source: Sources/RecorderCore/CaptureConfiguration.swift @ laogou717/dogsc 567fd6e
 * 逐行对照：OutputFrameRate / CameraCaptureResolution / CaptureSource /
 * SystemAudioScope / NormalizedRect / CaptureDimensions / CaptureCodec /
 * CaptureResolutionLimit / CaptureConfiguration / FrameIntervalDiagnostics /
 * FrameRateMeasurement。
 *
 * 平台差异说明：
 *   · UInt32 displayID/windowID → number（Electron desktopCapturer 也是 number）
 *   · Codable → decodeCaptureConfiguration / encodeCaptureConfiguration
 *     （缺字段兜底与 Swift init(from:) 逐项一致）
 */

import type { TimeInterval } from './ZoomAnimation'

// ---------------------------------------------------------------- OutputFrameRate

export type OutputFrameRate = 30 | 60 | 90 | 120

export const OUTPUT_FRAME_RATE_VALUES: readonly OutputFrameRate[] = [30, 60, 90, 120]

/** 仅解码兼容：产品收缩回稳定 60 FPS 录制/导出契约之前创建的工程。 */
export const EXPORT_PRODUCT_CHOICES: readonly OutputFrameRate[] = [30, 60]
export const CAPTURE_ENCODING_QUALITY_TARGET: OutputFrameRate = 60

export function outputFrameRateLabel(rate: OutputFrameRate): string {
  return `${rate} FPS`
}

export function outputFrameRateDuration(rate: OutputFrameRate): TimeInterval {
  return 1.0 / rate
}

/**
 * REC-002/EXP-002：采集保留 ScreenCaptureKit 实际交付的每一帧时间戳。
 * 这些只是 CFR 输出选项，绝不能当作回调侧的采集限流器。
 */

// ---------------------------------------------------------------- CameraCaptureResolution

/** 摄像头设备广播的具体分辨率。帧率刻意不做用户设置。 */
export interface CameraCaptureResolution {
  width: number
  height: number
}

export function cameraResolutionID(r: CameraCaptureResolution): string {
  return `${r.width}x${r.height}`
}

export function cameraResolutionLabel(r: CameraCaptureResolution): string {
  const { width, height } = r
  if ((width === 3840 && height === 2160) || (width === 4096 && height === 2160)) return '4K'
  if (width === 2560 && height === 1440) return '1440p'
  if (width === 1920 && height === 1080) return '1080p'
  if (width === 1280 && height === 720) return '720p'
  return `${width}×${height}`
}

export function cameraAspectRatioLabel(r: CameraCaptureResolution): string {
  const divisor = greatestCommonDivisor(r.width, r.height)
  return `${r.width / divisor}:${r.height / divisor}`
}

export function cameraResolutionFullLabel(r: CameraCaptureResolution): string {
  return `${cameraResolutionLabel(r)} · ${cameraAspectRatioLabel(r)} · ${r.width}×${r.height}`
}

function greatestCommonDivisor(lhs: number, rhs: number): number {
  let a = Math.max(Math.abs(lhs), 1)
  let b = Math.max(Math.abs(rhs), 1)
  while (b !== 0) {
    const t = a % b
    a = b
    b = t
  }
  return Math.max(a, 1)
}

// ---------------------------------------------------------------- 源与作用域

export type CaptureSource = 'display' | 'window' | 'area' | 'device'

export const CAPTURE_SOURCE_LABELS: Record<CaptureSource, string> = {
  display: '整块屏幕',
  window: '单个窗口',
  area: '自选区域',
  device: 'iOS 设备',
}

export type SystemAudioScope = 'all' | 'selectedApplication'

export const SYSTEM_AUDIO_SCOPE_LABELS: Record<SystemAudioScope, string> = {
  all: '全部系统声音',
  selectedApplication: '所选窗口 App',
}

// ---------------------------------------------------------------- NormalizedRect

export interface NormalizedRect {
  x: number
  y: number
  width: number
  height: number
}

export function makeNormalizedRect(
  x: number,
  y: number,
  width: number,
  height: number
): NormalizedRect {
  return { x, y, width, height }
}

export function constrainedRect(rect: NormalizedRect): NormalizedRect {
  const safeX = Math.min(Math.max(rect.x, 0), 1)
  const safeY = Math.min(Math.max(rect.y, 0), 1)
  return {
    x: safeX,
    y: safeY,
    width: Math.min(Math.max(rect.width, 0.02), 1 - safeX),
    height: Math.min(Math.max(rect.height, 0.02), 1 - safeY),
  }
}

// ---------------------------------------------------------------- CaptureDimensions

export interface CaptureDimensions {
  width: number
  height: number
}

export function makeCaptureDimensions(width: number, height: number): CaptureDimensions {
  return { width, height }
}

/** 缩到 H.264 兼容包络内（长宽取偶），绝不放大源。 */
export function h264CompatibleDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maximumWidth = 4096,
  maximumHeight = 2304
): CaptureDimensions {
  const safeWidth = Math.max(sourceWidth, 2)
  const safeHeight = Math.max(sourceHeight, 2)
  const scale = Math.min(
    1,
    maximumWidth / safeWidth,
    maximumHeight / safeHeight
  )
  const width = Math.max(Math.floor(safeWidth * scale / 2) * 2, 2)
  const height = Math.max(Math.floor(safeHeight * scale / 2) * 2, 2)
  return { width, height }
}

// ---------------------------------------------------------------- 编解码与分辨率上限

export type CaptureCodec = 'hevc' | 'h264' | 'proRes422'

export const CAPTURE_CODEC_LABELS: Record<CaptureCodec, string> = {
  hevc: 'HEVC（H.265，原生分辨率）',
  h264: 'H.264（兼容模式，最高 4K）',
  proRes422: 'ProRes 422（原生分辨率）',
}

export function codecUsesMOVContainer(codec: CaptureCodec): boolean {
  return codec === 'proRes422'
}

export type CaptureResolutionLimit = 'native' | 'uhd' | 'fullHD'

export const CAPTURE_RESOLUTION_LIMIT_LABELS: Record<CaptureResolutionLimit, string> = {
  native: '原始分辨率',
  uhd: '最高 4K',
  fullHD: '最高 1080p',
}

/** 在横屏/竖屏包络内下采样；绝不放大源。 */
export function applyResolutionLimit(
  limit: CaptureResolutionLimit,
  size: CaptureDimensions
): CaptureDimensions {
  if (limit === 'native') return size
  const longEdge = limit === 'uhd' ? 3840 : 1920
  const shortEdge = limit === 'uhd' ? 2160 : 1080
  const landscape = size.width >= size.height
  return h264CompatibleDimensions(
    size.width,
    size.height,
    landscape ? longEdge : shortEdge,
    landscape ? shortEdge : longEdge
  )
}

// ---------------------------------------------------------------- CaptureConfiguration

/** 录制配置。Windows 版通过 desktopCapturer 落地，字段语义与 Swift 一致。 */
export interface CaptureConfiguration {
  source: CaptureSource
  displayID?: number | null
  displayName?: string | null
  windowID?: number | null
  windowName?: string | null
  selectedApplicationBundleIdentifier?: string | null
  selectedApplicationName?: string | null
  area?: NormalizedRect | null
  deviceID?: string | null
  deviceName?: string | null
  captureFrameRate: OutputFrameRate
  /** 录制期主编解码。导出是独立选择。 */
  captureCodec: CaptureCodec
  captureResolutionLimit: CaptureResolutionLimit
  hidesDesktopFiles: boolean
  hidesDock: boolean
  recordsSystemAudio: boolean
  systemAudioScope: SystemAudioScope
  recordsMicrophone: boolean
  microphoneDeviceID?: string | null
  microphoneDeviceName?: string | null
  recordsCamera: boolean
  cameraDeviceID?: string | null
  cameraDeviceName?: string | null
  cameraCaptureResolution?: CameraCaptureResolution | null
}

export function makeCaptureConfiguration(
  overrides: Partial<CaptureConfiguration> = {}
): CaptureConfiguration {
  return {
    source: overrides.source ?? 'display',
    displayID: overrides.displayID ?? null,
    displayName: overrides.displayName ?? null,
    windowID: overrides.windowID ?? null,
    windowName: overrides.windowName ?? null,
    selectedApplicationBundleIdentifier:
      overrides.selectedApplicationBundleIdentifier ?? null,
    selectedApplicationName: overrides.selectedApplicationName ?? null,
    area: overrides.area ?? null,
    deviceID: overrides.deviceID ?? null,
    deviceName: overrides.deviceName ?? null,
    captureFrameRate: overrides.captureFrameRate ?? 60,
    captureCodec: overrides.captureCodec ?? 'h264',
    captureResolutionLimit: overrides.captureResolutionLimit ?? 'native',
    hidesDesktopFiles: overrides.hidesDesktopFiles ?? false,
    hidesDock: overrides.hidesDock ?? false,
    recordsSystemAudio: overrides.recordsSystemAudio ?? true,
    systemAudioScope: overrides.systemAudioScope ?? 'all',
    recordsMicrophone: overrides.recordsMicrophone ?? false,
    microphoneDeviceID: overrides.microphoneDeviceID ?? null,
    microphoneDeviceName: overrides.microphoneDeviceName ?? null,
    recordsCamera: overrides.recordsCamera ?? false,
    cameraDeviceID: overrides.cameraDeviceID ?? null,
    cameraDeviceName: overrides.cameraDeviceName ?? null,
    cameraCaptureResolution: overrides.cameraCaptureResolution ?? null,
  }
}

/** 旧工程 JSON 解码。缺字段兜底与 Swift init(from:) 一致。 */
export function decodeCaptureConfiguration(raw: unknown): CaptureConfiguration {
  const o = (raw ?? {}) as Record<string, unknown>
  const str = (k: string): string | null =>
    typeof o[k] === 'string' ? (o[k] as string) : null
  const num = (k: string): number | null =>
    typeof o[k] === 'number' ? (o[k] as number) : null
  const bool = (k: string, fallback: boolean): boolean =>
    typeof o[k] === 'boolean' ? (o[k] as boolean) : fallback
  const rate = num('captureFrameRate')
  return {
    source: (str('source') as CaptureSource) ?? 'display',
    displayID: num('displayID'),
    displayName: str('displayName'),
    windowID: num('windowID'),
    windowName: str('windowName'),
    selectedApplicationBundleIdentifier: str('selectedApplicationBundleIdentifier'),
    selectedApplicationName: str('selectedApplicationName'),
    area: (o['area'] as NormalizedRect | undefined) ?? null,
    deviceID: str('deviceID'),
    deviceName: str('deviceName'),
    captureFrameRate: (OUTPUT_FRAME_RATE_VALUES as readonly number[]).includes(rate ?? 0)
      ? (rate as OutputFrameRate)
      : 60,
    captureCodec: (str('captureCodec') as CaptureCodec) ?? 'h264',
    captureResolutionLimit: (str('captureResolutionLimit') as CaptureResolutionLimit) ?? 'native',
    hidesDesktopFiles: bool('hidesDesktopFiles', false),
    hidesDock: bool('hidesDock', false),
    recordsSystemAudio: bool('recordsSystemAudio', true),
    systemAudioScope: (str('systemAudioScope') as SystemAudioScope) ?? 'all',
    recordsMicrophone: bool('recordsMicrophone', false),
    microphoneDeviceID: str('microphoneDeviceID'),
    microphoneDeviceName: str('microphoneDeviceName'),
    recordsCamera: bool('recordsCamera', false),
    cameraDeviceID: str('cameraDeviceID'),
    cameraDeviceName: str('cameraDeviceName'),
    cameraCaptureResolution: (o['cameraCaptureResolution'] as CameraCaptureResolution | undefined) ?? null,
  }
}

// ---------------------------------------------------------------- 帧间隔诊断

/**
 * 诊断可见采集卡顿的有序帧间隙证据。平均 FPS 会掩盖孤立与反复的长间隙，
 * 所以录制件把百分位、阈值计数与最长连续慢段作为独立事实保存。
 */
export interface FrameIntervalDiagnostics {
  sampleCount: number
  p50: TimeInterval
  p90: TimeInterval
  p95: TimeInterval
  p99: TimeInterval
  maximum: TimeInterval
  over25Milliseconds: number
  over33Milliseconds: number
  over50Milliseconds: number
  maximumConsecutiveOver33Milliseconds: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const position = (sorted.length - 1) * Math.min(Math.max(p, 0), 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  const fraction = position - lower
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction
}

/** 消费调用方的数组（过滤 + 原地排序），与 Swift init(consuming:) 等价。 */
export function makeFrameIntervalDiagnostics(intervals: number[]): FrameIntervalDiagnostics {
  const usable = intervals.filter(i => Number.isFinite(i) && i > 0)
  const over33 = usable.filter(i => i > 1.0 / 30.0)

  let currentRun = 0
  let longestRun = 0
  for (const interval of usable) {
    if (interval > 1.0 / 30.0) {
      currentRun += 1
      longestRun = Math.max(longestRun, currentRun)
    } else {
      currentRun = 0
    }
  }

  const sorted = [...usable].sort((a, b) => a - b)
  return {
    sampleCount: sorted.length,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    maximum: sorted.length ? sorted[sorted.length - 1] : 0,
    over25Milliseconds: usable.filter(i => i > 0.025).length,
    over33Milliseconds: over33.length,
    over50Milliseconds: usable.filter(i => i > 0.05).length,
    maximumConsecutiveOver33Milliseconds: longestRun,
  }
}

export const EMPTY_FRAME_INTERVAL_DIAGNOSTICS: FrameIntervalDiagnostics =
  makeFrameIntervalDiagnostics([])

// ---------------------------------------------------------------- FrameRateMeasurement

export interface FrameRateMeasurement {
  target: OutputFrameRate
  receivedFrames: number
  deliveredFrames: number
  writerDroppedFrames: number
  /** 无可编码图像的采样帧（静止/过渡）。占比高说明内容静止，属预期。 */
  idleFrames: number
  elapsed: TimeInterval
  maxFrameInterval: TimeInterval
  intervalDiagnostics: FrameIntervalDiagnostics
}

export function makeFrameRateMeasurement(opts: {
  target: OutputFrameRate
  receivedFrames?: number | null
  deliveredFrames: number
  writerDroppedFrames?: number
  idleFrames?: number
  elapsed: TimeInterval
  maxFrameInterval?: number
  intervalDiagnostics?: FrameIntervalDiagnostics
}): FrameRateMeasurement {
  const diagnostics = opts.intervalDiagnostics ?? EMPTY_FRAME_INTERVAL_DIAGNOSTICS
  return {
    target: opts.target,
    receivedFrames: opts.receivedFrames ?? opts.deliveredFrames,
    deliveredFrames: opts.deliveredFrames,
    writerDroppedFrames: opts.writerDroppedFrames ?? 0,
    idleFrames: opts.idleFrames ?? 0,
    elapsed: opts.elapsed,
    maxFrameInterval: Math.max(opts.maxFrameInterval ?? 0, diagnostics.maximum),
    intervalDiagnostics: diagnostics,
  }
}

/** 采集管线的真实上限（含空闲帧），不会超过屏幕刷新率。 */
export function sckDeliveryFPS(m: FrameRateMeasurement): number {
  if (!(m.elapsed > 0) || m.receivedFrames + m.idleFrames <= 1) return 0
  return (m.receivedFrames + m.idleFrames) / m.elapsed
}

export function isMostlyIdle(m: FrameRateMeasurement): boolean {
  return m.idleFrames > m.receivedFrames
}

export function actualFPS(m: FrameRateMeasurement): number {
  if (!(m.elapsed > 0) || m.deliveredFrames <= 1) return 0
  return (m.deliveredFrames - 1) / m.elapsed
}

export function deliveryRatio(m: FrameRateMeasurement): number {
  if (!(m.target > 0)) return 0
  return actualFPS(m) / m.target
}

export function averageFrameInterval(m: FrameRateMeasurement): number {
  if (m.receivedFrames <= 1 || !(m.elapsed > 0)) return 0
  return m.elapsed / (m.receivedFrames - 1)
}

export function estimatedDroppedFrames(m: FrameRateMeasurement): number {
  const expected = Math.round(m.elapsed * m.target) + 1
  const timelineMissing = Math.max(expected - m.deliveredFrames, 0)
  return Math.max(timelineMissing, m.writerDroppedFrames)
}

export function droppedFrameRatio(m: FrameRateMeasurement): number {
  const expected = m.deliveredFrames + estimatedDroppedFrames(m)
  if (expected <= 0) return 0
  return estimatedDroppedFrames(m) / expected
}
