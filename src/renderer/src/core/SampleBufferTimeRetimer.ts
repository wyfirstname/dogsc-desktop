/**
 * Swift source: Sources/DogSCApp/SampleBufferTimeRetimer.swift（96 行）@ 567fd6e
 *
 * L100-113 → 入口：offset 非数值或 ≤ 0 时原样返回；条目数 0 时原样返回
 * L115-132 → 单条目快路径（屏幕帧、整块 PCM/AAC 缓冲）
 * L134-159 → 多条目路径
 * L161-171 → adjust：只减**有效**的时间戳
 * L173-187 → 复制为新时间戳的样本缓冲
 *
 * 原注释：把 Core Media 样本重定基到录制时间线，同时让「绝大多数只有一条时间项」
 * 的路径留在栈上 —— 屏幕帧与普通 PCM/AAC 缓冲即使含很多样本也只暴露一条时间项，
 * 每次回调都分配一个数组完全没必要。
 */

/** 一条时间项。null 表示 `.invalid`（不参与重定基）。 */
export interface SampleTimingEntry {
  readonly duration: number | null
  readonly presentationTime: number | null
  readonly decodeTime: number | null
}

export type RetimeOutcome =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'retimed'; readonly entries: readonly SampleTimingEntry[] }
  | { readonly kind: 'failed' }

/**
 * 重定基决策（Swift L105-113）。
 *
 * `offset` 非数值或 ≤ 0 **直接原样返回**：这是最常见的情况（从 0 开始的录制），
 * 走快路径省掉一次数组拷贝与一次样本缓冲复制。
 */
export function retimeSampleTimings(
  entries: readonly SampleTimingEntry[],
  offset: number
): RetimeOutcome {
  if (!Number.isFinite(offset) || offset <= 0) return { kind: 'unchanged' }
  if (entries.length === 0) return { kind: 'unchanged' }
  return { kind: 'retimed', entries: entries.map((entry) => adjustTiming(entry, offset)) }
}

/**
 * 只减有效时间戳（Swift L161-171）。
 * `.invalid` 保持 `.invalid` —— 给它一个数字会让 Core Media 认为时间戳可用，
 * 后续 `-offset` 就会算出垃圾值。
 */
export function adjustTiming(entry: SampleTimingEntry, offset: number): SampleTimingEntry {
  return {
    duration: entry.duration,
    presentationTime:
      entry.presentationTime === null ? null : entry.presentationTime - offset,
    decodeTime: entry.decodeTime === null ? null : entry.decodeTime - offset,
  }
}

/** 单条目 vs 多条目路径的选择（Swift L115）。 */
export function retimePath(entryCount: number): 'single' | 'multiple' | 'skip' {
  if (entryCount <= 0) return 'skip'
  return entryCount === 1 ? 'single' : 'multiple'
}
