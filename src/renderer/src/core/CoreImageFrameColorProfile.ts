/**
 * Swift source: Sources/DogSCApp/CoreImageFrameColorProfile.swift（92 行）@ 567fd6e
 *
 * L7-19  → FrameColorProfileError 两条中文文案
 * L24-40 → CoreImageFrameColorProfile.init（只接受 sdrDesktop）
 * L42-48 → makeContext 的 options
 * L50-62 → makeMetalContext（同一套色彩选项 + 指定命令队列）
 * L64-70 → avVideoColorProperties
 * L72-91 → applyAttachments（逐 buffer 设置三种附件）
 *
 * 原注释：把 RecorderCore 的色彩契约落成**唯一可执行形态**。预览与导出都必须
 * 通过它构造 Core Image 上下文，不许回退到跟随显示器的 RGB 空间。
 *
 * Windows 侧：Core Image / AVFoundation 换成语义等价的常量与 ffmpeg 参数，
 * 但「工作空间线性 sRGB、输出 sRGB、709 电视范围」这套约定必须原样保留。
 */

/** 色彩契约（Swift `FrameColorContract`，当前版本只有 sdrDesktop）。 */
export type FrameColorContract = 'sdrDesktop' | (string & {})

export const FRAME_COLOR_PROFILE_ERRORS = {
  unsupported: '当前版本只支持桌面 SDR 成片。',
  unavailableColorSpace: '系统无法建立 sRGB 色彩空间。',
} as const

export class FrameColorProfileError extends Error {
  readonly kind: 'unsupported' | 'unavailableColorSpace'
  readonly contract: FrameColorContract | null

  constructor(kind: 'unsupported' | 'unavailableColorSpace', contract: FrameColorContract | null = null) {
    super(
      kind === 'unsupported'
        ? FRAME_COLOR_PROFILE_ERRORS.unsupported
        : FRAME_COLOR_PROFILE_ERRORS.unavailableColorSpace
    )
    this.name = 'FrameColorProfileError'
    this.kind = kind
    this.contract = contract
  }
}

export interface FrameColorProfile {
  readonly contract: FrameColorContract
  /** 工作空间：线性 sRGB。 */
  readonly workingColorSpace: 'linear-srgb'
  /** 输出空间：sRGB。 */
  readonly outputColorSpace: 'srgb'
}

/**
 * 建立色彩配置。非 `sdrDesktop` 直接抛「只支持桌面 SDR 成片」——
 * 降级成 SDR 会让 HDR 素材的亮部整体压死，宁可拒绝也不出坏片。
 */
export function resolveFrameColorProfile(contract: FrameColorContract): FrameColorProfile {
  if (contract !== 'sdrDesktop') {
    throw new FrameColorProfileError('unsupported', contract)
  }
  return {
    contract,
    workingColorSpace: 'linear-srgb',
    outputColorSpace: 'srgb',
  }
}

/**
 * Core Image 上下文选项：工作/输出空间显式指定，`cacheIntermediates`
 * 由调用方决定（导出时关掉可省内存，预览时打开换速度）。
 */
export function frameColorProfileContextOptions(
  profile: FrameColorProfile,
  cacheIntermediates: boolean
): {
  cacheIntermediates: boolean
  workingColorSpace: FrameColorProfile['workingColorSpace']
  outputColorSpace: FrameColorProfile['outputColorSpace']
} {
  return {
    cacheIntermediates,
    workingColorSpace: profile.workingColorSpace,
    outputColorSpace: profile.outputColorSpace,
  }
}

/**
 * Metal 上下文：选项与 CPU 版**逐项相同**，只多一个命令队列。
 * 选项不一致会让 GPU 路径的中间结果落到另一个色彩空间，预览与导出就分叉了。
 */
export function frameColorProfileMetalContextOptions(
  profile: FrameColorProfile,
  cacheIntermediates: boolean
): { commandQueueRequired: true } & ReturnType<typeof frameColorProfileContextOptions> {
  return { commandQueueRequired: true, ...frameColorProfileContextOptions(profile, cacheIntermediates) }
}

/** 编码器色彩属性：原色 709 / 传输函数 sRGB / 矩阵 709（Swift L64-70）。 */
export const FRAME_COLOR_VIDEO_PROPERTIES = {
  colorPrimaries: 'ITU_R_709_2',
  transferFunction: 'sRGB',
  yCbCrMatrix: 'ITU_R_709_2',
} as const

export function avVideoColorProperties(profile: FrameColorProfile): typeof FRAME_COLOR_VIDEO_PROPERTIES {
  resolveFrameColorProfile(profile.contract)
  return FRAME_COLOR_VIDEO_PROPERTIES
}

/** 像素缓冲附件：三种键 + `.shouldPropagate`（下游滤镜继承，不回退默认）。 */
export const FRAME_COLOR_PIXEL_BUFFER_ATTACHMENTS = [
  { key: 'kCVImageBufferColorPrimariesKey', value: 'ITU_R_709_2', propagate: true },
  { key: 'kCVImageBufferTransferFunctionKey', value: 'sRGB', propagate: true },
  { key: 'kCVImageBufferYCbCrMatrixKey', value: 'ITU_R_709_2', propagate: true },
] as const

export function frameColorProfileAttachments(
  profile: FrameColorProfile
): typeof FRAME_COLOR_PIXEL_BUFFER_ATTACHMENTS {
  resolveFrameColorProfile(profile.contract)
  return FRAME_COLOR_PIXEL_BUFFER_ATTACHMENTS
}
