/**
 * 暂停态精确帧解码 —— Swift EditorPlaybackPausedFrames.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorPlaybackPausedFrames.swift（84 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - refreshPausedFrames 前置卫兵（预览活跃 / 有素材 / 不在播放）  L9
 *   - 帧对齐：floor(时间 × 帧率) / 帧率（帧率下限 1）              L12-18
 *   - 屏幕与摄像头两路并发解码                                     L39-53
 *   - 回主线程的四重过期检查（代次/seek/解码令牌/播放中）           L55-60
 *   - 摄像头帧的三种结局：写入 / 清空 / 保留                        L61-70
 *   - cancelPausedFrameDecode：令牌 +1、取消任务、取消生成器        L77-83
 *
 * 原注释两条关键设计：
 * 1. **生成器由请求对象持有到整个请求结束** —— 只靠 Task 取消的话，快速拖动时
 *    生成器仍在后台解码，CPU 会被拖垮。
 * 2. 屏幕与摄像头的合成有各自的生成器，串行等待会让「暂停/剪切/拖动」付出两次
 *    exact-seek 的延迟；并发子任务把刷新时间降到两者中较慢的那个。
 */

export interface PausedFrameRequestInput {
  readonly isPreviewActive: boolean
  readonly hasPreparedMedia: boolean
  readonly isPlaying: boolean
}

/** Swift L9 的三个卫兵：任一不满足就不刷新。 */
export function shouldRefreshPausedFrames(input: PausedFrameRequestInput): boolean {
  return input.isPreviewActive && input.hasPreparedMedia && !input.isPlaying
}

/**
 * Swift L12-18：先把时间夹到 `[0, duration]`，再对齐到帧边界。
 * 帧率下限 1（预览可能尚未拿到真实帧率）—— 否则 `frame / 0` 会得到 Infinity。
 */
export function pausedFrameTime(time: number, duration: number, frameRate: number): number {
  const rate = Math.max(frameRate, 1)
  return pausedFrameIndex(time, duration, frameRate) / rate
}

/** 对齐后的帧序号（先取整再回乘，避免 `floor(t*rate)/rate*rate` 的浮点误差）。 */
export function pausedFrameIndex(time: number, duration: number, frameRate: number): number {
  const rate = Math.max(frameRate, 1)
  const clamped = Math.min(Math.max(time, 0), Math.max(duration, 0))
  return Math.floor(clamped * rate)
}

export interface PausedFramePublicationTicket {
  readonly generation: number
  readonly seekToken: number
  readonly decodeToken: number
}

/**
 * Swift L56-60：四个条件全都要满足才允许写入画面。
 * 少一条就会把「上一次拖动」的帧贴到新位置上 —— 表现为画面闪回。
 */
export function pausedFramePublicationIsCurrent(
  requested: PausedFramePublicationTicket,
  current: PausedFramePublicationTicket,
  isPlaying: boolean
): boolean {
  return (
    !isPlaying &&
    requested.generation === current.generation &&
    requested.seekToken === current.seekToken &&
    requested.decodeToken === current.decodeToken
  )
}

export type PausedCameraImageDecision = 'set' | 'clear' | 'keep'

/**
 * Swift L65-70：摄像头帧的三种结局 ——
 * 有新图就写入；没有新图但本轮**不需要**摄像头就清空（否则会残留上一个位置的画面）；
 * 需要摄像头却解码失败则保留旧图（总比黑屏好）。
 */
export function pausedCameraImageDecision(
  shouldLoadCamera: boolean,
  hasCameraImage: boolean
): PausedCameraImageDecision {
  if (hasCameraImage) return 'set'
  return shouldLoadCamera ? 'keep' : 'clear'
}

/** Swift `pausedFrameDecodeToken &+= 1`：无符号回绕，比较用不等即可。 */
export function nextPausedFrameDecodeToken(token: number): number {
  return (token + 1) >>> 0
}
