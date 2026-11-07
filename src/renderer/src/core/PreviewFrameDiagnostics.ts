/**
 * 预览帧诊断 —— 只在显式开启时采集，且样本量有硬上限。
 *
 * Swift source: Sources/DogSCApp/PreviewFrameDiagnostics.swift（180 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - final class PreviewFrameDiagnostics              L10-180
 *   - struct Frame（owner / captureID / index / …）     L11-23  → PreviewDiagnosticsFrame
 *   - enqueued()（重打时间戳）                          L18-22  → previewDiagnosticsEnqueueFrame
 *   - struct Measurement（17 个字段）                   L25-41  → PreviewDiagnosticsMeasurement
 *   - struct Capture（epoch / startedAt / …）           L43-48  → PreviewDiagnosticsCapture
 *   - configured()（DOGSC_PREVIEW_DIAGNOSTICS=1）       L58-61  → previewDiagnosticsConfigured
 *   - beginFrame(epoch:outputTime:target:…)            L63-89  → PreviewFrameDiagnostics.beginFrame
 *   - update(_:_:)                                     L91-96  → PreviewFrameDiagnostics.update
 *   - encoded / coalesced / failed                     L98-107 → encoded / coalesced / failed
 *   - presented(_:at:)（0 表示未显示）                  L109-114 → presented
 *   - collectRenderInfo（最多 4 个在飞）                L116-136 → collectRenderInfo
 *   - report(_:)（统计与 JSON）                        L143-179 → previewDiagnosticsBuildReport
 *
 * 原注释（L6-9）：
 *   Explicit, bounded diagnostics. Release does nothing unless launched with
 *   DOGSC_PREVIEW_DIAGNOSTICS=1; no per-second production logs or frame images.
 *   All shared state is lock-protected, and CI waits run on a utility collector,
 *   never the main actor or the serial composition/presentation queue.
 *
 * 原注释（L110-112）：
 *   Zero means not shown/skipped. Command-buffer completion is expressly
 *   not accepted as evidence that the window server displayed a frame.
 *
 * 迁移说明：`CIRenderTask` / `MockCIRenderTask` 在 Windows 侧没有对应物，
 * `collectRenderInfo` 收敛为 `PreviewRenderInfoProvider` port（返回
 * `{ kernelCompileSeconds, kernelExecutionSeconds, passCount, pixelsProcessed }`
 * 或 null）。`CACurrentMediaTime()` 由调用方传 `now`，便于断言。
 * `JSONSerialization` 的 `.sortedKeys` 在 Windows 侧用固定键顺序的 JSON 文本表达。
 */

/** Swift L59：环境变量名。 */
export const PREVIEW_DIAGNOSTICS_ENVIRONMENT_KEY = 'DOGSC_PREVIEW_DIAGNOSTICS'

/** Swift L68：最多同时存在的采集批次数（第 4 个 epoch 直接被拒）。 */
export const PREVIEW_DIAGNOSTICS_MAX_CAPTURES = 3

/** Swift L76：单批次最长 10 秒，超过就拒收新帧。 */
export const PREVIEW_DIAGNOSTICS_CAPTURE_WINDOW_SECONDS = 10

/** Swift L77：单批次最多 900 个测量，满了就拒收。 */
export const PREVIEW_DIAGNOSTICS_MAX_MEASUREMENTS = 900

/** Swift L73：11 秒后出报告（比采集窗口多 1 秒，等最后几帧落地）。 */
export const PREVIEW_DIAGNOSTICS_REPORT_DELAY_SECONDS = 11

/** Swift L80：渲染信息最多每 0.25 秒采一次。 */
export const PREVIEW_DIAGNOSTICS_INFO_SAMPLE_INTERVAL = 0.25

/** Swift L81 / L119：同时在飞的渲染信息请求最多 4 个。 */
export const PREVIEW_DIAGNOSTICS_MAX_PENDING_RENDER_INFO = 4

/**
 * Swift L58-61：只有 `DOGSC_PREVIEW_DIAGNOSTICS=1` 才构造。
 * 注意是**字符串**比较，不是「非空即为真」—— 设成 `true` / `yes` 都不开。
 */
export function previewDiagnosticsConfigured(
  environment: Readonly<Record<string, string | undefined>>
): boolean {
  return environment[PREVIEW_DIAGNOSTICS_ENVIRONMENT_KEY] === '1'
}

/** Swift L11-23：一帧的诊断句柄。 */
export interface PreviewDiagnosticsFrame {
  readonly captureID: number
  readonly index: number
  /** 入队时刻（秒）。暂停帧会因排队而变大，这是有意的测量点。 */
  queuedAt: number
  readonly collectsRenderInfo: boolean
}

/** Swift L18-22：`enqueued()` 只把 `queuedAt` 打到当前时刻，其余字段不动。 */
export function previewDiagnosticsEnqueueFrame(
  frame: PreviewDiagnosticsFrame,
  now: number
): PreviewDiagnosticsFrame {
  return { ...frame, queuedAt: now }
}

/** Swift L25-41：单帧的全部测量槽位，全部可选（未发生的阶段留空）。 */
export interface PreviewDiagnosticsMeasurement {
  readonly outputTime: number
  readonly target: number
  readonly evaluationMS: number
  queueMS?: number
  graphMS?: number
  drawableWaitMS?: number
  encodeMS?: number
  /** 0 表示「没显示/被跳过」，因此用 `> 0` 判定而不是 `!= nil`。 */
  presentedAt?: number
  compileMS?: number
  executionMS?: number
  passes?: number
  pixels?: number
  submitted?: boolean
  failed?: boolean
  coalesced?: boolean
}

/** Swift L43-48：一次采集（一个 epoch）。 */
export interface PreviewDiagnosticsCapture {
  readonly epoch: number
  readonly startedAt: number
  measurements: PreviewDiagnosticsMeasurement[]
  lastInfoSampleAt: number
}

/** Swift L152：`sorted[min(Int(Double(count - 1) * 0.95), count - 1)]`。 */
export function previewDiagnosticsPercentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(Math.trunc((sorted.length - 1) * fraction), sorted.length - 1)
  return sorted[Math.max(index, 0)]
}

/** Swift L148-154：空数组返回 null（对应 Swift 的空字典）。 */
export interface PreviewDiagnosticsStats {
  readonly count: number
  readonly mean: number
  readonly p95: number
  readonly max: number
}

export function previewDiagnosticsStats(values: readonly number[]): PreviewDiagnosticsStats | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const sum = values.reduce((total, value) => total + value, 0)
  return {
    count: values.length,
    mean: sum / values.length,
    p95: previewDiagnosticsPercentile(sorted, 0.95),
    max: sorted[sorted.length - 1]!,
  }
}

/**
 * Swift L155-162：`presentedFPS`。
 *
 * 用 `shown.count − 1` 而不是 `shown.count` —— 这是「帧间隔的个数」，
 * 首帧没有前驱，不构成一个间隔。
 */
export function previewDiagnosticsPresentedFPS(shownCount: number, span: number): number {
  if (!(span > 0)) return 0
  return Math.max(shownCount - 1, 0) / span
}

/**
 * Swift L164：`max(presentedAt − target, 0) * 1_000`。
 *
 * 早于目标时刻（负值）夹到 0：display link 提前送达不是「负延迟」，
 * 把它算成负数会把平均值拉低到看不出问题。
 */
export function previewDiagnosticsDeadlineDelayMS(presentedAt: number, target: number): number {
  return Math.max(presentedAt - target, 0) * 1_000
}

/** Swift L76：是否还在采集窗口内。 */
export function previewDiagnosticsWithinWindow(startedAt: number, now: number): boolean {
  return now - startedAt < PREVIEW_DIAGNOSTICS_CAPTURE_WINDOW_SECONDS
}

/**
 * Swift L80-82：这一帧是否要附带渲染信息采样。
 *
 * 两个条件：距上次采样 ≥ 0.25 秒，且在飞请求没到 4 个。第二条是**背压**——
 * `waitUntilCompleted()` 会真等 GPU，无限排队会把 utility 线程池打满。
 */
export function previewDiagnosticsShouldCollectRenderInfo(input: {
  readonly now: number
  readonly lastInfoSampleAt: number
  readonly pendingRenderInfo: number
}): boolean {
  return (
    input.now - input.lastInfoSampleAt >= PREVIEW_DIAGNOSTICS_INFO_SAMPLE_INTERVAL &&
    input.pendingRenderInfo < PREVIEW_DIAGNOSTICS_MAX_PENDING_RENDER_INFO
  )
}

/** `collectRenderInfo` 的 port —— 返回 null 表示等待失败（Swift 的 `try?`）。 */
export interface PreviewRenderInfo {
  readonly kernelCompileSeconds: number
  readonly kernelExecutionSeconds: number
  readonly passCount: number
  readonly pixelsProcessed: number
}

/**
 * 渲染信息 → 测量槽位。
 *
 * Swift L130-131 把秒乘 1000 变成毫秒；这里同。
 */
export function previewDiagnosticsRenderInfoUpdate(
  info: PreviewRenderInfo
): Pick<PreviewDiagnosticsMeasurement, 'compileMS' | 'executionMS' | 'passes' | 'pixels'> {
  return {
    compileMS: info.kernelCompileSeconds * 1_000,
    executionMS: info.kernelExecutionSeconds * 1_000,
    passes: info.passCount,
    pixels: info.pixelsProcessed,
  }
}

/** Swift L156-175：报告的全部键（顺序即 JSON 里的顺序）。 */
export const PREVIEW_DIAGNOSTICS_REPORT_NOTE =
  'Presented FPS counts changed base drawables, not stationary holds or the separate cursor layer. CI timings are sampled; presentation-buffer time is not total GPU render time.'

/**
 * 内存版 `PreviewFrameDiagnostics`。
 *
 * 与 Swift 的三处等价关系：
 *   - `beginFrame` 在 `lastEpoch != epoch` 时**先**看采集数是否已满（满了直接返回
 *     null，且**不**更新 `lastEpoch`）——否则第 4 个 epoch 会把 `lastEpoch` 改掉，
 *     让后续同 epoch 的帧误以为换了批次
 *   - `update` 用 `indices.contains(index)` 兜住已出报告的迟到回调
 *   - `presented` 传 0 直接丢弃（Swift L112 的 `guard time > 0`）
 */
export class PreviewFrameDiagnostics {
  private readonly captures = new Map<number, PreviewDiagnosticsCapture>()
  private lastEpoch: number | null = null
  private captureCount = 0
  private pendingRenderInfo = 0
  private readonly reportSink: (report: PreviewDiagnosticsReport) => void

  constructor(reportSink: (report: PreviewDiagnosticsReport) => void = () => {}) {
    this.reportSink = reportSink
  }

  /** Swift L52 / L54：观测位，便于断言。 */
  get pendingRenderInfoCount(): number {
    return this.pendingRenderInfo
  }

  get captureCountValue(): number {
    return this.captureCount
  }

  get lastEpochValue(): number | null {
    return this.lastEpoch
  }

  beginFrame(input: {
    readonly epoch: number
    readonly outputTime: number
    readonly target: number
    readonly evaluationMS: number
    readonly now: number
  }): PreviewDiagnosticsFrame | null {
    if (this.lastEpoch !== input.epoch) {
      if (this.captureCount >= PREVIEW_DIAGNOSTICS_MAX_CAPTURES) return null
      this.captureCount += 1
      this.lastEpoch = input.epoch
      this.captures.set(this.captureCount, {
        epoch: input.epoch,
        startedAt: input.now,
        measurements: [],
        lastInfoSampleAt: 0,
      })
    }
    const id = this.captureCount
    const capture = this.captures.get(id)
    if (capture == null) return null
    if (!previewDiagnosticsWithinWindow(capture.startedAt, input.now)) return null
    if (capture.measurements.length >= PREVIEW_DIAGNOSTICS_MAX_MEASUREMENTS) return null

    const collectInfo = previewDiagnosticsShouldCollectRenderInfo({
      now: input.now,
      lastInfoSampleAt: capture.lastInfoSampleAt,
      pendingRenderInfo: this.pendingRenderInfo,
    })
    if (collectInfo) capture.lastInfoSampleAt = input.now

    capture.measurements.push({
      outputTime: input.outputTime,
      target: input.target,
      evaluationMS: input.evaluationMS,
    })
    return {
      captureID: id,
      index: capture.measurements.length - 1,
      queuedAt: input.now,
      collectsRenderInfo: collectInfo,
    }
  }

  encoded(
    frame: PreviewDiagnosticsFrame,
    input: { queueMS: number; graphMS: number; drawableWaitMS: number; encodeMS: number }
  ): void {
    this.update(frame, (measurement) => {
      measurement.queueMS = input.queueMS
      measurement.graphMS = input.graphMS
      measurement.drawableWaitMS = input.drawableWaitMS
      measurement.encodeMS = input.encodeMS
      measurement.submitted = true
    })
  }

  coalesced(frame: PreviewDiagnosticsFrame): void {
    this.update(frame, (measurement) => {
      measurement.coalesced = true
    })
  }

  failed(frame: PreviewDiagnosticsFrame): void {
    this.update(frame, (measurement) => {
      measurement.failed = true
    })
  }

  /** Swift L109-114：`time <= 0` 视为「没显示」。 */
  presented(frame: PreviewDiagnosticsFrame, time: number): void {
    if (!(time > 0)) return
    this.update(frame, (measurement) => {
      measurement.presentedAt = time
    })
  }

  /**
   * 预留一个渲染信息名额；返回 false 表示这一帧不采样。
   *
   * Swift L118-122 在锁内同时检查「没到 4 个」和「采集还在」——
   * 后者防的是报告已经出完、任务才被调度的迟到情况。
   */
  reserveRenderInfo(frame: PreviewDiagnosticsFrame): boolean {
    if (!frame.collectsRenderInfo) return false
    if (this.pendingRenderInfo >= PREVIEW_DIAGNOSTICS_MAX_PENDING_RENDER_INFO) return false
    if (!this.captures.has(frame.captureID)) return false
    this.pendingRenderInfo += 1
    return true
  }

  /** 与 `reserveRenderInfo` 配对；无论成功失败都必须调用一次。 */
  releaseRenderInfo(frame: PreviewDiagnosticsFrame, info: PreviewRenderInfo | null): void {
    this.pendingRenderInfo = Math.max(this.pendingRenderInfo - 1, 0)
    if (info == null) return
    const update = previewDiagnosticsRenderInfoUpdate(info)
    this.update(frame, (measurement) => {
      Object.assign(measurement, update)
    })
  }

  /** Swift L143-179：出报告并从表里摘掉这一批。 */
  report(captureID: number): PreviewDiagnosticsReport | null {
    const capture = this.captures.get(captureID)
    if (capture == null) return null
    this.captures.delete(captureID)
    const report = previewDiagnosticsBuildReport(captureID, capture)
    this.reportSink(report)
    return report
  }

  private update(
    frame: PreviewDiagnosticsFrame,
    change: (measurement: PreviewDiagnosticsMeasurement) => void
  ): void {
    const capture = this.captures.get(frame.captureID)
    if (capture == null) return
    if (frame.index < 0 || frame.index >= capture.measurements.length) return
    change(capture.measurements[frame.index]!)
  }
}

/** Swift L156-175 的报告形状（值类型固定，便于逐字段断言）。 */
export interface PreviewDiagnosticsReport {
  readonly capture: number
  readonly epoch: number
  readonly previewBudgetFPS: number
  readonly outputStart: number
  readonly outputEnd: number
  readonly ticks: number
  readonly submitted: number
  readonly actuallyPresented: number
  readonly failed: number
  readonly coalesced: number
  readonly presentedFPS: number
  readonly displayIntervalMS: PreviewDiagnosticsStats | null
  readonly deadlineDelayMS: PreviewDiagnosticsStats | null
  readonly sceneEvaluationMS: PreviewDiagnosticsStats | null
  readonly renderQueueWaitMS: PreviewDiagnosticsStats | null
  readonly ciGraphCPUMS: PreviewDiagnosticsStats | null
  readonly drawableWaitMS: PreviewDiagnosticsStats | null
  readonly ciEncodeCPUMS: PreviewDiagnosticsStats | null
  readonly ciKernelCompileMS: PreviewDiagnosticsStats | null
  readonly ciKernelExecutionMS: PreviewDiagnosticsStats | null
  readonly ciPasses: PreviewDiagnosticsStats | null
  readonly ciPixelsProcessed: PreviewDiagnosticsStats | null
  readonly note: string
}

/**
 * Swift L143-178：把一批测量压成报告。
 *
 * 两个容易看错的细节：
 *   - `intervals` 是 `zip(shown.dropFirst(), shown)`，即 `后 − 前`（正值），
 *     写成 `前 − 后` 会让所有显示间隔变成负数
 *   - `outputStart` / `outputEnd` 取**全部**样本的首尾，不是已显示样本的
 */
export function previewDiagnosticsBuildReport(
  captureID: number,
  capture: PreviewDiagnosticsCapture,
  previewBudgetFPS = 60
): PreviewDiagnosticsReport {
  const samples = capture.measurements
  const shown = samples
    .map((sample) => sample.presentedAt)
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b)
  const intervals: number[] = []
  for (let index = 1; index < shown.length; index += 1) {
    intervals.push((shown[index]! - shown[index - 1]!) * 1_000)
  }
  const span = (shown[shown.length - 1] ?? 0) - (shown[0] ?? 0)
  const compact = <T>(values: (T | undefined)[]): T[] =>
    values.filter((value): value is T => value != null)
  const deadlineDelays = compact(
    samples.map((sample) =>
      sample.presentedAt == null
        ? undefined
        : previewDiagnosticsDeadlineDelayMS(sample.presentedAt, sample.target)
    )
  )
  return {
    capture: captureID,
    epoch: capture.epoch,
    previewBudgetFPS,
    outputStart: samples[0]?.outputTime ?? 0,
    outputEnd: samples[samples.length - 1]?.outputTime ?? 0,
    ticks: samples.length,
    submitted: samples.filter((sample) => sample.submitted === true).length,
    actuallyPresented: shown.length,
    failed: samples.filter((sample) => sample.failed === true).length,
    coalesced: samples.filter((sample) => sample.coalesced === true).length,
    presentedFPS: previewDiagnosticsPresentedFPS(shown.length, span),
    displayIntervalMS: previewDiagnosticsStats(intervals),
    deadlineDelayMS: previewDiagnosticsStats(deadlineDelays),
    sceneEvaluationMS: previewDiagnosticsStats(samples.map((sample) => sample.evaluationMS)),
    renderQueueWaitMS: previewDiagnosticsStats(compact(samples.map((sample) => sample.queueMS))),
    ciGraphCPUMS: previewDiagnosticsStats(compact(samples.map((sample) => sample.graphMS))),
    drawableWaitMS: previewDiagnosticsStats(compact(samples.map((sample) => sample.drawableWaitMS))),
    ciEncodeCPUMS: previewDiagnosticsStats(compact(samples.map((sample) => sample.encodeMS))),
    ciKernelCompileMS: previewDiagnosticsStats(compact(samples.map((sample) => sample.compileMS))),
    ciKernelExecutionMS: previewDiagnosticsStats(
      compact(samples.map((sample) => sample.executionMS))
    ),
    ciPasses: previewDiagnosticsStats(compact(samples.map((sample) => sample.passes))),
    ciPixelsProcessed: previewDiagnosticsStats(
      compact(samples.map((sample) => sample.pixels))
    ),
    note: PREVIEW_DIAGNOSTICS_REPORT_NOTE,
  }
}
