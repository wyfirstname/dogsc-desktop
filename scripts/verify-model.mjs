/**
 * verify-model — ProjectModel 批次（CanvasCustomAspectRatio / ProjectModel /
 * ScreenFrameDefaults / ExportSettings / MotionStyle 扩展）数值断言。
 *
 * 用 esbuild 打包后以 ESM 导入运行，避免 Node 直接解析 TS。
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'dogsc-model-'))
await build({
  entryPoints: ['scripts/verify-model-entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(outDir, 'bundle.mjs'),
})
const m = await import(pathToFileURL(join(outDir, 'bundle.mjs')).href)

let passed = 0
let failed = 0
function check(name, actual, expected, tol = 1e-9) {
  const ok =
    typeof expected === 'number' && typeof actual === 'number'
      ? Math.abs(actual - expected) <= tol
      : actual === expected
  if (ok) {
    passed++
  } else {
    failed++
    console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
function checkThrows(name, fn) {
  try {
    fn()
    failed++
    console.error(`FAIL ${name}: expected throw`)
  } catch {
    passed++
  }
}

const {
  // schema
  ProjectSchema, PROJECT_SCHEMA_CURRENT_VERSION,
  // canvas
  makeCanvasStyle, decodeCanvasStyle, encodeCanvasStyle, decodeScreenFrameStyle,
  canvasPixelDimensions, clampedCrop, cropFromEdges, cropRight, cropBottom,
  // opening
  makeOpeningSequence, maximumOpeningStagger, participatingOpeningElements,
  // background
  decodeDynamicBackgroundPreset, dynamicBackgroundDisplayName, decodeBackgroundSource,
  backgroundSourceUsesWallpaperMedia, BACKGROUND_SOURCE_SAFE_FALLBACK,
  // cursor
  makeCursorStyle, decodeCursorStyle, encodeCursorStyle, cursorAppearance,
  cursorClickEffectDuration, cursorShowsClickEffect, setCursorShowsClickEffect,
  decodeCameraShape,
  // audio/camera
  makeAudioStyle, decodeAudioStyle, makeCameraStyle, decodeCameraStyle,
  // aspect / frame defaults / export
  customAspectRatioValue, resolvedFixedAspectRatio, applyScreenFrameStyle,
  screenFrameDefaults, makeExportSettings, decodeExportSettings,
} = m
const {
  // ---- 批次 2 ----
  ScreenMotionTrack, makeAnchorViewport, mixAngle,
  makeMediaSyncAnchor, makeProjectMediaReference, decodeProjectMediaReference,
  makeProjectMediaManifest, decodeProjectMediaManifest,
  decodeRecorderProject, encodeRecorderProject, makeRecorderProject,
  MediaTimelinePlacement, MediaSyncAnchorCurve, anchor,
  makeTransitionTiming, makeProjectTimeline, makeClip, makeMotionStyle,
} = m

// ---- ProjectSchema
ProjectSchema.validateForDecoding(23)
ProjectSchema.validateForDecoding(27)
ProjectSchema.validateForEncoding(23)
checkThrows('schema.tooOld', () => ProjectSchema.validateForDecoding(22))
checkThrows('schema.tooNew', () => ProjectSchema.validateForDecoding(28))
check('schema.current', PROJECT_SCHEMA_CURRENT_VERSION, 27)

// ---- ScreenFrameStyle decode
check('sfs.retiredPaper', decodeScreenFrameStyle('paperWhite'), 'none')
check('sfs.retiredGraphite', decodeScreenFrameStyle('graphite'), 'none')
check('sfs.cyberNeon', decodeScreenFrameStyle('cyberNeon'), 'windowDark')
check('sfs.frostedGlass', decodeScreenFrameStyle('frostedGlass'), 'windowLight')
check('sfs.devicePhonePortrait', decodeScreenFrameStyle('devicePhonePortrait'), 'devicePhonePortrait')
checkThrows('sfs.unknown', () => decodeScreenFrameStyle('nope'))

// ---- OpeningSequence
const seq = makeOpeningSequence({ duration: 5, stagger: 3, includedElements: ['屏幕', '屏幕', '摄像头'] })
check('open.durClamp', seq.duration, 5)
check('open.staggerClampInit', seq.stagger, 1.2)
check('open.dedupe', seq.includedElements.length, 2)
check('open.orderAppendMissing', seq.elementOrder.join(','), '屏幕,摄像头,贴图')
check('open.maxStagger', maximumOpeningStagger(seq, 3), Math.min(1.2, (5 - 0.18) / 2))
const tiny = makeOpeningSequence({ duration: 0.2 })
check('open.minDur', tiny.duration, 0.4)
check('open.maxStaggerSingle', maximumOpeningStagger(tiny, 1), 1.2)
const part = participatingOpeningElements(
  makeOpeningSequence(),
  false,
  false
)
check('open.noCameraNoSticker', part.join(','), '屏幕')

// ---- backgrounds
check('dyn.legacyCross', decodeDynamicBackgroundPreset('旋转十字星阵'), '赛博微流网格')
check('dyn.displayName', dynamicBackgroundDisplayName('赛博微流网格'), '流金缓移网格')
checkThrows('dyn.unknown', () => decodeDynamicBackgroundPreset('不存在'))
const bg = decodeBackgroundSource({ kind: 'projectImage', relativePath: 'media/a.png' })
check('bg.roundtrip', bg.relativePath, 'media/a.png')
check('bg.wallpaper', backgroundSourceUsesWallpaperMedia(bg), true)
check('bg.fallbackKind', BACKGROUND_SOURCE_SAFE_FALLBACK.patternPreset, '黑曜石网格')
checkThrows('bg.badKind', () => decodeBackgroundSource({ kind: 'nope' }))

// ---- camera shape
check('shape.legacyRound', decodeCameraShape('圆角矩形'), '横向')
check('shape.legacyCont', decodeCameraShape('连续圆角'), '方形')
check('shape.unknown', decodeCameraShape('nope'), '方形')

// ---- cursor
const cs = makeCursorStyle({ size: 99, idleDelay: 0.01, clickOpacity: 5, clickScale: 0, motionTiltStrength: 1, assetID: '' })
check('cur.size', cs.size, 6)
check('cur.idle', cs.idleDelay, 0.2)
check('cur.opacity', cs.clickOpacity, 1.0)
check('cur.scale', cs.clickScale, 0.4)
check('cur.tilt', cs.motionTiltStrength, 2)
check('cur.emptyAsset', cs.assetID, 'system.arrow')
check('cur.effectDur', cursorClickEffectDuration('pulse'), 0.38)
check('cur.shows', cursorShowsClickEffect(cs), true)
setCursorShowsClickEffect(cs, false)
check('cur.unset', cs.clickEffectStyle, 'none')
setCursorShowsClickEffect(cs, true)
check('cur.reset', cs.clickEffectStyle, 'ripple')
const legacy = decodeCursorStyle({ appearance: '指向手势', showsClickEffect: false, size: 2 })
check('cur.legacyAsset', legacy.assetID, 'system.pointing-hand')
check('cur.legacyEffect', legacy.clickEffectStyle, 'none')
check('cur.appearanceView', cursorAppearance(legacy), '指向手势')
const encoded = encodeCursorStyle(legacy)
check('cur.encodeOmitsTilt', 'motionTiltStrength' in encoded, false)
check('cur.encodeShows', encoded.showsClickEffect, false)
check('cur.encodeOmitsColor', 'clickColor' in encoded, false)

// ---- crop
check('crop.clampWidth', clampedCrop({ x: 0.5, y: 0.5, width: 1, height: 1 }).width, 0.5)
check('crop.right', cropRight({ x: 0.1, y: 0, width: 0.4, height: 1 }), 0.5)
const edge = cropFromEdges(0.1, 0.2, 0.05, 0.05)
check('crop.fromEdgesW', edge.width, 0.7)
check('crop.fromEdgesH', edge.height, 0.9)
check('crop.minSize', clampedCrop({ x: 0.99, y: 0.99, width: 0, height: 0 }, 0.02).width, 0.02, 1e-12)

// ---- canvas style decode/encode
const decodedStyle = decodeCanvasStyle({
  aspectRatio: '16:9', padding: 80, borderHex: '#112233', screenFrame: 'windowDark',
  crop: { x: 0, y: 0, width: 2, height: 1 }, patternScale: 99, screenFrameScale: 9,
})
check('style.border', decodedStyle.borderColor, '#112233')
check('style.frame', decodedStyle.screenFrame, 'windowDark')
check('style.cropClamped', decodedStyle.crop.width, 1)
check('style.patternClamped', decodedStyle.patternScale, 6.0)
check('style.frameScaleClamped', decodedStyle.screenFrameScale, 1.6)
check('style.defaults', decodeCanvasStyle({}).padding, 100)
const enc = encodeCanvasStyle(decodedStyle)
check('style.encKey', enc.borderHex, '#112233')
check('style.encOmitsNilRadius', 'screenFrameOuterCornerRadius' in enc, false)
const withRadius = decodeCanvasStyle({ screenFrameOuterCornerRadius: 999 })
check('style.radiusClamped', withRadius.screenFrameOuterCornerRadius, 160)

// ---- pixelDimensions
const adaptive = makeCanvasStyle({ aspectRatio: '适应' })
check('pix.adaptive169', canvasPixelDimensions(adaptive, '1080p', 16 / 9).width, 1920)
check('pix.adaptive169h', canvasPixelDimensions(adaptive, '1080p', 16 / 9).height, 1080)
const portrait = canvasPixelDimensions(adaptive, '1080p', 9 / 16)
check('pix.portraitW', portrait.width, 1080)
check('pix.portraitH', portrait.height, 1920)
const wide = canvasPixelDimensions(adaptive, '1080p', 5.0)
check('pix.ratioClamp', wide.width, 1920)
check('pix.ratioClampH', wide.height, 384)
const cinema = makeCanvasStyle({ aspectRatio: '2.39:1' })
const cine = canvasPixelDimensions(cinema, '1440p')
check('pix.cinemaW', cine.width, 2560)
check('pix.cinemaH', cine.height, Math.round(2560 / 2.39 / 2) * 2)
const sq = canvasPixelDimensions(makeCanvasStyle({ aspectRatio: '1:1' }), '4K')
check('pix.square', sq.width, 2160)
check('pix.landscape', canvasPixelDimensions(makeCanvasStyle({ aspectRatio: '16:9' }), '4K').width, 3840)
// source 模式 + 裁切 + 固定比例不放大裁切包络
const cropped = makeCanvasStyle({ aspectRatio: '16:9', crop: { x: 0, y: 0, width: 0.5, height: 0.5 } })
const srcDim = canvasPixelDimensions(cropped, '原始素材', null, { width: 1920, height: 1080 })
check('pix.srcW', srcDim.width, 960)
check('pix.srcH', srcDim.height, 540)
const croppedTall = makeCanvasStyle({ aspectRatio: '9:16', crop: { x: 0, y: 0, width: 0.5, height: 0.5 } })
const srcTall = canvasPixelDimensions(croppedTall, '原始素材', null, { width: 1920, height: 1080 })
check('pix.srcFitW', srcTall.width, 304)
check('pix.srcFitH', srcTall.height, 540)
check('pix.defaultSource', canvasPixelDimensions(makeCanvasStyle(), '原始素材').width, 1920)

// ---- custom aspect ratio
check('car.value', customAspectRatioValue({ width: 21, height: 9 }), 21 / 9)
check('car.invalid', customAspectRatioValue({ width: -1, height: 0 }), 16 / 9)
check('car.clamp', customAspectRatioValue({ width: 100, height: 1 }), 10)

// ---- resolvedFixedAspectRatio / applyScreenFrameStyle
const customStyle = makeCanvasStyle({ aspectRatio: '自定义', customAspectRatio: { width: 21, height: 9 } })
check('rfa.custom', resolvedFixedAspectRatio(customStyle), 21 / 9)
check('rfa.adaptive', resolvedFixedAspectRatio(makeCanvasStyle()), null)
check('rfa.cinema', resolvedFixedAspectRatio(makeCanvasStyle({ aspectRatio: '2.39:1' })), 2.39)
const canvas = makeCanvasStyle()
applyScreenFrameStyle(canvas, 'windowDark')
check('sfd.applyFrame', canvas.screenFrame, 'windowDark')
check('sfd.applyToolbar', canvas.screenFrameToolbarScale, 0.9)
check('sfd.applyOuter', canvas.screenFrameOuterCornerRadius, 18)
check('sfd.applyContent', canvas.cornerRadius, 0)
check('sfd.applyShadow', canvas.shadowStrength, 0.3)
check('sfd.tablet', screenFrameDefaults('deviceTablet').outerRadius, 48)

// ---- audio
const audio = makeAudioStyle({ systemVolume: 2 })
check('audio.vol', audio.systemVolume, 1)
const decAudio = decodeAudioStyle({})
check('audio.defaults', decAudio.microphoneVolume, 0.9)
check('audio.mute', decAudio.isSystemMuted, false)

// ---- camera style
const cam = makeCameraStyle()
check('cam.pos', cam.position.x, 0.96)
check('cam.scale', cam.scaleDuringZoom, 0.7)
check('cam.decodeHidden', decodeCameraStyle({}).isHidden, false)
check('cam.decodeMirror', decodeCameraStyle({ isMirrored: false }).isMirrored, false)

// ---- export settings
check('exp.default', makeExportSettings().frameRate, 60)
check('exp.decode90', decodeExportSettings({ frameRate: 90, resolution: '1080p' }).frameRate, 90)
check('exp.decodeBad', decodeExportSettings({ frameRate: 77 }).frameRate, 60)
check('exp.decodeRes', decodeExportSettings({ resolution: '4K' }).resolution, '4K')

// ---- 批次 2：mixAngle / ScreenMotionTrack
check('mixAngle.shortWay', mixAngle(170, -170, 0.5), 180)
check('mixAngle.zero', mixAngle(30, 30, 0.7), 30)

const baseState = { position: { x: 0.5, y: 0.5 }, scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, perspective: 0.65 }
const targetState = { position: { x: 0.3, y: 0.5 }, scale: 2, rotationX: 0, rotationY: 0, rotationZ: 0, perspective: 0.65 }
const timingA = makeTransitionTiming({ startTime: 0, duration: 2, leadInDuration: 1, easing: '线性' })
const track1 = new ScreenMotionTrack([
  { id: 'c1', timing: timingA, target: targetState, groupID: null, focusEffect: null },
])
check('sm.midScale', track1.sampleAt(0.5, baseState).scale, 1.5)
check('sm.midPosX', track1.sampleAt(0.5, baseState).position.x, 0.4)
const held = track1.sampleAt(3, baseState)
check('sm.holdScale', held.scale, 2)
check('sm.holdPos', held.position.x, 0.3)
check('sm.before', track1.sampleAt(-1, baseState).scale, 1)
check('sm.activeBefore', track1.activeClipAt(-1), null)
check('sm.activeMid', track1.activeClipAt(0.5)?.id, 'c1')
check('sm.activeAfterHold', track1.activeClipAt(3)?.id, 'c1')

// 带回落：1s 回落窗口
const timingR = makeTransitionTiming({ startTime: 0, duration: 2, leadInDuration: 1, easing: '线性', returnDuration: 1 })
const trackR = new ScreenMotionTrack([
  { id: 'r1', timing: timingR, target: targetState, groupID: null, focusEffect: null },
])
check('sm.retMid', trackR.sampleAt(2.5, baseState).scale, 1.5)
check('sm.retDone', trackR.sampleAt(3.5, baseState).scale, 1)
check('sm.retActiveGone', trackR.activeClipAt(3.2), null)
check('sm.retStillActive', trackR.activeClipAt(2.5)?.id, 'r1')

// 相接关键帧：前段回落被休眠
const timingB = makeTransitionTiming({ startTime: 2, duration: 2, leadInDuration: 1, easing: '线性' })
const targetC = { ...targetState, scale: 3, position: { x: 0.7, y: 0.5 } }
const trackChain = new ScreenMotionTrack([
  { id: 'a', timing: timingR, target: targetState, groupID: null, focusEffect: null },
  { id: 'b', timing: timingB, target: targetC, groupID: null, focusEffect: null },
])
check('sm.chainAt3', trackChain.sampleAt(3, baseState).scale, 3)
// t=2.0 恰在接点：最后开始的片段是 b，但 leadIn 进度 0 → 保持前段目标
check('sm.chainNoFalloff', trackChain.sampleAt(2.0, baseState).scale, 2)

// 视口锚点：rect 空间线性插值 + 像素 manualOffset
const vp = makeAnchorViewport(1920, 1080, 1600, 900)
const sampled = track1.sampleLayout(0.5, baseState, makeMotionStyle(), vp)
check('sm.vpPos', sampled.state.position.x, 0.23333333333333334, 1e-9)
check('sm.vpPosY', sampled.state.position.y, 0.5)
check('sm.vpOffset', sampled.manualOffset.x, 187.52, 1e-9)
check('sm.vpOffsetY', sampled.manualOffset.y, 0)
check('sm.vpAnchor', sampled.projectionAnchor.x, 0.3)
check('sm.noVpOffset', track1.sampleLayout(0.5, baseState, makeMotionStyle(), null).manualOffset, null)

// 畸形轨道走扫描路径（负时长片段被跳过）
const broken = new ScreenMotionTrack([
  { id: 'x', timing: makeTransitionTiming({ startTime: 0, duration: -1, easing: '线性' }), target: targetState, groupID: null, focusEffect: null },
  { id: 'y', timing: makeTransitionTiming({ startTime: 0, duration: 2, leadInDuration: 1, easing: '线性' }), target: targetState, groupID: null, focusEffect: null },
])
check('sm.brokenMid', broken.sampleAt(0.5, baseState).scale, 1.5)
check('sm.brokenSorted', broken.clips[0].id, 'x')

// ---- 批次 2：ProjectMediaModel
const anchorClamped = makeMediaSyncAnchor({ sourceTime: -5, offset: 99 })
check('pm.anchorTime', anchorClamped.sourceTime, 0)
check('pm.anchorOffset', anchorClamped.offset, 10)
check('pm.anchorLow', makeMediaSyncAnchor({ sourceTime: 1, offset: -99 }).offset, -10)
const ref = makeProjectMediaReference({
  relativePath: 'cam', startOffset: 2, sourceStartTime: 1, sourceTimeScale: 2, sourceEndTime: 11,
})
check('pm.refScale', ref.sourceTimeScale, 2)
check('pm.refEnd', ref.sourceEndTime, 11)
check('pm.refBadScale', makeProjectMediaReference({ relativePath: 'x', sourceTimeScale: 0 }).sourceTimeScale, null)
check('pm.refBadEnd', makeProjectMediaReference({ relativePath: 'x', sourceEndTime: -1 }).sourceEndTime, null)
const refDecoded = decodeProjectMediaReference({ relativePath: 'm', startOffset: 1, syncAnchors: [{ id: 'a', sourceTime: 5, offset: 3 }] })
check('pm.decAnchor', refDecoded.syncAnchors.length, 1)
check('pm.decDefaultScale', refDecoded.sourceTimeScale, null)

// v1-v6 兼容分支与 Swift 行为一致：validateForDecoding（最低 23）先行，
// 这些分支在当前 schema 下不可达，仅作为逐行转写保留。
checkThrows('pm.v1Rejected', () => decodeRecorderProject({
  version: 1,
  zoomKeyframes: [{ id: 'k1', time: 1, scale: 2, focus: { x: 0.5, y: 0.5 }, origin: 'manual' }],
}))
checkThrows('pm.v5Rejected', () =>
  decodeRecorderProject({ version: 5, exportSettings: { frameRate: 60, resolution: '1080p' } }))
checkThrows('pm.legacyRejected', () =>
  decodeRecorderProject({ version: 2, screenRecordingRelativePath: 'screen.mp4' }))
checkThrows('pm.v7Rejected', () =>
  decodeRecorderProject({ version: 7, exportSettings: { frameRate: 60, resolution: '1080p' } }))

// 默认与编码
const fresh = decodeRecorderProject({ version: 27 })
check('pm.freshTitle', fresh.title, '未命名录制')
check('pm.freshVersion', fresh.version, 27)
const encProject = encodeRecorderProject(fresh)
check('pm.encVersion', encProject.version, 27)
check('pm.encMediaOmitted', 'media' in encProject, false)
checkThrows('pm.futureVersion', () => decodeRecorderProject({ version: 99 }))

// ---- 批次 2：MediaTimelinePlacement
const place = new MediaTimelinePlacement(ref, 10, 100)
check('mt.timelineStart', place.timelineStart, 2)
check('mt.sourceStart', place.sourceStart, 1)
check('mt.playable', place.playableDuration, 4.5)
check('mt.sourceEnd', place.sourceEnd, 10)
check('mt.timelineEnd', place.timelineEnd, 6.5)
check('mt.stMap', place.sourceTimeAt(4.5), 6)
check('mt.tsMap', place.timelineTimeFor(6), 4.5)
check('mt.stOutside', place.sourceTimeAt(6.6), null)
check('mt.tsOutside', place.timelineTimeFor(10.1), null)
check('mt.contains', place.contains(4.5), true)
check('mt.containsOut', place.contains(6.6), false)
// 不可用前导：请求源起点 0.5 但可用区间从 1 开始 → 时间线起点右移 0.5
const refLead = makeProjectMediaReference({ relativePath: 'x', startOffset: 2, sourceStartTime: 0.5 })
const placeLead = new MediaTimelinePlacement(refLead, 10, 100, 1)
check('mt.leadStart', placeLead.timelineStart, 2.5)
check('mt.leadSource', placeLead.sourceStart, 1)
// 时间线时长不足时截断
const placeShort = new MediaTimelinePlacement(ref, 10, 4)
check('mt.shortTimeline', placeShort.timelineStart, 2)
check('mt.shortPlayable', placeShort.playableDuration, 2)

// ---- 批次 2：MediaSyncAnchorCurve
const curve = new MediaSyncAnchorCurve([
  anchor(20, 6, 'c'), anchor(0, 0, 'a'), anchor(10, 2, 'b'),
])
check('curve.sorted', curve.anchors.map((a) => a.sourceTime).join(','), '0,10,20')
check('curve.before', curve.offsetAt(-1), 0)
check('curve.mid', curve.offsetAt(5), 1)
check('curve.mid2', curve.offsetAt(15), 4)
check('curve.after', curve.offsetAt(30), 6)
check('curve.atAnchor', curve.offsetAt(10), 2)
const ramp = new MediaSyncAnchorCurve([anchor(10, 2, 'a')])
check('curve.rampFromZero', ramp.offsetAt(3), 0.6)
check('curve.atFirst', ramp.offsetAt(10), 2)
check('curve.afterFirst', ramp.offsetAt(15), 2)
check('curve.empty', new MediaSyncAnchorCurve([]).offsetAt(5), 0)


// ================================================================ OverlayTimeline
{
  const {
    makeOverlayRect, clampedOverlayRect, makeOverlayTiming, overlayEndTime, overlayContains,
    decodeMosaicEffectStyle, makeMosaicClip, decodeMosaicClip, encodeMosaicClip,
    stickerAutomaticExit, makeStickerClip, decodeStickerClip, encodeStickerClip,
  } = m

  // ---- NormalizedOverlayRect.clamped
  const r = clampedOverlayRect({ x: -0.2, y: 0.9, width: NaN, height: 0.5 })
  check('or.x', r.x, 0)
  check('or.y', r.y, 0.5)
  check('or.w', r.width, 0.3)
  check('or.h', r.height, 0.5)
  const r2 = clampedOverlayRect({ x: 0.35, y: 0.39, width: 0.9, height: 0.3 })
  check('or.xClamp', r2.x, 0.1)
  check('or.wMin', clampedOverlayRect({ width: 0.001 }).width, 0.01)

  // ---- OverlayTiming
  const t = makeOverlayTiming(2)
  check('ot.endTime', overlayEndTime(t), 5)
  check('ot.containsIn', overlayContains(t, 4.9), true)
  check('ot.containsEnd', overlayContains(t, 5), false)

  // ---- MosaicEffectStyle 解码迁移（v9 像素块 → blur）
  check('mos.spotlight', decodeMosaicEffectStyle('spotlight'), 'spotlight')
  check('mos.pixelBlock', decodeMosaicEffectStyle('pixelBlock'), 'blur')
  check('mos.unknown', decodeMosaicEffectStyle('whatever'), 'blur')

  // ---- MosaicClip：transitionStyle 缺省推导 + 编码往返
  const mc = makeMosaicClip({ timing: makeOverlayTiming(1, 2) })
  check('mc.defaults', mc.transitionStyle, 'none')
  const mcSpot = decodeMosaicClip({ id: 'm1', timing: { startTime: 0, duration: 1 }, sourceRect: { x: 0, y: 0, width: 0.2, height: 0.2 }, cornerRadius: 0.1, style: 'spotlight', intensity: 0.7 })
  check('mc.spotTransition', mcSpot.transitionStyle, 'smooth')
  check('mc.spotDimming', mcSpot.spotlightDimming, 0.22)
  const mcRound = decodeMosaicClip(encodeMosaicClip(mcSpot))
  check('mc.round.style', mcRound.style, 'spotlight')
  check('mc.round.intensity', mcRound.intensity, 0.7)
  check('mc.round.transition', mcRound.transitionStyle, 'smooth')

  // ---- StickerAnimationPreset.automaticExit
  check('sa.slideLeft', stickerAutomaticExit('slideLeft'), 'slideRight')
  check('sa.slideTopLeft', stickerAutomaticExit('slideTopLeft'), 'slideBottomRight')
  check('sa.pop', stickerAutomaticExit('pop'), 'pop')
  check('sa.fade', stickerAutomaticExit('fade'), 'fade')

  // ---- StickerClip：默认值 + 编码往返（HexColor → hexString）
  const sc = makeStickerClip({ timing: makeOverlayTiming(0, 4), relativePath: 'stickers/a.png' })
  check('sc.width', sc.width, 0.38)
  check('sc.animation', sc.animation, 'pop')
  check('sc.exitAuto', sc.exitAnimation, null)
  check('sc.borderHex', sc.borderColor.hexString, '#FFFFFF')
  const enc = encodeStickerClip(sc)
  check('sc.encBorderColor', enc.borderColor, '#FFFFFF')
  check('sc.encNoExit', 'exitAnimation' in enc, false)
  const scRound = decodeStickerClip(enc)
  check('sc.round.border', scRound.borderColor.hexString, '#FFFFFF')
  check('sc.round.curve', scRound.animationCurve, 'swift')
  const sc2 = decodeStickerClip({ id: 's1', timing: { startTime: 0, duration: 2 }, relativePath: 'x', position: { x: 0.5, y: 0.5 }, width: 0.5, rotationDegrees: 12, opacity: 0.9, cornerRadius: 8, borderWidth: 2, borderColor: '#FF8800', shadowOpacity: 0.3, shadowRadius: 10, shadowOffsetX: 1, shadowOffsetY: 2, animation: 'slideLeft', enterDuration: 0.5, exitDuration: 0.3, backdropBlur: 12, layerIndex: 3 })
  check('sc2.border', sc2.borderColor.hexString, '#FF8800')
  check('sc2.exit', sc2.exitAnimation, null)
  check('sc2.layer', sc2.layerIndex, 3)
  const enc2 = encodeStickerClip({ ...sc2, exitAnimation: 'slideRight' })
  check('sc2.encExit', enc2.exitAnimation, 'slideRight')
}


// ================================================================ CameraMotion
{
  const {
    CameraMotionTrack, makeCameraMotionState, makeCameraMotionClip,
    decodeCameraLayoutMode, encodeCameraLayoutMode, cameraMotionClipsNeedRepair,
  } = m
  const { makeTransitionTiming } = m

  // ---- resolve：形状 → 连续值
  const trk = new CameraMotionTrack([])
  const base = makeCameraMotionState()
  const s0 = trk.sample(0, base, 1.6, 16 / 9)
  check('cm.basePos', s0.position.x, 0.86)
  check('cm.baseAspect', s0.aspectRatio, 1)
  check('cm.baseCorner', s0.cornerFraction, 0.25)
  const fs = makeCameraMotionState({ layout: { kind: 'fullscreen' } })
  const sfs = trk.sample(0, fs, 1.6, 16 / 9)
  check('cm.fsAspect', sfs.aspectRatio, 16 / 9)
  check('cm.fsProgress', sfs.fullscreenProgress, 1)
  const circ = makeCameraMotionState({ layout: { kind: 'shape', shape: '圆形' } })
  check('cm.circleCorner', trk.sample(0, circ, 1.6, 16 / 9).cornerFraction, 0.5)
  const orig = makeCameraMotionState({ layout: { kind: 'shape', shape: '原始比例' } })
  check('cm.origAspect', trk.sample(0, orig, 1.6, 16 / 9).aspectRatio, 1.6)

  // ---- 单片段：leadIn 进入过渡
  const target = makeCameraMotionState({ position: { x: 0.2, y: 0.2 }, size: 0.5 })
  const clip = makeCameraMotionClip({
    id: 'c1',
    timing: makeTransitionTiming({ startTime: 1, duration: 2, leadInDuration: 1 }),
    target,
  })
  const t1 = new CameraMotionTrack([clip])
  const before = t1.sample(0.5, base, 1.6, 16 / 9)
  check('cm.beforePos', before.position.x, 0.86)
  const mid = t1.sample(1.5, base, 1.6, 16 / 9)
  // 三次方缓动 @0.5 ≈ 0.5（对称贝塞尔）；位置从 0.86 → 0.2
  check('cm.midPosBetween', mid.position.x > 0.2 && mid.position.x < 0.86, true)
  const held = t1.sample(2.5, base, 1.6, 16 / 9)
  check('cm.holdPos', held.position.x, 0.2)
  // returnDuration=0 → 保持目标
  const late = t1.sample(9, base, 1.6, 16 / 9)
  check('cm.keepTarget', late.position.x, 0.2)

  // ---- returnDuration 回落：endTime 后 1s 回到 base
  const clipR = makeCameraMotionClip({
    id: 'c2',
    timing: makeTransitionTiming({ startTime: 1, duration: 2, leadInDuration: 1, returnDuration: 1 }),
    target,
  })
  const t2 = new CameraMotionTrack([clipR])
  const half = t2.sample(2.5, base, 1.6, 16 / 9)
  check('cm.fallHalfBetween', half.position.x > 0.2 && half.position.x < 0.86, true)
  check('cm.fallDone', t2.sample(4.5, base, 1.6, 16 / 9).position.x, 0.86)

  // ---- 相接链：前段目标保持到后段
  const clipB = makeCameraMotionClip({
    id: 'c3',
    timing: makeTransitionTiming({ startTime: 3, duration: 2, leadInDuration: 1 }),
    target: makeCameraMotionState({ position: { x: 0.4, y: 0.4 } }),
  })
  const t3 = new CameraMotionTrack([clip, clipB])
  // clip endTime=3，clipB startTime=3 相接 → 3 处应已处于 clipB 的进入过渡起点（=clip 目标）
  const atJunction = t3.sample(3.0, base, 1.6, 16 / 9)
  check('cm.chainNoFlash', atJunction.position.x < 0.86, true)

  // ---- 隐藏目标：原地淡出，位置不动
  const hide = makeCameraMotionClip({
    id: 'c4',
    timing: makeTransitionTiming({ startTime: 1, duration: 2, leadInDuration: 1 }),
    target: makeCameraMotionState({ opacity: 0, position: { x: 0.1, y: 0.1 } }),
  })
  const t4 = new CameraMotionTrack([hide])
  const fading = t4.sample(1.5, base, 1.6, 16 / 9)
  check('cm.hidePos', fading.position.x, 0.86)
  check('cm.hideOpacity<1', fading.opacity < 1, true)

  // ---- 乱序修复
  check('cm.repairNeeded', cameraMotionClipsNeedRepair([clipB, clip]), true)
  const t5 = new CameraMotionTrack([clipB, clip])
  check('cm.repaired', t5.clips[0].id, 'c1')

  // ---- 编解码
  check('cm.encShape', encodeCameraLayoutMode({ kind: 'shape', shape: '横向' }).shape, '横向')
  check('cm.encFs', encodeCameraLayoutMode({ kind: 'fullscreen' }).kind, 'fullscreen')
  check('cm.decFs', decodeCameraLayoutMode({ kind: 'fullscreen' }).kind, 'fullscreen')
  check('cm.decShape', decodeCameraLayoutMode({ kind: 'shape', shape: '纵向' }).shape, '纵向')
}

// ---- 批次 5（PointerTrack / ProjectPointerTrack）----
function runPointerTrackBatch() {
  const {
    PointerTrack, PointerInterpolator, smootherStep, isContinuousMovement,
    monotoneTangent, ProjectPointerTrack, interpolatedRawPosition,
    TimelineMap, firstEventIndexAtOrAfter,
    makeMotionStyle, makeCursorStyle, makeRecordingSegment, makeClip,
  } = m
  const mkEvent = (time, x, y, kind = 'move', cursorAssetID = null) => ({
    time,
    location: { x, y },
    kind,
    modifiers: [],
    cursorAssetID,
  })
  const motion = makeMotionStyle()
  const style = makeCursorStyle()

  // smootherStep（五次）
  check('pt.smooth0', smootherStep(0), 0)
  check('pt.smooth1', smootherStep(1), 1)
  check('pt.smoothHalf', smootherStep(0.5), 0.5)

  // 连续运动判定
  check(
    'pt.contTrue',
    isContinuousMovement(mkEvent(0, 0, 0), mkEvent(0.05, 0.1, 0.1)),
    true
  )
  check(
    'pt.contFalse',
    isContinuousMovement(mkEvent(0, 0, 0), mkEvent(0.6, 0.4, 0.4)),
    false
  )

  // monotoneTangent：单调递增斜坡 → 切向为正
  const mt = monotoneTangent(
    mkEvent(0, 0, 0),
    mkEvent(1, 1, 1),
    mkEvent(2, 4, 4)
  )
  check('pt.mtPositive', mt.x > 0 && mt.y > 0, true)

  // 基本评估：「无」光标风格 → Hermite 线性插值（密集事件=连续运动）
  const linear = new PointerTrack([mkEvent(0, 0, 0), mkEvent(0.1, 1, 1)])
  const linearMotion = makeMotionStyle({ cursor: '无' })
  check('pt.linearMid', linear.evaluation(0.05, linearMotion, style).position.x, 0.5)

  // 轨迹开始前不透露未来样本
  check('pt.beforeStart', linear.evaluation(-0.1, linearMotion, style).position, null)

  // 隐藏光标：position 仍在，cursor 为 null（位置与可见性解耦）
  const hiddenStyle = makeCursorStyle({ assetID: 'system.hidden' })
  const hiddenEval = linear.evaluation(0.05, linearMotion, hiddenStyle)
  check('pt.hiddenPos', hiddenEval.position.x, 0.5)
  check('pt.hiddenCursor', hiddenEval.cursor, null)

  // 点击相位
  const withClick = new PointerTrack([
    mkEvent(0, 0.2, 0.2),
    mkEvent(0.5, 0.3, 0.3, 'leftClick'),
    mkEvent(1, 0.4, 0.4),
  ])
  const clickEval = withClick.evaluation(0.6, linearMotion, style)
  check('pt.clicking', clickEval.cursor.isClicking, true)
  check('pt.clickPhaseKind', clickEval.cursor.clickPhase.kind, 'leftClick')
  check('pt.clickPhaseProgress<1', clickEval.cursor.clickPhase.progress < 1, true)

  // 静止时不倾斜
  const staticEval = withClick.evaluation(0.05, linearMotion, style)
  check('pt.staticRotation', staticEval.cursor.rotationRadians, 0)

  // 弹簧路径（平滑）：密集事件=连续运动目标，弹簧在两点之间推进
  const springTrack = new PointerTrack([mkEvent(0, 0, 0), mkEvent(0.2, 1, 1)])
  const s0 = springTrack.evaluation(0.5, motion, style).position
  check('pt.springMid', s0.x > 0 && s0.x < 1, true)
  const s1 = springTrack.evaluation(2, motion, style).position
  check('pt.springReach', s1.x > 0.99 && s1.x <= 1.001, true)

  // 预热弹簧缓存
  const prewarmed = new PointerTrack([mkEvent(0, 0, 0), mkEvent(1, 1, 1)])
  check('pt.cacheBefore', prewarmed.cachedSpringVariantCount, 0)
  prewarmed.prewarmCursorSpring(motion)
  check('pt.cacheAfter', prewarmed.cachedSpringVariantCount, 1)

  // 乱序输入被规范化
  const unordered = new PointerTrack([mkEvent(1, 1, 1), mkEvent(0, 0, 0)])
  check('pt.normalized', unordered.events[0].time, 0)

  // PointerInterpolator 门面
  check(
    'pt.interp',
    PointerInterpolator.sample([mkEvent(0, 0.1, 0.1)], 0, linearMotion, style).location.x,
    0.1
  )

  // eventsBetween 二分切片：窗口 [0.4,0.9] 只含 0.5 处的点击
  check('pt.sliceLen', withClick.eventsBetween(0.4, 0.9).length, 1)
  check('pt.sliceInvalid', withClick.eventsBetween(2, 1).length, 0)

  // interpolatedRawPosition
  check('pt.rawMid', interpolatedRawPosition(0.5, [mkEvent(0, 0, 0.2), mkEvent(1, 1, 0.4)]).x, 0.5)
  check('pt.rawClamp', interpolatedRawPosition(5, [mkEvent(0, 0, 0), mkEvent(1, 1, 1)]).x, 1)

  // ---- ProjectPointerTrack ----
  const timelineMap = new TimelineMap({ kind: 'fullRecording' }, 10)
  // 密集事件（间隔 ≤0.12s = 连续运动），使插值在中点有效
  const sourceEvents = [
    mkEvent(0, 0, 0),
    mkEvent(0.05, 0.5, 0.5),
    mkEvent(0.1, 1, 1, 'leftClick'),
  ]
  const ppt = new ProjectPointerTrack(timelineMap, sourceEvents)
  check('ppt.segments', ppt.segments.length, 1)
  check('ppt.noDiscontinuity', ppt.segments[0].startsAfterSourceDiscontinuity, false)
  check('ppt.firstClick', ppt.segments[0].firstClickTime, 0.1)

  // 输出时钟评估（全片 1:1 映射；「无」风格线性 Hermite）
  check('ppt.evalStart', ppt.evaluation(0, linearMotion, style).position.x, 0)
  check('ppt.evalMid', ppt.evaluation(0.05, linearMotion, style).position.x, 0.5)

  // sample = evaluation().cursor
  check('ppt.sampleAlias', ppt.sample(0, linearMotion, style).location.x, 0)

  // 剪辑桥接：两段保留片段之间源不连续 → 光标五次缓动跨过剪辑
  const segA = makeRecordingSegment({ id: 'a', sourceStart: 0, sourceDuration: 1, playbackRate: 1 })
  const segB = makeRecordingSegment({ id: 'b', sourceStart: 5, sourceDuration: 1, playbackRate: 1 })
  const cutMap = new TimelineMap({ kind: 'edited', segments: [segA, segB] }, 10)
  const cutEvents = [
    mkEvent(0, 0, 0),
    mkEvent(0.9, 0.1, 0.1),
    mkEvent(5, 0.8, 0.8),
    mkEvent(5.9, 0.9, 0.9),
  ]
  const cutTrack = new ProjectPointerTrack(cutMap, cutEvents)
  check('ppt.cutSegments', cutTrack.segments.length, 2)
  check('ppt.cutDiscontinuity', cutTrack.segments[1].startsAfterSourceDiscontinuity, true)
  // 剪辑点 output=1.0 处：桥接中点位置应介于两端之间（用「无」风格避免弹簧滞后）
  const bridged = cutTrack.evaluation(1.14, linearMotion, style).position
  check('ppt.bridgeMid', bridged.x > 0.1 && bridged.x < 0.9, true)
  // 桥接结束之后回到保留片段自己的位置（output 1.95 ↔ 源 5.9）
  check('ppt.bridgeDone', cutTrack.evaluation(1.95, linearMotion, style).position.x, 0.9)

  // mapPointerEventSegments：片段起点无精确事件 → 注入位置种子
  const midMap = new TimelineMap(
    { kind: 'edited', segments: [makeRecordingSegment({ id: 'm', sourceStart: 0.6, sourceDuration: 0.2, playbackRate: 1 })] },
    10
  )
  const mapped = midMap.mapPointerEventSegments([
    mkEvent(0.5, 0.25, 0.25),
    mkEvent(0.7, 0.75, 0.75),
  ])
  check('ppt.mapSeedKind', mapped[0].events[0].kind, 'move')
  check('ppt.mapSeedTime', mapped[0].events[0].time, 0)
  check('ppt.mapSeedX', mapped[0].events[0].location.x, 0.25)
  check('ppt.mapMappedTime', Math.round(mapped[0].events[1].time * 100) / 100, 0.1)

  // firstEventIndexAtOrAfter
  check('ppt.binSearch', firstEventIndexAtOrAfter(0.06, sourceEvents), 2)
  check('ppt.binSearchEnd', firstEventIndexAtOrAfter(99, sourceEvents), 3)

  // automaticEntryStartsAfterCut：manual 片段恒 false
  const manualClip = makeClip({ startTime: 0, endTime: 1, origin: 'manual' })
  check('ppt.manualNoCut', cutTrack.automaticEntryStartsAfterCut(manualClip), false)
}

runPointerTrackBatch()

// ---- 批次 6（CompositionScene）----
function runCompositionSceneBatch() {
  const {
    canonicalStyleScale, decorationInsetsAtScaleOne, compositionSceneEvaluate,
    evaluateCameraStatic, evaluateCamera, SCREEN_DECORATION_ZERO,
    makeRecorderProject, makeCanvasStyle, makeCameraStyle, makeMotionStyle, projectedQuad,
  } = m

  // canonicalStyleScale：1080 短边基准
  check('cs.scale1080', canonicalStyleScale(1080, 1920), 1)
  check('cs.scale540', canonicalStyleScale(540, 960), 0.5)

  // decorationInsetsAtScaleOne
  check(
    'cs.insetsNone',
    decorationInsetsAtScaleOne('none', 1, 1, 800, 600, 1),
    SCREEN_DECORATION_ZERO
  )
  // 窗口：46px 工具栏 @scale1，受 25% 高度上限约束
  const winTop = decorationInsetsAtScaleOne('windowLight', 1, 1, 800, 600, 1).top
  check('cs.insetsWindow', winTop, 46)
  // 手机边框：短边 500 → 500*0.026 = 13
  const phone = decorationInsetsAtScaleOne('devicePhone', 1, 1, 500, 900, 1)
  check('cs.insetsPhone', phone.top, 13)
  check('cs.insetsPhoneSym', phone.left, 13)
  // frameScale 钳制：0.6*46=27.6 上限 25% (150) 之内
  const winScaled = decorationInsetsAtScaleOne('windowDark', 0.6, 1, 800, 600, 1).top
  check('cs.insetsWindowScaled', winScaled, 27.6)

  // evaluateCameraStatic：方形摄像头 @ 1080x1920
  const cam = evaluateCameraStatic(makeCameraStyle(), 1, 1, 1080, 1920, 1)
  // base=1080，height = max(1080*0.29, 72) = 313.2，方形 aspect 1
  check('cs.camHeight', cam.rect.height, 313.2, 1e-6)
  check('cs.camWidth', cam.rect.width, 313.2, 1e-6)
  check('cs.camBorder', cam.borderWidth, 3, 1e-6)
  check('cs.camOpacity', cam.opacity, 1)
  check('cs.camFullscreen', cam.fullscreenProgress, 0)

  // evaluateCamera：全屏过渡 → 铺满画布、边框消失
  const fsSample = {
    position: { x: 0.5, y: 0.5 },
    size: 0.29,
    aspectRatio: 1,
    cornerFraction: 0.5,
    fullscreenProgress: 1,
    opacity: 1,
  }
  const fs = evaluateCamera(makeCameraStyle(), fsSample, 1, 1080, 1920, 1)
  check('cs.fsX', fs.rect.x, 0)
  check('cs.fsY', fs.rect.y, 0)
  check('cs.fsW', fs.rect.width, 1080)
  check('cs.fsH', fs.rect.height, 1920)
  check('cs.fsBorder', fs.borderWidth, 0)

  // compositionSceneEvaluate：默认工程 1080x1080、16:9 源
  const project = makeRecorderProject({
    canvas: makeCanvasStyle({ padding: 100 }),
    camera: makeCameraStyle(),
    motion: makeMotionStyle(),
  })
  const scene = compositionSceneEvaluate({
    project,
    time: 0,
    canvasWidth: 1080,
    canvasHeight: 1080,
    sourceAspectRatio: 16 / 9,
  })
  // padding 100 → available 880 → fitted 880x495 居中
  check('cs.fittedW', scene.screen.fittedRect.width, 880, 1e-6)
  check('cs.fittedH', scene.screen.fittedRect.height, 495, 1e-6)
  check('cs.fittedX', scene.screen.fittedRect.x, 100, 1e-6)
  check('cs.fittedY', scene.screen.fittedRect.y, 292.5, 1e-6)
  // scale 1、居中 → baseRect = fittedRect
  check('cs.baseW', scene.screen.baseRect.width, 880, 1e-6)
  check('cs.baseX', scene.screen.baseRect.x, 100, 1e-6)
  check('cs.manualScale', scene.screen.manualScale, 1)
  // 无缩放 → viewport scale 1，finalRect = baseRect
  check('cs.vpScale', scene.screen.viewport.scale, 1)
  check('cs.finalX', scene.screen.finalRect.x, 100, 1e-6)
  // 未指定 cameraAspectRatio → camera null
  check('cs.noCamera', scene.camera, null)
  // 指定 cameraAspectRatio → camera 有值且位置合理
  const sceneCam = compositionSceneEvaluate({
    project,
    time: 0,
    canvasWidth: 1080,
    canvasHeight: 1080,
    sourceAspectRatio: 16 / 9,
    cameraAspectRatio: 4 / 3,
  })
  check('cs.hasCamera', sceneCam.camera !== null, true)
  check('cs.camOpacityScene', sceneCam.camera.opacity, 1)

  // keepsCanvasCovered：padding=0 且全画布覆盖 → finalCornerRadius 归零
  const fullProject = makeRecorderProject({
    canvas: makeCanvasStyle({ padding: 0, cornerRadius: 24, borderWidth: 0 }),
    camera: makeCameraStyle(),
    motion: makeMotionStyle(),
  })
  const fullScene = compositionSceneEvaluate({
    project: fullProject,
    time: 0,
    canvasWidth: 1920,
    canvasHeight: 1080,
    sourceAspectRatio: 16 / 9,
  })
  check('cs.coverRadius', fullScene.screen.finalCornerRadius, 0)
  check('cs.coverScale', fullScene.screen.viewport.scale, 1)

  // projectedQuad：无旋转时四角 = finalRect 四角
  const quad = projectedQuad(scene.screen)
  check('cs.quadTL', Math.round(quad.topLeft.x * 100) / 100, 100)
  check('cs.quadTR', Math.round(quad.topRight.x * 100) / 100, 980)
}

runCompositionSceneBatch()

function runFrameSceneBatch() {
  const {
    cameraContentFillLayout, cameraContentFillDestinationPoint, cameraContentFillMirrorAxisX,
    CAMERA_CONTENT_FILL_EDGE_OVERSCAN_SCALE,
    cursorRenderLayout, cursorClickGeometry, makeCursorAssetMetrics,
    CURSOR_CANONICAL_HEIGHT, CURSOR_CANONICAL_SHORT_EDGE,
    makeFocusEffect, focusEffectScene, focusEffectIsValid, normalizedAngle,
    focusEffectClearHalfWidth, focusEffectFeatherWidth,
    StickerTransitionTrack, FrameStickerBackdropScene,
    TimelineMediaPlan, ProjectTimelineMediaPlan, inferredSourceTimeScale, isSameBoundary,
    FrameSceneEvaluator, openingSample, openingRect, stickerAnimationTransform, smootherStep,
    overlayEffectProgress, screenDecoration, screenChromeKindFor, makeFrameMosaicScene,
    frameCursorScene, stickerScenes, FRAME_COLOR_SDR_DESKTOP, compositionSizeShortEdge,
    HexColor, makeZoomTrack,
    makeCanvasStyle, makeCameraStyle, makeRecorderProject, makeOpeningSequence,
    makeProjectTimeline, makeMosaicClip, makeStickerClip, makeOverlayTiming,
    makeMotionStyle, makeCursorStyle, TimelineMap, makeTransitionTiming,
  } = m

  // ---- CameraContentFill（Swift L12-67）
  const fill = cameraContentFillLayout(100, 100, { x: 0, y: 0, width: 200, height: 100 })
  check('ccf.overscan', CAMERA_CONTENT_FILL_EDGE_OVERSCAN_SCALE, 1.01)
  check('ccf.scale', fill.scale, 2 * 1.01)
  check('ccf.destW', fill.destination.width, 200 * 1.01)
  check('ccf.visibleW', Math.round(fill.visibleSource.width * 1000) / 1000, 99.01)
  check('ccf.visibleH', Math.round(fill.visibleSource.height * 1000) / 1000, 49.505)
  check('ccf.mirrorAxis', cameraContentFillMirrorAxisX(fill), 100)
  const mirrored = cameraContentFillDestinationPoint(fill, { x: 50, y: 50 }, false)
  check('ccf.pointX', Math.round(mirrored.x * 100) / 100, 100)
  check('ccf.badTarget', cameraContentFillLayout(100, 100, { x: 0, y: 0, width: 0, height: 10 }), null)
  check('ccf.zoomClamp', Math.round(cameraContentFillLayout(100, 100, { x: 0, y: 0, width: 100, height: 100 }, { x: 0.5, y: 0.5 }, 9).scale * 1000) / 1000, 4.04)

  // ---- CursorRenderGeometry（Swift L145-357）
  const metrics = makeCursorAssetMetrics({
    hotspot: { x: 0, y: 0 },
    intrinsicSize: { width: 32, height: 32 },
    clickColor: HexColor.white,
  })
  const layout = cursorRenderLayout({ x: 500, y: 400 }, 1080, 1, metrics)
  check('cur.canonical', CURSOR_CANONICAL_HEIGHT, 44)
  check('cur.shortEdge', CURSOR_CANONICAL_SHORT_EDGE, 1080)
  check('cur.height', layout.size.height, 44)
  check('cur.originX', layout.origin.x, 500)
  check('cur.clickD', layout.clickDiameter, 44 * 1.45)
  check('cur.lineWidth', layout.clickLineWidth, 44 * 0.08)
  check('cur.refHeight', layout.clickEffectHeight, 44)
  const centered = cursorRenderLayout(
    { x: 500, y: 400 },
    1080,
    1,
    makeCursorAssetMetrics({
      hotspot: { x: 0.5, y: 0.5 },
      intrinsicSize: { width: 32, height: 32 },
      clickColor: HexColor.white,
    })
  )
  check('cur.hotspotX', centered.origin.x, 478)
  check('cur.hotspotY', centered.origin.y, 378)
  check('cur.4k', cursorRenderLayout({ x: 0, y: 0 }, 2160, 1, metrics).size.height, 88)
  check('cur.badEdge', cursorRenderLayout({ x: 0, y: 0 }, 0, 1, metrics), null)

  const ripple0 = cursorClickGeometry('ripple', 0, 44)
  check('cur.rippleD', ripple0.primaryDiameter, 44 * 0.45)
  check('cur.rippleFoot', ripple0.maxFootprintDiameter, 44 * 2.2)
  check('cur.rippleDot', ripple0.secondaryIsFilled, true)
  const ripple1 = cursorClickGeometry('ripple', 0.5, 44)
  check('cur.rippleDotGone', ripple1.secondaryDiameter, 0)
  check('cur.glowFilled', cursorClickGeometry('glow', 0.5, 44).primaryIsFilled, true)
  check('cur.pulseInner', cursorClickGeometry('pulse', 0.275, 44).secondaryDiameter > 44 * 0.25, true)
  check('cur.burstAccent', cursorClickGeometry('burst', 0, 44).accentOffset, 44 * 0.28)
  check('cur.noneFx', cursorClickGeometry('none', 0.5, 44), null)
  check('cur.badHeight', cursorClickGeometry('ripple', 0.5, 0), null)
  check('cur.scaleClamp', cursorClickGeometry('ripple', 0, 44, 1, 9).maxFootprintDiameter, 44 * 3 * 2.2)

  // ---- FocusEffect（Swift L31-117）
  check('fe.angleNeg', normalizedAngle(-10), 350)
  check('fe.angleWrap', normalizedAngle(370), 10)
  check('fe.valid', focusEffectIsValid(makeFocusEffect()), true)
  check('fe.invalidSize', focusEffectIsValid({ ...makeFocusEffect(), size: 0.05 }), false)
  check('fe.invalidAngle', focusEffectIsValid({ ...makeFocusEffect(), angleDegrees: 400 }), false)
  check('fe.half', focusEffectClearHalfWidth(makeFocusEffect(), 1000), 225)
  check('fe.feather', focusEffectFeatherWidth(makeFocusEffect(), 1000), 200)
  const linearEffect = makeFocusEffect({ linear: true })
  check('fe.linearDimming', linearEffect.dimming, 0)
  check('fe.linearSize', linearEffect.size, 0.32)
  check('fe.noTracks', focusEffectScene({
    zoom: null, screen: null, zoomFocus: { x: 0.5, y: 0.5 },
    crop: { x: 0, y: 0, width: 1, height: 1 }, pointer: null,
    time: 1, motion: makeMotionStyle(),
  }), null)

  const focusClip = {
    id: 'fe-1',
    timing: makeTransitionTiming({ startTime: 0, duration: 2 }),
    target: { position: { x: 0.5, y: 0.5 }, scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, perspective: 0 },
    focusEffect: makeFocusEffect({ blur: 0.6, dimming: 0.2 }),
  }
  const focusMid = focusEffectScene({
    zoom: null, screen: focusClip, zoomFocus: { x: 0.5, y: 0.5 },
    crop: { x: 0, y: 0, width: 1, height: 1 }, pointer: null,
    time: 0.5, motion: makeMotionStyle(),
  })
  check('fe.anchorX', focusMid.center.x, 0.5)
  check('fe.enterPartial', focusMid.progress > 0 && focusMid.progress < 1, true)
  const focusAfter = focusEffectScene({
    zoom: null, screen: focusClip, zoomFocus: { x: 0.5, y: 0.5 },
    crop: { x: 0, y: 0, width: 1, height: 1 }, pointer: null,
    time: 3, motion: makeMotionStyle(),
  })
  check('fe.holds', focusAfter.progress, 1)
  // shape 为 nil 的 3D 聚焦按线性/固定目标解释（Swift L67-72），target 被覆盖
  const implicitLinear = focusEffectScene({
    zoom: null,
    screen: { ...focusClip, focusEffect: makeFocusEffect({ blur: 0.6, target: 'pointer' }) },
    zoomFocus: { x: 0.5, y: 0.5 },
    crop: { x: 0, y: 0, width: 1, height: 1 },
    pointer: { x: 0.2, y: 0.8 },
    time: 1, motion: makeMotionStyle(),
  })
  check('fe.implicitFixed', implicitLinear.center.y, 0.5)
  // 显式给出 shape 时指针目标生效
  const pointerFocus = focusEffectScene({
    zoom: null,
    screen: {
      ...focusClip,
      focusEffect: makeFocusEffect({ shape: 'radial', blur: 0.6, target: 'pointer' }),
    },
    zoomFocus: { x: 0.5, y: 0.5 },
    crop: { x: 0, y: 0, width: 1, height: 1 },
    pointer: { x: 0.2, y: 0.8 },
    time: 1, motion: makeMotionStyle(),
  })
  check('fe.pointerTarget', pointerFocus.center.y, 0.8)

  // ---- StickerTransition（Swift L6-265）
  const stickerA = makeStickerClip({
    id: 'a', timing: makeOverlayTiming(0, 2), animation: 'pop', layerIndex: 0, hidesScreen: true,
  })
  const stickerB = makeStickerClip({
    id: 'b', timing: makeOverlayTiming(2, 2), animation: 'pop', layerIndex: 1,
  })
  const stickerTrack = new StickerTransitionTrack([stickerA, stickerB])
  const stickerAt05 = stickerTrack.sample(0.5)
  check('st.visible', stickerAt05.stickers.length, 1)
  // hasJoinedEntry 只看「入场侧已接入」的贴图（Swift L214-216）
  check('st.joinedIncoming', stickerTrack.hasJoinedEntry('b'), true)
  check('st.joinedOutgoing', stickerTrack.hasJoinedEntry('a'), false)
  check('st.backdropSuppress', stickerAt05.backdrop.screenSuppression > 0, true)
  check('st.emptyAfter', stickerTrack.sample(5).stickers.length, 0)
  check('st.suppressEntry', stickerTrack.sample(0.05, true).stickers[0].visibility >= 0, true)
  const backdropFromClip = FrameStickerBackdropScene.fromClip(stickerA, 0.5)
  check('st.backdropBlurSuppressed', backdropFromClip.screenBlur, 0)
  const merged = backdropFromClip.interpolated(new FrameStickerBackdropScene(), 0.5)
  check('st.interpolate', merged.screenSuppression, 0.25)

  // ---- TimelineMediaPlan（Swift L5-231）
  const map10 = new TimelineMap({ kind: 'fullRecording' }, 10)
  const primaryPlan = TimelineMediaPlan.fromPrimary(map10)
  check('tmp.slices', primaryPlan.slices.length, 1)
  check('tmp.contains', primaryPlan.contains(5), true)
  check('tmp.notContainsEnd', primaryPlan.contains(10), false)
  check('tmp.sourceAt', primaryPlan.sourceTimeAt(2), 2)
  check('tmp.playable', primaryPlan.playableDuration, 10)
  check('tmp.boundary', isSameBoundary(1, 1 + 1e-12), true)
  const projPlan = ProjectTimelineMediaPlan.build({ kind: 'fullRecording' }, null, { start: 0, end: 10 })
  check('tmp.projDuration', projPlan.outputDuration, 10)
  check('tmp.projNoCamera', projPlan.camera, null)
  check('tmp.projPointer', projPlan.pointer.segments.length, 1)
  check('tmp.inferredScale', inferredSourceTimeScale({
    relativePath: 'cam', startOffset: 0, sourceStartTime: 0,
    sourceTimeScale: null, sourceEndTime: null, syncAnchors: [],
  }, { start: 0, end: 10 }, 10), 1)

  // ---- FrameScene 基础场景（Swift L541-833）
  const motion = makeMotionStyle()
  const baseCanvas = makeCanvasStyle({ screenFrame: 'none' })
  const baseProject = makeRecorderProject({
    canvas: baseCanvas,
    camera: makeCameraStyle({ isHidden: true }),
    motion,
    cursorStyle: makeCursorStyle(),
    openingSequence: makeOpeningSequence(),
    timeline: makeProjectTimeline(),
  })
  const scene = FrameSceneEvaluator.scene({
    project: baseProject,
    time: 0,
    outputDuration: 10,
    canvasSize: { width: 1920, height: 1080 },
    sourceAspectRatio: 16 / 9,
  })
  check('fs.time', scene.time, 0)
  check('fs.order', scene.layerOrder.join(','), 'background,screen')
  check('fs.noCamera', scene.camera, null)
  check('fs.noCursor', scene.cursor, null)
  check('fs.colorSpace', scene.color.outputSpace, 'sRGB')
  check('fs.shortEdge', compositionSizeShortEdge(scene.canvasSize), 1080)
  check('fs.fitsCanvas', scene.screen.finalRect.width <= 1920, true)
  check('fs.opacity', scene.screen.opacity, 1)
  check('fs.blurZero', scene.background.blurRadius, 0)
  check('fs.projection', typeof scene.screen.projectedQuad.topLeft.x, 'number')
  check('fs.noDecoration', scene.screen.decoration.type, 'none')
  check('fs.noMosaic', scene.screen.mosaics.length, 0)

  // 时间被夹取到 [0, outputDuration]
  const latePlan = FrameSceneEvaluator.renderPlan({
    project: baseProject,
    presentationTime: -5,
    outputDuration: 10,
    frameRate: 0,
    canvasSize: { width: 1920, height: 1080 },
    sourceAspectRatio: 16 / 9,
  })
  check('fs.planClampTime', latePlan.presentationTime, 0)
  check('fs.planRate', latePlan.frameRate, 1)
  check('fs.planDuration', latePlan.outputDuration, 10)

  // ---- 打码 + spotlight 层
  const mosaicProject = makeRecorderProject({
    canvas: baseCanvas,
    camera: makeCameraStyle({ isHidden: true }),
    motion,
    cursorStyle: makeCursorStyle(),
    openingSequence: makeOpeningSequence(),
    timeline: makeProjectTimeline({
      mosaicClips: [makeMosaicClip({ timing: makeOverlayTiming(0, 5), style: 'spotlight' })],
    }),
  })
  const mosaicScene = FrameSceneEvaluator.scene({
    project: mosaicProject,
    time: 1,
    outputDuration: 10,
    canvasSize: { width: 1920, height: 1080 },
    sourceAspectRatio: 16 / 9,
  })
  check('fs.mosaicCount', mosaicScene.screen.mosaics.length, 1)
  check('fs.spotlightLayer', mosaicScene.layerOrder.includes('spotlight'), true)
  check('fs.mosaicIdle', mosaicScene.screen.mosaics[0].intensity, 0.55)
  const mosaicOut = FrameSceneEvaluator.scene({
    project: mosaicProject,
    time: 8,
    outputDuration: 10,
    canvasSize: { width: 1920, height: 1080 },
    sourceAspectRatio: 16 / 9,
  })
  check('fs.mosaicExpired', mosaicOut.screen.mosaics.length, 0)

  // ---- 贴图层
  const stickerProject = makeRecorderProject({
    canvas: baseCanvas,
    camera: makeCameraStyle({ isHidden: true }),
    motion,
    cursorStyle: makeCursorStyle(),
    openingSequence: makeOpeningSequence(),
    timeline: makeProjectTimeline({
      stickerClips: [makeStickerClip({ timing: makeOverlayTiming(0, 5), animation: 'fade' })],
    }),
  })
  const stickerScene = FrameSceneEvaluator.scene({
    project: stickerProject,
    time: 2,
    outputDuration: 10,
    canvasSize: { width: 1920, height: 1080 },
    sourceAspectRatio: 16 / 9,
  })
  check('fs.stickerCount', stickerScene.stickers.length, 1)
  check('fs.stickerLayer', stickerScene.layerOrder.includes('stickers'), true)
  check('fs.stickerWidthClamp', stickerScene.stickers[0].width <= 2, true)
  check('fs.stickerBackdrop', stickerScene.stickerBackdrop.screenSuppression, 0)

  // ---- 开场序列（Swift L954-1078）
  check('fs.openingIdentity', openingSample('屏幕', makeOpeningSequence(), ['屏幕'], 0.5, 1920, 1080).opacity, 1)
  const openingProject = makeRecorderProject({
    canvas: baseCanvas,
    camera: makeCameraStyle({ isHidden: true }),
    motion,
    cursorStyle: makeCursorStyle(),
    openingSequence: makeOpeningSequence({ isEnabled: true, duration: 2, preset: '聚拢', stagger: 0.16 }),
    timeline: makeProjectTimeline(),
  })
  const openingSceneStart = FrameSceneEvaluator.scene({
    project: openingProject,
    time: 0,
    outputDuration: 10,
    canvasSize: { width: 1920, height: 1080 },
    sourceAspectRatio: 16 / 9,
  })
  check('fs.openingFadeIn', openingSceneStart.screen.opacity < 0.05, true)
  const openingSceneDone = FrameSceneEvaluator.scene({
    project: openingProject,
    time: 5,
    outputDuration: 10,
    canvasSize: { width: 1920, height: 1080 },
    sourceAspectRatio: 16 / 9,
  })
  check('fs.openingSettled', openingSceneDone.screen.opacity, 1)
  const shrink = openingRect(
    { x: 100, y: 100, width: 200, height: 100 },
    { opacity: 1, scale: 0.5, offset: { x: 10, y: 0 }, rotationX: 0, rotationY: 0, perspective: 0, remaining: 1 }
  )
  check('fs.openingRectW', shrink.width, 100)
  check('fs.openingRectCX', shrink.x + shrink.width / 2, 210)

  // ---- 贴图动画路径（Swift L882-932）
  check('fs.smootherStep', smootherStep(0.5), 0.5)
  check('fs.smootherLow', smootherStep(-1), 0)
  check('fs.smootherHigh', smootherStep(2), 1)
  check('fs.slideLeft', stickerAnimationTransform('slideLeft', 0, { x: 0.5, y: 0.5 }, 0.4).offset.x, -1.35)
  check('fs.slideLeftEnd', stickerAnimationTransform('slideLeft', 1, { x: 0.5, y: 0.5 }, 0.4).offset.x, 0)
  check('fs.popStart', stickerAnimationTransform('pop', 0, { x: 0.5, y: 0.5 }, 0.4).scale, 0.72)
  check('fs.popEnd', stickerAnimationTransform('pop', 1, { x: 0.5, y: 0.5 }, 0.4).scale, 1)
  check('fs.fadeStill', stickerAnimationTransform('fade', 0, { x: 0.5, y: 0.5 }, 0.4).scale, 1)
  check('fs.wideTravel', Math.round(stickerAnimationTransform('slideLeft', 0, { x: 0.5, y: 0.5 }, 3).offset.x * 100) / 100, -2.06)

  // ---- 打码过渡进度（Swift L1089-1119）
  check('fs.overlayLinear', overlayEffectProgress({ startTime: 0, duration: 2 }, 'linear', 0.3, 0.3, 0.15), 0.5)
  check('fs.overlaySmooth', overlayEffectProgress({ startTime: 0, duration: 2 }, 'smooth', 0.3, 0.3, 0.15), 0.5)
  check('fs.overlayNone', overlayEffectProgress({ startTime: 0, duration: 2 }, 'none', 0.3, 0.3, 0.15), 1)
  check('fs.overlayZero', overlayEffectProgress({ startTime: 0, duration: 0 }, 'smooth', 0.3, 0.3, 0.1), 0)

  // ---- 屏幕框装饰（Swift L1121-1230）
  const geometry = {
    fittedRect: { x: 100, y: 100, width: 1720, height: 880 },
    baseRect: { x: 100, y: 100, width: 1720, height: 880 },
    finalRect: { x: 100, y: 100, width: 1720, height: 880 },
    manualScale: 1,
    manualOffset: { x: 0, y: 0 },
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    perspective: 0,
    projectionAnchor: { x: 0.5, y: 0.5 },
    baseCornerRadius: 24,
    baseBorderWidth: 0,
    finalCornerRadius: 24,
    finalBorderWidth: 0,
    zoom: { scale: 1, focus: { x: 0.5, y: 0.5 }, framingProgress: 0, targetScale: 1 },
    viewport: { scale: 1 },
  }
  const decoNone = screenDecoration({
    style: 'none', frameScale: 1, toolbarScale: 1,
    outerCornerRadius: null, contentCornerRadius: null, title: '', browserAddress: '',
    geometry, styleScale: 1,
  })
  check('fs.decoNone', decoNone.type, 'none')
  const decoWindow = screenDecoration({
    style: 'windowLight', frameScale: 1, toolbarScale: 0.9,
    outerCornerRadius: null, contentCornerRadius: null, title: 'DogSC', browserAddress: '',
    geometry, styleScale: 1,
  })
  check('fs.decoChrome', decoWindow.type, 'chrome')
  check('fs.decoKind', decoWindow.chrome.kind, 'window')
  check('fs.decoToolbarH', decoWindow.chrome.toolbarRect.height > 0, true)
  check('fs.decoOuterW', decoWindow.chrome.outerRect.width, 1720)
  check('fs.decoTitle', decoWindow.chrome.title, 'DogSC')
  check('fs.decoRadiusClamp', decoWindow.chrome.outerCornerRadius <= 160, true)
  check('fs.kindPhoneWide', screenChromeKindFor('devicePhone', { x: 0, y: 0, width: 900, height: 500 }), 'devicePhoneLandscape')
  check('fs.kindPhoneTall', screenChromeKindFor('devicePhone', { x: 0, y: 0, width: 500, height: 900 }), 'devicePhonePortrait')
  check('fs.kindBrowser', screenChromeKindFor('browserDark', { x: 0, y: 0, width: 500, height: 900 }), 'browser')

  // ---- 光标场景（Swift L1232-1282）
  const cursorMetrics = makeCursorAssetMetrics({
    hotspot: { x: 0, y: 0 },
    intrinsicSize: { width: 32, height: 32 },
    clickColor: HexColor.white,
  })
  const cursorScene = frameCursorScene({
    sample: {
      location: { x: 0.5, y: 0.5 },
      isClicking: false,
      clickPhase: null,
      rotationRadians: 0,
      recordedCursorAssetID: null,
    },
    project: baseProject,
    metrics: cursorMetrics,
    metricsByAssetID: {},
    screen: scene.screen,
    canvasSize: { width: 1920, height: 1080 },
  })
  check('fs.cursorAsset', cursorScene.assetID, 'system.arrow')
  check('fs.cursorAttach', cursorScene.attachment, 'screen')
  check('fs.cursorLocalX', cursorScene.normalizedScreenPosition.x, 0.5)
  check('fs.cursorShadow', cursorScene.shadow !== null, true)
  check('fs.cursorNoMetrics', frameCursorScene({
    sample: {
      location: { x: 0.5, y: 0.5 }, isClicking: false, clickPhase: null,
      rotationRadians: 0, recordedCursorAssetID: null,
    },
    project: baseProject,
    metrics: null,
    metricsByAssetID: {},
    screen: scene.screen,
    canvasSize: { width: 1920, height: 1080 },
  }), null)
  check('fs.cursorOutside', frameCursorScene({
    sample: {
      location: { x: 1.5, y: 0.5 }, isClicking: false, clickPhase: null,
      rotationRadians: 0, recordedCursorAssetID: null,
    },
    project: baseProject,
    metrics: cursorMetrics,
    metricsByAssetID: {},
    screen: scene.screen,
    canvasSize: { width: 1920, height: 1080 },
  }), null)

  // ---- refreshingCursor（Swift L449-487）：只刷新光标，保留视频帧相位
  const zoomTrack = makeZoomTrack(baseProject.timeline.zoomClips, 10)
  const refreshed = FrameSceneEvaluator.refreshingCursor({
    plan: latePlan,
    presentationTime: 1,
    project: baseProject,
    pointerTrack: null,
    cursorMetrics: null,
    zoomTrack,
  })
  check('fs.refreshTime', refreshed.presentationTime, 1)
  check('fs.refreshSceneTime', refreshed.scene.time, 0)
  check('fs.refreshNoCursor', refreshed.scene.cursor, null)
  check('fs.refreshOrder', refreshed.scene.layerOrder.join(','), 'background,screen')
}

runFrameSceneBatch()

// ---- 批次 8（RecorderCore 收官：ExportPolicy / 三个诊断 / ScreenMotionCreationStyle
//      / ProjectValidator / AutoZoomPlanner / EditorTimeline）----
function runRecorderCoreBatch() {
  const {
    requiredProjectMedia, exportVideoBitrate, EXPORT_AUDIO_BITRATE,
    makeRecordingPerformanceSample, summaryFromSample, summaryIncludingSample,
    makeRecordingPerformanceSummary,
    makeAudioCaptureDiagnostics, totalDroppedSampleBuffers, appendedSampleBuffersPerSecond,
    makeCameraCaptureDiagnostics, decodeCameraCaptureDiagnostics, encodeCameraCaptureDiagnostics,
    systemDroppedFrames, applicationDroppedFrames, receivedFramesPerSecond, appendedFramesPerSecond,
    screenMotionCreationStyleFromClip, makeScreenMotionCreationStyle,
    screenMotionCreationStyleIsValid, screenMotionClipFromStyle,
    ProjectValidationError, validateRecorderProject, validateCanvasStyle, validateCameraStyle,
    validateAudioStyle, validateCursorStyle, validateMotionStyle, validateZoomAnimationClip,
    validateProjectTimeline,
    makeAutoZoomAnimations, makeAutoZoomAnimationsFromClicks, repairingLegacyAutomaticAnimations,
    makePerClickLegacyAnimations, extendingAutomaticHoldsThroughPointerActivity,
    mergingConnectedAutomaticEnvelopes, orderedValidClicks, pointerClicks,
    spatialFocusGroups, spatialFocusGroupFocus, clippedZoomAnimations, clippedZoomKeyframes,
    makeAutoZoomKeyframes, makeAutoZoomKeyframesFromClicks,
    fitZoomAnimation, manualZoomAnimation, manualZoomRangeKeyframes, clampedTime, xPosition,
    zoomSegmentsFromAnimations, splitZoomAnimation, zoomSequenceIsValid, effectiveExitDuration,
    exitNormalizations, movingZoomAnimation, resizingZoomAnimation, zoomHitZone, motionHitZone,
    fitMotionTiming, motionReturnNormalizations, zoomSegmentsFromKeyframes,
    makeKeyframe, makePointerClick, makeTimelineZoomSegment, makeClip, makeTransitionTiming,
  } = m

  const tol = 1e-6
  const baseProject = {
    ...m.makeRecorderProject(),
    canvas: m.makeCanvasStyle(),
    camera: m.makeCameraStyle(),
    audio: m.makeAudioStyle(),
    cursorStyle: m.makeCursorStyle(),
    motion: m.makeMotionStyle(),
    openingSequence: m.makeOpeningSequence(),
    timeline: m.makeProjectTimeline(),
  }

  // ================================================ ExportPolicy
  check('ep.audioBitrate', EXPORT_AUDIO_BITRATE, 192000)
  check('ep.bitrate1080', exportVideoBitrate(1920, 1080, 60), 20736000)
  // 4K：像素数 ≥ 7M → 上限抬到 130 Mbps
  check('ep.bitrate4k', exportVideoBitrate(3840, 2160, 60), 82944000)
  // 1440p：上限 100 Mbps（82.9M/6 不触顶，但 1440p60 会）
  check('ep.bitrate1440p60', exportVideoBitrate(2560, 1440, 60), 36864000)
  // 触顶需要更高帧率：1440p120 → 73.7M 仍低于上限；4K120 → 165.9M 被 130M 截断
  check('ep.bitrate4k120Cap', exportVideoBitrate(3840, 2160, 120), 130000000)
  // 极小分辨率：12 Mbps 下限生效
  check('ep.bitrateFloor', exportVideoBitrate(100, 100, 60), 12000000)
  // frameRate 0 按 1 处理
  check('ep.bitrateZeroFps', exportVideoBitrate(1920, 1080, 0), 12000000)

  const required = requiredProjectMedia(baseProject)
  check('ep.reqScreen', required.screenVideo, true)
  check('ep.reqSystemAudio', required.systemAudio, true)
  // media 为 null → 相机与麦克风都不需要
  check('ep.reqCamera', required.cameraVideo, false)
  check('ep.reqMic', required.microphoneAudio, false)
  check('ep.reqBgImage', required.backgroundImage, false)
  check('ep.reqBgVideo', required.backgroundVideo, false)

  // 静音后系统声不再需要
  const mutedProject = { ...baseProject, audio: m.makeAudioStyle({ isSystemMuted: true }) }
  check('ep.reqMutedSystem', requiredProjectMedia(mutedProject).systemAudio, false)
  // 相机隐藏 → 不需要相机视频
  const hiddenCamera = { ...baseProject, camera: m.makeCameraStyle({ isHidden: true }) }
  check('ep.reqCameraHidden', requiredProjectMedia(hiddenCamera).cameraVideo, false)

  // ================================================ RecordingPerformanceDiagnostics
  const sample1 = makeRecordingPerformanceSample({
    elapsed: NaN,
    processCPUPercent: -5,
    systemCPUPercent: 120,
    processResidentBytes: 1024,
    thermalState: 'nominal',
  })
  check('perf.elapsedNaN', sample1.elapsed, 0)
  check('perf.cpuNegative', sample1.processCPUPercent, 0)
  check('perf.systemCpuClamped', sample1.systemCPUPercent, 100)
  check('perf.metalNull', sample1.processMetalAllocatedBytes, null)

  const sample2 = makeRecordingPerformanceSample({
    elapsed: 2,
    processCPUPercent: 55,
    systemCPUPercent: 30,
    processResidentBytes: 4096,
    processMetalAllocatedBytes: 8192,
    availableDiskBytes: 1000,
    thermalState: 'serious',
  })
  const sample3 = makeRecordingPerformanceSample({
    elapsed: 3,
    processCPUPercent: 40,
    systemCPUPercent: 20,
    processResidentBytes: 2048,
    processMetalAllocatedBytes: 16384,
    availableDiskBytes: 500,
    thermalState: 'fair',
  })
  const summary = makeRecordingPerformanceSummary([sample2, sample3])
  check('perf.count', summary.sampleCount, 2)
  check('perf.peakCpu', summary.peakProcessCPUPercent, 55)
  check('perf.peakResident', summary.peakProcessResidentBytes, 4096)
  check('perf.peakMetal', summary.peakProcessMetalAllocatedBytes, 16384)
  check('perf.minDisk', summary.minimumAvailableDiskBytes, 500)
  check('perf.worstThermal', summary.worstThermalState, 'serious')
  check('perf.emptyCount', makeRecordingPerformanceSummary([]).sampleCount, 0)
  check('perf.emptyThermal', makeRecordingPerformanceSummary([]).worstThermalState, 'unknown')

  // unknown 严重度 -1：不会覆盖已观测到的 nominal
  const withUnknown = summaryIncludingSample(summaryFromSample(sample1), {
    ...sample1, thermalState: 'unknown',
  })
  check('perf.unknownKeepsWorst', withUnknown.worstThermalState, 'nominal')
  check('perf.unknownCount', withUnknown.sampleCount, 2)

  // ================================================ AudioCaptureDiagnostics
  const audioDiag = makeAudioCaptureDiagnostics({
    receivedSampleBuffers: 100,
    appendedSampleBuffers: 90,
    ingressDrops: -3,
    writerBackpressureDrops: 4,
    invalidTimestampDrops: 1,
    elapsed: 2,
    maximumSampleInterval: NaN,
  })
  check('ad.ingressClamped', audioDiag.ingressDrops, 0)
  check('ad.maxIntervalNaN', audioDiag.maximumSampleInterval, 0)
  check('ad.totalDropped', totalDroppedSampleBuffers(audioDiag), 5)
  check('ad.perSecond', appendedSampleBuffersPerSecond(audioDiag), 45, tol)
  check(
    'ad.perSecondZero',
    appendedSampleBuffersPerSecond(makeAudioCaptureDiagnostics({
      receivedSampleBuffers: 10, appendedSampleBuffers: 10, elapsed: 0,
    })),
    0
  )

  // ================================================ CameraCaptureDiagnostics
  const camDiag = makeCameraCaptureDiagnostics({
    receivedFrames: 61,
    appendedFrames: 31,
    systemLateDrops: 2,
    systemOutOfBufferDrops: 1,
    systemDiscontinuityDrops: 0,
    systemUnknownDrops: 3,
    encoderBackpressureDrops: 5,
    nonMonotonicTimestampDrops: 1,
    normalizedFrames: 4,
    formatChanges: 1,
    initialWidth: 1920,
    initialHeight: 1080,
    finalWidth: 1280,
    finalHeight: 720,
    elapsed: 2,
    maximumFrameInterval: 0.05,
  })
  check('cd.systemDropped', systemDroppedFrames(camDiag), 6)
  check('cd.appDropped', applicationDroppedFrames(camDiag), 6)
  // (N-1)/elapsed
  check('cd.receivedFps', receivedFramesPerSecond(camDiag), 30, tol)
  check('cd.appendedFps', appendedFramesPerSecond(camDiag), 15, tol)
  // 单帧无法算区间
  check(
    'cd.singleFrameFps',
    receivedFramesPerSecond({ ...camDiag, receivedFrames: 1 }),
    0
  )
  // 旧清单缺字段 → 中性默认
  const legacyDiag = decodeCameraCaptureDiagnostics({
    receivedFrames: 10, appendedFrames: 9,
    systemLateDrops: 0, systemOutOfBufferDrops: 0,
    systemDiscontinuityDrops: 0, systemUnknownDrops: 0,
    encoderBackpressureDrops: 0, nonMonotonicTimestampDrops: 0,
    normalizedFrames: 0, formatChanges: 0,
    elapsed: 1, maximumFrameInterval: 0.1,
  })
  check('cd.legacyInvalidSample', legacyDiag.invalidSampleDrops, 0)
  check('cd.legacyInterruptions', legacyDiag.sessionInterruptionCount, 0)
  check('cd.legacyPixelFormat', legacyDiag.initialPixelFormat, null)
  // 编码：可空字段省略，非可空 0 保留
  const encoded = encodeCameraCaptureDiagnostics(legacyDiag)
  check('cd.encodeOmitNull', 'initialWidth' in encoded, false)
  check('cd.encodeKeepZero', encoded.sessionInterruptionCount, 0)
  check('cd.encodeInvalidSample', encoded.invalidSampleDrops, 0)

  // ================================================ ScreenMotionCreationStyle
  const motionTiming = makeTransitionTiming({
    startTime: 2, duration: 3, leadInDuration: 1.2, returnDuration: 0.4,
  })
  const motionClip = {
    id: 'mc1',
    timing: motionTiming,
    target: { position: { x: 0.3, y: 0.7 }, scale: 1.4, rotationX: 5, rotationY: -3, rotationZ: 2, perspective: 0.65 },
    focusEffect: null,
  }
  const creationStyle = screenMotionCreationStyleFromClip(motionClip)
  check('sms.leadIn', creationStyle.leadInDuration, 1.2, tol)
  // 手授意图优先：preferredReturnDuration 为 null 时回落到已生效值 0.4（> 0）
  check('sms.return', creationStyle.returnDuration, 0.4, tol)
  check('sms.targetX', creationStyle.target.position.x, 0.3, tol)
  check('sms.valid', screenMotionCreationStyleIsValid(creationStyle), true)
  check('sms.invalidScale', screenMotionCreationStyleIsValid({
    ...creationStyle, target: { ...creationStyle.target, scale: 0 },
  }), false)
  check('sms.invalidPosition', screenMotionCreationStyleIsValid({
    ...creationStyle, target: { ...creationStyle.target, position: { x: 1.4, y: 0.5 } },
  }), false)
  check('sms.invalidLeadIn', screenMotionCreationStyleIsValid({
    ...creationStyle, leadInDuration: 6,
  }), false)
  check('sms.invalidCurve', screenMotionCreationStyleIsValid({
    ...creationStyle, customCurve: { x1: NaN, y1: 0, x2: 1, y2: 1 },
  }), false)

  // clip(timing:)：进入按整段截断，回落取 min(样式, 旧值)
  const applied = screenMotionClipFromStyle(
    { ...creationStyle, leadInDuration: 2.5, returnDuration: 0.9 },
    makeTransitionTiming({ startTime: 0, duration: 1.0, leadInDuration: 0.5, returnDuration: 0.3 }),
    'mc2'
  )
  check('sms.clipLeadInClamped', applied.timing.leadInDuration, 1.0, tol)
  // min(0.9, 0.3) = 0.3 —— 样式不能把回落放大
  check('sms.clipReturnMin', applied.timing.returnDuration, 0.3, tol)
  check('sms.clipPreferredLeadIn', applied.timing.preferredLeadInDuration, 2.5, tol)
  check('sms.clipPreferredReturn', applied.timing.preferredReturnDuration, 0.9, tol)
  check('sms.clipOffset', applied.timing.leadInProgressOffset, 0)
  check('sms.clipId', applied.id, 'mc2')

  // ================================================ ProjectValidator
  validateCanvasStyle(m.makeCanvasStyle())
  passed++
  validateCameraStyle(m.makeCameraStyle())
  passed++
  validateAudioStyle(m.makeAudioStyle())
  passed++
  validateCursorStyle(m.makeCursorStyle())
  passed++
  validateMotionStyle(m.makeMotionStyle())
  passed++
  validateRecorderProject(baseProject)
  passed++

  const expectKind = (name, fn, kind) => {
    try {
      fn()
      failed++
      console.error(`FAIL ${name}: expected throw ${kind}`)
    } catch (error) {
      if (error instanceof ProjectValidationError && error.kind === kind) {
        passed++
      } else {
        failed++
        console.error(`FAIL ${name}: got ${error && error.kind ? error.kind : error}`)
      }
    }
  }
  expectKind('pv.canvasPadding', () => validateCanvasStyle(m.makeCanvasStyle({ padding: 2000 })), 'invalidCanvas')
  // make* 工厂本身会规范化（clamp crop / 截断 title），因此必须绕过工厂直接覆盖
  expectKind('pv.canvasCrop', () => validateCanvasStyle({
    ...m.makeCanvasStyle(), crop: { x: 0.5, y: 0, width: 0.8, height: 1 },
  }), 'invalidCanvas')
  expectKind('pv.canvasTitle', () => validateCanvasStyle({
    ...m.makeCanvasStyle(), screenFrameTitle: 'x'.repeat(121),
  }), 'invalidCanvas')
  expectKind('pv.cameraSize', () => validateCameraStyle(m.makeCameraStyle({ size: 0 })), 'invalidCamera')
  expectKind('pv.audioVolume', () => validateAudioStyle({ ...m.makeAudioStyle(), systemVolume: 1.5 }), 'invalidAudio')
  // motionTiltStrength 合法域是 2...4
  expectKind('pv.cursorTilt', () => validateCursorStyle({ ...m.makeCursorStyle(), motionTiltStrength: 5 }), 'invalidCursor')
  expectKind('pv.cursorSize', () => validateCursorStyle({ ...m.makeCursorStyle(), size: 0.1 }), 'invalidCursor')
  expectKind('pv.motionScale', () => validateMotionStyle(m.makeMotionStyle({ defaultZoomScale: 8 })), 'invalidMotion')
  expectKind('pv.motionSpring', () => validateMotionStyle(
    m.makeMotionStyle({ cursorSpringMass: 0 })
  ), 'invalidMotion')
  expectKind('pv.openingStagger', () => validateRecorderProject({
    ...baseProject,
    openingSequence: { ...m.makeOpeningSequence(), duration: 0.5, stagger: 1.0 },
  }), 'invalidOpening')
  expectKind('pv.openingOrder', () => validateRecorderProject({
    ...baseProject,
    openingSequence: { ...m.makeOpeningSequence(), elementOrder: ['屏幕'] },
  }), 'invalidOpening')

  // 重复 ID → duplicateZoomID
  const dupClip = makeClip({ id: 'z1', startTime: 0, endTime: 1, scale: 1.6 })
  expectKind('pv.duplicateZoom', () => validateProjectTimeline(
    m.makeProjectTimeline({ zoomClips: [dupClip, { ...dupClip }] })
  ), 'duplicateZoomID')
  // 重叠（间隙落在回落窗口内）→ overlappingZoom
  expectKind('pv.overlapZoom', () => validateProjectTimeline(
    m.makeProjectTimeline({
      zoomClips: [
        makeClip({ id: 'a', startTime: 0, endTime: 2, scale: 1.6, exitDuration: 0.7 }),
        makeClip({ id: 'b', startTime: 2.2, endTime: 4, scale: 1.6 }),
      ],
    })
  ), 'overlappingZoom')
  // 单个片段入口走同一套规则
  expectKind('pv.zoomClip', () => validateZoomAnimationClip({
    ...makeClip({ id: 'bad', startTime: 0, endTime: 1, scale: 1.6 }), scale: 0.5,
  }), 'invalidZoom')

  // ================================================ AutoZoomPlanner
  const click = (time, x, y) => makePointerClick(time, { x, y })
  const evMove = (time, x, y) => ({ time, location: { x, y }, kind: 'move', clickPhase: null, rotationRadians: 0, recordedCursorAssetID: null })

  // 单点击：start = t - 0.7*0.18，end = t + 0.9
  const single = makeAutoZoomAnimationsFromClicks([click(2, 0.5, 0.5)])
  check('az.singleCount', single.length, 1)
  check('az.singleStart', single[0].startTime, 2 - 0.126, tol)
  check('az.singleEnd', single[0].endTime, 2.9, tol)
  check('az.singleOrigin', single[0].origin, 'automatic')
  check('az.singleExit', single[0].exitDuration, 0.7, tol)
  check('az.singleScale', single[0].scale, 1.6, tol)
  // focus 按 safeInset=0.12 夹取
  const corner = makeAutoZoomAnimationsFromClicks([click(2, 0.02, 0.98)])
  check('az.focusClampedX', corner[0].focus.x, 0.12, tol)
  check('az.focusClampedY', corner[0].focus.y, 0.88, tol)

  // 同区域两点击（时间近 + 空间近）→ 一个焦点组
  const near = makeAutoZoomAnimationsFromClicks([click(2, 0.5, 0.5), click(2.3, 0.52, 0.51)])
  check('az.nearCount', near.length, 1)
  // 空间远（跨度 0.8 > visibleExtent*0.5=0.3125）→ 两个焦点组
  const far = makeAutoZoomAnimationsFromClicks([click(2, 0.1, 0.5), click(2.3, 0.9, 0.5)])
  check('az.farCount', far.length, 2)
  // 时间远（> clickGroupGap 1.4）→ 两个时间组
  const late = makeAutoZoomAnimationsFromClicks([click(2, 0.5, 0.5), click(5, 0.5, 0.5)])
  check('az.timeGapCount', late.length, 2)

  // 空间分组细节
  const groups = spatialFocusGroups([click(1, 0.2, 0.2), click(2, 0.3, 0.3), click(3, 0.9, 0.9)], 0.5, 0.5)
  check('az.groupCount', groups.length, 2)
  check('az.groupFocus', spatialFocusGroupFocus(groups[0]).x, 0.25, tol)

  // 乱序 / 非法时间
  check('az.orderedSorted', orderedValidClicks([click(3, 0, 0), click(1, 0, 0)])[0].time, 1)
  check('az.orderedFiltered', orderedValidClicks([click(-1, 0, 0), click(1, 0, 0)]).length, 1)
  const alreadyOrdered = [click(1, 0, 0), click(2, 0, 0)]
  check('az.orderedIdentity', orderedValidClicks(alreadyOrdered) === alreadyOrdered, true)

  // pointerClicks 只认左右键
  check('az.pointerClicks', pointerClicks([
    evMove(1, 0.1, 0.1),
    { ...evMove(2, 0.2, 0.2), kind: 'leftClick' },
    { ...evMove(3, 0.3, 0.3), kind: 'rightClick' },
  ]).length, 2)

  // 指针活动延长保持：点击后连续移动 → endTime 被拉长
  const extended = makeAutoZoomAnimations(
    [evMove(1.9, 0.5, 0.5), { ...evMove(2, 0.5, 0.5), kind: 'leftClick' }, evMove(2.5, 0.55, 0.55), evMove(3.0, 0.6, 0.6)],
  )
  check('az.activityExtended', extended[0].endTime > 2.9, true)
  // settleHold 0.55：3.0 + 0.55 = 3.55
  check('az.activityEnd', extended[0].endTime, 3.55, tol)

  // 折叠：首尾相接、同 scale / easing 的自动片段合一
  const merged = mergingConnectedAutomaticEnvelopes([
    makeClip({ id: 'm1', startTime: 0, endTime: 2, scale: 1.6, origin: 'automatic', easing: '弹簧', exitDuration: 0 }),
    makeClip({ id: 'm2', startTime: 2, endTime: 4, scale: 1.6, origin: 'automatic', easing: '弹簧', exitDuration: 0.5 }),
  ])
  check('az.mergedCount', merged.length, 1)
  check('az.mergedEnd', merged[0].endTime, 4, tol)
  check('az.mergedExit', merged[0].exitDuration, 0.5, tol)
  // 手动片段不折叠
  check('az.mergedManual', mergingConnectedAutomaticEnvelopes([
    makeClip({ id: 'm3', startTime: 0, endTime: 2, scale: 1.6, origin: 'automatic', exitDuration: 0 }),
    makeClip({ id: 'm4', startTime: 2, endTime: 4, scale: 1.6, origin: 'manual' }),
  ]).length, 2)

  // 裁剪：末段夹到时长、退出收缩
  const clipped = clippedZoomAnimations(
    [makeClip({ id: 'c1', startTime: 0, endTime: 5, scale: 1.6, exitDuration: 0.7 })],
    3
  )
  check('az.clipEnd', clipped[0].endTime, 3, tol)
  check('az.clipExit', clipped[0].exitDuration, 0, tol)
  check('az.clipBeyond', clippedZoomAnimations(
    [makeClip({ id: 'c2', startTime: 10, endTime: 12, scale: 1.6 })], 3
  ).length, 0)
  check('az.clipInvalidDuration', clippedZoomAnimations([], 0).length, 0)

  // 关键帧裁剪：在裁点补一个采样帧
  const clippedFrames = clippedZoomKeyframes(
    [makeKeyframe({ time: 0, scale: 1, focus: { x: 0.5, y: 0.5 } }),
     makeKeyframe({ time: 5, scale: 1.6, focus: { x: 0.5, y: 0.5 } })],
    3,
    m.makeMotionStyle()
  )
  check('az.clipFramesTail', clippedFrames[clippedFrames.length - 1].time, 3, tol)
  check('az.clipFramesCount', clippedFrames.length, 2)

  // 旧版关键帧：单点击组 → 初始帧 + start/zoomed/release/return = 5
  const legacyFrames = makeAutoZoomKeyframesFromClicks([click(2, 0.5, 0.5)])
  check('az.legacyFrameCount', legacyFrames.length, 5)
  check('az.legacyStart', legacyFrames[1].time, 2 - 0.42 * 0.18, tol)
  check('az.legacyZoomed', legacyFrames[2].time, 2 - 0.42 * 0.18 + 0.42, tol)
  // release = max(t + hold, zoomed + hold)；zoomed 更晚时以 zoomed 为准
  check('az.legacyRelease', legacyFrames[3].time, 2 - 0.42 * 0.18 + 0.42 + 0.9, tol)
  check('az.legacyReturnScale', legacyFrames[4].scale, 1)

  // 一点击一片段的历史配方
  const perClick = makePerClickLegacyAnimations([click(2, 0.5, 0.5)])
  check('az.perClickCount', perClick.length, 1)
  check('az.perClickStart', perClick[0].startTime, 2 - 0.42 * 0.18, tol)
  check('az.perClickEnd', perClick[0].endTime, 2.9, tol)

  // 修复入口：只认纯自动轨
  const manualTrack = [makeClip({ id: 'x1', startTime: 0, endTime: 1, scale: 1.6, origin: 'manual' })]
  check('az.repairSkipsManual', repairingLegacyAutomaticAnimations(manualTrack, []).length, 1)
  check('az.repairEmpty', repairingLegacyAutomaticAnimations([], []).length, 0)
  // 当前规划器输出的轨道被识别 → 折叠（结果仍为 1 段）
  const currentTrack = makeAutoZoomAnimationsFromClicks([click(2, 0.5, 0.5)])
  const repaired = repairingLegacyAutomaticAnimations(currentTrack, [], { easing: '弹簧' })
  check('az.repairRecognized', repaired.length, 1)
  check('az.repairEasing', repaired[0].easing, '弹簧')

  // ================================================ EditorTimeline
  check('et.clampedTime', clampedTime(50, 100, 10), 5, tol)
  check('et.clampedTimeOutOfRange', clampedTime(200, 100, 10), 10, tol)
  check('et.clampedTimeZeroWidth', clampedTime(50, 0, 10), 0)
  check('et.xPosition', xPosition(5, 100, 10), 50, tol)
  check('et.xPositionZeroDuration', xPosition(5, 100, 0), 0)

  // 空轨道拟合
  const fitted = fitZoomAnimation({ start: 1, end: 2, animations: [], duration: 10 })
  check('et.fitStart', fitted.startTime, 1, tol)
  check('et.fitEnd', fitted.endTime, 2, tol)
  check('et.fitOrigin', fitted.origin, 'automatic')
  check('et.fitExit', fitted.exitDuration, 0.7, tol)
  check('et.fitPreferredEnter', fitted.preferredEnterDuration, 0.7, tol)
  // 点击（start == end）：默认 1.5s
  const clickFit = fitZoomAnimation({ start: 1, end: 1, animations: [], duration: 10 })
  check('et.fitClickLength', clickFit.endTime - clickFit.startTime, 1.5, tol)
  // 起点落入前段回落窗口「洞口」→ 吸到相接
  const neighbourClip = makeClip({ id: 'n1', startTime: 0, endTime: 2, scale: 1.6, exitDuration: 0.7 })
  const holeFit = fitZoomAnimation({
    start: 2.3, end: 3.3, animations: [neighbourClip], duration: 10,
  })
  // 起点被吸到相接处（lowerTouch=2），长度不变 → 终点随之前移
  check('et.fitHoleStart', holeFit.startTime, 2, tol)
  check('et.fitHoleEnd', holeFit.endTime, 3, tol)
  // 起点已让开回落窗口 → 保持原样
  const clearFit = fitZoomAnimation({
    start: 3, end: 4, animations: [neighbourClip], duration: 10,
  })
  check('et.fitClearStart', clearFit.startTime, 3, tol)
  // 完全没有空隙 → null
  const fullClip = makeClip({ id: 'n2', startTime: 0, endTime: 10, scale: 1.6 })
  check('et.fitNoRoom', fitZoomAnimation({
    start: 4, end: 5, animations: [fullClip], duration: 10,
  }), null)
  check('et.fitInvalidDuration', fitZoomAnimation({
    start: 1, end: 2, animations: [], duration: 0,
  }), null)

  // 手动画笔
  const manual = manualZoomAnimation({ start: 1, end: 3, duration: 10 })
  check('et.manualOrigin', manual.origin, 'manual')
  check('et.manualEnd', manual.endTime, 3, tol)
  // 极短拖动 → 按点击处理，最短 0.24
  const manualTiny = manualZoomAnimation({ start: 1, end: 1.01, duration: 10 })
  check('et.manualTinyEnd', manualTiny.endTime, 1 + Math.min(1.5, Math.max(10 * 0.2, 0.6)), tol)
  const manualFrames = manualZoomRangeKeyframes({ start: 1, end: 4, duration: 10 })
  check('et.manualFramesCount', manualFrames.length, 4)
  check('et.manualFramesOrigin', manualFrames[0].origin, 'manual')
  // transition = min(0.28, 3*0.3) = 0.28
  check('et.manualFramesIn', manualFrames[1].time, 1.28, tol)
  check('et.manualFramesOut', manualFrames[2].time, 3.72, tol)

  // 段表
  const segs = zoomSegmentsFromAnimations(
    [makeClip({ id: 's1', startTime: 1, endTime: 3, scale: 1.6 })], 10
  )
  check('et.segCount', segs.length, 1)
  check('et.segRepresentative', segs[0].representativeKeyframeID, 's1')
  // 超出时长的段被夹取
  const segsClamped = zoomSegmentsFromAnimations(
    [makeClip({ id: 's2', startTime: 1, endTime: 20, scale: 1.6 })], 10
  )
  check('et.segClampedEnd', segsClamped[0].endTime, 10, tol)
  // 退化段（时长 ≤ 0）被丢弃
  check('et.segDegenerate', zoomSegmentsFromAnimations(
    [makeClip({ id: 's3', startTime: 1, endTime: 1, scale: 1.6 })], 10
  ).length, 0)

  // 拆分
  const splitSource = makeClip({ id: 'sp', startTime: 0, endTime: 2, scale: 1.6 })
  const halves = splitZoomAnimation(splitSource, 1)
  check('et.splitLeftEnd', halves[0].endTime, 1, tol)
  check('et.splitLeftExit', halves[0].exitDuration, 0, tol)
  check('et.splitRightStart', halves[1].startTime, 1, tol)
  check('et.splitRightNewID', halves[1].id !== splitSource.id, true)
  // 右段至少 0.15 的交接时长
  check('et.splitRightEnter', halves[1].enterDuration, 0.7, tol)
  check('et.splitTooShort', splitZoomAnimation(splitSource, 0.05), null)

  // 邻接合法性
  const prevClip = makeClip({ id: 'p1', startTime: 0, endTime: 2, scale: 1.6, exitDuration: 0.7 })
  check('et.adjTouching', zoomSequenceIsValid(prevClip, makeClip({ id: 'p2', startTime: 2, endTime: 3, scale: 1.6 })), true)
  check('et.adjCleared', zoomSequenceIsValid(prevClip, makeClip({ id: 'p3', startTime: 2.7, endTime: 3, scale: 1.6 })), true)
  check('et.adjInHole', zoomSequenceIsValid(prevClip, makeClip({ id: 'p4', startTime: 2.3, endTime: 3, scale: 1.6 })), false)
  check('et.adjOverlap', zoomSequenceIsValid(prevClip, makeClip({ id: 'p5', startTime: 1.9, endTime: 3, scale: 1.6 })), false)
  check('et.effectiveExit', effectiveExitDuration(prevClip, 1.2), 0.7, tol)
  const zeroExit = makeClip({ id: 'p6', startTime: 0, endTime: 1, scale: 1.6, exitDuration: 0 })
  check('et.effectiveExitDefault', effectiveExitDuration(zeroExit, 1.2), 1.2, tol)

  // 移动：单片段自由平移
  const moved = movingZoomAnimation(
    makeClip({ id: 'mv', startTime: 1, endTime: 2, scale: 1.6 }), 3, [], 10
  )
  check('et.moveTo', moved.startTime, 3, tol)
  check('et.moveKeepsDuration', moved.endTime - moved.startTime, 1, tol)
  // 被前段回落窗口挡住 → 吸附到合法位置
  const movedIntoHole = movingZoomAnimation(
    makeClip({ id: 'mv2', startTime: 5, endTime: 6, scale: 1.6 }),
    2.2,
    [makeClip({ id: 'pp', startTime: 0, endTime: 2, scale: 1.6, exitDuration: 0.7 })],
    10
  )
  check('et.moveSnapped', movedIntoHole.startTime, 2, tol)

  // 调整右端
  const resized = resizingZoomAnimation({
    animation: makeClip({ id: 'rs', startTime: 1, endTime: 2, scale: 1.6 }),
    proposedEnd: 5,
    animations: [],
    duration: 10,
  })
  check('et.resizeEnd', resized.endTime, 5, tol)
  // 最短时长保护
  const resizedTiny = resizingZoomAnimation({
    animation: makeClip({ id: 'rs2', startTime: 1, endTime: 3, scale: 1.6 }),
    proposedEnd: 1.02,
    animations: [],
    duration: 10,
  })
  check('et.resizeMinimum', resizedTiny.endTime, 1.16, tol)

  // 命中测试
  const hitSegs = [makeTimelineZoomSegment({
    id: 'h1', startTime: 0, endTime: 5, scale: 1.6, origin: 'automatic', representativeKeyframeID: 'h1',
  })]
  check('et.hitEmptyOutsideBar', zoomHitZone({
    x: 10, y: 2, segments: hitSegs, width: 100, duration: 10, selectedID: null, hoveredID: null,
  }).kind, 'empty')
  check('et.hitMove', zoomHitZone({
    x: 10, y: 28, segments: hitSegs, width: 100, duration: 10, selectedID: null, hoveredID: null,
  }).kind, 'move')
  // 选中后靠近左端 → leading 手柄
  const leadingHit = zoomHitZone({
    x: 2, y: 28, segments: hitSegs, width: 100, duration: 10, selectedID: 'h1', hoveredID: null,
  })
  check('et.hitLeadingKind', leadingHit.kind, 'resize')
  check('et.hitLeadingSide', leadingHit.leading, true)
  // 靠近右端（段宽 50，右端 50）→ trailing 手柄
  const trailingHit = zoomHitZone({
    x: 48, y: 28, segments: hitSegs, width: 100, duration: 10, selectedID: null, hoveredID: 'h1',
  })
  check('et.hitTrailingSide', trailingHit.leading, false)
  // 空白处（段外）→ empty
  check('et.hitOutsideSegment', zoomHitZone({
    x: 80, y: 28, segments: hitSegs, width: 100, duration: 10, selectedID: null, hoveredID: null,
  }).kind, 'empty')

  // 运动命中（tuple 版）
  const motionItems = [{ id: 'mo1', timing: makeTransitionTiming({ startTime: 0, duration: 2 }) }]
  check('et.motionHitMove', motionHitZone({
    x: 10, y: 23, timings: motionItems, width: 100, duration: 10, selectedID: null, hoveredID: null,
  }).kind, 'move')
  // trackHeight 46 / barHeight 36 → bar 在 y ∈ [5, 41]
  check('et.motionHitOutside', motionHitZone({
    x: 10, y: 2, timings: motionItems, width: 100, duration: 10, selectedID: null, hoveredID: null,
  }).kind, 'empty')

  // 运动创建拟合
  const fittedTiming = fitMotionTiming({
    start: 1, end: 2, timings: [], duration: 10, returnDuration: 0.6,
  })
  check('et.fitMotionStart', fittedTiming.startTime, 1, tol)
  check('et.fitMotionDuration', fittedTiming.duration, 1, tol)
  // leadInDuration 默认整段
  check('et.fitMotionLeadIn', fittedTiming.leadInDuration, 1, tol)
  check('et.fitMotionReturn', fittedTiming.returnDuration, 0.6, tol)
  const fittedMotionClick = fitMotionTiming({
    start: 1, end: 1, timings: [], duration: 10, returnDuration: 0.6,
  })
  check('et.fitMotionClickLength', fittedMotionClick.duration, Math.min(1.2, Math.max(10 * 0.15, 0.5)), tol)
  // 间隙不足 0.16 → null
  check('et.fitMotionNoRoom', fitMotionTiming({
    start: 1, end: 2, timings: [makeTransitionTiming({ startTime: 0, duration: 10 })],
    duration: 10, returnDuration: 0.6,
  }), null)

  // 运动回落归一
  const returnPatches = motionReturnNormalizations(
    'r1',
    [
      { id: 'r1', timing: makeTransitionTiming({ startTime: 0, duration: 2, returnDuration: 0 }) },
      { id: 'r2', timing: makeTransitionTiming({ startTime: 2.5, duration: 1, returnDuration: 0 }) },
    ],
    0.7
  )
  check('et.returnPatchCount', returnPatches.length, 1)
  check('et.returnPatchId', returnPatches[0].id, 'r1')
  // 剩余间隙 0.5 < 默认回落 0.7 → 封顶到 0.5
  check('et.returnPatchDuration', returnPatches[0].timing.returnDuration, 0.5, tol)

  // 缩放退出归一
  const exitPatches = exitNormalizations(
    'e1',
    [
      makeClip({ id: 'e1', startTime: 0, endTime: 2, scale: 1.6, exitDuration: 0 }),
      makeClip({ id: 'e2', startTime: 2.5, endTime: 4, scale: 1.6 }),
    ],
    0.7
  )
  check('et.exitPatchCount', exitPatches.length, 1)
  check('et.exitPatchDuration', exitPatches[0].exitDuration, 0.5, tol)

  // 关键帧 → 段表
  const kfSegs = zoomSegmentsFromKeyframes(
    [
      makeKeyframe({ time: 0, scale: 1, focus: { x: 0.5, y: 0.5 } }),
      makeKeyframe({ time: 1, scale: 1.6, focus: { x: 0.5, y: 0.5 } }),
      makeKeyframe({ time: 3, scale: 1.6, focus: { x: 0.5, y: 0.5 } }),
      makeKeyframe({ time: 4, scale: 1, focus: { x: 0.5, y: 0.5 } }),
    ],
    10
  )
  check('et.kfSegCount', kfSegs.length, 1)
  // 段起点取前一个关键帧（开始爬升处）
  check('et.kfSegStart', kfSegs[0].startTime, 0, tol)
  check('et.kfSegEnd', kfSegs[0].endTime, 4, tol)
  check('et.kfSegScale', kfSegs[0].scale, 1.6, tol)
  check('et.kfSegEasing', kfSegs[0].easing, '三次方缓动')
  check('et.kfSegEnter', kfSegs[0].enterDuration, 0.55, tol)
  // 手动关键帧 → 段 origin 升级为 manual
  const manualKfSegs = zoomSegmentsFromKeyframes(
    [
      makeKeyframe({ time: 0, scale: 1, focus: { x: 0.5, y: 0.5 } }),
      makeKeyframe({ time: 1, scale: 2, focus: { x: 0.5, y: 0.5 }, origin: 'manual' }),
      makeKeyframe({ time: 2, scale: 1, focus: { x: 0.5, y: 0.5 } }),
    ],
    10
  )
  check('et.kfManualOrigin', manualKfSegs[0].origin, 'manual')
}

runRecorderCoreBatch()

// ---- 批次 9（时间线几何 / 磁吸 / 手授顺序 / 交互纯决策）----
function runTimelineGeometryBatch() {
  const {
    CLIP_CONTENT_INSET, CLIP_WAVEFORM_BAND_FRACTION, clipInteractionRange, clipWaveformBand,
    rulerMajorStep, nextFinerRulerStep, rulerScaleLayers, rulerVisibleTicks, rulerLabel,
    timelineGeometry, timelineViewportHeight, timelineDocumentHeight, timelineFrameDuration,
    snappedToProjectFrame, snappedTimelineTime, snappedEditableTime, steppedTimelineTime,
    EditorTimelineMagneticSnap, magneticTargets, magneticDelta,
    normalizeZoomClipOrder, normalizeScreenMotionClipOrder, normalizeCameraMotionClipOrder,
    PrimarySegmentReorderDraft, makePrimarySegmentTrimDraft,
    primaryLeadingGap, primaryTrailingGap, primarySegmentJunctions, junctionID,
  junctionHasRemovedSourceGap, primaryDisplaySegments,
    primaryTrimDraftOrigin, primarySnappedCutX, trimOutputTimeFromTranslation, trimPreviewTime,
    trimOutputTimeFromPointerX, EditorTimelineZoomAnchor,
    EDITOR_TIMELINE_MINIMUM_ZOOM, EDITOR_TIMELINE_MAXIMUM_ZOOM, clampedTimelineZoom,
    timelineZoomTargetFromWheel, EditorTimelineZoomInputCoalescer, timelineZoomTargetScrollOffset,
    fallbackTimelineZoomViewportX, overlayMoveActionName, overlayResizeActionName,
    primarySegmentIDFromSelection, primarySegmentIDs, reconcilingPrimarySelection,
    timelineDeleteTarget, timelineSplitTarget, timelineSelectionRevealTime,
    gestureSeeksDuringDrag, gestureIntentEquals, EditorTimelineGestureOwnership,
    TimelineMap, makeClip, makeTransitionTiming, makeRecordingSegment, makeProjectTimeline,
    makeRecorderProject, makeCanvasStyle, makeCameraStyle, makeAudioStyle, makeCursorStyle,
    makeMotionStyle, makeOpeningSequence,
  } = m

  const tol = 1e-6
  const mapWith = (segments) =>
    new TimelineMap({ kind: 'edited', segments }, 10)

  // ================================================ EditorTimelineClipGeometry
  check('geo.inset', CLIP_CONTENT_INSET, 3)
  check('geo.bandFraction', CLIP_WAVEFORM_BAND_FRACTION, 0.26)
  const range = clipInteractionRange(100, 500, { start: 0, end: 200 })
  check('geo.rangeStart', range.start, 0)
  check('geo.rangeEnd', range.end, 100)
  const rangeInside = clipInteractionRange(0, 500, { start: 120, end: 200 })
  check('geo.rangeInsideStart', rangeInside.start, 120)
  check('geo.rangeInsideEnd', rangeInside.end, 200)
  // 文档范围完全在片段右侧 → 空区间（start == end）
  const rangeBeyond = clipInteractionRange(0, 400, { start: 600, end: 800 })
  check('geo.rangeBeyond', rangeBeyond.start, 400)
  check('geo.rangeBeyondEnd', rangeBeyond.end, 400)
  const band = clipWaveformBand({ x: 10, y: 20, width: 200, height: 100 })
  // content 高 94，band 高 24.44，贴底
  check('geo.bandX', band.x, 10)
  check('geo.bandWidth', band.width, 200)
  check('geo.bandHeight', band.height, 94 * 0.26, tol)
  check('geo.bandY', band.y, 20 + 3 + 94 - 94 * 0.26, tol)

  // ================================================ 标尺
  // 60s 落在 600pt：每 128pt 一格 → raw 12.8s → 1/2/5 取 20
  check('geo.majorStep', rulerMajorStep(60, 600), 20)
  check('geo.majorStepInvalid', rulerMajorStep(0, 600), 1)
  check('geo.nextFiner20', nextFinerRulerStep(20), 10)
  check('geo.nextFiner10', nextFinerRulerStep(10), 5)
  check('geo.nextFiner5', nextFinerRulerStep(5), 2)
  check('geo.nextFiner2', nextFinerRulerStep(2), 1)
  check('geo.nextFinerInvalid', nextFinerRulerStep(0), 0.5)

  // 交叉淡化两端
  // rawStep 正好等于 coarseStep（60s / 3 格）→ 进度 0 → 只用粗层
  const layersCoarse = rulerScaleLayers(60, 384)
  check('geo.layersCoarseCount', layersCoarse.length, 1)
  check('geo.layersCoarseStep', layersCoarse[0].majorStep, 20)
  // 进度落在中间 → 两层同时存在且不透明度互补
  const layersMid = rulerScaleLayers(60, 750)
  check('geo.layersMidCount', layersMid.length, 2)
  check('geo.layersMidSum', layersMid[0].opacity + layersMid[1].opacity, 1, tol)
  check('geo.layersMidFine', layersMid[1].majorStep, 10)
  check('geo.layersInvalid', rulerScaleLayers(0, 600).length, 0)

  // 视口内刻度：60s / 600pt，major 20s → minor 10s
  const ticks = rulerVisibleTicks({
    majorStep: 20, duration: 60, width: 600, visibleRange: { start: 0, end: 600 }, guardBand: 0,
  })
  check('geo.ticksFirst', ticks[0].time, 0)
  check('geo.ticksFirstMajor', ticks[0].isMajor, true)
  // 每 10s 一个次刻度，主刻度在偶数索引
  check('geo.ticksStep', ticks[1].time, 10)
  check('geo.ticksMinor', ticks[1].isMajor, false)
  check('geo.ticksLastAtMostDuration', ticks[ticks.length - 1].time <= 60, true)
  // 视口收窄后刻度数显著减少
  const narrowTicks = rulerVisibleTicks({
    majorStep: 20, duration: 60, width: 600, visibleRange: { start: 200, end: 300 }, guardBand: 0,
  })
  check('geo.ticksNarrowFewer', narrowTicks.length < ticks.length, true)
  check('geo.ticksGuarded', rulerVisibleTicks({
    majorStep: 20, duration: 60, width: 600, visibleRange: { start: 200, end: 300 }, guardBand: 80,
  }).length, narrowTicks.length + 2)

  // 标签：整秒省略百分秒
  check('geo.label18', rulerLabel(18), '0:18')
  check('geo.label18_5', rulerLabel(18.5), '0:18.50')
  check('geo.labelZero', rulerLabel(0), '0:00')
  check('geo.labelNegative', rulerLabel(-5), '0:00')
  check('geo.labelOverMinute', rulerLabel(125.25), '2:05.25')

  // ================================================ 行高几何
  const fullVisibility = {
    showsZoomTimeline: true,
    showsCameraSyncTimeline: true,
    showsScreenMotionTimeline: true,
    showsCameraMotionTimeline: true,
    showsOverlayTimeline: true,
    overlayTimelineRowCount: 2,
  }
  const geoRegular = timelineGeometry({ compact: false }, fullVisibility, false)
  check('geo.rulerHeight', geoRegular.timelineRulerHeight, 32)
  check('geo.primaryVideo', geoRegular.primaryVideoHeight, 64)
  check('geo.primaryLine', geoRegular.primaryTimelineHeight, 76)
  check('geo.cameraSync', geoRegular.cameraSyncTimelineHeight, 62)
  check('geo.motion', geoRegular.motionTimelineHeight, 44)
  check('geo.overlayRows', geoRegular.overlayTimelineHeight, 2 * 34 + 16)
  // 32 + 76 + 44 + 62 + 44 + 44 + 84
  check('geo.canvasHeight', geoRegular.timelineCanvasHeight, 32 + 76 + 44 + 62 + 44 + 44 + 84)
  check('geo.labelWidth', geoRegular.timelineLabelWidth, 156)
  check('geo.labelWidthCollapsed', timelineGeometry({ compact: false }, fullVisibility, true).timelineLabelWidth, 52)

  const geoCompact = timelineGeometry({ compact: true }, fullVisibility, false)
  check('geo.compactRuler', geoCompact.timelineRulerHeight, 28)
  check('geo.compactVideo', geoCompact.primaryVideoHeight, 52)
  check('geo.compactMotion', geoCompact.motionTimelineHeight, 40)
  check('geo.compactLabel', geoCompact.timelineLabelWidth, 128)
  // 轨道全部隐藏时只剩标尺 + 主轨
  const geoBare = timelineGeometry({ compact: false }, {
    showsZoomTimeline: false,
    showsCameraSyncTimeline: false,
    showsScreenMotionTimeline: false,
    showsCameraMotionTimeline: false,
    showsOverlayTimeline: false,
    overlayTimelineRowCount: 0,
  }, false)
  check('geo.bareCanvas', geoBare.timelineCanvasHeight, 32 + 76)
  // 叠加轨至少 1 行高
  check('geo.overlayMinimum', geoBare.overlayTimelineHeight, Math.max(34 + 16, 44))

  check('geo.viewportMin', timelineViewportHeight(10, geoRegular), 80)
  // 面板 400：400 - 44 - 20 - 1 = 335 > 80
  check('geo.viewportNormal', timelineViewportHeight(400, geoRegular), 400 - 44 - 20 - 1)
  check('geo.documentHeight', timelineDocumentHeight(400, geoRegular),
    Math.max(geoRegular.timelineCanvasHeight, 400 - 65))

  // ================================================ 帧吸附
  check('geo.frameDuration', timelineFrameDuration(60), 1 / 60, tol)
  check('geo.frameDurationGuard', timelineFrameDuration(0), 1)
  check('geo.snappedFrame', snappedToProjectFrame(1.01, 1 / 60), Math.round(1.01 * 60) / 60, tol)
  check('geo.snappedFrameNaN', snappedToProjectFrame(NaN, 1 / 60), 0)

  // 首/尾半帧归到精确端点（保留非整数帧的媒体时长）
  check('geo.snappedTimelineHead', snappedTimelineTime(0.005, 10.008, 1 / 60), 0)
  check('geo.snappedTimelineTail', snappedTimelineTime(10.006, 10.008, 1 / 60), 10.008)
  check('geo.snappedTimelineMid', snappedTimelineTime(5.008, 10, 1 / 60), Math.round(5.008 * 60) / 60, tol)
  check('geo.snappedTimelineClamp', snappedTimelineTime(99, 10, 1 / 60), 10)

  check('geo.snappedEditableLower', snappedEditableTime(2.004, 2, 8, 1 / 60), 2)
  check('geo.snappedEditableUpper', snappedEditableTime(7.999, 2, 8, 1 / 60), 8)
  check('geo.stepped', steppedTimelineTime(1, 3, 1 / 30), 1 + 3 / 30, tol)

  // ================================================ 手授顺序归一
  const orderedClips = [
    makeClip({ id: 'a', startTime: 1, endTime: 2, scale: 1.6 }),
    makeClip({ id: 'b', startTime: 3, endTime: 4, scale: 1.6 }),
  ]
  const orderedResult = normalizeZoomClipOrder(orderedClips)
  check('order.identity', orderedResult.items === orderedClips, true)
  check('order.noSort', orderedResult.didSort, false)
  const inverted = [
    makeClip({ id: 'c', startTime: 5, endTime: 6, scale: 1.6 }),
    makeClip({ id: 'd', startTime: 2, endTime: 3, scale: 1.6 }),
  ]
  const invertedResult = normalizeZoomClipOrder(inverted)
  check('order.sorted', invertedResult.didSort, true)
  check('order.sortedFirst', invertedResult.items[0].id, 'd')
  // 起点相同按 id 字典序，保证确定性
  const tie = normalizeZoomClipOrder([
    makeClip({ id: 'z9', startTime: 1, endTime: 2, scale: 1.6 }),
    makeClip({ id: 'a1', startTime: 1, endTime: 2, scale: 1.6 }),
  ])
  check('order.tieByID', tie.items[0].id, 'a1')
  check('order.empty', normalizeZoomClipOrder([]).didSort, false)
  check('order.single', normalizeZoomClipOrder([orderedClips[0]]).didSort, false)
  // 运动轨同规则
  const motionTie = normalizeScreenMotionClipOrder([
    { id: 'mb', timing: makeTransitionTiming({ startTime: 2, duration: 1 }), target: { position: { x: 0.5, y: 0.5 }, scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, perspective: 0.65 } },
    { id: 'ma', timing: makeTransitionTiming({ startTime: 1, duration: 1 }), target: { position: { x: 0.5, y: 0.5 }, scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, perspective: 0.65 } },
  ])
  check('order.motionSorted', motionTie.items[0].id, 'ma')
  check('order.cameraEmpty', normalizeCameraMotionClipOrder([]).didSort, false)

  // ================================================ 磁吸
  const snap = new EditorTimelineMagneticSnap()
  const targets = () => [0, 5, 10]
  // 指针 4.95 落在 5 的 7pt 捕获内（10pt/s → capture 0.7s）
  check('snap.capture', snap.resolve(4.95, [0], 10, { targets }), 5, tol)
  check('snap.targetTime', snap.targetTime, 5)
  // 已吸住：指针微抖仍输出同一个吸附目标
  check('snap.held', snap.resolve(5.05, [0], 10, { targets }), 5, tol)
  // 超出 14pt 脱开半径（1.4s）→ 松开
  check('snap.escape', snap.resolve(6.6, [0], 10, { targets }), 6.6, tol)
  check('snap.released', snap.targetTime, null)
  // 初始边缘被屏蔽：起点就在 5 上时不吸自己
  const selfSnap = new EditorTimelineMagneticSnap()
  check('snap.selfSuppressed', selfSnap.resolve(5.0, [0], 10, { targets, initial: [5] }), 5, tol)
  check('snap.selfNoTarget', selfSnap.targetTime, null)
  // Shift 临时跳过
  check('snap.skip', snap.resolve(4.95, [0], 10, { targets, skipRequested: true }), 4.95, tol)
  // validate：合法落点没走到目标 → 释放
  const validated = new EditorTimelineMagneticSnap()
  validated.resolve(4.95, [0], 10, { targets })
  validated.validate([4.0])
  check('snap.validateReleased', validated.targetTime, null)
  const kept = new EditorTimelineMagneticSnap()
  kept.resolve(4.95, [0], 10, { targets })
  kept.validate([5.0])
  check('snap.validateKept', kept.targetTime, 5)
  // reset 清空候选缓存
  kept.reset()
  check('snap.reset', kept.targetTime, null)
  // 非法比例尺直接返回原值
  check('snap.invalidScale', new EditorTimelineMagneticSnap().resolve(1, [0], 0, { targets }), 1)
  // 移动模式两端参与：终点被吸到 10
  const moveSnap = new EditorTimelineMagneticSnap()
  const moved = moveSnap.resolve(8.95, [0, 1], 10, { targets })
  check('snap.offsetEdge', moved, 9, tol)
  check('snap.offsetTarget', moveSnap.targetTime, 10)

  // magneticTargets：端点收集 + 排除 + scrub
  const targetList = magneticTargets({
    duration: 20,
    primarySegments: [{ id: 'p1', outputStart: 0, outputDuration: 5 }],
    zoomClips: [{ id: 'z1', startTime: 2, endTime: 4 }],
    screenMotionClips: [{ id: 's1', startTime: 6, endTime: 8 }],
    cameraMotionClips: [{ id: 'c1', startTime: 9, endTime: 11 }],
    mosaicClips: [{ id: 'm1', startTime: 12, endTime: 13 }],
    stickerClips: [{ id: 'k1', startTime: 14, endTime: 15 }],
    playbackTime: 7,
    showsZoomTimeline: true,
    showsScreenMotionTimeline: true,
    showsCameraMotionTimeline: true,
    showsOverlayTimeline: true,
    excludedIDs: new Set(['m1']),
    isScrubbing: false,
  })
  check('snap.targetsHasZero', targetList.includes(0), true)
  check('snap.targetsHasDuration', targetList.includes(20), true)
  check('snap.targetsHasPrimaryEnd', targetList.includes(5), true)
  check('snap.targetsHasZoom', targetList.includes(2), true)
  check('snap.targetsHasPlayback', targetList.includes(7), true)
  check('snap.targetsExcluded', targetList.includes(12), false)
  check('snap.targetsHasSticker', targetList.includes(14), true)
  // scrub 时播放头不作为目标
  check('snap.targetsNoPlaybackWhileScrub', magneticTargets({
    ...{
      duration: 20,
      primarySegments: [],
      zoomClips: [],
      screenMotionClips: [],
      cameraMotionClips: [],
      mosaicClips: [],
      stickerClips: [],
      showsZoomTimeline: false,
      showsScreenMotionTimeline: false,
      showsCameraMotionTimeline: false,
      showsOverlayTimeline: false,
      excludedIDs: new Set(),
    },
    playbackTime: 7,
    isScrubbing: true,
  }).includes(7), false)
  // 隐藏轨道不贡献目标
  check('snap.targetsHiddenTrack', magneticTargets({
    duration: 20,
    primarySegments: [],
    zoomClips: [{ id: 'z1', startTime: 2, endTime: 4 }],
    screenMotionClips: [],
    cameraMotionClips: [],
    mosaicClips: [],
    stickerClips: [],
    playbackTime: 7,
    showsZoomTimeline: false,
    showsScreenMotionTimeline: false,
    showsCameraMotionTimeline: false,
    showsOverlayTimeline: false,
    excludedIDs: new Set(),
    isScrubbing: true,
  }).includes(2), false)

  // ================================================ 主轨呈现
  // 开头缺口：首段 sourceStart = 2
  const gapMap = mapWith([
    makeRecordingSegment({ id: 'g1', sourceStart: 2, sourceDuration: 3 }),
    makeRecordingSegment({ id: 'g2', sourceStart: 5, sourceDuration: 2 }),
  ])
  check('main.leadingGap', primaryLeadingGap(gapMap).removedDuration, 2, tol)
  check('main.leadingGapID', primaryLeadingGap(gapMap).nextSegmentID, 'g1')
  // 无缺口
  const noGapMap = mapWith([makeRecordingSegment({ id: 'n1', sourceStart: 0, sourceDuration: 5 })])
  check('main.noLeadingGap', primaryLeadingGap(noGapMap), null)
  // 结尾缺口：整段 10s，末段到 8
  check('main.trailingGap', primaryTrailingGap(noGapMap).removedDuration, 5, tol)
  check('main.trailingGapOutput', primaryTrailingGap(noGapMap).outputTime, 5, tol)
  const fullMap = mapWith([makeRecordingSegment({ id: 'f1', sourceStart: 0, sourceDuration: 10 })])
  check('main.noTrailingGap', primaryTrailingGap(fullMap), null)

  // 接缝：两段相邻但有源缺口
  const junctionMap = mapWith([
    makeRecordingSegment({ id: 'j1', sourceStart: 0, sourceDuration: 2 }),
    makeRecordingSegment({ id: 'j2', sourceStart: 3, sourceDuration: 2 }),
  ])
  const junctions = primarySegmentJunctions(junctionMap)
  check('main.junctionCount', junctions.length, 1)
  check('main.junctionRemoved', junctions[0].removedDuration, 1, tol)
  check('main.junctionOutput', junctions[0].outputTime, 2, tol)
  check('main.junctionHasGap', junctionHasRemovedSourceGap(junctions[0]), true)
  check('main.junctionID', junctionID(junctions[0]), 'j2')
  // 倒回剪切的接缝被跳过
  const reversedMap = mapWith([
    makeRecordingSegment({ id: 'r1', sourceStart: 5, sourceDuration: 2 }),
    makeRecordingSegment({ id: 'r2', sourceStart: 1, sourceDuration: 2 }),
  ])
  check('main.reversedSkipped', primarySegmentJunctions(reversedMap).length, 0)

  // 修剪草稿叠加：右侧修剪把输出时长缩短，后续片段左移
  const trimMap = mapWith([
    makeRecordingSegment({ id: 't1', sourceStart: 0, sourceDuration: 4, playbackRate: 1 }),
    makeRecordingSegment({ id: 't2', sourceStart: 4, sourceDuration: 2, playbackRate: 1 }),
  ])
  const trimDraft = makePrimarySegmentTrimDraft({
    segmentID: 't1',
    edge: 'right',
    original: trimMap.segments[0],
    proposedOutputTime: 2,
  })
  const trimmed = primaryDisplaySegments(trimMap, trimDraft, null)
  check('main.trimOutput', trimmed[0].outputStart + trimmed[0].sourceDuration, 2, tol)
  check('main.trimRipple', trimmed[1].outputStart, 2, tol)
  // 左侧修剪：源起点右移，源时长减少（乘 playbackRate）
  const leftDraft = makePrimarySegmentTrimDraft({
    segmentID: 't1', edge: 'left', original: trimMap.segments[0], proposedOutputTime: 1,
  })
  const leftTrimmed = primaryDisplaySegments(trimMap, leftDraft, null)
  check('main.trimLeftSource', leftTrimmed[0].sourceStart, 1, tol)
  check('main.trimLeftDuration', leftTrimmed[0].sourceDuration, 3, tol)
  // 变速草稿夹取
  const retimed = primaryDisplaySegments(trimMap, null, {
    segmentID: 't2', original: trimMap.segments[1], proposedRate: 1000,
  })
  check('main.retimeClamp', retimed[1].playbackRate, 100)
  // 草稿指向不存在的片段 → 原样返回
  const missingDraft = makePrimarySegmentTrimDraft({
    segmentID: 'nope', edge: 'right', original: trimMap.segments[0], proposedOutputTime: 1,
  })
  check('main.draftMissing', primaryDisplaySegments(trimMap, missingDraft, null), trimMap.segments)

  // trimDraftOrigin：两侧可还原余量
  const originDraft = primaryTrimDraftOrigin({
    segmentID: 't2', edge: 'left', map: trimMap, fullSourceDuration: 10,
  })
  check('main.originMinimum', originDraft.minimumOutputTime, 4, tol)
  // 整段源素材 0~10s，t2 只用到 4~6 → 右侧还能还原 4s
  check('main.originMaximum', originDraft.maximumOutputTime, 10, tol)

  // snappedCutX：切点命中片段边界
  const cutMap = mapWith([
    makeRecordingSegment({ id: 'c1', sourceStart: 0, sourceDuration: 5 }),
    makeRecordingSegment({ id: 'c2', sourceStart: 5, sourceDuration: 5 }),
  ])
  const cutX = primarySnappedCutX({
    pointerX: 253, width: 500, duration: 10, segments: cutMap.segments, playbackTime: 8,
  })
  check('main.cutSnapToBoundary', cutX, 250, tol)
  // 无片段边界可吸 → 回落播放头
  const cutPlayback = primarySnappedCutX({
    pointerX: 402, width: 500, duration: 10,
    segments: [makeRecordingSegment({ id: 'c3', sourceStart: 0, sourceDuration: 10 })],
    playbackTime: 8,
  })
  check('main.cutSnapToPlayback', cutPlayback, 400, tol)
  // 都不命中 → 原值
  check('main.cutRaw', primarySnappedCutX({
    pointerX: 300, width: 500, duration: 10,
    segments: [makeRecordingSegment({ id: 'c4', sourceStart: 0, sourceDuration: 10 })],
    playbackTime: 1,
  }), 300)

  // 增量修剪：保留最短时长
  const trimSegment = cutMap.segments[0]
  // 未给 maximumOutputTime 时不能扩张到自身之外
  check('main.trimNoExpand', trimOutputTimeFromTranslation({
    segment: trimSegment, edge: 'right', translation: 50, laneWidth: 500,
    outputDuration: 10, minimumSegmentDuration: 0.16,
  }), 5, tol)
  check('main.trimTranslation', trimOutputTimeFromTranslation({
    segment: trimSegment, edge: 'right', translation: 50, laneWidth: 500,
    outputDuration: 10, minimumSegmentDuration: 0.16, maximumOutputTime: 8,
  }), 6, tol)
  // 缩到负 → 保留 0.16
  check('main.trimRetained', trimOutputTimeFromTranslation({
    segment: trimSegment, edge: 'right', translation: -500, laneWidth: 500,
    outputDuration: 10, minimumSegmentDuration: 0.16,
  }), 0.16, tol)
  // 左边缘向右拖 → 起点右移
  check('main.trimLeft', trimOutputTimeFromTranslation({
    segment: trimSegment, edge: 'left', translation: 100, laneWidth: 500,
    outputDuration: 10, minimumSegmentDuration: 0.16,
  }), 2, tol)

  // 预览相位：右边缘显示最后一帧（proposed − frame）
  const previewDraft = makePrimarySegmentTrimDraft({
    segmentID: 'c1', edge: 'right', original: trimSegment, proposedOutputTime: 3,
  })
  check('main.previewRight', trimPreviewTime(previewDraft, 0.1), 2.9, tol)
  const leftPreviewDraft = makePrimarySegmentTrimDraft({
    segmentID: 'c1', edge: 'left', original: trimSegment, proposedOutputTime: 3,
  })
  check('main.previewLeft', trimPreviewTime(leftPreviewDraft, 0.1), 3, tol)

  // 绝对位置修剪
  check('main.trimPointer', trimOutputTimeFromPointerX({
    segment: trimSegment, edge: 'right', pointerX: 300, laneWidth: 500,
    outputDuration: 10, minimumSegmentDuration: 0.16, maximumOutputTime: 8,
  }), 6, tol)

  // ================================================ 缩放锚点
  const anchor = new EditorTimelineZoomAnchor({
    pointerViewportX: 100, contentOffsetX: 0, contentWidth: 500, targetContentWidth: 1000,
  })
  // 语义时刻 = 100/500 = 20% → 新偏移 200 − 100 = 100
  check('zoom.anchorFraction', anchor.contentFraction, 0.2, tol)
  check('zoom.anchorOffset', anchor.scrollOffset(500), 100, tol)
  // 上限夹取
  check('zoom.anchorClamp', new EditorTimelineZoomAnchor({
    pointerViewportX: 0, contentOffsetX: 0, contentWidth: 500, targetContentWidth: 500,
  }).scrollOffset(500), 0)
  check('zoom.min', EDITOR_TIMELINE_MINIMUM_ZOOM, 1)
  check('zoom.max', EDITOR_TIMELINE_MAXIMUM_ZOOM, 4096)
  check('zoom.clampLow', clampedTimelineZoom(0.1), 1)
  check('zoom.clampHigh', clampedTimelineZoom(99999), 4096)
  check('zoom.clampNaN', clampedTimelineZoom(NaN), 1)
  // 每单位 deltaY 缩放 1.24 倍
  check('zoom.wheel', timelineZoomTargetFromWheel(1, 1), 1.24, tol)
  check('zoom.wheelClamp', timelineZoomTargetFromWheel(4000, 10), 4096)

  // 输入合并器：累计而非替换
  const coalescer = new EditorTimelineZoomInputCoalescer()
  let scheduled = 0
  coalescer.enqueueWheel(1, 1, 100, () => { scheduled += 1 })
  coalescer.enqueueWheel(1, 1, 200, () => { scheduled += 1 })
  check('zoom.coalesceScheduleOnce', scheduled, 1)
  const flushed = coalescer.flush()
  // 1 × 1.24 × 1.24
  check('zoom.coalesceAccumulated', flushed.targetZoom, 1.24 * 1.24, tol)
  check('zoom.coalescePointer', flushed.pointerViewportX, 200)
  check('zoom.coalesceEmpty', coalescer.flush(), null)
  // 绝对目标也夹取
  const absolute = new EditorTimelineZoomInputCoalescer()
  absolute.enqueueTarget(99999, null, () => {})
  check('zoom.coalesceAbsolute', absolute.flush().targetZoom, 4096)
  // cancel 丢弃
  const cancelled = new EditorTimelineZoomInputCoalescer()
  cancelled.enqueueTarget(2, null, () => {})
  cancelled.cancel()
  check('zoom.coalesceCancel', cancelled.flush(), null)

  // 目标偏移：视口宽 × 缩放
  const zoomTarget = timelineZoomTargetScrollOffset({
    requestedZoom: 2, viewportWidth: 500, currentContentWidth: 500,
    currentContentOffsetX: 0, pointerViewportX: 250,
  })
  check('zoom.targetWidth', zoomTarget.targetContentWidth, 1000, tol)
  // 锚点在视口中心 → 新偏移 = 500 − 250 = 250
  check('zoom.targetOffset', zoomTarget.scrollOffsetX, 250, tol)
  check('zoom.fallbackViewportX', fallbackTimelineZoomViewportX({
    contentWidth: 500, viewportWidth: 500, contentOffset: 0,
  }), 250, tol)

  // ================================================ 叠加轨命名
  check('ov.mosaicMove', overlayMoveActionName('mosaic'), '移动打码')
  check('ov.stickerMove', overlayMoveActionName('sticker'), '移动贴图')
  check('ov.mosaicResize', overlayResizeActionName('mosaic'), '调整打码时长')
  check('ov.stickerResize', overlayResizeActionName('sticker'), '调整贴图时长')

  // ================================================ 选择策略
  check('sel.primaryID', primarySegmentIDFromSelection({ kind: 'primarySegment', id: 'x' }), 'x')
  check('sel.primaryIDNone', primarySegmentIDFromSelection({ kind: 'canvas' }), null)
  check('sel.primaryIDsFull', primarySegmentIDs(makeProjectTimeline())[0].length > 0, true)
  const editedTimeline = makeProjectTimeline({
    sourceSequence: {
      kind: 'edited',
      segments: [makeRecordingSegment({ id: 'e1', sourceStart: 0, sourceDuration: 3 })],
    },
  })
  check('sel.primaryIDsEdited', primarySegmentIDs(editedTimeline).join(','), 'e1')
  // 已删除的片段 id → 回退画布
  check('sel.reconcileRemoved', reconcilingPrimarySelection(
    { kind: 'primarySegment', id: 'gone' }, editedTimeline
  ).kind, 'canvas')
  check('sel.reconcileKept', reconcilingPrimarySelection(
    { kind: 'primarySegment', id: 'e1' }, editedTimeline
  ).kind, 'primarySegment')
  // 非主片段选择原样返回
  check('sel.reconcileOther', reconcilingPrimarySelection({ kind: 'canvas' }, editedTimeline).kind, 'canvas')

  check('sel.deleteTarget', timelineDeleteTarget({ kind: 'zoom', id: 'q' }).kind, 'zoom')
  check('sel.deleteTargetNone', timelineDeleteTarget({ kind: 'zoomTrack' }), null)
  check('sel.splitTarget', timelineSplitTarget({ kind: 'sticker', id: 'k' }).kind, 'sticker')
  // 主片段不能拆（S 键回落到主轨拆分）
  check('sel.splitTargetPrimary', timelineSplitTarget({ kind: 'primarySegment', id: 'p' }), null)

  // 选中揭示：播放头已在片段内 → 不移动
  const revealProject = {
    ...makeRecorderProject(),
    canvas: makeCanvasStyle(),
    camera: makeCameraStyle(),
    audio: makeAudioStyle(),
    cursorStyle: makeCursorStyle(),
    motion: makeMotionStyle(),
    openingSequence: makeOpeningSequence(),
    timeline: makeProjectTimeline({
      zoomClips: [makeClip({ id: 'rv', startTime: 2, endTime: 5, scale: 1.6, enterDuration: 0.7 })],
    }),
  }
  check('sel.revealInside', timelineSelectionRevealTime({
    selection: { kind: 'zoom', id: 'rv' }, project: revealProject, currentTime: 3,
  }), null)
  // 播放头在片段外 → 跳到进入完成点
  check('sel.revealOutside', timelineSelectionRevealTime({
    selection: { kind: 'zoom', id: 'rv' }, project: revealProject, currentTime: 9,
  }), 2.7, tol)
  // 未命中选择 → null
  check('sel.revealMissing', timelineSelectionRevealTime({
    selection: { kind: 'zoom', id: 'none' }, project: revealProject, currentTime: 0,
  }), null)

  // ================================================ 手势意图
  check('gesture.scrubSeeks', gestureSeeksDuringDrag({ kind: 'scrub' }), true)
  check('gesture.zoomMoveNoSeek', gestureSeeksDuringDrag({ kind: 'zoomMove', id: 'z' }), false)
  check('gesture.trimSeeks', gestureSeeksDuringDrag({ kind: 'primaryTrim', id: 'p', edge: 'left' }), true)
  check('gesture.equalsTrim', gestureIntentEquals(
    { kind: 'primaryTrim', id: 'p', edge: 'left' },
    { kind: 'primaryTrim', id: 'p', edge: 'left' }
  ), true)
  check('gesture.differsTrimEdge', gestureIntentEquals(
    { kind: 'primaryTrim', id: 'p', edge: 'left' },
    { kind: 'primaryTrim', id: 'p', edge: 'right' }
  ), false)
  check('gesture.equalsResize', gestureIntentEquals(
    { kind: 'zoomResize', id: 'z', leading: true },
    { kind: 'zoomResize', id: 'z', leading: false }
  ), false)

  // 所有权：先到先得，跨意图抢占失败，同意图重入成功
  const ownership = new EditorTimelineGestureOwnership()
  check('gesture.beginFirst', ownership.begin({ kind: 'zoomCreate' }), true)
  check('gesture.blockOther', ownership.begin({ kind: 'zoomMove', id: 'z' }), false)
  check('gesture.reenterSame', ownership.begin({ kind: 'zoomCreate' }), true)
  check('gesture.activeKind', ownership.activeIntent.kind, 'zoomCreate')
  ownership.end({ kind: 'zoomMove', id: 'z' })
  check('gesture.endMismatchKeeps', ownership.activeIntent.kind, 'zoomCreate')
  ownership.end({ kind: 'zoomCreate' })
  check('gesture.ended', ownership.activeIntent, null)
  ownership.begin({ kind: 'overlayCreate' })
  ownership.cancel()
  check('gesture.cancelled', ownership.activeIntent, null)

  // 重排草稿
  const reorderMap = mapWith([
    makeRecordingSegment({ id: 'a', sourceStart: 0, sourceDuration: 2 }),
    makeRecordingSegment({ id: 'b', sourceStart: 2, sourceDuration: 2 }),
    makeRecordingSegment({ id: 'c', sourceStart: 4, sourceDuration: 2 }),
  ])
  const draft = PrimarySegmentReorderDraft.make('a', reorderMap.segments)
  check('reorder.initialIndex', draft.destination, 0)
  check('reorder.initialInsertion', draft.insertionTime, 0)
  // 向右拖过 b 的中心（位移 3s > 1+1）
  draft.update(3)
  check('reorder.movedIndex', draft.destination, 1)
  check('reorder.newOrder', draft.segments.map((s) => s.id).join(','), 'b,a,c')
  check('reorder.newStarts', draft.segments.map((s) => s.outputStart).join(','), '0,2,4')
  // 拖到最右
  draft.update(99)
  check('reorder.lastIndex', draft.destination, 2)
  check('reorder.missing', PrimarySegmentReorderDraft.make('nope', reorderMap.segments), null)

}

runTimelineGeometryBatch()

async function runMediaAnalysisBatch() {
  const {
    EMPTY_MEDIA_INVENTORY, MediaAnalysisError, MediaWaveformSession,
    MEDIA_ANALYZER_DEFAULT_SAMPLE_COUNT, TimestampedWaveformAccumulator,
    inventoryHasAudio, inventoryHasVideo, makeMediaAssetInventory,
    mediaAnalysisErrorMessage, mediaInventoryEquals, mediaInventoryFromProbe,
    waveformFrameBoundary,
    CameraLetterboxCache, LETTERBOX_LUMA_B, LETTERBOX_LUMA_G, LETTERBOX_LUMA_R,
    LETTERBOX_MINIMUM_DURATION, LETTERBOX_SAMPLE_FRACTIONS, analyzeCameraLetterbox,
    cameraLetterboxMediaVersion, cameraLetterboxMediaVersionKey, centralDetailedBand,
    conservativeBounds, contentBounds, coreImageCropRect, croppedDisplaySize,
    croppedOriginTranslation, downsampleToLetterboxGrid, letterboxGridDimension,
    letterboxLumaProfile, letterboxSampleTimes, medianArea, stableCrop,
    CAMERA_TIMESTAMP_REPAIRED_SUFFIX, PROJECT_OPEN_WARNING, PROJECT_PACKAGE_ENTRY_FILE,
    loadProjectOpenSnapshot, normalizeProjectPackagePath, originalCameraRecordingPath,
    snapshotIsSaved, zoomClipArraysEqual,
    LEGACY_CURSOR_SPRING, LEGACY_MOTION_UPGRADE_TOLERANCE, LEGACY_SCREEN_SPRING,
    UPGRADED_CURSOR_SPRING, UPGRADED_SCREEN_SPRING, motionStyleEquals,
    upgradeLegacyMotionDefaults,
    bucketIndex, makeRecorderProject, makeCanvasStyle, makeMotionStyle,
    makeProjectTimeline, makeProjectMediaManifest, makeProjectMediaReference,
    makeStickerClip,
  } = m

  // ================================================ MediaAnalysis（Swift 327 行）
  check('ma.defaultSampleCount', MEDIA_ANALYZER_DEFAULT_SAMPLE_COUNT, 160)
  check('ma.emptyDuration', EMPTY_MEDIA_INVENTORY.duration, 0)
  check('ma.emptyHasVideo', inventoryHasVideo(EMPTY_MEDIA_INVENTORY), false)
  check('ma.emptyHasAudio', inventoryHasAudio(EMPTY_MEDIA_INVENTORY), false)
  check('ma.videoFrameRateDefault', EMPTY_MEDIA_INVENTORY.videoFrameRate, null)

  // bucketIndex：Swift L28-38
  check('ma.bucketMid', bucketIndex({ start: 0, end: 10 }, 5, 160), 80)
  check('ma.bucketStart', bucketIndex({ start: 0, end: 10 }, 0, 160), 0)
  check('ma.bucketAtEnd', bucketIndex({ start: 0, end: 10 }, 10, 160), null)
  check('ma.bucketBeforeStart', bucketIndex({ start: 2, end: 10 }, 1.9, 160), null)
  check('ma.bucketZeroCount', bucketIndex({ start: 0, end: 10 }, 5, 0), null)
  check('ma.bucketNaN', bucketIndex({ start: 0, end: 10 }, NaN, 160), null)

  // 错误文案逐字照搬
  check('ma.errMissing', mediaAnalysisErrorMessage('missingAudioTrack'), '媒体中没有可用的音频轨。')
  check('ma.errCannotRead', mediaAnalysisErrorMessage('cannotReadAudio'), '无法创建音频读取器。')
  check('ma.errFormat', mediaAnalysisErrorMessage('unsupportedAudioFormat'), '音频轨格式无法用于波形分析。')
  check('ma.errRange', mediaAnalysisErrorMessage('invalidAudioTimeRange'), '音频轨的时间范围为空或无效。')
  check('ma.errReader', mediaAnalysisErrorMessage('readerFailed', 'boom'), '音频分析失败：boom')
  const maErr = new MediaAnalysisError('readerFailed', '磁盘坏道')
  check('ma.errIsError', maErr instanceof Error, true)
  check('ma.errKind', maErr.kind, 'readerFailed')
  check('ma.errMessage', maErr.message, '音频分析失败：磁盘坏道')

  // TimestampedWaveformAccumulator（L49-172）
  const waveRange = { start: 0, end: 1 }
  const acc = new TimestampedWaveformAccumulator(waveRange, 10)
  check('ma.accCount', acc.sampleCount, 10)
  check('ma.accZeroSampleClamped', new TimestampedWaveformAccumulator(waveRange, 0).sampleCount, 1)
  acc.record(0.5, 0.35)
  check('ma.accBucket3', acc.peaks[3], 0.5)
  acc.record(0.2, 0.35)
  check('ma.accKeepsMax', acc.peaks[3], 0.5)
  acc.record(0.9, 0.32)
  check('ma.accSameBucket', acc.peaks[3], 0.9)
  acc.record(0.9, 1.0)
  acc.record(-1, 0.05)
  acc.record(NaN, 0.05)
  check('ma.accGuardedTotal', acc.peaks.reduce((s, v) => s + v, 0), 0.9)
  // normalizedSamples：噪声底 0.012 + pow(x, 0.95)
  const expectedCurve = Math.pow((0.9 - 0.012) / (1 - 0.012), 0.95)
  check('ma.accCurve', acc.normalizedSamples[3], expectedCurve, 1e-12)
  check('ma.accSilence', acc.normalizedSamples[0], 0)
  const accFloor = new TimestampedWaveformAccumulator(waveRange, 4)
  accFloor.record(0.012, 0.1)
  check('ma.accFloorZero', accFloor.normalizedSamples[0], 0)

  // waveformFrameBoundary（L150-161）：容差 max(|raw|,1)*eps*16
  check('ma.frameExact', waveformFrameBoundary(0.1, 0.1, 48000, 4800), 0)
  check('ma.frameJustBelow', waveformFrameBoundary(0.1 + 4799.999999999 / 48000, 0.1, 48000, 4800), 4800)
  check('ma.frameClampLow', waveformFrameBoundary(-5, 0.1, 48000, 4800), 0)
  check('ma.frameClampHigh', waveformFrameBoundary(10, 0.1, 48000, 4800), 4800)
  const toleranceAt4800 = Math.max(Math.abs(4800), 1) * Number.EPSILON * 16
  check('ma.frameTolerance', toleranceAt4800, 4800 * 2.220446049250313e-16 * 16, 1e-18)

  // recordInterleavedPCM（L78-148）：10 帧 / 10 桶 / 单声道
  const pcmMono = new Int16Array(10)
  for (let i = 0; i < 10; i++) pcmMono[i] = (i + 1) * 1000
  const accPcm = new TimestampedWaveformAccumulator(waveRange, 10)
  accPcm.recordInterleavedPCM(pcmMono, 1, 10, 0)
  check('ma.pcmFirstBucket', accPcm.peaks[0], 1000 / 32768, 1e-12)
  check('ma.pcmLastBucket', accPcm.peaks[9], 10000 / 32768, 1e-12)
  check('ma.pcmBuckets', accPcm.peaks.filter((v) => v > 0).length, 10)

  // 立体声：最大值跨声道取
  const pcmStereo = new Int16Array(20)
  for (let i = 0; i < 10; i++) {
    pcmStereo[i * 2] = 1000 * (i + 1)
    pcmStereo[i * 2 + 1] = -30000
  }
  const accStereo = new TimestampedWaveformAccumulator(waveRange, 10)
  accStereo.recordInterleavedPCM(pcmStereo, 2, 10, 0)
  check('ma.stereoMax', accStereo.peaks[0], 30000 / 32768, 1e-12)

  // 守卫：channels=0 / sampleRate=0 / 空缓冲 / 非有限 presentationTime
  const accGuard = new TimestampedWaveformAccumulator(waveRange, 10)
  accGuard.recordInterleavedPCM(pcmMono, 0, 10, 0)
  accGuard.recordInterleavedPCM(pcmMono, 1, 0, 0)
  accGuard.recordInterleavedPCM(new Int16Array(0), 1, 10, 0)
  accGuard.recordInterleavedPCM(pcmMono, 1, 10, NaN)
  check('ma.guardsNoWrite', accGuard.peaks.reduce((s, v) => s + v, 0), 0)
  // 缓冲完全落在时间区间之外
  const accOut = new TimestampedWaveformAccumulator(waveRange, 10)
  accOut.recordInterleavedPCM(pcmMono, 1, 10, 5)
  check('ma.outOfRangeNoWrite', accOut.peaks.reduce((s, v) => s + v, 0), 0)
  // 取消回调：bucket 0 与 64 各触发一次
  const accCancel = new TimestampedWaveformAccumulator({ start: 0, end: 1 }, 200)
  let cancelCalls = 0
  accCancel.recordInterleavedPCM(new Int16Array(200), 1, 200, 0, {
    checkCancellation: () => {
      cancelCalls++
    }
  })
  check('ma.cancelCalls', cancelCalls, 4) // 0,64,128,192

  // MediaWaveformSession（L281-314 循环骨架）
  const session = new MediaWaveformSession(waveRange, 10)
  session.append(pcmMono, 1, 10, NaN)
  session.append(new Int16Array(0), 1, 10, 0)
  session.append(pcmMono, 1, 10, 0)
  check('ma.sessionPeak', session.finish()[9], Math.pow((10000 / 32768 - 0.012) / (1 - 0.012), 0.95), 1e-12)

  // mediaInventoryFromProbe（L212-229）
  const invFull = mediaInventoryFromProbe({
    assetDuration: 3,
    videoTimeRange: { start: 0, end: 4 },
    audioTimeRange: { start: 0, end: 6 },
    videoWidth: 1920.4,
    videoHeight: 1080.6,
    videoFrameRate: 59.94
  })
  check('ma.invDurationMax', invFull.duration, 6)
  check('ma.invWidthRounded', invFull.videoWidth, 1920)
  check('ma.invHeightRounded', invFull.videoHeight, 1081)
  check('ma.invFrameRate', invFull.videoFrameRate, 59.94)
  const invNoVideo = mediaInventoryFromProbe({
    assetDuration: NaN,
    videoTimeRange: null,
    audioTimeRange: { start: 0, end: 2.5 },
    videoWidth: 800,
    videoHeight: 600,
    videoFrameRate: 30
  })
  check('ma.invNaNRange', invNoVideo.duration, 2.5)
  check('ma.invNoVideoWidth', invNoVideo.videoWidth, null)
  check('ma.invNoVideoRate', invNoVideo.videoFrameRate, null)
  const invZeroSize = mediaInventoryFromProbe({
    assetDuration: 1,
    videoTimeRange: { start: 0, end: 1 },
    audioTimeRange: null,
    videoWidth: 0,
    videoHeight: 720,
    videoFrameRate: 0
  })
  check('ma.invZeroWidth', invZeroSize.videoWidth, null)
  check('ma.invZeroRate', invZeroSize.videoFrameRate, null)
  check('ma.invEquals', mediaInventoryEquals(invFull, { ...invFull }), true)
  check(
    'ma.invNotEquals',
    mediaInventoryEquals(invFull, { ...invFull, duration: 7 }),
    false
  )
  check(
    'ma.invFactory',
    mediaInventoryEquals(makeMediaAssetInventory({ duration: 0 }), EMPTY_MEDIA_INVENTORY),
    true
  )

  // ================================================ CameraLetterboxAnalysis（Swift 335 行）
  check('lb.lumaR', LETTERBOX_LUMA_R, 0.2126)
  check('lb.lumaSum', LETTERBOX_LUMA_R + LETTERBOX_LUMA_G + LETTERBOX_LUMA_B, 1, 1e-12)
  check('lb.minDuration', LETTERBOX_MINIMUM_DURATION, 0.2)
  const grid1080 = letterboxGridDimension(1920, 1080)
  check('lb.gridWidth', grid1080.gridWidth, 360)
  check('lb.gridHeight', grid1080.gridHeight, 203) // round(1080/1920*360) = round(202.5)
  const gridSmall = letterboxGridDimension(40, 40)
  check('lb.gridSmallWidth', gridSmall.gridWidth, 40)
  check('lb.gridSmallHeight', gridSmall.gridHeight, 40)
  check('lb.gridInvalid', letterboxGridDimension(0, 10), null)

  // conservativeBounds（L195-206）：确认有黑边的一侧内收一格
  const spanFull = conservativeBounds({ first: 0, last: 9 }, 10)
  check('lb.spanFullStart', spanFull.start, 0)
  check('lb.spanFullEnd', spanFull.end, 1)
  const spanTop = conservativeBounds({ first: 2, last: 9 }, 10)
  check('lb.spanTopStart', spanTop.start, 0.3)
  const spanBottom = conservativeBounds({ first: 0, last: 5 }, 10)
  check('lb.spanBottomEnd', spanBottom.end, 0.5)

  // centralDetailedBand（L221-265）
  check('lb.bandTooShort', centralDetailedBand([0, 0, 0, 0, 0, 0, 0]), null)
  check('lb.bandFlat', centralDetailedBand(new Array(20).fill(0)), null)
  const detailGap = new Array(20).fill(0)
  for (let i = 5; i <= 8; i++) detailGap[i] = 10
  for (let i = 11; i <= 14; i++) detailGap[i] = 10
  const bandGap = centralDetailedBand(detailGap)
  check('lb.bandBridgedFirst', bandGap.first, 4)
  check('lb.bandBridgedLast', bandGap.last, 15)

  // contentBounds：合成 40x40，白色内容块 rows 10..29 / cols 5..34
  const makeRaster = (width, height, paint) => {
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4
        const value = paint(x, y) ? 255 : 0
        pixels[o] = value
        pixels[o + 1] = value
        pixels[o + 2] = value
        pixels[o + 3] = 255
      }
    }
    return { width, height, pixels }
  }
  const insideBox = makeRaster(40, 40, (x, y) => y >= 10 && y <= 29 && x >= 5 && x <= 34)
  const boxCrop = contentBounds(insideBox)
  check('lb.boxX', boxCrop.x, 0.15) // (5+1)/40
  check('lb.boxY', boxCrop.y, 0.275) // (10+1)/40
  check('lb.boxWidth', boxCrop.width, 0.7) // 34/40 - 6/40
  check('lb.boxHeight', boxCrop.height, 0.45) // 29/40 - 11/40
  // 满幅内容：没有黑边 → 返回 null（调用方按原样使用素材）
  check('lb.fullFrameNull', contentBounds(makeRaster(40, 40, () => true)), null)
  // 全黑：无内容 → null
  check('lb.blackNull', contentBounds(makeRaster(40, 40, () => false)), null)
  check('lb.invalidImage', contentBounds({ width: 0, height: 0, pixels: new Uint8ClampedArray(0) }), null)

  // 竖屏分支：20x80，纹理带在 rows 30..49（棋盘列）
  const portraitTextured = makeRaster(20, 80, (x, y) => y >= 30 && y <= 49 && x % 2 === 1)
  const portraitCrop = contentBounds(portraitTextured)
  check('lb.portraitX', portraitCrop.x, 0)
  // 纹理带 rows 30..49，radius=2 平滑后 active 覆盖 28..51
  check('lb.portraitY', portraitCrop.y, 0.3625) // (28+1)/80
  check('lb.portraitWidth', portraitCrop.width, 1)
  check('lb.portraitHeight', portraitCrop.height, 0.275) // 51/80 - 29/80

  // letterboxLumaProfile：行/列均值与行细节
  const profileOfBox = letterboxLumaProfile(insideBox.pixels, 40, 40)
  check('lb.profileRow', profileOfBox.rowLuma[10], 191.25) // 255*30/40
  check('lb.profileCol', profileOfBox.colLuma[5], 127.5) // 255*20/40
  // 内容块左右各一次 0→255 跳变：2*255/39
  check('lb.profileDetail', profileOfBox.rowDetail[10], 510 / 39) // 13.0769…
  const profileOfPortrait = letterboxLumaProfile(portraitTextured.pixels, 20, 80)
  check('lb.portraitDetail', profileOfPortrait.rowDetail[30], 255)

  // 下采样：2x2 → 1x1 等权平均
  const tiny = makeRaster(2, 2, () => false)
  for (let i = 0; i < 4; i++) {
    tiny.pixels[i * 4] = 100
    tiny.pixels[i * 4 + 3] = 255
  }
  const gridTiny = downsampleToLetterboxGrid(tiny, 1, 1)
  check('lb.downsampleR', gridTiny[0], 100)

  // stableCrop（L270-299）：离群帧不能带动全片取景
  const stableBase = { x: 0.1, y: 0.2, width: 0.6, height: 0.5 }
  const candidates = [
    stableBase,
    stableBase,
    stableBase,
    { ...stableBase },
    { x: 0.9, y: 0.0, width: 0.1, height: 1 }
  ]
  const stable = stableCrop(candidates)
  check('lb.stableX', stable.x, 0.1)
  check('lb.stableY', stable.y, 0.2)
  check('lb.stableWidth', stable.width, 0.6)
  check('lb.stableHeight', stable.height, 0.5)
  check('lb.stableEmpty', stableCrop([]), null)
  // 等量簇时取中位面积更小的那个
  const tie = stableCrop([
    { x: 0, y: 0, width: 1, height: 0.5 },
    { x: 0, y: 0, width: 1, height: 0.5 },
    { x: 0.4, y: 0, width: 0.3, height: 0.2 },
    { x: 0.4, y: 0, width: 0.3, height: 0.2 }
  ])
  check('lb.stableTieHeight', tie.height, 0.2)
  check('lb.medianAreaEmpty', medianArea([]) === Infinity, true)
  // Swift `areas[areas.count / 2]`：偶数个取上中位数 → 0.5
  check('lb.medianArea', medianArea([{ width: 1, height: 0.5 }, { width: 1, height: 0.1 }]), 0.5)

  // Core Image y 轴翻转（L318-328）
  const ciRect = coreImageCropRect(
    { x: 0, y: 0, width: 100, height: 200 },
    { x: 0.1, y: 0.25, width: 0.5, height: 0.5 }
  )
  check('lb.ciX', ciRect.x, 10)
  check('lb.ciY', ciRect.y, 50) // 200*(1-0.25-0.5)
  check('lb.ciWidth', ciRect.width, 50)
  check('lb.ciHeight', ciRect.height, 100)
  const ciMoved = croppedOriginTranslation(
    { x: 0, y: 0, width: 100, height: 200 },
    { x: 0.1, y: 0.25, width: 0.5, height: 0.5 }
  )
  check('lb.ciTranslateX', ciMoved.x, -10)
  check('lb.ciTranslateY', ciMoved.y, -50)
  const displaySize = croppedDisplaySize({ width: 1000, height: 800 }, { x: 0, y: 0, width: 0.5, height: 0.25 })
  check('lb.displayWidth', displaySize.width, 500)
  check('lb.displayHeight', displaySize.height, 200)
  check('lb.displayNullCrop', croppedDisplaySize({ width: 10, height: 20 }, null).width, 10)
  check('lb.displayNullSize', croppedDisplaySize(null, { x: 0, y: 0, width: 1, height: 1 }), null)

  // 采样时间点（L84-95）：0.1 … 0.9
  check('lb.fractionCount', LETTERBOX_SAMPLE_FRACTIONS.length, 9)
  check('lb.fractionLast', LETTERBOX_SAMPLE_FRACTIONS[8], 0.9)
  check('lb.sampleMid', letterboxSampleTimes(10)[4], 5)
  // 时长不足 0.2s 直接放弃
  let sampleCalls = 0
  const shortResult = await analyzeCameraLetterbox(0.1, () => {
    sampleCalls++
    return null
  })
  check('lb.shortNull', shortResult, null)
  check('lb.shortNoSample', sampleCalls, 0)
  const sampled = await analyzeCameraLetterbox(10, (time) => (time >= 1 && time <= 9 ? insideBox : null))
  check('lb.sampledY', sampled.y, 0.275)
  const cancelled = await analyzeCameraLetterbox(
    10,
    () => insideBox,
    { isCancelled: () => true }
  )
  check('lb.cancelledNull', cancelled, null)

  // 缓存：同版本只分析一次、nil 结果也缓存、超容量按插入顺序淘汰（L27-48）
  const lbCache = new CameraLetterboxCache(2)
  let analyzeCalls = 0
  const versionA = cameraLetterboxMediaVersion('/a.mov', { size: 10n })
  const versionA2 = cameraLetterboxMediaVersion('/a.mov', { size: 10n })
  const versionB = cameraLetterboxMediaVersion('/a.mov', { size: 11n })
  const versionC = cameraLetterboxMediaVersion('/a.mov', { size: 12n })
  check('lb.versionKeyEqual', cameraLetterboxMediaVersionKey(versionA), cameraLetterboxMediaVersionKey(versionA2))
  await lbCache.value(versionA, async () => {
    analyzeCalls++
    return null
  })
  await lbCache.value(versionA2, async () => {
    analyzeCalls++
    return null
  })
  check('lb.cacheSingleFlight', analyzeCalls, 1)
  check('lb.cacheSize', lbCache.size, 1)
  await lbCache.value(versionB, async () => null)
  await lbCache.value(versionC, async () => null)
  check('lb.cacheEvicted', lbCache.size, 2)
  lbCache.clear()
  check('lb.cacheCleared', lbCache.size, 0)

  // ================================================ LegacyMotionDefaultsUpgrade
  check('lm.tolerance', LEGACY_MOTION_UPGRADE_TOLERANCE, 0.000001)
  const legacyMotion = makeMotionStyle({
    screenSpringMass: 1,
    screenSpringStiffness: 180,
    screenSpringDamping: 24,
    cursorSpringMass: 1,
    cursorSpringStiffness: 260,
    cursorSpringDamping: 30,
    defaultZoomEasing: '三次方缓动',
    defaultZoomTransitionDuration: 0.55
  })
  const upgradedMotion = upgradeLegacyMotionDefaults(legacyMotion)
  check('lm.screenMass', upgradedMotion.screenSpringMass, UPGRADED_SCREEN_SPRING.mass)
  check('lm.screenStiffness', upgradedMotion.screenSpringStiffness, 210)
  check('lm.screenDamping', upgradedMotion.screenSpringDamping, 42)
  check('lm.cursorMass', upgradedMotion.cursorSpringMass, UPGRADED_CURSOR_SPRING.mass)
  check('lm.cursorStiffness', upgradedMotion.cursorSpringStiffness, 450)
  check('lm.cursorDamping', upgradedMotion.cursorSpringDamping, 66)
  check('lm.easing', upgradedMotion.defaultZoomEasing, '弹簧')
  check('lm.duration', upgradedMotion.defaultZoomTransitionDuration, 0.7)
  check('lm.originalPreserved', legacyMotion.screenSpringMass, LEGACY_SCREEN_SPRING.mass)
  check('lm.changed', motionStyleEquals(legacyMotion, upgradedMotion), false)
  // 用户手写值保持权威
  const authored = makeMotionStyle({
    screenSpringMass: 1,
    screenSpringStiffness: 190,
    screenSpringDamping: 24,
    defaultZoomEasing: '三次方缓动',
    defaultZoomTransitionDuration: 0.55
  })
  const authoredUpgrade = upgradeLegacyMotionDefaults(authored)
  check('lm.authoredScreenMass', authoredUpgrade.screenSpringMass, 1)
  check('lm.authoredEasingStillUpgrades', authoredUpgrade.defaultZoomEasing, '弹簧')
  // 上一代弹簧默认 0.6s 只改时长
  const nearSpring = makeMotionStyle({ defaultZoomEasing: '弹簧', defaultZoomTransitionDuration: 0.6 })
  check('lm.springDuration', upgradeLegacyMotionDefaults(nearSpring).defaultZoomTransitionDuration, 0.7)
  const userSpring = makeMotionStyle({ defaultZoomEasing: '弹簧', defaultZoomTransitionDuration: 0.9 })
  check('lm.userSpringDuration', upgradeLegacyMotionDefaults(userSpring).defaultZoomTransitionDuration, 0.9)

  // ================================================ ProjectOpening（Swift 219 行）
  check('po.entryFile', PROJECT_PACKAGE_ENTRY_FILE, 'project.json')
  check('po.normalizeInner', normalizeProjectPackagePath('/a/b/project.json'), '/a/b')
  check('po.normalizeDir', normalizeProjectPackagePath('/a/b'), '/a/b')
  check('po.normalizeTrailingSlash', normalizeProjectPackagePath('/a/b/'), '/a/b')
  check('po.normalizeWindows', normalizeProjectPackagePath('C:\\a\\b\\project.json'), 'C:\\a\\b')
  check('po.suffix', CAMERA_TIMESTAMP_REPAIRED_SUFFIX, '-timestamp-repaired.mov')
  check('po.warnRelocated', PROJECT_OPEN_WARNING.relocatedMedia(3), '已在项目包内安全重新定位 3 项素材。')
  check('po.warnStickers', PROJECT_OPEN_WARNING.missingStickers(2), '有 2 项贴图素材不存在或路径无效。')
  check('po.warnPointer', PROJECT_OPEN_WARNING.brokenPointerEvents('X'), '鼠标事件轨损坏：X')

  const repairedResolver = {
    resolve: (relativePath) => (relativePath === 'media/cam.mov' ? '/P/media/cam.mov' : null)
  }
  check(
    'po.originalCameraMigrated',
    originalCameraRecordingPath('media/cam-timestamp-repaired.mov', repairedResolver, {}),
    'media/cam.mov'
  )
  check('po.originalCameraNotProxy', originalCameraRecordingPath('media/cam.mov', repairedResolver, {}), null)
  check(
    'po.originalCameraMissing',
    originalCameraRecordingPath('media/other-timestamp-repaired.mov', repairedResolver, {}),
    null
  )

  // zoomClipArraysEqual：Swift 数组值语义
  check('po.clipsEqual', zoomClipArraysEqual([], []), true)
  check('po.clipsLength', zoomClipArraysEqual([{ id: 'a' }], []), false)
  check('po.clipsValue', zoomClipArraysEqual([{ id: 'a' }], [{ id: 'b' }]), false)

  // 完整加载流程
  const makeOpenProject = (overrides = {}) =>
    makeRecorderProject({
      canvas: {
        ...makeCanvasStyle(),
        backgroundSource: { kind: 'projectImage', relativePath: 'assets/bg.png' },
        ...(overrides.canvas ?? {})
      },
      media:
        overrides.media !== undefined
          ? overrides.media
          : makeProjectMediaManifest({
              screen: makeProjectMediaReference({ relativePath: 'media/screen.mov' }),
              camera: makeProjectMediaReference({
                relativePath: 'media/cam-timestamp-repaired.mov',
                sourceTimeScale: 1.5,
                sourceEndTime: 9
              }),
              pointerEvents: makeProjectMediaReference({ relativePath: 'events/pointer.json' })
            }),
      timeline: makeProjectTimeline({
        stickerClips: [makeStickerClip({ relativePath: 'assets/sticker.png' })]
      }),
      motion: makeMotionStyle({
        screenSpringMass: 1,
        screenSpringStiffness: 180,
        screenSpringDamping: 24
      }),
      ...(overrides.project ?? {})
    })

  const openProject = makeOpenProject()
  const resolverA = {
    isRecoverableProject: () => true,
    isWorkingProject: () => false,
    loadProject: (normalizedPath) => ({
      project: openProject,
      session: { root: normalizedPath },
      recoveredFromPreviousRevision: true
    }),
    resolve: (relativePath) =>
      relativePath === 'media/screen.mov' || relativePath === 'media/cam.mov'
        ? `/P/${relativePath}`
        : null,
    relocatedRelativePath: () => null,
    fileExists: () => false,
    loadPointerEvents: () => {
      throw new Error('事件文件损坏')
    }
  }
  const snapshotA = loadProjectOpenSnapshot('/P/project.json', resolverA)
  check('po.snapshotPath', snapshotA.normalizedPath, '/P')
  check('po.snapshotInterrupted', snapshotA.wasInterrupted, true)
  check('po.snapshotScreen', snapshotA.recordingURL, '/P/media/screen.mov')
  check('po.snapshotCameraMigrated', snapshotA.cameraRecordingURL, '/P/media/cam.mov')
  check('po.snapshotCameraPath', openProject.media.camera.relativePath, 'media/cam.mov')
  check('po.snapshotCameraScale', openProject.media.camera.sourceTimeScale, null)
  check('po.snapshotCameraEnd', openProject.media.camera.sourceEndTime, null)
  check('po.snapshotMicrophone', snapshotA.microphoneRecordingURL, null)
  check('po.snapshotEventsEmpty', snapshotA.pointerEvents.length, 0)
  check('po.snapshotWarningCount', snapshotA.warnings.length, 4)
  check('po.snapshotWarn0', snapshotA.warnings[0], PROJECT_OPEN_WARNING.recoveredFromPreviousRevision)
  check('po.snapshotWarn1', snapshotA.warnings[1], PROJECT_OPEN_WARNING.missingBackgroundMedia)
  check('po.snapshotWarn2', snapshotA.warnings[2], PROJECT_OPEN_WARNING.missingStickers(1))
  check('po.snapshotWarn3', snapshotA.warnings[3], PROJECT_OPEN_WARNING.brokenPointerEvents('事件文件损坏'))
  check('po.snapshotMotionUpgraded', openProject.motion.screenSpringMass, 2.4)
  check('po.snapshotSaved', snapshotIsSaved(snapshotA, resolverA), true)
  check('po.snapshotWorking', snapshotIsSaved(snapshotA, { isWorkingProject: () => true }), false)

  // 重定位分支：素材在包内被移动过
  const relocProject = makeOpenProject({
    canvas: { backgroundSource: makeCanvasStyle().backgroundSource },
    media: makeProjectMediaManifest({
      screen: makeProjectMediaReference({ relativePath: 'media/screen.mov' }),
      camera: makeProjectMediaReference({ relativePath: 'camera-moved.mov' })
    }),
    project: { timeline: makeProjectTimeline({ stickerClips: [] }) }
  })
  const resolverB = {
    isRecoverableProject: () => false,
    isWorkingProject: () => false,
    loadProject: (normalizedPath) => ({
      project: relocProject,
      session: { root: normalizedPath },
      recoveredFromPreviousRevision: false
    }),
    resolve: (relativePath) =>
      relativePath === 'media/screen.mov' || relativePath === 'media/cam.mov'
        ? `/P/${relativePath}`
        : null,
    relocatedRelativePath: (path, session, directories) =>
      path === 'camera-moved.mov' && directories.includes('media') ? 'media/cam.mov' : null,
    fileExists: () => true,
    loadPointerEvents: () => []
  }
  const snapshotB = loadProjectOpenSnapshot('/P', resolverB)
  check('po.relocatedPath', relocProject.media.camera.relativePath, 'media/cam.mov')
  check('po.relocatedWarnings', snapshotB.warnings.length, 1)
  check('po.relocatedWarning', snapshotB.warnings[0], PROJECT_OPEN_WARNING.relocatedMedia(1))
  check('po.relocatedCameraURL', snapshotB.cameraRecordingURL, '/P/media/cam.mov')

  // 系统背景缺失
  const systemBgProject = makeOpenProject({
    canvas: { backgroundSource: { kind: 'systemImage', absolutePath: '/System/bg.heic' } },
    project: { timeline: makeProjectTimeline({ stickerClips: [] }) }
  })
  const resolverC = {
    ...resolverB,
    loadProject: (normalizedPath) => ({
      project: systemBgProject,
      session: { root: normalizedPath },
      recoveredFromPreviousRevision: false
    }),
    fileExists: () => false,
    loadPointerEvents: () => []
  }
  const snapshotC = loadProjectOpenSnapshot('/P', resolverC)
  check('po.systemBgWarn', snapshotC.warnings.includes(PROJECT_OPEN_WARNING.missingSystemBackground), true)
  check('po.systemBgNoProjectWarn', snapshotC.warnings.includes(PROJECT_OPEN_WARNING.missingBackgroundMedia), false)

}


await runMediaAnalysisBatch()

async function runFileBoundaryBatch() {
  const {
    EXPORT_TEMP_DEFAULT_EXTENSION, EXPORT_TEMP_INFIX, canonicalExportPath,
    exportFileTransactionCollides, exportPromotionMode, exportPromotionPlan,
    normalizePath, splitFilePath, temporaryExportPath,
    EXPORT_WATCHDOG_DEFAULT_TIMEOUT, ExportActivityWatchdog, watchdogRepeatInterval,
    DisposalCancelledError, moveProjectPackageToTrash, performDisposalWork,
    removeProjectPackageIfPresent,
    ProjectDocument, projectsEqual, replaceProjectSnapshot, stableStringify,
    PROJECT_CATALOG_PRESENTED_RECENT_LIMIT, PROJECT_CATALOG_RECENT_QUERY_LIMIT,
    loadProjectCatalogSnapshot, projectCatalogSnapshotEquals,
    RECOVERY_DEFAULT_SCREEN_RELATIVE_PATH, RecordingRecoveryJournal,
    makeRecordingRecoverySnapshot,
    SC_FRAME_STATUS, SC_STREAM_FRAME_INFO_STATUS_KEY, decodeFrameStatus,
    frameStatusHasContent, frameStatusName, readAttachmentStatus,
    screenCaptureFrameStatus,
    CAPTURE_STREAM_EXTRA_SURFACE_COST_MIB, CAPTURE_STREAM_MAXIMUM_FPS,
    CAPTURE_STREAM_QUEUE_DEPTH, RECORDING_PERFORMANCE_ACTIVITY_OPTIONS,
    captureStreamMinimumFrameInterval, captureStreamMinimumFrameIntervalSeconds,
    cmTimeSeconds, recordingActivityDisablesIdleSleep,
    makeRecorderProject,
  } = m

  // ================================================ ExportFileTransaction（Swift 33 行）
  check('ft.normalizeDots', normalizePath('/a/b/../c//d/./e'), '/a/c/d/e')
  check('ft.normalizeRoot', normalizePath('/'), '/')
  check('ft.normalizeRelative', normalizePath('a/./b'), 'a/b')
  check('ft.normalizeUp', normalizePath('../a'), '../a')
  check('ft.splitFolder', splitFilePath('/out/a.b.mp4').folder, '/out')
  check('ft.splitBase', splitFilePath('/out/a.b.mp4').base, 'a.b')
  check('ft.splitExtension', splitFilePath('/out/a.b.mp4').fileExtension, 'mp4')
  check('ft.splitNoExtension', splitFilePath('/out/clip').fileExtension, '')
  check('ft.splitHidden', splitFilePath('/out/.hidden').fileExtension, '')
  check('ft.tempInfix', EXPORT_TEMP_INFIX, 'dogsc-export')
  check('ft.tempDefaultExt', EXPORT_TEMP_DEFAULT_EXTENSION, 'mp4')
  check(
    'ft.tempPath',
    temporaryExportPath('/out/video.mp4', 'ABC-123'),
    '/out/.video.dogsc-export-abc-123.tmp.mp4'
  )
  check(
    'ft.tempPathNoExtension',
    temporaryExportPath('/out/video', 'U1'),
    '/out/.video.dogsc-export-u1.tmp.mp4'
  )
  check(
    'ft.tempPathDotBase',
    temporaryExportPath('/out/final.cut.mp4', 'U2'),
    '/out/.final.cut.dogsc-export-u2.tmp.mp4'
  )
  check('ft.collides', exportFileTransactionCollides('/out/a.mp4', ['/out/a.mp4']), true)
  check('ft.collidesDots', exportFileTransactionCollides('/out/./a.mp4', ['/out/a.mp4']), true)
  check('ft.notCollides', exportFileTransactionCollides('/out/a.mp4', ['/out/b.mp4']), false)
  check(
    'ft.collidesSymlink',
    exportFileTransactionCollides('/out/link.mp4', ['/out/real.mp4'], (p) =>
      p === '/out/link.mp4' ? '/out/real.mp4' : p
    ),
    true
  )
  check('ft.promoteExisting', exportPromotionMode(true), 'replace')
  check('ft.promoteNew', exportPromotionMode(false), 'move')
  check('ft.planMode', exportPromotionPlan('/out/.t.tmp.mp4', '/out/a.mp4', true).mode, 'replace')

  // ================================================ ExportActivityWatchdog（Swift 54 行）
  check('wd.defaultTimeout', EXPORT_WATCHDOG_DEFAULT_TIMEOUT, 120)
  check('wd.repeatLong', watchdogRepeatInterval(120), 2)
  check('wd.repeatShort', watchdogRepeatInterval(3), 1.5)

  const makeScheduler = () => {
    let clock = 0
    const timers = []
    return {
      now: () => clock,
      schedule: (delaySeconds, repeatSeconds, callback) => {
        const entry = { delaySeconds, repeatSeconds, callback, active: true }
        timers.push(entry)
        return () => {
          entry.active = false
        }
      },
      advance: (seconds) => {
        clock += seconds
      },
      fireActive: () => {
        for (const entry of timers) if (entry.active) entry.callback()
      },
      timers
    }
  }

  const sched = makeScheduler()
  let stalls = 0
  const watchdog = new ExportActivityWatchdog({
    timeout: 120,
    onStall: () => {
      stalls++
    },
    scheduler: sched
  })
  check('wd.scheduleDelay', sched.timers[0].delaySeconds, 120)
  check('wd.scheduleRepeat', sched.timers[0].repeatSeconds, 2)
  sched.advance(119.9)
  sched.fireActive()
  check('wd.notYet', stalls, 0)
  check('wd.notStopped', watchdog.isStopped, false)
  sched.advance(0.2)
  sched.fireActive()
  check('wd.stalled', stalls, 1)
  check('wd.stopped', watchdog.isStopped, true)
  sched.advance(500)
  sched.fireActive()
  check('wd.stallOnceOnly', stalls, 1)

  // 进度刷新会顺延：读与写都算进度
  const sched2 = makeScheduler()
  let stalls2 = 0
  const watchdog2 = new ExportActivityWatchdog({
    timeout: 10,
    onStall: () => {
      stalls2++
    },
    scheduler: sched2
  })
  sched2.advance(9)
  watchdog2.recordProgress()
  check('wd.progressTime', watchdog2.lastProgressTime, 9)
  sched2.advance(5)
  sched2.fireActive()
  check('wd.progressResets', stalls2, 0)

  // cancel 后不再触发
  const sched3 = makeScheduler()
  let stalls3 = 0
  const watchdog3 = new ExportActivityWatchdog({
    timeout: 10,
    onStall: () => {
      stalls3++
    },
    scheduler: sched3
  })
  watchdog3.cancel()
  sched3.advance(100)
  sched3.fireActive()
  check('wd.cancelNoStall', stalls3, 0)
  check('wd.cancelStopped', watchdog3.isStopped, true)
  watchdog.dispose()
  watchdog2.dispose()
  watchdog3.dispose()

  // ================================================ ProjectPackageDisposal（Swift 36 行）
  const makeFileSystem = (existing) => {
    const calls = []
    return {
      calls,
      trashItem: (path) => calls.push(['trash', path]),
      removeItem: (path) => calls.push(['remove', path]),
      fileExists: (path) => existing.includes(path)
    }
  }
  const fsTrash = makeFileSystem(['/P'])
  await moveProjectPackageToTrash(fsTrash, '/P')
  check('pd.trashCalled', fsTrash.calls.length, 1)
  check('pd.trashPath', fsTrash.calls[0][1], '/P')
  check('pd.trashNeverRemoves', fsTrash.calls.some((c) => c[0] === 'remove'), false)

  const fsExisting = makeFileSystem(['/P'])
  await removeProjectPackageIfPresent(fsExisting, '/P')
  check('pd.removeExisting', fsExisting.calls.length, 1)
  const fsAbsent = makeFileSystem([])
  await removeProjectPackageIfPresent(fsAbsent, '/P')
  check('pd.removeSkipped', fsAbsent.calls.length, 0)
  const fsFailing = {
    trashItem: () => {},
    removeItem: () => {
      throw new Error('权限不足')
    },
    fileExists: () => true
  }
  let swallowed = false
  await removeProjectPackageIfPresent(fsFailing, '/P')
  swallowed = true
  check('pd.removeSwallows', swallowed, true)

  let operated = 0
  const cancelFlag = { cancelled: false }
  let cancelThrown = false
  try {
    await performDisposalWork(
      () => {
        operated++
      },
      { isCancelled: () => true }
    )
  } catch (error) {
    cancelThrown = error instanceof DisposalCancelledError
  }
  check('pd.cancelThrows', cancelThrown, true)
  check('pd.cancelSkipsOperation', operated, 0)
  let postCancel = false
  try {
    await performDisposalWork(
      () => {
        operated++
        // 操作过程中被取消：结束后的检查必须抛
        cancelFlag.cancelled = true
      },
      { isCancelled: () => cancelFlag.cancelled }
    )
  } catch (error) {
    postCancel = error instanceof DisposalCancelledError
  }
  check('pd.cancelAfterOperation', postCancel, true)

  // ================================================ ProjectDocument（Swift 24 行）
  const docProjectA = makeRecorderProject({ title: 'A' })
  const docProjectB = makeRecorderProject({ title: 'B' })
  // 同一份数据的深拷贝（makeRecorderProject 每次都生成新 createdAt，不能直接对比两次构造）
  const docProjectACopy = JSON.parse(JSON.stringify(docProjectA))
  check('doc.equal', projectsEqual(docProjectA, docProjectACopy), true)
  check('doc.notEqual', projectsEqual(docProjectA, docProjectB), false)
  check(
    'doc.keyOrderInsensitive',
    stableStringify({ a: 1, b: 2 }) === stableStringify({ b: 2, a: 1 }),
    true
  )
  const plainDoc = new ProjectDocument(docProjectA)
  check('doc.noopReplace', plainDoc.replace(docProjectACopy), false)
  check('doc.commitReplace', plainDoc.replace(docProjectB), true)
  check('doc.projectUpdated', plainDoc.project.title, 'B')
  let notified = 0
  const observedDoc = new ProjectDocument(docProjectA, () => {
    notified++
  })
  observedDoc.replace(docProjectB)
  observedDoc.replace(docProjectB)
  check('doc.notifyOnce', notified, 1)
  const pureReplace = replaceProjectSnapshot(docProjectA, docProjectA)
  check('doc.pureNoopKeepsReference', pureReplace.project === docProjectA, true)
  check('doc.pureNoopFlag', pureReplace.didCommit, false)

  // ================================================ ProjectCatalogSnapshot（Swift 19 行）
  check('cat.queryLimit', PROJECT_CATALOG_RECENT_QUERY_LIMIT, 50)
  check('cat.presentedLimit', PROJECT_CATALOG_PRESENTED_RECENT_LIMIT, 8)
  const allProjects = Array.from({ length: 60 }, (_, i) => `/P/${i}`)
  let receivedCandidates = null
  const catalog = loadProjectCatalogSnapshot({
    recentProjectPaths: (limit) => allProjects.slice(0, limit),
    recoverableProjectPaths: (candidates) => {
      receivedCandidates = candidates
      return ['/P/40']
    }
  })
  check('cat.recentTrimmed', catalog.recent.length, 8)
  check('cat.recentFirst', catalog.recent[0], '/P/0')
  check('cat.recoverableUsesFullQuery', receivedCandidates.length, 50)
  check('cat.recoverableValue', catalog.recoverable[0], '/P/40')
  check('cat.equals', projectCatalogSnapshotEquals(catalog, { ...catalog }), true)
  check(
    'cat.notEquals',
    projectCatalogSnapshotEquals(catalog, { recent: catalog.recent, recoverable: [] }),
    false
  )

  // ================================================ RecordingRecoveryJournal（Swift 44 行）
  check('rj.defaultScreen', RECOVERY_DEFAULT_SCREEN_RELATIVE_PATH, 'media/screen-0001.mp4')
  const recoverySnapshot = makeRecordingRecoverySnapshot({
    state: 'recording',
    session: { root: '/P' },
    frameRate: 60
  })
  check('rj.defaultState', recoverySnapshot.state, 'recording')
  check('rj.defaultNoSample', recoverySnapshot.appendsPerformanceSample, false)
  check('rj.defaultScreenPath', recoverySnapshot.screenRelativePath, 'media/screen-0001.mp4')
  check('rj.defaultMeasurement', recoverySnapshot.measurement, null)

  const events = []
  const journalStore = {
    appendRecordingPerformanceSample: async (sample) => {
      events.push(`sample:${sample.count}`)
    },
    writeRecoveryManifest: async (fields) => {
      events.push(`manifest:${fields.state}:${fields.performanceSummary == null ? 'none' : 'summary'}`)
    }
  }
  const journal = new RecordingRecoveryJournal(journalStore)
  const monitor = {
    sample: () => ({ count: 7 }),
    summary: { sampleCount: 7 }
  }
  await journal.persist(
    makeRecordingRecoverySnapshot({
      state: 'recording',
      session: {},
      frameRate: 60,
      performanceMonitor: monitor,
      appendsPerformanceSample: true
    })
  )
  check('rj.appendFirst', events[0], 'sample:7')
  check('rj.manifestSecond', events[1], 'manifest:recording:summary')
  await journal.persist(
    makeRecordingRecoverySnapshot({
      state: 'recording',
      session: {},
      frameRate: 60,
      performanceMonitor: monitor,
      appendsPerformanceSample: false
    })
  )
  check('rj.skipsSample', events[2], 'manifest:recording:summary')
  check('rj.eventsTotal', events.length, 3)
  // 终态写与心跳写共用队列：顺序严格保持
  const order = []
  const slowStore = {
    appendRecordingPerformanceSample: () => {},
    writeRecoveryManifest: async (fields) => {
      await new Promise((resolve) => setTimeout(resolve, fields.state === 'recording' ? 20 : 0))
      order.push(fields.state)
    }
  }
  const journal2 = new RecordingRecoveryJournal(slowStore)
  const heartbeat = journal2.persist(
    makeRecordingRecoverySnapshot({ state: 'recording', session: {}, frameRate: 60 })
  )
  const complete = journal2.persist(
    makeRecordingRecoverySnapshot({ state: 'complete', session: {}, frameRate: 60 })
  )
  await Promise.all([heartbeat, complete])
  await journal2.drain()
  check('rj.serializedFirst', order[0], 'recording')
  check('rj.serializedSecond', order[1], 'complete')

  // ================================================ ScreenCaptureFrameMetadata（Swift 31 行）
  check('sm.statusKey', SC_STREAM_FRAME_INFO_STATUS_KEY, 'status')
  check('sm.complete', SC_FRAME_STATUS.complete, 0)
  check('sm.stopped', SC_FRAME_STATUS.stopped, 5)
  check('sm.dictComplete', screenCaptureFrameStatus([{ status: 0 }]), 0)
  check('sm.dictIdle', screenCaptureFrameStatus([{ status: 1 }]), 1)
  check('sm.mapValue', screenCaptureFrameStatus([new Map([['status', 3]])]), 3)
  check('sm.stringNumber', screenCaptureFrameStatus([{ status: '2' }]), 2)
  check('sm.missingKey', screenCaptureFrameStatus([{}]), null)
  check('sm.emptyArray', screenCaptureFrameStatus([]), null)
  check('sm.nullArray', screenCaptureFrameStatus(null), null)
  check('sm.unknownRaw', screenCaptureFrameStatus([{ status: 9 }]), null)
  check('sm.unknownDecode', decodeFrameStatus(42), null)
  check('sm.readNumber', readAttachmentStatus({ status: 4 }), 4)
  check('sm.readNonObject', readAttachmentStatus(4), null)
  check('sm.nameComplete', frameStatusName(0), 'complete')
  check('sm.nameUnknown', frameStatusName(null), 'unknown')
  check('sm.hasContentComplete', frameStatusHasContent(0), true)
  check('sm.hasContentIdle', frameStatusHasContent(1), false)
  check('sm.hasContentBlank', frameStatusHasContent(2), false)

  // ================================================ CaptureStreamCadence（Swift 40 行）
  check('cs.maxFps', CAPTURE_STREAM_MAXIMUM_FPS, 60)
  const displayInterval = captureStreamMinimumFrameInterval('display')
  check('cs.displayValue', displayInterval.value, 1)
  check('cs.displayTimescale', displayInterval.timescale, 60)
  check('cs.windowSame', cmTimeSeconds(captureStreamMinimumFrameInterval('window')), 1 / 60)
  check('cs.areaSame', cmTimeSeconds(captureStreamMinimumFrameInterval('area')), 1 / 60)
  check('cs.deviceZero', cmTimeSeconds(captureStreamMinimumFrameInterval('device')), 0)
  check('cs.deviceSeconds', captureStreamMinimumFrameIntervalSeconds('device'), 0)
  check('cs.displaySeconds', captureStreamMinimumFrameIntervalSeconds('display'), 1 / 60)
  check('cs.queueDepth', CAPTURE_STREAM_QUEUE_DEPTH, 8)
  check('cs.surfaceCost', CAPTURE_STREAM_EXTRA_SURFACE_COST_MIB, 42)
  check('cs.activityCount', RECORDING_PERFORMANCE_ACTIVITY_OPTIONS.length, 3)
  check('cs.activityNoIdleSleep', recordingActivityDisablesIdleSleep(), true)

}

await runFileBoundaryBatch()

async function runCaptureSupportBatch() {
  const {
    EditorThumbnailPermits, ThumbnailPermitCancelledError,
    cameraReadinessEquals, cameraReadinessPermitsRecording, recorderCameraReadiness,
    recorderStartAvailability, startAvailabilityPermitsRecording,
    captureAreaSelectionOutcome, captureDisplayIdentity, resolveCaptureDisplay,
    resolveCaptureDisplayScreen, screenDeviceDisplayID,
    EDITOR_EXTERNAL_ACTIONS, interactionEndPolicy, preparationAllowsProceeding,
    prepareExternalAction,
    CAPTURE_AREA_SAFE_MARGIN, CAPTURE_AREA_TOOLBAR_GAP, CAPTURE_AREA_TOOLBAR_HEIGHT,
    CAPTURE_AREA_TOOLBAR_WIDTH, captureAreaSelectionScale, captureAreaToolbarFrame,
    rectMaxX, rectMaxY, rectMidX, rectMinX, rectMinY,
    CAPTURE_AREA_SELECTION_MOTION_DURATION, CaptureAreaSelectionMotion,
    selectionMotionIsComplete, selectionMotionProgress,
    persistRecordingPointerEvents, prepareRecordingPointerFinalization,
    SCENE_PRESET_ASSET_SUBDIRECTORY, makeScenePresetBackgroundAsset,
    retainedScenePresetAsset, retainedScenePresetFilename, scenePresetAssetDirectory,
    scenePresetAssetExtension, scenePresetAssetIsAvailable, scenePresetAssetPath,
    scenePresetBackgroundSource,
  } = m

  // ================================================ EditorThumbnailPermits（Swift 49 行）
  const permits = new EditorThumbnailPermits(2)
  check('tp.limit', permits.permitLimit, 2)
  await permits.acquire()
  await permits.acquire()
  check('tp.activeFull', permits.activeCount, 2)
  check('tp.noWaiting', permits.waitingCount, 0)
  let thirdGranted = false
  const third = permits.acquire().then(() => {
    thirdGranted = true
  })
  check('tp.queued', permits.waitingCount, 1)
  check('tp.queuedNotGranted', thirdGranted, false)
  // release 是「转移许可」：队首直接拿到，active 不变
  permits.release()
  await third
  check('tp.transferred', thirdGranted, true)
  check('tp.activeUnchanged', permits.activeCount, 2)
  check('tp.queueDrained', permits.waitingCount, 0)
  permits.release()
  permits.release()
  check('tp.activeDecremented', permits.activeCount, 0)
  permits.release()
  check('tp.activeFloor', permits.activeCount, 0)

  // 排队中取消：立即出队并拒绝
  const permits2 = new EditorThumbnailPermits(1)
  await permits2.acquire()
  let cancelWaiter = null
  const queued = permits2.acquire({ registerCancellation: (cancel) => { cancelWaiter = cancel } })
  check('tp2.queued', permits2.waitingCount, 1)
  cancelWaiter()
  let cancelledError = null
  try {
    await queued
  } catch (error) {
    cancelledError = error
  }
  check('tp2.cancelled', cancelledError instanceof ThumbnailPermitCancelledError, true)
  check('tp2.queueEmptyAfterCancel', permits2.waitingCount, 0)
  permits2.release()
  // 入口即取消
  const permits3 = new EditorThumbnailPermits(1)
  let immediateCancel = false
  try {
    await permits3.acquire({ isCancelled: () => true })
  } catch (error) {
    immediateCancel = error instanceof ThumbnailPermitCancelledError
  }
  check('tp3.immediateCancel', immediateCancel, true)
  check('tp3.noPermitConsumed', permits3.activeCount, 0)

  // ================================================ RecorderStartAvailability（Swift 47 行）
  const noCamera = recorderCameraReadiness(false, null)
  check('sa.disabledKind', noCamera.kind, 'disabled')
  check('sa.disabledPermits', cameraReadinessPermitsRecording(noCamera), true)
  const preparing = recorderCameraReadiness(true, null)
  check('sa.preparingKind', preparing.kind, 'preparing')
  check('sa.preparingBlocks', cameraReadinessPermitsRecording(preparing), false)
  const readyCamera = recorderCameraReadiness(true, { width: 1920, height: 1080, framesPerSecond: 30 })
  check('sa.readyKind', readyCamera.kind, 'ready')
  check('sa.readyPermits', cameraReadinessPermitsRecording(readyCamera), true)
  check(
    'sa.readyFormat',
    cameraReadinessEquals(readyCamera, recorderCameraReadiness(true, { width: 1920, height: 1080, framesPerSecond: 30 })),
    true
  )
  check(
    'sa.formatDiffers',
    cameraReadinessEquals(readyCamera, recorderCameraReadiness(true, { width: 1280, height: 720, framesPerSecond: 30 })),
    false
  )
  check('sa.kindDiffers', cameraReadinessEquals(noCamera, preparing), false)
  check('sa.needsTarget', recorderStartAvailability(false, noCamera), 'needsCaptureTarget')
  check('sa.needsTargetWins', recorderStartAvailability(false, preparing), 'needsCaptureTarget')
  check('sa.preparingCamera', recorderStartAvailability(true, preparing), 'preparingCamera')
  check('sa.readyNoCamera', recorderStartAvailability(true, noCamera), 'ready')
  check('sa.permitsReady', startAvailabilityPermitsRecording('ready'), true)
  check('sa.permitsPreparing', startAvailabilityPermitsRecording('preparingCamera'), false)

  // ================================================ CaptureDisplayResolution（Swift 67 行）
  const screens = [
    { id: 1, name: '内建' },
    { id: 2, name: '外接 A' },
    { id: null, name: '虚拟' }
  ]
  check('cd.explicitHit', resolveCaptureDisplay(2, screens, (s) => s.id, 1).name, '外接 A')
  // 显式 ID 找不到 → null，绝不降级到别的屏
  check('cd.explicitMiss', resolveCaptureDisplay(9, screens, (s) => s.id, 1), null)
  check('cd.preferred', resolveCaptureDisplay(null, screens, (s) => s.id, 2).name, '外接 A')
  check('cd.preferredMissing', resolveCaptureDisplay(null, screens, (s) => s.id, 7).name, '内建')
  check(
    'cd.firstWithID',
    resolveCaptureDisplay(null, [{ id: null, name: 'X' }, { id: 5, name: 'Y' }], (s) => s.id, null).name,
    'Y'
  )
  check('cd.allNull', resolveCaptureDisplay(null, [{ id: null, name: 'X' }], (s) => s.id, null), null)
  check('cd.screenWrapper', resolveCaptureDisplayScreen(1, screens, 2).name, '内建')
  check('cd.identity', captureDisplayIdentity({ id: 3, name: '屏' }).id, 3)
  check('cd.identityNull', captureDisplayIdentity({ id: null, name: '屏' }), null)
  check('cd.deviceID', screenDeviceDisplayID({ NSScreenNumber: 2 }), 2)
  check('cd.deviceIDString', screenDeviceDisplayID({ NSScreenNumber: '4' }), 4)
  check('cd.deviceIDMissing', screenDeviceDisplayID({}), null)
  check('cd.deviceIDNull', screenDeviceDisplayID(null), null)
  const selectedOutcome = captureAreaSelectionOutcome(
    { display: { id: 1, name: '屏' }, rect: { x: 0, y: 0, width: 1, height: 1 } },
    false,
    1
  )
  check('cd.outcomeSelected', selectedOutcome.kind, 'selected')
  check('cd.outcomeCancelled', captureAreaSelectionOutcome(null, true, 1).kind, 'cancelled')
  const unavailable = captureAreaSelectionOutcome(null, false, 9)
  check('cd.outcomeUnavailable', unavailable.kind, 'displayUnavailable')
  check('cd.outcomeRequestedID', unavailable.requestedID, 9)

  // ================================================ EditorInteractionLifecycle（Swift 29 行）
  check('il.actionCount', EDITOR_EXTERNAL_ACTIONS.length, 4)
  check('il.policyExport', interactionEndPolicy('export'), 'cancel')
  check('il.policyDeactivation', interactionEndPolicy('windowDeactivation'), 'cancel')
  check('il.policyClosing', interactionEndPolicy('windowClosing'), 'cancel')
  check('il.policyReplacement', interactionEndPolicy('projectReplacement'), 'cancel')
  check('il.noDraft', prepareExternalAction('export', false), 'ready')
  check('il.draftCancelled', prepareExternalAction('export', true), 'cancelledDraft')
  check('il.allowsProceed', preparationAllowsProceeding('cancelledDraft'), true)

  // ================================================ CaptureAreaSelectionLayout（Swift 26 行）
  check('al.toolbarWidth', CAPTURE_AREA_TOOLBAR_WIDTH, 642)
  check('al.toolbarHeight', CAPTURE_AREA_TOOLBAR_HEIGHT, 60)
  check('al.margin', CAPTURE_AREA_SAFE_MARGIN, 12)
  check('al.gap', CAPTURE_AREA_TOOLBAR_GAP, 14)
  const bigDisplay = { x: 0, y: 0, width: 1920, height: 1080 }
  check('al.scalePreferred', captureAreaSelectionScale(bigDisplay, 1), 1)
  const smallDisplay = { x: 0, y: 0, width: 300, height: 60 }
  check('al.scaleWidthBound', captureAreaSelectionScale(smallDisplay, 1), 300 / 666, 1e-12)
  check('al.scalePreferredWins', captureAreaSelectionScale(bigDisplay, 0.5), 0.5)
  check('al.rectMidX', rectMidX({ x: 100, y: 0, width: 200, height: 0 }), 200)
  check('al.rectMaxY', rectMaxY({ x: 0, y: 100, width: 0, height: 50 }), 150)
  check('al.rectMinX', rectMinX({ x: 7, y: 0, width: 0, height: 0 }), 7)
  check('al.rectMaxX', rectMaxX({ x: 7, y: 0, width: 3, height: 0 }), 10)
  check('al.rectMinY', rectMinY({ x: 0, y: 9, width: 0, height: 0 }), 9)
  const toolbar = captureAreaToolbarFrame(
    { x: 100, y: 100, width: 200, height: 100 },
    { x: 0, y: 0, width: 1000, height: 800 },
    1
  )
  check('al.frameBelowY', toolbar.y, 26) // 100 - 60 - 14
  check('al.frameX', toolbar.x, 12) // 夹到安全区左边
  check('al.frameWidth', toolbar.width, 642)
  check('al.frameHeight', toolbar.height, 60)
  const toolbarAbove = captureAreaToolbarFrame(
    { x: 400, y: 10, width: 200, height: 100 },
    { x: 0, y: 0, width: 1000, height: 800 },
    1
  )
  check('al.frameAboveY', toolbarAbove.y, 124) // 110 + 14
  check('al.frameCenteredX', toolbarAbove.x, 500 - 321)
  const toolbarClamped = captureAreaToolbarFrame(
    { x: 400, y: 400, width: 100, height: 10 },
    { x: 0, y: 0, width: 700, height: 300 },
    1
  )
  check('al.frameClampedY', toolbarClamped.y, 300 - 12 - 60)

  // ================================================ CaptureAreaSelectionMotion（Swift 38 行）
  check('mo.duration', CAPTURE_AREA_SELECTION_MOTION_DURATION, 0.32)
  check('mo.start', selectionMotionProgress(0), 0)
  check('mo.mid', selectionMotionProgress(0.16), 0.875)
  check('mo.end', selectionMotionProgress(0.32), 1)
  check('mo.clampHigh', selectionMotionProgress(1), 1)
  check('mo.clampLow', selectionMotionProgress(-1), 0)
  check('mo.reduceMotion', selectionMotionProgress(0.1, 0.32, true), 1)
  check('mo.completeAtOne', selectionMotionIsComplete(1), true)
  check('mo.incomplete', selectionMotionIsComplete(0.999), false)

  const motionValues = []
  let currentTime = 0
  let pendingFrame = null
  const motion = new CaptureAreaSelectionMotion(() => false)
  motion.start((progress) => motionValues.push(progress), {
    now: () => currentTime,
    nextFrame: (callback) => {
      pendingFrame = callback
      return () => {
        pendingFrame = null
      }
    }
  })
  check('mo.firstFrameZero', motionValues[0], 0)
  check('mo.running', motion.isRunning, true)
  currentTime = 0.16
  pendingFrame()
  check('mo.tickMid', motionValues[1], 0.875)
  currentTime = 0.4
  pendingFrame()
  check('mo.tickEnd', motionValues[2], 1)
  check('mo.stoppedAtEnd', motion.isRunning, false)
  check('mo.framesTotal', motionValues.length, 3)
  // reduceMotion 下直接到终态并停止
  const motionRM = new CaptureAreaSelectionMotion(() => true)
  const rmValues = []
  let pendingRM = null
  motionRM.start((progress) => rmValues.push(progress), {
    now: () => 0,
    nextFrame: (callback) => {
      pendingRM = callback
      return () => {
        pendingRM = null
      }
    }
  })
  pendingRM()
  check('mo.reduceMotionEnd', rmValues[rmValues.length - 1], 1)
  check('mo.reduceMotionStops', motionRM.isRunning, false)

  // ================================================ RecordingPointerFinalization（Swift 49 行）
  let checks = 0
  const finalized = prepareRecordingPointerFinalization([], {
    startOffset: 0,
    sourceStartTime: 0,
    createsAutomaticZooms: true,
    easing: '弹簧',
    transitionDuration: 0.7,
    checkCancellation: () => {
      checks++
    }
  })
  check('pf.cancelChecks', checks, 3)
  check('pf.emptyEvents', finalized.events.length, 0)
  check('pf.emptyAnimations', finalized.automaticZoomAnimations.length, 0)
  const noZoom = prepareRecordingPointerFinalization([], {
    startOffset: 0,
    sourceStartTime: 0,
    createsAutomaticZooms: false,
    easing: '弹簧',
    transitionDuration: 0.7
  })
  check('pf.noAutoZoom', noZoom.automaticZoomAnimations.length, 0)
  const savedEvents = []
  let persistChecks = 0
  await persistRecordingPointerEvents([], { root: '/P' }, {
    savePointerEvents: (events) => savedEvents.push(events.length)
  }, {
    checkCancellation: () => {
      persistChecks++
    }
  })
  check('pf.persistChecks', persistChecks, 2)
  check('pf.persisted', savedEvents.length, 1)

  // ================================================ ScenePresetBackgroundAsset（Swift 47 行）
  check('sp.subdirectory', SCENE_PRESET_ASSET_SUBDIRECTORY, 'DogSC/ScenePresets/Assets')
  check('sp.directory', scenePresetAssetDirectory('/AppData'), '/AppData/DogSC/ScenePresets/Assets')
  check('sp.directoryTrailing', scenePresetAssetDirectory('/AppData/'), '/AppData/DogSC/ScenePresets/Assets')
  const asset = makeScenePresetBackgroundAsset('scene-1.png', false)
  check('sp.path', scenePresetAssetPath(asset, '/Assets'), '/Assets/scene-1.png')
  check('sp.rejectEmpty', scenePresetAssetPath(makeScenePresetBackgroundAsset('', false), '/Assets'), null)
  check('sp.rejectSlash', scenePresetAssetPath(makeScenePresetBackgroundAsset('a/b.png', false), '/Assets'), null)
  check('sp.rejectBackslash', scenePresetAssetPath(makeScenePresetBackgroundAsset('a\\b.png', false), '/Assets'), null)
  check('sp.rejectDot', scenePresetAssetPath(makeScenePresetBackgroundAsset('.', false), '/Assets'), null)
  check('sp.rejectDotDot', scenePresetAssetPath(makeScenePresetBackgroundAsset('..', false), '/Assets'), null)
  check('sp.available', scenePresetAssetIsAvailable(asset, '/Assets', () => true), true)
  check('sp.unavailable', scenePresetAssetIsAvailable(asset, '/Assets', () => false), false)
  const imageSource = scenePresetBackgroundSource(asset, '/Assets', () => true)
  check('sp.sourceKind', imageSource.kind, 'systemImage')
  check('sp.sourcePath', imageSource.absolutePath, '/Assets/scene-1.png')
  const videoSource = scenePresetBackgroundSource(
    makeScenePresetBackgroundAsset('scene-1.mov', true),
    '/Assets',
    () => true
  )
  check('sp.videoKind', videoSource.kind, 'systemVideo')
  check('sp.sourceMissing', scenePresetBackgroundSource(asset, '/Assets', () => false), null)
  check('sp.extGiven', scenePresetAssetExtension('/tmp/clip.MP4', true), 'MP4')
  check('sp.extVideoDefault', scenePresetAssetExtension('/tmp/clip', true), 'mov')
  check('sp.extImageDefault', scenePresetAssetExtension('/tmp/clip', false), 'png')
  check('sp.extTrailingDot', scenePresetAssetExtension('/tmp/clip.', false), 'png')
  check('sp.retainedName', retainedScenePresetFilename('/tmp/clip.mov', true, 'ABC'), 'scene-ABC.mov')
  const retained = retainedScenePresetAsset('/tmp/clip.heic', false, 'DEF')
  check('sp.retainedFilename', retained.filename, 'scene-DEF.heic')
  check('sp.retainedIsVideo', retained.asset.isVideo, false)

}

await runCaptureSupportBatch()

async function runExportStatusBatch() {
  const {
    EXPORT_STAGES, exportDurationText, exportStageFromRawValue, exportStageRawValue,
    exportStageTitle, exportStatusElapsedLabel, exportStatusRemainingLabel,
    exportStatusTitle, makeExportStatus, ExportTimeEstimator,
    ExportProgressCoalescer, ExportProgressRelay,
    exportProgressDeliveryDelayNanoseconds,
    makeScreenTopologyNode, screenTopologyGeometryFacts, screenTopologyModeFacts,
    screenTopologyNodeEquals, ScreenTopologySnapshot, ScreenTopologyDelta,
    ScreenTopologyReconfigurationState, ScreenTopologyMonitor,
  } = m

  // ================================================ ExportStatus（Swift 85 行）
  check('es.stageCount', EXPORT_STAGES.length, 4)
  check('es.rawCancelling', exportStageRawValue('cancelling'), 3)
  check('es.fromRaw', exportStageFromRawValue(2), 'finishing')
  check('es.fromRawOutOfRange', exportStageFromRawValue(9), null)
  check('es.titlePreparing', exportStageTitle('preparing', false), '正在准备素材')
  check('es.titleProcessingVideo', exportStageTitle('processing', false), '正在合成与编码')
  check('es.titleProcessingAudio', exportStageTitle('processing', true), '正在处理音频')
  check('es.titleFinishing', exportStageTitle('finishing', false), '正在完成文件')
  check('es.titleCancelling', exportStageTitle('cancelling', false), '正在取消导出')

  check('es.defaultStage', makeExportStatus().stage, 'preparing')
  check('es.defaultRemaining', makeExportStatus().remaining, null)
  check('es.title', exportStatusTitle(makeExportStatus({ stage: 'processing', audioOnly: true })), '正在处理音频')
  check('es.elapsedLabel', exportStatusElapsedLabel(makeExportStatus({ elapsed: 65 })), '已用时 1:05')
  // 五级优先级
  check(
    'es.labelCancellingFirst',
    exportStatusRemainingLabel(makeExportStatus({ stage: 'cancelling', secondsWithoutProgress: 60 })),
    '正在释放导出资源…'
  )
  check(
    'es.labelStalled',
    exportStatusRemainingLabel(makeExportStatus({ secondsWithoutProgress: 20, remaining: 30 })),
    '暂未收到新进度，可继续等待或取消后重试'
  )
  check(
    'es.labelFinishing',
    exportStatusRemainingLabel(makeExportStatus({ stage: 'finishing', remaining: 30 })),
    '正在写入最终文件…'
  )
  check(
    'es.labelEstimating',
    exportStatusRemainingLabel(makeExportStatus({ remaining: null })),
    '正在估算剩余时间…'
  )
  check(
    'es.labelRemaining',
    exportStatusRemainingLabel(makeExportStatus({ remaining: 125 })),
    '预计剩余约 2:05'
  )
  check(
    'es.labelStalledBelowThreshold',
    exportStatusRemainingLabel(makeExportStatus({ secondsWithoutProgress: 19.9, remaining: 10 })),
    '预计剩余约 0:10'
  )
  // durationText 向上取整
  check('es.durationZero', exportDurationText(0), '0:00')
  check('es.durationCeil', exportDurationText(4.2), '0:05')
  check('es.durationExact', exportDurationText(59), '0:59')
  check('es.durationMinute', exportDurationText(60), '1:00')
  check('es.durationLastMinute', exportDurationText(3599), '59:59')
  check('es.durationHour', exportDurationText(3600), '1:00:00')
  check('es.durationHourMinute', exportDurationText(3661), '1:01:01')
  check('es.durationNaN', exportDurationText(NaN), '0:00')
  check('es.durationNegative', exportDurationText(-5), '0:00')
  check('es.durationInfinity', exportDurationText(Infinity), '0:00')

  // ExportTimeEstimator：线性进度 → 精确剩余
  const estimator = new ExportTimeEstimator()
  estimator.restart(0, 0)
  let lastEstimate = null
  for (let t = 0; t <= 20; t++) {
    lastEstimate = estimator.sample(t, t * 0.025)
  }
  check('es.estimateRemaining', lastEstimate.remaining, 20)
  check('es.estimateIdle', lastEstimate.idle, 0)
  // 早期不给估算（进度 < 3%）
  const early = new ExportTimeEstimator()
  early.restart(0, 0)
  const earlySample = early.sample(1, 0.01)
  check('es.estimateEarlyNull', earlySample.remaining, null)
  // 卡住超过 5s 不给估算
  const stalled = new ExportTimeEstimator()
  stalled.restart(0, 0)
  for (let t = 0; t <= 12; t++) stalled.sample(t, t * 0.025)
  const stalledSample = stalled.sample(20, 12 * 0.025)
  check('es.estimateStalledNull', stalledSample.remaining, null)
  check('es.estimateStalledIdle', stalledSample.idle, 8)
  // 速率突变 → 隐藏估算
  const jumpy = new ExportTimeEstimator()
  jumpy.restart(0, 0)
  for (let t = 0; t <= 12; t++) jumpy.sample(t, t * 0.02)
  const jumped = jumpy.sample(13, 0.6)
  check('es.estimateRateMismatchNull', jumped.remaining, null)
  // 完成时不给估算
  const finished = new ExportTimeEstimator()
  finished.restart(0, 0)
  for (let t = 0; t <= 12; t++) finished.sample(t, t * 0.02)
  check('es.estimateCompleteNull', finished.sample(13, 1).remaining, null)
  // 样本窗口只留 24 秒
  const pruning = new ExportTimeEstimator()
  pruning.restart(0, 0)
  for (let t = 0; t <= 60; t++) pruning.sample(t, Math.min(t * 0.02, 0.99))
  const prunedSample = pruning.sample(61, 0.99)
  check('es.estimatePrunedWindow', prunedSample.remaining, null)

  // ================================================ ExportProgressRelay（Swift 85 行）
  const coalescer = new ExportProgressCoalescer()
  check('pr.initialActive', coalescer.isActive, true)
  check('pr.firstSubmit', coalescer.submit(0.5), true)
  check('pr.secondSubmit', coalescer.submit(0.7), false)
  check('pr.latestKept', coalescer.latestValue, 0.7)
  check('pr.scheduled', coalescer.deliveryIsScheduled, true)
  const delivered = coalescer.takePendingForDelivery()
  check('pr.takeValue', delivered, 0.7)
  check('pr.clearedAfterTake', coalescer.latestValue, null)
  check('pr.unscheduledAfterTake', coalescer.deliveryIsScheduled, false)
  check('pr.takeAgain', coalescer.takePendingForDelivery(), null)
  check('pr.clampLow', (coalescer.submit(-1), coalescer.latestValue), 0)
  check('pr.clampHigh', (coalescer.submit(2), coalescer.latestValue), 1)
  check('pr.clampNonFinite', (coalescer.submit(NaN), coalescer.latestValue), 0)
  coalescer.invalidate()
  check('pr.inactive', coalescer.isActive, false)
  check('pr.submitAfterInvalidate', coalescer.submit(0.4), false)
  check('pr.takeAfterInvalidate', coalescer.takePendingForDelivery(), null)

  check('pr.delayDefault', exportProgressDeliveryDelayNanoseconds(15), 66666667)
  check('pr.delayNonFinite', exportProgressDeliveryDelayNanoseconds(NaN), 66666667)
  check('pr.delayFloorOne', exportProgressDeliveryDelayNanoseconds(0), 1_000_000_000)
  check('pr.delaySixty', exportProgressDeliveryDelayNanoseconds(60), 16666667)

  const deliveries = []
  const relay = new ExportProgressRelay({
    maximumUpdatesPerSecond: 15,
    delivery: (value) => deliveries.push(value)
  })
  check('pr.relayDelay', relay.deliveryDelayMilliseconds, 66.666667, 1e-6)
  relay.submit(0.1)
  relay.submit(0.2)
  relay.submit(0.3)
  check('pr.relayPending', deliveries.length, 0)
  relay.flush()
  check('pr.relayOneDelivery', deliveries.length, 1)
  check('pr.relayLatestValue', deliveries[0], 0.3)
  relay.invalidate()
  relay.submit(0.9)
  relay.flush()
  check('pr.relayInvalidatedNoDelivery', deliveries.length, 1)

  // ================================================ ScreenTopology（Swift 313 行）
  const makeNode = (overrides = {}) =>
    makeScreenTopologyNode({
      id: 1,
      name: '内建',
      frame: { x: 0, y: 0, width: 1440, height: 900 },
      visibleFrame: { x: 0, y: 0, width: 1440, height: 875 },
      pixelWidth: 2880,
      pixelHeight: 1800,
      backingScale: 2,
      maximumFramesPerSecond: 120,
      ...overrides
    })
  const nodeA = makeNode()
  check('st.pixelWidth', nodeA.pixelSize.width, 2880)
  check('st.clampedPixel', makeNode({ pixelWidth: 0, pixelHeight: -5 }).pixelSize.width, 1)
  check('st.clampedScale', makeNode({ backingScale: 0.5 }).backingScale, 1)
  check('st.clampedFps', makeNode({ maximumFramesPerSecond: 0 }).maximumFramesPerSecond, 1)
  check('st.geometryFacts', screenTopologyGeometryFacts(nodeA), '0,0,1440,900|0,0,1440,875')
  check('st.modeFacts', screenTopologyModeFacts(nodeA), '2880x1800@2#120')
  // 名称变化不算几何变化，也不算模式变化
  check('st.nameNotIdentity', screenTopologyGeometryFacts(makeNode({ name: '改名' })), screenTopologyGeometryFacts(nodeA))

  const nodeB = makeNode({ id: 2, name: '外接' })
  const snapshotA = new ScreenTopologySnapshot(0, [nodeB, nodeA], 1)
  check('st.nodesSorted', snapshotA.nodes.map((n) => n.id).join(','), '1,2')
  check('st.nodeLookup', snapshotA.node(2).name, '外接')
  check('st.nodeMissing', snapshotA.node(9), null)
  check('st.mainResolved', ScreenTopologySnapshot.mainDisplayIDFor([nodeA, nodeB], 2), 2)
  check('st.mainMissing', ScreenTopologySnapshot.mainDisplayIDFor([nodeA], 9), null)
  // 同 id 重复 → 后者胜出
  const deduped = new ScreenTopologySnapshot(0, [nodeA, makeNode({ name: '新' })], 1)
  check('st.dedupeNewestWins', deduped.node(1).name, '新')
  check('st.assignGeneration', snapshotA.assigningGeneration(7).generation, 7)
  check('st.assignKeepsNodes', snapshotA.assigningGeneration(7).nodes.length, 2)
  check('st.equals', snapshotA.equals(snapshotA.assigningGeneration(0)), true)
  check('st.notEqualsGeneration', snapshotA.equals(snapshotA.assigningGeneration(3)), false)

  // Delta：新增 / 移除 / 几何 / 模式 / 主屏
  const snapshotB = new ScreenTopologySnapshot(1, [nodeA, makeNode({ id: 3, name: '第三块' })], 2)
  const deltaAdd = ScreenTopologyDelta.between(snapshotA, snapshotB)
  check('st.deltaAdded', [...deltaAdd.added].join(','), '3')
  check('st.deltaRemoved', [...deltaAdd.removed].join(','), '2')
  check('st.deltaNoGeometry', deltaAdd.geometryChanged.size, 0)
  check('st.deltaMainChanged', deltaAdd.mainChanged, true)
  check('st.deltaNotEmpty', deltaAdd.isEmpty, false)
  check('st.deltaGenerations', `${deltaAdd.previousGeneration}->${deltaAdd.generation}`, '0->1')

  const movedNode = makeNode({ frame: { x: 100, y: 0, width: 1440, height: 900 } })
  const deltaMove = ScreenTopologyDelta.between(
    snapshotA,
    new ScreenTopologySnapshot(2, [nodeA, movedNode], 1)
  )
  check('st.deltaGeometry', [...deltaMove.geometryChanged].join(','), '1')
  check('st.deltaModeUnchanged', deltaMove.modeChanged.size, 0)
  check('st.deltaMainSame', deltaMove.mainChanged, false)

  const scaledNode = makeNode({ pixelWidth: 3840, pixelHeight: 2160 })
  const deltaMode = ScreenTopologyDelta.between(
    snapshotA,
    new ScreenTopologySnapshot(3, [nodeA, scaledNode], 1)
  )
  check('st.deltaMode', [...deltaMode.modeChanged].join(','), '1')
  check('st.deltaGeometryUnchanged', deltaMode.geometryChanged.size, 0)

  const deltaSame = ScreenTopologyDelta.between(snapshotA, snapshotA.assigningGeneration(4))
  check('st.deltaEmpty', deltaSame.isEmpty, true)

  // 重配置状态
  const reconfig = new ScreenTopologyReconfigurationState()
  check('st.reconfigInitial', reconfig.generation, 0)
  check('st.reconfigAdvance', reconfig.advance(), 1)
  check('st.reconfigCurrentHit', reconfig.isCurrent(1), true)
  check('st.reconfigCurrentMiss', reconfig.isCurrent(0), false)
  reconfig.invalidate()
  check('st.reconfigInvalidated', reconfig.generation, 2)
  check('st.reconfigDefault', new ScreenTopologyReconfigurationState(5).isCurrent(5), true)

  // Monitor：一次通知合并成一次稳定刷新
  const monitorEvents = []
  const pendingRefreshes = []
  const monitor = new ScreenTopologyMonitor({
    snapshotProvider: () => new ScreenTopologySnapshot(999, [nodeA, nodeB], 1),
    scheduleStableRefresh: (operation) => {
      pendingRefreshes.push(operation)
    }
  })
  check('st.monitorInitialGeneration', monitor.snapshot.generation, 0)
  check('st.monitorNotRunning', monitor.isRunning, false)
  monitor.start()
  check('st.monitorRunning', monitor.isRunning, true)
  monitor.onChange = (snapshot, delta) => monitorEvents.push({ snapshot, delta })
  monitor.screenParametersDidChange()
  monitor.screenParametersDidChange()
  check('st.monitorCoalesced', pendingRefreshes.length, 1)
  pendingRefreshes.shift()()
  check('st.monitorPublished', monitor.snapshot.generation, 1)
  check('st.monitorEvents', monitorEvents.length, 1)
  check('st.monitorDeltaEmpty', monitorEvents[0].delta.isEmpty, true)
  // stop 会作废在途刷新
  monitor.screenParametersDidChange()
  const staleRefresh = pendingRefreshes.shift()
  monitor.stop()
  check('st.monitorStopped', monitor.isRunning, false)
  staleRefresh()
  check('st.monitorStaleIgnored', monitor.snapshot.generation, 1)
  check('st.monitorNoExtraEvent', monitorEvents.length, 1)

}

await runExportStatusBatch()

async function runZoomEnvelopeBatch() {
  const {
    ENVELOPE_HEIGHT, ENVELOPE_HOVER_RADIUS, ENVELOPE_DRAG_RADIUS, ENVELOPE_MAX_SCALE,
    ENVELOPE_MINIMUM_PEAK, ENVELOPE_MINIMUM_SPAN_LABEL_WIDTH, ENVELOPE_NODES,
    ENVELOPE_PLOT_INSETS, ENVELOPE_RULE_LEVELS, envelopeAxisSpans,
    envelopeCurveCacheKeyEquals, envelopeCurveDuration, envelopeCurvePoints,
    envelopeCurveSteps, envelopeEffectiveEnter, envelopeMagnificationAt,
    envelopeMagnificationAtY, envelopeMoveResult, envelopeNearestNode,
    envelopeNodePoint, envelopePlayheadPoint, envelopePlotRect, envelopeRuleLines,
    envelopeTimeAtX, envelopeTotal, envelopeVisibleNodes, envelopeX, envelopeY,
  } = m

  // ================================================ EditorZoomEnvelope（Swift 345 行）
  check('ze.height', ENVELOPE_HEIGHT, 156)
  check('ze.insetTop', ENVELOPE_PLOT_INSETS.top, 16)
  check('ze.insetLeading', ENVELOPE_PLOT_INSETS.leading, 12)
  check('ze.insetBottom', ENVELOPE_PLOT_INSETS.bottom, 26)
  check('ze.maxScale', ENVELOPE_MAX_SCALE, 6)
  check('ze.minimumPeak', ENVELOPE_MINIMUM_PEAK, 1.05)
  check('ze.hoverRadius', ENVELOPE_HOVER_RADIUS, 22)
  check('ze.dragRadius', ENVELOPE_DRAG_RADIUS, 26)
  check('ze.ruleCount', ENVELOPE_RULE_LEVELS.length, 5)
  check('ze.ruleLast', ENVELOPE_RULE_LEVELS[4], 6)
  check('ze.minSpan', ENVELOPE_MINIMUM_SPAN_LABEL_WIDTH, 30)

  const plot = envelopePlotRect({ width: 300, height: 156 })
  check('ze.plotX', plot.x, 12)
  check('ze.plotY', plot.y, 16)
  check('ze.plotWidth', plot.width, 276)
  check('ze.plotHeight', plot.height, 114)
  const tinyPlot = envelopePlotRect({ width: 4, height: 4 })
  check('ze.plotMinWidth', tinyPlot.width, 1)
  check('ze.plotMinHeight', tinyPlot.height, 1)

  const makeEnvelopeClip = (overrides = {}) => ({
    id: 'clip-1',
    startTime: 0,
    endTime: 2,
    scale: 2,
    focus: { x: 0.5, y: 0.5 },
    origin: 'manual',
    easing: '弹簧',
    customCurve: { x1: 0.3, y1: 0.8, x2: 0.3, y2: 1 },
    enterDuration: 0.5,
    exitDuration: 0.6,
    enterProgressOffset: 0,
    exitProgressOffset: 0,
    ...overrides
  })
  const envelopeClip = makeEnvelopeClip()
  check('ze.curveDuration', envelopeCurveDuration(envelopeClip), 2.6)
  check('ze.totalDefault', envelopeTotal(2.6, null), 2.6)
  check('ze.totalFrozen', envelopeTotal(2.6, 5), 5)
  check('ze.totalFloor', envelopeTotal(0, null), 0.001)
  check('ze.effectiveEnterOwn', envelopeEffectiveEnter(envelopeClip, false, 0.7), 0.5)
  // 进入为 0 且左侧有相邻片段 → 用工程默认过渡时长
  check('ze.effectiveEnterHandoff', envelopeEffectiveEnter(makeEnvelopeClip({ enterDuration: 0 }), true, 0.7), 0.7)
  // 但不能超过片段自身时长
  check(
    'ze.effectiveEnterClampedByDuration',
    envelopeEffectiveEnter(makeEnvelopeClip({ enterDuration: 0, endTime: 0.4 }), true, 0.7),
    0.4
  )
  check('ze.effectiveEnterZeroNoNeighbour', envelopeEffectiveEnter(makeEnvelopeClip({ enterDuration: 0 }), false, 0.7), 0)
  check('ze.visibleNodesAll', envelopeVisibleNodes(envelopeClip).length, 3)
  check('ze.visibleNodesMinimal', envelopeVisibleNodes(makeEnvelopeClip({ exitDuration: 0 })).length, 2)

  // 坐标映射
  check('ze.xStart', envelopeX(0, 2, plot), 12)
  check('ze.xMid', envelopeX(1, 2, plot), 150)
  check('ze.xEnd', envelopeX(3, 2, plot), 288)
  check('ze.xNegativeClamped', envelopeX(-1, 2, plot), 12)
  check('ze.yOne', envelopeY(1, plot), 130)
  check('ze.yMax', envelopeY(6, plot), 16)
  const lnRatio = Math.log(2) / Math.log(6)
  check('ze.yTwo', envelopeY(2, plot), 130 - lnRatio * 114, 1e-9)
  check('ze.timeAtX', envelopeTimeAtX(150, 2, plot), 1)
  check('ze.magAtBottom', envelopeMagnificationAtY(130, plot), 1, 1e-9)
  check('ze.magAtTop', envelopeMagnificationAtY(16, plot), 6, 1e-9)
  check('ze.magRoundTrip', envelopeMagnificationAtY(envelopeY(3, plot), plot), 3, 1e-9)
  // 0.9 下限：低于 1× 也允许画到轴下
  check('ze.yBelowOneClamped', envelopeY(0.5, plot), 130 - (Math.log(0.9) / Math.log(6)) * 114, 1e-9)

  // 节点位置：退出终点恒为 1×
  const constantSampler = () => 2
  const exitPoint = envelopeNodePoint('exitEnd', envelopeClip, 0.5, 2.6, plot, 2.6, constantSampler)
  check('ze.exitNodeX', exitPoint.x, 288)
  check('ze.exitNodeY', exitPoint.y, 130)
  const enterPoint = envelopeNodePoint('enterEnd', envelopeClip, 0.5, 2.6, plot, 2.6, constantSampler)
  check('ze.enterNodeX', enterPoint.x, 12 + (0.5 / 2.6) * 276, 1e-9)
  check('ze.enterNodeY', enterPoint.y, 130 - lnRatio * 114, 1e-9)
  const holdPoint = envelopeNodePoint('holdEnd', envelopeClip, 0.5, 2.6, plot, 2.6, constantSampler)
  check('ze.holdNodeX', holdPoint.x, 12 + (2 / 2.6) * 276, 1e-9)

  // 命中测试
  const candidates = [
    { node: 'enterEnd', point: enterPoint },
    { node: 'holdEnd', point: holdPoint },
    { node: 'exitEnd', point: exitPoint }
  ]
  check('ze.nearestExact', envelopeNearestNode(enterPoint, candidates, 22), 'enterEnd')
  check(
    'ze.nearestWithin',
    envelopeNearestNode({ x: enterPoint.x + 10, y: enterPoint.y }, candidates, 22),
    'enterEnd'
  )
  check(
    'ze.nearestOutside',
    envelopeNearestNode({ x: enterPoint.x + 40, y: enterPoint.y - 40 }, candidates, 22),
    null
  )
  // 两个都在半径内时取更近的
  const closeCandidates = [
    { node: 'enterEnd', point: { x: 100, y: 100 } },
    { node: 'holdEnd', point: { x: 105, y: 100 } }
  ]
  check('ze.nearestPicksClosest', envelopeNearestNode({ x: 104, y: 100 }, closeCandidates, 22), 'holdEnd')

  // 拖拽夹取
  const enterDrag = envelopeMoveResult('enterEnd', { x: envelopeX(1, 2.6, plot), y: envelopeY(3, plot) }, envelopeClip, 2.6, plot)
  check('ze.dragEnterValue', enterDrag.enter, 1)
  check('ze.dragEnterScale', enterDrag.scale, 3, 1e-9)
  const enterTooLong = envelopeMoveResult(
    'enterEnd',
    { x: envelopeX(2.5, 2.6, plot), y: envelopeY(2, plot) },
    envelopeClip,
    2.6,
    plot
  )
  check('ze.dragEnterClampedByDuration', enterTooLong.enter, 2) // min(duration, 3)
  const holdDrag = envelopeMoveResult('holdEnd', { x: 100, y: envelopeY(4, plot) }, envelopeClip, 2.6, plot)
  check('ze.dragHoldScale', holdDrag.scale, 4, 1e-9)
  check('ze.dragHoldNoEnter', holdDrag.enter, undefined)
  const exitDrag = envelopeMoveResult(
    'exitEnd',
    { x: envelopeX(2.5, 2.6, plot), y: envelopeY(1, plot) },
    envelopeClip,
    2.6,
    plot
  )
  check('ze.dragExitValue', exitDrag.exit, 0.5)
  const exitTooLong = envelopeMoveResult(
    'exitEnd',
    { x: envelopeX(2.6, 2.6, plot), y: envelopeY(1, plot) },
    makeEnvelopeClip({ endTime: 0.2, exitDuration: 0 }),
    2.6,
    plot
  )
  check('ze.dragExitClampedThree', exitTooLong.exit, 2.4)
  // 峰值上下限
  const highPeak = envelopeMoveResult('holdEnd', { x: 100, y: 0 }, envelopeClip, 2.6, plot)
  check('ze.dragPeakMax', highPeak.scale, 6)
  const lowPeak = envelopeMoveResult('holdEnd', { x: 100, y: 400 }, envelopeClip, 2.6, plot)
  check('ze.dragPeakMin', lowPeak.scale, 1.05)

  // 曲线采样
  check('ze.stepsWide', envelopeCurveSteps(276), 92)
  check('ze.stepsNarrow', envelopeCurveSteps(30), 24)
  const curvePoints = envelopeCurvePoints(envelopeClip, 2.6, 8, plot, 2.6, constantSampler)
  check('ze.curvePointCount', curvePoints.length, 9)
  check('ze.curveFlatY', curvePoints[0].y, 130 - lnRatio * 114, 1e-9)
  check('ze.curveStartX', curvePoints[0].x, 12)
  check('ze.curveEndX', curvePoints[8].x, 288)

  // 播放头
  const playheadInside = envelopePlayheadPoint(1, envelopeClip, 2.6, plot, 2.6, constantSampler)
  check('ze.playheadX', playheadInside.x, 12 + (1 / 2.6) * 276, 1e-9)
  check('ze.playheadBefore', envelopePlayheadPoint(-0.5, envelopeClip, 2.6, plot, 2.6, constantSampler), null)
  check('ze.playheadAfter', envelopePlayheadPoint(3, envelopeClip, 2.6, plot, 2.6, constantSampler), null)
  check('ze.playheadAtStart', envelopePlayheadPoint(0, envelopeClip, 2.6, plot, 2.6, constantSampler).x, 12)

  // 参考线
  const rules = envelopeRuleLines(plot)
  check('ze.rulesCount', rules.length, 5)
  check('ze.rulesOne', rules[0], 130)
  check('ze.rulesSix', rules[4], 16)

  // 阶段标签：跨度 > 30pt 才显示
  const spans = envelopeAxisSpans(envelopeClip, 0.5, 2.6, plot)
  check('ze.spanEnterVisible', spans[0].visible, true)
  check('ze.spanHoldMidpoint', spans[1].midpoint, (12 + (0.5 / 2.6) * 276 + 12 + (2 / 2.6) * 276) / 2, 1e-9)
  check('ze.spanLabels', spans.map((s) => s.label).join(','), '进入,保持,退出')
  const narrowSpans = envelopeAxisSpans(envelopeClip, 0.5, 2.6, envelopePlotRect({ width: 100, height: 156 }))
  check('ze.spanEnterHidden', narrowSpans[0].visible, false)

  // 缓存键
  const keyA = {
    trackID: 't1',
    animationID: 'a1',
    motionKey: 'm1',
    steps: 92,
    plot,
    total: 2.6
  }
  check('ze.cacheSame', envelopeCurveCacheKeyEquals(keyA, { ...keyA }), true)
  check('ze.cacheStepsDiffer', envelopeCurveCacheKeyEquals(keyA, { ...keyA, steps: 24 }), false)
  check('ze.cachePlotDiffer', envelopeCurveCacheKeyEquals(keyA, { ...keyA, plot: { ...plot, width: 200 } }), false)
  check('ze.cacheNull', envelopeCurveCacheKeyEquals(null, null), true)
  check('ze.cacheNullVsValue', envelopeCurveCacheKeyEquals(null, keyA), false)

}

await runZoomEnvelopeBatch()

async function runEditorInteractionSupportBatch() {
  const {
    EditorKnobDragState, KNOB_DEAD_ZONE_RADIUS, KNOB_FINE_MULTIPLIER, KNOB_START_ANGLE,
    KNOB_SWEEP_ANGLE, clampKnobFraction, knobAngle, knobNeedleAngle,
    editorMotionCurveDetail, editorMotionCurveOption, editorMotionCurveSymbol,
    editorMotionCurveTitle,
    CANVAS_SLEEP_FADE_DURATION, EditorCanvasSleepPresentation,
    PANEL_FADE_DURATION, RecorderPanelTransition, panelTransitionDuration,
    EditorPlaybackTimelineObserverHub, makeEditorPlaybackTimelineSnapshot,
    CAMERA_SYNC_DISMISSAL, CAMERA_SYNC_TRACK_AMPLITUDE, CAMERA_SYNC_TRACK_CENTER_Y,
    CAMERA_SYNC_MINIMUM_DISPLAY_RANGE, cameraSyncDisplayRange, cameraSyncOffsetLabel,
    cameraSyncY, presentedCameraSyncAnchor, removeCameraSyncAnchor,
    rectContains, rectIntersection, targetsTextInput, textInputRegionContains,
    INITIAL_FRAME_DEFAULT_ADVANCE_INTERVAL, InitialFrameMediaDataWaiter,
  } = m

  // ================================================ EditorKnobDrag（Swift 55 行）
  check('kn.sweep', KNOB_SWEEP_ANGLE, 270)
  check('kn.start', KNOB_START_ANGLE, -135)
  check('kn.deadZone', KNOB_DEAD_ZONE_RADIUS, 6)
  check('kn.fine', KNOB_FINE_MULTIPLIER, 0.2)
  check('kn.clampNaN', clampKnobFraction(NaN), 0)
  check('kn.clampLow', clampKnobFraction(-1), 0)
  check('kn.clampHigh', clampKnobFraction(2), 1)
  check('kn.needleStart', knobNeedleAngle(0), -135)
  check('kn.needleMid', knobNeedleAngle(0.5), 0)
  check('kn.needleEnd', knobNeedleAngle(1), 135)
  const knobCenter = { x: 0, y: 0 }
  check('kn.angleUp', knobAngle({ x: 0, y: -10 }, knobCenter), 0)
  check('kn.angleRight', knobAngle({ x: 10, y: 0 }, knobCenter), 90)
  check('kn.angleDown', knobAngle({ x: 0, y: 10 }, knobCenter), 180)
  check('kn.angleLeft', knobAngle({ x: -10, y: 0 }, knobCenter), -90)
  check('kn.angleDeadZone', knobAngle({ x: 2, y: 2 }, knobCenter), null)
  check('kn.angleNaN', knobAngle({ x: NaN, y: 0 }, knobCenter), null)
  // 顺时针拖动：每 90° 走 90/270 = 1/3
  const knob = new EditorKnobDragState(0, { x: 0, y: -10 }, knobCenter)
  check('kn.initialFraction', knob.fraction, 0)
  check('kn.rotateQuarter', knob.update({ x: 10, y: 0 }, false), 1 / 3, 1e-9)
  check('kn.rotateHalf', knob.update({ x: 0, y: 10 }, false), 2 / 3, 1e-9)
  // 精细模式慢 5 倍
  const fineKnob = new EditorKnobDragState(0, { x: 0, y: -10 }, knobCenter)
  check('kn.fineQuarter', fineKnob.update({ x: 10, y: 0 }, true), (1 / 3) * 0.2, 1e-9)
  // 跨底缝：+179° → -179° 只走 +2°，不会被解释成 -358°
  const seamKnob = new EditorKnobDragState(0.5, { x: 0.1745, y: 9.998 }, knobCenter)
  const seamStart = knobAngle({ x: 0.1745, y: 9.998 }, knobCenter)
  check('kn.seamStartAngle', Math.round(seamStart), 179)
  const seamResult = seamKnob.update({ x: -0.1745, y: 9.998 }, false)
  check('kn.seamShortestPath', seamResult, 0.5 + 2 / 270, 1e-6)
  // 经过圆心：锚点清空，不跳半圈
  const centerKnob = new EditorKnobDragState(0.5, { x: 0, y: -10 }, knobCenter)
  check('kn.centerKeepsValue', centerKnob.update({ x: 1, y: 1 }, false), 0.5)
  check('kn.afterCenterNoJump', centerKnob.update({ x: 0, y: 10 }, false), 0.5)
  // 离开死区后的第一步只重新锚定（上一条），之后才恢复正常步进
  check('kn.afterCenterReanchored', centerKnob.update({ x: 10, y: 0 }, false), 0.5 - 90 / 270, 1e-9)
  // 夹取到 [0,1]
  const fullKnob = new EditorKnobDragState(0.95, { x: 0, y: -10 }, knobCenter)
  check('kn.clampedAtOne', fullKnob.update({ x: 10, y: 0 }, false), 1)
  // 滚轮
  check(
    'kn.wheelNormal',
    EditorKnobDragState.wheelDelta({ vertical: 10, horizontal: 0, precise: false, inverted: false, fine: false }),
    0.08
  )
  check(
    'kn.wheelPrecise',
    EditorKnobDragState.wheelDelta({ vertical: 60, horizontal: 0, precise: true, inverted: false, fine: false }),
    0.08
  )
  check(
    'kn.wheelInverted',
    EditorKnobDragState.wheelDelta({ vertical: 10, horizontal: 0, precise: false, inverted: true, fine: false }),
    -0.08
  )
  check(
    'kn.wheelFine',
    EditorKnobDragState.wheelDelta({ vertical: 5, horizontal: 0, precise: false, inverted: false, fine: true }),
    0.08 * 0.2 // 0.1 先夹到 0.08，再乘精细倍率
  )
  check(
    'kn.wheelHorizontalDominant',
    EditorKnobDragState.wheelDelta({ vertical: 1, horizontal: 5, precise: false, inverted: false, fine: false }),
    null
  )
  check(
    'kn.wheelTooSmall',
    EditorKnobDragState.wheelDelta({ vertical: 0.00005, horizontal: 0, precise: false, inverted: false, fine: false }),
    null
  )
  check(
    'kn.wheelNaN',
    EditorKnobDragState.wheelDelta({ vertical: NaN, horizontal: 0, precise: false, inverted: false, fine: false }),
    null
  )

  // ================================================ EditorMotionCurveStyle（Swift 27 行）
  check('mc.smoothTitle', editorMotionCurveTitle('smooth'), '顺滑')
  check('mc.swiftTitle', editorMotionCurveTitle('swift'), '利落')
  check('mc.gentleTitle', editorMotionCurveTitle('gentle'), '柔和')
  check('mc.smoothSymbol', editorMotionCurveSymbol('smooth'), 'waveform.path')
  check('mc.swiftSymbol', editorMotionCurveSymbol('swift'), 'bolt.fill')
  check('mc.gentleSymbol', editorMotionCurveSymbol('gentle'), 'wind')
  check('mc.smoothDetail', editorMotionCurveDetail('smooth'), '均衡加减速，适合大多数元素。')
  check('mc.swiftDetail', editorMotionCurveDetail('swift'), '快速进入并干净收尾，节奏更明确。')
  check('mc.gentleDetail', editorMotionCurveDetail('gentle'), '起落更慢，适合较大的画面和样机。')
  check('mc.option', editorMotionCurveOption('swift').title, '利落')

  // ================================================ EditorCanvasSleepPresentation（Swift 46 行）
  check('cs.fadeDuration', CANVAS_SLEEP_FADE_DURATION, 0.26)
  const fadeCalls = []
  const fakeAnimator = {
    animate: (from, to, duration, completion) => {
      fadeCalls.push({ from, to, duration, completion })
      return () => {}
    }
  }
  const sleep = new EditorCanvasSleepPresentation(fakeAnimator)
  check('cs.initialOpacity', sleep.opacity, 0)
  let sleepCompletions = 0
  sleep.setCovered(true, false, () => {
    sleepCompletions++
  })
  check('cs.coverTarget', sleep.opacity, 1)
  check('cs.coverDuration', fadeCalls[0].duration, 0.26)
  check('cs.coverAnimating', sleep.animating, true)
  check('cs.coverPendingCompletion', sleepCompletions, 0)
  fadeCalls[0].completion()
  check('cs.coverCompletionRan', sleepCompletions, 1)
  check('cs.coverStopped', sleep.animating, false)
  // reduce motion → 时长为 0
  const sleepReduced = new EditorCanvasSleepPresentation(fakeAnimator)
  sleepReduced.setCovered(true, true, () => {})
  check('cs.reducedMotionDuration', fadeCalls[fadeCalls.length - 1].duration, 0)
  // 同目标重复请求：不重启动画，但会替换 completion；未在动画中则立即完成
  const sleepIdle = new EditorCanvasSleepPresentation(fakeAnimator)
  let idleCompletions = 0
  sleepIdle.setCovered(false, false, () => {
    idleCompletions++
  })
  check('cs.sameTargetImmediate', idleCompletions, 1)
  const sleepBusy = new EditorCanvasSleepPresentation(fakeAnimator)
  let busyFirst = 0
  let busySecond = 0
  const beforeCount = fadeCalls.length
  sleepBusy.setCovered(true, false, () => {
    busyFirst++
  })
  const busyFade = fadeCalls[fadeCalls.length - 1]
  sleepBusy.setCovered(true, false, () => {
    busySecond++
  })
  check('cs.sameTargetNoRestart', fadeCalls.length - beforeCount, 1)
  busyFade.completion()
  check('cs.sameTargetFirstReplaced', busyFirst, 0)
  check('cs.sameTargetSecondRuns', busySecond, 1)
  // invalidate 作废在途 completion
  const sleepInvalidated = new EditorCanvasSleepPresentation(fakeAnimator)
  sleepInvalidated.setCovered(true, false, () => {
    sleepCompletions++
  })
  const invalidatedFade = fadeCalls[fadeCalls.length - 1]
  const completionsBefore = sleepCompletions
  sleepInvalidated.invalidate()
  invalidatedFade.completion()
  check('cs.invalidateDropsCompletion', sleepCompletions, completionsBefore)
  check('cs.invalidateStops', sleepInvalidated.animating, false)

  // ================================================ RecorderPanelTransition（Swift 57 行）
  check('pt.fadeDuration', PANEL_FADE_DURATION, 0.18)
  check('pt.fadeReduced', panelTransitionDuration(true, true), 0.1)
  check('pt.fadeNormal', panelTransitionDuration(true, false), 0.18)
  check('pt.fadeDisabled', panelTransitionDuration(false, false), 0)
  const makePanelWindow = () => {
    const state = { visible: false, alpha: 1, pointer: true, orderOutCount: 0 }
    return {
      state,
      get isVisible() {
        return state.visible
      },
      setAlpha(value) {
        state.alpha = value
      },
      orderFront() {
        state.visible = true
      },
      orderOut() {
        state.visible = false
        state.orderOutCount++
      },
      setPointerInteractionEnabled(enabled) {
        state.pointer = enabled
      }
    }
  }
  const panelAnimations = []
  const panelTransition = new RecorderPanelTransition({
    animate: (target, duration, completion) => {
      panelAnimations.push({ target, duration, completion })
    }
  })
  const panelWindow = makePanelWindow()
  panelTransition.show(panelWindow, true)
  check('pt.showVisible', panelWindow.state.visible, true)
  check('pt.showPointer', panelWindow.state.pointer, true)
  check('pt.showAlphaZeroFirst', panelWindow.state.alpha, 0)
  check('pt.showAnimationTarget', panelAnimations[0].target, 1)
  check('pt.showRevision', panelTransition.currentRevision, 1)
  // 已可见再 show → 空操作
  const animCountBefore = panelAnimations.length
  panelTransition.show(panelWindow, true)
  check('pt.showIdempotent', panelAnimations.length, animCountBefore)
  // hide 动画：完成前不送走窗口
  panelTransition.hide(panelWindow, true)
  check('pt.hidePointerOff', panelWindow.state.pointer, false)
  check('pt.hideStillVisible', panelWindow.state.visible, true)
  panelAnimations[panelAnimations.length - 1].completion()
  check('pt.hideOrderedOut', panelWindow.state.visible, false)
  check('pt.hideAlphaReset', panelWindow.state.alpha, 1)
  // 淡出被 show 抢走：过期回调不送窗口
  panelTransition.show(panelWindow, false)
  const staleFadeIndex = panelAnimations.length
  panelTransition.hide(panelWindow, true)
  const retiring = panelAnimations[panelAnimations.length - 1]
  panelTransition.show(panelWindow, false)
  const visibleAfterReshow = panelWindow.state.visible
  retiring.completion()
  check('pt.staleFadeIgnored', panelWindow.state.visible, visibleAfterReshow)
  check('pt.staleFadeWasCancelled', staleFadeIndex > 0, true)
  // 非动画 hide 直接送走
  const quickWindow = makePanelWindow()
  const quickTransition = new RecorderPanelTransition({ animate: () => {} })
  quickTransition.show(quickWindow, false)
  quickTransition.hide(quickWindow, false)
  check('pt.immediateHide', quickWindow.state.visible, false)
  check('pt.immediateAlpha', quickWindow.state.alpha, 1)
  // 已隐藏且非动画 → 仍然走一遍（guard 只在 animated 时生效）
  check('pt.hideGuardOnlyWhenAnimated', quickWindow.state.orderOutCount >= 1, true)

  // ================================================ EditorPlaybackTimelineObserver（Swift 63 行）
  const snapshotDefault = makeEditorPlaybackTimelineSnapshot({ outputTime: 0, duration: 10, isPlaying: false })
  check('ob.defaultReveal', snapshotDefault.allowsViewportReveal, true)
  const batchLog = []
  const hub = new EditorPlaybackTimelineObserverHub({
    begin: () => batchLog.push('begin'),
    end: () => batchLog.push('end')
  })
  const received = []
  const observerA = {
    editorPlaybackTimelineDidUpdate: (snapshot) => received.push(`A:${snapshot.outputTime}`)
  }
  const observerB = {
    editorPlaybackTimelineDidUpdate: (snapshot) => received.push(`B:${snapshot.outputTime}`)
  }
  hub.add(observerA, snapshotDefault)
  hub.add(observerB, snapshotDefault)
  check('ob.addImmediatePush', received.length, 2)
  check('ob.count', hub.observerCount, 2)
  received.length = 0
  hub.publish(makeEditorPlaybackTimelineSnapshot({ outputTime: 1, duration: 10, isPlaying: true }))
  check('ob.publishBoth', received.join(','), 'A:1,B:1')
  check('ob.singleTransaction', batchLog.join(','), 'begin,end')
  // 重复 add 不重复注册
  hub.add(observerA, snapshotDefault)
  check('ob.addDedupes', hub.observerCount, 2)
  // 移除
  hub.remove(observerB)
  check('ob.removed', hub.observerCount, 1)
  // 过期（弱引用被回收）自动清理
  const hubWithRefs = new EditorPlaybackTimelineObserverHub({ begin: () => {}, end: () => {} })
  let observerAlive = true
  hubWithRefs.add(observerA, snapshotDefault, () => ({
    deref: () => (observerAlive ? observerA : null)
  }))
  observerAlive = false
  const beforeCleanup = received.length
  hubWithRefs.publish(snapshotDefault)
  check('ob.expiredSkipped', received.length, beforeCleanup)
  check('ob.expiredPruned', hubWithRefs.observerCount, 0)

  // ================================================ EditorTimelineCameraSync（Swift 58 行）
  check('csx.centerY', CAMERA_SYNC_TRACK_CENTER_Y, 41)
  check('csx.amplitude', CAMERA_SYNC_TRACK_AMPLITUDE, 14)
  check('csx.zeroOffset', cameraSyncY(0, 2), 41)
  check('csx.fullPositive', cameraSyncY(2, 2), 27)
  check('csx.fullNegative', cameraSyncY(-2, 2), 55)
  check('csx.clampedPositive', cameraSyncY(9, 2), 27)
  check('csx.halfOffset', cameraSyncY(1, 2), 34)
  check('csx.zeroRangeFloor', cameraSyncY(0, 0), 41)
  check('csx.labelPositive', cameraSyncOffsetLabel(0.012), '+12 ms')
  check('csx.labelNegative', cameraSyncOffsetLabel(-0.012), '-12 ms')
  check('csx.labelZero', cameraSyncOffsetLabel(0), '+0 ms')
  check('csx.labelHalfMs', cameraSyncOffsetLabel(0.0005), '+1 ms')
  const anchors = [
    { id: 'a1', sourceTime: 1, offset: 0.01 },
    { id: 'a2', sourceTime: 2, offset: -0.02 }
  ]
  check('csx.presentedCommitted', presentedCameraSyncAnchor('a1', anchors, null).offset, 0.01)
  check(
    'csx.presentedDraft',
    presentedCameraSyncAnchor('a1', anchors, { originalID: 'a1', draft: { id: 'a1', sourceTime: 1, offset: 0.05 } }).offset,
    0.05
  )
  check('csx.presentedMissing', presentedCameraSyncAnchor('a9', anchors, null), null)
  const removal = removeCameraSyncAnchor('a1', anchors, 'a1', (sourceTime) => sourceTime + 100)
  check('csx.removalRemaining', removal.anchors.length, 1)
  check('csx.removalClearsSelection', removal.clearsSelection, true)
  check('csx.removalAudition', removal.auditionOutputTime, 101)
  const removalUnselected = removeCameraSyncAnchor('a2', anchors, 'a1', () => null)
  check('csx.removalKeepsSelection', removalUnselected.clearsSelection, false)
  check('csx.removalNoAudition', removalUnselected.auditionOutputTime, null)
  check('csx.dismissalCancelsAudition', CAMERA_SYNC_DISMISSAL.cancelAudition, true)

  // ================================================ EditorTextInputHitTesting（Swift 60 行）
  check('tx.rectContains', rectContains({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5 }), true)
  check('tx.rectOutside', rectContains({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 5 }), false)
  check('tx.intersection', rectIntersection({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }).width, 5)
  check('tx.intersectionNone', rectIntersection({ x: 0, y: 0, width: 1, height: 1 }, { x: 5, y: 5, width: 1, height: 1 }), null)
  // 区域命中：窗口必须一致；命中区取 bounds ∩ visibleRect
  const region = { bounds: { x: 0, y: 0, width: 100, height: 20 }, visibleRect: { x: 0, y: 0, width: 50, height: 20 } }
  check('tx.regionInside', textInputRegionContains(region, { windowID: 1, locationInWindow: { x: 10, y: 10 } }, 1), true)
  check('tx.regionOutsideVisible', textInputRegionContains(region, { windowID: 1, locationInWindow: { x: 80, y: 10 } }, 1), false)
  check('tx.regionOtherWindow', textInputRegionContains(region, { windowID: 2, locationInWindow: { x: 10, y: 10 } }, 1), false)
  check('tx.regionNoWindow', textInputRegionContains(region, { windowID: 1, locationInWindow: { x: 10, y: 10 } }, null), false)
  // 命中链
  const plainView = { isEditableTextField: false, isEditableTextView: false, parent: null }
  const editableField = { isEditableTextField: true, isEditableTextView: false, parent: plainView }
  check('tx.fieldEditorWins', targetsTextInput({ pointInWindow: { x: 5, y: 5 }, fieldEditorBounds: { x: 0, y: 0, width: 10, height: 10 }, hitCandidate: null }), true)
  check('tx.chainTextField', targetsTextInput({ pointInWindow: { x: 50, y: 50 }, fieldEditorBounds: null, hitCandidate: editableField }), true)
  check('tx.chainPlain', targetsTextInput({ pointInWindow: { x: 50, y: 50 }, fieldEditorBounds: null, hitCandidate: plainView }), false)
  check('tx.chainMissing', targetsTextInput({ pointInWindow: { x: 50, y: 50 }, fieldEditorBounds: null, hitCandidate: null }), false)
  check(
    'tx.chainTextView',
    targetsTextInput({
      pointInWindow: { x: 1, y: 1 },
      fieldEditorBounds: null,
      hitCandidate: { isEditableTextField: false, isEditableTextView: true, parent: null }
    }),
    true
  )

  // ================================================ EditorPlaybackInitialFrameWaiter（Swift 72 行）
  check('fw.defaultAdvance', INITIAL_FRAME_DEFAULT_ADVANCE_INTERVAL, 0.005)
  const makeOutputPort = () => {
    const state = { delegate: null, requested: null, delegateClears: 0 }
    return {
      state,
      setDelegate(callback) {
        state.delegate = callback
        if (callback == null) state.delegateClears++
      },
      requestNotificationOfMediaDataChange(interval) {
        state.requested = interval
      }
    }
  }
  const pendingTimeouts = []
  const outputA = makeOutputPort()
  const waiterA = new InitialFrameMediaDataWaiter({
    output: outputA,
    scheduleTimeout: (seconds, callback) => {
      pendingTimeouts.push({ seconds, callback })
      return () => {
        pendingTimeouts.pop()
      }
    }
  })
  const waitA = waiterA.wait(1.5, 0.01)
  check('fw.requestedInterval', outputA.state.requested, 0.01)
  check('fw.delegateInstalled', typeof outputA.state.delegate, 'function')
  check('fw.timeoutScheduled', pendingTimeouts[pendingTimeouts.length - 1].seconds, 1.5)
  outputA.state.delegate()
  check('fw.resolvedTrue', await waitA, true)
  check('fw.delegateCleared', outputA.state.delegateClears, 1)
  check('fw.cachedValue', waiterA.value, true)
  // 已解析后再 wait：直接返回缓存值，不再请求
  outputA.state.requested = null
  check('fw.cachedWait', await waiterA.wait(1), true)
  check('fw.noSecondRequest', outputA.state.requested, null)
  // 超时 → false
  const outputB = makeOutputPort()
  const timeoutsB = []
  const waiterB = new InitialFrameMediaDataWaiter({
    output: outputB,
    scheduleTimeout: (seconds, callback) => {
      timeoutsB.push(callback)
      return () => {}
    }
  })
  const waitB = waiterB.wait(0.1)
  timeoutsB[0]()
  check('fw.timeoutFalse', await waitB, false)
  check('fw.timeoutClearsDelegate', outputB.state.delegateClears, 1)
  // 取消 → false
  const outputC = makeOutputPort()
  const cancellers = []
  const waiterC = new InitialFrameMediaDataWaiter({
    output: outputC,
    scheduleTimeout: () => () => {},
    registerCancellation: (cancel) => cancellers.push(cancel)
  })
  const waitC = waiterC.wait(1)
  cancellers[0]()
  check('fw.cancelledFalse', await waitC, false)
  check('fw.cancelClearsDelegate', outputC.state.delegateClears, 1)

}

await runEditorInteractionSupportBatch()


async function runEditorExportRequestBatch() {
  // ============================================ EditorExportRequest（Swift 431 行）
  const {
    EXPORT_OUTPUT_KINDS, exportOutputFileExtension, exportAssetRoleDisplayName,
    editorMediaFileVersion, editorMediaFileVersionEquals,
    editorExportScopeOutputRange, editorExportScopeSelectedSegmentCount,
    editorExportRequestErrorMessage, EditorExportRequestError,
    isFileURLPath, validateExistingLocalFile, validateCurrentVersion,
    makeExportAssetFromPath, validateCurrentAssetVersions, exportAssetInputURLs,
    exportFileNameComponent, exportOutputPath, exportTimestampText, defaultExportOutputPath,
    buildEditorExportRequest,
  } = m

  function kindOf(fn) {
    try {
      fn()
      return 'no-throw'
    } catch (error) {
      return error instanceof EditorExportRequestError ? error.kind : `other:${error}`
    }
  }
  function messageOf(fn) {
    try {
      fn()
      return 'no-throw'
    } catch (error) {
      return error.message
    }
  }

  check('ex.kinds', EXPORT_OUTPUT_KINDS.join(','), 'video,audio')
  check('ex.extVideo', exportOutputFileExtension('video'), 'mp4')
  check('ex.extAudio', exportOutputFileExtension('audio'), 'm4a')

  check('ex.roleScreen', exportAssetRoleDisplayName('screenRecording'), '主录屏')
  check('ex.roleCamera', exportAssetRoleDisplayName('cameraRecording'), '摄像头')
  check('ex.roleMic', exportAssetRoleDisplayName('microphoneRecording'), '麦克风')
  check('ex.roleWallpaper', exportAssetRoleDisplayName('wallpaper'), '背景素材')
  check('ex.roleSticker', exportAssetRoleDisplayName('sticker'), '贴图')

  // --- 文件代次
  const versionA = editorMediaFileVersion('/in/a.mp4', {
    systemNumber: 16777220n,
    systemFileNumber: 99n,
    size: 1024n,
    modificationDate: 1700000000000,
  })
  check('ex.versionPath', versionA.standardizedPath, '/in/a.mp4')
  check('ex.versionSize', versionA.fileSize === 1024n, true)
  check('ex.versionEquals', editorMediaFileVersionEquals(versionA, { ...versionA }), true)
  check(
    'ex.versionSizeDiffers',
    editorMediaFileVersionEquals(versionA, { ...versionA, fileSize: 2048n }),
    false
  )
  check(
    'ex.versionDateDiffers',
    editorMediaFileVersionEquals(versionA, { ...versionA, modificationDate: 1700000000001 }),
    false
  )
  check(
    'ex.versionMissingAttrs',
    editorMediaFileVersion('/in/b.mp4', null).fileSystemNumber === null,
    true
  )

  // --- 导出范围
  const scopeRange = { start: 1.5, end: 4.5 }
  check('ex.scopeFullRange', editorExportScopeOutputRange({ kind: 'fullProject' }) === null, true)
  check('ex.scopeFullCount', editorExportScopeSelectedSegmentCount({ kind: 'fullProject' }), 0)
  check(
    'ex.scopeRangeStart',
    editorExportScopeOutputRange({ kind: 'timelineRange', range: scopeRange, selectedSegmentCount: 3 }).start,
    1.5
  )
  check(
    'ex.scopeRangeCount',
    editorExportScopeSelectedSegmentCount({ kind: 'timelineRange', range: scopeRange, selectedSegmentCount: 3 }),
    3
  )

  // --- 错误文案（逐字）
  check(
    'ex.msgSession',
    editorExportRequestErrorMessage('editorSessionMismatch'),
    '导出素材不属于当前编辑会话，请等待预览重新准备。'
  )
  check(
    'ex.msgGeneration',
    editorExportRequestErrorMessage('mediaGenerationMismatch'),
    '导出素材已经被新的编辑代次取代，请重新导出。'
  )
  check(
    'ex.msgSequence',
    editorExportRequestErrorMessage('sourceSequenceMismatch'),
    '剪辑时间线已变化，请等待预览更新后重试。'
  )
  check(
    'ex.msgManifest',
    editorExportRequestErrorMessage('mediaManifestMismatch'),
    '项目素材清单已变化，请等待预览更新后重试。'
  )
  check(
    'ex.msgMissingRef',
    editorExportRequestErrorMessage('missingAssetReference', { role: 'cameraRecording' }),
    '项目需要摄像头素材，但当前编辑会话没有对应文件。'
  )
  check(
    'ex.msgMissingFile',
    editorExportRequestErrorMessage('missingAssetFile', { role: 'screenRecording', path: '/x.mp4' }),
    '主录屏素材不存在：/x.mp4。'
  )
  check(
    'ex.msgNonFile',
    // 上游 displayName(wallpaper) = "背景素材"，模板是 "\(displayName)素材不是…"，
    // 因此文案里出现「背景素材素材」是原样照搬，不做改写。
    editorExportRequestErrorMessage('nonFileAsset', { role: 'wallpaper', value: '/dir' }),
    '背景素材素材不是可用的本地文件：/dir。'
  )
  check(
    'ex.msgChanged',
    editorExportRequestErrorMessage('assetVersionChanged', { role: 'sticker', path: '/s.png' }),
    '贴图素材在导出前已变化：/s.png。请重新打开或刷新项目。'
  )
  check(
    'ex.msgInvalidURL',
    editorExportRequestErrorMessage('invalidOutputURL', { value: 'https://x/y.mp4' }),
    '导出位置不是本地文件路径：https://x/y.mp4。'
  )
  check(
    'ex.msgCollides',
    editorExportRequestErrorMessage('outputCollidesWithInput', { path: '/in.mp4' }),
    '导出位置不能覆盖项目素材：/in.mp4。'
  )
  check(
    'ex.msgRange',
    editorExportRequestErrorMessage('invalidOutputRange'),
    '所选片段已经变化，无法确定有效的导出范围。请重新选择片段。'
  )

  // --- 本地文件判定
  check('ex.isLocal', isFileURLPath('/in/a.mp4'), true)
  check('ex.isLocalWin', isFileURLPath('C:\\clips\\a.mp4'), true)
  check('ex.isRemote', isFileURLPath('https://x/a.mp4'), false)
  check('ex.isFileScheme', isFileURLPath('file:///in/a.mp4'), false)

  const fakeFileSystem = (files) => ({
    fileExists: (path) => Object.prototype.hasOwnProperty.call(files, path),
    isDirectory: (path) => files[path] === 'dir',
    attributes: (path) =>
      files[path] === 'dir' || !Object.prototype.hasOwnProperty.call(files, path)
        ? null
        : { systemNumber: 1n, systemFileNumber: 2n, size: BigInt(files[path]), modificationDate: 1000 },
  })
  const filesBase = { '/in/screen.mp4': 100, '/in/cam.mov': 200, '/in/mic.m4a': 300, '/in/sticker.png': 400 }
  const fsA = fakeFileSystem(filesBase)

  check('ex.validLocal', kindOf(() => validateExistingLocalFile('/in/screen.mp4', 'screenRecording', fsA)), 'no-throw')
  check('ex.validRemote', kindOf(() => validateExistingLocalFile('https://x/a.mp4', 'sticker', fsA)), 'nonFileAsset')
  check('ex.validMissing', kindOf(() => validateExistingLocalFile('/in/none.mp4', 'sticker', fsA)), 'missingAssetFile')
  const fsDir = fakeFileSystem({ ...filesBase, '/in/somedir': 'dir' })
  check('ex.validDirectory', kindOf(() => validateExistingLocalFile('/in/somedir', 'wallpaper', fsDir)), 'nonFileAsset')

  // --- 素材冻结与代次比对
  const screenAsset = makeExportAssetFromPath('/in/screen.mp4', 'screenRecording', fsA)
  check('ex.assetSize', screenAsset.version.fileSize === 100n, true)
  check('ex.assetStable', kindOf(() => validateCurrentVersion(screenAsset, 'screenRecording', fsA)), 'no-throw')
  const fsReplaced = fakeFileSystem({ ...filesBase, '/in/screen.mp4': 999 })
  check(
    'ex.assetReplaced',
    kindOf(() => validateCurrentVersion(screenAsset, 'screenRecording', fsReplaced)),
    'assetVersionChanged'
  )
  const fsGone = fakeFileSystem({ '/in/cam.mov': 200 })
  check(
    'ex.assetGone',
    kindOf(() => validateCurrentVersion(screenAsset, 'screenRecording', fsGone)),
    'missingAssetFile'
  )

  const stickerAsset = makeExportAssetFromPath('/in/sticker.png', 'sticker', fsA)
  const micAsset = makeExportAssetFromPath('/in/mic.m4a', 'microphoneRecording', fsA)
  const assetUnion = {
    source: screenAsset,
    camera: null,
    microphone: micAsset,
    wallpaper: null,
    stickers: { 'stickers/a.png': stickerAsset },
  }
  check('ex.assetUnionURLs', exportAssetInputURLs(assetUnion).length, 3)
  check('ex.assetUnionFirst', exportAssetInputURLs(assetUnion)[0], '/in/screen.mp4')
  check('ex.assetUnionAllValid', kindOf(() => validateCurrentAssetVersions(assetUnion, fsA)), 'no-throw')
  check(
    'ex.assetUnionBadSticker',
    kindOf(() =>
      validateCurrentAssetVersions(assetUnion, fakeFileSystem({ '/in/screen.mp4': 100, '/in/mic.m4a': 300 }))
    ),
    'missingAssetFile'
  )

  // --- 文件名净化
  check('ex.nameBlank', exportFileNameComponent('   '), null)
  check('ex.namePlain', exportFileNameComponent('  我的录像  '), '我的录像')
  check('ex.nameSlash', exportFileNameComponent('a/b:c'), 'a-b-c')
  check('ex.nameNewline', exportFileNameComponent('第一行\n第二行'), '第一行-第二行')
  check('ex.nameLeadingSeparator', exportFileNameComponent('/开头'), '开头')
  check('ex.nameControl', exportFileNameComponent('a\u0000b'), 'a-b')
  check('ex.nameCollapse', exportFileNameComponent('a / b'), 'a-b')

  // --- 输出路径
  const noFiles = () => false
  check(
    'ex.outPathPlain',
    exportOutputPath({ folder: '/out', baseName: '成片', outputKind: 'video', fileExists: noFiles }),
    '/out/成片.mp4'
  )
  check(
    'ex.outPathAudio',
    exportOutputPath({ folder: '/out', baseName: '音频', outputKind: 'audio', fileExists: noFiles }),
    '/out/音频.m4a'
  )
  const taken = new Set(['/out/成片.mp4', '/out/成片-2.mp4'])
  check(
    'ex.outPathSuffix',
    exportOutputPath({
      folder: '/out/',
      baseName: '成片',
      outputKind: 'video',
      fileExists: (path) => taken.has(path),
    }),
    '/out/成片-3.mp4'
  )
  check(
    'ex.outPathBlankName',
    kindOf(() =>
      exportOutputPath({ folder: '/out', baseName: ' : ', outputKind: 'video', fileExists: noFiles })
    ),
    'invalidOutputURL'
  )

  // --- 时间戳与默认名
  const stamp = exportTimestampText(new Date(2024, 0, 2, 3, 4, 5).getTime())
  check('ex.timestamp', stamp, '2024-01-02-03-04-05')
  check(
    'ex.defaultVideoNamed',
    defaultExportOutputPath({
      folder: '/out',
      projectName: '项目一',
      frameRate: 30,
      outputKind: 'video',
      timestampMilliseconds: 0,
      fileExists: noFiles,
    }),
    '/out/项目一-30fps.mp4'
  )
  check(
    'ex.defaultVideoUnnamed',
    defaultExportOutputPath({
      folder: '/out',
      projectName: '   ',
      frameRate: 60,
      outputKind: 'video',
      timestampMilliseconds: new Date(2024, 0, 2, 3, 4, 5).getTime(),
      fileExists: noFiles,
    }),
    '/out/成片-2024-01-02-03-04-05-60fps.mp4'
  )
  check(
    'ex.defaultAudioNamed',
    defaultExportOutputPath({
      folder: '/out',
      projectName: '项目一',
      frameRate: 30,
      outputKind: 'audio',
      timestampMilliseconds: 0,
      fileExists: noFiles,
    }),
    '/out/项目一-音频.m4a'
  )
  check(
    'ex.defaultAudioUnnamed',
    defaultExportOutputPath({
      folder: '/out',
      projectName: null,
      frameRate: 30,
      outputKind: 'audio',
      timestampMilliseconds: new Date(2024, 0, 2, 3, 4, 5).getTime(),
      fileExists: noFiles,
    }),
    '/out/音频-2024-01-02-03-04-05.m4a'
  )

  // --- 构建器：正常路径
  const requiredNone = {
    cameraVideo: false,
    microphoneAudio: false,
    backgroundImage: false,
    backgroundVideo: false,
  }
  const preparedBase = {
    editorSessionID: 'session-1',
    generation: 7,
    sourceSequenceKey: 'seq-1',
    sourceAsset: screenAsset,
    cameraAsset: null,
    microphoneAsset: null,
    sourceVideoTimeRange: { start: 0, end: 10 },
  }
  const buildInput = (overrides = {}) => ({
    editorSessionID: 'session-1',
    mediaGeneration: 7,
    project: { timeline: { stickerClips: [] } },
    prepared: preparedBase,
    hasMediaManifest: true,
    projectSourceSequenceKey: 'seq-1',
    preparedManifestKey: 'manifest-1',
    projectManifestKey: 'manifest-1',
    requiredMedia: requiredNone,
    wallpaperPath: null,
    stickerPaths: {},
    outputURL: '/out/final.mp4',
    outputKind: 'video',
    outputRange: null,
    fileSystem: fsA,
    buildMediaPlan: () => ({ outputDuration: 10 }),
    defaultOutputPath: () => '/out/default.mp4',
    ...overrides,
  })

  const happy = buildEditorExportRequest(buildInput())
  check('ex.buildURL', happy.outputURL, '/out/final.mp4')
  check('ex.buildSession', happy.editorSessionID, 'session-1')
  check('ex.buildGeneration', happy.mediaGeneration, 7)
  check('ex.buildKind', happy.outputKind, 'video')
  check('ex.buildRange', happy.outputRange === null, true)
  check('ex.buildDuration', happy.mediaPlan.outputDuration, 10)
  check('ex.buildCameraNull', happy.assets.camera === null, true)
  check('ex.buildMicNull', happy.assets.microphone === null, true)
  check('ex.buildWallpaperNull', happy.assets.wallpaper === null, true)
  check('ex.buildStickerCount', Object.keys(happy.assets.stickers).length, 0)

  const defaulted = buildEditorExportRequest(buildInput({ outputURL: null }))
  check('ex.buildDefaultURL', defaulted.outputURL, '/out/default.mp4')

  // --- 构建器：错误优先级
  check(
    'ex.buildSessionMismatch',
    kindOf(() => buildEditorExportRequest(buildInput({ editorSessionID: 'other' }))),
    'editorSessionMismatch'
  )
  check(
    'ex.buildGenerationMismatch',
    kindOf(() => buildEditorExportRequest(buildInput({ mediaGeneration: 8 }))),
    'mediaGenerationMismatch'
  )
  check(
    'ex.buildSequenceMismatch',
    kindOf(() => buildEditorExportRequest(buildInput({ projectSourceSequenceKey: 'seq-2' }))),
    'sourceSequenceMismatch'
  )
  check(
    'ex.buildManifestMismatch',
    kindOf(() => buildEditorExportRequest(buildInput({ projectManifestKey: 'manifest-2' }))),
    'mediaManifestMismatch'
  )
  check(
    'ex.buildNoManifest',
    kindOf(() => buildEditorExportRequest(buildInput({ hasMediaManifest: false }))),
    'missingAssetReference'
  )
  // 会话优先于清单：两者都不对时先报会话
  check(
    'ex.buildPrioritySession',
    kindOf(() => buildEditorExportRequest(buildInput({ editorSessionID: 'x', hasMediaManifest: false }))),
    'editorSessionMismatch'
  )

  // 缺素材（按后期状态决定）
  const needCamera = { ...requiredNone, cameraVideo: true }
  check(
    'ex.buildCameraMissing',
    kindOf(() => buildEditorExportRequest(buildInput({ requiredMedia: needCamera }))),
    'missingAssetReference'
  )
  check(
    'ex.buildCameraMissingMsg',
    messageOf(() => buildEditorExportRequest(buildInput({ requiredMedia: needCamera }))),
    '项目需要摄像头素材，但当前编辑会话没有对应文件。'
  )
  const needMic = { ...requiredNone, microphoneAudio: true }
  check(
    'ex.buildMicMissing',
    kindOf(() => buildEditorExportRequest(buildInput({ requiredMedia: needMic }))),
    'missingAssetReference'
  )
  const needWallpaper = { ...requiredNone, backgroundImage: true }
  check(
    'ex.buildWallpaperMissing',
    kindOf(() => buildEditorExportRequest(buildInput({ requiredMedia: needWallpaper }))),
    'missingAssetReference'
  )
  const camAsset = makeExportAssetFromPath('/in/cam.mov', 'cameraRecording', fsA)
  const withCamera = buildEditorExportRequest(
    buildInput({ requiredMedia: needCamera, prepared: { ...preparedBase, cameraAsset: camAsset } })
  )
  check('ex.buildCameraKept', withCamera.assets.camera !== null && withCamera.assets.camera.url, '/in/cam.mov')
  // 只导音频时不要摄像头
  const audioOnly = buildEditorExportRequest(
    buildInput({ outputKind: 'audio', outputURL: '/out/final.m4a', requiredMedia: needCamera })
  )
  check('ex.buildAudioSkipsCamera', audioOnly.assets.camera === null, true)

  const stickerProject = { timeline: { stickerClips: [{ relativePath: 'stickers/a.png' }] } }
  check(
    'ex.buildStickerMissing',
    kindOf(() => buildEditorExportRequest(buildInput({ project: stickerProject }))),
    'missingAssetReference'
  )
  const stickered = buildEditorExportRequest(
    buildInput({ project: stickerProject, stickerPaths: { 'stickers/a.png': '/in/sticker.png' } })
  )
  check('ex.buildStickerKept', stickered.assets.stickers['stickers/a.png'].url, '/in/sticker.png')

  // 素材在准备之后被替换
  check(
    'ex.buildAssetChanged',
    kindOf(() => buildEditorExportRequest(buildInput({ fileSystem: fsReplaced }))),
    'assetVersionChanged'
  )

  // 输出路径
  check(
    'ex.buildRemoteOutput',
    kindOf(() => buildEditorExportRequest(buildInput({ outputURL: 'https://x/final.mp4' }))),
    'invalidOutputURL'
  )
  check(
    'ex.buildWrongExtension',
    kindOf(() => buildEditorExportRequest(buildInput({ outputURL: '/out/final.m4a' }))),
    'invalidOutputURL'
  )
  check(
    'ex.buildWrongExtensionMsg',
    messageOf(() => buildEditorExportRequest(buildInput({ outputURL: '/out/final.m4a' }))),
    '导出位置不是本地文件路径：音视频类型与扩展名不匹配：/out/final.m4a。'
  )
  check(
    'ex.buildCaseInsensitiveExtension',
    buildEditorExportRequest(buildInput({ outputURL: '/out/final.MP4' })).outputURL,
    '/out/final.MP4'
  )
  check(
    'ex.buildCollides',
    kindOf(() => buildEditorExportRequest(buildInput({ outputURL: '/in/screen.mp4' }))),
    'outputCollidesWithInput'
  )

  // 源视频轨缺失
  check(
    'ex.buildNoSourceRange',
    kindOf(() =>
      buildEditorExportRequest(buildInput({ prepared: { ...preparedBase, sourceVideoTimeRange: null } }))
    ),
    'mediaManifestMismatch'
  )

  // 范围校验
  const ranged = buildEditorExportRequest(buildInput({ outputRange: { start: 2, end: 8 } }))
  check('ex.buildRangeKept', ranged.outputRange.start, 2)
  check('ex.buildRangeEnd', ranged.outputRange.end, 8)
  check(
    'ex.buildRangeNegative',
    kindOf(() => buildEditorExportRequest(buildInput({ outputRange: { start: -0.5, end: 8 } }))),
    'invalidOutputRange'
  )
  check(
    'ex.buildRangeOverflow',
    kindOf(() => buildEditorExportRequest(buildInput({ outputRange: { start: 1, end: 10.5 } }))),
    'invalidOutputRange'
  )
  check(
    'ex.buildRangeEmpty',
    kindOf(() => buildEditorExportRequest(buildInput({ outputRange: { start: 5, end: 5 } }))),
    'invalidOutputRange'
  )
  // 浮点尾差被容差吸收并夹取
  const tolerant = buildEditorExportRequest(
    buildInput({ outputRange: { start: -1e-9, end: 10 + 1e-9 } })
  )
  check('ex.buildRangeToleranceStart', tolerant.outputRange.start, 0)
  check('ex.buildRangeToleranceEnd', tolerant.outputRange.end, 10)

}

await runEditorExportRequestBatch()

async function runUiSmallPartsBatch() {
  // ============================== UI 小件与运行时身份（12 文件 / 303 行）
  const {
    RECORDER_ACCESSIBILITY_ID, recorderPhaseAccessibilityID,
    EDITOR_ICON_LINE_GRID, EDITOR_MAGNET_ICON_SCALE, EDITOR_MAGNET_ICON_KIND,
    EDITOR_MAGNET_ICON_ACCESSIBILITY_HIDDEN, editorMagnetIconGlyphSize, editorMagnetIconLayout,
    APP_IDENTITY_FALLBACK_DISPLAY_NAME, appDisplayName,
    WINDOW_SURFACE_CORNER_CURVE, WINDOW_SURFACE_MASKS_TO_BOUNDS, appWindowSurfaceStyle,
    windowSurfaceCornerRadius,
    ROTATION_HANDLE_SIZE, ROTATION_HANDLE_GLYPH_SIZE, ROTATION_HANDLE_SYMBOL,
    ROTATION_HANDLE_FONT_SIZE, ROTATION_HANDLE_FONT_WEIGHT, ROTATION_HANDLE_SHADOW,
    rotationHandleGlyphRotation, rotationHandleSurface,
    colorChannelByte, cssColorFromHexColor, hexColorFromRgbComponents,
    recorderViewStyleRoundTrip, RECORDER_VIEW_FALLBACK_HEX_COLOR, HexColor,
    compositeSharedFrame,
    ISLAND_CONTENT_BLUR, ISLAND_CANVAS_VERTICAL_SLACK, compactIslandLayout,
    islandCanvasHorizontalMargin, morphIslandLayout,
    SOURCE_THUMBNAIL_WIDTH, SOURCE_THUMBNAIL_MINIMUM_HEIGHT, SOURCE_THUMBNAIL_SHOWS_CURSOR,
    sourceThumbnailSize, resolveSourceThumbnailTarget,
    CAMERA_FULL_HD_PIXELS, CAMERA_FULL_HD_PIXEL_HEADROOM, cameraFormatIsLandscape,
    preferredCameraFormatIndex,
    MINIATURE_CORNER_RADIUS, MINIATURE_GEOMETRY, MINIATURE_PALETTE,
    miniatureContentRowCount, miniatureLayers,
    APPEARANCE_PREFERENCE_KEY, APPEARANCE_DEFAULT_PREFERENCE, APPEARANCE_TOGGLE_CORNER_RADIUS,
    appearanceToggleState, appearanceToggleTransition, appearanceToggleAnimation,
  } = m

  // ------------------------------------------------ RecorderAccessibility.swift
  check('ra.phaseSetup', RECORDER_ACCESSIBILITY_ID.phaseSetup, 'recorder.phase.setup')
  check('ra.phaseFinishing', RECORDER_ACCESSIBILITY_ID.phaseFinishing, 'recorder.phase.finishing')
  check('ra.permissionGate', RECORDER_ACCESSIBILITY_ID.permissionGate, 'recorder.permission-gate')
  check('ra.pauseResume', RECORDER_ACCESSIBILITY_ID.recordingPauseResume, 'recorder.recording.pause-resume')
  check('ra.stop', RECORDER_ACCESSIBILITY_ID.recordingStop, 'recorder.recording.stop')
  check('ra.phasePreparing', recorderPhaseAccessibilityID('preparing'), 'recorder.phase.preparing')
  check('ra.phaseRecording', recorderPhaseAccessibilityID('recording'), 'recorder.phase.recording')
  check(
    'ra.idCount',
    Object.keys(RECORDER_ACCESSIBILITY_ID).length,
    7
  )

  // ------------------------------------------------ EditorMagnetIcon.swift
  check('mi.grid', EDITOR_ICON_LINE_GRID, 18)
  check('mi.scale', EDITOR_MAGNET_ICON_SCALE, 1.15)
  check('mi.kind', EDITOR_MAGNET_ICON_KIND, 'magnet')
  check('mi.hidden', EDITOR_MAGNET_ICON_ACCESSIBILITY_HIDDEN, true)
  check('mi.glyphSquare', editorMagnetIconGlyphSize(20, 20), 23, 1e-9)
  check('mi.glyphMinAxis', editorMagnetIconGlyphSize(20, 30), 23, 1e-9)
  const magnetLayout = editorMagnetIconLayout(40, 24)
  check('mi.frameWidth', magnetLayout.frameWidth, 40)
  check('mi.frameHeight', magnetLayout.frameHeight, 24)
  check('mi.layoutGlyph', magnetLayout.glyphSize, 24 * 1.15, 1e-9)

  // ------------------------------------------------ AppIdentity.swift
  check('ai.fallback', APP_IDENTITY_FALLBACK_DISPLAY_NAME, 'DogSC')
  check('ai.null', appDisplayName(null), 'DogSC')
  check('ai.undefined', appDisplayName(undefined), 'DogSC')
  check('ai.blank', appDisplayName('   '), 'DogSC')
  check('ai.trimmed', appDisplayName('  DogSC Dev\n'), 'DogSC Dev')
  check('ai.passthrough', appDisplayName('狗录屏'), '狗录屏')

  // ------------------------------------------------ AppWindowSurface.swift
  check('ws.curve', WINDOW_SURFACE_CORNER_CURVE, 'continuous')
  check('ws.masks', WINDOW_SURFACE_MASKS_TO_BOUNDS, true)
  check('ws.radiusKept', windowSurfaceCornerRadius(16, 100, 40), 16)
  check('ws.radiusClamped', windowSurfaceCornerRadius(16, 100, 30), 15)
  check('ws.radiusNegative', windowSurfaceCornerRadius(-4, 100, 40), 0)
  check('ws.radiusNaN', windowSurfaceCornerRadius(NaN, 100, 40), 0)
  const surfaceStyle = appWindowSurfaceStyle(30, 60, 40)
  check('ws.styleRadius', surfaceStyle.cornerRadius, 20)
  check('ws.styleCurve', surfaceStyle.cornerCurve, 'continuous')
  check('ws.styleMasks', surfaceStyle.masksToBounds, true)

  // --------------------------------- EditorLinearFocusRotationHandle.swift
  check('rh.size', ROTATION_HANDLE_SIZE, 28)
  check('rh.glyph', ROTATION_HANDLE_GLYPH_SIZE, 17)
  check('rh.symbol', ROTATION_HANDLE_SYMBOL, 'arrow.triangle.2.circlepath')
  check('rh.fontSize', ROTATION_HANDLE_FONT_SIZE, 13)
  check('rh.fontWeight', ROTATION_HANDLE_FONT_WEIGHT, 600)
  check('rh.shadowY', ROTATION_HANDLE_SHADOW.offsetY, 1)
  check('rh.shadowOpacity', ROTATION_HANDLE_SHADOW.opacity, 0.24)
  const idleHandle = rotationHandleSurface(false)
  const activeHandle = rotationHandleSurface(true)
  check('rh.idleWhite', idleHandle.white, 0.19)
  check('rh.activeWhite', activeHandle.white, 0.13)
  check('rh.idleStroke', idleHandle.strokeWhite, 0.6)
  check('rh.activeStroke', activeHandle.strokeWhite, 0.85)
  check('rh.surfaceOpacity', idleHandle.opacity, 0.94)
  check('rh.strokeWidth', activeHandle.strokeWidth, 0.75)
  check('rh.rotationPassThrough', rotationHandleGlyphRotation(37.5), 37.5)
  check('rh.rotationNaN', rotationHandleGlyphRotation(NaN), 0)

  // ------------------------------------------- RecorderViewStyle.swift
  check('vs.byteMid', colorChannelByte(0.5), 128)
  check('vs.byteLow', colorChannelByte(-1), 0)
  check('vs.byteHigh', colorChannelByte(2), 255)
  check('vs.byteNaN', colorChannelByte(NaN), 0)
  check('vs.byteOne', colorChannelByte(1), 255)
  const sampleHex = HexColor.fromRgb24(0x33_66_99)
  check('vs.css', cssColorFromHexColor(sampleHex), 'rgb(51, 102, 153)')
  const rebuilt = hexColorFromRgbComponents(0.2, 0.4, 0.6)
  check('vs.rgb24', rebuilt.rgb24, 0x33_66_99)
  check('vs.roundTrip', recorderViewStyleRoundTrip(sampleHex).rgb24, 0x33_66_99)
  check('vs.roundTripTwice', recorderViewStyleRoundTrip(recorderViewStyleRoundTrip(sampleHex)).rgb24, 0x33_66_99)
  check('vs.fallbackWhite', RECORDER_VIEW_FALLBACK_HEX_COLOR.rgb24, 0xff_ff_ff)
  check('vs.clampsComponents', hexColorFromRgbComponents(-5, 5, NaN).rgb24, 0x00_ff_00)

  // ------------------------------------------- SharedFrameCompositor.swift
  const compositorCalls = []
  const compositorPorts = (preparedBackground, wallpaperSource = null) => ({
    preparedBackground,
    wallpaperSource,
    backgroundImage: (args) => {
      compositorCalls.push(['background', args.time, args.canvasRect.width])
      return 'computed-bg'
    },
    renderOver: (scene, resources, background) => {
      compositorCalls.push(['render', background, resources.tag])
      return `stack(${background})`
    },
    crop: (image, extent) => {
      compositorCalls.push(['crop', extent.width, extent.height])
      return `cropped(${image})`
    },
  })
  check(
    'fc.zeroExtent',
    compositeSharedFrame({ scene: { time: 1 } }, { tag: 'r' }, { width: 0, height: 10 }, compositorPorts('bg')),
    null
  )
  check('fc.zeroExtentNoCalls', compositorCalls.length, 0)
  compositorCalls.length = 0
  check(
    'fc.reusesPrepared',
    compositeSharedFrame({ scene: { time: 2 } }, { tag: 'r' }, { width: 8, height: 4 }, compositorPorts('ready-bg')),
    'cropped(stack(ready-bg))'
  )
  check('fc.reusesPreparedCalls', compositorCalls.length, 2)
  check('fc.reusesPreparedFirst', compositorCalls[0][0], 'render')
  compositorCalls.length = 0
  check(
    'fc.computesBackground',
    compositeSharedFrame({ scene: { time: 3 } }, { tag: 'r' }, { width: 8, height: 4 }, compositorPorts(null, 'wall')),
    'cropped(stack(computed-bg))'
  )
  check('fc.computesTime', compositorCalls[0][1], 3)
  check('fc.computesCanvas', compositorCalls[0][2], 8)
  check('fc.cropsToExtent', compositorCalls[2][1], 8)

  // ------------------------------------------- RecorderIslandLayout.swift
  check('il.blur', ISLAND_CONTENT_BLUR, 6)
  check('il.slack', ISLAND_CANVAS_VERTICAL_SLACK, 32)
  const compactIsland = compactIslandLayout({ width: 200, height: 40 })
  check('il.compactCanvas', compactIsland.canvasWidth, 200)
  check('il.compactPlacement', compactIsland.placementHeight, 40)
  check('il.marginFloor', islandCanvasHorizontalMargin(100), 16)
  check('il.marginPercent', islandCanvasHorizontalMargin(1000), 50)
  const morphed = morphIslandLayout({ width: 200, height: 40 }, { width: 260, height: 40 }, compactIsland)
  check('il.morphPlacement', morphed.placementWidth, 260)
  check('il.morphCanvasWidth', morphed.canvasWidth, 292)
  check('il.morphCanvasHeight', morphed.canvasHeight, 72)
  // 重指向到更小的内容：canvas 只增不减
  const shrunk = morphIslandLayout({ width: 260, height: 40 }, { width: 180, height: 36 }, morphed)
  check('il.shrinkKeepsCanvas', shrunk.canvasWidth, 292)
  check('il.shrinkPlacement', shrunk.placementWidth, 260)
  check('il.shrinkHeightCanvas', shrunk.canvasHeight, 72)

  // ------------------------------------------- RecorderSourceThumbnail.swift
  check('st.width', SOURCE_THUMBNAIL_WIDTH, 256)
  check('st.minHeight', SOURCE_THUMBNAIL_MINIMUM_HEIGHT, 2)
  check('st.noCursor', SOURCE_THUMBNAIL_SHOWS_CURSOR, false)
  const hd = sourceThumbnailSize(1920, 1080)
  check('st.hdWidth', hd.width, 256)
  check('st.hdHeight', hd.height, 144)
  check('st.tallHeight', sourceThumbnailSize(1000, 4000).height, 1024)
  check('st.zeroHeight', sourceThumbnailSize(0, 0).height, 2)
  check('st.ultraWideHeight', sourceThumbnailSize(3840, 1080).height, 72)
  check(
    'st.windowPreferred',
    resolveSourceThumbnailTarget({ windowID: 5, displayID: 1, availableWindowIDs: [5], availableDisplayIDs: [1] }).kind,
    'window'
  )
  check(
    'st.displayFallback',
    resolveSourceThumbnailTarget({ windowID: 9, displayID: 1, availableWindowIDs: [5], availableDisplayIDs: [1] })
      .kind,
    'display'
  )
  check(
    'st.displayExcludesOwn',
    resolveSourceThumbnailTarget({ windowID: null, displayID: 1, availableWindowIDs: [], availableDisplayIDs: [1] })
      .excludesOwnApplications,
    true
  )
  check(
    'st.none',
    resolveSourceThumbnailTarget({ windowID: 9, displayID: 7, availableWindowIDs: [5], availableDisplayIDs: [1] }),
    null
  )

  // --------------------------------------- CameraCaptureFormatSelector.swift
  check('cf.fullHd', CAMERA_FULL_HD_PIXELS, 2073600)
  check('cf.headroom', CAMERA_FULL_HD_PIXEL_HEADROOM, 1.05)
  check('cf.landscape', cameraFormatIsLandscape({ width: 1920, height: 1080 }), true)
  check('cf.landscapeSquare', cameraFormatIsLandscape({ width: 1080, height: 1080 }), true)
  const formats = [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 3840, height: 2160 },
    { width: 1080, height: 1920 },
  ]
  check('cf.capsAtFullHd', preferredCameraFormatIndex(formats, true), 1)
  check('cf.portraitDeviceKeepsTallest', preferredCameraFormatIndex(formats, false), 2)
  check(
    'cf.noLandscapeFallsBack',
    preferredCameraFormatIndex([{ width: 1080, height: 1920 }, { width: 720, height: 1280 }], true),
    0
  )
  check('cf.allInvalid', preferredCameraFormatIndex([{ width: 0, height: 1080 }, { width: 1920, height: 0 }], true), null)
  check('cf.empty', preferredCameraFormatIndex([], false), null)
  check('cf.tieKeepsFirst', preferredCameraFormatIndex([{ width: 1280, height: 720 }, { width: 1280, height: 720 }], true), 0)
  check(
    'cf.headroomAccepted',
    preferredCameraFormatIndex([{ width: 1936, height: 1088 }, { width: 1280, height: 720 }], true),
    0
  )
  check(
    'cf.skipInvalidKeepsOriginalIndex',
    preferredCameraFormatIndex([{ width: 0, height: 0 }, { width: 1280, height: 720 }], true),
    1
  )

  // --------------------------------------- SettingsAppearanceMiniature.swift
  check('mn.corner', MINIATURE_CORNER_RADIUS, 6)
  check('mn.sidebarWidth', MINIATURE_GEOMETRY.sidebarWidth, 30)
  check('mn.sidebarPadding', MINIATURE_GEOMETRY.sidebarPadding, 7)
  check('mn.dotSize', MINIATURE_GEOMETRY.sidebarDotSize, 5)
  check('mn.contentBars', MINIATURE_GEOMETRY.contentRowCount, 3)
  check('mn.trailingPadding', MINIATURE_GEOMETRY.contentTrailingPadding, 8)
  check('mn.canvasDark', MINIATURE_PALETTE.canvasDark, 0.1)
  check('mn.sidebarLight', MINIATURE_PALETTE.sidebarLight, 0.94)
  check('mn.rowCount', miniatureContentRowCount(), 3)
  const systemLayers = miniatureLayers('system')
  check('mn.systemLayers', systemLayers.length, 2)
  check('mn.systemBaseLight', systemLayers[0].dark, false)
  check('mn.systemOverlayDark', systemLayers[1].dark, true)
  check('mn.systemMask', systemLayers[1].trailingMaskFraction, 0.5)
  check('mn.lightSingle', miniatureLayers('light').length, 1)
  check('mn.lightDark', miniatureLayers('light')[0].dark, false)
  check('mn.darkSingle', miniatureLayers('dark')[0].dark, true)
  check('mn.darkMask', miniatureLayers('dark')[0].trailingMaskFraction, 0)

  // ------------------------------------- EditorAppearanceToggleButton.swift
  check('at.key', APPEARANCE_PREFERENCE_KEY, 'app.appearance')
  check('at.default', APPEARANCE_DEFAULT_PREFERENCE, 'dark')
  check('at.corner', APPEARANCE_TOGGLE_CORNER_RADIUS, 16)
  const darkState = appearanceToggleState(true)
  check('at.darkNext', darkState.nextPreference, 'light')
  check('at.darkSymbol', darkState.symbolName, 'moon.stars.fill')
  check('at.darkTitle', darkState.actionTitle, '切换为浅色外观')
  check('at.darkValue', darkState.accessibilityValue, '深色')
  const lightState = appearanceToggleState(false)
  check('at.lightNext', lightState.nextPreference, 'dark')
  check('at.lightSymbol', lightState.symbolName, 'sun.max.fill')
  check('at.lightTitle', lightState.actionTitle, '切换为深色外观')
  check('at.lightValue', lightState.accessibilityValue, '浅色')
  check('at.label', lightState.accessibilityLabel, '界面外观')
  check('at.identifier', lightState.accessibilityIdentifier, 'editor.appearance')
  // 「跟随系统」不写回偏好：目标永远是具体浅/深
  check('at.neverSystem', darkState.nextPreference !== 'system' && lightState.nextPreference !== 'system', true)
  const fadeTransition = appearanceToggleTransition(true)
  check('at.reduceTransition', fadeTransition.kind, 'opacity')
  const scaledTransition = appearanceToggleTransition(false)
  check('at.scaleIn', scaledTransition.insertionScale, 0.6)
  check('at.scaleOut', scaledTransition.removalScale, 1.3)
  check('at.animSpring', appearanceToggleAnimation(false).dampingFraction, 1)
  check('at.animSpringResponse', appearanceToggleAnimation(false).response, 0.38)
  check('at.animReduceKind', appearanceToggleAnimation(true).kind, 'easeOut')
  check('at.animReduceDuration', appearanceToggleAnimation(true).duration, 0.18)

}

await runUiSmallPartsBatch()

async function runOnboardingAndChromeBatch() {
  // ======================== 引导高亮 / 支持面板 / 采集过滤 / 字体（6 文件 / 289 行）
  const {
    TOUR_HIGHLIGHT_RECORDER_INPUTS, TOUR_HIGHLIGHT_RECORDER_SOURCES, flipTourHighlightY,
    tourHighlightCornerRadii, tourHighlightInsetRect, tourHighlightRounded, tourHighlightSegments,
    SUPPORT_APPRECIATION_IMAGE_RESOURCE, SUPPORT_IMAGE_CONTENT_MODE, SUPPORT_SHEET_ACCESSIBILITY,
    SUPPORT_SHEET_FOOTER, SUPPORT_SHEET_METRICS, SUPPORT_SHEET_MISSING_IMAGE_TEXT,
    SUPPORT_SHEET_TITLE, supportImageState,
    CAMERA_SESSION_NOTIFICATION, CAMERA_SESSION_UNKNOWN_ERROR_CODE,
    CAMERA_SESSION_UNKNOWN_ERROR_MESSAGE, CameraCaptureSessionEventMonitor,
    cameraSessionEventForNotification, cameraSessionRuntimeErrorEvent,
    DOCK_BUNDLE_IDENTIFIER, FINDER_BUNDLE_IDENTIFIER, captureSurfaceFilterPlan,
    finderDesktopWindowIDs,
    SAVE_ACTION_ROW_HEIGHT, SAVE_ACTION_DISABLED_OPACITY, SAVE_ACTION_PRESSED_SCALE,
    SAVE_ACTION_PRESS_ANIMATION_DURATION, SAVE_ACTION_CORNER_RADIUS, SAVE_TOGGLE_ROW_HEIGHT,
    SAVE_TOGGLE_ROW_LAYOUT, saveActionRowLayout, saveActionTrailing,
    APP_TYPOGRAPHY_FAMILY, APP_TYPOGRAPHY_FONT_FILES, APP_TYPOGRAPHY_RESOURCE_DIRECTORY,
    APP_TIMECODE_FONT_FAMILY, appRegularTextFontFamily, appTextStyleFont, appTextStyleSize,
    appTypographyFace, appUIFont,
  } = m

  // ---------------------------------------- FirstUseTourHighlight.swift
  check('th.sourcesSegments', TOUR_HIGHLIGHT_RECORDER_SOURCES.segments, 4)
  check('th.sourcesSpacing', TOUR_HIGHLIGHT_RECORDER_SOURCES.spacing, 2)
  check('th.sourcesInset', TOUR_HIGHLIGHT_RECORDER_SOURCES.inset, 2)
  check('th.sourcesContinuous', TOUR_HIGHLIGHT_RECORDER_SOURCES.continuous, false)
  check('th.inputsSegments', TOUR_HIGHLIGHT_RECORDER_INPUTS.segments, 3)
  check('th.inputsSpacing', TOUR_HIGHLIGHT_RECORDER_INPUTS.spacing, 0)
  const roundedAll = tourHighlightRounded(12)
  check('th.roundedRadius', roundedAll.radius, 12)
  check('th.roundedContinuous', roundedAll.continuous, true)
  check('th.roundedSegments', roundedAll.segments, 1)
  check('th.roundedInset', roundedAll.inset, 0)
  const radiiAll = tourHighlightCornerRadii(20, 'all')
  check('th.allTopLeading', radiiAll.topLeading, 20)
  check('th.allBottomTrailing', radiiAll.bottomTrailing, 20)
  const radiiTop = tourHighlightCornerRadii(20, 'top')
  check('th.topTopLeading', radiiTop.topLeading, 20)
  check('th.topBottomLeading', radiiTop.bottomLeading, 0)
  const radiiBottom = tourHighlightCornerRadii(20, 'bottom')
  check('th.bottomTopLeading', radiiBottom.topLeading, 0)
  check('th.bottomBottomTrailing', radiiBottom.bottomTrailing, 20)
  const tourBounds = { minX: 0, minY: 0, width: 100, height: 50 }
  const insetRect = tourHighlightInsetRect(tourBounds, 2)
  check('th.insetX', insetRect.minX, 2)
  check('th.insetWidth', insetRect.width, 96)
  check('th.insetHeight', insetRect.height, 46)
  const sourceSegments = tourHighlightSegments(TOUR_HIGHLIGHT_RECORDER_SOURCES, tourBounds)
  check('th.segmentCount', sourceSegments.length, 4)
  check('th.segmentWidth', sourceSegments[0].width, 22.5)
  check('th.segmentFirstX', sourceSegments[0].x, 2)
  check('th.segmentSecondX', sourceSegments[1].x, 26.5)
  check('th.segmentLastX', sourceSegments[3].x, 75.5)
  check('th.segmentHeight', sourceSegments[0].height, 46)
  check('th.segmentRadius', sourceSegments[0].cornerRadii.topLeading, 20)
  const singleSegment = tourHighlightSegments(tourHighlightRounded(8), tourBounds)
  check('th.singleCount', singleSegment.length, 1)
  check('th.singleWidth', singleSegment[0].width, 100)
  check('th.flipY', flipTourHighlightY(10, tourBounds), 40)

  // ----------------------------------------------- AppSupportSheet.swift
  check('sp.subdirectory', SUPPORT_APPRECIATION_IMAGE_RESOURCE.subdirectory, 'Support')
  check('sp.extension', SUPPORT_APPRECIATION_IMAGE_RESOURCE.extension, 'jpg')
  check('sp.title', SUPPORT_SHEET_TITLE, '请我喝杯咖啡')
  check('sp.footer', SUPPORT_SHEET_FOOTER, '免费开源 · 自愿支持')
  check('sp.missingText', SUPPORT_SHEET_MISSING_IMAGE_TEXT, '赞赏码暂时无法显示')
  check('sp.width', SUPPORT_SHEET_METRICS.width, 448)
  check('sp.padding', SUPPORT_SHEET_METRICS.padding, 24)
  check('sp.imageSize', SUPPORT_SHEET_METRICS.imageSize, 400)
  check('sp.imageRadius', SUPPORT_SHEET_METRICS.imageCornerRadius, 8)
  check('sp.borderWidth', SUPPORT_SHEET_METRICS.imageBorderWidth, 0.75)
  check('sp.closeSize', SUPPORT_SHEET_METRICS.closeButtonSize, 28)
  check('sp.closeLabel', SUPPORT_SHEET_ACCESSIBILITY.closeLabel, '关闭赞赏码')
  check('sp.imageHint', SUPPORT_SHEET_ACCESSIBILITY.imageHint, '使用手机扫描图片中的赞赏码')
  check('sp.contentMode', SUPPORT_IMAGE_CONTENT_MODE, 'contain')
  const missingState = supportImageState(null)
  check('sp.missingKind', missingState.kind, 'missing')
  check('sp.missingSize', missingState.size, 400)
  check('sp.missingTextState', missingState.text, '赞赏码暂时无法显示')
  const readyState = supportImageState('F:/res/Support/AppreciationCode.jpg')
  check('sp.readyKind', readyState.kind, 'ready')
  check('sp.readySize', readyState.size, 400)

  // ------------------------------- CameraCaptureSessionEventMonitor.swift
  check('cm.unknownMessage', CAMERA_SESSION_UNKNOWN_ERROR_MESSAGE, '摄像头会话发生未知运行错误')
  check('cm.unknownCode', CAMERA_SESSION_UNKNOWN_ERROR_CODE, -11800)
  check('cm.runtimeName', CAMERA_SESSION_NOTIFICATION.runtimeError, 'AVCaptureSessionRuntimeErrorNotification')
  const synthesized = cameraSessionRuntimeErrorEvent(null)
  check('cm.synthKind', synthesized.kind, 'runtimeError')
  check('cm.synthMessage', synthesized.message, '摄像头会话发生未知运行错误')
  check('cm.synthCode', synthesized.code, -11800)
  const blankError = cameraSessionRuntimeErrorEvent({ message: '   ' })
  check('cm.blankMessageSynthesized', blankError.message, '摄像头会话发生未知运行错误')
  const realError = cameraSessionRuntimeErrorEvent({ message: '设备已断开', code: 42 })
  check('cm.realMessage', realError.message, '设备已断开')
  check('cm.realCode', realError.code, 42)
  check(
    'cm.notifyInterrupted',
    cameraSessionEventForNotification(CAMERA_SESSION_NOTIFICATION.wasInterrupted).kind,
    'interrupted'
  )
  check(
    'cm.notifyEnded',
    cameraSessionEventForNotification(CAMERA_SESSION_NOTIFICATION.interruptionEnded).kind,
    'interruptionEnded'
  )
  check('cm.notifyUnknown', cameraSessionEventForNotification('SomethingElse'), null)
  const cameraEvents = []
  const cameraMonitor = new CameraCaptureSessionEventMonitor((event) => cameraEvents.push(event))
  const unsubscribers = []
  cameraMonitor.observe(CAMERA_SESSION_NOTIFICATION.wasInterrupted, (callback) => {
    unsubscribers.push(() => callback(null))
    return () => {
      const index = unsubscribers.length
      unsubscribers.length = Math.max(0, index - 1)
    }
  })
  check('cm.observerCount', cameraMonitor.observerCount, 1)
  cameraMonitor.dispose()
  check('cm.disposed', cameraMonitor.isDisposed, true)
  check('cm.disposedCount', cameraMonitor.observerCount, 0)

  // ------------------------------------------- CaptureSurfaceFilter.swift
  check('cf.dockBundle', DOCK_BUNDLE_IDENTIFIER, 'com.apple.dock')
  check('cf.finderBundle', FINDER_BUNDLE_IDENTIFIER, 'com.apple.finder')
  const ownApps = [
    { processID: 100, bundleIdentifier: 'com.dogsc.app' },
    { processID: 100, bundleIdentifier: 'com.dogsc.helper' },
  ]
  const otherApps = [
    { processID: 200, bundleIdentifier: 'com.apple.dock' },
    { processID: 300, bundleIdentifier: 'com.apple.finder' },
  ]
  const filterWindows = [
    { windowID: 5, ownerProcessID: 100 },
    { windowID: 6, ownerProcessID: 100 },
    { windowID: 7, ownerProcessID: 300 },
    { windowID: 8, ownerProcessID: 300 },
  ]
  const filterInput = (overrides = {}) => ({
    configuration: { hidesDock: true, hidesDesktopFiles: true },
    applications: [...ownApps, ...otherApps],
    windows: filterWindows,
    ownProcessID: 100,
    editorWindowIDs: [5],
    finderDesktopWindowIDs: [8],
    ...overrides,
  })
  const fullPlan = captureSurfaceFilterPlan(filterInput())
  check('cf.excludedCount', fullPlan.excludedApplications.length, 3)
  check('cf.excludedOwn', fullPlan.excludedApplications.filter((a) => a.processID === 100).length, 2)
  check('cf.excludedDock', fullPlan.excludedApplications.some((a) => a.bundleIdentifier === 'com.apple.dock'), true)
  check('cf.exceptingWindows', fullPlan.exceptingWindowIDs.join(','), '5,8')
  check('cf.editorWindows', fullPlan.editorWindowIDs.join(','), '5')
  const leanPlan = captureSurfaceFilterPlan(
    filterInput({ configuration: { hidesDock: false, hidesDesktopFiles: false } })
  )
  check('cf.leanExcluded', leanPlan.excludedApplications.length, 2)
  check('cf.leanExcepting', leanPlan.exceptingWindowIDs.join(','), '5')
  const desktopWindows = [
    { ownerProcessID: 300, ownerBundleIdentifier: 'com.apple.finder', layer: -1, windowNumber: 8 },
    { ownerProcessID: 300, ownerBundleIdentifier: 'com.apple.finder', layer: 0, windowNumber: 9 },
    { ownerProcessID: 200, ownerBundleIdentifier: 'com.apple.dock', layer: -1, windowNumber: 10 },
  ]
  check('cf.desktopIDs', finderDesktopWindowIDs(desktopWindows).join(','), '8')

  // ----------------------------------------- RecorderSaveActions.swift
  check('sa.rowHeight', SAVE_ACTION_ROW_HEIGHT, 36)
  check('sa.toggleHeight', SAVE_TOGGLE_ROW_HEIGHT, 34)
  check('sa.pressedScale', SAVE_ACTION_PRESSED_SCALE, 0.98)
  check('sa.pressDuration', SAVE_ACTION_PRESS_ANIMATION_DURATION, 0.13)
  check('sa.disabledOpacity', SAVE_ACTION_DISABLED_OPACITY, 0.4)
  check('sa.cornerRadius', SAVE_ACTION_CORNER_RADIUS, 9)
  check('sa.toggleTint', SAVE_TOGGLE_ROW_LAYOUT.tint, 'mint')
  check('sa.toggleControlSize', SAVE_TOGGLE_ROW_LAYOUT.controlSize, 'small')
  check('sa.trailingDetail', saveActionTrailing('12 MB', true), 'detail')
  check('sa.trailingDetailEmpty', saveActionTrailing('', true), 'chevron')
  check('sa.trailingChevron', saveActionTrailing(null, true), 'chevron')
  check('sa.trailingNone', saveActionTrailing(null, false), 'none')
  const pressedLayout = saveActionRowLayout({
    title: '保存到文件',
    symbol: 'square.and.arrow.down',
    detail: null,
    enabled: true,
    showsChevron: true,
    pressed: true,
  })
  check('sa.pressedScaleApplied', pressedLayout.scale, 0.98)
  check('sa.enabledOpacity', pressedLayout.opacity, 1)
  check('sa.animationKind', pressedLayout.pressedAnimation.kind, 'easeOut')
  check('sa.animationDuration', pressedLayout.pressedAnimation.duration, 0.13)
  check('sa.idleScale', saveActionRowLayout({ title: 't', symbol: 's', detail: null, enabled: true, showsChevron: false, pressed: false }).scale, 1)
  check(
    'sa.disabledDim',
    saveActionRowLayout({ title: 't', symbol: 's', detail: null, enabled: false, showsChevron: false, pressed: false }).opacity,
    0.4
  )

  // ------------------------------------------------ AppTypography.swift
  check('ty.family', APP_TYPOGRAPHY_FAMILY, 'AlibabaPuHuiTi_3')
  check('ty.resourceDir', APP_TYPOGRAPHY_RESOURCE_DIRECTORY, 'Fonts')
  check('ty.fileCount', APP_TYPOGRAPHY_FONT_FILES.length, 3)
  check('ty.firstFile', APP_TYPOGRAPHY_FONT_FILES[0].file, 'AlibabaPuHuiTi-3-55-Regular.otf')
  check('ty.firstFace', APP_TYPOGRAPHY_FONT_FILES[0].face, '55_Regular')
  check('ty.regularFace', appTypographyFace('regular'), '55_Regular')
  check('ty.lightFace', appTypographyFace('light'), '55_Regular')
  check('ty.mediumFace', appTypographyFace('medium'), '65_Medium')
  check('ty.semiboldFace', appTypographyFace('semibold'), '75_SemiBold')
  check('ty.boldFace', appTypographyFace('bold'), '75_SemiBold')
  check('ty.blackFace', appTypographyFace('black'), '75_SemiBold')
  check('ty.sizeTitle2', appTextStyleSize('title2'), 18)
  check('ty.sizeHeadline', appTextStyleSize('headline'), 13)
  check('ty.sizeCaption2', appTextStyleSize('caption2'), 10)
  check('ty.sizeUnknown', appTextStyleSize('nope'), 13)
  const bodyFont = appUIFont(13)
  check('ty.bodyFamily', bodyFont.family, 'AlibabaPuHuiTi_3_55_Regular')
  check('ty.bodyCustom', bodyFont.custom, true)
  check('ty.monoUsesSystem', appUIFont(13, 'regular', 'monospaced').family, 'system-ui')
  check('ty.monoNotCustom', appUIFont(13, 'regular', 'monospaced').custom, false)
  check('ty.unregisteredFallsBack', appUIFont(13, 'regular', 'default', false).family, 'system-ui')
  const headlineFont = appTextStyleFont('headline')
  check('ty.headlineWeight', headlineFont.weight, 'semibold')
  check('ty.headlineSize', headlineFont.size, 13)
  check('ty.headlineFamily', headlineFont.family, 'AlibabaPuHuiTi_3_75_SemiBold')
  check('ty.captionWeight', appTextStyleFont('caption2').weight, 'regular')
  check('ty.explicitWeightWins', appTextStyleFont('headline', 'regular').weight, 'regular')
  check('ty.measureFamily', appRegularTextFontFamily(), 'AlibabaPuHuiTi_3_55_Regular')
  check('ty.measureFamilyFallback', appRegularTextFontFamily(false), 'system-ui')
  check('ty.timecodeIsSystemMono', APP_TIMECODE_FONT_FAMILY.includes('ui-monospace'), true)

}

await runOnboardingAndChromeBatch()

async function runEditorChromeMathBatch() {
  // ===== 滑块行程 / 录制标记 / 工作区布局 / 暂停帧 / 裁切呈现 / 键盘桥（6 文件 / 500 行）
  const {
    EDITOR_SLIDER_MINIMUM_KNEE, EDITOR_SLIDER_TICK_MINIMUM_SPACING, EDITOR_SLIDER_SCALE_LINEAR,
    linearTickStep, logarithmicSliderScale, sliderFraction, sliderScaleForValueFormat, sliderTicks,
    sliderValue,
    RECORDING_MARKER_DEBOUNCE_SECONDS, RECORDING_MARKER_HOTKEY_ID, RECORDING_MARKER_HOTKEY_KEY_CODE,
    RECORDING_MARKER_HOTKEY_SIGNATURE, canAddRecordingMarker,
    nextRecordingMarkerNumber, recordingMarkerHotKeyShouldBeRegistered,
    recordingMarkerIsTooSoon, recordingMarkerShortcutAvailable, recordingMarkerToAppend,
    EDITOR_MINIMUM_WINDOW_SIZE, EDITOR_INTERFACE_RADIUS, editorChromeScaledSize,
    editorChromeUnscaledSize, editorTimelineHeight, editorWorkspaceCompression,
    editorWorkspaceMetrics, editorWorkspaceValue,
    pausedCameraImageDecision, pausedFrameIndex, pausedFramePublicationIsCurrent, pausedFrameTime,
    nextPausedFrameDecodeToken, shouldRefreshPausedFrames,
    EDITOR_CROP_ONLY_ACTIONS, EDITOR_STANDARD_TOOLBAR_ACTIONS, EDITOR_CROP_TOOLBAR_ACTIONS,
    editorCropPresentation, editorCropPresentationIsActive, editorCropToolbarPermits,
    SLIDER_ARROW_KEY_CODES, SLIDER_KEY_CODE_DOWN, SLIDER_KEY_CODE_LEFT, SLIDER_KEY_CODE_RIGHT,
    SLIDER_KEY_CODE_UP, sliderAcceptsFocus, sliderKeyboardStep, sliderMouseDownReleasesFocus,
    sliderShouldRequestFocus, sliderStepDirection,
  } = m

  const noModifiers = { shift: false, command: false, control: false, option: false }

  // ---------------------------------------------- EditorSliderScale.swift
  check('ss.minimumKnee', EDITOR_SLIDER_MINIMUM_KNEE, 0.000001)
  check('ss.tickSpacing', EDITOR_SLIDER_TICK_MINIMUM_SPACING, 38)
  check('ss.linearKind', EDITOR_SLIDER_SCALE_LINEAR.kind, 'linear')
  const range10 = { lower: 0, upper: 10 }
  check('ss.linearFraction', sliderFraction(EDITOR_SLIDER_SCALE_LINEAR, 2.5, range10), 0.25)
  check('ss.linearBelow', sliderFraction(EDITOR_SLIDER_SCALE_LINEAR, -5, range10), 0)
  check('ss.linearAbove', sliderFraction(EDITOR_SLIDER_SCALE_LINEAR, 20, range10), 1)
  check('ss.zeroSpan', sliderFraction(EDITOR_SLIDER_SCALE_LINEAR, 5, { lower: 5, upper: 5 }), 0)
  check('ss.nanValue', sliderFraction(EDITOR_SLIDER_SCALE_LINEAR, NaN, range10), 0)
  const logKnee1 = logarithmicSliderScale(1)
  check('ss.logFractionAtKnee', sliderFraction(logKnee1, 1, range10), Math.log1p(1) / Math.log1p(10), 1e-12)
  check('ss.logFractionZero', sliderFraction(logKnee1, 0, range10), 0)
  check('ss.logValueRoundTrip', sliderValue(logKnee1, sliderFraction(logKnee1, 5, range10), range10), 5, 1e-9)
  check('ss.logValueClamped', sliderValue(logKnee1, 1.5, range10), 10, 1e-9)
  check('ss.linearValue', sliderValue(EDITOR_SLIDER_SCALE_LINEAR, 0.5, range10), 5)
  check('ss.valueBelowZero', sliderValue(EDITOR_SLIDER_SCALE_LINEAR, -1, range10), 0)
  check('ss.tickStep', linearTickStep(10), 5)
  check('ss.tickStepSmall', linearTickStep(4), 1)
  check('ss.linearTicks', sliderTicks(EDITOR_SLIDER_SCALE_LINEAR, range10, 400).join(','), '0,5,10')
  check('ss.linearTicksFiltered', sliderTicks(EDITOR_SLIDER_SCALE_LINEAR, range10, 60).join(','), '0,10')
  const logTicks = sliderTicks(logKnee1, { lower: 1, upper: 100 }, 500)
  check('ss.logTickCount', logTicks.length, 7)
  check('ss.logTickFirst', logTicks[0], 1)
  check('ss.logTickSecond', logTicks[1], 2)
  check('ss.logTickLast', logTicks[logTicks.length - 1], 100)
  check('ss.degenerateTicks', sliderTicks(EDITOR_SLIDER_SCALE_LINEAR, { lower: 3, upper: 3 }, 100).join(','), '3')
  check('ss.scaleMultiplier', sliderScaleForValueFormat('multiplier', range10).knee, 1)
  check('ss.scaleSeconds', sliderScaleForValueFormat('seconds', range10).knee, 0.5)
  check('ss.scalePoints', sliderScaleForValueFormat('points', { lower: 0, upper: 100 }).knee, 12.5)
  check('ss.scalePointsFloor', sliderScaleForValueFormat('points', { lower: 0, upper: 4 }).knee, 1)
  check('ss.scalePercentLinear', sliderScaleForValueFormat('percent', range10).kind, 'linear')
  check('ss.scaleAngleLinear', sliderScaleForValueFormat('angle', range10).kind, 'linear')
  check('ss.negativeRangeLinear', sliderScaleForValueFormat('multiplier', { lower: -2, upper: 2 }).kind, 'linear')

  // ------------------------------------------------ RecordingMarkers.swift
  check('rm.signature', RECORDING_MARKER_HOTKEY_SIGNATURE, 0x4447_4d4b)
  check('rm.hotkeyID', RECORDING_MARKER_HOTKEY_ID, 1)
  check('rm.keyCode', RECORDING_MARKER_HOTKEY_KEY_CODE, 0x4d)
  check('rm.debounce', RECORDING_MARKER_DEBOUNCE_SECONDS, 0.3)
  check('rm.canAdd', canAddRecordingMarker({ phase: 'recording', isPaused: false, isPauseTransitioning: false, sourceTime: 1.2 }), true)
  check('rm.blockedPaused', canAddRecordingMarker({ phase: 'recording', isPaused: true, isPauseTransitioning: false, sourceTime: 1.2 }), false)
  check('rm.blockedTransitioning', canAddRecordingMarker({ phase: 'recording', isPaused: false, isPauseTransitioning: true, sourceTime: 1.2 }), false)
  check('rm.blockedSetup', canAddRecordingMarker({ phase: 'setup', isPaused: false, isPauseTransitioning: false, sourceTime: 1.2 }), false)
  check('rm.blockedNoTime', canAddRecordingMarker({ phase: 'recording', isPaused: false, isPauseTransitioning: false, sourceTime: null }), false)
  check('rm.tooSoon', recordingMarkerIsTooSoon([{ sourceTime: 10, number: 1 }], 10.2), true)
  check('rm.notTooSoon', recordingMarkerIsTooSoon([{ sourceTime: 10, number: 1 }], 10.5), false)
  check('rm.emptyNotTooSoon', recordingMarkerIsTooSoon([], 1), false)
  check('rm.numberFromEmpty', nextRecordingMarkerNumber([]), 1)
  check('rm.numberAfterGap', nextRecordingMarkerNumber([{ sourceTime: 1, number: 1 }, { sourceTime: 2, number: 5 }]), 6)
  const appendedMarker = recordingMarkerToAppend(
    { phase: 'recording', isPaused: false, isPauseTransitioning: false, sourceTime: 4.2 },
    [{ sourceTime: 1, number: 1 }]
  )
  check('rm.appendNumber', appendedMarker.number, 2)
  check('rm.appendTime', appendedMarker.sourceTime, 4.2)
  check(
    'rm.appendRejectedTooSoon',
    recordingMarkerToAppend(
      { phase: 'recording', isPaused: false, isPauseTransitioning: false, sourceTime: 1.1 },
      [{ sourceTime: 1, number: 1 }]
    ),
    null
  )
  check(
    'rm.appendRejectedNotFinite',
    recordingMarkerToAppend(
      { phase: 'recording', isPaused: false, isPauseTransitioning: false, sourceTime: NaN },
      []
    ),
    null
  )
  check('rm.registerWhileRecording', recordingMarkerHotKeyShouldBeRegistered('recording'), true)
  check('rm.unregisterOtherwise', recordingMarkerHotKeyShouldBeRegistered('finishing'), false)
  check('rm.shortcutAvailable', recordingMarkerShortcutAvailable(true, true), true)
  check('rm.shortcutUnavailable', recordingMarkerShortcutAvailable(true, false), false)

  // --------------------------------------------- EditorWorkspaceLayout.swift
  check('wl.minWidth', EDITOR_MINIMUM_WINDOW_SIZE.width, 840)
  check('wl.minHeight', EDITOR_MINIMUM_WINDOW_SIZE.height, 600)
  check('wl.floatingRadius', EDITOR_INTERFACE_RADIUS.floating, 20)
  const roomy = editorWorkspaceMetrics({ width: 1440, height: 820 })
  check('wl.roomyCompression', roomy.compression, 0)
  check('wl.roomyCompact', roomy.isCompact, false)
  check('wl.roomyChrome', roomy.chromeScale, 1)
  check('wl.roomyToolbar', roomy.toolbarHeight, 72)
  check('wl.roomyInset', roomy.outerInset, 16)
  check('wl.roomyGap', roomy.timelineGap, 12)
  check('wl.roomyRadius', roomy.surfaceRadius, 20)
  check('wl.roomyInspectorLogical', roomy.inspectorLogicalWidth, 384)
  check('wl.roomyInspector', roomy.inspectorWidth, 384)
  check('wl.roomyRail', roomy.railWidth, 72)
  check('wl.roomyNoCompactControls', roomy.compactTimelineControls, false)
  const tight = editorWorkspaceMetrics({ width: 1024, height: 700 })
  check('wl.tightCompression', tight.compression, 1)
  check('wl.tightChrome', tight.chromeScale, 0.86)
  check('wl.tightToolbar', tight.toolbarHeight, 56)
  check('wl.tightInset', tight.outerInset, 10)
  check('wl.tightGap', tight.timelineGap, 8)
  check('wl.tightEdge', tight.workspaceEdge, 12)
  check('wl.tightRadius', tight.surfaceRadius, 20 * 0.86, 1e-9)
  check('wl.tightInspector', tight.inspectorWidth, 384 * 0.86, 1e-9)
  check('wl.tightRail', tight.railWidth, 72 * 0.86, 1e-9)
  check('wl.tightCanvasOffset', tight.canvasToolbarOffset, 46 * 0.86, 1e-9)
  check('wl.tightCompactControls', tight.compactTimelineControls, true)
  check('wl.tightIconOnly', tight.iconOnlyTimelineControls, true)
  // 窗口够大但屏幕小：仍然要紧凑（1080p 上最大化也一样）
  check(
    'wl.screenPressure',
    editorWorkspaceCompression({ width: 1600, height: 900, screenWidth: 1280, screenHeight: 800 }),
    1
  )
  // 中间态线性插值
  const mid = editorWorkspaceCompression({ width: 1296, height: 730 })
  check('wl.midCompression', mid, 0.4090909090909091, 1e-9)
  check('wl.midValue', editorWorkspaceValue(mid, 72, 56), 72 + (56 - 72) * mid, 1e-9)
  check('wl.timelinePreferred', editorTimelineHeight(0, 300, 900), 300)
  check('wl.timelineDefault', editorTimelineHeight(0, null, 900), 300)
  check('wl.timelineClampedToBudget', editorTimelineHeight(0, 800, 900), 552)
  check('wl.timelineCompactBudget', editorTimelineHeight(1, 400, 700), 308)
  check('wl.timelineFloor', editorTimelineHeight(1, 400, 300), 170)
  check('wl.timelineShortPreferred', editorTimelineHeight(1, 100, 300), 100)
  // 提案先除以 scale 再问子视图：scale 0.5 时 200 的空间等于 400 的未缩放内容
  check('wl.chromeUnscaledWidth', editorChromeUnscaledSize(0.5, { width: 200, height: null }).width, 400)
  check('wl.chromeUnscaledNullHeight', editorChromeUnscaledSize(0.5, { width: 200, height: null }).height, null)
  check('wl.chromeScaled', editorChromeScaledSize(0.86, { width: 100, height: 50 }).width, 86, 1e-9)

  // ----------------------------------------- EditorPlaybackPausedFrames.swift
  check('pf.refreshGate', shouldRefreshPausedFrames({ isPreviewActive: true, hasPreparedMedia: true, isPlaying: false }), true)
  check('pf.refreshBlockedPlaying', shouldRefreshPausedFrames({ isPreviewActive: true, hasPreparedMedia: true, isPlaying: true }), false)
  check('pf.refreshBlockedInactive', shouldRefreshPausedFrames({ isPreviewActive: false, hasPreparedMedia: true, isPlaying: false }), false)
  check('pf.alignedTime', pausedFrameTime(1.55, 10, 30), 46 / 30, 1e-12)
  check('pf.alignedIndex', pausedFrameIndex(1.55, 10, 30), 46)
  check('pf.zeroRateFallsBack', pausedFrameIndex(1.55, 10, 0), 1)
  check('pf.negativeClamped', pausedFrameIndex(-1, 10, 30), 0)
  check('pf.overrunClamped', pausedFrameIndex(20, 10, 30), 300)
  const ticket = { generation: 3, seekToken: 7, decodeToken: 11 }
  check('pf.publishCurrent', pausedFramePublicationIsCurrent(ticket, { ...ticket }, false), true)
  check('pf.publishPlaying', pausedFramePublicationIsCurrent(ticket, { ...ticket }, true), false)
  check('pf.publishStaleDecode', pausedFramePublicationIsCurrent(ticket, { ...ticket, decodeToken: 12 }, false), false)
  check('pf.publishStaleSeek', pausedFramePublicationIsCurrent(ticket, { ...ticket, seekToken: 8 }, false), false)
  check('pf.publishStaleGeneration', pausedFramePublicationIsCurrent(ticket, { ...ticket, generation: 4 }, false), false)
  check('pf.cameraSet', pausedCameraImageDecision(true, true), 'set')
  check('pf.cameraKeep', pausedCameraImageDecision(true, false), 'keep')
  check('pf.cameraClear', pausedCameraImageDecision(false, false), 'clear')
  check('pf.decodeTokenWrap', nextPausedFrameDecodeToken(0xffff_ffff), 0)

  // ----------------------------------------------- EditorCropPresentation.swift
  check('cp.actionCount', EDITOR_CROP_TOOLBAR_ACTIONS.length, 6)
  check('cp.standardActions', EDITOR_STANDARD_TOOLBAR_ACTIONS.join(','), 'changeCanvasAspectRatio,beginCrop,openScreenAppearance')
  check('cp.cropOnlyActions', EDITOR_CROP_ONLY_ACTIONS.join(','), 'resetCrop,cancelCrop,confirmCrop')
  const idleCrop = editorCropPresentation(null)
  check('cp.idleToolbar', idleCrop.toolbarMode, 'standardControls')
  check('cp.idleInspector', idleCrop.inspectorMode, 'selectedInspector')
  check('cp.idleCanvas', idleCrop.canvasMode, 'composition')
  check('cp.idleDraft', idleCrop.draft, null)
  check('cp.idleActive', editorCropPresentationIsActive(idleCrop), false)
  const halfCrop = editorCropPresentation({
    tool: 'crop',
    selection: 'clip',
    crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
  })
  check('cp.needsBothSelection', halfCrop.toolbarMode, 'standardControls')
  const activeCrop = editorCropPresentation({
    tool: 'crop',
    selection: 'crop',
    crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
  })
  check('cp.activeToolbar', activeCrop.toolbarMode, 'cropControls')
  check('cp.activeInspector', activeCrop.inspectorMode, 'cropInspector')
  check('cp.activeCanvas', activeCrop.canvasMode, 'cropEditor')
  check('cp.activeDraftX', activeCrop.draft.x, 0.2)
  check('cp.activeIsActive', editorCropPresentationIsActive(activeCrop), true)
  const clampedActive = editorCropPresentation({
    tool: 'crop',
    selection: 'crop',
    crop: { x: 1.5, y: -1, width: 0, height: 5 },
  })
  check('cp.clampX', clampedActive.draft.x, 0.98)
  check('cp.clampY', clampedActive.draft.y, 0)
  check('cp.clampWidth', clampedActive.draft.width, 0.02)
  check('cp.clampHeight', clampedActive.draft.height, 1)
  check('cp.standardBegin', editorCropToolbarPermits('standardControls', 'beginCrop'), true)
  check('cp.standardConfirmBlocked', editorCropToolbarPermits('standardControls', 'confirmCrop'), false)
  check('cp.cropConfirm', editorCropToolbarPermits('cropControls', 'confirmCrop'), true)
  check('cp.cropBeginBlocked', editorCropToolbarPermits('cropControls', 'beginCrop'), false)

  // ----------------------------------------- EditorSliderKeyboardBridge.swift
  check('sk.left', SLIDER_KEY_CODE_LEFT, 123)
  check('sk.right', SLIDER_KEY_CODE_RIGHT, 124)
  check('sk.down', SLIDER_KEY_CODE_DOWN, 125)
  check('sk.up', SLIDER_KEY_CODE_UP, 126)
  check('sk.arrowCount', SLIDER_ARROW_KEY_CODES.length, 4)
  check('sk.dirRight', sliderStepDirection(124), 1)
  check('sk.dirUp', sliderStepDirection(126), 1)
  check('sk.dirLeft', sliderStepDirection(123), -1)
  check('sk.dirDown', sliderStepDirection(125), -1)
  const plainStep = sliderKeyboardStep(124, noModifiers, true)
  check('sk.stepDirection', plainStep.direction, 1)
  check('sk.stepNotFine', plainStep.fine, false)
  check('sk.shiftFine', sliderKeyboardStep(123, { ...noModifiers, shift: true }, true).fine, true)
  check('sk.commandBlocked', sliderKeyboardStep(124, { ...noModifiers, command: true }, true), null)
  check('sk.controlBlocked', sliderKeyboardStep(124, { ...noModifiers, control: true }, true), null)
  check('sk.optionBlocked', sliderKeyboardStep(124, { ...noModifiers, option: true }, true), null)
  check('sk.disabledBlocked', sliderKeyboardStep(124, noModifiers, false), null)
  check('sk.nonArrowBlocked', sliderKeyboardStep(0, noModifiers, true), null)
  check('sk.acceptsFocus', sliderAcceptsFocus(true), true)
  check('sk.disabledNoFocus', sliderAcceptsFocus(false), false)
  check('sk.requestOnEdge', sliderShouldRequestFocus(true, false), true)
  check('sk.noRepeatRequest', sliderShouldRequestFocus(true, true), false)
  check('sk.otherWindowReleases', sliderMouseDownReleasesFocus(false, true), true)
  check('sk.outsideReleases', sliderMouseDownReleasesFocus(true, false), true)
  check('sk.insideKeeps', sliderMouseDownReleasesFocus(true, true), false)

}

await runEditorChromeMathBatch()

async function runPreviewAndAudioBatch() {
  // ========== 提示卡 / 预览采样 / 弹出菜单 / 纯音频导出（4 文件 / 335 行）
  const {
    TRANSIENT_NOTICE_METRICS, TRANSIENT_NOTICE_PROJECT_OPENED_PREFIX,
    TRANSIENT_NOTICE_SAME_TRACK_MESSAGE, TRANSIENT_NOTICE_INSUFFICIENT_TAIL_MESSAGE,
    TRANSIENT_NOTICE_SECONDS_PER_CHARACTER, TRANSIENT_NOTICE_MINIMUM_SECONDS,
    TRANSIENT_NOTICE_MAXIMUM_SECONDS, transientNoticeContent, transientNoticeLifetime,
    transientNoticeAnimatesProgress, transientNoticeProgressWidth,
    PREVIEW_ANIMATION_FRAMES_PER_SECOND, PREVIEW_ANIMATION_FRAME_DURATION,
    PREVIEW_ZOOM_ENTRY_MAXIMUM, PREVIEW_PREWARM_CAPACITY, previewAnimationSampleTime,
    previewAnimationIntervals, previewPrewarmTimes,
    POPOVER_ENTRY_KEYS, POPOVER_ENTRY_VIEW_SIZE, POPOVER_EXIT_KEY,
    POPOVER_PASSES_SPACEBAR_TO_WORKSPACE, eventTargetsPresentedContent, popoverKeyboardEntryHandles,
    AUDIO_EXPORT_PROGRESS_POLL_MILLISECONDS, AUDIO_EXPORT_PROGRESS_CEILING, AUDIO_EXPORT_PRESET,
    AUDIO_EXPORT_FILE_TYPE, AUDIO_EXPORT_TIME_PITCH_ALGORITHM, AudioExportError,
    audioExportFailureKind, audioExportHasTracks, audioExportReportedProgress,
    audioExportTimeRange, audioExportVolume,
  } = m

  // -------------------------------------------- EditorTransientNotice.swift
  check('tn.width', TRANSIENT_NOTICE_METRICS.width, 352)
  check('tn.padding', TRANSIENT_NOTICE_METRICS.padding, 14)
  check('tn.corner', TRANSIENT_NOTICE_METRICS.cornerRadius, 16)
  check('tn.progressHeight', TRANSIENT_NOTICE_METRICS.progressHeight, 2)
  check('tn.progressLeading', TRANSIENT_NOTICE_METRICS.progressLeading, 41)
  check('tn.perCharacter', TRANSIENT_NOTICE_SECONDS_PER_CHARACTER, 0.08)
  const sameTrack = transientNoticeContent(TRANSIENT_NOTICE_SAME_TRACK_MESSAGE)
  check('tn.sameTrackTitle', sameTrack.title, '这里已有片段')
  check('tn.sameTrackDetail', sameTrack.detail, '移到空白处，或贴近边缘再粘贴')
  const tailShort = transientNoticeContent(TRANSIENT_NOTICE_INSUFFICIENT_TAIL_MESSAGE)
  check('tn.tailTitle', tailShort.title, '剩余空间不够')
  check('tn.tailDetail', tailShort.detail, '移到更靠前的位置，保留完整片段')
  const opened = transientNoticeContent(TRANSIENT_NOTICE_PROJECT_OPENED_PREFIX + '摄像头素材已重新定位。')
  check('tn.openedTitle', opened.title, '项目已打开，需要留意')
  check('tn.openedDetail', opened.detail, '摄像头素材已重新定位。')
  const fallback = transientNoticeContent('保存失败')
  check('tn.fallbackTitle', fallback.title, '操作未完成')
  check('tn.fallbackDetail', fallback.detail, '保存失败')
  check('tn.lifetimeFloor', transientNoticeLifetime('短提示'), 5)
  check('tn.lifetimeMid', transientNoticeLifetime('x'.repeat(100)), 8)
  check('tn.lifetimeCeiling', transientNoticeLifetime('x'.repeat(400)), 10)
  check('tn.lifetimeExact', transientNoticeLifetime('x'.repeat(75)), 6)
  check('tn.animatesWhenAllowed', transientNoticeAnimatesProgress(false), true)
  check('tn.noAnimationOnReduceMotion', transientNoticeAnimatesProgress(true), false)
  check('tn.progressFull', transientNoticeProgressWidth(352, 1), 283)
  check('tn.progressHalf', transientNoticeProgressWidth(352, 0.5), 141.5)
  check('tn.progressClamped', transientNoticeProgressWidth(352, 2), 283)

  // --------------------------------------- PreviewAnimationPreparation.swift
  check('pa.fps', PREVIEW_ANIMATION_FRAMES_PER_SECOND, 60)
  check('pa.frameDuration', PREVIEW_ANIMATION_FRAME_DURATION, 1 / 60)
  check('pa.zoomEntryCap', PREVIEW_ZOOM_ENTRY_MAXIMUM, 0.6)
  check('pa.prewarmCapacity', PREVIEW_PREWARM_CAPACITY, 4)
  check('pa.sampleExact', previewAnimationSampleTime(1), 1)
  check('pa.sampleRounds', previewAnimationSampleTime(0.02), 1 / 60, 1e-12)
  check('pa.sampleNegative', previewAnimationSampleTime(-5), 0)
  check('pa.sampleNaN', previewAnimationSampleTime(NaN), 0)
  const previewEval = {
    outputDuration: 20,
    opening: { isEnabled: true, duration: 2 },
    zoomAnimations: [{ startTime: 1, effectEndTime: 3 }],
    screenMotionClips: [{ startTime: 5, effectEndTime: 7, leadInDuration: 0.3 }],
    cameraMotionClips: [],
    mosaicClips: [{ startTime: 9, endTime: 10, transitionInDuration: 0.4 }],
    stickerClips: [{ startTime: 11, endTime: 12, enterDuration: 0.5 }],
  }
  const previewIntervals = previewAnimationIntervals(previewEval)
  check('pa.intervalCount', previewIntervals.length, 5)
  check('pa.openingFirst', previewIntervals[0].isOpening, true)
  check('pa.openingEntry', previewIntervals[0].entryDuration, 2)
  check('pa.zoomEntryCapped', previewIntervals[1].entryDuration, 0.6)
  check('pa.screenEntry', previewIntervals[2].entryDuration, 0.3)
  check('pa.mosaicEntry', previewIntervals[3].entryDuration, 0.4)
  check('pa.stickerEntry', previewIntervals[4].entryDuration, 0.5)
  check('pa.noOpeningWhenDisabled', previewAnimationIntervals({ ...previewEval, opening: { isEnabled: false, duration: 2 } }).length, 4)
  const prewarmEarly = previewPrewarmTimes(0, previewEval)
  check('pa.prewarmCount', prewarmEarly.length, 4)
  check('pa.prewarmFirst', prewarmEarly[0], 1)
  check('pa.prewarmSecond', prewarmEarly[1], 1.3)
  check('pa.prewarmOpeningEightyTwo', prewarmEarly[2], 1.64)
  check('pa.prewarmLast', prewarmEarly[3], 5.15)
  const prewarmMid = previewPrewarmTimes(4, previewEval)
  check('pa.prewarmMidCount', prewarmMid.length, 3)
  check('pa.prewarmMidFirst', prewarmMid[0], 5.15)
  check('pa.prewarmMidMosaic', prewarmMid[1], 9.2)
  check('pa.prewarmMidSticker', prewarmMid[2], 11.25)
  // 超过容量时只保留最早的 4 个
  const crowded = previewPrewarmTimes(0, {
    ...previewEval,
    outputDuration: 40,
    stickerClips: [
      { startTime: 0.5, endTime: 1, enterDuration: 0.1 },
      { startTime: 2.5, endTime: 3, enterDuration: 0.1 },
      { startTime: 3.5, endTime: 4, enterDuration: 0.1 },
      { startTime: 4.5, endTime: 5, enterDuration: 0.1 },
      { startTime: 5.5, endTime: 6, enterDuration: 0.1 },
    ],
  })
  check('pa.prewarmCapacity', crowded.length, 4)

  // -------------------------------------------------- EditorPopover.swift
  check('po.entryKeys', POPOVER_ENTRY_KEYS.join(','), 'return,downArrow')
  check('po.entryViewSize', POPOVER_ENTRY_VIEW_SIZE, 1)
  check('po.exitKey', POPOVER_EXIT_KEY, 'escape')
  check('po.spacebarGoesToWorkspace', POPOVER_PASSES_SPACEBAR_TO_WORKSPACE, true)
  check('po.returnHandled', popoverKeyboardEntryHandles({ key: 'return', modifiers: [] }, true), true)
  check('po.downArrowHandled', popoverKeyboardEntryHandles({ key: 'downArrow', modifiers: [] }, true), true)
  check('po.commandIgnored', popoverKeyboardEntryHandles({ key: 'downArrow', modifiers: ['command'] }, true), false)
  check('po.shiftIgnored', popoverKeyboardEntryHandles({ key: 'return', modifiers: ['shift'] }, true), false)
  check('po.disabledIgnored', popoverKeyboardEntryHandles({ key: 'return', modifiers: [] }, false), false)
  check('po.spaceIgnored', popoverKeyboardEntryHandles({ key: 'space', modifiers: [] }, true), false)
  check(
    'po.targetsPresented',
    eventTargetsPresentedContent({
      hasEventWindow: true,
      hasResponderView: true,
      responderHasWindow: true,
      responderWindowIsEventWindow: false,
    }),
    true
  )
  check(
    'po.sameWindowNotPresented',
    eventTargetsPresentedContent({
      hasEventWindow: true,
      hasResponderView: true,
      responderHasWindow: true,
      responderWindowIsEventWindow: true,
    }),
    false
  )
  check(
    'po.noResponder',
    eventTargetsPresentedContent({
      hasEventWindow: true,
      hasResponderView: false,
      responderHasWindow: false,
      responderWindowIsEventWindow: false,
    }),
    false
  )

  // ------------------------------------------- AudioOnlyExportPipeline.swift
  check('ae.pollInterval', AUDIO_EXPORT_PROGRESS_POLL_MILLISECONDS, 120)
  check('ae.ceiling', AUDIO_EXPORT_PROGRESS_CEILING, 0.99)
  check('ae.preset', AUDIO_EXPORT_PRESET, 'AVAssetExportPresetAppleM4A')
  check('ae.fileType', AUDIO_EXPORT_FILE_TYPE, 'm4a')
  check('ae.timePitch', AUDIO_EXPORT_TIME_PITCH_ALGORITHM, 'spectral')
  check('ae.noTracks', audioExportHasTracks({ hasSystemAudioTrack: false, hasMicrophoneAudioTrack: false }), false)
  check('ae.systemOnly', audioExportHasTracks({ hasSystemAudioTrack: true, hasMicrophoneAudioTrack: false }), true)
  check('ae.micOnly', audioExportHasTracks({ hasSystemAudioTrack: false, hasMicrophoneAudioTrack: true }), true)
  check('ae.volumePassThrough', audioExportVolume(0.5, false), 0.5)
  check('ae.volumeClampHigh', audioExportVolume(1.4, false), 1)
  check('ae.volumeClampLow', audioExportVolume(-1, false), 0)
  check('ae.volumeMuted', audioExportVolume(0.5, true), 0)
  check('ae.volumeNaN', audioExportVolume(NaN, false), 0)
  check('ae.defaultRange', audioExportTimeRange(null, 12.5).duration, 12.5)
  check('ae.defaultRangeStart', audioExportTimeRange(null, 12.5).start, 0)
  check('ae.explicitRange', audioExportTimeRange({ start: 2, duration: 3 }, 12.5).start, 2)
  check('ae.progressClampHigh', audioExportReportedProgress(1.5), 0.99)
  check('ae.progressClampLow', audioExportReportedProgress(-1), 0)
  check('ae.progressNaN', audioExportReportedProgress(NaN), 0)
  check('ae.progressPassThrough', audioExportReportedProgress(0.42), 0.42)
  check('ae.cancelledKind', audioExportFailureKind(true), 'cancelled')
  check('ae.failedKind', audioExportFailureKind(false), 'exportFailed')
  check('ae.errorKind', new AudioExportError('noAudioToExport').kind, 'noAudioToExport')
  check('ae.errorMessage', new AudioExportError('noAudioToExport').message, '项目里没有可导出的音频轨。')
  check(
    'ae.errorMessageDetail',
    new AudioExportError('exportFailed', '磁盘已满').message,
    '音频导出失败。（磁盘已满）'
  )

}

await runPreviewAndAudioBatch()

async function runInspectorAndChromeBatch() {
  // ========== 12 文件 / 990 行：转义关窗 / 缩放相位条 / 权限引导 / 更新器 /
  //            壁纸手风琴 / 拖动刷帧 / 标题栏交互 / 色彩配置 / 裁切命令 /
  //            检查器派生 / 页签栏 / 窗口淡化
  const {
    escapeDismissalAction,
    ZOOM_PHASE_BAR_HEIGHT, ZOOM_PHASE_SEAM_HEIGHT, ZOOM_PHASE_LABEL_MINIMUM_WIDTH,
    ZOOM_PHASE_EDGE_OPACITY, ZOOM_PHASE_SEAM_OPACITY, ZOOM_PHASE_LABELS,
    zoomPhaseSegments, zoomPhaseGradientStops, zoomPhaseSeamVisible,
    zoomPhaseLabelVisible, zoomPhaseLabelFrame,
    PermissionTourFlow, permissionFirstRequiredStep, permissionAccessAllGranted,
    permissionAccessGrants,
    APP_FORMAL_BUNDLE_IDENTIFIER, APP_UPDATE_PLACEHOLDER, APP_UPDATE_TEXT,
    appIsFormalRelease, appUpdateVersionDescription, appUpdateAvailabilityDescription,
    appUpdateStartDecision, appUpdateCheckAllowed, APP_UPDATE_CHECK_SEQUENCE,
    AppUpdateController,
    WALLPAPER_ACCORDION_SPACING, WALLPAPER_ACCORDION_HEIGHT, WALLPAPER_HOVER_WEIGHT,
    WALLPAPER_SELECTED_WEIGHT, WALLPAPER_IDLE_WEIGHT, WALLPAPER_LABEL_MINIMUM_WIDTH,
    wallpaperAccordionWeight, wallpaperAccordionLayout, wallpaperSliceState,
    SCRUB_SEEK_TIMESCALE, playbackClampedTime, ScrubSeekCoalescer, EditorScrubbingSession,
    titlebarDoubleClickAction, chromeClickKind, titlebarDoubleClickEffect,
    EDITOR_CHROME_ACCEPTS_FIRST_RESPONDER, EDITOR_CHROME_ACCEPTS_FIRST_MOUSE,
    FRAME_COLOR_PROFILE_ERRORS, FrameColorProfileError, resolveFrameColorProfile,
    frameColorProfileContextOptions, frameColorProfileMetalContextOptions,
    FRAME_COLOR_VIDEO_PROPERTIES, avVideoColorProperties, frameColorProfileAttachments,
    EDITOR_WINDOW_IDENTIFIER, CROP_FULL, cropCommandPlan, cropDraftValue,
    cropDraftUpdateAllowed, selectionAfterExternalAction, performEditorCommand,
    editorCropPresentation,
    BACKGROUND_BLUR_RANGE, backgroundBlurSectionVisible, zoomTransitionAvailability,
    zoomPhaseSecondsText, zoomTransitionConstrainedLine, ZOOM_TRANSITION_TEXTS,
    SEGMENT_AUDIO_TEXTS, segmentAudioScopeText, segmentAudioHeader, segmentAudioRangeText,
    segmentAudioRestoreVisible, segmentAudioOutsideWarningVisible, segmentAudioSourceDetail,
    selectedAudioContextVerticalPadding, selectedAudioContextRowSpacing,
    INSPECTOR_TAB_BAR_HEIGHT, INSPECTOR_TAB_MINIMUM_TARGET, INSPECTOR_TABS,
    INSPECTOR_TAB_BAR_DISABLED_OPACITY, INSPECTOR_TAB_UNAVAILABLE_OPACITY,
    inspectorTabAvailable, inspectorTabHelp, inspectorTabAccessibilityIdentifier,
    inspectorTabPresentations, inspectorTabSelectionChanges,
    APPEARANCE_CROSSFADE_DURATION, WINDOW_CROSSFADE_DURATION, SNAPSHOT_FADE_DELAY,
    CROSSFADE_TIMING, appearanceTransitionPlan, crossfadePlan,
    SNAPSHOT_ACCEPTS_HIT_TESTING, WINDOW_SERVER_CAPTURE_ARGUMENTS,
  } = m

  // ---------------------------------------------- EscapeDismissibleWindow.swift
  check('esc.withSheet', escapeDismissalAction(true), 'deferToSuper')
  check('esc.withoutSheet', escapeDismissalAction(false), 'close')

  // ------------------------------------------------ EditorZoomPhaseBar.swift
  check('zpb.height', ZOOM_PHASE_BAR_HEIGHT, 28)
  check('zpb.seamHeight', ZOOM_PHASE_SEAM_HEIGHT, 14)
  check('zpb.labels', ZOOM_PHASE_LABELS.map(l => l.title).join('/'), '进入/保持/退出')
  check('zpb.edgeOpacity', ZOOM_PHASE_EDGE_OPACITY, 0.28)
  {
    const seg = zoomPhaseSegments(300, { duration: 6, enterDuration: 1.5, exitDuration: 1.5 })
    check('zpb.total', seg.total, 7.5)
    check('zpb.enter', seg.enter, 60)
    check('zpb.hold', seg.hold, 180)
    check('zpb.exit', seg.exit, 60)
    const stops = zoomPhaseGradientStops(300, seg)
    check('zpb.stopCount', stops.length, 4)
    check('zpb.stopLocations', stops.map(s => s.location).join(','), '0,0.2,0.8,1')
    check('zpb.stopEdge', stops[3].opacity, 0.28)
    check('zpb.stopTop', stops[1].opacity, 1)
  }
  {
    // 全零片段：0.001 兜底，整条退化为纯退出段，不产生 NaN
    const seg = zoomPhaseSegments(200, { duration: 0, enterDuration: 0, exitDuration: 0 })
    check('zpb.zeroTotal', seg.total, 0.001)
    check('zpb.zeroEnter', seg.enter, 0)
    check('zpb.zeroHold', seg.hold, 0)
    check('zpb.zeroExit', seg.exit, 200)
    check('zpb.zeroFinite', Number.isFinite(seg.enter + seg.hold + seg.exit), true)
  }
  {
    // 进入段被时长挤压：hold 必须归零而不是负数
    const seg = zoomPhaseSegments(120, { duration: 1, enterDuration: 2, exitDuration: 0 })
    check('zpb.squeezedEnter', seg.enter, 120)
    check('zpb.squeezedHold', seg.hold, 0)
    check('zpb.squeezedExit', seg.exit, 0)
  }
  check('zpb.seamVisible', zoomPhaseSeamVisible(60, 180), true)
  check('zpb.seamHiddenLeft', zoomPhaseSeamVisible(0, 180), false)
  check('zpb.seamHiddenRight', zoomPhaseSeamVisible(60, 0), false)
  check('zpb.seamOpacity', ZOOM_PHASE_SEAM_OPACITY, 0.22)
  check('zpb.labelAtThreshold', zoomPhaseLabelVisible(ZOOM_PHASE_LABEL_MINIMUM_WIDTH), false)
  check('zpb.labelOverThreshold', zoomPhaseLabelVisible(58.5), true)
  check('zpb.labelFrame', zoomPhaseLabelFrame(60), 59)
  check('zpb.labelFrameFloor', zoomPhaseLabelFrame(0), 0)

  // ---------------------------------------------------- PermissionTourFlow.swift
  check('pt.allGrantedBoth', permissionAccessAllGranted({ screen: true, accessibility: true }), true)
  check('pt.allGrantedOne', permissionAccessAllGranted({ screen: true, accessibility: false }), false)
  check('pt.firstScreen', permissionFirstRequiredStep({ screen: false, accessibility: false }), 'screen')
  check('pt.firstAccessibility', permissionFirstRequiredStep({ screen: true, accessibility: false }), 'accessibility')
  check('pt.firstReady', permissionFirstRequiredStep({ screen: true, accessibility: true }), 'ready')
  check('pt.grantsScreen', permissionAccessGrants({ screen: true, accessibility: false }, 'screen'), true)
  check('pt.grantsReadyNeedsBoth', permissionAccessGrants({ screen: true, accessibility: false }, 'ready'), false)
  {
    const flow = new PermissionTourFlow({ screen: false, accessibility: false }, false)
    check('pt.initialStep', flow.currentStep, 'screen')
    check('pt.primaryOpenSettings', flow.primaryAction().kind, 'openSettings')
    check('pt.primaryTarget', flow.primaryAction().step, 'screen')
  }
  {
    // 复盘模式从第一步开始，即使权限已全齐
    const flow = new PermissionTourFlow({ screen: true, accessibility: true }, true)
    check('pt.reviewStartsAtScreen', flow.currentStep, 'screen')
    check('pt.reviewPrimaryAdvance', flow.primaryAction().kind, 'advance')
    flow.advance()
    check('pt.reviewAdvance', flow.currentStep, 'accessibility')
    flow.previous()
    check('pt.reviewPrevious', flow.currentStep, 'screen')
  }
  {
    const flow = new PermissionTourFlow({ screen: true, accessibility: true }, false)
    check('pt.readyStep', flow.currentStep, 'ready')
    check('pt.readyEnter', flow.primaryAction().kind, 'enter')
  }
  {
    // 系统设置期间保留来源步骤：轮询看到成功也不跳步
    const flow = new PermissionTourFlow({ screen: false, accessibility: false }, false)
    flow.openedSettings('screen')
    check('pt.settingsStep', flow.settingsStep, 'screen')
    flow.update({ screen: true, accessibility: false })
    check('pt.heldStep', flow.currentStep, 'screen')
    flow.returnedFromSettings({ screen: true, accessibility: false })
    check('pt.returnedAdvance', flow.currentStep, 'accessibility')
    check('pt.settingsCleared', flow.settingsStep, null)
  }
  {
    // 返回时仍未授权：停在原步
    const flow = new PermissionTourFlow({ screen: false, accessibility: false }, false)
    flow.openedSettings('screen')
    flow.returnedFromSettings({ screen: false, accessibility: false })
    check('pt.returnedHeld', flow.currentStep, 'screen')
  }
  {
    // 未授予时 advance 是空操作（guard primaryAction === 'advance'）
    const flow = new PermissionTourFlow({ screen: false, accessibility: false }, false)
    flow.advance()
    check('pt.advanceBlocked', flow.currentStep, 'screen')
    check('pt.advanceBlockedAction', flow.primaryAction().kind, 'openSettings')
  }
  {
    // 复盘模式连按两次 advance 到 ready；权限齐时停在 ready
    const flow = new PermissionTourFlow({ screen: true, accessibility: true }, true)
    flow.advance()
    flow.advance()
    check('pt.advanceToReady', flow.currentStep, 'ready')
    check('pt.advanceReadyEnter', flow.primaryAction().kind, 'enter')
  }
  {
    const flow = new PermissionTourFlow({ screen: false, accessibility: false }, false)
    flow.openedSettings('ready')
    check('pt.readyRejectsSettings', flow.settingsStep, null)
  }
  {
    // 权限被撤销时 ready 必须退回
    const flow = new PermissionTourFlow({ screen: true, accessibility: true }, false)
    flow.update({ screen: false, accessibility: true })
    check('pt.revokedFallsBack', flow.currentStep, 'screen')
  }
  {
    const flow = new PermissionTourFlow({ screen: true, accessibility: false }, false)
    const before = flow.currentStep
    flow.previous()
    check('pt.previousWithoutReview', flow.currentStep, before)
  }

  // --------------------------------------------------- AppUpdateController.swift
  check('up.formalId', APP_FORMAL_BUNDLE_IDENTIFIER, 'cn.laogou.dogsc')
  check('up.isFormal', appIsFormalRelease('cn.laogou.dogsc'), true)
  check('up.isDev', appIsFormalRelease('cn.laogou.dogsc.dev'), false)
  check('up.isNull', appIsFormalRelease(null), false)
  check('up.placeholder', APP_UPDATE_PLACEHOLDER, '—')
  check('up.version', appUpdateVersionDescription('1.2', '34'), '1.2（34）')
  check('up.versionMissingBoth', appUpdateVersionDescription(null, null), '—（—）')
  check('up.versionMissingBuild', appUpdateVersionDescription('1.2', null), '1.2（—）')
  check('up.availabilityAuto', appUpdateAvailabilityDescription({ isFormalRelease: true, automaticallyChecksForUpdates: true }), APP_UPDATE_TEXT.automaticOn)
  check('up.availabilityManual', appUpdateAvailabilityDescription({ isFormalRelease: true, automaticallyChecksForUpdates: false }), APP_UPDATE_TEXT.automaticOff)
  check('up.availabilityDev', appUpdateAvailabilityDescription({ isFormalRelease: false, automaticallyChecksForUpdates: true }), APP_UPDATE_TEXT.development)
  check('up.decisionStarted', appUpdateStartDecision({ didStart: true, isFormalRelease: true }), 'alreadyStarted')
  check('up.decisionDev', appUpdateStartDecision({ didStart: false, isFormalRelease: false }), 'development')
  check('up.decisionStart', appUpdateStartDecision({ didStart: false, isFormalRelease: true }), 'start')
  check('up.checkAllowedDev', appUpdateCheckAllowed(false), false)
  check('up.checkSequence', APP_UPDATE_CHECK_SEQUENCE.join('>'), 'startIfEligible>activateApplication>checkForUpdates')
  {
    const calls = []
    const port = {
      readAutomaticallyChecksForUpdates: () => true,
      startUpdater: () => calls.push('start'),
      checkForUpdates: () => calls.push('check'),
      activateApplication: () => calls.push('activate'),
      writeAutomaticallyChecksForUpdates: (v) => calls.push(`write:${v}`),
    }
    const controller = new AppUpdateController(port, false)
    controller.startIfEligible()
    controller.startIfEligible()
    controller.checkForUpdates()
    check('up.devNeverStarts', calls.length, 0)
    check('up.devDidStartRecorded', controller.snapshot.didStart, true)
    check('up.devNotReady', controller.snapshot.isReady, false)
  }
  {
    const calls = []
    const port = {
      readAutomaticallyChecksForUpdates: () => true,
      startUpdater: () => calls.push('start'),
      checkForUpdates: () => calls.push('check'),
      activateApplication: () => calls.push('activate'),
      writeAutomaticallyChecksForUpdates: (v) => calls.push(`write:${v}`),
    }
    const controller = new AppUpdateController(port, true)
    controller.startIfEligible()
    check('up.formalStarts', calls.join(','), 'start')
    check('up.formalReady', controller.snapshot.isReady, true)
    check('up.formalAutoState', controller.snapshot.automaticallyChecksForUpdates, true)
    controller.checkForUpdates()
    check('up.formalActivateThenCheck', calls.join(','), 'start,activate,check')
    controller.setAutomaticallyChecksForUpdates(false)
    check('up.formalWrite', calls[calls.length - 1], 'write:false')
    check('up.formalAutoFalse', controller.snapshot.automaticallyChecksForUpdates, false)
    check('up.formalAvailability', controller.availabilityDescription, APP_UPDATE_TEXT.automaticOff)
  }

  // ---------------------------------------------- EditorWallpaperAccordion.swift
  check('wa.spacing', WALLPAPER_ACCORDION_SPACING, 4)
  check('wa.height', WALLPAPER_ACCORDION_HEIGHT, 124)
  check('wa.weights', [WALLPAPER_HOVER_WEIGHT, WALLPAPER_SELECTED_WEIGHT, WALLPAPER_IDLE_WEIGHT].join('/'), '5/3.4/1')
  check('wa.weightHovered', wallpaperAccordionWeight({ id: 'a', hoveredID: 'a', selectedGroupID: null }), 5)
  check('wa.weightSelected', wallpaperAccordionWeight({ id: 'a', hoveredID: null, selectedGroupID: 'a' }), 3.4)
  // 指针在别的切片上时，选中片退回 1 —— 否则两条同时张开
  check('wa.weightSelectedWhileOtherHovered', wallpaperAccordionWeight({ id: 'a', hoveredID: 'b', selectedGroupID: 'a' }), 1)
  {
    const layout = wallpaperAccordionLayout({ width: 400, ids: ['a', 'b', 'c'], hoveredID: null, selectedGroupID: null })
    check('wa.layoutAvailable', layout.available, 392)
    check('wa.layoutTotalWeight', layout.totalWeight, 3)
    check('wa.layoutEven', Math.round(layout.widths[0] * 1000) / 1000, 130.667)
  }
  {
    const layout = wallpaperAccordionLayout({ width: 400, ids: ['a', 'b', 'c'], hoveredID: 'a', selectedGroupID: 'b' })
    check('wa.layoutHoverTotal', layout.totalWeight, 7)
    check('wa.layoutHoverWidth', layout.widths[0], 280)
    check('wa.layoutIdleWidth', Math.round(layout.widths[1] * 100) / 100, 56)
  }
  {
    const layout = wallpaperAccordionLayout({ width: 10, ids: [], hoveredID: null, selectedGroupID: null })
    check('wa.layoutEmptyAvailable', layout.available, 10)
    check('wa.layoutEmptyTotal', layout.totalWeight, 1)
    check('wa.layoutEmptyWidths', layout.widths.length, 0)
  }
  {
    const open = wallpaperSliceState({ id: 'a', width: 100, hoveredID: null, selectedGroupID: 'a' })
    check('wa.openSelected', open.isOpen, true)
    check('wa.openShowsLabel', open.showsLabel, true)
    check('wa.openOffset', open.labelOffsetY, 0)
    check('wa.openOpacity', open.opacity, 1)
    check('wa.openBorder', open.borderWidth, 2)
    check('wa.openAccent', open.borderIsAccent, true)
  }
  {
    const narrow = wallpaperSliceState({ id: 'a', width: 60, hoveredID: 'a', selectedGroupID: 'a' })
    check('wa.narrowNoLabel', narrow.showsLabel, false)
    check('wa.narrowStillOpen', narrow.isOpen, true)
  }
  {
    const idle = wallpaperSliceState({ id: 'a', width: 100, hoveredID: null, selectedGroupID: 'b' })
    check('wa.idleClosed', idle.isOpen, false)
    check('wa.idleOffset', idle.labelOffsetY, 5)
    check('wa.idleOpacity', idle.opacity, 0.82)
    check('wa.idleBorder', idle.borderWidth, 0.75)
    check('wa.idleNotAccent', idle.borderIsAccent, false)
    check('wa.labelMinWidth', WALLPAPER_LABEL_MINIMUM_WIDTH, 72)
  }

  // --------------------------------------------- EditorPlaybackScrubbing.swift
  check('sc.timescale', SCRUB_SEEK_TIMESCALE, 60000)
  check('sc.clampNaN', playbackClampedTime(NaN, 10), 0)
  check('sc.clampBelow', playbackClampedTime(-5, 10), 0)
  check('sc.clampAbove', playbackClampedTime(12, 10), 10)
  check('sc.clampNegativeDuration', playbackClampedTime(3, -1), 0)
  {
    const coalescer = new ScrubSeekCoalescer()
    coalescer.update(1)
    coalescer.update(2)
    check('sc.coalesceLatest', coalescer.pendingTarget, 2)
    check('sc.takeOnce', coalescer.takePending(), 2)
    check('sc.takeClears', coalescer.pendingTarget, null)
    coalescer.update(3)
    coalescer.cancel()
    check('sc.cancelClears', coalescer.takePending(), null)
  }
  {
    // 单飞：第二次 update 在前一次 seek 未完成时不再发起新 seek
    const seeks = []
    let resolvers = []
    const primary = {
      pauseTransport: () => {},
      cancelPendingSeeks: () => {},
      seekTransport: (seconds) => {
        seeks.push(seconds)
        return new Promise((resolve) => resolvers.push(resolve))
      },
    }
    const state = { finished: [], anchors: [] }
    const session = new EditorScrubbingSession({
      primaryPlayer: primary,
      cameraPlayer: null,
      outputTime: () => 0,
      endHoverPreview: () => {},
      clearPausedFrames: () => {},
      cancelPausedFrameDecode: () => {},
      resetPlaybackAnchor: (t) => state.anchors.push(t),
      synchronizeCamera: () => {},
      advanceDiscontinuity: () => {},
      seekFinally: (t) => state.finished.push(t),
    })
    session.begin()
    check('sc.beginActive', session.state.isScrubbing, true)
    session.update(2, 10)
    session.update(4, 10)
    check('sc.singleFlightSeeks', seeks.length, 1)
    check('sc.singleFlightFirstTarget', seeks[0], 2)
    check('sc.latestClock', session.state.latestOutputTime, 4)
    check('sc.anchorCalls', state.anchors.join(','), '2,4')
    resolvers.shift()(true)
    await Promise.resolve()
    await Promise.resolve()
    check('sc.chasedLatest', seeks.length, 2)
    check('sc.chasedTarget', seeks[1], 4)
    check('sc.previewAfterFirst', session.state.previewTime, 2)
    resolvers.shift()(true)
    await Promise.resolve()
    await Promise.resolve()
    check('sc.previewChased', session.state.previewTime, 4)
    session.end()
    check('sc.endInactive', session.state.isScrubbing, false)
    check('sc.endFinalSeek', state.finished.join(','), '4')
  }
  {
    // 松手时优先用未消化的待办目标
    const finals = []
    const primary = { pauseTransport: () => {}, cancelPendingSeeks: () => {}, seekTransport: () => new Promise(() => {}) }
    const session = new EditorScrubbingSession({
      primaryPlayer: primary,
      cameraPlayer: null,
      outputTime: () => 1.5,
      endHoverPreview: () => {},
      clearPausedFrames: () => {},
      cancelPausedFrameDecode: () => {},
      resetPlaybackAnchor: () => {},
      synchronizeCamera: () => {},
      advanceDiscontinuity: () => {},
      seekFinally: (t) => finals.push(t),
    })
    session.begin()
    session.update(6, 10)
    session.update(7, 10)
    session.end()
    check('sc.endUsesPending', finals[0], 7)
  }
  {
    // 会话代次变了：迟到的 seek 结果不得回写预览帧
    let resolveSeek
    const primary = {
      pauseTransport: () => {},
      cancelPendingSeeks: () => {},
      seekTransport: () => new Promise((resolve) => { resolveSeek = resolve }),
    }
    const session = new EditorScrubbingSession({
      primaryPlayer: primary,
      cameraPlayer: null,
      outputTime: () => 0,
      endHoverPreview: () => {},
      clearPausedFrames: () => {},
      cancelPausedFrameDecode: () => {},
      resetPlaybackAnchor: () => {},
      synchronizeCamera: () => {},
      advanceDiscontinuity: () => {},
      seekFinally: () => {},
    })
    session.begin()
    session.update(3, 10)
    session.end()
    resolveSeek(true)
    await Promise.resolve()
    await Promise.resolve()
    check('sc.staleSeekDiscarded', session.state.previewTime, null)
    check('sc.staleEndedAt', session.state.latestOutputTime, 3)
  }
  {
    // 没有主播放器时 update 不启动会话
    const session = new EditorScrubbingSession({
      primaryPlayer: null,
      cameraPlayer: null,
      outputTime: () => 0,
      endHoverPreview: () => {},
      clearPausedFrames: () => {},
      cancelPausedFrameDecode: () => {},
      resetPlaybackAnchor: () => {},
      synchronizeCamera: () => {},
      advanceDiscontinuity: () => {},
      seekFinally: () => {},
    })
    session.update(5, 10)
    check('sc.noPlayerStaysIdle', session.state.isScrubbing, false)
  }

  // ------------------------------------------ EditorWindowChromeInteraction.swift
  check('wc.acceptsFirstResponder', EDITOR_CHROME_ACCEPTS_FIRST_RESPONDER, false)
  check('wc.acceptsFirstMouse', EDITOR_CHROME_ACCEPTS_FIRST_MOUSE, true)
  check('wc.minimizeToken', titlebarDoubleClickAction({ actionString: 'Minimize' }), 'minimize')
  check('wc.miniaturizeToken', titlebarDoubleClickAction({ actionString: ' miniaturize ' }), 'minimize')
  check('wc.doNothingToken', titlebarDoubleClickAction({ actionString: 'Do Nothing' }), 'none')
  check('wc.zoomToken', titlebarDoubleClickAction({ actionString: 'maximize' }), 'zoom')
  check('wc.fillToken', titlebarDoubleClickAction({ actionString: 'fill' }), 'zoom')
  check('wc.unknownFallsBackToLegacy', titlebarDoubleClickAction({ actionString: 'whatever', miniaturizeOnDoubleClick: true }), 'minimize')
  check('wc.legacyFalseZooms', titlebarDoubleClickAction({ actionString: null, miniaturizeOnDoubleClick: false }), 'zoom')
  check('wc.defaultZoom', titlebarDoubleClickAction({}), 'zoom')
  check('wc.clickDouble', chromeClickKind(2), 'doubleClick')
  check('wc.clickSingle', chromeClickKind(1), 'drag')
  check('wc.clickTriple', chromeClickKind(3), 'drag')
  check('wc.effectZoom', titlebarDoubleClickEffect('zoom'), 'zoom')
  check('wc.effectNone', titlebarDoubleClickEffect('none'), null)

  // ----------------------------------------- CoreImageFrameColorProfile.swift
  check('cc.unsupportedText', FRAME_COLOR_PROFILE_ERRORS.unsupported, '当前版本只支持桌面 SDR 成片。')
  check('cc.unavailableText', FRAME_COLOR_PROFILE_ERRORS.unavailableColorSpace, '系统无法建立 sRGB 色彩空间。')
  {
    const profile = resolveFrameColorProfile('sdrDesktop')
    check('cc.working', profile.workingColorSpace, 'linear-srgb')
    check('cc.output', profile.outputColorSpace, 'srgb')
    const options = frameColorProfileContextOptions(profile, false)
    check('cc.cacheFlag', options.cacheIntermediates, false)
    check('cc.optionsWorking', options.workingColorSpace, 'linear-srgb')
    const metal = frameColorProfileMetalContextOptions(profile, true)
    check('cc.metalQueue', metal.commandQueueRequired, true)
    check('cc.metalCache', metal.cacheIntermediates, true)
    check('cc.videoPrimaries', avVideoColorProperties(profile).colorPrimaries, 'ITU_R_709_2')
    check('cc.videoTransfer', avVideoColorProperties(profile).transferFunction, 'sRGB')
    check('cc.videoMatrix', avVideoColorProperties(profile).yCbCrMatrix, 'ITU_R_709_2')
    check('cc.attachmentCount', frameColorProfileAttachments(profile).length, 3)
    check('cc.attachmentPropagate', frameColorProfileAttachments(profile).every((a) => a.propagate), true)
    check('cc.propertiesConst', FRAME_COLOR_VIDEO_PROPERTIES.transferFunction, 'sRGB')
  }
  {
    let caught = null
    try {
      resolveFrameColorProfile('hdr10')
    } catch (error) {
      caught = error
    }
    check('cc.thrown', caught instanceof FrameColorProfileError, true)
    check('cc.thrownKind', caught.kind, 'unsupported')
    check('cc.thrownContract', caught.contract, 'hdr10')
    check('cc.thrownMessage', caught.message, FRAME_COLOR_PROFILE_ERRORS.unsupported)
  }

  // ------------------------------------------- EditorViewCropAndPreset.swift
  check('cv.windowId', EDITOR_WINDOW_IDENTIFIER, 'cn.laogou.dogsc.editor-window')
  check('cv.fullCrop', JSON.stringify(CROP_FULL), '{"x":0,"y":0,"width":1,"height":1}')
  {
    const standard = editorCropPresentation(null)
    check('cv.standardToolbar', standard.toolbarMode, 'standardControls')
    const begin = cropCommandPlan(standard, 'beginCrop')
    check('cv.beginRuns', begin.kind, 'run')
    check('cv.beginStopsPlayback', begin.stopsPlayback, true)
    check('cv.beginCrossfades', begin.crossfadesWindow, true)
    check('cv.beginKeepsSelection', begin.resetsSelectionToScreen, false)
    check('cv.confirmBlockedInStandard', cropCommandPlan(standard, 'confirmCrop').kind, 'ignored')
    check('cv.resetBlockedInStandard', cropCommandPlan(standard, 'resetCrop').kind, 'ignored')
  }
  {
    const cropping = editorCropPresentation({ tool: 'crop', selection: 'crop', crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } })
    check('cv.cropToolbar', cropping.toolbarMode, 'cropControls')
    check('cv.beginBlockedInCrop', cropCommandPlan(cropping, 'beginCrop').kind, 'ignored')
    const confirm = cropCommandPlan(cropping, 'confirmCrop')
    check('cv.confirmRuns', confirm.kind, 'run')
    check('cv.confirmResetsSelection', confirm.resetsSelectionToScreen, true)
    check('cv.confirmKeepsPlayback', confirm.stopsPlayback, false)
    const reset = cropCommandPlan(cropping, 'resetCrop')
    check('cv.resetNoCrossfade', reset.crossfadesWindow, false)
  }
  {
    const cropping = editorCropPresentation({ tool: 'crop', selection: 'crop', crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } })
    const draft = cropDraftValue(cropping, { x: 0, y: 0, width: 1, height: 1 })
    check('cv.draftPreferred', draft.width, 0.5)
    const fromProject = cropDraftValue(editorCropPresentation(null), { x: -1, y: 0, width: 3, height: 1 })
    check('cv.projectClamped', fromProject.x, 0)
    check('cv.projectClampedWidth', fromProject.width, 1)
    check('cv.draftAllowedWhileCropping', cropDraftUpdateAllowed(cropping), true)
    check('cv.draftBlockedIdle', cropDraftUpdateAllowed(editorCropPresentation(null)), false)
  }
  check('cv.selectionCropToScreen', selectionAfterExternalAction({ wasCropping: true, selection: 'crop' }), 'screen')
  check('cv.selectionKept', selectionAfterExternalAction({ wasCropping: true, selection: 'segment' }), 'segment')
  check('cv.selectionUntouched', selectionAfterExternalAction({ wasCropping: false, selection: 'crop' }), 'crop')
  {
    const errors = []
    check('cv.commandOk', performEditorCommand(() => {}, (msg) => errors.push(msg)), true)
    check('cv.commandNoError', errors.length, 0)
    check('cv.commandFails', performEditorCommand(() => { throw new Error('裁切失败') }, (msg) => errors.push(msg)), false)
    check('cv.commandReported', errors[0], '裁切失败')
    check('cv.commandNonError', performEditorCommand(() => { throw 'x' }, (msg) => errors.push(msg)), false)
    check('cv.commandStringReported', errors[1], 'x')
  }

  // --------------------------------------- EditorInspectorScopeControls.swift
  check('is.blurRange', `${BACKGROUND_BLUR_RANGE.lower}-${BACKGROUND_BLUR_RANGE.upper}`, '0-80')
  check('is.blurHiddenPattern', backgroundBlurSectionVisible({ kind: 'pattern', patternPreset: '黑曜石网格' }), false)
  check('is.blurShownImage', backgroundBlurSectionVisible({ kind: 'systemImage', absolutePath: '/w.png' }), true)
  check('is.blurShownVideo', backgroundBlurSectionVisible({ kind: 'projectVideo', relativePath: 'media/bg.mp4' }), true)
  {
    const fits = zoomTransitionAvailability(
      { enterDuration: 0.6, exitDuration: 0.45, endTime: 3 },
      { enterDuration: 0.6, exitDuration: 0.45, endTime: 3 }
    )
    check('is.zoomFits', fits.kind, 'fits')
    const enterDiff = zoomTransitionAvailability(
      { enterDuration: 0.602, exitDuration: 0.45, endTime: 3 },
      { enterDuration: 0.6, exitDuration: 0.45, endTime: 3 }
    )
    check('is.zoomEnterConstrained', enterDiff.kind, 'constrained')
    const endDiff = zoomTransitionAvailability(
      { enterDuration: 0.6, exitDuration: 0.45, endTime: 2.5 },
      { enterDuration: 0.6, exitDuration: 0.45, endTime: 3 }
    )
    check('is.zoomEndConstrained', endDiff.kind, 'constrained')
    check('is.zoomMissing', zoomTransitionAvailability(null, { enterDuration: 1, exitDuration: 1, endTime: 1 }).kind, 'fits')
    check('is.zoomLine', zoomTransitionConstrainedLine({ enterDuration: 1.25, exitDuration: 0.75, endTime: 2 }), '实际进入 1.25s · 退出 0.75s')
    check('is.zoomTitle', ZOOM_TRANSITION_TEXTS.constrainedTitle, '已按可用时间适配')
    check('is.zoomNote', ZOOM_TRANSITION_TEXTS.constrainedNote, '保留上方设定；片尾前完成退出，相邻动画紧接时连续衔接。')
    check('is.zoomFitsText', ZOOM_TRANSITION_TEXTS.fits, '设定时长均可完整播放。')
  }
  check('is.secondsText', zoomPhaseSecondsText(1.5), '1.50s')
  check('is.secondsTextNaN', zoomPhaseSecondsText(NaN), '0.00s')
  check('is.scopeInherits', segmentAudioScopeText(false), '继承全片声音设置')
  check('is.scopeOverrides', segmentAudioScopeText(true), '已覆盖此段的声音设置')
  check('is.headerNumbered', segmentAudioHeader({ index: 2, hasOverrides: false, compact: false }), '第 3 段')
  check('is.headerCompact', segmentAudioHeader({ index: 0, hasOverrides: true, compact: true }), SEGMENT_AUDIO_TEXTS.overrides)
  check('is.range', segmentAudioRangeText(0.5, 2.1), '00:00.50 – 00:02.10')
  check('is.restoreVisible', segmentAudioRestoreVisible(true), true)
  check('is.restoreHidden', segmentAudioRestoreVisible(false), false)
  check('is.outsideBefore', segmentAudioOutsideWarningVisible({ playbackTime: 0.5, outputStart: 1, outputEnd: 3 }), true)
  check('is.outsideAtEnd', segmentAudioOutsideWarningVisible({ playbackTime: 3, outputStart: 1, outputEnd: 3 }), true)
  check('is.inside', segmentAudioOutsideWarningVisible({ playbackTime: 2, outputStart: 1, outputEnd: 3 }), false)
  check('is.detailBoth', segmentAudioSourceDetail({ volume: 0.5, mute: false }), '仅此片段，自定义设置')
  check('is.detailVolumeOnly', segmentAudioSourceDetail({ volume: 0.5, mute: null }), '继承全片设置')
  check('is.detailNone', segmentAudioSourceDetail({ volume: null, mute: null }), SEGMENT_AUDIO_TEXTS.inheritDetail)
  check('is.paddingCompact', selectedAudioContextVerticalPadding(true), 0)
  check('is.paddingRegular', selectedAudioContextVerticalPadding(false), 4)
  check('is.spacingCompact', selectedAudioContextRowSpacing(true), 6)
  check('is.spacingRegular', selectedAudioContextRowSpacing(false), 9)

  // ------------------------------------------------ EditorInspectorTabBar.swift
  check('it.height', INSPECTOR_TAB_BAR_HEIGHT, 60)
  check('it.target', INSPECTOR_TAB_MINIMUM_TARGET, 44)
  check('it.count', INSPECTOR_TABS.length, 6)
  check('it.order', INSPECTOR_TABS.map((t) => t.key).join(','), 'frame,opening,zoom,cursor,camera,audio')
  check('it.labels', INSPECTOR_TABS.map((t) => t.label).join('/'), '画面/开场/运镜/光标/摄像头/声音')
  check('it.icons', INSPECTOR_TABS[4].icon, 'video')
  check('it.cameraUnavailable', inspectorTabAvailable('camera', { cameraAvailable: false, audioAvailable: true, cursorAvailable: true }), false)
  check('it.audioAvailable', inspectorTabAvailable('audio', { cameraAvailable: false, audioAvailable: true, cursorAvailable: false }), true)
  check('it.cursorAvailable', inspectorTabAvailable('cursor', { cameraAvailable: false, audioAvailable: false, cursorAvailable: true }), true)
  check('it.frameAlways', inspectorTabAvailable('frame', { cameraAvailable: false, audioAvailable: false, cursorAvailable: false }), true)
  check('it.zoomAlways', inspectorTabAvailable('zoom', { cameraAvailable: false, audioAvailable: false, cursorAvailable: false }), true)
  check('it.helpCamera', inspectorTabHelp('camera', false), '当前项目没有摄像头素材')
  check('it.helpAudio', inspectorTabHelp('audio', false), '当前项目没有系统声音或麦克风素材')
  check('it.helpCursor', inspectorTabHelp('cursor', false), '当前项目没有记录鼠标事件')
  check('it.helpAvailable', inspectorTabHelp('zoom', true), '运镜')
  check('it.a11yFrame', inspectorTabAccessibilityIdentifier('frame'), 'editor.workspace.tool.画面')
  check('it.a11yCamera', inspectorTabAccessibilityIdentifier('camera'), 'editor.workspace.tool.摄像头')
  {
    const rows = inspectorTabPresentations({
      selection: 'frame',
      hoveredTab: null,
      isCropping: false,
      cameraAvailable: false,
      audioAvailable: true,
      cursorAvailable: true,
    })
    check('it.selectedRow', rows[0].selected, true)
    check('it.selectedShowsLabel', rows[0].showsLabel, true)
    check('it.selectedLeading', rows[0].leadingPadding, 14)
    check('it.selectedTrailing', rows[0].trailingPadding, 16)
    check('it.unselectedHidesLabel', rows[1].showsLabel, false)
    check('it.unselectedPadding', rows[1].leadingPadding, 0)
    check('it.cameraDimmed', rows[4].opacity, INSPECTOR_TAB_UNAVAILABLE_OPACITY)
    check('it.frameFullOpacity', rows[0].opacity, 1)
  }
  {
    const rows = inspectorTabPresentations({
      selection: 'zoom',
      hoveredTab: 'zoom',
      isCropping: true,
      cameraAvailable: true,
      audioAvailable: true,
      cursorAvailable: true,
    })
    check('it.croppingOpacity', rows[0].opacity, INSPECTOR_TAB_BAR_DISABLED_OPACITY)
    check('it.croppingDimmedUnavailable', rows[4].opacity, INSPECTOR_TAB_BAR_DISABLED_OPACITY)
    // 选中页签不算 hover（选中态已由胶囊表达）
    check('it.selectedNotHovered', rows[2].hovered, false)
  }
  {
    const rows = inspectorTabPresentations({
      selection: 'frame',
      hoveredTab: 'zoom',
      isCropping: false,
      cameraAvailable: true,
      audioAvailable: true,
      cursorAvailable: true,
    })
    check('it.hoveredOther', rows[2].hovered, true)
    check('it.hoverKeepsLabelOff', rows[2].showsLabel, false)
  }
  check('it.selectChanges', inspectorTabSelectionChanges('frame', 'zoom'), true)
  check('it.selectSame', inspectorTabSelectionChanges('frame', 'frame'), false)

  // ---------------------------------------- WindowAppearanceTransition.swift
  check('wt.appearanceDuration', APPEARANCE_CROSSFADE_DURATION, 0.34)
  check('wt.crossfadeDuration', WINDOW_CROSSFADE_DURATION, 0.26)
  check('wt.snapshotDelay', SNAPSHOT_FADE_DELAY, 0.05)
  check('wt.timing', CROSSFADE_TIMING.join(','), '0.4,0,0.2,1')
  check('wt.noHitTesting', SNAPSHOT_ACCEPTS_HIT_TESTING, false)
  check('wt.serverCaptureOption', WINDOW_SERVER_CAPTURE_ARGUMENTS.windowListOption, 8)
  {
    const base = {
      previousAppearance: 'dark', nextAppearance: 'light',
      applicationActive: true, applicationHidden: false,
      windowVisible: true, windowMiniaturized: false, windowOccluded: false,
      reduceMotion: false,
    }
    check('wt.changedAnimates', appearanceTransitionPlan(base).animate, true)
    check('wt.changedDuration', appearanceTransitionPlan(base).duration, 0.34)
    check('wt.sameAppearance', appearanceTransitionPlan({ ...base, nextAppearance: 'dark' }).animate, false)
    check('wt.occludedSkips', appearanceTransitionPlan({ ...base, windowOccluded: true }).animate, false)
    check('wt.miniaturizedSkips', appearanceTransitionPlan({ ...base, windowMiniaturized: true }).animate, false)
    check('wt.inactiveSkips', appearanceTransitionPlan({ ...base, applicationActive: false }).animate, false)
    check('wt.reduceMotionSkips', appearanceTransitionPlan({ ...base, reduceMotion: true }).animate, false)
    check('wt.alwaysApplies', appearanceTransitionPlan({ ...base, reduceMotion: true }).applyAppearance, true)
  }
  {
    const base = {
      hasWindow: true, hasContentView: true, windowVisible: true, windowOccluded: false,
      reduceMotion: false, boundsWidth: 800, boundsHeight: 600,
      windowServerImageAvailable: true, bitmapRepresentationAvailable: true,
    }
    check('wt.serverSnapshot', crossfadePlan(base).mode, 'snapshotWindowServer')
    check('wt.redrawFallback', crossfadePlan({ ...base, windowServerImageAvailable: false }).mode, 'snapshotRedraw')
    check('wt.noImage', crossfadePlan({ ...base, windowServerImageAvailable: false, bitmapRepresentationAvailable: false }).mode, 'directChange')
    check('wt.noWindow', crossfadePlan({ ...base, hasWindow: false }).mode, 'directChange')
    check('wt.hiddenWindow', crossfadePlan({ ...base, windowVisible: false }).mode, 'directChange')
    check('wt.occludedWindow', crossfadePlan({ ...base, windowOccluded: true }).mode, 'directChange')
    check('wt.reduceMotionDirect', crossfadePlan({ ...base, reduceMotion: true }).mode, 'directChange')
    check('wt.tinyWindow', crossfadePlan({ ...base, boundsWidth: 1 }).mode, 'directChange')
    check('wt.planDelay', crossfadePlan(base).delay, 0.05)
    check('wt.planDuration', crossfadePlan(base).duration, 0.26)
    check('wt.customDuration', crossfadePlan(base, 0.34).duration, 0.34)
    check('wt.directNoDelay', crossfadePlan({ ...base, reduceMotion: true }).delay, 0)
  }

}

await runInspectorAndChromeBatch()

async function runRecordingShellBatch() {
  // ========== 10 文件 / 1,255 行：录制标记 / 保存徽章 / 工程工作区 / 设备解析 /
  //            摄像头节奏 / 画面预览 / 录制条交互 / 快捷键表 / 工程替换 / 片段外观
  const {
    MARKER_BOOKMARK_GLYPH_WIDTH, MARKER_BOOKMARK_HIT_WIDTH, MARKER_BOOKMARK_RULER_INSET,
    MARKER_BOOKMARK_RGB, MARKER_SCROLL_MARGIN, MARKER_SCROLL_CENTER_FRACTION,
    recordingMarkerTimestamp, makeEditorRecordingMarker, visibleRecordingMarkerIndices,
    recordingMarkerOffsetX, recordingMarkerRulerHidden, recordingMarkerScrollPlan,
    recordingMarkerHelpText, RECORDING_MARKER_MENU_TEXT,
    editorPersistenceBadgeState, EDITOR_PERSISTENCE_TITLES, EDITOR_PERSISTENCE_ACCESSIBILITY,
    EDITOR_PERSISTENCE_IDENTIFIERS, EDITOR_PERSISTENCE_BADGE_METRICS,
    EDITOR_PERSISTENCE_BADGE_COLORS, EDITOR_SAVE_DOT, editorSaveDotFrame,
    editorPersistenceMarker,
    ProjectWorkspace,
    captureInputDeviceRequest, captureInputDeviceRequestRole, captureInputDeviceRequestedUniqueID,
    CAPTURE_DEVICE_ERROR_MESSAGES, captureDeviceResolutionErrorMessage,
    CaptureInputDeviceResolutionError, resolveCaptureInputDevice, CAPTURE_INPUT_DEVICE_ROLES,
    CAMERA_CADENCE_WINDOW_CAPACITY, CAMERA_CADENCE_MINIMUM_SAMPLES, CAMERA_CADENCE_FPS_DELTA,
    RollingHostTimeWindow, CameraRuntimeFormatMonitor, fourCC,
    FRAME_PREVIEW_HEIGHT, FRAME_PREVIEW_CHROME_BAR_HEIGHT, FRAME_PREVIEW_DEVICE_BEZEL,
    FRAME_PREVIEW_MINIMUM_CONTENT_SIDE, FRAME_PREVIEW_TRAFFIC_LIGHTS,
    framePreviewIsDark, framePreviewScreenGeometry, framePreviewScreenPosition,
    framePreviewWallpaperBlur, framePreviewAddressBarColor, framePreviewChromeBarBackground,
    DRAG_GRIP_WIDTH, DRAG_GRIP_HEIGHT, DRAG_GRIP_DOT_DIAMETER, DRAG_GRIP_DOTS_PER_COLUMN,
    DRAG_GRIP_ACCESSIBILITY_IDENTIFIER, DRAG_GRIP_LABEL,
    panelPointerDecision, roundedRectContains, PANEL_POINTER_EVENTS, panelPointerMonitorAction,
    ISLAND_INTERACTION_VIEW_ACCEPTS_HIT_TEST, RECORDER_HOSTING_ACCEPTS_FIRST_MOUSE,
    EDITOR_SHORTCUT_GROUPS, SHORTCUT_KEY_COLUMN_MINIMUM, SHORTCUT_KEY_COLUMN_PADDING,
    SHORTCUT_PANEL_EXPLANATION_WIDTH, SHORTCUT_PANEL_HEIGHT, SHORTCUT_KEYCAP,
    shortcutKeyColumnWidth, shortcutPanelWidth, shortcutEntryCount, SHORTCUT_PANEL_TEXT,
    EDITOR_BUSY_MESSAGE, projectSaveFailureMessage, canCrossSaveBarrier, openProjectDecision,
    phaseObservationAction, saveBarrierOutcome, restoreEditorState,
    resolveTimelineClipEmphasis, timelineClipShowsHandles, timelineClipEmphasisMetrics,
    timelineClipSurface, primaryTimelineSurface, timelineClipChromeStyle,
    TIMELINE_CLIP_CHROME_ANIMATION, TIMELINE_CLIP_CHROME_HIT_TESTING,
  } = m

  // ------------------------------------- EditorTimelineRecordingMarkers.swift
  check('mk.glyph', `${MARKER_BOOKMARK_GLYPH_WIDTH}x${MARKER_BOOKMARK_HIT_WIDTH}`, '8x18')
  check('mk.rulerInset', MARKER_BOOKMARK_RULER_INSET, 21)
  check('mk.rgb', `${MARKER_BOOKMARK_RGB.red}/${MARKER_BOOKMARK_RGB.green}/${MARKER_BOOKMARK_RGB.blue}`, '0.65/0.47/0.22')
  check('mk.menuSeek', RECORDING_MARKER_MENU_TEXT.seek, '跳转到标记')
  check('mk.menuRemove', RECORDING_MARKER_MENU_TEXT.remove, '删除录制标记')
  check('mk.ts.zero', recordingMarkerTimestamp(0), '00:00.00')
  check('mk.ts.frac', recordingMarkerTimestamp(1.239), '00:01.23')
  check('mk.ts.minute', recordingMarkerTimestamp(65.5), '01:05.50')
  check('mk.ts.negative', recordingMarkerTimestamp(-3), '00:00.00')
  check('mk.ts.long', recordingMarkerTimestamp(6000), '100:00.00')
  {
    const marker = makeEditorRecordingMarker({ id: 'm1', number: 3 }, 12.34)
    check('mk.label', marker.label, '标记 3')
    check('mk.timestamp', marker.timestamp, '00:12.34')
    check('mk.idKept', marker.id, 'm1')
    check('mk.help', recordingMarkerHelpText(marker, (t) => `t${t}`), '标记 3 · t12.34')
  }
  check(
    'mk.visibleIndices',
    visibleRecordingMarkerIndices([{ outputTime: 1 }, { outputTime: 5 }, { outputTime: 9 }], { lower: 2, upper: 9 }).join(','),
    '1,2'
  )
  check('mk.offset', recordingMarkerOffsetX({ outputTime: 5, duration: 10, width: 200 }), 91)
  check('mk.offsetZeroDuration', recordingMarkerOffsetX({ outputTime: 5, duration: 0, width: 200 }), 999991)
  check('mk.hiddenRestore', recordingMarkerRulerHidden({ isRestoreCutMode: true, hasTrimDraft: false, hasReorderDraft: false }), true)
  check('mk.hiddenTrim', recordingMarkerRulerHidden({ isRestoreCutMode: false, hasTrimDraft: true, hasReorderDraft: false }), true)
  check('mk.hiddenReorder', recordingMarkerRulerHidden({ isRestoreCutMode: false, hasTrimDraft: false, hasReorderDraft: true }), true)
  check('mk.visibleNormal', recordingMarkerRulerHidden({ isRestoreCutMode: false, hasTrimDraft: false, hasReorderDraft: false }), false)
  {
    const visible = recordingMarkerScrollPlan({
      outputTime: 5, timelineDuration: 10, timelineContentWidth: 1000,
      viewportMinX: 400, viewportMaxX: 900, viewportWidth: 500, documentWidth: 1000,
    })
    check('mk.noScrollWhenVisible', visible.scrolls, false)
    const left = recordingMarkerScrollPlan({
      outputTime: 1, timelineDuration: 10, timelineContentWidth: 1000,
      viewportMinX: 400, viewportMaxX: 900, viewportWidth: 500, documentWidth: 1000,
    })
    check('mk.scrollLeft', left.scrolls, true)
    check('mk.scrollLeftClamped', left.targetX, 0)
    const right = recordingMarkerScrollPlan({
      outputTime: 9, timelineDuration: 10, timelineContentWidth: 1000,
      viewportMinX: 400, viewportMaxX: 900, viewportWidth: 500, documentWidth: 1000,
    })
    check('mk.scrollRight', right.targetX, 500)
    check('mk.margin', MARKER_SCROLL_MARGIN, 24)
    check('mk.centerFraction', MARKER_SCROLL_CENTER_FRACTION, 0.4)
  }

  // ---------------------------------------- EditorPersistenceIndicator.swift
  check('pi.stateFailed', editorPersistenceBadgeState({ status: 'failed', hasDraft: false }), 'failed')
  check('pi.stateSaving', editorPersistenceBadgeState({ status: 'saving', hasDraft: false }), 'saving')
  check('pi.stateEditing', editorPersistenceBadgeState({ status: 'clean', hasDraft: true }), 'editing')
  check('pi.stateSaved', editorPersistenceBadgeState({ status: 'clean', hasDraft: false }), 'saved')
  check('pi.titles', Object.values(EDITOR_PERSISTENCE_TITLES).join('/'), '已保存/正在保存/编辑中/保存失败')
  check('pi.a11y', EDITOR_PERSISTENCE_ACCESSIBILITY.failed, '查看自动保存失败原因')
  check('pi.ids', EDITOR_PERSISTENCE_IDENTIFIERS.editing, 'editor.persistence.editing')
  check('pi.metrics', `${EDITOR_PERSISTENCE_BADGE_METRICS.height}/${EDITOR_PERSISTENCE_BADGE_METRICS.markerSize}/${EDITOR_PERSISTENCE_BADGE_METRICS.spacing}`, '26/12/7')
  check('pi.colors', EDITOR_PERSISTENCE_BADGE_COLORS.failedFillOpacity, 0.1)
  check('pi.markers', ['saved', 'saving', 'editing', 'failed'].map(editorPersistenceMarker).join(','), 'check,progressDot,pencil,warning')
  {
    const rest = editorSaveDotFrame(0, false)
    check('pi.dotRestScale', rest.scale, EDITOR_SAVE_DOT.minScale)
    check('pi.dotRestOpacity', rest.opacity, EDITOR_SAVE_DOT.minOpacity)
    const peak = editorSaveDotFrame(EDITOR_SAVE_DOT.period, false)
    check('pi.dotPeakScale', peak.scale, 1)
    const back = editorSaveDotFrame(EDITOR_SAVE_DOT.period * 2, false)
    check('pi.dotBackScale', Math.round(back.scale * 1000) / 1000, 0.6)
    const still = editorSaveDotFrame(0.3, true)
    check('pi.dotReduceMotion', `${still.scale}/${still.opacity}`, '1/1')
  }

  // ---------------------------------------------------- ProjectWorkspace.swift
  {
    const scheduled = []
    const events = []
    const persistence = {
      session: null,
      isSaved: true,
      status: 'clean',
      scheduleAutosave: (project) => scheduled.push(project),
      activate: (session, saved) => events.push(`activate:${session.id}:${saved}`),
      flush: async () => ({ savedAt: 7 }),
      move: async () => null,
      moveAndInvalidate: async () => null,
      flushAndInvalidate: async () => null,
      invalidateCurrentSession: async () => null,
    }
    const document = { project: { name: 'p' } }
    const workspace = new ProjectWorkspace(document, persistence)
    check('pw.initialSaved', workspace.isSaved, true)
    check('pw.initialStatus', workspace.status, 'clean')
    const snapshot = { name: 'q' }
    workspace.notifyProjectChanged(snapshot)
    workspace.notifyProjectChanged(snapshot)
    check('pw.autosaveOncePerProject', scheduled.length, 1)
    workspace.notifyProjectChanged({ name: 'r' })
    check('pw.autosaveOnNewSnapshot', scheduled.length, 2)
    workspace.activate({ id: 's1' }, false)
    check('pw.activateForwarded', events.join(','), 'activate:s1:false')
    const receipt = await workspace.flush({ name: 'q' })
    check('pw.flushReceipt', receipt.savedAt, 7)
    const invalidated = await workspace.invalidateCurrentSession()
    check('pw.invalidateNull', invalidated, null)
  }

  // ------------------------------------------------ CaptureDeviceResolution.swift
  check('cdr.roles', CAPTURE_INPUT_DEVICE_ROLES.join(','), 'camera,microphone,iosDevice')
  {
    const automatic = captureInputDeviceRequest('camera', null)
    check('cdr.automaticKind', automatic.kind, 'automatic')
    check('cdr.automaticRole', captureInputDeviceRequestRole(automatic), 'camera')
    check('cdr.automaticId', captureInputDeviceRequestedUniqueID(automatic), null)
    const exact = captureInputDeviceRequest('microphone', '')
    check('cdr.emptyStringIsExact', exact.kind, 'exact')
    check('cdr.exactId', captureInputDeviceRequestedUniqueID(exact), '')
  }
  check('cdr.msgCameraAuto', captureDeviceResolutionErrorMessage('camera', null), CAPTURE_DEVICE_ERROR_MESSAGES.cameraAutomatic)
  check('cdr.msgCameraExact', captureDeviceResolutionErrorMessage('camera', 'abc'), CAPTURE_DEVICE_ERROR_MESSAGES.cameraExact)
  check('cdr.msgMicAuto', captureDeviceResolutionErrorMessage('microphone', null), '没有找到可用的麦克风。')
  check('cdr.msgMicExact', captureDeviceResolutionErrorMessage('microphone', 'abc'), '所选麦克风已断开或不可用，请重新选择。')
  check('cdr.msgIosAuto', captureDeviceResolutionErrorMessage('iosDevice', null), '请先选择要录制的 iPhone 或 iPad。')
  check('cdr.msgIosExact', captureDeviceResolutionErrorMessage('iosDevice', 'abc'), '所选 iPhone 或 iPad 已断开或不可用，请重新选择。')
  {
    const error = new CaptureInputDeviceResolutionError('camera', 'abc')
    check('cdr.errorKind', error.info.kind, 'cameraUnavailable')
    check('cdr.errorMessage', error.message, CAPTURE_DEVICE_ERROR_MESSAGES.cameraExact)
    check('cdr.errorRequested', error.info.requestedUniqueID, 'abc')
  }
  {
    const candidates = [
      { role: 'camera', uniqueID: 'cam-1', localizedName: '内建摄像头' },
      { role: 'microphone', uniqueID: 'mic-1', localizedName: '内建麦克风' },
      { role: 'iosDevice', uniqueID: 'ios-1', localizedName: 'iPhone' },
    ]
    const exact = resolveCaptureInputDevice({
      request: captureInputDeviceRequest('camera', 'cam-1'), candidates, defaultUniqueID: null,
    })
    check('cdr.exactFound', exact.ok, true)
    check('cdr.exactName', exact.device.localizedName, '内建摄像头')
    // 同名 ID 但角色不同 → 必须失败（角色是身份的一部分）
    const wrongRole = resolveCaptureInputDevice({
      request: captureInputDeviceRequest('camera', 'mic-1'), candidates, defaultUniqueID: null,
    })
    check('cdr.roleMismatch', wrongRole.ok, false)
    check('cdr.roleMismatchKind', wrongRole.error.kind, 'cameraUnavailable')
    const automatic = resolveCaptureInputDevice({
      request: captureInputDeviceRequest('camera', null), candidates, defaultUniqueID: 'cam-1',
    })
    check('cdr.automaticDefault', automatic.ok, true)
    const noDefault = resolveCaptureInputDevice({
      request: captureInputDeviceRequest('camera', null), candidates, defaultUniqueID: null,
    })
    check('cdr.automaticNoDefault', noDefault.ok, false)
    const defaultIsOtherRole = resolveCaptureInputDevice({
      request: captureInputDeviceRequest('microphone', null), candidates, defaultUniqueID: 'cam-1',
    })
    check('cdr.defaultRoleMismatch', defaultIsOtherRole.ok, false)
    // iOS 端点永不接受自动选择
    const iosAutomatic = resolveCaptureInputDevice({
      request: captureInputDeviceRequest('iosDevice', null), candidates, defaultUniqueID: 'ios-1',
    })
    check('cdr.iosNeverAutomatic', iosAutomatic.ok, false)
    check('cdr.iosMessage', iosAutomatic.error.message, CAPTURE_DEVICE_ERROR_MESSAGES.iosAutomatic)
    const iosExact = resolveCaptureInputDevice({
      request: captureInputDeviceRequest('iosDevice', 'ios-1'), candidates, defaultUniqueID: null,
    })
    check('cdr.iosExactWorks', iosExact.ok, true)
  }

  // ------------------------------------------------- CameraRuntimeFormatMonitor.swift
  check('cf.capacity', CAMERA_CADENCE_WINDOW_CAPACITY, 31)
  check('cf.minimumSamples', CAMERA_CADENCE_MINIMUM_SAMPLES, 8)
  check('cf.fpsDelta', CAMERA_CADENCE_FPS_DELTA, 0.5)
  {
    const window = new RollingHostTimeWindow(3)
    window.append(1); window.append(2); window.append(3)
    check('cf.windowCount', window.count, 3)
    check('cf.windowFirst', window.first, 1)
    check('cf.windowLast', window.last, 3)
    window.append(4)
    check('cf.windowWrappedFirst', window.first, 2)
    check('cf.windowWrappedLast', window.last, 4)
    window.reset()
    check('cf.windowReset', window.count, 0)
    check('cf.windowResetFirst', window.first, null)
    const guarded = new RollingHostTimeWindow(0)
    check('cf.windowCapacityFloor', guarded.capacity, 1)
  }
  {
    const layout = { isStructurallyValid: true, width: 1920, height: 1080, pixelFormat: 0x42475241, planeCount: 1, bytesPerRow: 7680 }
    const monitor = new CameraRuntimeFormatMonitor()
    check('cf.invalidLayout', monitor.observe({ layout: { ...layout, isStructurallyValid: false }, hostTime: 0, deliveredDuration: 1 / 30 }), null)
    check('cf.nonFiniteTime', monitor.observe({ layout, hostTime: NaN, deliveredDuration: 1 / 30 }), null)
    const first = monitor.observe({ layout, hostTime: 0, deliveredDuration: 1 / 30 })
    check('cf.firstReportFps', first.framesPerSecond, 30)
    check('cf.firstReportWidth', first.width, 1920)
    const suppressed = monitor.observe({ layout, hostTime: 0.2, deliveredDuration: 1 / 30.2 })
    check('cf.suppressedWithinSecond', suppressed, null)
    const cadenceChanged = monitor.observe({ layout, hostTime: 1.5, deliveredDuration: 1 / 29.4 })
    check('cf.reportedAfterInterval', cadenceChanged !== null, true)
    const dimsChanged = monitor.observe({
      layout: { ...layout, width: 1280, height: 720 }, hostTime: 1.6, deliveredDuration: 1 / 29.4,
    })
    check('cf.dimensionsReportImmediately', dimsChanged.width, 1280)
    check('cf.logLine', monitor.logLine({ width: 1280, height: 720, framesPerSecond: 29.4 }, layout).includes('pixelFormat=BGRA'), true)
    monitor.reset()
    const afterReset = monitor.observe({ layout, hostTime: 9, deliveredDuration: 1 / 60 })
    check('cf.reportsAgainAfterReset', afterReset.framesPerSecond, 60)
  }
  {
    // 窗口估算：样本自身时长无效时用 8 个主机时间点算
    const layout = { isStructurallyValid: true, width: 640, height: 480, pixelFormat: 0x42475241, planeCount: 1, bytesPerRow: 2560 }
    const monitor = new CameraRuntimeFormatMonitor()
    let last = null
    for (let i = 0; i < 8; i += 1) {
      last = monitor.observe({ layout, hostTime: i / 30, deliveredDuration: 0 })
    }
    check('cf.windowFps', last.framesPerSecond, 30)
    check('cf.windowWidth', last.width, 640)
  }
  check('cf.fourCCPrintable', fourCC(0x42475241), 'BGRA')
  check('cf.fourCCFallback', fourCC(1), '0x00000001')

  // ------------------------------------------------------- EditorFramePreview.swift
  check('fp.height', FRAME_PREVIEW_HEIGHT, 146)
  check('fp.barHeight', FRAME_PREVIEW_CHROME_BAR_HEIGHT, 11)
  check('fp.bezel', FRAME_PREVIEW_DEVICE_BEZEL, 4.5)
  check('fp.minimumContent', FRAME_PREVIEW_MINIMUM_CONTENT_SIDE, 20)
  check('fp.trafficLights', FRAME_PREVIEW_TRAFFIC_LIGHTS.length, 3)
  check('fp.darkWindow', framePreviewIsDark('windowDark'), true)
  check('fp.darkBrowser', framePreviewIsDark('browserDark'), true)
  check('fp.lightBrowser', framePreviewIsDark('browserLight'), false)
  check('fp.deviceNotDark', framePreviewIsDark('devicePhone'), false)
  {
    const geometry = framePreviewScreenGeometry({
      stageWidth: 400, stageHeight: 146,
      canvas: { padding: 40, cornerRadius: 24, borderWidth: 20, shadowStrength: 0.28, screenFrame: 'none', screenFrameScale: 1 },
      baseWidth: 320, baseHeight: 180,
    })
    check('fp.margin', Math.round(geometry.margin * 1000) / 1000, 18.218)
    check('fp.noneBar', geometry.bar, 0)
    check('fp.noneBezel', geometry.bezel, 0)
    check('fp.noneScale', geometry.scale, 1)
    check('fp.contentWidth', geometry.contentWidth, 320)
    check('fp.contentHeight', Math.round(geometry.contentHeight * 100) / 100, 109.56)
    check('fp.contentRadius', Math.round(geometry.contentRadius * 100) / 100, 4.35)
    check('fp.outerRadiusNone', Math.round(geometry.outerRadius * 100) / 100, 4.35)
    check('fp.borderWidth', geometry.borderWidth, 6)
    check('fp.shadow', Math.round(geometry.shadowOpacity * 1000) / 1000, 0.292)
    check('fp.insetRadiusNone', Math.round(geometry.contentInsetRadius * 100) / 100, 4.35)
  }
  {
    const geometry = framePreviewScreenGeometry({
      stageWidth: 400, stageHeight: 146,
      canvas: { padding: 40, cornerRadius: 24, borderWidth: 20, shadowStrength: 0.28, screenFrame: 'browserLight', screenFrameScale: 2 },
      baseWidth: 320, baseHeight: 100,
    })
    check('fp.browserBar', geometry.bar, 11)
    check('fp.scaleClamped', geometry.scale, 1.6)
    check('fp.browserOuterRadius', geometry.outerRadius, 6)
    check('fp.browserInsetRadius', geometry.contentInsetRadius, 0)
    check('fp.availableHeight', Math.round(geometry.availableHeight * 100) / 100, 98.56)
  }
  {
    const geometry = framePreviewScreenGeometry({
      stageWidth: 300, stageHeight: 200,
      canvas: { padding: 0, cornerRadius: 0, borderWidth: 0, shadowStrength: 0, screenFrame: 'devicePhone', screenFrameScale: 0.1, screenFrameContentCornerRadius: 40 },
      baseWidth: 100, baseHeight: 200,
    })
    check('fp.deviceBezel', geometry.bezel, 4.5)
    check('fp.deviceScaleFloor', geometry.scale, 0.6)
    check('fp.deviceOuterRadius', geometry.outerRadius, 13.5)
    check('fp.deviceInsetRadius', geometry.contentInsetRadius, 3)
    check('fp.marginBase', Math.round(geometry.margin * 1000) / 1000, 14)
    check('fp.zeroShadow', geometry.shadowOpacity, 0.18)
  }
  {
    const position = framePreviewScreenPosition({
      stageWidth: 400, stageHeight: 146, totalWidth: 320, totalHeight: 110,
      contentPosition: { x: 0.5, y: 0.5 },
    })
    check('fp.positionX', position.x, 200)
    check('fp.positionY', position.y, 73)
    const corner = framePreviewScreenPosition({
      stageWidth: 400, stageHeight: 146, totalWidth: 320, totalHeight: 110,
      contentPosition: { x: 1, y: 1 },
    })
    check('fp.positionCornerX', corner.x, 240)
    check('fp.positionCornerY', corner.y, 91)
    const overflow = framePreviewScreenPosition({
      stageWidth: 100, stageHeight: 100, totalWidth: 320, totalHeight: 110,
      contentPosition: { x: 1, y: 1 },
    })
    check('fp.positionNoFreeSpace', `${overflow.x}/${overflow.y}`, '160/55')
  }
  check('fp.blur', framePreviewWallpaperBlur(40), 10)
  check('fp.blurClamped', framePreviewWallpaperBlur(400), 10)
  check('fp.blurZero', framePreviewWallpaperBlur(-5), 0)
  check('fp.addressDark', framePreviewAddressBarColor(true).opacity, 0.12)
  check('fp.addressLight', framePreviewAddressBarColor(false).opacity, 0.07)
  check('fp.chromeDark', framePreviewChromeBarBackground(true), 0.17)
  check('fp.chromeLight', framePreviewChromeBarBackground(false), 0.96)

  // --------------------------------------------------- RecorderPanelInteraction.swift
  check('rp.grip', `${DRAG_GRIP_WIDTH}x${DRAG_GRIP_HEIGHT}`, '22x40')
  check('rp.gripDot', DRAG_GRIP_DOT_DIAMETER, 2)
  check('rp.gripDots', DRAG_GRIP_DOTS_PER_COLUMN * 2, 6)
  check('rp.gripId', DRAG_GRIP_ACCESSIBILITY_IDENTIFIER, 'recorder.window-drag-grip')
  check('rp.gripLabel', DRAG_GRIP_LABEL, '拖动录制条')
  check('rp.events', PANEL_POINTER_EVENTS.join(','), 'mouseMoved,leftMouseUp,rightMouseUp,otherMouseUp')
  check('rp.islandNoHitTest', ISLAND_INTERACTION_VIEW_ACCEPTS_HIT_TEST, false)
  check('rp.hostingFirstMouse', RECORDER_HOSTING_ACCEPTS_FIRST_MOUSE, true)
  check(
    'rp.monitorInstall',
    panelPointerMonitorAction({ enabled: true, hasLocalMonitor: false, hasGlobalMonitor: false }),
    'install'
  )
  check(
    'rp.monitorRefresh',
    panelPointerMonitorAction({ enabled: true, hasLocalMonitor: true, hasGlobalMonitor: true }),
    'refresh'
  )
  check(
    'rp.monitorRemove',
    panelPointerMonitorAction({ enabled: false, hasLocalMonitor: true, hasGlobalMonitor: true }),
    'remove'
  )
  {
    const island = { x: 0, y: 0, width: 100, height: 100 }
    const base = {
      enabled: true, hasIslandView: true, islandBelongsToWindow: true,
      pressedMouseButtons: 0, pointer: { x: 50, y: 50 }, island,
    }
    check('rp.inside', panelPointerDecision(base), 'accept')
    check('rp.outside', panelPointerDecision({ ...base, pointer: { x: 150, y: 50 } }), 'ignore')
    // 圆角矩形的角上：矩形内但圆外
    check('rp.cornerRejected', panelPointerDecision({ ...base, pointer: { x: 1, y: 1 } }), 'ignore')
    check('rp.pressedKeeps', panelPointerDecision({ ...base, pressedMouseButtons: 1, pointer: { x: 500, y: 500 } }), 'keep')
    check('rp.disabled', panelPointerDecision({ ...base, enabled: false }), 'ignore')
    check('rp.noIsland', panelPointerDecision({ ...base, hasIslandView: false }), 'ignore')
    check('rp.otherWindow', panelPointerDecision({ ...base, islandBelongsToWindow: false }), 'ignore')
    check('rp.noPointer', panelPointerDecision({ ...base, pointer: null }), 'ignore')
    check('rp.rectContains', roundedRectContains(island, 50, { x: 50, y: 0 }), true)
    check('rp.rectEdge', roundedRectContains(island, 50, { x: 50, y: 101 }), false)
    check('rp.zeroRadius', roundedRectContains(island, 0, { x: 99, y: 99 }), true)
  }

  // ------------------------------------------------- EditorShortcutCheatsheet.swift
  check('sk.groups', EDITOR_SHORTCUT_GROUPS.map((g) => g.title).join('/'), '播放与浏览/剪辑/运镜与轨道/通用')
  check('sk.entryCount', shortcutEntryCount(), 26)
  check('sk.minimumColumn', SHORTCUT_KEY_COLUMN_MINIMUM, 96)
  check('sk.columnPadding', SHORTCUT_KEY_COLUMN_PADDING, 16)
  check('sk.panelHeight', SHORTCUT_PANEL_HEIGHT, 480)
  check('sk.panelWidth', shortcutPanelWidth(116), 460)
  check('sk.panelExplanation', SHORTCUT_PANEL_EXPLANATION_WIDTH, 344)
  check('sk.keycapRadius', SHORTCUT_KEYCAP.cornerRadius, 6)
  check('sk.keycapStroke', SHORTCUT_KEYCAP.strokeOpacity, 0.12)
  check('sk.title', SHORTCUT_PANEL_TEXT.title, '快捷键速查')
  check('sk.closeA11y', SHORTCUT_PANEL_TEXT.closeAccessibility, '关闭快捷键速查')
  check('sk.widthFromMeasure', shortcutKeyColumnWidth(() => 100), 116)
  check('sk.widthFloor', shortcutKeyColumnWidth(() => 10), 96)
  check('sk.widthCeil', shortcutKeyColumnWidth(() => 87), 103)
  check(
    'sk.widthFromTable',
    shortcutKeyColumnWidth((text) => text.length * 7),
    107
  )
  check(
    'sk.entriesHaveKeys',
    EDITOR_SHORTCUT_GROUPS.every((group) => group.entries.every((entry) => entry.keys.length > 0 && entry.action.length > 0)),
    true
  )

  // ----------------------------------------------------- RecordingProjectEditor.swift
  check('rpe.busy', EDITOR_BUSY_MESSAGE, '请先完成当前项目的打开、保存或导出操作。')
  check('rpe.saveFailure', projectSaveFailureMessage('磁盘已满'), '保存项目失败：磁盘已满')
  {
    const idle = { phase: 'editor', isExporting: false, isMediaExchangeRunning: false, hasSession: true }
    check('rpe.barrierOk', canCrossSaveBarrier({ isCrossingSaveBarrier: false, model: idle }), true)
    check('rpe.barrierNoModel', canCrossSaveBarrier({ isCrossingSaveBarrier: false, model: null }), false)
    check('rpe.barrierCrossing', canCrossSaveBarrier({ isCrossingSaveBarrier: true, model: idle }), false)
    check('rpe.barrierExporting', canCrossSaveBarrier({ isCrossingSaveBarrier: false, model: { ...idle, isExporting: true } }), false)
    check('rpe.barrierExchanging', canCrossSaveBarrier({ isCrossingSaveBarrier: false, model: { ...idle, isMediaExchangeRunning: true } }), false)
    check('rpe.barrierNoSession', canCrossSaveBarrier({ isCrossingSaveBarrier: false, model: { ...idle, hasSession: false } }), false)
    check('rpe.barrierFinishing', canCrossSaveBarrier({ isCrossingSaveBarrier: false, model: { ...idle, phase: 'finishing' } }), false)
  }
  {
    check('rpe.openCrossing', openProjectDecision({ isCrossingSaveBarrier: true, hasModel: true, model: null }).kind, 'ignore')
    check('rpe.openFresh', openProjectDecision({ isCrossingSaveBarrier: false, hasModel: false, model: null }).kind, 'createModel')
    const idle = { phase: 'editor', isExporting: false, isMediaExchangeRunning: false, hasSession: true }
    check('rpe.openReuse', openProjectDecision({ isCrossingSaveBarrier: false, hasModel: true, model: idle }).kind, 'reuseModel')
    const busy = openProjectDecision({
      isCrossingSaveBarrier: false, hasModel: true,
      model: { ...idle, isExporting: true },
    })
    check('rpe.openReject', busy.kind, 'reject')
    check('rpe.openRejectMessage', busy.message, EDITOR_BUSY_MESSAGE)
  }
  check(
    'rpe.observeNotCurrent',
    phaseObservationAction({ isCurrentModel: false, phase: 'setup' }).kind,
    'notifyOnly'
  )
  check(
    'rpe.observeSetupError',
    phaseObservationAction({ isCurrentModel: true, phase: 'setup', errorMessage: '坏文件' }).kind,
    'releaseWithError'
  )
  check(
    'rpe.observeSetupSilent',
    phaseObservationAction({ isCurrentModel: true, phase: 'setup' }).kind,
    'release'
  )
  check(
    'rpe.observeEditor',
    phaseObservationAction({ isCurrentModel: true, phase: 'editor' }).kind,
    'notifyOnly'
  )
  check('rpe.outcomeReplacement', saveBarrierOutcome({ purpose: 'replacement', flushReturnedReceipt: true }).action, 'closeProject')
  check('rpe.outcomeTermination', saveBarrierOutcome({ purpose: 'termination', flushReturnedReceipt: true }).action, 'stayOpen')
  {
    const failed = saveBarrierOutcome({ purpose: 'termination', flushReturnedReceipt: false })
    check('rpe.outcomeFailure', failed.ok, false)
    check('rpe.outcomeFailureMessage', failed.message, '保存项目失败：未能写入项目文件。')
    const withReason = saveBarrierOutcome({ purpose: 'termination', flushReturnedReceipt: false, failureReason: '只读卷' })
    check('rpe.outcomeFailureReason', withReason.message, '保存项目失败：只读卷')
  }
  {
    const restored = restoreEditorState('保存项目失败：x')
    check('rpe.restorePhase', restored.phase, 'editor')
    check('rpe.restoreStage', restored.transitionStage, 'idle')
    check('rpe.restoreMessage', restored.errorMessage, '保存项目失败：x')
  }

  // ------------------------------------------------ EditorTimelineClipChrome.swift
  check('tcl.resolveEditing', resolveTimelineClipEmphasis({ isEditing: true, isSelected: true, isHovered: true }), 'editing')
  check('tcl.resolveSelected', resolveTimelineClipEmphasis({ isEditing: false, isSelected: true, isHovered: true }), 'selected')
  check('tcl.resolveHovered', resolveTimelineClipEmphasis({ isEditing: false, isSelected: false, isHovered: true }), 'hovered')
  check('tcl.resolveIdle', resolveTimelineClipEmphasis({ isEditing: false, isSelected: false, isHovered: false }), 'idle')
  {
    const idle = timelineClipEmphasisMetrics('idle')
    check('tcl.idleStroke', `${idle.strokeOpacity}/${idle.strokeWidth}`, '0.08/0.65')
    check('tcl.idleHandles', idle.handleOpacity, 0)
    const editing = timelineClipEmphasisMetrics('editing')
    check('tcl.editingStroke', `${editing.strokeOpacity}/${editing.strokeWidth}`, '1/1.5')
    check('tcl.editingHandles', editing.handleOpacity, 1)
    const hovered = timelineClipEmphasisMetrics('hovered')
    check('tcl.hoveredTrackLight', hovered.trackLightFillOpacity, 0.34)
    check('tcl.selectedTrackDark', timelineClipEmphasisMetrics('selected').trackDarkFillOpacity, 0.4)
    check('tcl.primaryNeutral', timelineClipEmphasisMetrics('selected').primaryNeutralFillOpacity, 0.065)
  }
  check('tcl.handlesIdle', timelineClipShowsHandles('idle'), false)
  check('tcl.handlesHovered', timelineClipShowsHandles('hovered'), true)
  check('tcl.surfaceLight', timelineClipSurface('selected', 'light').opacity, 0.46)
  check('tcl.surfaceDark', timelineClipSurface('selected', 'dark').opacity, 0.4)
  check('tcl.surfaceSource', timelineClipSurface('idle', 'light').source, 'trackWash')
  check('tcl.primarySource', primaryTimelineSurface('editing').source, 'chrome')
  check('tcl.primaryOpacity', primaryTimelineSurface('editing').opacity, 0.07)
  {
    const tintHover = timelineClipChromeStyle({ emphasis: 'hovered', hasTint: true, hasSelectionRing: false })
    check('tcl.tintHoverOpacity', tintHover.opacity, 0.7)
    check('tcl.tintHoverWidth', tintHover.strokeWidth, 0.75)
    check('tcl.tintSource', tintHover.ringSource, 'tint')
    const noTintHover = timelineClipChromeStyle({ emphasis: 'hovered', hasTint: false, hasSelectionRing: false })
    check('tcl.noTintHoverOpacity', noTintHover.opacity, 0.2)
    const noTintIdle = timelineClipChromeStyle({ emphasis: 'idle', hasTint: false, hasSelectionRing: false })
    check('tcl.noTintIdleOpacity', noTintIdle.opacity, 0.1)
    check('tcl.defaultRing', noTintIdle.ringSource, 'defaultRing')
    const selectionOnly = timelineClipChromeStyle({ emphasis: 'idle', hasTint: false, hasSelectionRing: true })
    check('tcl.selectionRingSource', selectionOnly.ringSource, 'selectionTint')
    const selected = timelineClipChromeStyle({ emphasis: 'selected', hasTint: true, hasSelectionRing: true })
    check('tcl.selectedRing', `${selected.opacity}/${selected.strokeWidth}`, '1/1.5')
  }
  check('tcl.animation', `${TIMELINE_CLIP_CHROME_ANIMATION.kind}/${TIMELINE_CLIP_CHROME_ANIMATION.duration}`, 'easeOut/0.14')
  check('tcl.noHitTesting', TIMELINE_CLIP_CHROME_HIT_TESTING, false)

}

await runRecordingShellBatch()

async function runCapturePipelineBatch() {
  // ========== 6 文件 / 649 行：循环壁纸读取 / 输入开关 / 样本重定基 /
  //            摄像头格式配置 / 预览效果预热 / 轨道标签
  const {
    WALLPAPER_SAMPLE_TOLERANCE, wallpaperLoopPosition, wallpaperReaderResetRequired,
    wallpaperAdvanceIndex, LoopingWallpaperReader, wallpaperFallbackIndex,
    INPUT_TOGGLE_SPACING, INPUT_TOGGLE_MINIMUM_SPACER, INPUT_TOGGLE_FOCUS_RING_OPACITY,
    INPUT_TOGGLE_NATIVE_FOCUS_RING, INPUT_TOGGLE_LABEL_ACCESSIBILITY_HIDDEN,
    inputToggleIsOn, inputToggleFocusReport, inputToggleFocusCueVisible, inputToggleRowLayout,
    retimePath, adjustTiming, retimeSampleTimings,
    widestCadenceFormat, formatsMatchingDimensions, preferredFormatPlan, cameraFormatPlan,
    cameraFormatNeedsApply, cameraFormatFailureMessage, CAMERA_AUTOMATIC_CADENCE_FRAME_DURATIONS,
    cameraConfiguredLogLine,
    EFFECT_PREWARM_DELAY, EFFECT_PREWARM_SIGNATURE_LIMIT, EFFECT_PREWARM_MINIMUM_SIDE,
    EFFECT_PREWARM_MINIMUM_SCALE, EFFECT_PREWARM_TEXTURE, previewEffectPrewarmKey,
    previewEffectPrewarmKeyString, effectPrewarmIsCurrent, effectSignatureSetAction,
    previewDestinationScale,
    LANE_LABEL_ICON_SIZE, LANE_LABEL_TILE_SIZE, LANE_LABEL_TILE_RADIUS,
    LANE_LABEL_TILE_TINT_OPACITY, LANE_LABEL_SPACING, LANE_LABEL_HORIZONTAL_INSET,
    LANE_LABEL_COLLAPSED_INSET, LANE_HIDE_BUTTON_SIZE, LANE_ROW_DIVIDER_HEIGHT,
    TIMELINE_SWAP_IN_DELAY, LANE_LABEL_TEXT, laneLabelHorizontalPadding,
    laneHideButtonVisible, laneLabelShowsTitle, laneLabelUsesPrimaryText,
    laneRowDividerOpacity, laneTransitionSpec, timelineRowHeights,
  } = m

  // ---------------------------------- ExportLoopingWallpaperVideoReader.swift
  check('wl.tolerance', WALLPAPER_SAMPLE_TOLERANCE, 0.0005)
  {
    const position = wallpaperLoopPosition(2.5, 2)
    check('wl.loopIndex', position.loopIndex, 1)
    check('wl.localTime', position.localTime, 0.5)
    check('wl.zeroPosition', wallpaperLoopPosition(0, 2).loopIndex, 0)
    check('wl.nanClamped', wallpaperLoopPosition(NaN, 2).localTime, 0)
    check('wl.negativeClamped', wallpaperLoopPosition(-3, 2).loopIndex, 0)
  }
  check('wl.resetNoReader', wallpaperReaderResetRequired({ hasReader: false, loopIndex: 0, previousLoopIndex: -1, localTime: 0, currentLocalTime: -1 }), true)
  check('wl.noResetForward', wallpaperReaderResetRequired({ hasReader: true, loopIndex: 1, previousLoopIndex: 1, localTime: 0.5, currentLocalTime: 0.2 }), false)
  check('wl.resetOnLoopChange', wallpaperReaderResetRequired({ hasReader: true, loopIndex: 2, previousLoopIndex: 1, localTime: 0.1, currentLocalTime: 1.9 }), true)
  // 同一圈内回拖：必须重建，否则只能拿到后面的帧
  check('wl.resetOnRewind', wallpaperReaderResetRequired({ hasReader: true, loopIndex: 1, previousLoopIndex: 1, localTime: 0.2, currentLocalTime: 0.9 }), true)
  {
    const samples = [0, 1 / 30, 2 / 30, 3 / 30]
    check('wl.advanceFirst', wallpaperAdvanceIndex({ sampleTimes: samples, startOffset: 0, localTime: 0 }), 0)
    check('wl.advanceThird', wallpaperAdvanceIndex({ sampleTimes: samples, startOffset: 0, localTime: 0.071 }), 2)
    check('wl.advanceWithOffset', wallpaperAdvanceIndex({ sampleTimes: [10, 10.5, 11], startOffset: 10, localTime: 0.4 }), 0)
    check('wl.advanceNone', wallpaperAdvanceIndex({ sampleTimes: [5], startOffset: 0, localTime: 1 }), -1)
  }
  {
    let threw = null
    try {
      new LoopingWallpaperReader(0)
    } catch (error) {
      threw = error
    }
    check('wl.zeroDurationThrows', threw instanceof RangeError, true)
    check('wl.errorMessage', threw.message, 'unusableMediaRange')
    const reader = new LoopingWallpaperReader(2)
    const first = reader.plan(2.5)
    check('wl.firstPlanResets', first.reset, true)
    check('wl.firstPlanLoop', first.loopIndex, 1)
    const second = reader.plan(2.6)
    check('wl.forwardNoReset', second.reset, false)
    const rewind = reader.plan(0.2)
    check('wl.rewindResets', rewind.reset, true)
    check('wl.readerStateLoop', reader.state.loopIndex, 0)
    check('wl.failureMessage', LoopingWallpaperReader.failureMessage('背景素材'), '背景素材视频轨读取失败')
  }
  check('wl.fallbackKeep', wallpaperFallbackIndex({ hasCurrentFrame: true, hasNextSample: true }), 'keepCurrent')
  check('wl.fallbackNext', wallpaperFallbackIndex({ hasCurrentFrame: false, hasNextSample: true }), 'takeNext')
  check('wl.fallbackNone', wallpaperFallbackIndex({ hasCurrentFrame: false, hasNextSample: false }), 'none')

  // ------------------------------------------------- RecorderInputToggle.swift
  check('itg.spacing', INPUT_TOGGLE_SPACING, 8)
  check('itg.minimumSpacer', INPUT_TOGGLE_MINIMUM_SPACER, 8)
  check('itg.ringOpacity', INPUT_TOGGLE_FOCUS_RING_OPACITY, 0.4)
  check('itg.nativeRing', INPUT_TOGGLE_NATIVE_FOCUS_RING, 'none')
  check('itg.labelHidden', INPUT_TOGGLE_LABEL_ACCESSIBILITY_HIDDEN, true)
  check('itg.onState', inputToggleIsOn('on'), true)
  check('itg.offState', inputToggleIsOn('off'), false)
  check('itg.mixedState', inputToggleIsOn('mixed'), false)
  check('itg.focusReported', inputToggleFocusReport(true), true)
  check('itg.focusCue', inputToggleFocusCueVisible(true, true), true)
  check('itg.focusCueDisabled', inputToggleFocusCueVisible(true, false), false)
  {
    const layout = inputToggleRowLayout({ availableWidth: 200, switchWidth: 38 })
    check('itg.labelWidth', layout.labelWidth, 146)
    check('itg.switchWidth', layout.switchWidth, 38)
    const tight = inputToggleRowLayout({ availableWidth: 40, switchWidth: 38 })
    check('itg.tightFloors', tight.labelWidth, 8)
  }

  // ---------------------------------------------- SampleBufferTimeRetimer.swift
  check('rt.pathSkip', retimePath(0), 'skip')
  check('rt.pathSingle', retimePath(1), 'single')
  check('rt.pathMultiple', retimePath(3), 'multiple')
  {
    const entries = [{ duration: 0.1, presentationTime: 5, decodeTime: null }]
    check('rt.zeroOffsetUnchanged', retimeSampleTimings(entries, 0).kind, 'unchanged')
    check('rt.negativeOffsetUnchanged', retimeSampleTimings(entries, -2).kind, 'unchanged')
    check('rt.nanOffsetUnchanged', retimeSampleTimings(entries, NaN).kind, 'unchanged')
    check('rt.emptyUnchanged', retimeSampleTimings([], 3).kind, 'unchanged')
    const retimed = retimeSampleTimings(entries, 2)
    check('rt.retimed', retimed.kind, 'retimed')
    check('rt.presentationShifted', retimed.entries[0].presentationTime, 3)
    check('rt.decodeStaysInvalid', retimed.entries[0].decodeTime, null)
    check('rt.durationUntouched', retimed.entries[0].duration, 0.1)
    const adjusted = adjustTiming({ duration: null, presentationTime: 10, decodeTime: 9 }, 4)
    check('rt.adjustPresentation', adjusted.presentationTime, 6)
    check('rt.adjustDecode', adjusted.decodeTime, 5)
  }

  // --------------------------------------- CameraCaptureDeviceConfigurator.swift
  {
    const formats = [
      { width: 1920, height: 1080, frameRateMaximums: [30] },
      { width: 1920, height: 1080, frameRateMaximums: [60] },
      { width: 1920, height: 1080, frameRateMaximums: [60] },
    ]
    // 并列时保留先出现的（Swift 用严格小于）
    const widest = widestCadenceFormat(formats)
    check('cfg.widestTieKeepsFirst', widest.frameRateMaximums[0], 60)
    check('cfg.widestIndexTwo', formats.indexOf(widest), 1)
    check('cfg.widestEmpty', widestCadenceFormat([]), null)
  }
  {
    const formats = [
      { width: 1280, height: 720, frameRateMaximums: [30] },
      { width: 1280, height: 720, frameRateMaximums: [] },
      { width: 1920, height: 1080, frameRateMaximums: [30] },
    ]
    const matched = formatsMatchingDimensions(formats, { width: 1280, height: 720 })
    check('cfg.matchExcludesNoCadence', matched.length, 1)
    check('cfg.matchDimensions', matched[0].width, 1280)
    const none = formatsMatchingDimensions(formats, { width: 640, height: 480 })
    check('cfg.matchNone', none.length, 0)
  }
  {
    const formats = [
      { width: 1920, height: 1080, frameRateMaximums: [30] },
      { width: 1920, height: 1080, frameRateMaximums: [60] },
      { width: 1280, height: 720, frameRateMaximums: [60] },
    ]
    const plan = preferredFormatPlan({ formats, role: 'camera' })
    check('cfg.preferredApplies', plan.kind, 'apply')
    check('cfg.preferredWidest', plan.format.frameRateMaximums[0], 60)
    check('cfg.preferredEmpty', preferredFormatPlan({ formats: [], role: 'camera' }).kind, 'skip')
    check(
      'cfg.preferredInvalidDims',
      preferredFormatPlan({ formats: [{ width: 0, height: 0, frameRateMaximums: [30] }], role: 'camera' }).kind,
      'skip'
    )
  }
  {
    const formats = [
      { width: 1280, height: 720, frameRateMaximums: [24] },
      { width: 1280, height: 720, frameRateMaximums: [30] },
    ]
    const plan = cameraFormatPlan(formats, { width: 1280, height: 720, label: '720p' }, '摄像头')
    check('cfg.exactApplies', plan.kind, 'apply')
    check('cfg.exactWidest', plan.format.frameRateMaximums[0], 30)
    const unsupported = cameraFormatPlan(formats, { width: 640, height: 480, label: '480p' }, '摄像头')
    check('cfg.exactUnsupported', unsupported.kind, 'unsupported')
    check('cfg.exactMessage', unsupported.message, '摄像头：摄像头不再支持所选分辨率 480p')
  }
  check('cfg.sameFormatSkips', cameraFormatNeedsApply({ isSameFormat: true }), false)
  check('cfg.differentFormatApplies', cameraFormatNeedsApply({ isSameFormat: false }), true)
  check(
    'cfg.failureWithLabel',
    cameraFormatFailureMessage({ label: '1080p', reason: '被占用', roleDisplayName: '摄像头' }),
    '摄像头：无法选择 1080p：被占用'
  )
  check(
    'cfg.failureWithoutLabel',
    cameraFormatFailureMessage({ reason: '被占用', roleDisplayName: '摄像头' }),
    '摄像头：无法锁定设备采集格式：被占用'
  )
  check('cfg.autoCadence', `${CAMERA_AUTOMATIC_CADENCE_FRAME_DURATIONS.minimum}/${CAMERA_AUTOMATIC_CADENCE_FRAME_DURATIONS.maximum}`, 'null/null')
  check('cfg.logLine', cameraConfiguredLogLine({ width: 1280, height: 720 }), 'camera configured size=1280x720 fps=automatic')

  // ------------------------------------ SharedPreviewEffectPreparation.swift
  check('pw.delay', EFFECT_PREWARM_DELAY, 0.12)
  check('pw.signatureLimit', EFFECT_PREWARM_SIGNATURE_LIMIT, 16)
  check('pw.minimumSide', EFFECT_PREWARM_MINIMUM_SIDE, 2)
  check('pw.minimumScale', EFFECT_PREWARM_MINIMUM_SCALE, 0.0001)
  check('pw.textureFormat', EFFECT_PREWARM_TEXTURE.pixelFormat, 'bgra8Unorm')
  {
    const scene = {
      canvasSize: { width: 100, height: 50 },
      screen: {
        decoration: 'none', cornerRadius: 0, borderWidth: 0, shadowOpacity: 0,
        opacity: 1, hasFocusEffect: false, isIdentityProjection: true, mosaics: [],
      },
      cursorPresent: false,
      camera: null,
      backgroundBlurRadius: 0,
      stickerBackdrop: { screenBlur: 0, cameraBlur: 0, screenSuppression: 0, cameraSuppression: 0 },
      stickers: [],
    }
    const resources = { hasCursor: false, hasCamera: false, stickerPaths: [] }
    const key = previewEffectPrewarmKey({ scene, resources, destinationSize: { width: 99.6, height: 50.2 } })
    check('pw.branchCount', key.branches.length, 17)
    check('pw.widthRounded', key.width, 100)
    check('pw.heightRounded', key.height, 50)
    check('pw.allBranchesFalse', key.branches.every((flag) => flag === false), true)
    const decorated = previewEffectPrewarmKey({
      scene: {
        ...scene,
        cursorPresent: true,
        screen: { ...scene.screen, decoration: 'chrome', cornerRadius: 8, borderWidth: 2, shadowOpacity: 0.2, opacity: 0.5, hasFocusEffect: true, isIdentityProjection: false, mosaics: [{ style: 'pixel' }] },
      },
      resources: { hasCursor: true, hasCamera: true, stickerPaths: ['s.png'] },
      destinationSize: { width: 100, height: 50 },
    })
    check('pw.identity', decorated.branches[0], true)
    check('pw.chrome', decorated.branches[1], true)
    check('pw.corner', decorated.branches[2], true)
    check('pw.translucent', decorated.branches[5], true)
    check('pw.focus', decorated.branches[6], true)
    check('pw.cursorNeedsResource', decorated.branches[7], true)
    check('pw.mosaicStyle', decorated.mosaicStyles.join(','), 'pixel')
    check('pw.noStickers', decorated.stickerBranches.length, 0)
    check('pw.keyStable', previewEffectPrewarmKeyString(key), previewEffectPrewarmKeyString(
      previewEffectPrewarmKey({ scene, resources, destinationSize: { width: 100, height: 50 } })
    ))
    check('pw.keyDiffersBySize', previewEffectPrewarmKeyString(key) !== previewEffectPrewarmKeyString(decorated), true)
  }
  {
    const base = {
      jobGeneration: 1, renderGeneration: 1, jobEpoch: 2, presentationEpoch: 2,
      jobColorContract: 'sdr', queueColorContract: 'sdr',
    }
    check('pw.currentOk', effectPrewarmIsCurrent(base), true)
    check('pw.staleGeneration', effectPrewarmIsCurrent({ ...base, renderGeneration: 2 }), false)
    check('pw.staleEpoch', effectPrewarmIsCurrent({ ...base, presentationEpoch: 3 }), false)
    check('pw.colorMismatch', effectPrewarmIsCurrent({ ...base, queueColorContract: 'hdr' }), false)
  }
  check('pw.signatureSkip', effectSignatureSetAction({ alreadyPrepared: true, size: 3 }), 'skip')
  check('pw.signatureInsert', effectSignatureSetAction({ alreadyPrepared: false, size: 15 }), 'insert')
  check('pw.signatureClear', effectSignatureSetAction({ alreadyPrepared: false, size: 16 }), 'clearAndInsert')
  {
    const shrink = previewDestinationScale({ canvasSize: { width: 100, height: 100 }, bounds: { width: 50, height: 25 } })
    check('pw.scaleX', shrink.scaleX, 0.5)
    check('pw.scaleY', shrink.scaleY, 0.25)
    check('pw.usesLanczos', shrink.usesLanczos, true)
    check('pw.aspectRatio', shrink.aspectRatio, 2)
    const grow = previewDestinationScale({ canvasSize: { width: 100, height: 100 }, bounds: { width: 200, height: 200 } })
    check('pw.growNoLanczos', grow.usesLanczos, false)
    check('pw.growAspect', grow.aspectRatio, 1)
    const tiny = previewDestinationScale({ canvasSize: { width: 0, height: 0 }, bounds: { width: 1, height: 1 } })
    check('pw.canvasFloor', tiny.scaleX, 0.5)
  }

  // ------------------------------------------- EditorTimelineLaneLabel.swift
  check('ll.icon', `${LANE_LABEL_ICON_SIZE}/${LANE_LABEL_TILE_SIZE}`, '12/22')
  check('ll.tileRadius', LANE_LABEL_TILE_RADIUS, 8)
  check('ll.tintOpacity', LANE_LABEL_TILE_TINT_OPACITY, 0.18)
  check('ll.spacing', LANE_LABEL_SPACING, 9)
  check('ll.hideSize', LANE_HIDE_BUTTON_SIZE, 24)
  check('ll.dividerHeight', LANE_ROW_DIVIDER_HEIGHT, 0.5)
  check('ll.swapDelay', TIMELINE_SWAP_IN_DELAY, 0.1)
  check('ll.paddingRegular', laneLabelHorizontalPadding(false, LANE_LABEL_HORIZONTAL_INSET), 12)
  check('ll.paddingCollapsed', laneLabelHorizontalPadding(true, 40), 15)
  check('ll.collapsedInset', LANE_LABEL_COLLAPSED_INSET, 15)
  check('ll.hideVisible', laneHideButtonVisible({ hasHideAction: true, collapsed: false, hovered: true }), true)
  check('ll.hideHiddenNotHovered', laneHideButtonVisible({ hasHideAction: true, collapsed: false, hovered: false }), false)
  check('ll.hideHiddenCollapsed', laneHideButtonVisible({ hasHideAction: true, collapsed: true, hovered: true }), false)
  check('ll.hideHiddenNoAction', laneHideButtonVisible({ hasHideAction: false, collapsed: false, hovered: true }), false)
  check('ll.titleHiddenWhenCollapsed', laneLabelShowsTitle(true), false)
  check('ll.titleShown', laneLabelShowsTitle(false), true)
  check('ll.hoverPrimary', laneLabelUsesPrimaryText(true), true)
  check('ll.restSecondary', laneLabelUsesPrimaryText(false), false)
  check('ll.dividerNormal', laneRowDividerOpacity(false), 0.055)
  check('ll.dividerStrong', laneRowDividerOpacity(true), 0.085)
  check('ll.hideHelp', LANE_LABEL_TEXT.hideHelpFormat('缩放'), '隐藏“缩放”轨道；效果仍然生效')
  check('ll.hideA11y', LANE_LABEL_TEXT.hideAccessibilityFormat('缩放'), '隐藏“缩放”轨道')
  {
    const motion = laneTransitionSpec(false)
    check('ll.insertDuration', motion.insertion.duration, 0.22)
    check('ll.insertDelay', motion.insertion.delay, 0.12)
    check('ll.insertOffset', motion.insertion.offsetY, -6)
    check('ll.removeDuration', motion.removal.duration, 0.1)
    const reduced = laneTransitionSpec(true)
    check('ll.reducedInsertKind', reduced.insertion.kind, 'opacity')
    check('ll.reducedOffset', reduced.insertion.offsetY, 0)
    check('ll.reducedRemove', reduced.removal.duration, 0)
  }
  {
    const heights = timelineRowHeights({
      rulerHeight: 30, primaryVideoHeight: 64, cameraSyncTimelineHeight: 22,
      zoomTimelineHeight: 26, motionTimelineHeight: 24, overlayTimelineHeight: 20,
      showsCameraSync: true, showsZoom: false, showsScreenMotion: true,
      showsCameraMotion: false, showsOverlay: false,
    })
    check('ll.rowCount', heights.length, 4)
    check('ll.primaryPadded', heights[1], 76)
    check('ll.rowOrder', heights.join(','), '30,76,22,24')
  }

}

await runCapturePipelineBatch()


async function runEditorChromeAndPresetBatch() {
  // ========== 8 文件 / 1117 行：聚焦检查器 / 性能采样 / 编辑窗口过滤 /
  //            完成过渡 / 键盘焦点外观 / 图标目录 / 关于页 / 样式预设
  const {
    // ---- EditorFocusEffectInspector.swift
    FOCUS_EFFECT_INSPECTOR_ACTION_NAME, FOCUS_EFFECT_TARGET_TITLES,
    FOCUS_EFFECT_INSPECTOR_TITLES, FOCUS_EFFECT_INSPECTOR_TOGGLE_LABELS,
    FOCUS_EFFECT_INSPECTOR_ROTATION_SLIDER, FOCUS_EFFECT_INSPECTOR_SLIDERS,
    focusEffectInspectorSelectionEffect, focusEffectInspectorIsLinear,
    focusEffectInspectorTitle, focusEffectInspectorAccessibilityLabel,
    focusEffectInspectorToggleProposal, normalizeFocusEffectForLinear,
    focusEffectInspectorAcceptsUpdate, editorSelectionEqual,
    focusEffectInspectorSlider, focusEffectInspectorTargetChange,
    focusEffectInspectorCenterChange, focusEffectInspectorPositionPadVisible,
    focusEffectInspectorSliderVisible, focusEffectInspectorTargetPickerVisible,
    focusEffectInspectorWritePlan, applyFocusEffectWritePlan,
    makeFocusEffect,
    // ---- RecordingPerformanceMonitor.swift
    NANOSECONDS_PER_SECOND, subtractWrappingUInt64, performanceSampleWallDelta,
    processCPUPercent, systemCPUPercent, performanceDelta,
    availableDiskBytesFromCandidates, thermalStateFromName, performanceSampleFrom,
    RecordingPerformanceMonitor,
    // ---- CaptureEditorWindows.swift
    EDITOR_WINDOW_IDENTIFIER, editorWindowRegistrationIDs, CaptureEditorWindowsRegistry,
    captureEditorRefreshSupported, CAPTURE_EDITOR_REFRESH_RETRY_DELAYS_MS,
    CAPTURE_EDITOR_REFRESH_FALLBACK_DETAIL, captureEditorRefreshFailureMessage,
    captureEditorRefreshPlan, windowIDSetEqual, runCaptureEditorRefresh,
    CaptureEditorWindowRefresh,
    // ---- RecordingCompletionTransition.swift
    RECORDING_COMPLETION_DURATION, RECORDING_COMPLETION_REDUCED_DURATION,
    RECORDING_COMPLETION_CARD_RADIUS, completionTransitionDuration,
    completionTransitionProgress, completionTransitionGeometry,
    completionTransitionElapsed, completionTransitionTime, completionTransitionFrame,
    completionTransitionAlphas, completionTransitionFrameAt,
    COMPLETION_TRANSITION_INITIAL_STATE, recordingCompletionCardOrigins,
    COMPLETION_TRANSITION_RUN_LOOP_MODES,
    // ---- AppControlFocusAppearance.swift
    APP_KEYBOARD_FOCUS_NAVIGATION_KEY_CODES, APP_KEYBOARD_FOCUS_BLOCKING_MODIFIERS,
    APP_SHOWS_KEYBOARD_FOCUS_DEFAULT, APP_KEYBOARD_FOCUS_CUE_LINE_WIDTH,
    APP_KEYBOARD_FOCUS_CUE_DEFAULT_CHROME_LEVEL, APP_CONTROL_FOCUS_ROOT_ATTRIBUTE,
    appKeyboardFocusEventAction, keyboardFocusCueVisible, keyboardFocusEnvironmentValue,
    AppKeyboardFocusVisibility,
    // ---- EditorSymbol.swift
    EDITOR_SYMBOL_SCALE, EDITOR_SYMBOL_LABEL_DEFAULT_SIZE, EDITOR_SYMBOL_CATALOG,
    editorSymbolKind, editorSymbolSize, editorSymbolKinds,
    // ---- AppAboutSettingsView.swift
    ABOUT_SUBTITLE, ABOUT_HERO_ICON_SIZE, ABOUT_HERO_ICON_SHADOW, ABOUT_HERO_ENTRY_SCALE,
    ABOUT_HERO_ENTRY_OFFSET_Y, ABOUT_HERO_ARRIVAL_DELAY, ABOUT_TITLE_SIZE,
    ABOUT_SUBTITLE_SIZE, ABOUT_VERSION_PILL, ABOUT_HERO_PADDING, ABOUT_LINK_TILE_SPACING,
    ABOUT_LINK_TILE_METRICS, ABOUT_LINK_TILE_HOVER_OFFSET, ABOUT_UPDATE_BAR_METRICS,
    ABOUT_PAGE_PADDING, ABOUT_AUTOMATIC_UPDATE_TITLE, ABOUT_CHECK_UPDATES_TITLE,
    ABOUT_CHECK_UPDATES_HINT, APP_PROJECT_LINKS, ABOUT_LINK_TILES, aboutHeroArrival,
    aboutLinkTileTrailingOffset, aboutLinkTileAccessibilityIdentifier,
    aboutCheckForUpdatesEnabled, aboutAutoUpdateEnabled, aboutCheckForUpdatesHelp,
    // ---- EditorStylePresetStore.swift
    EDITOR_STYLE_PRESET_KEY, EDITOR_LAST_USED_STYLE_KEY, EDITOR_DEFAULT_PRESET_ID_KEY,
    EDITOR_STYLE_PRESET_FORMAT_VERSION, EDITOR_LAST_USED_STYLE_FORMAT_VERSION,
    EDITOR_LAST_USED_STYLE_NAME, styleValueEqual, editorStylePresetIncludesCrop,
    makeEditorStylePreset, applyEditorStylePreset, editorStylePresetMatchesConfiguration,
    editorStylePresetHasAvailableBackground, editorStylePresetBackgroundIsAvailable,
    loadEditorStylePresets, saveEditorStylePresets, readDefaultPresetID,
    writeDefaultPresetID, rememberLastUsedStyle, applyingLastUsedStyle,
    clearEditorStylePresetStorage,
    // ---- 工程构造（复用既有批次）
    makeRecorderProject, makeProjectTimeline, makeCanvasStyle, makeCameraStyle,
    makeMotionStyle, makeCursorStyle, makeAudioStyle, makeOpeningSequence,
  } = m

  const projectWith = (overrides = {}) =>
    makeRecorderProject({
      canvas: makeCanvasStyle(overrides.canvas ?? {}),
      camera: makeCameraStyle(overrides.camera ?? {}),
      motion: makeMotionStyle(overrides.motion ?? {}),
      cursorStyle: makeCursorStyle(),
      audio: makeAudioStyle(),
      openingSequence: makeOpeningSequence(),
      timeline: makeProjectTimeline(overrides.timeline ?? {}),
    })

  // ---------------------------------------------------------------------------
  // EditorFocusEffectInspector.swift（135 行）
  // ---------------------------------------------------------------------------
  check('efi.actionName', FOCUS_EFFECT_INSPECTOR_ACTION_NAME, '调整聚焦')
  check('efi.titleRadial', FOCUS_EFFECT_INSPECTOR_TITLES.radial, '聚焦')
  check('efi.titleLinear', FOCUS_EFFECT_INSPECTOR_TITLES.linear, '线性虚化')
  check('efi.a11yRadial', FOCUS_EFFECT_INSPECTOR_TOGGLE_LABELS.radial, '启用聚焦')
  check('efi.a11yLinear', FOCUS_EFFECT_INSPECTOR_TOGGLE_LABELS.linear, '启用线性虚化')
  check('efi.targetTitles', Object.values(FOCUS_EFFECT_TARGET_TITLES).join(','), '随运镜,随鼠标,固定')
  check('efi.titleUsesLinear', focusEffectInspectorTitle(true), '线性虚化')
  check('efi.titleUsesRadial', focusEffectInspectorTitle(false), '聚焦')
  check('efi.a11yUsesLinear', focusEffectInspectorAccessibilityLabel(true), '启用线性虚化')
  check('efi.rotationMin', FOCUS_EFFECT_INSPECTOR_ROTATION_SLIDER.min, 0)
  check('efi.rotationMax', FOCUS_EFFECT_INSPECTOR_ROTATION_SLIDER.max, 360)
  check('efi.rotationFormat', FOCUS_EFFECT_INSPECTOR_ROTATION_SLIDER.format, 'degrees')
  check('efi.sliderTitles', FOCUS_EFFECT_INSPECTOR_SLIDERS.map((s) => s.title).join(','),
    '清晰范围,模糊程度,羽化范围,暗角')
  check('efi.sliderRanges', FOCUS_EFFECT_INSPECTOR_SLIDERS.map((s) => `${s.min}-${s.max}`).join(','),
    '0.1-1,0-1,0-1,0-1')
  check('efi.dimmingHiddenWhenLinear',
    FOCUS_EFFECT_INSPECTOR_SLIDERS[3].hiddenWhenLinear, true)
  check('efi.dimmingHiddenInLinear',
    focusEffectInspectorSliderVisible(FOCUS_EFFECT_INSPECTOR_SLIDERS[3], true), false)
  check('efi.dimmingVisibleInRadial',
    focusEffectInspectorSliderVisible(FOCUS_EFFECT_INSPECTOR_SLIDERS[3], false), true)
  check('efi.sizeAlwaysVisible',
    focusEffectInspectorSliderVisible(FOCUS_EFFECT_INSPECTOR_SLIDERS[0], true), true)
  check('efi.targetPickerRadial', focusEffectInspectorTargetPickerVisible(false), true)
  check('efi.targetPickerLinear', focusEffectInspectorTargetPickerVisible(true), false)

  {
    const effect = makeFocusEffect()
    const project = projectWith({
      timeline: {
        zoomClips: [{ id: 'z1', focusEffect: effect }, { id: 'z2', focusEffect: null }],
        screenMotionClips: [{ id: 'm1', focusEffect: makeFocusEffect({ linear: true }) }],
      },
    })
    check('efi.selectionZoomEffect',
      focusEffectInspectorSelectionEffect({ kind: 'zoom', id: 'z1' }, project) === effect, true)
    check('efi.selectionZoomNull',
      focusEffectInspectorSelectionEffect({ kind: 'zoom', id: 'z2' }, project), null)
    check('efi.selectionMissingClip',
      focusEffectInspectorSelectionEffect({ kind: 'zoom', id: 'zz' }, project), null)
    check('efi.selectionScreenMotionShape',
      focusEffectInspectorSelectionEffect({ kind: 'screenMotion', id: 'm1' }, project).shape, 'linear')
    check('efi.selectionCanvas',
      focusEffectInspectorSelectionEffect({ kind: 'canvas' }, project), null)
    check('efi.selectionNull', focusEffectInspectorSelectionEffect(null, project), null)
  }

  check('efi.linearByScreenMotion',
    focusEffectInspectorIsLinear({ kind: 'screenMotion', id: 'm1' }, null), true)
  check('efi.linearByShape',
    focusEffectInspectorIsLinear({ kind: 'zoom', id: 'z1' }, makeFocusEffect({ linear: true })), true)
  check('efi.radialByDefault',
    focusEffectInspectorIsLinear({ kind: 'zoom', id: 'z1' }, makeFocusEffect()), false)
  check('efi.radialForCanvasSelection',
    focusEffectInspectorIsLinear({ kind: 'canvas' }, null), false)

  {
    const off = focusEffectInspectorToggleProposal(true, false)
    check('efi.toggleOffNull', off, null)
    const linear = focusEffectInspectorToggleProposal(true, true)
    check('efi.toggleLinearShape', linear.shape, 'linear')
    check('efi.toggleLinearTarget', linear.target, 'fixed')
    check('efi.toggleLinearDimming', linear.dimming, 0)
    const radial = focusEffectInspectorToggleProposal(false, true)
    check('efi.toggleRadialShape', radial.shape, null)
    check('efi.toggleRadialDimming', radial.dimming, 0.18)
    check('efi.toggleRadialSize', radial.size, 0.45)
  }

  {
    const source = makeFocusEffect({ dimming: 0.4, target: 'pointer' })
    check('efi.normalizeNull', normalizeFocusEffectForLinear(null, true), null)
    check('efi.normalizeRadialKeepsRef', normalizeFocusEffectForLinear(source, false) === source, true)
    const linear = normalizeFocusEffectForLinear(source, true)
    check('efi.normalizeShape', linear.shape, 'linear')
    check('efi.normalizeTarget', linear.target, 'fixed')
    check('efi.normalizeDimming', linear.dimming, 0)
    check('efi.normalizeNoMutation', source.dimming, 0.4)
    check('efi.normalizeKeepsSize', linear.size, source.size)
  }

  check('efi.selectionSameID',
    editorSelectionEqual({ kind: 'zoom', id: 'a' }, { kind: 'zoom', id: 'a' }), true)
  check('efi.selectionDiffID',
    editorSelectionEqual({ kind: 'zoom', id: 'a' }, { kind: 'zoom', id: 'b' }), false)
  check('efi.selectionDiffKind',
    editorSelectionEqual({ kind: 'zoom', id: 'a' }, { kind: 'screenMotion', id: 'a' }), false)
  check('efi.selectionBothNull', editorSelectionEqual(null, null), true)
  check('efi.selectionNullVsCanvas', editorSelectionEqual(null, { kind: 'canvas' }), false)
  check('efi.acceptsSame',
    focusEffectInspectorAcceptsUpdate({ kind: 'zoom', id: 'a' }, { kind: 'zoom', id: 'a' }), true)
  check('efi.acceptsChanged',
    focusEffectInspectorAcceptsUpdate({ kind: 'zoom', id: 'a' }, { kind: 'zoom', id: 'b' }), false)

  {
    const effect = makeFocusEffect({ size: 0.5 })
    check('efi.sliderSize', focusEffectInspectorSlider(effect, 'size', 0.9).size, 0.9)
    check('efi.sliderNoMutation', effect.size, 0.5)
    check('efi.sliderAngle', focusEffectInspectorSlider(effect, 'angleDegrees', 45).angleDegrees, 45)
    check('efi.targetChange', focusEffectInspectorTargetChange(effect, 'pointer').target, 'pointer')
    const moved = focusEffectInspectorCenterChange(effect, { x: 0.2, y: 0.7 })
    check('efi.centerChange', `${moved.center.x},${moved.center.y}`, '0.2,0.7')
  }

  check('efi.padVisibleFixed',
    focusEffectInspectorPositionPadVisible(makeFocusEffect({ target: 'fixed' }), false), true)
  check('efi.padHiddenPointer',
    focusEffectInspectorPositionPadVisible(makeFocusEffect({ target: 'pointer' }), false), false)
  check('efi.padHiddenLinear',
    focusEffectInspectorPositionPadVisible(makeFocusEffect({ target: 'fixed' }), true), false)
  check('efi.padHiddenNoEffect', focusEffectInspectorPositionPadVisible(null, false), false)

  {
    check('efi.writePlanCanvas', focusEffectInspectorWritePlan({ kind: 'canvas' }, null), null)
    const zoomPlan = focusEffectInspectorWritePlan({ kind: 'zoom', id: 'z9' }, null)
    check('efi.writePlanKind', zoomPlan.selectionKind, 'zoom')
    check('efi.writePlanID', zoomPlan.clipID, 'z9')
    const project = projectWith({ timeline: { zoomClips: [{ id: 'z9', focusEffect: null }] } })
    const effect = makeFocusEffect({ linear: true })
    check('efi.writePlanApplied', applyFocusEffectWritePlan(project, zoomPlan), true)
    check('efi.writePlanWrote', project.timeline.zoomClips[0].focusEffect, null)
    check('efi.applyMissing',
      applyFocusEffectWritePlan(project, { selectionKind: 'zoom', clipID: 'nope', effect }), false)
    const motionProject = projectWith({ timeline: { screenMotionClips: [{ id: 'm9', focusEffect: null }] } })
    check('efi.applyScreenMotion',
      applyFocusEffectWritePlan(motionProject, { selectionKind: 'screenMotion', clipID: 'm9', effect }), true)
    check('efi.applyScreenMotionWrote', motionProject.timeline.screenMotionClips[0].focusEffect, effect)
  }

  // ---------------------------------------------------------------------------
  // RecordingPerformanceMonitor.swift（136 行）
  // ---------------------------------------------------------------------------
  check('pm.nanosPerSecond', Number(NANOSECONDS_PER_SECOND), 1_000_000_000)
  check('pm.wrapSubtract', subtractWrappingUInt64(5n, 10n), 18446744073709551611n)
  check('pm.plainSubtract', subtractWrappingUInt64(10n, 5n), 5n)
  check('pm.wallDeltaFirst', performanceSampleWallDelta(12.5, null), 0)
  check('pm.wallDeltaNormal', performanceSampleWallDelta(12.5, 11), 1.5)
  check('pm.wallDeltaClamped', performanceSampleWallDelta(10, 12), 0)
  check('pm.processCPUNoPrevious', processCPUPercent(null, 1), 0)
  check('pm.processCPUZeroWall', processCPUPercent(1_000_000_000n, 0), 0)
  check('pm.processCPUFullCore', processCPUPercent(1_000_000_000n, 1), 100)
  check('pm.processCPUHalfCore', processCPUPercent(500_000_000n, 2), 25)
  check('pm.systemCPUHalf', systemCPUPercent(50n, 100n), 50)
  check('pm.systemCPUZeroTotal', systemCPUPercent(50n, 0n), 0)
  check('pm.systemCPUNullUsed', systemCPUPercent(null, 100n), 0)

  {
    const first = { processNanoseconds: 100n, residentBytes: 400n, systemUsedTicks: 10n, systemTotalTicks: 100n }
    const second = { processNanoseconds: 1_000_000_100n, residentBytes: 800n, systemUsedTicks: 60n, systemTotalTicks: 200n }
    const delta0 = performanceDelta(first, null, 10, null)
    check('pm.deltaFirstProcess', delta0.processDelta, null)
    check('pm.deltaFirstWall', delta0.wallDelta, 0)
    const delta1 = performanceDelta(second, first, 11, 10)
    check('pm.deltaProcess', delta1.processDelta, 1_000_000_000n)
    check('pm.deltaSystemUsed', delta1.systemUsedDelta, 50n)
    check('pm.deltaSystemTotal', delta1.systemTotalDelta, 100n)
    check('pm.deltaWall', delta1.wallDelta, 1)
  }

  check('pm.diskImportantFirst',
    availableDiskBytesFromCandidates({ importantUsage: 3, capacity: 2, fileSystemFree: 1 }), 3)
  check('pm.diskCapacitySecond',
    availableDiskBytesFromCandidates({ importantUsage: null, capacity: 2, fileSystemFree: 1 }), 2)
  check('pm.diskFreeThird',
    availableDiskBytesFromCandidates({ importantUsage: null, capacity: null, fileSystemFree: 1 }), 1)
  check('pm.diskNone',
    availableDiskBytesFromCandidates({ importantUsage: null, capacity: null, fileSystemFree: null }), null)
  check('pm.thermalNominal', thermalStateFromName('nominal'), 'nominal')
  check('pm.thermalFair', thermalStateFromName('fair'), 'fair')
  check('pm.thermalSerious', thermalStateFromName('serious'), 'serious')
  check('pm.thermalCritical', thermalStateFromName('critical'), 'critical')
  check('pm.thermalUnknown', thermalStateFromName('sleeping'), 'unknown')

  {
    const sample = performanceSampleFrom({
      uptime: 10,
      startedAt: 12,
      delta: { wallDelta: 1, processDelta: 500_000_000n, systemUsedDelta: 25n, systemTotalDelta: 100n },
      residentBytes: 2048n,
      metalAllocatedBytes: 4096,
      availableDiskBytes: 1024,
      thermalState: 'fair',
    })
    check('pm.sampleElapsedClamped', sample.elapsed, 0)
    check('pm.sampleProcessCPU', sample.processCPUPercent, 50)
    check('pm.sampleSystemCPU', sample.systemCPUPercent, 25)
    check('pm.sampleResident', sample.processResidentBytes, 2048)
    check('pm.sampleMetal', sample.processMetalAllocatedBytes, 4096)
    check('pm.sampleDisk', sample.availableDiskBytes, 1024)
    check('pm.sampleThermal', sample.thermalState, 'fair')
  }

  {
    let uptime = 100
    let counters = { processNanoseconds: 0n, residentBytes: 100n, systemUsedTicks: 0n, systemTotalTicks: 0n }
    let readable = true
    const monitor = new RecordingPerformanceMonitor({
      uptime: () => uptime,
      readCpuCounters: () => (readable ? counters : null),
      allocatedMetalBytes: () => 512,
      availableDiskBytes: () => 4096,
      thermalState: () => 'nominal',
    })
    check('pm.monitorStart', monitor.startUptime, 100)
    check('pm.monitorSummaryEmpty', monitor.summary, null)
    const first = monitor.sample()
    check('pm.monitorFirstElapsed', first.elapsed, 0)
    check('pm.monitorFirstProcessCPU', first.processCPUPercent, 0)
    check('pm.monitorSummaryCount', monitor.summary.sampleCount, 1)

    uptime = 102
    counters = { processNanoseconds: 2_000_000_000n, residentBytes: 200n, systemUsedTicks: 60n, systemTotalTicks: 240n }
    const second = monitor.sample()
    check('pm.monitorSecondElapsed', second.elapsed, 2)
    check('pm.monitorSecondProcessCPU', second.processCPUPercent, 100)
    check('pm.monitorSecondSystemCPU', second.systemCPUPercent, 25)
    check('pm.monitorSecondResident', second.processResidentBytes, 200)
    check('pm.monitorSummaryPeakCPU', monitor.summary.peakProcessCPUPercent, 100)

    // 拿不到计数器时采样缺席，且**不**推进上一帧快照。
    readable = false
    check('pm.monitorMissingCounters', monitor.sample(), null)
    check('pm.monitorSummaryUnchanged', monitor.summary.sampleCount, 2)
    readable = true
    uptime = 104
    counters = { processNanoseconds: 3_000_000_000n, residentBytes: 200n, systemUsedTicks: 90n, systemTotalTicks: 360n }
    const fourth = monitor.sample()
    check('pm.monitorDeltaSpansGap', fourth.processCPUPercent, 50)
    check('pm.monitorSummaryFinal', monitor.summary.sampleCount, 3)

    const snapshot = monitor.summary
    snapshot.sampleCount = 99
    check('pm.monitorSummarySnapshot', monitor.summary.sampleCount, 3)
  }

  // ---------------------------------------------------------------------------
  // CaptureEditorWindows.swift（137 行）
  // ---------------------------------------------------------------------------
  check('cew.identifier', EDITOR_WINDOW_IDENTIFIER, 'cn.laogou.dogsc.editor-window')
  check('cew.registerMatch',
    editorWindowRegistrationIDs(EDITOR_WINDOW_IDENTIFIER, 42).join(','), '42')
  check('cew.registerMismatch',
    editorWindowRegistrationIDs('other-window', 42).length, 0)
  check('cew.registerZero', editorWindowRegistrationIDs(EDITOR_WINDOW_IDENTIFIER, 0).length, 0)
  check('cew.registerNegative', editorWindowRegistrationIDs(EDITOR_WINDOW_IDENTIFIER, -3).length, 0)
  check('cew.registerFraction',
    editorWindowRegistrationIDs(EDITOR_WINDOW_IDENTIFIER, 1.5).length, 0)

  {
    const registry = new CaptureEditorWindowsRegistry()
    check('cew.registryEmpty', registry.windowIDs.length, 0)
    registry.register('other-window', 9)
    check('cew.registryIgnoresMismatch', registry.windowIDs.length, 0)
    registry.register(EDITOR_WINDOW_IDENTIFIER, 7)
    check('cew.registryRegistered', registry.windowIDs.join(','), '7')
    registry.register(EDITOR_WINDOW_IDENTIFIER, 7)
    check('cew.registryStable', registry.windowIDs.join(','), '7')
    registry.register(EDITOR_WINDOW_IDENTIFIER, 8)
    check('cew.registryReplaces', registry.windowIDs.join(','), '8')
    registry.unregister(7)
    check('cew.registryKeepsLatest', registry.windowIDs.join(','), '8')
    registry.unregister(8)
    check('cew.registryCleared', registry.windowIDs.length, 0)
    registry.register(EDITOR_WINDOW_IDENTIFIER, 11)
    check('cew.includes', registry.includes(11), true)
    check('cew.excludes', registry.includes(12), false)
  }

  check('cew.supportsDisplay', captureEditorRefreshSupported('display'), true)
  check('cew.supportsArea', captureEditorRefreshSupported('area'), true)
  check('cew.rejectsWindow', captureEditorRefreshSupported('window'), false)
  check('cew.rejectsDevice', captureEditorRefreshSupported('device'), false)
  check('cew.retryDelays', CAPTURE_EDITOR_REFRESH_RETRY_DELAYS_MS.join(','), '100,250,500,1000,1500')
  check('cew.fallbackDetail', CAPTURE_EDITOR_REFRESH_FALLBACK_DETAIL, '未取得编辑窗口的录制目录')
  check('cew.failureMessage', captureEditorRefreshFailureMessage('超时'), '编辑窗口录制过滤更新失败：超时')

  check('cew.planTaskRunning',
    captureEditorRefreshPlan({ taskRunning: true, runID: 'r', hasRefreshHandler: true, desiredWindowIDs: [1], appliedWindowIDs: [] }), null)
  check('cew.planNoRun',
    captureEditorRefreshPlan({ taskRunning: false, runID: null, hasRefreshHandler: true, desiredWindowIDs: [1], appliedWindowIDs: [] }), null)
  check('cew.planNoHandler',
    captureEditorRefreshPlan({ taskRunning: false, runID: 'r', hasRefreshHandler: false, desiredWindowIDs: [1], appliedWindowIDs: [] }), null)
  check('cew.planNoChange',
    captureEditorRefreshPlan({ taskRunning: false, runID: 'r', hasRefreshHandler: true, desiredWindowIDs: [1], appliedWindowIDs: [1] }), null)
  check('cew.planChange',
    captureEditorRefreshPlan({ taskRunning: false, runID: 'r', hasRefreshHandler: true, desiredWindowIDs: [1], appliedWindowIDs: [] }) !== null, true)

  check('cew.setEqual', windowIDSetEqual([1, 2], [2, 1]), true)
  check('cew.setLengthDiff', windowIDSetEqual([1, 2], [1]), false)
  check('cew.setValueDiff', windowIDSetEqual([1, 2], [1, 3]), false)
  check('cew.setDuplicateCollapse', windowIDSetEqual([1, 1], [1]), false)

  {
    const makeHost = (applied, desired, failRefreshTimes = 0) => {
      const state = { applied: [...applied], calls: 0 }
      return {
        state,
        host: {
          sleep: async () => {},
          refresh: async () => {
            state.calls += 1
            if (state.calls <= failRefreshTimes) throw new Error('boom')
            state.applied = [...desired]
          },
          appliedWindowIDs: () => state.applied,
          desiredWindowIDs: () => desired,
        },
      }
    }

    const settled = makeHost([1], [1])
    const settledOutcome = await runCaptureEditorRefresh(settled.host, 'r')
    check('cew.loopAlreadySettled', settledOutcome.settled, true)
    check('cew.loopAlreadySettledAttempts', settledOutcome.attempts, 0)
    check('cew.loopAlreadySettledCalls', settled.state.calls, 0)

    const once = makeHost([1], [2])
    const onceOutcome = await runCaptureEditorRefresh(once.host, 'r')
    check('cew.loopOneAttempt', onceOutcome.attempts, 1)
    check('cew.loopSettled', onceOutcome.settled, true)
    check('cew.loopApplied', once.state.applied.join(','), '2')

    const failing = makeHost([1], [2], 99)
    const failOutcome = await runCaptureEditorRefresh(failing.host, 'r')
    check('cew.loopFailAttempts', failOutcome.attempts, 5)
    check('cew.loopFailSettled', failOutcome.settled, false)
    check('cew.loopFailError', failOutcome.lastError instanceof Error, true)

    const cancelledHost = {
      sleep: async () => { throw new Error('cancelled') },
      refresh: async () => {},
      appliedWindowIDs: () => [1],
      desiredWindowIDs: () => [2],
    }
    const cancelledOutcome = await runCaptureEditorRefresh(cancelledHost, 'r')
    check('cew.loopCancelled', cancelledOutcome.cancelled, true)
    check('cew.loopCancelledAttempts', cancelledOutcome.attempts, 0)
  }

  {
    const refresh = new CaptureEditorWindowRefresh()
    check('cew.refreshInitiallyIdle', refresh.currentRunID, null)
    check('cew.refreshNoObservation', refresh.observesEditorWindows, false)
    const config = { source: 'display' }
    refresh.start({ runID: 'run1', configuration: config, appliedWindowIDs: [], refresh: async () => {} })
    check('cew.refreshStarted', refresh.currentRunID, 'run1')
    check('cew.refreshObserves', refresh.observesEditorWindows, true)
    check('cew.refreshConfigMatch', refresh.configurationFor('run1') === config, true)
    check('cew.refreshConfigMismatch', refresh.configurationFor('run2'), null)
    check('cew.refreshNeedsUpdate', refresh.needsUpdate(config, [5]), true)
    check('cew.refreshFailureInitiallyNull', refresh.failureMessage, null)
    refresh.didApply([5], config, 'run1', [5])
    check('cew.refreshSettled', refresh.needsUpdate(config, [5]), false)
    refresh.didApply([5], config, 'run2', [5])
    check('cew.refreshIgnoresOtherRun', refresh.needsUpdate(config, [5]), false)
    refresh.stop('run2')
    check('cew.refreshStopMismatch', refresh.currentRunID, 'run1')
    refresh.stop('run1')
    check('cew.refreshStopped', refresh.currentRunID, null)
    check('cew.refreshStoppedObservation', refresh.observesEditorWindows, false)

    const windowOnly = new CaptureEditorWindowRefresh()
    windowOnly.start({ runID: 'run3', configuration: { source: 'window' }, appliedWindowIDs: [], refresh: async () => {} })
    check('cew.refreshWindowSourceNotObserved', windowOnly.observesEditorWindows, false)
  }

  // ---------------------------------------------------------------------------
  // RecordingCompletionTransition.swift（137 行）
  // ---------------------------------------------------------------------------
  check('rct.duration', completionTransitionDuration(false), RECORDING_COMPLETION_DURATION)
  check('rct.durationDefault', RECORDING_COMPLETION_DURATION, 0.32)
  check('rct.durationReduced', completionTransitionDuration(true), RECORDING_COMPLETION_REDUCED_DURATION)
  check('rct.durationReducedValue', RECORDING_COMPLETION_REDUCED_DURATION, 0.14)
  check('rct.cardRadius', RECORDING_COMPLETION_CARD_RADIUS, 28)
  check('rct.progressStart', completionTransitionProgress(0), 0)
  check('rct.progressEnd', completionTransitionProgress(1), 1)
  check('rct.progressQuarter', completionTransitionProgress(0.25), 0.3671875)
  check('rct.progressHalf', completionTransitionProgress(0.5), 0.8125)
  check('rct.progressMonotonic',
    completionTransitionProgress(0.3) < completionTransitionProgress(0.4), true)
  check('rct.progressNoOvershoot', completionTransitionProgress(2), 1)
  check('rct.progressClampNegative', completionTransitionProgress(-1), 0)
  check('rct.geometryReduced', completionTransitionGeometry(0.5, true), 1)
  check('rct.geometryNormal', completionTransitionGeometry(0.5, false), 0.8125)
  check('rct.elapsedClampHigh', completionTransitionElapsed(0, 5, 0.32), 0.32)
  check('rct.elapsedClampLow', completionTransitionElapsed(5, 4, 0.32), 0)
  check('rct.elapsedNormal', completionTransitionElapsed(1, 1.16, 0.32), 0.16)
  check('rct.timeHalf', completionTransitionTime(0.16, 0.32), 0.5)
  check('rct.timeZeroDuration', completionTransitionTime(5, 0), 1)

  {
    const start = { x: 0, y: 0, width: 100, height: 100 }
    const target = { x: 10, y: 20, width: 300, height: 220 }
    const atZero = completionTransitionFrame(start, target, 0)
    check('rct.frameStart', `${atZero.x},${atZero.y},${atZero.width},${atZero.height}`, '0,0,100,100')
    const atOne = completionTransitionFrame(start, target, 1)
    check('rct.frameEnd', `${atOne.x},${atOne.y},${atOne.width},${atOne.height}`, '10,20,300,220')
    const atHalf = completionTransitionFrame(start, target, 0.5)
    check('rct.frameHalf', `${atHalf.x},${atHalf.y},${atHalf.width},${atHalf.height}`, '5,10,200,160')
    check('rct.frameNonFinite', completionTransitionFrame(start, target, NaN).x, 0)
  }

  check('rct.alphaAtZero',
    Object.values(completionTransitionAlphas(0)).join(','), '1,0')
  check('rct.alphaSum', (() => {
    const a = completionTransitionAlphas(0.37)
    return a.outgoing + a.incoming
  })(), 1)

  {
    const start = { x: 0, y: 0, width: 100, height: 100 }
    const target = { x: 0, y: 0, width: 200, height: 200 }
    const mid = completionTransitionFrameAt({
      elapsed: 0.16, duration: 0.32, reducesMotion: false, startFrame: start, targetFrame: target,
    })
    check('rct.frameAtProgress', mid.progress, 0.8125)
    check('rct.frameAtGeometry', mid.geometry, 0.8125)
    check('rct.frameAtWidth', mid.frame.width, 181.25)
    check('rct.frameAtFinished', mid.finished, false)
    const done = completionTransitionFrameAt({
      elapsed: 0.32, duration: 0.32, reducesMotion: false, startFrame: start, targetFrame: target,
    })
    check('rct.frameAtDone', done.finished, true)
    check('rct.frameAtDoneAlpha', done.incomingAlpha, 1)
    const reduced = completionTransitionFrameAt({
      elapsed: 0.05, duration: 0.14, reducesMotion: true, startFrame: start, targetFrame: target,
    })
    check('rct.frameAtReducedGeometry', reduced.geometry, 1)
    check('rct.frameAtReducedWidth', reduced.frame.width, 200)
    check('rct.frameAtReducedAlpha', reduced.incomingAlpha, completionTransitionProgress(0.05 / 0.14))
    const overshoot = completionTransitionFrameAt({
      elapsed: 9, duration: 0.32, reducesMotion: false, startFrame: start, targetFrame: target,
    })
    check('rct.frameAtClamp', overshoot.elapsed, 0.32)
  }

  check('rct.initialOutgoing', COMPLETION_TRANSITION_INITIAL_STATE.outgoingAlpha, 1)
  check('rct.initialIncoming', COMPLETION_TRANSITION_INITIAL_STATE.incomingAlpha, 0)
  check('rct.initialVisible',
    `${COMPLETION_TRANSITION_INITIAL_STATE.outgoingHidden},${COMPLETION_TRANSITION_INITIAL_STATE.incomingHidden}`,
    'false,false')
  check('rct.runLoopModes', COMPLETION_TRANSITION_RUN_LOOP_MODES.join(','), 'common,modalPanel')

  {
    const layout = recordingCompletionCardOrigins({ bounds: { x: 4, y: 6, width: 320, height: 480 } })
    check('rct.layoutBackground',
      `${layout.background.x},${layout.background.y},${layout.background.width},${layout.background.height}`,
      '4,6,320,480')
    check('rct.layoutViewport',
      `${layout.viewport.x},${layout.viewport.y},${layout.viewport.width},${layout.viewport.height}`,
      '4,6,320,480')
    check('rct.layoutResultOrigin',
      `${layout.resultOrigin.x},${layout.resultOrigin.y}`, '0,0')
  }

  // ---------------------------------------------------------------------------
  // AppControlFocusAppearance.swift（141 行）
  // ---------------------------------------------------------------------------
  check('kf.navKeyCodes', APP_KEYBOARD_FOCUS_NAVIGATION_KEY_CODES.join(','), '48,123,124,125,126')
  check('kf.blockingModifiers', APP_KEYBOARD_FOCUS_BLOCKING_MODIFIERS.join(','), 'command,control,option')
  check('kf.environmentDefault', APP_SHOWS_KEYBOARD_FOCUS_DEFAULT, false)
  check('kf.cueLineWidth', APP_KEYBOARD_FOCUS_CUE_LINE_WIDTH, 1.5)
  check('kf.defaultChrome', APP_KEYBOARD_FOCUS_CUE_DEFAULT_CHROME_LEVEL, 0.4)
  check('kf.rootAttribute', APP_CONTROL_FOCUS_ROOT_ATTRIBUTE, 'data-app-focus-root')
  check('kf.tabShows', appKeyboardFocusEventAction({ type: 'keyDown', keyCode: 48 }), 'show')
  check('kf.leftArrowShows', appKeyboardFocusEventAction({ type: 'keyDown', keyCode: 123 }), 'show')
  check('kf.upArrowShows', appKeyboardFocusEventAction({ type: 'keyDown', keyCode: 126 }), 'show')
  check('kf.letterIgnored', appKeyboardFocusEventAction({ type: 'keyDown', keyCode: 0 }), 'ignore')
  check('kf.commandIgnored',
    appKeyboardFocusEventAction({ type: 'keyDown', keyCode: 48, modifiers: ['command'] }), 'ignore')
  check('kf.controlIgnored',
    appKeyboardFocusEventAction({ type: 'keyDown', keyCode: 48, modifiers: ['control'] }), 'ignore')
  check('kf.optionIgnored',
    appKeyboardFocusEventAction({ type: 'keyDown', keyCode: 48, modifiers: ['option'] }), 'ignore')
  check('kf.shiftStillShows',
    appKeyboardFocusEventAction({ type: 'keyDown', keyCode: 48, modifiers: ['shift'] }), 'show')
  check('kf.missingKeyCode',
    appKeyboardFocusEventAction({ type: 'keyDown' }), 'ignore')
  check('kf.mouseDownHides', appKeyboardFocusEventAction({ type: 'leftMouseDown' }), 'hide')
  check('kf.keyUpHides', appKeyboardFocusEventAction({ type: 'keyUp' }), 'hide')

  check('kf.cueVisible',
    keyboardFocusCueVisible({ isEnabled: true, isFocused: true, showsKeyboardFocus: true }), true)
  check('kf.cueHiddenDisabled',
    keyboardFocusCueVisible({ isEnabled: false, isFocused: true, showsKeyboardFocus: true }), false)
  check('kf.cueHiddenUnfocused',
    keyboardFocusCueVisible({ isEnabled: true, isFocused: false, showsKeyboardFocus: true }), false)
  check('kf.cueHiddenNotNavigating',
    keyboardFocusCueVisible({ isEnabled: true, isFocused: true, showsKeyboardFocus: false }), false)
  check('kf.cueExplicitOverridesFalse',
    keyboardFocusCueVisible({ isEnabled: true, isFocused: false, showsKeyboardFocus: true, explicitFocus: true }), true)
  check('kf.cueExplicitOverridesTrue',
    keyboardFocusCueVisible({ isEnabled: true, isFocused: true, showsKeyboardFocus: true, explicitFocus: false }), false)
  check('kf.cueExplicitNullFallsBack',
    keyboardFocusCueVisible({ isEnabled: true, isFocused: true, showsKeyboardFocus: true, explicitFocus: null }), true)
  check('kf.environmentValue', keyboardFocusEnvironmentValue(true), true)

  {
    const visibility = new AppKeyboardFocusVisibility()
    check('kf.acquireNeedsMonitor', visibility.acquire(), true)
    check('kf.acquireSecond', visibility.acquire(), false)
    check('kf.mountedCount', visibility.mountedCount, 2)
    check('kf.releaseNotLast', visibility.release(), false)
    check('kf.stillMonitoring', visibility.isMonitoring, true)
    check('kf.releaseLast', visibility.release(), true)
    check('kf.monitorDetached', visibility.isMonitoring, false)
    check('kf.releaseUnderflow', visibility.release(), false)
    check('kf.releaseClamped', visibility.mountedCount, 0)

    const single = new AppKeyboardFocusVisibility()
    single.acquire()
    check('kf.showsOnTab', single.handle({ type: 'keyDown', keyCode: 48 }), true)
    check('kf.visible', single.isVisible, true)
    check('kf.repeatShowsNoChange', single.handle({ type: 'keyDown', keyCode: 48 }), false)
    check('kf.hidesOnPointer', single.handle({ type: 'leftMouseDown' }), true)
    check('kf.hidden', single.isVisible, false)
    check('kf.ignoredLetter', single.handle({ type: 'keyDown', keyCode: 3 }), false)
  }

  // ---------------------------------------------------------------------------
  // EditorSymbol.swift（142 行）
  // ---------------------------------------------------------------------------
  check('sym.catalogSize', Object.keys(EDITOR_SYMBOL_CATALOG).length, 124)
  check('sym.catalogDistinct', new Set(Object.values(EDITOR_SYMBOL_CATALOG)).size, 77)
  check('sym.scale', EDITOR_SYMBOL_SCALE.join(','), '12,14,16,18,20')
  check('sym.labelDefault', EDITOR_SYMBOL_LABEL_DEFAULT_SIZE, 14)
  check('sym.minusCircle', editorSymbolKind('minus.circle'), 'minus')
  check('sym.squareStack', editorSymbolKind('square.stack'), 'layers')
  check('sym.rectangleStack', editorSymbolKind('rectangle.stack'), 'layers')
  check('sym.linkBadgePlus', editorSymbolKind('link.badge.plus'), 'link')
  check('sym.rectangleFill', editorSymbolKind('rectangle.fill'), 'shapeWide')
  check('sym.squareFill', editorSymbolKind('square.fill'), 'shapeRounded')
  check('sym.timelineSelection', editorSymbolKind('timeline.selection'), 'film')
  check('sym.moonStarsFill', editorSymbolKind('moon.stars.fill'), 'moon')
  check('sym.cursorMotion', editorSymbolKind('cursorarrow.motionlines'), 'cursorMotion')
  check('sym.unknownName', editorSymbolKind('no.such.symbol'), null)
  check('sym.layerOrderFallsBack', editorSymbolKind('square.3.layers.3d.top.filled'), null)
  check('sym.batchKinds',
    editorSymbolKinds(['plus', 'video', 'video.slash', 'nope']).join(','),
    'plus,camera,cameraOff,')
  check('sym.sizeExact', editorSymbolSize(16), 16)
  check('sym.sizeTieDown', editorSymbolSize(13), 12)
  check('sym.sizeTieUp', editorSymbolSize(19), 18)
  check('sym.sizeMid', editorSymbolSize(15), 14)
  check('sym.sizeBelow', editorSymbolSize(2), 12)
  check('sym.sizeAbove', editorSymbolSize(100), 20)
  check('sym.sizeInvalid', editorSymbolSize(NaN), 14)

  // ---------------------------------------------------------------------------
  // AppAboutSettingsView.swift（144 行）
  // ---------------------------------------------------------------------------
  check('about.subtitle', ABOUT_SUBTITLE, '丝滑、优雅的高性能屏幕录制工具')
  check('about.iconSize', ABOUT_HERO_ICON_SIZE, 76)
  check('about.iconShadow', `${ABOUT_HERO_ICON_SHADOW.radius},${ABOUT_HERO_ICON_SHADOW.offsetY}`, '12,6')
  check('about.entryScale', ABOUT_HERO_ENTRY_SCALE, 0.84)
  check('about.entryOffset', ABOUT_HERO_ENTRY_OFFSET_Y, 6)
  check('about.arrivalDelay', ABOUT_HERO_ARRIVAL_DELAY, 0.14)
  check('about.titleSize', ABOUT_TITLE_SIZE, 21)
  check('about.subtitleSize', ABOUT_SUBTITLE_SIZE, 12)
  check('about.versionPillHeight', ABOUT_VERSION_PILL.height, 22)
  check('about.versionPillPadding', ABOUT_VERSION_PILL.horizontalPadding, 10)
  check('about.heroPadding', `${ABOUT_HERO_PADDING.top},${ABOUT_HERO_PADDING.bottom}`, '24,22')
  check('about.tileSpacing', ABOUT_LINK_TILE_SPACING, 8)
  check('about.tileMinHeight', ABOUT_LINK_TILE_METRICS.minHeight, 100)
  check('about.tilePadding', ABOUT_LINK_TILE_METRICS.contentPadding, 12)
  check('about.tilePressScale', ABOUT_LINK_TILE_METRICS.pressScale, 0.97)
  check('about.tileIconSize', ABOUT_LINK_TILE_METRICS.iconSize, 22)
  check('about.hoverOffset', `${ABOUT_LINK_TILE_HOVER_OFFSET.x},${ABOUT_LINK_TILE_HOVER_OFFSET.y}`, '2,-2')
  check('about.updateBarMinHeight', ABOUT_UPDATE_BAR_METRICS.minHeight, 56)
  check('about.updateBarPadding', ABOUT_UPDATE_BAR_METRICS.horizontalPadding, 14)
  check('about.pagePadding', `${ABOUT_PAGE_PADDING.horizontal},${ABOUT_PAGE_PADDING.bottom}`, '6,6')
  check('about.updateTitle', ABOUT_AUTOMATIC_UPDATE_TITLE, '自动检查更新')
  check('about.checkTitle', ABOUT_CHECK_UPDATES_TITLE, '检查更新')
  check('about.checkHint', ABOUT_CHECK_UPDATES_HINT, '从 GitHub Release 检查并安装 DogSC 新版本')
  check('about.sourceURL', APP_PROJECT_LINKS.source, 'https://github.com/laogou717/dogsc')
  check('about.feedbackURL', APP_PROJECT_LINKS.feedback, 'https://github.com/laogou717/dogsc/issues')
  check('about.tileCount', ABOUT_LINK_TILES.length, 3)
  check('about.tileIcons', ABOUT_LINK_TILES.map((t) => t.icon).join(','), 'code,feedback,cup')
  check('about.tileTitles', ABOUT_LINK_TILES.map((t) => t.title).join(','),
    '开源仓库 (GitHub),反馈与建议,自愿赞赏支持')
  check('about.tileTrailing', ABOUT_LINK_TILES.map((t) => t.trailingIcon).join(','), 'external,external,chevron')
  check('about.tileSupportID', ABOUT_LINK_TILES[2].accessibilityIdentifier, 'settings.about.support')
  check('about.tileSupportNoURL', ABOUT_LINK_TILES[2].opensURL, null)

  {
    const pending = aboutHeroArrival({ heroArrived: false, reducesMotion: false })
    check('about.heroPendingScale', pending.scale, 0.84)
    check('about.heroPendingOffset', pending.offsetY, 6)
    const arrived = aboutHeroArrival({ heroArrived: true, reducesMotion: false })
    check('about.heroArrivedScale', arrived.scale, 1)
    check('about.heroArrivedOffset', arrived.offsetY, 0)
    const reduced = aboutHeroArrival({ heroArrived: false, reducesMotion: true })
    check('about.heroReducedScale', reduced.scale, 1)
    check('about.heroReducedOffset', reduced.offsetY, 0)
  }

  {
    const external = aboutLinkTileTrailingOffset({ hovered: true, reducesMotion: false, trailingIcon: 'external' })
    check('about.externalHoverX', external.x, 2)
    check('about.externalHoverY', external.y, -2)
    const chevron = aboutLinkTileTrailingOffset({ hovered: true, reducesMotion: false, trailingIcon: 'chevron' })
    check('about.chevronHoverX', chevron.x, 2)
    check('about.chevronHoverY', chevron.y, 0)
    const idle = aboutLinkTileTrailingOffset({ hovered: false, reducesMotion: false, trailingIcon: 'external' })
    check('about.idleOffset', `${idle.x},${idle.y}`, '0,0')
    const reducedHover = aboutLinkTileTrailingOffset({ hovered: true, reducesMotion: true, trailingIcon: 'external' })
    check('about.reducedHoverOffset', `${reducedHover.x},${reducedHover.y}`, '0,0')
  }

  check('about.a11yFallback', aboutLinkTileAccessibilityIdentifier('反馈与建议', null),
    'settings.about.反馈与建议')
  check('about.a11yExplicit', aboutLinkTileAccessibilityIdentifier('自愿赞赏支持', 'settings.about.support'),
    'settings.about.support')
  check('about.checkEnabled', aboutCheckForUpdatesEnabled({ isFormalRelease: true, isReady: true }), true)
  check('about.checkNotFormal', aboutCheckForUpdatesEnabled({ isFormalRelease: false, isReady: true }), false)
  check('about.checkNotReady', aboutCheckForUpdatesEnabled({ isFormalRelease: true, isReady: false }), false)
  check('about.autoUpdateFormal', aboutAutoUpdateEnabled(true), true)
  check('about.autoUpdateNotFormal', aboutAutoUpdateEnabled(false), false)
  check('about.helpPassthrough', aboutCheckForUpdatesHelp('可以从 GitHub 检查更新'), '可以从 GitHub 检查更新')

  // ---------------------------------------------------------------------------
  // EditorStylePresetStore.swift（146 行）
  // ---------------------------------------------------------------------------
  check('sp.presetKey', EDITOR_STYLE_PRESET_KEY, 'editor-style-presets-v1')
  check('sp.lastUsedKey', EDITOR_LAST_USED_STYLE_KEY, 'editor-last-used-style-v1')
  check('sp.defaultIDKey', EDITOR_DEFAULT_PRESET_ID_KEY, 'editor-scene-preset.default-id')
  check('sp.formatVersion', EDITOR_STYLE_PRESET_FORMAT_VERSION, 2)
  check('sp.lastUsedFormatVersion', EDITOR_LAST_USED_STYLE_FORMAT_VERSION, 1)
  check('sp.lastUsedName', EDITOR_LAST_USED_STYLE_NAME, '上次使用')
  check('sp.cropMissingVersion', editorStylePresetIncludesCrop({ formatVersion: null }), false)
  check('sp.cropV1', editorStylePresetIncludesCrop({ formatVersion: 1 }), false)
  check('sp.cropV2', editorStylePresetIncludesCrop({ formatVersion: 2 }), true)

  const baseProject = projectWith({
    canvas: { crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, backgroundSource: { kind: 'pattern', patternPreset: '黑曜石网格' } },
    camera: { isHidden: true },
    motion: { defaultZoomScale: 1.5 },
  })

  {
    const preset = makeEditorStylePreset({ name: '预设 A', project: baseProject })
    check('sp.makeName', preset.name, '预设 A')
    check('sp.makeIDDefault', preset.id, '')
    check('sp.makeFormatVersion', preset.formatVersion, 2)
    check('sp.makeIncludesBackground', preset.includesBackground, true)
    check('sp.makeZoomScale', preset.motion.defaultZoomScale, 1.5)
    check('sp.makeCameraHidden', preset.camera.isHidden, true)
    check('sp.makeCrop', preset.canvas.crop.width, 0.5)
    const scaled = makeEditorStylePreset({
      name: 'B',
      project: projectWith({ motion: { defaultZoomScale: null } }),
      zoomCreationScale: 2.4,
    })
    check('sp.makeZoomCreationScale', scaled.motion.defaultZoomScale, 2.4)
    const privateBackground = makeEditorStylePreset({
      name: 'C',
      project: projectWith({ canvas: { backgroundSource: { kind: 'projectImage', relativePath: 'a.png' } } }),
    })
    check('sp.makePrivateBackgroundExcluded', privateBackground.includesBackground, false)
  }

  {
    const preset = makeEditorStylePreset({ name: 'V2', project: baseProject })
    preset.canvas.crop = { x: 0, y: 0, width: 1, height: 1 }
    const applied = applyEditorStylePreset({ preset, baseline: baseProject })
    check('sp.applyCropReplaced', applied.canvas.crop.width, 1)
    check('sp.applyCameraHidden', applied.camera.isHidden, true)
    check('sp.applyNoMutation', baseProject.canvas.crop.width, 0.5)

    const legacy = makeEditorStylePreset({ name: 'V1', project: baseProject })
    legacy.formatVersion = 1
    legacy.canvas.crop = { x: 0, y: 0, width: 1, height: 1 }
    legacy.camera.isHidden = false
    const legacyApplied = applyEditorStylePreset({ preset: legacy, baseline: baseProject })
    check('sp.applyLegacyCropKept', legacyApplied.canvas.crop.width, 0.5)
    check('sp.applyLegacyCameraKept', legacyApplied.camera.isHidden, true)
  }

  {
    // 背景三重闸门
    const preset = makeEditorStylePreset({ name: 'BG', project: baseProject })
    preset.canvas.backgroundSource = { kind: 'systemImage', absolutePath: '/nope/a.png' }
    const override = { kind: 'pattern', patternPreset: '极光' }
    const withOverride = applyEditorStylePreset({
      preset, baseline: baseProject, backgroundOverride: override,
    })
    check('sp.applyOverrideWins', withOverride.canvas.backgroundSource.patternPreset, '极光')

    const missing = applyEditorStylePreset({
      preset, baseline: baseProject, fileExists: () => false,
    })
    check('sp.applyMissingKeepsBaseline', missing.canvas.backgroundSource.kind, 'pattern')

    const present = applyEditorStylePreset({
      preset, baseline: baseProject, fileExists: () => true,
    })
    check('sp.applyPresentUsesPreset', present.canvas.backgroundSource.kind, 'systemImage')

    const excluded = makeEditorStylePreset({
      name: 'NB',
      project: projectWith({ canvas: { backgroundSource: { kind: 'projectImage', relativePath: 'a.png' } } }),
    })
    excluded.canvas.backgroundSource = { kind: 'systemImage', absolutePath: '/x.png' }
    const kept = applyEditorStylePreset({ preset: excluded, baseline: baseProject, fileExists: () => true })
    check('sp.applyExcludedKeepsBaseline', kept.canvas.backgroundSource.kind, 'pattern')
  }

  {
    const noScale = makeEditorStylePreset({
      name: 'NS',
      project: projectWith({ motion: { defaultZoomScale: null } }),
    })
    const applied = applyEditorStylePreset({ preset: noScale, baseline: baseProject })
    check('sp.applyZoomScaleInherited', applied.motion.defaultZoomScale, 1.5)

    const noAudio = makeEditorStylePreset({ name: 'NA', project: baseProject })
    noAudio.audio = null
    const noOpening = makeEditorStylePreset({ name: 'NO', project: baseProject })
    noOpening.opening = null
    const baselineAudio = baseProject.audio.systemVolume
    const applied2 = applyEditorStylePreset({ preset: noAudio, baseline: baseProject })
    check('sp.applyAudioKeptWhenNull', applied2.audio.systemVolume, baselineAudio)
    const applied3 = applyEditorStylePreset({ preset: noOpening, baseline: baseProject })
    check('sp.applyOpeningKeptWhenNull', applied3.openingSequence.duration, baseProject.openingSequence.duration)
  }

  {
    const preset = makeEditorStylePreset({ name: 'M', project: baseProject })
    check('sp.matchesSame', editorStylePresetMatchesConfiguration(preset, baseProject), true)
    const changed = projectWith({ canvas: { padding: 20 } })
    check('sp.matchesChanged', editorStylePresetMatchesConfiguration(preset, changed), false)
    // includesBackground / formatVersion 不参与比较
    const shapeOnly = { ...preset, includesBackground: !preset.includesBackground, formatVersion: 1 }
    check('sp.matchesIgnoresBookkeeping', editorStylePresetMatchesConfiguration(shapeOnly, baseProject), true)
  }

  check('sp.availablePattern', editorStylePresetHasAvailableBackground({
    preset: { includesBackground: true, canvas: { backgroundSource: { kind: 'pattern', patternPreset: 'x' } } },
  }), true)
  check('sp.availableProjectImage', editorStylePresetHasAvailableBackground({
    preset: { includesBackground: true, canvas: { backgroundSource: { kind: 'projectImage', relativePath: 'a.png' } } },
  }), false)
  check('sp.availableExcluded', editorStylePresetHasAvailableBackground({
    preset: { includesBackground: false, canvas: { backgroundSource: { kind: 'pattern', patternPreset: 'x' } } },
  }), false)
  check('sp.availableAssetMissing', editorStylePresetHasAvailableBackground({
    preset: { includesBackground: true, canvas: { backgroundSource: { kind: 'pattern', patternPreset: 'x' } }, backgroundAsset: { filename: 'scene-a.png', isVideo: false } },
    assetDirectory: '/assets',
    fileExists: () => false,
  }), false)
  check('sp.availableAssetPresent', editorStylePresetHasAvailableBackground({
    preset: { includesBackground: true, canvas: { backgroundSource: { kind: 'pattern', patternPreset: 'x' } }, backgroundAsset: { filename: 'scene-a.png', isVideo: false } },
    assetDirectory: '/assets',
    fileExists: (path) => path === '/assets/scene-a.png',
  }), true)
  check('sp.availableAssetTraversal', editorStylePresetHasAvailableBackground({
    preset: { includesBackground: true, canvas: { backgroundSource: { kind: 'pattern', patternPreset: 'x' } }, backgroundAsset: { filename: '../a.png', isVideo: false } },
    assetDirectory: '/assets',
    fileExists: () => true,
  }), false)
  check('sp.backgroundProjectVideo',
    editorStylePresetBackgroundIsAvailable({ kind: 'projectVideo', relativePath: 'a.mov' }, () => true), false)
  check('sp.backgroundDynamicFlow',
    editorStylePresetBackgroundIsAvailable({ kind: 'dynamicFlow', dynamicPreset: '星辉漫步点阵' }, () => true), true)
  check('sp.backgroundSystemVideo',
    editorStylePresetBackgroundIsAvailable({ kind: 'systemVideo', absolutePath: '/a.mov' }, (p) => p === '/a.mov'), true)

  {
    const store = new Map()
    const storage = {
      read: (key) => (store.has(key) ? store.get(key) : null),
      write: (key, value) => { if (value === null) store.delete(key); else store.set(key, value) },
    }
    check('sp.loadEmpty', loadEditorStylePresets(storage).length, 0)
    store.set(EDITOR_STYLE_PRESET_KEY, 'not json')
    check('sp.loadCorrupt', loadEditorStylePresets(storage).length, 0)
    store.set(EDITOR_STYLE_PRESET_KEY, '{"a":1}')
    check('sp.loadNonArray', loadEditorStylePresets(storage).length, 0)

    const presets = [makeEditorStylePreset({ name: 'P1', project: baseProject, id: 'id-1' })]
    saveEditorStylePresets(storage, presets)
    const loaded = loadEditorStylePresets(storage)
    check('sp.roundTripCount', loaded.length, 1)
    check('sp.roundTripName', loaded[0].name, 'P1')
    check('sp.roundTripCrop', loaded[0].canvas.crop.width, 0.5)

    check('sp.defaultIDEmpty', readDefaultPresetID(storage), null)
    writeDefaultPresetID(storage, 'id-1')
    check('sp.defaultIDWritten', readDefaultPresetID(storage), 'id-1')
    writeDefaultPresetID(storage, null)
    check('sp.defaultIDCleared', readDefaultPresetID(storage), null)

    const snapshot = rememberLastUsedStyle(storage, baseProject)
    check('sp.rememberFormatVersion', snapshot.formatVersion, 1)
    check('sp.rememberName', snapshot.name, '上次使用')
    check('sp.rememberStored', store.has(EDITOR_LAST_USED_STYLE_KEY), true)

    // 无默认预设时，隐式快照不会带上裁切
    const target = projectWith({ canvas: { crop: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 } } })
    const restored = applyingLastUsedStyle({ storage, project: target })
    check('sp.lastUsedKeepsTargetCrop', restored.canvas.crop.width, 0.3)

    // 有默认预设时按显式预设应用（含裁切）
    writeDefaultPresetID(storage, 'id-1')
    const explicit = applyingLastUsedStyle({ storage, project: target })
    check('sp.defaultPresetCropTravels', explicit.canvas.crop.width, 0.5)

    const empty = new Map()
    const emptyStorage = {
      read: (key) => (empty.has(key) ? empty.get(key) : null),
      write: (key, value) => { if (value === null) empty.delete(key); else empty.set(key, value) },
    }
    const untouched = applyingLastUsedStyle({ storage: emptyStorage, project: target })
    check('sp.noStyleKeepsProject', untouched.canvas.crop.width, 0.3)
    check('sp.noStyleNewObject', untouched !== target, true)

    clearEditorStylePresetStorage(storage)
    check('sp.clearedPresets', store.has(EDITOR_STYLE_PRESET_KEY), false)
    check('sp.clearedLastUsed', store.has(EDITOR_LAST_USED_STYLE_KEY), false)
  }

  check('sp.valueEqualKeyOrder', styleValueEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true)
  check('sp.valueEqualArrayOrder', styleValueEqual([1, 2], [2, 1]), false)
  check('sp.valueEqualNested', styleValueEqual({ a: [{ b: 1 }] }, { a: [{ b: 1 }] }), true)
  check('sp.valueEqualNull', styleValueEqual(null, { a: 1 }), false)
}

await runEditorChromeAndPresetBatch()


async function runHoverAndInputBatch() {
  // ========== 8 文件 / 1480 行：悬浮预览 / 控制台配色 / 波形缓存 / 旋钮输入 /
  //            本地化 / 动作菜单 / 源文件交换 / 设备生命周期
  const {
    // ---- EditorPlaybackHoverPreview.swift
    HOVER_SEEK_TIMESCALE, hoverRenderTick, canStartHoverPreview, hoverPreviewTarget,
    shouldScheduleHoverSeek, hoverPreviewEndPlan, hoverRestoreTarget,
    hoverSeekResultShouldPublish, hoverInFlightCountAfterLanding, EditorHoverPreview,
    // ---- EditorInspectorPalette.swift
    EDITOR_CONSOLE_SCROLL_SPACE, paletteRGB, rgbHex, blendTowardWhite, rgbaString,
    CONSOLE_SOFT_ALPHA, CONSOLE_LIFTED_FILL_FRACTION, vividPalette,
    EDITOR_CONSOLE_PRIMARY, EDITOR_CONSOLE_TRACK_HEX, EDITOR_CONSOLE_TRACK_HUES,
    EDITOR_CONSOLE_TRACKS, EDITOR_CONSOLE_WAVEFORM_INK, consolePaletteForTab,
    consolePaletteForSelection, paletteAdaptiveWash, INSPECTOR_TABS_ORDER,
    // ---- EditorTimelineWaveformCache.swift
    WAVEFORM_CACHE_SCHEMA_VERSION, WAVEFORM_CACHE_ENTRY_LIMIT, WAVEFORM_MAX_SAMPLES,
    WAVEFORM_CACHE_IDENTITY_VERSION, WAVEFORM_CACHE_SUBDIRECTORY,
    waveformCacheEntryLimit, waveformCacheDirectory, waveformSampleIsValid,
    waveformSamplesAreValid, waveformCacheEnvelopeAccepts, waveformCacheIdentityFields,
    waveformCacheIdentity, doubleBitPattern, waveformOverflowEvictionCount,
    waveformOverflowEvictions, waveformCacheEntryEligible, waveformCacheFileName,
    // ---- EditorKnobInput.swift
    KNOB_WHEEL_IDLE_TIMEOUT_MS, KNOB_CURSOR_IDLE, KNOB_CURSOR_ACTIVE, KNOB_INPUT_TRAITS,
    KNOB_TRACKING_OPTIONS, knobInputIsLive, knobHitTestEnabled, knobInputShouldFinish,
    knobPointerAction, knobMouseDownPlan, knobWheelAction, knobWheelShouldBegin,
    knobWheelCompletionIsCurrent, knobWheelEndEmitsEnd, knobFinishPlan,
    // ---- AppLocalization.swift
    APP_SUPPORTED_LANGUAGES, APP_LANGUAGE_FALLBACK, APP_LANGUAGE_DID_CHANGE,
    resolveAppLanguage, appLanguageSnapshot, appLocalizedString, LocalizedStringCache,
    AppLocalizationStore, appLocaleTag, localizeWindowTitle, formatWithArguments,
    // ---- EditorActionMenu.swift
    EDITOR_ACTION_MENU_MIN_WIDTH, EDITOR_ACTION_MENU_MAX_WIDTH,
    EDITOR_ACTION_MENU_WIDTH_SLACK, EDITOR_ACTION_MENU_MAX_CONTENT_HEIGHT,
    EDITOR_ACTION_MENU_INFO_SLACK, EDITOR_ACTION_MENU_ACTION_SLACK,
    EDITOR_ACTION_MENU_ICON_COLUMN, EDITOR_ACTION_MENU_ROW_HEIGHTS,
    EDITOR_ACTION_MENU_SEPARATOR_HEIGHT, EDITOR_ACTION_MENU_LAYOUT,
    EDITOR_ACTION_MENU_BUTTON_RADIUS, editorActionMenuWidth,
    editorActionMenuContentHeight, editorActionRowMinHeight, editorActionRowShowsIcon,
    editorActionRowCheckmarkOpacity, editorActionRowForeground, editorActionRowIsLit,
    editorActionRowFill, EDITOR_ACTION_ROW_SELECTED_FILL, editorActionRowBorderOpacity,
    EDITOR_ACTION_ROW_BORDER_WIDTH, editorActionRowOffset, editorActionRowScale,
    editorActionMenuReturnKeyAction, editorActionMenuPerformPlan,
    editorActionRowAccessibilityTraits, editorActionRowHelpText,
    // ---- ProjectMediaExchange.swift
    PROJECT_MEDIA_EXPORT_BASENAMES, PROJECT_MEDIA_EXPORT_FOLDER_SUFFIX,
    MEDIA_COPY_FALLBACK_EXTENSION, MEDIA_MINIMUM_DURATION, UNTITLED_RECORDING_NAME,
    CAMERA_REPLACEMENT_FOLDER_PREFIX, sanitizedMediaFilename, exportFolderBaseName,
    uniqueExportFolderName, mediaCopyExtension, mediaCopySourceIsReadable,
    mediaInspectionAccepts, cameraReplacementRequirements, cameraReplacementFolderName,
    cameraRelativePath, mediaExchangeErrorMessage, missingMediaFileMessage,
    missingMediaTrackMessage, mediaExportPlan,
    // ---- CaptureDeviceLifecycle.swift
    CAPTURE_DEVICE_OPERATION_DOMAINS, captureDeviceGenerationNext,
    CaptureDeviceGenerationState, CAPTURE_DEVICE_REFRESH_DELAYS_MS,
    captureDeviceRefreshShouldSleep, captureDeviceNotificationAction,
    captureDeviceRefreshPlan, captureDeviceRefreshShouldContinue,
    CAPTURE_DEVICE_CONNECTION_NOTIFICATIONS, CaptureDeviceLifecycle,
  } = m

  // ---------------------------------------------------------------------------
  // EditorPlaybackHoverPreview.swift（147 行）
  // ---------------------------------------------------------------------------
  check('hp.timescale', HOVER_SEEK_TIMESCALE, 60000)
  check('hp.tickNoEndpoints',
    hoverRenderTick({ hasEndpoints: false, mediaGeneration: 1, discontinuityID: 0, hoverPreviewTime: 3, duration: 10, cameraIsAvailable: true }), null)
  check('hp.tickNoPreview',
    hoverRenderTick({ hasEndpoints: true, mediaGeneration: 1, discontinuityID: 0, hoverPreviewTime: null, duration: 10, cameraIsAvailable: true }), null)
  {
    const tick = hoverRenderTick({ hasEndpoints: true, mediaGeneration: 7, discontinuityID: 2, hoverPreviewTime: 12.5, duration: 10, cameraIsAvailable: false })
    check('hp.tickClamped', tick.outputTime, 10)
    check('hp.tickGeneration', tick.mediaGeneration, 7)
    check('hp.tickDiscontinuity', tick.discontinuityID, 2)
    check('hp.tickItemTime', `${tick.itemTime.seconds},${tick.itemTime.timescale}`, '10,60000')
    check('hp.tickCamera', tick.cameraIsAvailable, false)
    check('hp.tickNotPlaying', tick.isPlaying, false)
  }

  check('hp.canStart',
    canStartHoverPreview({ isPlaying: false, scrubIsActive: false, hasPrimaryPlayer: true }), true)
  check('hp.cannotWhilePlaying',
    canStartHoverPreview({ isPlaying: true, scrubIsActive: false, hasPrimaryPlayer: true }), false)
  check('hp.cannotWhileScrubbing',
    canStartHoverPreview({ isPlaying: false, scrubIsActive: true, hasPrimaryPlayer: true }), false)
  check('hp.cannotWithoutPlayer',
    canStartHoverPreview({ isPlaying: false, scrubIsActive: false, hasPrimaryPlayer: false }), false)
  check('hp.targetClampLow', hoverPreviewTarget(-4, 10), 0)
  check('hp.targetClampHigh', hoverPreviewTarget(40, 10), 10)
  check('hp.targetKeep', hoverPreviewTarget(3.5, 10), 3.5)

  check('hp.scheduleOk',
    shouldScheduleHoverSeek({ hoverSeekTaskRunning: false, hoverSeekInFlightCount: 0, isPlaying: false, scrubIsActive: false }), true)
  check('hp.scheduleTaskRunning',
    shouldScheduleHoverSeek({ hoverSeekTaskRunning: true, hoverSeekInFlightCount: 0, isPlaying: false, scrubIsActive: false }), false)
  check('hp.scheduleInFlight',
    shouldScheduleHoverSeek({ hoverSeekTaskRunning: false, hoverSeekInFlightCount: 1, isPlaying: false, scrubIsActive: false }), false)
  check('hp.schedulePlaying',
    shouldScheduleHoverSeek({ hoverSeekTaskRunning: false, hoverSeekInFlightCount: 0, isPlaying: true, scrubIsActive: false }), false)

  {
    const idle = hoverPreviewEndPlan({ hoverPreviewTime: null, hoverSeekInFlightCount: 0, hoverSeekTaskRunning: false, coalescerPendingTarget: null, hasPrimaryPlayer: true, restoreTransport: true })
    check('hp.endIdleInvalidate', idle.shouldInvalidate, false)

    const previewing = hoverPreviewEndPlan({ hoverPreviewTime: 4, hoverSeekInFlightCount: 0, hoverSeekTaskRunning: false, coalescerPendingTarget: null, hasPrimaryPlayer: true, restoreTransport: true })
    check('hp.endPreviewInvalidate', previewing.shouldInvalidate, true)
    check('hp.endPreviewWasPreviewing', previewing.wasPreviewing, true)
    check('hp.endPreviewNeedsRestore', previewing.needsTransportRestore, true)
    check('hp.endPreviewRestores', previewing.shouldRestoreTransport, true)

    const handoff = hoverPreviewEndPlan({ hoverPreviewTime: 4, hoverSeekInFlightCount: 0, hoverSeekTaskRunning: false, coalescerPendingTarget: null, hasPrimaryPlayer: true, restoreTransport: false })
    check('hp.endHandoffInvalidate', handoff.shouldInvalidate, true)
    check('hp.endHandoffNoRestore', handoff.shouldRestoreTransport, false)

    const inFlightOnly = hoverPreviewEndPlan({ hoverPreviewTime: null, hoverSeekInFlightCount: 2, hoverSeekTaskRunning: false, coalescerPendingTarget: null, hasPrimaryPlayer: true, restoreTransport: true })
    check('hp.endInFlightOnlyNotPreviewing', inFlightOnly.wasPreviewing, false)
    check('hp.endInFlightOnlyRestores', inFlightOnly.shouldRestoreTransport, true)

    const scheduledOnly = hoverPreviewEndPlan({ hoverPreviewTime: null, hoverSeekInFlightCount: 0, hoverSeekTaskRunning: true, coalescerPendingTarget: 5, hasPrimaryPlayer: true, restoreTransport: true })
    check('hp.endScheduledInvalidate', scheduledOnly.shouldInvalidate, true)
    check('hp.endScheduledNoRestore', scheduledOnly.shouldRestoreTransport, false)

    const noPlayer = hoverPreviewEndPlan({ hoverPreviewTime: 4, hoverSeekInFlightCount: 0, hoverSeekTaskRunning: false, coalescerPendingTarget: null, hasPrimaryPlayer: false, restoreTransport: true })
    check('hp.endNoPlayerNeedsRestore', noPlayer.needsTransportRestore, true)
    check('hp.endNoPlayerNoSeek', noPlayer.shouldRestoreTransport, false)
  }

  check('hp.publishOk',
    hoverSeekResultShouldPublish({ belongsToCurrentHoverSession: true, seekTokenMatches: true, generationMatches: true, finished: true }), true)
  check('hp.publishOtherSession',
    hoverSeekResultShouldPublish({ belongsToCurrentHoverSession: false, seekTokenMatches: true, generationMatches: true, finished: true }), false)
  check('hp.publishStaleToken',
    hoverSeekResultShouldPublish({ belongsToCurrentHoverSession: true, seekTokenMatches: false, generationMatches: true, finished: true }), false)
  check('hp.publishStaleGeneration',
    hoverSeekResultShouldPublish({ belongsToCurrentHoverSession: true, seekTokenMatches: true, generationMatches: false, finished: true }), false)
  check('hp.publishUnfinished',
    hoverSeekResultShouldPublish({ belongsToCurrentHoverSession: true, seekTokenMatches: true, generationMatches: true, finished: false }), false)
  check('hp.inFlightDecrement', hoverInFlightCountAfterLanding(2, true), 1)
  check('hp.inFlightFloor', hoverInFlightCountAfterLanding(0, true), 0)
  check('hp.inFlightIgnoredForOtherSession', hoverInFlightCountAfterLanding(2, false), 2)
  check('hp.restoreClampLow', hoverRestoreTarget(-1, 10), 0)
  check('hp.restoreClampHigh', hoverRestoreTarget(20, 10), 10)
  check('hp.restoreKeep', hoverRestoreTarget(4, 10), 4)

  {
    const host = {
      playing: false,
      scrubbing: false,
      duration: 10,
      isPlaying() { return this.playing },
      scrubIsActive() { return this.scrubbing },
      duration() { return this.duration },
      outputTime() { return 0 },
      cancelPendingSeeks() {},
      seekTransport: async () => true,
    }
    const hover = new EditorHoverPreview()
    check('hp.machineInitialTime', hover.hoverPreviewTime, null)
    check('hp.machineRequestWhilePlaying', (() => { host.playing = true; const ok = hover.request(2, 10, host); host.playing = false; return ok })(), false)
    check('hp.machineRequestOk', hover.request(2, 10, host), true)
    check('hp.machinePending', hover.pendingHoverTarget, 2)
    check('hp.machinePendingClamped', (() => { hover.request(20, 10, host); return hover.pendingHoverTarget })(), 10)
    check('hp.machineTakePending', hover.takePending(), 10)
    check('hp.machineTakePendingClears', hover.pendingHoverTarget, null)
    const generation = hover.beginSeek()
    check('hp.machineInFlight', hover.inFlightCount, 1)
    check('hp.machineLandMatch', hover.land(generation), 0)
    check('hp.machineLandOtherSession', (() => { hover.beginSeek(); return hover.land(generation + 99) })(), 1)
    hover.publish(3)
    check('hp.machinePublished', hover.hoverPreviewTime, 3)
    const plan = hover.end(true, host)
    check('hp.machineEndPlanInvalidate', plan.shouldInvalidate, true)
    check('hp.machineEndCleared', hover.hoverPreviewTime, null)
    check('hp.machineEndInFlight', hover.inFlightCount, 0)
    check('hp.machineEndGeneration', hover.hoverGeneration, 1)
  }

  // ---------------------------------------------------------------------------
  // EditorInspectorPalette.swift（149 行）
  // ---------------------------------------------------------------------------
  check('pal.scrollSpace', EDITOR_CONSOLE_SCROLL_SPACE, 'inspector.scroll')
  check('pal.tabOrder', INSPECTOR_TABS_ORDER.join(','), 'frame,opening,zoom,cursor,camera,audio')
  {
    const rgb = paletteRGB(0xb5e655)
    check('pal.rgbRed', rgb.r, 181 / 255)
    check('pal.rgbGreen', rgb.g, 230 / 255)
    check('pal.rgbBlue', rgb.b, 85 / 255)
    check('pal.rgbRoundTrip', rgbHex(rgb), '#b5e655')
    check('pal.rgbBlack', rgbHex(paletteRGB(0x000000)), '#000000')
    check('pal.rgbWhite', rgbHex(paletteRGB(0xffffff)), '#ffffff')
  }
  check('pal.liftFraction', CONSOLE_LIFTED_FILL_FRACTION, 0.38)
  {
    const lifted = blendTowardWhite({ r: 0, g: 0, b: 0 }, 0.38)
    check('pal.liftBlack', lifted.r, 0.38)
    const untouched = blendTowardWhite({ r: 1, g: 1, b: 1 }, 0.38)
    check('pal.liftWhite', untouched.r, 1)
    const clamped = blendTowardWhite({ r: 0.5, g: 0.5, b: 0.5 }, 5)
    check('pal.liftClamp', clamped.r, 1)
  }
  check('pal.softAlphaLight', CONSOLE_SOFT_ALPHA.light, 0.24)
  check('pal.softAlphaDark', CONSOLE_SOFT_ALPHA.dark, 0.2)
  check('pal.rgbaLight', rgbaString({ r: 181 / 255, g: 230 / 255, b: 85 / 255 }, 0.24),
    'rgba(181, 230, 85, 0.24)')
  check('pal.rgbaDark', rgbaString({ r: 181 / 255, g: 230 / 255, b: 85 / 255 }, 0.2),
    'rgba(181, 230, 85, 0.2)')

  {
    const zoom = EDITOR_CONSOLE_TRACKS.zoom
    check('pal.zoomFill', zoom.fill, '#b5e655')
    check('pal.zoomStrokeLight', zoom.stroke.light, '#5a9e1c')
    check('pal.zoomStrokeDark', zoom.stroke.dark, '#b5e655')
    check('pal.zoomInk', zoom.ink, '#223400')
    check('pal.zoomTextLight', zoom.text.light, '#2f5a05')
    check('pal.zoomTextDark', zoom.text.dark, '#b5e655')
    check('pal.zoomSoftLight', zoom.soft.light, 'rgba(181, 230, 85, 0.24)')
    check('pal.zoomSoftDark', zoom.soft.dark, 'rgba(181, 230, 85, 0.2)')
    check('pal.zoomSoftInkLight', zoom.softInk.light, '#223400')
    check('pal.zoomSoftInkLifted', zoom.softInk.dark !== zoom.fill, true)
  }

  check('pal.trackHexOrder', Object.keys(EDITOR_CONSOLE_TRACK_HEX).join(','),
    'zoom,screenMotion,cameraMotion,overlay,cameraSync')
  check('pal.trackHues', Object.values(EDITOR_CONSOLE_TRACK_HUES).join(','), '80,45,18,172,340')
  check('pal.screenMotionFill', EDITOR_CONSOLE_TRACKS.screenMotion.fill, '#f7c548')
  check('pal.cameraMotionFill', EDITOR_CONSOLE_TRACKS.cameraMotion.fill, '#ff8a5c')
  check('pal.overlayFill', EDITOR_CONSOLE_TRACKS.overlay.fill, '#45cbb8')
  check('pal.cameraSyncFill', EDITOR_CONSOLE_TRACKS.cameraSync.fill, '#f27e9f')
  check('pal.vividMatchesTable',
    vividPalette(EDITOR_CONSOLE_TRACK_HEX.zoom).fill, EDITOR_CONSOLE_TRACKS.zoom.fill)

  check('pal.primaryIsShared',
    consolePaletteForTab('zoom') === EDITOR_CONSOLE_PRIMARY, true)
  check('pal.allTabsPrimary',
    INSPECTOR_TABS_ORDER.every((tab) => consolePaletteForTab(tab) === EDITOR_CONSOLE_PRIMARY), true)
  check('pal.selectionZoom', consolePaletteForSelection('zoom') === EDITOR_CONSOLE_TRACKS.zoom, true)
  check('pal.selectionZoomTrack', consolePaletteForSelection('zoomTrack') === EDITOR_CONSOLE_TRACKS.zoom, true)
  check('pal.selectionScreenMotion',
    consolePaletteForSelection('screenMotion') === EDITOR_CONSOLE_TRACKS.screenMotion, true)
  check('pal.selectionCameraMotion',
    consolePaletteForSelection('cameraMotion') === EDITOR_CONSOLE_TRACKS.cameraMotion, true)
  check('pal.selectionMosaic',
    consolePaletteForSelection('mosaic') === EDITOR_CONSOLE_TRACKS.overlay, true)
  check('pal.selectionSticker',
    consolePaletteForSelection('sticker') === EDITOR_CONSOLE_TRACKS.overlay, true)
  check('pal.selectionCanvas', consolePaletteForSelection('canvas') === EDITOR_CONSOLE_PRIMARY, true)
  check('pal.selectionNull', consolePaletteForSelection(null) === EDITOR_CONSOLE_PRIMARY, true)
  check('pal.waveformInkLight', EDITOR_CONSOLE_WAVEFORM_INK.lightAlpha, 0.34)
  check('pal.waveformInkDark', EDITOR_CONSOLE_WAVEFORM_INK.darkAlpha, 0.4)
  {
    const wash = paletteAdaptiveWash(EDITOR_CONSOLE_TRACKS.zoom, 0.5, 0.3)
    check('pal.washLight', wash.light, 'rgba(181, 230, 85, 0.5)')
    check('pal.washDark', wash.dark, 'rgba(181, 230, 85, 0.3)')
  }

  // ---------------------------------------------------------------------------
  // EditorTimelineWaveformCache.swift（149 行）
  // ---------------------------------------------------------------------------
  check('wfc.schemaVersion', WAVEFORM_CACHE_SCHEMA_VERSION, 2)
  check('wfc.entryLimit', WAVEFORM_CACHE_ENTRY_LIMIT, 24)
  check('wfc.maxSamples', WAVEFORM_MAX_SAMPLES, 6000)
  check('wfc.identityVersion', WAVEFORM_CACHE_IDENTITY_VERSION, 'waveform-v1')
  check('wfc.subdirectory', WAVEFORM_CACHE_SUBDIRECTORY, 'cn.laogou.dogsc/Waveforms')
  check('wfc.dirJoin', waveformCacheDirectory('/root'), '/root/cn.laogou.dogsc/Waveforms')
  check('wfc.dirTrailingSlash', waveformCacheDirectory('/root/'), '/root/cn.laogou.dogsc/Waveforms')
  check('wfc.limitFloor', waveformCacheEntryLimit(0), 1)
  check('wfc.limitNegative', waveformCacheEntryLimit(-3), 1)
  check('wfc.limitKeep', waveformCacheEntryLimit(24), 24)
  check('wfc.sampleZero', waveformSampleIsValid(0), true)
  check('wfc.sampleOne', waveformSampleIsValid(1), true)
  check('wfc.sampleNegative', waveformSampleIsValid(-0.01), false)
  check('wfc.sampleAbove', waveformSampleIsValid(1.01), false)
  check('wfc.sampleNaN', waveformSampleIsValid(Number.NaN), false)
  check('wfc.samplesValid', waveformSamplesAreValid([0, 0.5, 1], 3), true)
  check('wfc.samplesCountMismatch', waveformSamplesAreValid([0, 0.5], 3), false)
  check('wfc.samplesBadValue', waveformSamplesAreValid([0, 2, 1], 3), false)

  check('wfc.envelopeNull', waveformCacheEnvelopeAccepts(null, 3), false)
  check('wfc.envelopeVersionMismatch',
    waveformCacheEnvelopeAccepts({ schemaVersion: 1, samples: [0, 0, 0] }, 3), false)
  check('wfc.envelopeOk',
    waveformCacheEnvelopeAccepts({ schemaVersion: 2, samples: [0, 0.5, 1] }, 3), true)
  check('wfc.envelopeCountMismatch',
    waveformCacheEnvelopeAccepts({ schemaVersion: 2, samples: [0, 1] }, 3), false)

  {
    const version = {
      standardizedPath: '/media/screen.mov',
      fileSystemNumber: 12345,
      fileNumber: 678,
      fileSize: 99_000_000,
      modificationDate: 700_000_000.25,
    }
    const range = { start: 1.5, end: 11.5 }
    const fields = waveformCacheIdentityFields({ version, sourceRange: range, sampleCount: 6000 })
    check('wfc.fieldCount', fields.length, 9)
    check('wfc.fieldPrefix', fields[0], 'waveform-v1')
    check('wfc.fieldPath', fields[1], '/media/screen.mov')
    check('wfc.fieldFileSystem', fields[2], '12345')
    check('wfc.fieldFileNumber', fields[3], '678')
    check('wfc.fieldFileSize', fields[4], '99000000')
    check('wfc.fieldModification', fields[5], '700000000.25')
    check('wfc.fieldStart', fields[6], '1.5')
    check('wfc.fieldDuration', fields[7], '10')
    check('wfc.fieldSampleCount', fields[8], '6000')
    check('wfc.identitySeparator', waveformCacheIdentity({ version, sourceRange: range, sampleCount: 6000 }).split('\u0000').length, 9)

    const missing = waveformCacheIdentityFields({
      version: { standardizedPath: '/a.mov', fileSystemNumber: null, fileNumber: null, fileSize: null, modificationDate: null },
      sourceRange: { start: 0, end: 1 },
      sampleCount: 10,
    })
    check('wfc.fieldPlaceholders', missing.slice(2, 6).join(','), '-,-,-,-')

    // 时长相同但区间不同的两段必须得到不同的键
    const a = waveformCacheIdentity({ version, sourceRange: { start: 0, end: 10 }, sampleCount: 100 })
    const b = waveformCacheIdentity({ version, sourceRange: { start: 5, end: 15 }, sampleCount: 100 })
    check('wfc.identityDistinguishesOffset', a !== b, true)
    const sameA = waveformCacheIdentity({ version, sourceRange: { start: 0, end: 10 }, sampleCount: 100 })
    check('wfc.identityStable', a === sameA, true)
  }

  check('wfc.bitPatternZero', doubleBitPattern(0), '0')
  check('wfc.bitPatternNegativeZero', doubleBitPattern(-0), '-0')
  check('wfc.bitPatternNaN', doubleBitPattern(Number.NaN), 'nan')
  check('wfc.bitPatternValue', doubleBitPattern(1.25), '1.25')

  check('wfc.evictionNone', waveformOverflowEvictionCount(24, 24), 0)
  check('wfc.evictionSome', waveformOverflowEvictionCount(30, 24), 6)
  check('wfc.evictionLimitFloor', waveformOverflowEvictionCount(5, 0), 4)
  {
    const evicted = waveformOverflowEvictions([
      { name: 'b.plist', modifiedAt: 20 },
      { name: 'a.plist', modifiedAt: 10 },
      { name: 'c.plist', modifiedAt: 30 },
    ], 2)
    check('wfc.evictOldestFirst', evicted.join(','), 'a.plist')
  }
  check('wfc.entryEligible', waveformCacheEntryEligible({ pathExtension: 'plist', isRegularFile: true }), true)
  check('wfc.entryDirectory', waveformCacheEntryEligible({ pathExtension: 'plist', isRegularFile: false }), false)
  check('wfc.entryOtherExtension', waveformCacheEntryEligible({ pathExtension: 'json', isRegularFile: true }), false)
  check('wfc.fileName', waveformCacheFileName('abc'), 'abc.plist')

  // ---------------------------------------------------------------------------
  // EditorKnobInput.swift（153 行）
  // ---------------------------------------------------------------------------
  check('ki.idleTimeout', KNOB_WHEEL_IDLE_TIMEOUT_MS, 220)
  check('ki.idleCursor', KNOB_CURSOR_IDLE, 'openHand')
  check('ki.activeCursor', KNOB_CURSOR_ACTIVE, 'closedHand')
  check('ki.traits', `${KNOB_INPUT_TRAITS.isFlipped},${KNOB_INPUT_TRAITS.mouseDownCanMoveWindow},${KNOB_INPUT_TRAITS.acceptsFirstMouse}`,
    'true,false,true')
  check('ki.trackingOptions', KNOB_TRACKING_OPTIONS.join(','),
    'mouseEnteredAndExited,activeInKeyWindow,inVisibleRect')
  check('ki.liveEnabled', knobInputIsLive(true), true)
  check('ki.liveDisabled', knobInputIsLive(false), false)
  check('ki.hitTestEnabled', knobHitTestEnabled(true), true)
  check('ki.hitTestDisabled', knobHitTestEnabled(false), false)
  check('ki.finishNoWindow', knobInputShouldFinish({ hasWindow: false, windowResignedKey: false }), true)
  check('ki.finishResignedKey', knobInputShouldFinish({ hasWindow: true, windowResignedKey: true }), true)
  check('ki.finishStay', knobInputShouldFinish({ hasWindow: true, windowResignedKey: false }), false)

  check('ki.pointerHoverIn', knobPointerAction({ event: 'entered', rotating: false }), 'hoverIn')
  check('ki.pointerHoverOut', knobPointerAction({ event: 'exited', rotating: false }), 'hoverOut')
  check('ki.pointerDragged', knobPointerAction({ event: 'dragged', rotating: true }), 'dragChange')
  check('ki.pointerDraggedIdle', knobPointerAction({ event: 'dragged', rotating: false }), 'ignore')
  check('ki.pointerUp', knobPointerAction({ event: 'up', rotating: true }), 'dragEnd')
  check('ki.pointerUpIdle', knobPointerAction({ event: 'up', rotating: false }), 'ignore')
  check('ki.mouseDownBegin', knobMouseDownPlan({ isEnabled: true, dragBeginAccepted: true }).beginDrag, true)
  check('ki.mouseDownRejected', knobMouseDownPlan({ isEnabled: true, dragBeginAccepted: false }).beginDrag, false)
  check('ki.mouseDownDisabled', knobMouseDownPlan({ isEnabled: false, dragBeginAccepted: true }).beginDrag, false)
  check('ki.mouseDownAlwaysFinishesWheel', knobMouseDownPlan({ isEnabled: false, dragBeginAccepted: false }).finishWheel, true)

  {
    const base = {
      isEnabled: true, isKeyWindow: true, rotating: false, hasCommandModifier: false,
      momentumPhaseEmpty: true, phaseEndedOrCancelled: false,
      vertical: -40, horizontal: 0, precise: true, inverted: false, fine: false,
      scrolling: false, wheelBeginAccepted: true,
    }
    check('ki.wheelBegin', knobWheelAction(base).kind, 'begin')
    check('ki.wheelChange', knobWheelAction({ ...base, scrolling: true }).kind, 'change')
    check('ki.wheelBeginRejected', knobWheelAction({ ...base, wheelBeginAccepted: false }).kind, 'passThrough')
    check('ki.wheelDisabled', knobWheelAction({ ...base, isEnabled: false }).kind, 'passThrough')
    check('ki.wheelNotKeyWindow', knobWheelAction({ ...base, isKeyWindow: false }).kind, 'passThrough')
    check('ki.wheelRotating', knobWheelAction({ ...base, rotating: true }).kind, 'passThrough')
    check('ki.wheelCommand', knobWheelAction({ ...base, hasCommandModifier: true }).kind, 'passThrough')
    check('ki.wheelMomentum', knobWheelAction({ ...base, momentumPhaseEmpty: false }).kind, 'finishWheel')
    check('ki.wheelPhaseEnded', knobWheelAction({ ...base, phaseEndedOrCancelled: true }).kind, 'finishWheel')
    check('ki.wheelHorizontalOnly', knobWheelAction({ ...base, vertical: 0, horizontal: 40 }).kind, 'passThrough')
    check('ki.wheelInvertedFlips', (() => {
      const forward = knobWheelAction({ ...base, vertical: -40 })
      const inverted = knobWheelAction({ ...base, vertical: -40, inverted: true })
      return forward.delta * inverted.delta < 0
    })(), true)
  }

  check('ki.wheelShouldBegin', knobWheelShouldBegin({ scrolling: false, wheelBeginAccepted: true }), true)
  check('ki.wheelShouldBeginAlready', knobWheelShouldBegin({ scrolling: true, wheelBeginAccepted: true }), false)
  check('ki.wheelShouldBeginRejected', knobWheelShouldBegin({ scrolling: false, wheelBeginAccepted: false }), false)
  check('ki.completionCurrent', knobWheelCompletionIsCurrent(3, 3), true)
  check('ki.completionStale', knobWheelCompletionIsCurrent(4, 3), false)
  check('ki.wheelEndEmits', knobWheelEndEmitsEnd(true), true)
  check('ki.wheelEndSilent', knobWheelEndEmitsEnd(false), false)
  {
    const plan = knobFinishPlan({ scrolling: true, rotating: true })
    check('ki.finishPlan', `${plan.finishWheel},${plan.endDrag},${plan.setHoverOut},${plan.invalidateCursorRects}`,
      'true,true,true,true')
    const idle = knobFinishPlan({ scrolling: false, rotating: false })
    check('ki.finishPlanIdle', `${idle.finishWheel},${idle.endDrag},${idle.setHoverOut}`,
      'false,false,true')
  }

  // ---------------------------------------------------------------------------
  // AppLocalization.swift（159 行）
  // ---------------------------------------------------------------------------
  check('loc.supported', APP_SUPPORTED_LANGUAGES.join(','), 'en,zh-Hans')
  check('loc.fallback', APP_LANGUAGE_FALLBACK, 'en')
  check('loc.notification', APP_LANGUAGE_DID_CHANGE, 'cn.laogou.dogsc.language.changed')
  check('loc.resolveZh',
    resolveAppLanguage({ preferenceLanguages: ['zh-Hans'], systemLanguages: [] }), 'zh-Hans')
  check('loc.resolveZhHant',
    resolveAppLanguage({ preferenceLanguages: ['zh-Hant'], systemLanguages: [] }), 'zh-Hans')
  check('loc.resolveEnUS',
    resolveAppLanguage({ preferenceLanguages: ['en-US'], systemLanguages: [] }), 'en')
  check('loc.resolveUnknown',
    resolveAppLanguage({ preferenceLanguages: ['fr-FR'], systemLanguages: [] }), 'en')
  check('loc.resolveFallsBackToSystem',
    resolveAppLanguage({ preferenceLanguages: null, systemLanguages: ['zh-Hans'] }), 'zh-Hans')
  check('loc.resolvePreferenceWins',
    resolveAppLanguage({ preferenceLanguages: ['en'], systemLanguages: ['zh-Hans'] }), 'en')
  check('loc.resolveEmpty',
    resolveAppLanguage({ preferenceLanguages: [], systemLanguages: ['en'] }), 'en')
  check('loc.snapshot', appLanguageSnapshot('zh-Hans').locale, 'zh-Hans')
  check('loc.localeTag', appLocaleTag(appLanguageSnapshot('en')), 'en')
  check('loc.localizedHit', appLocalizedString('确定', { 确定: 'OK' }), 'OK')
  check('loc.localizedMiss', appLocalizedString('确定', {}), '确定')

  {
    const cache = new LocalizedStringCache()
    let calls = 0
    const first = cache.string('k', () => { calls += 1; return 'v' })
    const second = cache.string('k', () => { calls += 1; return 'v2' })
    check('loc.cacheFirst', first, 'v')
    check('loc.cacheSecond', second, 'v')
    check('loc.cacheResolveOnce', calls, 1)
    check('loc.cacheSize', cache.size, 1)
    cache.reset()
    check('loc.cacheReset', cache.size, 0)
  }

  {
    const store = new AppLocalizationStore({ identifier: 'en', table: { 打开: 'Open' } })
    check('loc.storeInitial', store.language.identifier, 'en')
    check('loc.storeTranslate', store.localizedString('打开'), 'Open')
    check('loc.storeMissingKey', store.localizedString('关闭'), '关闭')
    check('loc.storeApplySame', store.apply('en'), false)
    check('loc.storeApplyNew', store.apply('zh-Hans'), true)
    check('loc.storeSwitched', store.language.identifier, 'zh-Hans')
    check('loc.storeLocale', store.locale, 'zh-Hans')
  }

  check('loc.formatSingle', formatWithArguments('%d 项已导出', []), '%d 项已导出')
  check('loc.formatOne', formatWithArguments('已导出 %d 项', []), '已导出 %d 项')
  check('loc.formatTwo', formatWithArguments('%@ / %@', ['a', 'b']), 'a / b')
  check('loc.formatMissingArgument', formatWithArguments('%@ %@', ['a']), 'a %@')
  check('loc.titleNoPrefix', localizeWindowTitle({ key: '设置', prefix: null, arguments: [], translate: (k) => k }), '设置')
  check('loc.titleWithPrefix',
    localizeWindowTitle({ key: '设置', prefix: 'DogSC', arguments: [], translate: (k) => k }), 'DogSC 设置')
  check('loc.titleWithArguments',
    localizeWindowTitle({ key: '导出 %@', prefix: null, arguments: ['项目 A'], translate: (k) => k }),
    '导出 项目 A')

  // ---------------------------------------------------------------------------
  // EditorActionMenu.swift（159 行）
  // ---------------------------------------------------------------------------
  check('am.minWidth', EDITOR_ACTION_MENU_MIN_WIDTH, 270)
  check('am.maxWidth', EDITOR_ACTION_MENU_MAX_WIDTH, 360)
  check('am.widthSlack', EDITOR_ACTION_MENU_WIDTH_SLACK, 2)
  check('am.maxContentHeight', EDITOR_ACTION_MENU_MAX_CONTENT_HEIGHT, 360)
  check('am.infoSlack', EDITOR_ACTION_MENU_INFO_SLACK, 36)
  check('am.actionSlack', EDITOR_ACTION_MENU_ACTION_SLACK, 88)
  check('am.iconColumn', EDITOR_ACTION_MENU_ICON_COLUMN, 34)
  check('am.rowHeights',
    `${EDITOR_ACTION_MENU_ROW_HEIGHTS.separator},${EDITOR_ACTION_MENU_ROW_HEIGHTS.info},${EDITOR_ACTION_MENU_ROW_HEIGHTS.actionCompact},${EDITOR_ACTION_MENU_ROW_HEIGHTS.actionWithDetail}`,
    '15,40,40,56')
  check('am.separatorHeight', EDITOR_ACTION_MENU_SEPARATOR_HEIGHT, 6)
  check('am.buttonRadius', EDITOR_ACTION_MENU_BUTTON_RADIUS, 'capsule')
  check('am.layoutGaps', `${EDITOR_ACTION_MENU_LAYOUT.outerSpacing},${EDITOR_ACTION_MENU_LAYOUT.rowSpacing},${EDITOR_ACTION_MENU_LAYOUT.cardPadding}`,
    '4,4,8')
  check('am.rowPadding', EDITOR_ACTION_MENU_LAYOUT.rowHorizontalPadding, 12)
  check('am.iconTile', `${EDITOR_ACTION_MENU_LAYOUT.iconTileSize},${EDITOR_ACTION_MENU_LAYOUT.iconGlyphSize}`,
    '30,15')

  const measure = (text) => text.length * 7
  check('am.widthMin', editorActionMenuWidth([{ kind: 'info', title: 'info' }], measure), 270)
  check('am.widthMiddle',
    editorActionMenuWidth([{ kind: 'action', title: 'x'.repeat(30) }], measure), 300)
  check('am.widthCapped',
    editorActionMenuWidth([{ kind: 'action', title: 'x'.repeat(45) }], measure), 360)
  check('am.widthWithIcon',
    editorActionMenuWidth([{ kind: 'action', title: 'x'.repeat(30), systemImage: 'plus' }], measure), 334)
  check('am.widthDetailDominates',
    editorActionMenuWidth([{ kind: 'action', title: 'x'.repeat(5), detail: 'y'.repeat(30) }], measure), 300)
  check('am.widthSeparatorOnly',
    editorActionMenuWidth([{ kind: 'separator', title: '' }], measure), 270)
  check('am.widthEmpty', editorActionMenuWidth([], measure), 270)
  check('am.widthInfoWins',
    editorActionMenuWidth([
      { kind: 'info', title: 'x'.repeat(40) },
      { kind: 'action', title: 'y'.repeat(10) },
    ], measure), 318)

  check('am.heightMixed', editorActionMenuContentHeight([
    { kind: 'separator', title: '' },
    { kind: 'info', title: 'i' },
    { kind: 'action', title: 'a' },
    { kind: 'action', title: 'b', detail: 'd' },
  ]), 151)
  check('am.heightCapped', editorActionMenuContentHeight(
    Array.from({ length: 10 }, (_, i) => ({ kind: 'action', title: `a${i}`, detail: 'd' }))
  ), 360)
  check('am.heightEmpty', editorActionMenuContentHeight([]), 0)

  check('am.rowMinHeightCompact', editorActionRowMinHeight({ kind: 'action', title: 'a' }), 36)
  check('am.rowMinHeightDetail', editorActionRowMinHeight({ kind: 'action', title: 'a', detail: 'd' }), 52)
  check('am.rowShowsIcon', editorActionRowShowsIcon({ kind: 'action', title: 'a', systemImage: 'plus' }), true)
  check('am.rowHidesIcon', editorActionRowShowsIcon({ kind: 'action', title: 'a', systemImage: null }), false)
  check('am.checkmarkOn', editorActionRowCheckmarkOpacity(true), 1)
  check('am.checkmarkOff', editorActionRowCheckmarkOpacity(false), 0)

  check('am.foregroundIdle', editorActionRowForeground({ isEnabled: true, hovered: false }), 0.86)
  check('am.foregroundHover', editorActionRowForeground({ isEnabled: true, hovered: true }), 0.96)
  check('am.foregroundDisabled', editorActionRowForeground({ isEnabled: false, hovered: true }), 0.32)
  check('am.litEnabledHover', editorActionRowIsLit({ isEnabled: true, hovered: true }), true)
  check('am.litDisabledHover', editorActionRowIsLit({ isEnabled: false, hovered: true }), false)

  check('am.fillPressed',
    editorActionRowFill({ isEnabled: true, isPressed: true, hovered: false, selected: false }).kind, 'pressed')
  check('am.fillHover',
    editorActionRowFill({ isEnabled: true, isPressed: false, hovered: true, selected: false }).kind, 'hover')
  check('am.fillSelected',
    editorActionRowFill({ isEnabled: true, isPressed: false, hovered: false, selected: true }).kind, 'selected')
  check('am.fillSelectedOpacity', EDITOR_ACTION_ROW_SELECTED_FILL, 0.045)
  check('am.fillNone',
    editorActionRowFill({ isEnabled: true, isPressed: false, hovered: false, selected: false }).kind, 'none')
  check('am.fillDisabledPressed',
    editorActionRowFill({ isEnabled: false, isPressed: true, hovered: true, selected: true }).kind, 'selected')
  check('am.borderLit', editorActionRowBorderOpacity(true), 0.06)
  check('am.borderIdle', editorActionRowBorderOpacity(false), 0)
  check('am.borderWidth', EDITOR_ACTION_ROW_BORDER_WIDTH, 0.5)
  check('am.offsetHover',
    editorActionRowOffset({ isEnabled: true, hovered: true, reducesMotion: false }), 2)
  check('am.offsetReduced',
    editorActionRowOffset({ isEnabled: true, hovered: true, reducesMotion: true }), 0)
  check('am.offsetIdle',
    editorActionRowOffset({ isEnabled: true, hovered: false, reducesMotion: false }), 0)
  check('am.scalePressed',
    editorActionRowScale({ isEnabled: true, isPressed: true, reducesMotion: false }), 0.985)
  check('am.scaleReduced',
    editorActionRowScale({ isEnabled: true, isPressed: true, reducesMotion: true }), 1)
  check('am.scaleIdle',
    editorActionRowScale({ isEnabled: true, isPressed: false, reducesMotion: false }), 1)
  check('am.returnPerforms', editorActionMenuReturnKeyAction({ isEnabled: true, modifiers: [] }), 'perform')
  check('am.returnWithModifier',
    editorActionMenuReturnKeyAction({ isEnabled: true, modifiers: ['shift'] }), 'ignored')
  check('am.returnDisabled',
    editorActionMenuReturnKeyAction({ isEnabled: false, modifiers: [] }), 'ignored')
  check('am.performPlan', editorActionMenuPerformPlan().dismissFirst, true)
  check('am.traitsOn', editorActionRowAccessibilityTraits(true).join(','), 'selected')
  check('am.traitsOff', editorActionRowAccessibilityTraits(false).length, 0)
  check('am.helpUsesDetail',
    editorActionRowHelpText({ kind: 'action', title: 'a', detail: 'd' }), 'd')
  check('am.helpFallsBack', editorActionRowHelpText({ kind: 'action', title: 'a' }), 'a')

  // ---------------------------------------------------------------------------
  // ProjectMediaExchange.swift（164 行）
  // ---------------------------------------------------------------------------
  check('pmx.basenames',
    `${PROJECT_MEDIA_EXPORT_BASENAMES.screen},${PROJECT_MEDIA_EXPORT_BASENAMES.camera},${PROJECT_MEDIA_EXPORT_BASENAMES.microphone}`,
    '屏幕,摄像头,麦克风')
  check('pmx.folderSuffix', PROJECT_MEDIA_EXPORT_FOLDER_SUFFIX, '-源文件')
  check('pmx.audioFallback', MEDIA_COPY_FALLBACK_EXTENSION.audio, 'm4a')
  check('pmx.videoFallback', MEDIA_COPY_FALLBACK_EXTENSION.video, 'mov')
  check('pmx.minimumDuration', MEDIA_MINIMUM_DURATION, 0.01)
  check('pmx.untitled', UNTITLED_RECORDING_NAME, '未命名录制')
  check('pmx.folderPrefix', CAMERA_REPLACEMENT_FOLDER_PREFIX, 'camera-replacement-')

  check('pmx.sanitizeSlash', sanitizedMediaFilename('a/b'), 'a-b')
  check('pmx.sanitizeColon', sanitizedMediaFilename('a:b'), 'a-b')
  check('pmx.sanitizeBoth', sanitizedMediaFilename('a/b:c/d'), 'a-b-c-d')
  check('pmx.sanitizeTrim', sanitizedMediaFilename('  录制  '), '录制')
  check('pmx.sanitizeEmpty', sanitizedMediaFilename('   '), '未命名录制')
  check('pmx.sanitizeKeepsSpaces', sanitizedMediaFilename('项目 一'), '项目 一')
  check('pmx.exportBase', exportFolderBaseName('项目 A'), '项目 A-源文件')
  check('pmx.exportBaseEmpty', exportFolderBaseName(''), '未命名录制-源文件')

  {
    const taken = new Set(['X', 'X-2', 'X-3'])
    check('pmx.uniqueFirst', uniqueExportFolderName('Y', (n) => n === 'Y'), 'Y-2')
    check('pmx.uniqueSkipsExisting', uniqueExportFolderName('X', (n) => taken.has(n)), 'X-4')
    check('pmx.uniqueFree', uniqueExportFolderName('Z', () => false), 'Z')
  }

  check('pmx.extLowered', mediaCopyExtension('/a/b.MOV', PROJECT_MEDIA_EXPORT_BASENAMES.camera), 'mov')
  check('pmx.extAudioFallback', mediaCopyExtension('/a/b', PROJECT_MEDIA_EXPORT_BASENAMES.microphone), 'm4a')
  check('pmx.extAudioEnglish', mediaCopyExtension('/a/b', 'microphone'), 'm4a')
  check('pmx.extVideoFallback', mediaCopyExtension('/a/b', PROJECT_MEDIA_EXPORT_BASENAMES.screen), 'mov')
  check('pmx.extHiddenFile', mediaCopyExtension('/a/.hidden', PROJECT_MEDIA_EXPORT_BASENAMES.screen), 'mov')
  check('pmx.extTrailingDot', mediaCopyExtension('/a/b.', PROJECT_MEDIA_EXPORT_BASENAMES.screen), 'mov')
  check('pmx.extWindowsPath', mediaCopyExtension('C:\\media\\a.M4A', PROJECT_MEDIA_EXPORT_BASENAMES.microphone), 'm4a')

  check('pmx.copyReadable', mediaCopySourceIsReadable(true), true)
  check('pmx.copyMissing', mediaCopySourceIsReadable(false), false)
  check('pmx.inspectNoTracks', mediaInspectionAccepts({ trackCount: 0, duration: 5 }), false)
  check('pmx.inspectNaN', mediaInspectionAccepts({ trackCount: 1, duration: Number.NaN }), false)
  check('pmx.inspectTooShort', mediaInspectionAccepts({ trackCount: 1, duration: 0.01 }), false)
  check('pmx.inspectOk', mediaInspectionAccepts({ trackCount: 1, duration: 0.02 }), true)
  check('pmx.cameraRequirementsOnlyVideo', cameraReplacementRequirements().requiredMediaType, 'video')
  check('pmx.replacementFolder', cameraReplacementFolderName('ABC-123'), 'camera-replacement-abc-123')
  check('pmx.relativePath', cameraRelativePath('f1', 'camera.mov'), 'media/f1/camera.mov')

  check('pmx.errorMissing',
    mediaExchangeErrorMessage('missingProjectMedia', '摄像头'), '项目没有可导出的摄像头源文件。')
  check('pmx.errorInvalid', mediaExchangeErrorMessage('invalidMedia', '坏文件'), '坏文件')
  check('pmx.missingFile', missingMediaFileMessage('/x/y.mov'), '选择的文件不存在：/x/y.mov')
  check('pmx.missingVideoTrack',
    missingMediaTrackMessage('a.mov', 'video'), 'a.mov 没有可用的视频轨。')
  check('pmx.missingAudioTrack',
    missingMediaTrackMessage('a.m4a', 'audio'), 'a.m4a 没有可用的音频轨。')

  {
    const plan = mediaExportPlan({
      sources: { screen: '/r/screen.mov', camera: '/r/cam.mov', microphone: '/r/mic.m4a' },
      projectTitle: '演示',
      exists: () => false,
    })
    check('pmx.planFolder', plan.folderName, '演示-源文件')
    check('pmx.planCopyCount', plan.copies.length, 3)
    check('pmx.planOrder', plan.copies.map((c) => c.baseName).join(','), '屏幕,摄像头,麦克风')
    check('pmx.planExtensions', plan.copies.map((c) => c.extension).join(','), 'mov,mov,m4a')
    const screenOnly = mediaExportPlan({
      sources: { screen: '/r/screen.mov', camera: null, microphone: null },
      projectTitle: '演示',
      exists: () => false,
    })
    check('pmx.planScreenOnly', screenOnly.copies.length, 1)
    const taken = mediaExportPlan({
      sources: { screen: '/r/screen.mov', camera: null, microphone: null },
      projectTitle: '演示',
      exists: (n) => n === '演示-源文件',
    })
    check('pmx.planDeduped', taken.folderName, '演示-源文件-2')
  }

  // ---------------------------------------------------------------------------
  // CaptureDeviceLifecycle.swift（165 行）
  // ---------------------------------------------------------------------------
  check('cdl.domains', CAPTURE_DEVICE_OPERATION_DOMAINS.join(','),
    'catalogRefresh,screenDevice,camera,microphone')
  check('cdl.nextFirst', captureDeviceGenerationNext(0n), 1n)
  check('cdl.nextIncrement', captureDeviceGenerationNext(5n), 6n)
  check('cdl.nextWrapSkipsZero',
    captureDeviceGenerationNext(0xffffffffffffffffn), 1n)
  check('cdl.delays', CAPTURE_DEVICE_REFRESH_DELAYS_MS.join(','), '0,250,500,1000,2000,3000,5000')
  check('cdl.sleepFirstImmediate', captureDeviceRefreshShouldSleep(0), false)
  check('cdl.sleepLater', captureDeviceRefreshShouldSleep(250), true)
  check('cdl.notifications', CAPTURE_DEVICE_CONNECTION_NOTIFICATIONS.length, 2)

  {
    const state = new CaptureDeviceGenerationState()
    check('cdl.initialGeneration', state.generationOf('camera'), 0n)
    const first = state.begin('camera')
    check('cdl.tokenGeneration', first.generation, 1n)
    check('cdl.tokenDomain', first.domain, 'camera')
    check('cdl.isCurrentFirst', state.isCurrent(first), true)
    const second = state.begin('camera')
    check('cdl.secondGeneration', second.generation, 2n)
    check('cdl.firstSuperseded', state.isCurrent(first), false)
    check('cdl.secondCurrent', state.isCurrent(second), true)
    check('cdl.domainsIndependent', state.generationOf('microphone'), 0n)
    const mic = state.begin('microphone')
    check('cdl.micFirst', mic.generation, 1n)
    check('cdl.cameraUnchanged', state.generationOf('camera'), 2n)
  }

  check('cdl.actionNoSession',
    captureDeviceNotificationAction({ observationSessionID: null, notificationSessionID: 'a' }), 'ignore')
  check('cdl.actionMismatch',
    captureDeviceNotificationAction({ observationSessionID: 'b', notificationSessionID: 'a' }), 'ignore')
  check('cdl.actionMatch',
    captureDeviceNotificationAction({ observationSessionID: 'a', notificationSessionID: 'a' }), 'scheduleRefresh')
  check('cdl.continueOk',
    captureDeviceRefreshShouldContinue({ cancelled: false, isCurrent: true }), true)
  check('cdl.continueCancelled',
    captureDeviceRefreshShouldContinue({ cancelled: true, isCurrent: true }), false)
  check('cdl.continueStale',
    captureDeviceRefreshShouldContinue({ cancelled: false, isCurrent: false }), false)

  {
    let refreshes = 0
    const lifecycle = new CaptureDeviceLifecycle(() => { refreshes += 1 })
    const observed = []
    const started = lifecycle.start({
      createSessionID: () => 's1',
      observe: (handler) => {
        observed.push(handler)
        return { names: CAPTURE_DEVICE_CONNECTION_NOTIFICATIONS, dispose() {} }
      },
    })
    check('cdl.startOk', started, true)
    check('cdl.startRefreshesOnce', refreshes, 1)
    check('cdl.sessionID', lifecycle.sessionID, 's1')
    check('cdl.isObserving', lifecycle.isObserving, true)
    check('cdl.startIdempotent', lifecycle.start({
      createSessionID: () => 's2',
      observe: () => ({ names: [], dispose() {} }),
    }), false)

    // 同一会话的通知会排一轮刷新
    const plan = lifecycle.scheduleCatalogRefresh()
    check('cdl.planOperation', plan.operation.domain, 'catalogRefresh')
    check('cdl.planDelayCount', plan.delays.length, 7)
    check('cdl.isRefreshing', lifecycle.isRefreshing, true)
    check('cdl.refreshIfCurrent', lifecycle.refreshIfCurrent(plan, false), true)
    check('cdl.refreshCount', refreshes, 2)
    check('cdl.refreshIfCancelled', lifecycle.refreshIfCurrent(plan, true), false)

    // 新计划作废旧计划
    const newer = lifecycle.scheduleCatalogRefresh()
    check('cdl.oldPlanStale', lifecycle.refreshIfCurrent(plan, false), false)
    check('cdl.newPlanCurrent', lifecycle.refreshIfCurrent(newer, false), true)

    lifecycle.finishCatalogRefresh()
    check('cdl.finishedRefreshing', lifecycle.isRefreshing, false)

    const token = lifecycle.beginOperation('camera')
    check('cdl.lifecycleToken', lifecycle.isCurrent(token), true)

    lifecycle.stop()
    check('cdl.stoppedSession', lifecycle.sessionID, null)
    check('cdl.stoppedObserving', lifecycle.isObserving, false)
    check('cdl.stopInvalidatesPlans', lifecycle.refreshIfCurrent(newer, false), false)
    // stop() 只推进 catalogRefresh；其它域的代次刻意不动。
    check('cdl.stopKeepsOtherDomains', lifecycle.isCurrent(token), true)
  }
}

await runHoverAndInputBatch()


async function runCaptureWindowBatch() {
  // ========== 6 文件 / 1038 行：录制支撑 / 帧规格归一 / 窗口几何 /
  //            窗口层级与卡片 / 调色面板 / 场景预设弹窗
  const {
    // ---- CaptureRecordingSupport.swift
    cameraRecorderErrorMessage, MOVIE_CAPTURE_ROLES, movieCaptureRoleDisplayName,
    movieCaptureRoleInputDeviceRole, microphoneRecorderErrorMessage,
    recorderSetupErrorRecoveryForMessage, isPermissionMessage, isSurfaceUpdateErrorMessage,
    CaptureCancellationFlag, captureActivityRecordingRequestID,
    captureActivityOwnsRecordingOutput, captureActivityIsRecording, captureFinishOutcome,
    captureSampleHostTime, formatArguments,
    // ---- CameraSampleWriterFrameNormalizer.swift
    CAMERA_FRAME_SCALING_MODE, CAMERA_FRAME_REALTIME, cameraFrameOutputDimensions,
    cameraFrameNeedsNormalization, cameraFrameContract, cameraFrameNormalizeAction,
    CAMERA_FRAME_ERROR_TEXT, cameraFramePoolAllocationMessage, cameraFrameTransferMessage,
    cameraFrameSessionCreationMessage, cameraFrameSessionConfigurationMessage,
    cameraFrameShouldCreateSession, CameraSampleFrameNormalizer,
    // ---- CaptureWindowGeometry.swift
    CAPTURE_WINDOW_GEOMETRY_OPTIONS, CAPTURE_WINDOW_POLL_INTERVAL_MS,
    CAPTURE_WINDOW_RECORDING_POLL_INTERVAL_MS, captureWindowHoverSelection,
    captureWindowLockedWindow, resolveCaptureWindowGeometry, captureWindowGeometryEqual,
    captureWindowLookupPublication, CaptureWindowGeometryRuntime,
    // ---- CaptureWindowPresentationPolicy.swift
    NS_WINDOW_LEVEL_FLOATING, NS_WINDOW_LEVEL_CAPTURE_OVERLAY,
    NS_WINDOW_LEVEL_ACTIVE_RECORDER, captureWindowLevel, captureOverlayKeyScreenIndex,
    captureLargestIntersectionIndex, CAPTURE_SELECTION_CARD_EDGE_INSET,
    CAPTURE_SELECTION_CARD_ATTACHMENT_GAP, captureSelectionCardGlobalCenter,
    captureSelectionCardLocalCenter, clampCenter, RECORDER_CAPTURE_SOURCE_ACCESSIBILITY_IDS,
    recorderCaptureSourceAccessibilityID, CAMERA_PREVIEW_WINDOW_IDENTIFIER,
    recorderAnchorFrame, rectIntersection,
    // ---- EditorColorPalette.swift
    COLOR_PALETTE_WIDTH, COLOR_PALETTE_PADDING, COLOR_PALETTE_PLANE_HEIGHT,
    COLOR_PALETTE_THUMB_SIZE, COLOR_PALETTE_THUMB_RADIUS, COLOR_PALETTE_HUE_STRIP_INSET,
    COLOR_PALETTE_HUE_STRIP_HEIGHT, COLOR_PALETTE_BRIGHTNESS_STEP,
    COLOR_PALETTE_HUE_STEP, COLOR_PALETTE_HUE_RETAIN_THRESHOLD, COLOR_PALETTE_INVALID_HINT,
    hsbToRgb, hsbFromRgb, colorPaletteRebase, colorPalettePlanePoint,
    colorPalettePlaneDragValue, colorPaletteHueTravel, colorPaletteHueThumbOffset,
    colorPaletteHueDragValue, colorPaletteHueGradientHues, colorPaletteHexIsValid,
    colorPaletteHexPreview, colorPaletteSubmitText, colorPalettePlaneAccessibilityValue,
    colorPaletteHueAccessibilityValue, colorPaletteHexAccessibilityLabel,
    colorPaletteHexFromHsb,
    // ---- EditorScenePresetSheet.swift
    scenePresetSheetTitle, scenePresetSaveTitle, SCENE_PRESET_SHEET_SUBTITLE,
    SCENE_PRESET_NAME_PLACEHOLDER, SCENE_PRESET_CONFLICT_HINT, SCENE_PRESET_FOOTNOTE,
    SCENE_PRESET_SAVING_LABEL, SCENE_PRESET_APPLY_LABEL, SCENE_PRESET_SHEET_WIDTH,
    SCENE_PRESET_SHEET_PADDING, SCENE_PRESET_PREVIEW_WIDTH, SCENE_PRESET_CONFIGURATION_ROWS,
    scenePresetSaveEnabled, scenePresetPreviewSize, sceneCropSummary,
    normalizedCropIsFull, scenePresetOutlineRect, scenePresetDimensionSummary,
    SCENE_PRESET_PREVIEW_TEXTS,
  } = m

  // ---------------------------------------------------------------------------
  // CaptureRecordingSupport.swift（168 行）
  // ---------------------------------------------------------------------------
  check('crs.cameraPermission',
    cameraRecorderErrorMessage('permissionDenied', ['摄像头']), '没有摄像头采集权限。')
  check('crs.cameraConfigure',
    cameraRecorderErrorMessage('cannotConfigure', ['摄像头']), '无法配置摄像头录制。')
  check('crs.cameraRecording',
    cameraRecorderErrorMessage('recordingFailed', ['摄像头', '设备忙']), '摄像头录制失败：设备忙')
  check('crs.movieRoles', MOVIE_CAPTURE_ROLES.join(','), 'camera,iosDevice')
  check('crs.movieRoleCamera', movieCaptureRoleDisplayName('camera'), '摄像头')
  check('crs.movieRoleIOS', movieCaptureRoleDisplayName('iosDevice'), 'iPhone/iPad 屏幕')
  check('crs.movieRoleInputCamera', movieCaptureRoleInputDeviceRole('camera'), 'camera')
  check('crs.movieRoleInputIOS', movieCaptureRoleInputDeviceRole('iosDevice'), 'iosDevice')
  check('crs.micPermission',
    microphoneRecorderErrorMessage('permissionDenied', []), '没有麦克风权限。')
  check('crs.micRecording',
    microphoneRecorderErrorMessage('recordingFailed', ['设备被占用']), '麦克风录制失败：设备被占用')
  check('crs.formatArguments', formatArguments('%@录制失败：%@', ['摄像头', '超时']), '摄像头录制失败：超时')

  check('crs.recoveryProjectFolder',
    recorderSetupErrorRecoveryForMessage('保存目录不可用：/x'), 'projectFolder')
  check('crs.recoveryCamera',
    recorderSetupErrorRecoveryForMessage('没有摄像头采集权限。'), 'camera')
  check('crs.recoveryMicrophone',
    recorderSetupErrorRecoveryForMessage('没有麦克风权限。'), 'microphone')
  check('crs.recoveryOther', recorderSetupErrorRecoveryForMessage('磁盘已满'), 'none')
  check('crs.recoveryLocalizedCamera',
    recorderSetupErrorRecoveryForMessage('Camera access denied', {
      cameraPermissionMessage: 'Camera access denied',
    }), 'camera')
  check('crs.recoveryLocalizedMic',
    recorderSetupErrorRecoveryForMessage('Microphone access denied', {
      microphonePermissionMessage: 'Microphone access denied',
    }), 'microphone')

  check('crs.permissionContains',
    isPermissionMessage('需要屏幕录制权限'), true)
  check('crs.permissionCamera', isPermissionMessage('没有摄像头采集权限。'), true)
  check('crs.permissionScreen',
    isPermissionMessage('没有屏幕录制权限。请在系统设置中允许后重新启动。'), true)
  check('crs.permissionUnrelated', isPermissionMessage('文件写入失败'), false)
  check('crs.surfaceErrorPrefix', isSurfaceUpdateErrorMessage('无法更新录制画面：设备断开'), true)
  check('crs.surfaceErrorPlain', isSurfaceUpdateErrorMessage('无法更新录制画面'), true)
  check('crs.surfaceErrorOther', isSurfaceUpdateErrorMessage('导出失败'), false)

  {
    const flag = new CaptureCancellationFlag()
    check('crs.flagInitial', flag.isCancelled, false)
    flag.cancel()
    check('crs.flagCancelled', flag.isCancelled, true)
    flag.cancel()
    check('crs.flagIdempotent', flag.isCancelled, true)
  }

  check('crs.idleNoRequest', captureActivityRecordingRequestID({ kind: 'idle' }), null)
  check('crs.idleNoOutput', captureActivityOwnsRecordingOutput({ kind: 'idle' }), false)
  check('crs.previewNoRequest',
    captureActivityRecordingRequestID({ kind: 'livePreview', requestID: 'p1' }), null)
  check('crs.previewNoOutput', captureActivityOwnsRecordingOutput({ kind: 'livePreview', requestID: 'p1' }), false)
  check('crs.startingRequest',
    captureActivityRecordingRequestID({ kind: 'starting', requestID: 'r1' }), 'r1')
  check('crs.startingOwnsOutput', captureActivityOwnsRecordingOutput({ kind: 'starting', requestID: 'r1' }), true)
  check('crs.startingNotRecording', captureActivityIsRecording({ kind: 'starting', requestID: 'r1' }), false)
  check('crs.recordingIsRecording', captureActivityIsRecording({ kind: 'recording', requestID: 'r1' }), true)
  check('crs.stoppingOwnsOutput', captureActivityOwnsRecordingOutput({ kind: 'stopping', requestID: 'r1' }), true)
  check('crs.stoppingNotRecording', captureActivityIsRecording({ kind: 'stopping', requestID: 'r1' }), false)

  {
    const clean = captureFinishOutcome({ hasError: false, successfullyFinishedFlag: false })
    check('crs.finishClean', clean.succeeded, true)
    check('crs.finishCleanReason', clean.failureReason, '未知错误')
    const benign = captureFinishOutcome({
      hasError: true, successfullyFinishedFlag: true, errorDescription: 'benign',
    })
    check('crs.finishBenignSucceeded', benign.succeeded, true)
    check('crs.finishBenignReason', benign.failureReason, 'benign')
    const failed = captureFinishOutcome({ hasError: true, successfullyFinishedFlag: false, errorDescription: 'disk full' })
    check('crs.finishFailed', failed.succeeded, false)
    check('crs.finishFailedReason', failed.failureReason, 'disk full')
  }

  check('crs.hostTimeNotNumeric',
    captureSampleHostTime({ presentationSeconds: 1, presentationIsNumeric: false, convertedSeconds: null }), null)
  check('crs.hostTimeNoMaster',
    captureSampleHostTime({ presentationSeconds: 12.5, presentationIsNumeric: true, convertedSeconds: null }), 12.5)
  check('crs.hostTimeConverted',
    captureSampleHostTime({ presentationSeconds: 1, presentationIsNumeric: true, convertedSeconds: 99.25 }), 99.25)
  check('crs.hostTimeConvertedInvalid',
    captureSampleHostTime({ presentationSeconds: 1, presentationIsNumeric: true, convertedSeconds: Number.NaN, convertedIsNumeric: false }), null)
  check('crs.hostTimeConvertedNaN',
    captureSampleHostTime({ presentationSeconds: 1, presentationIsNumeric: true, convertedSeconds: Number.NaN }), null)

  // ---------------------------------------------------------------------------
  // CameraSampleWriterFrameNormalizer.swift（168 行）
  // ---------------------------------------------------------------------------
  check('csw.scalingMode', CAMERA_FRAME_SCALING_MODE, 'trim')
  check('csw.realtime', CAMERA_FRAME_REALTIME, true)
  {
    const configured = cameraFrameOutputDimensions({
      configuredWidth: 1280, configuredHeight: 720, sourceWidth: 1920, sourceHeight: 1080,
    })
    check('csw.dimsConfigured', `${configured.width},${configured.height}`, '1280,720')
    const missing = cameraFrameOutputDimensions({
      configuredWidth: null, configuredHeight: 720, sourceWidth: 1920, sourceHeight: 1080,
    })
    check('csw.dimsSourceFallback', `${missing.width},${missing.height}`, '1920,1080')
    const zero = cameraFrameOutputDimensions({
      configuredWidth: 0, configuredHeight: 0, sourceWidth: 0, sourceHeight: 0,
    })
    check('csw.dimsFloorOne', `${zero.width},${zero.height}`, '1,1')
    const negative = cameraFrameOutputDimensions({
      configuredWidth: -4, configuredHeight: -2, sourceWidth: 640, sourceHeight: 480,
    })
    check('csw.dimsNegativeIgnored', `${negative.width},${negative.height}`, '640,480')
  }
  check('csw.needsWidth',
    cameraFrameNeedsNormalization({ contractWidth: 1280, contractHeight: 720, contractPixelFormat: 1, sourceWidth: 1920, sourceHeight: 720, sourcePixelFormat: 1 }), true)
  check('csw.needsHeight',
    cameraFrameNeedsNormalization({ contractWidth: 1280, contractHeight: 720, contractPixelFormat: 1, sourceWidth: 1280, sourceHeight: 480, sourcePixelFormat: 1 }), true)
  check('csw.needsPixelFormat',
    cameraFrameNeedsNormalization({ contractWidth: 1280, contractHeight: 720, contractPixelFormat: 1, sourceWidth: 1280, sourceHeight: 720, sourcePixelFormat: 2 }), true)
  check('csw.needsNothing',
    cameraFrameNeedsNormalization({ contractWidth: 1280, contractHeight: 720, contractPixelFormat: 1, sourceWidth: 1280, sourceHeight: 720, sourcePixelFormat: 1 }), false)

  check('csw.contractRequiresSession',
    cameraFrameContract({ width: 1280, height: 720, pixelFormat: 1, sourceWidth: 1920, sourceHeight: 1080, sourcePixelFormat: 1 }).requiresTransferSession, true)
  check('csw.contractNoSession',
    cameraFrameContract({ width: 1280, height: 720, pixelFormat: 1, sourceWidth: 1280, sourceHeight: 720, sourcePixelFormat: 1 }).requiresTransferSession, false)

  check('csw.actionNoContract',
    cameraFrameNormalizeAction({ hasContract: false, contractWidth: 0, contractHeight: 0, contractPixelFormat: 0, sourceWidth: 10, sourceHeight: 10, sourcePixelFormat: 1 }).kind, 'passThrough')
  check('csw.actionSame',
    cameraFrameNormalizeAction({ hasContract: true, contractWidth: 1280, contractHeight: 720, contractPixelFormat: 1, sourceWidth: 1280, sourceHeight: 720, sourcePixelFormat: 1 }).kind, 'passThrough')
  {
    const action = cameraFrameNormalizeAction({ hasContract: true, contractWidth: 1280, contractHeight: 720, contractPixelFormat: 1, sourceWidth: 1920, sourceHeight: 1080, sourcePixelFormat: 1 })
    check('csw.actionTransfer', action.kind, 'transfer')
    check('csw.actionTransferSize', `${action.width},${action.height}`, '1280,720')
  }

  check('csw.poolMessage', cameraFramePoolAllocationMessage(-6680), '无法申请摄像头等比裁切缓冲（-6680）')
  check('csw.transferMessage', cameraFrameTransferMessage(1920, 1080, -1), '无法把摄像头画面等比转换为 1920x1080（-1）')
  check('csw.creationMessage', cameraFrameSessionCreationMessage(-1), '无法创建摄像头画面规格转换器（-1）')
  check('csw.configMessage', cameraFrameSessionConfigurationMessage(0, -1), '无法配置摄像头等比裁切（0/-1）')
  check('csw.poolNotReadyText', CAMERA_FRAME_ERROR_TEXT.poolNotReady, '摄像头画面规格转换缓冲池尚未准备')
  check('csw.shouldCreate', cameraFrameShouldCreateSession(false), true)
  check('csw.shouldReuse', cameraFrameShouldCreateSession(true), false)

  {
    const normalizer = new CameraSampleFrameNormalizer()
    check('csw.normalizerInitialWidth', normalizer.width, null)
    check('csw.normalizerInitialPrepared', normalizer.isPrepared, false)
    const plan = normalizer.prepareContract({
      width: 1280, height: 720, pixelFormat: 875704422,
      sourceWidth: 1920, sourceHeight: 1080, sourcePixelFormat: 875704422,
    })
    check('csw.normalizerContract', `${normalizer.width},${normalizer.height}`, '1280,720')
    check('csw.normalizerPixelFormat', normalizer.pixelFormat, 875704422)
    check('csw.normalizerPrepared', normalizer.isPrepared, plan.requiresTransferSession)
    check('csw.normalizerSamePassThrough',
      normalizer.normalizeAction({ sourceWidth: 1280, sourceHeight: 720, sourcePixelFormat: 875704422 }).kind, 'passThrough')
    check('csw.normalizerDifferentTransfer',
      normalizer.normalizeAction({ sourceWidth: 640, sourceHeight: 480, sourcePixelFormat: 875704422 }).kind, 'transfer')
    normalizer.reset()
    check('csw.normalizerReset', normalizer.width, null)
    check('csw.normalizerResetAction',
      normalizer.normalizeAction({ sourceWidth: 100, sourceHeight: 100, sourcePixelFormat: 1 }).kind, 'passThrough')
  }

  // ---------------------------------------------------------------------------
  // CaptureWindowGeometry.swift（169 行）
  // ---------------------------------------------------------------------------
  check('cwg.options', CAPTURE_WINDOW_GEOMETRY_OPTIONS.join(','), 'optionIncludingWindow,excludeDesktopElements')
  check('cwg.pollInterval', CAPTURE_WINDOW_POLL_INTERVAL_MS, 75)
  check('cwg.recordingPollInterval', CAPTURE_WINDOW_RECORDING_POLL_INTERVAL_MS, 250)

  check('cwg.hoverKeepsInside',
    captureWindowHoverSelection({ previous: 'A', pointerIsInsideRecorderWindow: true, frontmostCandidate: 'B' }), 'A')
  check('cwg.hoverFollowsOutside',
    captureWindowHoverSelection({ previous: 'A', pointerIsInsideRecorderWindow: false, frontmostCandidate: 'B' }), 'B')
  check('cwg.hoverClearsOutside',
    captureWindowHoverSelection({ previous: 'A', pointerIsInsideRecorderWindow: false, frontmostCandidate: null }), null)

  {
    const catalog = [{ id: 3 }, { id: 5 }]
    check('cwg.lockedNoGeometry',
      captureWindowLockedWindow({ id: 3, catalog, geometry: null }), null)
    check('cwg.lockedWrongGeometry',
      captureWindowLockedWindow({ id: 3, catalog, geometry: { windowID: 5, frame: { x: 0, y: 0, width: 1, height: 1 } } }), null)
    check('cwg.lockedFound',
      captureWindowLockedWindow({ id: 5, catalog, geometry: { windowID: 5, frame: { x: 0, y: 0, width: 1, height: 1 } } }).id, 5)
    check('cwg.lockedNotInCatalog',
      captureWindowLockedWindow({ id: 9, catalog, geometry: { windowID: 9, frame: { x: 0, y: 0, width: 1, height: 1 } } }), null)
  }

  check('cwg.resolveNotFound',
    resolveCaptureWindowGeometry({ windowID: 1, descriptions: [], mainDisplayHeight: 1000 }), null)
  check('cwg.resolveWrongLayer',
    resolveCaptureWindowGeometry({
      windowID: 1,
      descriptions: [{ number: 1, layer: 1, bounds: { x: 0, y: 0, width: 10, height: 10 } }],
      mainDisplayHeight: 1000,
    }), null)
  check('cwg.resolveNoBounds',
    resolveCaptureWindowGeometry({
      windowID: 1, descriptions: [{ number: 1, layer: 0, bounds: null }], mainDisplayHeight: 1000,
    }), null)
  check('cwg.resolveZeroSize',
    resolveCaptureWindowGeometry({
      windowID: 1,
      descriptions: [{ number: 1, layer: 0, bounds: { x: 0, y: 0, width: 0, height: 10 } }],
      mainDisplayHeight: 1000,
    }), null)
  {
    const geometry = resolveCaptureWindowGeometry({
      windowID: 7,
      descriptions: [{ number: 7, layer: 0, bounds: { x: 10, y: 200, width: 300, height: 400 } }],
      mainDisplayHeight: 1000,
    })
    check('cwg.resolveWindowID', geometry.windowID, 7)
    check('cwg.resolveFlippedY', geometry.frame.y, 400)
    check('cwg.resolveKeepsX', geometry.frame.x, 10)
    check('cwg.resolveKeepsSize', `${geometry.frame.width},${geometry.frame.height}`, '300,400')
  }

  check('cwg.equalBothNull', captureWindowGeometryEqual(null, null), true)
  check('cwg.equalOneNull', captureWindowGeometryEqual(null, { windowID: 1, frame: { x: 0, y: 0, width: 1, height: 1 } }), false)
  check('cwg.equalSame',
    captureWindowGeometryEqual(
      { windowID: 1, frame: { x: 1, y: 2, width: 3, height: 4 } },
      { windowID: 1, frame: { x: 1, y: 2, width: 3, height: 4 } }), true)
  check('cwg.equalDifferent',
    captureWindowGeometryEqual(
      { windowID: 1, frame: { x: 1, y: 2, width: 3, height: 4 } },
      { windowID: 1, frame: { x: 1, y: 2, width: 3, height: 5 } }), false)

  check('cwg.publishNull', captureWindowLookupPublication(null, 3), null)
  check('cwg.publishOtherWindow',
    captureWindowLookupPublication({ windowID: 4, frame: { x: 0, y: 0, width: 1, height: 1 } }, 3), null)
  {
    const replacement = { windowID: 3, frame: { x: 5, y: 6, width: 7, height: 8 } }
    check('cwg.publishAccepted', captureWindowLookupPublication(replacement, 3) === replacement, true)
  }

  {
    const runtime = new CaptureWindowGeometryRuntime()
    const seen = []
    runtime.setOnChange((geometry) => seen.push(geometry === null ? 'null' : geometry.windowID))
    const started = runtime.start({ windowID: 4, initialFrame: { x: 0, y: 10, width: 100, height: 50 } })
    check('cwg.runtimePolls', started.polls, true)
    check('cwg.runtimeGeneration', started.generation, 1)
    check('cwg.runtimeNotified', seen.join(','), '4')
    check('cwg.runtimeFrame', runtime.frameFor(4).y, 10)
    check('cwg.runtimeFrameOtherWindow', runtime.frameFor(5), null)
    check('cwg.runtimePublishDedupes', runtime.applyPoll({ windowID: 4, frame: { x: 0, y: 10, width: 100, height: 50 } }, 4), undefined)
    check('cwg.runtimeNotifiedOnce', seen.join(','), '4')
    runtime.applyPoll({ windowID: 4, frame: { x: 0, y: 20, width: 100, height: 50 } }, 4)
    check('cwg.runtimeNotifiedTwice', seen.join(','), '4,4')
    runtime.applyPoll({ windowID: 9, frame: { x: 0, y: 0, width: 1, height: 1 } }, 4)
    check('cwg.runtimeOtherWindowClears', runtime.geometry, null)
    check('cwg.runtimeAcceptPoll', runtime.shouldAcceptPoll({ generation: 1, windowID: 4 }), true)
    check('cwg.runtimeRejectGeneration', runtime.shouldAcceptPoll({ generation: 0, windowID: 4 }), false)
    check('cwg.runtimeRejectWindow', runtime.shouldAcceptPoll({ generation: 1, windowID: 5 }), false)
    runtime.stop()
    check('cwg.runtimeStoppedWindow', runtime.windowID, null)
    check('cwg.runtimeStoppedFrame', runtime.frameFor(4), null)
    check('cwg.runtimeStopGeneration', runtime.activeGeneration, 2)
  }
  {
    const manual = new CaptureWindowGeometryRuntime({ pollIntervalMs: null })
    check('cwg.runtimeNoPoll',
      manual.start({ windowID: 1, initialFrame: { x: 0, y: 0, width: 1, height: 1 } }).polls, false)
    const overridden = new CaptureWindowGeometryRuntime({ pollIntervalMs: null })
    check('cwg.runtimeOverridePoll',
      overridden.start({ windowID: 1, initialFrame: { x: 0, y: 0, width: 1, height: 1 }, pollIntervalMs: 250 }).polls, true)
  }

  // ---------------------------------------------------------------------------
  // CaptureWindowPresentationPolicy.swift（178 行）
  // ---------------------------------------------------------------------------
  check('cwp.floating', NS_WINDOW_LEVEL_FLOATING, 3)
  check('cwp.overlay', NS_WINDOW_LEVEL_CAPTURE_OVERLAY, 4)
  check('cwp.activeRecorder', NS_WINDOW_LEVEL_ACTIVE_RECORDER, 5)
  check('cwp.levelMemo', captureWindowLevel({ kind: 'recorderMemo' }), 6)
  check('cwp.levelSelectionOverlay', captureWindowLevel({ kind: 'selectionOverlay' }), 4)
  check('cwp.levelGuide', captureWindowLevel({ kind: 'recordingGuideOverlay' }), 4)
  check('cwp.levelSetupActive',
    captureWindowLevel({ kind: 'recorderPanel', phase: 'setup', selectionActive: true }), 5)
  check('cwp.levelSetupIdle',
    captureWindowLevel({ kind: 'recorderPanel', phase: 'setup', selectionActive: false }), 3)
  check('cwp.levelPreparing',
    captureWindowLevel({ kind: 'recorderPanel', phase: 'preparing', selectionActive: false }), 5)
  check('cwp.levelRecording',
    captureWindowLevel({ kind: 'recorderPanel', phase: 'recording', selectionActive: false }), 5)
  check('cwp.levelFinishing',
    captureWindowLevel({ kind: 'recorderPanel', phase: 'finishing', selectionActive: true }), 3)
  check('cwp.levelEditor',
    captureWindowLevel({ kind: 'recorderPanel', phase: 'editor', selectionActive: false }), 3)
  check('cwp.levelComplete',
    captureWindowLevel({ kind: 'recorderPanel', phase: 'recordingComplete', selectionActive: false }), 3)

  {
    const frames = [
      { x: 0, y: 0, width: 1000, height: 800 },
      { x: 1000, y: 0, width: 1000, height: 800 },
    ]
    check('cwp.keyScreenFirst', captureOverlayKeyScreenIndex({ x: 10, y: 10 }, frames), 0)
    check('cwp.keyScreenSecond', captureOverlayKeyScreenIndex({ x: 1500, y: 100 }, frames), 1)
    check('cwp.keyScreenFallback', captureOverlayKeyScreenIndex({ x: -50, y: -50 }, frames), 0)
    check('cwp.keyScreenEmpty', captureOverlayKeyScreenIndex({ x: 0, y: 0 }, []), null)

    check('cwp.largestFirst',
      captureLargestIntersectionIndex({ x: 0, y: 0, width: 100, height: 100 }, frames), 0)
    check('cwp.largestSecond',
      captureLargestIntersectionIndex({ x: 900, y: 0, width: 300, height: 100 }, frames), 1)
    check('cwp.largestNone',
      captureLargestIntersectionIndex({ x: 5000, y: 0, width: 100, height: 100 }, frames), null)
    // 面积并列时保留先出现的（复刻 `if area > bestArea` 的严格大于）
    check('cwp.largestTieKeepsFirst',
      captureLargestIntersectionIndex({ x: 500, y: 0, width: 1000, height: 100 },
        [frames[1], frames[0]]), 0)
  }

  check('cwp.edgeInset', CAPTURE_SELECTION_CARD_EDGE_INSET, 16)
  check('cwp.attachmentGap', CAPTURE_SELECTION_CARD_ATTACHMENT_GAP, 12)
  {
    const visibleFrame = { x: 0, y: 0, width: 1000, height: 800 }
    const cardSize = { width: 200, height: 100 }
    const centered = captureSelectionCardGlobalCenter({ anchorFrame: null, cardSize, visibleFrame })
    check('cwp.cardNoAnchor', `${centered.x},${centered.y}`, '500,400')
    const below = captureSelectionCardGlobalCenter({
      anchorFrame: { x: 400, y: 300, width: 200, height: 50 }, cardSize, visibleFrame,
    })
    check('cwp.cardBelowX', below.x, 500)
    check('cwp.cardBelowY', below.y, 238)
    const above = captureSelectionCardGlobalCenter({
      anchorFrame: { x: 400, y: 20, width: 200, height: 50 }, cardSize, visibleFrame,
    })
    check('cwp.cardAboveY', above.y, 132)
    const tooTall = captureSelectionCardGlobalCenter({
      anchorFrame: { x: 400, y: 5, width: 200, height: 50 },
      cardSize: { width: 200, height: 800 },
      visibleFrame,
    })
    check('cwp.cardInvertedClampY', tooTall.y, 400)
    const farRight = captureSelectionCardGlobalCenter({
      anchorFrame: { x: 980, y: 300, width: 20, height: 50 }, cardSize, visibleFrame,
    })
    check('cwp.cardClampedRight', farRight.x, 884)

    const local = captureSelectionCardLocalCenter({
      anchorFrame: { x: 400, y: 300, width: 200, height: 50 },
      cardSize,
      screenFrame: { x: 0, y: 0, width: 1000, height: 800 },
      visibleFrame,
    })
    check('cwp.cardLocalX', local.x, 500)
    check('cwp.cardLocalY', local.y, 562)
    const offsetLocal = captureSelectionCardLocalCenter({
      anchorFrame: { x: 400, y: 300, width: 200, height: 50 },
      cardSize,
      screenFrame: { x: 100, y: 50, width: 1000, height: 800 },
      visibleFrame: { x: 100, y: 50, width: 1000, height: 800 },
    })
    check('cwp.cardLocalOffsetX', offsetLocal.x, 400)
  }

  check('cwp.clampInside', clampCenter(5, 0, 10), 5)
  check('cwp.clampLow', clampCenter(-5, 0, 10), 0)
  check('cwp.clampHigh', clampCenter(50, 0, 10), 10)
  check('cwp.clampInverted', clampCenter(0, 10, 4), 7)

  check('cwp.a11yDisplay', recorderCaptureSourceAccessibilityID('display'), 'recorder.capture-source.display')
  check('cwp.a11yWindow', recorderCaptureSourceAccessibilityID('window'), 'recorder.capture-source.window')
  check('cwp.a11yArea', recorderCaptureSourceAccessibilityID('area'), 'recorder.capture-source.area')
  check('cwp.a11yDevice', recorderCaptureSourceAccessibilityID('device'), 'recorder.capture-source.device')
  check('cwp.a11yKeys', Object.keys(RECORDER_CAPTURE_SOURCE_ACCESSIBILITY_IDS).join(','),
    'display,window,area,device')
  check('cwp.cameraPreviewID', CAMERA_PREVIEW_WINDOW_IDENTIFIER, 'cn.laogou.dogsc.camera-preview')
  check('cwp.anchorNull', recorderAnchorFrame(null), null)
  check('cwp.anchorZero',
    recorderAnchorFrame({ x: 0, y: 0, width: 0, height: 40 }), null)
  check('cwp.anchorOk',
    recorderAnchorFrame({ x: 1, y: 2, width: 3, height: 4 }).width, 3)

  check('cwp.rectIntersectNull',
    rectIntersection({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 }), null)
  {
    const overlap = rectIntersection({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })
    check('cwp.rectIntersect', `${overlap.x},${overlap.y},${overlap.width},${overlap.height}`, '5,5,5,5')
  }

  // ---------------------------------------------------------------------------
  // EditorColorPalette.swift（178 行）
  // ---------------------------------------------------------------------------
  check('cp.width', COLOR_PALETTE_WIDTH, 272)
  check('cp.padding', COLOR_PALETTE_PADDING, 16)
  check('cp.planeHeight', COLOR_PALETTE_PLANE_HEIGHT, 164)
  check('cp.thumb', `${COLOR_PALETTE_THUMB_SIZE},${COLOR_PALETTE_THUMB_RADIUS}`, '16,8')
  check('cp.hueStrip', `${COLOR_PALETTE_HUE_STRIP_INSET},${COLOR_PALETTE_HUE_STRIP_HEIGHT}`, '8,20')
  check('cp.brightnessStep', COLOR_PALETTE_BRIGHTNESS_STEP, 0.05)
  check('cp.hueStep', COLOR_PALETTE_HUE_STEP, 0.025)
  check('cp.hueThreshold', COLOR_PALETTE_HUE_RETAIN_THRESHOLD, 0.0001)
  check('cp.invalidHint', COLOR_PALETTE_INVALID_HINT, '请输入六位色值，例如 #EDA647')

  {
    const red = hsbFromRgb({ red: 1, green: 0, blue: 0 })
    check('cp.hsbRedHue', red.hue, 0)
    check('cp.hsbRedSaturation', red.saturation, 1)
    check('cp.hsbRedBrightness', red.brightness, 1)
    const green = hsbFromRgb({ red: 0, green: 1, blue: 0 })
    check('cp.hsbGreenHue', green.hue, 1 / 3)
    const blue = hsbFromRgb({ red: 0, green: 0, blue: 1 })
    check('cp.hsbBlueHue', blue.hue, 2 / 3)
    const gray = hsbFromRgb({ red: 0.5, green: 0.5, blue: 0.5 })
    check('cp.hsbGraySaturation', gray.saturation, 0)
    check('cp.hsbGrayHue', gray.hue, 0)
    const black = hsbFromRgb({ red: 0, green: 0, blue: 0 })
    check('cp.hsbBlackBrightness', black.brightness, 0)
    check('cp.hsbBlackSaturation', black.saturation, 0)
  }
  {
    const back = hsbToRgb({ hue: 0, saturation: 1, brightness: 1 })
    check('cp.hsvToRgbRed', `${back.red},${back.green},${back.blue}`, '1,0,0')
    const white = hsbToRgb({ hue: 0.3, saturation: 0, brightness: 1 })
    check('cp.hsvToRgbWhite', `${white.red},${white.green},${white.blue}`, '1,1,1')
    const wrapped = hsbToRgb({ hue: 1.25, saturation: 1, brightness: 1 })
    check('cp.hsvWrapHue', wrapped.green, 1)
  }

  check('cp.rebaseKeepsHue',
    colorPaletteRebase({ hue: 0.7, saturation: 0.5, brightness: 0.5 }, { hue: 0, saturation: 0, brightness: 0 }).hue, 0.7)
  check('cp.rebaseTakesHue',
    colorPaletteRebase({ hue: 0.7, saturation: 0.5, brightness: 0.5 }, { hue: 0.2, saturation: 0.4, brightness: 0.9 }).hue, 0.2)
  check('cp.rebaseThresholdBoundary',
    colorPaletteRebase({ hue: 0.7, saturation: 0, brightness: 0 }, { hue: 0.2, saturation: 0.0001, brightness: 0.5 }).hue, 0.7)

  {
    const point = colorPalettePlanePoint({ saturation: 0.5, brightness: 1, width: 200, height: 100 })
    check('cp.planePointX', point.x, 100)
    check('cp.planePointYClamped', point.y, 8)
    const maxPoint = colorPalettePlanePoint({ saturation: 1, brightness: 0, width: 200, height: 100 })
    check('cp.planePointXMax', maxPoint.x, 192)
    check('cp.planePointYMax', maxPoint.y, 92)
    const drag = colorPalettePlaneDragValue({ x: 100, y: 50, width: 200, height: 100 })
    check('cp.planeDragSaturation', drag.saturation, 0.5)
    check('cp.planeDragBrightness', drag.brightness, 0.5)
    const zero = colorPalettePlaneDragValue({ x: 100, y: 50, width: 0, height: 0 })
    check('cp.planeDragZeroWidth', zero.saturation, 1)
    check('cp.planeDragZeroHeight', zero.brightness, 0)
  }

  check('cp.hueTravel', colorPaletteHueTravel(200), 184)
  check('cp.hueTravelFloor', colorPaletteHueTravel(4), 1)
  check('cp.hueThumbHalf', colorPaletteHueThumbOffset(0.5, 200), 92)
  check('cp.hueDragStart', colorPaletteHueDragValue(8, 200), 0)
  check('cp.hueDragEnd', colorPaletteHueDragValue(192, 200), 1)
  check('cp.hueDragMiddle', colorPaletteHueDragValue(100, 200), 0.5)
  check('cp.hueDragNegative', colorPaletteHueDragValue(0, 200), 0)
  check('cp.hueGradient', colorPaletteHueGradientHues().join(','), '0,0.16666666666666666,0.3333333333333333,0.5,0.6666666666666666,0.8333333333333334,1')

  check('cp.hexValidHash', colorPaletteHexIsValid('#EDA647'), true)
  check('cp.hexValidPlain', colorPaletteHexIsValid('EDA647'), true)
  check('cp.hexInvalidShort', colorPaletteHexIsValid('#EDA64'), false)
  check('cp.hexInvalidEmpty', colorPaletteHexIsValid(''), false)
  check('cp.hexPreviewNull', colorPaletteHexPreview('#EDA64'), null)
  check('cp.hexPreviewValue', colorPaletteHexPreview('#EDA647').hexString, '#EDA647')
  check('cp.submitText', colorPaletteSubmitText(colorPaletteHexPreview('#123456')), '#123456')

  check('cp.planeA11y',
    colorPalettePlaneAccessibilityValue({ hue: 0.1, saturation: 0.5, brightness: 0.8 }),
    '饱和度 50%，亮度 80%')
  check('cp.hueA11y', colorPaletteHueAccessibilityValue(0.5), '180 度')
  check('cp.hexA11y', colorPaletteHexAccessibilityLabel('文字颜色'), '文字颜色十六进制值')
  check('cp.hexFromHsb', colorPaletteHexFromHsb({ hue: 0, saturation: 1, brightness: 1 }).hexString, '#FF0000')
  check('cp.hexFromHsbBlack', colorPaletteHexFromHsb({ hue: 0.5, saturation: 0, brightness: 0 }).hexString, '#000000')

  // ---------------------------------------------------------------------------
  // EditorScenePresetSheet.swift（179 行）
  // ---------------------------------------------------------------------------
  check('sps.titleSave', scenePresetSheetTitle(false), '保存场景预设')
  check('sps.titleUpdate', scenePresetSheetTitle(true), '更新场景预设')
  check('sps.saveTitleSave', scenePresetSaveTitle(false), '保存预设')
  check('sps.saveTitleUpdate', scenePresetSaveTitle(true), '更新预设')
  check('sps.subtitle', SCENE_PRESET_SHEET_SUBTITLE, '把这套配置留给下一次录制。')
  check('sps.placeholder', SCENE_PRESET_NAME_PLACEHOLDER, '例如：全屏上下裁切')
  check('sps.conflictHint',
    SCENE_PRESET_CONFLICT_HINT, '这个名称已存在，请换一个名称；更新已有预设请使用“更新此预设”。')
  check('sps.savingLabel', SCENE_PRESET_SAVING_LABEL, '正在保存背景与配置…')
  check('sps.applyLabel', SCENE_PRESET_APPLY_LABEL, '应用预设')
  check('sps.footnotePrefix', SCENE_PRESET_FOOTNOTE.startsWith('保留当前项目的素材'), true)
  check('sps.sheetWidth', SCENE_PRESET_SHEET_WIDTH, 480)
  check('sps.sheetPadding', SCENE_PRESET_SHEET_PADDING, 24)
  check('sps.previewWidth', SCENE_PRESET_PREVIEW_WIDTH, 500)
  check('sps.rowCount', SCENE_PRESET_CONFIGURATION_ROWS.length, 4)
  check('sps.rowTitles',
    SCENE_PRESET_CONFIGURATION_ROWS.map((r) => r.title).join(','),
    '画布与屏幕,摄像头,光标与运镜,声音与背景')
  check('sps.rowIcons',
    SCENE_PRESET_CONFIGURATION_ROWS.map((r) => r.icon).join(','),
    'rectangle.inset.filled,person.crop.rectangle,cursorarrow.motionlines,speaker.wave.2')
  check('sps.previewTexts',
    `${SCENE_PRESET_PREVIEW_TEXTS.title}|${SCENE_PRESET_PREVIEW_TEXTS.thumbnailUnavailable}`,
    '检查裁切适配|预览暂不可用，可取消后稍后重试。')

  check('sps.saveEnabled',
    scenePresetSaveEnabled({ isSaving: false, nameConflict: false, name: '场景 A' }), true)
  check('sps.saveBlockedSaving',
    scenePresetSaveEnabled({ isSaving: true, nameConflict: false, name: '场景 A' }), false)
  check('sps.saveBlockedConflict',
    scenePresetSaveEnabled({ isSaving: false, nameConflict: true, name: '场景 A' }), false)
  check('sps.saveBlockedBlank',
    scenePresetSaveEnabled({ isSaving: false, nameConflict: false, name: '   ' }), false)
  check('sps.saveBlockedEmpty',
    scenePresetSaveEnabled({ isSaving: false, nameConflict: false, name: '' }), false)
  check('sps.saveAllowsInnerSpace',
    scenePresetSaveEnabled({ isSaving: false, nameConflict: false, name: ' 场景 A ' }), true)

  {
    const landscape = scenePresetPreviewSize({ width: 1920, height: 1080 })
    check('sps.previewLandscapeWidth', landscape.width, 452)
    check('sps.previewLandscapeHeight', landscape.height, 254.25)
    const portrait = scenePresetPreviewSize({ width: 1080, height: 1920 })
    check('sps.previewPortraitWidth', portrait.width, 146.25)
    check('sps.previewPortraitHeight', portrait.height, 260)
    const square = scenePresetPreviewSize({ width: 500, height: 500 })
    check('sps.previewSquare', `${square.width},${square.height}`, '260,260')
    const zero = scenePresetPreviewSize({ width: 0, height: 0 })
    check('sps.previewZero', `${zero.width},${zero.height}`, '260,260')
  }

  check('sps.cropSummaryFull',
    sceneCropSummary({ x: 0, y: 0, width: 1, height: 1 }, { width: 1000, height: 500 }), '完整画面')
  check('sps.cropSummaryInsets',
    sceneCropSummary({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, { width: 1000, height: 500 }),
    '上 50 · 下 50 · 左 100 · 右 100 px')
  check('sps.cropSummaryRoundsDown',
    sceneCropSummary({ x: 0.1, y: 0.1049, width: 0.8, height: 0.8 }, { width: 1000, height: 500 }).startsWith('上 52'),
    true)
  check('sps.cropSummaryRoundsUp',
    sceneCropSummary({ x: 0.1, y: 0.105, width: 0.8, height: 0.8 }, { width: 1000, height: 500 }).startsWith('上 53'),
    true)
  check('sps.fullCropDetected', normalizedCropIsFull({ x: 0, y: 0, width: 1, height: 1 }), true)
  check('sps.notFullCrop', normalizedCropIsFull({ x: 0, y: 0, width: 0.9, height: 1 }), false)
  {
    const rect = scenePresetOutlineRect({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 }, { width: 1000, height: 500 })
    check('sps.outlineRect', `${rect.x},${rect.y},${rect.width},${rect.height}`, '100,100,500,200')
  }
  check('sps.dimensionSummaryNull',
    scenePresetDimensionSummary({ sourceDimensions: null, currentSize: { width: 100, height: 50 } }), null)
  check('sps.dimensionSummary',
    scenePresetDimensionSummary({
      sourceDimensions: { width: 2880, height: 1620 },
      currentSize: { width: 1920, height: 1080 },
    }), '2880 × 1620 → 1920 × 1080')
}

await runCaptureWindowBatch()



async function runPreviewAndSelectionBatch() {
  // ========== 7 文件 / 1375 行：预览诊断 / 录制就绪 / 选择反馈 /
  //            选择状态机 / 选择过渡 / 设备目录 / 音频增益分段
  const {
    // ---- PreviewFrameDiagnostics.swift
    PREVIEW_DIAGNOSTICS_ENVIRONMENT_KEY, PREVIEW_DIAGNOSTICS_MAX_CAPTURES,
    PREVIEW_DIAGNOSTICS_CAPTURE_WINDOW_SECONDS, PREVIEW_DIAGNOSTICS_MAX_MEASUREMENTS,
    PREVIEW_DIAGNOSTICS_REPORT_DELAY_SECONDS, PREVIEW_DIAGNOSTICS_INFO_SAMPLE_INTERVAL,
    PREVIEW_DIAGNOSTICS_MAX_PENDING_RENDER_INFO, PREVIEW_DIAGNOSTICS_REPORT_NOTE,
    previewDiagnosticsConfigured, previewDiagnosticsEnqueueFrame,
    previewDiagnosticsPercentile, previewDiagnosticsStats,
    previewDiagnosticsPresentedFPS, previewDiagnosticsDeadlineDelayMS,
    previewDiagnosticsWithinWindow, previewDiagnosticsShouldCollectRenderInfo,
    previewDiagnosticsRenderInfoUpdate, previewDiagnosticsBuildReport,
    PreviewFrameDiagnostics,
    // ---- CaptureReadiness.swift
    captureDisplayDimensions, captureDisplayPickerLabel, captureDisplayFromSnapshot,
    CAPTURE_UNKNOWN_DISPLAY, captureHasSufficientDisk, captureInsufficientDiskMessage,
    captureDisplayCanShowTargetRate, captureFrameRateWarningText,
    captureAvailableDiskBytes, estimateRecordingBytes, captureReadinessCurrent,
    capturePermissionStateFromAuthorizationStatus, capturePermissionStateLabel,
    CAPTURE_PERMISSION_STATE_LABELS, formatFileByteCount,
    // ---- AppChoiceFeedback.swift
    APP_CHOICE_MINIMUM_PRESS_DURATION, APP_CHOICE_ACTIVATION_RELEASE_WINDOW,
    APP_CHOICE_DISABLED_OPACITY, APP_CHOICE_CONTENT_PRESSED_SCALE,
    APP_CHOICE_ICON_PRESSED_SCALE, APP_CHOICE_PRESS_ANIMATION_SECONDS,
    APP_CHOICE_PRESS_DEFAULT, appChoiceKeyPressDecision, AppChoiceFeedback,
    appChoiceContentScale, appChoiceIconScale,
    // ---- CaptureSelectionState.swift
    makeCaptureSelectionToken, captureSelectionTokensEqual, captureSelectionTargetSource,
    materializeCaptureSelectionTarget, CAPTURE_SELECTION_IDLE, captureSelectionSession,
    captureSelectionSelectedSource, captureSelectionTarget, captureSelectionCanStartRecording,
    captureSelectionTargetsEqual, captureSelectionStatesEqual, reduceCaptureSelection,
    CaptureSelectionCoordinator,
    // ---- CaptureSelectionTransition.swift
    CAPTURE_SELECTION_PRESENT_FADE_SECONDS, CAPTURE_SELECTION_RETIRE_FADE_SECONDS,
    CAPTURE_SELECTION_CARD_HIDE_SECONDS, CAPTURE_SELECTION_CARD_OFFSET_Y,
    CAPTURE_SELECTION_CARD_SCALE, CAPTURE_SELECTION_CARD_MOTION_SECONDS,
    CAPTURE_SELECTION_RETIRE_PREREQUISITES, captureSelectionFadePlan,
    captureSelectionPresentStartAlpha, CaptureSelectionWindowTransition,
    captureSelectionCardShowPlan, framesEqual, captureSelectionCardHidePlan,
    captureSelectionCardAnimatePlan, captureSelectionCardMotion,
    CaptureSelectionCardTransition,
    // ---- CaptureDeviceCatalog.swift
    runtimeFormatResolution, runtimeFormatLabel, captureDeviceInfos,
    CAPTURE_DEVICE_IOS_MODEL_ID, CAPTURE_DEVICE_DISCOVERY_ROLES,
    captureDeviceRequiresIOSModelID, captureDeviceIsEligible,
    captureEnableIOSScreenCaptureDecision, captureDeviceResolutionsFromFormats,
    captureDeviceDefaultQueryForRequest, captureResolveLiveDevice,
    CaptureDeviceCatalogScheduler,
    // ---- TimelineAudioGainProcessor.swift
    TIMELINE_AUDIO_GAIN_EPSILON, timelineAudioGainClamped, timelineAudioGainValidSpans,
    timelineAudioGainNeedsProcessor, timelineAudioGainParametersPlan,
    timelineAudioGainFirstSpanIndex, timelineAudioGainNextBoundaryFrame,
    timelineAudioGainSegments, timelineAudioGainScaleKind, timelineAudioGainSampleCount,
    // ---- 依赖（CaptureConfiguration，本批顺带导出）
    makeCaptureConfiguration,
  } = m

  // ---------------------------------------------------------------------------
  // PreviewFrameDiagnostics.swift（180 行）
  // ---------------------------------------------------------------------------
  check('pfd.envKey', PREVIEW_DIAGNOSTICS_ENVIRONMENT_KEY, 'DOGSC_PREVIEW_DIAGNOSTICS')
  check('pfd.configuredOn', previewDiagnosticsConfigured({ DOGSC_PREVIEW_DIAGNOSTICS: '1' }), true)
  check('pfd.configuredTrueString',
    previewDiagnosticsConfigured({ DOGSC_PREVIEW_DIAGNOSTICS: 'true' }), false)
  check('pfd.configuredAbsent', previewDiagnosticsConfigured({}), false)
  check('pfd.maxCaptures', PREVIEW_DIAGNOSTICS_MAX_CAPTURES, 3)
  check('pfd.windowSeconds', PREVIEW_DIAGNOSTICS_CAPTURE_WINDOW_SECONDS, 10)
  check('pfd.maxMeasurements', PREVIEW_DIAGNOSTICS_MAX_MEASUREMENTS, 900)
  check('pfd.reportDelay', PREVIEW_DIAGNOSTICS_REPORT_DELAY_SECONDS, 11)
  check('pfd.infoInterval', PREVIEW_DIAGNOSTICS_INFO_SAMPLE_INTERVAL, 0.25)
  check('pfd.maxPending', PREVIEW_DIAGNOSTICS_MAX_PENDING_RENDER_INFO, 4)

  const enqueued = previewDiagnosticsEnqueueFrame(
    { captureID: 2, index: 5, queuedAt: 1, collectsRenderInfo: true }, 9.5)
  check('pfd.enqueueQueuedAt', enqueued.queuedAt, 9.5)
  check('pfd.enqueueKeepsCaptureID', enqueued.captureID, 2)
  check('pfd.enqueueKeepsIndex', enqueued.index, 5)
  check('pfd.enqueueKeepsCollects', enqueued.collectsRenderInfo, true)

  check('pfd.percentileTwenty',
    previewDiagnosticsPercentile([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20], 0.95), 19)
  check('pfd.percentileSingle', previewDiagnosticsPercentile([7], 0.95), 7)
  check('pfd.percentileEmpty', previewDiagnosticsPercentile([], 0.95), 0)
  check('pfd.percentileZeroFraction', previewDiagnosticsPercentile([3, 9], 0), 3)

  check('pfd.statsEmptyNull', previewDiagnosticsStats([]), null)
  const st = previewDiagnosticsStats([2, 4, 6])
  check('pfd.statsCount', st.count, 3)
  check('pfd.statsMean', st.mean, 4)
  check('pfd.statsP95', st.p95, 4)
  check('pfd.statsMax', st.max, 6)

  check('pfd.fpsSixtyInOneSecond', previewDiagnosticsPresentedFPS(61, 1), 60)
  check('pfd.fpsZeroSpan', previewDiagnosticsPresentedFPS(61, 0), 0)
  check('pfd.fpsSingleShown', previewDiagnosticsPresentedFPS(1, 2), 0)
  check('pfd.fpsNegativeSpan', previewDiagnosticsPresentedFPS(5, -1), 0)

  check('pfd.deadlineClampedEarly', previewDiagnosticsDeadlineDelayMS(1.0, 1.2), 0)
  check('pfd.deadlineLate', previewDiagnosticsDeadlineDelayMS(1.25, 1.2), 50, 1e-6)

  check('pfd.withinWindow', previewDiagnosticsWithinWindow(0, 9.9), true)
  check('pfd.atWindowEdge', previewDiagnosticsWithinWindow(0, 10), false)

  check('pfd.collectFirstFrame',
    previewDiagnosticsShouldCollectRenderInfo({ now: 100, lastInfoSampleAt: 0, pendingRenderInfo: 0 }), true)
  check('pfd.collectTooSoon',
    previewDiagnosticsShouldCollectRenderInfo({ now: 100.1, lastInfoSampleAt: 100, pendingRenderInfo: 0 }), false)
  check('pfd.collectBackpressure',
    previewDiagnosticsShouldCollectRenderInfo({ now: 100, lastInfoSampleAt: 0, pendingRenderInfo: 4 }), false)
  check('pfd.collectUnderLimit',
    previewDiagnosticsShouldCollectRenderInfo({ now: 100.3, lastInfoSampleAt: 100, pendingRenderInfo: 3 }), true)

  const renderInfo = previewDiagnosticsRenderInfoUpdate(
    { kernelCompileSeconds: 0.002, kernelExecutionSeconds: 0.004, passCount: 3, pixelsProcessed: 1000 })
  check('pfd.renderInfoCompileMS', renderInfo.compileMS, 2)
  check('pfd.renderInfoExecutionMS', renderInfo.executionMS, 4)
  check('pfd.renderInfoPasses', renderInfo.passes, 3)
  check('pfd.renderInfoPixels', renderInfo.pixels, 1000)

  {
    const diag = new PreviewFrameDiagnostics()
    const first = diag.beginFrame({ epoch: 10, outputTime: 0, target: 0, evaluationMS: 1, now: 0 })
    check('pfd.classFirstCapture', first.captureID, 1)
    check('pfd.classFirstIndex', first.index, 0)
    // 首帧时 lastInfoSampleAt 仍是 0，now 也是 0 → 0 - 0 < 0.25 → 不采样
    check('pfd.classFirstNoInfo', first.collectsRenderInfo, false)
    const second = diag.beginFrame({ epoch: 10, outputTime: 1, target: 1, evaluationMS: 2, now: 0.3 })
    check('pfd.classSameEpochIndex', second.index, 1)
    check('pfd.classSecondCollects', second.collectsRenderInfo, true)
    diag.encoded(second, { queueMS: 1, graphMS: 2, drawableWaitMS: 3, encodeMS: 4 })
    diag.presented(second, 1.5)
    // 0 表示没显示 → 不得写入
    const third = diag.beginFrame({ epoch: 10, outputTime: 2, target: 2, evaluationMS: 3, now: 0.6 })
    diag.presented(third, 0)
    const report = diag.report(1)
    check('pfd.classReportTicks', report.ticks, 3)
    check('pfd.classReportSubmitted', report.submitted, 1)
    check('pfd.classReportPresented', report.actuallyPresented, 1)
    check('pfd.classReportPresentedFPS', report.presentedFPS, 0)
    check('pfd.classReportOutputStart', report.outputStart, 0)
    check('pfd.classReportOutputEnd', report.outputEnd, 2)
    check('pfd.classReportEpoch', report.epoch, 10)
    check('pfd.classReportNullAfterRemoval', diag.report(1), null)
    check('pfd.classReportNote', report.note, PREVIEW_DIAGNOSTICS_REPORT_NOTE)
    // 已出报告之后同 epoch 的帧：captureCount 仍指向那条已删除的批次
    check('pfd.classAfterReportRejected',
      diag.beginFrame({ epoch: 10, outputTime: 3, target: 3, evaluationMS: 4, now: 0.9 }), null)
  }

  {
    const diag = new PreviewFrameDiagnostics()
    check('pfd.capEpoch1',
      diag.beginFrame({ epoch: 1, outputTime: 0, target: 0, evaluationMS: 0, now: 0 }) != null, true)
    check('pfd.capEpoch2',
      diag.beginFrame({ epoch: 2, outputTime: 0, target: 0, evaluationMS: 0, now: 0 }) != null, true)
    check('pfd.capEpoch3',
      diag.beginFrame({ epoch: 3, outputTime: 0, target: 0, evaluationMS: 0, now: 0 }) != null, true)
    check('pfd.capEpoch4Rejected',
      diag.beginFrame({ epoch: 4, outputTime: 0, target: 0, evaluationMS: 0, now: 0 }), null)
    check('pfd.capCount', diag.captureCountValue, 3)
    // 第 4 个 epoch 被拒时不能污染 lastEpoch
    check('pfd.capLastEpoch', diag.lastEpochValue, 3)
  }

  {
    const diag = new PreviewFrameDiagnostics()
    diag.beginFrame({ epoch: 1, outputTime: 0, target: 0, evaluationMS: 0, now: 0 })
    check('pfd.windowInside',
      diag.beginFrame({ epoch: 1, outputTime: 1, target: 1, evaluationMS: 1, now: 9.99 }) != null, true)
    check('pfd.windowOutside',
      diag.beginFrame({ epoch: 1, outputTime: 2, target: 2, evaluationMS: 2, now: 10 }), null)
  }

  {
    const diag = new PreviewFrameDiagnostics()
    let accepted = 0
    let rejectedAt = -1
    for (let index = 0; index < 901; index += 1) {
      const frame = diag.beginFrame({ epoch: 1, outputTime: index, target: index, evaluationMS: 0, now: 0 })
      if (frame == null) { rejectedAt = index } else { accepted += 1 }
    }
    check('pfd.maxMeasurementsAccepted', accepted, 900)
    check('pfd.maxMeasurementsRejectedAt', rejectedAt, 900)
  }

  {
    const diag = new PreviewFrameDiagnostics()
    const frame = diag.beginFrame({ epoch: 1, outputTime: 0, target: 0, evaluationMS: 0, now: 100 })
    check('pfd.reserveOK', diag.reserveRenderInfo(frame), true)
    check('pfd.reservePending', diag.pendingRenderInfoCount, 1)
    diag.releaseRenderInfo(frame, null)
    check('pfd.releasePending', diag.pendingRenderInfoCount, 0)
    diag.releaseRenderInfo(frame, { kernelCompileSeconds: 0.001, kernelExecutionSeconds: 0.003, passCount: 1, pixelsProcessed: 10 })
    check('pfd.releaseNeverNegative', diag.pendingRenderInfoCount, 0)
    const report = diag.report(1)
    check('pfd.releaseAppliedCompile', report.ciKernelCompileMS.max, 1)
    check('pfd.releaseAppliedExecution', report.ciKernelExecutionMS.max, 3)
    // 报告已摘掉 → 再预留必须失败
    check('pfd.reserveAfterReport', diag.reserveRenderInfo(frame), false)
  }

  check('pfd.coalescedCount', (() => {
    const diag = new PreviewFrameDiagnostics()
    const frame = diag.beginFrame({ epoch: 1, outputTime: 0, target: 0, evaluationMS: 0, now: 0 })
    diag.coalesced(frame)
    diag.failed(frame)
    const report = diag.report(1)
    return `${report.coalesced}/${report.failed}`
  })(), '1/1')

  check('pfd.buildReportFPS', (() => {
    const report = previewDiagnosticsBuildReport(1, {
      epoch: 7, startedAt: 0, lastInfoSampleAt: 0,
      measurements: [
        { outputTime: 0, target: 0, evaluationMS: 0, presentedAt: 1.0 },
        { outputTime: 1, target: 1, evaluationMS: 0, presentedAt: 1.5 },
        { outputTime: 2, target: 2, evaluationMS: 0 },
      ],
    })
    return `${report.actuallyPresented}:${report.presentedFPS}`
  })(), '2:2')
  check('pfd.buildReportIntervals', (() => {
    const report = previewDiagnosticsBuildReport(1, {
      epoch: 7, startedAt: 0, lastInfoSampleAt: 0,
      measurements: [
        { outputTime: 0, target: 0, evaluationMS: 0, presentedAt: 1.0 },
        { outputTime: 1, target: 1, evaluationMS: 0, presentedAt: 1.5 },
      ],
    })
    return report.displayIntervalMS.max
  })(), 500)
  const deadlineReport = previewDiagnosticsBuildReport(1, {
    epoch: 7, startedAt: 0, lastInfoSampleAt: 0,
    measurements: [
      { outputTime: 0, target: 1.0, evaluationMS: 0, presentedAt: 1.2 },
      // 提前送达（1.9 < 2.0）夹到 0，不得算成负延迟
      { outputTime: 1, target: 2.0, evaluationMS: 0, presentedAt: 1.9 },
    ],
  })
  check('pfd.buildReportDeadlineMax', deadlineReport.deadlineDelayMS.max, 200, 1e-6)
  check('pfd.buildReportDeadlineMean', deadlineReport.deadlineDelayMS.mean, 100, 1e-6)

  // ---------------------------------------------------------------------------
  // CaptureReadiness.swift（181 行）
  // ---------------------------------------------------------------------------
  const display5K = { id: 1, name: 'Studio Display', width: 5120, height: 2880, refreshRate: 60 }
  check('cr.h264Envelope', (() => {
    const d = captureDisplayDimensions(display5K, 'h264')
    return `${d.width}x${d.height}`
  })(), '4096x2304')
  check('cr.nativeEnvelope', (() => {
    const d = captureDisplayDimensions(display5K, 'hevc')
    return `${d.width}x${d.height}`
  })(), '5120x2880')
  check('cr.pickerLabel', captureDisplayPickerLabel(
    { id: 2, name: '内置', width: 2560, height: 1440, refreshRate: 60 }),
    '内置 · 2560×1440 · 60 Hz')

  check('cr.snapshotNoID', captureDisplayFromSnapshot({
    displayID: null, name: 'x', modeRefreshRate: 60, maximumFramesPerSecond: 60,
    pixelWidth: 100, pixelHeight: 100 }), null)
  check('cr.snapshotRefreshFallback', captureDisplayFromSnapshot({
    displayID: 1, name: 'x', modeRefreshRate: 0, maximumFramesPerSecond: 120,
    pixelWidth: 100, pixelHeight: 100 }).refreshRate, 120)
  check('cr.snapshotRefreshMin', captureDisplayFromSnapshot({
    displayID: 1, name: 'x', modeRefreshRate: 0, maximumFramesPerSecond: 0,
    pixelWidth: 100, pixelHeight: 100 }).refreshRate, 1)
  check('cr.snapshotRefreshRounded', captureDisplayFromSnapshot({
    displayID: 1, name: 'x', modeRefreshRate: 59.94, maximumFramesPerSecond: 60,
    pixelWidth: 100, pixelHeight: 100 }).refreshRate, 60)
  check('cr.snapshotDimensionFloor', (() => {
    const d = captureDisplayFromSnapshot({
      displayID: 1, name: 'x', modeRefreshRate: 60, maximumFramesPerSecond: 60,
      pixelWidth: 0, pixelHeight: 0 })
    return `${d.width}x${d.height}`
  })(), '1x1')

  const readinessBase = {
    hasScreenRecordingPermission: true, availableDiskBytes: 1_000_000_000,
    estimatedOneMinuteBytes: 1_000_000_000, displayRefreshRate: 60,
    targetFrameRate: 60, captureCodec: 'h264',
  }
  check('cr.sufficientNull', captureHasSufficientDisk({ ...readinessBase, availableDiskBytes: null }), true)
  check('cr.sufficientEqual', captureHasSufficientDisk(readinessBase), true)
  check('cr.insufficient',
    captureHasSufficientDisk({ ...readinessBase, availableDiskBytes: 999_999_999 }), false)
  check('cr.messageNullWhenEnough', captureInsufficientDiskMessage(readinessBase), null)
  check('cr.messageNullWhenUnknown',
    captureInsufficientDiskMessage({ ...readinessBase, availableDiskBytes: null }), null)
  check('cr.messageText',
    captureInsufficientDiskMessage({ ...readinessBase, availableDiskBytes: 500_000_000 }),
    '开始录制需预留约 1 分钟的空间（1 GB），当前可用 500 MB。请再释放约 500 MB 后重试。')

  check('cr.canShowNull',
    captureDisplayCanShowTargetRate({ ...readinessBase, displayRefreshRate: null }), true)
  check('cr.canShowEqual', captureDisplayCanShowTargetRate(readinessBase), true)
  check('cr.canShowBelow',
    captureDisplayCanShowTargetRate({ ...readinessBase, displayRefreshRate: 30 }), false)
  check('cr.warningNull', captureFrameRateWarningText(readinessBase), null)
  check('cr.warningText',
    captureFrameRateWarningText({ ...readinessBase, displayRefreshRate: 30 }),
    '目标为 60 FPS，但显示器当前仅报告 30 Hz；录制会保留实际帧率，不会补帧冒充。')

  check('cr.diskWalksUp', captureAvailableDiskBytes({
    workingFolder: '/Users/me/Library/Working',
    pathExists: (p) => p === '/Users/me',
    freeBytesAtPath: (p) => (p === '/Users/me' ? 42 : null),
  }), 42)
  check('cr.diskExistingFolder', captureAvailableDiskBytes({
    workingFolder: '/data',
    pathExists: () => true,
    freeBytesAtPath: (p) => (p === '/data' ? 7 : null),
  }), 7)
  check('cr.diskRootFallback', captureAvailableDiskBytes({
    workingFolder: '/a/b/c',
    pathExists: (p) => p === '/',
    freeBytesAtPath: (p) => (p === '/' ? 11 : null),
  }), 11)

  const noBitrate = () => 2_000_000
  check('cr.estimateProRes', estimateRecordingBytes({
    width: 1920, height: 1080, frameRate: 30, codec: 'proRes422', duration: 60,
    exportBitrate: noBitrate,
  }), 934_560_000)
  check('cr.estimateProResFloor', estimateRecordingBytes({
    width: 320, height: 240, frameRate: 30, codec: 'proRes422', duration: 60,
    exportBitrate: noBitrate,
  }), 751_440_000)
  check('cr.estimateHevc', estimateRecordingBytes({
    width: 1920, height: 1080, frameRate: 30, codec: 'hevc', duration: 60,
    exportBitrate: noBitrate,
  }), 16_440_000)

  check('cr.currentFirstDisplay', (() => {
    const r = captureReadinessCurrent({
      displays: [{ id: 3, name: 'A', width: 1920, height: 1080, refreshRate: 60 }],
      displayID: null, targetFrameRate: 60, captureCodec: 'hevc',
      hasScreenRecordingPermission: true, availableDiskBytes: 100,
      exportBitrate: noBitrate,
    })
    return `${r.displayRefreshRate}:${r.estimatedOneMinuteBytes}`
  })(), '60:16440000')
  check('cr.currentByID', (() => {
    const r = captureReadinessCurrent({
      displays: [
        { id: 3, name: 'A', width: 1920, height: 1080, refreshRate: 60 },
        { id: 4, name: 'B', width: 1280, height: 720, refreshRate: 30 },
      ],
      displayID: 4, targetFrameRate: 30, captureCodec: 'h264',
      hasScreenRecordingPermission: false, availableDiskBytes: null,
      exportBitrate: noBitrate,
    })
    return `${r.displayRefreshRate}:${r.hasScreenRecordingPermission}`
  })(), '30:false')
  check('cr.currentUnknownDisplay', (() => {
    const r = captureReadinessCurrent({
      displays: [], displayID: 9, targetFrameRate: 60, captureCodec: 'hevc',
      hasScreenRecordingPermission: true, availableDiskBytes: 0,
      exportBitrate: noBitrate,
    })
    return `${r.displayRefreshRate}:${r.estimatedOneMinuteBytes}`
  })(), `60:${CAPTURE_UNKNOWN_DISPLAY.width === 1920 ? 16_440_000 : -1}`)

  check('cr.permissionUnknown', capturePermissionStateFromAuthorizationStatus('unknown'), 'restricted')
  check('cr.permissionAuthorized',
    capturePermissionStateFromAuthorizationStatus('authorized'), 'authorized')
  check('cr.permissionLabel', capturePermissionStateLabel('denied'), '未授权')
  check('cr.permissionLabels', Object.keys(CAPTURE_PERMISSION_STATE_LABELS).length, 4)

  check('cr.byteCount999', formatFileByteCount(999), '999 bytes')
  check('cr.byteCount1000', formatFileByteCount(1000), '1 KB')
  check('cr.byteCount1500', formatFileByteCount(1500), '1.5 KB')
  check('cr.byteCountZero', formatFileByteCount(0), '0 bytes')
  check('cr.byteCountNaN', formatFileByteCount(Number.NaN), '0 bytes')

  // ---------------------------------------------------------------------------
  // AppChoiceFeedback.swift（182 行）
  // ---------------------------------------------------------------------------
  check('acf.minimumPress', APP_CHOICE_MINIMUM_PRESS_DURATION, 0.1)
  check('acf.activationWindow', APP_CHOICE_ACTIVATION_RELEASE_WINDOW, 0.05)
  check('acf.disabledOpacity', APP_CHOICE_DISABLED_OPACITY, 0.45)
  check('acf.contentScale', APP_CHOICE_CONTENT_PRESSED_SCALE, 0.96)
  check('acf.iconScale', APP_CHOICE_ICON_PRESSED_SCALE, 0.9)
  check('acf.pressAnimation', APP_CHOICE_PRESS_ANIMATION_SECONDS, 0.09)
  check('acf.defaultNotPressed', APP_CHOICE_PRESS_DEFAULT.pressed, false)

  check('acf.keyDisabled',
    appChoiceKeyPressDecision({ key: 'return', isEnabled: false, modifiers: [] }), 'ignored')
  check('acf.keyWithModifier',
    appChoiceKeyPressDecision({ key: 'return', isEnabled: true, modifiers: ['command'] }), 'ignored')
  check('acf.keyReturn',
    appChoiceKeyPressDecision({ key: 'return', isEnabled: true, modifiers: [] }), 'handled')
  check('acf.keyOther',
    appChoiceKeyPressDecision({ key: 'space', isEnabled: true, modifiers: [] }), 'ignored')

  {
    const feedback = new AppChoiceFeedback()
    feedback.trackPress(1, true, true)
    check('acf.trackBegins', `${feedback.press.pressed}/${feedback.press.wasSelected}`, 'true/true')
    feedback.trackPress(1.05, false, true)
    check('acf.shortPressHeld', feedback.press.pressed, true)
    check('acf.shortPressDelay', feedback.pendingReleaseDelay(1.05), 0.05, 1e-9)
    check('acf.shortPressSettleEarly', feedback.settle(1.099), false)
    check('acf.shortPressSettleAt', feedback.settle(1.1), true)
    check('acf.shortPressReleased', feedback.press.pressed, false)
    check('acf.shortPressDelayGone', feedback.pendingReleaseDelay(1.2), null)
  }

  {
    const feedback = new AppChoiceFeedback()
    feedback.trackPress(1, true, false)
    feedback.trackPress(1.5, false, false)
    check('acf.longHoldReleasesNow', feedback.press.pressed, false)
    check('acf.longHoldNoDelay', feedback.pendingReleaseDelay(1.5), null)
  }

  {
    const feedback = new AppChoiceFeedback()
    feedback.trackPress(1, true, true)
    // action 与 isPressed=false 的先后任意：这里先等 action
    feedback.activate(1.02, true)
    check('acf.activateConsumesNative', feedback.press.pressed, true)
    feedback.trackPress(1.05, false, true)
    // 若 activate 重新 begin 过，startedAt 会变成 1.02 → 结束于 1.12
    check('acf.activateDidNotRestart', feedback.pendingReleaseDelay(1.05), 0.05, 1e-9)
  }

  {
    const feedback = new AppChoiceFeedback()
    // 键盘/无障碍触发：完全没有原生按下过程
    feedback.activate(5, false)
    check('acf.activateWithoutNative', feedback.press.pressed, true)
    check('acf.activateWithoutNativeDelay', feedback.pendingReleaseDelay(5), 0.1, 1e-9)
    feedback.settle(5.1)
    check('acf.activateSettles', feedback.press.pressed, false)
  }

  check('acf.contentScaleEngaged',
    appChoiceContentScale({ press: { pressed: true, wasSelected: true }, reduceMotion: false }), 0.96)
  check('acf.contentScaleOther',
    appChoiceContentScale({ press: { pressed: true, wasSelected: false }, reduceMotion: false }), 1)
  check('acf.contentScaleReduceMotion',
    appChoiceContentScale({ press: { pressed: true, wasSelected: true }, reduceMotion: true }), 1)
  check('acf.iconScaleEngaged',
    appChoiceIconScale({ press: { pressed: true, wasSelected: false }, reduceMotion: false }), 0.9)
  check('acf.iconScaleSelected',
    appChoiceIconScale({ press: { pressed: true, wasSelected: true }, reduceMotion: false }), 1)

  // ---------------------------------------------------------------------------
  // CaptureSelectionState.swift（204 行）
  // ---------------------------------------------------------------------------
  check('css.tokenEqual',
    captureSelectionTokensEqual(makeCaptureSelectionToken(3), makeCaptureSelectionToken(3)), true)
  check('css.tokenNotEqual',
    captureSelectionTokensEqual(makeCaptureSelectionToken(3), makeCaptureSelectionToken(4)), false)
  check('css.tokenNullEqual', captureSelectionTokensEqual(null, null), true)
  check('css.tokenNullVsValue',
    captureSelectionTokensEqual(null, makeCaptureSelectionToken(1)), false)

  check('css.targetSourceDisplay', captureSelectionTargetSource({ kind: 'display', id: 1, name: 'A' }), 'display')
  check('css.targetSourceWindow',
    captureSelectionTargetSource({ kind: 'window', id: 1, name: 'W',
      applicationBundleIdentifier: null, applicationName: null }), 'window')
  check('css.targetSourceArea',
    captureSelectionTargetSource({ kind: 'area', displayID: null, displayName: null,
      rect: { x: 0, y: 0, width: 1, height: 1 } }), 'area')
  check('css.targetSourceDevice',
    captureSelectionTargetSource({ kind: 'device', id: 'd', name: 'D' }), 'device')

  const selectionBase = makeCaptureConfiguration({
    windowID: 7, windowName: 'OldWindow', deviceID: 'old', deviceName: 'Old',
    area: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    systemAudioScope: 'selectedApplication',
  })
  check('css.materializeDisplayClears',
    (() => {
      const c = materializeCaptureSelectionTarget(selectionBase, { kind: 'display', id: 2, name: 'D2' })
      return `${c.source}:${c.windowID}:${c.deviceID}:${c.area}:${c.displayID}`
    })(), 'display:null:null:null:2')
  check('css.materializeDisplayKeepsScope',
    materializeCaptureSelectionTarget(selectionBase, { kind: 'display', id: 2, name: 'D2' })
      .systemAudioScope, 'selectedApplication')
  check('css.materializeWindowWithoutBundle',
    materializeCaptureSelectionTarget(selectionBase, { kind: 'window', id: 9, name: 'C',
      applicationBundleIdentifier: null, applicationName: null }).systemAudioScope, 'all')
  check('css.materializeWindowWithBundle',
    (() => {
      const c = materializeCaptureSelectionTarget(selectionBase, { kind: 'window', id: 9, name: 'C',
        applicationBundleIdentifier: 'com.example', applicationName: 'C' })
      return `${c.systemAudioScope}:${c.selectedApplicationBundleIdentifier}`
    })(), 'selectedApplication:com.example')
  check('css.materializeAreaConstrained',
    (() => {
      const c = materializeCaptureSelectionTarget(selectionBase, { kind: 'area', displayID: 5,
        displayName: 'D5', rect: { x: -1, y: 0.5, width: 2, height: 2 } })
      return `${c.area.x},${c.area.y},${c.area.width},${c.area.height}`
    })(), '0,0.5,1,0.5')
  check('css.materializeAreaScope',
    materializeCaptureSelectionTarget(selectionBase, { kind: 'area', displayID: 5, displayName: 'D5',
      rect: { x: 0, y: 0, width: 0.5, height: 0.5 } }).systemAudioScope, 'all')
  check('css.materializeDeviceScope',
    materializeCaptureSelectionTarget(selectionBase, { kind: 'device', id: 'cam', name: 'Cam' })
      .systemAudioScope, 'all')

  const t1 = makeCaptureSelectionToken(1)
  const t2 = makeCaptureSelectionToken(2)
  const displayTarget = { kind: 'display', id: 2, name: 'D2' }
  const windowTarget = { kind: 'window', id: 3, name: 'W3',
    applicationBundleIdentifier: null, applicationName: null }

  check('css.reduceChoose',
    reduceCaptureSelection(CAPTURE_SELECTION_IDLE,
      { kind: 'choose', source: 'display', token: t1 }).kind, 'selecting')
  const selecting = reduceCaptureSelection(CAPTURE_SELECTION_IDLE,
    { kind: 'choose', source: 'display', token: t1 })
  check('css.reduceConfirmStaleToken',
    reduceCaptureSelection(selecting, { kind: 'confirm', target: displayTarget, token: t2 }) === selecting, true)
  check('css.reduceConfirmSourceMismatch',
    reduceCaptureSelection(selecting, { kind: 'confirm', target: windowTarget, token: t1 }) === selecting, true)
  const ready = reduceCaptureSelection(selecting, { kind: 'confirm', target: displayTarget, token: t1 })
  check('css.reduceConfirmReady', ready.kind, 'ready')
  check('css.reduceConfirmTarget', captureSelectionTarget(ready).name, 'D2')
  check('css.reduceCanStart', captureSelectionCanStartRecording(ready), true)
  check('css.reduceCanStartSelecting', captureSelectionCanStartRecording(selecting), false)
  check('css.reduceSelectedSource', captureSelectionSelectedSource(ready), 'display')
  check('css.reduceSessionToken', captureSelectionSession(ready).token.rawValue, 1)
  check('css.reduceIdleSession', captureSelectionSession(CAPTURE_SELECTION_IDLE), null)
  check('css.reduceUnlock', reduceCaptureSelection(ready, { kind: 'unlock', token: t1 }).kind, 'selecting')
  check('css.reduceUnlockStale',
    reduceCaptureSelection(ready, { kind: 'unlock', token: t2 }) === ready, true)
  check('css.reduceCancel', reduceCaptureSelection(ready, { kind: 'cancel', token: t1 }).kind, 'idle')
  check('css.reduceCancelStale',
    reduceCaptureSelection(ready, { kind: 'cancel', token: t2 }) === ready, true)

  check('css.targetsEqual',
    captureSelectionTargetsEqual(displayTarget, { kind: 'display', id: 2, name: 'D2' }), true)
  check('css.targetsNotEqual',
    captureSelectionTargetsEqual(displayTarget, { kind: 'display', id: 2, name: 'D3' }), false)
  check('css.targetsDifferentKind',
    captureSelectionTargetsEqual(displayTarget, windowTarget), false)
  check('css.statesEqual', captureSelectionStatesEqual(ready, { ...ready }), true)
  check('css.statesNotEqualKind',
    captureSelectionStatesEqual(ready, selecting), false)

  {
    const coordinator = new CaptureSelectionCoordinator()
    const notifications = []
    const observed = new CaptureSelectionCoordinator((state) => notifications.push(state.kind))
    const session = observed.choose('window')
    check('css.coordinatorToken', session.token.rawValue, 1)
    check('css.coordinatorSource', session.source, 'window')
    check('css.coordinatorIsCurrent', observed.isCurrent(session.token), true)
    check('css.coordinatorIsNotCurrent', observed.isCurrent(makeCaptureSelectionToken(99)), false)
    check('css.coordinatorConfirmMismatch',
      observed.confirm(displayTarget, session.token), false)
    check('css.coordinatorConfirm',
      observed.confirm({ kind: 'window', id: 4, name: 'W4',
        applicationBundleIdentifier: null, applicationName: null }, session.token), true)
    check('css.coordinatorConfirmAgain',
      observed.confirm({ kind: 'window', id: 4, name: 'W4',
        applicationBundleIdentifier: null, applicationName: null }, session.token), false)
    check('css.coordinatorUnlock', observed.unlock(session.token), true)
    check('css.coordinatorUnlockAgain', observed.unlock(session.token), false)
    check('css.coordinatorCancel', observed.cancel(session.token), true)
    check('css.coordinatorCancelIdle', observed.cancel(session.token), false)
    check('css.coordinatorResetIdle', observed.reset(), false)
    observed.choose('device')
    check('css.coordinatorResetActive', observed.reset(), true)
    check('css.coordinatorStateAfterReset', observed.state.kind, 'idle')
    // 状态未变时不通知
    check('css.coordinatorNotifications', notifications.join(','),
      'selecting,ready,selecting,idle,selecting,idle')
    check('css.coordinatorFreshToken', coordinator.choose('display').token.rawValue, 1)
  }

  // ---------------------------------------------------------------------------
  // CaptureSelectionTransition.swift（217 行）
  // ---------------------------------------------------------------------------
  check('cst.presentFade', CAPTURE_SELECTION_PRESENT_FADE_SECONDS, 0.18)
  check('cst.retireFade', CAPTURE_SELECTION_RETIRE_FADE_SECONDS, 0.16)
  check('cst.cardHide', CAPTURE_SELECTION_CARD_HIDE_SECONDS, 0.14)
  check('cst.cardOffset', CAPTURE_SELECTION_CARD_OFFSET_Y, 6)
  check('cst.cardScale', CAPTURE_SELECTION_CARD_SCALE, 0.985)
  check('cst.cardMotionSeconds', CAPTURE_SELECTION_CARD_MOTION_SECONDS, 0.2)
  check('cst.retirePrerequisites', CAPTURE_SELECTION_RETIRE_PREREQUISITES.length, 4)

  check('cst.fadeIn', (() => {
    const p = captureSelectionFadePlan({ retiring: false, reduceMotion: false })
    return `${p.duration}:${p.closeOnCompletion}:${p.immediate}:${p.targetAlpha}`
  })(), '0.18:false:false:1')
  check('cst.fadeOut', (() => {
    const p = captureSelectionFadePlan({ retiring: true, reduceMotion: false })
    return `${p.duration}:${p.closeOnCompletion}:${p.immediate}:${p.targetAlpha}`
  })(), '0.16:true:false:0')
  check('cst.fadeOutReduceMotion', (() => {
    const p = captureSelectionFadePlan({ retiring: true, reduceMotion: true })
    return `${p.duration}:${p.closeOnCompletion}:${p.immediate}:${p.targetAlpha}`
  })(), '0:true:true:0')
  check('cst.presentStartAlpha', captureSelectionPresentStartAlpha(false), 0)
  check('cst.presentStartAlphaReduce', captureSelectionPresentStartAlpha(true), 1)

  {
    const closed = []
    const alphas = []
    const transition = new CaptureSelectionWindowTransition({
      reduceMotion: () => false,
      closeWindow: (key) => closed.push(key),
      setAlpha: (key, alpha) => alphas.push(`${key}=${alpha}`),
    })
    transition.present('a')
    check('cst.presentPending', transition.pendingCount, 1)
    transition.retire(['a'], true)
    check('cst.retireStillPending', transition.pendingCount, 1)
    transition.finishImmediately()
    check('cst.finishClears', transition.pendingCount, 0)
    check('cst.finishCloses', closed.join(','), 'a')
  }

  {
    const closed = []
    const transition = new CaptureSelectionWindowTransition({
      reduceMotion: () => true,
      closeWindow: (key) => closed.push(key),
      setAlpha: () => {},
    })
    transition.retire(['b'], true)
    check('cst.reduceMotionClosesImmediately', closed.join(','), 'b')
    check('cst.reduceMotionNoPending', transition.pendingCount, 0)
  }

  {
    const closed = []
    const transition = new CaptureSelectionWindowTransition({
      reduceMotion: () => false,
      closeWindow: (key) => closed.push(key),
      setAlpha: () => {},
    })
    transition.retire(['c'], false)
    check('cst.unanimatedRetireCloses', closed.join(','), 'c')
  }

  {
    const alphas = []
    const transition = new CaptureSelectionWindowTransition({
      reduceMotion: () => false,
      closeWindow: () => {},
      setAlpha: (key, alpha) => alphas.push(`${key}=${alpha}`),
    })
    transition.present('d')
    transition.settlePresentation(['d'])
    check('cst.settlePinsAlpha', alphas.join(',').endsWith('d=1'), true)
    check('cst.settleClears', transition.pendingCount, 0)
  }

  {
    const rect = { x: 10, y: 20, width: 100, height: 50 }
    check('cst.framesEqual', framesEqual(rect, { ...rect }), true)
    check('cst.framesNotEqual', framesEqual(rect, { ...rect, y: 21 }), false)
    check('cst.showFirst', (() => {
      const p = captureSelectionCardShowPlan({ isPresented: false, targetFrame: null, target: rect })
      return `${p.entering}:${p.updateFrame}`
    })(), 'true:true')
    check('cst.showSameFrame', (() => {
      const p = captureSelectionCardShowPlan({ isPresented: true, targetFrame: rect, target: { ...rect } })
      return `${p.entering}:${p.updateFrame}`
    })(), 'false:false')
    check('cst.showMovedFrame', (() => {
      const p = captureSelectionCardShowPlan({ isPresented: true, targetFrame: rect,
        target: { ...rect, x: 30 } })
      return `${p.entering}:${p.updateFrame}`
    })(), 'false:true')
  }

  check('cst.hideNeverShownAnimated',
    captureSelectionCardHidePlan({ isPresented: false, animated: true, reduceMotion: false }), null)
  check('cst.hideNeverShownImmediate', (() => {
    const p = captureSelectionCardHidePlan({ isPresented: false, animated: false, reduceMotion: false })
    return `${p.duration}:${p.hideOnCompletion}:${p.immediate}`
  })(), '0:true:true')
  check('cst.hideAnimated', (() => {
    const p = captureSelectionCardHidePlan({ isPresented: true, animated: true, reduceMotion: false })
    return `${p.duration}:${p.hideOnCompletion}:${p.immediate}`
  })(), '0.14:true:false')
  check('cst.hideAnimatedReduce', (() => {
    const p = captureSelectionCardHidePlan({ isPresented: true, animated: true, reduceMotion: true })
    return `${p.duration}:${p.immediate}`
  })(), '0:true')

  check('cst.animateReduced', (() => {
    const p = captureSelectionCardAnimatePlan({ initialAlpha: 0, alpha: 1, duration: 0.16,
      reduceMotion: true, hideOnCompletion: false })
    return `${p.animate}:${p.duration}`
  })(), 'false:0')
  check('cst.animateSameAlpha', (() => {
    const p = captureSelectionCardAnimatePlan({ initialAlpha: 0, alpha: 0, duration: 0.14,
      reduceMotion: false, hideOnCompletion: true })
    return `${p.animate}:${p.hideOnCompletion}`
  })(), 'false:true')
  check('cst.animateNormal', (() => {
    const p = captureSelectionCardAnimatePlan({ initialAlpha: 0, alpha: 1, duration: 0.16,
      reduceMotion: false, hideOnCompletion: false })
    return `${p.animate}:${p.duration}`
  })(), 'true:0.16')

  check('cst.motionVisible', (() => {
    const p = captureSelectionCardMotion({ appeared: true, retiring: false, reduceMotion: false })
    return `${p.offsetY}:${p.scale}:${p.duration}`
  })(), '0:1:0.2')
  check('cst.motionEntering', (() => {
    const p = captureSelectionCardMotion({ appeared: false, retiring: false, reduceMotion: false })
    return `${p.offsetY}:${p.scale}`
  })(), '6:0.985')
  check('cst.motionRetiringDuration',
    captureSelectionCardMotion({ appeared: true, retiring: true, reduceMotion: false }).duration, 0.16)
  check('cst.motionReduceMotion', (() => {
    const p = captureSelectionCardMotion({ appeared: false, retiring: false, reduceMotion: true })
    return `${p.offsetY}:${p.scale}:${p.duration}`
  })(), '0:1:null')

  {
    const card = new CaptureSelectionCardTransition()
    check('cst.cardStartsHidden', card.isPresented, false)
    card.show('v', { x: 0, y: 0, width: 10, height: 10 })
    check('cst.cardShown', card.isPresented, true)
    check('cst.cardFrame', card.targetFrame.width, 10)
    check('cst.cardGeneration', card.generationValue, 1)
    card.show('v', { x: 0, y: 0, width: 10, height: 10 })
    check('cst.cardSameFrameNoBump', card.generationValue, 1)
    card.show('v', { x: 5, y: 0, width: 10, height: 10 })
    check('cst.cardMovedNoBump', card.generationValue, 1)
    check('cst.cardHidePlanDuration', card.hide(true, false).duration, 0.14)
    check('cst.cardHidden', card.isPresented, false)
    check('cst.cardHideBumps', card.generationValue, 2)
    check('cst.cardHideAgainNull', card.hide(true, false), null)
    card.show('v', { x: 1, y: 1, width: 2, height: 2 })
    card.stop()
    check('cst.cardStopClears', `${card.isPresented}:${card.targetFrame}`, 'false:null')
  }

  // ---------------------------------------------------------------------------
  // CaptureDeviceCatalog.swift（216 行）
  // ---------------------------------------------------------------------------
  check('cdc.runtimeResolution',
    (() => {
      const r = runtimeFormatResolution({ width: 1920, height: 1080, framesPerSecond: 30 })
      return `${r.width}x${r.height}`
    })(), '1920x1080')
  check('cdc.runtimeLabel',
    runtimeFormatLabel({ width: 1920, height: 1080, framesPerSecond: 30 }),
    '1080p · 16:9 · 30.0 FPS')
  check('cdc.runtimeLabelRounded',
    runtimeFormatLabel({ width: 1280, height: 720, framesPerSecond: 29.97 }),
    '720p · 16:9 · 30.0 FPS')
  check('cdc.deviceInfos', (() => {
    const infos = captureDeviceInfos([
      { uniqueID: 'a', localizedName: 'A' },
      { uniqueID: 'b', localizedName: 'B' },
    ])
    return `${infos.length}:${infos[0].id}:${infos[1].name}`
  })(), '2:a:B')
  check('cdc.iosModelID', CAPTURE_DEVICE_IOS_MODEL_ID, 'iOS Device')
  check('cdc.discoveryRoleCount', CAPTURE_DEVICE_DISCOVERY_ROLES.length, 3)
  check('cdc.iosRequiresModel',
    captureDeviceRequiresIOSModelID('iosDevice'), true)
  check('cdc.cameraNoModel', captureDeviceRequiresIOSModelID('camera'), false)
  check('cdc.eligibleCamera',
    captureDeviceIsEligible({ role: 'camera', isConnected: true, modelID: 'FaceTime HD' }), true)
  check('cdc.eligibleDisconnected',
    captureDeviceIsEligible({ role: 'camera', isConnected: false, modelID: 'x' }), false)
  check('cdc.eligibleIOSWrongModel',
    captureDeviceIsEligible({ role: 'iosDevice', isConnected: true, modelID: 'iPad' }), false)
  check('cdc.eligibleIOSRightModel',
    captureDeviceIsEligible({ role: 'iosDevice', isConnected: true, modelID: 'iOS Device' }), true)
  check('cdc.enableIOSOK', captureEnableIOSScreenCaptureDecision(0), true)
  check('cdc.enableIOSFail', captureEnableIOSScreenCaptureDecision(-50), false)

  check('cdc.resolutionsDedupedSorted', (() => {
    const list = captureDeviceResolutionsFromFormats([
      { width: 1280, height: 720, supportedFrameRateRangeCount: 1 },
      { width: 1920, height: 1080, supportedFrameRateRangeCount: 2 },
      { width: 1920, height: 1080, supportedFrameRateRangeCount: 1 },
      { width: 640, height: 480, supportedFrameRateRangeCount: 1 },
    ])
    return list.map((r) => `${r.width}x${r.height}`).join(',')
  })(), '1920x1080,1280x720,640x480')
  check('cdc.resolutionsSkipped', (() => {
    const list = captureDeviceResolutionsFromFormats([
      { width: 0, height: 1080, supportedFrameRateRangeCount: 1 },
      { width: 1920, height: 0, supportedFrameRateRangeCount: 1 },
      { width: 1920, height: 1080, supportedFrameRateRangeCount: 0 },
      { width: 1024, height: 768, supportedFrameRateRangeCount: 1 },
    ])
    return list.map((r) => `${r.width}x${r.height}`).join(',')
  })(), '1024x768')
  check('cdc.resolutionsTieByWidth', (() => {
    const list = captureDeviceResolutionsFromFormats([
      { width: 1440, height: 2560, supportedFrameRateRangeCount: 1 },
      { width: 2560, height: 1440, supportedFrameRateRangeCount: 1 },
    ])
    return list.map((r) => r.width).join(',')
  })(), '2560,1440')

  check('cdc.defaultQueryExact',
    captureDeviceDefaultQueryForRequest({ kind: 'exact', role: 'camera', uniqueID: 'x' }), 'none')
  check('cdc.defaultQueryCamera',
    captureDeviceDefaultQueryForRequest({ kind: 'automatic', role: 'camera' }), 'video')
  check('cdc.defaultQueryMicrophone',
    captureDeviceDefaultQueryForRequest({ kind: 'automatic', role: 'microphone' }), 'audio')
  check('cdc.defaultQueryIOS',
    captureDeviceDefaultQueryForRequest({ kind: 'automatic', role: 'iosDevice' }), 'none')

  check('cdc.resolveAutomaticAppendsDefault', (() => {
    const result = captureResolveLiveDevice({
      request: { kind: 'automatic', role: 'camera' },
      candidates: [{ role: 'camera', uniqueID: 'builtin', localizedName: '内置' }],
      defaultDevice: { uniqueID: 'usb', isConnected: true },
    })
    return `${result.ok}:${result.appendedDefault}:${result.device.uniqueID}`
  })(), 'true:true:usb')
  check('cdc.resolveAutomaticExistingDefault', (() => {
    const result = captureResolveLiveDevice({
      request: { kind: 'automatic', role: 'camera' },
      candidates: [{ role: 'camera', uniqueID: 'usb', localizedName: 'USB' }],
      defaultDevice: { uniqueID: 'usb', isConnected: true },
    })
    return `${result.appendedDefault}:${result.device.uniqueID}`
  })(), 'false:usb')
  check('cdc.resolveExactNeverUsesDefault', (() => {
    const result = captureResolveLiveDevice({
      request: { kind: 'exact', role: 'camera', uniqueID: 'missing' },
      candidates: [{ role: 'camera', uniqueID: 'builtin', localizedName: '内置' }],
      defaultDevice: { uniqueID: 'usb', isConnected: true },
    })
    return `${result.ok}:${result.requestedUniqueID}`
  })(), 'false:missing')
  check('cdc.resolveDisconnectedDefault', (() => {
    const result = captureResolveLiveDevice({
      request: { kind: 'automatic', role: 'camera' },
      candidates: [{ role: 'camera', uniqueID: 'builtin', localizedName: '内置' }],
      defaultDevice: { uniqueID: 'usb', isConnected: false },
    })
    // Swift L148-152：未连接的默认设备不补进候选，但 defaultUniqueID 仍然传下去
    // → 策略在候选里找不到它 → 解析失败（requestedUniqueID 为 null）
    return `${result.ok}:${result.requestedUniqueID}`
  })(), 'false:null')
  check('cdc.resolveAutomaticNoDefault', (() => {
    const result = captureResolveLiveDevice({
      request: { kind: 'automatic', role: 'camera' },
      candidates: [{ role: 'camera', uniqueID: 'builtin', localizedName: '内置' }],
      defaultDevice: null,
    })
    return `${result.ok}:${result.requestedUniqueID}`
  })(), 'false:null')

  check('cdc.schedulerCoalesces', await (async () => {
    let calls = 0
    const scheduler = new CaptureDeviceCatalogScheduler(async () => {
      calls += 1
      return { screenDevices: [], cameras: [], microphones: [] }
    })
    const first = scheduler.snapshot()
    const second = scheduler.snapshot()
    check('cdc.schedulerSamePromise', first === second, true)
    await Promise.all([first, second])
    check('cdc.schedulerCalls', calls, 1)
    check('cdc.schedulerIdle', scheduler.isEnumerating, false)
    return true
  })(), true)

  // ---------------------------------------------------------------------------
  // TimelineAudioGainProcessor.swift（195 行）
  // ---------------------------------------------------------------------------
  check('tag.epsilon', TIMELINE_AUDIO_GAIN_EPSILON, 1e-7)
  check('tag.clampHigh', timelineAudioGainClamped(2), 1)
  check('tag.clampLow', timelineAudioGainClamped(-1), 0)
  check('tag.clampNaN', timelineAudioGainClamped(Number.NaN), 0)
  check('tag.clampKeep', timelineAudioGainClamped(0.35), 0.35)

  check('tag.validSpans', (() => {
    const spans = timelineAudioGainValidSpans([
      { start: 2, end: 3, gain: 0.5 },
      { start: 0, end: 0, gain: 0.5 },
      { start: 1, end: 2, gain: 0.2 },
      { start: Number.NaN, end: 4, gain: 0.1 },
    ])
    return spans.map((s) => s.start).join(',')
  })(), '1,2')

  check('tag.needsProcessor', timelineAudioGainNeedsProcessor(0.5, [
    { start: 0, end: 1, gain: 0.2 },
  ]), true)
  check('tag.noProcessorWhenAllSame', timelineAudioGainNeedsProcessor(0.5, [
    { start: 0, end: 1, gain: 0.5 },
    { start: 1, end: 2, gain: 0.5 },
  ]), false)
  check('tag.noProcessorWhenClampedSame', timelineAudioGainNeedsProcessor(1, [
    { start: 0, end: 1, gain: 2 },
  ]), false)

  check('tag.planNoProcessor', (() => {
    const p = timelineAudioGainParametersPlan({
      defaultGain: 0.8, spans: [{ start: 0, end: 1, gain: 0.8 }], processorAvailable: true,
    })
    return `${p.volume}:${p.usesProcessor}:${p.spans.length}`
  })(), '0.8:false:0')
  check('tag.planWithProcessor', (() => {
    const p = timelineAudioGainParametersPlan({
      defaultGain: 0.8, spans: [{ start: 0, end: 1, gain: 0 }], processorAvailable: true,
    })
    return `${p.volume}:${p.usesProcessor}:${p.spans[0].gain}`
  })(), '1:true:0')
  check('tag.planProcessorUnavailable', (() => {
    const p = timelineAudioGainParametersPlan({
      defaultGain: 0.8, spans: [{ start: 0, end: 1, gain: 0 }], processorAvailable: false,
    })
    return `${p.volume}:${p.usesProcessor}`
  })(), '0:false')
  check('tag.planClampsDefault', timelineAudioGainParametersPlan({
    defaultGain: 5, spans: [], processorAvailable: true,
  }).volume, 1)

  const sortedSpans = [
    { start: 0, end: 1, gain: 0.5 },
    { start: 1, end: 2, gain: 0.2 },
    { start: 2, end: 3, gain: 0.8 },
  ]
  check('tag.firstIndexAtZero', timelineAudioGainFirstSpanIndex(sortedSpans, 0), 0)
  check('tag.firstIndexAtBoundary', timelineAudioGainFirstSpanIndex(sortedSpans, 1), 1)
  check('tag.firstIndexInside', timelineAudioGainFirstSpanIndex(sortedSpans, 1.5), 1)
  check('tag.firstIndexPast', timelineAudioGainFirstSpanIndex(sortedSpans, 3), 3)
  check('tag.firstIndexEmpty', timelineAudioGainFirstSpanIndex([], 0), 0)

  check('tag.nextBoundary', timelineAudioGainNextBoundaryFrame({
    frame: 0, frameCount: 100, boundary: 0.5, start: 0, step: 0.01,
  }), 50)
  check('tag.nextBoundaryAtLeastOne', timelineAudioGainNextBoundaryFrame({
    frame: 10, frameCount: 100, boundary: 0.05, start: 0, step: 0.01,
  }), 11)
  check('tag.nextBoundaryClamped', timelineAudioGainNextBoundaryFrame({
    frame: 99, frameCount: 100, boundary: 100, start: 0, step: 0.01,
  }), 100)

  check('tag.segmentsSplitsAtSpans', (() => {
    const segments = timelineAudioGainSegments({
      spans: sortedSpans, defaultGain: 1, start: 0, sampleRate: 100, frameCount: 300,
    })
    return segments.map((s) => `${s.startFrame}-${s.endFrame}:${s.gain}`).join('|')
  })(), '0-100:0.5|100-200:0.2|200-300:0.8')
  check('tag.segmentsDefaultBeforeFirstSpan', (() => {
    const segments = timelineAudioGainSegments({
      spans: [{ start: 0.5, end: 1, gain: 0 }], defaultGain: 1, start: 0, sampleRate: 100,
      frameCount: 100,
    })
    return segments.map((s) => `${s.startFrame}-${s.endFrame}:${s.gain}`).join('|')
  })(), '0-50:1|50-100:0')
  check('tag.segmentsDefaultAfterLastSpan', (() => {
    const segments = timelineAudioGainSegments({
      spans: [{ start: 0, end: 0.5, gain: 0 }], defaultGain: 1, start: 0, sampleRate: 100,
      frameCount: 100,
    })
    return segments.map((s) => `${s.startFrame}-${s.endFrame}:${s.gain}`).join('|')
  })(), '0-50:0|50-100:1')
  check('tag.segmentsEmpty', timelineAudioGainSegments({
    spans: [], defaultGain: 1, start: 0, sampleRate: 100, frameCount: 0,
  }).length, 0)
  check('tag.segmentsInvalidSampleRate', (() => {
    const segments = timelineAudioGainSegments({
      spans: [], defaultGain: 1, start: 0, sampleRate: 0, frameCount: 10,
    })
    return `${segments.length}:${segments[0].gain}:${segments[0].endFrame}`
  })(), '1:0:10')
  check('tag.segmentsNonFiniteStart', timelineAudioGainSegments({
    spans: [], defaultGain: 1, start: Number.NaN, sampleRate: 100, frameCount: 10,
  })[0].gain, 0)
  check('tag.segmentsCoverage', (() => {
    const segments = timelineAudioGainSegments({
      spans: sortedSpans, defaultGain: 1, start: 0, sampleRate: 50, frameCount: 137,
    })
    const last = segments[segments.length - 1]
    return `${segments[0].startFrame}:${last.endFrame}`
  })(), '0:137')

  check('tag.scaleIdentity',
    timelineAudioGainScaleKind({ gain: 1, isFloat: true, isSignedInteger: false, bytesPerSample: 4 }), 'identity')
  check('tag.scaleZero',
    timelineAudioGainScaleKind({ gain: 0, isFloat: true, isSignedInteger: false, bytesPerSample: 4 }), 'zero')
  check('tag.scaleFloat32',
    timelineAudioGainScaleKind({ gain: 0.5, isFloat: true, isSignedInteger: false, bytesPerSample: 4 }), 'multiplyFloat32')
  check('tag.scaleFloat64',
    timelineAudioGainScaleKind({ gain: 0.5, isFloat: true, isSignedInteger: false, bytesPerSample: 8 }), 'multiplyFloat64')
  check('tag.scaleInt16',
    timelineAudioGainScaleKind({ gain: 0.5, isFloat: false, isSignedInteger: true, bytesPerSample: 2 }), 'multiplyInteger')
  check('tag.scaleInt32',
    timelineAudioGainScaleKind({ gain: 0.5, isFloat: false, isSignedInteger: true, bytesPerSample: 4 }), 'multiplyInteger')
  check('tag.scaleUnknownFormat',
    timelineAudioGainScaleKind({ gain: 0.5, isFloat: false, isSignedInteger: false, bytesPerSample: 3 }), 'zero')

  check('tag.sampleCount', timelineAudioGainSampleCount({
    lowerFrame: 0, upperFrame: 10, channels: 2, byteSize: 80, bytesPerSample: 4,
  }), 20)
  check('tag.sampleCountClamped', timelineAudioGainSampleCount({
    lowerFrame: 0, upperFrame: 100, channels: 2, byteSize: 40, bytesPerSample: 4,
  }), 10)
  check('tag.sampleCountEmpty', timelineAudioGainSampleCount({
    lowerFrame: 5, upperFrame: 5, channels: 2, byteSize: 40, bytesPerSample: 4,
  }), 0)
  check('tag.sampleCountZeroBytes', timelineAudioGainSampleCount({
    lowerFrame: 0, upperFrame: 5, channels: 2, byteSize: 10, bytesPerSample: 0,
  }), 0)
}

await runPreviewAndSelectionBatch()



async function runWindowAndMarkerBatch() {
  // ========== 8 文件 / 1794 行：编辑器窗口桥 / 悬浮参考线 / 连续圆角 /
  //            画布比例 / 设置窗口 / 倾斜板 / 标记列表 / 录制运行安全
  const {
    // ---- EditorWindowLifecycleBridge.swift
    EDITOR_TITLE_BAR_HEIGHT, EDITOR_TRAFFIC_LIGHT_LEADING_INSET,
    EDITOR_TRAFFIC_LIGHT_SPACING, EDITOR_TRAFFIC_LIGHT_BUTTONS,
    editorWindowTitle, editorWindowIsActive, editorTitleBarContainerFrame,
    editorTrafficLightOrigin, editorShouldAlignTrafficLights,
    editorScreenSizeDecision, editorDeferredDispatchShouldRun, EditorWindowObservation,
    // ---- EditorTimelineHoverGuide.swift
    TIMELINE_HOVER_GUIDE_LINE_WIDTH, TIMELINE_HOVER_GUIDE_DASH,
    TIMELINE_HOVER_BADGE_WIDTH, TIMELINE_HOVER_BADGE_HEIGHT,
    TIMELINE_HOVER_BADGE_CORNER_RADIUS, TIMELINE_HOVER_BADGE_BORDER_WIDTH,
    TIMELINE_HOVER_BADGE_SHADOW_OPACITY, TIMELINE_HOVER_BADGE_SHADOW_RADIUS,
    TIMELINE_HOVER_BADGE_SHADOW_OFFSET_Y, TIMELINE_HOVER_BADGE_LABEL_FONT_SIZE,
    TIMELINE_HOVER_GUIDE_STROKE_ALPHA, TIMELINE_HOVER_GUIDE_BORDER_ALPHA,
    TIMELINE_HOVER_GUIDE_TEXT_ALPHA, TIMELINE_HOVER_BADGE_LEADING_GAP,
    TIMELINE_HOVER_BADGE_TRAILING_INSET, timelineHoverTimecodeLabel,
    timelineHoverGuideLayout, timelineHoverBadgeLabelFrame,
    timelineHoverGuideConfigurePlan, timelineHoverBackingScale, TimelineHoverGuideState,
    // ---- ContinuousCornerMask.swift
    CORNER_MASK_CACHE_COUNT_LIMIT, CORNER_MASK_CACHE_COST_LIMIT,
    CORNER_MASK_BITS_PER_COMPONENT, CORNER_MASK_EXTENT_TOLERANCE,
    continuousCornerMaskCacheKey, continuousCornerClampedRadius,
    continuousCornerMaskKind, continuousCornerIsCircle, continuousCornerAtlasCap,
    continuousCornerAtlasPlan, continuousCornerAtlasSlices,
    continuousCornerAtlasTranslation, continuousCornerStretchPlan,
    continuousCornerStretchAccepts, continuousCornerCacheCost,
    continuousCornerMaskTranslation, ContinuousCornerMaskCache,
    // ---- EditorCanvasRatioSelector.swift
    EDITOR_CANVAS_RATIO_PRESETS, EDITOR_CANVAS_CUSTOM_RATIO_MIN,
    EDITOR_CANVAS_CUSTOM_RATIO_MAX, EDITOR_CANVAS_RATIO_PANEL_WIDTH,
    EDITOR_CANVAS_RATIO_PANEL_PADDING, EDITOR_CANVAS_RATIO_GRID_COLUMNS,
    EDITOR_CANVAS_RATIO_GRID_SPACING, EDITOR_CANVAS_RATIO_ITEM_HEIGHT,
    EDITOR_CANVAS_RATIO_THUMB_MAX_EDGE, EDITOR_CANVAS_RATIO_THUMB_BOX,
    EDITOR_CANVAS_RATIO_PANEL_TITLE_SIZE, EDITOR_CANVAS_RATIO_CLOSE_GLYPH_SIZE,
    EDITOR_CANVAS_RATIO_CUSTOM_HINT, editorCanvasIsPortrait, editorCanvasSelectedPreset,
    editorCanvasCustomAspectRatio, editorCanvasRatioNumberText, editorCanvasRatioFields,
    editorCanvasOrientedRatio, editorCanvasPresetAspectValue, editorCanvasPresetThumbSize,
    editorCanvasCustomFieldID, editorCanvasPresetUsesIcon, editorCanvasPresetSymbol,
    editorCanvasShowsOrientationControl, editorCanvasPresetTitleKey,
    editorCanvasRatioValueLabel, editorCanvasStyleIsPortrait,
    // ---- AppSettingsWindowController.swift
    SETTINGS_WINDOW_CONTENT_WIDTH, SETTINGS_WINDOW_MAXIMUM_CONTENT_HEIGHT,
    SETTINGS_WINDOW_INITIAL_CONTENT_HEIGHT, SETTINGS_WINDOW_MINIMUM_CONTENT_HEIGHT,
    SETTINGS_WINDOW_SCREEN_HEIGHT_RESERVE, SETTINGS_WINDOW_MINIMUM_LIMIT,
    SETTINGS_WINDOW_IDENTIFIER, SETTINGS_HEIGHT_SPRING_INTERVAL,
    SETTINGS_HEIGHT_EPSILON, SETTINGS_WINDOW_STYLE, settingsHeightLimit,
    settingsInitialHeight, settingsWindowOrigin, settingsFinishPresentationPlan,
    settingsTargetHeight, settingsHeightAppliesImmediately, windowHeightSpringFrame,
    WindowHeightSpring, settingsReferenceSpring,
    // ---- EditorTiltPad.swift
    TILT_PAD_MAXIMUM_X, TILT_PAD_MAXIMUM_Y, TILT_PAD_WIDTH, TILT_PAD_HEIGHT,
    TILT_PAD_INSET, TILT_PAD_OUTER_CORNER_RADIUS, TILT_PAD_PLATE_CORNER_RADIUS,
    TILT_PAD_PLATE_HORIZONTAL_PADDING, TILT_PAD_PLATE_VERTICAL_PADDING,
    TILT_PAD_PREVIEW_ROTATION_SCALE, TILT_PAD_PREVIEW_PERSPECTIVE,
    TILT_PAD_CROSS_ALPHA, TILT_PAD_ACTIVE_CROSS_ALPHA, TILT_PAD_HANDLE_INNER_IDLE,
    TILT_PAD_HANDLE_INNER_ACTIVE, TILT_PAD_HANDLE_OUTER_IDLE, TILT_PAD_HANDLE_OUTER_ACTIVE,
    TILT_PAD_DEAD_ZONE_DEGREES, TILT_PAD_NEUTRAL_EPSILON, TILT_PAD_READOUT_UNIT,
    TILT_PAD_READOUT_DIGITS, tiltPadClamped, tiltPadIsNeutral, tiltPadHandlePoint,
    tiltPadTiltAt, tiltPadPlateRotation, tiltPadHandleSize, tiltPadIsActive,
    tiltPadAllowsHitTesting, TiltPadDragState,
    // ---- EditorMarkerListControl.swift
    EDITOR_MARKER_ENTRY_HEIGHT, EDITOR_MARKER_ENTRY_HORIZONTAL_PADDING,
    EDITOR_MARKER_ENTRY_CORNER_RADIUS, EDITOR_MARKER_CARD_CORNER_RADIUS,
    EDITOR_MARKER_CARD_BORDER_WIDTH, EDITOR_MARKER_CARD_BORDER_ALPHA,
    EDITOR_MARKER_ROW_HEIGHT, EDITOR_MARKER_ROW_SPACING, EDITOR_MARKER_ROW_STRIDE,
    EDITOR_MARKER_LIST_MINIMUM_HEIGHT, EDITOR_MARKER_LIST_MAXIMUM_HEIGHT,
    EDITOR_MARKER_LIST_CHROME_HEIGHT, EDITOR_MARKER_EMPTY_HINT, EDITOR_MARKER_SUBTITLE,
    EDITOR_MARKER_FOOTER_HINT, EDITOR_MARKER_TRASH_WIDTH, EDITOR_MARKER_TRASH_HEIGHT,
    EDITOR_MARKER_TRASH_ALPHA_IDLE, EDITOR_MARKER_TRASH_ALPHA_HOVERED,
    EDITOR_MARKER_PANEL_MAXIMUM_WIDTH, EDITOR_MARKER_PANEL_SCREEN_INSET,
    EDITOR_MARKER_PANEL_ANCHOR_GAP, EDITOR_MARKER_PANEL_MINIMUM_HEIGHT,
    EDITOR_MARKER_PANEL_IDENTIFIER, EDITOR_MARKER_ESCAPE_KEY_CODE,
    editorMarkerListHeight, editorMarkerTrashAlpha, editorMarkerPanelLevel,
    editorMarkerPanelFrame, EDITOR_MARKER_DISMISS_ORDER, editorMarkerEventDecision,
    EditorMarkerCardPresenter,
    // ---- ScreenRecorderRunSafety.swift
    ScreenRecorderRunSafetyState, CAPTURE_OUTPUT_ERROR_DOMAIN,
    CAPTURE_OUTPUT_TERMINAL_ERROR_CODES, CAPTURE_OUTPUT_TERMINAL_STAGE_DESCRIPTIONS,
    captureOutputTerminalErrorCode, captureOutputTerminalErrorDescription,
    CaptureOutputTerminalState,
    // ---- 依赖
    makeCanvasStyle,
  } = m

  // ---------------------------------------------------------------------------
  // EditorWindowLifecycleBridge.swift（189 行）
  // ---------------------------------------------------------------------------
  check('ewl.titleBarHeight', EDITOR_TITLE_BAR_HEIGHT, 46)
  check('ewl.trafficLeading', EDITOR_TRAFFIC_LIGHT_LEADING_INSET, 16)
  check('ewl.trafficSpacing', EDITOR_TRAFFIC_LIGHT_SPACING, 20)
  check('ewl.trafficButtons', EDITOR_TRAFFIC_LIGHT_BUTTONS.length, 3)

  check('ewl.titleWithProject',
    editorWindowTitle({ projectTitle: '  我的片子  ', appDisplayName: 'DogSC' }),
    '我的片子 — DogSC')
  check('ewl.titleBlank',
    editorWindowTitle({ projectTitle: '   ', appDisplayName: 'DogSC' }), 'DogSC 编辑器')
  check('ewl.titleKeepsInnerSpace',
    editorWindowTitle({ projectTitle: 'a b', appDisplayName: 'DogSC' }), 'a b — DogSC')

  const activeAll = {
    applicationIsActive: true, applicationIsHidden: false,
    windowIsMiniaturized: false, windowIsVisible: true, windowIsOccluded: true,
  }
  check('ewl.active', editorWindowIsActive(activeAll), true)
  check('ewl.activeAppInactive',
    editorWindowIsActive({ ...activeAll, applicationIsActive: false }), false)
  check('ewl.activeAppHidden',
    editorWindowIsActive({ ...activeAll, applicationIsHidden: true }), false)
  check('ewl.activeMiniaturized',
    editorWindowIsActive({ ...activeAll, windowIsMiniaturized: true }), false)
  check('ewl.activeInvisible',
    editorWindowIsActive({ ...activeAll, windowIsVisible: false }), false)
  check('ewl.activeOccluded',
    editorWindowIsActive({ ...activeAll, windowIsOccluded: false }), false)

  check('ewl.trafficLightFirst',
    (() => {
      const o = editorTrafficLightOrigin({ index: 0, barHeight: 46, buttonHeight: 14 })
      return `${o.x},${o.y}`
    })(), '16,16')
  check('ewl.trafficLightThird',
    (() => {
      const o = editorTrafficLightOrigin({ index: 2, barHeight: 46, buttonHeight: 14 })
      return `${o.x},${o.y}`
    })(), '56,16')
  check('ewl.trafficLightRoundsUp',
    editorTrafficLightOrigin({ index: 0, barHeight: 46, buttonHeight: 13 }).y, 17)

  check('ewl.containerFrame',
    (() => {
      const f = editorTitleBarContainerFrame({ windowWidth: 900, windowHeight: 600, barHeight: 46 })
      return `${f.x},${f.y},${f.width},${f.height}`
    })(), '0,554,900,46')
  check('ewl.alignOk',
    editorShouldAlignTrafficLights({ hasWindow: true, isFullScreen: false, hasTitlebarAccessory: true }),
    true)
  check('ewl.alignFullScreen',
    editorShouldAlignTrafficLights({ hasWindow: true, isFullScreen: true, hasTitlebarAccessory: true }),
    false)
  check('ewl.alignNoWindow',
    editorShouldAlignTrafficLights({ hasWindow: false, isFullScreen: false, hasTitlebarAccessory: true }),
    false)

  check('ewl.screenSizeFirst',
    editorScreenSizeDecision({ lastScreenSize: null, screenSize: { width: 100, height: 50 } }).schedule,
    true)
  check('ewl.screenSizeSame',
    editorScreenSizeDecision({
      lastScreenSize: { width: 100, height: 50 }, screenSize: { width: 100, height: 50 },
    }).schedule, false)
  check('ewl.screenSizeChanged',
    editorScreenSizeDecision({
      lastScreenSize: { width: 100, height: 50 }, screenSize: { width: 100, height: 51 },
    }).schedule, true)
  check('ewl.screenSizeNull',
    editorScreenSizeDecision({ lastScreenSize: { width: 100, height: 50 }, screenSize: null }).schedule,
    false)
  check('ewl.deferredSame', editorDeferredDispatchShouldRun(5, 5), true)

  {
    const changes = []
    const sizes = []
    const observation = new EditorWindowObservation({
      onActivityChanged: (active) => changes.push(active),
      onScreenSizeChanged: (size) => sizes.push(`${size.width}x${size.height}`),
    })
    check('ewl.obsFirstActivity', observation.updateActivity(activeAll), true)
    check('ewl.obsSameActivity', observation.updateActivity(activeAll), false)
    await Promise.resolve()
    check('ewl.obsNotifiedOnce', changes.join(','), 'true')
    observation.reset()
    check('ewl.obsResetClears', observation.activityValue, null)
    check('ewl.obsReNotifyAfterReset', observation.updateActivity(activeAll), true)
    check('ewl.obsFirstScreenSize', observation.updateScreenSize({ width: 800, height: 600 }), true)
    check('ewl.obsSameScreenSize', observation.updateScreenSize({ width: 800, height: 600 }), false)
    await Promise.resolve()
    check('ewl.obsScreenNotified', sizes.join(','), '800x600')
  }

  // ---------------------------------------------------------------------------
  // EditorTimelineHoverGuide.swift（204 行）
  // ---------------------------------------------------------------------------
  check('thg.lineWidth', TIMELINE_HOVER_GUIDE_LINE_WIDTH, 1)
  check('thg.dash', TIMELINE_HOVER_GUIDE_DASH.join(','), '3,4')
  check('thg.badgeWidth', TIMELINE_HOVER_BADGE_WIDTH, 62)
  check('thg.badgeHeight', TIMELINE_HOVER_BADGE_HEIGHT, 18)
  check('thg.badgeRadius', TIMELINE_HOVER_BADGE_CORNER_RADIUS, 9)
  check('thg.badgeBorder', TIMELINE_HOVER_BADGE_BORDER_WIDTH, 0.75)
  check('thg.badgeShadowOpacity', TIMELINE_HOVER_BADGE_SHADOW_OPACITY, 0.34)
  check('thg.badgeShadowRadius', TIMELINE_HOVER_BADGE_SHADOW_RADIUS, 4)
  check('thg.badgeShadowOffset', TIMELINE_HOVER_BADGE_SHADOW_OFFSET_Y, 2)
  check('thg.labelFont', TIMELINE_HOVER_BADGE_LABEL_FONT_SIZE, 9)
  check('thg.strokeAlpha', TIMELINE_HOVER_GUIDE_STROKE_ALPHA, 0.34)
  check('thg.borderAlpha', TIMELINE_HOVER_GUIDE_BORDER_ALPHA, 0.18)
  check('thg.textAlpha', TIMELINE_HOVER_GUIDE_TEXT_ALPHA, 0.92)
  check('thg.leadingGap', TIMELINE_HOVER_BADGE_LEADING_GAP, 3)
  check('thg.trailingInset', TIMELINE_HOVER_BADGE_TRAILING_INSET, 65)

  check('thg.timecodeZero', timelineHoverTimecodeLabel(0), '0:00.00')
  check('thg.timecodeMinute', timelineHoverTimecodeLabel(6000), '1:00.00')
  check('thg.timecodeMixed', timelineHoverTimecodeLabel(6150), '1:01.50')
  check('thg.timecodeMax', timelineHoverTimecodeLabel(359999), '59:59.99')
  check('thg.timecodeNegative', timelineHoverTimecodeLabel(-5), '0:00.00')

  const guideBounds = { x: 0, y: 0, width: 1000, height: 200 }
  const guideVisible = { x: 0, y: 0, width: 1000, height: 200 }
  const guideBase = {
    isEnabled: true,
    viewportPoint: { x: 500, y: 50 },
    bounds: guideBounds,
    visible: guideVisible,
    duration: 10,
    canvasHeight: 180,
    badgeY: 2,
  }
  check('thg.layoutCenter', (() => {
    const l = timelineHoverGuideLayout(guideBase)
    return `${l.lineX}:${l.badgeX}:${l.centiseconds}:${l.label}`
  })(), '499.5:469:500:0:05.00')
  check('thg.layoutScrolled', (() => {
    const l = timelineHoverGuideLayout({
      ...guideBase,
      viewportPoint: { x: 100, y: 50 },
      visible: { x: 200, y: 0, width: 400, height: 200 },
    })
    return `${l.centiseconds}:${l.badgeX}`
  })(), '300:269')
  check('thg.layoutClampedLeft', (() => {
    const l = timelineHoverGuideLayout({ ...guideBase, viewportPoint: { x: -600, y: 50 } })
    return `${l.lineX}:${l.badgeX}`
  })(), '-0.5:3')
  check('thg.layoutClampedRight', (() => {
    const l = timelineHoverGuideLayout({ ...guideBase, viewportPoint: { x: 5000, y: 50 } })
    return `${l.lineX}:${l.badgeX}:${l.label}`
  })(), '999.5:935:0:10.00')
  check('thg.layoutNarrowVisible', (() => {
    const l = timelineHoverGuideLayout({
      ...guideBase,
      visible: { x: 0, y: 0, width: 50, height: 200 },
    })
    return l.badgeX
  })(), 3)
  check('thg.layoutDisabled',
    timelineHoverGuideLayout({ ...guideBase, isEnabled: false }).showsGuide, false)
  check('thg.layoutNoPoint',
    timelineHoverGuideLayout({ ...guideBase, viewportPoint: null }).showsGuide, false)
  check('thg.layoutZeroWidth',
    timelineHoverGuideLayout({ ...guideBase, bounds: { x: 0, y: 0, width: 0, height: 200 } }).showsGuide,
    false)
  check('thg.layoutNegativeDuration',
    timelineHoverGuideLayout({ ...guideBase, duration: -5 }).centiseconds, 0)

  check('thg.labelFrame', (() => {
    const f = timelineHoverBadgeLabelFrame(11)
    return `${f.y}:${f.height}:${f.width}`
  })(), '3:11:62')
  check('thg.labelFrameCeils', timelineHoverBadgeLabelFrame(10.2).height, 11)
  check('thg.backingScaleFallback', timelineHoverBackingScale(null), 2)
  check('thg.backingScaleGiven', timelineHoverBackingScale(1), 1)

  check('thg.configureNone', (() => {
    const p = timelineHoverGuideConfigurePlan({
      locationChanged: false, canvasHeightChanged: false, scrollViewChanged: false,
    })
    return `${p.rebindsLocation}:${p.rebuildsPath}:${p.rebindsScrollView}`
  })(), 'false:false:false')
  check('thg.configureAll', (() => {
    const p = timelineHoverGuideConfigurePlan({
      locationChanged: true, canvasHeightChanged: true, scrollViewChanged: true,
    })
    return `${p.rebindsLocation}:${p.rebuildsPath}:${p.rebindsScrollView}`
  })(), 'true:true:true')

  {
    const state = new TimelineHoverGuideState()
    check('thg.stateInitial', state.label, '0:00.00')
    check('thg.stateFirstUpdate', state.updateCentiseconds(500), true)
    check('thg.stateLabel', state.label, '0:05.00')
    check('thg.stateSameUpdate', state.updateCentiseconds(500), false)
    check('thg.stateChanged', state.updateCentiseconds(600), true)
    check('thg.stateCentiseconds', state.centisecondsValue, 600)
  }

  // ---------------------------------------------------------------------------
  // ContinuousCornerMask.swift（218 行）
  // ---------------------------------------------------------------------------
  check('cc.cacheCountLimit', CORNER_MASK_CACHE_COUNT_LIMIT, 48)
  check('cc.cacheCostLimit', CORNER_MASK_CACHE_COST_LIMIT, 67108864)
  check('cc.bitsPerComponent', CORNER_MASK_BITS_PER_COMPONENT, 8)
  check('cc.extentTolerance', CORNER_MASK_EXTENT_TOLERANCE, 0.001)

  check('cc.cacheKey',
    continuousCornerMaskCacheKey({ width: 100.5, height: 50.25, clampedRadius: 12 }),
    '100.5x50.25@12')
  check('cc.clampRadius', continuousCornerClampedRadius(100, 200, 100), 50)
  check('cc.clampRadiusSmall', continuousCornerClampedRadius(4, 200, 100), 4)

  check('cc.kindTransparent',
    continuousCornerMaskKind({ width: 0, height: 10, radius: 4 }), 'transparent')
  check('cc.kindTransparentHeight',
    continuousCornerMaskKind({ width: 10, height: 0, radius: 4 }), 'transparent')
  check('cc.kindOpaque', continuousCornerMaskKind({ width: 10, height: 10, radius: 0 }), 'opaque')
  check('cc.kindRounded', continuousCornerMaskKind({ width: 10, height: 10, radius: 2 }), 'rounded')

  check('cc.isCircle',
    continuousCornerIsCircle({ width: 100, height: 100, clampedRadius: 50 }), true)
  check('cc.isCircleCapsule',
    continuousCornerIsCircle({ width: 400, height: 100, clampedRadius: 50 }), false)
  check('cc.isCircleNotFull',
    continuousCornerIsCircle({ width: 100, height: 100, clampedRadius: 49 }), false)
  check('cc.isCircleNearSquare',
    continuousCornerIsCircle({ width: 100, height: 100.4, clampedRadius: 50 }), true)

  check('cc.atlasCap', continuousCornerAtlasCap(12), 26)
  check('cc.atlasPlanLarge', (() => {
    const p = continuousCornerAtlasPlan({ width: 1000, height: 600, clampedRadius: 12, isCircle: false })
    return `${p.usesAtlas}:${p.drawingWidth}x${p.drawingHeight}:${p.usesFullPath}`
  })(), 'true:54x54:false')
  check('cc.atlasPlanSmall', (() => {
    const p = continuousCornerAtlasPlan({ width: 50, height: 50, clampedRadius: 12, isCircle: false })
    return `${p.usesAtlas}:${p.drawingWidth}x${p.drawingHeight}`
  })(), 'false:50x50')
  check('cc.atlasPlanStrictBoundary', (() => {
    // cap*2+2 = 54；54 > 54 为假 → 走整路径（严格大于）
    const p = continuousCornerAtlasPlan({ width: 54, height: 54, clampedRadius: 12, isCircle: false })
    return p.usesAtlas
  })(), false)
  check('cc.atlasPlanCircle', (() => {
    const p = continuousCornerAtlasPlan({ width: 100.4, height: 100.4, clampedRadius: 50, isCircle: true })
    return `${p.usesAtlas}:${p.drawingWidth}:${p.usesFullPath}`
  })(), 'false:101:true')

  check('cc.slices', (() => {
    const slices = continuousCornerAtlasSlices(10)
    return slices.map((s) => `${s.origin}+${s.length}`).join('|')
  })(), '0+10|10+2|12+10')
  check('cc.translationLast', continuousCornerAtlasTranslation({
    index: 2, drawingSize: 54, targetSize: 1000,
  }), -946)
  check('cc.translationFirst', continuousCornerAtlasTranslation({
    index: 0, drawingSize: 54, targetSize: 1000,
  }), 0)

  check('cc.stretchPlan', (() => {
    const p = continuousCornerStretchPlan({ cap: 26, width: 1000, height: 600, drawingWidth: 54, drawingHeight: 54 })
    return `${p.breakpoint0.x},${p.breakpoint0.y}|${p.breakpoint1.x},${p.breakpoint1.y}|${p.growAmount.x},${p.growAmount.y}`
  })(), '26,26|28,28|946,546')

  const acceptsBase = {
    hasOutput: true, isFinite: true, isNull: false,
    extentWidth: 1000, extentHeight: 600, targetWidth: 1000, targetHeight: 600,
  }
  check('cc.accepts', continuousCornerStretchAccepts(acceptsBase), true)
  check('cc.acceptsOffByTolerance',
    continuousCornerStretchAccepts({ ...acceptsBase, extentWidth: 1000.002 }), false)
  check('cc.acceptsWithinTolerance',
    continuousCornerStretchAccepts({ ...acceptsBase, extentWidth: 1000.0005 }), true)
  check('cc.acceptsNull',
    continuousCornerStretchAccepts({ ...acceptsBase, isNull: true }), false)
  check('cc.acceptsInfinite',
    continuousCornerStretchAccepts({ ...acceptsBase, isFinite: false }), false)
  check('cc.acceptsNoOutput',
    continuousCornerStretchAccepts({ ...acceptsBase, hasOutput: false }), false)

  check('cc.cacheCostFloor', continuousCornerCacheCost(0), 1)
  check('cc.cacheCostKeep', continuousCornerCacheCost(500), 500)
  check('cc.maskTranslation', (() => {
    const t = continuousCornerMaskTranslation({ minX: 10, minY: 20 })
    return `${t.x},${t.y}`
  })(), '10,20')

  {
    const cache = new ContinuousCornerMaskCache()
    cache.set('a', 100)
    check('cc.cacheAfterSet', `${cache.count}:${cache.cost}`, '1:100')
    cache.set('a', 50)
    check('cc.cacheReplacesCost', `${cache.count}:${cache.cost}`, '1:50')
    cache.removeAll()
    check('cc.cacheCleared', `${cache.count}:${cache.cost}`, '0:0')
    for (let index = 0; index < CORNER_MASK_CACHE_COUNT_LIMIT + 1; index += 1) {
      cache.set(`k${index}`, 1)
    }
    check('cc.cacheEvictsByCount', cache.count, CORNER_MASK_CACHE_COUNT_LIMIT)
    check('cc.cacheEvictedOldest', cache.has('k0'), false)
    const oversize = new ContinuousCornerMaskCache()
    oversize.set('huge', CORNER_MASK_CACHE_COST_LIMIT + 1)
    check('cc.cacheEvictsByCost', `${oversize.count}:${oversize.cost}`, '0:0')
  }

  // ---------------------------------------------------------------------------
  // EditorCanvasRatioSelector.swift（225 行）
  // ---------------------------------------------------------------------------
  check('crs.presets', EDITOR_CANVAS_RATIO_PRESETS.join(','), '适应,16:9,4:3,2.39:1,1:1,自定义')
  check('crs.customRatioMin', EDITOR_CANVAS_CUSTOM_RATIO_MIN, 0.1)
  check('crs.customRatioMax', EDITOR_CANVAS_CUSTOM_RATIO_MAX, 10)
  check('crs.panelWidth', EDITOR_CANVAS_RATIO_PANEL_WIDTH, 320)
  check('crs.panelPadding', EDITOR_CANVAS_RATIO_PANEL_PADDING, 16)
  check('crs.gridColumns', EDITOR_CANVAS_RATIO_GRID_COLUMNS, 3)
  check('crs.gridSpacing', EDITOR_CANVAS_RATIO_GRID_SPACING, 8)
  check('crs.itemHeight', EDITOR_CANVAS_RATIO_ITEM_HEIGHT, 68)
  check('crs.thumbMaxEdge', EDITOR_CANVAS_RATIO_THUMB_MAX_EDGE, 24)
  check('crs.thumbBox', EDITOR_CANVAS_RATIO_THUMB_BOX, 32)
  check('crs.titleSize', EDITOR_CANVAS_RATIO_PANEL_TITLE_SIZE, 14)
  check('crs.closeGlyph', EDITOR_CANVAS_RATIO_CLOSE_GLYPH_SIZE, 14)
  check('crs.customHint', EDITOR_CANVAS_RATIO_CUSTOM_HINT,
    '输入宽高比例，例如 3:2（支持 1:10 至 10:1）')

  check('crs.isPortrait', editorCanvasIsPortrait(0.5), true)
  check('crs.isPortraitSquare', editorCanvasIsPortrait(1), false)
  check('crs.isPortraitNull', editorCanvasIsPortrait(null), false)
  check('crs.selectedPresetPortrait',
    editorCanvasSelectedPreset({ aspectRatio: '9:16', editingCustom: false }), '16:9')
  check('crs.selectedPresetStandardPortrait',
    editorCanvasSelectedPreset({ aspectRatio: '3:4', editingCustom: false }), '4:3')
  check('crs.selectedPresetCinemaPortrait',
    editorCanvasSelectedPreset({ aspectRatio: '1:2.39', editingCustom: false }), '2.39:1')
  check('crs.selectedPresetSquare',
    editorCanvasSelectedPreset({ aspectRatio: '1:1', editingCustom: false }), '1:1')
  check('crs.selectedPresetEditing',
    editorCanvasSelectedPreset({ aspectRatio: '16:9', editingCustom: true }), '自定义')

  check('crs.customValid', (() => {
    const r = editorCanvasCustomAspectRatio('16', '9')
    return `${r.width}:${r.height}`
  })(), '16:9')
  check('crs.customBoundaryLow', editorCanvasCustomAspectRatio('1', '10') != null, true)
  check('crs.customBoundaryHigh', editorCanvasCustomAspectRatio('10', '1') != null, true)
  check('crs.customOutOfRange', editorCanvasCustomAspectRatio('100', '1'), null)
  check('crs.customZero', editorCanvasCustomAspectRatio('0', '9'), null)
  check('crs.customNegative', editorCanvasCustomAspectRatio('-1', '9'), null)
  check('crs.customNaN', editorCanvasCustomAspectRatio('abc', '9'), null)

  check('crs.numberInteger', editorCanvasRatioNumberText(16), '16')
  check('crs.numberFraction', editorCanvasRatioNumberText(3.5), '3.5')
  check('crs.numberTruncated', editorCanvasRatioNumberText(0.3333), '0.333')
  check('crs.numberZero', editorCanvasRatioNumberText(0), '0')
  check('crs.numberTen', editorCanvasRatioNumberText(10), '10')
  check('crs.numberNaN', editorCanvasRatioNumberText(Number.NaN), '0')

  check('crs.fields', (() => {
    const f = editorCanvasRatioFields({
      aspectRatio: '自定义', customAspectRatio: { width: 16, height: 9 },
    })
    return `${f.editingCustom}:${f.widthText}:${f.heightText}`
  })(), 'true:16:9')
  check('crs.fieldsNotCustom', editorCanvasRatioFields({
    aspectRatio: '16:9', customAspectRatio: { width: 4, height: 3 },
  }).editingCustom, false)

  check('crs.oriented', editorCanvasOrientedRatio('16:9', true), '9:16')
  check('crs.orientedKeep', editorCanvasOrientedRatio('16:9', false), '16:9')
  check('crs.orientedSquare', editorCanvasOrientedRatio('1:1', true), '1:1')
  check('crs.orientedCinema', editorCanvasOrientedRatio('2.39:1', true), '1:2.39')
  check('crs.orientedCustom', editorCanvasOrientedRatio('自定义', true), '自定义')

  check('crs.aspectValue', editorCanvasPresetAspectValue('16:9'), 16 / 9)
  check('crs.aspectValueFallback', editorCanvasPresetAspectValue('1:1'), 1)
  check('crs.thumbWideWidth', editorCanvasPresetThumbSize('16:9').width, 32, 1e-9)
  check('crs.thumbWideHeight', editorCanvasPresetThumbSize('16:9').height, 18, 1e-9)
  check('crs.thumbSquare', (() => {
    const s = editorCanvasPresetThumbSize('1:1')
    return `${s.width}x${s.height}`
  })(), '24x24')
  check('crs.thumbCinemaWidth', editorCanvasPresetThumbSize('2.39:1').width, 32, 1e-6)
  check('crs.thumbCinemaHeight',
    editorCanvasPresetThumbSize('2.39:1').height / editorCanvasPresetThumbSize('2.39:1').width,
    1 / 2.39, 1e-9)

  check('crs.customFieldWidth', editorCanvasCustomFieldID('width'), 'editor.canvas.custom.width')
  check('crs.customFieldHeight', editorCanvasCustomFieldID('height'), 'editor.canvas.custom.height')
  check('crs.usesIconCustom', editorCanvasPresetUsesIcon('自定义'), true)
  check('crs.usesIconAdaptive', editorCanvasPresetUsesIcon('适应'), true)
  check('crs.usesIconLandscape', editorCanvasPresetUsesIcon('16:9'), false)
  check('crs.symbolCustom', editorCanvasPresetSymbol('自定义'), 'slider.horizontal.3')
  check('crs.symbolAdaptive', editorCanvasPresetSymbol('适应'), 'arrow.up.left.and.arrow.down.right')
  check('crs.symbolNone', editorCanvasPresetSymbol('16:9'), null)

  check('crs.orientationShown',
    editorCanvasShowsOrientationControl({ editingCustom: false, selectedPreset: '16:9' }), true)
  check('crs.orientationHiddenSquare',
    editorCanvasShowsOrientationControl({ editingCustom: false, selectedPreset: '1:1' }), false)
  check('crs.orientationHiddenAdaptive',
    editorCanvasShowsOrientationControl({ editingCustom: false, selectedPreset: '适应' }), false)
  check('crs.orientationHiddenEditing',
    editorCanvasShowsOrientationControl({ editingCustom: true, selectedPreset: '16:9' }), false)

  check('crs.titleKeyCinema', editorCanvasPresetTitleKey('2.39:1'), '电影')
  check('crs.titleKeyOther', editorCanvasPresetTitleKey('16:9'), '16:9')
  check('crs.valueLabel', editorCanvasRatioValueLabel('自定义'), '自定义')
  check('crs.styleIsPortrait', editorCanvasStyleIsPortrait(
    makeCanvasStyle({ aspectRatio: '9:16' })), true)
  check('crs.styleIsPortraitLandscape', editorCanvasStyleIsPortrait(
    makeCanvasStyle({ aspectRatio: '16:9' })), false)

  // ---------------------------------------------------------------------------
  // AppSettingsWindowController.swift（237 行）
  // ---------------------------------------------------------------------------
  check('swc.width', SETTINGS_WINDOW_CONTENT_WIDTH, 560)
  check('swc.heightMax', SETTINGS_WINDOW_MAXIMUM_CONTENT_HEIGHT, 640)
  check('swc.heightInitial', SETTINGS_WINDOW_INITIAL_CONTENT_HEIGHT, 540)
  check('swc.heightMin', SETTINGS_WINDOW_MINIMUM_CONTENT_HEIGHT, 240)
  check('swc.screenReserve', SETTINGS_WINDOW_SCREEN_HEIGHT_RESERVE, 100)
  check('swc.minimumLimit', SETTINGS_WINDOW_MINIMUM_LIMIT, 420)
  check('swc.identifier', SETTINGS_WINDOW_IDENTIFIER, 'cn.laogou.dogsc.settings-window')
  check('swc.springInterval', SETTINGS_HEIGHT_SPRING_INTERVAL, 1 / 120)
  check('swc.epsilon', SETTINGS_HEIGHT_EPSILON, 0.5)
  check('swc.styleAlwaysOnTop', SETTINGS_WINDOW_STYLE.alwaysOnTop, false)
  check('swc.styleHidesOnDeactivate', SETTINGS_WINDOW_STYLE.hidesOnDeactivate, true)
  check('swc.styleRestorable', SETTINGS_WINDOW_STYLE.restorable, false)

  check('swc.limitTallScreen', settingsHeightLimit(900), 640)
  check('swc.limitSmallScreen', settingsHeightLimit(300), 420)
  check('swc.limitHugeScreen', settingsHeightLimit(1500), 640)
  check('swc.limitBoundary', settingsHeightLimit(1120), 640)
  check('swc.initialWithMemory',
    settingsInitialHeight({ lastPreferredHeight: 600, limit: 500 }), 500)
  check('swc.initialDefault', settingsInitialHeight({ lastPreferredHeight: null, limit: 640 }), 540)

  check('swc.origin', (() => {
    const o = settingsWindowOrigin({
      visibleBounds: { x: 0, y: 0, width: 1000, height: 800 },
      windowWidth: 560, windowHeight: 566, typicalFrameHeight: 566,
    })
    return `${o.x},${o.y}`
  })(), '220,117')

  check('swc.finishOk', (() => {
    const p = settingsFinishPresentationPlan({
      isLatestRequest: true, applicationIsActive: true, hasWindow: true, clearsInitialFocus: false,
    })
    return `${p.shouldPresent}:${p.shouldClearFirstResponder}`
  })(), 'true:false')
  check('swc.finishClearsFocus', settingsFinishPresentationPlan({
    isLatestRequest: true, applicationIsActive: true, hasWindow: true, clearsInitialFocus: true,
  }).shouldClearFirstResponder, true)
  check('swc.finishStaleRequest', settingsFinishPresentationPlan({
    isLatestRequest: false, applicationIsActive: true, hasWindow: true, clearsInitialFocus: false,
  }).shouldPresent, false)
  check('swc.finishInactive', settingsFinishPresentationPlan({
    isLatestRequest: true, applicationIsActive: false, hasWindow: true, clearsInitialFocus: false,
  }).shouldPresent, false)

  check('swc.targetClamp', settingsTargetHeight(100), 240)
  check('swc.targetMax', settingsTargetHeight(900), 640)
  check('swc.targetRounds', settingsTargetHeight(540.6), 541)
  check('swc.targetKeep', settingsTargetHeight(300), 300)

  check('swc.appliesImmediatelyInvisible',
    settingsHeightAppliesImmediately({ windowIsVisible: false, reduceMotion: false }), true)
  check('swc.appliesImmediatelyReduceMotion',
    settingsHeightAppliesImmediately({ windowIsVisible: true, reduceMotion: true }), true)
  check('swc.appliesAnimated',
    settingsHeightAppliesImmediately({ windowIsVisible: true, reduceMotion: false }), false)

  check('swc.springFrame', (() => {
    const f = windowHeightSpringFrame({
      currentFrame: { x: 10, y: 100, width: 560, height: 566 },
      width: 560, contentHeight: 600, frameHeightForContent: 600,
    })
    return `${f.x},${f.y},${f.width},${f.height}`
  })(), '10,66,560,600')

  {
    const spring = settingsReferenceSpring()
    const heights = []
    const animator = new WindowHeightSpring({
      spring, from: 500, to: 600, now: 0,
      setHeight: (height) => heights.push(height),
    })
    check('swc.springSettlingRounded', Math.round(spring.settlingDuration * 1000), 308)
    animator.start()
    check('swc.springRunning', animator.isRunning, true)
    check('swc.springNoRetargetSame', animator.retarget(600, 0.05), false)
    check('swc.springRetarget', animator.retarget(700, 0.05), true)
    check('swc.springRetargetTo', animator.currentTo, 700)
    check('swc.springTickEarly', animator.tick(0.06), true)
    check('swc.springTickSettles', animator.tick(2), false)
    check('swc.springFinalHeight', heights[heights.length - 1], 700)
    check('swc.springStopped', animator.isRunning, false)
  }

  {
    const animator = new WindowHeightSpring({
      spring: settingsReferenceSpring(), from: 500, to: 600, now: 0, setHeight: () => {},
    })
    animator.start()
    animator.detachWindow()
    check('swc.springDetachedStops', animator.tick(0.01), false)
    check('swc.springDetachedNotRunning', animator.isRunning, false)
  }

  // ---------------------------------------------------------------------------
  // EditorTiltPad.swift（238 行）
  // ---------------------------------------------------------------------------
  check('tp.maxX', TILT_PAD_MAXIMUM_X, 28)
  check('tp.maxY', TILT_PAD_MAXIMUM_Y, 32)
  check('tp.width', TILT_PAD_WIDTH, 184)
  check('tp.height', TILT_PAD_HEIGHT, 126)
  check('tp.inset', TILT_PAD_INSET, 12)
  check('tp.outerRadius', TILT_PAD_OUTER_CORNER_RADIUS, 12)
  check('tp.plateRadius', TILT_PAD_PLATE_CORNER_RADIUS, 9)
  check('tp.platePaddingX', TILT_PAD_PLATE_HORIZONTAL_PADDING, 24)
  check('tp.platePaddingY', TILT_PAD_PLATE_VERTICAL_PADDING, 18)
  check('tp.previewScale', TILT_PAD_PREVIEW_ROTATION_SCALE, 0.55)
  check('tp.previewPerspective', TILT_PAD_PREVIEW_PERSPECTIVE, 0.72)
  check('tp.crossAlpha', TILT_PAD_CROSS_ALPHA, 0.13)
  check('tp.activeCrossAlpha', TILT_PAD_ACTIVE_CROSS_ALPHA, 0.27)
  check('tp.handleInnerIdle', TILT_PAD_HANDLE_INNER_IDLE, 14)
  check('tp.handleInnerActive', TILT_PAD_HANDLE_INNER_ACTIVE, 16)
  check('tp.handleOuterIdle', TILT_PAD_HANDLE_OUTER_IDLE, 24)
  check('tp.handleOuterActive', TILT_PAD_HANDLE_OUTER_ACTIVE, 28)
  check('tp.deadZone', TILT_PAD_DEAD_ZONE_DEGREES, 1.4)
  check('tp.neutralEpsilon', TILT_PAD_NEUTRAL_EPSILON, 0.0005)
  check('tp.readoutUnit', TILT_PAD_READOUT_UNIT, '°')
  check('tp.readoutDigits', TILT_PAD_READOUT_DIGITS, 1)

  check('tp.clampInside', tiltPadClamped(5, -28, 28), 5)
  check('tp.clampHigh', tiltPadClamped(100, -28, 28), 28)
  check('tp.clampNaN', tiltPadClamped(Number.NaN, -28, 28), 0)
  check('tp.neutral', tiltPadIsNeutral(0.0001, -0.0002), true)
  check('tp.notNeutral', tiltPadIsNeutral(0.001, 0), false)

  const padSize = { width: TILT_PAD_WIDTH, height: TILT_PAD_HEIGHT }
  check('tp.handleCenter', (() => {
    const p = tiltPadHandlePoint({ rotationX: 0, rotationY: 0, size: padSize, inset: TILT_PAD_INSET })
    return `${p.x},${p.y}`
  })(), '92,63')
  check('tp.handleTopRight', (() => {
    const p = tiltPadHandlePoint({
      rotationX: TILT_PAD_MAXIMUM_X, rotationY: TILT_PAD_MAXIMUM_Y,
      size: padSize, inset: TILT_PAD_INSET,
    })
    return `${p.x},${p.y}`
  })(), '172,12')
  check('tp.handleBottomLeft', (() => {
    const p = tiltPadHandlePoint({
      rotationX: -TILT_PAD_MAXIMUM_X, rotationY: -TILT_PAD_MAXIMUM_Y,
      size: padSize, inset: TILT_PAD_INSET,
    })
    return `${p.x},${p.y}`
  })(), '12,114')
  check('tp.handleClampsBeyondMax', (() => {
    const p = tiltPadHandlePoint({
      rotationX: 999, rotationY: 999, size: padSize, inset: TILT_PAD_INSET,
    })
    return `${p.x},${p.y}`
  })(), '172,12')

  check('tp.tiltCenter', (() => {
    const t = tiltPadTiltAt({
      location: { x: 92, y: 63 }, size: padSize, inset: TILT_PAD_INSET,
    })
    return `${t.x},${t.y}`
  })(), '0,0')
  check('tp.tiltTop', (() => {
    const t = tiltPadTiltAt({
      location: { x: 92, y: TILT_PAD_INSET }, size: padSize, inset: TILT_PAD_INSET,
    })
    return `${t.x},${t.y}`
  })(), '28,0')
  check('tp.tiltLeft', (() => {
    const t = tiltPadTiltAt({
      location: { x: TILT_PAD_INSET, y: 63 }, size: padSize, inset: TILT_PAD_INSET,
    })
    return `${t.x},${t.y}`
  })(), '0,-32')
  check('tp.tiltDeadZone', (() => {
    // vertical 0.48 → x = (0.5 − 0.48) × 56 = 1.12，落在 1.4 死区内 → 归零
    const t = tiltPadTiltAt({
      location: { x: 92, y: 12 + 0.48 * 102 }, size: padSize, inset: TILT_PAD_INSET,
    })
    return t.x
  })(), 0)
  check('tp.tiltOutsideClamps', (() => {
    const t = tiltPadTiltAt({
      location: { x: -999, y: -999 }, size: padSize, inset: TILT_PAD_INSET,
    })
    return `${t.x},${t.y}`
  })(), '28,-32')

  const plateNormal = tiltPadPlateRotation({ rotationX: 28, rotationY: 32 })
  check('tp.plateRotationX', plateNormal.x, 15.4, 1e-9)
  check('tp.plateRotationY', plateNormal.y, 17.6, 1e-9)
  const plateClamped = tiltPadPlateRotation({ rotationX: 56, rotationY: 64 })
  check('tp.plateRotationClampsX', plateClamped.x, 15.4, 1e-9)
  check('tp.plateRotationClampsY', plateClamped.y, 17.6, 1e-9)

  check('tp.handleSizeIdle', (() => {
    const s = tiltPadHandleSize(false)
    return `${s.inner},${s.outer}`
  })(), '14,24')
  check('tp.handleSizeActive', (() => {
    const s = tiltPadHandleSize(true)
    return `${s.inner},${s.outer}`
  })(), '16,28')
  check('tp.isActive', tiltPadIsActive({ isDragging: false, isAngleEditing: true }), true)
  check('tp.allowsHitTesting', tiltPadAllowsHitTesting(true), false)
  check('tp.allowsHitTestingIdle', tiltPadAllowsHitTesting(false), true)

  {
    const changes = []
    let ended = 0
    const drag = new TiltPadDragState({
      rotationX: 5, rotationY: 5,
      onChanged: (x, y) => changes.push(`${x},${y}`),
      onEnded: () => { ended += 1 },
    })
    const tilt = drag.dragChanged({ x: 92, y: TILT_PAD_INSET }, {
      size: padSize, inset: TILT_PAD_INSET,
    })
    check('tp.dragEmitsChange', changes.join('|'), '28,0')
    check('tp.dragNotifiesX', tilt.x, 28)
    check('tp.dragActive', drag.isDragging, true)
    drag.dragEnded()
    check('tp.dragEnded', `${drag.isDragging}:${ended}`, 'false:1')
    drag.resetToNeutral()
    check('tp.resetEmits', changes.join('|'), '28,0|0,0')
    check('tp.resetRotation', `${drag.rotation.x},${drag.rotation.y}`, '0,0')
    check('tp.resetEnded', ended, 2)
  }

  // ---------------------------------------------------------------------------
  // EditorMarkerListControl.swift（239 行）
  // ---------------------------------------------------------------------------
  check('mlc.entryHeight', EDITOR_MARKER_ENTRY_HEIGHT, 30)
  check('mlc.entryPadding', EDITOR_MARKER_ENTRY_HORIZONTAL_PADDING, 8)
  check('mlc.entryRadius', EDITOR_MARKER_ENTRY_CORNER_RADIUS, 8)
  check('mlc.cardRadius', EDITOR_MARKER_CARD_CORNER_RADIUS, 16)
  check('mlc.cardBorder', EDITOR_MARKER_CARD_BORDER_WIDTH, 1)
  check('mlc.cardBorderAlpha', EDITOR_MARKER_CARD_BORDER_ALPHA, 0.09)
  check('mlc.rowHeight', EDITOR_MARKER_ROW_HEIGHT, 41)
  check('mlc.rowSpacing', EDITOR_MARKER_ROW_SPACING, 3)
  check('mlc.rowStride', EDITOR_MARKER_ROW_STRIDE, 44)
  check('mlc.listMin', EDITOR_MARKER_LIST_MINIMUM_HEIGHT, 44)
  check('mlc.listMax', EDITOR_MARKER_LIST_MAXIMUM_HEIGHT, 261)
  check('mlc.listChrome', EDITOR_MARKER_LIST_CHROME_HEIGHT, 120)
  check('mlc.emptyHint', EDITOR_MARKER_EMPTY_HINT, '标记所在素材已被剪掉，恢复剪辑后可重新定位')
  check('mlc.subtitle', EDITOR_MARKER_SUBTITLE, '快速找回重点与重录位置')
  check('mlc.footerHint', EDITOR_MARKER_FOOTER_HINT, '点击定位 · 点删除图标移除')
  check('mlc.trashSize', `${EDITOR_MARKER_TRASH_WIDTH}x${EDITOR_MARKER_TRASH_HEIGHT}`, '24x30')
  check('mlc.trashAlphaIdle', EDITOR_MARKER_TRASH_ALPHA_IDLE, 0.28)
  check('mlc.trashAlphaHovered', EDITOR_MARKER_TRASH_ALPHA_HOVERED, 0.55)
  check('mlc.panelWidth', EDITOR_MARKER_PANEL_MAXIMUM_WIDTH, 304)
  check('mlc.panelInset', EDITOR_MARKER_PANEL_SCREEN_INSET, 12)
  check('mlc.panelGap', EDITOR_MARKER_PANEL_ANCHOR_GAP, 8)
  check('mlc.panelMinHeight', EDITOR_MARKER_PANEL_MINIMUM_HEIGHT, 100)
  check('mlc.panelIdentifier', EDITOR_MARKER_PANEL_IDENTIFIER, 'editor.recording-markers')
  check('mlc.escapeKeyCode', EDITOR_MARKER_ESCAPE_KEY_CODE, 53)

  check('mlc.listHeightThree', editorMarkerListHeight(3, 500), 129)
  check('mlc.listHeightOne', editorMarkerListHeight(1, 500), 41)
  check('mlc.listHeightMany', editorMarkerListHeight(20, 500), 261)
  check('mlc.listHeightTight', editorMarkerListHeight(2, 200), 80)
  check('mlc.listHeightVeryTight', editorMarkerListHeight(2, 100), 44)
  // 空列表时上游公式会得到 −3；这个分支不会被渲染（只在非空时进列表），
  // 这里锁定行为，避免有人把它「修」成 0 而让 max(44, …) 的下限失去意义。
  check('mlc.listHeightEmpty', editorMarkerListHeight(0, 500), -3)

  check('mlc.trashAlphaHover', editorMarkerTrashAlpha(true), 0.55)
  check('mlc.trashAlphaIdleValue', editorMarkerTrashAlpha(false), 0.28)
  check('mlc.panelLevel', editorMarkerPanelLevel(3), 4)

  const markerVisible = { x: 0, y: 0, width: 1000, height: 800 }
  check('mlc.panelFlippedAbove', (() => {
    const f = editorMarkerPanelFrame({
      visibleFrame: markerVisible,
      anchorRect: { x: 100, y: 200, width: 100, height: 30 },
      contentHeight: 300,
    })
    return `${f.x},${f.y},${f.width},${f.height},${f.placedAbove}`
  })(), '100,238,304,300,true')
  check('mlc.panelBelow', (() => {
    const f = editorMarkerPanelFrame({
      visibleFrame: markerVisible,
      anchorRect: { x: 100, y: 600, width: 100, height: 30 },
      contentHeight: 300,
    })
    return `${f.y},${f.placedAbove}`
  })(), '292,false')
  check('mlc.panelClampsRight', (() => {
    const f = editorMarkerPanelFrame({
      visibleFrame: markerVisible,
      anchorRect: { x: 900, y: 600, width: 100, height: 30 },
      contentHeight: 300,
    })
    return f.x
  })(), 684)
  check('mlc.panelMinHeightApplied', (() => {
    const f = editorMarkerPanelFrame({
      visibleFrame: markerVisible,
      anchorRect: { x: 100, y: 600, width: 100, height: 30 },
      contentHeight: 40,
    })
    return f.height
  })(), 100)
  check('mlc.dismissOrder', EDITOR_MARKER_DISMISS_ORDER.length, 7)

  check('mlc.eventEscape', editorMarkerEventDecision({
    isKeyDown: true, keyCode: 53, isPanelWindow: false, isAnchorWindow: false, isInsideAnchorBounds: false,
  }), 'dismissRestoreFocus')
  check('mlc.eventOtherKey', editorMarkerEventDecision({
    isKeyDown: true, keyCode: 12, isPanelWindow: false, isAnchorWindow: false, isInsideAnchorBounds: false,
  }), 'passThrough')
  check('mlc.eventInsidePanel', editorMarkerEventDecision({
    isKeyDown: false, keyCode: 0, isPanelWindow: true, isAnchorWindow: false, isInsideAnchorBounds: false,
  }), 'passThrough')
  check('mlc.eventAnchorToggle', editorMarkerEventDecision({
    isKeyDown: false, keyCode: 0, isPanelWindow: false, isAnchorWindow: true, isInsideAnchorBounds: true,
  }), 'dismissRestoreFocus')
  check('mlc.eventOutsideAnchor', editorMarkerEventDecision({
    isKeyDown: false, keyCode: 0, isPanelWindow: false, isAnchorWindow: true, isInsideAnchorBounds: false,
  }), 'dismiss')
  check('mlc.eventOtherWindow', editorMarkerEventDecision({
    isKeyDown: false, keyCode: 0, isPanelWindow: false, isAnchorWindow: false, isInsideAnchorBounds: false,
  }), 'dismiss')

  {
    const notifications = []
    const presenter = new EditorMarkerCardPresenter((presented) => notifications.push(presented))
    check('mlc.presenterRejectsWithoutAnchor', presenter.toggle(null), 'rejected')
    check('mlc.presenterNotPresented', presenter.isPresented, false)
    check('mlc.presenterOpens', presenter.toggle(3), 'presented')
    check('mlc.presenterLevel', presenter.panelLevel, 4)
    check('mlc.presenterTogglesClosed', presenter.toggle(3), 'dismissed')
    check('mlc.presenterNotifications', notifications.join(','), 'true,false')
    check('mlc.presenterDismissIdle', presenter.dismiss(), false)
    presenter.toggle(2)
    presenter.detach()
    check('mlc.presenterDetach', `${presenter.isPresented}:${presenter.panelLevel}`, 'false:0')
  }

  // ---------------------------------------------------------------------------
  // ScreenRecorderRunSafety.swift（244 行）
  // ---------------------------------------------------------------------------
  {
    const state = new ScreenRecorderRunSafetyState()
    const begun = state.begin('run-a')
    check('srs.beginAccepted', begun.kind, 'accepted')
    check('srs.beginGeneration', begun.token.streamGeneration, 1)
    const token = begun.token
    check('srs.activeRunID', state.activeRunID, 'run-a')
    check('srs.beginAgain', state.begin('run-b').kind, 'alreadyActive')
    check('srs.beginAgainRunID', state.begin('run-b').runID, 'run-a')
    check('srs.lifecycleStarting', state.lifecycle(token), 'starting')
    check('srs.registerStreams', state.registerStreams('s1', 's2', token), true)
    check('srs.registerWrongToken', state.registerStreams('s3', null, {
      runID: 'run-a', streamGeneration: 99,
    }), false)
    check('srs.tokenForPrimary', state.tokenForDelegate('s1').streamGeneration, 1)
    check('srs.tokenForUnknown', state.tokenForDelegate('nope'), null)
    check('srs.rolePrimary', state.streamRole('s1', token), 'primary')
    check('srs.roleSecondary', state.streamRole('s2', token), 'secondary')
    check('srs.roleUnknown', state.streamRole('nope', token), null)
    check('srs.markCapturing', state.markCapturing(token), true)
    check('srs.markCapturingAgain', state.markCapturing(token), false)
    check('srs.lifecycleCapturing', state.lifecycle(token), 'capturing')

    const update = state.makeSurfaceUpdate('run-a')
    check('srs.surfaceRevision', update.revision, 1)
    check('srs.surfaceDecisionApply', state.surfaceUpdateDecision(update, false), 'apply')
    check('srs.surfaceDecisionCancelled', state.surfaceUpdateDecision(update, true), 'cancelled')
    const second = state.makeSurfaceUpdate('run-a')
    check('srs.surfaceRevisionIncrements', second.revision, 2)
    check('srs.surfaceDecisionStaleRevision',
      state.surfaceUpdateDecision(update, false), 'stale')
    check('srs.surfaceUpdateWrongRun', state.makeSurfaceUpdate('run-b'), null)

    const error = { message: '磁盘已满' }
    check('srs.claimTerminal', state.claimTerminal(error, token), true)
    check('srs.lifecycleTerminal', state.lifecycle(token), 'terminal')
    check('srs.terminalError', state.terminalError('run-a').message, '磁盘已满')
    check('srs.terminalErrorOtherRun', state.terminalError('run-b'), null)
    check('srs.tokenForDelegateAfterTerminal', state.tokenForDelegate('s1'), null)
    check('srs.surfaceUpdateAfterTerminal', state.makeSurfaceUpdate('run-a'), null)
    check('srs.claimTerminalTwice', state.claimTerminal({ message: 'x' }, token), false)
    check('srs.beginStoppingFromTerminal', state.beginStopping('run-a').streamGeneration, 1)
    check('srs.lifecycleStopping', state.lifecycle(token), 'stopping')
    check('srs.end', state.end(token), true)
    check('srs.endedActive', state.activeRunID, null)
    check('srs.endTwice', state.end(token), false)
    check('srs.lifecycleAfterEnd', state.lifecycle(token), null)
    check('srs.beginAfterEnd', state.begin('run-c').token.streamGeneration, 2)
  }

  {
    const state = new ScreenRecorderRunSafetyState()
    const token = state.begin('run-x').token
    check('srs.deferTerminal', state.deferTerminalDuringStart({ message: '提前终止' }, token), true)
    check('srs.deferTerminalTwice', state.deferTerminalDuringStart({ message: 'again' }, token), false)
    check('srs.markCapturingAfterDefer', state.markCapturing(token), false)
    check('srs.lifecycleStillStarting', state.lifecycle(token), 'starting')
    check('srs.claimTerminalDuringStart', state.claimTerminal({ message: 'x' }, token), false)
    check('srs.deferredTerminalError', state.terminalError('run-x').message, '提前终止')
    check('srs.beginStoppingDuringStart', state.beginStopping('run-x'), null)
    // starting 阶段仍可换 token（代理回调可能先到）
    check('srs.deferRegister', state.registerStreams('s1', null, token), true)
    check('srs.deferTokenForDelegate', state.tokenForDelegate('s1').runID, 'run-x')
  }

  check('srs.outputErrorDomain', CAPTURE_OUTPUT_ERROR_DOMAIN, 'cn.laogou.dogsc.capture-output')
  check('srs.outputStages', Object.keys(CAPTURE_OUTPUT_TERMINAL_STAGE_DESCRIPTIONS).length, 3)
  check('srs.outputCodeWriter', captureOutputTerminalErrorCode('writerStart'), 1)
  check('srs.outputCodeVideo', captureOutputTerminalErrorCode('videoAppend'), 2)
  check('srs.outputCodeAudio', captureOutputTerminalErrorCode('audioAppend'), 3)
  check('srs.outputDescription', captureOutputTerminalErrorDescription('audioAppend', '磁盘已满'),
    '写入系统声音失败：磁盘已满')
  check('srs.outputCodesTable', CAPTURE_OUTPUT_TERMINAL_ERROR_CODES.writerStart, 1)

  {
    const terminal = new CaptureOutputTerminalState()
    check('srs.terminalNoStage', terminal.stage, null)
    check('srs.terminalClaimFirst', terminal.claim('writerStart'), true)
    check('srs.terminalClaimSecond', terminal.claim('videoAppend'), false)
    check('srs.terminalStage', terminal.stage, 'writerStart')
  }
}

await runWindowAndMarkerBatch()

console.log(`MODEL-RESULT passed=${passed} failed=${failed}`)
if (failed > 0) process.exit(1)
