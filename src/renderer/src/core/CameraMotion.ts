/**
 * 摄像头运动轨：布局/位置/尺寸/圆角/不透明度的定时过渡采样。
 *
 * Swift source: Sources/RecorderCore/CameraMotion.swift @ laogou717/dogsc 567fd6e
 * 逐结构对照：
 *   - CameraLayoutMode（shape | fullscreen 标签联合）        (L3-37)
 *   - CameraMotionState（默认 右下角 方形 0.35）              (L39-59)
 *   - CameraMotionClip（+ groupID 跨轨配对）                  (L61-79)
 *   - CameraMotionSample（连续值采样）                        (L84-107)
 *   - CameraMotionTrack（索引路径 / 扫描路径 / returnFalloff） (L109-423)
 *
 * 语义要点：
 *   - 离散布局在插值前先 resolve 成连续值（圆 → 矩形 → 全屏可平滑过渡）
 *   - 隐藏目标（opacity≈0）不做位移动画，原地淡出；从隐藏进入则在目标处淡入
 *   - 子帧间隙仍属于相邻交接：保持前段目标而不是回落基础（与屏幕 3D 轨一致）
 */
import type { CameraShape } from './ProjectModel'
import type { NormalizedPoint } from './ZoomAnimation'
import { ZOOM_INTERP, easedProgress, type ZoomBezierCurve, type ZoomEasingPreset } from './ZoomAnimation'
import type { TransitionTiming } from './ProjectTimeline'
import { timingEndTime } from './ProjectTimeline'
import type { MotionStyle } from './MotionStyle'
import { makeMotionStyle } from './MotionStyle'

// ---------------------------------------------------------------- CameraLayoutMode

export type CameraLayoutMode =
  | { kind: 'shape'; shape: CameraShape }
  | { kind: 'fullscreen' }

export function decodeCameraLayoutMode(raw: unknown): CameraLayoutMode {
  const obj = (raw ?? {}) as Record<string, unknown>
  if (obj.kind === 'fullscreen') return { kind: 'fullscreen' }
  return { kind: 'shape', shape: (obj.shape as CameraShape) ?? '方形' }
}

export function encodeCameraLayoutMode(layout: CameraLayoutMode): Record<string, unknown> {
  return layout.kind === 'shape' ? { kind: 'shape', shape: layout.shape } : { kind: 'fullscreen' }
}

// ---------------------------------------------------------------- CameraMotionState

export interface CameraMotionState {
  layout: CameraLayoutMode
  position: NormalizedPoint
  size: number
  roundness: number
  opacity: number
}

export const CAMERA_MOTION_DEFAULTS: CameraMotionState = {
  layout: { kind: 'shape', shape: '方形' },
  position: { x: 0.86, y: 0.82 },
  size: 0.35,
  roundness: 0.5,
  opacity: 1,
}

export function makeCameraMotionState(overrides: Partial<CameraMotionState> = {}): CameraMotionState {
  return { ...CAMERA_MOTION_DEFAULTS, ...overrides }
}

// ---------------------------------------------------------------- CameraMotionClip

export interface CameraMotionClip {
  id: string
  timing: TransitionTiming
  target: CameraMotionState
  /** 组合布局预设插入的跨轨道配对 ID；拖动/缩放一侧时另一侧跟随。 */
  groupID: string | null
}

export function makeCameraMotionClip(overrides: Partial<CameraMotionClip> = {}): CameraMotionClip {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    timing: overrides.timing!,
    target: overrides.target ?? makeCameraMotionState(),
    groupID: overrides.groupID ?? null,
  }
}

// ---------------------------------------------------------------- CameraMotionSample

/** 几何求值消费的连续摄像头值。 */
export interface CameraMotionSample {
  position: NormalizedPoint
  size: number
  aspectRatio: number
  cornerFraction: number
  fullscreenProgress: number
  opacity: number
}

// ---------------------------------------------------------------- CameraMotionTrack

export class CameraMotionTrack {
  readonly clips: CameraMotionClip[]
  private readonly usesIndexedEvaluation: boolean

  constructor(clips: CameraMotionClip[]) {
    if (cameraMotionClipsNeedRepair(clips)) {
      this.clips = clips.slice().sort((lhs, rhs) =>
        lhs.timing.startTime === rhs.timing.startTime
          ? (lhs.id.toUpperCase() < rhs.id.toUpperCase() ? -1 : 1)
          : lhs.timing.startTime - rhs.timing.startTime
      )
    } else {
      this.clips = clips
    }
    const timingsAreValid = this.clips.every(
      (c) =>
        Number.isFinite(c.timing.startTime) &&
        Number.isFinite(c.timing.duration) &&
        c.timing.duration > 0
    )
    const sequenceIsNonoverlapping = this.clips.slice(1).every((next, i) => {
      const previous = this.clips[i]
      const gap = next.timing.startTime - timingEndTime(previous.timing)
      const touches = gap <= ZOOM_INTERP.adjacencyTolerance
      const clears = next.timing.startTime >= timingEndTime(previous.timing) - 0.0001
      return next.timing.startTime >= timingEndTime(previous.timing) - 0.0001 && (touches || clears)
    })
    this.usesIndexedEvaluation = timingsAreValid && sequenceIsNonoverlapping
  }

  sample(
    time: number,
    base: CameraMotionState,
    cameraAspectRatio: number,
    canvasAspectRatio: number,
    motion: MotionStyle = makeMotionStyle()
  ): CameraMotionSample {
    const resolvedBase = CameraMotionTrack.resolve(base, cameraAspectRatio, canvasAspectRatio)
    if (!this.usesIndexedEvaluation || !Number.isFinite(time)) {
      return this.sampleByScanning(time, resolvedBase, cameraAspectRatio, canvasAspectRatio, motion)
    }
    const index = this.lastStartedClipIndex(time)
    if (index === null) return resolvedBase
    const clip = this.clips[index]
    const target = CameraMotionTrack.resolve(clip.target, cameraAspectRatio, canvasAspectRatio)
    const endTime = timingEndTime(clip.timing)
    if (time < endTime) {
      let inherited: CameraMotionSample
      if (index > 0) {
        const previous = this.clips[index - 1]
        const touches =
          Math.abs(timingEndTime(previous.timing) - clip.timing.startTime) <=
          ZOOM_INTERP.adjacencyTolerance
        inherited =
          !touches && previous.timing.returnDuration > 0.0001
            ? resolvedBase
            : CameraMotionTrack.resolve(previous.target, cameraAspectRatio, canvasAspectRatio)
      } else {
        inherited = resolvedBase
      }
      const leadIn = Math.min(clip.timing.leadInDuration, clip.timing.duration)
      if (!(leadIn > 0.0001)) return target
      const local = Math.min((time - clip.timing.startTime) / leadIn, 1)
      const linear =
        clip.timing.leadInProgressOffset + (1 - clip.timing.leadInProgressOffset) * local
      const progress = easedProgress(linear, clip.timing.easing, clip.timing.customCurve, motion)
      return CameraMotionTrack.transitionSample(inherited, target, progress)
    }
    // 子帧间隙仍属于相邻交接：保持前段目标直到下一段开始（回落会闪烁）
    if (this.touchesNextClip(index)) return target
    const falling = this.returnFalloff(index, resolvedBase, time, cameraAspectRatio, canvasAspectRatio, motion)
    if (falling) return falling
    return clip.timing.returnDuration > 0.0001 ? resolvedBase : target
  }

  /** 畸形轨道的兼容扫描路径；持久化工程已校验，总走上面的索引路径。 */
  private sampleByScanning(
    time: number,
    resolvedBase: CameraMotionSample,
    cameraAspectRatio: number,
    canvasAspectRatio: number,
    motion: MotionStyle
  ): CameraMotionSample {
    let inherited = resolvedBase
    let previousIndex: number | null = null
    for (let index = 0; index < this.clips.length; index++) {
      const clip = this.clips[index]
      if (
        !Number.isFinite(clip.timing.startTime) ||
        !Number.isFinite(clip.timing.duration) ||
        !(clip.timing.duration > 0)
      ) {
        continue
      }
      if (time < clip.timing.startTime) {
        if (previousIndex !== null) {
          const falling = this.returnFalloff(previousIndex, resolvedBase, time, cameraAspectRatio, canvasAspectRatio, motion)
          if (falling) return falling
        }
        return inherited
      }
      const target = CameraMotionTrack.resolve(clip.target, cameraAspectRatio, canvasAspectRatio)
      const endTime = timingEndTime(clip.timing)
      if (time < endTime) {
        const leadIn = Math.min(clip.timing.leadInDuration, clip.timing.duration)
        if (!(leadIn > 0.0001)) return target
        const local = Math.min((time - clip.timing.startTime) / leadIn, 1)
        const linear =
          clip.timing.leadInProgressOffset + (1 - clip.timing.leadInProgressOffset) * local
        const progress = easedProgress(linear, clip.timing.easing, clip.timing.customCurve, motion)
        return CameraMotionTrack.transitionSample(inherited, target, progress)
      }
      inherited =
        !this.touchesNextClip(index) && clip.timing.returnDuration > 0.0001
          ? resolvedBase
          : target
      previousIndex = index
    }
    if (previousIndex !== null) {
      const falling = this.returnFalloff(previousIndex, resolvedBase, time, cameraAspectRatio, canvasAspectRatio, motion)
      if (falling) return falling
      return this.clips[previousIndex].timing.returnDuration > 0.0001 ? resolvedBase : inherited
    }
    return inherited
  }

  private lastStartedClipIndex(time: number): number | null {
    let lower = 0
    let upper = this.clips.length
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2)
      if (this.clips[middle].timing.startTime <= time) lower = middle + 1
      else upper = middle
    }
    return lower > 0 ? lower - 1 : null
  }

  private touchesNextClip(index: number): boolean {
    return (
      index + 1 < this.clips.length &&
      Math.abs(this.clips[index + 1].timing.startTime - timingEndTime(this.clips[index].timing)) <=
        ZOOM_INTERP.adjacencyTolerance
    )
  }

  /** 结尾回落窗口：从片段自身目标平滑回基础状态，仅在无相接后继时生效。 */
  private returnFalloff(
    index: number,
    base: CameraMotionSample,
    time: number,
    cameraAspectRatio: number,
    canvasAspectRatio: number,
    motion: MotionStyle
  ): CameraMotionSample | null {
    const clip = this.clips[index]
    if (!(clip.timing.returnDuration > 0.0001)) return null
    if (this.touchesNextClip(index)) return null
    const endTime = timingEndTime(clip.timing)
    if (time > endTime + clip.timing.returnDuration) return null
    const local = Math.min(Math.max((time - endTime) / clip.timing.returnDuration, 0), 1)
    const linear = clip.timing.returnProgressOffset + (1 - clip.timing.returnProgressOffset) * local
    const progress = easedProgress(linear, clip.timing.easing, clip.timing.customCurve, motion)
    const target = CameraMotionTrack.resolve(clip.target, cameraAspectRatio, canvasAspectRatio)
    return CameraMotionTrack.transitionSample(target, base, progress)
  }

  /** 隐藏目标原地淡出 / 隐藏源在目标处淡入；其余走完整几何插值。 */
  private static transitionSample(
    from: CameraMotionSample,
    to: CameraMotionSample,
    progress: number
  ): CameraMotionSample {
    const t = Math.min(Math.max(progress, 0), 1)
    if (to.opacity < 0.01) {
      return { ...from, opacity: mix(from.opacity, 0, t) }
    }
    if (from.opacity < 0.01) {
      return { ...to, opacity: mix(0, to.opacity, t) }
    }
    return CameraMotionTrack.interpolate(from, to, t)
  }

  /** 离散布局 → 连续采样（圆 → 矩形 → 全屏过渡的统一坐标系）。 */
  static resolve(
    state: CameraMotionState,
    cameraAspectRatio: number,
    canvasAspectRatio: number
  ): CameraMotionSample {
    let aspect: number
    let cornerFraction: number
    let fullscreen: number
    if (state.layout.kind === 'shape') {
      fullscreen = 0
      switch (state.layout.shape) {
        case '方形':
          aspect = 1
          cornerFraction = 0.5 * state.roundness
          break
        case '圆形':
          aspect = 1
          cornerFraction = 0.5
          break
        case '横向':
          aspect = 1.5
          cornerFraction = 0.5 * state.roundness
          break
        case '纵向':
          aspect = 0.72
          cornerFraction = 0.5 * state.roundness
          break
        case '原始比例':
          aspect = Math.max(cameraAspectRatio, 0.01)
          cornerFraction = 0.5 * state.roundness
          break
      }
    } else {
      aspect = Math.max(canvasAspectRatio, 0.01)
      cornerFraction = 0
      fullscreen = 1
    }
    return {
      position: state.position,
      size: state.size,
      aspectRatio: aspect,
      cornerFraction,
      fullscreenProgress: fullscreen,
      opacity: state.opacity,
    }
  }

  private static interpolate(
    from: CameraMotionSample,
    to: CameraMotionSample,
    progress: number
  ): CameraMotionSample {
    const t = Math.min(Math.max(progress, 0), 1)
    return {
      position: {
        x: mix(from.position.x, to.position.x, t),
        y: mix(from.position.y, to.position.y, t),
      },
      size: mix(from.size, to.size, t),
      aspectRatio: mix(from.aspectRatio, to.aspectRatio, t),
      cornerFraction: mix(from.cornerFraction, to.cornerFraction, t),
      fullscreenProgress: mix(from.fullscreenProgress, to.fullscreenProgress, t),
      opacity: mix(from.opacity, to.opacity, t),
    }
  }
}

function mix(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

// ---------------------------------------------------------------- TimelineTrackOrdering 扩展

/** Swift TimelineTrackOrdering.cameraMotionClipsNeedRepair（同 motionClipsNeedRepair 泛型逻辑）。 */
export function cameraMotionClipsNeedRepair(clips: CameraMotionClip[]): boolean {
  if (clips.length <= 1) return false
  for (let i = 1; i < clips.length; i++) {
    const current = clips[i]
    const previous = clips[i - 1]
    if (
      current.timing.startTime < previous.timing.startTime ||
      (current.timing.startTime === previous.timing.startTime &&
        current.id.toUpperCase() < previous.id.toUpperCase())
    ) {
      return true
    }
  }
  return false
}
