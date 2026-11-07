/**
 * Swift source: Sources/DogSCApp/CameraRuntimeFormatMonitor.swift（119 行）@ 567fd6e
 *
 * L6-42   → RollingHostTimeWindow（环形窗口）
 * L47-94  → CameraRuntimeFormatMonitor.observe
 * L96-100 → reset
 * L102-118→ 日志与 fourCC 解码
 *
 * 原注释：滚动节奏窗口用来上报摄像头**实际交付**的格式。把这套状态放在
 * `CameraRecorder` 之外，采集会话就只负责编排，不必再算遥测数学。
 */

/** 采样窗口容量（Swift `capacity: 31`）。 */
export const CAMERA_CADENCE_WINDOW_CAPACITY = 31
/** 至少这么多样本才用窗口估算帧率。 */
export const CAMERA_CADENCE_MINIMUM_SAMPLES = 8
/** 帧率上报的最小间隔（秒）。 */
export const CAMERA_CADENCE_REPORT_INTERVAL = 1
/** 帧率变化阈值。 */
export const CAMERA_CADENCE_FPS_DELTA = 0.5
/** 帧率小数位（`(fps * 10).rounded() / 10`）。 */
export const CAMERA_CADENCE_ROUNDING = 10

/** 环形主机时间窗口：容量固定、写入覆盖最旧值。 */
export class RollingHostTimeWindow {
  readonly capacity: number
  private values: number[] = []
  private startIndex = 0

  constructor(capacity: number) {
    this.capacity = Math.max(capacity, 1)
  }

  get count(): number {
    return this.values.length
  }

  get first(): number | null {
    return this.values.length === 0 ? null : this.values[this.startIndex]
  }

  get last(): number | null {
    if (this.values.length === 0) return null
    if (this.values.length < this.capacity) return this.values[this.values.length - 1]
    return this.values[(this.startIndex + this.values.length - 1) % this.capacity]
  }

  append(value: number): void {
    if (this.values.length < this.capacity) {
      this.values.push(value)
      return
    }
    this.values[this.startIndex] = value
    this.startIndex = (this.startIndex + 1) % this.capacity
  }

  reset(): void {
    this.values = []
    this.startIndex = 0
  }
}

export interface CameraPixelBufferLayoutLike {
  readonly isStructurallyValid: boolean
  readonly width: number
  readonly height: number
  readonly pixelFormat: number
  readonly planeCount: number
  readonly bytesPerRow: number
}

export interface CameraRuntimeFormat {
  readonly width: number
  readonly height: number
  readonly framesPerSecond: number
}

/**
 * 摄像头实际交付格式的监视器。
 *
 * `observe` 的收敛策略（Swift L83-89）：
 * - 分辨率变了 → 立刻上报（用户能直接看到画面形状变化）；
 * - 分辨率没变 → 必须**同时**满足「距上次上报 ≥ 1s」与「帧率差 ≥ 0.5」才上报，
 *   否则灯光闪烁导致的 ±0.2fps 抖动会把状态栏刷成心电图。
 */
export class CameraRuntimeFormatMonitor {
  private readonly samples = new RollingHostTimeWindow(CAMERA_CADENCE_WINDOW_CAPACITY)
  private lastReportedFormat: CameraRuntimeFormat | null = null
  private lastReportHostTime: number | null = null

  observe(input: {
    readonly layout: CameraPixelBufferLayoutLike
    readonly hostTime: number
    /** 样本自身时长（秒）；无效或非正时回退到窗口估算。 */
    readonly deliveredDuration: number
    /** 首帧的展示时间（Swift 用最后一次 `timelineTimestamp` 的等价物）。 */
    readonly timelineTimestamp?: number
  }): CameraRuntimeFormat | null {
    if (!input.layout.isStructurallyValid || !Number.isFinite(input.hostTime)) return null

    this.samples.append(input.hostTime)

    const delivered = input.deliveredDuration
    let framesPerSecond = Number.isFinite(delivered) && delivered > 0 ? 1 / delivered : 0
    const first = this.samples.first
    const last = this.samples.last
    if (
      this.samples.count >= CAMERA_CADENCE_MINIMUM_SAMPLES &&
      first !== null &&
      last !== null &&
      last > first
    ) {
      framesPerSecond = (this.samples.count - 1) / (last - first)
    }
    if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0) return null

    const format: CameraRuntimeFormat = {
      width: input.layout.width,
      height: input.layout.height,
      framesPerSecond:
        Math.round(framesPerSecond * CAMERA_CADENCE_ROUNDING) / CAMERA_CADENCE_ROUNDING,
    }

    const previous = this.lastReportedFormat
    if (previous) {
      const dimensionsChanged = previous.width !== format.width || previous.height !== format.height
      const enoughTimeElapsed =
        input.hostTime - (this.lastReportHostTime ?? Number.NEGATIVE_INFINITY) >= CAMERA_CADENCE_REPORT_INTERVAL
      const cadenceChanged =
        Math.abs(previous.framesPerSecond - format.framesPerSecond) >= CAMERA_CADENCE_FPS_DELTA
      if (!dimensionsChanged && !(enoughTimeElapsed && cadenceChanged)) return null
    }

    this.lastReportedFormat = format
    this.lastReportHostTime = input.hostTime
    return format
  }

  reset(): void {
    this.samples.reset()
    this.lastReportedFormat = null
    this.lastReportHostTime = null
  }

  /** 日志行（Swift L102-107）：样本尺寸 / 像素格式 / plane 数 / 行字节 / 帧率。 */
  logLine(format: CameraRuntimeFormat, layout: CameraPixelBufferLayoutLike): string {
    return (
      `camera sample size=${format.width}x${format.height} ` +
      `pixelFormat=${fourCC(layout.pixelFormat)} planes=${layout.planeCount} ` +
      `bytesPerRow=${layout.bytesPerRow} fps=${format.framesPerSecond}`
    )
  }
}

/**
 * OSType → 四字符码。非 ASCII 可打印字符回退成 `0x%08X`，
 * 而不是打印一串替换字符 —— 日志要能贴进 issue。
 */
export function fourCC(value: number): string {
  const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
  const printable = bytes.every((byte) => byte >= 0x20 && byte <= 0x7e)
  if (!printable) return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
  return String.fromCharCode(...bytes)
}
