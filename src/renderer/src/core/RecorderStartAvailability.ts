/**
 * 录制开始可用性 —— Swift RecorderStartAvailability.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/RecorderStartAvailability.swift（47 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - enum RecorderCameraReadiness   L6-31  → RecorderCameraReadiness 联合 + 工厂/判定
 *   - enum RecorderStartAvailability L33-47 → RecorderStartAvailability 联合 + 工厂/判定
 *
 * 原注释（L3-5）：
 *   Recording may only begin after every enabled live input has produced real
 *   media. Merely selecting a camera is not readiness: permissions, USB device
 *   negotiation, and the first delivered sample can all still be pending.
 */

/**
 * Swift `CameraRuntimeFormat`（定义在 CaptureDeviceCatalog.swift L11-24）。
 * 该文件整体转写时会复用这里的结构；在那之前先在此声明，避免重复定义。
 */
export interface CameraRuntimeFormat {
  readonly width: number
  readonly height: number
  readonly framesPerSecond: number
}

/** Swift L6-10。 */
export type RecorderCameraReadiness =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'preparing' }
  | { readonly kind: 'ready'; readonly runtimeFormat: CameraRuntimeFormat }

/** Swift L11-21：不录摄像头 → disabled；录但还没有运行时格式 → preparing。 */
export function recorderCameraReadiness(
  recordsCamera: boolean,
  runtimeFormat: CameraRuntimeFormat | null
): RecorderCameraReadiness {
  if (!recordsCamera) return { kind: 'disabled' }
  if (runtimeFormat == null) return { kind: 'preparing' }
  return { kind: 'ready', runtimeFormat }
}

/** Swift L23-30：**preparing 是唯一不允许开录的状态**。 */
export function cameraReadinessPermitsRecording(readiness: RecorderCameraReadiness): boolean {
  switch (readiness.kind) {
    case 'disabled':
    case 'ready':
      return true
    case 'preparing':
      return false
  }
}

/** Swift L33-36。 */
export type RecorderStartAvailability = 'needsCaptureTarget' | 'preparingCamera' | 'ready'

/** Swift L38-44：没有采集目标优先于摄像头准备中。 */
export function recorderStartAvailability(
  hasCaptureTarget: boolean,
  cameraReadiness: RecorderCameraReadiness
): RecorderStartAvailability {
  if (!hasCaptureTarget) return 'needsCaptureTarget'
  return cameraReadinessPermitsRecording(cameraReadiness) ? 'ready' : 'preparingCamera'
}

/** Swift L46：`self == .ready`。 */
export function startAvailabilityPermitsRecording(availability: RecorderStartAvailability): boolean {
  return availability === 'ready'
}

/** 相机就绪状态的值语义相等（`Equatable`）。 */
export function cameraReadinessEquals(
  a: RecorderCameraReadiness,
  b: RecorderCameraReadiness
): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'ready' && b.kind === 'ready') {
    return (
      a.runtimeFormat.width === b.runtimeFormat.width &&
      a.runtimeFormat.height === b.runtimeFormat.height &&
      a.runtimeFormat.framesPerSecond === b.runtimeFormat.framesPerSecond
    )
  }
  return true
}
