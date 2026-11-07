/**
 * 共享帧合成入口 —— Swift SharedFrameCompositor.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/SharedFrameCompositor.swift（28 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - extent 空判定 guard                                   L13
 *   - resources.preparedBackground ?? backgroundImage(...)  L15-21
 *   - SharedFrameRenderer.render(scene:resources:over:)     L22-25
 *   - .cropped(to: extent)                                  L26
 *
 * 原注释：合成的是「一个已完整求值的输出场景」；运动处理已经在各个运动图层上完成，
 * 合成器**从不重绘帧历史**。这条约束是导出与预览一致的前提 —— 两边都只问
 * 「这一时刻的场景长什么样」，而不是「从上一帧推演」。
 *
 * 迁移说明：`SharedFrameRenderer`（2128 行）尚未转写，因此本文件按端口注入：
 * 背景求值、逐层叠加、裁剪三步都由调用方提供，这里只固定**调用顺序与短路条件**——
 * 顺序一旦改了，`preparedBackground` 的复用就会失效（背景贴图每帧重算是最贵的一步）。
 */

export interface CompositeExtent {
  readonly width: number
  readonly height: number
}

export interface SharedFrameCompositorPorts<TScene, TResources, TImage> {
  /** 上层已经算好的背景（预览可复用同一帧），null 表示必须现算。 */
  readonly preparedBackground: TImage | null
  /** 背景素材（壁纸/视频帧），透传给 `backgroundImage`。 */
  readonly wallpaperSource: unknown
  backgroundImage(args: {
    readonly scene: TScene
    readonly canvasRect: CompositeExtent
    readonly wallpaperSource: unknown
    readonly time: number
  }): TImage | null
  /** 依次叠加所有运动图层；`background` 是合成底。 */
  renderOver(scene: TScene, resources: TResources, background: TImage): TImage
  /** 裁到输出画布。 */
  crop(image: TImage, extent: CompositeExtent): TImage
}

/**
 * Swift `SharedFrameCompositor.composite(_:resources:extent:)`。
 *
 * 返回 null 的唯一条件是 extent 有零/负边 —— 此时下游（编码器）会跳过这一帧，
 * 而不是拿到一张 0×0 图再崩在 CIContext 里。
 */
export function compositeSharedFrame<TScene extends { readonly time: number }, TResources, TImage>(
  plan: { readonly scene: TScene },
  resources: TResources,
  extent: CompositeExtent,
  ports: SharedFrameCompositorPorts<TScene, TResources, TImage>
): TImage | null {
  if (!(extent.width > 0) || !(extent.height > 0)) return null
  const scene = plan.scene
  const background =
    ports.preparedBackground ??
    ports.backgroundImage({
      scene,
      canvasRect: extent,
      wallpaperSource: ports.wallpaperSource,
      time: scene.time,
    })
  if (background == null) return null
  return ports.crop(ports.renderOver(scene, resources, background), extent)
}
