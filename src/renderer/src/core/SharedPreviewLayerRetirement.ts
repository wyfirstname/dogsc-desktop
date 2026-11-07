/**
 * SharedPreviewLayerRetirement —— 预览层的后台退役与恢复重建。
 *
 * Swift source: Sources/DogSCApp/SharedPreviewLayerRetirement.swift（204 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L9-17    PreviewLayerRetirementRequest（weak layer + generation）
 *   L22      extension SharedRenderedPreviewNSView
 *   L23-27   makePreviewMetalLayer
 *   L37-55   configurePreviewMetalLayer（九个字段）
 *   L63-94   suspendPreviewBackingLayer（摘五个子层 → 2×2 退役 drawable）
 *   L100-143 presentTinyRetirementDrawable（四步 guard + 清屏）
 *   L145-155 finishTinyRetirementDrawable
 *   L157-173 finalizePreviewBackingLayerRetirement
 *   L178-203 installPreviewBackingLayerIfNeeded（复原九个字段 + 按原序挂回子层）
 *
 * 迁移说明：
 *   CAMetalLayer / CATransaction 在 Electron 里不存在。这里保留的纯逻辑是：
 *     1. 一份**完整的图层配置表**（九个字段的常量）—— 这是「恢复后不黑屏」
 *        的唯一依据，两个方向（创建 / 修复）用的是同一份。
 *     2. 退役 drawable 的尺寸常量 2×2，以及清屏颜色（全 0，含 alpha）。
 *     3. 子层挂载/摘除的**同一顺序**：摘的时候从渐变到图像，挂回去也按这个序。
 *     4. 退役流程的四步 bail 判定（哪一步失败都要落到同一个收尾）。
 *     5. 「恢复时必须重新应用配置」的原因 —— AppKit 会还回同一个被剥光
 *        device 的图层对象，而不是调 makeBackingLayer()。
 */

/**
 * Swift L37-55：`configurePreviewMetalLayer` 写入的九个字段。
 *
 * `maximumDrawableCount = 3` 与 `displaySyncEnabled = false` 是一对：
 * 播放节奏已经由 display link 管着，再叠一层 CAMetalLayer 自己的 vblank 门，
 * 会三个 drawable 全被压到呈现完成 —— 120 Hz 桌面上 60 Hz 产线实测只剩
 * 43–46 fps。
 */
export interface PreviewMetalLayerConfiguration {
  readonly pixelFormat: 'bgra8Unorm'
  readonly framebufferOnly: boolean
  readonly maximumDrawableCount: number
  readonly displaySyncEnabled: boolean
  readonly presentsWithTransaction: boolean
  readonly allowsNextDrawableTimeout: boolean
  readonly isOpaque: boolean
  readonly backgroundColor: 'clear'
  /** L41-43：Core Image 需要往纹理里写，所以必须放开 framebufferOnly。 */
  readonly acceptsCoreImageRendering: boolean
}

export const PREVIEW_METAL_LAYER_CONFIGURATION: PreviewMetalLayerConfiguration = {
  pixelFormat: 'bgra8Unorm',
  framebufferOnly: false,
  maximumDrawableCount: 3,
  displaySyncEnabled: false,
  presentsWithTransaction: false,
  allowsNextDrawableTimeout: true,
  isOpaque: false,
  backgroundColor: 'clear',
  acceptsCoreImageRendering: true,
}

/**
 * Swift L38-40：`if layer.device == nil { layer.device = MTLCreateSystemDefaultDevice() }`。
 *
 * 只在缺失时补，绝不覆盖已有 device —— 覆盖会把还活着的队列一起拔掉。
 */
export function previewMetalLayerNeedsDeviceRepair(input: {
  readonly hasDevice: boolean
}): boolean {
  return !input.hasDevice
}

/**
 * Swift L29-36 / L187-192：从后台回来时，AppKit 会把**同一个**图层对象还回来。
 *
 * 那个对象身上留着退役时留下的三处伤痕：`device = nil`、2×2 的 drawable、
 * `isHidden = true`。不重新跑一遍完整配置，第一次恢复渲染就会因为缺 device
 * 直接 bail，窗口保持全黑。
 */
export function previewRestoredLayerNeedsFullReconfigure(input: {
  readonly isMetalLayer: boolean
  readonly hasDevice: boolean
  readonly drawableWidth: number
  readonly drawableHeight: number
  readonly isHidden: boolean
}): boolean {
  if (!input.isMetalLayer) return false
  return (
    !input.hasDevice ||
    input.drawableWidth <= 2 ||
    input.drawableHeight <= 2 ||
    input.isHidden
  )
}

/** Swift L109：退役用 2×2 的 drawable。 */
export const PREVIEW_RETIREMENT_DRAWABLE_SIZE = { width: 2, height: 2 } as const

/**
 * Swift L125-130：`MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)`。
 *
 * alpha 必须是 0（全透明），否则 WindowServer 留下的快照是一块黑矩形。
 */
export const PREVIEW_RETIREMENT_CLEAR_COLOR = {
  red: 0,
  green: 0,
  blue: 0,
  alpha: 0,
} as const

/**
 * Swift L71-75（摘除）与 L197-201（挂回）用的是同一份子层清单与同一顺序。
 *
 * 顺序即 z 序：点击涟漪的渐变在最底，光标图像在最上。把两份清单写成两个常量
 * 是这类文件最容易漂移的地方 —— 摘的时候顺序错了不要紧，挂回去错了就会
 * 出现「光标被涟漪盖住」。
 */
export const PREVIEW_CURSOR_SUBLAYER_ORDER: readonly string[] = [
  'cursorClickGradientLayer',
  'cursorClickSecondaryLayer',
  'cursorClickAccentLayer',
  'cursorClickLayer',
  'cursorImageLayer',
]

/** Swift L197-201：恢复时按上面的顺序重新 addSublayer。 */
export function previewRestoreSublayerOrder(): readonly string[] {
  return PREVIEW_CURSOR_SUBLAYER_ORDER
}

/** Swift L71-75：退役时按**同一个**顺序 removeFromSuperlayer。 */
export function previewRetireSublayerOrder(): readonly string[] {
  return PREVIEW_CURSOR_SUBLAYER_ORDER
}

/**
 * Swift L63-94：`suspendPreviewBackingLayer` 的三条出路。
 *
 *  - `ignore`      —— 本来就没有 layer，什么都不做（L64 的 guard）。
 *  - `retire-metal` —— 是 CAMetalLayer：隐藏它、摘子层、排队画 2×2。
 *  - `drop-layer`   —— 不是 Metal layer：直接把 wantsLayer 关掉（L89-91）。
 *
 * 第三条容易被漏：非 Metal 的背衬图层没有 IOSurface 可释放，关掉 wantsLayer
 * 就够了，走 2×2 那套反而会留下一个隐藏的空图层。
 */
export type PreviewSuspendOutcome = 'ignore' | 'retire-metal' | 'drop-layer'

export function previewSuspendBackingLayerDecision(input: {
  readonly wantsLayer: boolean
  readonly isMetalLayer: boolean
}): PreviewSuspendOutcome {
  if (!input.wantsLayer) return 'ignore'
  return input.isMetalLayer ? 'retire-metal' : 'drop-layer'
}

/**
 * Swift L100-143：`presentTinyRetirementDrawable` 的四步 bail。
 *
 * 每一步失败都走 `finishTinyRetirementDrawable` —— 也就是说**无论如何都会**
 * 收尾（把 wantsLayer 关掉、device 置空）。区别只在于有没有真的画上那个
 * 2×2。返回 `'proceed'` 是唯一会 encoder/commit 的分支。
 */
export type PreviewTinyRetirementStep =
  | 'stale-generation'
  | 'layer-deallocated'
  | 'missing-device'
  | 'drawable-unavailable'
  | 'encoder-unavailable'
  | 'proceed'

export function previewTinyRetirementStep(input: {
  readonly generationMatches: boolean
  readonly layerAlive: boolean
  readonly hasDevice: boolean
  readonly drawableAcquired: boolean
  readonly hasCommandQueue: boolean
  readonly hasCommandBuffer: boolean
  readonly encoderAvailable: boolean
}): PreviewTinyRetirementStep {
  if (!input.generationMatches) return 'stale-generation'
  if (!input.layerAlive) return 'layer-deallocated'
  if (!input.hasDevice) return 'missing-device'
  if (!input.drawableAcquired || !input.hasCommandQueue || !input.hasCommandBuffer) {
    return 'drawable-unavailable'
  }
  if (!input.encoderAvailable) return 'encoder-unavailable'
  return 'proceed'
}

/**
 * Swift L103：代次不符时**直接 return**，连收尾都不做。
 *
 * 这是整个文件里唯一的例外：其余 bail 都会调 finish，只有「代次已经过期」
 * 这条什么都不做 —— 因为新的退役/恢复流程已经在跑，旧请求再收尾会把
 * 新图层一起拆掉。
 */
export function previewTinyRetirementBailsSilently(
  step: PreviewTinyRetirementStep
): boolean {
  return step === 'stale-generation' || step === 'layer-deallocated'
}

/**
 * Swift L157-173：`finalizePreviewBackingLayerRetirement` 的三条件。
 *
 * 与 `shouldFinalizePreviewLayerRetirement`（SharedPreviewFramePipeline）同义，
 * 这里提供一层只吃「是否还是我」的便捷封装，方便退役流程内部自测。
 */
export function previewRetirementCanFinalize(input: {
  readonly requestedGeneration: number
  readonly latestGeneration: number
  readonly isSuspended: boolean
  readonly stillOwnsLayer: boolean
}): boolean {
  return (
    input.requestedGeneration === input.latestGeneration &&
    input.isSuspended &&
    input.stillOwnsLayer
  )
}

/**
 * Swift L181-184 / L66：两条路都先把代次 +1。
 *
 * `installPreviewBackingLayerIfNeeded` 递增代次是为了**取消在飞的退役**：
 * 那个请求落地时代次已经不匹配，于是被静默丢弃。`suspend` 递增是为了让
 * 上一轮在飞的退役失效。两处方向不同、目的相同。
 */
export function previewBumpsRetirementGeneration(
  action: 'suspend' | 'install' | 'invalidate'
): boolean {
  return action !== 'invalidate'
}

/**
 * Swift L178-203：恢复时**先**递增代次，**再**开 wantsLayer，最后才碰 layer。
 *
 * 顺序有实际意义：如果先开 wantsLayer，AppKit 可能立刻把旧图层挂回来并触发
 * 一次渲染，而此时在飞的退役还没被作废。
 */
export const PREVIEW_INSTALL_STEP_ORDER: readonly string[] = [
  'bump-retirement-generation',
  'enable-wants-layer',
  'resolve-metal-layer',
  'reconfigure-metal-layer',
  'set-masks-to-bounds',
  'reattach-cursor-sublayers',
]
