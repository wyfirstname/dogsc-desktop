/**
 * 指针轨迹 —— 重构出的合成光标运动路径。
 *
 * Swift source: Sources/RecorderCore/PointerTrack.swift @ laogou717/dogsc 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct PointerClickPhase      L3-20    → PointerClickPhase
 *   - struct PointerSample          L22-45   → PointerSample
 *   - struct PointerTrackEvaluation L47-55   → PointerTrackEvaluation
 *   - struct PointerSpringCacheKey  L57-61   → PointerSpringCacheKey（key 用模板串）
 *   - struct PointerSpringSample    L63-66   → PointerSpringSample
 *   - struct PointerTrack           L68-883  → class PointerTrack
 *   - enum PointerInterpolator      L885-894 → PointerInterpolator
 *
 * MotionStyle / CursorMotionStyle 的 rawValue 是中文：smooth/medium/rapid/none
 * 分别对应 '平滑'/'适中'/'快速'/'无'。CursorStyle.assetID 用字符串
 * （CURSOR_ASSET_HIDDEN = 'system.hidden'）；clickEffectStyle.duration
 * 对应 cursorClickEffectDuration(style)。
 */

import type { NormalizedPoint, PointerEventKind, PointerEventRecord, TimeInterval } from './ZoomAnimation'
import {
  CURSOR_ASSET_HIDDEN,
  makeCursorStyle,
  type CursorStyle,
  cursorClickEffectDuration,
} from './ProjectModel'
import { makeMotionStyle, type CursorMotionStyle, type MotionStyle } from './MotionStyle'
import { BoundedMemoizationCache } from './BoundedMemoizationCache'
import { normalizedPointerEvents } from './PointerEventTimelineOrdering'
import { firstEventIndexAtOrAfter } from './TimelineMap'

// ---------------------------------------------------------------- Value types

/** Swift PointerClickPhase（L3-20）。 */
export interface PointerClickPhase {
  progress: number
  elapsed: number
  duration: number
  kind: PointerEventKind
}

/** Swift PointerClickPhase.init(progress:elapsed:duration:kind:)。 */
export function makeClickPhase(
  progress: number,
  elapsed: number,
  duration: number,
  kind: PointerEventKind
): PointerClickPhase {
  return { progress: Math.min(Math.max(progress, 0), 1), elapsed, duration, kind }
}

/** Swift PointerSample（L22-45）。 */
export interface PointerSample {
  location: NormalizedPoint
  isClicking: boolean
  clickPhase: PointerClickPhase | null
  /**
   * 由近期光标速度推导的克制后期倾斜。渲染器绕声明的热点旋转位图，
   * 因此创作的点击坐标保持精确。
   */
  rotationRadians: number
  recordedCursorAssetID: string | null
}

/** Swift PointerSample.init(location:isClicking:...)。 */
export function makePointerSample(
  location: NormalizedPoint,
  isClicking: boolean,
  clickPhase: PointerClickPhase | null = null,
  rotationRadians: number = 0,
  recordedCursorAssetID: string | null = null
): PointerSample {
  return {
    location,
    isClicking,
    clickPhase,
    rotationRadians: Number.isFinite(rotationRadians) ? rotationRadians : 0,
    recordedCursorAssetID,
  }
}

/** Swift PointerTrackEvaluation（L47-55）。位置与可见性解耦。 */
export interface PointerTrackEvaluation {
  position: NormalizedPoint | null
  cursor: PointerSample | null
}

export function makeEvaluation(
  position: NormalizedPoint | null,
  cursor: PointerSample | null
): PointerTrackEvaluation {
  return { position, cursor }
}

interface PointerSpringSample {
  time: TimeInterval
  location: NormalizedPoint
}

/** 弹簧参数键（Swift PointerSpringCacheKey），序列化为稳定字符串。 */
function springCacheKey(motion: MotionStyle): string {
  return `${motion.cursorSpringMass}|${motion.cursorSpringStiffness}|${motion.cursorSpringDamping}`
}

// ---------------------------------------------------------------- PointerTrack

/**
 * Swift PointerTrack（L68-883）。
 *
 * 一条重构的合成光标路径：弹簧平滑、点击锚定、C1 Hermite/PCHIP 插值、
 * 拖尾倾斜。评估是因果且确定的——只采样过去的重构位置，预览与导出一致。
 */
export class PointerTrack {
  /** 间隔超过它说明指针空闲过，下一事件开启一段新运动（L72）。 */
  private static readonly MAXIMUM_CONTINUOUS_INPUT_GAP: TimeInterval = 0.12
  /** macOS 上报指针变化而非固定采样；真实慢速移动可以含稀疏事件（L77-78）。 */
  private static readonly MAXIMUM_SLOW_MOVE_GAP: TimeInterval = 0.5
  private static readonly MAXIMUM_SLOW_MOVE_DISTANCE = 0.03
  /** 后期握有完整轨迹，把点击修正摊在短邻域而非点击帧硬跳（L83-85）。 */
  private static readonly CLICK_ANCHOR_LEAD_DURATION: TimeInterval = 0.18
  private static readonly CLICK_ANCHOR_TRAIL_DURATION: TimeInterval = 0.18
  private static readonly CLICK_EFFECT_DURATION: TimeInterval = 0.18

  readonly events: PointerEventRecord[]
  /**
   * 40 分钟 240Hz 弹簧路径约 576,000 个样本。只保留当前与上一个检查器
   * 变体，不保留滑杆拖动过程中的每个瞬时值（L91-94）。
   */
  private readonly springCache: BoundedMemoizationCache<string, PointerSpringSample[]>

  constructor(events: PointerEventRecord[]) {
    this.events = normalizedPointerEvents(events)
    this.springCache = new BoundedMemoizationCache(2)
  }

  /** L101-103：events 数组相等即相等。 */
  equals(other: PointerTrack): boolean {
    return pointerEventsEqual(this.events, other.events)
  }

  /** L108-117：在播放/显示链接调用点之外构建当前光标弹簧。 */
  prewarmCursorSpring(motion: MotionStyle): void {
    if (motion.cursor !== '平滑' || this.events.length === 0) return
    const key = springCacheKey(motion)
    this.springCache.valueIfBuilt(key, () =>
      this.makeSpringSamples(motion, () => false)
    )
  }

  /** L119：cachedSpringVariantCount。 */
  get cachedSpringVariantCount(): number {
    return this.springCache.count
  }

  /** L121-127。 */
  sample(
    time: TimeInterval,
    motion: MotionStyle = defaultMotion(),
    style: CursorStyle = defaultCursorStyle()
  ): PointerSample | null {
    return this.evaluation(time, motion, style).cursor
  }

  /** L129-134。 */
  samplePosition(time: TimeInterval, motion: MotionStyle = defaultMotion()): NormalizedPoint | null {
    return this.evaluation(time, motion, defaultCursorStyle()).position
  }

  /**
   * L139-211：物理指针位置独立于光标可见性计算。隐藏导出光标绝不能
   * 停用跟随同一指针轨迹的自动运镜。
   */
  evaluation(
    time: TimeInterval,
    motion: MotionStyle = defaultMotion(),
    style: CursorStyle = defaultCursorStyle()
  ): PointerTrackEvaluation {
    const first = this.events[0]
    if (!first) return makeEvaluation(null, null)
    // 轨迹开始之前绝不透露未来样本（L147-151）。
    if (time < first.time) return makeEvaluation(null, null)

    const upperIndex = this.firstIndexAfter(time)
    const lowerIndex = upperIndex > 0 ? upperIndex - 1 : 0
    const lower = this.events[lowerIndex]
    const upper = upperIndex < this.events.length ? this.events[upperIndex] : null
    let rawLocation: NormalizedPoint
    if (motion.cursor === '平滑') {
      rawLocation = this.springLocation(time, motion) ?? lower.location
    } else if (upper && upper.time > lower.time) {
      rawLocation = this.interpolatedLocation(lowerIndex, upperIndex, time, motion)
    } else {
      rawLocation = lower.location
    }
    const cursorIsVisible =
      style.assetID !== CURSOR_ASSET_HIDDEN &&
      (!style.hideWhenIdle || time - lower.time <= style.idleDelay)
    let clickPhase: PointerClickPhase | null = null
    const effectDuration = cursorClickEffectDuration(style.clickEffectStyle)
    if (cursorIsVisible && style.clickEffectStyle !== 'none' && effectDuration > 0) {
      const click = this.mostRecentClick(time - effectDuration, time)
      if (click) {
        const elapsed = Math.max(time - click.time, 0)
        const progress = Math.min(Math.max(elapsed / effectDuration, 0), 1)
        clickPhase = makeClickPhase(progress, elapsed, effectDuration, click.kind)
      }
    }
    const clicking = clickPhase !== null
    const rotationRadians = this.cursorRotationRadians(time, rawLocation, motion, style.motionTiltStrength)
    return makeEvaluation(
      rawLocation,
      cursorIsVisible
        ? makePointerSample(rawLocation, clicking, clickPhase, rotationRadians, lower.cursorAssetID ?? null)
        : null
    )
  }

  // ------------------------------------------------ cursorRotationRadians

  /**
   * L218-302：把热点当作沉重的领先端尖。可见的箭头主体保留一部分之前的
   * 运动方向，因此在加速与转向时略微拖在端尖后面，而不是保持刚性精灵。
   */
  private cursorRotationRadians(
    time: TimeInterval,
    currentLocation: NormalizedPoint,
    motion: MotionStyle,
    strength: number
  ): number {
    const boundedStrength = Math.min(Math.max(strength, 2), 4)

    let sampleWindow: TimeInterval
    let maximumDegrees: number
    let previousVelocityWeight: number
    let responseSpan: number
    switch (motion.cursor as CursorMotionStyle) {
      case '平滑':
        sampleWindow = 0.08
        maximumDegrees = 9
        previousVelocityWeight = 0.38
        responseSpan = 0.18
        break
      case '适中':
        sampleWindow = 0.065
        maximumDegrees = 8
        previousVelocityWeight = 0.24
        responseSpan = 0.22
        break
      case '快速':
        sampleWindow = 0.05
        maximumDegrees = 7
        previousVelocityWeight = 0.12
        responseSpan = 0.28
        break
      case '无':
        return 0
    }
    const previous = this.resolvedLocation(time - sampleWindow, motion)
    const older = this.resolvedLocation(time - sampleWindow * 2, motion)
    if (!previous || !older) return 0

    const recentVelocityX = (currentLocation.x - previous.x) / sampleWindow
    const recentVelocityY = (currentLocation.y - previous.y) / sampleWindow
    const previousVelocityX = (previous.x - older.x) / sampleWindow
    const previousVelocityY = (previous.y - older.y) / sampleWindow
    const retainedWeight = previousVelocityWeight
    const velocityX = recentVelocityX * (1 - retainedWeight) + previousVelocityX * retainedWeight
    const velocityY = recentVelocityY * (1 - retainedWeight) + previousVelocityY * retainedWeight
    const speed = Math.hypot(velocityX, velocityY)
    // 强度刻意同时改变响应的两部分（L267-270）。
    const responseGain = Math.max(boundedStrength, 0.25)
    const stationaryThreshold = 0.006 / responseGain
    if (!Number.isFinite(speed) || speed <= stationaryThreshold) return 0

    // 箭头未旋转的尾巴从热点向右下延伸。与反向运动向量的叉积表达尾巴
    // 应在领先端尖后摆动多远。X/Y 等权重是刻意的（L275-279）。
    const inverseSpeed = 1 / Math.max(speed, 0.000_001)
    const trailingTorque = clamp(
      ((velocityX - velocityY) * inverseSpeed) / Math.sqrt(2),
      -1,
      1
    )
    const response = clamp((speed - stationaryThreshold) / (responseSpan / responseGain), 0, 1)
    const smoothResponse = response * response * (3 - 2 * response)
    const lowerIndex = Math.max(this.firstIndexAfter(time) - 1, 0)
    const elapsed = Math.max(time - this.events[lowerIndex].time, 0)
    const idleDecay = clamp(1 - elapsed / 0.18, 0, 1)
    const amplitudeScale = 0.35 + 0.65 * boundedStrength
    const degrees =
      -maximumDegrees * amplitudeScale * smoothResponse * trailingTorque * idleDecay
    return (degrees * Math.PI) / 180
  }

  /** L304-326。 */
  private resolvedLocation(time: TimeInterval, motion: MotionStyle): NormalizedPoint | null {
    const first = this.events[0]
    if (!first || time < first.time) return null
    const upperIndex = this.firstIndexAfter(time)
    const lowerIndex = upperIndex > 0 ? upperIndex - 1 : 0
    const lower = this.events[lowerIndex]
    if (motion.cursor === '平滑') {
      return this.springLocation(time, motion) ?? lower.location
    }
    if (upperIndex < this.events.length && this.events[upperIndex].time > lower.time) {
      return this.interpolatedLocation(lowerIndex, upperIndex, time, motion)
    }
    return lower.location
  }

  // ------------------------------------------------ spring path

  /**
   * L332-369：真正的二阶弹簧。不像对每个 8-16ms 输入区间独立缓动那样
   * 在事件边界把速度归零，它让速度与滞后跨边界保持连续，并在不量化
   * 60Hz 渲染光标的情况下抑制亚像素设备抖动。
   */
  private springLocation(time: TimeInterval, motion: MotionStyle): NormalizedPoint | null {
    const key = springCacheKey(motion)
    const samples = this.springCache.value(key, () =>
      this.makeSpringSamples(motion, () => false) ?? []
    )
    const first = samples[0]
    if (!first) return null
    if (time <= first.time) return first.location
    const last = samples[samples.length - 1]
    if (!last || time >= last.time) return last?.location ?? null

    const upperIndex = binaryUpperBound(samples, time)
    const lowerIndex = Math.max(upperIndex - 1, 0)
    const a = samples[lowerIndex]
    const b = samples[upperIndex]
    const duration = Math.max(b.time - a.time, LEAST_NONZERO)
    const progress = clamp((time - a.time) / duration, 0, 1)
    return {
      x: a.location.x + (b.location.x - a.location.x) * progress,
      y: a.location.y + (b.location.y - a.location.y) * progress,
    }
  }

  /** L379-458：240Hz 弹簧积分 + 连续运动判定 + 点击锚定修正。 */
  private makeSpringSamples(
    motion: MotionStyle,
    cancellationCheck: () => boolean
  ): PointerSpringSample[] | null {
    const first = this.events[0]
    const last = this.events[this.events.length - 1]
    if (!first || !last) return []
    const interval = 1.0 / 240.0
    const mass = Math.max(motion.cursorSpringMass, 0.01)
    const stiffness = Math.max(motion.cursorSpringStiffness, 0.01)
    const damping = Math.max(motion.cursorSpringDamping, 0.01)
    const settleDuration = Math.max(0.65, 6 * Math.sqrt(mass / stiffness))
    const endTime = Math.max(last.time, first.time) + settleDuration
    const jitterThreshold = 0.000_35
    const jitterThresholdSquared = jitterThreshold * jitterThreshold

    let position = first.location
    let velocityX = 0
    let velocityY = 0
    let stableTarget = first.location
    let eventIndex = 1
    let sampleTime = first.time
    const result: PointerSpringSample[] = [{ time: sampleTime, location: position }]
    let iteration = 0

    while (sampleTime < endTime) {
      if (iteration % 1024 === 0 && cancellationCheck()) return null
      const nextTime = Math.min(sampleTime + interval, endTime)
      while (eventIndex < this.events.length && this.events[eventIndex].time <= nextTime) {
        eventIndex += 1
      }
      const lowerIndex = Math.max(eventIndex - 1, 0)
      let target: NormalizedPoint
      if (eventIndex < this.events.length) {
        const lowerEvent = this.events[lowerIndex]
        const upperEvent = this.events[eventIndex]
        const duration = Math.max(upperEvent.time - lowerEvent.time, LEAST_NONZERO)
        if (isContinuousMovement(lowerEvent, upperEvent)) {
          const progress = clamp((nextTime - lowerEvent.time) / duration, 0, 1)
          target = {
            x: lowerEvent.location.x + (upperEvent.location.x - lowerEvent.location.x) * progress,
            y: lowerEvent.location.y + (upperEvent.location.y - lowerEvent.location.y) * progress,
          }
        } else {
          target = lowerEvent.location
        }
      } else {
        target = last.location
      }
      const targetDeltaX = target.x - stableTarget.x
      const targetDeltaY = target.y - stableTarget.y
      if (targetDeltaX * targetDeltaX + targetDeltaY * targetDeltaY >= jitterThresholdSquared) {
        stableTarget = target
      }

      const deltaTime = Math.max(nextTime - sampleTime, 0)
      const accelerationX = (stiffness * (stableTarget.x - position.x) - damping * velocityX) / mass
      const accelerationY = (stiffness * (stableTarget.y - position.y) - damping * velocityY) / mass
      velocityX += accelerationX * deltaTime
      velocityY += accelerationY * deltaTime
      position = {
        x: clamp(position.x + velocityX * deltaTime, 0, 1),
        y: clamp(position.y + velocityY * deltaTime, 0, 1),
      }
      sampleTime = nextTime
      result.push({ time: sampleTime, location: position })
      iteration += 1
    }
    return this.anchoringClicks(result, cancellationCheck)
  }

  // ------------------------------------------------ click anchoring

  /**
   * L466-553：把紧凑修正应用到已平滑的弹簧路径上。支持在相邻点击的
   * 中点处停住，这样一个锚不会把另一个从它的记录点拉开。五次
   * smoother-step 在两端的一阶与二阶导数均为零。
   */
  private anchoringClicks(
    baseSamples: PointerSpringSample[],
    cancellationCheck: () => boolean
  ): PointerSpringSample[] | null {
    const clicks = this.events.filter(
      (event) => event.kind === 'leftClick' || event.kind === 'rightClick'
    )
    if (baseSamples.length === 0 || clicks.length === 0) return baseSamples

    const samples = this.insertingClickSamples(baseSamples, clicks, cancellationCheck)
    if (!samples) return null

    for (let clickIndex = 0; clickIndex < clicks.length; clickIndex += 1) {
      if (cancellationCheck()) return null
      const click = clicks[clickIndex]
      const anchorIndex = exactSampleIndex(click.time, samples)
      if (anchorIndex === null) continue
      const previousClickTime = clickIndex > 0 ? clicks[clickIndex - 1].time : null
      const nextClickTime = clickIndex + 1 < clicks.length ? clicks[clickIndex + 1].time : null
      const supportStart = Math.max(
        samples[0].time,
        Math.max(
          click.time - PointerTrack.CLICK_ANCHOR_LEAD_DURATION,
          previousClickTime !== null ? (previousClickTime + click.time) * 0.5 : -Infinity
        )
      )
      const supportEnd = Math.min(
        samples[samples.length - 1].time,
        Math.min(
          click.time + PointerTrack.CLICK_ANCHOR_TRAIL_DURATION,
          nextClickTime !== null ? (click.time + nextClickTime) * 0.5 : Infinity
        )
      )
      const current = samples[anchorIndex].location
      const correctionX = click.location.x - current.x
      const correctionY = click.location.y - current.y

      const supportStartIndex = firstSampleIndexAtOrAfter(supportStart, samples)
      const supportEndIndex = firstSampleIndexAfter(supportEnd, samples)
      for (let index = supportStartIndex; index < supportEndIndex; index += 1) {
        const sampleTime = samples[index].time
        let weight: number
        if (sampleTime <= click.time) {
          const duration = click.time - supportStart
          const progress = duration > 0 ? (sampleTime - supportStart) / duration : 1
          weight = smootherStep(progress)
        } else {
          const duration = supportEnd - click.time
          const progress = duration > 0 ? (sampleTime - click.time) / duration : 1
          weight = 1 - smootherStep(progress)
        }
        samples[index] = {
          time: sampleTime,
          location: {
            x: clamp(samples[index].location.x + correctionX * weight, 0, 1),
            y: clamp(samples[index].location.y + correctionY * weight, 0, 1),
          },
        }
      }
      // 避免在语义锚点本身累积浮点插值误差（L545-550）。
      samples[anchorIndex] = { time: click.time, location: click.location }
    }
    return samples
  }

  /** L555-603：一次遍历把语义点击时间戳并入 240Hz 网格。 */
  private insertingClickSamples(
    baseSamples: PointerSpringSample[],
    clicks: PointerEventRecord[],
    cancellationCheck: () => boolean
  ): PointerSpringSample[] | null {
    if (baseSamples.length <= 1) return baseSamples
    const result: PointerSpringSample[] = []
    let baseIndex = 0

    for (let clickIndex = 0; clickIndex < clicks.length; clickIndex += 1) {
      if (clickIndex % 256 === 0 && cancellationCheck()) return null
      const click = clicks[clickIndex]
      if (
        click.time < baseSamples[0].time ||
        click.time > baseSamples[baseSamples.length - 1].time
      ) {
        continue
      }
      while (baseIndex < baseSamples.length && baseSamples[baseIndex].time < click.time - 0.000_000_1) {
        result.push(baseSamples[baseIndex])
        baseIndex += 1
      }
      if (
        baseIndex < baseSamples.length &&
        Math.abs(baseSamples[baseIndex].time - click.time) <= 0.000_000_1
      ) {
        const lastSample = result[result.length - 1]
        if (!lastSample || lastSample.time !== baseSamples[baseIndex].time) {
          result.push(baseSamples[baseIndex])
        }
        baseIndex += 1
        continue
      }
      const before = result[result.length - 1]
      if (!before || baseIndex >= baseSamples.length) continue
      if (Math.abs(before.time - click.time) <= 0.000_000_1) continue
      const after = baseSamples[baseIndex]
      const duration = Math.max(after.time - before.time, LEAST_NONZERO)
      const progress = clamp((click.time - before.time) / duration, 0, 1)
      result.push({
        time: click.time,
        location: {
          x: before.location.x + (after.location.x - before.location.x) * progress,
          y: before.location.y + (after.location.y - before.location.y) * progress,
        },
      })
    }
    for (let index = baseIndex; index < baseSamples.length; index += 1) {
      result.push(baseSamples[index])
    }
    return result
  }

  // ------------------------------------------------ Hermite / PCHIP 插值

  /**
   * L669-730：时间感知三次 Hermite 插值。每个结点共享一个速度，因此
   * 相邻区间 C1 连续，且每个记录位置在其真实时间戳被精确到达。
   */
  private interpolatedLocation(
    lowerIndex: number,
    upperIndex: number,
    time: TimeInterval,
    motion: MotionStyle
  ): NormalizedPoint {
    const lower = this.events[lowerIndex]
    const upper = this.events[upperIndex]
    const duration = upper.time - lower.time
    if (!(duration > 0)) return lower.location
    if (!isContinuousMovement(lower, upper)) return lower.location
    const progress = clamp((time - lower.time) / duration, 0, 1)
    if (motion.cursor === '无') {
      return {
        x: lower.location.x + (upper.location.x - lower.location.x) * progress,
        y: lower.location.y + (upper.location.y - lower.location.y) * progress,
      }
    }
    let tangentScale: number
    switch (motion.cursor as CursorMotionStyle) {
      case '平滑': {
        const mass = Math.max(motion.cursorSpringMass, 0.01)
        const stiffness = Math.max(motion.cursorSpringStiffness, 0.01)
        const damping = Math.max(motion.cursorSpringDamping, 0.01)
        const naturalFrequency = Math.sqrt(stiffness / mass)
        const decayRate = damping / (2 * mass)
        const responsiveness = naturalFrequency / (naturalFrequency + decayRate)
        tangentScale = clamp(0.25 + 1.1 * responsiveness, 0.25, 1.2)
        break
      }
      case '适中':
        tangentScale = 0.78
        break
      case '快速':
        tangentScale = 1
        break
      case '无':
        tangentScale = 1
        break
    }
    const lowerTangent = this.tangent(lowerIndex)
    const upperTangent = this.tangent(upperIndex)
    const t2 = progress * progress
    const t3 = t2 * progress
    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + progress
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2
    return {
      x: clamp(
        h00 * lower.location.x +
          h10 * duration * lowerTangent.x * tangentScale +
          h01 * upper.location.x +
          h11 * duration * upperTangent.x * tangentScale,
        0,
        1
      ),
      y: clamp(
        h00 * lower.location.y +
          h10 * duration * lowerTangent.y * tangentScale +
          h01 * upper.location.y +
          h11 * duration * upperTangent.y * tangentScale,
        0,
        1
      ),
    }
  }

  /** L732-768：结点切向（含边界单侧情形）。 */
  private tangent(index: number): NormalizedPoint {
    const current = this.events[index]
    let previous = index - 1
    while (previous >= 0 && this.events[previous].time >= current.time) {
      previous -= 1
    }
    let next = index + 1
    while (next < this.events.length && this.events[next].time <= current.time) {
      next += 1
    }
    if (previous >= 0 && next < this.events.length) {
      return monotoneTangent(this.events[previous], current, this.events[next])
    }
    if (next < this.events.length) {
      const duration = this.events[next].time - current.time
      if (!(duration > 0)) return { x: 0, y: 0 }
      return {
        x: (this.events[next].location.x - current.location.x) / duration,
        y: (this.events[next].location.y - current.location.y) / duration,
      }
    }
    if (previous >= 0) {
      const duration = current.time - this.events[previous].time
      if (!(duration > 0)) return { x: 0, y: 0 }
      return {
        x: (current.location.x - this.events[previous].location.x) / duration,
        y: (current.location.y - this.events[previous].location.y) / duration,
      }
    }
    return { x: 0, y: 0 }
  }

  // ------------------------------------------------ helpers

  /** L822-834：first index with events[i].time > time。 */
  private firstIndexAfter(time: TimeInterval): number {
    let lower = 0
    let upper = this.events.length
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2)
      if (this.events[middle].time <= time) {
        lower = middle + 1
      } else {
        upper = middle
      }
    }
    return lower
  }

  /**
   * L853-863：events(from:through:) —— 两次二分查找返回窗口内事件切片，
   * 让自动运镜规划不必为每个短缩放片段复制过滤整段长录制。
   */
  eventsBetween(start: TimeInterval, end: TimeInterval): PointerEventRecord[] {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
    const lower = firstEventIndexAtOrAfter(start, this.events)
    const upper = this.firstIndexAfter(end)
    return this.events.slice(lower, upper)
  }

  /** L869-882：mostRecentClick(from:through:)。 */
  private mostRecentClick(start: TimeInterval, end: TimeInterval): PointerEventRecord | null {
    let index = firstEventIndexAtOrAfter(start, this.events)
    let latest: PointerEventRecord | null = null
    while (index < this.events.length && this.events[index].time <= end) {
      const kind = this.events[index].kind
      if (kind === 'leftClick' || kind === 'rightClick') {
        latest = this.events[index]
      }
      index += 1
    }
    return latest
  }
}

// ---------------------------------------------------------------- 文件级助手

/** Swift Double.leastNonzeroMagnitude ≈ 5e-324；JS 用最小正规数近似即可。 */
const LEAST_NONZERO = Number.MIN_VALUE

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(Math.max(value, lower), upper)
}

/** Swift smootherStep（L658-661）。 */
export function smootherStep(value: number): number {
  const t = clamp(value, 0, 1)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** Swift isContinuousMovement(from:to:)（L770-782）。常量见 PointerTrack L72-78。 */
export function isContinuousMovement(
  lower: PointerEventRecord,
  upper: PointerEventRecord
): boolean {
  const duration = upper.time - lower.time
  if (!(duration > 0)) return false
  if (duration <= 0.12) return true // MAXIMUM_CONTINUOUS_INPUT_GAP
  if (duration > 0.5) return false // MAXIMUM_SLOW_MOVE_GAP
  const deltaX = upper.location.x - lower.location.x
  const deltaY = upper.location.y - lower.location.y
  return deltaX * deltaX + deltaY * deltaY <= 0.03 * 0.03 // MAXIMUM_SLOW_MOVE_DISTANCE
}

/** Swift monotoneTangent(previous:current:next:)（L790-820）。 */
export function monotoneTangent(
  previous: PointerEventRecord,
  current: PointerEventRecord,
  next: PointerEventRecord
): NormalizedPoint {
  const previousDuration = current.time - previous.time
  const nextDuration = next.time - current.time
  if (!(previousDuration > 0) || !(nextDuration > 0)) return { x: 0, y: 0 }

  function axis(previousValue: number, value: number, nextValue: number): number {
    const previousSlope = (value - previousValue) / previousDuration
    const nextSlope = (nextValue - value) / nextDuration
    if (
      !Number.isFinite(previousSlope) ||
      !Number.isFinite(nextSlope) ||
      previousSlope * nextSlope <= 0
    ) {
      return 0
    }
    const firstWeight = 2 * nextDuration + previousDuration
    const secondWeight = nextDuration + 2 * previousDuration
    const denominator = firstWeight / previousSlope + secondWeight / nextSlope
    if (!Number.isFinite(denominator) || Math.abs(denominator) <= LEAST_NONZERO) {
      return 0
    }
    return (firstWeight + secondWeight) / denominator
  }

  return {
    x: axis(previous.location.x, current.location.x, next.location.x),
    y: axis(previous.location.y, current.location.y, next.location.y),
  }
}

/** L605-622：exactSampleIndex(at:in:)。 */
function exactSampleIndex(time: TimeInterval, samples: PointerSpringSample[]): number | null {
  let lower = 0
  let upper = samples.length
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2)
    if (samples[middle].time < time) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }
  if (lower >= samples.length || Math.abs(samples[lower].time - time) > 0.000_000_1) {
    return null
  }
  return lower
}

/** L624-639：firstSampleIndex(atOrAfter:in:)。 */
function firstSampleIndexAtOrAfter(time: TimeInterval, samples: PointerSpringSample[]): number {
  let lower = 0
  let upper = samples.length
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2)
    if (samples[middle].time < time) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }
  return lower
}

/** L641-656：firstSampleIndex(after:in:)。 */
function firstSampleIndexAfter(time: TimeInterval, samples: PointerSpringSample[]): number {
  let lower = 0
  let upper = samples.length
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2)
    if (samples[middle].time <= time) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }
  return lower
}

/** 样本数组二分：第一个 time > 给定时间 的下标。 */
function binaryUpperBound(samples: PointerSpringSample[], time: TimeInterval): number {
  return firstSampleIndexAfter(time, samples)
}

/** 逐元素比较指针事件数组（Swift Equatable 语义，字段级）。 */
function pointerEventsEqual(a: PointerEventRecord[], b: PointerEventRecord[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (x.time !== y.time || x.kind !== y.kind) return false
    if (x.location.x !== y.location.x || x.location.y !== y.location.y) return false
    if (x.modifiers.length !== y.modifiers.length) return false
    for (let j = 0; j < x.modifiers.length; j += 1) {
      if (x.modifiers[j] !== y.modifiers[j]) return false
    }
    if ((x.cursorAssetID ?? null) !== (y.cursorAssetID ?? null)) return false
  }
  return true
}

// ---------------------------------------------------------------- 门面

/** Swift MotionStyle() 默认构造。 */
function defaultMotion(): MotionStyle {
  return makeMotionStyle()
}

/** Swift CursorStyle() 默认构造。 */
function defaultCursorStyle(): CursorStyle {
  return makeCursorStyle()
}

/**
 * Swift PointerInterpolator（L885-894）：无状态门面。
 */
export const PointerInterpolator = {
  sample(
    events: PointerEventRecord[],
    time: TimeInterval,
    motion: MotionStyle = makeMotionStyle(),
    style: CursorStyle = makeCursorStyle()
  ): PointerSample | null {
    return new PointerTrack(events).sample(time, motion, style)
  },
}
