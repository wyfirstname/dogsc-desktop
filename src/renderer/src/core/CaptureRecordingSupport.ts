/**
 * 采集录制的支撑件 —— 错误文案、角色、阶段状态、取消标志与主机时钟换算。
 *
 * Swift source: Sources/DogSCApp/CaptureRecordingSupport.swift（168 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - enum CameraRecorderError                       L8-23   → cameraRecorderErrorMessage
 *   - enum MovieCaptureRole                          L25-42  → MOVIE_CAPTURE_ROLES / movieCaptureRole*
 *   - enum MicrophoneRecorderError                   L44-56  → microphoneRecorderErrorMessage
 *   - enum RecorderSetupErrorRecovery                L60-95  → recorderSetupErrorRecoveryForMessage / isPermissionMessage / isSurfaceUpdateErrorMessage
 *   - final class CaptureCancellationFlag            L97-105 → CaptureCancellationFlag
 *   - enum CaptureActivity                           L107-127 → CaptureActivity / captureActivity*
 *   - struct CaptureFinishOutcome                    L129-139 → captureFinishOutcome
 *   - func captureSampleHostTime(_:session:)         L145-163 → captureSampleHostTime
 *
 * 原注释（L58-59）：
 *   Recovery follows the canonical error presentation in the current language.
 *   Legacy Chinese prefixes remain compatible with earlier message producers.
 *
 * 原注释（L141-144）：
 *   Convert a capture-session sample timestamp onto the one host clock shared
 *   with ScreenCaptureKit and the other recorder sessions. Comparing raw sample
 *   seconds from different session master clocks is not a valid synchronization
 *   operation even when their numeric values happen to look similar.
 *
 * 迁移说明：`AVErrorRecordingSuccessfullyFinishedKey`、`CMSyncConvertTime` 都是
 * macOS 专属；Windows 侧 ffmpeg 用 `-progress` 的 `out_time` 与 `QPC` 时间基准。
 * 保留的是**判据**：什么算成功结束、什么样的时间戳可用、错误消息怎么归类。
 */

/** Swift L8-23 的三类摄像头错误。 */
export type CameraRecorderErrorKind = 'permissionDenied' | 'cannotConfigure' | 'recordingFailed'

/** Swift L13-22。 */
export function cameraRecorderErrorMessage(
  kind: CameraRecorderErrorKind,
  args: readonly string[],
  translate: (key: string) => string = (key) => key
): string {
  switch (kind) {
    case 'permissionDenied':
      return formatArguments(translate('没有%@采集权限。'), [translate(args[0] ?? '')])
    case 'cannotConfigure':
      return formatArguments(translate('无法配置%@录制。'), [translate(args[0] ?? '')])
    case 'recordingFailed':
      return formatArguments(translate('%@录制失败：%@'), [
        translate(args[0] ?? ''),
        translate(args[1] ?? ''),
      ])
  }
}

/** Swift L25-42。 */
export type MovieCaptureRole = 'camera' | 'iosDevice'

export const MOVIE_CAPTURE_ROLES: readonly MovieCaptureRole[] = ['camera', 'iosDevice']

/** Swift L29-34：显示名（经过本地化）。 */
export function movieCaptureRoleDisplayName(
  role: MovieCaptureRole,
  translate: (key: string) => string = (key) => key
): string {
  return translate(role === 'camera' ? '摄像头' : 'iPhone/iPad 屏幕')
}

/**
 * Swift L36-41：角色即输入设备角色，一一对应。
 * 绝不做「摄像头失败就用 iOS」这类回退 —— 两者的采集路径完全不同。
 */
export function movieCaptureRoleInputDeviceRole(role: MovieCaptureRole): 'camera' | 'iosDevice' {
  return role
}

/** Swift L44-56。 */
export type MicrophoneRecorderErrorKind = 'permissionDenied' | 'recordingFailed'

export function microphoneRecorderErrorMessage(
  kind: MicrophoneRecorderErrorKind,
  args: readonly string[],
  translate: (key: string) => string = (key) => key
): string {
  if (kind === 'permissionDenied') return translate('没有麦克风权限。')
  return formatArguments(translate('麦克风录制失败：%@'), [translate(args[0] ?? '')])
}

/** Swift L60-64。 */
export type RecorderSetupErrorRecovery = 'projectFolder' | 'camera' | 'microphone' | 'none'

/**
 * Swift L66-80。
 *
 * 每条都接受**两种**形态：历史中文前缀，以及「当前语言下的规范文案」。
 * 注释（L58-59）说明了原因：早期的消息生产者写死了中文前缀，不能因为换了语言
 * 就识别不出来 —— 认不出来意味着「恢复」按钮消失，用户只能重开应用。
 */
export function recorderSetupErrorRecoveryForMessage(
  message: string,
  input: {
    readonly translate?: (key: string) => string
    /** `CameraRecorderError.permissionDenied("摄像头")` 的最终文案。 */
    readonly cameraPermissionMessage?: string | null
    /** `MicrophoneRecorderError.permissionDenied` 的最终文案。 */
    readonly microphonePermissionMessage?: string | null
  } = {}
): RecorderSetupErrorRecovery {
  const translate = input.translate ?? ((key: string) => key)
  if (message.startsWith('保存目录不可用') || message.startsWith(translate('保存目录不可用'))) {
    return 'projectFolder'
  }
  const cameraPermission = input.cameraPermissionMessage ?? null
  if (
    message.startsWith('没有摄像头采集权限') ||
    (cameraPermission !== null && message === cameraPermission)
  ) {
    return 'camera'
  }
  const microphonePermission = input.microphonePermissionMessage ?? null
  if (
    message.startsWith('没有麦克风权限') ||
    (microphonePermission !== null && message === microphonePermission)
  ) {
    return 'microphone'
  }
  return 'none'
}

/**
 * Swift L82-88：是否是权限类消息。
 *
 * `message.contains("权限")` 是**有意宽松**的一步：宁可多给一次「去设置」
 * 的入口，也不要让用户卡在一条认不出来的拒绝消息上。
 */
export function isPermissionMessage(
  message: string,
  input: {
    readonly translate?: (key: string) => string
    readonly cameraPermissionMessage?: string | null
    readonly microphonePermissionMessage?: string | null
    readonly screenPermissionMessage?: string | null
    readonly iosPermissionMessage?: string | null
  } = {}
): boolean {
  const translate = input.translate ?? ((key: string) => key)
  if (message.includes('权限')) return true
  const recovery = recorderSetupErrorRecoveryForMessage(message, input)
  if (recovery === 'camera' || recovery === 'microphone') return true
  const screen = input.screenPermissionMessage ?? translate('没有屏幕录制权限。请在系统设置中允许后重新启动。')
  if (message === screen) return true
  const ios = input.iosPermissionMessage ?? null
  return ios !== null && message === ios
}

/**
 * Swift L90-94：
 *   hasPrefix("无法更新录制画面")
 *   || hasPrefix(appLocalized("无法更新录制画面"))
 *   || hasPrefix(String(format: appLocalized("无法更新录制画面：%@"), ""))
 *
 * 第三条其实是「带冒号的形态」，因为把 `%@` 换成空串就得到前缀本身。
 */
export function isSurfaceUpdateErrorMessage(
  message: string,
  translate: (key: string) => string = (key) => key
): boolean {
  return (
    message.startsWith('无法更新录制画面') ||
    message.startsWith(translate('无法更新录制画面')) ||
    message.startsWith(formatArguments(translate('无法更新录制画面：%@'), ['']))
  )
}

/** Swift L97-105：跨线程的取消标志。 */
export class CaptureCancellationFlag {
  private cancelled = false

  get isCancelled(): boolean {
    return this.cancelled
  }

  /** 幂等：重复取消不改变结果，也不报错。 */
  cancel(): void {
    this.cancelled = true
  }
}

/** Swift L107-127。 */
export type CaptureActivity =
  | { readonly kind: 'idle' }
  | { readonly kind: 'livePreview'; readonly requestID: string }
  | { readonly kind: 'starting'; readonly requestID: string }
  | { readonly kind: 'recording'; readonly requestID: string }
  | { readonly kind: 'stopping'; readonly requestID: string }

/**
 * Swift L114-119：只有 starting / recording / stopping 带录制请求 id。
 * `livePreview` 有 id 但那是**预览**会话的 id，不能当成录制请求 ——
 * 混用会让停止逻辑去停一个不存在的录制。
 */
export function captureActivityRecordingRequestID(activity: CaptureActivity): string | null {
  switch (activity.kind) {
    case 'starting':
    case 'recording':
    case 'stopping':
      return activity.requestID
    case 'idle':
    case 'livePreview':
      return null
  }
}

/** Swift L121：拥有输出文件 = 有录制请求 id。 */
export function captureActivityOwnsRecordingOutput(activity: CaptureActivity): boolean {
  return captureActivityRecordingRequestID(activity) !== null
}

/** Swift L123-126：只有 recording 才算「正在录」。stopping 已经不再写帧了。 */
export function captureActivityIsRecording(activity: CaptureActivity): boolean {
  return activity.kind === 'recording'
}

/** Swift L129-139。 */
export interface CaptureFinishOutcome {
  readonly succeeded: boolean
  readonly failureReason: string
}

/**
 * Swift L133-138：
 *   succeeded = error == nil
 *       || (nsError?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool == true)
 *   failureReason = error.map(appErrorDescription) ?? appLocalized("未知错误")
 *
 * 「带着 error 但成功结束」是 AVFoundation 的常态（停止时被打断、最后一帧
 * 时间戳不整都会给个 error，文件其实是完整的）。这个键就是为了把它区分出来。
 *
 * 注意 `failureReason` 在成功时也会被算出来 —— 上游保留它是为了让日志里
 * 仍能看到那次「良性错误」的原因。
 */
export function captureFinishOutcome(input: {
  readonly hasError: boolean
  readonly successfullyFinishedFlag: boolean
  readonly errorDescription?: string | null
  readonly translate?: (key: string) => string
}): CaptureFinishOutcome {
  const translate = input.translate ?? ((key: string) => key)
  return {
    succeeded: !input.hasError || input.successfullyFinishedFlag,
    failureReason: input.hasError
      ? (input.errorDescription ?? '')
      : translate('未知错误'),
  }
}

/**
 * Swift L145-163。
 *
 *   guard presentationTime.isNumeric else { return nil }
 *   hostTime = masterClock 存在 ? CMSyncConvertTime(→ host) : presentationTime
 *   guard hostTime.isNumeric, hostTime.seconds.isFinite else { return nil }
 *   return hostTime.seconds
 *
 * 两条注释值得抄下来（L141-144）：**不能**直接比较两个会话的原始样本秒数 ——
 * 即使数值看起来接近，它们来自不同的主时钟，那不是合法的同步操作。
 *
 * 参数化：`convertedSeconds` 为 null 表示「没有主时钟，用原始值」。
 */
export function captureSampleHostTime(input: {
  readonly presentationSeconds: number
  readonly presentationIsNumeric: boolean
  /** 有主时钟时由宿主换算出的主机时钟秒数；无主时钟传 null。 */
  readonly convertedSeconds: number | null
  readonly convertedIsNumeric?: boolean
}): number | null {
  if (!input.presentationIsNumeric) return null
  const hostSeconds =
    input.convertedSeconds === null ? input.presentationSeconds : input.convertedSeconds
  if (input.convertedSeconds !== null && input.convertedIsNumeric === false) return null
  if (!Number.isFinite(hostSeconds)) return null
  return hostSeconds
}

/** Swift 的 `String(format:arguments:)` 子集：只处理 `%@`。 */
export function formatArguments(template: string, args: readonly string[]): string {
  let index = 0
  return template.replace(/%@/g, () => {
    const value = args[index]
    index += 1
    return value === undefined ? '%@' : value
  })
}
