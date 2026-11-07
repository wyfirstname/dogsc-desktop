/**
 * 采集设备生命周期 —— 连接观察与「刷新爆发」的全部时序。
 *
 * Swift source: Sources/DogSCApp/CaptureDeviceLifecycle.swift（165 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - enum CaptureDeviceOperationDomain              L4-9   → CaptureDeviceOperationDomain
 *   - struct CaptureDeviceOperationToken             L11-14 → CaptureDeviceOperationToken
 *   - struct CaptureDeviceGenerationState            L20-33 → CaptureDeviceGenerationState
 *   - begin(_:)（&+ 1，回绕到 0 时改 1）              L23-28 → captureDeviceGenerationNext
 *   - isCurrent(_:)                                  L30-32 → isCurrent
 *   - final class CaptureDeviceObservationBag        L38-63 → 观察订阅的持有与拆除
 *   - final class CaptureDeviceLifecycle             L69-165 → CaptureDeviceLifecycle
 *   - defaultRefreshDelays                           L72-80 → CAPTURE_DEVICE_REFRESH_DELAYS_MS
 *   - start() / stop()                               L100-124 → start / stop
 *   - handleConnectionChange(for:)                   L126-132 → captureDeviceNotificationAction
 *   - scheduleCatalogRefresh()                       L142-160 → captureDeviceRefreshPlan
 *
 * 原注释（L16-19）：
 *   A small, pure state machine used to reject completions from superseded
 *   device work. Device IDs are not sufficient here: a disconnected USB camera
 *   can reconnect with the same ID while its previous release/preview task is
 *   still suspended in AVFoundation.
 *
 * 原注释（L146-149）：
 *   USB cameras and iOS screen-capture endpoints can announce their underlying
 *   AV device before every media endpoint is queryable. The cumulative delays
 *   intentionally preserve the existing burst.
 *
 * 迁移说明：`AVCaptureDevice.wasConnected/DisconnectedNotification` 在 Windows
 * 侧对应 `navigator.mediaDevices.ondevicechange`；`Task.sleep` 对应 `setTimeout`。
 * 本文件保留代次状态机的全部语义 —— 这是「USB 摄像头热插拔后预览卡在旧会话」
 * 这类问题的唯一防线。
 */

/** Swift L4-9：四条互相独立的工作域（`CaseIterable` 顺序）。 */
export type CaptureDeviceOperationDomain =
  | 'catalogRefresh'
  | 'screenDevice'
  | 'camera'
  | 'microphone'

export const CAPTURE_DEVICE_OPERATION_DOMAINS: readonly CaptureDeviceOperationDomain[] = [
  'catalogRefresh',
  'screenDevice',
  'camera',
  'microphone',
]

/** Swift L11-14。 */
export interface CaptureDeviceOperationToken {
  readonly domain: CaptureDeviceOperationDomain
  readonly generation: bigint
}

/**
 * Swift L24-27：
 *   var next = (generations[domain] ?? 0) &+ 1
 *   if next == 0 { next = 1 }
 *
 * UInt64 环绕到 0 时跳过 0 —— 0 是「从未开始」的哨兵值，一旦被当作代次，
 * `isCurrent` 会把所有未开始的域都判为有效。
 */
export function captureDeviceGenerationNext(current: bigint): bigint {
  const next = BigInt.asUintN(64, current + 1n)
  return next === 0n ? 1n : next
}

/** Swift L20-33。 */
export class CaptureDeviceGenerationState {
  private readonly generations = new Map<CaptureDeviceOperationDomain, bigint>()

  /** Swift L23-28：开始一次工作，返回它的令牌。 */
  begin(domain: CaptureDeviceOperationDomain): CaptureDeviceOperationToken {
    const next = captureDeviceGenerationNext(this.generations.get(domain) ?? 0n)
    this.generations.set(domain, next)
    return { domain, generation: next }
  }

  /** Swift L30-32：令牌是否仍然属于当前代次。 */
  isCurrent(token: CaptureDeviceOperationToken): boolean {
    return this.generations.get(token.domain) === token.generation
  }

  /** 当前代次（诊断用；未开始为 0）。 */
  generationOf(domain: CaptureDeviceOperationDomain): bigint {
    return this.generations.get(domain) ?? 0n
  }
}

/**
 * Swift L72-80：累计延迟（不是「每隔」而是「这些时刻」）。
 *   0, 250, 500, 1000, 2000, 3000, 5000 ms
 * 第一次立即执行（0 不 sleep），最后到 5 秒 —— 覆盖 USB 与 iOS 端点
 * 「先宣告底层设备、再逐个可见」的时间窗。
 */
export const CAPTURE_DEVICE_REFRESH_DELAYS_MS: readonly number[] = [
  0, 250, 500, 1_000, 2_000, 3_000, 5_000,
]

/** Swift L151-153：`if delay > .zero { try? await Task.sleep(...) }`。 */
export function captureDeviceRefreshShouldSleep(delayMs: number): boolean {
  return delayMs > 0
}

/** 通知到达后的结论。 */
export type CaptureDeviceNotificationAction = 'ignore' | 'scheduleRefresh'

/**
 * Swift L126-132：
 *   guard observationSessionID == sessionID else { return }
 *   scheduleCatalogRefresh()
 *
 * 注释（L127-129）：`stop()` 移除观察者时通知可能**已经**排在队列里。
 * 所以必须校验会话 id —— 否则一次快速 stop/start 之后，上一轮的观察者
 * 仍然能触发刷新，把已经换掉的设备目录重新刷回来。
 */
export function captureDeviceNotificationAction(input: {
  readonly observationSessionID: string | null
  readonly notificationSessionID: string
}): CaptureDeviceNotificationAction {
  if (input.observationSessionID === null) return 'ignore'
  return input.observationSessionID === input.notificationSessionID
    ? 'scheduleRefresh'
    : 'ignore'
}

/**
 * Swift L142-160 的调度计划。
 *   refreshTask?.cancel()
 *   let operation = generations.begin(.catalogRefresh)
 *   for delay in delays { sleep; guard !isCancelled, generations.isCurrent(operation) else return; refreshCatalog() }
 *
 * 每次调度都会作废上一轮（取消 + 换代次）。所以「连续插拔两台设备」
 * 最终只有最后那一轮跑完全程，前一轮在下一个检查点自行退出。
 */
export interface CaptureDeviceRefreshPlan {
  readonly delays: readonly number[]
  readonly operation: CaptureDeviceOperationToken
}

export function captureDeviceRefreshPlan(
  generations: CaptureDeviceGenerationState,
  delays: readonly number[] = CAPTURE_DEVICE_REFRESH_DELAYS_MS
): CaptureDeviceRefreshPlan {
  return { delays, operation: generations.begin('catalogRefresh') }
}

/** 一轮爆发中某个检查点是否还应该继续（Swift L154-156）。 */
export function captureDeviceRefreshShouldContinue(input: {
  readonly cancelled: boolean
  readonly isCurrent: boolean
}): boolean {
  return !input.cancelled && input.isCurrent
}

/**
 * Swift L64-70 的观察者持有者：`deinit` 里逐个 `removeObserver`。
 * Web 侧对应「返回一个 dispose 函数」，语义相同：**由持有者负责拆除**，
 * 不依赖被观察对象的生命周期。
 */
export interface CaptureDeviceObservationBag {
  readonly names: readonly string[]
  dispose(): void
}

/** Swift L106-109：两条连接通知。 */
export const CAPTURE_DEVICE_CONNECTION_NOTIFICATIONS: readonly string[] = [
  'AVCaptureDeviceWasConnected',
  'AVCaptureDeviceWasDisconnected',
]

/**
 * Swift L69-165 的类形态（不含实际的通知订阅与定时器，由宿主注入）。
 */
export class CaptureDeviceLifecycle {
  private readonly generations = new CaptureDeviceGenerationState()
  private observationSessionID: string | null = null
  private observations: CaptureDeviceObservationBag | null = null
  private refreshing = false
  private refreshCatalogue: () => void

  constructor(refreshCatalogue: () => void) {
    this.refreshCatalogue = refreshCatalogue
  }

  /** 当前观察会话（null 表示未启动）。 */
  get sessionID(): string | null {
    return this.observationSessionID
  }

  get isObserving(): boolean {
    return this.observations !== null
  }

  get isRefreshing(): boolean {
    return this.refreshing
  }

  /**
   * Swift L100-116：
   *   guard observations == nil else { return }   ← 幂等
   *   sessionID = UUID(); 订阅两条通知；**立即** refreshCatalog()
   *
   * 最后那一步「立即刷一次」很关键：启动时已有的设备不会发通知。
   */
  start(input: {
    readonly createSessionID: () => string
    readonly observe: (handler: (sessionID: string) => void) => CaptureDeviceObservationBag
  }): boolean {
    if (this.observations !== null) return false
    const sessionID = input.createSessionID()
    this.observationSessionID = sessionID
    this.observations = input.observe((notified) => {
      if (
        captureDeviceNotificationAction({
          observationSessionID: this.observationSessionID,
          notificationSessionID: notified,
        }) === 'scheduleRefresh'
      ) {
        this.scheduleCatalogRefresh()
      }
    })
    this.refreshCatalogue()
    return true
  }

  /**
   * Swift L118-124：
   *   observationSessionID = nil；observations = nil（触发 deinit 拆除）；
   *   refreshTask?.cancel()；_ = generations.begin(.catalogRefresh)
   *
   * 最后那一步作废**正在跑**的那一轮爆发：只 cancel 任务而不换代次，若取消
   * 请求刚好落在检查点之后，那一轮还会再刷一次。
   */
  stop(): void {
    this.observationSessionID = null
    this.observations?.dispose()
    this.observations = null
    this.refreshing = false
    this.generations.begin('catalogRefresh')
  }

  /** Swift L134-140。 */
  beginOperation(domain: CaptureDeviceOperationDomain): CaptureDeviceOperationToken {
    return this.generations.begin(domain)
  }

  /** Swift L138-140。 */
  isCurrent(token: CaptureDeviceOperationToken): boolean {
    return this.generations.isCurrent(token)
  }

  /**
   * Swift L142-160。返回本次爆发的计划；宿主按延迟表逐个回调，每个检查点
   * 用 `captureDeviceRefreshShouldContinue` 判断是否继续。
   */
  scheduleCatalogRefresh(
    delays: readonly number[] = CAPTURE_DEVICE_REFRESH_DELAYS_MS
  ): CaptureDeviceRefreshPlan {
    this.refreshing = true
    return captureDeviceRefreshPlan(this.generations, delays)
  }

  /** 一轮爆发结束（含被取消的情形）。 */
  finishCatalogRefresh(): void {
    this.refreshing = false
  }

  /** 供宿主在检查点调用：条件成立才真的刷目录。 */
  refreshIfCurrent(plan: CaptureDeviceRefreshPlan, cancelled: boolean): boolean {
    if (
      !captureDeviceRefreshShouldContinue({
        cancelled,
        isCurrent: this.generations.isCurrent(plan.operation),
      })
    ) {
      return false
    }
    this.refreshCatalogue()
    return true
  }
}
