// 复现：同一播放头连续两次分割
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'dogsc-repro-'))
await build({
  entryPoints: ['scripts/repro-split-entry.ts'],
  bundle: true, platform: 'node', format: 'esm',
  outfile: join(outDir, 'bundle.mjs'),
})
const m = await import(pathToFileURL(join(outDir, 'bundle.mjs')).href)
const { makeProjectTimeline, TimelineMap, Editing } = m

const DUR = 6.37
function snap(tl) {
  const map = new TimelineMap(tl.sourceSequence, DUR)
  return map.segments.map(s => ({
    id: s.id.slice(0, 6), src: +s.sourceStart.toFixed(4),
    dur: +s.sourceDuration.toFixed(4), rate: s.playbackRate,
  }))
}

const t = 2.5
// 第一次分割
let tl = makeProjectTimeline()
try {
  tl = Editing.splitPrimarySegment(tl, t, 'b1', DUR)
  console.log('SPLIT1 ok', JSON.stringify(snap(tl)))
} catch (e) { console.log('SPLIT1 threw', e.code) }

// 第二次：完全相同的时间
try {
  tl = Editing.splitPrimarySegment(tl, t, 'b2', DUR)
  console.log('SPLIT2-same ok', JSON.stringify(snap(tl)))
} catch (e) { console.log('SPLIT2-same threw', e.code) }

// 第二次：播放头微动 1ms（视频 timeupdate）
try {
  tl = Editing.splitPrimarySegment(tl, t + 0.001, 'b3', DUR)
  console.log('SPLIT2+1ms ok', JSON.stringify(snap(tl)))
} catch (e) { console.log('SPLIT2+1ms threw', e.code) }

// 第三次：再次 1ms
try {
  tl = Editing.splitPrimarySegment(tl, t + 0.002, 'b4', DUR)
  console.log('SPLIT3+1ms ok', JSON.stringify(snap(tl)))
} catch (e) { console.log('SPLIT3+1ms threw', e.code) }

// 尝试对最终 timeline 构建 map（store 的 useMemo 逻辑）
try {
  const map = new TimelineMap(tl.sourceSequence, DUR)
  console.log('MAP ok', JSON.stringify(snap(tl)), 'outDur=', map.outputDuration)
} catch (e) { console.log('MAP threw', e.code, e.message) }
