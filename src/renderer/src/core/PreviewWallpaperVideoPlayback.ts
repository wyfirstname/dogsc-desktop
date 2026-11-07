/**
 * PreviewWallpaperVideoPlayback —— 画布背景的静音循环视频。
 *
 * Swift source: Sources/DogSCApp/PreviewWallpaperVideoPlayback.swift（262 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L9-23    class PreviewWallpaperVideoPlayback（12 个私有成员）
 *   L25-93   configure(url:) —— 建 player / output / 预取任务
 *   L33-40   像素格式 NV12 + Metal 兼容
 *   L42-47   1.5 秒缓冲、静音、结束时暂停、不等缓冲
 *   L52-92   预取任务：load 可播 → 取视频轨 → 变换/时长 → seek → 等就绪 → preroll
 *   L95-103  synchronize(to:) —— 跟随编辑器的渲染 tick
 *   L105-129 applySynchronization —— 暂停/播放两条分支
 *   L131-150 copyFrame(at:) —— 取像素缓冲并去重
 *   L152-169 invalidate —— 13 项清零
 *   L171-175 localTime(for:) —— 取模环绕
 *   L177-184 startAlignedPlayback —— setRate(1, time:, atHostTime:)
 *   L189-210 enqueuePausedSeek —— 合并排队
 *   L212-227 seekPlayer / L229-235 preroll / L241-261 waitUntilReady
 *
 * 迁移说明：
 *   AVPlayer 在 Web 侧由 `<video>` + `requestVideoFrameCallback` 承担。这里
 *   保留的五件纯逻辑都是「踩过坑」的产物：
 *     1. 本地时间 = 输出时间对时长取模（负数补一圈）
 *     2. 暂停与播放两套不同的重新对齐阈值（1/120 秒 vs 0.25 秒）
 *     3. 暂停态 seek 的**合并排队** —— 不合并会让首帧解码被饿死
 *     4. 取帧去重：同一个 itemTime 只交一次
 *     5. 就绪轮询 500 次 × 10 ms，且 unknown 必须继续等（提前 preroll 会抛异常）
 */

/** Swift L42：1.5 秒前向缓冲。 */
export const WALLPAPER_FORWARD_BUFFER_SECONDS = 1.5

/** Swift L133 / L181 / L196：时间刻度。 */
export const WALLPAPER_TIMESCALE = 600

/**
 * Swift L37-38：请求硬件原生的 NV12。
 *
 * 请求 BGRA 会在每次预览合成前强制一次 4K 色彩转换和大量内存搬运 ——
 * 这是「背景视频一开就掉帧」的直接原因。
 */
export const WALLPAPER_PIXEL_FORMAT = '420YpCbCr8BiPlanarVideoRange'
export const WALLPAPER_PIXEL_FORMAT_METAL_COMPATIBLE = true

/** Swift L45-48：播放器的四个开关。 */
export const WALLPAPER_PLAYER_IS_MUTED = true
export const WALLPAPER_ACTION_AT_ITEM_END = 'pause'
export const WALLPAPER_WAITS_TO_MINIMIZE_STALLING = false
export const WALLPAPER_PREVENTS_DISPLAY_SLEEP = false

/** Swift L118：暂停态的重对齐阈值 = 1/120 秒。 */
export const WALLPAPER_PAUSED_RESYNC_TOLERANCE = 1 / 120

/** Swift L126：播放态的重对齐阈值 = 0.25 秒。 */
export const WALLPAPER_PLAYING_RESYNC_TOLERANCE = 0.25

/** Swift L124：目标时间比当前时间早 0.08 秒以上，视为跨过了循环边界。 */
export const WALLPAPER_LOOP_BOUNDARY_MARGIN = 0.08

/** Swift L242：就绪轮询的次数与间隔。 */
export const WALLPAPER_READY_POLL_ATTEMPTS = 500
export const WALLPAPER_READY_POLL_INTERVAL_MS = 10

/**
 * Swift L171-175：把编辑器输出时间折进素材的本地时间。
 *
 * `truncatingRemainder` 在 Swift 里对负数返回负数（C 语义），所以要补一圈。
 * 时长未知（≤ 0）或时间非有限时一律返回 0 —— 此时「从头播」比「算出一个
 * 巨大值」安全。
 */
export function wallpaperLocalTime(
  outputTime: number,
  duration: number
): number {
  if (!(duration > 0)) return 0
  if (!Number.isFinite(outputTime)) return 0
  const remainder = outputTime % duration
  return remainder >= 0 ? remainder : remainder + duration
}

/**
 * Swift L26-27：URL 做标准化后再比较，相同就不重建。
 *
 * 比较的是 `standardizedFileURL` 而不是原串 —— 同一个文件的不同写法
 * （相对/绝对、含 `..`）不该触发一次完整的重建与预取。
 */
export function wallpaperConfigureNeedsRebuild(input: {
  readonly currentURL: string | null
  readonly incomingURL: string | null
}): boolean {
  return input.currentURL !== input.incomingURL
}

/**
 * Swift L105-129：一次同步请求要走哪条分支。
 *
 * 暂停分支：`force || 不连续 || 当前时间非有限 || |当前 − 目标| > 1/120`
 * 时就精确 seek。1/120 秒 = 半帧（60 fps 下），也就是说**超过半帧**才动。
 *
 * 播放分支：`force || 不连续 || 跨过循环边界 || 当前时间非有限 ||
 * |当前 − 目标| > 0.25 || rate == 0` 就重新对齐播放。
 * 0.25 秒比暂停态宽 30 倍 —— 播放时频繁 seek 会造成可见的卡顿，
 * 宁可让背景短暂领先/落后，也不要每帧 seek 一次。
 */
export type WallpaperSyncAction =
  | 'pause-without-seek'
  | 'pause-and-seek'
  | 'keep-playing'
  | 'realign-playback'

export function wallpaperSyncAction(input: {
  readonly isPlaying: boolean
  readonly force: boolean
  readonly discontinuityChanged: boolean
  readonly currentTime: number
  readonly targetTime: number
  readonly playbackRate: number
}): WallpaperSyncAction {
  const currentIsFinite = Number.isFinite(input.currentTime)
  if (!input.isPlaying) {
    const needsSeek =
      input.force ||
      input.discontinuityChanged ||
      !currentIsFinite ||
      Math.abs(input.currentTime - input.targetTime) > WALLPAPER_PAUSED_RESYNC_TOLERANCE
    return needsSeek ? 'pause-and-seek' : 'pause-without-seek'
  }
  const crossedLoopBoundary =
    currentIsFinite && input.targetTime + WALLPAPER_LOOP_BOUNDARY_MARGIN < input.currentTime
  const needsRealign =
    input.force ||
    input.discontinuityChanged ||
    crossedLoopBoundary ||
    !currentIsFinite ||
    Math.abs(input.currentTime - input.targetTime) > WALLPAPER_PLAYING_RESYNC_TOLERANCE ||
    input.playbackRate === 0
  return needsRealign ? 'realign-playback' : 'keep-playing'
}

/**
 * Swift L95-103：`synchronize` 的第一道闸。
 *
 * `tick == null` 时只暂停、不 seek —— 编辑器没有渲染 tick 意味着播放停了，
 * 此时去 seek 一个随机位置没有意义。`duration > 0 && isPrimed` 才往下走：
 * 素材还没预取完就去对齐，会不断打断预取本身。
 */
export type WallpaperSynchronizeStep = 'pause-only' | 'ignore' | 'apply'

export function wallpaperSynchronizeStep(input: {
  readonly hasTick: boolean
  readonly duration: number
  readonly isPrimed: boolean
}): WallpaperSynchronizeStep {
  if (!input.hasTick) return 'pause-only'
  if (!(input.duration > 0) || !input.isPrimed) return 'ignore'
  return 'apply'
}

/**
 * Swift L189-210：暂停态 seek 的合并。
 *
 * 关键在「在飞时不发第二发」：把目标记进 `queuedPausedSeek` 就返回，
 * 等回调回来再补发一次。不合并的话，静止画面上每次 UI 更新都会发一个
 * 零容差 seek，首帧解码永远抢不到带宽。
 */
export type WallpaperPausedSeekPlan = 'start-now' | 'queue-until-idle'

export function wallpaperPausedSeekStep(input: {
  readonly seekIsInFlight: boolean
  readonly hasPlayer: boolean
}): WallpaperPausedSeekPlan {
  if (!input.hasPlayer) return 'queue-until-idle'
  return input.seekIsInFlight ? 'queue-until-idle' : 'start-now'
}

/**
 * Swift L204-207：seek 回调里的补发条件。
 *
 * 只有「期间又排进了一个新目标」才补发；没有排队就只通知一次帧可用。
 */
export function wallpaperResumesQueuedSeek(input: {
  readonly hasQueuedSeek: boolean
}): boolean {
  return input.hasQueuedSeek
}

/**
 * Swift L131-150：取帧前的三道闸与去重。
 *
 * 去重语义：`displayTime.isNumeric && displayTime == lastCopiedItemTime` 就
 * 返回 null。同一个显示时刻拿第二次没有新内容，继续往上交会让下游每帧
 * 都重跑一次定向与合成。
 */
export function wallpaperFrameCopyAccepted(input: {
  readonly duration: number
  readonly hasOutput: boolean
  readonly displayTimeIsNumeric: boolean
  readonly displayTimeEqualsLast: boolean
}): boolean {
  if (!(input.duration > 0) || !input.hasOutput) return false
  if (!input.displayTimeIsNumeric) return true
  return !input.displayTimeEqualsLast
}

/**
 * Swift L217-219：预取阶段用的 seek 容差。
 *
 * `exact`（暂停中）给零容差，否则给 1/30 秒 —— 播放中预取没必要精确到帧，
 * 零容差会让预取慢一个数量级。
 */
export function wallpaperSeekTolerance(exact: boolean): number {
  return exact ? 0 : 1 / 30
}

/**
 * Swift L241-261：就绪轮询的判定。
 *
 * `unknown` 必须继续等：AVPlayer 的 seek 完成只代表「时间请求落地了」，
 * 本地 HEVC 素材可能还会报 `unknown` 一小段时间。在 `readyToPlay` 之前调
 * `preroll` 会抛 Objective-C 异常。
 */
export type WallpaperReadyOutcome = 'ready' | 'failed' | 'keep-waiting'

export function wallpaperReadyOutcome(
  status: 'unknown' | 'readyToPlay' | 'failed' | 'other'
): WallpaperReadyOutcome {
  if (status === 'readyToPlay') return 'ready'
  if (status === 'unknown') return 'keep-waiting'
  return 'failed'
}

/**
 * Swift L152-169：`invalidate` 的清零顺序。
 *
 * 先取消预取任务、再取消在飞 seek，最后才释放 player —— 顺序反了会让
 * 取消回调拿到一个已经半拆的对象。
 */
export const WALLPAPER_INVALIDATE_ORDER: readonly string[] = [
  'cancel-preparation-task',
  'cancel-pending-seeks',
  'pause-player',
  'replace-current-item',
  'release-player',
  'release-output',
  'reset-duration',
  'reset-transform',
  'reset-discontinuity',
  'reset-copied-item-time',
  'reset-latest-tick',
  'clear-primed',
  'clear-seek-state',
]

/**
 * Swift L80-85：预取完成后是「立刻对齐播放」还是「暂停并记账」。
 *
 * 暂停时只记下 `discontinuityID`，不 seek —— 因为 `configure` 里已经
 * 精确 seek 到最新 tick 的位置了，再 seek 一次是多余的。
 */
export type WallpaperPrimedAction = 'apply-playing' | 'pause-and-remember'

export function wallpaperPrimedAction(input: {
  readonly hasTick: boolean
  readonly isPlaying: boolean
}): WallpaperPrimedAction {
  return input.hasTick && input.isPlaying ? 'apply-playing' : 'pause-and-remember'
}

/**
 * Swift L59 / L74 / L76：预取过程中三次校验「URL 还是不是我的」。
 *
 * 用户在预取期间换了壁纸，旧任务的后续步骤必须全部放弃 ——
 * 否则会把旧素材的变换与时长写到新播放器上。
 */
export function wallpaperPreparationStillOwns(input: {
  readonly currentURL: string | null
  readonly expectedURL: string
}): boolean {
  return input.currentURL === input.expectedURL
}
