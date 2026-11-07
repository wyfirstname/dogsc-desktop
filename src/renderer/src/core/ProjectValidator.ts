/**
 * Swift source: Sources/RecorderCore/ProjectValidator.swift @ 567fd6e
 *
 * 逐结构对照：
 *   ProjectValidationError              L8-19
 *   errorDescription（中文文案）         L21-46
 *   validate(CanvasStyle)               L54-80
 *   validate(CameraStyle)               L82-98
 *   validate(AudioStyle)                L100-108
 *   validate(CursorStyle)               L110-120
 *   validate(MotionStyle)               L122-141
 *   validate(ZoomAnimationClip)         L143-155
 *   validate(ProjectTimeline)           L157-176
 *   validate(RecorderProject)           L179-202
 *   finite(_:in:)                       L204-209
 *
 * 这是「持久化工程域值」的唯一校验边界。本类型**只校验、不修复**：
 * 从不 clamp 或改写工程，因此调用方不可能意外持久化一个与用户手授不同的值。
 */

import type { ZoomAnimationClip } from './ZoomAnimation'
import type { CanvasStyle, CameraStyle, AudioStyle, CursorStyle } from './ProjectModel'
import { maximumOpeningStagger, OPENING_SEQUENCE_ELEMENTS } from './ProjectModel'
import type { MotionStyle } from './MotionStyle'
import type { NormalizedCrop } from './ProjectModel'
import { clampedCrop } from './ProjectModel'
import type { ProjectTimeline } from './ProjectTimeline'
import { makeProjectTimeline } from './ProjectTimeline'
import type { RecorderProject } from './ProjectMediaModel'
import { ProjectTimelineEditingError, validate as validateTimelineEditing } from './ProjectTimelineEditing'
import { screenMotionCreationStyleIsValid } from './ScreenMotionCreationStyle'

// ---------------------------------------------------------------- Errors

export type ProjectValidationErrorKind =
  | 'invalidCanvas'
  | 'invalidCamera'
  | 'invalidAudio'
  | 'invalidCursor'
  | 'invalidMotion'
  | 'invalidOpening'
  | 'invalidZoom'
  | 'duplicateZoomID'
  | 'overlappingZoom'
  | 'invalidTimeline'

/**
 * Swift enum ProjectValidationError —— 编辑器把它映射成命令级失败，
 * 而工程加载/持久化/未来导入路径复用同一套规则，无需依赖 App 目标。
 */
export class ProjectValidationError extends Error {
  readonly kind: ProjectValidationErrorKind
  /** invalidZoom / duplicateZoomID 携带的可选片段 ID。 */
  readonly clipID: string | null
  /** overlappingZoom 携带的第二个片段 ID。 */
  readonly secondClipID: string | null

  constructor(
    kind: ProjectValidationErrorKind,
    reason: string,
    clipID: string | null = null,
    secondClipID: string | null = null
  ) {
    super(projectValidationMessage(kind, reason))
    this.name = 'ProjectValidationError'
    this.kind = kind
    this.clipID = clipID
    this.secondClipID = secondClipID
  }
}

/** Swift errorDescription L21-46（中文文案逐字照搬）。 */
function projectValidationMessage(kind: ProjectValidationErrorKind, reason: string): string {
  switch (kind) {
    case 'invalidCanvas':
      return `画布参数无效：${reason}`
    case 'invalidCamera':
      return `摄像头参数无效：${reason}`
    case 'invalidAudio':
      return `音频参数无效：${reason}`
    case 'invalidCursor':
      return `光标参数无效：${reason}`
    case 'invalidMotion':
      return `动画参数无效：${reason}`
    case 'invalidOpening':
      return `开场编排参数无效：${reason}`
    case 'invalidZoom':
      return `缩放片段无效：${reason}`
    case 'duplicateZoomID':
      return '缩放轨道中存在重复片段。'
    case 'overlappingZoom':
      return '缩放片段的生效区间发生重叠。'
    case 'invalidTimeline':
      return `时间线无效：${reason}`
  }
}

/** Swift L204-209。 */
function finite(value: number, lower: number, upper: number): boolean {
  return Number.isFinite(value) && value >= lower && value <= upper
}

// ---------------------------------------------------------------- Canvas

/** Swift L54-80。`crop == crop.clamped()` 要求裁切已经规范化。 */
export function validateCanvasStyle(style: CanvasStyle): void {
  const ok =
    finite(style.padding, 0, 1_000) &&
    finite(style.contentScale, 0.05, 8) &&
    finite(style.contentPosition.x, 0, 1) &&
    finite(style.contentPosition.y, 0, 1) &&
    finite(style.cornerRadius, 0, 500) &&
    finite(style.borderWidth, 0, 60) &&
    finite(style.shadowStrength, 0, 1) &&
    finite(style.backgroundBlur, 0, 96) &&
    finite(style.insetOpacity, 0, 1) &&
    finite(style.screenFrameScale, 0.6, 1.6) &&
    finite(style.screenFrameToolbarScale, 0.65, 1.6) &&
    (style.screenFrameOuterCornerRadius === null ||
      finite(style.screenFrameOuterCornerRadius, 0, 160)) &&
    (style.screenFrameContentCornerRadius === null ||
      finite(style.screenFrameContentCornerRadius, 0, 160)) &&
    style.screenFrameTitle.length <= 120 &&
    style.screenFrameBrowserAddress.length <= 240 &&
    normalizedCropEquals(style.crop, clampedCrop(style.crop))
  if (!ok) {
    throw new ProjectValidationError('invalidCanvas', '包含越界、非有限或无效裁切值。')
  }
}

function normalizedCropEquals(lhs: NormalizedCrop, rhs: NormalizedCrop): boolean {
  return (
    lhs.x === rhs.x && lhs.y === rhs.y && lhs.width === rhs.width && lhs.height === rhs.height
  )
}

// ---------------------------------------------------------------- Camera

/** Swift L82-98。 */
export function validateCameraStyle(style: CameraStyle): void {
  const ok =
    finite(style.position.x, 0, 1) &&
    finite(style.position.y, 0, 1) &&
    finite(style.size, 0.01, 1) &&
    finite(style.borderWidth, 0, 18) &&
    finite(style.shadowStrength, 0, 1) &&
    finite(style.roundness, 0, 1) &&
    finite(style.scaleDuringZoom, 0.1, 2) &&
    finite(style.contentPosition.x, 0, 1) &&
    finite(style.contentPosition.y, 0, 1) &&
    finite(style.contentScale, 1, 4)
  if (!ok) {
    throw new ProjectValidationError('invalidCamera', '位置、大小或外观值超出可渲染范围。')
  }
}

// ---------------------------------------------------------------- Audio

/** Swift L100-108。 */
export function validateAudioStyle(style: AudioStyle): void {
  const ok = finite(style.systemVolume, 0, 1) && finite(style.microphoneVolume, 0, 1)
  if (!ok) {
    throw new ProjectValidationError('invalidAudio', '音量必须位于 0 到 1。')
  }
}

// ---------------------------------------------------------------- Cursor

/**
 * Swift L110-120。
 * 注意 motionTiltStrength 的合法区间是 2...4 —— 这是 Swift 侧的既有约束
 * （UI 上「摆动强度」的刻度域），不是笔误。
 */
export function validateCursorStyle(style: CursorStyle): void {
  const ok =
    style.assetID.length > 0 &&
    finite(style.size, 0.25, 6) &&
    finite(style.idleDelay, 0.2, 8) &&
    finite(style.motionTiltStrength, 2, 4)
  if (!ok) {
    throw new ProjectValidationError('invalidCursor', '尺寸、静止延迟或摆动强度超出支持范围。')
  }
}

// ---------------------------------------------------------------- Motion

/** Swift L122-141。 */
export function validateMotionStyle(style: MotionStyle): void {
  const scale = style.defaultZoomScale ?? null
  if (scale !== null && !finite(scale, 1, 6)) {
    throw new ProjectValidationError('invalidMotion', '新动画倍率必须在 1 到 6 倍之间。')
  }
  const screenMotion = style.defaultScreenMotion ?? null
  if (screenMotion !== null && !screenMotionCreationStyleIsValid(screenMotion)) {
    throw new ProjectValidationError('invalidMotion', '新屏幕 3D 动画的参数无法稳定求值。')
  }
  const ok =
    finite(style.screenSpringMass, 0.01, 20) &&
    finite(style.screenSpringStiffness, 1, 5_000) &&
    finite(style.screenSpringDamping, 0.1, 1_000) &&
    finite(style.cursorSpringMass, 0.01, 20) &&
    finite(style.cursorSpringStiffness, 1, 5_000) &&
    finite(style.cursorSpringDamping, 0.1, 1_000) &&
    finite(style.defaultZoomTransitionDuration, 0, 5)
  if (!ok) {
    throw new ProjectValidationError('invalidMotion', '弹簧或默认过渡参数无法稳定求值。')
  }
}

// ---------------------------------------------------------------- Zoom clip

/**
 * Swift L143-155 —— 单个片段的校验也走 ProjectTimelineEditing（含自定义
 * 贝塞尔曲线有效性），这样「单片段入口」和「整轨校验」永远同一套规则。
 */
export function validateZoomAnimationClip(clip: ZoomAnimationClip): void {
  try {
    validateTimelineEditing(makeProjectTimeline({ zoomClips: [clip] }))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new ProjectValidationError('invalidZoom', reason, clip.id)
  }
}

// ---------------------------------------------------------------- Timeline

/** Swift L157-176 —— 把编辑层的错误类型翻译成稳定的工程域错误。 */
export function validateProjectTimeline(timeline: ProjectTimeline): void {
  try {
    validateTimelineEditing(timeline)
  } catch (error) {
    if (error instanceof ProjectTimelineEditingError) {
      if (error.kind === 'duplicateClipID') {
        const duplicated = findDuplicateZoomClipID(timeline.zoomClips)
        throw new ProjectValidationError('duplicateZoomID', error.message, duplicated)
      }
      if (error.kind === 'overlappingClips') {
        const pair = findOverlappingZoomPair(timeline.zoomClips)
        throw new ProjectValidationError(
          'overlappingZoom',
          error.message,
          pair ? pair[0] : null,
          pair ? pair[1] : null
        )
      }
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new ProjectValidationError('invalidTimeline', reason)
  }
}

/** 只在校验失败后执行，用于给错误补上具体 id（不参与「是否合法」的判定）。 */
function findDuplicateZoomClipID(clips: ZoomAnimationClip[]): string | null {
  const seen = new Set<string>()
  for (const clip of clips) {
    if (seen.has(clip.id)) return clip.id
    seen.add(clip.id)
  }
  return null
}

function findOverlappingZoomPair(clips: ZoomAnimationClip[]): [string, string] | null {
  const ordered = [...clips].sort((lhs, rhs) =>
    lhs.startTime === rhs.startTime
      ? lhs.id < rhs.id
        ? -1
        : 1
      : lhs.startTime - rhs.startTime
  )
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    if (current.startTime < previous.endTime - 0.000_1) {
      return [previous.id, current.id]
    }
  }
  return null
}

// ---------------------------------------------------------------- Project

/**
 * Swift L179-202 —— 全体持久化编辑域的入口。
 *
 * 开场编排的三条不变量：
 *   · stagger 不超过 maximumStagger(includedElements.count) + 1e-6（余量）
 *   · includedElements 无重复
 *   · elementOrder 必须是全部元素的排列（集合相等且长度相等）
 */
export function validateRecorderProject(project: RecorderProject): void {
  validateCanvasStyle(project.canvas)
  validateCameraStyle(project.camera)
  validateAudioStyle(project.audio)
  validateCursorStyle(project.cursorStyle)
  validateMotionStyle(project.motion)

  const opening = project.openingSequence
  const maximumStagger = maximumOpeningStagger(opening, opening.includedElements.length)
  const includedUnique = new Set(opening.includedElements)
  const orderUnique = new Set(opening.elementOrder)
  const allElements = OPENING_SEQUENCE_ELEMENTS
  const ok =
    finite(opening.duration, 0.4, 8) &&
    finite(opening.stagger, 0, 1.2) &&
    opening.stagger <= maximumStagger + 0.000_001 &&
    includedUnique.size === opening.includedElements.length &&
    orderUnique.size === allElements.length &&
    allElements.every((element) => orderUnique.has(element)) &&
    opening.elementOrder.length === allElements.length
  if (!ok) {
    throw new ProjectValidationError('invalidOpening', '时长、间隔或元素顺序无效。')
  }

  validateProjectTimeline(project.timeline)
}
