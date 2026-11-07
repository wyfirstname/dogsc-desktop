/**
 * 采集流节律策略 —— Swift CaptureStreamCadence.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/CaptureStreamCadence.swift（40 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - enum CaptureStreamTimingPolicy    L12-21 → captureStreamMinimumFrameInterval
 *   - enum CaptureStreamSurfacePolicy   L28-30 → CAPTURE_STREAM_QUEUE_DEPTH
 *   - enum RecordingPerformanceActivityPolicy L34-40 → RECORDING_PERFORMANCE_ACTIVITY_OPTIONS
 *
 * 原注释（L5-11）：
 *   REC-001/REC-002/REC-004: product recording is authored for at most 60 FPS.
 *   Asking a 120 Hz compositor or independent window for unlimited updates adds
 *   frames the 60 FPS export cannot retain and divides the same real-time HEVC
 *   budget across up to twice as many screen images. Ask ScreenCaptureKit for at
 *   most 60 updates for every Mac screen source. This remains VFR: no frames are
 *   synthesized or callback-filtered, and every frame ScreenCaptureKit chooses
 *   to deliver keeps its original PTS.
 */

import type { CaptureSource } from './CaptureConfiguration'

/** 产品录制的上限帧率。 */
export const CAPTURE_STREAM_MAXIMUM_FPS = 60

/** Swift `CMTime` 的等价物（value / timescale 秒）。 */
export interface CMTimeValue {
  readonly value: number
  readonly timescale: number
}

/**
 * Swift L13-20：屏幕类源（display / window / area）最少间隔 1/60 秒；
 * **设备源（摄像头）返回 .zero** —— 摄像头自有帧率协商，不能在这里限流。
 */
export function captureStreamMinimumFrameInterval(source: CaptureSource): CMTimeValue {
  switch (source) {
    case 'display':
    case 'window':
    case 'area':
      return { value: 1, timescale: CAPTURE_STREAM_MAXIMUM_FPS }
    case 'device':
      return { value: 0, timescale: 1 }
  }
}

/** `CMTime.seconds`。 */
export function cmTimeSeconds(time: CMTimeValue): number {
  if (time.timescale === 0) return 0
  return time.value / time.timescale
}

/** 以秒为单位的等价形式（0 表示「不限流」）。 */
export function captureStreamMinimumFrameIntervalSeconds(source: CaptureSource): number {
  return cmTimeSeconds(captureStreamMinimumFrameInterval(source))
}

/**
 * Swift L28-30：
 *   REC-001/REC-004: keep the maximum ScreenCaptureKit surface pool that Apple
 *   exposes for desktop capture. Three additional 4K NV12 surfaces cost roughly
 *   42 MiB, but let WindowServer continue presenting while the hardware encoder
 *   briefly owns older surfaces.
 */
export const CAPTURE_STREAM_QUEUE_DEPTH = 8

/** 额外三张 4K NV12 表面的近似内存开销（MiB）。 */
export const CAPTURE_STREAM_EXTRA_SURFACE_COST_MIB = 42

/**
 * Swift L34-40：
 *   Recording is a foreground, deadline-sensitive user operation. The activity
 *   scope ends with the capture run and never remains active in the editor.
 */
export const RECORDING_PERFORMANCE_ACTIVITY_OPTIONS = [
  'userInitiated',
  'latencyCritical',
  'idleSystemSleepDisabled'
] as const

export type RecordingPerformanceActivityOption =
  (typeof RECORDING_PERFORMANCE_ACTIVITY_OPTIONS)[number]

/** 录制期间是否允许空闲系统睡眠（`idleSystemSleepDisabled` 生效）。 */
export function recordingActivityDisablesIdleSleep(): boolean {
  return RECORDING_PERFORMANCE_ACTIVITY_OPTIONS.includes('idleSystemSleepDisabled')
}
