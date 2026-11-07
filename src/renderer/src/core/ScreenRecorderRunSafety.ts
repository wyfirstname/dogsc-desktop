/**
 * 录制运行安全 —— 每次 ScreenCaptureKit 运行的**值语义**所有权。
 *
 * Swift source: Sources/DogSCApp/ScreenRecorderRunSafety.swift（244 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct ScreenRecorderRunToken                         L3-6    → ScreenRecorderRunToken
 *   - enum ScreenRecorderRunLifecycle（4 态）                L8-13   → ScreenRecorderRunLifecycle
 *   - struct ScreenRecorderSurfaceUpdateToken               L15-19  → ScreenRecorderSurfaceUpdateToken
 *   - enum ScreenRecorderSurfaceUpdateDecision（3 态）       L21-25  → 同名
 *   - enum ScreenRecorderStreamRole（primary/secondary）     L27-30  → 同名
 *   - enum ScreenRecorderRunBeginResult                      L32-35  → 同名
 *   - struct ScreenRecorderRunSafetyState                    L39-193
 *     · begin(_:)（首次才能拿 token，代次 &+ 1）              L54-63  → begin
 *     · registerStreams（主/辅流身份）                        L65-76  → registerStreams
 *     · markCapturing（只在 starting 且无终止错误）           L78-85  → markCapturing
 *     · deferTerminalDuringStart（start 期间的终止延后）       L87-100 → deferTerminalDuringStart
 *     · tokenForDelegate（只在 starting/capturing）           L102-109 → tokenForDelegate
 *     · role(for:in:)（主/辅判定）                            L113-123 → streamRole
 *     · lifecycle(for:)                                      L125-128
 *     · claimTerminal（只在 capturing 认领）                  L130-139 → claimTerminal
 *     · terminalError(for:)                                  L141-144
 *     · beginStopping（capturing 或 terminal → stopping）      L146-153 → beginStopping
 *     · makeSurfaceUpdate（revision &+ 1）                    L155-168 → makeSurfaceUpdate
 *     · surfaceUpdateDecision（取消 / 过期 / 应用）           L170-181 → surfaceUpdateDecision
 *     · end(_:)（清空 active）                                L183-190 → end
 *   - enum CaptureOutputTerminalStage                        L195-199 → CaptureOutputTerminalStage
 *   - struct CaptureOutputTerminalFailure（错误码 1/2/3）    L201-233 → CAPTURE_OUTPUT_TERMINAL_*
 *   - struct CaptureOutputTerminalState（一次性认领）         L239-244 → CaptureOutputTerminalState
 *
 * 原注释（L37-38）：
 *   Value-semantic ownership for one ScreenCaptureKit run. Every asynchronous
 *   completion carries both the user-visible run identity and the concrete
 *   stream generation, so a late callback cannot mutate a replacement stream.
 *
 * 原注释（L89-91）：
 *   A terminal callback may reach the main actor while `start` is suspended
 *   after the first frame but before ownership becomes capturing. Preserve it
 *   for the throwing start path without publishing an unexpected-stop event
 *   that would race preparation cleanup.
 *
 * 原注释（L111-112）：
 *   Whether the stream that stopped is the primary screen stream or the
 *   auxiliary (selected-app audio) stream. The auxiliary stream must never
 *   terminate the whole recording: its loss only degrades one audio track.
 *
 * 原注释（L237-238）：
 *   `CaptureOutput` is serialized on its sample queue, but keeping the one-shot
 *   claim as a value policy makes the terminal-event contract directly testable.
 *
 * 迁移说明：这是纯状态机，TypeScript 侧逐行同构。`ObjectIdentifier` 换成
 * `streamIdentity: string`（宿主用设备 id + 轨角色拼）。`any Error` 换成
 * `CaptureSessionError`（含 `message`），只在 `terminalError` 用作不透明句柄。
 */

/** 一次运行的标识（用户可见的「这次录制」）。 */
export type RecordingRunID = string

/** Swift L3-6：运行 + 流代次的复合身份。 */
export interface ScreenRecorderRunToken {
  readonly runID: RecordingRunID
  readonly streamGeneration: number
}

/** Swift L8-13。 */
export type ScreenRecorderRunLifecycle = 'starting' | 'capturing' | 'terminal' | 'stopping'

/** Swift L15-19：一次表面更新的身份。 */
export interface ScreenRecorderSurfaceUpdateToken {
  readonly run: ScreenRecorderRunToken
  readonly streamIdentity: string
  readonly revision: number
}

/** Swift L21-25。 */
export type ScreenRecorderSurfaceUpdateDecision = 'apply' | 'cancelled' | 'stale'

/** Swift L27-30。 */
export type ScreenRecorderStreamRole = 'primary' | 'secondary'

/** Swift L32-35。 */
export type ScreenRecorderRunBeginResult =
  | { readonly kind: 'accepted'; readonly token: ScreenRecorderRunToken }
  | { readonly kind: 'alreadyActive'; readonly runID: RecordingRunID }

/** 终止错误的可断言替身（Swift 的 `any Error`）。 */
export interface CaptureSessionError {
  readonly message: string
}

interface ActiveRun {
  readonly token: ScreenRecorderRunToken
  lifecycle: ScreenRecorderRunLifecycle
  streamIdentities: Set<string>
  primaryStreamIdentity: string | null
  latestSurfaceRevision: number
  terminalError: CaptureSessionError | null
}

/**
 * Swift L39-193：一次运行的完整状态机。
 *
 * 四个不变量：
 *   1. `streamGeneration` **只在进入新运行时递增**（`begin` 的成功分支），
 *      所以「同一次运行内的所有回调」共享一个代次，而「新运行的第一个回调」
 *      一定带着新代次 —— 迟到的旧回调因此永远匹配不上。
 *   2. 只有 `starting → capturing` 能正向推进；`markCapturing` 在已有
 *      `terminalError` 时拒绝（先出错的运行不该再被标成「正在采集」）。
 *   3. `claimTerminal` 只在 `capturing` 生效 —— `starting` 期间的终止必须走
 *      `deferTerminalDuringStart`，两条路径不能混。
 *   4. `end` 后 `active` 为 null，所有后续查询返回 null / false。
 */
export class ScreenRecorderRunSafetyState {
  private nextStreamGeneration = 0
  private active: ActiveRun | null = null

  get activeRunID(): RecordingRunID | null {
    return this.active?.token.runID ?? null
  }

  /** Swift L54-63。 */
  begin(runID: RecordingRunID): ScreenRecorderRunBeginResult {
    if (this.active != null) {
      return { kind: 'alreadyActive', runID: this.active.token.runID }
    }
    this.nextStreamGeneration += 1
    const token: ScreenRecorderRunToken = {
      runID,
      streamGeneration: this.nextStreamGeneration,
    }
    this.active = {
      token,
      lifecycle: 'starting',
      streamIdentities: new Set(),
      primaryStreamIdentity: null,
      latestSurfaceRevision: 0,
      terminalError: null,
    }
    return { kind: 'accepted', token }
  }

  /** Swift L65-76：登记主/辅流身份。辅流为 null 时只登记主流。 */
  registerStreams(
    primary: string,
    secondary: string | null,
    token: ScreenRecorderRunToken
  ): boolean {
    if (!this.matches(token)) return false
    const active = this.active!
    active.primaryStreamIdentity = primary
    active.streamIdentities = new Set([primary])
    if (secondary != null) active.streamIdentities.add(secondary)
    return true
  }

  /** Swift L78-85：只有 `starting` 且还没有终止错误才能进入 `capturing`。 */
  markCapturing(token: ScreenRecorderRunToken): boolean {
    if (!this.matches(token)) return false
    const active = this.active!
    if (active.lifecycle !== 'starting') return false
    if (active.terminalError != null) return false
    active.lifecycle = 'capturing'
    return true
  }

  /** Swift L87-100：`start` 期间到达的终止先记下，不改生命周期。 */
  deferTerminalDuringStart(error: CaptureSessionError, token: ScreenRecorderRunToken): boolean {
    if (!this.matches(token)) return false
    const active = this.active!
    if (active.lifecycle !== 'starting') return false
    if (active.terminalError != null) return false
    active.terminalError = error
    return true
  }

  /** Swift L102-109：代理回调要先换回 token；已终止的运行返回 null。 */
  tokenForDelegate(streamIdentity: string): ScreenRecorderRunToken | null {
    const active = this.active
    if (active == null) return null
    if (active.lifecycle !== 'starting' && active.lifecycle !== 'capturing') return null
    if (!active.streamIdentities.has(streamIdentity)) return null
    return active.token
  }

  /** Swift L113-123：主/辅流判定。 */
  streamRole(
    streamIdentity: string,
    token: ScreenRecorderRunToken
  ): ScreenRecorderStreamRole | null {
    if (!this.matches(token)) return null
    const active = this.active!
    if (!active.streamIdentities.has(streamIdentity)) return null
    return streamIdentity === active.primaryStreamIdentity ? 'primary' : 'secondary'
  }

  /** Swift L125-128。 */
  lifecycle(token: ScreenRecorderRunToken): ScreenRecorderRunLifecycle | null {
    if (!this.matches(token)) return null
    return this.active!.lifecycle
  }

  /** Swift L130-139：只在 `capturing` 认领，避免与 `deferTerminalDuringStart` 双报。 */
  claimTerminal(error: CaptureSessionError, token: ScreenRecorderRunToken): boolean {
    if (!this.matches(token)) return false
    const active = this.active!
    if (active.lifecycle !== 'capturing') return false
    active.lifecycle = 'terminal'
    active.terminalError = error
    return true
  }

  /** Swift L141-144：按 runID 取终止错误（供 `start` 的抛出路径使用）。 */
  terminalError(runID: RecordingRunID): CaptureSessionError | null {
    if (this.active?.token.runID !== runID) return null
    return this.active.terminalError
  }

  /** Swift L146-153：`capturing` 或 `terminal` 才可进入 `stopping`。 */
  beginStopping(runID: RecordingRunID): ScreenRecorderRunToken | null {
    const active = this.active
    if (active == null) return null
    if (active.token.runID !== runID) return null
    if (active.lifecycle !== 'capturing' && active.lifecycle !== 'terminal') return null
    active.lifecycle = 'stopping'
    return active.token
  }

  /** Swift L155-168：生成一个表面更新令牌（revision 递增）。 */
  makeSurfaceUpdate(runID: RecordingRunID): ScreenRecorderSurfaceUpdateToken | null {
    const active = this.active
    if (active == null) return null
    if (active.token.runID !== runID) return null
    if (active.lifecycle !== 'capturing') return null
    if (active.primaryStreamIdentity == null) return null
    active.latestSurfaceRevision += 1
    return {
      run: active.token,
      streamIdentity: active.primaryStreamIdentity,
      revision: active.latestSurfaceRevision,
    }
  }

  /**
   * Swift L170-181：表面更新的三态判定。
   *
   * 顺序有意义：**取消优先**。已经取消的更新即使身份完全匹配也不该应用 ——
   * 取消意味着「视图已经不在了」，应用它只会往废弃的图层写像素。
   */
  surfaceUpdateDecision(
    token: ScreenRecorderSurfaceUpdateToken,
    isCancelled: boolean
  ): ScreenRecorderSurfaceUpdateDecision {
    if (isCancelled) return 'cancelled'
    const active = this.active
    if (active == null) return 'stale'
    if (
      active.token.runID !== token.run.runID ||
      active.token.streamGeneration !== token.run.streamGeneration ||
      active.lifecycle !== 'capturing' ||
      active.primaryStreamIdentity !== token.streamIdentity ||
      active.latestSurfaceRevision !== token.revision
    ) {
      return 'stale'
    }
    return 'apply'
  }

  /** Swift L183-190。 */
  end(token: ScreenRecorderRunToken): boolean {
    if (!this.matches(token)) return false
    this.active = null
    return true
  }

  private matches(token: ScreenRecorderRunToken): boolean {
    const active = this.active
    if (active == null) return false
    return (
      active.token.runID === token.runID &&
      active.token.streamGeneration === token.streamGeneration
    )
  }
}

/** Swift L195-199：终止发生在哪个阶段。 */
export type CaptureOutputTerminalStage = 'writerStart' | 'videoAppend' | 'audioAppend'

/** Swift L203：错误域。 */
export const CAPTURE_OUTPUT_ERROR_DOMAIN = 'cn.laogou.dogsc.capture-output'

/** Swift L205-212：三个阶段的错误码。 */
export const CAPTURE_OUTPUT_TERMINAL_ERROR_CODES: Readonly<Record<CaptureOutputTerminalStage, number>> = {
  writerStart: 1,
  videoAppend: 2,
  audioAppend: 3,
}

/** Swift L225-232：三个阶段的中文描述。 */
export const CAPTURE_OUTPUT_TERMINAL_STAGE_DESCRIPTIONS: Readonly<
  Record<CaptureOutputTerminalStage, string>
> = {
  writerStart: '启动视频写入器',
  videoAppend: '写入视频帧',
  audioAppend: '写入系统声音',
}

/** Swift L205-212。 */
export function captureOutputTerminalErrorCode(stage: CaptureOutputTerminalStage): number {
  return CAPTURE_OUTPUT_TERMINAL_ERROR_CODES[stage]
}

/** Swift L215-217：`"%@失败：%@"`。 */
export function captureOutputTerminalErrorDescription(
  stage: CaptureOutputTerminalStage,
  underlyingDescription: string
): string {
  return `${CAPTURE_OUTPUT_TERMINAL_STAGE_DESCRIPTIONS[stage]}失败：${underlyingDescription}`
}

/**
 * Swift L239-244：一次性认领。
 *
 * `CaptureOutput` 的回调在采样队列上串行，但仍然把「只能认领一次」做成
 * 值策略 —— 这样错误路径可以被直接断言，而不是靠并发时序去猜。
 */
export class CaptureOutputTerminalState {
  private stageValue: CaptureOutputTerminalStage | null = null

  get stage(): CaptureOutputTerminalStage | null {
    return this.stageValue
  }

  claim(stage: CaptureOutputTerminalStage): boolean {
    if (this.stageValue != null) return false
    this.stageValue = stage
    return true
  }
}
