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

console.log(`MODEL-RESULT passed=${passed} failed=${failed}`)
if (failed > 0) process.exit(1)
