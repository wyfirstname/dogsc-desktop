/**
 * 基础批次（CaptureConfiguration / RecordingMarker / ElementMotion /
 * PointerEventTimelineOrdering / PointerTimelineAlignment /
 * ZoomTransitionResolution / TimelineTrackOrdering / BoundedMemoizationCache /
 * OutputFrameSchedule）的数值冒烟测试。
 *
 * 运行：node scripts/verify-batch1.mjs
 */
import { build } from 'esbuild'
import { writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const entry = join(root, 'scripts', '.batch1-entry.ts')
const outfile = join(root, 'scripts', '.batch1-bundle.mjs')

writeFileSync(entry, `
import { makeFrameIntervalDiagnostics, h264CompatibleDimensions, applyResolutionLimit, makeFrameRateMeasurement, actualFPS, estimatedDroppedFrames } from '../src/renderer/src/core/CaptureConfiguration'
import { makeRecordingMarker } from '../src/renderer/src/core/RecordingMarker'
import { elementMotionProgress } from '../src/renderer/src/core/ElementMotion'
import { normalizedPointerEvents } from '../src/renderer/src/core/PointerEventTimelineOrdering'
import { alignPointerEvents } from '../src/renderer/src/core/PointerTimelineAlignment'
import { resolveZoomTransitions } from '../src/renderer/src/core/ZoomTransitionResolution'
import { zoomAnimationsNeedRepair } from '../src/renderer/src/core/TimelineTrackOrdering'
import { BoundedMemoizationCache } from '../src/renderer/src/core/BoundedMemoizationCache'
import { OutputFrameSchedule, OutputFrameScheduleError, PRESENTATION_TIMESCALE } from '../src/renderer/src/core/OutputFrameSchedule'

let passed = 0
const failures: string[] = []
function check(name: string, actual: unknown, expected: unknown, tol = 1e-9) {
  const ok = typeof expected === 'number' && typeof actual === 'number'
    ? Math.abs(actual - expected) <= tol
    : JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passed++
  else failures.push(name + ': expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual))
}
function expectThrow(name: string, fn: () => void, kind: string) {
  try { fn(); failures.push(name + ': no throw') }
  catch (e: any) { e.kind === kind ? passed++ : failures.push(name + ': ' + e.kind) }
}

// ---- FrameIntervalDiagnostics
{
  const d = makeFrameIntervalDiagnostics([0.016, 0.02, 0.05, 0.04, 0.03, 0.03, 0.03, 0.017, 0.016, 0.016])
  check('diag.count', d.sampleCount, 10)
  // >0.025：0.05, 0.04, 0.03, 0.03, 0.03 → 5
  check('diag.over25', d.over25Milliseconds, 5)
  // >1/30≈0.0333：0.05, 0.04 → 2
  check('diag.over33', d.over33Milliseconds, 2)
  check('diag.over50', d.over50Milliseconds, 0) // 严格大于：0.05 不算
  check('diag.maxRun', d.maximumConsecutiveOver33Milliseconds, 2)
}

// ---- CaptureDimensions
{
  const d = h264CompatibleDimensions(3024, 1964)
  check('h264.widthEven', d.width % 2, 0)
  check('h264.heightEven', d.height % 2, 0)
  check('h264.scaled', d.width <= 4096 && d.height <= 2304, true)
  const noUpscale = h264CompatibleDimensions(100, 50)
  check('h264.noUpscale', noUpscale, { width: 100, height: 50 })
  const limited = applyResolutionLimit('fullHD', { width: 3840, height: 2160 })
  check('limit.fullHD.landscape', limited, { width: 1920, height: 1080 })
  const portrait = applyResolutionLimit('fullHD', { width: 2160, height: 3840 })
  check('limit.fullHD.portrait', portrait, { width: 1080, height: 1920 })
}

// ---- FrameRateMeasurement
{
  const m = makeFrameRateMeasurement({ target: 60, deliveredFrames: 121, elapsed: 2 })
  check('fps.actual', actualFPS(m), 60)
  check('fps.dropped', estimatedDroppedFrames(m), 0)
  const idle = makeFrameRateMeasurement({ target: 60, deliveredFrames: 30, idleFrames: 100, elapsed: 2 })
  check('fps.idleCeiling', Math.round((idle.receivedFrames + idle.idleFrames) / idle.elapsed), 65)
}

// ---- RecordingMarker
{
  const m = makeRecordingMarker({ sourceTime: -3, number: 0 })
  check('marker.clampTime', m.sourceTime, 0)
  check('marker.clampNumber', m.number, 1)
}

// ---- ElementMotion
{
  check('motion.smooth.0', elementMotionProgress(0, 'smooth'), 0)
  check('motion.smooth.1', elementMotionProgress(1, 'smooth'), 1)
  check('motion.smooth.0.5', elementMotionProgress(0.5, 'smooth'), 0.5)
  check('motion.swift.0.5', elementMotionProgress(0.5, 'swift'), 1 - Math.pow(0.5, 4))
  check('motion.gentle.0.5', elementMotionProgress(0.5, 'gentle'), 1 - Math.pow(0.5, 3))
  check('motion.nanClamped', elementMotionProgress(NaN, 'smooth'), 0)
}

// ---- PointerEventTimelineOrdering
{
  const ev = (time: number, kind: any = 'move') => ({ time, location: { x: 0, y: 0 }, kind, modifiers: [] })
  const sorted = [ev(1), ev(2), ev(3)]
  check('pe.sharedRef', normalizedPointerEvents(sorted) === sorted, true)
  const shuffled = [ev(2), ev(1), ev(3), ev(0.5)]
  const fixed = normalizedPointerEvents(shuffled)
  check('pe.sortedTimes', fixed.map(e => e.time), [0.5, 1, 2, 3])
  check('pe.nanFiltered', normalizedPointerEvents([ev(1), ev(NaN)]).length, 1)
}

// ---- PointerTimelineAlignment
{
  const ev = (time: number) => ({ time, location: { x: time, y: 0 }, kind: 'move' as const, modifiers: [] })
  const out = alignPointerEvents([ev(-0.5), ev(0.3), ev(1.0)], 0, 0.2)
  // shift = 0 - 0.2 = -0.2；-0.5+(-0.2)=-0.7 <0 → preRoll；0.3-0.2=0.1；1.0-0.2=0.8
  check('align.first', out[0].time, 0)
  check('align.firstLoc', out[0].location.x, -0.5)
  check('align.rest0', out[1].time, 0.1, 1e-12)
  check('align.rest1', out[2].time, 0.8, 1e-12)
  // shift<0 时全部 pre-roll：整条轨道塌缩成 t=0 的一个 move 种子
  const allNegative = alignPointerEvents([ev(-2), ev(-1)], 0, 3)
  check('align.allNegative', allNegative.length, 1)
  check('align.allNegativeLoc', allNegative[0].location.x, -1)
  check('align.allNegativeTime', allNegative[0].time, 0)
}

// ---- ZoomTransitionResolution
{
  const clip = (id: string, startTime: number, endTime: number, enter = 0.7, exit = 0.7): any => ({
    id, startTime, endTime, scale: 2, focus: { x: 0.5, y: 0.5 }, origin: 'manual',
    easing: '三次方缓动', customCurve: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 },
    enterDuration: enter, exitDuration: exit, enterProgressOffset: 0, exitProgressOffset: 0,
    focusEffect: null, preferredEnterDuration: null, preferredExitDuration: null,
  })
  // 尾部片段被拟合到输出末尾
  const r1 = resolveZoomTransitions([clip('z', 8, 10.5)], 10)
  check('ztr.exitShort', r1[0].endTime < 10 && r1[0].exitDuration > 0, true)
  // 相接片段退出被休眠
  const r2 = resolveZoomTransitions([clip('a', 0, 2), clip('b', 2, 4)], 10)
  check('ztr.adjacentExit', r2[0].exitDuration, 0)
  // 空输出时长 → 空
  check('ztr.empty', resolveZoomTransitions([clip('z', 0, 1)], 0).length, 0)
}

// ---- TimelineTrackOrdering
{
  const clip = (id: string, startTime: number, dur = 1): any => ({
    id, startTime, endTime: startTime + dur, scale: 2, focus: { x: 0.5, y: 0.5 },
    origin: 'manual', easing: '三次方缓动', customCurve: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 },
    enterDuration: 0.3, exitDuration: 0.3, enterProgressOffset: 0, exitProgressOffset: 0,
    focusEffect: null, preferredEnterDuration: null, preferredExitDuration: null,
  })
  check('order.ok', zoomAnimationsNeedRepair([clip('a', 0), clip('b', 2)]), false)
  check('order.unsorted', zoomAnimationsNeedRepair([clip('b', 2), clip('a', 0)]), true)
  check('order.zeroDur', zoomAnimationsNeedRepair([clip('a', 0, 0)]), true)
}

// ---- BoundedMemoizationCache
{
  const cache = new BoundedMemoizationCache<string, number>(2)
  cache.value('a', () => 1)
  cache.value('b', () => 2)
  cache.value('a', () => 99)
  check('lru.hit', cache.value('a', () => 99), 1)
  cache.value('c', () => 3) // 驱逐 b（a 刚被访问，LRU 顺序 b,a → 插 c 驱逐 b）
  check('lru.evict', cache.value('b', () => 22), 22) // b 重建后又驱逐 a
  check('lru.keep', cache.value('a', () => 99), 99)  // a 已被驱逐，重新构建
  check('lru.size', cache.count, 2)
  check('lru.partial', cache.valueIfBuilt('x', () => null), null)
  check('lru.partialNotStored', cache.valueIfBuilt('x', () => 7), 7)
}

// ---- OutputFrameSchedule
{
  const s = new OutputFrameSchedule(10, 60)
  check('ofs.count', s.frameCount, 600)
  check('ofs.ticks', s.ticksPerFrame, PRESENTATION_TIMESCALE / 60)
  const f0 = s.frame(0)!
  const f599 = s.frame(599)!
  check('ofs.f0pts', f0.presentationTimeValue, 0)
  check('ofs.f599pts', f599.presentationTimeValue, 599 * 1500)
  check('ofs.f599sec', Math.abs(f599.presentationTimeValue / 90000 - 599 / 60) < 1e-12, true)
  check('ofs.oob', s.frame(600), null)
  expectThrow('ofs.negative', () => new OutputFrameSchedule(-1, 60), 'invalidDuration')
  // 浮点表示噪声吸附：0.9999999999999999s @ 90fps 应精确得 90 帧（而非 89）
  const noisy = new OutputFrameSchedule((1 / 90) * 90, 90)
  check('ofs.noiseSnap', noisy.frameCount, 90)
  const tiny = new OutputFrameSchedule(1 / 90, 90)
  check('ofs.subFrame', tiny.frameCount, 1)
}

console.log('PASSED ' + passed)
if (failures.length) {
  console.log('FAILED ' + failures.length)
  for (const f of failures) console.log('  - ' + f)
  process.exitCode = 1
} else {
  console.log('ALL OK')
}
`)

await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error' })
await import('file://' + outfile.replace(/\\/g, '/'))
rmSync(entry, { force: true })
rmSync(outfile, { force: true })
