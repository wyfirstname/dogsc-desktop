/**
 * Swift source: Sources/RecorderCore/RecordingPerformanceDiagnostics.swift @ 567fd6e
 *
 * 逐结构对照：
 *   RecordingThermalState          L3-9
 *   RecordingPerformanceSample     L13-42
 *   RecordingPerformanceSummary    L44-156
 */

/** Swift RecordingThermalState。取值即原始字符串（Codable rawValue）。 */
export type RecordingThermalState = 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown'

/** 严重度排序：unknown 视为「未知」，比 nominal 还轻（Swift L147-155 返回 -1）。 */
function severity(state: RecordingThermalState): number {
  switch (state) {
    case 'nominal':
      return 0
    case 'fair':
      return 1
    case 'serious':
      return 2
    case 'critical':
      return 3
    case 'unknown':
      return -1
  }
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

/** 一次录制运行关联的低频系统/进程采样。Swift L13-42。 */
export interface RecordingPerformanceSample {
  elapsed: number
  processCPUPercent: number
  systemCPUPercent: number
  processResidentBytes: number
  processMetalAllocatedBytes: number | null
  availableDiskBytes: number | null
  thermalState: RecordingThermalState
}

export interface RecordingPerformanceSampleOptions {
  elapsed: number
  processCPUPercent: number
  systemCPUPercent: number
  processResidentBytes: number
  processMetalAllocatedBytes?: number | null
  availableDiskBytes?: number | null
  thermalState: RecordingThermalState
}

/** Swift RecordingPerformanceSample.init(...)。 */
export function makeRecordingPerformanceSample(
  opts: RecordingPerformanceSampleOptions
): RecordingPerformanceSample {
  return {
    elapsed: Math.max(finiteOrZero(opts.elapsed), 0),
    processCPUPercent: Math.max(finiteOrZero(opts.processCPUPercent), 0),
    // Swift 把系统 CPU 夹到 0...100（L33-36）
    systemCPUPercent: Math.min(Math.max(finiteOrZero(opts.systemCPUPercent), 0), 100),
    processResidentBytes: opts.processResidentBytes,
    processMetalAllocatedBytes: opts.processMetalAllocatedBytes ?? null,
    availableDiskBytes: opts.availableDiskBytes ?? null,
    thermalState: opts.thermalState,
  }
}

/**
 * 紧凑的峰值摘要 —— 录制进行中每来一个采样就滚动更新，
 * 不需要保留或重扫完整采样历史（逐采样真相仍以 JSONL 恢复日志为准）。
 *
 * Swift L44-156。
 */
export interface RecordingPerformanceSummary {
  sampleCount: number
  peakProcessCPUPercent: number
  peakSystemCPUPercent: number
  peakProcessResidentBytes: number
  peakProcessMetalAllocatedBytes: number | null
  minimumAvailableDiskBytes: number | null
  worstThermalState: RecordingThermalState
}

/** Swift `maximum(_:_:)` L129-136：nil 视为「无约束」，不参与比较。 */
function nullableMaximum(lhs: number | null, rhs: number | null): number | null {
  if (lhs === null) return rhs
  if (rhs === null) return lhs
  return Math.max(lhs, rhs)
}

/** Swift `minimum(_:_:)` L138-145。 */
function nullableMinimum(lhs: number | null, rhs: number | null): number | null {
  if (lhs === null) return rhs
  if (rhs === null) return lhs
  return Math.min(lhs, rhs)
}

/** Swift RecordingPerformanceSummary.empty L117-127。 */
export const EMPTY_PERFORMANCE_SUMMARY: RecordingPerformanceSummary = {
  sampleCount: 0,
  peakProcessCPUPercent: 0,
  peakSystemCPUPercent: 0,
  peakProcessResidentBytes: 0,
  peakProcessMetalAllocatedBytes: null,
  minimumAvailableDiskBytes: null,
  worstThermalState: 'unknown',
}

/** Swift RecordingPerformanceSummary.init(sample:) L61-69。 */
export function summaryFromSample(
  sample: RecordingPerformanceSample
): RecordingPerformanceSummary {
  return {
    sampleCount: 1,
    peakProcessCPUPercent: sample.processCPUPercent,
    peakSystemCPUPercent: sample.systemCPUPercent,
    peakProcessResidentBytes: sample.processResidentBytes,
    peakProcessMetalAllocatedBytes: sample.processMetalAllocatedBytes,
    minimumAvailableDiskBytes: sample.availableDiskBytes,
    worstThermalState: sample.thermalState,
  }
}

/** Swift including(_:) L75-97：滚动扩增，只保留峰值。 */
export function summaryIncludingSample(
  summary: RecordingPerformanceSummary,
  sample: RecordingPerformanceSample
): RecordingPerformanceSummary {
  const worst =
    severity(sample.thermalState) > severity(summary.worstThermalState)
      ? sample.thermalState
      : summary.worstThermalState
  return {
    sampleCount: summary.sampleCount + 1,
    peakProcessCPUPercent: Math.max(summary.peakProcessCPUPercent, sample.processCPUPercent),
    peakSystemCPUPercent: Math.max(summary.peakSystemCPUPercent, sample.systemCPUPercent),
    peakProcessResidentBytes: Math.max(
      summary.peakProcessResidentBytes,
      sample.processResidentBytes
    ),
    peakProcessMetalAllocatedBytes: nullableMaximum(
      summary.peakProcessMetalAllocatedBytes,
      sample.processMetalAllocatedBytes
    ),
    minimumAvailableDiskBytes: nullableMinimum(
      summary.minimumAvailableDiskBytes,
      sample.availableDiskBytes
    ),
    worstThermalState: worst,
  }
}

/** Swift RecordingPerformanceSummary.init(samples:) L53-59。 */
export function makeRecordingPerformanceSummary(
  samples: RecordingPerformanceSample[]
): RecordingPerformanceSummary {
  let summary: RecordingPerformanceSummary | null = null
  for (const sample of samples) {
    summary = summary === null ? summaryFromSample(sample) : summaryIncludingSample(summary, sample)
  }
  return summary ?? { ...EMPTY_PERFORMANCE_SUMMARY }
}
