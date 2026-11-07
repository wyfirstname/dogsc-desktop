/**
 * EditorCanvasPreviewLayout —— 画布场景求值：把工程求值成一份可渲染的布局。
 *
 * Swift source: Sources/DogSCApp/EditorCanvasPreviewLayout.swift（207 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L6       extension CanvasPreview
 *   L7-151   previewLayout(canvasSize:renderScale:playbackTime:tracks:)
 *   L13-21   sourceAspect / sourceCanvasDimensions（像素下限 2）
 *   L22-36   previewRasterCanvasSize（低清 / 完整两档）
 *   L37-39   overlayAuthoringProject + stickerTrack 复用判定
 *   L41-45   pointerEvaluation（mediaPlan 缺失时给空求值）
 *   L46-56   activeZoomClip / activeAutomaticClip / automaticCameraPosition
 *   L57-66   inheritedAutomaticCameraPosition（上一个自动片段的终点）
 *   L70-86   CompositionSceneEvaluator.evaluate（交互用点空间）
 *   L87-89   cursorMetrics
 *   L90-115  FrameSceneEvaluator.scene（栅格用像素空间）
 *   L116-140 makeEvaluation 闭包
 *   L141-150 previewEvaluation / visibleFrame / CanvasPreviewLayout
 *   L158-206 overlayAuthoringProject(at:stickerTrack:)
 *
 * 迁移说明：
 *   文件本身是一段「把七路输入拼成一个布局」的装配代码，没有分支逻辑的那种；
 *   但它有六处**容易装配错**的判定，全部提成了纯函数：
 *     1. 源像素尺寸必须 `max(round(v), 2)`
 *     2. stickerTrack 能复用就复用（否则每帧重建整条过渡轨）
 *     3. 只有 `origin === 'automatic'` 的缩放片段才有自动构图焦点
 *     4. 继承焦点取「上一个片段的**终点**」，取终点是因为连续性要接在它结束的位置
 *     5. `reanchorAutomaticEntry` 只对自动片段求值
 *     6. 暂停授权时把首帧片段的入场时长清零 —— 但参加接力的片段必须跳过
 */

/** Swift L18-20：源像素尺寸，四舍五入后下限 2。 */
export function previewSourcePixelSize(size: {
  readonly width: number
  readonly height: number
}): { readonly width: number; readonly height: number } {
  return {
    width: Math.max(Math.round(size.width), 2),
    height: Math.max(Math.round(size.height), 2),
  }
}

/**
 * Swift L37-39：`evaluatedProject.timeline.stickerClips == project.timeline.stickerClips`
 * 就复用外部传入的过渡轨，否则按求值后的片段重建。
 *
 * 复用很重要：`StickerTransitionTrack` 的构造要扫全部片段建立进入时间索引，
 * 每帧重建会让 60 Hz 预览多出可观的开销。而一旦授权用的工程被改过
 * （暂停时把 enterDuration 清零），就必须重建，否则画出来的还是旧入场。
 */
export type StickerTrackDecision = 'reuse' | 'rebuild'

export function canvasPreviewStickerTrackDecision(input: {
  readonly evaluatedClipsMatchProject: boolean
  readonly hasSuppliedTrack: boolean
}): StickerTrackDecision {
  return input.evaluatedClipsMatchProject && input.hasSuppliedTrack
    ? 'reuse'
    : 'rebuild'
}

/**
 * Swift L46-49：只有 `origin === 'automatic'` 的缩放片段参与自动构图。
 *
 * `flatMap { $0.origin == .automatic ? $0 : nil }` —— 手动放置的片段
 * （`origin === 'manual'`）一律返回 null，于是下游拿到的是「没有焦点」，
 * 而不是「用片段自己的 focus」。
 */
export interface CanvasPreviewZoomClip {
  readonly id: string
  readonly origin: 'automatic' | 'manual'
  readonly startTime: number
  readonly endTime: number
  readonly focus: { readonly x: number; readonly y: number }
}

export function canvasPreviewAutomaticClip(
  activeClip: CanvasPreviewZoomClip | null
): CanvasPreviewZoomClip | null {
  if (activeClip == null) return null
  return activeClip.origin === 'automatic' ? activeClip : null
}

/**
 * Swift L50-56：自动构图焦点的取值。
 *
 * 优先用指针跟踪算出的焦点（`automaticCameraFocus`），取不到才退回片段里
 * 存着的 `focus`。这个兜底不是可选的：媒体计划缺失时指针跟踪整条不可用，
 * 没有兜底就会让自动片段在「还没分析完指针」的那几帧跳到原点。
 */
export function canvasPreviewAutomaticCameraPosition(input: {
  readonly automaticClip: CanvasPreviewZoomClip | null
  readonly trackedFocus: { readonly x: number; readonly y: number } | null
}): { readonly x: number; readonly y: number } | null {
  if (input.automaticClip == null) return null
  return input.trackedFocus ?? input.automaticClip.focus
}

/**
 * Swift L57-66：继承焦点 = 「当前自动片段的上一个片段」在**它自己的终点**处的焦点。
 *
 * 用终点而不是起点：自动构图的连续性要求新片段接着上一段**结束**的位置，
 * 用起点会让两个片段交界处跳一下。
 *
 * 且上一个片段也必须是 automatic —— 手动片段没有可继承的构图语义。
 */
export function canvasPreviewInheritedAutomaticPosition(input: {
  readonly activeClip: CanvasPreviewZoomClip | null
  readonly previousClip: CanvasPreviewZoomClip | null
  readonly trackedFocus: { readonly x: number; readonly y: number } | null
}): { readonly x: number; readonly y: number } | null {
  if (input.activeClip == null) return null
  const previous = input.previousClip
  if (previous == null) return null
  if (previous.origin !== 'automatic') return null
  return input.trackedFocus ?? previous.focus
}

/**
 * Swift L80-82：`reanchorAutomaticEntry` 只对存在自动片段的情况求值。
 *
 * 语义是「这个自动片段是不是紧接在一次剪切之后开始的」—— 若是，入场要
 * 重新锚定，不能沿用上一段的缓动进度。
 */
export function canvasPreviewShouldReanchorAutomaticEntry(input: {
  readonly automaticClip: CanvasPreviewZoomClip | null
  readonly startsAfterCut: boolean
}): boolean {
  if (input.automaticClip == null) return false
  return input.startsAfterCut
}

/**
 * Swift L158-206：暂停授权时的「入场清零」计划。
 *
 * 规则分两层：
 *
 * 1. **先过选中项自己的闸**。选中的片段必须满足「时间在片段时间范围内」
 *    且「距离片段起点不超过一帧 + 0.0001」。超出就不做任何修改 —— 这一条
 *    保证只有刚插入的那一帧才享有「看见最终外观」的待遇。
 *
 * 2. **贴图分支要遍历全部片段**，不只选中的那个。原因是两张图连着粘贴时，
 *    较早那张也停在 opacity 0；只处理选中项会让先贴的那张一直看不见。
 *    但参加接力的条目（`hasJoinedEntry`）必须跳过 —— 它们本来就靠双方的
 *    入场动画完成交接，把入场压掉只会让暂停预览里出现一次硬切。
 *
 * 播放中一律不改：`guard !isPlaying` 在最前面。
 */
export type OverlayAuthoringAction =
  | 'unchanged-playing'
  | 'unchanged-not-selected'
  | 'unchanged-clip-missing'
  | 'unchanged-outside-first-frame'
  | 'clear-sticker-entrances'
  | 'clear-mosaic-transition'

export interface OverlayAuthoringPlan {
  readonly action: OverlayAuthoringAction
  /** 需要把 `enterDuration` 归零的贴图片段 id。 */
  readonly stickerClipIDsToClear: readonly string[]
  /** 需要把 `transitionInDuration` 归零的马赛克片段下标；-1 表示不动。 */
  readonly mosaicClipIndexToClear: number
}

export interface OverlayAuthoringInput {
  readonly isPlaying: boolean
  readonly frameRate: number
  readonly playbackTime: number
  readonly selection:
    | { readonly kind: 'sticker'; readonly id: string }
    | { readonly kind: 'mosaic'; readonly id: string }
    | { readonly kind: 'other' }
  readonly stickerClips: readonly {
    readonly id: string
    readonly startTime: number
    readonly endTime: number
  }[]
  readonly mosaicClips: readonly {
    readonly id: string
    readonly startTime: number
    readonly endTime: number
  }[]
  /** `StickerTransitionTrack.hasJoinedEntry(id)` 的查询函数。 */
  readonly hasJoinedEntry: (clipID: string) => boolean
}

/** Swift L170 / L185 / L195：`帧长 + 0.0001` 的容差。 */
export const OVERLAY_AUTHORING_FRAME_TOLERANCE = 0.000_1

/** Swift L163：一帧的时长，帧率下限 1。 */
export function overlayAuthoringFrameDuration(frameRate: number): number {
  return 1 / Math.max(frameRate, 1)
}

/** Swift L169-171：`timing.contains(t) && t - start <= 帧长 + 0.0001`。 */
export function overlayAuthoringClipIsOnFirstFrame(input: {
  readonly playbackTime: number
  readonly startTime: number
  readonly endTime: number
  readonly frameDuration: number
}): boolean {
  const contains =
    input.playbackTime >= input.startTime && input.playbackTime <= input.endTime
  if (!contains) return false
  return (
    input.playbackTime - input.startTime <=
    input.frameDuration + OVERLAY_AUTHORING_FRAME_TOLERANCE
  )
}

export function canvasPreviewOverlayAuthoringPlan(
  input: OverlayAuthoringInput
): OverlayAuthoringPlan {
  const unchanged = (action: OverlayAuthoringAction): OverlayAuthoringPlan => ({
    action,
    stickerClipIDsToClear: [],
    mosaicClipIndexToClear: -1,
  })

  if (input.isPlaying) return unchanged('unchanged-playing')
  const selection = input.selection
  if (selection.kind === 'other') return unchanged('unchanged-not-selected')

  const frameDuration = overlayAuthoringFrameDuration(input.frameRate)
  const firstFrame = (clip: { startTime: number; endTime: number }): boolean =>
    overlayAuthoringClipIsOnFirstFrame({
      playbackTime: input.playbackTime,
      startTime: clip.startTime,
      endTime: clip.endTime,
      frameDuration,
    })

  if (selection.kind === 'sticker') {
    const selectedID = selection.id
    const selected = input.stickerClips.find((clip) => clip.id === selectedID)
    if (selected == null) return unchanged('unchanged-clip-missing')
    if (!firstFrame(selected)) return unchanged('unchanged-outside-first-frame')
    const clear = input.stickerClips
      .filter((clip) => !input.hasJoinedEntry(clip.id) && firstFrame(clip))
      .map((clip) => clip.id)
    return {
      action: 'clear-sticker-entrances',
      stickerClipIDsToClear: clear,
      mosaicClipIndexToClear: -1,
    }
  }

  const mosaicID = selection.id
  const index = input.mosaicClips.findIndex((clip) => clip.id === mosaicID)
  if (index < 0) return unchanged('unchanged-clip-missing')
  if (!firstFrame(input.mosaicClips[index]!)) {
    return unchanged('unchanged-outside-first-frame')
  }
  return {
    action: 'clear-mosaic-transition',
    stickerClipIDsToClear: [],
    mosaicClipIndexToClear: index,
  }
}

/**
 * Swift L67-69 / L99-106：两处注释点出的两个坑，写成常量便于回归。
 *
 * ① `cameraSourceSize` 必须是**真实像素**尺寸。给归一化宽高比会让
 *    `contentFill` 的缩放把图像放大几百倍，PIP 里只剩左边缘一列像素，
 *    表现为「摄像头全黑」。
 * ② 点空间的 `scene` 只服务交互（拖拽归一化与选中框变换）；真正上屏的像素
 *    只来自 `frameScene` + `renderPlan`。
 */
export const CANVAS_PREVIEW_CAMERA_SOURCE_SIZE_IS_PIXELS = true
export const CANVAS_PREVIEW_POINT_SCENE_IS_INTERACTION_ONLY = true

/**
 * Swift L143-150：布局的六个字段。
 *
 * `rasterFrameScene` 与 `frameScene` 是**同一时刻的两份场景**，分别贴着
 * 点空间与栅格像素空间 —— 在 Retina 上合成点空间再放大，正是「看起来糊」
 * 的根因。
 */
export const CANVAS_PREVIEW_LAYOUT_FIELDS: readonly string[] = [
  'sourceAspect',
  'scene',
  'frameScene',
  'rasterFrameScene',
  'renderPlan',
  'playbackEvaluation',
]
