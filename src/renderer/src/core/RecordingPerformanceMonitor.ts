/**
 * 录制性能采样器 —— 每个恢复心跳取一次「便宜且公开」的计数。
 *
 * Swift source: Sources/DogSCApp/RecordingPerformanceMonitor.swift（136 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - final class RecordingPerformanceMonitor       L8-136
 *   - private struct CPUCounters                    L9-14  → CpuCounters
 *   - 字段（startedAt / previousCounters / …）       L16-22 → 构造参数
 *   - init(volumeURL:metalDevice:)                  L24-27 → RecordingPerformanceMonitorPort
 *   - func sample()                                 L29-65 → sample()
 *   - var summary                                   L67-71 → summary
 *   - cpuCounters()（proc_pidinfo + host_statistics）L73-103 → 端口注入
 *   - availableDiskBytes(at:)                       L105-123 → availableDiskBytesFromCandidates
 *   - thermalState(_:)                              L125-135 → thermalStateFromName
 *
 * 迁移说明：`proc_pidinfo` / `host_statistics` / `MTLDevice` / `URLResourceValues`
 * 在 Windows 上分别对应 process.cpuUsage()、systeminformation 类库、GPU adapter 与
 * fs.statfs()，全部在本文件之外。这里保留**唯一**的算法部分：
 *   1. UInt64 计数器的环绕减法（Swift 的 `&-`）
 *   2. 两次采样之间的 CPU 百分比
 *   3. 可用磁盘字节数的三级回退顺序
 *   4. 缺一次样本就返回 null（不制造 0 值假象）
 */

import type {
  RecordingPerformanceSample,
  RecordingPerformanceSummary,
  RecordingThermalState,
} from './RecordingPerformanceDiagnostics'
import {
  summaryFromSample,
  summaryIncludingSample,
} from './RecordingPerformanceDiagnostics'

/** Swift L98-101：一次采样的原始计数器（UInt64 → bigint）。 */
export interface CpuCounters {
  /** pti_total_user &+ pti_total_system */
  readonly processNanoseconds: bigint
  /** pti_resident_size */
  readonly residentBytes: bigint
  /** user &+ system &+ nice */
  readonly systemUsedTicks: bigint
  /** user &+ system &+ idle &+ nice */
  readonly systemTotalTicks: bigint
}

/** Swift L48：纳秒 → 秒。 */
export const NANOSECONDS_PER_SECOND = 1_000_000_000n

/** Swift 的 `&-`：无符号 64 位环绕减法。 */
export function subtractWrappingUInt64(current: bigint, previous: bigint): bigint {
  return BigInt.asUintN(64, current - previous)
}

/**
 * Swift L34：`previousUptime.map { max(uptime - $0, 0) } ?? 0`。
 * 首次采样没有上一帧，间隔视为 0。
 */
export function performanceSampleWallDelta(
  uptime: number,
  previousUptime: number | null
): number {
  if (previousUptime === null) return 0
  const delta = uptime - previousUptime
  return Number.isFinite(delta) ? Math.max(delta, 0) : 0
}

/** Swift L47-49：进程 CPU 百分比。墙钟间隔为 0 时给 0，绝不除零。 */
export function processCPUPercent(
  processDeltaNanoseconds: bigint | null,
  wallDeltaSeconds: number
): number {
  if (processDeltaNanoseconds === null || !(wallDeltaSeconds > 0)) return 0
  return (Number(processDeltaNanoseconds) / 1_000_000_000 / wallDeltaSeconds) * 100
}

/** Swift L50-52：系统 CPU 百分比。总刻度为 0 时给 0。 */
export function systemCPUPercent(
  systemUsedDeltaTicks: bigint | null,
  systemTotalDeltaTicks: bigint | null
): number {
  if (systemUsedDeltaTicks === null || systemTotalDeltaTicks === null) return 0
  if (!(systemTotalDeltaTicks > 0n)) return 0
  return (Number(systemUsedDeltaTicks) / Number(systemTotalDeltaTicks)) * 100
}

/**
 * Swift L34-52 的合并形式：给定上一帧与这一帧，算出两个百分比。
 * 计数器必须成对存在 —— 只补其中一个是加密钥缺失的隐患。
 */
export interface PerformanceDelta {
  readonly wallDelta: number
  readonly processDelta: bigint | null
  readonly systemUsedDelta: bigint | null
  readonly systemTotalDelta: bigint | null
}

export function performanceDelta(
  current: CpuCounters,
  previous: CpuCounters | null,
  uptime: number,
  previousUptime: number | null
): PerformanceDelta {
  return {
    wallDelta: performanceSampleWallDelta(uptime, previousUptime),
    processDelta:
      previous === null
        ? null
        : subtractWrappingUInt64(current.processNanoseconds, previous.processNanoseconds),
    systemUsedDelta:
      previous === null
        ? null
        : subtractWrappingUInt64(current.systemUsedTicks, previous.systemUsedTicks),
    systemTotalDelta:
      previous === null
        ? null
        : subtractWrappingUInt64(current.systemTotalTicks, previous.systemTotalTicks),
  }
}

/**
 * Swift L105-123：可用磁盘字节数的三级回退。
 *   1. volumeAvailableCapacityForImportantUsage
 *   2. volumeAvailableCapacity
 *   3. attributesOfFileSystem[.systemFreeSize]
 * 注释（L116-118）说明了为什么需要第三级：某些挂载/虚拟卷不暴露 URL 容量键。
 */
export interface DiskCapacityCandidates {
  readonly importantUsage: number | null
  readonly capacity: number | null
  readonly fileSystemFree: number | null
}

export function availableDiskBytesFromCandidates(
  candidates: DiskCapacityCandidates
): number | null {
  if (candidates.importantUsage !== null) return candidates.importantUsage
  if (candidates.capacity !== null) return candidates.capacity
  return candidates.fileSystemFree
}

/** Swift L125-135：ThermalState 映射；未知枚举落到 unknown。 */
export function thermalStateFromName(raw: string): RecordingThermalState {
  switch (raw) {
    case 'nominal':
    case 'fair':
    case 'serious':
    case 'critical':
      return raw
    default:
      return 'unknown'
  }
}

/** Swift L53-61：一次样本的成形（不含第一次的增量）。 */
export interface PerformanceSampleInput {
  readonly uptime: number
  readonly startedAt: number
  readonly delta: PerformanceDelta
  readonly residentBytes: bigint
  readonly metalAllocatedBytes: number | null
  readonly availableDiskBytes: number | null
  readonly thermalState: RecordingThermalState
}

export function performanceSampleFrom(input: PerformanceSampleInput): RecordingPerformanceSample {
  const elapsed = input.uptime - input.startedAt
  return {
    elapsed: Number.isFinite(elapsed) ? Math.max(elapsed, 0) : 0,
    processCPUPercent: processCPUPercent(input.delta.processDelta, input.delta.wallDelta),
    systemCPUPercent: systemCPUPercent(input.delta.systemUsedDelta, input.delta.systemTotalDelta),
    processResidentBytes: Number(input.residentBytes),
    processMetalAllocatedBytes: input.metalAllocatedBytes,
    availableDiskBytes: input.availableDiskBytes,
    thermalState: input.thermalState,
  }
}

/**
 * Swift L16-27 + L29-71 的宿主抽象。
 * `readCpuCounters()` 返回 null 表示这一拍拿不到计数器 —— Swift 里是
 * `guard let current = Self.cpuCounters() else { return nil }`，
 * 采样直接缺席，`previousCounters` 不推进。
 */
export interface RecordingPerformanceMonitorPort {
  /** 等价 ProcessInfo.processInfo.systemUptime（秒，单调）。 */
  uptime(): number
  readCpuCounters(): CpuCounters | null
  /** 等价 metalDevice.map { UInt64($0.currentAllocatedSize) }。 */
  allocatedMetalBytes(): number | null
  availableDiskBytes(): number | null
  thermalState(): RecordingThermalState
}

/**
 * Swift L8-136 的类形态。
 *
 * 三个不变量：
 *   1. 拿不到计数器时返回 null，且**不**推进上一帧快照（否则下一拍会算出跨两拍的增量）。
 *   2. summary 只累积真正产出的样本。
 *   3. summary 读出来是快照拷贝，调用方改它不影响内部状态。
 */
export class RecordingPerformanceMonitor {
  private previousCounters: CpuCounters | null = null
  private previousUptime: number | null = null
  private summaryStorage: RecordingPerformanceSummary | null = null
  private readonly startedAt: number

  constructor(private readonly port: RecordingPerformanceMonitorPort) {
    this.startedAt = port.uptime()
  }

  /** Swift L29-65。 */
  sample(): RecordingPerformanceSample | null {
    const current = this.port.readCpuCounters()
    if (current === null) return null
    const uptime = this.port.uptime()
    const delta = performanceDelta(current, this.previousCounters, uptime, this.previousUptime)
    this.previousCounters = current
    this.previousUptime = uptime
    const sample = performanceSampleFrom({
      uptime,
      startedAt: this.startedAt,
      delta,
      residentBytes: current.residentBytes,
      metalAllocatedBytes: this.port.allocatedMetalBytes(),
      availableDiskBytes: this.port.availableDiskBytes(),
      thermalState: this.port.thermalState(),
    })
    this.summaryStorage =
      this.summaryStorage === null
        ? summaryFromSample(sample)
        : summaryIncludingSample(this.summaryStorage, sample)
    return sample
  }

  /** Swift L67-71：快照拷贝。 */
  get summary(): RecordingPerformanceSummary | null {
    return this.summaryStorage === null ? null : { ...this.summaryStorage }
  }

  /** 起始时间（秒，自宿主启动）。采样前的 elapsed 基准。 */
  get startUptime(): number {
    return this.startedAt
  }
}
