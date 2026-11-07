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

// ---------------------------------------------------------------- 批次 15：旋钮 / 休眠遮罩 / 播放观察者
export {
  EditorKnobDragState,
  KNOB_DEAD_ZONE_RADIUS,
  KNOB_FINE_MULTIPLIER,
  KNOB_START_ANGLE,
  KNOB_SWEEP_ANGLE,
  KNOB_WHEEL_DIVISOR,
  KNOB_WHEEL_MAXIMUM_DELTA,
  KNOB_WHEEL_PRECISE_DIVISOR,
  clampKnobFraction,
  knobAngle,
  knobNeedleAngle,
} from '../src/renderer/src/core/EditorKnobDrag'
export {
  editorMotionCurveDetail,
  editorMotionCurveOption,
  editorMotionCurveSymbol,
  editorMotionCurveTitle,
} from '../src/renderer/src/core/EditorMotionCurveStyle'
export {
  CANVAS_SLEEP_FADE_DURATION,
  EditorCanvasSleepPresentation,
  rafFadeAnimator,
} from '../src/renderer/src/core/EditorCanvasSleepPresentation'
export {
  PANEL_FADE_DURATION,
  PANEL_FADE_DURATION_REDUCED_MOTION,
  RecorderPanelTransition,
  panelTransitionDuration,
} from '../src/renderer/src/core/RecorderPanelTransition'
export {
  EditorPlaybackTimelineObserverHub,
  makeEditorPlaybackTimelineSnapshot,
} from '../src/renderer/src/core/EditorPlaybackTimelineObserver'
export {
  CAMERA_SYNC_DISMISSAL,
  CAMERA_SYNC_MINIMUM_DISPLAY_RANGE,
  CAMERA_SYNC_TRACK_AMPLITUDE,
  CAMERA_SYNC_TRACK_CENTER_Y,
  cameraSyncDisplayRange,
  cameraSyncOffsetLabel,
  cameraSyncY,
  presentedCameraSyncAnchor,
  removeCameraSyncAnchor,
} from '../src/renderer/src/core/EditorTimelineCameraSync'
export {
  rectContains,
  rectIntersection,
  targetsTextInput,
  textInputRegionContains,
} from '../src/renderer/src/core/EditorTextInputHitTesting'
export {
  INITIAL_FRAME_DEFAULT_ADVANCE_INTERVAL,
  InitialFrameMediaDataWaiter,
} from '../src/renderer/src/core/EditorPlaybackInitialFrameWaiter'
export {
  EXPORT_OUTPUT_KINDS,
  EditorExportRequestError,
  buildEditorExportRequest,
  defaultExportOutputPath,
  editorExportRequestErrorMessage,
  editorExportScopeOutputRange,
  editorExportScopeSelectedSegmentCount,
  editorMediaFileVersion,
  editorMediaFileVersionEquals,
  exportAssetInputURLs,
  exportAssetRoleDisplayName,
  exportFileNameComponent,
  exportOutputFileExtension,
  exportOutputPath,
  exportTimestampText,
  isFileURLPath,
  makeExportAssetFromPath,
  validateCurrentAssetVersions,
  validateCurrentVersion,
  validateExistingLocalFile,
} from '../src/renderer/src/core/EditorExportRequest'
export {
  RECORDER_ACCESSIBILITY_ID,
  recorderPhaseAccessibilityID,
} from '../src/renderer/src/core/RecorderAccessibility'
export {
  EDITOR_ICON_LINE_GRID,
  EDITOR_MAGNET_ICON_ACCESSIBILITY_HIDDEN,
  EDITOR_MAGNET_ICON_KIND,
  EDITOR_MAGNET_ICON_SCALE,
  editorMagnetIconGlyphSize,
  editorMagnetIconLayout,
} from '../src/renderer/src/core/EditorMagnetIcon'
export {
  APP_IDENTITY_FALLBACK_DISPLAY_NAME,
  appDisplayName,
} from '../src/renderer/src/core/AppIdentity'
export {
  WINDOW_SURFACE_CORNER_CURVE,
  WINDOW_SURFACE_MASKS_TO_BOUNDS,
  appWindowSurfaceStyle,
  windowSurfaceCornerRadius,
} from '../src/renderer/src/core/AppWindowSurface'
export {
  ROTATION_HANDLE_FONT_SIZE,
  ROTATION_HANDLE_FONT_WEIGHT,
  ROTATION_HANDLE_GLYPH_SIZE,
  ROTATION_HANDLE_SHADOW,
  ROTATION_HANDLE_SIZE,
  ROTATION_HANDLE_SYMBOL,
  rotationHandleGlyphRotation,
  rotationHandleSurface,
} from '../src/renderer/src/core/EditorLinearFocusRotationHandle'
export {
  RECORDER_VIEW_FALLBACK_HEX_COLOR,
  colorChannelByte,
  cssColorFromHexColor,
  hexColorFromRgbComponents,
  recorderViewStyleRoundTrip,
} from '../src/renderer/src/core/RecorderViewStyle'
export { compositeSharedFrame } from '../src/renderer/src/core/SharedFrameCompositor'
export {
  ISLAND_CANVAS_VERTICAL_SLACK,
  ISLAND_CONTENT_BLUR,
  compactIslandLayout,
  islandCanvasHorizontalMargin,
  morphIslandLayout,
} from '../src/renderer/src/core/RecorderIslandLayout'
export {
  SOURCE_THUMBNAIL_MINIMUM_HEIGHT,
  SOURCE_THUMBNAIL_SHOWS_CURSOR,
  SOURCE_THUMBNAIL_WIDTH,
  resolveSourceThumbnailTarget,
  sourceThumbnailSize,
} from '../src/renderer/src/core/RecorderSourceThumbnail'
export {
  CAMERA_FULL_HD_PIXELS,
  CAMERA_FULL_HD_PIXEL_HEADROOM,
  cameraFormatIsLandscape,
  preferredCameraFormatIndex,
} from '../src/renderer/src/core/CameraCaptureFormatSelector'
export {
  MINIATURE_CORNER_RADIUS,
  MINIATURE_GEOMETRY,
  MINIATURE_PALETTE,
  miniatureContentRowCount,
  miniatureLayers,
} from '../src/renderer/src/core/SettingsAppearanceMiniature'
export {
  APPEARANCE_DEFAULT_PREFERENCE,
  APPEARANCE_PREFERENCE_KEY,
  APPEARANCE_TOGGLE_CORNER_RADIUS,
  appearanceToggleAnimation,
  appearanceToggleState,
  appearanceToggleTransition,
} from '../src/renderer/src/core/EditorAppearanceToggleButton'
export {
  TOUR_HIGHLIGHT_RECORDER_INPUTS,
  TOUR_HIGHLIGHT_RECORDER_SOURCES,
  flipTourHighlightY,
  tourHighlightCornerRadii,
  tourHighlightInsetRect,
  tourHighlightRounded,
  tourHighlightSegments,
} from '../src/renderer/src/core/FirstUseTourHighlight'
export {
  SUPPORT_APPRECIATION_IMAGE_RESOURCE,
  SUPPORT_IMAGE_CONTENT_MODE,
  SUPPORT_SHEET_ACCESSIBILITY,
  SUPPORT_SHEET_FOOTER,
  SUPPORT_SHEET_METRICS,
  SUPPORT_SHEET_MISSING_IMAGE_TEXT,
  SUPPORT_SHEET_TITLE,
  supportImageState,
} from '../src/renderer/src/core/AppSupportSheet'
export {
  CAMERA_SESSION_NOTIFICATION,
  CAMERA_SESSION_UNKNOWN_ERROR_CODE,
  CAMERA_SESSION_UNKNOWN_ERROR_MESSAGE,
  CameraCaptureSessionEventMonitor,
  cameraSessionEventForNotification,
  cameraSessionRuntimeErrorEvent,
} from '../src/renderer/src/core/CameraCaptureSessionEventMonitor'
export {
  DOCK_BUNDLE_IDENTIFIER,
  FINDER_BUNDLE_IDENTIFIER,
  captureSurfaceFilterPlan,
  finderDesktopWindowIDs,
} from '../src/renderer/src/core/CaptureSurfaceFilter'
export {
  SAVE_ACTION_CORNER_RADIUS,
  SAVE_ACTION_DISABLED_OPACITY,
  SAVE_ACTION_PRESS_ANIMATION_DURATION,
  SAVE_ACTION_PRESSED_SCALE,
  SAVE_ACTION_ROW_HEIGHT,
  SAVE_TOGGLE_ROW_HEIGHT,
  SAVE_TOGGLE_ROW_LAYOUT,
  saveActionRowLayout,
  saveActionTrailing,
} from '../src/renderer/src/core/RecorderSaveActions'
export {
  APP_TEXT_STYLE_SIZE,
  APP_TIMECODE_FONT_FAMILY,
  APP_TYPOGRAPHY_FAMILY,
  APP_TYPOGRAPHY_FONT_FILES,
  APP_TYPOGRAPHY_RESOURCE_DIRECTORY,
  appRegularTextFontFamily,
  appTextStyleFont,
  appTextStyleSize,
  appTypographyFace,
  appUIFont,
} from '../src/renderer/src/core/AppTypography'
export {
  EDITOR_SLIDER_MINIMUM_KNEE,
  EDITOR_SLIDER_SCALE_LINEAR,
  EDITOR_SLIDER_TICK_MINIMUM_SPACING,
  linearTickStep,
  logarithmicSliderScale,
  sliderFraction,
  sliderScaleForValueFormat,
  sliderTicks,
  sliderValue,
} from '../src/renderer/src/core/EditorSliderScale'
export {
  RECORDING_MARKER_DEBOUNCE_SECONDS,
  RECORDING_MARKER_HOTKEY_ID,
  RECORDING_MARKER_HOTKEY_KEY_CODE,
  RECORDING_MARKER_HOTKEY_SIGNATURE,
  canAddRecordingMarker,
  nextRecordingMarkerNumber,
  recordingMarkerHotKeyShouldBeRegistered,
  recordingMarkerIsTooSoon,
  recordingMarkerShortcutAvailable,
  recordingMarkerToAppend,
} from '../src/renderer/src/core/RecordingMarkers'
export {
  EDITOR_INTERFACE_RADIUS,
  EDITOR_MINIMUM_WINDOW_SIZE,
  editorChromeScaledSize,
  editorChromeUnscaledSize,
  editorTimelineHeight,
  editorWorkspaceCompression,
  editorWorkspaceMetrics,
  editorWorkspaceValue,
} from '../src/renderer/src/core/EditorWorkspaceLayout'
export {
  nextPausedFrameDecodeToken,
  pausedCameraImageDecision,
  pausedFrameIndex,
  pausedFramePublicationIsCurrent,
  pausedFrameTime,
  shouldRefreshPausedFrames,
} from '../src/renderer/src/core/EditorPlaybackPausedFrames'
export {
  EDITOR_CROP_ONLY_ACTIONS,
  EDITOR_CROP_TOOLBAR_ACTIONS,
  EDITOR_STANDARD_TOOLBAR_ACTIONS,
  editorCropPresentation,
  editorCropPresentationIsActive,
  editorCropToolbarPermits,
} from '../src/renderer/src/core/EditorCropPresentation'
export {
  SLIDER_ARROW_KEY_CODES,
  SLIDER_KEY_CODE_DOWN,
  SLIDER_KEY_CODE_LEFT,
  SLIDER_KEY_CODE_RIGHT,
  SLIDER_KEY_CODE_UP,
  sliderAcceptsFocus,
  sliderKeyboardStep,
  sliderMouseDownReleasesFocus,
  sliderShouldRequestFocus,
  sliderStepDirection,
} from '../src/renderer/src/core/EditorSliderKeyboardBridge'
export {
  TRANSIENT_NOTICE_INSUFFICIENT_TAIL_MESSAGE,
  TRANSIENT_NOTICE_MAXIMUM_SECONDS,
  TRANSIENT_NOTICE_METRICS,
  TRANSIENT_NOTICE_MINIMUM_SECONDS,
  TRANSIENT_NOTICE_PROJECT_OPENED_PREFIX,
  TRANSIENT_NOTICE_SAME_TRACK_MESSAGE,
  TRANSIENT_NOTICE_SECONDS_PER_CHARACTER,
  transientNoticeAnimatesProgress,
  transientNoticeContent,
  transientNoticeLifetime,
  transientNoticeProgressWidth,
} from '../src/renderer/src/core/EditorTransientNotice'
export {
  PREVIEW_ANIMATION_FRAMES_PER_SECOND,
  PREVIEW_ANIMATION_FRAME_DURATION,
  PREVIEW_PREWARM_CAPACITY,
  PREVIEW_ZOOM_ENTRY_MAXIMUM,
  previewAnimationIntervals,
  previewAnimationSampleTime,
  previewPrewarmTimes,
} from '../src/renderer/src/core/PreviewAnimationPreparation'
export {
  POPOVER_ENTRY_KEYS,
  POPOVER_ENTRY_VIEW_SIZE,
  POPOVER_EXIT_KEY,
  POPOVER_PASSES_SPACEBAR_TO_WORKSPACE,
  eventTargetsPresentedContent,
  popoverKeyboardEntryHandles,
} from '../src/renderer/src/core/EditorPopover'
export {
  AUDIO_EXPORT_FILE_TYPE,
  AUDIO_EXPORT_PRESET,
  AUDIO_EXPORT_PROGRESS_CEILING,
  AUDIO_EXPORT_PROGRESS_POLL_MILLISECONDS,
  AUDIO_EXPORT_TIME_PITCH_ALGORITHM,
  AudioExportError,
  audioExportFailureKind,
  audioExportHasTracks,
  audioExportReportedProgress,
  audioExportTimeRange,
  audioExportVolume,
} from '../src/renderer/src/core/AudioOnlyExportPipeline'
export { escapeDismissalAction } from '../src/renderer/src/core/EscapeDismissibleWindow'
export {
  ZOOM_PHASE_BAR_HEIGHT,
  ZOOM_PHASE_SEAM_HEIGHT,
  ZOOM_PHASE_LABEL_ICON_SIZE,
  ZOOM_PHASE_LABEL_FONT_SIZE,
  ZOOM_PHASE_LABEL_MINIMUM_WIDTH,
  ZOOM_PHASE_EDGE_OPACITY,
  ZOOM_PHASE_BORDER_OPACITY,
  ZOOM_PHASE_SEAM_OPACITY,
  ZOOM_PHASE_LABEL_OPACITY,
  ZOOM_PHASE_LABELS,
  zoomPhaseSegments,
  zoomPhaseGradientStops,
  zoomPhaseSeamVisible,
  zoomPhaseLabelVisible,
  zoomPhaseLabelFrame,
} from '../src/renderer/src/core/EditorZoomPhaseBar'
export {
  PERMISSION_STEP_ORDER,
  PermissionTourFlow,
  permissionAccessAllGranted,
  permissionAccessGrants,
  permissionFirstRequiredStep,
  permissionStepIndex,
} from '../src/renderer/src/core/PermissionTourFlow'
export {
  APP_FORMAL_BUNDLE_IDENTIFIER,
  APP_UPDATE_PLACEHOLDER,
  APP_UPDATE_TEXT,
  APP_UPDATE_CHECK_SEQUENCE,
  AppUpdateController,
  appIsFormalRelease,
  appUpdateAvailabilityDescription,
  appUpdateCheckAllowed,
  appUpdateStartDecision,
  appUpdateVersionDescription,
} from '../src/renderer/src/core/AppUpdateController'
export {
  WALLPAPER_ACCORDION_SPACING,
  WALLPAPER_ACCORDION_HEIGHT,
  WALLPAPER_ACCORDION_SPRING,
  WALLPAPER_HOVER_WEIGHT,
  WALLPAPER_SELECTED_WEIGHT,
  WALLPAPER_IDLE_WEIGHT,
  WALLPAPER_LABEL_MINIMUM_WIDTH,
  WALLPAPER_IDLE_OPACITY,
  wallpaperAccordionLayout,
  wallpaperAccordionWeight,
  wallpaperSliceState,
} from '../src/renderer/src/core/EditorWallpaperAccordion'
export {
  SCRUB_SEEK_TIMESCALE,
  EditorScrubbingSession,
  ScrubSeekCoalescer,
  playbackClampedTime,
} from '../src/renderer/src/core/EditorPlaybackScrubbing'
export {
  TITLEBAR_DOUBLE_CLICK_TOKENS,
  EDITOR_CHROME_ACCEPTS_FIRST_MOUSE,
  EDITOR_CHROME_ACCEPTS_FIRST_RESPONDER,
  chromeClickKind,
  titlebarDoubleClickAction,
  titlebarDoubleClickEffect,
} from '../src/renderer/src/core/EditorWindowChromeInteraction'
export {
  FRAME_COLOR_PROFILE_ERRORS,
  FRAME_COLOR_VIDEO_PROPERTIES,
  FRAME_COLOR_PIXEL_BUFFER_ATTACHMENTS,
  FrameColorProfileError,
  avVideoColorProperties,
  frameColorProfileAttachments,
  frameColorProfileContextOptions,
  frameColorProfileMetalContextOptions,
  resolveFrameColorProfile,
} from '../src/renderer/src/core/CoreImageFrameColorProfile'
export {
  CROP_FULL,
  EDITOR_WINDOW_IDENTIFIER,
  cropCommandPlan,
  cropDraftUpdateAllowed,
  cropDraftValue,
  performEditorCommand,
  selectionAfterExternalAction,
} from '../src/renderer/src/core/EditorViewCropAndPreset'
export {
  BACKGROUND_BLUR_RANGE,
  SEGMENT_AUDIO_TEXTS,
  ZOOM_TRANSITION_TEXTS,
  ZOOM_TRANSITION_TOLERANCE,
  backgroundBlurSectionVisible,
  segmentAudioHeader,
  segmentAudioOutsideWarningVisible,
  segmentAudioRangeText,
  segmentAudioRestoreVisible,
  segmentAudioScopeText,
  segmentAudioSourceDetail,
  selectedAudioContextRowSpacing,
  selectedAudioContextVerticalPadding,
  zoomPhaseSecondsText,
  zoomTransitionAvailability,
  zoomTransitionConstrainedLine,
} from '../src/renderer/src/core/EditorInspectorScopeControls'
export {
  INSPECTOR_TABS,
  INSPECTOR_TAB_BAR_DISABLED_OPACITY,
  INSPECTOR_TAB_BAR_HEIGHT,
  INSPECTOR_TAB_MINIMUM_TARGET,
  INSPECTOR_TAB_UNAVAILABLE_HELP,
  INSPECTOR_TAB_UNAVAILABLE_OPACITY,
  inspectorTabAccessibilityIdentifier,
  inspectorTabAvailable,
  inspectorTabHelp,
  inspectorTabPresentations,
  inspectorTabSelectionChanges,
} from '../src/renderer/src/core/EditorInspectorTabBar'
export {
  APPEARANCE_CROSSFADE_DURATION,
  CROSSFADE_TIMING,
  SNAPSHOT_ACCEPTS_HIT_TESTING,
  SNAPSHOT_FADE_DELAY,
  WINDOW_CROSSFADE_DURATION,
  WINDOW_SERVER_CAPTURE_ARGUMENTS,
  appearanceTransitionPlan,
  crossfadePlan,
} from '../src/renderer/src/core/WindowAppearanceTransition'
