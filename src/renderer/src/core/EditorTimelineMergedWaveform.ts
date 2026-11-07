/**
 * EditorTimelineMergedWaveform —— 系统声与麦克风合并成一条包络的波形视图。
 *
 * Swift source: Sources/DogSCApp/EditorTimelineMergedWaveform.swift（188 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L7-44    struct EditorTimelineMergedWaveform（View）
 *   L20-30   request —— 两路通道 + 采样点数 + 窗口
 *   L32-43   body —— 展开/收起的两种动画
 *   L49-73   WaveformEnvelopeCanvas（Equatable 只比 request 与 expansion）
 *   L77-90   WaveformEnvelopeCache（NSLock + 单槽）
 *   L92-110  WaveformEnvelopeChannel（== 只比 version/sourceRange/plan/gains）
 *   L102-109 amplitude(at:)
 *   L112-136 WaveformEnvelopeRequest（sample()）
 *   L138-188 WaveformEnvelopeShape（path(in:)）
 *
 * 迁移说明：
 *   这里保留波形**几何与取样**的全部纯逻辑，但不碰 PCM 解码与 SwiftUI：
 *     - `mergedWaveformRequest`：采样点数 `min(max(ceil(w/2),2),4096)`
 *     - `waveformChannelAmplitude`：三道闸（增益 ≤ 0 / 峰值非有限或过小 /
 *       显示增益钳到 1）
 *     - `sampleMergedEnvelope`：每个格子取 0.2 / 0.5 / 0.8 三个点的**最大**
 *       幅度，两路通道取 max 合并（不是相加）
 *     - `waveformEnvelopeGeometry`：中心线、振幅、步长的展开插值
 *     - `waveformAmplitudeRuns`：连续非零区间的切分（含收尾规则）
 *
 * 原文件里所有事情都发生在 `Canvas` 的绘制闭包里，无法单独断言；把它们
 * 提成函数是这次转写的主要价值。
 */

/** Swift L28：采样点数的上下界。 */
export const MERGED_WAVEFORM_MIN_SAMPLES = 2
export const MERGED_WAVEFORM_MAX_SAMPLES = 4096

/** Swift L127：每个格子取三个相对位置的峰值。 */
export const MERGED_WAVEFORM_CELL_FRACTIONS: readonly number[] = [0.2, 0.5, 0.8]

/** Swift L107：峰值小于千分之一就当作静音。 */
export const MERGED_WAVEFORM_PEAK_FLOOR = 0.001

/** Swift L174：判定「这一格有声音」的下限。 */
export const MERGED_WAVEFORM_RUN_THRESHOLD = 0.0001

/**
 * Swift L28：`min(max(Int(ceil(width / 2)), 2), 4096)`。
 *
 * 每 2 像素采一个点 —— 再密也画不出来，只是白白多算。宽度为 0 时也要给 2，
 * 因为 `WaveformEnvelopeShape.path` 要求 `samples.count > 1`。
 */
export function mergedWaveformSampleCount(width: number): number {
  return Math.min(
    Math.max(Math.ceil(width / 2), MERGED_WAVEFORM_MIN_SAMPLES),
    MERGED_WAVEFORM_MAX_SAMPLES
  )
}

/** Swift L20-30：一次取样请求的完整描述。 */
export interface MergedWaveformRequest {
  readonly channelCount: number
  readonly count: number
  readonly start: number
  readonly duration: number
}

/**
 * Swift L22-29：只有「数据与放置计划都拿到」的通道才参与合成。
 *
 * 缺一个就整路丢弃 —— 只拿到数据没有 plan 时无法把源时间映射到输出时间，
 * 强行按 0 起点画会让波形整体错位。
 */
export function mergedWaveformRequest(input: {
  readonly width: number
  readonly outputStart: number
  readonly outputDuration: number
  readonly channels: readonly { readonly hasData: boolean; readonly hasPlan: boolean }[]
}): MergedWaveformRequest {
  const channelCount = input.channels.filter(
    (channel) => channel.hasData && channel.hasPlan
  ).length
  return {
    channelCount,
    count: mergedWaveformSampleCount(input.width),
    start: input.outputStart,
    duration: input.outputDuration,
  }
}

/**
 * Swift L102-109：单通道在某一时刻的幅度。
 *
 * 三道闸，顺序不能换：
 *   1. `gain <= 0` → 0（静音轨不查峰值，省一次取样）
 *   2. 峰值非有限或 `<= 0.001` → 0（NaN 会污染后面的 max）
 *   3. `min(peak * displayGain, 1) * gain` —— 注意显示增益在乘音量增益**之前**
 *      就先钳到 1 了，所以 3 倍显示增益 + 0.5 音量 = 0.5，而不是 1.5。
 */
export function waveformChannelAmplitude(input: {
  readonly gain: number
  readonly peak: number
  readonly displayGain: number
}): number {
  if (!(input.gain > 0)) return 0
  if (!Number.isFinite(input.peak) || !(input.peak > MERGED_WAVEFORM_PEAK_FLOOR)) {
    return 0
  }
  return Math.min(input.peak * input.displayGain, 1) * input.gain
}

/**
 * Swift L118-135：整条包络的取样。
 *
 * - `step = duration / count`，格子下标 i 覆盖 `[start + i*step, start + (i+1)*step)`。
 * - 每格在 0.2 / 0.5 / 0.8 处各取一次，**取最大值**。只取中点会漏掉短促的
 *   鼓点 —— 这正是原注释强调的那句「take the peak across each drawing cell,
 *   not just its midpoint」。
 * - 两路通道是 `max` 合并，不是相加。相加会让「系统声和麦克风同时有声音」
 *   画成一条冲出画面的柱子。
 */
export function sampleMergedEnvelope(input: {
  readonly request: MergedWaveformRequest
  /** 给定输出时刻，返回该时刻两路合并后的幅度。 */
  readonly amplitudeAt: (time: number) => number
}): number[] {
  const { count, start, duration } = input.request
  if (input.request.channelCount === 0) return []
  const values = new Array<number>(count).fill(0)
  const step = duration / count
  for (let index = 0; index < count; index += 1) {
    for (const fraction of MERGED_WAVEFORM_CELL_FRACTIONS) {
      const time = start + (index + fraction) * step
      values[index] = Math.max(values[index]!, input.amplitudeAt(time))
    }
  }
  return values
}

/**
 * Swift L146-160：包络的几何插值。
 *
 * `expansion` 从 0 到 1 表示「收起 → 展开」：
 *   - 中心线从波形带中线移到整块矩形中线（`rect.height * 0.50`，不是 0.5*height
 *     的一半 —— 就写在代码里的 0.50）
 *   - 振幅从 `band.height * 0.38` 长到 `rect.height * 0.30`
 *
 * `peakHeight` 只对**超过 1** 的部分做展开插值：`min(s,1)` 那截固定不动，
 * 超出的部分按 progress 释放。所以 boost 过的音频在收起态会被压回带内，
 * 展开态才回到原样。
 */
export interface MergedWaveformGeometry {
  readonly progress: number
  readonly center: number
  readonly compactAmplitude: number
  readonly amplitude: number
  readonly step: number
}

export function waveformEnvelopeGeometry(input: {
  readonly sampleCount: number
  readonly expansion: number
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly band: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}): MergedWaveformGeometry {
  const progress = Math.min(Math.max(input.expansion, 0), 1)
  const bandMidY = input.band.y + input.band.height / 2
  const center = bandMidY + (input.rect.height * 0.5 - bandMidY) * progress
  const compactAmplitude = input.band.height * 0.38
  const amplitude = compactAmplitude + (input.rect.height * 0.3 - compactAmplitude) * progress
  const step =
    input.sampleCount > 1 ? input.rect.width / (input.sampleCount - 1) : 0
  return { progress, center, compactAmplitude, amplitude, step }
}

/** Swift L154-160：单格的峰值高度。 */
export function waveformPeakHeight(input: {
  readonly sample: number
  readonly progress: number
  readonly amplitude: number
}): number {
  const compactPeak = Math.min(input.sample, 1)
  const peak = compactPeak + (input.sample - compactPeak) * input.progress
  return peak * input.amplitude
}

/**
 * Swift L173-185：把采样序列切成连续的非零区间。
 *
 * 规则有一处不对称，容易写错：
 *   - 遇到零时用 `closeRun(at: max(index - 1, 0))` —— 收在上一个非零格；
 *   - 循环结束后用 `closeRun(at: samples.count - 1)` —— 收在**最后一格**，
 *     哪怕最后几格是零。于是末尾有静音时，最后一个区间会比实际声音长出去。
 *
 * 这是上游的行为，照抄不修：改成「收在最后一个非零格」会让末尾的波形
 * 比音频早结束，看上去像被裁掉了。
 */
export interface WaveformAmplitudeRun {
  readonly startIndex: number
  readonly endIndex: number
}

export function waveformAmplitudeRuns(samples: readonly number[]): WaveformAmplitudeRun[] {
  if (samples.length <= 1) return []
  const runs: WaveformAmplitudeRun[] = []
  let runStart: number | null = null
  const closeRun = (end: number): void => {
    if (runStart == null) return
    runs.push({ startIndex: runStart, endIndex: end })
    runStart = null
  }
  for (let index = 0; index < samples.length; index += 1) {
    if (!(samples[index]! > MERGED_WAVEFORM_RUN_THRESHOLD)) {
      if (runStart != null) closeRun(Math.max(index - 1, 0))
      continue
    }
    if (runStart == null) runStart = index
  }
  if (runStart != null) closeRun(samples.length - 1)
  return runs
}

/**
 * Swift L161-172 / L181-183：一个区间的三个折点（闭区间都要反着走一遍）。
 *
 * 起点先画到 `x - step/2`（下限 0），终点收在 `(end + 0.5) * step`（上限 rect.width）。
 * 两侧各留半格，是为了让相邻区间的边缘不会在像素中心留下锯齿。
 */
export function waveformRunEdgePoints(input: {
  readonly run: WaveformAmplitudeRun
  readonly step: number
  readonly rectWidth: number
}): {
  readonly openX: number
  readonly closeX: number
} {
  return {
    openX: Math.max(input.run.startIndex * input.step - input.step / 2, 0),
    closeX: Math.min(
      (input.run.endIndex + 0.5) * input.step,
      input.rectWidth
    ),
  }
}

/**
 * Swift L36-41：展开用弹簧 + 延迟，收起用 0.12 秒缓入。
 *
 * 不对称的原因：展开时波形要与上面的剪辑块交换位置，需要等 `EditorTimelineSwap.inDelay`
 * 之后才动，否则两个动画会互相打架；收起时没有交换，直接淡出即可。
 */
export function mergedWaveformAnimation(input: {
  readonly expanded: boolean
  readonly swapInDelay: number
}): {
  readonly kind: 'spring' | 'ease-in'
  readonly response: number
  readonly dampingFraction: number
  readonly duration: number
  readonly delay: number
} {
  if (input.expanded) {
    return {
      kind: 'spring',
      response: 0.42,
      dampingFraction: 0.86,
      duration: 0,
      delay: input.swapInDelay,
    }
  }
  return {
    kind: 'ease-in',
    response: 0,
    dampingFraction: 0,
    duration: 0.12,
    delay: 0,
  }
}

/**
 * Swift L52-54：`Equatable` 只比 `request` 与 `expansion`。
 *
 * 通道的相等判定（L97-100）只比 `version` / `sourceRange` / `plan` / `gains`，
 * 不比 `samples` 数组本身 —— 峰值数组可能几十万个数，逐元素比会让每一帧
 * 都做一次全量扫描。
 */
export function mergedWaveformRequestsEqual(
  lhs: MergedWaveformRequest & { readonly expansion: number },
  rhs: MergedWaveformRequest & { readonly expansion: number }
): boolean {
  return (
    lhs.channelCount === rhs.channelCount &&
    lhs.count === rhs.count &&
    lhs.start === rhs.start &&
    lhs.duration === rhs.duration &&
    lhs.expansion === rhs.expansion
  )
}

/**
 * Swift L82-89：单槽缓存。
 *
 * 命中就返回旧值；未命中就重新取样，**但只有取样成功才写回** —— 取到 nil
 * （任务被取消）时保留旧缓存，这样下一次同样的请求还能命中上一份结果。
 */
export function mergedWaveformCacheAccepts(input: {
  readonly cachedRequest: (MergedWaveformRequest & { readonly expansion: number }) | null
  readonly request: MergedWaveformRequest & { readonly expansion: number }
}): boolean {
  if (input.cachedRequest == null) return false
  return mergedWaveformRequestsEqual(input.cachedRequest, input.request)
}

/**
 * Swift L123：`if index.isMultiple(of: 128), Task.isCancelled { return nil }`。
 *
 * 每 128 个格子才查一次取消 —— 每格都查会让互斥锁与任务调度的开销盖过
 * 取样本身。
 */
export function mergedWaveformShouldCheckCancellation(index: number): boolean {
  return index % 128 === 0
}
