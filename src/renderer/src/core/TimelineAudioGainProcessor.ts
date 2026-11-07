/**
 * 时间线音频增益 —— 在 PCM 采样上应用每段增益，而不是让 AVFoundation
 * 在合成剪切点之间插值音量。
 *
 * Swift source: Sources/DogSCApp/TimelineAudioGainProcessor.swift（195 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - enum TimelineAudioGainProcessor                    L11-195
 *   - struct Span（start / end / gain）                  L12-16  → TimelineAudioGainSpan
 *   - parameters(track:defaultGain:spans:)              L18-79  → timelineAudioGainParametersPlan
 *     · validSpans 过滤与排序                            L24-26  → timelineAudioGainValidSpans
 *     · 「全段都等于默认增益」的直接返回                  L28-31  → timelineAudioGainNeedsProcessor
 *     · 建 tap 失败 → 静音而不是回落全局增益              L67-75  → timelineAudioGainFailurePlan
 *   - clamped(_:)（非有限 → 0）                          L81-83  → timelineAudioGainClamped
 *   - final class State.apply（分段）                    L99-152 → timelineAudioGainSegments
 *     · 二分找第一个 end > start                         L117-123 → timelineAudioGainFirstSpanIndex
 *     · 半开区间的帧边界                                  L144-148 → timelineAudioGainNextBoundaryFrame
 *   - State.scale（按格式缩放 / 静音）                   L154-193 → timelineAudioGainScaleKind
 *
 * 原注释（L7-10）：
 *   Apply authored gains to PCM samples, rather than asking AVFoundation to
 *   interpolate volume events across composition cuts. Preview and both export
 *   paths use this same immutable envelope; editing a slider only replaces the
 *   audio mix, without reopening assets or adding a track per clip.
 *
 * 原注释（L71-72）：
 *   Never play an explicitly muted segment at the global gain if the system
 *   cannot allocate its processor.
 *
 * 原注释（L111-114）：
 *   A retimed composition can report a source-scaled range duration even though
 *   this post-effects buffer is already on the output clock. Anchor to its asset
 *   start, then advance by the negotiated PCM sample rate; duration/frameCount
 *   moves cuts on fast clips.
 *
 * 原注释（L144-145）：
 *   Half-open intervals: the first sample on a cut belongs to the next segment.
 *   Only remove arithmetic noise, not a frame.
 *
 * 迁移说明：`MTAudioProcessingTap` / `vDSP_vsmul` / `UnsafeMutableAudioBufferListPointer`
 * 都没有 Windows 对应物。这里保留两件纯逻辑：
 *   1. **分段表**（哪一帧区间用哪个增益）—— 剪切点和采样率换算是真正的难点
 *   2. **缩放方式选择**（float32/float64/int16/int32/静音）—— 决定 Web Audio 侧
 *      要不要走 Float32Array 快路径
 * 真正的乘算交给 Web Audio 的 GainNode 或 `AudioBuffer` 原地相乘。
 */

/** Swift L12-16：一段增益区间（秒）。 */
export interface TimelineAudioGainSpan {
  readonly start: number
  readonly end: number
  readonly gain: number
}

/**
 * Swift L147：`0.000_000_1`。
 *
 * 只用来消掉 `(boundary − start) / step` 的浮点噪声，**不是**为了吃掉一整帧。
 * 写成 `1e-3` 会真的跳过边界上的那一帧。
 */
export const TIMELINE_AUDIO_GAIN_EPSILON = 1e-7

/** Swift L81-83：非有限值一律当 0（静音），超出 [0,1] 夹住。 */
export function timelineAudioGainClamped(gain: number): number {
  if (!Number.isFinite(gain)) return 0
  return Math.min(Math.max(gain, 0), 1)
}

/** Swift L24-26：丢掉非法区间并按起点排序。 */
export function timelineAudioGainValidSpans(
  spans: readonly TimelineAudioGainSpan[]
): TimelineAudioGainSpan[] {
  return spans
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
    .slice()
    .sort((a, b) => a.start - b.start)
}

/**
 * Swift L28-31：如果**每一段**都等于默认增益，就不必建 tap。
 *
 * 用夹取后的值比较（`clamped($0.gain) != fallback`），所以写 `gain: 2` 与
 * `gain: 1` 在这里等价 —— 两者都会被夹到 1，不构成「需要分段」的理由。
 */
export function timelineAudioGainNeedsProcessor(
  defaultGain: number,
  validSpans: readonly TimelineAudioGainSpan[]
): boolean {
  const fallback = timelineAudioGainClamped(defaultGain)
  return validSpans.some((span) => timelineAudioGainClamped(span.gain) !== fallback)
}

/** Swift L18-79 的可断言结果。 */
export interface TimelineAudioGainParametersPlan {
  /** 直接设在 input 上的整体音量。 */
  readonly volume: number
  /** 是否需要分段处理器。 */
  readonly usesProcessor: boolean
  /** 处理器使用的（已夹取增益的）区间表。 */
  readonly spans: readonly TimelineAudioGainSpan[]
  readonly defaultGain: number
}

/**
 * Swift L18-79。
 *
 * 三条分支：
 *   1. 不需要分段 → 整体设 volume = fallback，无 tap
 *   2. 需要分段且 tap 建成功 → volume = 1（缩放全交给 tap）
 *   3. 需要分段但 tap 建失败 → **volume = 0**
 *
 * 第三条是安全阀：宁可整轨静音，也不能让「用户明确静音的片段」按全局增益
 * 播出来。这个取舍写在 L71-74 的注释里。
 */
export function timelineAudioGainParametersPlan(input: {
  readonly defaultGain: number
  readonly spans: readonly TimelineAudioGainSpan[]
  readonly processorAvailable: boolean
}): TimelineAudioGainParametersPlan {
  const fallback = timelineAudioGainClamped(input.defaultGain)
  const validSpans = timelineAudioGainValidSpans(input.spans)
  if (!timelineAudioGainNeedsProcessor(input.defaultGain, validSpans)) {
    return { volume: fallback, usesProcessor: false, spans: [], defaultGain: fallback }
  }
  const spans = validSpans.map((span) => ({
    start: span.start,
    end: span.end,
    gain: timelineAudioGainClamped(span.gain),
  }))
  if (!input.processorAvailable) {
    return { volume: 0, usesProcessor: false, spans, defaultGain: fallback }
  }
  return { volume: 1, usesProcessor: true, spans, defaultGain: fallback }
}

/**
 * Swift L117-123：二分找第一个 `end > start` 的段。
 *
 * 用 `end <= start` 收缩下界，等价于 Swift 的
 * `if spans[middle].end <= start { lower = middle + 1 }`。
 * 返回 `spans.length` 表示「start 之后没有任何段」。
 */
export function timelineAudioGainFirstSpanIndex(
  spans: readonly TimelineAudioGainSpan[],
  start: number
): number {
  let lower = 0
  let upper = spans.length
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    if (spans[middle]!.end <= start) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }
  return lower
}

/**
 * Swift L144-148：从 `frame` 起、持续到 `boundary` 的帧区间上界。
 *
 *   1. `ceil((boundary − start) / step − ε)` —— 边界落在哪一帧之前
 *   2. `max(frame + 1, …)` —— 至少推进一帧（否则死循环）
 *   3. `min(frameCount, …)` —— 不越出缓冲
 *
 * 半开区间：剪切点上的**第一帧属于下一段**，所以边界帧不进当前区间。
 */
export function timelineAudioGainNextBoundaryFrame(input: {
  readonly frame: number
  readonly frameCount: number
  readonly boundary: number
  readonly start: number
  readonly step: number
}): number {
  const byBoundary = Math.ceil(
    (input.boundary - input.start) / input.step - TIMELINE_AUDIO_GAIN_EPSILON
  )
  return Math.min(input.frameCount, Math.max(input.frame + 1, byBoundary))
}

/** 一段「帧区间 + 增益」。 */
export interface TimelineAudioGainSegment {
  readonly startFrame: number
  readonly endFrame: number
  readonly gain: number
}

/**
 * Swift L99-152：把一次缓冲（`frameCount` 帧，起点 `start` 秒）切成若干等增益段。
 *
 * 三个前置：
 *   - `frameCount <= 0` → 无段
 *   - `start` 非有限、或采样率非正 → **整段静音**（Swift L107-110）
 *   - 步长固定 `1 / sampleRate`，时长由 `frameCount × step` 得出
 *     （**不**用 range.duration，那是源时钟上的值，快剪时会错位）
 *
 * 返回的段首尾相接、覆盖 `[0, frameCount)`，与 Swift 的 while 循环等价。
 */
export function timelineAudioGainSegments(input: {
  readonly spans: readonly TimelineAudioGainSpan[]
  readonly defaultGain: number
  readonly start: number
  readonly sampleRate: number
  readonly frameCount: number
}): TimelineAudioGainSegment[] {
  if (!(input.frameCount > 0)) return []
  if (!Number.isFinite(input.start) || !Number.isFinite(input.sampleRate) || !(input.sampleRate > 0)) {
    return [{ startFrame: 0, endFrame: input.frameCount, gain: 0 }]
  }
  const step = 1 / input.sampleRate
  const duration = input.frameCount * step
  const end = input.start + duration
  let index = timelineAudioGainFirstSpanIndex(input.spans, input.start)
  const segments: TimelineAudioGainSegment[] = []
  let frame = 0
  while (frame < input.frameCount) {
    const time = input.start + frame * step
    while (index < input.spans.length && input.spans[index]!.end <= time) {
      index += 1
    }
    let gain: number
    let boundary: number
    if (index < input.spans.length) {
      const span = input.spans[index]!
      if (time < span.start) {
        gain = input.defaultGain
        boundary = span.start
      } else {
        gain = span.gain
        boundary = span.end
      }
    } else {
      gain = input.defaultGain
      boundary = end
    }
    const nextFrame = timelineAudioGainNextBoundaryFrame({
      frame,
      frameCount: input.frameCount,
      boundary,
      start: input.start,
      step,
    })
    segments.push({ startFrame: frame, endFrame: nextFrame, gain })
    frame = nextFrame
  }
  return segments
}

/**
 * Swift L154-193：某一帧区间该怎么缩放。
 *
 * 顺序即语义：
 *   - `gain == 1` → `identity`（连 memset 都不做，这是最常见的路径）
 *   - `gain == 0` → `zero`（memset，比乘 0 快且对 NaN 也安全）
 *   - float32 → `multiplyFloat32`；float64 → `multiplyFloat64`
 *   - int16 / int32 → `multiplyInteger`
 *   - 其它 → `zero`（「保持显式静音安全」—— 未知格式宁可静音）
 */
export type TimelineAudioGainScaleKind =
  | 'identity'
  | 'zero'
  | 'multiplyFloat32'
  | 'multiplyFloat64'
  | 'multiplyInteger'

export function timelineAudioGainScaleKind(input: {
  readonly gain: number
  readonly isFloat: boolean
  readonly isSignedInteger: boolean
  readonly bytesPerSample: number
}): TimelineAudioGainScaleKind {
  if (input.gain === 1) return 'identity'
  if (input.gain === 0) return 'zero'
  if (input.isFloat && input.bytesPerSample === 4) return 'multiplyFloat32'
  if (input.isFloat && input.bytesPerSample === 8) return 'multiplyFloat64'
  if (input.isSignedInteger && input.bytesPerSample === 2) return 'multiplyInteger'
  if (input.isSignedInteger && input.bytesPerSample === 4) return 'multiplyInteger'
  return 'zero'
}

/**
 * Swift L166-167：`min(frames.lower × channels, mDataByteSize / bytesPerSample)`。
 *
 * 上限来自**缓冲自己的字节数**，而不是帧数 —— 多声道交错缓冲里
 * `lower × channels` 很容易超出实际写入量。
 */
export function timelineAudioGainSampleCount(input: {
  readonly lowerFrame: number
  readonly upperFrame: number
  readonly channels: number
  readonly byteSize: number
  readonly bytesPerSample: number
}): number {
  if (!(input.bytesPerSample > 0)) return 0
  const limit = Math.trunc(input.byteSize / input.bytesPerSample)
  const first = Math.min(input.lowerFrame * input.channels, limit)
  const last = Math.min(input.upperFrame * input.channels, limit)
  return Math.max(last - first, 0)
}
