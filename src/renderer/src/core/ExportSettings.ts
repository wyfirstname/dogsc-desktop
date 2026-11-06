/**
 * ExportSettings — 单个工程的持久化导出选择。
 *
 * Swift source: Sources/RecorderCore/ExportSettings.swift @ laogou717/dogsc 567fd6e
 *
 * 采集配置与画布风格刻意不持有这些值：更改导出预设绝不能改写
 * 素材的采集方式，也不能在视觉模型里引入第二个输出分辨率权威。
 */

import type { OutputFrameRate } from './CaptureConfiguration'
import type { CanvasResolution } from './ProjectModel'

export interface ExportSettings {
  frameRate: OutputFrameRate
  resolution: CanvasResolution
}

export function makeExportSettings(overrides: Partial<ExportSettings> = {}): ExportSettings {
  return {
    frameRate: 60,
    resolution: '原始素材',
    ...overrides,
  }
}

export function decodeExportSettings(raw: unknown): ExportSettings {
  const obj = (raw ?? {}) as Record<string, unknown>
  const rate = obj.frameRate
  return makeExportSettings({
    frameRate: (rate === 30 || rate === 60 || rate === 90 || rate === 120 ? rate : 60) as OutputFrameRate,
    resolution: (obj.resolution as CanvasResolution) ?? '原始素材',
  })
}
