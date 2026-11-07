/**
 * 采集选择状态机 —— token 是唯一的护栏。
 *
 * Swift source: Sources/DogSCApp/CaptureSelectionState.swift（204 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct CaptureSelectionToken                      L4-10   → CaptureSelectionToken
 *   - enum CaptureSelectionTarget（四态）               L14-76  → CaptureSelectionTarget
 *     · var source                                      L25-32  → captureSelectionTargetSource
 *     · materializing(in:)                              L34-75  → materializeCaptureSelectionTarget
 *   - struct CaptureSelectionSession（token / source）  L78-81  → CaptureSelectionSession
 *   - enum CaptureSelectionState（idle/selecting/ready） L83-103 → CaptureSelectionState
 *     · session / selectedSource / target / canStartRecording        → 同名访问器
 *   - enum CaptureSelectionEvent（4 个事件）            L105-110 → CaptureSelectionEvent
 *   - enum CaptureSelectionReducer.reduce               L112-137 → reduceCaptureSelection
 *   - final class CaptureSelectionCoordinator           L141-204 → CaptureSelectionCoordinator
 *
 * 原注释（L12-13）：
 *   A confirmed source target. Transient hover and loading data never enter the
 *   persisted `CaptureConfiguration`; only this value may materialize a target.
 *
 * 原注释（L139-140）：
 *   Owns token issuance and guarantees that callbacks from an older selector
 *   session cannot mutate the currently visible selection.
 *
 * 原注释（L185-187）：
 *   Invalidates the current session without reusing its generation. External
 *   lifecycle resets (closing a project or abandoning a recording) use this;
 *   selector callbacks must continue to use token-scoped `cancel(token:)`.
 *
 * 迁移说明：这是纯状态机，TypeScript 侧几乎逐行同构。唯一的额外工作是
 * `materializing(in:)` 里那张「清空所有来源字段再按 target 填回」的表 ——
 * Swift 用 9 行显式置 nil，这里必须同样显式，**不能**用 `{...base, source}`
 * 再加几个可选字段，否则上一次选择的 `windowID` 会残留下来。
 */

import {
  constrainedRect,
  type CaptureConfiguration,
  type CaptureSource,
  type NormalizedRect,
} from './CaptureConfiguration'

/** Swift L4-10：单调递增的选择代次。 */
export interface CaptureSelectionToken {
  readonly rawValue: number
}

export function makeCaptureSelectionToken(rawValue: number): CaptureSelectionToken {
  return { rawValue }
}

export function captureSelectionTokensEqual(
  a: CaptureSelectionToken | null,
  b: CaptureSelectionToken | null
): boolean {
  if (a == null || b == null) return a == null && b == null
  return a.rawValue === b.rawValue
}

/** Swift L14-24：四种「已确认」的来源。 */
export type CaptureSelectionTarget =
  | { readonly kind: 'display'; readonly id: number; readonly name: string }
  | {
      readonly kind: 'window'
      readonly id: number
      readonly name: string
      readonly applicationBundleIdentifier: string | null
      readonly applicationName: string | null
    }
  | {
      readonly kind: 'area'
      readonly displayID: number | null
      readonly displayName: string | null
      readonly rect: NormalizedRect
    }
  | { readonly kind: 'device'; readonly id: string; readonly name: string }

/** Swift L25-32：target → 来源类型。 */
export function captureSelectionTargetSource(target: CaptureSelectionTarget): CaptureSource {
  return target.kind
}

/**
 * Swift L34-75：把 target 灌进配置。
 *
 * 顺序不能变：先 `source`，再逐项置 null（九个字段），最后按 target 填。
 * 中途任何一步省略，上一次选择的残留字段就会让录制抓到错误的窗口/设备。
 *
 * 三处「降级到全部系统声音」的理由不同：
 *   - window：`selectedApplication` 需要 bundle id，窗口拿不到就只能退
 *   - area：区域选择不属于任何 App
 *   - device：摄像头录制没有「所选窗口 App」这个概念
 */
export function materializeCaptureSelectionTarget(
  base: CaptureConfiguration,
  target: CaptureSelectionTarget
): CaptureConfiguration {
  const result: CaptureConfiguration = {
    ...base,
    source: captureSelectionTargetSource(target),
    displayID: null,
    displayName: null,
    windowID: null,
    windowName: null,
    selectedApplicationBundleIdentifier: null,
    selectedApplicationName: null,
    area: null,
    deviceID: null,
    deviceName: null,
  }
  switch (target.kind) {
    case 'display':
      result.displayID = target.id
      result.displayName = target.name
      break
    case 'window':
      result.windowID = target.id
      result.windowName = target.name
      result.selectedApplicationBundleIdentifier = target.applicationBundleIdentifier
      result.selectedApplicationName = target.applicationName
      if (
        result.systemAudioScope === 'selectedApplication' &&
        target.applicationBundleIdentifier == null
      ) {
        result.systemAudioScope = 'all'
      }
      break
    case 'area':
      result.displayID = target.displayID
      result.displayName = target.displayName
      // 只有区域要走一次约束：最小 0.02、不越出右/下边界。
      result.area = constrainedRect(target.rect)
      if (result.systemAudioScope === 'selectedApplication') {
        result.systemAudioScope = 'all'
      }
      break
    case 'device':
      result.deviceID = target.id
      result.deviceName = target.name
      if (result.systemAudioScope === 'selectedApplication') {
        result.systemAudioScope = 'all'
      }
      break
  }
  return result
}

/** Swift L78-81。 */
export interface CaptureSelectionSession {
  readonly token: CaptureSelectionToken
  readonly source: CaptureSource
}

/** Swift L83-103：三态。 */
export type CaptureSelectionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'selecting'; readonly session: CaptureSelectionSession }
  | {
      readonly kind: 'ready'
      readonly session: CaptureSelectionSession
      readonly target: CaptureSelectionTarget
    }

export const CAPTURE_SELECTION_IDLE: CaptureSelectionState = { kind: 'idle' }

/** Swift L88-95。 */
export function captureSelectionSession(
  state: CaptureSelectionState
): CaptureSelectionSession | null {
  return state.kind === 'idle' ? null : state.session
}

/** Swift L97。 */
export function captureSelectionSelectedSource(
  state: CaptureSelectionState
): CaptureSource | null {
  return captureSelectionSession(state)?.source ?? null
}

/** Swift L98-101：只有 `ready` 才有 target。 */
export function captureSelectionTarget(
  state: CaptureSelectionState
): CaptureSelectionTarget | null {
  return state.kind === 'ready' ? state.target : null
}

/** Swift L102：能开始录制 ⇔ 有 target。 */
export function captureSelectionCanStartRecording(state: CaptureSelectionState): boolean {
  return captureSelectionTarget(state) != null
}

/** Swift `CaptureSelectionTarget: Equatable`（结构体按字段比，不是按引用）。 */
export function captureSelectionTargetsEqual(
  a: CaptureSelectionTarget,
  b: CaptureSelectionTarget
): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'display':
      return b.kind === 'display' && a.id === b.id && a.name === b.name
    case 'window':
      return (
        b.kind === 'window' &&
        a.id === b.id &&
        a.name === b.name &&
        a.applicationBundleIdentifier === b.applicationBundleIdentifier &&
        a.applicationName === b.applicationName
      )
    case 'area':
      return (
        b.kind === 'area' &&
        a.displayID === b.displayID &&
        a.displayName === b.displayName &&
        a.rect.x === b.rect.x &&
        a.rect.y === b.rect.y &&
        a.rect.width === b.rect.width &&
        a.rect.height === b.rect.height
      )
    case 'device':
      return b.kind === 'device' && a.id === b.id && a.name === b.name
  }
}

/**
 * Swift `CaptureSelectionState: Equatable`。
 *
 * 这条**必须**是值比较 —— 协调器的 `confirm/unlock/cancel` 都靠
 * `state != before` 决定返回 true/false。写成引用比较会让「对同一个已确认
 * 目标点两次」两次都返回 true，宿主就会重复触发「开始录制」。
 */
export function captureSelectionStatesEqual(
  a: CaptureSelectionState,
  b: CaptureSelectionState
): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'idle' || b.kind === 'idle') return a.kind === b.kind
  if (!captureSelectionTokensEqual(a.session.token, b.session.token)) return false
  if (a.session.source !== b.session.source) return false
  if (a.kind === 'ready' && b.kind === 'ready') {
    return captureSelectionTargetsEqual(a.target, b.target)
  }
  return a.kind === b.kind
}

/** Swift L105-110。 */
export type CaptureSelectionEvent =
  | { readonly kind: 'choose'; readonly source: CaptureSource; readonly token: CaptureSelectionToken }
  | {
      readonly kind: 'confirm'
      readonly target: CaptureSelectionTarget
      readonly token: CaptureSelectionToken
    }
  | { readonly kind: 'unlock'; readonly token: CaptureSelectionToken }
  | { readonly kind: 'cancel'; readonly token: CaptureSelectionToken }

/** Swift L112-137：四个事件的完整语义。 */
export function reduceCaptureSelection(
  state: CaptureSelectionState,
  event: CaptureSelectionEvent
): CaptureSelectionState {
  const session = captureSelectionSession(state)
  switch (event.kind) {
    case 'choose':
      return {
        kind: 'selecting',
        session: { token: event.token, source: event.source },
      }
    case 'confirm':
      if (session == null) return state
      if (!captureSelectionTokensEqual(session.token, event.token)) return state
      if (session.source !== captureSelectionTargetSource(event.target)) return state
      return { kind: 'ready', session, target: event.target }
    case 'unlock':
      if (session == null) return state
      if (!captureSelectionTokensEqual(session.token, event.token)) return state
      return { kind: 'selecting', session }
    case 'cancel':
      if (session == null) return state
      if (!captureSelectionTokensEqual(session.token, event.token)) return state
      return CAPTURE_SELECTION_IDLE
  }
}

/**
 * Swift L141-204：发 token 的协调器。
 *
 * `choose` 用 `&+= 1` 后**先**发事件再读回 session —— 因为 `reduce` 对
 * `choose` 无条件生效，所以 `state.session!` 一定非空。若这里改成
 * 「先判断能不能改再发事件」，`choose` 就会需要一份额外的特例。
 */
export class CaptureSelectionCoordinator {
  private stateValue: CaptureSelectionState = CAPTURE_SELECTION_IDLE
  private nextTokenValue = 0
  private readonly onChange: (state: CaptureSelectionState) => void

  constructor(onChange: (state: CaptureSelectionState) => void = () => {}) {
    this.onChange = onChange
  }

  get state(): CaptureSelectionState {
    return this.stateValue
  }

  /** Swift L147-156。 */
  choose(source: CaptureSource): CaptureSelectionSession {
    this.nextTokenValue += 1
    const token = makeCaptureSelectionToken(this.nextTokenValue)
    this.setState(reduceCaptureSelection(this.stateValue, { kind: 'choose', source, token }))
    const session = captureSelectionSession(this.stateValue)
    if (session == null) {
      throw new Error('capture selection: choose 之后必须处于 selecting')
    }
    return session
  }

  /** Swift L158-169：返回「是否发生了变化」。 */
  confirm(target: CaptureSelectionTarget, token: CaptureSelectionToken): boolean {
    const before = this.stateValue
    this.setState(reduceCaptureSelection(this.stateValue, { kind: 'confirm', target, token }))
    return !captureSelectionStatesEqual(this.stateValue, before)
  }

  /** Swift L171-176。 */
  unlock(token: CaptureSelectionToken): boolean {
    const before = this.stateValue
    this.setState(reduceCaptureSelection(this.stateValue, { kind: 'unlock', token }))
    return !captureSelectionStatesEqual(this.stateValue, before)
  }

  /** Swift L178-183。 */
  cancel(token: CaptureSelectionToken): boolean {
    const before = this.stateValue
    this.setState(reduceCaptureSelection(this.stateValue, { kind: 'cancel', token }))
    return !captureSelectionStatesEqual(this.stateValue, before)
  }

  /** Swift L188-193：外部生命周期复位，不消耗 token。 */
  reset(): boolean {
    if (this.stateValue.kind === 'idle') return false
    this.setState(CAPTURE_SELECTION_IDLE)
    return true
  }

  /** Swift L195-197：迟到的选择器回调先问这一句。 */
  isCurrent(token: CaptureSelectionToken): boolean {
    return captureSelectionTokensEqual(captureSelectionSession(this.stateValue)?.token ?? null, token)
  }

  /** Swift L199-203：状态没变就不通知（避免无意义重绘）。 */
  private setState(newState: CaptureSelectionState): void {
    if (captureSelectionStatesEqual(newState, this.stateValue)) return
    this.stateValue = newState
    this.onChange(newState)
  }
}
