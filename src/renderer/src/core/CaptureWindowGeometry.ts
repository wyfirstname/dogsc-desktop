/**
 * 采集窗口几何 —— 只活在「选择与录制」期间，永不写进工程。
 *
 * Swift source: Sources/DogSCApp/CaptureWindowGeometry.swift（169 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct CaptureWindowGeometry                       L7-10   → CaptureWindowGeometry
 *   - enum CaptureWindowSelectionPolicy                  L12-29
 *   - hover(previous:pointerIsInsideRecorderWindow:…)    L13-19  → captureWindowHoverSelection
 *   - lockedWindow(id:catalog:geometry:)                 L21-28  → captureWindowLockedWindow
 *   - enum CaptureWindowGeometryLookup                   L31-85
 *   - live(windowID:)                                    L37-47  → CAPTURE_WINDOW_GEOMETRY_OPTIONS
 *   - background(windowID:)（后台队列）                   L52-58  → background 语义
 *   - resolve(windowID:descriptions:mainDisplayHeight:)  L60-84  → resolveCaptureWindowGeometry
 *   - final class CaptureWindowGeometryRuntime            L90-169 → CaptureWindowGeometryRuntime
 *   - start(windowID:initialFrame:pollInterval:)         L112-137 → CAPTURE_WINDOW_POLL_INTERVAL_MS
 *   - publishLookupResult                                L139-148 → publishLookupResult 语义
 *   - frame(for:) / stop() / publish(_:)                 L150-168 → frameFor / stop
 *
 * 原注释（L5-6）：
 *   Ephemeral geometry for one immutable capture-window identity. This is never
 *   persisted into the project; it exists only while selecting or recording.
 *
 * 原注释（L49-51）：
 *   CGWindowListCopyWindowInfo is a synchronous WindowServer round trip.
 *   Recording polls must not execute it on MainActor, where a slow response
 *   blocks the recorder toolbar and every AppKit event in the process.
 *
 * 迁移说明：Windows 侧窗口矩形来自 `BrowserWindow.getBounds()` / Win32
 * `GetWindowRect`，坐标系本来就是「左上原点、y 向下」，不需要 macOS 那次翻转。
 * 但**翻转公式本身**仍保留为独立函数，因为它决定了多显示器下上/下偏移的方向。
 */

/** Swift L7-10。 */
export interface CaptureWindowGeometry {
  readonly windowID: number
  readonly frame: CaptureWindowRect
}

export interface CaptureWindowRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Swift L38-39：查询选项。 */
export const CAPTURE_WINDOW_GEOMETRY_OPTIONS = ['optionIncludingWindow', 'excludeDesktopElements'] as const

/** Swift L35：后台队列的 QoS。 */
export const CAPTURE_WINDOW_GEOMETRY_QUEUE_QOS = 'utility'

/** Swift L103：默认轮询间隔 75ms（约 13Hz）。 */
export const CAPTURE_WINDOW_POLL_INTERVAL_MS = 75

/**
 * Swift L122-123 的注释：
 *   录制高亮不需要悬停级的跟手精度：13Hz 的窗口服务器同步查询在录制期间与
 *   SwiftUI 录制面板争抢主线程，降到 250ms 视觉无感知差异。
 */
export const CAPTURE_WINDOW_RECORDING_POLL_INTERVAL_MS = 250

/**
 * Swift L13-19：
 *   pointerIsInsideRecorderWindow ? previous : frontmostCandidate
 *
 * 指针落在录制面板上时**保持**当前高亮不变 —— 否则面板一挪动，高亮就在
 * 面板底下疯狂跳动（面板本身是一个窗口，也在候选列表里）。
 */
export function captureWindowHoverSelection(input: {
  readonly previous: unknown | null
  readonly pointerIsInsideRecorderWindow: boolean
  readonly frontmostCandidate: unknown | null
}): unknown | null {
  return input.pointerIsInsideRecorderWindow ? input.previous : input.frontmostCandidate
}

/**
 * Swift L21-28：
 *   guard geometry?.windowID == id else { return nil }
 *   return catalog.first(where: { $0.id == id })
 *
 * 只有「几何记录与请求 id 一致」时才回目录里找 —— 这条看似多余的判断挡住了
 * 「锁定 A 窗口，但 B 窗口的几何先到」的竞态。
 */
export function captureWindowLockedWindow<T extends { readonly id: number }>(input: {
  readonly id: number
  readonly catalog: readonly T[]
  readonly geometry: CaptureWindowGeometry | null
}): T | null {
  if (input.geometry === null || input.geometry.windowID !== input.id) return null
  return input.catalog.find((item) => item.id === input.id) ?? null
}

/** 一条窗口描述（`CGWindowListCopyWindowInfo` 的元素子集）。 */
export interface CaptureWindowDescription {
  readonly number: number
  /** `kCGWindowLayer`：0 才是普通窗口层。 */
  readonly layer: number
  /** Quartz 坐标系下的边界（原点左下）。 */
  readonly bounds: CaptureWindowRect | null
}

/**
 * Swift L60-84：
 *   guard 找到 number == windowID 的描述,
 *         layer == 0,
 *         有 bounds 且能解成 CGRect,
 *         width > 0, height > 0
 *   return CaptureWindowGeometry(windowID, CGRect(
 *       x: quartzFrame.minX,
 *       y: mainDisplayHeight - quartzFrame.maxY,
 *       width: quartzFrame.width, height: quartzFrame.height))
 *
 * 三条拒绝理由对应三类不该被采集的「窗口」：找不到（已关闭）、
 * layer ≠ 0（面板/悬浮条/桌面元素）、零尺寸（最小化）。
 *
 * 那次 y 翻转是 Quartz（左下原点）→ AppKit（左上原点）的换算：
 * `y = 主屏高 − quartz.maxY`。
 */
export function resolveCaptureWindowGeometry(input: {
  readonly windowID: number
  readonly descriptions: readonly CaptureWindowDescription[]
  readonly mainDisplayHeight: number
}): CaptureWindowGeometry | null {
  const description = input.descriptions.find((item) => item.number === input.windowID)
  if (description === undefined) return null
  if (description.layer !== 0) return null
  const bounds = description.bounds
  if (bounds === null) return null
  if (!(bounds.width > 0)) return null
  if (!(bounds.height > 0)) return null
  return {
    windowID: input.windowID,
    frame: {
      x: bounds.x,
      y: input.mainDisplayHeight - (bounds.y + bounds.height),
      width: bounds.width,
      height: bounds.height,
    },
  }
}

/** 几何相等（Swift 的 `Equatable`）。用于 publish 去重。 */
export function captureWindowGeometryEqual(
  a: CaptureWindowGeometry | null,
  b: CaptureWindowGeometry | null
): boolean {
  if (a === null || b === null) return a === b
  if (a.windowID !== b.windowID) return false
  return (
    a.frame.x === b.frame.x &&
    a.frame.y === b.frame.y &&
    a.frame.width === b.frame.width &&
    a.frame.height === b.frame.height
  )
}

/**
 * Swift L139-148：
 *   guard replacement?.windowID == windowID else { publish(nil); return }
 *   publish(replacement)
 *
 * 查回来的几何若属于别的窗口（或窗口已消失），发布 **nil** 而不是丢弃：
 * 高亮框必须立刻消失，否则会停在一个已经不在的位置上。
 */
export function captureWindowLookupPublication(
  replacement: CaptureWindowGeometry | null,
  expectedWindowID: number
): CaptureWindowGeometry | null {
  if (replacement === null || replacement.windowID !== expectedWindowID) return null
  return replacement
}

/**
 * Swift L90-169 的类形态。
 * 代次（generation）是唯一防串台手段：每次 start/stop 都 `&+= 1`，
 * 在飞的那次查询落地后先比代次再比 windowID。
 */
export class CaptureWindowGeometryRuntime {
  private generation = 0
  private activeWindowID: number | null = null
  private current: CaptureWindowGeometry | null = null
  private onChange: ((geometry: CaptureWindowGeometry | null) => void) | null = null
  private pollIntervalMs: number | null = CAPTURE_WINDOW_POLL_INTERVAL_MS

  constructor(options: { readonly pollIntervalMs?: number | null } = {}) {
    if (options.pollIntervalMs !== undefined) this.pollIntervalMs = options.pollIntervalMs
  }

  get windowID(): number | null {
    return this.activeWindowID
  }

  get geometry(): CaptureWindowGeometry | null {
    return this.current
  }

  get activeGeneration(): number {
    return this.generation
  }

  setOnChange(handler: ((geometry: CaptureWindowGeometry | null) => void) | null): void {
    this.onChange = handler
  }

  /**
   * Swift L112-137：
   *   generation &+= 1；取消旧任务；记下 windowID；
   *   **立即** publish(初始帧)；interval 为 nil 则不再轮询。
   */
  start(input: {
    readonly windowID: number
    readonly initialFrame: CaptureWindowRect
    readonly pollIntervalMs?: number | null
  }): { readonly generation: number; readonly polls: boolean } {
    this.generation += 1
    this.activeWindowID = input.windowID
    this.publish({ windowID: input.windowID, frame: input.initialFrame })
    const interval =
      input.pollIntervalMs === undefined ? this.pollIntervalMs : input.pollIntervalMs
    return { generation: this.generation, polls: interval !== null }
  }

  /**
   * Swift L129-134 的检查点：
   *   guard !Task.isCancelled, generation == activeGeneration, windowID == windowID
   */
  shouldAcceptPoll(input: {
    readonly generation: number
    readonly windowID: number
  }): boolean {
    return this.generation === input.generation && this.activeWindowID === input.windowID
  }

  /** 把一次查询结果落地（含「不属于我 → 变 nil」的规则）。 */
  applyPoll(replacement: CaptureWindowGeometry | null, expectedWindowID: number): void {
    this.publish(captureWindowLookupPublication(replacement, expectedWindowID))
  }

  /** Swift L150-154：两个条件都要满足才给帧。 */
  frameFor(requestedWindowID: number): CaptureWindowRect | null {
    if (this.activeWindowID !== requestedWindowID) return null
    if (this.current === null || this.current.windowID !== requestedWindowID) return null
    return this.current.frame
  }

  /** Swift L156-162。 */
  stop(): void {
    this.generation += 1
    this.activeWindowID = null
    this.publish(null)
  }

  /** Swift L164-168：相同则不通知 —— 13Hz 的轮询不该每拍都惊动渲染。 */
  private publish(replacement: CaptureWindowGeometry | null): boolean {
    if (captureWindowGeometryEqual(replacement, this.current)) return false
    this.current = replacement
    this.onChange?.(replacement)
    return true
  }
}
