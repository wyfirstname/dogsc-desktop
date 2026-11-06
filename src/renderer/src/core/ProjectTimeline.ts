/**
 * 工程时间线的持久化模型。
 *
 * 来源：upstream-dogsc/Sources/RecorderCore/ProjectTimeline.swift
 * 基线：laogou717/dogsc @ 567fd6e
 *
 * 转写原则：字段名、默认值、解码兜底（旧工程缺字段时的迁移语义）与
 * Swift 一一对应。这里只保留 Windows 版实际会用到的轨道；Swift 中的
 * cameraMotion / mosaic / sticker 轨道暂未转写，相关代码在
 * ProjectTimelineEditing.ts 里以「轨道缺失即不处理」的方式兼容。
 */

import type {
  ZoomAnimationClip,
  ZoomBezierCurve,
  ZoomEasingPreset,
  TimeInterval,
} from './ZoomAnimation'
import { ZOOM_BEZIER } from './ZoomAnimation'

// ---------------------------------------------------------------- RecordingSegment

/**
 * 原录屏中保留下来的一段。
 *
 * 片段顺序即输出顺序。轻量编辑器**故意不持久化 outputStart**：它由时长
 * 累加推导，这样一次裁切或波纹删除不会留下两个互相矛盾的时间线位置。
 *
 * 对应 Swift RecordingSegment。
 */
export interface RecordingSegment {
  id: string
  sourceStart: TimeInterval
  sourceDuration: TimeInterval
  /** 一个输出秒消耗多少源秒。编辑器开放 1×…100× 快进。 */
  playbackRate: number
}

/**
 * 编辑器故意支持把长停顿/准备工作大幅压缩，同时把持久化契约限制在
 * AVFoundation（这里是 ffmpeg / HTMLMediaElement）能可预期处理的范围内。
 */
export const MINIMUM_PLAYBACK_RATE = 1
export const MAXIMUM_PLAYBACK_RATE = 100

export function makeRecordingSegment(opts: {
  id?: string
  sourceStart: TimeInterval
  sourceDuration: TimeInterval
  playbackRate?: number
}): RecordingSegment {
  const rate = opts.playbackRate ?? 1
  return {
    id: opts.id ?? randomUUID(),
    sourceStart: opts.sourceStart,
    sourceDuration: opts.sourceDuration,
    playbackRate: Number.isFinite(rate) && rate > 0 ? rate : 1,
  }
}

export function segmentSourceEnd(segment: RecordingSegment): TimeInterval {
  return segment.sourceStart + segment.sourceDuration
}

export function segmentOutputDuration(segment: RecordingSegment): TimeInterval {
  return segment.sourceDuration / segment.playbackRate
}

// ---------------------------------------------------------------- SourceSequence

/**
 * 主录屏的持久化剪辑决策。
 *
 * 新录制或历史工程在用户做第一次破坏性时间线编辑之前始终保持
 * `.fullRecording`。这让迁移保持纯粹：解码工程 JSON 时永远不需要去
 * 探测媒体文件时长。
 *
 * 对应 Swift enum SourceSequence（标签联合，序列化为 { kind, segments }）。
 */
export type SourceSequence =
  | { kind: 'fullRecording' }
  | { kind: 'edited'; segments: RecordingSegment[] }

export const FULL_RECORDING: SourceSequence = { kind: 'fullRecording' }

export function editedSequence(segments: RecordingSegment[]): SourceSequence {
  return { kind: 'edited', segments }
}

/** 源序列里包含的所有主片段 id。对应 Swift primarySegmentIDs(in:)。 */
export function sequenceSegmentIDs(sequence: SourceSequence): string[] {
  return sequence.kind === 'edited' ? sequence.segments.map(s => s.id) : [FULL_RECORDING_SEGMENT_ID]
}

// ---------------------------------------------------------------- TransitionTiming

/**
 * 场景过渡共用的时间参数。片段区间是「进入 + 保持」：目标状态在
 * `leadInDuration` 内缓入，然后**保持**到 `endTime`。结束后目标状态继续
 * 生效，直到另一段片段改变它 —— 除非 `returnDuration` 非零，此时一段
 * 不接触后继的片段会先用该窗口缓回基础状态（zoom 式的 进入/保持/回落）。
 * 相接的片段总是链式衔接。
 *
 * 对应 Swift TransitionTiming。
 */
export interface TransitionTiming {
  startTime: TimeInterval
  /** 整段时长（进入过渡 + 保持）；时间线上拖两端改的就是它。 */
  duration: TimeInterval
  /** 进入过渡时长；0 = 直接跳变。超过 duration 时按 duration 截断。 */
  leadInDuration: TimeInterval
  /** 保留素材在剪切接点前的进入相位；0 = 从头，1 = 已进入完成。 */
  leadInProgressOffset: number
  easing: ZoomEasingPreset
  customCurve: ZoomBezierCurve
  /** 结尾自动回到基础状态的过渡时长；0 = 保持目标状态（旧工程语义）。 */
  returnDuration: TimeInterval
  /** 剪切跨过回落起点时保留的回落相位；0 = 从目标开始回落，1 = 已回位。 */
  returnProgressOffset: number
  /** 手授时长在 ripple 拟合与临时邻接约束下存活。 */
  preferredLeadInDuration?: TimeInterval | null
  preferredReturnDuration?: TimeInterval | null
}

export interface TransitionTimingOptions {
  startTime: TimeInterval
  duration?: TimeInterval
  leadInDuration?: TimeInterval
  leadInProgressOffset?: number
  easing?: ZoomEasingPreset
  customCurve?: ZoomBezierCurve
  returnDuration?: TimeInterval
  returnProgressOffset?: number
  preferredLeadInDuration?: TimeInterval | null
  preferredReturnDuration?: TimeInterval | null
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(Math.max(value, lower), upper)
}

export function makeTransitionTiming(opts: TransitionTimingOptions): TransitionTiming {
  const duration = opts.duration ?? 0.7
  return {
    startTime: opts.startTime,
    duration,
    leadInDuration: clamp(opts.leadInDuration ?? duration, 0, 5),
    leadInProgressOffset: clamp(opts.leadInProgressOffset ?? 0, 0, 1),
    easing: opts.easing ?? '三次方缓动',
    customCurve: opts.customCurve ?? ZOOM_BEZIER.cubic,
    returnDuration: clamp(opts.returnDuration ?? 0, 0, 5),
    returnProgressOffset: clamp(opts.returnProgressOffset ?? 0, 0, 1),
    preferredLeadInDuration: opts.preferredLeadInDuration ?? null,
    preferredReturnDuration: opts.preferredReturnDuration ?? null,
  }
}

export function timingEndTime(timing: TransitionTiming): TimeInterval {
  return timing.startTime + timing.duration
}

/** 进入过渡完成的时刻；leadIn 超出整段时按整段截断。 */
export function timingLeadInEndTime(timing: TransitionTiming): TimeInterval {
  return timing.startTime + Math.min(timing.leadInDuration, timing.duration)
}

export function timingEffectEndTime(timing: TransitionTiming): TimeInterval {
  return timingEndTime(timing) + timing.returnDuration
}

export function requestedLeadInDuration(timing: TransitionTiming): TimeInterval {
  return timing.preferredLeadInDuration ?? timing.leadInDuration
}

export function requestedReturnDuration(
  timing: TransitionTiming,
  defaultTransition = 0.7
): TimeInterval {
  return (
    timing.preferredReturnDuration ??
    (timing.returnDuration > 0.0001 ? timing.returnDuration : Math.max(defaultTransition, 0))
  )
}

/** 固化为可变副本，保留手授意图。对应 Swift preserveTransitionIntent()。 */
export function withPreservedTimingIntent(
  timing: TransitionTiming,
  defaultTransition = 0.7
): TransitionTiming {
  return {
    ...timing,
    preferredLeadInDuration: timing.preferredLeadInDuration ?? timing.leadInDuration,
    preferredReturnDuration:
      timing.preferredReturnDuration ??
      requestedReturnDuration(timing, defaultTransition),
  }
}

// ---------------------------------------------------------------- ScreenMotionClip

/**
 * 屏幕 3D 运镜的目标状态。对应 Swift ScreenMotionTarget（结构子集）。
 * Windows 版直接驱动 CSS 3D transform，字段与 ScreenMotion.swift 一致。
 */
export interface ScreenMotionTarget {
  position: { x: number; y: number }
  scale: number
  rotationX: number
  rotationY: number
  rotationZ: number
  perspective: number
}

export interface ScreenMotionClip {
  id: string
  timing: TransitionTiming
  target: ScreenMotionTarget
  /** 组合布局预设插入的跨轨道配对 ID；拖动/缩放一侧时另一侧跟随。 */
  groupID?: string | null
  focusEffect?: unknown | null
}

// ---------------------------------------------------------------- OverlayTiming

/** 贴图/打码这类覆盖层的最小时间参数。对应 Swift OverlayTiming。 */
export interface OverlayTiming {
  startTime: TimeInterval
  duration: TimeInterval
}

export function makeOverlayTiming(
  startTime: TimeInterval,
  duration: TimeInterval
): OverlayTiming {
  return { startTime, duration }
}

export function overlayEndTime(timing: OverlayTiming): TimeInterval {
  return timing.startTime + timing.duration
}

// ---------------------------------------------------------------- Audio overrides

/**
 * 一个主片段私有的音源覆盖。缺省值故意继承工程级音频设置 —— 这样
 * 「系统声音 / 麦克风」仍然是默认开关，只有用户真正编辑过的片段才分叉。
 */
export interface PrimarySegmentAudioOverrides {
  systemVolume?: number | null
  microphoneVolume?: number | null
  isSystemMuted?: boolean | null
  isMicrophoneMuted?: boolean | null
}

export function isEmptyAudioOverrides(overrides: PrimarySegmentAudioOverrides): boolean {
  return (
    (overrides.systemVolume ?? null) === null &&
    (overrides.microphoneVolume ?? null) === null &&
    (overrides.isSystemMuted ?? null) === null &&
    (overrides.isMicrophoneMuted ?? null) === null
  )
}

export function audioOverridesEqual(
  lhs: PrimarySegmentAudioOverrides,
  rhs: PrimarySegmentAudioOverrides
): boolean {
  return (
    (lhs.systemVolume ?? null) === (rhs.systemVolume ?? null) &&
    (lhs.microphoneVolume ?? null) === (rhs.microphoneVolume ?? null) &&
    (lhs.isSystemMuted ?? null) === (rhs.isSystemMuted ?? null) &&
    (lhs.isMicrophoneMuted ?? null) === (rhs.isMicrophoneMuted ?? null)
  )
}

// ---------------------------------------------------------------- ProjectTimeline

/** 每一个随时间变化的工程编辑的唯一持久化所有者。 */
export interface ProjectTimeline {
  sourceSequence: SourceSequence
  primarySegmentAudioOverrides: Record<string, PrimarySegmentAudioOverrides>
  zoomClips: ZoomAnimationClip[]
  screenMotionClips: ScreenMotionClip[]
}

export function makeProjectTimeline(
  overrides: Partial<ProjectTimeline> = {}
): ProjectTimeline {
  return {
    sourceSequence: overrides.sourceSequence ?? { ...FULL_RECORDING },
    primarySegmentAudioOverrides: overrides.primarySegmentAudioOverrides ?? {},
    zoomClips: overrides.zoomClips ?? [],
    screenMotionClips: overrides.screenMotionClips ?? [],
  }
}

// ---------------------------------------------------------------- ids

/**
 * 全录屏片段在 `.fullRecording` 状态下的固定 id。
 * 对应 Swift TimelineMap.fullRecordingSegmentID。
 */
export const FULL_RECORDING_SEGMENT_ID = '00000000-0000-4000-8000-000000000001'

export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 兜底：极老的渲染器
  const hex = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-'
    else if (i === 14) out += '4'
    else out += hex[Math.floor(Math.random() * 16)]
  }
  return out
}
