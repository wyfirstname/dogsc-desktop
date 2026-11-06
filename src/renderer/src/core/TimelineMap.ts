/**
 * 最终波纹时间线 ↔ 原始录制时钟之间的纯映射。
 *
 * 来源：upstream-dogsc/Sources/RecorderCore/TimelineMap.swift
 * 基线：laogou717/dogsc @ 567fd6e
 *
 * 数组顺序即输出顺序；源区间可以重排，但必须互不重叠，这样每个原始
 * 源时刻都恰好有一个归属。
 */

import type { TimeInterval } from './ZoomAnimation'
import type { MediaTimeRange } from './MediaTimeRange'
import { makeRange } from './MediaTimeRange'
import type { PointerEventRecord } from './ZoomAnimation'
import { normalizedPointerEvents } from './PointerEventTimelineOrdering'
import {
  FULL_RECORDING_SEGMENT_ID,
  type RecordingSegment,
  type SourceSequence,
} from './ProjectTimeline'

/** 对应 Swift ProjectTimelineEditing.epsilon。 */
export const TIMELINE_EPSILON = 1.0 / 120_000.0

// ---------------------------------------------------------------- Errors

export type TimelineMapErrorKind =
  | 'invalidFullSourceDuration'
  | 'emptyEditedSequence'
  | 'duplicateSegmentID'
  | 'invalidSegment'
  | 'segmentOutsideSource'
  | 'nonMonotonicSegments'

export class TimelineMapError extends Error {
  readonly kind: TimelineMapErrorKind

  constructor(kind: TimelineMapErrorKind, message: string, readonly segmentID?: string) {
    super(message)
    this.name = 'TimelineMapError'
    this.kind = kind
  }
}

function messageFor(kind: TimelineMapErrorKind): string {
  switch (kind) {
    case 'invalidFullSourceDuration':
      return '主录屏时长必须是正的有限数。'
    case 'emptyEditedSequence':
      return '剪辑后至少需要保留一个主录屏片段。'
    case 'duplicateSegmentID':
      return '时间线中存在重复的主片段。'
    case 'invalidSegment':
      return '主片段包含无效的时间范围。'
    case 'segmentOutsideSource':
      return '主片段超出原始录屏可用时长。'
    case 'nonMonotonicSegments':
      return '主片段不能重复使用同一段源素材。'
  }
}

// ---------------------------------------------------------------- Resolved

/** 已解析出 outputStart 的主片段。 */
export interface ResolvedRecordingSegment {
  id: string
  sourceStart: TimeInterval
  sourceDuration: TimeInterval
  playbackRate: number
  outputStart: TimeInterval
}

export function resolvedSourceEnd(segment: ResolvedRecordingSegment): TimeInterval {
  return segment.sourceStart + segment.sourceDuration
}

export function resolvedOutputDuration(segment: ResolvedRecordingSegment): TimeInterval {
  return segment.sourceDuration / segment.playbackRate
}

export function resolvedOutputEnd(segment: ResolvedRecordingSegment): TimeInterval {
  return segment.outputStart + resolvedOutputDuration(segment)
}

// ---------------------------------------------------------------- TimelineMap

/**
 * 不可变的时间线映射。构造时完成全部校验，之后只做查询。
 *
 * `outputStart` 在此处一次性累加得出，**不落盘**。这正是「裁切/波纹删除
 * 不会留下两个矛盾位置」的实现方式。
 */
export class TimelineMap {
  readonly segments: ResolvedRecordingSegment[]
  readonly fullSourceDuration: TimeInterval

  constructor(sourceSequence: SourceSequence, fullSourceDuration: TimeInterval) {
    if (!Number.isFinite(fullSourceDuration) || !(fullSourceDuration > 0)) {
      throw new TimelineMapError(
        'invalidFullSourceDuration',
        messageFor('invalidFullSourceDuration')
      )
    }
    this.fullSourceDuration = fullSourceDuration

    let authored: RecordingSegment[]
    if (sourceSequence.kind === 'fullRecording') {
      authored = [
        {
          id: FULL_RECORDING_SEGMENT_ID,
          sourceStart: 0,
          sourceDuration: fullSourceDuration,
          playbackRate: 1,
        },
      ]
    } else {
      if (sourceSequence.segments.length === 0) {
        throw new TimelineMapError('emptyEditedSequence', messageFor('emptyEditedSequence'))
      }
      authored = sourceSequence.segments
    }

    const identifiers = new Set<string>()
    let outputStart = 0
    const resolved: ResolvedRecordingSegment[] = []
    const epsilon = TIMELINE_EPSILON

    for (const segment of authored) {
      if (identifiers.has(segment.id)) {
        throw new TimelineMapError(
          'duplicateSegmentID',
          messageFor('duplicateSegmentID'),
          segment.id
        )
      }
      identifiers.add(segment.id)

      const sourceEnd = segment.sourceStart + segment.sourceDuration
      if (
        !Number.isFinite(segment.sourceStart) ||
        !Number.isFinite(segment.sourceDuration) ||
        !Number.isFinite(segment.playbackRate) ||
        segment.sourceStart < 0 ||
        !(segment.sourceDuration > 0) ||
        !(segment.playbackRate > 0) ||
        !Number.isFinite(sourceEnd)
      ) {
        throw new TimelineMapError('invalidSegment', messageFor('invalidSegment'), segment.id)
      }

      const availableDuration = fullSourceDuration
      if (segment.sourceStart >= availableDuration || sourceEnd > availableDuration + epsilon) {
        throw new TimelineMapError(
          'segmentOutsideSource',
          messageFor('segmentOutsideSource'),
          segment.id
        )
      }

      const resolvedDuration = Math.min(
        segment.sourceDuration,
        availableDuration - segment.sourceStart
      )
      if (!(resolvedDuration > 0)) {
        throw new TimelineMapError(
          'segmentOutsideSource',
          messageFor('segmentOutsideSource'),
          segment.id
        )
      }

      resolved.push({
        id: segment.id,
        sourceStart: segment.sourceStart,
        sourceDuration: resolvedDuration,
        playbackRate: segment.playbackRate,
        outputStart,
      })
      outputStart += resolvedDuration / segment.playbackRate
    }

    // 源区间不得重叠：找出「紧邻的前一个源片段」再比对。
    for (const current of authored) {
      let previous: RecordingSegment | null = null
      for (const candidate of authored) {
        if (candidate.id === current.id) continue
        if (candidate.sourceStart > current.sourceStart) continue
        if (previous === null) {
          previous = candidate
          continue
        }
        if (
          candidate.sourceStart > previous.sourceStart ||
          (candidate.sourceStart === previous.sourceStart &&
            candidate.id > previous.id)
        ) {
          previous = candidate
        }
      }
      if (previous === null) continue
      const previousEnd = previous.sourceStart + previous.sourceDuration
      if (current.sourceStart < previousEnd - epsilon) {
        throw new TimelineMapError(
          'nonMonotonicSegments',
          messageFor('nonMonotonicSegments'),
          current.id
        )
      }
    }

    this.segments = resolved
  }

  get outputDuration(): TimeInterval {
    const last = this.segments[this.segments.length - 1]
    return last ? resolvedOutputEnd(last) : 0
  }

  /** 二分查找输出时刻所属的片段。 */
  segmentAtOutputTime(time: TimeInterval): ResolvedRecordingSegment | null {
    const outputDuration = this.outputDuration
    if (!Number.isFinite(time) || time < 0 || time >= outputDuration) return null
    let lower = 0
    let upper = this.segments.length
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2)
      if (resolvedOutputEnd(this.segments[middle]) <= time) {
        lower = middle + 1
      } else {
        upper = middle
      }
    }
    if (lower >= this.segments.length) return null
    const candidate = this.segments[lower]
    return time >= candidate.outputStart ? candidate : null
  }

  /** 输出时刻 → 源时刻（考虑变速）。 */
  sourceTimeAtOutputTime(time: TimeInterval): TimeInterval | null {
    const segment = this.segmentAtOutputTime(time)
    if (!segment) return null
    return segment.sourceStart + (time - segment.outputStart) * segment.playbackRate
  }

  /** 源时刻 → 输出时刻；不在任何保留片段内则 null。 */
  outputTimeForSourceTime(time: TimeInterval): TimeInterval | null {
    if (!Number.isFinite(time)) return null
    const segment = this.segments.find(
      s => time >= s.sourceStart && time < resolvedSourceEnd(s)
    )
    if (!segment) return null
    return segment.outputStart + (time - segment.sourceStart) / segment.playbackRate
  }

  segmentByID(id: string): ResolvedRecordingSegment | null {
    return this.segments.find(s => s.id === id) ?? null
  }

  /** 冻结为可持久化的 `.edited` 源序列。 */
  materializedSourceSequence(): SourceSequence {
    return {
      kind: 'edited',
      segments: this.segments.map(s => ({
        id: s.id,
        sourceStart: s.sourceStart,
        sourceDuration: s.sourceDuration,
        playbackRate: s.playbackRate,
      })),
    }
  }

  /** 该片段在输出时间线上的起止。 */
  outputRangeForSegmentID(id: string): { start: TimeInterval; end: TimeInterval } | null {
    const segment = this.segmentByID(id)
    if (!segment) return null
    return { start: segment.outputStart, end: resolvedOutputEnd(segment) }
  }

  // Swift source: TimelineMap.swift @ 567fd6e L439-500（mapPointerEventSegments）
  // 与 L502-515（firstEventIndex(atOrAfter:in:)）。

  /**
   * 把源指针事件逐段映射到输出时钟。
   *
   * 对应 Swift TimelineMap.mapPointerEventSegments(_:)。指针事件按片段分组：
   * 展平它们会让插值器穿越被删除的区间滑向下一片段的首位置，制造出成片中
   * 从未存在过的运动。每个片段开头若没有与 sourceStart 精确对齐的事件，
   * 注入一个 carry-over「位置种子」（kind: 'move'），使插值器从保留区间
   * 的真实起点开始。
   */
  mapPointerEventSegments(sourceEvents: PointerEventRecord[]): TimelineMappedPointerSegment[] {
    const ordered = normalizedPointerEvents(sourceEvents)

    const result: TimelineMappedPointerSegment[] = []
    for (const segment of this.segments) {
      const sourceEnd = resolvedSourceEnd(segment)
      const outputRange = makeRange(segment.outputStart, resolvedOutputEnd(segment))
      const lowerIndex = firstEventIndexAtOrAfter(segment.sourceStart, ordered)
      const upperIndex = firstEventIndexAtOrAfter(sourceEnd, ordered)
      const eventsInRange = ordered.slice(lowerIndex, upperIndex)
      const mapped: PointerEventRecord[] = []
      const startsWithExactEvent =
        eventsInRange.length > 0 &&
        Math.abs(eventsInRange[0].time - segment.sourceStart) < 0.000_001
      if (!startsWithExactEvent && lowerIndex > 0) {
        const seed = ordered[lowerIndex - 1]
        mapped.push({
          time: segment.outputStart,
          location: seed.location,
          kind: 'move',
          modifiers: seed.modifiers,
          cursorAssetID: seed.cursorAssetID,
        })
      }
      for (const event of eventsInRange) {
        mapped.push({
          time: segment.outputStart + (event.time - segment.sourceStart) / segment.playbackRate,
          location: event.location,
          kind: event.kind,
          modifiers: event.modifiers,
          cursorAssetID: event.cursorAssetID,
        })
      }
      result.push({ id: segment.id, outputRange, events: mapped })
    }
    return result
  }
}

/** Swift TimelineMappedPointerSegment（TimelineMap.swift L398-418）。 */
export interface TimelineMappedPointerSegment {
  id: string
  outputRange: MediaTimeRange
  events: PointerEventRecord[]
}

/** Swift TimelineMap.firstEventIndex(atOrAfter:in:) —— 二分查找。 */
export function firstEventIndexAtOrAfter(
  time: TimeInterval,
  events: PointerEventRecord[]
): number {
  let lower = 0
  let upper = events.length
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2)
    if (events[middle].time < time) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }
  return lower
}
