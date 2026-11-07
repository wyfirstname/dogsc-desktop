/**
 * 录制就绪度 —— 开始录制前必须能回答的三件事：有没有权限、空间够不够、
 * 显示器刷新率撑不撑得住目标帧率。
 *
 * Swift source: Sources/DogSCApp/CaptureReadiness.swift（181 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct CaptureDisplay（5 字段）                  L7-46   → CaptureDisplay
 *   - captureDimensions(for:)（h264 走兼容包络）        L14-19  → captureDisplayDimensions
 *   - pickerLabel                                      L21-23  → captureDisplayPickerLabel
 *   - available(screens:)（displayID / 刷新率回退）     L25-45  → captureDisplayFromSnapshot
 *   - struct CaptureReadiness（6 字段）                L48-155
 *   - hasSufficientDisk                                L56-59  → captureHasSufficientDisk
 *   - insufficientDiskMessage                          L61-70  → captureInsufficientDiskMessage
 *   - displayCanShowTargetRate                         L72-75  → captureDisplayCanShowTargetRate
 *   - frameRateWarningText                             L77-85  → captureFrameRateWarningText
 *   - current(targetFrameRate:captureCodec:displayID:) L87-118 → captureReadinessCurrent
 *   - estimatedRecordingBytes(…)                       L120-141 → estimateRecordingBytes
 *   - availableDiskCapacity()                          L143-153 → captureAvailableDiskBytes
 *   - enum CapturePermissionState                      L157-181 → CapturePermissionState / labels
 *
 * 原注释（L129-131）：
 *   Conservative planning estimate; actual ProRes rate depends on raster
 *   dimensions and cadence and intentionally remains large.
 *
 * 原注释（L144-146）：
 *   New recordings are written to the working-project volume before being
 *   archived. Movies or the saved-project destination may be on another disk.
 *   Walk to an existing ancestor on first launch.
 *
 * 迁移说明：`NSScreen` / `CGDisplayCopyDisplayMode` / `CGPreflightScreenCaptureAccess`
 * / `FileManager.attributesOfFileSystem` 全部收敛为宿主注入的快照与 port。
 * `ByteCountFormatter(.file)` 在 Windows 侧自算十进制单位（与 Swift 的 .file
 * 1000 进制一致），文案保持中文原样。
 */

import { h264CompatibleDimensions, type CaptureCodec } from './CaptureConfiguration'

/** Swift L14-19：H.264 走兼容包络，其余编解码用原生分辨率。 */
export interface CaptureDimensionsValue {
  readonly width: number
  readonly height: number
}

/** Swift L7-12：一个可录制的显示器。 */
export interface CaptureDisplay {
  readonly id: number
  readonly name: string
  readonly width: number
  readonly height: number
  readonly refreshRate: number
}

/** Swift L14-19。 */
export function captureDisplayDimensions(
  display: CaptureDisplay,
  codec: CaptureCodec
): CaptureDimensionsValue {
  if (codec !== 'h264') {
    return { width: display.width, height: display.height }
  }
  return h264CompatibleDimensions(display.width, display.height)
}

/** Swift L21-23：`名字 · 宽×高 · 60 Hz`。 */
export function captureDisplayPickerLabel(display: CaptureDisplay): string {
  return `${display.name} · ${display.width}×${display.height} · ${display.refreshRate} Hz`
}

/**
 * Swift L31-43：单个屏幕 → `CaptureDisplay`。
 *
 * 三处兜底都要保留：
 *   - 拿不到 displayID 的屏幕直接跳过（`compactMap` 的语义）
 *   - 模式刷新率非正值时回退到 `maximumFramesPerSecond`，再不行给 1
 *     —— 注意不是给 60，上游这里就是 `max(…, 1)`
 *   - 像素宽高为 0 时兜底 1
 */
export function captureDisplayFromSnapshot(input: {
  readonly displayID: number | null
  readonly name: string
  readonly modeRefreshRate: number
  readonly maximumFramesPerSecond: number
  readonly pixelWidth: number
  readonly pixelHeight: number
}): CaptureDisplay | null {
  if (input.displayID == null) return null
  const refreshRate =
    input.modeRefreshRate > 0
      ? Math.round(input.modeRefreshRate)
      : Math.max(input.maximumFramesPerSecond, 1)
  return {
    id: input.displayID,
    name: input.name,
    width: Math.max(input.pixelWidth, 1),
    height: Math.max(input.pixelHeight, 1),
    refreshRate,
  }
}

/** Swift L48-55：开始录制前的六项前置。 */
export interface CaptureReadiness {
  readonly hasScreenRecordingPermission: boolean
  readonly availableDiskBytes: number | null
  readonly estimatedOneMinuteBytes: number
  readonly displayRefreshRate: number | null
  readonly targetFrameRate: number
  readonly captureCodec: CaptureCodec
}

/**
 * Swift L56-59：`availableDiskBytes` 为 null 时**视为够用**。
 *
 * 拿不到容量不该阻止录制 —— 这是上游明确的选择（`guard let … else { return true }`）。
 */
export function captureHasSufficientDisk(readiness: CaptureReadiness): boolean {
  if (readiness.availableDiskBytes == null) return true
  return readiness.availableDiskBytes >= readiness.estimatedOneMinuteBytes
}

/**
 * Swift L61-70：空间不足文案。
 *
 * 三个数字都有含义：需要多少、现在可用多少、**还差多少**
 * （`estimated − available`，`available` 先夹到 0 免得负数变成「还差 −2 GB」）。
 */
export function captureInsufficientDiskMessage(readiness: CaptureReadiness): string | null {
  const available = readiness.availableDiskBytes
  if (available == null) return null
  if (captureHasSufficientDisk(readiness)) return null
  const safeAvailable = Math.max(available, 0)
  const required = formatFileByteCount(readiness.estimatedOneMinuteBytes)
  const current = formatFileByteCount(safeAvailable)
  const shortfall = formatFileByteCount(readiness.estimatedOneMinuteBytes - safeAvailable)
  return `开始录制需预留约 1 分钟的空间（${required}），当前可用 ${current}。请再释放约 ${shortfall} 后重试。`
}

/** Swift L72-75：刷新率未知时视为能显示。 */
export function captureDisplayCanShowTargetRate(readiness: CaptureReadiness): boolean {
  if (readiness.displayRefreshRate == null) return true
  return readiness.displayRefreshRate >= readiness.targetFrameRate
}

/** Swift L77-85：刷新率低于目标帧率时的提示。 */
export function captureFrameRateWarningText(readiness: CaptureReadiness): string | null {
  const rate = readiness.displayRefreshRate
  if (rate == null) return null
  if (rate >= readiness.targetFrameRate) return null
  return `目标为 ${readiness.targetFrameRate} FPS，但显示器当前仅报告 ${rate} Hz；录制会保留实际帧率，不会补帧冒充。`
}

/**
 * Swift L143-153：沿目录向上找到第一个存在的祖先再问容量。
 *
 * 首次启动时工作目录还不存在，`attributesOfFileSystem` 会直接失败并返回 null
 * —— 那会让「空间不足」的检查静默失效。所以先走一遍 `deleteLastPathComponent()`
 * 直到命中已有目录或到根。
 *
 * `pathExists` 由宿主注入（Node 侧 `fs.existsSync`）；`freeBytesAtPath` 返回
 * null 表示查询失败。
 */
export function captureAvailableDiskBytes(input: {
  readonly workingFolder: string
  readonly pathExists: (path: string) => boolean
  readonly freeBytesAtPath: (path: string) => number | null
}): number | null {
  let directory = input.workingFolder
  while (!input.pathExists(directory) && directory !== '/') {
    const cut = directory.lastIndexOf('/')
    if (cut <= 0) {
      directory = '/'
      break
    }
    directory = directory.slice(0, cut)
  }
  return input.freeBytesAtPath(directory)
}

/**
 * Swift L120-141：估算「一分钟要多少字节」。
 *
 * - ProRes 422 用 `max(宽 × 高 × 帧率 × 2, 100_000_000)` —— 故意保守偏大，
 *   因为真实码率随画面复杂度浮动，宁可提醒早了
 * - 其它编解码走 `ExportEncodingPolicy.videoBitrate`
 * - 系统音频固定预留 192 kbps（`192_000`）
 * - `× duration / 8`：比特转字节用**除 8**，写成乘 8 会大 64 倍
 */
export function estimateRecordingBytes(input: {
  readonly width: number
  readonly height: number
  readonly frameRate: number
  readonly codec: CaptureCodec
  readonly duration: number
  readonly exportBitrate: (width: number, height: number, frameRate: number) => number
}): number {
  const videoBitsPerSecond =
    input.codec === 'proRes422'
      ? Math.max(input.width * input.height * input.frameRate * 2, 100_000_000)
      : input.exportBitrate(input.width, input.height, input.frameRate)
  const totalBitsPerSecond = videoBitsPerSecond + 192_000
  return Math.trunc((totalBitsPerSecond * input.duration) / 8)
}

/** Swift L87-118：`current(...)` 的纯决策部分。 */
export interface CaptureReadinessCurrentInput {
  readonly displays: readonly CaptureDisplay[]
  readonly displayID: number | null
  readonly targetFrameRate: number
  readonly captureCodec: CaptureCodec
  readonly hasScreenRecordingPermission: boolean
  readonly availableDiskBytes: number | null
  readonly exportBitrate: (width: number, height: number, frameRate: number) => number
}

/** Swift L95-101：找不到指定显示器时的占位（1920×1080 / 60 Hz）。 */
export const CAPTURE_UNKNOWN_DISPLAY: CaptureDisplay = {
  id: 0,
  name: '未知显示器',
  width: 1920,
  height: 1080,
  refreshRate: 60,
}

/**
 * Swift L93-118：组装就绪度。
 *
 * 选屏规则是 `displayID == nil || $0.id == displayID` —— 传 null 时取**第一个**
 * 屏幕（不是主屏的概念，是靠数组顺序），这是上游的行为，照搬。
 */
export function captureReadinessCurrent(input: CaptureReadinessCurrentInput): CaptureReadiness {
  const display =
    input.displays.find(
      (candidate) => input.displayID == null || candidate.id === input.displayID
    ) ?? CAPTURE_UNKNOWN_DISPLAY
  const dimensions = captureDisplayDimensions(display, input.captureCodec)
  return {
    hasScreenRecordingPermission: input.hasScreenRecordingPermission,
    availableDiskBytes: input.availableDiskBytes,
    estimatedOneMinuteBytes: estimateRecordingBytes({
      width: dimensions.width,
      height: dimensions.height,
      frameRate: input.targetFrameRate,
      codec: input.captureCodec,
      duration: 60,
      exportBitrate: input.exportBitrate,
    }),
    displayRefreshRate: display.refreshRate,
    targetFrameRate: input.targetFrameRate,
    captureCodec: input.captureCodec,
  }
}

/** Swift L157-181：摄像头权限四态。 */
export type CapturePermissionState = 'notDetermined' | 'restricted' | 'denied' | 'authorized'

/**
 * Swift L163-171：`AVAuthorizationStatus` → 四态。
 *
 * `@unknown default` 落到 `restricted` 而不是 `notDetermined` —— 未知状态
 * 当作「系统限制」处理，不会反复弹系统授权框。
 */
export function capturePermissionStateFromAuthorizationStatus(
  status: 'notDetermined' | 'restricted' | 'denied' | 'authorized' | 'unknown'
): CapturePermissionState {
  switch (status) {
    case 'notDetermined':
    case 'restricted':
    case 'denied':
    case 'authorized':
      return status
    default:
      return 'restricted'
  }
}

/** Swift L173-180。 */
export const CAPTURE_PERMISSION_STATE_LABELS: Readonly<Record<CapturePermissionState, string>> = {
  notDetermined: '首次使用时询问',
  restricted: '系统限制',
  denied: '未授权',
  authorized: '已授权',
}

export function capturePermissionStateLabel(state: CapturePermissionState): string {
  return CAPTURE_PERMISSION_STATE_LABELS[state]
}

/**
 * `ByteCountFormatter(.file)` 的等价实现：十进制（1000 进制）+ 一位小数。
 *
 * swift 的 .file 风格单位表是 byte / KB / MB / GB / TB…，且 0 字节输出 `Zero KB`；
 * 这里只服务「空间不足」文案，因此保留 `0 bytes` 的中性写法即可，
 * 但进制必须是 1000（用 1024 会让「要 1.2 GB」变成「要 1.1 GB」而对不上 Finder）。
 */
export function formatFileByteCount(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB'] as const
  if (!Number.isFinite(bytes)) return `0 ${units[0]}`
  let value = Math.abs(bytes)
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${bytes < 0 ? '-' : ''}${rounded} ${units[unit]}`
}
