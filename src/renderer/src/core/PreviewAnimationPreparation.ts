/**
 * 预览动画的采样与预热 —— Swift PreviewAnimationPreparation.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/PreviewAnimationPreparation.swift（79 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - PreviewAnimationCadence.sampleTime（60fps 量化）        L6-13
 *   - intervals(using:)：开场 + 缩放 + 屏幕/镜头运动 + 马赛克/贴图  L23-51
 *   - prewarmTimes(around:using:)：可见窗口筛选 + 两个采样点    L56-78
 *   - 结果去重、升序、最多 4 个                                L77
 *
 * 原注释：**暂停与导出路径故意不做量化** —— 它们按精确时间求值，只有原生显示循环
 * 与它的 CPU 计划缓存共用这套 60fps 栅格。
 */

export const PREVIEW_ANIMATION_FRAMES_PER_SECOND = 60

/** 单帧时长（1/60）。入口偏移的下限就用它。 */
export const PREVIEW_ANIMATION_FRAME_DURATION = 1 / PREVIEW_ANIMATION_FRAMES_PER_SECOND

/** Swift L9-12：非有限值归 0、负数归 0，然后**四舍五入**到最近的 1/60。 */
export function previewAnimationSampleTime(time: number): number {
  const safe = Number.isFinite(time) ? Math.max(time, 0) : 0
  return Math.round(safe * PREVIEW_ANIMATION_FRAMES_PER_SECOND) / PREVIEW_ANIMATION_FRAMES_PER_SECOND
}

export interface PreviewAnimationInterval {
  readonly start: number
  readonly end: number
  readonly entryDuration: number
  /** 开场序列（会额外采一个 82% 处的时间点）。 */
  readonly isOpening: boolean
}

/** 各类动画的最小输入（与 CanvasPlaybackEvaluationContext 的字段一一对应）。 */
export interface PreviewAnimationEvaluation {
  readonly outputDuration: number
  readonly opening: { readonly isEnabled: boolean; readonly duration: number }
  readonly zoomAnimations: readonly { readonly startTime: number; readonly effectEndTime: number }[]
  readonly screenMotionClips: readonly {
    readonly startTime: number
    readonly effectEndTime: number
    readonly leadInDuration: number
  }[]
  readonly cameraMotionClips: readonly {
    readonly startTime: number
    readonly effectEndTime: number
    readonly leadInDuration: number
  }[]
  readonly mosaicClips: readonly {
    readonly startTime: number
    readonly endTime: number
    readonly transitionInDuration: number
  }[]
  readonly stickerClips: readonly {
    readonly startTime: number
    readonly endTime: number
    readonly enterDuration: number
  }[]
}

/** 缩放进入段上限：`min(时长, 0.6)`。 */
export const PREVIEW_ZOOM_ENTRY_MAXIMUM = 0.6

/** Swift `interval` 的收集顺序：开场 → 缩放 → 屏幕运动 → 镜头运动 → 马赛克 → 贴图。 */
export function previewAnimationIntervals(
  evaluation: PreviewAnimationEvaluation
): readonly PreviewAnimationInterval[] {
  const result: PreviewAnimationInterval[] = []
  if (evaluation.opening.isEnabled) {
    result.push({
      start: 0,
      end: evaluation.opening.duration,
      entryDuration: evaluation.opening.duration,
      isOpening: true,
    })
  }
  for (const animation of evaluation.zoomAnimations) {
    result.push({
      start: animation.startTime,
      end: animation.effectEndTime,
      entryDuration: Math.min(animation.effectEndTime - animation.startTime, PREVIEW_ZOOM_ENTRY_MAXIMUM),
      isOpening: false,
    })
  }
  for (const clip of [...evaluation.screenMotionClips, ...evaluation.cameraMotionClips]) {
    result.push({
      start: clip.startTime,
      end: clip.effectEndTime,
      entryDuration: clip.leadInDuration,
      isOpening: false,
    })
  }
  for (const clip of evaluation.mosaicClips) {
    result.push({
      start: clip.startTime,
      end: clip.endTime,
      entryDuration: clip.transitionInDuration,
      isOpening: false,
    })
  }
  for (const clip of evaluation.stickerClips) {
    result.push({
      start: clip.startTime,
      end: clip.endTime,
      entryDuration: clip.enterDuration,
      isOpening: false,
    })
  }
  return result
}

/** 预热最多取 4 个时间点（每个点都是一次完整工程求值，代价不低）。 */
export const PREVIEW_PREWARM_CAPACITY = 4

/**
 * Swift `prewarmTimes(around:using:)`。
 *
 * 只取「还没结束（`end > now`）且已经进入 8 秒视野（`start <= horizon`）」的区间，
 * 每个区间取一个点：`start + max(min(entry×0.5, 区间半长), 1/60)`，夹到 `[now, end-0.001]`；
 * 开场额外取 82% 处 —— 那时错峰出场的摄像头/贴图都已就位。
 */
export function previewPrewarmTimes(around: number, evaluation: PreviewAnimationEvaluation): readonly number[] {
  const now = Math.min(Math.max(Number.isFinite(around) ? around : 0, 0), evaluation.outputDuration)
  const horizon = Math.min(now + 8, evaluation.outputDuration)
  const times: number[] = []
  const candidates = previewAnimationIntervals(evaluation)
    .filter((interval) => interval.end > now && interval.start <= horizon)
    .sort((a, b) => a.start - b.start)

  for (const interval of candidates) {
    const end = Math.min(interval.end, evaluation.outputDuration)
    const remainingStart = Math.max(now, interval.start)
    if (!(end > remainingStart)) continue
    const offset = Math.max(
      Math.min(interval.entryDuration * 0.5, (end - interval.start) * 0.5),
      PREVIEW_ANIMATION_FRAME_DURATION
    )
    times.push(Math.min(Math.max(now, interval.start + offset), end - 0.001))
    if (interval.isOpening) {
      times.push(
        Math.min(Math.max(now, interval.start + (end - interval.start) * 0.82), end - 0.001)
      )
    }
  }

  const unique = [...new Set(times.filter((time) => time >= 0 && time <= horizon))]
  return unique.sort((a, b) => a - b).slice(0, PREVIEW_PREWARM_CAPACITY)
}
