/**
 * 摄像头帧规格归一 —— 录制中途驱动换分辨率时，写入器保持同一个等比契约。
 *
 * Swift source: Sources/DogSCApp/CameraSampleWriterFrameNormalizer.swift（168 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - final class CameraSampleWriterFrameNormalizer        L8-168
 *   - static outputDimensions(configured…:source…)         L18-31  → cameraFrameOutputDimensions
 *   - prepareContract(width:height:pixelFormat:…)          L33-56  → cameraFrameContract
 *   - needsNormalization(_ imageBuffer:)                   L58-68  → cameraFrameNeedsNormalization
 *   - static needsNormalization(contract…:source…)         L70-81  → cameraFrameNeedsNormalization
 *   - normalizedImageBuffer(_:adaptor:roleName:)           L83-124 → CameraSampleFrameNormalizer
 *   - reset()                                              L126-134 → reset
 *   - prepareTransferSession(roleName:)                    L136-167 → CAMERA_FRAME_SCALING_MODE / 错误文案
 *
 * 原注释（L5-7）：
 *   Owns the fixed writer canvas and the VideoToolbox transfer session needed
 *   when a camera driver changes buffer dimensions during an active recording.
 *   The writer therefore keeps one aspect-preserving contract for the whole file.
 *
 * 迁移说明：`VTPixelTransferSession` 在 Windows 侧对应 D3D11 视频处理器或
 * `sws_scale`；`AVAssetWriterInputPixelBufferAdaptor` 的像素缓冲池对应 ring buffer。
 * 这里保留三件事：契约尺寸的决策、是否需要归一、以及五条错误文案。
 */

/** Swift L151-153：`kVTScalingMode_Trim` —— 等比裁切而不是拉伸。 */
export const CAMERA_FRAME_SCALING_MODE = 'trim'

/** Swift L154-157：转换会话必须开实时模式。 */
export const CAMERA_FRAME_REALTIME = true

/** 写入器契约：目标尺寸 + 像素格式。 */
export interface CameraFrameContract {
  readonly width: number
  readonly height: number
  readonly pixelFormat: number
}

/**
 * Swift L18-31：
 *   if let configuredWidth, let configuredHeight, 两者都 > 0 → 用配置值
 *   return (max(sourceWidth, 1), max(sourceHeight, 1))
 *
 * 源尺寸兜底为 1 而不是 0：尺寸为 0 的像素缓冲会让后续所有除法溢出。
 */
export function cameraFrameOutputDimensions(input: {
  readonly configuredWidth: number | null
  readonly configuredHeight: number | null
  readonly sourceWidth: number
  readonly sourceHeight: number
}): { readonly width: number; readonly height: number } {
  const { configuredWidth, configuredHeight } = input
  if (
    configuredWidth !== null &&
    configuredHeight !== null &&
    configuredWidth > 0 &&
    configuredHeight > 0
  ) {
    return { width: configuredWidth, height: configuredHeight }
  }
  return {
    width: Math.max(input.sourceWidth, 1),
    height: Math.max(input.sourceHeight, 1),
  }
}

/**
 * Swift L70-81：三处任一不同就需要归一。
 * 像素格式也算 —— 驱动换了输出格式（例如 420v → BGRA）但尺寸没变时，
 * 直接塞进写入器会得到花屏而不是报错，更难查。
 */
export function cameraFrameNeedsNormalization(input: {
  readonly contractWidth: number
  readonly contractHeight: number
  readonly contractPixelFormat: number
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly sourcePixelFormat: number
}): boolean {
  return (
    input.sourceWidth !== input.contractWidth ||
    input.sourceHeight !== input.contractHeight ||
    input.sourcePixelFormat !== input.contractPixelFormat
  )
}

/** Swift L33-56：`prepareContract` 的结论。 */
export interface CameraFrameContractPlan {
  readonly contract: CameraFrameContract
  /** 当前源帧是否已经满足契约（满足则不需要转换会话）。 */
  readonly requiresTransferSession: boolean
}

export function cameraFrameContract(input: {
  width: number
  height: number
  pixelFormat: number
  sourceWidth: number
  sourceHeight: number
  sourcePixelFormat: number
}): CameraFrameContractPlan {
  const contract: CameraFrameContract = {
    width: input.width,
    height: input.height,
    pixelFormat: input.pixelFormat,
  }
  return {
    contract,
    requiresTransferSession: cameraFrameNeedsNormalization({
      contractWidth: input.width,
      contractHeight: input.height,
      contractPixelFormat: input.pixelFormat,
      sourceWidth: input.sourceWidth,
      sourceHeight: input.sourceHeight,
      sourcePixelFormat: input.sourcePixelFormat,
    }),
  }
}

/** 归一化一步的结论。 */
export type CameraFrameNormalizeAction =
  | { readonly kind: 'passThrough' }
  | { readonly kind: 'transfer'; readonly width: number; readonly height: number }

/**
 * Swift L88-89：
 *   guard let width, let height else { return imageBuffer }
 *   guard needsNormalization(imageBuffer) else { return imageBuffer }
 *
 * 契约还没建立（三个字段都 nil）时原样返回 —— 此时写入器就是按源尺寸建的，
 * 什么都不用做。
 */
export function cameraFrameNormalizeAction(input: {
  readonly hasContract: boolean
  readonly contractWidth: number
  readonly contractHeight: number
  readonly contractPixelFormat: number
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly sourcePixelFormat: number
}): CameraFrameNormalizeAction {
  if (!input.hasContract) return { kind: 'passThrough' }
  if (
    !cameraFrameNeedsNormalization({
      contractWidth: input.contractWidth,
      contractHeight: input.contractHeight,
      contractPixelFormat: input.contractPixelFormat,
      sourceWidth: input.sourceWidth,
      sourceHeight: input.sourceHeight,
      sourcePixelFormat: input.sourcePixelFormat,
    })
  ) {
    return { kind: 'passThrough' }
  }
  return { kind: 'transfer', width: input.contractWidth, height: input.contractHeight }
}

/** Swift L94-98 / L105-110 / L117-122 / L143-148 / L159-165 的五条文案。 */
export const CAMERA_FRAME_ERROR_TEXT = {
  poolNotReady: '摄像头画面规格转换缓冲池尚未准备',
  poolAllocationFailed: '无法申请摄像头等比裁切缓冲',
  transferFailed: '无法把摄像头画面等比转换为',
  sessionCreationFailed: '无法创建摄像头画面规格转换器',
  sessionConfigurationFailed: '无法配置摄像头等比裁切',
} as const

export function cameraFramePoolAllocationMessage(status: number): string {
  return `${CAMERA_FRAME_ERROR_TEXT.poolAllocationFailed}（${status}）`
}

export function cameraFrameTransferMessage(width: number, height: number, status: number): string {
  return `${CAMERA_FRAME_ERROR_TEXT.transferFailed} ${width}x${height}（${status}）`
}

export function cameraFrameSessionCreationMessage(status: number): string {
  return `${CAMERA_FRAME_ERROR_TEXT.sessionCreationFailed}（${status}）`
}

export function cameraFrameSessionConfigurationMessage(
  scalingStatus: number,
  realtimeStatus: number
): string {
  return `${CAMERA_FRAME_ERROR_TEXT.sessionConfigurationFailed}（${scalingStatus}/${realtimeStatus}）`
}

/**
 * Swift L136-137：`guard transferSession == nil else { return }` —— 会话复用。
 * 每次归一都重建会话会让 13Hz 的摄像头流直接卡死。
 */
export function cameraFrameShouldCreateSession(hasSession: boolean): boolean {
  return !hasSession
}

/**
 * Swift L111：`CVBufferPropagateAttachments(imageBuffer, destination)`。
 * 附件里带色彩空间与显示矩阵，丢了两者会让归一后的帧颜色变样。
 */
export const CAMERA_FRAME_PROPAGATES_ATTACHMENTS = true

/**
 * Swift L8-168 的类形态。`transfer` 由宿主注入（D3D / sws_scale）。
 */
export class CameraSampleFrameNormalizer {
  private contract: CameraFrameContract | null = null
  private hasTransferSession = false

  /** Swift L10-12 的三个只读字段。 */
  get width(): number | null {
    return this.contract?.width ?? null
  }

  get height(): number | null {
    return this.contract?.height ?? null
  }

  get pixelFormat(): number | null {
    return this.contract?.pixelFormat ?? null
  }

  get isPrepared(): boolean {
    return this.hasTransferSession
  }

  /** Swift L33-56。reset 在赋值之前 —— 半旧半新的契约比没有契约更危险。 */
  prepareContract(input: {
    width: number
    height: number
    pixelFormat: number
    sourceWidth: number
    sourceHeight: number
    sourcePixelFormat: number
  }): CameraFrameContractPlan {
    this.reset()
    const plan = cameraFrameContract(input)
    this.contract = plan.contract
    this.hasTransferSession = plan.requiresTransferSession
    return plan
  }

  /** Swift L58-68 + L83-89。 */
  normalizeAction(input: {
    readonly sourceWidth: number
    readonly sourceHeight: number
    readonly sourcePixelFormat: number
  }): CameraFrameNormalizeAction {
    const contract = this.contract
    if (contract === null) return { kind: 'passThrough' }
    return cameraFrameNormalizeAction({
      hasContract: true,
      contractWidth: contract.width,
      contractHeight: contract.height,
      contractPixelFormat: contract.pixelFormat,
      sourceWidth: input.sourceWidth,
      sourceHeight: input.sourceHeight,
      sourcePixelFormat: input.sourcePixelFormat,
    })
  }

  /** Swift L126-134：清空三个字段并作废转换会话。 */
  reset(): void {
    this.hasTransferSession = false
    this.contract = null
  }
}
