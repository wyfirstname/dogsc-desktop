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

console.log(`MODEL-RESULT passed=${passed} failed=${failed}`)
if (failed > 0) process.exit(1)
