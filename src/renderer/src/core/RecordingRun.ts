/**
 * RecordingRun —— 一次录制作业的值语义快照与代数状态。
 *
 * Swift source: Sources/DogSCApp/RecordingRun.swift（276 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L5-11    RecordingRunID
 *   L13-49   RecordingPlanError（十种 + 文案）
 *   L54-159  RecordingPlan（target / configuration / inputDeviceRequests /
 *            pointerCaptureFrame / automaticallyCreatesZooms）
 *   L71-99   构造器的五组校验
 *   L100-111 三条精确设备请求的追加顺序
 *   L119-126 primaryRecordingRelativePath
 *   L128-138 initialMediaManifest
 *   L140-157 validateAvailability
 *   L161-173 RecordingStartedTracks（五个位）
 *   L175-183 RecordingRun.adding
 *   L187-219 RecordingRunState（begin / isCurrent / markStarted / end）
 *   L221-266 pointerCaptureFrame(for:availableWindows:)
 *   L268-276 currentCaptureWindowIDs
 *
 * 迁移说明：
 *   这是「一次录制从头到尾只有一份快照」的实现。三处关键语义：
 *     1. 重录时代次替换，任何带着旧 id 的迟到完成都无法改到新 run
 *     2. 窗口在 plan 冻结与真正开始之间被关掉时**必须显式失败** ——
 *        静默退化成整屏会让指针事件按整屏归一化、视频轨按窗口裁切，
 *        光标位置全部错位
 *     3. 设备请求永远是 `exact`，绝不出现 `automatic` —— 用户勾了「录摄像头」
 *        却录到「系统默认」，是比报错更糟的失败
 */

/** Swift L13-49：十种规划错误与文案。 */
export type RecordingPlanErrorKind =
  | 'targetDoesNotMatchConfiguration'
  | 'invalidDisplay'
  | 'invalidWindow'
  | 'invalidArea'
  | 'invalidDevice'
  | 'displayUnavailable'
  | 'windowUnavailable'
  | 'deviceUnavailable'
  | 'missingCamera'
  | 'missingMicrophone'

export const RECORDING_PLAN_ERROR_DESCRIPTIONS: Readonly<
  Record<RecordingPlanErrorKind, string>
> = {
  targetDoesNotMatchConfiguration: '录制目标已变更，请重新选择显示器、窗口、区域或设备。',
  invalidDisplay: '请先选择要录制的显示器。',
  invalidWindow: '请先选择要录制的窗口。',
  invalidArea: '请先拖动选择要录制的区域。',
  invalidDevice: '请先选择要录制的 iPhone 或 iPad。',
  displayUnavailable: '已选择的显示器已断开，请重新选择。',
  windowUnavailable: '已选择的窗口已关闭，请重新选择。',
  deviceUnavailable: '已选择的 iPhone 或 iPad 已断开，请重新选择。',
  missingCamera: '已开启摄像头，但没有选择可用的摄像头。',
  missingMicrophone: '已开启麦克风，但没有选择可用的麦克风。',
}

export function recordingPlanErrorDescription(kind: RecordingPlanErrorKind): string {
  return RECORDING_PLAN_ERROR_DESCRIPTIONS[kind]
}

/** Swift L54-63：录制目标。 */
export type RecordingPlanTarget =
  | { readonly kind: 'display'; readonly displayID: number }
  | { readonly kind: 'window'; readonly windowID: number }
  | {
      readonly kind: 'area'
      readonly displayID: number | null
      readonly rect: {
        readonly x: number
        readonly y: number
        readonly width: number
        readonly height: number
      }
      readonly rectIsConstrained: boolean
    }
  | { readonly kind: 'device'; readonly deviceID: string }

/**
 * Swift L75-91：目标本身的合法性。
 *
 * 四种目标各一条：显示器和窗口的 id 不能是 0；区域必须有显示器 id、
 * 矩形必须已经过 `constrained()`、四个分量都得有限；设备 id 去空白后不能为空。
 *
 * 区域那条最容易漏：`rect == rect.constrained()` 是在检查「调用方有没有
 * 先夹取过」。没夹取的矩形可能跑到屏幕外，之后按它算指针归一化会得到负数。
 */
export function recordingPlanTargetError(
  target: RecordingPlanTarget
): RecordingPlanErrorKind | null {
  switch (target.kind) {
    case 'display':
      return target.displayID !== 0 ? null : 'invalidDisplay'
    case 'window':
      return target.windowID !== 0 ? null : 'invalidWindow'
    case 'area': {
      const rect = target.rect
      const finite =
        Number.isFinite(rect.x) &&
        Number.isFinite(rect.y) &&
        Number.isFinite(rect.width) &&
        Number.isFinite(rect.height)
      const ok = target.displayID != null && target.rectIsConstrained && finite
      return ok ? null : 'invalidArea'
    }
    case 'device':
      return target.deviceID.trim().length > 0 ? null : 'invalidDevice'
  }
}

/**
 * Swift L92-99：勾了轨却没有设备。
 *
 * 注意判断写成 `cameraDeviceID?.isEmpty != false` —— 也就是说 **null 和空串
 * 都算缺失**。写成 `== true` 会漏掉 null 的情况（此时 `?.isEmpty` 是 nil）。
 */
export function recordingPlanInputDeviceError(input: {
  readonly recordsCamera: boolean
  readonly cameraDeviceID: string | null
  readonly recordsMicrophone: boolean
  readonly microphoneDeviceID: string | null
}): RecordingPlanErrorKind | null {
  if (input.recordsCamera && (input.cameraDeviceID == null || input.cameraDeviceID.length === 0)) {
    return 'missingCamera'
  }
  if (
    input.recordsMicrophone &&
    (input.microphoneDeviceID == null || input.microphoneDeviceID.length === 0)
  ) {
    return 'missingMicrophone'
  }
  return null
}

/** Swift L58-59：一条精确设备请求。 */
export interface CaptureInputDeviceRequest {
  readonly role: 'iosDevice' | 'camera' | 'microphone'
  readonly kind: 'exact'
  readonly uniqueID: string
}

/**
 * Swift L100-111：设备请求的**追加顺序**。
 *
 * 依次是：iOS 端点（若目标是设备）→ 摄像头（若开）→ 麦克风（若开）。
 * 全部是 `exact`。顺序本身有意义：下断言时按 id 位置比对，顺序错了虽然
 * 功能上等价，但会掩盖「iOS 端点是不是被当成摄像头加进去了」这类问题。
 */
export function recordingPlanInputDeviceRequests(input: {
  readonly target: RecordingPlanTarget
  readonly recordsCamera: boolean
  readonly cameraDeviceID: string | null
  readonly recordsMicrophone: boolean
  readonly microphoneDeviceID: string | null
}): readonly CaptureInputDeviceRequest[] {
  const requests: CaptureInputDeviceRequest[] = []
  if (input.target.kind === 'device') {
    requests.push({ role: 'iosDevice', kind: 'exact', uniqueID: input.target.deviceID })
  }
  if (input.recordsCamera && input.cameraDeviceID != null) {
    requests.push({ role: 'camera', kind: 'exact', uniqueID: input.cameraDeviceID })
  }
  if (input.recordsMicrophone && input.microphoneDeviceID != null) {
    requests.push({ role: 'microphone', kind: 'exact', uniqueID: input.microphoneDeviceID })
  }
  return requests
}

/** Swift L119-126：主录制的相对路径。 */
export function recordingPlanPrimaryRelativePath(input: {
  readonly source: string
  readonly captureCodecUsesMOVContainer: boolean
}): string {
  if (input.source === 'device') return 'media/device-0001.mov'
  return input.captureCodecUsesMOVContainer
    ? 'media/screen-0001.mov'
    : 'media/screen-0001.mp4'
}

/** Swift L128-138：初始媒体清单。 */
export interface RecordingPlanMediaManifest {
  readonly screen: { readonly relativePath: string }
  readonly camera: { readonly relativePath: string } | null
  readonly microphone: { readonly relativePath: string } | null
  readonly pointerEvents: { readonly relativePath: string } | null
}

/**
 * Swift L128-138：三路可选媒体与一条指针事件流。
 *
 * 设备录制时 `pointerEvents` 为 null —— iOS 端点没有桌面指针，写一个空的
 * jsonl 反而会让导出器去读一个不存在的文件。
 */
export function recordingPlanInitialMediaManifest(input: {
  readonly source: string
  readonly captureCodecUsesMOVContainer: boolean
  readonly recordsCamera: boolean
  readonly recordsMicrophone: boolean
}): RecordingPlanMediaManifest {
  return {
    screen: {
      relativePath: recordingPlanPrimaryRelativePath({
        source: input.source,
        captureCodecUsesMOVContainer: input.captureCodecUsesMOVContainer,
      }),
    },
    camera: input.recordsCamera
      ? { relativePath: 'media/camera-0001.mov' }
      : null,
    microphone: input.recordsMicrophone
      ? { relativePath: 'media/microphone.m4a' }
      : null,
    pointerEvents:
      input.source === 'device'
        ? null
        : { relativePath: 'events/pointer.jsonl' },
  }
}

/**
 * Swift L140-157：真正开始前的可用性复核。
 *
 * 区域目标与显示器目标是**同一个**错误（`displayUnavailable`），
 * 因为区域录制依赖的也是那块屏。设备断开会给 `deviceUnavailable`，
 * 而不是笼统的「目标不可用」。
 */
export function recordingPlanAvailabilityError(input: {
  readonly target: RecordingPlanTarget
  readonly displayIDs: ReadonlySet<number>
  readonly windowIDs: ReadonlySet<number>
  readonly deviceIDs: ReadonlySet<string>
}): RecordingPlanErrorKind | null {
  switch (input.target.kind) {
    case 'display':
      return input.displayIDs.has(input.target.displayID) ? null : 'displayUnavailable'
    case 'area':
      return input.target.displayID != null && input.displayIDs.has(input.target.displayID)
        ? null
        : 'displayUnavailable'
    case 'window':
      return input.windowIDs.has(input.target.windowID) ? null : 'windowUnavailable'
    case 'device':
      return input.deviceIDs.has(input.target.deviceID) ? null : 'deviceUnavailable'
  }
}

/**
 * Swift L161-173：五条轨的位。
 *
 * 用位集合而不是数组，是为了让 `adding` 天然幂等 —— 同一条轨标记两次
 * 结果不变，迟到的重复回调不会出错。
 */
export const RECORDING_TRACK_BITS: Readonly<Record<string, number>> = {
  screen: 1 << 0,
  device: 1 << 1,
  camera: 1 << 2,
  microphone: 1 << 3,
  pointer: 1 << 4,
}

export function recordingStartedTracksUnion(lhs: number, rhs: number): number {
  return lhs | rhs
}

export function recordingStartedTrackEnabled(mask: number, track: string): boolean {
  const bit = RECORDING_TRACK_BITS[track]
  if (bit == null) return false
  return (mask & bit) !== 0
}

/**
 * Swift L187-219：代次状态机。
 *
 * 四个方法 + 四个不变量：
 *   - `begin` 永远替换 active（重录即换代）
 *   - `isCurrent` 只比值，不看其它字段
 *   - `markStarted` 只在 id 匹配时生效，否则返回 false 且**不修改**状态
 *   - `end` 只在 id 匹配时返回被结束的 run 并清空；不匹配返回 null 且**保留**当前 run
 *
 * 最后一条是重点：不匹配时若也清空，一个迟到的旧 `end` 会把新 run 干掉。
 */
export class RecordingRunState {
  private activeRun: {
    readonly id: string
    readonly startedTracks: number
  } | null = null

  get activeID(): string | null {
    return this.activeRun?.id ?? null
  }

  get activeTracks(): number {
    return this.activeRun?.startedTracks ?? 0
  }

  begin(id: string): { readonly id: string; readonly startedTracks: number } {
    const run = { id, startedTracks: 0 }
    this.activeRun = run
    return run
  }

  isCurrent(id: string): boolean {
    return this.activeRun?.id === id
  }

  markStarted(track: string, id: string): boolean {
    const run = this.activeRun
    if (run == null || run.id !== id) return false
    const bit = RECORDING_TRACK_BITS[track]
    if (bit == null) return false
    this.activeRun = { id: run.id, startedTracks: recordingStartedTracksUnion(run.startedTracks, bit) }
    return true
  }

  end(id: string): { readonly id: string; readonly startedTracks: number } | null {
    const run = this.activeRun
    if (run == null || run.id !== id) return null
    this.activeRun = null
    return run
  }
}

/** Swift L222-266：指针捕获帧的解析结果。 */
export type PointerCaptureFrameResult =
  | { readonly ok: true; readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } }
  | { readonly ok: false; readonly error: RecordingPlanErrorKind }

/**
 * Swift L221-266：冻结指针捕获用的屏幕矩形。
 *
 *  - `display`  → 整块屏
 *  - `area`     → 屏矩形 + 归一化区域（y 要翻转：`1 − y − height`）；
 *                 区域为 null 时退回整屏
 *  - `window`   → 必须是**当前**活着的窗口几何；窗口已关就显式失败
 *  - `device`   → 零矩形（iOS 端点没有桌面坐标）
 *
 * 窗口分支有三道校验：id 在可用列表里、能查到活几何、查到的几何 id 与请求
 * 一致。第三道防的是「窗口 id 被系统复用」。
 */
export function pointerCaptureFrame(input: {
  readonly target: RecordingPlanTarget
  readonly screenFrame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null
  readonly screenResolvedWithoutRequest: boolean
  readonly area: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null
  readonly windowIsAvailable: boolean
  readonly windowGeometry: {
    readonly windowID: number
    readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  } | null
}): PointerCaptureFrameResult {
  const screenOrError = (): PointerCaptureFrameResult => {
    if (input.screenFrame == null) {
      return {
        ok: false,
        error: input.screenResolvedWithoutRequest ? 'invalidDisplay' : 'displayUnavailable',
      }
    }
    return { ok: true, frame: input.screenFrame }
  }

  switch (input.target.kind) {
    case 'display':
      return screenOrError()
    case 'area': {
      const screen = screenOrError()
      if (!screen.ok) return screen
      const area = input.area
      if (area == null) return { ok: true, frame: screen.frame }
      return {
        ok: true,
        frame: {
          x: screen.frame.x + area.x * screen.frame.width,
          y: screen.frame.y + (1 - area.y - area.height) * screen.frame.height,
          width: area.width * screen.frame.width,
          height: area.height * screen.frame.height,
        },
      }
    }
    case 'window': {
      const geometry = input.windowGeometry
      const ok =
        input.windowIsAvailable &&
        geometry != null &&
        geometry.windowID === input.target.windowID
      if (!ok) return { ok: false, error: 'windowUnavailable' }
      return { ok: true, frame: geometry!.frame }
    }
    case 'device':
      return { ok: true, frame: { x: 0, y: 0, width: 0, height: 0 } }
  }
}

/**
 * Swift L243-249：区域为空时退回整屏，但**显示器缺失仍然报错**。
 *
 * 这两件事必须分开：区域没选是正常的初始态（用户还没拖），显示器没了
 * 是故障。合并处理会让「不选区域」变成一条错误。
 */
export function pointerCaptureAreaFallsBackToScreen(input: {
  readonly hasArea: boolean
}): boolean {
  return !input.hasArea
}

/**
 * Swift L255-257：窗口不可用时**绝不**退化成整屏。
 *
 * 退化会让指针事件按整屏归一化、视频轨按窗口裁切 —— 光标位置全部错位，
 * 而且这种错位在成片里才看得出来。宁可让开始录制失败。
 */
export function pointerCaptureWindowMayDegradeToScreen(): boolean {
  return false
}

/**
 * Swift L268-276：当前所有窗口 id。
 *
 * `[.optionAll, .excludeDesktopElements]` —— 必须包含屏幕外/最小化窗口，
 * 但排除桌面元素（否则 Dock 与壁纸会被列成可录窗口）。
 */
export const CAPTURE_WINDOW_LIST_OPTIONS: readonly string[] = [
  'optionAll',
  'excludeDesktopElements',
]

/**
 * Swift L185-186：加入一条轨时的值语义。
 *
 * 返回**新的** run 而不是就地修改 —— 这正是「迟到的完成拿着旧 id」能安全
 * 被拒绝的原因：旧对象根本不会被改。
 */
export function recordingRunAdding(input: {
  readonly currentTracks: number
  readonly addedMask: number
}): number {
  return recordingStartedTracksUnion(input.currentTracks, input.addedMask)
}
