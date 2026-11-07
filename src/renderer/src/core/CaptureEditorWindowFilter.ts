/**
 * 编辑窗口录制过滤 —— 只允许编辑器自己的窗口被排除在 ScreenCaptureKit 之外。
 *
 * Swift source: Sources/DogSCApp/CaptureEditorWindows.swift（137 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - let recorderEditorWindowIdentifier            L7-9   → EDITOR_WINDOW_IDENTIFIER
 *   - final class CaptureEditorWindows              L14-35 → CaptureEditorWindowsRegistry
 *   - register(_:)                                  L20-26 → editorWindowRegistrationIDs / register
 *   - unregister(_:)                                L28-32 → unregister
 *   - includes(_:)                                  L34     → includes
 *   - final class CaptureEditorWindowRefresh        L41-137 → CaptureEditorWindowRefresh
 *   - start(runID:configuration:appliedWindowIDs:)  L52-69 → start / captureEditorRefreshSupported
 *   - updateConfiguration / configuration(for:)     L71-78 → updateConfiguration / configurationFor
 *   - needsUpdate(configuration:windowIDs:)         L80-82 → needsUpdate
 *   - didApply(_:configuration:for:)                L84-94 → didApply
 *   - stop(for:)                                    L96-105 → stop
 *   - scheduleRefresh(desiredWindowIDs:)            L107-136 → captureEditorRefreshPlan / runCaptureEditorRefresh
 *
 * 迁移说明：`NSWindow` / `SCStream` / `AnyCancellable` / `Logger` 都是 macOS 专属。
 * Windows 侧窗口由 BrowserWindow 提供，拿到的不是 windowNumber 而是「合成 id」，
 * 但**判定逻辑完全一致**：只登记标识符匹配的那一个窗口，且 id 必须为正。
 *
 * 原注释（L11-12）：
 *   Only the editor's owner may opt a DogSC window into screen capture. Keeping
 *   the rest of the process excluded also covers helper windows opened mid-take.
 */

import type { CaptureConfiguration } from './CaptureConfiguration'
import { EDITOR_WINDOW_IDENTIFIER } from './EditorViewCropAndPreset'

/** 运行期唯一标识（Swift RecordingRunID → string）。 */
export type RecordingRunID = string

/**
 * Swift L7-9 声明的 `recorderEditorWindowIdentifier` 与
 * `EditorViewCropAndPreset.swift` 里的 `EDITOR_WINDOW_IDENTIFIER` 是同一个字符串，
 * 已在那里定义（批次 21），这里直接复用，避免两份常量漂移。
 */
export { EDITOR_WINDOW_IDENTIFIER }

/**
 * Swift L21 + L23-25：
 *   guard window.identifier == recorderEditorWindowIdentifier else { return }
 *   UInt32(exactly: window.windowNumber).flatMap { $0 > 0 ? $0 : nil }.map { Set([$0]) } ?? []
 *
 * 三条拒绝理由：标识符不符、窗口号超出 UInt32、窗口号 ≤ 0。
 */
export function editorWindowRegistrationIDs(
  identifier: string,
  windowNumber: number
): number[] {
  if (identifier !== EDITOR_WINDOW_IDENTIFIER) return []
  if (!Number.isInteger(windowNumber)) return []
  if (windowNumber <= 0 || windowNumber > 0xffff_ffff) return []
  return [windowNumber]
}

/**
 * Swift L14-35 的注册表。
 * 只持有**一个**编辑窗口：注册新窗口会替换旧的，注销旧窗口不会误删新的
 * （`guard editorWindow === window`）。
 */
export class CaptureEditorWindowsRegistry {
  private ids: number[] = []
  private editorWindowNumber: number | null = null

  get windowIDs(): readonly number[] {
    return this.ids
  }

  /** Swift L20-26。标识符不符直接忽略，不改任何状态。 */
  register(identifier: string, windowNumber: number): void {
    const next = editorWindowRegistrationIDs(identifier, windowNumber)
    if (next.length === 0) return
    this.editorWindowNumber = windowNumber
    // L25：`if windowIDs != ids { windowIDs = ids }` —— 相同则不产生新发布。
    if (this.ids.length !== next.length || this.ids[0] !== next[0]) {
      this.ids = next
    }
  }

  /** Swift L28-32：只有当前登记的窗口才能注销自己。 */
  unregister(windowNumber: number): void {
    if (this.editorWindowNumber !== windowNumber) return
    this.editorWindowNumber = null
    if (this.ids.length > 0) this.ids = []
  }

  /** Swift L34。 */
  includes(windowID: number): boolean {
    return this.ids.includes(windowID)
  }
}

/**
 * Swift L65：`guard configuration.source == .display || configuration.source == .area`。
 * 窗口/区域外的采集源（例如单窗口录制）不需要编辑窗口过滤 —— 那时编辑器根本不在画面里。
 */
export function captureEditorRefreshSupported(source: string): boolean {
  return source === 'display' || source === 'area'
}

/**
 * Swift L118：WindowServer 可能比 SCK 的目录先看到刚打开的 NSWindow，
 * 因此这段固定退避表用来跨过短暂发现延迟，而不是整个录制期间轮询。
 */
export const CAPTURE_EDITOR_REFRESH_RETRY_DELAYS_MS: readonly number[] = [
  100, 250, 500, 1_000, 1_500,
]

/** Swift L131-132 的文案。 */
export const CAPTURE_EDITOR_REFRESH_FALLBACK_DETAIL = '未取得编辑窗口的录制目录'

export function captureEditorRefreshFailureMessage(detail: string): string {
  return `编辑窗口录制过滤更新失败：${detail}`
}

/** Swift L110-112 的守卫结果。 */
export type CaptureEditorRefreshPlan = { readonly delays: readonly number[] } | null

/**
 * Swift L107-112：
 *   guard task == nil, let runID, let refresh,
 *         (desiredWindowIDs ?? CaptureEditorWindows.shared.windowIDs) != appliedWindowIDs
 *   else { return }
 *
 * 单飞：任务在跑时再来的请求直接丢弃（不是排队）。
 * 注释 L108-109 说明了 `@Published` 在存储变更**之前**发信号，所以必须用发出来的那份
 * 集合做比较，否则「打开第一个编辑器」会被误判成没有变化。
 */
export function captureEditorRefreshPlan(input: {
  readonly taskRunning: boolean
  readonly runID: RecordingRunID | null
  readonly hasRefreshHandler: boolean
  readonly desiredWindowIDs: readonly number[]
  readonly appliedWindowIDs: readonly number[]
}): CaptureEditorRefreshPlan {
  if (input.taskRunning) return null
  if (input.runID === null) return null
  if (!input.hasRefreshHandler) return null
  if (windowIDSetEqual(input.desiredWindowIDs, input.appliedWindowIDs)) return null
  return { delays: CAPTURE_EDITOR_REFRESH_RETRY_DELAYS_MS }
}

/** 无序集合相等。 */
export function windowIDSetEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  if (set.size !== new Set(b).size) return false
  for (const id of b) if (!set.has(id)) return false
  return true
}

/** 重试循环的宿主。`refresh` 对应 Swift 的 `refresh(runID)` 闭包。 */
export interface CaptureEditorRefreshHost {
  sleep(milliseconds: number): Promise<void>
  refresh(runID: RecordingRunID): Promise<void>
  /** 当前的「已应用窗口集合」，每轮重新读取。 */
  appliedWindowIDs(): readonly number[]
  desiredWindowIDs(): readonly number[]
}

/** 一次重试循环的结论。 */
export interface CaptureEditorRefreshOutcome {
  /** 已应用集合最终与期望集合一致。 */
  readonly settled: boolean
  /** 因为取消而提前退出（Swift 的 `catch { return }` / `Task.isCancelled`）。 */
  readonly cancelled: boolean
  /** 实际做过的重试次数（0 表示第一轮前就已一致）。 */
  readonly attempts: number
  /** 最后一次非取消错误。 */
  readonly lastError: unknown
}

/**
 * Swift L113-135 的重试循环。
 *
 *   for delay in [100, 250, 500, 1_000, 1_500] {
 *       try await Task.sleep(...)            // 取消则直接 return
 *       guard runID 未变, !isCancelled else { return }
 *       if appliedWindowIDs == windowIDs { break }
 *       try await refresh(runID)             // CancellationError 吞掉，其余记 lastError
 *   }
 *   结束后若仍不一致 → failureMessage
 */
export async function runCaptureEditorRefresh(
  host: CaptureEditorRefreshHost,
  runID: RecordingRunID,
  isCancelled: () => boolean = () => false
): Promise<CaptureEditorRefreshOutcome> {
  let lastError: unknown = null
  let attempts = 0
  for (const delay of CAPTURE_EDITOR_REFRESH_RETRY_DELAYS_MS) {
    try {
      await host.sleep(delay)
    } catch {
      return { settled: false, cancelled: true, attempts, lastError }
    }
    if (isCancelled()) return { settled: false, cancelled: true, attempts, lastError }
    if (windowIDSetEqual(host.appliedWindowIDs(), host.desiredWindowIDs())) break
    attempts += 1
    try {
      await host.refresh(runID)
    } catch (error) {
      if (isCancellationError(error)) {
        if (isCancelled()) return { settled: false, cancelled: true, attempts, lastError }
        continue
      }
      lastError = error
    }
  }
  const settled = windowIDSetEqual(host.appliedWindowIDs(), host.desiredWindowIDs())
  return { settled, cancelled: false, attempts, lastError }
}

function isCancellationError(error: unknown): boolean {
  return error instanceof Error && error.name === 'CancellationError'
}

/**
 * Swift L41-137 的类形态（不含 Combine 订阅与 Task 句柄）。
 * 订阅由 React 端用 `useEffect` + registry 的变更通知实现。
 */
export class CaptureEditorWindowRefresh {
  private runID: RecordingRunID | null = null
  private configuration: CaptureConfiguration | null = null
  private appliedConfiguration: CaptureConfiguration | null = null
  private appliedWindowIDs: number[] = []
  private refreshHandler: ((runID: RecordingRunID) => Promise<void>) | null = null
  private taskRunning = false
  private failure: string | null = null

  /** Swift L50。 */
  get failureMessage(): string | null {
    return this.failure
  }

  get currentRunID(): RecordingRunID | null {
    return this.runID
  }

  /** Swift L52-69。先 stop() 再接管 —— 旧任务绝不能跨运行存活。 */
  start(input: {
    runID: RecordingRunID
    configuration: CaptureConfiguration
    appliedWindowIDs: readonly number[]
    refresh: (runID: RecordingRunID) => Promise<void>
  }): void {
    this.stop()
    this.runID = input.runID
    this.configuration = input.configuration
    this.appliedConfiguration = input.configuration
    this.appliedWindowIDs = [...input.appliedWindowIDs]
    this.refreshHandler = input.refresh
    this.failure = null
  }

  /** Swift L65：是否应该订阅编辑窗口变化。 */
  get observesEditorWindows(): boolean {
    if (this.configuration === null) return false
    return captureEditorRefreshSupported(this.configuration.source)
  }

  /** Swift L71-74。runID 不符的更新被静默丢弃。 */
  updateConfiguration(configuration: CaptureConfiguration, runID: RecordingRunID): void {
    if (this.runID !== runID) return
    this.configuration = configuration
  }

  /** Swift L76-78。 */
  configurationFor(runID: RecordingRunID): CaptureConfiguration | null {
    return this.runID === runID ? this.configuration : null
  }

  /** Swift L80-82。引用相等即 Swift 的 `!=`（CaptureConfiguration 是 Equatable 值类型）。 */
  needsUpdate(configuration: CaptureConfiguration, windowIDs: readonly number[]): boolean {
    return this.appliedConfiguration !== configuration || !windowIDSetEqual(this.appliedWindowIDs, windowIDs)
  }

  /** Swift L84-94。 */
  didApply(
    windowIDs: readonly number[],
    configuration: CaptureConfiguration,
    runID: RecordingRunID,
    currentWindowIDs: readonly number[]
  ): void {
    if (this.runID !== runID) return
    this.appliedWindowIDs = [...windowIDs]
    this.appliedConfiguration = configuration
    if (windowIDSetEqual(windowIDs, currentWindowIDs)) this.failure = null
  }

  /** Swift L96-105。给 runID 时只停对应运行。 */
  stop(runID: RecordingRunID | null = null): void {
    if (runID !== null && this.runID !== runID) return
    this.taskRunning = false
    this.runID = null
    this.configuration = null
    this.appliedConfiguration = null
    this.refreshHandler = null
  }

  /**
   * Swift L107-135 的调度入口。返回 null 表示这一拍什么都不做。
   * 注意 `desiredWindowIDs` 用**调用方传入**的集合（`@Published` 的那份快照）。
   */
  async scheduleRefresh(currentWindowIDs: readonly number[], desiredWindowIDs?: readonly number[]): Promise<CaptureEditorRefreshOutcome | null> {
    const desired = desiredWindowIDs ?? currentWindowIDs
    const plan = captureEditorRefreshPlan({
      taskRunning: this.taskRunning,
      runID: this.runID,
      hasRefreshHandler: this.refreshHandler !== null,
      desiredWindowIDs: desired,
      appliedWindowIDs: this.appliedWindowIDs,
    })
    if (plan === null) return null
    const runID = this.runID as RecordingRunID
    const refresh = this.refreshHandler as (runID: RecordingRunID) => Promise<void>
    this.taskRunning = true
    try {
      const outcome = await runCaptureEditorRefresh(
        {
          sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
          refresh,
          appliedWindowIDs: () => this.appliedWindowIDs,
          desiredWindowIDs: () => desired,
        },
        runID,
        () => this.runID !== runID
      )
      if (this.runID !== runID) return outcome
      if (!outcome.settled) {
        const detail =
          outcome.lastError === null
            ? CAPTURE_EDITOR_REFRESH_FALLBACK_DETAIL
            : String(outcome.lastError)
        this.failure = captureEditorRefreshFailureMessage(detail)
      }
      return outcome
    } finally {
      if (this.runID === runID) this.taskRunning = false
    }
  }
}
