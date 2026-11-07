/**
 * Swift source: Sources/RecorderCore/ExportPolicy.swift @ 567fd6e
 *
 * 逐结构对照：
 *   RequiredProjectMedia        L5-42
 *   ExportEncodingPolicy        L46-68
 */

import type { RecorderProject } from './ProjectMediaModel'
import { FULL_RECORDING_SEGMENT_ID } from './ProjectTimeline'
import { backgroundSourceIsImage, backgroundSourceIsVideo } from './ProjectModel'

/**
 * 决定一个工程渲染时到底需要哪些可选媒体文件 —— 依据是后期状态
 * （静音、隐藏、背景源），而不是录制期的开关。
 *
 * Swift L5-42。
 */
export interface RequiredProjectMedia {
  screenVideo: boolean
  systemAudio: boolean
  cameraVideo: boolean
  microphoneAudio: boolean
  backgroundImage: boolean
  backgroundVideo: boolean
}

/** Swift RequiredProjectMedia.init(project:)。 */
export function requiredProjectMedia(project: RecorderProject): RequiredProjectMedia {
  const sequence = project.timeline.sourceSequence
  const recordingSegmentIDs: string[] =
    sequence.kind === 'fullRecording'
      ? [FULL_RECORDING_SEGMENT_ID]
      : sequence.segments.map((segment) => segment.id)

  const overridesFor = (id: string): PrimaryOverrides =>
    project.timeline.primarySegmentAudioOverrides[id] ?? {}

  const systemAudio = recordingSegmentIDs.some((id) => {
    const overrides = overridesFor(id)
    const isMuted = overrides.isSystemMuted ?? project.audio.isSystemMuted
    const volume = overrides.systemVolume ?? project.audio.systemVolume
    return !isMuted && volume > 0
  })

  const cameraVideo =
    (project.media?.camera ?? null) !== null && !project.camera.isHidden

  const microphoneAudio =
    (project.media?.microphone ?? null) !== null &&
    recordingSegmentIDs.some((id) => {
      const overrides = overridesFor(id)
      const isMuted = overrides.isMicrophoneMuted ?? project.audio.isMicrophoneMuted
      const volume = overrides.microphoneVolume ?? project.audio.microphoneVolume
      return !isMuted && volume > 0
    })

  const backgroundImage = backgroundSourceIsImage(project.canvas.backgroundSource)
  const backgroundVideo = backgroundSourceIsVideo(project.canvas.backgroundSource)
  return {
    screenVideo: true,
    systemAudio,
    cameraVideo,
    microphoneAudio,
    backgroundImage,
    backgroundVideo,
  }
}

interface PrimaryOverrides {
  systemVolume?: number | null
  microphoneVolume?: number | null
  isSystemMuted?: boolean | null
  isMicrophoneMuted?: boolean | null
}

/**
 * 导出 UI 的码率预估与真正跑的编码任务必须共用同一套策略，
 * 否则界面承诺的码率和实际写出的文件会不一致。
 *
 * Swift ExportEncodingPolicy L46-68。
 */
export const EXPORT_AUDIO_BITRATE = 192_000

/**
 * 屏幕内容的像素复杂度极高，纯按像素数 × 帧率推码率会明显起块（banding）
 * 与糊字；但仍需一个上限，避免 4K 60fps 把码率推到不可解码的量级。
 *
 * Swift ExportEncodingPolicy.videoBitrate(width:height:frameRate:) L49-67。
 */
export function exportVideoBitrate(
  width: number,
  height: number,
  frameRate: number
): number {
  const pixels = Math.max(width * height, 1)
  let ceiling: number
  if (pixels >= 7_000_000) {
    // ≈ 4K（3840×2160 = 8.29M）
    ceiling = 130_000_000
  } else if (pixels >= 3_500_000) {
    // ≈ 1440p（2560×1440 = 3.69M）
    ceiling = 100_000_000
  } else {
    ceiling = 65_000_000
  }
  return Math.min(
    Math.max((pixels * Math.max(frameRate, 1)) / 6, 12_000_000),
    ceiling
  )
}
