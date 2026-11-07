/**
 * ProjectMediaModel — 工程媒体清单与录制工程根模型。
 *
 * Swift source: Sources/RecorderCore/ProjectMediaModel.swift @ laogou717/dogsc 567fd6e
 *   逐项对照（按源文件行号）：
 *   - struct MediaSyncAnchor        (L3)
 *   - struct ProjectMediaReference  (L20)
 *   - struct ProjectMediaManifest   (L133)
 *   - struct RecorderProject        (L152，含 init(from:) 的 v1-v6 兼容路径与 encode)
 *
 * 平台差异说明：
 *   · Swift Date（createdAt）→ TS 保持 JSON 原样字符串（ISO/原格式透传），
 *     仅在缺省时写入当前 ISO 时间；比较/展示由调用方解析。
 *   · ProjectTimeline 自身的精细解码兜底待其 Swift init(from:) 转写后接入，
 *     这里先用 makeProjectTimeline 做结构化消毒（zoomClips 逐个过 makeClip）。
 */

import {
  makeClip,
  migratingKeyframes,
  type ZoomAnimationClip,
  type ZoomKeyframe,
  type ZoomEasingPreset,
} from './ZoomAnimation'
import {
  ProjectSchema,
  PROJECT_SCHEMA_CURRENT_VERSION,
  decodeCanvasStyle,
  decodeOpeningSequence,
  decodeCursorStyle,
  makeAudioStyle,
  makeCameraStyle,
  type CanvasStyle,
  type CameraStyle,
  type AudioStyle,
  type OpeningSequence,
  type CursorStyle,
  type MotionStyle,
} from './ProjectModel'
import type { TransitionTiming, ScreenMotionClip, ProjectTimeline } from './ProjectTimeline'
import { makeProjectTimeline, makeTransitionTiming, randomUUID } from './ProjectTimeline'
import { decodeCaptureConfiguration, type CaptureConfiguration } from './CaptureConfiguration'
import { makeMotionStyle } from './MotionStyle'
import { makeExportSettings, decodeExportSettings, type ExportSettings } from './ExportSettings'
import { makeRecordingMarker, type RecordingMarker } from './RecordingMarker'
import { makeCameraMotionClip, type CameraMotionClip } from './CameraMotion'
import { decodeMosaicClip, decodeStickerClip } from './OverlayTimeline'

export type TimeInterval = number

// ---------------------------------------------------------------- MediaSyncAnchor

export interface MediaSyncAnchor {
  id: string
  sourceTime: TimeInterval
  offset: TimeInterval
}

export function makeMediaSyncAnchor(opts: {
  id?: string
  sourceTime: TimeInterval
  offset: TimeInterval
}): MediaSyncAnchor {
  return {
    id: opts.id ?? randomUUID(),
    sourceTime: Number.isFinite(opts.sourceTime) ? Math.max(opts.sourceTime, 0) : 0,
    offset: Number.isFinite(opts.offset) ? Math.min(Math.max(opts.offset, -10), 10) : 0,
  }
}

// ---------------------------------------------------------------- ProjectMediaReference

/** 放在主录屏时间线上的包内相对工程资产引用。 */
export interface ProjectMediaReference {
  relativePath: string
  /** 摆放偏移；辅助采集故意先于屏幕写入器启动，时间线对齐需要非负偏移与非负源裁剪。 */
  startOffset: TimeInterval
  /**
   * 源文件内开头跳过的时间。独立采集设备即使首帧对齐也会漂移；保留该速率
   * 让首尾同时对齐，而不是在长录制中累积口型误差。null 让老工程从
   * 定稿媒体推断速率。
   */
  sourceStartTime: TimeInterval
  /** 主录制时钟上 1 秒消耗的源时钟秒数。 */
  sourceTimeScale: number | null
  /** 共享停止宿主时间捕获的可选源时钟终点；此边界后的 post-roll 不属于工程时间线。 */
  sourceEndTime: number | null
  /** 分段相机时钟校正；时间存储在原始屏幕源时钟上，波纹剪辑不会移动或使其失效。 */
  syncAnchors: MediaSyncAnchor[]
}

export function makeProjectMediaReference(opts: {
  relativePath: string
  startOffset?: TimeInterval
  sourceStartTime?: TimeInterval
  sourceTimeScale?: number | null
  sourceEndTime?: number | null
  syncAnchors?: MediaSyncAnchor[]
}): ProjectMediaReference {
  const startOffset = Number.isFinite(opts.startOffset ?? 0) ? Math.max(opts.startOffset ?? 0, 0) : 0
  const sourceStartTime = Number.isFinite(opts.sourceStartTime ?? 0)
    ? Math.max(opts.sourceStartTime ?? 0, 0)
    : 0
  const scale =
    opts.sourceTimeScale !== null &&
    opts.sourceTimeScale !== undefined &&
    Number.isFinite(opts.sourceTimeScale) &&
    (opts.sourceTimeScale as number) > 0
      ? (opts.sourceTimeScale as number)
      : null
  const sourceEndTime =
    opts.sourceEndTime !== null &&
    opts.sourceEndTime !== undefined &&
    Number.isFinite(opts.sourceEndTime) &&
    (opts.sourceEndTime as number) >= 0
      ? (opts.sourceEndTime as number)
      : null
  return {
    relativePath: opts.relativePath,
    startOffset,
    sourceStartTime,
    sourceTimeScale: scale,
    sourceEndTime,
    syncAnchors: normalizedSyncAnchors(opts.syncAnchors ?? []),
  }
}

export function decodeProjectMediaReference(raw: unknown): ProjectMediaReference {
  const obj = (raw ?? {}) as Record<string, unknown>
  return makeProjectMediaReference({
    relativePath: String(obj.relativePath ?? ''),
    startOffset: typeof obj.startOffset === 'number' ? obj.startOffset : 0,
    sourceStartTime: typeof obj.sourceStartTime === 'number' ? obj.sourceStartTime : 0,
    sourceTimeScale: typeof obj.sourceTimeScale === 'number' ? obj.sourceTimeScale : null,
    sourceEndTime: typeof obj.sourceEndTime === 'number' ? obj.sourceEndTime : null,
    syncAnchors: Array.isArray(obj.syncAnchors)
      ? obj.syncAnchors.map((a) =>
          makeMediaSyncAnchor(a as { id?: string; sourceTime: number; offset: number })
        )
      : [],
  })
}

function normalizedSyncAnchors(anchors: MediaSyncAnchor[]): MediaSyncAnchor[] {
  return anchors
    .map((a) => makeMediaSyncAnchor({ id: a.id, sourceTime: a.sourceTime, offset: a.offset }))
    .sort((lhs, rhs) =>
      lhs.sourceTime !== rhs.sourceTime
        ? lhs.sourceTime - rhs.sourceTime
        : lhs.id < rhs.id
          ? -1
          : lhs.id > rhs.id
            ? 1
            : 0
    )
}

// ---------------------------------------------------------------- ProjectMediaManifest

/** 已录制工程的完整媒体清单；screen 在 manifest 存在后结构上必有。 */
export interface ProjectMediaManifest {
  screen: ProjectMediaReference
  camera: ProjectMediaReference | null
  microphone: ProjectMediaReference | null
  pointerEvents: ProjectMediaReference | null
}

export function makeProjectMediaManifest(init: {
  screen: ProjectMediaReference
  camera?: ProjectMediaReference | null
  microphone?: ProjectMediaReference | null
  pointerEvents?: ProjectMediaReference | null
}): ProjectMediaManifest {
  return {
    screen: init.screen,
    camera: init.camera ?? null,
    microphone: init.microphone ?? null,
    pointerEvents: init.pointerEvents ?? null,
  }
}

export function decodeProjectMediaManifest(raw: unknown): ProjectMediaManifest {
  const obj = (raw ?? {}) as Record<string, unknown>
  return makeProjectMediaManifest({
    screen: decodeProjectMediaReference(obj.screen),
    camera: obj.camera !== undefined && obj.camera !== null ? decodeProjectMediaReference(obj.camera) : null,
    microphone:
      obj.microphone !== undefined && obj.microphone !== null
        ? decodeProjectMediaReference(obj.microphone)
        : null,
    pointerEvents:
      obj.pointerEvents !== undefined && obj.pointerEvents !== null
        ? decodeProjectMediaReference(obj.pointerEvents)
        : null,
  })
}

// ---------------------------------------------------------------- RecorderProject

/** 已录制工程的持久化根。 */
export interface RecorderProject {
  version: number
  title: string
  createdAt: string
  capture: CaptureConfiguration
  canvas: CanvasStyle
  camera: CameraStyle
  audio: AudioStyle
  motion: MotionStyle
  openingSequence: OpeningSequence
  cursorStyle: CursorStyle
  exportSettings: ExportSettings
  timeline: ProjectTimeline
  media: ProjectMediaManifest | null
  recordingMarkers: RecordingMarker[]
}

/** 兼容桥：app 调用点迁移到 timeline.zoomClips 期间保留；不是第二个持久化字段。 */
export const recorderZoomAnimations = {
  get(project: RecorderProject): ZoomAnimationClip[] {
    return project.timeline.zoomClips
  },
  set(project: RecorderProject, clips: ZoomAnimationClip[]): void {
    project.timeline.zoomClips = clips
  },
}

export function makeRecorderProject(overrides: Partial<RecorderProject> = {}): RecorderProject {
  return {
    version: PROJECT_SCHEMA_CURRENT_VERSION,
    title: '未命名录制',
    createdAt: new Date().toISOString(),
    capture: overrides.capture ?? ({} as CaptureConfiguration),
    canvas: overrides.canvas ?? ({} as CanvasStyle),
    camera: overrides.camera ?? ({} as CameraStyle),
    audio: overrides.audio ?? ({} as AudioStyle),
    motion: overrides.motion ?? ({} as MotionStyle),
    openingSequence: overrides.openingSequence ?? ({} as OpeningSequence),
    cursorStyle: overrides.cursorStyle ?? ({} as CursorStyle),
    exportSettings: overrides.exportSettings ?? ({} as ExportSettings),
    timeline: overrides.timeline ?? makeProjectTimeline(),
    media: overrides.media ?? null,
    recordingMarkers: overrides.recordingMarkers ?? [],
    ...overrides,
  }
}

/** 媒体清单消毒：只保留 screenPath 非空时的有效清单（v<3 兼容路径共用）。 */
function mediaFromLegacyPaths(container: Record<string, unknown>): ProjectMediaManifest | null {
  const screenPath = typeof container.screenRecordingRelativePath === 'string'
    ? container.screenRecordingRelativePath
    : null
  if (screenPath === null || screenPath === '') return null
  const ref = (key: string, offsetKey: string): ProjectMediaReference | null => {
    const p = container[key]
    const offset = typeof container[offsetKey] === 'number' ? (container[offsetKey] as number) : 0
    return typeof p === 'string' && p !== ''
      ? makeProjectMediaReference({ relativePath: p, startOffset: offset })
      : null
  }
  return makeProjectMediaManifest({
    screen: makeProjectMediaReference({ relativePath: screenPath }),
    camera: ref('cameraRecordingRelativePath', 'cameraStartOffset'),
    microphone: ref('microphoneRecordingRelativePath', 'microphoneStartOffset'),
    pointerEvents: ref('pointerEventsRelativePath', 'pointerStartOffset'),
  })
}

/**
 * 解码（L235-378）：v1-v6 兼容路径逐项对齐 Swift init(from:)。
 * 不认识的工程版本直接抛 ProjectSchemaError。
 */
export function decodeRecorderProject(raw: unknown): RecorderProject {
  const container = (raw ?? {}) as Record<string, unknown>
  const decodedVersion = typeof container.version === 'number' ? container.version : 1
  ProjectSchema.validateForDecoding(decodedVersion)
  const legacyCaptureExport = (container.capture ?? null) as Record<string, unknown> | null
  const legacyCanvasExport = (container.canvas ?? null) as Record<string, unknown> | null

  // recordingMarkers：过滤非法值并按 id 去重（与 Swift markerIDs 语义一致）。
  const markerIDs = new Set<string>()
  const recordingMarkers: RecordingMarker[] = Array.isArray(container.recordingMarkers)
    ? (container.recordingMarkers as RecordingMarker[])
        .filter((mk) => {
          if (
            mk === null ||
            typeof mk !== 'object' ||
            !Number.isFinite((mk as RecordingMarker).sourceTime) ||
            (mk as RecordingMarker).sourceTime < 0 ||
            !((mk as RecordingMarker).number > 0)
          ) {
            return false
          }
          return markerIDs.add((mk as RecordingMarker).id)
        })
        .map((mk) =>
          makeRecordingMarker({
            id: mk.id,
            sourceTime: mk.sourceTime,
            number: mk.number,
          })
        )
    : []

  const motion = container.motion !== undefined && container.motion !== null
    ? makeMotionStyle(container.motion as Partial<MotionStyle>)
    : makeMotionStyle()

  let exportSettings: ExportSettings
  if (decodedVersion >= 5) {
    exportSettings = decodeExportSettings(container.exportSettings)
    // v7 之前 1080p 是工程隐含默认值；产品切回 source 全画质后，
    // 不得继续把原生 4K/5K 录制静默降采样。
    if (decodedVersion < 7 && exportSettings.resolution === '1080p') {
      exportSettings = makeExportSettings({
        frameRate: exportSettings.frameRate,
        resolution: '原始素材',
      })
    }
  } else {
    const legacyResolution =
      legacyCanvasExport !== null && typeof legacyCanvasExport.resolution === 'string'
        ? (legacyCanvasExport.resolution as ExportSettings['resolution'])
        : '1080p'
    const legacyFrameRate = legacyCaptureExport?.exportFrameRate
    exportSettings = makeExportSettings({
      frameRate: (legacyFrameRate === 30 || legacyFrameRate === 60 || legacyFrameRate === 90 || legacyFrameRate === 120
        ? legacyFrameRate
        : 60) as ExportSettings['frameRate'],
      resolution: legacyResolution === '1080p' ? '原始素材' : legacyResolution,
    })
  }

  let timeline: ProjectTimeline
  if (decodedVersion >= 4) {
    const rawTimeline = (container.timeline ?? {}) as Record<string, unknown>
    timeline = makeProjectTimeline({
      sourceSequence: rawTimeline.sourceSequence as ProjectTimeline['sourceSequence'],
      primarySegmentAudioOverrides:
        (rawTimeline.primarySegmentAudioOverrides as ProjectTimeline['primarySegmentAudioOverrides']) ?? {},
      zoomClips: Array.isArray(rawTimeline.zoomClips)
        ? (rawTimeline.zoomClips as ZoomAnimationClip[]).map((c) =>
            makeClip(c as unknown as Parameters<typeof makeClip>[0])
          )
        : [],
      screenMotionClips: Array.isArray(rawTimeline.screenMotionClips)
        ? (rawTimeline.screenMotionClips as ScreenMotionClip[]).map((c) =>
            sanitizeScreenMotionClip(c)
          )
        : [],
      cameraMotionClips: Array.isArray(rawTimeline.cameraMotionClips)
        ? (rawTimeline.cameraMotionClips as CameraMotionClip[]).map((c) =>
            makeCameraMotionClip(c as unknown as Parameters<typeof makeCameraMotionClip>[0])
          )
        : [],
      mosaicClips: Array.isArray(rawTimeline.mosaicClips)
        ? rawTimeline.mosaicClips.map((c) => decodeMosaicClip(c))
        : [],
      stickerClips: Array.isArray(rawTimeline.stickerClips)
        ? rawTimeline.stickerClips.map((c) => decodeStickerClip(c))
        : [],
    })
  } else {
    const decodedAnimations = Array.isArray(container.zoomAnimations)
      ? (container.zoomAnimations as ZoomAnimationClip[]).map((c) =>
          makeClip(c as unknown as Parameters<typeof makeClip>[0])
        )
      : null
    let migratedAnimations: ZoomAnimationClip[]
    if (decodedVersion === 1 && !('zoomAnimations' in container)) {
      const legacyKeyframes = (container.zoomKeyframes ?? []) as ZoomKeyframe[]
      migratedAnimations = migratingKeyframes(
        legacyKeyframes,
        motion.defaultZoomEasing as ZoomEasingPreset
      )
    } else {
      // 显式空动画数组是权威的，即使 v1 文件同时带着过期的旧版 keyframes。
      migratedAnimations = decodedAnimations ?? []
    }
    timeline = makeProjectTimeline({ zoomClips: migratedAnimations })
  }

  let media: ProjectMediaManifest | null
  if (decodedVersion >= 3) {
    media =
      container.media !== undefined && container.media !== null
        ? decodeProjectMediaManifest(container.media)
        : null
  } else {
    media = mediaFromLegacyPaths(container)
  }

  return {
    version: PROJECT_SCHEMA_CURRENT_VERSION,
    title: typeof container.title === 'string' ? container.title : '未命名录制',
    createdAt: typeof container.createdAt === 'string' ? container.createdAt : new Date().toISOString(),
    capture: decodeCaptureConfiguration(container.capture),
    canvas:
      container.canvas !== undefined
        ? decodeCanvasStyle(container.canvas)
        : decodeCanvasStyle({}),
    camera: container.camera !== undefined && container.camera !== null
      ? makeCameraStyle(container.camera as Partial<CameraStyle>)
      : makeCameraStyle(),
    audio: makeAudioStyle((container.audio ?? {}) as Partial<AudioStyle>),
    motion,
    openingSequence: container.openingSequence !== undefined && container.openingSequence !== null
      ? decodeOpeningSequence(container.openingSequence)
      : decodeOpeningSequence(undefined),
    cursorStyle: container.cursorStyle !== undefined && container.cursorStyle !== null
      ? decodeCursorStyle(container.cursorStyle)
      : decodeCursorStyle(undefined),
    exportSettings,
    timeline,
    media,
    recordingMarkers,
  }
}

/** screenMotionClip 消毒：timing 走 makeTransitionTiming 补缺省字段。 */
function sanitizeScreenMotionClip(raw: ScreenMotionClip): ScreenMotionClip {
  const timing = makeTransitionTiming({
    startTime: raw.timing.startTime,
    duration: raw.timing.duration,
    leadInDuration: raw.timing.leadInDuration,
    leadInProgressOffset: raw.timing.leadInProgressOffset,
    easing: raw.timing.easing as TransitionTiming['easing'],
    customCurve: raw.timing.customCurve,
    returnDuration: raw.timing.returnDuration,
    returnProgressOffset: raw.timing.returnProgressOffset,
    preferredLeadInDuration: raw.timing.preferredLeadInDuration ?? null,
    preferredReturnDuration: raw.timing.preferredReturnDuration ?? null,
  })
  return { ...raw, timing }
}

/** 编码（L380-397）：写入当前 schema 版本。 */
export function encodeRecorderProject(project: RecorderProject): Record<string, unknown> {
  ProjectSchema.validateForEncoding(project.version)
  return {
    version: PROJECT_SCHEMA_CURRENT_VERSION,
    title: project.title,
    createdAt: project.createdAt,
    capture: project.capture,
    canvas: project.canvas,
    camera: project.camera,
    audio: project.audio,
    motion: project.motion,
    openingSequence: project.openingSequence,
    cursorStyle: project.cursorStyle,
    exportSettings: project.exportSettings,
    timeline: project.timeline,
    ...(project.media !== null ? { media: project.media } : {}),
    recordingMarkers: project.recordingMarkers,
  }
}
