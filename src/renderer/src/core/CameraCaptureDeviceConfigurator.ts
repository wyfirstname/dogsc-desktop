/**
 * Swift source: Sources/DogSCApp/CameraCaptureDeviceConfigurator.swift（112 行）@ 567fd6e
 *
 * L16-40  → applyPreferredFormat：先按选择器挑尺寸，再在同尺寸里取最大帧率
 * L42-67  → applyCameraFormat：精确尺寸；同尺寸多种像素编码时取最宽节奏范围
 * L69-81  → restoreAutomaticCadence：清空 min/max 帧时长，交还设备决定
 * L83-102 → apply：已经是指定格式就跳过；锁失败给出分层文案
 * L104-111→ 记录已配置尺寸
 *
 * 原注释：设备格式契约集中在预览/录制边界上，`CameraRecorder` 只负责采集生命周期，
 * 每次重配置都走同一条确定性路径。
 *
 * 关键取舍（L53-55）：同尺寸可能对应多种像素编码，这里只挑**节奏范围最宽**的那个，
 * 但**从不设置具体 FPS** —— 帧率设备说了算。
 */

import { preferredCameraFormatIndex } from './CameraCaptureFormatSelector'

export interface CameraFormatDescriptor {
  readonly width: number
  readonly height: number
  /** 该格式支持的帧率范围上界；空数组表示「不支持任何帧率」（应被排除）。 */
  readonly frameRateMaximums: readonly number[]
}

export interface CameraCaptureResolutionLike {
  readonly width: number
  readonly height: number
  readonly label: string
}

function maxFrameRate(format: CameraFormatDescriptor): number {
  return format.frameRateMaximums.length === 0 ? 0 : Math.max(...format.frameRateMaximums)
}

/**
 * 在候选里取「节奏范围最宽」的那个（Swift L34-38 / L56-60）。
 *
 * Swift 用 `max(by: { $0.max < $1.max })`：严格小于才替换，因此**并列时保留先出现的**。
 * 这里用显式 `>` 复刻同一行为，别改成 `>=`。
 */
export function widestCadenceFormat(
  candidates: readonly CameraFormatDescriptor[]
): CameraFormatDescriptor | null {
  let best: CameraFormatDescriptor | null = null
  for (const candidate of candidates) {
    if (best === null || maxFrameRate(candidate) > maxFrameRate(best)) best = candidate
  }
  return best
}

/** 只保留「尺寸匹配且确实支持帧率」的格式（Swift L28-33 / L47-52）。 */
export function formatsMatchingDimensions(
  formats: readonly CameraFormatDescriptor[],
  dimensions: { readonly width: number; readonly height: number }
): CameraFormatDescriptor[] {
  return formats.filter(
    (format) =>
      format.width === dimensions.width &&
      format.height === dimensions.height &&
      format.frameRateMaximums.length > 0
  )
}

export type PreferredFormatPlan =
  | { readonly kind: 'skip' }
  | { readonly kind: 'apply'; readonly format: CameraFormatDescriptor }

/**
 * 首选格式计划（Swift L16-40）。
 *
 * 选择器返回 null（没有合法尺寸）时**什么也不做** —— 保持设备当前格式，
 * 而不是随便挑一个：随便挑会把 4K 摄像头降到 480p 还静默。
 */
export function preferredFormatPlan(input: {
  readonly formats: readonly CameraFormatDescriptor[]
  readonly role: 'camera' | 'screen'
}): PreferredFormatPlan {
  const index = preferredCameraFormatIndex(
    input.formats.map((format) => ({ width: format.width, height: format.height })),
    input.role === 'camera'
  )
  if (index === null) return { kind: 'skip' }
  const target = input.formats[index]
  const candidates = formatsMatchingDimensions(input.formats, target)
  return { kind: 'apply', format: widestCadenceFormat(candidates) ?? input.formats[index] }
}

export type CameraFormatPlan =
  | { readonly kind: 'apply'; readonly format: CameraFormatDescriptor }
  | { readonly kind: 'unsupported'; readonly message: string }

/** 精确分辨率计划（Swift L42-67）。 */
export function cameraFormatPlan(
  formats: readonly CameraFormatDescriptor[],
  resolution: CameraCaptureResolutionLike,
  roleDisplayName: string
): CameraFormatPlan {
  const candidates = formatsMatchingDimensions(formats, resolution)
  const format = widestCadenceFormat(candidates)
  if (!format) {
    return {
      kind: 'unsupported',
      message: `${roleDisplayName}：摄像头不再支持所选分辨率 ${resolution.label}`,
    }
  }
  return { kind: 'apply', format }
}

/** 已经是指定格式就跳过锁定（Swift L89）。 */
export function cameraFormatNeedsApply(input: {
  readonly isSameFormat: boolean
}): boolean {
  return !input.isSameFormat
}

/**
 * 锁定失败的分层文案（Swift L94-101）：
 * 有标签时说「无法选择 <标签>」，没有说「无法锁定设备采集格式」，再拼系统原因。
 */
export function cameraFormatFailureMessage(input: {
  readonly label?: string | null
  readonly reason: string
  readonly roleDisplayName: string
}): string {
  const head = input.label ? `无法选择 ${input.label}` : '无法锁定设备采集格式'
  return `${input.roleDisplayName}：${head}：${input.reason}`
}

/** 恢复自动节奏（Swift L69-81）：min / max 帧时长都清成 invalid。 */
export const CAMERA_AUTOMATIC_CADENCE_FRAME_DURATIONS = { minimum: null, maximum: null } as const

/** 配置完成后的日志行（Swift L104-111）。 */
export function cameraConfiguredLogLine(dimensions: { readonly width: number; readonly height: number }): string {
  return `camera configured size=${dimensions.width}x${dimensions.height} fps=automatic`
}
