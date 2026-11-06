/**
 * 剪辑操作：分割 / 裁切 / 波纹删除 / 变速 / 还原剪切点。
 *
 * 来源：
 *   upstream-dogsc/Sources/RecorderCore/ProjectTimelineEditing.swift (935 行)
 *   upstream-dogsc/Sources/RecorderCore/ProjectTimelineEditingTransforms.swift (1168 行)
 *   upstream-dogsc/Sources/RecorderCore/ProjectTimelineRetime.swift (215 行)
 * 基线：laogou717/dogsc @ 567fd6e
 *
 * 核心不变式：
 *   1. 源区间唯一且互不重叠 —— 每个原始源时刻只属于一个输出片段。
 *   2. 数组顺序 = 输出顺序；outputStart 由时长累加推导，绝不落盘。
 *   3. 所有随时间变化的效果轨道跟着同一次 ripple 一起搬家，
 *      手授的过渡时长（preferred*）在搬运中存活。
 *
 * 未转写轨道（cameraMotion / mosaic / sticker）：Swift 里它们各自有
 * ripple 实现，但 Windows 版尚未实现这三类元素，因此这里统一以「轨道
 * 不存在」处理 —— 行为等价于空数组，不会影响主片段编辑的正确性。
 */

import type { TimeInterval, ZoomAnimationClip } from './ZoomAnimation'
import {
  ZOOM_INTERP,
  clipDuration,
  clipEffectEndTime,
  requestedEnterDuration,
  requestedExitDuration,
  withPreservedTransitionIntent,
} from './ZoomAnimation'
import {
  MAXIMUM_PLAYBACK_RATE,
  MINIMUM_PLAYBACK_RATE,
  type PrimarySegmentAudioOverrides,
  type ProjectTimeline,
  type RecordingSegment,
  type ScreenMotionClip,
  type SourceSequence,
  type TransitionTiming,
  audioOverridesEqual,
  isEmptyAudioOverrides,
  makeRecordingSegment,
  requestedLeadInDuration,
  requestedReturnDuration,
  sequenceSegmentIDs,
  timingEffectEndTime,
  timingEndTime,
  timingLeadInEndTime,
  withPreservedTimingIntent,
} from './ProjectTimeline'
import {
  TIMELINE_EPSILON,
  TimelineMap,
  type ResolvedRecordingSegment,
  resolvedOutputEnd,
  resolvedSourceEnd,
} from './TimelineMap'

const epsilon = TIMELINE_EPSILON
const adjacency = ZOOM_INTERP.adjacencyTolerance

// ---------------------------------------------------------------- Errors

export type ProjectTimelineEditingErrorKind =
  | 'invalidSourceSequence'
  | 'segmentNotFound'
  | 'splitOutsideSegment'
  | 'duplicateSegmentID'
  | 'trimOutsideSegment'
  | 'cannotRemoveFinalSegment'
  | 'restoreJunctionNotFound'
  | 'noRestorableSourceGap'
  | 'noRestorableLeadingSourceGap'
  | 'noRestorableTrailingSourceGap'
  | 'cannotMergeDeletedGap'
  | 'cannotMergeDifferentPlaybackRates'
  | 'cannotMergeDifferentAudioOverrides'
  | 'invalidPrimarySegmentAudioOverrides'
  | 'duplicateClipID'
  | 'missingClip'
  | 'mismatchedClipID'
  | 'invalidClip'
  | 'overlappingClips'

export class ProjectTimelineEditingError extends Error {
  readonly kind: ProjectTimelineEditingErrorKind

  constructor(kind: ProjectTimelineEditingErrorKind, message: string) {
    super(message)
    this.name = 'ProjectTimelineEditingError'
    this.kind = kind
  }
}

export function editingError(kind: ProjectTimelineEditingErrorKind): ProjectTimelineEditingError {
  const messages: Record<ProjectTimelineEditingErrorKind, string> = {
    invalidSourceSequence: '主录屏片段必须有效、不重复使用源素材且至少保留一段。',
    segmentNotFound: '找不到要编辑的主片段。',
    splitOutsideSegment: '拆分点必须位于主录屏片段内部。',
    duplicateSegmentID: '主片段数据重复，无法继续编辑。',
    trimOutsideSegment: '裁切点必须位于当前片段内部，且不能裁成空片段。',
    cannotRemoveFinalSegment: '项目必须至少保留一个主录屏片段。',
    restoreJunctionNotFound: '找不到要还原的相邻剪切点。',
    noRestorableSourceGap: '该剪切点没有可还原的源素材。',
    noRestorableLeadingSourceGap: '开头没有可还原的源素材。',
    noRestorableTrailingSourceGap: '结尾没有可还原的源素材。',
    cannotMergeDeletedGap: '该剪切点包含已删除素材，应先还原而不是直接合并。',
    cannotMergeDifferentPlaybackRates: '相邻片段速度不同，无法直接合并。',
    cannotMergeDifferentAudioOverrides: '相邻片段的声音设置不同，无法直接合并。',
    invalidPrimarySegmentAudioOverrides: '当前片段的声音设置无效。',
    duplicateClipID: '轨道中存在重复片段。',
    missingClip: '轨道中找不到要编辑的片段。',
    mismatchedClipID: '轨道中的片段已发生变化，请重新选择后再试。',
    invalidClip: '轨道中存在无效片段。',
    overlappingClips: '轨道中的片段发生重叠。',
  }
  return new ProjectTimelineEditingError(kind, messages[kind])
}

// ---------------------------------------------------------------- OutputDeletion

/** 输出时间线上被删掉的区间，以及把旧时刻映射到新时刻的规则。 */
export interface OutputDeletion {
  start: TimeInterval
  end: TimeInterval
}

export function deletionDuration(deletion: OutputDeletion): TimeInterval {
  return deletion.end - deletion.start
}

/**
 * 落在删除区间内的时刻塌缩到 start；区间之后的时刻整体左移。
 * 对应 Swift OutputDeletion.map(_:)。
 */
export function mapThroughDeletion(deletion: OutputDeletion, time: TimeInterval): TimeInterval {
  if (time <= deletion.start) return time
  if (time >= deletion.end) return time - deletionDuration(deletion)
  return deletion.start
}

export function deletionOverlap(
  deletion: OutputDeletion,
  otherStart: TimeInterval,
  otherEnd: TimeInterval
): TimeInterval {
  return Math.max(0, Math.min(deletion.end, otherEnd) - Math.max(deletion.start, otherStart))
}

// ---------------------------------------------------------------- ordering

export function zoomOrder(lhs: ZoomAnimationClip, rhs: ZoomAnimationClip): number {
  if (lhs.startTime !== rhs.startTime) return lhs.startTime - rhs.startTime
  return lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0
}

export function screenMotionOrder(lhs: ScreenMotionClip, rhs: ScreenMotionClip): number {
  if (lhs.timing.startTime !== rhs.timing.startTime) {
    return lhs.timing.startTime - rhs.timing.startTime
  }
  return lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0
}

// ---------------------------------------------------------------- helpers

export function authoredSegment(segment: ResolvedRecordingSegment): RecordingSegment {
  return makeRecordingSegment({
    id: segment.id,
    sourceStart: segment.sourceStart,
    sourceDuration: segment.sourceDuration,
    playbackRate: segment.playbackRate,
  })
}

export function primarySegmentAudioOverrides(
  timeline: ProjectTimeline,
  segmentID: string
): PrimarySegmentAudioOverrides {
  return timeline.primarySegmentAudioOverrides[segmentID] ?? {}
}

function prunedPrimarySegmentAudioOverrides(
  overrides: Record<string, PrimarySegmentAudioOverrides>,
  sourceSequence: SourceSequence
): Record<string, PrimarySegmentAudioOverrides> {
  const valid = new Set(sequenceSegmentIDs(sourceSequence))
  const result: Record<string, PrimarySegmentAudioOverrides> = {}
  for (const [id, value] of Object.entries(overrides)) {
    if (valid.has(id) && !isEmptyAudioOverrides(value)) result[id] = value
  }
  return result
}

function validateSourceSequence(sequence: SourceSequence): void {
  if (sequence.kind !== 'edited') return
  const segments = sequence.segments
  if (segments.length === 0) throw editingError('invalidSourceSequence')
  const identifiers = new Set<string>()
  for (const segment of segments) {
    if (identifiers.has(segment.id)) throw editingError('duplicateSegmentID')
    identifiers.add(segment.id)
    if (
      !Number.isFinite(segment.sourceStart) ||
      !Number.isFinite(segment.sourceDuration) ||
      !Number.isFinite(segment.playbackRate) ||
      segment.sourceStart < 0 ||
      !(segment.sourceDuration > 0) ||
      !(segment.playbackRate > 0) ||
      !Number.isFinite(segment.sourceStart + segment.sourceDuration)
    ) {
      throw editingError('invalidSourceSequence')
    }
  }
  for (const current of segments) {
    const currentEnd = current.sourceStart + current.sourceDuration
    const overlaps = segments.some(
      other =>
        other.id !== current.id &&
        current.sourceStart < other.sourceStart + other.sourceDuration - epsilon &&
        currentEnd > other.sourceStart + epsilon
    )
    if (overlaps) throw editingError('invalidSourceSequence')
  }
}

function validatePrimarySegmentAudioOverrides(
  overrides: Record<string, PrimarySegmentAudioOverrides>,
  sourceSequence: SourceSequence
): void {
  const valid = new Set(sequenceSegmentIDs(sourceSequence))
  for (const [id, value] of Object.entries(overrides)) {
    if (!valid.has(id) || isEmptyAudioOverrides(value)) {
      throw editingError('invalidPrimarySegmentAudioOverrides')
    }
    for (const volume of [value.systemVolume, value.microphoneVolume]) {
      if (volume === null || volume === undefined) continue
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
        throw editingError('invalidPrimarySegmentAudioOverrides')
      }
    }
  }
}

function validTiming(timing: TransitionTiming): boolean {
  return (
    Number.isFinite(timing.startTime) &&
    timing.startTime >= 0 &&
    Number.isFinite(timing.duration) &&
    timing.duration > 0 &&
    Number.isFinite(timingEndTime(timing)) &&
    Number.isFinite(timing.leadInProgressOffset) &&
    Number.isFinite(timing.returnProgressOffset) &&
    timing.leadInProgressOffset >= 0 &&
    timing.leadInProgressOffset <= 1 &&
    timing.returnProgressOffset >= 0 &&
    timing.returnProgressOffset <= 1 &&
    Number.isFinite(timing.leadInDuration) &&
    timing.leadInDuration >= 0 &&
    timing.leadInDuration <= 5 &&
    Number.isFinite(timing.returnDuration) &&
    timing.returnDuration >= 0 &&
    timing.returnDuration <= 5
  )
}

function validateZoomClips(clips: ZoomAnimationClip[]): void {
  const identifiers = new Set<string>()
  let previous: ZoomAnimationClip | null = null
  for (const clip of [...clips].sort(zoomOrder)) {
    if (identifiers.has(clip.id)) throw editingError('duplicateClipID')
    identifiers.add(clip.id)
    if (
      !Number.isFinite(clip.startTime) ||
      !Number.isFinite(clip.endTime) ||
      clip.startTime < 0 ||
      clip.endTime < clip.startTime ||
      !Number.isFinite(clip.scale) ||
      clip.scale < 1 ||
      !Number.isFinite(clip.enterDuration) ||
      !Number.isFinite(clip.exitDuration) ||
      !Number.isFinite(clip.enterProgressOffset) ||
      !Number.isFinite(clip.exitProgressOffset) ||
      clip.enterDuration < 0 ||
      clip.enterDuration > 5 ||
      clip.exitDuration < 0 ||
      clip.exitDuration > 5 ||
      clip.enterProgressOffset < 0 ||
      clip.enterProgressOffset > 1 ||
      clip.exitProgressOffset < 0 ||
      clip.exitProgressOffset > 1
    ) {
      throw editingError('invalidClip')
    }
    if (previous && !zoomSequenceIsValid(previous, clip)) {
      throw editingError('overlappingClips')
    }
    previous = clip
  }
}

/** 对应 Swift EditorTimelineMath.zoomSequenceIsValid(previous:next:)。 */
export function zoomSequenceIsValid(
  previous: ZoomAnimationClip,
  next: ZoomAnimationClip
): boolean {
  if (next.startTime >= previous.endTime - epsilon) {
    const gap = next.startTime - previous.endTime
    // 相接：前段退出被休眠
    if (gap <= adjacency) return true
    // 分离：后段必须在前段回落完成之后开始
    return next.startTime >= clipEffectEndTime(previous) - epsilon
  }
  return false
}

function validateScreenMotionClips(clips: ScreenMotionClip[]): void {
  const identifiers = new Set<string>()
  let previous: ScreenMotionClip | null = null
  for (const clip of [...clips].sort(screenMotionOrder)) {
    if (identifiers.has(clip.id)) throw editingError('duplicateClipID')
    identifiers.add(clip.id)
    const target = clip.target
    if (
      !validTiming(clip.timing) ||
      !Number.isFinite(target.position.x) ||
      !Number.isFinite(target.position.y) ||
      target.position.x < 0 ||
      target.position.x > 1 ||
      target.position.y < 0 ||
      target.position.y > 1 ||
      !Number.isFinite(target.scale) ||
      !(target.scale > 0) ||
      !Number.isFinite(target.rotationX) ||
      !Number.isFinite(target.rotationY) ||
      !Number.isFinite(target.rotationZ) ||
      !Number.isFinite(target.perspective) ||
      target.perspective < 0
    ) {
      throw editingError('invalidClip')
    }
    if (previous) {
      const gap = clip.timing.startTime - timingEndTime(previous.timing)
      const touches = gap <= adjacency
      const clears = clip.timing.startTime >= timingEffectEndTime(previous.timing) - epsilon
      if (clip.timing.startTime < timingEndTime(previous.timing) - epsilon || (!touches && !clears)) {
        throw editingError('overlappingClips')
      }
    }
    previous = clip
  }
}

export function validate(timeline: ProjectTimeline): void {
  validateSourceSequence(timeline.sourceSequence)
  validatePrimarySegmentAudioOverrides(
    timeline.primarySegmentAudioOverrides,
    timeline.sourceSequence
  )
  validateZoomClips(timeline.zoomClips)
  validateScreenMotionClips(timeline.screenMotionClips)
}

export function validateWithDuration(
  timeline: ProjectTimeline,
  fullSourceDuration: TimeInterval
): void {
  // 构造 TimelineMap 本身就是对源序列的时间合法性校验
  void new TimelineMap(timeline.sourceSequence, fullSourceDuration)
  validate(timeline)
}

function makeMap(timeline: ProjectTimeline, fullSourceDuration: TimeInterval): TimelineMap {
  return new TimelineMap(timeline.sourceSequence, fullSourceDuration)
}

// ---------------------------------------------------------------- inserting

/** 在 insertionTime 处插入时长 duration 的内容，返回平移后的片段。 */
function insertIntoZoom(
  clip: ZoomAnimationClip,
  insertionTime: TimeInterval,
  duration: TimeInterval
): ZoomAnimationClip {
  if (clip.startTime >= insertionTime - epsilon) {
    return { ...clip, startTime: clip.startTime + duration, endTime: clip.endTime + duration }
  }
  if (clip.endTime > insertionTime + epsilon) {
    // 还原的内容落在既有保持区间内部：下游边界跟着同一份原始素材走
    return { ...clip, endTime: clip.endTime + duration }
  }
  return clip
}

function insertIntoTransitionTiming(
  timing: TransitionTiming,
  insertionTime: TimeInterval,
  duration: TimeInterval
): TransitionTiming {
  if (timing.startTime >= insertionTime - epsilon) {
    return { ...timing, startTime: timing.startTime + duration }
  }
  if (timingEndTime(timing) > insertionTime + epsilon) {
    return { ...timing, duration: timing.duration + duration }
  }
  return timing
}

function insertIntoScreenMotion(
  clip: ScreenMotionClip,
  insertionTime: TimeInterval,
  duration: TimeInterval
): ScreenMotionClip {
  return {
    ...clip,
    timing: insertIntoTransitionTiming(clip.timing, insertionTime, duration),
  }
}

// ---------------------------------------------------------------- ripple

/**
 * 保留近端相位。起始点被删掉的相位，由 restore* 系列函数重建为一次全新的
 * 进入/回落。对应 Swift continuedPhaseOffset。
 */
function continuedPhaseOffset(
  originalOffset: number,
  phaseStart: TimeInterval,
  phaseDuration: TimeInterval,
  deletion: OutputDeletion
): number {
  const safeOffset = Math.min(Math.max(originalOffset, 0), 1)
  if (
    !(phaseDuration > epsilon) ||
    phaseStart < deletion.start - epsilon ||
    phaseStart >= deletion.end - epsilon
  ) {
    return safeOffset
  }
  // 波纹接点前的那一帧是 deletion.start 处的状态，不是 deletion.end 处。
  // 把相位追赶远端会产生可见跳跃：从近端相位恢复，让保留下来的过渡在
  // 剪切之后自然continue。
  const elapsed = Math.min(
    Math.max((deletion.start - phaseStart) / phaseDuration, 0),
    1
  )
  return safeOffset + (1 - safeOffset) * elapsed
}

function rippleZoom(
  input: ZoomAnimationClip,
  deletion: OutputDeletion,
  deletesOutputTail: boolean
): ZoomAnimationClip | null {
  const clip = withPreservedTransitionIntent(input)
  if (clipEffectEndTime(clip) <= deletion.start + epsilon) return clip
  if (deletesOutputTail) {
    return clip.startTime >= deletion.start - epsilon ? null : clip
  }
  if (clip.startTime >= deletion.end - epsilon) {
    const shift = deletionDuration(deletion)
    return { ...clip, startTime: clip.startTime - shift, endTime: clip.endTime - shift }
  }
  if (clip.startTime >= deletion.start - epsilon && clip.endTime <= deletion.end + epsilon) {
    return null
  }

  const oldEnterEnd = Math.min(clip.startTime + clip.enterDuration, clip.endTime)
  const newStart = mapThroughDeletion(deletion, clip.startTime)
  const newEnd = mapThroughDeletion(deletion, clip.endTime)
  const newEnterEnd = mapThroughDeletion(deletion, oldEnterEnd)
  const newEffectEnd = mapThroughDeletion(deletion, clipEffectEndTime(clip))
  if (!(newEnd - newStart > epsilon)) return null

  const mappedEnter = Math.max(0, Math.min(newEnterEnd - newStart, newEnd - newStart))
  const mappedExit = Math.max(0, newEffectEnd - newEnd)
  return {
    ...clip,
    startTime: newStart,
    endTime: newEnd,
    enterDuration: mappedEnter,
    enterProgressOffset: continuedPhaseOffset(
      clip.enterProgressOffset,
      clip.startTime,
      Math.min(clip.enterDuration, clipDuration(clip)),
      deletion
    ),
    exitDuration: mappedExit,
    exitProgressOffset: continuedPhaseOffset(
      clip.exitProgressOffset,
      clip.endTime,
      clip.exitDuration,
      deletion
    ),
  }
}

function rippleTiming(
  input: TransitionTiming,
  deletion: OutputDeletion,
  deletesOutputTail: boolean
): TransitionTiming | null {
  const timing = withPreservedTimingIntent(input)
  if (timingEffectEndTime(timing) <= deletion.start + epsilon) return timing
  // 过渡完全落在删除区间内：与缩放轨一致地删除它，而不是让整个编辑操作失败。
  if (timing.startTime >= deletion.start - epsilon && timingEndTime(timing) <= deletion.end + epsilon) {
    return null
  }
  if (deletesOutputTail) {
    return timing.startTime >= deletion.start - epsilon ? null : timing
  }
  if (timing.startTime >= deletion.end - epsilon) {
    return { ...timing, startTime: timing.startTime - deletionDuration(deletion) }
  }

  const newStart = mapThroughDeletion(deletion, timing.startTime)
  const newEnd = mapThroughDeletion(deletion, timingEndTime(timing))
  if (!(newEnd - newStart > epsilon)) return null
  const newLeadInEnd = mapThroughDeletion(deletion, timingLeadInEndTime(timing))
  const newEffectEnd = mapThroughDeletion(deletion, timingEffectEndTime(timing))
  const duration = newEnd - newStart

  return {
    ...timing,
    startTime: newStart,
    duration,
    leadInDuration: Math.max(0, Math.min(newLeadInEnd - newStart, duration)),
    leadInProgressOffset: continuedPhaseOffset(
      timing.leadInProgressOffset,
      timing.startTime,
      Math.min(timing.leadInDuration, timing.duration),
      deletion
    ),
    returnDuration: Math.max(0, newEffectEnd - newEnd),
    returnProgressOffset: continuedPhaseOffset(
      timing.returnProgressOffset,
      timingEndTime(timing),
      timing.returnDuration,
      deletion
    ),
  }
}

function rippleScreenMotion(
  clip: ScreenMotionClip,
  deletion: OutputDeletion,
  deletesOutputTail: boolean
): ScreenMotionClip | null {
  const timing = rippleTiming(clip.timing, deletion, deletesOutputTail)
  return timing ? { ...clip, timing } : null
}

// ------------------------------------------------ restore entry at junction

interface RestoredEntry {
  duration: TimeInterval
  progressOffset: number
}

/**
 * 缩放、屏幕 3D、摄像运动共用同一条编辑规则：即使只有几帧存活也要把被
 * 切到的进入过渡补回来。保留手授速度，保留被留下起点的相位；起点被删掉
 * 则从目标状态重新进入。显式写死的 0 仍然是 0。
 */
function restoredEntryAfterRipple(
  startTime: TimeInterval,
  entryDuration: TimeInterval,
  requestedDuration: TimeInterval,
  progressOffset: number,
  retainedDuration: TimeInterval,
  deletion: OutputDeletion
): RestoredEntry | null {
  if (
    !(entryDuration > epsilon) ||
    startTime >= deletion.end - epsilon ||
    startTime + entryDuration <= deletion.start + epsilon
  ) {
    return null
  }
  return {
    duration: Math.min(requestedDuration, retainedDuration),
    progressOffset: startTime >= deletion.start - epsilon ? 0 : progressOffset,
  }
}

function restoredZoomLeadIns(
  original: ZoomAnimationClip[],
  mapped: ZoomAnimationClip[],
  deletion: OutputDeletion
): ZoomAnimationClip[] {
  return mapped.map(item => {
    const old = original.find(c => c.id === item.id)
    if (!old) return item
    const entry = restoredEntryAfterRipple(
      old.startTime,
      Math.min(old.enterDuration, clipDuration(old)),
      requestedEnterDuration(old),
      old.enterProgressOffset,
      clipDuration(item),
      deletion
    )
    if (!entry) return item
    return { ...item, enterDuration: entry.duration, enterProgressOffset: entry.progressOffset }
  })
}

function restoringEntryForTiming(
  original: TransitionTiming,
  mapped: TransitionTiming,
  deletion: OutputDeletion
): TransitionTiming {
  const entry = restoredEntryAfterRipple(
    original.startTime,
    Math.min(original.leadInDuration, original.duration),
    requestedLeadInDuration(original),
    original.leadInProgressOffset,
    mapped.duration,
    deletion
  )
  if (!entry) return mapped
  return {
    ...mapped,
    leadInDuration: entry.duration,
    leadInProgressOffset: entry.progressOffset,
  }
}

function restoredScreenLeadIns(
  original: ScreenMotionClip[],
  mapped: ScreenMotionClip[],
  deletion: OutputDeletion
): ScreenMotionClip[] {
  return mapped.map(item => {
    const old = original.find(c => c.id === item.id)
    if (!old) return item
    return { ...item, timing: restoringEntryForTiming(old.timing, item.timing, deletion) }
  })
}

// ------------------------------------------------ restore return at junction

function restoredZoomReturns(
  original: ZoomAnimationClip[],
  mapped: ZoomAnimationClip[],
  deletion: OutputDeletion,
  defaultTransition: TimeInterval
): ZoomAnimationClip[] {
  const result = [...mapped].sort(zoomOrder)
  for (let index = 0; index < result.length; index++) {
    const old = original.find(c => c.id === result[index].id)
    if (!old) continue
    const requested = requestedExitDuration(old, defaultTransition)
    const next = index + 1 < result.length ? result[index + 1] : null
    const gap = next ? Math.max(next.startTime - result[index].endTime, 0) : null
    const touchesNext = gap !== null && gap <= adjacency
    result[index] = { ...result[index], preferredExitDuration: requested }
    if (touchesNext) continue
    result[index].exitDuration = Math.min(requested, gap ?? requested)
    // 删掉一段出向过渡的中间，不能加快它原本的相位时钟。回落起点被删掉
    // 时，在新的接点从「仍然缩放」的近端重新回落。
    result[index].exitProgressOffset =
      old.endTime >= deletion.start - epsilon && old.endTime < deletion.end - epsilon
        ? 0
        : old.exitProgressOffset
    if (old.exitDuration <= epsilon) result[index].exitProgressOffset = 0
  }
  return result
}

function restoredScreenReturns(
  original: ScreenMotionClip[],
  mapped: ScreenMotionClip[],
  deletion: OutputDeletion,
  defaultTransition: TimeInterval
): ScreenMotionClip[] {
  const originals = new Map(original.map(clip => [clip.id, clip]))
  const oldOrdered = [...original].sort(screenMotionOrder)
  const result = [...mapped].sort(screenMotionOrder)
  for (let index = 0; index < result.length; index++) {
    const old = originals.get(result[index].id)
    if (!old) continue
    // 旧版零回落片段刻意保持目标状态。只有这次编辑打断了它原本相接的
    // 后继时才复活。
    const oldIndex = oldOrdered.findIndex(c => c.id === old.id)
    const touchedOldSuccessor =
      oldIndex + 1 < oldOrdered.length &&
      Math.abs(timingEndTime(old.timing) - oldOrdered[oldIndex + 1].timing.startTime) <= adjacency
    if (
      old.timing.returnDuration <= epsilon &&
      (old.timing.preferredReturnDuration ?? null) === null &&
      !touchedOldSuccessor
    ) {
      result[index] = {
        ...result[index],
        timing: { ...result[index].timing, preferredReturnDuration: 0 },
      }
      continue
    }
    const requested = requestedReturnDuration(old.timing, defaultTransition)
    const next = index + 1 < result.length ? result[index + 1] : null
    const gap = next ? Math.max(next.timing.startTime - timingEndTime(result[index].timing), 0) : null
    const timing: TransitionTiming = {
      ...result[index].timing,
      preferredReturnDuration: requested,
    }
    if (gap !== null && gap <= adjacency) {
      result[index] = { ...result[index], timing }
      continue
    }
    timing.returnDuration = Math.min(requested, gap ?? requested)
    timing.returnProgressOffset =
      timingEndTime(old.timing) >= deletion.start - epsilon &&
      timingEndTime(old.timing) < deletion.end - epsilon
        ? 0
        : old.timing.returnProgressOffset
    if (old.timing.returnDuration <= epsilon) timing.returnProgressOffset = 0
    result[index] = { ...result[index], timing }
  }
  return result
}

// ---------------------------------------------------------------- ripple driver

function ripple(
  timeline: ProjectTimeline,
  sourceSequence: SourceSequence,
  deletion: OutputDeletion,
  deletesOutputTail: boolean,
  fullSourceDuration: TimeInterval,
  defaultTransitionDuration: number
): ProjectTimeline {
  const result: ProjectTimeline = {
    sourceSequence,
    primarySegmentAudioOverrides: prunedPrimarySegmentAudioOverrides(
      timeline.primarySegmentAudioOverrides,
      sourceSequence
    ),
    zoomClips: timeline.zoomClips
      .map(clip => rippleZoom(clip, deletion, deletesOutputTail))
      .filter((clip): clip is ZoomAnimationClip => clip !== null),
    screenMotionClips: timeline.screenMotionClips
      .map(clip => rippleScreenMotion(clip, deletion, deletesOutputTail))
      .filter((clip): clip is ScreenMotionClip => clip !== null),
  }
  result.zoomClips.sort(zoomOrder)
  result.screenMotionClips.sort(screenMotionOrder)

  if (!deletesOutputTail) {
    result.zoomClips = restoredZoomLeadIns(timeline.zoomClips, result.zoomClips, deletion)
    result.screenMotionClips = restoredScreenLeadIns(
      timeline.screenMotionClips,
      result.screenMotionClips,
      deletion
    )
    result.zoomClips = restoredZoomReturns(
      timeline.zoomClips,
      result.zoomClips,
      deletion,
      defaultTransitionDuration
    )
    result.screenMotionClips = restoredScreenReturns(
      timeline.screenMotionClips,
      result.screenMotionClips,
      deletion,
      defaultTransitionDuration
    )
    // 回落还原已经处理过邻接与可用空间。不要再跑一遍默认时长，否则会把
    // 后继被剪后显式写死的 0 回落覆盖掉。
  }

  validateWithDuration(result, fullSourceDuration)
  return result
}

// ---------------------------------------------------------------- public API

/**
 * 在输出时刻 outputTime 处把主片段一分为二。
 * 分割不改变总时长，也不动任何效果轨道。
 */
export function splitPrimarySegment(
  timeline: ProjectTimeline,
  atOutputTime: TimeInterval,
  newRightSegmentID: string,
  fullSourceDuration: TimeInterval
): ProjectTimeline {
  validateWithDuration(timeline, fullSourceDuration)
  const map = makeMap(timeline, fullSourceDuration)
  const resolved = Number.isFinite(atOutputTime)
    ? map.segmentAtOutputTime(atOutputTime)
    : null
  if (
    !resolved ||
    !(atOutputTime > resolved.outputStart + epsilon) ||
    !(atOutputTime < resolvedOutputEnd(resolved) - epsilon)
  ) {
    throw editingError('splitOutsideSegment')
  }
  if (map.segments.some(s => s.id === newRightSegmentID)) {
    throw editingError('duplicateSegmentID')
  }

  const splitOutputOffset = atOutputTime - resolved.outputStart
  const splitSourceOffset = splitOutputOffset * resolved.playbackRate
  const segments = map.segments.map(authoredSegment)
  const index = segments.findIndex(s => s.id === resolved.id)
  if (index < 0) throw editingError('segmentNotFound')

  segments[index] = { ...segments[index], sourceDuration: splitSourceOffset }
  segments.splice(
    index + 1,
    0,
    makeRecordingSegment({
      id: newRightSegmentID,
      sourceStart: resolved.sourceStart + splitSourceOffset,
      sourceDuration: resolved.sourceDuration - splitSourceOffset,
      playbackRate: resolved.playbackRate,
    })
  )

  const result: ProjectTimeline = {
    ...timeline,
    sourceSequence: { kind: 'edited', segments },
    primarySegmentAudioOverrides: { ...timeline.primarySegmentAudioOverrides },
  }
  const overrides = timeline.primarySegmentAudioOverrides[resolved.id]
  if (overrides) result.primarySegmentAudioOverrides[newRightSegmentID] = overrides
  validateWithDuration(result, fullSourceDuration)
  return result
}

export type RecordingSegmentTrimEdge = 'left' | 'right'

/**
 * 拖动片段某一端到 outputTime。
 *
 * 关键设计：当拖动超出片段本体时不是「拒绝」，而是**向外扩展**——
 * 左侧向前吃掉上游留下的源素材间隙，右侧向后吃掉下游的间隙。这让
 * 用户在时间线上把裁掉的头尾重新拖回来成为可能（真实剪辑软件行为）。
 */
export function trimPrimarySegment(
  timeline: ProjectTimeline,
  segmentID: string,
  edge: RecordingSegmentTrimEdge,
  toOutputTime: TimeInterval,
  fullSourceDuration: TimeInterval,
  defaultTransitionDuration = 0.7
): ProjectTimeline {
  validateWithDuration(timeline, fullSourceDuration)
  const map = makeMap(timeline, fullSourceDuration)
  const resolved = map.segmentByID(segmentID)
  if (!resolved) throw editingError('segmentNotFound')
  if (!Number.isFinite(toOutputTime)) throw editingError('trimOutsideSegment')

  const segments = map.segments.map(authoredSegment)
  const index = segments.findIndex(s => s.id === segmentID)
  if (index < 0) throw editingError('segmentNotFound')

  const resolvedEnd = resolvedOutputEnd(resolved)

  if (edge === 'left') {
    if (Math.abs(toOutputTime - resolved.outputStart) <= epsilon) return timeline

    if (toOutputTime < resolved.outputStart - epsilon) {
      // 向外扩展：吃掉上游留下的源素材
      let previousSourceEnd = 0
      segments.forEach((segment, offset) => {
        if (offset === index) return
        const end = segment.sourceStart + segment.sourceDuration
        if (end <= resolved.sourceStart + epsilon) {
          previousSourceEnd = Math.max(previousSourceEnd, end)
        }
      })
      const available = Math.max(resolved.sourceStart - previousSourceEnd, 0)
      const outputAmount = resolved.outputStart - toOutputTime
      const sourceAmount = outputAmount * resolved.playbackRate
      if (sourceAmount > available + epsilon) throw editingError('trimOutsideSegment')

      segments[index] = {
        ...segments[index],
        sourceStart: segments[index].sourceStart - sourceAmount,
        sourceDuration: segments[index].sourceDuration + sourceAmount,
      }
      return insertAt(
        timeline,
        segments,
        resolved.outputStart,
        outputAmount,
        fullSourceDuration
      )
    }

    if (
      !(toOutputTime > resolved.outputStart + epsilon) ||
      !(toOutputTime < resolvedEnd - epsilon)
    ) {
      throw editingError('trimOutsideSegment')
    }
    const sourceAmount = (toOutputTime - resolved.outputStart) * resolved.playbackRate
    segments[index] = {
      ...segments[index],
      sourceStart: segments[index].sourceStart + sourceAmount,
      sourceDuration: segments[index].sourceDuration - sourceAmount,
    }
    const deletion: OutputDeletion = { start: resolved.outputStart, end: toOutputTime }
    return ripple(
      timeline,
      { kind: 'edited', segments },
      deletion,
      deletion.end >= map.outputDuration - epsilon,
      fullSourceDuration,
      defaultTransitionDuration
    )
  }

  // edge === 'right'
  if (Math.abs(toOutputTime - resolvedEnd) <= epsilon) return timeline

  if (toOutputTime > resolvedEnd + epsilon) {
    // 向外扩展：吃掉下游留下的源素材
    const thisSourceEnd = resolvedSourceEnd(resolved)
    let nextSourceStart = fullSourceDuration
    segments.forEach((segment, offset) => {
      if (offset === index) return
      if (segment.sourceStart >= thisSourceEnd - epsilon) {
        nextSourceStart = Math.min(nextSourceStart, segment.sourceStart)
      }
    })
    const available = Math.max(nextSourceStart - thisSourceEnd, 0)
    const outputAmount = toOutputTime - resolvedEnd
    const sourceAmount = outputAmount * resolved.playbackRate
    if (sourceAmount > available + epsilon) throw editingError('trimOutsideSegment')

    segments[index] = {
      ...segments[index],
      sourceDuration: segments[index].sourceDuration + sourceAmount,
    }
    return insertAt(timeline, segments, resolvedEnd, outputAmount, fullSourceDuration)
  }

  if (
    !(toOutputTime > resolved.outputStart + epsilon) ||
    !(toOutputTime < resolvedEnd - epsilon)
  ) {
    throw editingError('trimOutsideSegment')
  }
  segments[index] = {
    ...segments[index],
    sourceDuration: (toOutputTime - resolved.outputStart) * resolved.playbackRate,
  }
  const deletion: OutputDeletion = { start: toOutputTime, end: resolvedEnd }
  return ripple(
    timeline,
    { kind: 'edited', segments },
    deletion,
    deletion.end >= map.outputDuration - epsilon,
    fullSourceDuration,
    defaultTransitionDuration
  )
}

/** 向外扩展时插入一段内容：片段平移、效果轨道让位。 */
function insertAt(
  timeline: ProjectTimeline,
  segments: RecordingSegment[],
  insertionTime: TimeInterval,
  duration: TimeInterval,
  fullSourceDuration: TimeInterval
): ProjectTimeline {
  const result: ProjectTimeline = {
    sourceSequence: { kind: 'edited', segments },
    primarySegmentAudioOverrides: prunedPrimarySegmentAudioOverrides(
      timeline.primarySegmentAudioOverrides,
      { kind: 'edited', segments }
    ),
    zoomClips: timeline.zoomClips.map(clip => insertIntoZoom(clip, insertionTime, duration)),
    screenMotionClips: timeline.screenMotionClips.map(clip =>
      insertIntoScreenMotion(clip, insertionTime, duration)
    ),
  }
  result.zoomClips.sort(zoomOrder)
  result.screenMotionClips.sort(screenMotionOrder)
  validateWithDuration(result, fullSourceDuration)
  return result
}

/** 波纹删除整个主片段。至少保留一段。 */
export function removePrimarySegment(
  timeline: ProjectTimeline,
  segmentID: string,
  fullSourceDuration: TimeInterval,
  defaultTransitionDuration = 0.7
): ProjectTimeline {
  validateWithDuration(timeline, fullSourceDuration)
  const map = makeMap(timeline, fullSourceDuration)
  const removed = map.segmentByID(segmentID)
  if (!removed) throw editingError('segmentNotFound')
  if (map.segments.length <= 1) throw editingError('cannotRemoveFinalSegment')

  const retained = map.segments.filter(s => s.id !== segmentID).map(authoredSegment)
  const deletion: OutputDeletion = {
    start: removed.outputStart,
    end: resolvedOutputEnd(removed),
  }
  return ripple(
    timeline,
    { kind: 'edited', segments: retained },
    deletion,
    deletion.end >= map.outputDuration - epsilon,
    fullSourceDuration,
    defaultTransitionDuration
  )
}

/** 设置某一主片段的播放倍速（1×…100×），并按倍速压缩效果轨道。 */
export function settingPlaybackRate(
  requestedRate: number,
  segmentID: string,
  timeline: ProjectTimeline,
  fullSourceDuration: TimeInterval
): ProjectTimeline {
  validateWithDuration(timeline, fullSourceDuration)
  const oldMap = makeMap(timeline, fullSourceDuration)
  const resolved = oldMap.segmentByID(segmentID)
  if (!resolved) throw editingError('segmentNotFound')

  const rate = Math.min(
    Math.max(
      Number.isFinite(requestedRate) ? requestedRate : MINIMUM_PLAYBACK_RATE,
      MINIMUM_PLAYBACK_RATE
    ),
    MAXIMUM_PLAYBACK_RATE
  )
  // 未变化时按 Swift 语义原样返回，但 `.fullRecording` 必须先实体化：
  // 后续的 split/remove 都要求显式片段列表，否则返回的对象无法继续编辑。
  if (Math.abs(rate - resolved.playbackRate) <= epsilon) {
    return timeline.sourceSequence.kind === 'fullRecording'
      ? materialized(timeline, fullSourceDuration)
      : timeline
  }

  const authored = oldMap.segments.map(authoredSegment)
  const index = authored.findIndex(s => s.id === segmentID)
  if (index < 0) throw editingError('segmentNotFound')
  authored[index] = { ...authored[index], playbackRate: rate }

  const segmentStart = resolved.outputStart
  const oldSegmentEnd = resolvedOutputEnd(resolved)
  const newSegmentEnd = resolved.outputStart + resolved.sourceDuration / rate
  const insideScale = resolved.playbackRate / rate
  const tailOffset = newSegmentEnd - oldSegmentEnd

  const mapAnchor = (time: TimeInterval): TimeInterval => {
    if (!Number.isFinite(time)) return time
    if (time <= segmentStart) return time
    if (time >= oldSegmentEnd) return time + tailOffset
    return segmentStart + (time - segmentStart) * insideScale
  }

  const result: ProjectTimeline = {
    sourceSequence: { kind: 'edited', segments: authored },
    primarySegmentAudioOverrides: timeline.primarySegmentAudioOverrides,
    zoomClips: nonoverlappingZoomClips(
      timeline.zoomClips.map(clip => {
        const duration = clipDuration(clip)
        const startTime = mapAnchor(clip.startTime)
        return { ...clip, startTime, endTime: startTime + duration }
      })
    ),
    screenMotionClips: nonoverlappingScreenMotionClips(
      timeline.screenMotionClips.map(clip => ({
        ...clip,
        timing: { ...clip.timing, startTime: mapAnchor(clip.timing.startTime) },
      }))
    ),
  }
  result.zoomClips.sort(zoomOrder)
  result.screenMotionClips.sort(screenMotionOrder)
  validateWithDuration(result, fullSourceDuration)
  return result
}

/**
 * 保持输出时钟上的动画时长不变，意味着媒体被压缩后两段动画会互相靠近。
 * 这里把后一段往后推，而不是缩短任何过渡。
 */
function nonoverlappingZoomClips(clips: ZoomAnimationClip[]): ZoomAnimationClip[] {
  const result: ZoomAnimationClip[] = []
  for (const original of clips) {
    let clip = original
    const previous = result.length > 0 ? result[result.length - 1] : null
    if (previous && !zoomSequenceIsValid(previous, clip)) {
      const minimumStart =
        clip.startTime < previous.endTime ? previous.endTime : clipEffectEndTime(previous)
      const duration = clipDuration(clip)
      clip = { ...clip, startTime: minimumStart, endTime: minimumStart + duration }
    }
    result.push(clip)
  }
  return result
}

function nonoverlappingScreenMotionClips(clips: ScreenMotionClip[]): ScreenMotionClip[] {
  const result: ScreenMotionClip[] = []
  for (const original of clips) {
    let clip = original
    const previous = result.length > 0 ? result[result.length - 1] : null
    if (previous) {
      const current = clip.timing
      const gap = current.startTime - timingEndTime(previous.timing)
      const touches = gap <= adjacency
      const clearsReturn = current.startTime >= timingEffectEndTime(previous.timing) - 0.0001
      if (current.startTime < timingEndTime(previous.timing) - 0.0001 || (!touches && !clearsReturn)) {
        const startTime =
          current.startTime < timingEndTime(previous.timing)
            ? timingEndTime(previous.timing)
            : timingEffectEndTime(previous.timing)
        clip = { ...clip, timing: { ...current, startTime } }
      }
    }
    result.push(clip)
  }
  return result
}

// ---------------------------------------------------------------- gap restore

/** 还原两个相邻片段之间被删掉的源素材。 */
export function restorePrimaryGap(
  timeline: ProjectTimeline,
  previousSegmentID: string,
  nextSegmentID: string,
  restoredSegmentID: string,
  fullSourceDuration: TimeInterval
): ProjectTimeline {
  validateWithDuration(timeline, fullSourceDuration)
  const map = makeMap(timeline, fullSourceDuration)
  if (map.segments.some(s => s.id === restoredSegmentID)) {
    throw editingError('duplicateSegmentID')
  }
  const previousIndex = map.segments.findIndex(s => s.id === previousSegmentID)
  if (
    previousIndex < 0 ||
    previousIndex + 1 >= map.segments.length ||
    map.segments[previousIndex + 1].id !== nextSegmentID
  ) {
    throw editingError('restoreJunctionNotFound')
  }
  const previous = map.segments[previousIndex]
  const next = map.segments[previousIndex + 1]
  const restoredDuration = next.sourceStart - resolvedSourceEnd(previous)
  if (!(restoredDuration > epsilon)) throw editingError('noRestorableSourceGap')

  const segments = map.segments.map(authoredSegment)
  segments.splice(
    previousIndex + 1,
    0,
    makeRecordingSegment({
      id: restoredSegmentID,
      sourceStart: resolvedSourceEnd(previous),
      sourceDuration: restoredDuration,
    })
  )
  const result = insertAt(
    timeline,
    segments,
    resolvedOutputEnd(previous),
    restoredDuration,
    fullSourceDuration
  )
  const inherited = timeline.primarySegmentAudioOverrides[previousSegmentID]
  if (inherited) result.primarySegmentAudioOverrides[restoredSegmentID] = inherited
  return result
}

/** 还原第一个保留片段之前被删掉的源素材。 */
export function restorePrimaryLeadingGap(
  timeline: ProjectTimeline,
  restoredSegmentID: string,
  fullSourceDuration: TimeInterval
): ProjectTimeline {
  validateWithDuration(timeline, fullSourceDuration)
  const map = makeMap(timeline, fullSourceDuration)
  const first = map.segments[0]
  if (!first || !(first.sourceStart > epsilon)) {
    throw editingError('noRestorableLeadingSourceGap')
  }
  if (map.segments.some(s => s.id === restoredSegmentID)) {
    throw editingError('duplicateSegmentID')
  }
  const restoredDuration = first.sourceStart
  const segments = map.segments.map(authoredSegment)
  segments.unshift(
    makeRecordingSegment({ id: restoredSegmentID, sourceStart: 0, sourceDuration: restoredDuration })
  )
  const result = insertAt(timeline, segments, 0, restoredDuration, fullSourceDuration)
  const inherited = timeline.primarySegmentAudioOverrides[first.id]
  if (inherited) result.primarySegmentAudioOverrides[restoredSegmentID] = inherited
  return result
}

/** 还原最后一个保留片段之后被删掉的源素材。 */
export function restorePrimaryTrailingGap(
  timeline: ProjectTimeline,
  restoredSegmentID: string,
  fullSourceDuration: TimeInterval
): ProjectTimeline {
  validateWithDuration(timeline, fullSourceDuration)
  const map = makeMap(timeline, fullSourceDuration)
  const last = map.segments[map.segments.length - 1]
  if (!last) throw editingError('noRestorableTrailingSourceGap')
  const remaining = fullSourceDuration - resolvedSourceEnd(last)
  if (!(remaining > epsilon)) throw editingError('noRestorableTrailingSourceGap')
  if (map.segments.some(s => s.id === restoredSegmentID)) {
    throw editingError('duplicateSegmentID')
  }
  const segments = map.segments.map(authoredSegment)
  segments.push(
    makeRecordingSegment({
      id: restoredSegmentID,
      sourceStart: resolvedSourceEnd(last),
      sourceDuration: remaining,
    })
  )
  const result: ProjectTimeline = {
    ...timeline,
    sourceSequence: { kind: 'edited', segments },
    primarySegmentAudioOverrides: { ...timeline.primarySegmentAudioOverrides },
  }
  const inherited = timeline.primarySegmentAudioOverrides[last.id]
  if (inherited) result.primarySegmentAudioOverrides[restoredSegmentID] = inherited
  validateWithDuration(result, fullSourceDuration)
  return result
}

/** 合并两个源上连续的分割片段。总时长与所有效果轨道都不变。 */
export function mergeAdjacentPrimarySegments(
  timeline: ProjectTimeline,
  previousSegmentID: string,
  nextSegmentID: string,
  fullSourceDuration: TimeInterval
): ProjectTimeline {
  validateWithDuration(timeline, fullSourceDuration)
  const map = makeMap(timeline, fullSourceDuration)
  const previousIndex = map.segments.findIndex(s => s.id === previousSegmentID)
  if (
    previousIndex < 0 ||
    previousIndex + 1 >= map.segments.length ||
    map.segments[previousIndex + 1].id !== nextSegmentID
  ) {
    throw editingError('restoreJunctionNotFound')
  }
  const previous = map.segments[previousIndex]
  const next = map.segments[previousIndex + 1]
  if (Math.abs(next.sourceStart - resolvedSourceEnd(previous)) > epsilon) {
    throw editingError('cannotMergeDeletedGap')
  }
  if (Math.abs(next.playbackRate - previous.playbackRate) > epsilon) {
    throw editingError('cannotMergeDifferentPlaybackRates')
  }
  if (
    !audioOverridesEqual(
      primarySegmentAudioOverrides(timeline, previousSegmentID),
      primarySegmentAudioOverrides(timeline, nextSegmentID)
    )
  ) {
    throw editingError('cannotMergeDifferentAudioOverrides')
  }

  const segments = map.segments.map(authoredSegment)
  segments[previousIndex] = {
    ...segments[previousIndex],
    sourceDuration: resolvedSourceEnd(next) - previous.sourceStart,
  }
  segments.splice(previousIndex + 1, 1)
  const overrides = { ...timeline.primarySegmentAudioOverrides }
  delete overrides[nextSegmentID]
  const result: ProjectTimeline = {
    ...timeline,
    sourceSequence: { kind: 'edited', segments },
    primarySegmentAudioOverrides: overrides,
  }
  validateWithDuration(result, fullSourceDuration)
  return result
}

// ---------------------------------------------------------------- screen motion

export function insertingScreenMotion(
  clip: ScreenMotionClip,
  timeline: ProjectTimeline
): ProjectTimeline {
  if (timeline.screenMotionClips.some(c => c.id === clip.id)) {
    throw editingError('duplicateClipID')
  }
  const result: ProjectTimeline = {
    ...timeline,
    screenMotionClips: [...timeline.screenMotionClips, clip].sort(screenMotionOrder),
  }
  validate(result)
  return result
}

export function replacingScreenMotion(
  id: string,
  timeline: ProjectTimeline,
  clip: ScreenMotionClip
): ProjectTimeline {
  if (id !== clip.id) throw editingError('mismatchedClipID')
  const index = timeline.screenMotionClips.findIndex(c => c.id === id)
  if (index < 0) throw editingError('missingClip')
  const clips = [...timeline.screenMotionClips]
  clips[index] = clip
  const result: ProjectTimeline = { ...timeline, screenMotionClips: clips.sort(screenMotionOrder) }
  validate(result)
  return result
}

export function removingScreenMotion(
  id: string,
  timeline: ProjectTimeline,
  defaultReturn = 0.7
): ProjectTimeline {
  const ordered = [...timeline.screenMotionClips].sort(screenMotionOrder)
  const removedIndex = ordered.findIndex(c => c.id === id)
  if (removedIndex < 0) throw editingError('missingClip')
  const predecessorID = removedIndex > 0 ? ordered[removedIndex - 1].id : null

  const clips = timeline.screenMotionClips.filter(c => c.id !== id).sort(screenMotionOrder)
  // 后继被移除，为原本手授的回落腾出了空间。
  if (predecessorID) {
    const index = clips.findIndex(c => c.id === predecessorID)
    if (index >= 0) {
      const original = clips[index].timing
      let timing = withPreservedTimingIntent(original, defaultReturn)
      const requested = requestedReturnDuration(timing, defaultReturn)
      const available =
        index + 1 < clips.length
          ? clips[index + 1].timing.startTime - timingEndTime(timing)
          : requested
      if (available > adjacency) {
        timing = { ...timing, returnDuration: Math.min(requested, Math.max(available, 0)) }
        if (timing.returnDuration > original.returnDuration + 0.000001) {
          timing = { ...timing, returnProgressOffset: 0 }
        }
        clips[index] = { ...clips[index], timing }
      }
    }
  }
  const result: ProjectTimeline = { ...timeline, screenMotionClips: clips }
  validate(result)
  return result
}

// ---------------------------------------------------------------- repair

/**
 * 修复旧版 ripple 实现留下的工程：真实源素材间隙处保存成了已消耗
 * （progressOffset == 1）的零时长回落。那些值编码的是一帧跳变，重新
 * 打开工程时必须像新做的删除一样把过渡还原回来。
 */
export function repairingPersistedRippleTransitions(
  timeline: ProjectTimeline,
  defaultTransitionDuration = 0.7
): ProjectTimeline {
  if (timeline.sourceSequence.kind !== 'edited') return timeline
  const segments = timeline.sourceSequence.segments
  if (segments.length <= 1) return timeline

  let output = 0
  const gapJunctions: number[] = []
  for (let index = 0; index < segments.length; index++) {
    output += segments[index].sourceDuration / segments[index].playbackRate
    if (index + 1 >= segments.length) continue
    const nextStart = segments[index + 1].sourceStart
    const currentEnd = segments[index].sourceStart + segments[index].sourceDuration
    if (nextStart - currentEnd > epsilon) gapJunctions.push(output)
  }
  if (gapJunctions.length === 0) return timeline

  const safeDefault = Math.max(defaultTransitionDuration, 0)
  const result: ProjectTimeline = {
    ...timeline,
    zoomClips: [...timeline.zoomClips].sort(zoomOrder),
    screenMotionClips: [...timeline.screenMotionClips].sort(screenMotionOrder),
  }

  for (let index = 0; index < result.zoomClips.length; index++) {
    const clip = result.zoomClips[index]
    const isBrokenJunction = gapJunctions.some(j => Math.abs(j - clip.endTime) <= adjacency)
    const touchesNext =
      index + 1 < result.zoomClips.length &&
      Math.abs(result.zoomClips[index + 1].startTime - clip.endTime) <= adjacency
    if (
      !isBrokenJunction ||
      touchesNext ||
      clip.exitDuration > epsilon ||
      clip.exitProgressOffset < 1 - epsilon
    ) {
      continue
    }
    const available =
      index + 1 < result.zoomClips.length
        ? Math.max(result.zoomClips[index + 1].startTime - clip.endTime, 0)
        : safeDefault
    result.zoomClips[index] = {
      ...clip,
      exitDuration: Math.min(safeDefault, available),
      exitProgressOffset: 0,
    }
  }

  for (let index = 0; index < result.screenMotionClips.length; index++) {
    const timing = result.screenMotionClips[index].timing
    const isBrokenJunction = gapJunctions.some(
      j => Math.abs(j - timingEndTime(timing)) <= adjacency
    )
    const touchesNext =
      index + 1 < result.screenMotionClips.length &&
      Math.abs(
        result.screenMotionClips[index + 1].timing.startTime - timingEndTime(timing)
      ) <= adjacency
    if (
      !isBrokenJunction ||
      touchesNext ||
      timing.returnDuration > epsilon ||
      timing.returnProgressOffset < 1 - epsilon
    ) {
      continue
    }
    const available =
      index + 1 < result.screenMotionClips.length
        ? Math.max(
            result.screenMotionClips[index + 1].timing.startTime - timingEndTime(timing),
            0
          )
        : safeDefault
    result.screenMotionClips[index] = {
      ...result.screenMotionClips[index],
      timing: {
        ...timing,
        returnDuration: Math.min(safeDefault, available),
        returnProgressOffset: 0,
      },
    }
  }
  return result
}

// ---------------------------------------------------------------- misc

export function settingPrimarySegmentAudioOverrides(
  timeline: ProjectTimeline,
  segmentID: string,
  overrides: PrimarySegmentAudioOverrides
): ProjectTimeline {
  if (!sequenceSegmentIDs(timeline.sourceSequence).includes(segmentID)) {
    throw editingError('segmentNotFound')
  }
  const next = { ...timeline.primarySegmentAudioOverrides }
  if (isEmptyAudioOverrides(overrides)) delete next[segmentID]
  else next[segmentID] = overrides
  const result: ProjectTimeline = { ...timeline, primarySegmentAudioOverrides: next }
  validate(result)
  return result
}

/** 把 `.fullRecording` 展开成显式片段列表。 */
export function materialized(
  timeline: ProjectTimeline,
  fullSourceDuration: TimeInterval
): ProjectTimeline {
  validateWithDuration(timeline, fullSourceDuration)
  const map = makeMap(timeline, fullSourceDuration)
  const result: ProjectTimeline = {
    ...timeline,
    sourceSequence: map.materializedSourceSequence(),
  }
  validate(result)
  return result
}

/**
 * 把输出时刻吸附到最近的片段边界（分割/裁切用）。
 * Windows 版新增的便利函数，Swift 端由 UI 层自行吸附。
 */
export function snapToSegmentBoundary(
  map: TimelineMap,
  time: TimeInterval,
  threshold = 0.08
): TimeInterval {
  let best = time
  let bestDistance = threshold
  for (const segment of map.segments) {
    for (const boundary of [segment.outputStart, resolvedOutputEnd(segment)]) {
      const distance = Math.abs(boundary - time)
      if (distance < bestDistance) {
        best = boundary
        bestDistance = distance
      }
    }
  }
  return best
}
