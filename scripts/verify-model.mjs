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

console.log(`MODEL-RESULT passed=${passed} failed=${failed}`)
if (failed > 0) process.exit(1)
