/**
 * MediaTimeline — 源轨道与工程时间线之间的规范映射 + 相机时钟校正曲线。
 *
 * Swift source: Sources/RecorderCore/MediaTimeline.swift @ laogou717/dogsc 567fd6e
 *   逐项对照（按源文件行号）：
 *   - struct MediaTimelinePlacement（init 与派生属性） (L6/L12)
 *   - struct MediaSyncAnchorCurve                     (L76)
 *
 * `ProjectMediaReference` 描述用户/采集摆放；可用源区间来自采集框架的
 * 实际轨道清单（Windows 侧为 ffprobe / MediaFoundation 结果）。
 */

import type { ProjectMediaReference, MediaSyncAnchor } from './ProjectMediaModel'
import { randomUUID } from './ProjectTimeline'

export type TimeInterval = number

const nonnegative = (v: TimeInterval): TimeInterval =>
  Number.isFinite(v) ? Math.max(v, 0) : 0

// ---------------------------------------------------------------- MediaTimelinePlacement

/** 源轨道与工程时间线之间的一一对应映射。 */
export class MediaTimelinePlacement {
  readonly timelineStart: TimeInterval
  readonly sourceStart: TimeInterval
  readonly playableDuration: TimeInterval
  readonly sourceTimeScale: number

  constructor(
    reference: ProjectMediaReference,
    sourceAvailableDuration: TimeInterval,
    timelineDuration: TimeInterval,
    sourceAvailableStart: TimeInterval = 0
  ) {
    const requestedSourceStart = nonnegative(reference.sourceStartTime)
    const availableStart = nonnegative(sourceAvailableStart)
    const availableDuration = nonnegative(sourceAvailableDuration)
    const availableEnd = availableStart + availableDuration
    const effectiveSourceStart = Math.min(Math.max(requestedSourceStart, availableStart), availableEnd)
    const requestedSourceEnd = reference.sourceEndTime ?? availableEnd
    const effectiveSourceEnd = Math.min(Math.max(requestedSourceEnd, effectiveSourceStart), availableEnd)
    const unavailableLead = Math.max(effectiveSourceStart - requestedSourceStart, 0)
    const effectiveTimelineStart = nonnegative(reference.startOffset) + unavailableLead
    const safeTimelineDuration = nonnegative(timelineDuration)
    const requestedScale = reference.sourceTimeScale ?? 1
    const safeScale = Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1

    this.sourceStart = effectiveSourceStart
    this.timelineStart = Math.min(effectiveTimelineStart, safeTimelineDuration)
    this.sourceTimeScale = safeScale
    this.playableDuration = Math.min(
      Math.max(effectiveSourceEnd - effectiveSourceStart, 0) / safeScale,
      Math.max(safeTimelineDuration - this.timelineStart, 0)
    )
  }

  get sourceEnd(): TimeInterval {
    return this.sourceStart + this.playableDuration * this.sourceTimeScale
  }

  get timelineEnd(): TimeInterval {
    return this.timelineStart + this.playableDuration
  }

  /** 时间线时刻 → 源时钟时刻；区间外返回 null。 */
  sourceTimeAt(timelineTime: TimeInterval): TimeInterval | null {
    if (!Number.isFinite(timelineTime)) return null
    if (timelineTime < this.timelineStart || timelineTime >= this.timelineEnd) return null
    return this.sourceStart + (timelineTime - this.timelineStart) * this.sourceTimeScale
  }

  /** 源时钟时刻 → 时间线时刻；区间外返回 null。 */
  timelineTimeFor(sourceTime: TimeInterval): TimeInterval | null {
    if (!Number.isFinite(sourceTime)) return null
    if (sourceTime < this.sourceStart || sourceTime >= this.sourceEnd) return null
    return this.timelineStart + (sourceTime - this.sourceStart) / this.sourceTimeScale
  }

  contains(timelineTime: TimeInterval): boolean {
    return this.sourceTimeAt(timelineTime) !== null && this.playableDuration > 0
  }
}

// ---------------------------------------------------------------- MediaSyncAnchorCurve

/**
 * 对原始屏幕源时钟求值的分段线性相机时钟校正曲线。
 * 第一个手授锚点之前，曲线从源时间零点的隐式零校正开始增长；
 * 最后一个锚点之后保持末段校正。
 */
export class MediaSyncAnchorCurve {
  readonly anchors: MediaSyncAnchor[]

  constructor(anchors: MediaSyncAnchor[]) {
    this.anchors = [...anchors].sort((lhs, rhs) =>
      lhs.sourceTime !== rhs.sourceTime
        ? lhs.sourceTime - rhs.sourceTime
        : lhs.id < rhs.id
          ? -1
          : lhs.id > rhs.id
            ? 1
            : 0
    )
  }

  offsetAt(sourceTime: TimeInterval): TimeInterval {
    if (!Number.isFinite(sourceTime) || this.anchors.length === 0) return 0
    const safeTime = Math.max(sourceTime, 0)
    const first = this.anchors[0]

    // 保留隐式零校正原点，不复制整个锚点数组、不为每次采样分配临时 UUID。
    // 编辑器曲线绘制与辅助媒体计划构建会高频命中这条路径。
    if (first.sourceTime > 0.000001 && safeTime <= first.sourceTime) {
      const progress = Math.min(Math.max(safeTime / first.sourceTime, 0), 1)
      return first.offset * progress
    }
    if (safeTime <= first.sourceTime) return first.offset

    // 锚点在初始化时已排序；二分找第一个右侧锚点而不是整条曲线线性走查。
    let lower = 1
    let upper = this.anchors.length
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2)
      if (this.anchors[middle].sourceTime < safeTime) {
        lower = middle + 1
      } else {
        upper = middle
      }
    }
    if (lower >= this.anchors.length) {
      return this.anchors[this.anchors.length - 1].offset
    }
    const left = this.anchors[lower - 1]
    const right = this.anchors[lower]
    const span = right.sourceTime - left.sourceTime
    if (!(span > 0.000001)) return right.offset
    const progress = Math.min(Math.max((safeTime - left.sourceTime) / span, 0), 1)
    return left.offset + (right.offset - left.offset) * progress
  }
}

/** 便捷构造：缺省 id 的锚点（本地辅助）。 */
export function anchor(sourceTime: number, offset: number, id?: string): MediaSyncAnchor {
  return { id: id ?? randomUUID(), sourceTime, offset }
}
