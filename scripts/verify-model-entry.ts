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

// ---- 批次 9（时间线几何 / 磁吸 / 手授顺序 / 交互纯决策）----
export {
  CLIP_CONTENT_INSET,
  CLIP_WAVEFORM_BAND_FRACTION,
  clipInteractionRange,
  clipWaveformBand,
  rulerMajorStep,
  nextFinerRulerStep,
  rulerScaleLayers,
  rulerVisibleTicks,
  rulerLabel,
  timelineGeometry,
  timelineViewportHeight,
  timelineDocumentHeight,
  timelineFrameDuration,
  snappedToProjectFrame,
  snappedTimelineTime,
  snappedEditableTime,
  steppedTimelineTime,
} from '../src/renderer/src/core/EditorTimelineGeometry'
export {
  EditorTimelineMagneticSnap,
  magneticTargets,
  magneticDelta,
} from '../src/renderer/src/core/EditorTimelineMagneticSnap'
export {
  normalizeZoomClipOrder,
  normalizeScreenMotionClipOrder,
  normalizeCameraMotionClipOrder,
} from '../src/renderer/src/core/EditorTimelineAuthoredOrder'
export {
  PrimarySegmentReorderDraft,
  makePrimarySegmentTrimDraft,
  primaryLeadingGap,
  primaryTrailingGap,
  primarySegmentJunctions,
  junctionID,
  junctionHasRemovedSourceGap,
  primaryDisplaySegments,
  primaryTrimDraftOrigin,
  primarySnappedCutX,
  trimOutputTimeFromTranslation,
  trimPreviewTime,
  trimOutputTimeFromPointerX,
  EditorTimelineZoomAnchor,
  EDITOR_TIMELINE_MINIMUM_ZOOM,
  EDITOR_TIMELINE_MAXIMUM_ZOOM,
  clampedTimelineZoom,
  timelineZoomTargetFromWheel,
  EditorTimelineZoomInputCoalescer,
  timelineZoomTargetScrollOffset,
  fallbackTimelineZoomViewportX,
  overlayMoveActionName,
  overlayResizeActionName,
  primarySegmentIDFromSelection,
  primarySegmentIDs,
  reconcilingPrimarySelection,
  timelineDeleteTarget,
  timelineSplitTarget,
  timelineSelectionRevealTime,
  gestureSeeksDuringDrag,
  gestureIntentEquals,
  EditorTimelineGestureOwnership,
} from '../src/renderer/src/core/EditorTimelineInteraction'

// ---------------------------------------------------------------- 批次 10：媒体探测 / 黑边检测 / 工程打开
export {
  EMPTY_MEDIA_INVENTORY,
  MediaAnalysisError,
  MediaWaveformSession,
  MEDIA_ANALYZER_DEFAULT_SAMPLE_COUNT,
  TimestampedWaveformAccumulator,
  inventoryHasAudio,
  inventoryHasVideo,
  makeMediaAssetInventory,
  mediaAnalysisErrorMessage,
  mediaInventoryEquals,
  mediaInventoryFromProbe,
  waveformFrameBoundary,
} from '../src/renderer/src/core/MediaAnalysis'
export {
  CameraLetterboxCache,
  LETTERBOX_LUMA_B,
  LETTERBOX_LUMA_G,
  LETTERBOX_LUMA_R,
  LETTERBOX_MINIMUM_DURATION,
  LETTERBOX_SAMPLE_FRACTIONS,
  analyzeCameraLetterbox,
  cameraLetterboxMediaVersion,
  cameraLetterboxMediaVersionKey,
  centralDetailedBand,
  conservativeBounds,
  contentBounds,
  coreImageCropRect,
  croppedDisplaySize,
  croppedOriginTranslation,
  downsampleToLetterboxGrid,
  letterboxGridDimension,
  letterboxLumaProfile,
  letterboxSampleTimes,
  medianArea,
  stableCrop,
} from '../src/renderer/src/core/CameraLetterboxAnalysis'
export {
  CAMERA_TIMESTAMP_REPAIRED_SUFFIX,
  PROJECT_OPEN_WARNING,
  PROJECT_PACKAGE_ENTRY_FILE,
  loadProjectOpenSnapshot,
  normalizeProjectPackagePath,
  originalCameraRecordingPath,
  snapshotIsSaved,
  zoomClipArraysEqual,
} from '../src/renderer/src/core/ProjectOpening'
export {
  LEGACY_CURSOR_SPRING,
  LEGACY_MOTION_UPGRADE_TOLERANCE,
  LEGACY_SCREEN_SPRING,
  UPGRADED_CURSOR_SPRING,
  UPGRADED_SCREEN_SPRING,
  motionStyleEquals,
  upgradeLegacyMotionDefaults,
} from '../src/renderer/src/core/LegacyMotionDefaultsUpgrade'
export { bucketIndex } from '../src/renderer/src/core/MediaTimeRange'

// ---------------------------------------------------------------- 批次 11：文件边界 / 看门狗 / 平台策略
export {
  EXPORT_TEMP_DEFAULT_EXTENSION,
  EXPORT_TEMP_INFIX,
  canonicalExportPath,
  exportFileTransactionCollides,
  exportPromotionMode,
  exportPromotionPlan,
  normalizePath,
  splitFilePath,
  temporaryExportPath,
} from '../src/renderer/src/core/ExportFileTransaction'
export {
  EXPORT_WATCHDOG_DEFAULT_TIMEOUT,
  ExportActivityWatchdog,
  intervalWatchdogScheduler,
  watchdogRepeatInterval,
} from '../src/renderer/src/core/ExportActivityWatchdog'
export {
  DisposalCancelledError,
  moveProjectPackageToTrash,
  performDisposalWork,
  removeProjectPackageIfPresent,
} from '../src/renderer/src/core/ProjectPackageDisposal'
export {
  ProjectDocument,
  projectsEqual,
  replaceProjectSnapshot,
  stableStringify,
} from '../src/renderer/src/core/ProjectDocument'
export {
  PROJECT_CATALOG_PRESENTED_RECENT_LIMIT,
  PROJECT_CATALOG_RECENT_QUERY_LIMIT,
  loadProjectCatalogSnapshot,
  projectCatalogSnapshotEquals,
} from '../src/renderer/src/core/ProjectCatalogSnapshot'
export {
  RECOVERY_DEFAULT_SCREEN_RELATIVE_PATH,
  RecordingRecoveryJournal,
  makeRecordingRecoverySnapshot,
} from '../src/renderer/src/core/RecordingRecoveryJournal'
export {
  SC_FRAME_STATUS,
  SC_STREAM_FRAME_INFO_STATUS_KEY,
  decodeFrameStatus,
  frameStatusHasContent,
  frameStatusName,
  readAttachmentStatus,
  screenCaptureFrameStatus,
} from '../src/renderer/src/core/ScreenCaptureFrameMetadata'
export {
  CAPTURE_STREAM_EXTRA_SURFACE_COST_MIB,
  CAPTURE_STREAM_MAXIMUM_FPS,
  CAPTURE_STREAM_QUEUE_DEPTH,
  RECORDING_PERFORMANCE_ACTIVITY_OPTIONS,
  captureStreamMinimumFrameInterval,
  captureStreamMinimumFrameIntervalSeconds,
  cmTimeSeconds,
  recordingActivityDisablesIdleSleep,
} from '../src/renderer/src/core/CaptureStreamCadence'

// ---------------------------------------------------------------- 批次 12：并发许可 / 就绪判定 / 选区几何
export {
  EditorThumbnailPermits,
  ThumbnailPermitCancelledError,
} from '../src/renderer/src/core/EditorThumbnailPermits'
export {
  cameraReadinessEquals,
  cameraReadinessPermitsRecording,
  recorderCameraReadiness,
  recorderStartAvailability,
  startAvailabilityPermitsRecording,
} from '../src/renderer/src/core/RecorderStartAvailability'
export {
  captureAreaSelectionOutcome,
  captureDisplayIdentity,
  resolveCaptureDisplay,
  resolveCaptureDisplayScreen,
  screenDeviceDisplayID,
} from '../src/renderer/src/core/CaptureDisplayResolution'
export {
  EDITOR_EXTERNAL_ACTIONS,
  interactionEndPolicy,
  preparationAllowsProceeding,
  prepareExternalAction,
} from '../src/renderer/src/core/EditorInteractionLifecycle'
export {
  CAPTURE_AREA_SAFE_MARGIN,
  CAPTURE_AREA_TOOLBAR_GAP,
  CAPTURE_AREA_TOOLBAR_HEIGHT,
  CAPTURE_AREA_TOOLBAR_WIDTH,
  captureAreaSelectionScale,
  captureAreaToolbarFrame,
  rectMaxX,
  rectMaxY,
  rectMidX,
  rectMinX,
  rectMinY,
} from '../src/renderer/src/core/CaptureAreaSelectionLayout'
export {
  CAPTURE_AREA_SELECTION_MOTION_DURATION,
  CaptureAreaSelectionMotion,
  selectionMotionIsComplete,
  selectionMotionProgress,
} from '../src/renderer/src/core/CaptureAreaSelectionMotion'
export {
  persistRecordingPointerEvents,
  prepareRecordingPointerFinalization,
} from '../src/renderer/src/core/RecordingPointerFinalization'
export {
  SCENE_PRESET_ASSET_SUBDIRECTORY,
  makeScenePresetBackgroundAsset,
  retainedScenePresetAsset,
  retainedScenePresetFilename,
  scenePresetAssetDirectory,
  scenePresetAssetExtension,
  scenePresetAssetIsAvailable,
  scenePresetAssetPath,
  scenePresetBackgroundSource,
} from '../src/renderer/src/core/ScenePresetBackgroundAsset'

// ---------------------------------------------------------------- 批次 13：导出状态 / 进度中继 / 屏幕拓扑
export {
  EXPORT_STAGES,
  ExportTimeEstimator,
  exportDurationText,
  exportStageFromRawValue,
  exportStageRawValue,
  exportStageTitle,
  exportStatusElapsedLabel,
  exportStatusRemainingLabel,
  exportStatusTitle,
  makeExportStatus,
} from '../src/renderer/src/core/ExportStatus'
export {
  ExportProgressCoalescer,
  ExportProgressRelay,
  exportProgressDeliveryDelayNanoseconds,
} from '../src/renderer/src/core/ExportProgressRelay'
export {
  ScreenTopologyDelta,
  ScreenTopologyMonitor,
  ScreenTopologyReconfigurationState,
  ScreenTopologySnapshot,
  makeScreenTopologyNode,
  screenTopologyGeometryFacts,
  screenTopologyModeFacts,
  screenTopologyNodeEquals,
} from '../src/renderer/src/core/ScreenTopology'

// ---------------------------------------------------------------- 批次 14：缩放包络编辑器几何
export {
  ENVELOPE_HEIGHT,
  ENVELOPE_HOVER_RADIUS,
  ENVELOPE_DRAG_RADIUS,
  ENVELOPE_MAX_SCALE,
  ENVELOPE_MINIMUM_PEAK,
  ENVELOPE_MINIMUM_SPAN_LABEL_WIDTH,
  ENVELOPE_NODES,
  ENVELOPE_PLOT_INSETS,
  ENVELOPE_RULE_LEVELS,
  envelopeAxisSpans,
  envelopeCurveCacheKeyEquals,
  envelopeCurveDuration,
  envelopeCurvePoints,
  envelopeCurveSteps,
  envelopeEffectiveEnter,
  envelopeMagnificationAt,
  envelopeMagnificationAtY,
  envelopeMoveResult,
  envelopeNearestNode,
  envelopeNodePoint,
  envelopePlayheadPoint,
  envelopePlotRect,
  envelopeRuleLines,
  envelopeTimeAtX,
  envelopeTotal,
  envelopeVisibleNodes,
  envelopeX,
  envelopeY,
} from '../src/renderer/src/core/EditorZoomEnvelope'
