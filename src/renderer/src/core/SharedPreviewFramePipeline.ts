/**
 * 共享预览帧管线 —— 预览侧与导出侧共用同一套渲染计划与合成入口。
 *
 * Swift source: Sources/DogSCApp/SharedPreviewFramePipeline.swift（556 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct PreviewRenderJob（18 个字段）                    L13-52   → PreviewRenderJob
 *   - struct PreviewVisualSignature                          L54-126  → PreviewVisualSignature
 *     · ==（含 dynamicFlow 时间例外）                        L65-91   → previewVisualSignaturesEqual
 *     · scenesMatchVisually                                  L93-119  → previewScenesMatchVisually
 *     · layerOrdersMatch（跳过 cursor）                      L121-126 → previewLayerOrdersMatch
 *   - struct PreviewCursorOverlayAppearance                  L132-154 → previewCursorOverlayAppearance
 *   - struct PreviewCursorContentsSignature                  L158-173
 *     · pixelDimension（−0.000001 消抖）                     L169-172 → previewCursorPixelDimension
 *   - struct PreviewCursorBitmapCache（12 / 2 MB LRU）        L177-215 → PreviewCursorBitmapCache
 *   - struct PreviewPreparedBackgroundCache                  L222-283 → PreviewPreparedBackgroundCache
 *   - struct PreviewPresentationEpoch                        L285-289 → PreviewPresentationEpoch
 *   - enum PreviewCameraFrameContinuityPolicy                L297-317 → canUseCachedPreviewFrame / shouldHoldPresentedFrame
 *   - enum PreviewPresentationVisibilityPolicy               L319-328 → 同名
 *   - enum PreviewLayerRetirementPolicy                      L330-344 → 同名
 *   - enum PreviewRenderBackpressurePolicy                   L346-373 → 同名
 *   - struct SharedPreviewPlaybackFrame                      L378-381
 *   - enum SharedPreviewFramePipeline                        L390-552
 *     · canSeparateCursor                                    L391-407 → canSeparatePreviewCursor
 *     · cursorIntersectsLaterCamera                          L414-462 → previewCursorIntersectsLaterCamera
 *     · rasterPlan(_:) / rasterPlan(_:separatesCursor:)      L468-490 → previewRasterPlan
 *     · orientedFrame                                        L492-500 → port
 *     · render(plan:resources:)                              L502-518 → port
 *     · render(scene:screen:camera:wallpaper:cursor:)        L523-551 → port
 *   - （其后为 SharedRenderedPreviewSurface 的声明，不在本文件）
 *
 * 原注释（L6-11）：
 *   Background preview render payload: all value types or immutable references
 *   (CIImage is immutable), safe to pass across queues.
 *
 * 原注释（L29-33）：
 *   Actual on-screen drawable size. The editor may display a 4K project in a
 *   900-point canvas; rendering the authored 4K size and then multiplying it by
 *   Retina scale accidentally created an 8K texture every frame.
 *
 * 原注释（L104-107）：
 *   Presentation/output time and FrameScene.time are normally evaluation
 *   provenance. Dynamic backgrounds are the exception because their visible
 *   phase is evaluated by the renderer from scene.time.
 *
 * 原注释（L156-157）：
 *   Rotation/projective basis arithmetic can turn an exact 110 pixels into
 *   110.00000000000003. Do not allocate another bitmap for that roundoff.
 *
 * 原注释（L217-221）：
 *   Keeps the editor's time-invariant background as one stable Core Image
 *   object. `insertingIntermediate(cache:)` only helps when that exact CIImage
 *   instance survives between renders.
 *
 * 原注释（L362-366）：
 *   Playback frames in one continuous interval must not be dropped merely
 *   because a newer tick has been queued; doing so previously reduced a
 *   nominal 60 Hz preview to roughly 45 fps.
 *
 * 迁移说明：`CIImage` / `CAMetalLayer` / `CGImage` 在 Windows 侧对应
 * Canvas 纹理与 `OffscreenCanvas`。这里保留五件**决定正确性**的纯逻辑：
 *   1. 视觉签名比较（含 dynamicFlow 的时间例外与跳过 cursor 的层序比较）
 *   2. 光标像素尺寸的消抖取整
 *   3. 两张缓存（光标位图 LRU、不随时间变化的背景图）
 *   4. 四条策略（相机连续性 / 可见性 / 图层退役 / 渲染背压）
 *   5. 光标能否独立成分离图层的判定（含与相机层的矩形相交）
 */

import type { FrameRenderPlan, FrameScene, FrameLayerRole, CompositionSize, FrameShadow } from './FrameScene'
import type { HexColor } from './HexColor'
import type { CursorAssetID, CursorClickEffectStyle } from './ProjectModel'
import { backgroundSourceIsVideo } from './ProjectModel'

/** Swift L13-52：一帧预览渲染任务的全部输入。 */
export interface PreviewRenderJob {
  /** 每提交一帧递增，用于暂停帧的丢弃判定。 */
  readonly generation: number
  /** 连续播放帧之间保持稳定；暂停/跳转/换素材时变化。 */
  readonly presentationEpochID: number
  /** display link 的呈现截止时刻；静止帧没有截止时刻，立即呈现。 */
  readonly presentationHostTime: number | null
  /** 诊断句柄（未开启诊断时为 null）。 */
  readonly diagnostics: PreviewDiagnosticsFrameRef | null
  readonly plan: FrameRenderPlan
  readonly effectPrewarmPlans: readonly FrameRenderPlan[]
  readonly canvasSize: CompositionSize
  /** **屏幕上真实的 drawable 尺寸**，不是创作的 4K 尺寸。 */
  readonly destinationPixelSize: CompositionSize
  readonly colorContract: FrameColorContractRef | null
  /** drawable 目标（`CAMetalLayer` 的替身）。 */
  readonly metalLayer: string
  /** 来自静止/检查器编辑而非播放 tick。 */
  readonly isPausedFrame: boolean
  readonly includesCamera: boolean
  readonly includesScreen: boolean
}

/** 诊断句柄的最小契约（真正的实现见 `PreviewFrameDiagnostics`）。 */
export interface PreviewDiagnosticsFrameRef {
  readonly captureID: number
  readonly index: number
  readonly collectsRenderInfo: boolean
  queuedAt: number
}

/** 颜色契约（等价物在 `CoreImageFrameColorProfile` 里）。 */
export interface FrameColorContractRef {
  readonly identifier: string
}

/** Swift L54-63：判断「这一帧和上一帧看起来是否一样」的全部输入。 */
export interface PreviewVisualSignature {
  readonly plan: FrameRenderPlan
  readonly separatesCursor: boolean
  readonly contentRevision: number
  readonly backingScale: number
  readonly destinationPixelSize: CompositionSize
  readonly colorContract: FrameColorContractRef | null
}

/**
 * Swift L65-91：签名相等。
 *
 * 六项前置（光标分离 / 内容修订 / backingScale / 目标像素尺寸 / 颜色契约 /
 * 帧率）任一不同就不等。之后有一个**只看 dynamicFlow 的时间例外**：
 * 动态背景的可见相位由渲染器从 `scene.time` 求值，所以时间变了画面就变了；
 * 其它背景的时间只是求值溯源信息，不参与比较。
 *
 * 最后才做场景比较，且光标随 `separatesCursor` 一起被跳过 ——
 * 分离光标时它不在合成图里，改它不该让底图重新合成。
 */
export function previewVisualSignaturesEqual(
  lhs: PreviewVisualSignature,
  rhs: PreviewVisualSignature
): boolean {
  if (lhs.separatesCursor !== rhs.separatesCursor) return false
  if (lhs.contentRevision !== rhs.contentRevision) return false
  if (lhs.backingScale !== rhs.backingScale) return false
  if (!sizesEqual(lhs.destinationPixelSize, rhs.destinationPixelSize)) return false
  if (!colorContractsEqual(lhs.colorContract, rhs.colorContract)) return false
  if (lhs.plan.frameRate !== rhs.plan.frameRate) return false

  if (
    lhs.plan.scene.background.source.kind === 'dynamicFlow' &&
    lhs.plan.scene.time !== rhs.plan.scene.time
  ) {
    return false
  }
  return previewScenesMatchVisually(lhs.plan.scene, rhs.plan.scene, lhs.separatesCursor)
}

/** Swift L93-119：逐字段比较场景（光标可跳过）。 */
export function previewScenesMatchVisually(
  lhs: FrameScene,
  rhs: FrameScene,
  ignoringCursor: boolean
): boolean {
  if (!sizesEqual(lhs.canvasSize, rhs.canvasSize)) return false
  if (!frameColorsEqual(lhs.color, rhs.color)) return false
  if (!frameBackgroundsEqual(lhs.background, rhs.background)) return false
  if (!frameScreensEqual(lhs.screen, rhs.screen)) return false
  if (!frameCamerasEqual(lhs.camera, rhs.camera)) return false
  if (!frameStickersEqual(lhs.stickers, rhs.stickers)) return false
  if (!frameStickerBackdropsEqual(lhs.stickerBackdrop, rhs.stickerBackdrop)) return false
  if (!ignoringCursor && !frameCursorsEqual(lhs.cursor, rhs.cursor)) return false
  return previewLayerOrdersMatch(lhs.layerOrder, rhs.layerOrder, ignoringCursor)
}

/**
 * Swift L121-126：层序比较（可跳过 cursor）。
 *
 * 跳过时必须**逐项对齐**而不是先各自过滤再比 —— 过滤会丢失相对位置，
 * 让 `[screen, cursor, camera]` 与 `[screen, camera]` 被判成相等（这是对的），
 * 但也让 `[cursor, screen, camera]` 与 `[screen, camera]` 相等（这也是对的），
 * 而 `[screen, camera, cursor]` 与 `[camera, screen]` 必须不等。
 */
export function previewLayerOrdersMatch(
  lhs: readonly FrameLayerRole[],
  rhs: readonly FrameLayerRole[],
  ignoringCursor: boolean
): boolean {
  if (!ignoringCursor) {
    if (lhs.length !== rhs.length) return false
    return lhs.every((role, index) => role === rhs[index])
  }
  let lhsIndex = 0
  let rhsIndex = 0
  for (;;) {
    while (lhsIndex < lhs.length && lhs[lhsIndex] === 'cursor') lhsIndex += 1
    while (rhsIndex < rhs.length && rhs[rhsIndex] === 'cursor') rhsIndex += 1
    if (lhsIndex === lhs.length || rhsIndex === rhs.length) {
      return lhsIndex === lhs.length && rhsIndex === rhs.length
    }
    if (lhs[lhsIndex] !== rhs[rhsIndex]) return false
    lhsIndex += 1
    rhsIndex += 1
  }
}

/** Swift L132-154：光标覆盖层的外观签名（不含位置）。 */
export interface PreviewCursorOverlayAppearance {
  readonly assetID: CursorAssetID
  readonly shadow: FrameShadow | null
  readonly clickColor: HexColor
  readonly clickStyle: CursorClickEffectStyle
  readonly clickOpacity: number
  readonly clickScale: number
  readonly clickDiameter: number
  readonly clickLineWidth: number
}

/** Swift L158-168：位图缓存键（只看形状与像素尺寸，不看位置）。 */
export interface PreviewCursorContentsSignature {
  readonly assetID: CursorAssetID
  readonly width: number
  readonly height: number
}

/**
 * Swift L169-172：`max(ceil(value − 0.000001), 1)`。
 *
 * 旋转/投影的基向量算术会把 110 像素算成 110.00000000000003，
 * 直接 `ceil` 会变成 111 并额外分配一张位图。减去 1e-6 只吃掉这种误差，
 * 真正的 110.5 仍然进到 111。
 */
export function previewCursorPixelDimension(value: number): number {
  if (!Number.isFinite(value) || !(value > 0)) return 1
  return Math.max(Math.ceil(value - 0.000_001), 1)
}

/** Swift L177-215：光标位图 LRU。 */
export const PREVIEW_CURSOR_BITMAP_COUNT_LIMIT = 12
export const PREVIEW_CURSOR_BITMAP_COST_LIMIT = 2 * 1024 * 1024

export interface PreviewCursorBitmapEntry {
  readonly signature: PreviewCursorContentsSignature
  readonly cost: number
}

/**
 * Swift L177-215 的顺序语义：
 *   - 命中时把条目**移到末尾**（LRU 的「最近使用」位）
 *   - 单条目超过成本上限时不缓存，但仍然返回它（调用方这次要用）
 *   - 插入前先按「条数已满」或「加上就超成本」淘汰最旧
 */
export class PreviewCursorBitmapCache {
  private readonly entries: PreviewCursorBitmapEntry[] = []
  private totalCost = 0

  get count(): number {
    return this.entries.length
  }

  get cost(): number {
    return this.totalCost
  }

  keys(): string[] {
    return this.entries.map((entry) => cursorBitmapKey(entry.signature))
  }

  /** `make` 只在未命中时调用；返回 null 表示这一帧没有可用位图。 */
  image(
    signature: PreviewCursorContentsSignature,
    make: () => { readonly cost: number } | null
  ): { readonly cost: number } | null {
    const index = this.entries.findIndex((entry) =>
      signaturesEqual(entry.signature, signature)
    )
    if (index >= 0) {
      const [entry] = this.entries.splice(index, 1)
      this.entries.push(entry!)
      return { cost: entry!.cost }
    }
    const made = make()
    if (made == null) return null
    if (made.cost > PREVIEW_CURSOR_BITMAP_COST_LIMIT) return made
    while (
      this.entries.length >= PREVIEW_CURSOR_BITMAP_COUNT_LIMIT ||
      this.totalCost + made.cost > PREVIEW_CURSOR_BITMAP_COST_LIMIT
    ) {
      const evicted = this.entries.shift()
      if (evicted == null) break
      this.totalCost -= evicted.cost
    }
    this.entries.push({ signature, cost: made.cost })
    this.totalCost += made.cost
    return made
  }

  reset(): void {
    this.entries.length = 0
    this.totalCost = 0
  }
}

/** 缓存键的字符串形式（便于断言）。 */
export function cursorBitmapKey(signature: PreviewCursorContentsSignature): string {
  return `${signature.assetID}@${signature.width}x${signature.height}`
}

/**
 * Swift L222-283：不随时间变化的背景图缓存。
 *
 * 三种情况**清空**缓存并返回 null：
 *   - `dynamicFlow`：相位随时间变，缓存没有意义
 *   - 视频背景：每一帧都是新解码的 4K 图像，`insertingIntermediate(cache:)`
 *     会给每个显示帧建一个缓存中间体，反而和屏幕/相机合成抢带宽
 * 其余（pattern / 图片）按 `(scene, canvasSize, wallpaperRevision)` 命中。
 *
 * `canvasSize` 必须进键：同样一张背景图在 1080p 与 4K 画布上的模糊半径
 * 换算结果不同，只按 scene 命中会拿到错误尺寸的中间体。
 */
export interface PreviewPreparedBackgroundKey {
  readonly scene: FrameScene['background']
  readonly canvasSize: CompositionSize
  readonly wallpaperRevision: number
}

export class PreviewPreparedBackgroundCache {
  private key: PreviewPreparedBackgroundKey | null = null
  private cached = false

  get isCached(): boolean {
    return this.cached
  }

  /** 返回 true 表示可以复用上一张（调用方不必重建图）。 */
  image(input: PreviewPreparedBackgroundKey): 'reuse' | 'rebuild' | 'bypass' {
    if (input.scene.source.kind === 'dynamicFlow') {
      this.reset()
      return 'bypass'
    }
    if (backgroundSourceIsVideo(input.scene.source)) {
      this.reset()
      return 'bypass'
    }
    if (this.key != null && this.cached && backgroundKeysEqual(this.key, input)) {
      return 'reuse'
    }
    this.key = input
    this.cached = true
    return 'rebuild'
  }

  reset(): void {
    this.key = null
    this.cached = false
  }
}

/** Swift L285-289。 */
export interface PreviewPresentationEpoch {
  readonly mediaGeneration: number | null
  readonly discontinuityID: number | null
  readonly isPlaying: boolean
}

/**
 * Swift L297-317：相机帧连续性。
 *
 * 媒体代次变化是硬边界（换素材必须等新帧）；不连续 id 变化时**暂停态可以
 * 复用上一帧** —— 暂停下的 seek 会立刻求值目标场景，而相机的确切帧是异步
 * 到达的，此时露出只有屏幕的一帧会闪。播放态则不接受过期的不连续 id。
 */
export function canUseCachedPreviewFrame(input: {
  readonly cachedMediaGeneration: number | null
  readonly cachedDiscontinuityID: number | null
  readonly currentMediaGeneration: number
  readonly currentDiscontinuityID: number
  readonly presentationIsPaused: boolean
}): boolean {
  if (input.cachedMediaGeneration !== input.currentMediaGeneration) return false
  return (
    input.cachedDiscontinuityID === input.currentDiscontinuityID || input.presentationIsPaused
  )
}

/**
 * Swift L308-316：相机还没到时要不要**整帧挂住**。
 *
 * 三个条件同时成立才挂：期望有相机、当前没有相机帧、且相机在场景里
 * 确实有可见不透明度（> 0.001）。少了第三条会让「相机层完全透明」的
 * 项目永远等一个永远不会来的帧。
 */
export function shouldHoldPresentedFrame(input: {
  readonly cameraOpacity: number | null
  readonly cameraIsExpected: boolean
  readonly hasCameraFrame: boolean
}): boolean {
  return (
    input.cameraIsExpected &&
    !input.hasCameraFrame &&
    (input.cameraOpacity ?? 0) > 0.001
  )
}

/**
 * Swift L319-328：是否暂停预览。
 *
 * `isApplicationActive` 默认 true —— 只有明确传 false 才算「失活」。
 */
export function shouldSuspendPreviewPresentation(input: {
  readonly hasWindow: boolean
  readonly isMiniaturized: boolean
  readonly isVisible: boolean
  readonly isApplicationActive?: boolean
}): boolean {
  const active = input.isApplicationActive ?? true
  return !input.hasWindow || input.isMiniaturized || !input.isVisible || !active
}

/**
 * Swift L330-344：允许拆卸背衬图层。
 *
 * 三条同时成立：代次仍是最新（期间没有恢复或发起新的退役）、当前处于挂起态、
 * 且那个图层仍然是「我」的。第三条防的是「窗口已经换成新图层，旧的退役请求
 * 才落地」。
 */
export function shouldFinalizePreviewLayerRetirement(input: {
  readonly requestedGeneration: number
  readonly latestGeneration: number
  readonly isSuspended: boolean
  readonly ownsRequestedLayer: boolean
}): boolean {
  return (
    input.requestedGeneration === input.latestGeneration &&
    input.isSuspended &&
    input.ownsRequestedLayer
  )
}

/** Swift L347-352：暂停帧只允许 1 个在飞，播放帧按配置（至少 1）。 */
export function previewMaximumInFlight(input: {
  readonly isPausedFrame: boolean
  readonly playbackLimit: number
}): number {
  return input.isPausedFrame ? 1 : Math.max(input.playbackLimit, 1)
}

/**
 * Swift L354-360：渲染前丢弃。
 *
 * **只有暂停帧**能因代次不符被丢弃。播放帧一旦也这么判，就会把刚排队的
 * 中间帧全丢掉，60 Hz 预览掉到 ~45 fps（这正是上游注释里记的那个 bug）。
 */
export function previewShouldDiscardBeforeRendering(input: {
  readonly isPausedFrame: boolean
  readonly generation: number
  readonly latestGeneration: number
}): boolean {
  return input.isPausedFrame && input.generation !== input.latestGeneration
}

/**
 * Swift L362-372：呈现前判定。
 *
 * 这里用的是 **epoch** 而不是 generation：同一次播放区间内的 epoch 不变，
 * 所以中间帧都能呈现；暂停/跳转/换素材会换 epoch，旧帧必须让位。
 */
export function previewShouldPresent(input: {
  readonly jobEpochID: number
  readonly latestEpochID: number
}): boolean {
  return input.jobEpochID === input.latestEpochID
}

/**
 * Swift L391-407：光标能否独立成 CALayer。
 *
 * 三条否决：
 *   1. 贴图正在抑制屏幕（`screenSuppression > 0`）—— 光标属于被抑制的录制内容，
 *      留在合成里才能随贴图一起被盖住
 *   2. 有聚光层 —— 「以下全部压暗」必须只有一个视觉结果
 *   3. 屏幕有 3D 投影时，只有存在相机层才需要保留栅格合成
 *      否则（无投影）看光标矩形是否与更靠后的相机层相交
 */
export function canSeparatePreviewCursor(input: {
  readonly screenSuppression: number
  readonly layerOrder: readonly FrameLayerRole[]
  readonly isIdentityProjection: boolean
  readonly hasCamera: boolean
  readonly cursorIntersectsLaterCamera: boolean
}): boolean {
  if (input.screenSuppression > 0) return false
  if (input.layerOrder.includes('spotlight')) return false
  return input.isIdentityProjection
    ? !input.cursorIntersectsLaterCamera
    : !input.hasCamera
}

/** 一个矩形（光标 / 相机）。 */
export interface PreviewLayerRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** 矩形并集（Swift `CGRect.union`）。 */
export function previewRectUnion(a: PreviewLayerRect, b: PreviewLayerRect): PreviewLayerRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

/** 矩形外扩（Swift `insetBy(dx: -d, dy: -d)`）。 */
export function previewRectInsetBy(rect: PreviewLayerRect, delta: number): PreviewLayerRect {
  return {
    x: rect.x - delta,
    y: rect.y - delta,
    width: rect.width + delta * 2,
    height: rect.height + delta * 2,
  }
}

/** 矩形平移。 */
export function previewRectOffsetBy(rect: PreviewLayerRect, dx: number, dy: number): PreviewLayerRect {
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height }
}

/** 两矩形是否相交（Swift `CGRect.intersects`）。 */
export function previewRectsIntersect(a: PreviewLayerRect, b: PreviewLayerRect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

/**
 * Swift L414-462：光标是否与「更靠后的相机层」相交。
 *
 * 六条前置：有光标、有相机、相机不透明度 > 0、光标索引 < 相机索引。
 * 之后把光标矩形扩成**完整视觉足迹**：
 *   - 形状矩形
 *   - 点击涟漪：`max(clickDiameter, clickEffectHeight × 2.5) × clickScale` 的圆
 *   - 阴影：平移后按 `radius` 外扩
 * 相机矩形同样按描边外扩、按阴影外扩。
 *
 * 这个判定的意义：分离光标（SwiftUI 层）在栅格表面之上，只有当它的完整
 * 足迹不与更靠后的相机层重叠时才与「合成在一起」等价。
 */
export function previewCursorIntersectsLaterCamera(input: {
  readonly cursor: {
    readonly layout: {
      readonly origin: { readonly x: number; readonly y: number }
      readonly size: { readonly width: number; readonly height: number }
      readonly pointer: { readonly x: number; readonly y: number }
      readonly clickDiameter: number
      readonly clickEffectHeight: number
      readonly clickLineWidth: number
    }
    readonly isClicking: boolean
    readonly clickScale: number
    readonly shadow: { readonly opacity: number; readonly radius: number; readonly offset: { readonly x: number; readonly y: number } } | null
  } | null
  readonly camera: {
    readonly rect: PreviewLayerRect
    readonly borderWidth: number
    readonly opacity: number
    readonly shadow: { readonly opacity: number; readonly radius: number; readonly offset: { readonly x: number; readonly y: number } } | null
  } | null
  readonly layerOrder: readonly FrameLayerRole[]
}): boolean {
  const cursor = input.cursor
  const camera = input.camera
  if (cursor == null || camera == null) return false
  if (!(camera.opacity > 0)) return false
  const cursorIndex = input.layerOrder.indexOf('cursor')
  const cameraIndex = input.layerOrder.indexOf('camera')
  if (cursorIndex < 0 || cameraIndex < 0) return false
  if (!(cursorIndex < cameraIndex)) return false

  let cursorRect: PreviewLayerRect = {
    x: cursor.layout.origin.x,
    y: cursor.layout.origin.y,
    width: cursor.layout.size.width,
    height: cursor.layout.size.height,
  }
  if (cursor.isClicking) {
    const footprint =
      Math.max(cursor.layout.clickDiameter, cursor.layout.clickEffectHeight * 2.5) *
      cursor.clickScale
    const radius = footprint / 2
    cursorRect = previewRectUnion(cursorRect, {
      x: cursor.layout.pointer.x - radius,
      y: cursor.layout.pointer.y - radius,
      width: radius * 2,
      height: radius * 2,
    })
  }
  if (cursor.shadow != null && cursor.shadow.opacity > 0) {
    cursorRect = previewRectUnion(
      cursorRect,
      previewRectInsetBy(
        previewRectOffsetBy(cursorRect, cursor.shadow.offset.x, cursor.shadow.offset.y),
        cursor.shadow.radius
      )
    )
  }

  // Swift `insetBy(dx: -borderWidth)` 是**外扩**；本项目的 previewRectInsetBy
  // 用的是相反符号约定（正数 = 外扩），所以这里传正的 borderWidth。
  let cameraRect = previewRectInsetBy(camera.rect, camera.borderWidth)
  if (camera.shadow != null && camera.shadow.opacity > 0) {
    cameraRect = previewRectUnion(
      cameraRect,
      previewRectInsetBy(
        previewRectOffsetBy(cameraRect, camera.shadow.offset.x, camera.shadow.offset.y),
        camera.shadow.radius
      )
    )
  }
  return previewRectsIntersect(cursorRect, cameraRect)
}

/**
 * Swift L468-490：光栅化用的计划。
 *
 * 两处清空是刻意的：`presentationTime` 与 `outputDuration` 归 0 ——
 * 预览的 raster 不携带输出时序，否则同一画面在不同呈现时刻会被判成不同帧。
 * **保留 `scene.time`**：静态场景忽略它，但动态背景把它当可见相位用。
 *
 * 分离光标时把 `cursor` 置 null 并从 `layerOrder` 里移除。
 */
export function previewRasterPlan(plan: FrameRenderPlan, separatesCursor: boolean): FrameRenderPlan {
  const layerOrder = separatesCursor
    ? plan.scene.layerOrder.filter((role) => role !== 'cursor')
    : plan.scene.layerOrder.slice()
  return {
    presentationTime: 0,
    outputDuration: 0,
    frameRate: plan.frameRate,
    scene: {
      ...plan.scene,
      cursor: separatesCursor ? null : plan.scene.cursor,
      layerOrder,
    },
  }
}

// ---------------------------------------------------------------- 内部比较器

function sizesEqual(a: CompositionSize, b: CompositionSize): boolean {
  return a.width === b.width && a.height === b.height
}

function colorContractsEqual(
  a: FrameColorContractRef | null,
  b: FrameColorContractRef | null
): boolean {
  if (a == null || b == null) return a == null && b == null
  return a.identifier === b.identifier
}

function signaturesEqual(
  a: PreviewCursorContentsSignature,
  b: PreviewCursorContentsSignature
): boolean {
  return a.assetID === b.assetID && a.width === b.width && a.height === b.height
}

function backgroundKeysEqual(
  a: PreviewPreparedBackgroundKey,
  b: PreviewPreparedBackgroundKey
): boolean {
  return (
    a.wallpaperRevision === b.wallpaperRevision &&
    sizesEqual(a.canvasSize, b.canvasSize) &&
    a.scene.source.kind === b.scene.source.kind &&
    a.scene.blurRadius === b.scene.blurRadius &&
    a.scene.patternScale === b.scene.patternScale &&
    a.scene.patternOpacity === b.scene.patternOpacity
  )
}

function frameColorsEqual(a: FrameScene['color'], b: FrameScene['color']): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function frameBackgroundsEqual(
  a: FrameScene['background'],
  b: FrameScene['background']
): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function frameScreensEqual(a: FrameScene['screen'], b: FrameScene['screen']): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function frameCamerasEqual(
  a: FrameScene['camera'],
  b: FrameScene['camera']
): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function frameCursorsEqual(
  a: FrameScene['cursor'],
  b: FrameScene['cursor']
): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function frameStickersEqual(
  a: FrameScene['stickers'],
  b: FrameScene['stickers']
): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function frameStickerBackdropsEqual(
  a: FrameScene['stickerBackdrop'],
  b: FrameScene['stickerBackdrop']
): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
