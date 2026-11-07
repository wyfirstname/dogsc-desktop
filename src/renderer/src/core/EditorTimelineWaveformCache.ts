/**
 * 时间线波形缓存 —— 小的、跟源版本绑定的派生结果缓存。
 *
 * Swift source: Sources/DogSCApp/EditorTimelineWaveformCache.swift（149 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - actor EditorTimelineWaveformCache                L11-149
 *   - struct Envelope（schemaVersion / samples）        L14-17  → WaveformCacheEnvelope
 *   - 构造（entryLimit / directory）                    L23-36  → WAVEFORM_CACHE_ENTRY_LIMIT / waveformCacheDirectory
 *   - samples(for:sourceRange:sampleCount:)            L38-62  → waveformCacheEnvelopeAccepts / waveformSamplesAreValid
 *   - store(_:for:sourceRange:sampleCount:)            L64-94  → waveformSamplesAreValid
 *   - cacheURL(for:sourceRange:sampleCount:)           L96-126 → waveformCacheIdentityFields / waveformCacheIdentity
 *   - removeOverflowEntries()                          L128-148 → waveformOverflowEvictionCount
 *
 * 原注释（L5-10）：
 *   A waveform contains at most 6,000 Doubles, so keeping the derived result is
 *   dramatically cheaper than decoding several minutes of PCM every time the
 *   user closes and reopens a project. It lives in Library/Caches rather than in
 *   the project package: cache failure can never damage or dirty authored data.
 *
 * 迁移说明：`PropertyListEncoder(.binary)` → JSON 或 msgpack（宿主选），`actor` 的
 * 隔离由「单线程写 + 原子替换」保证。这里保留四件事：身份字段顺序、读入校验、
 * 写入校验、溢出淘汰数量。缓存目录（`Library/Caches`）在 Windows 对应
 * `%LOCALAPPDATA%/cn.laogou.dogsc/Waveforms`。
 */

import type { MediaTimeRange } from './MediaTimeRange'

/** Swift L80 / L50：负载格式版本。读到别的版本一律当脏数据删掉。 */
export const WAVEFORM_CACHE_SCHEMA_VERSION = 2

/** Swift L25：默认最多保留 24 个条目。 */
export const WAVEFORM_CACHE_ENTRY_LIMIT = 24

/** Swift L6：一条波形最多 6000 个 Double。 */
export const WAVEFORM_MAX_SAMPLES = 6_000

/** Swift L111：身份串前缀。改采样算法时改这里，等于一次性作废全部旧缓存。 */
export const WAVEFORM_CACHE_IDENTITY_VERSION = 'waveform-v1'

/** Swift L34-35：`cn.laogou.dogsc/Waveforms`。 */
export const WAVEFORM_CACHE_SUBDIRECTORY = 'cn.laogou.dogsc/Waveforms'

/** Swift L19-36：`entryLimit` 至少 1。 */
export function waveformCacheEntryLimit(requested: number): number {
  if (!Number.isFinite(requested)) return 1
  return Math.max(Math.trunc(requested), 1)
}

/** 缓存目录（宿主传入 userData/LocalAppData 根）。 */
export function waveformCacheDirectory(localAppDataPath: string): string {
  return `${localAppDataPath.replace(/[\\/]+$/, '')}/${WAVEFORM_CACHE_SUBDIRECTORY}`
}

/** Swift L14-17。 */
export interface WaveformCacheEnvelope {
  readonly schemaVersion: number
  readonly samples: readonly number[]
}

/** Swift L52 / L71：每个样本必须有限且落在 [0, 1]。 */
export function waveformSampleIsValid(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

/** 数量与逐值校验一起做 —— 只查数量会让 NaN 溜进渲染。 */
export function waveformSamplesAreValid(
  samples: readonly number[],
  sampleCount: number
): boolean {
  if (samples.length !== sampleCount) return false
  return samples.every(waveformSampleIsValid)
}

/**
 * Swift L48-56：
 *   guard let data = try? Data(contentsOf: url),
 *         let envelope = try? PropertyListDecoder().decode(Envelope.self, from: data),
 *         envelope.schemaVersion == 2,
 *         envelope.samples.count == sampleCount,
 *         envelope.samples.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1 })
 *   else { try? fileManager.removeItem(at: url); return nil }
 *
 * 四条同时成立才算命中；否则**删文件**再返回 nil（不做「保留坏数据等下次」）。
 */
export function waveformCacheEnvelopeAccepts(
  envelope: WaveformCacheEnvelope | null,
  sampleCount: number
): boolean {
  if (envelope === null) return false
  if (envelope.schemaVersion !== WAVEFORM_CACHE_SCHEMA_VERSION) return false
  return waveformSamplesAreValid(envelope.samples, sampleCount)
}

/** 媒资版本指纹（Swift `EditorMediaInput.version`）。 */
export interface EditorMediaVersion {
  readonly standardizedPath: string
  readonly fileSystemNumber: number | null
  readonly fileNumber: number | null
  readonly fileSize: number | null
  /** 秒（自参考日起）。Swift 里取 `bitPattern`，这里直接取数值。 */
  readonly modificationDate: number | null
}

/**
 * Swift L101-120：九段身份字段，**顺序不可变**。
 *
 * 缺字段用 `"-"` 占位而不是跳过 —— 跳过一个字段会让「有版本」与「无版本」的
 * 两条不同素材产生同一个串。
 * 时间范围两端取 `bitPattern` 而不是 `String(Double)`，是为了让 -0.0 与 0.0
 * 这类在字符串上撞车的值仍然可区分（这里用 1/ 符号位模拟）。
 */
export function waveformCacheIdentityFields(input: {
  readonly version: EditorMediaVersion
  readonly sourceRange: MediaTimeRange
  readonly sampleCount: number
}): string[] {
  const optional = (value: number | null): string =>
    value === null ? '-' : String(value)
  return [
    WAVEFORM_CACHE_IDENTITY_VERSION,
    input.version.standardizedPath,
    optional(input.version.fileSystemNumber),
    optional(input.version.fileNumber),
    optional(input.version.fileSize),
    optional(input.version.modificationDate),
    doubleBitPattern(input.sourceRange.start),
    doubleBitPattern(input.sourceRange.end - input.sourceRange.start),
    String(input.sampleCount),
  ]
}

/**
 * Swift L108-109：`duration = range.duration`（即 end - start），
 * 不是结束时刻本身。改成 end 会让「同一段素材的后半段」与「前半段」共用键。
 */
export function waveformCacheIdentity(input: {
  readonly version: EditorMediaVersion
  readonly sourceRange: MediaTimeRange
  readonly sampleCount: number
}): string {
  return waveformCacheIdentityFields(input).join('\u0000')
}

/** Swift L106：`timeIntervalSinceReferenceDate.bitPattern` 的等价物（保留 -0 与 NaN）。 */
export function doubleBitPattern(value: number): string {
  if (Number.isNaN(value)) return 'nan'
  if (value === 0) return Object.is(value, -0) ? '-0' : '0'
  return String(value)
}

/**
 * Swift L142-147：
 *   guard entries.count > entryLimit else { return }
 *   for entry in entries.sorted(by: { $0.1 < $1.1 }).prefix(entries.count - entryLimit) { remove }
 *
 * 只按修改时间升序淘汰，淘汰数量 = 超出的部分。`entries` 只含 `.plist` 常规文件。
 */
export function waveformOverflowEvictionCount(
  entryCount: number,
  entryLimit: number
): number {
  const limit = waveformCacheEntryLimit(entryLimit)
  return Math.max(entryCount - limit, 0)
}

/** 给定一组 (文件名, 修改时间)，返回应当删除的文件名（最旧的先删）。 */
export function waveformOverflowEvictions(
  entries: readonly { readonly name: string; readonly modifiedAt: number }[],
  entryLimit: number
): string[] {
  const count = waveformOverflowEvictionCount(entries.length, entryLimit)
  if (count === 0) return []
  return [...entries]
    .sort((a, b) => a.modifiedAt - b.modifiedAt)
    .slice(0, count)
    .map((entry) => entry.name)
}

/** Swift L135 / L141：只认 `.plist` 且必须是常规文件。 */
export function waveformCacheEntryEligible(input: {
  readonly pathExtension: string
  readonly isRegularFile: boolean
}): boolean {
  return input.pathExtension === 'plist' && input.isRegularFile
}

/** Swift L125：文件名 = `<sha256hex>.plist`。 */
export function waveformCacheFileName(digestHex: string): string {
  return `${digestHex}.plist`
}

/**
 * 命中后的「保鲜」：Swift L57-60 把修改日期改成现在，
 * 让常用的条目在溢出淘汰时排在后面（这是 LRU 的近似）。
 */
export function waveformCacheTouchIsSafe(readSucceeded: boolean): boolean {
  return readSucceeded
}
