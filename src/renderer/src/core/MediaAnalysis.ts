/**
 * 媒体探测与波形分析 —— Swift MediaAnalysis.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/MediaAnalysis.swift（327 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐结构对照（Swift 行号 → 本文件）：
 *   - struct MediaAssetInventory              (L6-24)   → MediaAssetInventory / EMPTY_MEDIA_INVENTORY
 *   - enum MediaAnalysisError                 (L26-47)  → MediaAnalysisError + mediaAnalysisErrorMessage
 *   - struct TimestampedWaveformAccumulator   (L49-172) → TimestampedWaveformAccumulator
 *       · init(timeRange:sampleCount:)                  L53-56
 *       · record(peak:atPresentationTime:)              L58-66
 *       · record(interleavedPCM:channels:...)           L78-148
 *       · waveformFrameBoundary(at:...)                 L150-161
 *       · normalizedSamples                             L163-171
 *   - enum MediaAnalyzer                      (L177-327)
 *       · inspect(_:)                                   L178-230
 *       · waveform(_:sampleCount:)                      L234-315
 *       · timeRange(for:)                               L317-326
 *
 * 迁移说明：
 *   AVFoundation（AVURLAsset / AVAssetReader / CMSampleBuffer）在 Electron 侧由
 *   ffprobe + ffmpeg 在主进程提供等价的原始数据，因此这里保留**全部纯算术**，
 *   把「取数据」抽成入参：
 *     · `mediaInventoryFromProbe(probe)` 对应 inspect 的合并逻辑（三路时长取 max）；
 *     · `TimestampedWaveformAccumulator.recordInterleavedPCM` 接受 Int16Array，
 *       对应 AVAssetReader 解出的 interleaved Int16 PCM；
 *     · `Task.checkCancellation()` 改为可注入的 `checkCancellation` 回调。
 *   所有导出保持纯函数 / 纯数据，可单测。
 */

import { bucketIndex, type MediaTimeRange } from './MediaTimeRange'

// ------------------------------------------------------------ MediaAssetInventory

/** Swift L6-24。`videoFrameRate` 在原版有默认值 nil，故此处为可选字段。 */
export interface MediaAssetInventory {
  readonly duration: number
  readonly videoWidth: number | null
  readonly videoHeight: number | null
  readonly videoTimeRange: MediaTimeRange | null
  readonly audioTimeRange: MediaTimeRange | null
  /** Swift L12：`var videoFrameRate: Double? = nil` */
  readonly videoFrameRate?: number | null
}

/** Swift L14-15：`hasVideo` / `hasAudio` 只看时间区间是否存在。 */
export function inventoryHasVideo(inv: MediaAssetInventory): boolean {
  return inv.videoTimeRange != null
}

export function inventoryHasAudio(inv: MediaAssetInventory): boolean {
  return inv.audioTimeRange != null
}

/** Swift L17-23。原版 `static let empty` 未显式传 videoFrameRate，走默认 nil。 */
export const EMPTY_MEDIA_INVENTORY: MediaAssetInventory = {
  duration: 0,
  videoWidth: null,
  videoHeight: null,
  videoTimeRange: null,
  audioTimeRange: null,
  videoFrameRate: null
}

export function makeMediaAssetInventory(
  fields: Partial<MediaAssetInventory> & Pick<MediaAssetInventory, 'duration'>
): MediaAssetInventory {
  return {
    duration: fields.duration,
    videoWidth: fields.videoWidth ?? null,
    videoHeight: fields.videoHeight ?? null,
    videoTimeRange: fields.videoTimeRange ?? null,
    audioTimeRange: fields.audioTimeRange ?? null,
    videoFrameRate: fields.videoFrameRate ?? null
  }
}

export function mediaInventoryEquals(a: MediaAssetInventory, b: MediaAssetInventory): boolean {
  const rangeEquals = (x: MediaTimeRange | null, y: MediaTimeRange | null): boolean =>
    x === y || (x != null && y != null && x.start === y.start && x.end === y.end)
  return (
    a.duration === b.duration &&
    a.videoWidth === b.videoWidth &&
    a.videoHeight === b.videoHeight &&
    rangeEquals(a.videoTimeRange, b.videoTimeRange) &&
    rangeEquals(a.audioTimeRange, b.audioTimeRange) &&
    (a.videoFrameRate ?? null) === (b.videoFrameRate ?? null)
  )
}

// ------------------------------------------------------------ MediaAnalysisError

/** Swift L26-31 的五个 case。 */
export type MediaAnalysisErrorKind =
  | 'missingAudioTrack'
  | 'cannotReadAudio'
  | 'unsupportedAudioFormat'
  | 'invalidAudioTimeRange'
  | 'readerFailed'

/**
 * Swift L33-46 的 `errorDescription`，中文文案逐字照搬。
 * `readerFailed` 携带底层消息。
 */
export function mediaAnalysisErrorMessage(kind: MediaAnalysisErrorKind, detail?: string): string {
  switch (kind) {
    case 'missingAudioTrack':
      return '媒体中没有可用的音频轨。'
    case 'cannotReadAudio':
      return '无法创建音频读取器。'
    case 'unsupportedAudioFormat':
      return '音频轨格式无法用于波形分析。'
    case 'invalidAudioTimeRange':
      return '音频轨的时间范围为空或无效。'
    case 'readerFailed':
      return `音频分析失败：${detail ?? ''}`
  }
}

/** Swift L26 的 Error 载体（TS 侧用 class 携带 kind）。 */
export class MediaAnalysisError extends Error {
  readonly kind: MediaAnalysisErrorKind
  readonly detail: string | null

  constructor(kind: MediaAnalysisErrorKind, detail: string | null = null) {
    super(mediaAnalysisErrorMessage(kind, detail ?? undefined))
    this.name = 'MediaAnalysisError'
    this.kind = kind
    this.detail = detail
  }
}

// --------------------------------------------- TimestampedWaveformAccumulator

/**
 * Swift L49-172。
 *
 * 原实现的关键取舍（L68-77 注释）：早期版本把每个解码帧反算呈现时间再除以
 * 整轨时长求桶号，几分钟 48kHz 录音要做几千万次同样的映射。桶边界是线性的，
 * 所以改成「每个被触达的桶算一次帧区间，直接扫 Int16」。对全部声道、全部帧
 * 取最大值，与「逐帧取声道最大再取桶最大」数学等价。
 */
export class TimestampedWaveformAccumulator {
  readonly timeRange: MediaTimeRange
  private _peaks: number[]

  /** Swift L53-56：`peaks = Array(repeating: 0, count: max(sampleCount, 1))` */
  constructor(timeRange: MediaTimeRange, sampleCount: number) {
    this.timeRange = timeRange
    this._peaks = new Array<number>(Math.max(sampleCount, 1)).fill(0)
  }

  /** Swift `private(set) var peaks` */
  get peaks(): readonly number[] {
    return this._peaks
  }

  get sampleCount(): number {
    return this._peaks.length
  }

  /** Swift L58-66。 */
  record(peak: number, presentationTime: number): void {
    if (!Number.isFinite(peak) || peak < 0) return
    const bucket = bucketIndex(this.timeRange, presentationTime, this._peaks.length)
    if (bucket == null) return
    this._peaks[bucket] = Math.max(this._peaks[bucket], peak)
  }

  /**
   * Swift L78-148：按连续波形桶记录一段 interleaved PCM。
   *
   * 原版的 `try Task.checkCancellation()`（L118，每 64 个桶一次）改为
   * `options.checkCancellation` 回调；回调抛错即中止（等价于 Swift 的 try 传播）。
   */
  recordInterleavedPCM(
    pcm: Int16Array,
    channels: number,
    sampleRate: number,
    startingAt: number,
    options?: { checkCancellation?: () => void }
  ): void {
    // L84-88
    if (!(channels > 0)) return
    if (!Number.isFinite(sampleRate) || !(sampleRate > 0)) return
    if (!Number.isFinite(startingAt)) return
    if (pcm.length === 0) return
    const frameCount = Math.trunc(pcm.length / channels)
    if (!(frameCount > 0)) return

    // L92-95
    const bufferEnd = startingAt + frameCount / sampleRate
    const clippedStart = Math.max(startingAt, this.timeRange.start)
    const clippedEnd = Math.min(bufferEnd, this.timeRange.end)
    if (!(clippedStart < clippedEnd)) return

    // L97-99
    const bucketCount = this._peaks.length
    const bucketDuration = (this.timeRange.end - this.timeRange.start) / bucketCount
    if (!Number.isFinite(bucketDuration) || !(bucketDuration > 0)) return

    // L101-104
    const firstBucket = Math.min(
      Math.max(Math.floor((clippedStart - this.timeRange.start) / bucketDuration), 0),
      bucketCount - 1
    )
    // L105-110：用半个源帧把「右开」边界压进最后一个被触达的桶，
    // 不依赖固定的时间 epsilon。
    const finalIncludedTime = Math.max(clippedStart, clippedEnd - 0.5 / sampleRate)
    const lastBucket = Math.min(
      Math.max(Math.floor((finalIncludedTime - this.timeRange.start) / bucketDuration), 0),
      bucketCount - 1
    )
    if (!(firstBucket <= lastBucket)) return

    // L117-147
    for (let bucket = firstBucket; bucket <= lastBucket; bucket++) {
      if (bucket % 64 === 0) options?.checkCancellation?.()
      const bucketStart = this.timeRange.start + bucket * bucketDuration
      const bucketEnd = bucketStart + bucketDuration
      const startFrame = waveformFrameBoundary(bucketStart, startingAt, sampleRate, frameCount)
      const endFrame = waveformFrameBoundary(bucketEnd, startingAt, sampleRate, frameCount)
      if (!(startFrame < endFrame)) continue

      const sampleStart = startFrame * channels
      const sampleEnd = Math.min(endFrame * channels, pcm.length)
      let magnitude = 0
      for (let i = sampleStart; i < sampleEnd; i++) {
        const value = pcm[i]
        magnitude = Math.max(magnitude, value >= 0 ? value : -value)
      }
      this._peaks[bucket] = Math.max(this._peaks[bucket], magnitude / 32768.0)
    }
  }

  /**
   * Swift L163-171：噪声底 0.012、抬升后 `pow(elevated, 0.95)` 曲率、夹到 [0,1]。
   * 静音必须为 0 —— UI 不得自造一个最低绿色条。
   */
  get normalizedSamples(): number[] {
    return this._peaks.map((rawPeak) => {
      const noiseFloor = 0.012
      if (!(rawPeak > noiseFloor)) return 0
      const elevated = (rawPeak - noiseFloor) / (1.0 - noiseFloor)
      const curved = Math.pow(elevated, 0.95)
      return Math.min(Math.max(curved, 0), 1)
    })
  }
}

/**
 * Swift L150-161（原为 `private func`，此处导出以便断言）。
 *
 * 减去一个与量级相关的极小容差，使「精确 PCM 边界」被表示成
 * 4799.999999999 或 4800.000000001 时映射到同一帧。
 * `Double.ulpOfOne` → `Number.EPSILON`。
 */
export function waveformFrameBoundary(
  time: number,
  presentationTime: number,
  sampleRate: number,
  frameCount: number
): number {
  const rawFrame = (time - presentationTime) * sampleRate
  const tolerance = Math.max(Math.abs(rawFrame), 1) * Number.EPSILON * 16
  return Math.min(Math.max(Math.ceil(rawFrame - tolerance), 0), frameCount)
}

// ------------------------------------------------------------ MediaAnalyzer

/**
 * 主进程 ffprobe 给出的原始探测结果（对应 Swift inspect 里 AVFoundation 的那几路）。
 */
export interface MediaProbeResult {
  /** `assetDuration`：容器总时长，可能缺失或无效 */
  readonly assetDuration: number | null
  readonly videoTimeRange: MediaTimeRange | null
  readonly audioTimeRange: MediaTimeRange | null
  readonly videoWidth: number | null
  readonly videoHeight: number | null
  readonly videoFrameRate: number | null
}

/**
 * Swift L178-230 `inspect` 的纯算术部分。
 *
 * 三条有效化规则照搬：
 *   · `validAssetDuration`（L212-215）：非有限或 <= 0 一律按 0 处理；
 *   · 时长取 `max(assetDuration, videoTimeRange.end, audioTimeRange.end)`（L216-220），
 *     且两路区间各自再 `max(end, 0)`；
 *   · 宽高/帧率只在该轨道**真的存在视频时间区间**时才采信（L193-210）。
 */
export function mediaInventoryFromProbe(probe: MediaProbeResult): MediaAssetInventory {
  const assetDuration = probe.assetDuration
  const validAssetDuration =
    assetDuration != null && Number.isFinite(assetDuration) && assetDuration > 0 ? assetDuration : 0

  const duration = Math.max(
    validAssetDuration,
    probe.videoTimeRange != null ? Math.max(probe.videoTimeRange.end, 0) : 0,
    probe.audioTimeRange != null ? Math.max(probe.audioTimeRange.end, 0) : 0
  )

  const hasVideoTrack = probe.videoTimeRange != null
  let width: number | null = null
  let height: number | null = null
  let frameRate: number | null = null
  if (hasVideoTrack) {
    const w = probe.videoWidth
    const h = probe.videoHeight
    // L201-204：`displayed.width > 0, displayed.height > 0` 才写入并取整。
    if (w != null && h != null && w > 0 && h > 0) {
      width = Math.round(w)
      height = Math.round(h)
    }
    // L205-209
    const nominal = probe.videoFrameRate
    if (nominal != null && Number.isFinite(nominal) && nominal > 0) {
      frameRate = nominal
    }
  }

  return {
    duration,
    videoWidth: width,
    videoHeight: height,
    videoTimeRange: probe.videoTimeRange,
    audioTimeRange: probe.audioTimeRange,
    videoFrameRate: frameRate
  }
}

/** Swift L234 / L234-315 的默认采样数。 */
export const MEDIA_ANALYZER_DEFAULT_SAMPLE_COUNT = 160

/**
 * Swift L234-315 `waveform` 的解码循环骨架：调用方（主进程）每拿到一段
 * interleaved Int16 PCM 就喂进来一次，行为与 AVAssetReader 的 while 循环一致。
 */
export class MediaWaveformSession {
  private readonly accumulator: TimestampedWaveformAccumulator

  constructor(timeRange: MediaTimeRange, sampleCount: number = MEDIA_ANALYZER_DEFAULT_SAMPLE_COUNT) {
    this.accumulator = new TimestampedWaveformAccumulator(timeRange, Math.max(sampleCount, 1))
  }

  get sampleCount(): number {
    return this.accumulator.sampleCount
  }

  get peaks(): readonly number[] {
    return this.accumulator.peaks
  }

  /**
   * 对应 L281-308 循环体的一次迭代。
   * `presentationTime` 非有限时原版直接 `continue`。
   */
  append(
    pcm: Int16Array,
    channels: number,
    sampleRate: number,
    presentationTime: number,
    options?: { checkCancellation?: () => void }
  ): void {
    if (!Number.isFinite(presentationTime)) return
    // 原版 `totalLength >= MemoryLayout<Int16>.size` 才算有效数据。
    if (pcm.length * 2 < 2) return
    this.accumulator.recordInterleavedPCM(pcm, channels, sampleRate, presentationTime, options)
  }

  /** L314：返回归一化后的采样（静音为 0）。 */
  finish(): number[] {
    return this.accumulator.normalizedSamples
  }
}
