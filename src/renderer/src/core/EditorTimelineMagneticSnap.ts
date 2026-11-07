/**
 * Swift source: Sources/DogSCApp/EditorTimelineMagneticSnap.swift @ 567fd6e
 *
 * 逐结构对照（已剥离 AppKit / SwiftUI / 触感反馈）：
 *   reset / release                          L14-23
 *   resolve(_:offsets:initial:...)           L25-69
 *   validate(edges:)                         L73-76
 *
 * 手势内磁铁：**捕获距离** 与 **脱开距离** 分开（7pt 吸上、14pt 才松开），
 * 目标点从「已提交的数据」缓存，因此正在移动的片段不会把自己吸过去。
 *
 * 与原实现的差异只有一处：NSEvent.modifierFlags 的 Shift 屏蔽与
 * NSHapticFeedbackManager 的「对齐」触感在 Electron 里由调用方注入 ——
 * `skipRequested` 决定是否临时跳过吸附，`onAlignment` 负责触感/脉冲提示。
 */

import type { TimeInterval } from './ZoomAnimation'

/** Swift capture = 7 / pointsPerSecond。 */
const CAPTURE_POINTS = 7
/** Swift escape = 14 / pointsPerSecond。 */
const ESCAPE_POINTS = 14
/** Swift 的 0.000_01 初值比较容差。 */
const INITIAL_MATCH_TOLERANCE = 0.000_01
/** Swift validate 的 0.000_1 边界比较容差。 */
const EDGE_MATCH_TOLERANCE = 0.000_1

export interface MagneticSnapResolveOptions {
  /** 候选时间点（每次 resolve 现算，首次结果会被缓存）。 */
  targets: () => TimeInterval[]
  /** 手势起点已占据的时间（自身边缘），用于首次屏蔽「自吸」。 */
  initial?: TimeInterval[]
  /**
   * 本次事件是否要求临时跳过吸附（Swift 的 Shift 修饰键）。
   * 跳过时会先 release()，因此松手后不会留下过期磁吸点。
   */
  skipRequested?: boolean
}

/**
 * 对齐成功的触感回调（Swift `NSHapticFeedbackManager...perform(.alignment)`）。
 * 只在「吸到新的目标」时触发，同一目标持续跟随不重复触发。
 */
export type MagneticAlignmentCallback = (targetTime: TimeInterval) => void

export class EditorTimelineMagneticSnap {
  /** 对外的磁吸目标时刻；null 表示当前未吸上。 */
  private currentTargetTime: TimeInterval | null = null
  private candidates: TimeInterval[] | null = null
  private heldOffset = 0
  private suppressed = new Set<number>()

  constructor(private readonly onAlignment?: MagneticAlignmentCallback) {}

  /** Swift targetTime（@Published private(set)）。 */
  get targetTime(): TimeInterval | null {
    return this.currentTargetTime
  }

  /** Swift reset()（L14-18）：缓存与屏蔽集一起清掉。 */
  reset(): void {
    this.candidates = null
    this.suppressed.clear()
    this.release()
  }

  /** Swift release()（L20-23）：只松开磁吸，不动候选缓存。 */
  release(): void {
    if (this.currentTargetTime !== null) this.currentTargetTime = null
    this.heldOffset = 0
  }

  /**
   * Swift resolve(...)（L25-69）。
   *
   * @param proposed     未经吸附的候选时刻
   * @param offsets      同一次拖动里需要同时吸附的边缘偏移（0 = 起点，
   *                     end-start = 终点；移动时两者都参与）
   * @param pointsPerSecond 时间线当前的比例尺，用来把 pt 阈值换算成秒
   */
  resolve(
    proposed: TimeInterval,
    offsets: number[],
    pointsPerSecond: number,
    options: MagneticSnapResolveOptions
  ): TimeInterval {
    const initial = options.initial ?? []
    if (!Number.isFinite(proposed) || !(pointsPerSecond > 0)) return proposed
    const capture = CAPTURE_POINTS / pointsPerSecond
    const escape = ESCAPE_POINTS / pointsPerSecond

    if (this.candidates === null) {
      const raw = options
        .targets()
        .filter((point) => Number.isFinite(point))
        .sort((lhs, rhs) => lhs - rhs)
      // Swift `Array(Set(...)).sorted()`：去重后再排序
      this.candidates = raw.filter((point, index) => index === 0 || point !== raw[index - 1])
      this.suppressed = new Set(
        this.candidates.filter((point) =>
          initial.some((edge) => Math.abs(edge - point) < INITIAL_MATCH_TOLERANCE)
        )
      )
    }

    // 屏蔽集是「脱离」而不是「永久黑名单」：一旦某点重新落回 escape 范围，
    // 说明指针又靠回来了，下一轮可以再次吸附。
    this.suppressed = new Set(
      [...this.suppressed].filter((point) =>
        offsets.some((offset) => Math.abs(proposed + offset - point) <= escape)
      )
    )

    if (options.skipRequested === true) {
      this.release()
      return proposed
    }

    // 已经吸住：只要指针仍在脱开半径内，输出保持为「目标 − 保持偏移」，
    // 这样拖动过程中片段边缘稳定贴在目标上，不随指针微抖。
    if (
      this.currentTargetTime !== null &&
      Math.abs(proposed + this.heldOffset - this.currentTargetTime) <= escape
    ) {
      return this.currentTargetTime - this.heldOffset
    }

    this.release()
    const points = this.candidates ?? []
    let best: { distance: number; time: number; offset: number } | null = null
    for (const offset of offsets) {
      const position = proposed + offset
      // Swift 手写二分：第一个 >= position 的下标
      let lo = 0
      let hi = points.length
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (points[mid] < position) lo = mid + 1
        else hi = mid
      }
      for (const index of [lo - 1, lo]) {
        if (index < 0 || index >= points.length) continue
        const point = points[index]
        const distance = Math.abs(point - position)
        if (this.suppressed.has(point)) continue
        if (!(distance <= capture)) continue
        if (!(distance < (best === null ? Number.POSITIVE_INFINITY : best.distance))) continue
        best = { distance, time: point, offset }
      }
    }
    if (best === null) return proposed
    this.heldOffset = best.offset
    if (this.currentTargetTime !== best.time) {
      this.onAlignment?.(best.time)
    }
    this.currentTargetTime = best.time
    return best.time - best.offset
  }

  /**
   * Swift validate(edges:)（L73-76）。
   *
   * 既有的重叠/最短时长规则才是权威：如果合法落点根本没走到磁吸目标，
   * 绝不能继续对外宣称一个「磁吸对齐」。
   */
  validate(edges: TimeInterval[]): void {
    if (this.currentTargetTime === null) return
    const target = this.currentTargetTime
    if (!edges.some((edge) => Math.abs(edge - target) < EDGE_MATCH_TOLERANCE)) {
      this.release()
    }
  }
}

// ---------------------------------------------------------------- 目标点收集

/** 磁吸候选来源：与 Swift `magneticTargets(duration:)` 的输入一致。 */
export interface MagneticTargetSource {
  duration: TimeInterval
  /** 主录屏片段的输出区间端点。 */
  primarySegments: Array<{ id: string; outputStart: number; outputDuration: number }>
  zoomClips: Array<{ id: string; startTime: number; endTime: number }>
  screenMotionClips: Array<{ id: string; startTime: number; endTime: number }>
  cameraMotionClips: Array<{ id: string; startTime: number; endTime: number }>
  mosaicClips: Array<{ id: string; startTime: number; endTime: number }>
  stickerClips: Array<{ id: string; startTime: number; endTime: number }>
  playbackTime: TimeInterval
  showsZoomTimeline: boolean
  showsScreenMotionTimeline: boolean
  showsCameraMotionTimeline: boolean
  showsOverlayTimeline: boolean
  /** 拖动中被排除的片段（含联动伙伴），它们自己的边界不再是目标。 */
  excludedIDs: Set<string>
  /** scrub 手势期间播放头不作为目标（避免播放头一路追着自己）。 */
  isScrubbing: boolean
}

/**
 * Swift magneticTargets(duration:)（L96-128）。
 *
 * 语义要点：除了 0 与总时长，每个可见轨道的**片段端点**都是磁吸目标；
 * 拖动中的片段及其联动伙伴被排除；非 scrub 手势下播放头也是目标。
 * 最后统一裁到 [0, duration]。
 */
export function magneticTargets(source: MagneticTargetSource): TimeInterval[] {
  const excluded = source.excludedIDs
  const points: number[] = [0, source.duration]
  for (const clip of source.primarySegments) {
    if (excluded.has(clip.id)) continue
    points.push(clip.outputStart, clip.outputStart + clip.outputDuration)
  }
  const pushTrack = (
    clips: Array<{ id: string; startTime: number; endTime: number }>,
    visible: boolean
  ): void => {
    if (!visible) return
    for (const clip of clips) {
      if (excluded.has(clip.id)) continue
      points.push(clip.startTime, clip.endTime)
    }
  }
  pushTrack(source.zoomClips, source.showsZoomTimeline)
  pushTrack(source.screenMotionClips, source.showsScreenMotionTimeline)
  pushTrack(source.cameraMotionClips, source.showsCameraMotionTimeline)
  if (source.showsOverlayTimeline) {
    pushTrack(source.mosaicClips, true)
    pushTrack(source.stickerClips, true)
  }
  if (!source.isScrubbing) points.push(source.playbackTime)
  return points.filter((point) => point >= 0 && point <= source.duration)
}

/**
 * Swift magneticTime(...)（L130-137）。
 * 缩放比例尺 = width / max(duration, 0.001)，因此 7pt 在长工程里对应更短的时间。
 */
export function magneticTime(
  snap: EditorTimelineMagneticSnap,
  time: TimeInterval,
  width: number,
  duration: TimeInterval,
  source: Omit<MagneticTargetSource, 'duration' | 'playbackTime' | 'isScrubbing'> & {
    playbackTime?: TimeInterval
    isScrubbing?: boolean
  },
  offsets: number[] = [0],
  initial: TimeInterval[] = [],
  skipRequested = false
): TimeInterval {
  const pointsPerSecond = width / Math.max(duration, 0.001)
  return snap.resolve(time, offsets, pointsPerSecond, {
    initial,
    skipRequested,
    targets: () =>
      magneticTargets({
        ...source,
        duration,
        playbackTime: source.playbackTime ?? 0,
        isScrubbing: source.isScrubbing ?? false,
      }),
  })
}

/**
 * Swift magneticDelta(...)（L139-148）—— 拖动增量的磁吸版本。
 *
 * 三种模式参与吸附的边缘不同：移动吸附两端，拖左端只吸附起点，
 * 拖右端只吸附终点；`initial` 传原始两端，避免一开始就吸上自己的边。
 */
export function magneticDelta(
  snap: EditorTimelineMagneticSnap,
  delta: TimeInterval,
  start: TimeInterval,
  end: TimeInterval,
  mode: 'move' | 'leading' | 'trailing',
  width: number,
  duration: TimeInterval,
  source: Parameters<typeof magneticTime>[4],
  skipRequested = false
): TimeInterval {
  const offsets = mode === 'move' ? [0, end - start] : mode === 'leading' ? [0] : [end - start]
  return (
    magneticTime(snap, start + delta, width, duration, source, offsets, [start, end], skipRequested) -
    start
  )
}
