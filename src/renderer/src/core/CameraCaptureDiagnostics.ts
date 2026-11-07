/**
 * Swift source: Sources/RecorderCore/CameraCaptureDiagnostics.swift @ 567fd6e
 *
 * 逐结构对照：
 *   CameraCaptureDiagnostics                 L6-207
 *   CodingKeys                               L118-130
 *   init(from:) 旧清单缺字段补中性默认        L135-177
 *   encode(to:)                              L179-206
 *   systemDroppedFrames / applicationDropped L94-105
 *   received/appendedFramesPerSecond         L107-115
 *
 * 放在 RecorderCore 的原因：独立工程仓储校验器与签名的 App 必须共用
 * 完全相同的恢复清单 schema。
 */

export interface CameraCaptureDiagnostics {
  receivedFrames: number
  appendedFrames: number
  systemLateDrops: number
  systemOutOfBufferDrops: number
  systemDiscontinuityDrops: number
  systemUnknownDrops: number
  encoderBackpressureDrops: number
  nonMonotonicTimestampDrops: number
  /**
   * Core Media 尚未把数据准备好、或 CVPixelBuffer 布局结构不完整时
   * 被丢弃的采样。与设备/系统丢帧分开统计，用于在录制结束后定位
   * 重连与格式重协商失败。
   */
  invalidSampleDrops: number
  normalizedFrames: number
  formatChanges: number
  initialWidth: number | null
  initialHeight: number | null
  finalWidth: number | null
  finalHeight: number | null
  initialPixelFormat: number | null
  finalPixelFormat: number | null
  initialPlaneCount: number | null
  finalPlaneCount: number | null
  initialBytesPerRow: number[] | null
  finalBytesPerRow: number[] | null
  elapsed: number
  maximumFrameInterval: number
  /** AVCaptureSession 因设备被抢占（例如另一客户端拿走摄像头）而停止供帧。 */
  sessionInterruptionCount: number
  /** AVCaptureSession 通知通道报告的运行时错误次数。 */
  sessionRuntimeErrorCount: number
}

export interface CameraCaptureDiagnosticsOptions {
  receivedFrames: number
  appendedFrames: number
  systemLateDrops: number
  systemOutOfBufferDrops: number
  systemDiscontinuityDrops: number
  systemUnknownDrops: number
  encoderBackpressureDrops: number
  nonMonotonicTimestampDrops: number
  invalidSampleDrops?: number
  normalizedFrames: number
  formatChanges: number
  initialWidth: number | null
  initialHeight: number | null
  finalWidth: number | null
  finalHeight: number | null
  initialPixelFormat?: number | null
  finalPixelFormat?: number | null
  initialPlaneCount?: number | null
  finalPlaneCount?: number | null
  initialBytesPerRow?: number[] | null
  finalBytesPerRow?: number[] | null
  elapsed: number
  maximumFrameInterval: number
  sessionInterruptionCount?: number
  sessionRuntimeErrorCount?: number
}

/** Swift CameraCaptureDiagnostics.init(...) L40-92（不做夹取，逐字段透传）。 */
export function makeCameraCaptureDiagnostics(
  opts: CameraCaptureDiagnosticsOptions
): CameraCaptureDiagnostics {
  return {
    receivedFrames: opts.receivedFrames,
    appendedFrames: opts.appendedFrames,
    systemLateDrops: opts.systemLateDrops,
    systemOutOfBufferDrops: opts.systemOutOfBufferDrops,
    systemDiscontinuityDrops: opts.systemDiscontinuityDrops,
    systemUnknownDrops: opts.systemUnknownDrops,
    encoderBackpressureDrops: opts.encoderBackpressureDrops,
    nonMonotonicTimestampDrops: opts.nonMonotonicTimestampDrops,
    invalidSampleDrops: opts.invalidSampleDrops ?? 0,
    normalizedFrames: opts.normalizedFrames,
    formatChanges: opts.formatChanges,
    initialWidth: opts.initialWidth,
    initialHeight: opts.initialHeight,
    finalWidth: opts.finalWidth,
    finalHeight: opts.finalHeight,
    initialPixelFormat: opts.initialPixelFormat ?? null,
    finalPixelFormat: opts.finalPixelFormat ?? null,
    initialPlaneCount: opts.initialPlaneCount ?? null,
    finalPlaneCount: opts.finalPlaneCount ?? null,
    initialBytesPerRow: opts.initialBytesPerRow ?? null,
    finalBytesPerRow: opts.finalBytesPerRow ?? null,
    elapsed: opts.elapsed,
    maximumFrameInterval: opts.maximumFrameInterval,
    sessionInterruptionCount: opts.sessionInterruptionCount ?? 0,
    sessionRuntimeErrorCount: opts.sessionRuntimeErrorCount ?? 0,
  }
}

function intOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
}

function nullableInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null
}

function nullableIntArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  return value
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .map((v) => Math.trunc(v))
}

/**
 * Swift init(from:) L135-177 —— 完整性闸门之前写出的恢复清单没有新的
 * 布局字段，用中性默认值解码，避免诊断字段演进变成工程兼容性断裂。
 */
export function decodeCameraCaptureDiagnostics(
  raw: Record<string, unknown>
): CameraCaptureDiagnostics {
  return {
    receivedFrames: intOr(raw.receivedFrames, 0),
    appendedFrames: intOr(raw.appendedFrames, 0),
    systemLateDrops: intOr(raw.systemLateDrops, 0),
    systemOutOfBufferDrops: intOr(raw.systemOutOfBufferDrops, 0),
    systemDiscontinuityDrops: intOr(raw.systemDiscontinuityDrops, 0),
    systemUnknownDrops: intOr(raw.systemUnknownDrops, 0),
    encoderBackpressureDrops: intOr(raw.encoderBackpressureDrops, 0),
    nonMonotonicTimestampDrops: intOr(raw.nonMonotonicTimestampDrops, 0),
    invalidSampleDrops: intOr(raw.invalidSampleDrops, 0),
    normalizedFrames: intOr(raw.normalizedFrames, 0),
    formatChanges: intOr(raw.formatChanges, 0),
    initialWidth: nullableInt(raw.initialWidth),
    initialHeight: nullableInt(raw.initialHeight),
    finalWidth: nullableInt(raw.finalWidth),
    finalHeight: nullableInt(raw.finalHeight),
    initialPixelFormat: nullableInt(raw.initialPixelFormat),
    finalPixelFormat: nullableInt(raw.finalPixelFormat),
    initialPlaneCount: nullableInt(raw.initialPlaneCount),
    finalPlaneCount: nullableInt(raw.finalPlaneCount),
    initialBytesPerRow: nullableIntArray(raw.initialBytesPerRow),
    finalBytesPerRow: nullableIntArray(raw.finalBytesPerRow),
    elapsed: typeof raw.elapsed === 'number' ? raw.elapsed : 0,
    maximumFrameInterval:
      typeof raw.maximumFrameInterval === 'number' ? raw.maximumFrameInterval : 0,
    sessionInterruptionCount: intOr(raw.sessionInterruptionCount, 0),
    sessionRuntimeErrorCount: intOr(raw.sessionRuntimeErrorCount, 0),
  }
}

/** Swift encode(to:) L179-206 —— 可空字段省略（encodeIfPresent）。 */
export function encodeCameraCaptureDiagnostics(
  diagnostics: CameraCaptureDiagnostics
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    receivedFrames: diagnostics.receivedFrames,
    appendedFrames: diagnostics.appendedFrames,
    systemLateDrops: diagnostics.systemLateDrops,
    systemOutOfBufferDrops: diagnostics.systemOutOfBufferDrops,
    systemDiscontinuityDrops: diagnostics.systemDiscontinuityDrops,
    systemUnknownDrops: diagnostics.systemUnknownDrops,
    encoderBackpressureDrops: diagnostics.encoderBackpressureDrops,
    nonMonotonicTimestampDrops: diagnostics.nonMonotonicTimestampDrops,
    invalidSampleDrops: diagnostics.invalidSampleDrops,
    normalizedFrames: diagnostics.normalizedFrames,
    formatChanges: diagnostics.formatChanges,
    elapsed: diagnostics.elapsed,
    maximumFrameInterval: diagnostics.maximumFrameInterval,
    // 非可空：始终写出（含 0）
    sessionInterruptionCount: diagnostics.sessionInterruptionCount,
    sessionRuntimeErrorCount: diagnostics.sessionRuntimeErrorCount,
  }
  const optionalKeys = [
    'initialWidth',
    'initialHeight',
    'finalWidth',
    'finalHeight',
    'initialPixelFormat',
    'finalPixelFormat',
    'initialPlaneCount',
    'finalPlaneCount',
    'initialBytesPerRow',
    'finalBytesPerRow',
  ] as const
  for (const key of optionalKeys) {
    const value = diagnostics[key]
    if (value !== null && value !== undefined) out[key] = value
  }
  return out
}

/** Swift systemDroppedFrames L94-99。 */
export function systemDroppedFrames(diagnostics: CameraCaptureDiagnostics): number {
  return (
    diagnostics.systemLateDrops +
    diagnostics.systemOutOfBufferDrops +
    diagnostics.systemDiscontinuityDrops +
    diagnostics.systemUnknownDrops
  )
}

/** Swift applicationDroppedFrames L101-105。 */
export function applicationDroppedFrames(diagnostics: CameraCaptureDiagnostics): number {
  return (
    diagnostics.encoderBackpressureDrops +
    diagnostics.nonMonotonicTimestampDrops +
    diagnostics.invalidSampleDrops
  )
}

/**
 * Swift receivedFramesPerSecond L107-110 —— 注意 guard 里是 `> 1`：
 * 只有一帧时无法算区间，返回 0；有 N 帧时除以 N-1。
 */
export function receivedFramesPerSecond(diagnostics: CameraCaptureDiagnostics): number {
  if (!(diagnostics.elapsed > 0) || !(diagnostics.receivedFrames > 1)) return 0
  return (diagnostics.receivedFrames - 1) / diagnostics.elapsed
}

/** Swift appendedFramesPerSecond L112-115。 */
export function appendedFramesPerSecond(diagnostics: CameraCaptureDiagnostics): number {
  if (!(diagnostics.elapsed > 0) || !(diagnostics.appendedFrames > 1)) return 0
  return (diagnostics.appendedFrames - 1) / diagnostics.elapsed
}
