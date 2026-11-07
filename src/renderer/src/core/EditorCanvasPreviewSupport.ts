/**
 * EditorCanvasPreviewSupport —— 预览布局的数据结构、栅格策略与交互策略。
 *
 * Swift source: Sources/DogSCApp/EditorCanvasPreviewSupport.swift（214 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L5-18    struct CanvasPreviewLayout（六个字段）
 *   L20-88   struct CanvasPlaybackEvaluationContext（14 字段 + 两个取帧方法）
 *   L36-50   refreshingCursor(in:at:)
 *   L52-60   playbackFrame(at:) —— 先按 60 Hz 归到采样网格，再刷新光标
 *   L62-87   frame(at:) —— 精确时刻
 *   L90-111  enum EditorPreviewResolutionMode（low / full）
 *   L113-162 enum CanvasPreviewRasterPolicy（pixelSize / drawablePixelSize）
 *   L164-173 enum CanvasPreviewInteractionPolicy（showsEditingOverlays）
 *   L175-186 final class ImmutablePreviewAsset
 *   L188-214 final class PausedPreviewFrameRequest
 *
 * 迁移说明：
 *   这里有两个「反直觉但正确」的决策，是本文件存在的理由：
 *
 *   1. `pixelSize` 的 `displayScale` 参数**被显式忽略**（Swift 里写作 `_`）。
 *      「流畅」是用户主动选择的性能档，不是当前 backing scale 的别名。
 *      在 Retina 上按 2× backing 合成会让一个大编辑窗口接近 4K 工作量，
 *      与「完整源分辨率」的负担差距太小，这个开关就等于没用。用 1× point
 *      raster 把像素量稳定降到四分之一。
 *
 *   2. `playbackFrame` 与 `frame` 的差别只在时间：播放走 60 Hz 采样网格，
 *      暂停走精确时刻。两者共用同一套求值，所以「暂停看到的」与「播到那里
 *      看到的」除了时间点之外完全一致。
 */

/** Swift L90-96：两个分辨率档。 */
export type EditorPreviewResolutionMode = 'low' | 'full'

export const EDITOR_PREVIEW_RESOLUTION_MODES: readonly EditorPreviewResolutionMode[] = [
  'low',
  'full',
]

/** Swift L94：默认是完整分辨率 —— 清晰优先，性能档要用户主动选。 */
export const EDITOR_PREVIEW_RESOLUTION_DEFAULT: EditorPreviewResolutionMode = 'full'

/** Swift L98-103：两个档的显示名。 */
export const EDITOR_PREVIEW_RESOLUTION_LABELS: Readonly<
  Record<EditorPreviewResolutionMode, string>
> = {
  low: '清晰预览',
  full: '完整分辨率',
}

/** Swift L105-110：两个档的副标题。 */
export const EDITOR_PREVIEW_RESOLUTION_DETAILS: Readonly<
  Record<EditorPreviewResolutionMode, string>
> = {
  low: '播放更流畅',
  full: '保留素材细节',
}

export function editorPreviewResolutionLabel(
  mode: EditorPreviewResolutionMode
): string {
  return EDITOR_PREVIEW_RESOLUTION_LABELS[mode]
}

export function editorPreviewResolutionDetail(
  mode: EditorPreviewResolutionMode
): string {
  return EDITOR_PREVIEW_RESOLUTION_DETAILS[mode]
}

/** Swift L150-155：Metal 纹理的默认边长上限。 */
export const CANVAS_PREVIEW_MAXIMUM_TEXTURE_DIMENSION = 16_384

/**
 * Swift L114-142：预览栅格的像素尺寸。
 *
 * 低清档 = `max(ceil(points), 2)` —— 向上取整而不是四舍五入，避免 1.2 点
 * 的窗口算出 1 像素的栅格。完整档要拿到**有限且为正**的源分辨率才采用，
 * 否则安静地退回低清（而不是给一个 0 像素的栅格让下游炸掉）。
 *
 * `displayScale` 参数刻意不参与计算，见文件头。
 */
export function canvasPreviewRasterPixelSize(input: {
  readonly points: { readonly width: number; readonly height: number }
  readonly displayScale?: number
  readonly mode?: EditorPreviewResolutionMode
  readonly fullResolution?: { readonly width: number; readonly height: number } | null
}): { readonly width: number; readonly height: number } {
  const low = {
    width: Math.max(Math.ceil(input.points.width), 2),
    height: Math.max(Math.ceil(input.points.height), 2),
  }
  const mode = input.mode ?? EDITOR_PREVIEW_RESOLUTION_DEFAULT
  const full = input.fullResolution
  const fullUsable =
    mode === 'full' &&
    full != null &&
    Number.isFinite(full.width) &&
    Number.isFinite(full.height) &&
    full.width > 0 &&
    full.height > 0
  if (!fullUsable) return low
  return {
    width: Math.max(full.width, 2),
    height: Math.max(full.height, 2),
  }
}

/**
 * Swift L144-161：drawable 的像素尺寸。
 *
 * 只做一件事：把超过纹理上限的长边等比压回上限，再对两边四舍五入并夹到 2。
 * 等比而不是分别夹取 —— 分别夹会把 20000×1000 压成 16384×1000，
 * 画面横向压扁。
 */
export function canvasPreviewDrawablePixelSize(input: {
  readonly rasterCanvasSize: { readonly width: number; readonly height: number }
  readonly maximumTextureDimension?: number
}): { readonly width: number; readonly height: number } {
  const width = Math.max(input.rasterCanvasSize.width, 2)
  const height = Math.max(input.rasterCanvasSize.height, 2)
  const maximumEdge = Math.max(width, height)
  const limit = Math.max(
    input.maximumTextureDimension ?? CANVAS_PREVIEW_MAXIMUM_TEXTURE_DIMENSION,
    2
  )
  const scale = maximumEdge > limit ? limit / maximumEdge : 1
  return {
    width: Math.max(Math.round(width * scale), 2),
    height: Math.max(Math.round(height * scale), 2),
  }
}

/**
 * Swift L164-173：播放时**不显示**编辑手柄。
 *
 * 手柄是从静止的编辑器 tick 求值的；播放时留着它们，会让一条虚线框
 * 从移动/投影中的屏幕上脱开，看起来像「用户画的边框消失了」。
 */
export function canvasPreviewShowsEditingOverlays(isPlaying: boolean): boolean {
  return !isPlaying
}

/**
 * Swift L202：`generator.appliesPreferredTrackTransform = videoComposition == nil`。
 *
 * 多源指令已经把每一层都摆进规范渲染尺寸；再叠一次轨道变换，会让导入的
 * 竖屏素材**只在**暂停帧/缩略图里被多转 90° —— 播放正常、一暂停就横过来，
 * 是最难查的那类 bug。
 */
export function pausedPreviewFrameAppliesTrackTransform(
  hasVideoComposition: boolean
): boolean {
  return !hasVideoComposition
}

/** Swift L203-204：两次容差都必须是零，否则拖时间轴会取到邻近帧。 */
export const PAUSED_PREVIEW_FRAME_TIME_TOLERANCE = 0

/**
 * Swift L52-60：播放帧的时间先归到 60 Hz 网格。
 *
 * 用 `rounded()` 而不是 `floor` —— 归到**最近**的采样点，向上/向下取整都会
 * 让某一段动画比另一段晚一帧。归完之后仍用**原始**呈现时刻去刷新光标，
 * 这样指针与媒体时钟保留显示器的精确时间戳。
 */
export const CANVAS_PREVIEW_PLAYBACK_CADENCE_FPS = 60

export function canvasPreviewPlaybackSampleTime(time: number): number {
  const safe = Number.isFinite(time) ? Math.max(time, 0) : 0
  return Math.round(safe * CANVAS_PREVIEW_PLAYBACK_CADENCE_FPS) / CANVAS_PREVIEW_PLAYBACK_CADENCE_FPS
}

/**
 * Swift L36-60：两条取帧路径。
 *
 *  - `exact`    —— `frame(at: t)`，暂停检视用。
 *  - `playback` —— `playbackFrame(at: t)`：采样时刻归网格，光标按原时刻刷新。
 *
 * 两者都要刷新光标，因为光标是唯一「不跟网格走」的层：它必须贴着真实的
 * 指针位置，否则慢动作播放时光标会一顿一顿地跳。
 */
export type CanvasPreviewFrameSampleKind = 'exact' | 'playback'

export function canvasPreviewFrameSampleTime(
  kind: CanvasPreviewFrameSampleKind,
  presentationTime: number
): number {
  return kind === 'playback'
    ? canvasPreviewPlaybackSampleTime(presentationTime)
    : presentationTime
}

/**
 * Swift L20-34：求值上下文的 14 个字段，全部不可变。
 *
 * 关键在「只捕获一次」：60 Hz 的原生播放循环只重算这个上下文里的取帧，
 * 不再重建点空间的交互几何（那条路径要扫全部贴图/马赛克/缩放片段）。
 */
export const CANVAS_PLAYBACK_EVALUATION_FIELDS: readonly string[] = [
  'project',
  'outputDuration',
  'frameRate',
  'rasterCanvasSize',
  'sourceAspectRatio',
  'cameraSourceSize',
  'cameraPlan',
  'pointerTrack',
  'cursorMetrics',
  'cursorMetricsByAssetID',
  'zoomTrack',
  'screenMotionTrack',
  'cameraMotionTrack',
  'stickerTrack',
]

/**
 * Swift L80-82：`frame` 不再跑第二遍指针/缩放/投影求值 ——
 * 直接把 `plan.scene` 当作语义场景复用。
 *
 * 这条复用是「暂停帧不再比播放帧慢一截」的原因：第二次求值要重算投影矩阵，
 * 在 5K 工程上单帧能差出几毫秒。
 */
export function canvasPreviewReusesEvaluatedScene(): boolean {
  return true
}

/**
 * Swift L175-186：不可变资产包。
 *
 * 显式边界的作用是「已构造后不再变」，于是精确取帧可以跑到主线程之外，
 * 而不用假装一个正在被改的 AVFoundation 对象是 Sendable。
 */
export function immutablePreviewAssetIsTransferable(input: {
  readonly hasAsset: boolean
}): boolean {
  return input.hasAsset
}
