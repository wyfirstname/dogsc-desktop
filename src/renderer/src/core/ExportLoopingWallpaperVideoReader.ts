/**
 * Swift source: Sources/DogSCApp/ExportLoopingWallpaperVideoReader.swift（92 行）@ 567fd6e
 *
 * L19-26  → 构造：时长必须有限且 > 0，否则 `unusableMediaRange(role)`
 * L28-60  → frame(at:)：循环索引 + 本地时间 + 采样推进
 * L62-91  → resetReader：重建 reader / output，清空当前帧
 *
 * 原注释：导出视频队列用的串行、只向前的解码器。壁纸按**输出时间**循环播放，
 * 且有意静音 —— 工程声音只由录到的系统 / 麦克风轨持有。
 */

/** 采样可提前量：本地时间 ≤ 目标 + 0.5ms 就算命中。 */
export const WALLPAPER_SAMPLE_TOLERANCE = 0.0005

export interface WallpaperLoopPosition {
  readonly loopIndex: number
  readonly localTime: number
}

/**
 * 循环位置（Swift L29-31）：`loopIndex = floor(t / duration)`，
 * `localTime = t % duration`。负值 / 非有限值先夹到 0。
 */
export function wallpaperLoopPosition(outputTime: number, duration: number): WallpaperLoopPosition {
  const safe = Math.max(Number.isFinite(outputTime) ? outputTime : 0, 0)
  const index = Math.floor(safe / duration)
  // JS 的 % 对正数等价于 truncatingRemainder
  return { loopIndex: index, localTime: safe % duration }
}

/**
 * 是否需要重建解码器（Swift L32）。
 *
 * 三种情况：还没建过、进入了下一圈、**本地时间倒退**（用户在刷帧）。
 * 第三种最容易被漏掉：同一圈内回拖时，reader 已经越过目标位置，
 * 不重建就只能拿到后面的帧，画面会「跳一下」。
 */
export function wallpaperReaderResetRequired(input: {
  readonly hasReader: boolean
  readonly loopIndex: number
  readonly previousLoopIndex: number
  readonly localTime: number
  readonly currentLocalTime: number
}): boolean {
  return (
    !input.hasReader ||
    input.loopIndex !== input.previousLoopIndex ||
    input.localTime < input.currentLocalTime
  )
}

/**
 * 推进到目标本地时间（Swift L38-44）：取最后一个 `sampleTime ≤ target + tolerance`
 * 的样本索引；一个都取不到时返回 -1（表示「保持当前帧不动」）。
 */
export function wallpaperAdvanceIndex(input: {
  readonly sampleTimes: readonly number[]
  readonly startOffset: number
  readonly localTime: number
}): number {
  let last = -1
  for (let index = 0; index < input.sampleTimes.length; index += 1) {
    const localSampleTime = input.sampleTimes[index] - input.startOffset
    if (localSampleTime <= input.localTime + WALLPAPER_SAMPLE_TOLERANCE) last = index
    else break
  }
  return last
}

export interface LoopingWallpaperReaderState {
  readonly loopIndex: number
  readonly localTime: number
  readonly hasReader: boolean
  readonly readerFailed: boolean
}

/**
 * 读取器的状态骨架：真正的解码由 port 承担，判定逻辑留在这里，因此循环、
 * 回拖、读失败三条路径都可断言。
 */
export class LoopingWallpaperReader {
  private readonly duration: number
  private loopIndex = -1
  private localTime = -1
  private readerOpen = false

  constructor(duration: number) {
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new RangeError('unusableMediaRange')
    }
    this.duration = duration
  }

  get state(): LoopingWallpaperReaderState {
    return {
      loopIndex: this.loopIndex,
      localTime: this.localTime,
      hasReader: this.readerOpen,
      readerFailed: false,
    }
  }

  /** 规划一次取帧：返回是否要重置解码器以及目标本地时间。 */
  plan(outputTime: number, readerFailed = false): {
    readonly reset: boolean
    readonly loopIndex: number
    readonly localTime: number
    readonly failed: boolean
  } {
    const position = wallpaperLoopPosition(outputTime, this.duration)
    const reset = wallpaperReaderResetRequired({
      hasReader: this.readerOpen,
      loopIndex: position.loopIndex,
      previousLoopIndex: this.loopIndex,
      localTime: position.localTime,
      currentLocalTime: this.localTime,
    })
    if (reset) {
      this.readerOpen = true
      this.loopIndex = position.loopIndex
    }
    this.localTime = position.localTime
    return { reset, loopIndex: position.loopIndex, localTime: position.localTime, failed: readerFailed }
  }

  /** 读失败时抛出的错误语义（Swift L48-54）。 */
  static failureMessage(roleDisplayName: string): string {
    return `${roleDisplayName}视频轨读取失败`
  }
}

/**
 * 无当前帧时的兜底（Swift L45-47）：直接取下一个样本，避免第一帧全黑。
 * 返回 null 表示确实没有可用帧。
 */
export function wallpaperFallbackIndex(input: {
  readonly hasCurrentFrame: boolean
  readonly hasNextSample: boolean
}): 'keepCurrent' | 'takeNext' | 'none' {
  if (input.hasCurrentFrame) return 'keepCurrent'
  return input.hasNextSample ? 'takeNext' : 'none'
}
