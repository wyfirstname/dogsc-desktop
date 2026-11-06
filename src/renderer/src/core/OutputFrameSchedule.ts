/**
 * 导出视频帧数与 PTS 的唯一事实来源。
 *
 * Swift source: Sources/RecorderCore/OutputFrameSchedule.swift @ laogou717/dogsc 567fd6e
 *
 * 排他边界：帧 n 存在当且仅当 0 <= n / frameRate < duration。
 * 表现时间戳来自整数 tick 网格，而不是累加浮点帧时长。
 */

import type { TimeInterval } from './ZoomAnimation'
import type { OutputFrameRate } from './CaptureConfiguration'

export interface OutputFrame {
  index: number
  presentationTimeValue: number // Int64
  presentationTimescale: number // Int32
}

export function framePresentationTimeSeconds(frame: OutputFrame): TimeInterval {
  return frame.presentationTimeValue / frame.presentationTimescale
}

export type OutputFrameScheduleErrorKind = 'invalidDuration' | 'durationTooLong'

export class OutputFrameScheduleError extends Error {
  constructor(readonly kind: OutputFrameScheduleErrorKind) {
    super(kind === 'invalidDuration' ? '导出时长必须是非负有限数。' : '导出时长超出可排帧上限。')
    this.name = 'OutputFrameScheduleError'
  }
}

/**
 * 90,000 恰好被所有支持的输出帧率（60/90/120）整除。
 * （Swift 还列了 30，30 × 3000 = 90000 同样整除。）
 */
export const PRESENTATION_TIMESCALE = 90_000

export class OutputFrameSchedule {
  readonly duration: TimeInterval
  readonly frameRate: OutputFrameRate
  readonly frameCount: number
  readonly ticksPerFrame: number

  constructor(duration: TimeInterval, frameRate: OutputFrameRate) {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new OutputFrameScheduleError('invalidDuration')
    }

    const timescale = PRESENTATION_TIMESCALE
    const rate = frameRate
    if (timescale % rate !== 0) {
      // Swift 里是 precondition；这里按不可能路径防御
      throw new OutputFrameScheduleError('invalidDuration')
    }

    const ticksPerFrame = Math.floor(timescale / rate)
    const scaledDuration = duration * rate
    const maximumFrameCount = Number.MAX_SAFE_INTEGER / ticksPerFrame + 1
    if (!Number.isFinite(scaledDuration) || scaledDuration > maximumFrameCount) {
      throw new OutputFrameScheduleError('durationTooLong')
    }

    // (1/90)*90 这类值概念上是整数，但浮点上差几个 ulp。只吸附表示噪声；
    // 与固定 epsilon 不同，这不会抹掉真实的亚 1/60000 秒尾巴。
    const nearestInteger = Math.round(scaledDuration)
    const boundaryTolerance = Math.max(ulp(scaledDuration) * 4, ulp(nearestInteger) * 4)
    const boundarySafeDuration =
      Math.abs(scaledDuration - nearestInteger) <= boundaryTolerance
        ? nearestInteger
        : scaledDuration
    const frameCount = boundarySafeDuration > 0 ? Math.ceil(boundarySafeDuration) : 0

    if (frameCount > 0) {
      const lastFrameIndex = frameCount - 1
      if (lastFrameIndex > Number.MAX_SAFE_INTEGER / ticksPerFrame) {
        throw new OutputFrameScheduleError('durationTooLong')
      }
    }

    this.duration = duration
    this.frameRate = frameRate
    this.frameCount = frameCount
    this.ticksPerFrame = ticksPerFrame
  }

  frame(index: number): OutputFrame | null {
    if (index < 0 || index >= this.frameCount) return null
    return {
      index,
      presentationTimeValue: index * this.ticksPerFrame,
      presentationTimescale: PRESENTATION_TIMESCALE,
    }
  }
}

/** Swift Double.ulp 的等价物：与 x 相邻的大于 x 的数之间的间隔。 */
function ulp(x: number): number {
  if (!Number.isFinite(x)) return Number.POSITIVE_INFINITY
  const absX = Math.abs(x)
  if (absX === 0) return Number.MIN_VALUE
  const next = Math.max(absX, Number.MIN_VALUE)
  const nextUp = nextPlus(next)
  return nextUp - next
}

function nextPlus(x: number): number {
  if (x === Number.MAX_VALUE) return Number.POSITIVE_INFINITY
  // 通过 Buffer 精确 +1 ULP（大数相减会失真）
  const buf = new DataView(new ArrayBuffer(8))
  buf.setFloat64(0, x)
  let high = buf.getUint32(0)
  const low = buf.getUint32(4)
  if (x >= 0) {
    if (high === 0x7ff00000 && low === 0) return Number.POSITIVE_INFINITY
    if (low === 0xffffffff) {
      buf.setUint32(0, high + 1)
      buf.setUint32(4, 0)
    } else {
      buf.setUint32(4, low + 1)
    }
  } else {
    if (low === 0) {
      buf.setUint32(0, high - 1)
      buf.setUint32(4, 0xffffffff)
    } else {
      buf.setUint32(4, low - 1)
    }
  }
  return buf.getFloat64(0)
}
