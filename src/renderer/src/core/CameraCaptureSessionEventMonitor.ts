/**
 * 摄像头会话事件桥 —— Swift CameraCaptureSessionEventMonitor.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/CameraCaptureSessionEventMonitor.swift（54 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - enum CameraCaptureSessionEvent（runtimeError / interrupted / ended）  L4-8
 *   - runtimeError 通知 → 缺错误时造一个「未知运行错误」                      L25-33
 *   - wasInterrupted / interruptionEnded 通知                              L34-47
 *   - deinit 统一摘观察者                                                   L50-53
 *
 * 原注释：AVCaptureSession 的失败通道**只有通知**，没有返回值也没有 promise。不搭这座桥，
 * 摄像头可能已经停了而屏幕写入器还在跑 —— 最后产出一条轨道悄悄错位的成片。
 *
 * 迁移说明：Windows 侧没有 AVCaptureSession，但有等价的三类信号（设备断开、会话被占用、
 * 恢复）。这里保留「事件只有三种」「缺错误信息也必须给出一条可读错误」两条契约，
 * 观察者表与摘除逻辑由调用方（主进程端口）实现。
 */

export const CAMERA_SESSION_UNKNOWN_ERROR_MESSAGE = '摄像头会话发生未知运行错误'

export type CameraCaptureSessionEvent =
  | { readonly kind: 'runtimeError'; readonly message: string; readonly code: number | null }
  | { readonly kind: 'interrupted' }
  | { readonly kind: 'interruptionEnded' }

/** Swift `AVError.unknown.rawValue`（Windows 侧仅作占位，不参与判断）。 */
export const CAMERA_SESSION_UNKNOWN_ERROR_CODE = -11800

/**
 * Swift L26-31：通知里带 `AVCaptureSessionErrorKey` 就用它，否则**构造**一条
 * 「未知运行错误」。绝不因为缺错误就吞掉事件 —— 吞掉等于让录制继续跑在死摄像头上。
 */
export function cameraSessionRuntimeErrorEvent(error: {
  readonly message: string | null
  readonly code?: number | null
} | null): CameraCaptureSessionEvent {
  if (error == null || error.message == null || error.message.trim() === '') {
    return {
      kind: 'runtimeError',
      message: CAMERA_SESSION_UNKNOWN_ERROR_MESSAGE,
      code: CAMERA_SESSION_UNKNOWN_ERROR_CODE,
    }
  }
  return {
    kind: 'runtimeError',
    message: error.message,
    code: error.code ?? CAMERA_SESSION_UNKNOWN_ERROR_CODE,
  }
}

/** 三类通知名（macOS 侧的 `AVCaptureSession.*Notification`）。 */
export const CAMERA_SESSION_NOTIFICATION = {
  runtimeError: 'AVCaptureSessionRuntimeErrorNotification',
  wasInterrupted: 'AVCaptureSessionWasInterruptedNotification',
  interruptionEnded: 'AVCaptureSessionInterruptionEndedNotification',
} as const

export type CameraSessionNotificationName =
  (typeof CAMERA_SESSION_NOTIFICATION)[keyof typeof CAMERA_SESSION_NOTIFICATION]

/**
 * 通知 → 事件。未识别的通知返回 null（调用方忽略；这里不抛错，因为 NSNotificationCenter
 * 的观察者是广播语义，收到无关通知是正常现象）。
 */
export function cameraSessionEventForNotification(
  name: string,
  error: { readonly message: string | null; readonly code?: number | null } | null = null
): CameraCaptureSessionEvent | null {
  switch (name) {
    case CAMERA_SESSION_NOTIFICATION.runtimeError:
      return cameraSessionRuntimeErrorEvent(error)
    case CAMERA_SESSION_NOTIFICATION.wasInterrupted:
      return { kind: 'interrupted' }
    case CAMERA_SESSION_NOTIFICATION.interruptionEnded:
      return { kind: 'interruptionEnded' }
    default:
      return null
  }
}

/**
 * 观察者表的最小实现（对应 Swift 的 `observers: [NSObjectProtocol]` + deinit 摘除）。
 * 用 `dispose()` 取代 deinit：Windows 侧没有确定性的析构时机，必须显式释放。
 */
export class CameraCaptureSessionEventMonitor {
  private readonly teardown: Array<() => void> = []
  private disposed = false

  constructor(handler: (event: CameraCaptureSessionEvent) => void) {
    this.handler = handler
  }

  private readonly handler: (event: CameraCaptureSessionEvent) => void

  /** 注册一个通知源，返回其摘除函数（对应 `center.addObserver` 的返回值）。 */
  observe(name: string, subscribe: (callback: (payload: unknown) => void) => () => void): void {
    if (this.disposed) return
    const unsubscribe = subscribe((payload) => {
      if (this.disposed) return
      const event = cameraSessionEventForNotification(
        name,
        payload as { message: string | null; code?: number | null } | null
      )
      if (event != null) this.handler(event)
    })
    this.teardown.push(unsubscribe)
  }

  /** Swift deinit 的等价物：逐个摘除，幂等。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const unsubscribe of this.teardown) unsubscribe()
    this.teardown.length = 0
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  /** 当前挂着的观察者数量（诊断与断言用）。 */
  get observerCount(): number {
    return this.teardown.length
  }
}
