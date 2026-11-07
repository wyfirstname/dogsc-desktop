/**
 * Swift source: Sources/RecorderCore/AudioCaptureDiagnostics.swift @ 567fd6e
 *
 * 逐结构对照：
 *   AudioCaptureDiagnostics          L5-57
 *   init(...) 全字段非负夹取         L17-42
 *   totalDroppedSampleBuffers        L44-51
 *   appendedSampleBuffersPerSecond   L53-56
 *
 * 注意：音频回调是「包（packet / sample buffer）」驱动的，所以所有计数单位
 * 都是 sample buffer，而不是 PCM 帧。
 */

export interface AudioCaptureDiagnostics {
  receivedSampleBuffers: number
  appendedSampleBuffers: number
  ingressDrops: number
  writerBackpressureDrops: number
  invalidTimestampDrops: number
  nonMonotonicTimestampDrops: number
  formatChangeDrops: number
  otherDrops: number
  elapsed: number
  maximumSampleInterval: number
}

export interface AudioCaptureDiagnosticsOptions {
  receivedSampleBuffers: number
  appendedSampleBuffers: number
  ingressDrops?: number
  writerBackpressureDrops?: number
  invalidTimestampDrops?: number
  nonMonotonicTimestampDrops?: number
  formatChangeDrops?: number
  otherDrops?: number
  elapsed: number
  maximumSampleInterval?: number
}

/** 非负整数（Swift 的 Int 计数语义；浮点输入向下取整后夹取）。 */
function nonNegativeCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(Math.trunc(value), 0)
}

/** 非负有限浮点。Swift L37-41 对非有限值一律归零。 */
function nonNegativeFinite(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(value, 0)
}

/** Swift AudioCaptureDiagnostics.init(...) L17-42。 */
export function makeAudioCaptureDiagnostics(
  opts: AudioCaptureDiagnosticsOptions
): AudioCaptureDiagnostics {
  return {
    receivedSampleBuffers: nonNegativeCount(opts.receivedSampleBuffers),
    appendedSampleBuffers: nonNegativeCount(opts.appendedSampleBuffers),
    ingressDrops: nonNegativeCount(opts.ingressDrops),
    writerBackpressureDrops: nonNegativeCount(opts.writerBackpressureDrops),
    invalidTimestampDrops: nonNegativeCount(opts.invalidTimestampDrops),
    nonMonotonicTimestampDrops: nonNegativeCount(opts.nonMonotonicTimestampDrops),
    formatChangeDrops: nonNegativeCount(opts.formatChangeDrops),
    otherDrops: nonNegativeCount(opts.otherDrops),
    elapsed: nonNegativeFinite(opts.elapsed),
    maximumSampleInterval: nonNegativeFinite(opts.maximumSampleInterval),
  }
}

/** Swift totalDroppedSampleBuffers L44-51。 */
export function totalDroppedSampleBuffers(diagnostics: AudioCaptureDiagnostics): number {
  return (
    diagnostics.ingressDrops +
    diagnostics.writerBackpressureDrops +
    diagnostics.invalidTimestampDrops +
    diagnostics.nonMonotonicTimestampDrops +
    diagnostics.formatChangeDrops +
    diagnostics.otherDrops
  )
}

/** Swift appendedSampleBuffersPerSecond L53-56：elapsed 为 0 时返回 0。 */
export function appendedSampleBuffersPerSecond(
  diagnostics: AudioCaptureDiagnostics
): number {
  if (!(diagnostics.elapsed > 0)) return 0
  return diagnostics.appendedSampleBuffers / diagnostics.elapsed
}
