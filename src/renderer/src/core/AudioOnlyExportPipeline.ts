/**
 * 纯音频导出 —— Swift AudioOnlyExportPipeline.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/AudioOnlyExportPipeline.swift（89 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - 两条音轨都为空 → noAudioToExport                       L19-23
 *   - 预设 AppleM4A / 建 session 失败 → cannotCreateSession    L24-29
 *   - audioMix：静音即 0，否则音量夹 [0,1]                     L30-43
 *   - 时间范围缺省 = [0, 成片时长]                             L44-47
 *   - 进度轮询 120ms，夹到 0.99，结束时补 1                     L64-71 / L87
 *   - 取消：cancelExport + 抛 cancelled                        L74-85
 *
 * 原注释：导出的是**编辑器里听到的那一份**音频（同样的剪切、重定时、分段混音），
 * 但不启动视频渲染器，也不编码占位帧。
 */

/** 进度轮询间隔（毫秒）。 */
export const AUDIO_EXPORT_PROGRESS_POLL_MILLISECONDS = 120

/** 进度上限：导出完成前不报 100%，避免进度条先满再卡住。 */
export const AUDIO_EXPORT_PROGRESS_CEILING = 0.99

export type AudioExportErrorKind = 'noAudioToExport' | 'cannotCreateSession' | 'cancelled' | 'exportFailed'

export const AUDIO_EXPORT_ERROR_MESSAGE: Readonly<Record<AudioExportErrorKind, string>> = {
  noAudioToExport: '项目里没有可导出的音频轨。',
  cannotCreateSession: '无法创建音频导出会话。',
  cancelled: '导出已取消。',
  exportFailed: '音频导出失败。',
}

export class AudioExportError extends Error {
  readonly kind: AudioExportErrorKind

  constructor(kind: AudioExportErrorKind, detail?: string) {
    super(detail != null && detail !== '' ? `${AUDIO_EXPORT_ERROR_MESSAGE[kind]}（${detail}）` : AUDIO_EXPORT_ERROR_MESSAGE[kind])
    this.name = 'AudioExportError'
    this.kind = kind
  }
}

/**
 * Swift L19-23：系统音轨与麦克风音轨**都为 nil** 才是「没有可导出的音频」。
 * 只有一条轨时依旧导出（哪怕是纯麦克风）。
 */
export function audioExportHasTracks(input: {
  readonly hasSystemAudioTrack: boolean
  readonly hasMicrophoneAudioTrack: boolean
}): boolean {
  return input.hasSystemAudioTrack || input.hasMicrophoneAudioTrack
}

/**
 * Swift L32-40：静音 → 0；否则音量夹到 [0,1]。
 * 夹取必须做 —— 工程文件里出现 1.4 会让 AVAudioMix 报错而不是变响。
 */
export function audioExportVolume(volume: number, isMuted: boolean): number {
  if (isMuted) return 0
  if (!Number.isFinite(volume)) return 0
  return Math.min(Math.max(volume, 0), 1)
}

/** Swift L44-47：缺省范围 = 全片；显式范围原样使用。 */
export function audioExportTimeRange(
  outputRange: { readonly start: number; readonly duration: number } | null,
  outputDuration: number
): { readonly start: number; readonly duration: number } {
  if (outputRange != null) return outputRange
  return { start: 0, duration: Math.max(outputDuration, 0) }
}

/** Swift L66-68：轮询到的进度夹到 [0, 0.99]。 */
export function audioExportReportedProgress(rawProgress: number): number {
  if (!Number.isFinite(rawProgress)) return 0
  return Math.min(Math.max(rawProgress, 0), AUDIO_EXPORT_PROGRESS_CEILING)
}

/** Swift L80-85：取消优先于一般失败（否则用户看到的是无意义的系统错误）。 */
export function audioExportFailureKind(isTaskCancelled: boolean): AudioExportErrorKind {
  return isTaskCancelled ? 'cancelled' : 'exportFailed'
}

/** 导出容器格式（`export(to:as: .m4a)`）。 */
export const AUDIO_EXPORT_FILE_TYPE = 'm4a'

/** 音频预设名（`AVAssetExportPresetAppleM4A`）。 */
export const AUDIO_EXPORT_PRESET = 'AVAssetExportPresetAppleM4A'

/** 重定时处理要求频谱算法（`.spectral`），否则变速会带出金属音。 */
export const AUDIO_EXPORT_TIME_PITCH_ALGORITHM = 'spectral'
