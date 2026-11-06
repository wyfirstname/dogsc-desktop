/**
 * verify-model 的入口：从 ProjectModel 批次导出被测符号。
 */
export {
  ProjectSchema,
  PROJECT_SCHEMA_CURRENT_VERSION,
  makeCanvasStyle,
  decodeCanvasStyle,
  encodeCanvasStyle,
  decodeScreenFrameStyle,
  canvasPixelDimensions,
  clampedCrop,
  cropFromEdges,
  cropRight,
  makeOpeningSequence,
  maximumOpeningStagger,
  participatingOpeningElements,
  decodeDynamicBackgroundPreset,
  dynamicBackgroundDisplayName,
  decodeBackgroundSource,
  backgroundSourceUsesWallpaperMedia,
  BACKGROUND_SOURCE_SAFE_FALLBACK,
  makeCursorStyle,
  decodeCursorStyle,
  encodeCursorStyle,
  cursorAppearance,
  cursorClickEffectDuration,
  cursorShowsClickEffect,
  setCursorShowsClickEffect,
  decodeCameraShape,
  makeAudioStyle,
  decodeAudioStyle,
  makeCameraStyle,
  decodeCameraStyle,
} from '../src/renderer/src/core/ProjectModel'
export {
  applyScreenFrameStyle,
  screenFrameDefaults,
} from '../src/renderer/src/core/ScreenFrameDefaults'
export {
  customAspectRatioValue,
  resolvedFixedAspectRatio,
} from '../src/renderer/src/core/CanvasCustomAspectRatio'
export { makeExportSettings, decodeExportSettings } from '../src/renderer/src/core/ExportSettings'

// ---- 批次 2（ScreenMotion / ProjectMediaModel / MediaTimeline）----
export {
  ScreenMotionTrack,
  makeAnchorViewport,
  mixAngle,
  type ScreenAnchorViewport,
  type ScreenMotionSample,
} from '../src/renderer/src/core/ScreenMotion'
export {
  makeMediaSyncAnchor,
  makeProjectMediaReference,
  decodeProjectMediaReference,
  makeProjectMediaManifest,
  decodeProjectMediaManifest,
  decodeRecorderProject,
  encodeRecorderProject,
  makeRecorderProject,
} from '../src/renderer/src/core/ProjectMediaModel'
export {
  MediaTimelinePlacement,
  MediaSyncAnchorCurve,
  anchor,
} from '../src/renderer/src/core/MediaTimeline'
export { makeTransitionTiming, makeProjectTimeline } from '../src/renderer/src/core/ProjectTimeline'
export { makeClip } from '../src/renderer/src/core/ZoomAnimation'
export { makeMotionStyle } from '../src/renderer/src/core/MotionStyle'
