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

// ---- 批次 3（OverlayTimeline：马赛克 + 贴图）----
export {
  makeOverlayRect,
  clampedOverlayRect,
  makeOverlayTiming,
  overlayEndTime,
  overlayContains,
  decodeMosaicEffectStyle,
  makeMosaicClip,
  decodeMosaicClip,
  encodeMosaicClip,
  stickerAutomaticExit,
  makeStickerClip,
  decodeStickerClip,
  encodeStickerClip,
} from '../src/renderer/src/core/OverlayTimeline'

// ---- 批次 4（CameraMotion）----
export {
  CameraMotionTrack,
  makeCameraMotionState,
  makeCameraMotionClip,
  decodeCameraLayoutMode,
  encodeCameraLayoutMode,
  cameraMotionClipsNeedRepair,
  type CameraMotionClip,
} from '../src/renderer/src/core/CameraMotion'

// ---- 批次 5（PointerTrack / ProjectPointerTrack / TimelineMap 指针映射）----
export {
  PointerTrack,
  PointerInterpolator,
  makeClickPhase,
  makePointerSample,
  makeEvaluation,
  smootherStep,
  isContinuousMovement,
  monotoneTangent,
  type PointerClickPhase,
  type PointerSample,
  type PointerTrackEvaluation,
} from '../src/renderer/src/core/PointerTrack'
export {
  ProjectPointerTrack,
  ProjectPointerTrackSegment,
  interpolatedRawPosition,
} from '../src/renderer/src/core/ProjectPointerTrack'
export { TimelineMap, firstEventIndexAtOrAfter } from '../src/renderer/src/core/TimelineMap'
export { makeRecordingSegment } from '../src/renderer/src/core/ProjectTimeline'

// ---- 批次 6（CompositionScene）----
export {
  canonicalStyleScale,
  decorationInsetsAtScaleOne,
  compositionSceneEvaluate,
  evaluateCameraStatic,
  evaluateCamera,
  projectedQuad,
  SCREEN_DECORATION_ZERO,
} from '../src/renderer/src/core/CompositionScene'

// ---- 批次 7（FrameScene 及依赖层：CameraContentFill / CursorRenderGeometry /
//      FocusEffect / StickerTransition / TimelineMediaPlan / FrameScene）----
export {
  cameraContentFillLayout,
  cameraContentFillDestinationPoint,
  cameraContentFillMirrorAxisX,
  CAMERA_CONTENT_FILL_EDGE_OVERSCAN_SCALE,
} from '../src/renderer/src/core/CameraContentFill'
export {
  cursorRenderLayout,
  cursorClickGeometry,
  makeCursorAssetMetrics,
  CURSOR_CANONICAL_HEIGHT,
  CURSOR_CANONICAL_SHORT_EDGE,
} from '../src/renderer/src/core/CursorRenderGeometry'
export {
  makeFocusEffect,
  focusEffectScene,
  focusEffectProgress,
  focusEffectIsValid,
  focusEffectClearHalfWidth,
  focusEffectFeatherWidth,
  normalizedAngle,
  decodeFocusEffect,
} from '../src/renderer/src/core/FocusEffect'
export {
  StickerTransitionTrack,
  FrameStickerBackdropScene,
} from '../src/renderer/src/core/StickerTransition'
export {
  TimelineMediaPlan,
  ProjectTimelineMediaPlan,
  inferredSourceTimeScale,
  sliceSourceTime,
  isSameBoundary,
} from '../src/renderer/src/core/TimelineMediaPlan'
export { HexColor } from '../src/renderer/src/core/HexColor'
export { makeTrack as makeZoomTrack, activeClipAt } from '../src/renderer/src/core/ZoomAnimation'
export {
  FrameSceneEvaluator,
  openingSample,
  openingRect,
  stickerAnimationTransform,
  overlayEffectProgress,
  screenDecoration,
  screenChromeKindFor,
  makeFrameMosaicScene,
  makeFrameBackgroundScene,
  makeFrameShadow,
  frameScreenProjectionRect,
  frameCursorScene,
  stickerScenes,
  FRAME_COLOR_SDR_DESKTOP,
  FRAME_SCREEN_DECORATION_NONE,
  compositionSizeShortEdge,
} from '../src/renderer/src/core/FrameScene'

// ---- 批次 8（RecorderCore 收官：ExportPolicy / 三个诊断 / ScreenMotionCreationStyle
//      / ProjectValidator / AutoZoomPlanner / EditorTimeline）----
export {
  requiredProjectMedia,
  exportVideoBitrate,
  EXPORT_AUDIO_BITRATE,
} from '../src/renderer/src/core/ExportPolicy'
export {
  makeRecordingPerformanceSample,
  summaryFromSample,
  summaryIncludingSample,
  makeRecordingPerformanceSummary,
  EMPTY_PERFORMANCE_SUMMARY,
} from '../src/renderer/src/core/RecordingPerformanceDiagnostics'
export {
  makeAudioCaptureDiagnostics,
  totalDroppedSampleBuffers,
  appendedSampleBuffersPerSecond,
} from '../src/renderer/src/core/AudioCaptureDiagnostics'
export {
  makeCameraCaptureDiagnostics,
  decodeCameraCaptureDiagnostics,
  encodeCameraCaptureDiagnostics,
  systemDroppedFrames,
  applicationDroppedFrames,
  receivedFramesPerSecond,
  appendedFramesPerSecond,
} from '../src/renderer/src/core/CameraCaptureDiagnostics'
export {
  screenMotionCreationStyleFromClip,
  makeScreenMotionCreationStyle,
  screenMotionCreationStyleIsValid,
  screenMotionClipFromStyle,
} from '../src/renderer/src/core/ScreenMotionCreationStyle'
export {
  ProjectValidationError,
  validateRecorderProject,
  validateCanvasStyle,
  validateCameraStyle,
  validateAudioStyle,
  validateCursorStyle,
  validateMotionStyle,
  validateZoomAnimationClip,
  validateProjectTimeline,
} from '../src/renderer/src/core/ProjectValidator'
export {
  makeAutoZoomAnimations,
  makeAutoZoomAnimationsFromClicks,
  repairingLegacyAutomaticAnimations,
  makePerClickLegacyAnimations,
  extendingAutomaticHoldsThroughPointerActivity,
  mergingConnectedAutomaticEnvelopes,
  orderedValidClicks,
  pointerClicks,
  spatialFocusGroups,
  spatialFocusGroupFocus,
  clippedZoomAnimations,
  clippedZoomKeyframes,
  makeAutoZoomKeyframes,
  makeAutoZoomKeyframesFromClicks,
} from '../src/renderer/src/core/AutoZoomPlanner'
export {
  EditorTimelineMath,
  fitZoomAnimation,
  manualZoomAnimation,
  manualZoomRangeKeyframes,
  clampedTime,
  xPosition,
  zoomSegmentsFromAnimations,
  splitZoomAnimation,
  zoomSequenceIsValid,
  effectiveExitDuration,
  exitNormalizations,
  movingZoomAnimation,
  resizingZoomAnimation,
  zoomHitZone,
  motionHitZone,
  motionHitZoneOf,
  fitMotionTiming,
  fitMotionTimingOf,
  motionReturnNormalizations,
  motionReturnNormalizationsOf,
  zoomSegmentsFromKeyframes,
} from '../src/renderer/src/core/EditorTimeline'
export { makeKeyframe, makePointerClick } from '../src/renderer/src/core/ZoomAnimation'
export { makeTimelineZoomSegment, EMPTY_HIT_ZONE } from '../src/renderer/src/core/EditorTimeline'
