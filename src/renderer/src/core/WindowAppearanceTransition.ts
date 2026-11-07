/**
 * Swift source: Sources/DogSCApp/WindowAppearanceTransition.swift（101 行）@ 567fd6e
 *
 * L8-25  → apply：只在「真的会变 + 应用在前台 + 窗口可见 + 未最小化 +
 *           未被遮挡 + 未开启减少动态」时才淡化，否则直接赋值
 * L32-52 → crossfade：冻结快照盖住窗口 → 应用变更 → 两拍后淡出快照
 * L59-101→ WindowSnapshotView：优先取窗口服务器已合成的像素（含 Metal 画布），
 *           失败才回退到主线程重绘，且永不接收点击
 *
 * 原注释：只给 SwiftUI 颜色做动画会漏掉原生滚动视图与 NSColor 控件 —— 所以这里
 * 淡化的是**整块窗口表面**。
 */

/** 外观切换的淡化时长（Swift L22 `duration: 0.34`）。 */
export const APPEARANCE_CROSSFADE_DURATION = 0.34

/** 通用 crossfade 的默认时长（Swift L32 `duration: 0.26`）。 */
export const WINDOW_CROSSFADE_DURATION = 0.26

/** 快照淡出前的两拍延迟（Swift L43 `+ 0.05`）。 */
export const SNAPSHOT_FADE_DELAY = 0.05

/** 淡化曲线控制点（Swift L46 `CAMediaTimingFunction(controlPoints: 0.4, 0, 0.2, 1)`）。 */
export const CROSSFADE_TIMING = [0.4, 0, 0.2, 1] as const

/** 快照要求的最小边长；窗口小于它直接放弃快照走直接变更（Swift L62）。 */
export const SNAPSHOT_MINIMUM_SIDE = 1

export interface AppearanceTransitionInput {
  readonly previousAppearance: 'dark' | 'light'
  readonly nextAppearance: 'dark' | 'light'
  readonly applicationActive: boolean
  readonly applicationHidden: boolean
  readonly windowVisible: boolean
  readonly windowMiniaturized: boolean
  /** 窗口是否未被完全遮挡（`occlusionState.contains(.visible)`）。 */
  readonly windowOccluded: boolean
  readonly reduceMotion: boolean
}

export interface AppearanceTransitionPlan {
  readonly animate: boolean
  readonly duration: number
  /** 无论动画与否，外观本身都要写上。 */
  readonly applyAppearance: true
}

/**
 * 外观切换计划（Swift L12-20）。
 *
 * 只要有一条不满足就**直接赋值**：窗口被遮挡时做动画等于让 GPU 白跑 0.34 秒，
 * 用户切回来只会看到「已经变完了」，没有任何收益。
 */
export function appearanceTransitionPlan(
  input: AppearanceTransitionInput
): AppearanceTransitionPlan {
  const changed = input.previousAppearance !== input.nextAppearance
  const animate =
    changed &&
    input.applicationActive &&
    !input.applicationHidden &&
    input.windowVisible &&
    !input.windowMiniaturized &&
    !input.windowOccluded &&
    !input.reduceMotion
  return {
    animate,
    duration: animate ? APPEARANCE_CROSSFADE_DURATION : 0,
    applyAppearance: true,
  }
}

export interface CrossfadeInput {
  readonly hasWindow: boolean
  readonly hasContentView: boolean
  readonly windowVisible: boolean
  readonly windowOccluded: boolean
  readonly reduceMotion: boolean
  readonly boundsWidth: number
  readonly boundsHeight: number
  /** 窗口服务器像素是否取到（取不到就要回退主线程重绘）。 */
  readonly windowServerImageAvailable: boolean
  /** 回退路径是否能生成位图 representation。 */
  readonly bitmapRepresentationAvailable: boolean
}

export type CrossfadeMode = 'directChange' | 'snapshotWindowServer' | 'snapshotRedraw'

export interface CrossfadePlan {
  readonly mode: CrossfadeMode
  readonly delay: number
  readonly duration: number
  readonly timing: readonly [number, number, number, number]
}

/**
 * crossfade 计划（Swift L33-39 / L59-77）。
 *
 * 四种「不做快照」的情形都直接改：没有窗口、不可见、被遮挡、开了减少动态。
 * 剩下两种快照来源里，窗口服务器像素是**近即时**的（窗口服务器已经合成好了，
 * 含 Metal 画布），主线程重绘才是慢路径 —— 所以只在前者失败时回退。
 */
export function crossfadePlan(input: CrossfadeInput, duration = WINDOW_CROSSFADE_DURATION): CrossfadePlan {
  const base: CrossfadePlan = {
    mode: 'directChange',
    delay: 0,
    duration,
    timing: CROSSFADE_TIMING,
  }
  if (!input.hasWindow || !input.hasContentView) return base
  if (!input.windowVisible || input.windowOccluded) return base
  if (input.reduceMotion) return base
  if (input.boundsWidth <= SNAPSHOT_MINIMUM_SIDE || input.boundsHeight <= SNAPSHOT_MINIMUM_SIDE) {
    return base
  }
  const mode: CrossfadeMode = input.windowServerImageAvailable
    ? 'snapshotWindowServer'
    : input.bitmapRepresentationAvailable
      ? 'snapshotRedraw'
      : 'directChange'
  if (mode === 'directChange') return base
  return {
    mode,
    delay: SNAPSHOT_FADE_DELAY,
    duration,
    timing: CROSSFADE_TIMING,
  }
}

/** 快照层永不接收点击（Swift L81 `hitTest → nil`）。 */
export const SNAPSHOT_ACCEPTS_HIT_TESTING = false

/** 快照缩放方式：跟随窗口尺寸独立缩放两轴（`imageScaling = .scaleAxesIndependently`）。 */
export const SNAPSHOT_IMAGE_SCALING = 'scaleAxesIndependently' as const

/**
 * 窗口服务器取图的参数（Swift L96-99）：`.null` bounds = 窗口自身范围；
 * 选项 `1<<3` = 包含窗口；图像选项 `1<<0` = 忽略外框（不画阴影）。
 */
export const WINDOW_SERVER_CAPTURE_ARGUMENTS = {
  bounds: 'windowFrame',
  windowListOption: 8,
  imageOption: 1,
} as const
