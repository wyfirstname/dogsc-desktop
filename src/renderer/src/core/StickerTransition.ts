/**
 * StickerTransition —— 贴图入场/出场、相邻贴图桥接与背景处理合并。
 *
 * Swift source: Sources/RecorderCore/StickerTransition.swift @ laogou717/dogsc 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct FrameStickerBackdropScene                      L6-50   → FrameStickerBackdropScene
 *   - struct StickerTransitionTrack（Entry/Endpoint/Join/BackdropBridge/Sample）
 *                                                          L56-266 → StickerTransitionTrack
 *
 * 背景处理与两张图各自的动画不透明度无关：接力期间「隐藏屏幕」的贴图必须
 * 始终维持抑制，即使两张图都半透明或正移出画布。相邻判定只承认数值端点
 * 噪声，绝不把「差一帧」当成相接。
 */

import type { NormalizedPoint, TimeInterval } from './ZoomAnimation'
import { elementMotionProgress, type ElementMotionCurve } from './ElementMotion'
import {
  overlayContains,
  overlayEndTime,
  stickerAutomaticExit,
  type StickerAnimationPreset,
  type StickerClip,
} from './OverlayTimeline'
import type { FrameStickerScene } from './FrameScene'

const ENDPOINT_TOLERANCE = 0.000_000_1

/** Swift FrameStickerBackdropScene（L6-50）。 */
export class FrameStickerBackdropScene {
  screenSuppression = 0
  cameraSuppression = 0
  screenBlur = 0
  cameraBlur = 0

  /** Swift init(stickers:)（L14-23）：把一组贴图的最大处理合并起来。 */
  static fromStickers(stickers: readonly FrameStickerScene[]): FrameStickerBackdropScene {
    const result = new FrameStickerBackdropScene()
    for (const sticker of stickers) {
      const treatment = new FrameStickerBackdropScene()
      treatment.screenSuppression = sticker.hidesScreen ? sticker.transitionProgress : 0
      treatment.cameraSuppression = sticker.hidesCamera ? sticker.transitionProgress : 0
      treatment.screenBlur = sticker.hidesScreen ? 0 : sticker.backdropBlur
      treatment.cameraBlur = sticker.backdropBlurIncludesCamera ? sticker.backdropBlur : 0
      result.merge(treatment)
    }
    return result
  }

  /** Swift init(clip:visibility:)（L25-31）。 */
  static fromClip(clip: StickerClip, visibility: number): FrameStickerBackdropScene {
    const result = new FrameStickerBackdropScene()
    result.screenSuppression = clip.hidesScreen ? visibility : 0
    result.cameraSuppression = clip.hidesCamera ? visibility : 0
    result.screenBlur = clip.hidesScreen ? 0 : Math.max(clip.backdropBlur, 0) * visibility
    result.cameraBlur = clip.backdropBlurIncludesCamera
      ? Math.max(clip.backdropBlur, 0) * visibility
      : 0
    return result
  }

  /** Swift mutating merge(_:)（L33-38）：逐项取最大。 */
  merge(other: FrameStickerBackdropScene): this {
    this.screenSuppression = Math.max(this.screenSuppression, other.screenSuppression)
    this.cameraSuppression = Math.max(this.cameraSuppression, other.cameraSuppression)
    this.screenBlur = Math.max(this.screenBlur, other.screenBlur)
    this.cameraBlur = Math.max(this.cameraBlur, other.cameraBlur)
    return this
  }

  /** Swift interpolated(to:progress:)（L40-49）。 */
  interpolated(to: FrameStickerBackdropScene, progress: number): FrameStickerBackdropScene {
    const result = new FrameStickerBackdropScene()
    result.screenSuppression =
      this.screenSuppression + (to.screenSuppression - this.screenSuppression) * progress
    result.cameraSuppression =
      this.cameraSuppression + (to.cameraSuppression - this.cameraSuppression) * progress
    result.screenBlur = this.screenBlur + (to.screenBlur - this.screenBlur) * progress
    result.cameraBlur = this.cameraBlur + (to.cameraBlur - this.cameraBlur) * progress
    return result
  }

  /** Swift Equatable：四个分量全部相等。 */
  equals(other: FrameStickerBackdropScene): boolean {
    return (
      this.screenSuppression === other.screenSuppression &&
      this.cameraSuppression === other.cameraSuppression &&
      this.screenBlur === other.screenBlur &&
      this.cameraBlur === other.cameraBlur
    )
  }

  isZero(): boolean {
    return (
      this.screenSuppression === 0 &&
      this.cameraSuppression === 0 &&
      this.screenBlur === 0 &&
      this.cameraBlur === 0
    )
  }
}

/** Swift StickerTransitionTrack.Sample（L115-120）。 */
export interface StickerTransitionSample {
  clip: StickerClip
  visibility: number
  preset: StickerAnimationPreset
  progress: number
}

interface Entry {
  clip: StickerClip
  enterDuration: TimeInterval
  exitDuration: TimeInterval
  entryJoin: number | null
  exitJoin: number | null
}

interface Endpoint {
  time: TimeInterval
  index: number
  isStart: boolean
}

class Join {
  constructor(
    readonly start: TimeInterval,
    readonly end: TimeInterval,
    readonly outgoingBackdrop: FrameStickerBackdropScene,
    readonly incomingBackdrop: FrameStickerBackdropScene,
    readonly curve: ElementMotionCurve
  ) {}

  contains(time: TimeInterval): boolean {
    return time >= this.start && time < this.end
  }

  progress(time: TimeInterval): number {
    if (!(this.end > this.start)) return time >= this.end ? 1 : 0
    return Math.min(Math.max((time - this.start) / (this.end - this.start), 0), 1)
  }
}

class BackdropBridge {
  constructor(
    readonly start: TimeInterval,
    readonly end: TimeInterval,
    readonly treatment: FrameStickerBackdropScene
  ) {}

  contains(time: TimeInterval): boolean {
    return time >= this.start && time < this.end
  }
}

function makeEntry(clip: StickerClip): Entry {
  const enter = Math.max(clip.enterDuration, 0)
  const exit = Math.max(clip.exitDuration, 0)
  const total = enter + exit
  const duration = clip.timing.duration
  const scale = total > duration && total > 0 ? duration / total : 1
  return {
    clip,
    enterDuration: enter * scale,
    exitDuration: exit * scale,
    entryJoin: null,
    exitJoin: null,
  }
}

/** 入场侧预算：无动画则不占桥接时间。 */
function joinEnterDuration(entry: Entry): TimeInterval {
  return entry.clip.animation === 'none' ? 0 : entry.enterDuration
}

/** 出场侧预算：显式出场或 animation 的反向出场。 */
function joinExitDuration(entry: Entry): TimeInterval {
  const exitPreset = entry.clip.exitAnimation ?? stickerAutomaticExit(entry.clip.animation)
  return exitPreset === 'none' ? 0 : entry.exitDuration
}

/**
 * Swift StickerTransitionTrack（L56-266）。每次贴图编辑后准备一次，
 * 暂停预览、播放与导出共用同一份结果。
 */
export class StickerTransitionTrack {
  private readonly entries: Entry[]
  private readonly joins: Join[] = []
  private readonly backdropBridges: BackdropBridge[] = []

  constructor(clips: readonly StickerClip[]) {
    this.entries = clips
      .filter(
        (clip) =>
          Number.isFinite(clip.timing.startTime) &&
          Number.isFinite(clip.timing.duration) &&
          clip.timing.duration > 0
      )
      .slice()
      .sort((lhs, rhs) => {
        if (lhs.layerIndex === rhs.layerIndex) {
          return lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0
        }
        return lhs.layerIndex - rhs.layerIndex
      })
      .map(makeEntry)

    const endpoints: Endpoint[] = []
    this.entries.forEach((entry, index) => {
      endpoints.push({ time: entry.clip.timing.startTime, index, isStart: true })
      endpoints.push({ time: overlayEndTime(entry.clip.timing), index, isStart: false })
    })
    endpoints.sort((lhs, rhs) => lhs.time - rhs.time)

    let cursor = 0
    while (cursor < endpoints.length) {
      const boundary = endpoints[cursor].time
      const outgoing: number[] = []
      const incoming: number[] = []
      do {
        const endpoint = endpoints[cursor]
        if (endpoint.isStart) incoming.push(endpoint.index)
        else outgoing.push(endpoint.index)
        cursor += 1
      } while (
        cursor < endpoints.length &&
        endpoints[cursor].time - boundary <= ENDPOINT_TOLERANCE
      )
      // 极短的贴图不得把自己的起点和终点连起来。
      const shared = new Set(outgoing.filter((index) => incoming.includes(index)))
      const outgoingFiltered = outgoing.filter((index) => !shared.has(index))
      const incomingFiltered = incoming.filter((index) => !shared.has(index))
      if (outgoingFiltered.length === 0 || incomingFiltered.length === 0) continue

      // 两侧都留在各参与者分配到的过渡预算内：短中间贴图或同时多层时，
      // 相邻接力不会互相重叠。
      const before = Math.min(
        ...outgoingFiltered.map((index) => joinExitDuration(this.entries[index]))
      )
      const after = Math.min(
        ...incomingFiltered.map((index) => joinEnterDuration(this.entries[index]))
      )
      const outgoingBackdrop = new FrameStickerBackdropScene()
      const incomingBackdrop = new FrameStickerBackdropScene()
      for (const index of outgoingFiltered) {
        outgoingBackdrop.merge(
          FrameStickerBackdropScene.fromClip(this.entries[index].clip, 1)
        )
      }
      for (const index of incomingFiltered) {
        incomingBackdrop.merge(
          FrameStickerBackdropScene.fromClip(this.entries[index].clip, 1)
        )
      }
      const joinIndex = this.joins.length
      const outgoingEnd = Math.min(
        ...outgoingFiltered.map((index) => overlayEndTime(this.entries[index].clip.timing))
      )
      const incomingStart = Math.max(
        ...incomingFiltered.map((index) => this.entries[index].clip.timing.startTime)
      )
      // Swift 用 `entries[incoming.max()]` 取排序后的最后一位（层序最高者）。
      const curveSource = this.entries[incomingFiltered[incomingFiltered.length - 1]]
      this.joins.push(
        new Join(
          outgoingEnd - before,
          incomingStart + after,
          outgoingBackdrop,
          incomingBackdrop,
          curveSource.clip.animationCurve
        )
      )
      for (const index of outgoingFiltered) this.entries[index].exitJoin = joinIndex
      for (const index of incomingFiltered) this.entries[index].entryJoin = joinIndex
    }

    // 短重叠可能让两张贴图各自处在独立淡入淡出中，此时只取 max(visibility)
    // 会短暂露出录制画面。这里在出场起点到入场稳定之间维持两者共享的处理
    // 强度；与「相接」不同，它不重排时间也不改变层序。
    const ordered = this.entries
      .map((_, index) => index)
      .sort((lhs, rhs) => {
        const a = this.entries[lhs].clip.timing
        const b = this.entries[rhs].clip.timing
        return a.startTime === b.startTime ? a.duration - b.duration : a.startTime - b.startTime
      })

    ordered.forEach((outgoingIndex, offset) => {
      const outgoing = this.entries[outgoingIndex]
      const outgoingEnd = overlayEndTime(outgoing.clip.timing)
      for (const incomingIndex of ordered.slice(offset + 1)) {
        const incoming = this.entries[incomingIndex]
        if (
          !(
            incoming.clip.timing.startTime <
            outgoingEnd - ENDPOINT_TOLERANCE
          )
        ) {
          break
        }
        // 被包含的贴图不替换包住它的贴图。
        if (!(overlayEndTime(incoming.clip.timing) > outgoingEnd)) continue
        const start = outgoingEnd - joinExitDuration(outgoing)
        const end = incoming.clip.timing.startTime + joinEnterDuration(incoming)
        if (!(end > start)) continue
        const from = FrameStickerBackdropScene.fromClip(outgoing.clip, 1)
        const to = FrameStickerBackdropScene.fromClip(incoming.clip, 1)
        const treatment = new FrameStickerBackdropScene()
        treatment.screenSuppression = Math.min(from.screenSuppression, to.screenSuppression)
        treatment.cameraSuppression = Math.min(from.cameraSuppression, to.cameraSuppression)
        treatment.screenBlur = Math.min(from.screenBlur, to.screenBlur)
        treatment.cameraBlur = Math.min(from.cameraBlur, to.cameraBlur)
        if (!treatment.isZero()) {
          this.backdropBridges.push(new BackdropBridge(start, end, treatment))
        }
      }
    })
  }

  /** Swift hasJoinedEntry(_:)（L214-216）。 */
  hasJoinedEntry(id: string): boolean {
    return this.entries.some((entry) => entry.clip.id === id && entry.entryJoin !== null)
  }

  /**
   * Swift sample(at:suppressesInitialEntry:)（L218-265）。
   * `suppressesInitialEntry` 用于开场序列接管贴图入场时不重复播一次。
   */
  sample(
    time: TimeInterval,
    suppressesInitialEntry = false
  ): { stickers: StickerTransitionSample[]; backdrop: FrameStickerBackdropScene } {
    const backdrop = new FrameStickerBackdropScene()
    for (const bridge of this.backdropBridges) {
      if (bridge.contains(time)) backdrop.merge(bridge.treatment)
    }
    for (const join of this.joins) {
      if (!join.contains(time)) continue
      backdrop.merge(
        join.outgoingBackdrop.interpolated(
          join.incomingBackdrop,
          elementMotionProgress(join.progress(time), join.curve)
        )
      )
    }

    const stickers: StickerTransitionSample[] = []
    for (const entry of this.entries) {
      const clip = entry.clip
      const entryJoin = entry.entryJoin === null ? null : this.joins[entry.entryJoin]
      const exitJoin = entry.exitJoin === null ? null : this.joins[entry.exitJoin]
      const joinedEntryIsActive = entryJoin?.contains(time) ?? false
      const joinedExitIsActive = exitJoin?.contains(time) ?? false
      if (!overlayContains(clip.timing, time) && !joinedEntryIsActive && !joinedExitIsActive) {
        continue
      }
      const localTime = Math.max(time - clip.timing.startTime, 0)
      const remaining = Math.max(overlayEndTime(clip.timing) - time, 0)
      const suppressesEntry = suppressesInitialEntry && clip.timing.startTime <= 0.000_1
      const linearEnter =
        entryJoin?.progress(time) ??
        (suppressesEntry
          ? 1
          : entry.enterDuration > 0
            ? Math.min(localTime / entry.enterDuration, 1)
            : 1)
      const linearExit =
        exitJoin !== null
          ? 1 - exitJoin.progress(time)
          : entry.exitDuration > 0
            ? Math.min(remaining / entry.exitDuration, 1)
            : 1
      const enterProgress = elementMotionProgress(linearEnter, clip.animationCurve)
      const exitProgress = elementMotionProgress(linearExit, clip.animationCurve)
      const exitPreset = clip.exitAnimation ?? stickerAutomaticExit(clip.animation)
      const visibility = Math.min(
        clip.animation === 'none' ? 1 : enterProgress,
        exitPreset === 'none' ? 1 : exitProgress
      )
      const isExiting =
        exitJoin !== null
          ? time >= exitJoin.start
          : entry.exitDuration > 0 && remaining < entry.exitDuration
      if (!joinedEntryIsActive && !joinedExitIsActive) {
        backdrop.merge(FrameStickerBackdropScene.fromClip(clip, visibility))
      }
      stickers.push({
        clip,
        visibility,
        preset: isExiting ? exitPreset : clip.animation,
        progress: isExiting ? exitProgress : enterProgress,
      })
    }
    return { stickers, backdrop }
  }
}

/** 供 FrameScene 复用的贴图变换结果。 */
export interface StickerTransitionTransform {
  scale: number
  offset: NormalizedPoint
}
