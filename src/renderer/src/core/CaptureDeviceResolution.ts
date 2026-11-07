/**
 * Swift source: Sources/DogSCApp/CaptureDeviceResolution.swift（117 行）@ 567fd6e
 *
 * L6-10   → CaptureInputDeviceRole（camera / microphone / iosDevice）
 * L14-18  → CaptureInputDeviceDescriptor（唯一 ID 才是权威，不是显示名）
 * L20-46  → CaptureInputDeviceRequest（automatic / exact）
 * L48-80  → 错误三态 × 有无指定 ID = 六条中文文案
 * L82-117 → 解析策略
 *
 * 原注释：角色是**身份的一部分** —— 同名摄像头、麦克风或 iOS 端点永远不能
 * 满足另一种输入的请求。自动选择只能由显式的 `automatic` 表达，绝不从
 * 「精确查找失败」推断出来。
 */

export type CaptureInputDeviceRole = 'camera' | 'microphone' | 'iosDevice'

export const CAPTURE_INPUT_DEVICE_ROLES: readonly CaptureInputDeviceRole[] = [
  'camera',
  'microphone',
  'iosDevice',
]

export interface CaptureInputDeviceDescriptor {
  readonly role: CaptureInputDeviceRole
  readonly uniqueID: string
  readonly localizedName: string
}

export type CaptureInputDeviceRequest =
  | { readonly kind: 'automatic'; readonly role: CaptureInputDeviceRole }
  | { readonly kind: 'exact'; readonly role: CaptureInputDeviceRole; readonly uniqueID: string }

/** 选中的 ID 为 null 才走自动；空字符串是「指定了一个空 ID」，仍然精确匹配。 */
export function captureInputDeviceRequest(
  role: CaptureInputDeviceRole,
  selectedUniqueID: string | null | undefined
): CaptureInputDeviceRequest {
  if (selectedUniqueID !== null && selectedUniqueID !== undefined) {
    return { kind: 'exact', role, uniqueID: selectedUniqueID }
  }
  return { kind: 'automatic', role }
}

export function captureInputDeviceRequestRole(
  request: CaptureInputDeviceRequest
): CaptureInputDeviceRole {
  return request.role
}

export function captureInputDeviceRequestedUniqueID(
  request: CaptureInputDeviceRequest
): string | null {
  return request.kind === 'exact' ? request.uniqueID : null
}

export type CaptureInputDeviceResolutionErrorKind =
  | 'cameraUnavailable'
  | 'microphoneUnavailable'
  | 'iosDeviceUnavailable'

export interface CaptureInputDeviceResolutionErrorInfo {
  readonly kind: CaptureInputDeviceResolutionErrorKind
  readonly role: CaptureInputDeviceRole
  readonly requestedUniqueID: string | null
  readonly message: string
}

const ROLE_ERROR_KIND: Readonly<Record<CaptureInputDeviceRole, CaptureInputDeviceResolutionErrorKind>> = {
  camera: 'cameraUnavailable',
  microphone: 'microphoneUnavailable',
  iosDevice: 'iosDeviceUnavailable',
}

/** 六条文案（Swift L64-79）：有没有指定 ID 决定「没找到」还是「已断开」。 */
export const CAPTURE_DEVICE_ERROR_MESSAGES = {
  cameraAutomatic: '没有找到可用的摄像头。',
  cameraExact: '所选摄像头已断开或不可用，请重新选择。',
  microphoneAutomatic: '没有找到可用的麦克风。',
  microphoneExact: '所选麦克风已断开或不可用，请重新选择。',
  iosAutomatic: '请先选择要录制的 iPhone 或 iPad。',
  iosExact: '所选 iPhone 或 iPad 已断开或不可用，请重新选择。',
} as const

export function captureDeviceResolutionErrorMessage(
  role: CaptureInputDeviceRole,
  requestedUniqueID: string | null
): string {
  const hasRequested = requestedUniqueID !== null
  switch (role) {
    case 'camera':
      return hasRequested ? CAPTURE_DEVICE_ERROR_MESSAGES.cameraExact : CAPTURE_DEVICE_ERROR_MESSAGES.cameraAutomatic
    case 'microphone':
      return hasRequested
        ? CAPTURE_DEVICE_ERROR_MESSAGES.microphoneExact
        : CAPTURE_DEVICE_ERROR_MESSAGES.microphoneAutomatic
    case 'iosDevice':
      return hasRequested ? CAPTURE_DEVICE_ERROR_MESSAGES.iosExact : CAPTURE_DEVICE_ERROR_MESSAGES.iosAutomatic
  }
}

export class CaptureInputDeviceResolutionError extends Error {
  readonly info: CaptureInputDeviceResolutionErrorInfo

  constructor(role: CaptureInputDeviceRole, requestedUniqueID: string | null) {
    super(captureDeviceResolutionErrorMessage(role, requestedUniqueID))
    this.name = 'CaptureInputDeviceResolutionError'
    this.info = {
      kind: ROLE_ERROR_KIND[role],
      role,
      requestedUniqueID,
      message: this.message,
    }
  }
}

export type CaptureInputDeviceResolution =
  | { readonly ok: true; readonly device: CaptureInputDeviceDescriptor }
  | { readonly ok: false; readonly error: CaptureInputDeviceResolutionErrorInfo }

/**
 * 解析策略（Swift L86-116）。
 *
 * 两条硬规则：
 * 1. 只在**请求的角色**内匹配（角色是身份的一部分）；
 * 2. 默认 ID 只服务于 `automatic` 的摄像头 / 麦克风 —— iOS 端点永远要求精确 ID，
 *    因为「系统默认的那个 iPhone」这个概念不存在。
 */
export function resolveCaptureInputDevice(input: {
  readonly request: CaptureInputDeviceRequest
  readonly candidates: readonly CaptureInputDeviceDescriptor[]
  readonly defaultUniqueID: string | null
}): CaptureInputDeviceResolution {
  const request = input.request
  const roleCandidates = input.candidates.filter((device) => device.role === request.role)
  const failure = (requestedUniqueID: string | null): CaptureInputDeviceResolution => ({
    ok: false,
    error: new CaptureInputDeviceResolutionError(request.role, requestedUniqueID).info,
  })

  if (request.kind === 'exact') {
    const exact = roleCandidates.find((device) => device.uniqueID === request.uniqueID)
    return exact ? { ok: true, device: exact } : failure(request.uniqueID)
  }

  if (request.role === 'iosDevice' || input.defaultUniqueID === null) {
    return failure(null)
  }
  const defaultDevice = roleCandidates.find((device) => device.uniqueID === input.defaultUniqueID)
  return defaultDevice ? { ok: true, device: defaultDevice } : failure(null)
}
