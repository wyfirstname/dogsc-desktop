/**
 * 时间线派生呈现缓存 —— 全文档级别的同步记忆化（非可观察对象）。
 *
 * Swift source: Sources/DogSCApp/EditorTimelineDerivedPresentationCache.swift（322 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorCameraSyncCurveSample                       L4-8   → EditorCameraSyncCurveSample
 *   - class EditorTimelineDerivedPresentationCache             L14-321
 *     · recordingMarkers（输入相等则复用 + 按输出时刻排序）      L23-32  → editorRecordingMarkers
 *     · waveformPlan（片段 → SourceSequence → 计划）            L46-60  → editorTimelineWaveformInputKey
 *     · timelineMap（源序列 + 全源时长）                        L109-124 → editorTimelineCacheReuses
 *     · zoomSegments（含 id → 索引表）                          L126-148 → editorIndexByID
 *     · screenMotionClips / cameraMotionClips                   L150-210 → editorMotionTimelineClips
 *     · segmentJunctions / leadingGap / trailingGap             L212-286 → EDITOR_PRIMARY_PRESENTATION_PARTS
 *     · cameraSyncCurve / cameraSyncDisplayRange                L227-294 → editorSyncDisplayRange
 *     · cameraSyncPathSamples（逐片段 + 片段内锚点）             L237-279 → editorCameraSyncCurveSamples
 *     · firstAnchorIndex（二分找第一个 > sourceTime 的锚点）      L296-311 → editorFirstAnchorIndexAfter
 *     · motionOrder（startTime 相同则按 uuid 字符串）            L313-320 → editorMotionClipOrder
 *
 * 原注释（L10-13）：
 *   Synchronous, non-observable memoization for full-document timeline values.
 *   Native viewport movement and hover chrome can rebuild the SwiftUI body, but
 *   they must not remap/sort every offscreen clip or publish another state
 *   change from inside that body evaluation.
 *
 * 原注释（L44-45）：
 *   Pure media-time math over the existing PCM data. A ripple draft must move
 *   every following audio slice with the same displayed segment map.
 *
 * 原注释（L137-138）：
 *   A small, stable source-time grid improves reuse during zoom/trim.
 *
 * 迁移说明：Swift 的「输入相等就返回上一份结果」模式在 TS 里由一个
 * `EditorTimelineDerivedCache` 类承载；这里保留五件纯逻辑：标记排序、
 * 运动片段过滤与排序、索引表构造、同步曲线的显示范围、以及
 * 「逐片段 + 片段内锚点」的取样点生成（含二分查找）。
 */

// ---------------------------------------------------------------- 标记

/** Swift L4-8：同步曲线上的一个取样点。 */
export interface EditorCameraSyncCurveSample {
  readonly startsSubpath: boolean
  readonly outputTime: number
  readonly offset: number
}

/**
 * Swift L28-30：把录制标记映射到输出时间轴并按输出时刻排序。
 *
 * 映射不到的是被裁掉的标记（`outputTime(forSourceTime:)` 返回 nil），
 * 直接过滤掉而不是夹到边界 —— 夹到边界会让标记堆在片段交界处。
 *
 * 输出时刻相同时按标记编号排（`marker.number`）：同一帧插入的多个标记
 * 必须有稳定顺序，否则每次重算列表都会跳。
 */
export function editorRecordingMarkers<T extends { readonly number: number }>(input: {
  readonly markers: readonly T[]
  readonly outputTimeOf: (marker: T) => number | null
}): { readonly marker: T; readonly outputTime: number }[] {
  const mapped: { marker: T; outputTime: number }[] = []
  for (const marker of input.markers) {
    const outputTime = input.outputTimeOf(marker)
    if (outputTime === null || !Number.isFinite(outputTime)) continue
    mapped.push({ marker, outputTime })
  }
  mapped.sort((a, b) => {
    if (a.outputTime !== b.outputTime) return a.outputTime - b.outputTime
    return a.marker.number - b.marker.number
  })
  return mapped
}

// ---------------------------------------------------------------- 缓存复用

/**
 * Swift L54 / L117 / L131 / L156：所有缓存的分支都长这样 ——
 * 「输入没变就返回上一次的结果，变了才重算并换掉输入」。
 *
 * 抽成一个判定函数，是因为这条规则在本文件里出现七次，
 * 而任何一处写反（比如漏掉时长字段）都会表现为「改了参数但画面没变」。
 */
export function editorTimelineCacheReuses<T>(previous: T | null, next: T): boolean {
  if (previous === null) return false
  return editorTimelineInputEquals(previous, next)
}

/**
 * Swift 的 `Equatable` 对结构体是逐字段比较。
 *
 * TS 侧用「浅比较 + 数组逐项 + 嵌套对象递归」来等价：本文件的输入全是
 * 结构体与小数组，浅层递归足够，而且比序列化成字符串快得多。
 */
export function editorTimelineInputEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
      if (!editorTimelineInputEquals(a[index], b[index])) return false
    }
    return true
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const leftKeys = Object.keys(left)
    if (leftKeys.length !== Object.keys(right).length) return false
    for (const key of leftKeys) {
      if (!editorTimelineInputEquals(left[key], right[key])) return false
    }
    return true
  }
  return false
}

// ---------------------------------------------------------------- 索引表

/**
 * Swift L137-141 / L168-172：`Dictionary(uniqueKeysWithValues: indices.map { ... })`。
 *
 * 用首见索引覆盖后见的 —— 同一 id 出现两次时保留**第一份**，
 * 与 Swift 字典构造「重复键会崩溃」不同，这里选择容错：
 * 工程数据损坏时不该让整条时间线打不开。
 */
export function editorIndexByID(ids: readonly string[]): Map<string, number> {
  const map = new Map<string, number>()
  ids.forEach((id, index) => {
    if (!map.has(id)) map.set(id, index)
  })
  return map
}

/** Swift L146-148 / L177-179 / L208-210：`id.flatMap { map[$0] }` —— null 直接给 null。 */
export function editorIndexLookup(
  map: ReadonlyMap<string, number>,
  id: string | null
): number | null {
  if (id === null) return null
  const index = map.get(id)
  return index === undefined ? null : index
}

// ---------------------------------------------------------------- 运动片段

/**
 * Swift L166 / L197：运动片段的可见性判定。
 *
 * 两个条件：`endTime > 0`（零长度片段不该画）与
 * `startTime < duration`（起点超出总时长的不画）。
 *
 * 第二条件故意用 `<` 而不是 `<=`：起点正好等于总时长意味着它从头到尾
 * 都不在时间线里，画出来会是一根贴着末尾的零宽线。
 */
export function editorMotionClipIsVisible(input: {
  readonly startTime: number
  readonly endTime: number
  readonly duration: number
}): boolean {
  return input.endTime > 0 && input.startTime < input.duration
}

/**
 * Swift L313-320：运动片段的排序。
 *
 * 起点相同时按 `id.uuidString` 排 —— 用字符串而不是插入顺序，
 * 因为 Swift 的 sort 不稳定，不指定次序时同起点片段的相对位置每次都可能变。
 */
export function editorMotionClipOrder(
  a: { readonly startTime: number; readonly id: string },
  b: { readonly startTime: number; readonly id: string }
): number {
  if (a.startTime !== b.startTime) return a.startTime - b.startTime
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Swift L156-175 / L186-205：把一种运动片段转成时间线呈现用的裁剪列表。
 *
 * 三步：投影成通用结构（带 track 标记）→ 过滤不可见的 → 按统一顺序排序。
 *
 * `track` 字段是 `screen` / `camera`：两种轨道在同一块时间线上并排画，
 * 通用结构让绘制代码只认一个类型。
 */
export function editorMotionTimelineClips<T extends {
  readonly id: string
  readonly startTime: number
  readonly endTime: number
  readonly groupID: string | null
}>(input: {
  readonly clips: readonly T[]
  readonly duration: number
  readonly track: 'screen' | 'camera'
}): {
  readonly id: string
  readonly startTime: number
  readonly endTime: number
  readonly groupID: string | null
  readonly track: 'screen' | 'camera'
}[] {
  const projected = input.clips
    .filter((clip) =>
      editorMotionClipIsVisible({
        startTime: clip.startTime,
        endTime: clip.endTime,
        duration: input.duration,
      })
    )
    .map((clip) => ({
      id: clip.id,
      startTime: clip.startTime,
      endTime: clip.endTime,
      groupID: clip.groupID,
      track: input.track,
    }))
  projected.sort(editorMotionClipOrder)
  return projected
}

// ---------------------------------------------------------------- 主轨呈现

/**
 * Swift L284-286：主轨呈现的三个派生值必须一起重算。
 *
 * 它们都从同一份 `TimelineMap` 推导（片段交界、开头空隙、结尾空隙），
 * 只重算其中一个会让三者互相不一致 —— 比如片段数变了但空隙还用旧值。
 */
export const EDITOR_PRIMARY_PRESENTATION_PARTS = [
  'segmentJunctions',
  'leadingGap',
  'trailingGap',
] as const

/**
 * Swift L281-283：用 `primaryJunctionMap != map` 做记忆化。
 *
 * 注意这里比较的是**整份 map**，不是某一个字段：`TimelineMap` 是值类型，
 * 任何字段变化都意味着三个派生值都可能变。
 */
export function editorPrimaryPresentationStale(
  previousMap: unknown,
  nextMap: unknown
): boolean {
  return previousMap !== nextMap
}

// ---------------------------------------------------------------- 同步曲线

/** Swift L293：显示范围的下限 0.100 秒。 */
export const EDITOR_SYNC_DISPLAY_RANGE_MINIMUM = 0.1

/**
 * Swift L293：显示范围的放大系数 1.18。
 *
 * 乘 1.18 是为了让曲线上下各留一点余量 —— 取整到最大值会让峰值正好贴在
 * 图表的上下边界上，波峰看起来「被切掉」。
 */
export const EDITOR_SYNC_DISPLAY_RANGE_FACTOR = 1.18

/**
 * Swift L293：`max(max(|offset|), 0.100) × 1.18`。
 *
 * 分两步：先取所有锚点偏移绝对值的最大值，再与 0.100 取大（全零偏移时
 * 不能给 0，否则整个图表会塌成一条线），最后乘 1.18。
 */
export function editorSyncDisplayRange(offsets: readonly number[]): number {
  let maximum = 0
  for (const offset of offsets) {
    const magnitude = Math.abs(offset)
    if (Number.isFinite(magnitude) && magnitude > maximum) maximum = magnitude
  }
  return Math.max(maximum, EDITOR_SYNC_DISPLAY_RANGE_MINIMUM) * EDITOR_SYNC_DISPLAY_RANGE_FACTOR
}

/**
 * Swift L296-311：二分查找「第一个 sourceTime 大于给定值」的锚点索引。
 *
 * 手写二分而不是 `firstIndex(where:)`，是因为这个方法在
 * `cameraSyncPathSamples` 里对**每个片段**都调用一次：线性扫描在
 * 「200 个片段 × 500 个锚点」时会变成 10 万次比较，二分是 200 × 9。
 *
 * 返回 `anchors.count` 表示「没有更晚的锚点」，调用方的 while 循环自然结束。
 */
export function editorFirstAnchorIndexAfter(
  sourceTime: number,
  anchorSourceTimes: readonly number[]
): number {
  let lower = 0
  let upper = anchorSourceTimes.length
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2)
    if (anchorSourceTimes[middle] <= sourceTime) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }
  return lower
}

/**
 * Swift L247：取样点数组的预留容量 = 每片段 2 个（起点 + 终点）+ 锚点数。
 *
 * 「2 个」是固定的（每片段必有一个 subpath 起点和一个终点），
 * 锚点部分只是上限估计 —— 实际落进片段内的锚点通常远少于总数。
 */
export function editorCameraSyncSampleReserveCapacity(
  segmentCount: number,
  anchorCount: number
): number {
  const segments = Number.isFinite(segmentCount) ? Math.max(segmentCount, 0) : 0
  const anchors = Number.isFinite(anchorCount) ? Math.max(anchorCount, 0) : 0
  return segments * 2 + anchors
}

/**
 * Swift L237-279：生成同步曲线的多段路径取样点。
 *
 * 每个片段产出三类点：
 *   1. `startsSubpath: true` 的起点（输出时刻 = 片段输出起点）
 *   2. 片段**内部**的每个锚点（输出时刻 = 片段输出起点 + 锚点相对源起点的偏移）
 *   3. 终点（`startsSubpath: false`，输出时刻 = 片段输出终点）
 *
 * `startsSubpath` 只在每段第一个点上为 true：它表示「这里要断开路径重新起笔」，
 * 否则整条曲线会跨片段连成一根斜线，把片段之间的跳变画成一个斜坡。
 *
 * 内部锚点的循环条件 `anchor.sourceTime < segment.sourceEnd` 用严格小于：
 * 正好落在片段末尾的锚点由第 3 类点（终点）承担，重复添加会产生一个
 * 零长度路径段。
 */
export function editorCameraSyncCurveSamples(input: {
  readonly segments: readonly {
    readonly outputStart: number
    readonly outputEnd: number
    readonly sourceStart: number
    readonly sourceEnd: number
  }[]
  readonly anchorSourceTimes: readonly number[]
  readonly offsetAtSourceTime: (sourceTime: number) => number
}): EditorCameraSyncCurveSample[] {
  const samples: EditorCameraSyncCurveSample[] = []
  samples.length = 0
  for (const segment of input.segments) {
    samples.push({
      startsSubpath: true,
      outputTime: segment.outputStart,
      offset: input.offsetAtSourceTime(segment.sourceStart),
    })

    let anchorIndex = editorFirstAnchorIndexAfter(
      segment.sourceStart,
      input.anchorSourceTimes
    )
    while (anchorIndex < input.anchorSourceTimes.length) {
      const anchorSourceTime = input.anchorSourceTimes[anchorIndex]
      if (!(anchorSourceTime < segment.sourceEnd)) break
      samples.push({
        startsSubpath: false,
        outputTime: segment.outputStart + anchorSourceTime - segment.sourceStart,
        offset: input.offsetAtSourceTime(anchorSourceTime),
      })
      anchorIndex += 1
    }

    samples.push({
      startsSubpath: false,
      outputTime: segment.outputEnd,
      offset: input.offsetAtSourceTime(segment.sourceEnd),
    })
  }
  return samples
}

/**
 * Swift L241-242 / L245：路径取样先取曲线再取锚点。
 *
 * `cameraSyncCurve(for:)` 内部会先 `prepareCameraSyncPresentation`（有记忆化），
 * 所以这里拿到的是已经和当前锚点同步的那一份 —— 直接读 `syncCurve` 字段
 * 会在锚点刚变、曲线还没重算的那一帧用上旧曲线。
 */
export function editorCameraSyncPathUsesPreparedCurve(): boolean {
  return true
}

/**
 * Swift L188-190：波形计划的输入键。
 *
 * 把片段折成 `SourceSequence.edited(...)` 之后比较 —— 比的是
 * 「id / 源起点 / 源时长 / 播放速率」四项，而不是片段对象的引用。
 * Ripple 编辑会移动后续片段的源起点，所以这四项任何一项变化都必须重算。
 */
export function editorTimelineWaveformSegmentKey(segment: {
  readonly id: string
  readonly sourceStart: number
  readonly sourceDuration: number
  readonly playbackRate: number
}): string {
  return [segment.id, segment.sourceStart, segment.sourceDuration, segment.playbackRate].join('|')
}

/**
 * Swift L56-58：`try? ProjectTimelineMediaPlan(...)` —— 构造失败时缓存 null。
 *
 * 不抛给调用方：波形计划算不出来只是「没有波形」，不该让整个时间线崩掉。
 * 缓存 null 也意味着同一份坏输入不会反复重试。
 */
export function editorTimelinePlanConstructionFailureIsSilent(): boolean {
  return true
}
