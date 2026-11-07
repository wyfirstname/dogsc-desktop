/**
 * 采集设备目录 —— AVFoundation 发现边界的唯一入口。
 *
 * Swift source: Sources/DogSCApp/CaptureDeviceCatalog.swift（216 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct CaptureDeviceInfo（id / name）              L6-9   → CaptureDeviceInfo
 *   - struct CameraRuntimeFormat（宽/高/帧率）           L11-24 → CameraRuntimeFormat / runtimeFormatLabel
 *   - enum CaptureDeviceCatalog.Snapshot                 L29-33 → CaptureDeviceSnapshot
 *   - discoveryQueue（串行，防连接爆发并发枚举）          L37-39 → （宿主侧串行队列）
 *   - snapshotForUI()                                    L41-50 → captureDeviceSnapshot
 *   - resolutionsForUI(deviceUniqueID:)                  L52-58 → （同上，走队列）
 *   - enableIOSScreenCaptureDevices()                    L64-81 → captureEnableIOSScreenCaptureDecision
 *   - screenDevices / videoDevices / audioDevices        L83-93 → 三个 role 映射
 *   - cameraResolutions(deviceUniqueID:)                 L97-121 → captureDeviceResolutionsFromFormats
 *   - resolveLiveDevice(role:selectedUniqueID:)          L126-174 → captureResolveLiveDevice
 *   - deviceInfos(from:)                                 L176-180 → captureDeviceInfos
 *   - liveDevices(for:)（三种 DiscoverySession）          L182-215 → CAPTURE_DEVICE_DISCOVERY_ROLES
 *
 * 原注释（L26-27）：
 *   The AVFoundation boundary for device discovery. Discovery sessions are
 *   rebuilt for each catalog refresh and again for every recorder start.
 *
 * 原注释（L35-36）：
 *   UI refreshes must not wait for device discovery/driver format queries.
 *   Serialize them so connection bursts do not enumerate devices in parallel.
 *
 * 原注释（L95-96）：
 *   Enumerates resolutions the selected device actually advertises. Frame rate
 *   remains automatic and is measured from delivered sample PTS.
 *
 * 原注释（L123-125）：
 *   Rebuilds a discovery session at the actual preview/recording boundary. An
 *   explicit identity never consults AVCaptureDevice.default; automatic
 *   selection is available only to a genuinely unspecified camera or mic.
 *
 * 迁移说明：`AVCaptureDevice` / `CMIOObjectSetPropertyData` 在 Windows 侧由
 * `navigator.mediaDevices.enumerateDevices()` 提供。这里保留四件纯逻辑：
 *   1. 分辨率去重 + 排序（像素数降序、同像素按宽度降序）
 *   2. 「哪些格式算有效格式」的三条过滤
 *   3. 默认设备只补给 automatic 摄像头/麦克风（iOS 端点永远要求精确 ID）
 *   4. iOS 端点必须 `modelID === 'iOS Device'` 才算数
 */

import {
  cameraAspectRatioLabel,
  cameraResolutionLabel,
  type CameraCaptureResolution,
} from './CaptureConfiguration'
import {
  resolveCaptureInputDevice,
  type CaptureInputDeviceDescriptor,
  type CaptureInputDeviceRequest,
  type CaptureInputDeviceRole,
} from './CaptureDeviceResolution'

/** Swift L6-9：一个可被选中的设备。 */
export interface CaptureDeviceInfo {
  readonly id: string
  readonly name: string
}

/** Swift L11-24：运行时的具体格式。 */
export interface CameraRuntimeFormat {
  readonly width: number
  readonly height: number
  readonly framesPerSecond: number
}

/** Swift L16-18：`CameraCaptureResolution(width:height:)`。 */
export function runtimeFormatResolution(format: CameraRuntimeFormat): CameraCaptureResolution {
  return { width: format.width, height: format.height }
}

/**
 * Swift L20-23：`1080p · 16:9 · 30.0 FPS`。
 *
 * 帧率固定一位小数（`String(format: "%.1f", …)`），所以 30 会显示成 `30.0`
 * —— 这不是 bug，是与 Swift 对齐的结果。
 */
export function runtimeFormatLabel(format: CameraRuntimeFormat): string {
  const resolution = runtimeFormatResolution(format)
  return `${cameraResolutionLabel(resolution)} · ${cameraAspectRatioLabel(resolution)} · ${format.framesPerSecond.toFixed(1)} FPS`
}

/** Swift L29-33：一次刷新拿到的三张列表。 */
export interface CaptureDeviceSnapshot {
  readonly screenDevices: readonly CaptureDeviceInfo[]
  readonly cameras: readonly CaptureDeviceInfo[]
  readonly microphones: readonly CaptureDeviceInfo[]
}

/** Swift L176-180：驱动对象 → 展示对象。 */
export function captureDeviceInfos(
  devices: readonly { readonly uniqueID: string; readonly localizedName: string }[]
): CaptureDeviceInfo[] {
  return devices.map((device) => ({ id: device.uniqueID, name: device.localizedName }))
}

/** Swift L211：iOS 端点的 modelID 精确值。 */
export const CAPTURE_DEVICE_IOS_MODEL_ID = 'iOS Device'

/** Swift L186-206：三个角色各自的发现配置（Windows 侧用于说明取流约束）。 */
export interface CaptureDeviceDiscoveryRoleSpec {
  readonly role: CaptureInputDeviceRole
  /** 需要先打开「允许屏幕采集设备」开关。 */
  readonly requiresScreenCaptureDevicesEnabled: boolean
  /** 只接受 modelID 精确等于 iOS Device 的设备。 */
  readonly requiresIOSModelID: boolean
}

export const CAPTURE_DEVICE_DISCOVERY_ROLES: readonly CaptureDeviceDiscoveryRoleSpec[] = [
  { role: 'camera', requiresScreenCaptureDevicesEnabled: false, requiresIOSModelID: false },
  { role: 'microphone', requiresScreenCaptureDevicesEnabled: false, requiresIOSModelID: false },
  { role: 'iosDevice', requiresScreenCaptureDevicesEnabled: true, requiresIOSModelID: true },
]

/** Swift L210-213：只有 iOS 端点要求 modelID 精确匹配。 */
export function captureDeviceRequiresIOSModelID(role: CaptureInputDeviceRole): boolean {
  return CAPTURE_DEVICE_DISCOVERY_ROLES.find((spec) => spec.role === role)?.requiresIOSModelID ?? false
}

/**
 * Swift L208-214：设备是否进列表。
 *
 * 两层过滤：先 `isConnected`，再（仅 iOS）`modelID === "iOS Device"`。
 * 摄像头/麦克风**不**按 modelID 过滤 —— 外接任意品牌都该能用。
 */
export function captureDeviceIsEligible(input: {
  readonly role: CaptureInputDeviceRole
  readonly isConnected: boolean
  readonly modelID: string
}): boolean {
  if (!input.isConnected) return false
  if (captureDeviceRequiresIOSModelID(input.role)) {
    return input.modelID === CAPTURE_DEVICE_IOS_MODEL_ID
  }
  return true
}

/** Swift L64-81：打开「允许屏幕采集设备」的结果。 */
export function captureEnableIOSScreenCaptureDecision(status: number): boolean {
  // `CMIOObjectSetPropertyData` 返回 `noErr`（0）才算成功。
  return status === 0
}

/** Swift L104-113 的一路格式。 */
export interface CameraFormatDescriptor {
  readonly width: number
  readonly height: number
  readonly supportedFrameRateRangeCount: number
}

/**
 * Swift L103-121：从设备广播的格式里提取分辨率集合。
 *
 * 三条过滤缺一不可：
 *   - 宽 > 0、高 > 0（有些驱动会广播 0×0 的占位格式）
 *   - 至少有一个帧率区间（没有就意味着这个格式实际不可用）
 *
 * 去重按「宽×高」而不是浮点帧率 —— 帧率不做用户设置，同一分辨率下
 * 多个帧率变体对用户是同一个选项。
 *
 * 排序：像素数降序；像素数相同时**宽度**降序（2560×1440 排在 1440×2560 之前）。
 */
export function captureDeviceResolutionsFromFormats(
  formats: readonly CameraFormatDescriptor[]
): CameraCaptureResolution[] {
  const seen = new Set<string>()
  const resolutions: CameraCaptureResolution[] = []
  for (const format of formats) {
    if (!(format.width > 0)) continue
    if (!(format.height > 0)) continue
    if (format.supportedFrameRateRangeCount <= 0) continue
    const key = `${format.width}x${format.height}`
    if (seen.has(key)) continue
    seen.add(key)
    resolutions.push({ width: format.width, height: format.height })
  }
  return resolutions.sort((lhs, rhs) => {
    const lhsPixels = lhs.width * lhs.height
    const rhsPixels = rhs.width * rhs.height
    if (lhsPixels !== rhsPixels) return rhsPixels - lhsPixels
    return rhs.width - lhs.width
  })
}

/** Swift L137-146：`automatic` 时是否要问系统默认设备。 */
export function captureDeviceDefaultQueryForRequest(
  request: CaptureInputDeviceRequest
): 'none' | 'video' | 'audio' {
  if (request.kind === 'exact') return 'none'
  switch (request.role) {
    case 'camera':
      return 'video'
    case 'microphone':
      return 'audio'
    default:
      return 'none'
  }
}

/** Swift L126-174 的结果。 */
export type CaptureResolveLiveDeviceResult =
  | {
      readonly ok: true
      readonly device: CaptureInputDeviceDescriptor
      /** 是否把「系统默认设备」补进了候选列表。 */
      readonly appendedDefault: boolean
    }
  | {
      readonly ok: false
      readonly requestedUniqueID: string | null
    }

/**
 * Swift L126-174：在真正开始预览/录制的那一刻重建解析结果。
 *
 * 顺序很重要：
 *   1. 按请求决定要不要问系统默认设备（`exact` 永远不问）
 *   2. 默认设备**已连接**且**不在**候选里时补进去 —— 有些驱动只把它报给
 *      `AVCaptureDevice.default`，不出现在 DiscoverySession 里
 *   3. 走共享的 `resolveCaptureInputDevice` 策略
 *   4. 最后再按 uniqueID + **已连接**确认一次
 *
 * 第 4 步的 `isConnected` 复检不能省：第 3 步用的是快照，设备可能刚被拔掉。
 */
export function captureResolveLiveDevice(input: {
  readonly request: CaptureInputDeviceRequest
  readonly candidates: readonly CaptureInputDeviceDescriptor[]
  readonly defaultDevice: { readonly uniqueID: string; readonly isConnected: boolean } | null
}): CaptureResolveLiveDeviceResult {
  const devices = input.candidates.slice()
  let appendedDefault = false
  const query = captureDeviceDefaultQueryForRequest(input.request)
  const defaultDevice = query === 'none' ? null : input.defaultDevice
  if (
    defaultDevice != null &&
    defaultDevice.isConnected &&
    !devices.some((device) => device.uniqueID === defaultDevice.uniqueID)
  ) {
    devices.push({
      role: input.request.role,
      uniqueID: defaultDevice.uniqueID,
      localizedName: defaultDevice.uniqueID,
    })
    appendedDefault = true
  }
  const resolution = resolveCaptureInputDevice({
    request: input.request,
    candidates: devices,
    defaultUniqueID: query === 'none' ? null : (defaultDevice?.uniqueID ?? null),
  })
  if (!resolution.ok) {
    return { ok: false, requestedUniqueID: resolution.error.requestedUniqueID }
  }
  return { ok: true, device: resolution.device, appendedDefault }
}

/**
 * Swift L41-50：一次 UI 刷新同时取三张列表。
 *
 * Windows 侧没有「串行队列」，但必须保持同样的语义：连接爆发时不能并发枚举
 * （`enumerateDevices` 并发调用会互相打断授权提示）。宿主用一个共享的
 * pending promise 把并发请求折叠成一次。
 */
export class CaptureDeviceCatalogScheduler {
  private pending: Promise<CaptureDeviceSnapshot> | null = null

  constructor(private readonly enumerate: () => Promise<CaptureDeviceSnapshot>) {}

  snapshot(): Promise<CaptureDeviceSnapshot> {
    if (this.pending != null) return this.pending
    const task = this.enumerate().finally(() => {
      if (this.pending === task) this.pending = null
    })
    this.pending = task
    return task
  }

  /** 当前是否有一次枚举在飞（供断言）。 */
  get isEnumerating(): boolean {
    return this.pending != null
  }
}
