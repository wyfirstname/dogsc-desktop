/**
 * 剪辑核心逻辑冒烟测试。
 *
 * 直接对转写后的 TS 源码做数值断言 —— 与 Swift 原实现的语义逐项对齐。
 * 运行：node scripts/verify-editing.mjs
 */

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const entry = path.join(root, 'scripts', '.editing-test-entry.ts')
const outfile = path.join(root, 'scripts', '.editing-test-bundle.mjs')

fs.writeFileSync(
  entry,
  `
import * as TM from '../src/renderer/src/core/TimelineMap'
import * as PT from '../src/renderer/src/core/ProjectTimeline'
import * as ED from '../src/renderer/src/core/ProjectTimelineEditing'

const eps = 1e-6
let passed = 0
const failures = []

function check(name, actual, expected, tol = eps) {
  const ok = typeof expected === 'number'
    ? Math.abs(actual - expected) <= tol
    : JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { passed++; return }
  failures.push(name + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}

function approxList(name, actual, expected, tol = eps) {
  if (actual.length !== expected.length) {
    failures.push(name + ': length ' + actual.length + ' != ' + expected.length)
    return
  }
  for (let i = 0; i < actual.length; i++) {
    if (Math.abs(actual[i] - expected[i]) > tol) {
      failures.push(name + '[' + i + ']: expected ' + expected[i] + ', got ' + actual[i])
      return
    }
  }
  passed++
}

function expectThrow(name, fn, kind) {
  try {
    fn()
    failures.push(name + ': expected throw ' + kind + ', got none')
  } catch (error) {
    if (kind && error.kind !== kind) {
      failures.push(name + ': expected ' + kind + ', got ' + error.kind)
      return
    }
    passed++
  }
}

// ---------------------------------------------------------------- 1. fullRecording
{
  const map = new TM.TimelineMap({ kind: 'fullRecording' }, 10)
  check('full.segments', map.segments.length, 1)
  check('full.duration', map.outputDuration, 10)
  check('full.seg.sourceStart', map.segments[0].sourceStart, 0)
  check('full.seg.outputStart', map.segments[0].outputStart, 0)
  check('full.map(5)', map.sourceTimeAtOutputTime(5), 5)
  check('full.inverse(5)', map.outputTimeForSourceTime(5), 5)
}

// ---------------------------------------------------------------- 2. 累加推导 outputStart
{
  const seq = {
    kind: 'edited',
    segments: [
      { id: 'a', sourceStart: 0, sourceDuration: 2, playbackRate: 1 },
      { id: 'b', sourceStart: 4, sourceDuration: 3, playbackRate: 1 },
      { id: 'c', sourceStart: 8, sourceDuration: 2, playbackRate: 2 },
    ],
  }
  const map = new TM.TimelineMap(seq, 10)
  approxList('acc.outputStarts', map.segments.map(s => s.outputStart), [0, 2, 5])
  check('acc.total', map.outputDuration, 6)
  check('acc.segmentAt(0.5).id', map.segmentAtOutputTime(0.5).id, 'a')
  check('acc.segmentAt(2).id', map.segmentAtOutputTime(2).id, 'b')
  check('acc.segmentAt(4.99).id', map.segmentAtOutputTime(4.99).id, 'b')
  check('acc.segmentAt(5).id', map.segmentAtOutputTime(5).id, 'c')
  check('acc.segmentAt(6)', map.segmentAtOutputTime(6), null)
  check('acc.sourceAt(5.5)', map.sourceTimeAtOutputTime(5.5), 9)
  check('acc.inverse(9)', map.outputTimeForSourceTime(9), 5.5)
  // 源时刻 3 落在被删掉的间隙里
  check('acc.inverse(3)', map.outputTimeForSourceTime(3), null)
}

// ---------------------------------------------------------------- 3. 校验拒绝非法输入
{
  expectThrow('err.empty', () => new TM.TimelineMap({ kind: 'edited', segments: [] }, 10), 'emptyEditedSequence')
  expectThrow(
    'err.dup',
    () => new TM.TimelineMap({
      kind: 'edited',
      segments: [
        { id: 'a', sourceStart: 0, sourceDuration: 1, playbackRate: 1 },
        { id: 'a', sourceStart: 5, sourceDuration: 1, playbackRate: 1 },
      ],
    }, 10),
    'duplicateSegmentID'
  )
  expectThrow(
    'err.outside',
    () => new TM.TimelineMap({
      kind: 'edited',
      segments: [{ id: 'a', sourceStart: 9, sourceDuration: 5, playbackRate: 1 }],
    }, 10),
    'segmentOutsideSource'
  )
  expectThrow(
    'err.overlap',
    () => new TM.TimelineMap({
      kind: 'edited',
      segments: [
        { id: 'a', sourceStart: 0, sourceDuration: 5, playbackRate: 1 },
        { id: 'b', sourceStart: 3, sourceDuration: 2, playbackRate: 1 },
      ],
    }, 10),
    'nonMonotonicSegments'
  )
  expectThrow('err.duration', () => new TM.TimelineMap({ kind: 'fullRecording' }, 0), 'invalidFullSourceDuration')
}

// ---------------------------------------------------------------- 4. 分割
{
  const timeline = PT.makeProjectTimeline()
  const split = ED.splitPrimarySegment(timeline, 4, 'right-half', 10)
  check('split.count', split.sourceSequence.segments.length, 2)
  approxList(
    'split.ranges',
    split.sourceSequence.segments.map(s => s.sourceStart + ':' + s.sourceDuration),
    ['0:4', '4:6']
  )
  const map = new TM.TimelineMap(split.sourceSequence, 10)
  check('split.duration', map.outputDuration, 10)
  check('split.left.seg', map.segments[0].id, PT.FULL_RECORDING_SEGMENT_ID)
  check('split.right.seg', map.segments[1].id, 'right-half')
  // 分割点必须严格在片段内部
  expectThrow('split.edge0', () => ED.splitPrimarySegment(split, 0, 'x', 10), 'splitOutsideSegment')
  expectThrow('split.duration-edge', () => ED.splitPrimarySegment(split, 10, 'x', 10), 'splitOutsideSegment')
  expectThrow('split.dup', () => ED.splitPrimarySegment(split, 6, 'right-half', 10), 'duplicateSegmentID')
}

// ---------------------------------------------------------------- 5. 裁切 + 波纹
{
  const timeline = PT.makeProjectTimeline()
  const trimmed = ED.trimPrimarySegment(timeline, PT.FULL_RECORDING_SEGMENT_ID, 'left', 3, 10)
  const seq = trimmed.sourceSequence
  check('trim.left.sourceStart', seq.segments[0].sourceStart, 3)
  check('trim.left.sourceDuration', seq.segments[0].sourceDuration, 7)
  const map = new TM.TimelineMap(seq, 10)
  check('trim.left.output', map.outputDuration, 7)

  // 右端裁切
  const right = ED.trimPrimarySegment(timeline, PT.FULL_RECORDING_SEGMENT_ID, 'right', 6, 10)
  check('trim.right.duration', right.sourceSequence.segments[0].sourceDuration, 6)

  // 二次裁切：左端从 3 再裁到 4
  const again = ED.trimPrimarySegment(trimmed, seq.segments[0].id, 'left', 1, 10)
  check('trim.again.sourceStart', again.sourceSequence.segments[0].sourceStart, 4)
  check('trim.again.sourceDuration', again.sourceSequence.segments[0].sourceDuration, 6)

  // 向外扩展：把左边裁掉的素材拖回来
  const expanded = ED.trimPrimarySegment(again, seq.segments[0].id, 'left', -2, 10)
  check('trim.expand.sourceStart', expanded.sourceSequence.segments[0].sourceStart, 2)
  check('trim.expand.sourceDuration', expanded.sourceSequence.segments[0].sourceDuration, 8)

  // 超出可用源素材必须拒绝
  expectThrow(
    'trim.overflow',
    () => ED.trimPrimarySegment(expanded, seq.segments[0].id, 'left', -5, 10),
    'trimOutsideSegment'
  )
}

// ---------------------------------------------------------------- 6. 波纹删除 + 片段顺序
{
  const timeline = PT.makeProjectTimeline()
  const s1 = ED.splitPrimarySegment(timeline, 3, 'b', 10)
  const s2 = ED.splitPrimarySegment(s1, 6, 'c', 10)
  const map = new TM.TimelineMap(s2.sourceSequence, 10)
  approxList('cut.outputStarts', map.segments.map(s => s.outputStart), [0, 3, 6])

  const removed = ED.removePrimarySegment(s2, 'b', 10)
  check('cut.removed.count', removed.sourceSequence.segments.length, 2)
  const map2 = new TM.TimelineMap(removed.sourceSequence, 10)
  approxList('cut.after.sourceStarts', map2.segments.map(s => s.sourceStart), [0, 6])
  approxList('cut.after.outputStarts', map2.segments.map(s => s.outputStart), [0, 3])
  check('cut.after.duration', map2.outputDuration, 7)

  // 删除唯一片段必须失败
  const single = ED.splitPrimarySegment(timeline, 5, 'only-right', 10)
  const one = ED.removePrimarySegment(single, 'only-right', 10)
  expectThrow(
    'cut.final',
    () => ED.removePrimarySegment(one, PT.FULL_RECORDING_SEGMENT_ID, 10),
    'cannotRemoveFinalSegment'
  )
}

// ---------------------------------------------------------------- 7. 波纹删除带走效果轨道
{
  const base = PT.makeProjectTimeline({
    zoomClips: [
      {
        id: 'z1',
        startTime: 1, endTime: 2, scale: 2,
        focus: { x: 0.5, y: 0.5 }, origin: 'manual', easing: '三次方缓动',
        customCurve: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 },
        enterDuration: 0.3, exitDuration: 0.3,
        enterProgressOffset: 0, exitProgressOffset: 0,
        focusEffect: null, preferredEnterDuration: null, preferredExitDuration: null,
      },
      {
        id: 'z2',
        startTime: 7, endTime: 8, scale: 1.8,
        focus: { x: 0.5, y: 0.5 }, origin: 'manual', easing: '三次方缓动',
        customCurve: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 },
        enterDuration: 0.3, exitDuration: 0.3,
        enterProgressOffset: 0, exitProgressOffset: 0,
        focusEffect: null, preferredEnterDuration: null, preferredExitDuration: null,
      },
    ],
  })
  const s1 = ED.splitPrimarySegment(base, 3, 'b', 10)
  const s2 = ED.splitPrimarySegment(s1, 6, 'c', 10)
  const removed = ED.removePrimarySegment(s2, 'b', 10)
  const z2 = removed.zoomClips.find(c => c.id === 'z2')
  check('ripple.zoom.z2.start', z2.startTime, 4)
  check('ripple.zoom.z2.end', z2.endTime, 5)
  const z1 = removed.zoomClips.find(c => c.id === 'z1')
  check('ripple.zoom.z1.start', z1.startTime, 1)

  // 删除区间内的缩放片段应消失
  const insideBase = PT.makeProjectTimeline({
    zoomClips: [{
      id: 'mid',
      startTime: 3.5, endTime: 5.5, scale: 2,
      focus: { x: 0.5, y: 0.5 }, origin: 'manual', easing: '三次方缓动',
      customCurve: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 },
      enterDuration: 0.3, exitDuration: 0.3,
      enterProgressOffset: 0, exitProgressOffset: 0,
      focusEffect: null, preferredEnterDuration: null, preferredExitDuration: null,
    }],
  })
  const a1 = ED.splitPrimarySegment(insideBase, 3, 'b', 10)
  const a2 = ED.splitPrimarySegment(a1, 6, 'c', 10)
  const a3 = ED.removePrimarySegment(a2, 'b', 10)
  check('ripple.zoom.deleted', a3.zoomClips.length, 0)
}

// ---------------------------------------------------------------- 8. 变速
{
  const timeline = PT.makeProjectTimeline()
  const fast = ED.settingPlaybackRate(2, PT.FULL_RECORDING_SEGMENT_ID, timeline, 10)
  const map = new TM.TimelineMap(fast.sourceSequence, 10)
  check('rate.output', map.outputDuration, 5)
  check('rate.sourceDuration', map.segments[0].sourceDuration, 10)
  check('rate.rate', map.segments[0].playbackRate, 2)
  check('rate.sourceTime(3)', map.sourceTimeAtOutputTime(3), 6)

  // 上下限
  const clampedLow = ED.settingPlaybackRate(0.1, PT.FULL_RECORDING_SEGMENT_ID, timeline, 10)
  check('rate.min', clampedLow.sourceSequence.segments[0].playbackRate, 1)
  const clampedHigh = ED.settingPlaybackRate(500, PT.FULL_RECORDING_SEGMENT_ID, timeline, 10)
  check('rate.max', clampedHigh.sourceSequence.segments[0].playbackRate, 100)

  // 变速后时长：10s 源 @ 100× = 0.1s 输出
  const highMap = new TM.TimelineMap(clampedHigh.sourceSequence, 10)
  check('rate.max.output', highMap.outputDuration, 0.1)

  // 相同倍速不产生变更
  const same = ED.settingPlaybackRate(1, PT.FULL_RECORDING_SEGMENT_ID, timeline, 10)
  check('rate.noop.rate', same.sourceSequence.segments[0].playbackRate, 1)
}

// ---------------------------------------------------------------- 9. 变速平移效果轨道
{
  const timeline = PT.makeProjectTimeline({
    zoomClips: [{
      id: 'z',
      startTime: 6, endTime: 8, scale: 2,
      focus: { x: 0.5, y: 0.5 }, origin: 'manual', easing: '三次方缓动',
      customCurve: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 },
      enterDuration: 0.5, exitDuration: 0.5,
      enterProgressOffset: 0, exitProgressOffset: 0,
      focusEffect: null, preferredEnterDuration: null, preferredExitDuration: null,
    }],
  })
  const seg = ED.splitPrimarySegment(timeline, 5, 'b', 10)
  const fast = ED.settingPlaybackRate(2, 'b', seg, 10)
  const z = fast.zoomClips[0]
  // 片段 b 从 output 5 开始；z 在 b 内部 (6-5)*0.5 => 0.5，所以新起点 5.5
  check('retime.zoom.start', z.startTime, 5.5)
  // 时长保持在输出时钟上（2s）
  check('retime.zoom.dur', z.endTime - z.startTime, 2)
}

// ---------------------------------------------------------------- 10. 还原剪切点
{
  const timeline = PT.makeProjectTimeline()
  const s1 = ED.splitPrimarySegment(timeline, 3, 'b', 10)
  const s2 = ED.splitPrimarySegment(s1, 6, 'c', 10)
  const removed = ED.removePrimarySegment(s2, 'b', 10)
  const restored = ED.restorePrimaryGap(removed, PT.FULL_RECORDING_SEGMENT_ID, 'c', 'b2', 10)
  check('restore.count', restored.sourceSequence.segments.length, 3)
  approxList('restore.sourceStarts', restored.sourceSequence.segments.map(s => s.sourceStart), [0, 3, 6])
  const map = new TM.TimelineMap(restored.sourceSequence, 10)
  check('restore.duration', map.outputDuration, 10)

  // 开头还原
  const trimmed = ED.trimPrimarySegment(timeline, PT.FULL_RECORDING_SEGMENT_ID, 'left', 2, 10)
  const leading = ED.restorePrimaryLeadingGap(trimmed, 'head', 10)
  check('restore.leading.first', leading.sourceSequence.segments[0].id, 'head')
  check('restore.leading.start', leading.sourceSequence.segments[0].sourceStart, 0)

  // 结尾还原
  const trimmedR = ED.trimPrimarySegment(timeline, PT.FULL_RECORDING_SEGMENT_ID, 'right', 7, 10)
  const trailing = ED.restorePrimaryTrailingGap(trimmedR, 'tail', 10)
  const lastSeg = trailing.sourceSequence.segments[trailing.sourceSequence.segments.length - 1]
  check('restore.trailing.id', lastSeg.id, 'tail')
  check('restore.trailing.duration', lastSeg.sourceDuration, 3)
}

// ---------------------------------------------------------------- 11. 合并相邻分割
{
  const timeline = PT.makeProjectTimeline()
  const s1 = ED.splitPrimarySegment(timeline, 4, 'b', 10)
  const merged = ED.mergeAdjacentPrimarySegments(s1, PT.FULL_RECORDING_SEGMENT_ID, 'b', 10)
  check('merge.count', merged.sourceSequence.segments.length, 1)
  check('merge.duration', merged.sourceSequence.segments[0].sourceDuration, 10)
  // 有删除间隙时不能合并
  const s2 = ED.splitPrimarySegment(timeline, 3, 'b', 10)
  const s3 = ED.splitPrimarySegment(s2, 6, 'c', 10)
  const removed = ED.removePrimarySegment(s3, 'b', 10)
  expectThrow(
    'merge.gap',
    () => ED.mergeAdjacentPrimarySegments(removed, PT.FULL_RECORDING_SEGMENT_ID, 'c', 10),
    'cannotMergeDeletedGap'
  )
}

// ---------------------------------------------------------------- 12. 非法状态拒绝
{
  const timeline = PT.makeProjectTimeline()
  expectThrow(
    'validate.negDur',
    () => ED.validate(PT.makeProjectTimeline({
      sourceSequence: {
        kind: 'edited',
        segments: [{ id: 'a', sourceStart: 0, sourceDuration: -1, playbackRate: 1 }],
      },
    })),
    'invalidSourceSequence'
  )
  expectThrow(
    'trim.unknown',
    () => ED.trimPrimarySegment(timeline, 'nope', 'left', 1, 10),
    'segmentNotFound'
  )
}

// ---------------------------------------------------------------- 13. 快照输出
{
  const timeline = PT.makeProjectTimeline()
  const s1 = ED.splitPrimarySegment(timeline, 2, 'b', 10)
  const s2 = ED.splitPrimarySegment(s1, 5, 'c', 10)
  const s3 = ED.splitPrimarySegment(s2, 8, 'd', 10)
  const cut = ED.removePrimarySegment(s3, 'c', 10)
  const map = new TM.TimelineMap(cut.sourceSequence, 10)
  const snapshot = map.segments.map(s => ({
    id: s.id,
    src: s.sourceStart,
    dur: s.sourceDuration,
    out: s.outputStart,
  }))
  passed++
  console.log('SNAPSHOT ' + JSON.stringify(snapshot))
  console.log('SNAPSHOT_DURATION ' + map.outputDuration)
}

console.log('PASSED ' + passed)
if (failures.length) {
  console.log('FAILED ' + failures.length)
  for (const f of failures) console.log('  - ' + f)
  process.exitCode = 1
} else {
  console.log('ALL OK')
}
`
)

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'error',
})

await import('file://' + outfile.replace(/\\/g, '/'))
fs.rmSync(entry, { force: true })
fs.rmSync(outfile, { force: true })
