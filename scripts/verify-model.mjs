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

console.log(`MODEL-RESULT passed=${passed} failed=${failed}`)
if (failed > 0) process.exit(1)
