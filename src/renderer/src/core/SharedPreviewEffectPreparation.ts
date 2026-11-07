/**
 * Swift source: Sources/DogSCApp/SharedPreviewEffectPreparation.swift（127 行）@ 567fd6e
 *
 * L8-45   → PreviewEffectPrewarmSignature：分支 / 输出尺寸 / 资源可用性构成身份
 * L47-83  → scheduleEffectPreparation：延迟 0.12s、每次空闲只跑一个图、签名上限 16
 * L85-112 → prepareEffect：渲染 → 建纹理 → prepareRender；失败保留可见渲染兜底
 * L114-126→ previewDestinationImage：缩小用 Lanczos，否则仿射缩放
 *
 * 原注释：分支、输出尺寸与资源可用性才是图的身份。**不要**拿每个动画坐标做键 ——
 * 那会让每一个滑块 tick 都重新预热一次。
 */

/** 空闲预热延迟（Swift L59 `+ 0.12`）。 */
export const EFFECT_PREWARM_DELAY = 0.12

/** 签名历史上限（Swift L182），超了整批清空而不是逐条淘汰。 */
export const EFFECT_PREWARM_SIGNATURE_LIMIT = 16

/** 纹理最小边长（Swift L206-207 `max(..., 2)`）。 */
export const EFFECT_PREWARM_MINIMUM_SIDE = 2

/** 缩放除零保护（Swift L234 `max(scaleY, 0.0001)`）。 */
export const EFFECT_PREWARM_MINIMUM_SCALE = 0.0001

export interface PreviewRenderSceneLike {
  readonly canvasSize: { readonly width: number; readonly height: number }
  readonly screen: {
    readonly decoration: 'chrome' | 'none' | string
    readonly cornerRadius: number
    readonly borderWidth: number
    readonly shadowOpacity: number
    readonly opacity: number
    readonly hasFocusEffect: boolean
    readonly isIdentityProjection: boolean
    readonly mosaics: readonly { readonly style: string }[]
  }
  readonly cursorPresent: boolean
  readonly camera: {
    readonly opacity: number
    readonly borderWidth: number
    readonly shadowOpacity: number
  } | null
  readonly backgroundBlurRadius: number
  readonly stickerBackdrop: {
    readonly screenBlur: number
    readonly cameraBlur: number
    readonly screenSuppression: number
    readonly cameraSuppression: number
  }
  readonly stickers: readonly {
    readonly relativePath: string
    readonly cornerRadius: number
    readonly borderWidth: number
    readonly shadowOpacity: number
    readonly backdropBlur: number
    readonly opacity: number
    readonly rotationRadians: number
    readonly scale: number
  }[]
}

export interface PreviewResourceAvailability {
  readonly hasCursor: boolean
  readonly hasCamera: boolean
  readonly stickerPaths: readonly string[]
}

export interface PreviewEffectPrewarmKey {
  readonly width: number
  readonly height: number
  readonly branches: readonly boolean[]
  readonly mosaicStyles: readonly string[]
  readonly stickerBranches: readonly (readonly boolean[])[]
}

/**
 * 签名（Swift L127-156）：只取「会切换渲染分支」的量。
 *
 * 17 个布尔全是有无分支（投影 / 窗框 / 圆角 / 描边 / 阴影 / 半透明 / 焦点效果 /
 * 光标资源 / 摄像头资源 / 摄像头描边 / 摄像头阴影 / 摄像头半透明 / 背景模糊 /
 * 贴图四种 backdrop），而不是具体数值 —— 数值变化只改参数，不改图结构。
 */
export function previewEffectPrewarmKey(input: {
  readonly scene: PreviewRenderSceneLike
  readonly resources: PreviewResourceAvailability
  readonly destinationSize: { readonly width: number; readonly height: number }
}): PreviewEffectPrewarmKey {
  const scene = input.scene
  const screen = scene.screen
  const branches = [
    !screen.isIdentityProjection,
    screen.decoration === 'chrome',
    screen.cornerRadius > 0,
    screen.borderWidth > 0,
    screen.shadowOpacity > 0,
    screen.opacity > 0 && screen.opacity < 1,
    screen.hasFocusEffect,
    scene.cursorPresent && input.resources.hasCursor,
    (scene.camera?.opacity ?? 0) > 0 && input.resources.hasCamera,
    (scene.camera?.borderWidth ?? 0) > 0,
    (scene.camera?.shadowOpacity ?? 0) > 0,
    (scene.camera?.opacity ?? 1) < 1,
    scene.backgroundBlurRadius > 0,
    scene.stickerBackdrop.screenBlur > 0,
    scene.stickerBackdrop.cameraBlur > 0,
    scene.stickerBackdrop.screenSuppression > 0,
    scene.stickerBackdrop.cameraSuppression > 0,
  ]
  return {
    width: Math.round(input.destinationSize.width),
    height: Math.round(input.destinationSize.height),
    branches,
    mosaicStyles: screen.mosaics.map((mosaic) => mosaic.style),
    stickerBranches: scene.stickers.map((sticker) => [
      sticker.cornerRadius > 0,
      sticker.borderWidth > 0,
      sticker.shadowOpacity > 0,
      sticker.backdropBlur > 0,
      sticker.opacity < 1,
      Math.abs(sticker.rotationRadians) > 0.001,
      input.resources.stickerPaths.includes(sticker.relativePath),
      sticker.opacity > 0 && sticker.scale > 0,
    ]),
  }
}

/** 签名比较用的稳定字符串（UI 侧用 Map 去重）。 */
export function previewEffectPrewarmKeyString(key: PreviewEffectPrewarmKey): string {
  return [
    `${key.width}x${key.height}`,
    key.branches.map((flag) => (flag ? '1' : '0')).join(''),
    key.mosaicStyles.join('|'),
    key.stickerBranches.map((row) => row.map((flag) => (flag ? '1' : '0')).join('')).join('/'),
  ].join('#')
}

/**
 * 预热前的过期检查（Swift L63-67 / L186-189）：代次、呈现纪元、色彩契约三者
 * 都要「还是当前」，任一变就丢弃这次预热 —— 否则会把旧场景的 kernel 预热到
 * 新场景要用的上下文里，白花时间还可能贴错图。
 */
export function effectPrewarmIsCurrent(input: {
  readonly jobGeneration: number
  readonly renderGeneration: number
  readonly jobEpoch: number
  readonly presentationEpoch: number
  readonly jobColorContract: string
  readonly queueColorContract: string
}): boolean {
  return (
    input.jobGeneration === input.renderGeneration &&
    input.jobEpoch === input.presentationEpoch &&
    input.jobColorContract === input.queueColorContract
  )
}

/** 签名集合维护策略（Swift L179-191）：命中则跳过；满了先整批清空再插入。 */
export function effectSignatureSetAction(input: {
  readonly alreadyPrepared: boolean
  readonly size: number
}): 'skip' | 'clearAndInsert' | 'insert' {
  if (input.alreadyPrepared) return 'skip'
  return input.size >= EFFECT_PREWARM_SIGNATURE_LIMIT ? 'clearAndInsert' : 'insert'
}

/**
 * 目标缩放（Swift L114-126）：两轴都小于 1（缩小）走 Lanczos —— 缩小时双线性会
 * 产生锯齿；否则直接仿射缩放（放大/等大时 Lanczos 只是更慢）。
 */
export function previewDestinationScale(input: {
  readonly canvasSize: { readonly width: number; readonly height: number }
  readonly bounds: { readonly width: number; readonly height: number }
}): { readonly scaleX: number; readonly scaleY: number; readonly usesLanczos: boolean; readonly aspectRatio: number } {
  const scaleX = input.bounds.width / Math.max(input.canvasSize.width, 2)
  const scaleY = input.bounds.height / Math.max(input.canvasSize.height, 2)
  const usesLanczos = scaleX < 1 && scaleY < 1
  return {
    scaleX,
    scaleY,
    usesLanczos,
    aspectRatio: usesLanczos ? scaleX / Math.max(scaleY, EFFECT_PREWARM_MINIMUM_SCALE) : 1,
  }
}

/** 纹理描述（Swift L208-212）：bgra8Unorm / private 存储 / 渲染目标+读写。 */
export const EFFECT_PREWARM_TEXTURE = {
  pixelFormat: 'bgra8Unorm',
  storageMode: 'private',
  usage: ['renderTarget', 'shaderRead', 'shaderWrite'],
  isFlipped: true,
} as const
