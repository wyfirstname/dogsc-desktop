/**
 * ScreenMotion — 屏幕 3D 运镜的时间维求值器。
 *
 * Swift source: Sources/RecorderCore/ScreenMotion.swift @ laogou717/dogsc 567fd6e
 *   逐项对照（按源文件行号）：
 *   - struct ScreenMotionState            → ScreenTransform.ts（已有，L5）
 *   - struct ScreenMotionClip             → ProjectTimeline.ts（已有，此处补 groupID）
 *   - struct ScreenAnchorViewport         (L57)
 *   - struct ScreenMotionSample           (L99)
 *   - enum ScreenMotionFraming（placement/focus）(L118)
 *   - struct ScreenMotionTrack            (L132)
 *     · init（排序 + 索引路径资格判定）    (L136)
 *     · activeClip(at:)                  (L162)
 *     · sample(at:base:motion:)          (L168)
 *     · sampleLayout(...)                (L186)
 *     · sampleLayoutByScanning（畸形轨道兼容路径）(L288)
 *     · lastStartedClipIndex（二分）      (L388)
 *     · touchesNextClip                  (L402)
 *     · returnFalloff（结尾回落窗口）     (L410)
 *     · interpolateLayout（rect 空间线性插值 + manualOffset + 投影锚点搬运）(L443)
 *     · layoutSample / directOffset      (L533/L547)
 *     · mix / mixAngle                   (L601/L605)
 *
 * 平台差异说明：Swift UUID.uuidString 比较 → TS 直接比较 id 字符串。
 */

import {
  ZOOM_INTERP,
  easedProgress,
  type ZoomEasingPreset,
  type ZoomBezierCurve,
} from './ZoomAnimation'
import { screenMotionClipsNeedRepair } from './TimelineTrackOrdering'
import { timingEndTime, type TransitionTiming } from './ProjectTimeline'
import type { ScreenMotionState } from './ScreenTransform'
import type { NormalizedPoint } from './ZoomAnimation'
import type { MotionStyle } from './MotionStyle'
import { makeMotionStyle } from './MotionStyle'
import type { CompositionPoint } from './CompositionGeometry'
import type { ScreenMotionClip } from './ProjectTimeline'

export type TimeInterval = number

const mix = (from: number, to: number, progress: number): number =>
  from + (to - from) * progress

/** Swift mixAngle：角度差先归一到 (-180, 180] 再插值，避免绕远路。 */
export function mixAngle(from: number, to: number, progress: number): number {
  let delta = (to - from) % 360
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  return from + delta * progress
}

// ---------------------------------------------------------------- ScreenAnchorViewport

/**
 * 锚点空间：rect 线性过渡需要的画布与适配尺寸。
 * 提供后，位置/大小按「内容的几分之几对齐画布的几分之几」在 rect 空间线性
 * 插值（缩放锚点从动画开始就钉在目标区域），而不是分别独立插值
 * （pos×(W−scaledW) 的双线性路径会先居中放大、后漂移）。
 */
export interface ScreenAnchorViewport {
  canvasWidth: number
  canvasHeight: number
  fittedWidth: number
  fittedHeight: number
  /** 屏幕 motion scale = 1 时的外边框；边框随卡片缩放，参与同一像素偏移插值。 */
  borderWidthAtScaleOne: number
  /** motion scale = 1 时装饰超出录制内容的四向扩张；四值显式，定位不再假设卡片对称。 */
  decorationTopAtScaleOne: number
  decorationRightAtScaleOne: number
  decorationBottomAtScaleOne: number
  decorationLeftAtScaleOne: number
}

export function makeAnchorViewport(
  canvasWidth: number,
  canvasHeight: number,
  fittedWidth: number,
  fittedHeight: number,
  overrides: Partial<
    Pick<
      ScreenAnchorViewport,
      | 'borderWidthAtScaleOne'
      | 'decorationTopAtScaleOne'
      | 'decorationRightAtScaleOne'
      | 'decorationBottomAtScaleOne'
      | 'decorationLeftAtScaleOne'
    >
  > = {}
): ScreenAnchorViewport {
  return {
    canvasWidth,
    canvasHeight,
    fittedWidth,
    fittedHeight,
    borderWidthAtScaleOne: 0,
    decorationTopAtScaleOne: 0,
    decorationRightAtScaleOne: 0,
    decorationBottomAtScaleOne: 0,
    decorationLeftAtScaleOne: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------- ScreenMotionSample

/**
 * 求值后的屏幕 motion + 非奇异像素平移。
 * `state.position` 仍是持久化的编辑表示；渲染几何在已知锚点视口时消费
 * `manualOffset`。
 */
export interface ScreenMotionSample {
  state: ScreenMotionState
  manualOffset: CompositionPoint | null
  /** 装饰卡片被倾斜/旋转时必须保持固定的语义点。 */
  projectionAnchor: NormalizedPoint
}

// ---------------------------------------------------------------- ScreenMotionFraming

/** placement = 工程的普通摆放；focus = 3D 目标是录屏内的关注点。 */
type ScreenMotionFraming = 'placement' | 'focus'

// ---------------------------------------------------------------- ScreenMotionTrack

/**
 * 不可变、已排序的屏幕 motion 求值器。片段从上一段完成的目标出发，
 * 在 endTime 恰好到达目标。片段不再与后一段相接且带回落时长时，
 * 先平滑回到基础状态再继续；相接的片段永远直接串联（关键帧效果），
 * 过渡全部走非线性缓动。
 */
export class ScreenMotionTrack {
  readonly clips: ScreenMotionClip[]
  private readonly usesIndexedEvaluation: boolean

  constructor(clips: ScreenMotionClip[]) {
    if (screenMotionClipsNeedRepair(clips)) {
      this.clips = [...clips].sort((lhs, rhs) =>
        lhs.timing.startTime === rhs.timing.startTime
          ? (lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0)
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
    const sequenceIsNonoverlapping = this.clips
      .slice(1)
      .every((next, i) => {
        const previous = this.clips[i]
        const gap = next.timing.startTime - timingEndTime(previous.timing)
        const touches = gap <= ZOOM_INTERP.adjacencyTolerance
        const clears =
          next.timing.startTime >= timingEffectEnd(previous.timing) - 0.0001
        return (
          next.timing.startTime >= timingEndTime(previous.timing) - 0.0001 &&
          (touches || clears)
        )
      })
    this.usesIndexedEvaluation = timingsAreValid && sequenceIsNonoverlapping
  }

  activeClipAt(time: TimeInterval): ScreenMotionClip | null {
    if (!Number.isFinite(time)) return null
    const index = this.lastStartedClipIndex(time)
    if (index === null) return null
    const clip = this.clips[index]
    return clip.timing.returnDuration > 0 && time >= timingEffectEnd(clip.timing)
      ? null
      : clip
  }

  /** 简化采样：只要状态，不要 manualOffset。 */
  sampleAt(
    time: TimeInterval,
    base: ScreenMotionState,
    motion: MotionStyle = makeMotionStyle(),
    anchorViewport: ScreenAnchorViewport | null = null
  ): ScreenMotionState {
    return this.sampleLayout(time, base, motion, anchorViewport).state
  }

  /**
   * 渲染侧采样：平移保持像素单位。把一张正在移动、缩放的卡片换算回归一化
   * 位置要除以 `canvas − scaledCard`；该分母在卡片长到画布大小时会过零，
   * 正是 project-01 的一帧跳变根因。
   */
  sampleLayout(
    time: TimeInterval,
    base: ScreenMotionState,
    motion: MotionStyle = makeMotionStyle(),
    anchorViewport: ScreenAnchorViewport | null = null
  ): ScreenMotionSample {
    if (!this.usesIndexedEvaluation || !Number.isFinite(time)) {
      return this.sampleLayoutByScanning(time, base, motion, anchorViewport)
    }
    const index = this.lastStartedClipIndex(time)
    if (index === null) {
      return layoutSample(base, anchorViewport, 'placement')
    }
    const clip = this.clips[index]
    if (time < timingEndTime(clip.timing)) {
      let inherited: ScreenMotionState
      let inheritedFraming: ScreenMotionFraming
      if (index > 0) {
        const previous = this.clips[index - 1]
        const touches =
          Math.abs(timingEndTime(previous.timing) - clip.timing.startTime) <=
          ZOOM_INTERP.adjacencyTolerance
        if (!touches && previous.timing.returnDuration > 0.0001) {
          inherited = base
          inheritedFraming = 'placement'
        } else {
          inherited = previous.target
          inheritedFraming = 'focus'
        }
      } else {
        inherited = base
        inheritedFraming = 'placement'
      }
      const leadIn = Math.min(clip.timing.leadInDuration, clip.timing.duration)
      if (!(leadIn > 0.0001)) {
        return layoutSample(clip.target, anchorViewport, 'focus')
      }
      const local = Math.min((time - clip.timing.startTime) / leadIn, 1)
      const linear =
        clip.timing.leadInProgressOffset +
        (1 - clip.timing.leadInProgressOffset) * local
      const progress = easedProgress(
        linear,
        clip.timing.easing as ZoomEasingPreset,
        clip.timing.customCurve as ZoomBezierCurve,
        motion
      )
      return interpolateLayout(
        inherited,
        clip.target,
        progress,
        anchorViewport,
        inheritedFraming,
        'focus',
        inheritedFraming === 'focus' ? inherited.position : null,
        clip.target.position
      )
    }
    // 亚帧间隙仍算相接的关键帧：保持已完成的平面直到下一段开始；
    // 休眠回落不得在两个目标之间插入一帧未变换的基础状态。
    if (this.touchesNextClipAfter(index)) {
      return layoutSample(clip.target, anchorViewport, 'focus')
    }
    const falling = this.returnFalloff(index, base, time, motion, anchorViewport)
    if (falling !== null) return falling
    return clip.timing.returnDuration > 0.0001
      ? layoutSample(base, anchorViewport, 'placement')
      : layoutSample(clip.target, anchorViewport, 'focus')
  }

  /** 畸形调用方构造轨道的兼容路径；持久化工程经过校验，总走上面的索引路径。 */
  private sampleLayoutByScanning(
    time: TimeInterval,
    base: ScreenMotionState,
    motion: MotionStyle,
    anchorViewport: ScreenAnchorViewport | null
  ): ScreenMotionSample {
    let inherited = base
    let inheritedFraming: ScreenMotionFraming = 'placement'
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
          const falling = this.returnFalloff(
            previousIndex,
            base,
            time,
            motion,
            anchorViewport
          )
          if (falling !== null) return falling
        }
        return layoutSample(inherited, anchorViewport, inheritedFraming)
      }
      if (time < timingEndTime(clip.timing)) {
        // 进入过渡按 leadInDuration 插值，之后到 endTime 保持目标
        const leadIn = Math.min(clip.timing.leadInDuration, clip.timing.duration)
        if (!(leadIn > 0.0001)) {
          return layoutSample(clip.target, anchorViewport, 'focus')
        }
        const local = Math.min((time - clip.timing.startTime) / leadIn, 1)
        const linear =
          clip.timing.leadInProgressOffset +
          (1 - clip.timing.leadInProgressOffset) * local
        const progress = easedProgress(
          linear,
          clip.timing.easing as ZoomEasingPreset,
          clip.timing.customCurve as ZoomBezierCurve,
          motion
        )
        return interpolateLayout(
          inherited,
          clip.target,
          progress,
          anchorViewport,
          inheritedFraming,
          'focus',
          inheritedFraming === 'focus' ? inherited.position : null,
          clip.target.position
        )
      }
      const touchesNext = this.touchesNextClipAfter(index)
      if (!touchesNext && clip.timing.returnDuration > 0.0001) {
        inherited = base
        inheritedFraming = 'placement'
      } else {
        inherited = clip.target
        inheritedFraming = 'focus'
      }
      previousIndex = index
    }
    if (previousIndex !== null) {
      const falling = this.returnFalloff(previousIndex, base, time, motion, anchorViewport)
      if (falling !== null) return falling
      return this.clips[previousIndex].timing.returnDuration > 0.0001
        ? layoutSample(base, anchorViewport, 'placement')
        : layoutSample(inherited, anchorViewport, inheritedFraming)
    }
    return layoutSample(inherited, anchorViewport, inheritedFraming)
  }

  private lastStartedClipIndex(time: TimeInterval): number | null {
    let lower = 0
    let upper = this.clips.length
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2)
      if (this.clips[middle].timing.startTime <= time) {
        lower = middle + 1
      } else {
        upper = middle
      }
    }
    return lower > 0 ? lower - 1 : null
  }

  private touchesNextClipAfter(index: number): boolean {
    return (
      index + 1 < this.clips.length &&
      Math.abs(
        this.clips[index + 1].timing.startTime - timingEndTime(this.clips[index].timing)
      ) <= ZOOM_INTERP.adjacencyTolerance
    )
  }

  /**
   * 结尾回落窗口：从片段自身目标平滑回到基础状态，仅在片段没有相接的
   * 后继时生效；窗口结束后保持基础状态。
   */
  private returnFalloff(
    index: number,
    base: ScreenMotionState,
    time: TimeInterval,
    motion: MotionStyle,
    anchorViewport: ScreenAnchorViewport | null
  ): ScreenMotionSample | null {
    const clip = this.clips[index]
    if (!(clip.timing.returnDuration > 0.0001)) return null
    if (this.touchesNextClipAfter(index)) return null
    if (time > timingEndTime(clip.timing) + clip.timing.returnDuration) return null
    const local = Math.min(
      Math.max((time - timingEndTime(clip.timing)) / clip.timing.returnDuration, 0),
      1
    )
    const linear =
      clip.timing.returnProgressOffset +
      (1 - clip.timing.returnProgressOffset) * local
    const progress = easedProgress(
      linear,
      clip.timing.easing as ZoomEasingPreset,
      clip.timing.customCurve as ZoomBezierCurve,
      motion
    )
    return interpolateLayout(
      clip.target,
      base,
      progress,
      anchorViewport,
      'focus',
      'placement',
      null,
      clip.target.position
    )
  }
}

function timingEffectEnd(timing: TransitionTiming): TimeInterval {
  return timingEndTime(timing) + timing.returnDuration
}

// ---------------------------------------------------------------- 静态插值函数

function interpolateLayout(
  from: ScreenMotionState,
  to: ScreenMotionState,
  progress: number,
  anchorViewport: ScreenAnchorViewport | null,
  fromFraming: ScreenMotionFraming,
  toFraming: ScreenMotionFraming,
  inheritedProjectionAnchor: NormalizedPoint | null,
  projectionAnchor: NormalizedPoint
): ScreenMotionSample {
  const t = Math.min(Math.max(progress, 0), 1)
  let position: NormalizedPoint
  if (anchorViewport !== null) {
    // rect 空间线性插值：缩放锚点全程钉在两端 rect 连线上，
    // 不会先居中放大再漂移。
    const viewport = anchorViewport
    const scaledW0 = from.scale * viewport.fittedWidth
    const scaledW1 = to.scale * viewport.fittedWidth
    const scaledW = mix(scaledW0, scaledW1, t)
    const ux = mix(
      from.position.x * (viewport.canvasWidth - scaledW0),
      to.position.x * (viewport.canvasWidth - scaledW1),
      t
    )
    const scaledH0 = from.scale * viewport.fittedHeight
    const scaledH1 = to.scale * viewport.fittedHeight
    const scaledH = mix(scaledH0, scaledH1, t)
    const uy = mix(
      from.position.y * (viewport.canvasHeight - scaledH0),
      to.position.y * (viewport.canvasHeight - scaledH1),
      t
    )
    const denomX = viewport.canvasWidth - scaledW
    const denomY = viewport.canvasHeight - scaledH
    // 中间态 pos 允许超出 0...1（rect 线性路径在放大过渡中需要）；
    // 只有持久化的目标值要求 0...1，采样插值不受此限。
    position = {
      x:
        Math.abs(denomX) > 0.001
          ? ux / denomX
          : mix(from.position.x, to.position.x, t),
      y:
        Math.abs(denomY) > 0.001
          ? uy / denomY
          : mix(from.position.y, to.position.y, t),
    }
  } else {
    position = {
      x: mix(from.position.x, to.position.x, t),
      y: mix(from.position.y, to.position.y, t),
    }
  }
  const state: ScreenMotionState = {
    position,
    scale: mix(from.scale, to.scale, t),
    rotationX: mixAngle(from.rotationX, to.rotationX, t),
    rotationY: mixAngle(from.rotationY, to.rotationY, t),
    rotationZ: mixAngle(from.rotationZ, to.rotationZ, t),
    perspective: mix(from.perspective, to.perspective, t),
  }
  let manualOffset: CompositionPoint | null = null
  if (anchorViewport !== null) {
    const fromOffset = directOffset(from, anchorViewport, fromFraming)
    const toOffset = directOffset(to, anchorViewport, toFraming)
    manualOffset = {
      x: mix(fromOffset.x, toOffset.x, t),
      y: mix(fromOffset.y, toOffset.y, t),
    }
  }
  return {
    state,
    manualOffset,
    // 从平坦基础状态的首次进入，从第一帧起就保留手授轴心；
    // 已倾斜过的目标自带轴心：把它以与平面相同的缓动进度搬进下一段过渡，
    // 而不是在旧旋转仍完全生效时跳到新轴心。
    projectionAnchor:
      inheritedProjectionAnchor !== null
        ? {
            x: mix(inheritedProjectionAnchor.x, projectionAnchor.x, t),
            y: mix(inheritedProjectionAnchor.y, projectionAnchor.y, t),
          }
        : projectionAnchor,
  }
}

function layoutSample(
  state: ScreenMotionState,
  viewport: ScreenAnchorViewport | null,
  framing: ScreenMotionFraming
): ScreenMotionSample {
  return {
    state,
    manualOffset: viewport !== null ? directOffset(state, viewport, framing) : null,
    projectionAnchor: state.position,
  }
}

function directOffset(
  state: ScreenMotionState,
  viewport: ScreenAnchorViewport,
  framing: ScreenMotionFraming
): CompositionPoint {
  const cardScale = state.scale
  const contentWidth = viewport.fittedWidth * cardScale
  const contentHeight = viewport.fittedHeight * cardScale
  const border = viewport.borderWidthAtScaleOne * cardScale
  const left = border + viewport.decorationLeftAtScaleOne * cardScale
  const right = border + viewport.decorationRightAtScaleOne * cardScale
  const top = border + viewport.decorationTopAtScaleOne * cardScale
  const bottom = border + viewport.decorationBottomAtScaleOne * cardScale
  const decoratedWidth = contentWidth + left + right
  const decoratedHeight = contentHeight + top + bottom
  let contentCenterX: number
  let contentCenterY: number
  if (framing === 'placement') {
    // 从完整非对称卡片边界解出内容中心。基础屏幕的边缘值保证 chrome 与
    // 边框留在画布内。
    contentCenterX =
      state.position.x * (viewport.canvasWidth - decoratedWidth) +
      contentWidth / 2 +
      left
    contentCenterY =
      state.position.y * (viewport.canvasHeight - decoratedHeight) +
      contentHeight / 2 +
      top
  } else {
    const focusX = Math.min(Math.max(state.position.x, 0), 1)
    const focusY = Math.min(Math.max(state.position.y, 0), 1)
    // 角落目标是关注点，不是把整张卡片钉到画布角落的指令。高倍缩放时把
    // 选中内容点移进中央的构图安全区（3x 及以上约 31%/69%），低倍缩放保持
    // 熟悉的边缘摆放。该点本身仍是 3D 轴心。
    const recenter = Math.min(Math.max((cardScale - 1) / 2, 0), 1) * 0.62
    const boundedX = left + focusX * Math.max(viewport.canvasWidth - left - right, 0)
    const boundedY = top + focusY * Math.max(viewport.canvasHeight - top - bottom, 0)
    // 回中与 placement 一样以完整卡片为参照。内容相对该中心的内缩在任意
    // 缩放下保持不变，居中的 3D 目标带顶部工具栏时不会漂移。
    const targetX = mix(boundedX, (viewport.canvasWidth + left - right) / 2, recenter)
    const targetY = mix(boundedY, (viewport.canvasHeight + top - bottom) / 2, recenter)
    contentCenterX = targetX + (0.5 - focusX) * contentWidth
    contentCenterY = targetY + (0.5 - focusY) * contentHeight
  }
  return {
    x: contentCenterX - viewport.canvasWidth / 2,
    y: contentCenterY - viewport.canvasHeight / 2,
  }
}
