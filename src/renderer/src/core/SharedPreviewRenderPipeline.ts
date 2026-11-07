/**
 * SharedPreviewRenderPipeline —— 预览 drawable 的合成提交与透视预热。
 *
 * Swift source: Sources/DogSCApp/SharedPreviewRenderPipeline.swift（186 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L1-5     import（AVFoundation / CoreImage / Metal / QuartzCore / RecorderCore）
 *   L7-9     文档注释：从 SharedRenderedPreviewSurface.swift 拆出以满足行数预算
 *   L10      extension SharedRenderedPreviewNSView
 *   L14-185  nonisolated func renderDrawable(for:submissionCompletion:presentationCompletion:)
 *   L19-24   timing / renderStarted / didSubmit / defer failed
 *   L29-37   背压丢弃（只丢暂停帧）
 *   L44-47   无 device → submission(false)，**不调** presentation
 *   L48-67   colorContract 变化 → 重建 context / commandQueue / 清预热签名
 *   L68-72   无 context 或 queue → submission(false)
 *   L73-79   render 失败 → submission(false)
 *   L86-99   expectedTexture / displayBounds
 *   L100-101 previewDestinationImage + graphFinished
 *   L107-113 drawable 不存在或尺寸不符 → submission(false) + presentation(false)
 *   L114-126 CIRenderDestination 配置（isFlipped = true）
 *   L127-135 startTask 抛错 → submission(false) + presentation(false)
 *   L136-140 commandBuffer 失败 → submission(false) + presentation(false)
 *   L141-153 epoch 过期 → submission(true) + presentation(false) + commit
 *   L154-165 计时上报 + presentedHandler + collectRenderInfo
 *   L166-173 presentationHostTime 有无决定 present 的两个分支
 *   L174-180 completedHandler → presentationCompletion
 *   L181-184 didSubmit / submissionCompletion(true) / scheduleEffectPreparation
 *
 * 迁移说明：
 *   Metal / CoreImage / CAMetalLayer 在 Electron 里不存在对应物 —— 渲染由
 *   WebGL / Canvas2D 承担。这里只保留**决定正确性**的纯逻辑：
 *     1. 十一步提前返回的完整决策表（哪条路径回调哪个 completion、是否 commit）
 *     2. drawable 纹理尺寸与绘制边界的取整规则（都带 2 的下限）
 *     3. 颜色契约变化时才重建队列并清空预热签名
 *     4. 暂停帧与播放帧在丢弃判定上的不对称
 *   把「回调了什么」当成可断言的输出，是原文件里唯一能在没有 GPU 的情况下
 *   复现的语义。
 */

/** Swift L86-93：期望的 drawable 纹理宽高 —— 四舍五入后下限 2。 */
export function previewDrawableTextureSize(
  destinationPixelSize: { readonly width: number; readonly height: number }
): { readonly width: number; readonly height: number } {
  return {
    width: Math.max(Math.round(destinationPixelSize.width), 2),
    height: Math.max(Math.round(destinationPixelSize.height), 2),
  }
}

/**
 * Swift L94-99：CI 的绘制边界。
 *
 * 注意与上面**不同**：这里用 `max(w, 2)` 而不是「先四舍五入再取下限」。
 * 于是 1.4 像素的目标 → 纹理 2 像素、绘制边界 2 像素；但 2.4 像素的目标 →
 * 纹理 2 像素、绘制边界 2.4 像素。两者刻意不相等，别合并成一个函数。
 */
export function previewDrawableDisplayBounds(
  destinationPixelSize: { readonly width: number; readonly height: number }
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  return {
    x: 0,
    y: 0,
    width: Math.max(destinationPixelSize.width, 2),
    height: Math.max(destinationPixelSize.height, 2),
  }
}

/** Swift L48：`queueColorContract != job.colorContract`，其中初值是 nil。 */
export function previewColorContractDidChange(input: {
  readonly currentContract: string | null
  readonly incomingContract: string
}): boolean {
  return input.currentContract == null || input.currentContract !== input.incomingContract
}

/**
 * Swift L29-33 / L44-184：一次 `renderDrawable` 的完整决策。
 *
 * 输入是一串**渐进事实**，顺序与原函数的 guard 顺序一一对应。返回的四个布尔
 * 就是「这次调用对外的全部副作用」—— 在原实现里它们散落在十一个返回点上。
 */
export type PreviewDrawableOutcome =
  /** L29-37：暂停帧已被更新的代次取代。 */
  | 'discarded-stale-paused'
  /** L44-47：layer 没有 device（被退役过、或装配失败）。 */
  | 'missing-device'
  /** L57-60：颜色契约变了，但拿不到新的命令队列。 */
  | 'missing-command-queue'
  /** L68-72：约定了契约但 context/queue 尚未就绪。 */
  | 'missing-context'
  /** L73-79：整帧合成失败。 */
  | 'render-failed'
  /** L107-113：drawable 拿不到，或尺寸与当前 surface 不符。 */
  | 'drawable-unavailable'
  /** L131-135：Core Image 拒绝开始任务。 */
  | 'render-task-failed'
  /** L136-140：提交阶段的命令缓冲分配失败。 */
  | 'command-buffer-unavailable'
  /** L141-153：work 已编码但 epoch 已退役，允许跑完、绝不上屏。 */
  | 'retired-epoch'
  /** L154-184：正常呈递。 */
  | 'presented'

export interface PreviewDrawableDecision {
  readonly outcome: PreviewDrawableOutcome
  /** 是否调用 `submissionCompletion(true)`；false 表示回调 false 或根本不回调。 */
  readonly submissionSucceeded: boolean
  /** 是否回调 `submissionCompletion`（`missing-device` 之后的几条路径都会回调 false）。 */
  readonly callsSubmissionCompletion: boolean
  /** `presentationCompletion` 的参数；null 表示这条路径压根不回调它。 */
  readonly presentationResult: boolean | null
  /** 是否执行 `commandBuffer.commit()`。 */
  readonly commitsCommandBuffer: boolean
  /** 是否在提交后调度透视预热。 */
  readonly schedulesEffectPreparation: boolean
}

export interface PreviewDrawableFacts {
  readonly shouldDiscardBeforeRendering: boolean
  readonly hasDevice: boolean
  readonly colorContractChanged: boolean
  /** 契约变化后能否拿到新队列；契约没变时这个值被忽略。 */
  readonly canMakeCommandQueue: boolean
  readonly hasContextAndQueue: boolean
  readonly renderedFrame: boolean
  readonly drawableAcquired: boolean
  readonly drawableSizeMatches: boolean
  readonly renderTaskStarted: boolean
  readonly commandBufferAvailable: boolean
  /** `PreviewRenderBackpressurePolicy.shouldPresent` 的返回值。 */
  readonly epochStillCurrent: boolean
}

function makePreviewDrawableDecision(
  outcome: PreviewDrawableOutcome,
  overrides: Partial<Omit<PreviewDrawableDecision, 'outcome'>> = {}
): PreviewDrawableDecision {
  return {
    outcome,
    submissionSucceeded: false,
    callsSubmissionCompletion: true,
    presentationResult: null,
    commitsCommandBuffer: false,
    schedulesEffectPreparation: false,
    ...overrides,
  }
}

/**
 * Swift L29-184：按 guard 顺序求值，命中即返回。
 *
 * 三条容易被写错的语义：
 *   - `missing-device` 只回调 submission(false)，**不回调** presentation ——
 *     因为这时还没碰 drawable，主线程那头不能误以为「这一帧被拒了」。
 *   - `retired-epoch` 是唯一「submission 成功 + presentation false + 仍然
 *     commit」的组合；commit 是为了让已编码的 GPU 工作正常释放。
 *   - 只有 `presented` 才会 `schedulesEffectPreparation`。
 */
export function previewDrawableDecision(
  facts: PreviewDrawableFacts
): PreviewDrawableDecision {
  if (facts.shouldDiscardBeforeRendering) {
    return makePreviewDrawableDecision('discarded-stale-paused', {
      submissionSucceeded: true,
      presentationResult: false,
    })
  }
  if (!facts.hasDevice) {
    return makePreviewDrawableDecision('missing-device')
  }
  if (facts.colorContractChanged && !facts.canMakeCommandQueue) {
    return makePreviewDrawableDecision('missing-command-queue')
  }
  if (!facts.hasContextAndQueue) {
    return makePreviewDrawableDecision('missing-context')
  }
  if (!facts.renderedFrame) {
    return makePreviewDrawableDecision('render-failed')
  }
  if (!facts.drawableAcquired || !facts.drawableSizeMatches) {
    return makePreviewDrawableDecision('drawable-unavailable', {
      presentationResult: false,
    })
  }
  if (!facts.renderTaskStarted) {
    return makePreviewDrawableDecision('render-task-failed', {
      presentationResult: false,
    })
  }
  if (!facts.commandBufferAvailable) {
    return makePreviewDrawableDecision('command-buffer-unavailable', {
      presentationResult: false,
    })
  }
  if (!facts.epochStillCurrent) {
    return makePreviewDrawableDecision('retired-epoch', {
      submissionSucceeded: true,
      presentationResult: false,
      commitsCommandBuffer: true,
    })
  }
  return makePreviewDrawableDecision('presented', {
    submissionSucceeded: true,
    presentationResult: true,
    commitsCommandBuffer: true,
    schedulesEffectPreparation: true,
  })
}

/**
 * Swift L22-24：`defer { if let timing, !didSubmit { timing.owner.failed(timing) } }`。
 *
 * 只有真正走到 `didSubmit = true`（L181，即 presented 与 retired-epoch 两条路径）
 * 才不会记一次 failure —— 注意 `discarded-stale-paused` 虽然 submission 成功，
 * 但它提前 return 了，`didSubmit` 仍是 false，所以**照样记 failure**。
 */
export function previewDrawableReportsFailure(input: {
  readonly hasDiagnostics: boolean
  readonly decision: PreviewDrawableDecision
}): boolean {
  return input.hasDiagnostics && !input.decision.commitsCommandBuffer
}

/**
 * Swift L166-173：有 deadline 就按 deadline 呈递，否则立即呈递。
 *
 * 返回 null 表示「用 `commandBuffer.present(drawable)`」，也就是不指定时刻。
 */
export function previewPresentHostTime(
  presentationHostTime: number | null
): number | null {
  return presentationHostTime
}

/**
 * Swift L154-165：只有存在 timing 时才上报四个阶段耗时并挂 presentedHandler。
 *
 * 四段耗时按累加顺序切开整条管线：排队 → 图形 → 等 drawable → 编码。
 */
export function previewTimingSegments(input: {
  readonly queuedAt: number
  readonly renderStarted: number
  readonly graphFinished: number
  readonly drawableAcquired: number
  readonly encodedAt: number
}): {
  readonly queueMS: number
  readonly graphMS: number
  readonly drawableWaitMS: number
  readonly encodeMS: number
} {
  return {
    queueMS: (input.renderStarted - input.queuedAt) * 1000,
    graphMS: (input.graphFinished - input.renderStarted) * 1000,
    drawableWaitMS: (input.drawableAcquired - input.graphFinished) * 1000,
    encodeMS: (input.encodedAt - input.drawableAcquired) * 1000,
  }
}

/**
 * Swift L117-121：`destination.isFlipped = true` —— Core Image 用左下原点，
 * 直接呈递的 Metal drawable 第一行在顶上。这个转换只允许出现在呈递边界；
 * 一旦漏掉，整幅预览上下颠倒。
 */
export const PREVIEW_DESTINATION_IS_FLIPPED = true

/**
 * Swift L48-67：颜色契约变化时重建的是「整条队列」，而不是复用旧的。
 *
 * 因为旧 context 里缓存的中间结果都按旧色彩空间算过，混用会偏色。同时
 * `queuePreparedEffectSignatures.removeAll(keepingCapacity: false)` —— 预热
 * 签名必须清空，否则新契约会命中旧签名而跳过预热。
 */
export function previewQueueRebuildPlan(input: {
  readonly colorContractChanged: boolean
}): {
  readonly rebuildContext: boolean
  readonly recreateCommandQueue: boolean
  readonly clearPreparedEffectSignatures: boolean
} {
  return {
    rebuildContext: input.colorContractChanged,
    recreateCommandQueue: input.colorContractChanged,
    clearPreparedEffectSignatures: input.colorContractChanged,
  }
}
