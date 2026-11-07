/**
 * 时间线胶片条 —— 只在缓冲视口内采样的等高源画面。
 *
 * Swift source: Sources/DogSCApp/EditorTimelineFilmstrip.swift（298 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorTimelineFilmstrip                           L6-298
 *     · revealDuration 0.18 / logger category                 L20-21 → FILMSTRIP_REVEAL_*
 *     · FrameReveal / Sample / Tile / Request / SourceIdentity L23-54 → FILMSTRIP_* 接口
 *     · body（TimelineView 1/30、Canvas、裁剪与绘制）           L61-116 → filmstripTileRect
 *     · visibleTiles（瓦片网格 + 时间网格 + 容差桶）            L118-151 → filmstripVisibleTiles
 *     · makeRequest（优先区在前、时间去重）                     L153-167 → filmstripOrderedSamples
 *     · load（两道延迟 + 三次重试 + 小批发布）                  L169-223 → filmstripPublishDecision
 *     · requestIsCurrent                                       L225-228 → filmstripRequestIsCurrent
 *     · availableFrames / compatibleFrames                     L230-242 → filmstripCompatibleTimes
 *     · nearestFrame                                           L244-250 → filmstripNearestTime
 *     · draw                                                   L252-262 → filmstripTileRect
 *     · publish（保留量 32~160、rank 0/1/2、交叉淡入）          L264-297 → filmstripRetentionOrder
 *
 * 原注释（L4-5）：
 *   Height-sized source pictures, sampled only inside the buffered viewport.
 *   Clip duration changes the number of pictures, never their aspect ratio.
 *
 * 原注释（L127-128）：
 *   Full tiles follow the source aspect. Short clips/tails crop the same
 *   full-height picture horizontally instead of shrinking its height.
 *
 * 原注释（L137-138）：
 *   A small, stable source-time grid improves reuse during zoom/trim.
 *   Bounds and tolerance keep a thumbnail inside its retained source clip.
 *
 * 原注释（L181-183）：
 *   Cancel fast sweeps, but reveal the first useful picture promptly.
 *   Buffered-only clips wait longer so they don't queue ahead of the
 *   pictures actually on screen when many short clips become visible.
 *
 * 迁移说明：`Canvas` 绘制改由 React 侧的 canvas 承担；这里保留瓦片网格、
 * 时间网格吸附、容差桶、采样去重、最近帧查找与缓存保留排序这六件纯逻辑。
 * 全部时间值都用 Int64 的「1/600 秒」刻度，避免浮点相等比较。
 */

// ---------------------------------------------------------------- 常量

/**
 * Swift L20：新帧淡入时长 0.18 秒。
 *
 * 比缩略图解码本身（几十毫秒）长得多，是刻意的：解码是离散事件，
 * 直接替换会「闪」，0.18 秒足够让眼睛读成「化过去」。
 */
export const FILMSTRIP_REVEAL_DURATION = 0.18

/** Swift L72：动画 tick 最早 1/30 秒一次（降低动态效果时不 tick）。 */
export const FILMSTRIP_TICK_INTERVAL = 1 / 30

/** Swift L105：淡入结束后清理 reveal 记录的延时 180 毫秒。 */
export const FILMSTRIP_CLEANUP_DELAY_MS = 180

/**
 * Swift L129：瓦片最小宽度 40。
 *
 * 极窄的片段（1 秒的片段放在 10 分钟时间线上只有几个像素宽）如果按真实比例算，
 * 瓦片宽度会小于 1，`floor(x / tileWidth)` 会得到巨大的索引范围。
 */
export const FILMSTRIP_MINIMUM_TILE_WIDTH = 40

/** Swift L126：源尺寸无效时退回 16:9。 */
export const FILMSTRIP_DEFAULT_ASPECT = 16 / 9

/** Swift L139-142：所有时间值都以 1/600 秒为刻度存成整数。 */
export const FILMSTRIP_TIME_SCALE = 600

/**
 * Swift L141：`(rawTime * 15).rounded() * 40`。
 *
 * 15 × 40 = 600，所以这个式子做的是「先吸到 1/15 秒的格点，再换算成 1/600 秒」。
 * 用 1/15 秒而不是 1/30 秒：1/30 秒的格点在 4K 素材上会让相邻瓦片频繁取到同一帧
 * （瓦片中心间隔通常小于 1/30 秒），白解码一遍。
 */
export const FILMSTRIP_GRID_STEPS_PER_SECOND = 15
export const FILMSTRIP_GRID_MULTIPLIER = 40

/** Swift L143：容差上限 0.12 秒。 */
export const FILMSTRIP_MAXIMUM_TOLERANCE = 0.12

/**
 * Swift L147：`floor(tolerance * 50) * 12`。
 *
 * 50 × 12 = 600，即「把容差吸到 20 毫秒的桶里，再换算成 1/600 秒」。
 * 用 `floor` 而不是 `round`：向上取整会让容差越过片段右边界，取到一个不属于
 * 这个片段的帧。
 */
export const FILMSTRIP_TOLERANCE_BUCKETS_PER_SECOND = 50
export const FILMSTRIP_TOLERANCE_BUCKET_SCALE = 12

/**
 * Swift L185：优先区非空时延迟 45 毫秒，全在缓冲区外时 180 毫秒。
 *
 * 45 毫秒是「一次快速横扫（拖时间线）里大概率还会变」的判定窗口；
 * 全缓冲区的片段等 180 毫秒，避免很多短片段同时可见时它们的请求排在
 * 真正在屏幕上的那些之前。
 */
export const FILMSTRIP_PRIORITY_DELAY_MS = 45
export const FILMSTRIP_BUFFERED_DELAY_MS = 180

/** Swift L189：最多重试三次。 */
export const FILMSTRIP_RETRY_ATTEMPTS = 3

/** Swift L217：第 1 次失败后等 300 毫秒，第 2 次后等 1200 毫秒（有界退避）。 */
export const FILMSTRIP_RETRY_DELAYS_MS = [300, 1200] as const

/** Swift L205：第一帧立即发布，之后每攒够 3 帧发布一次。 */
export const FILMSTRIP_PUBLISH_BATCH = 3

/** Swift L270：缓存保留量 `min(max(count * 2, 32), 160)`。 */
export const FILMSTRIP_CACHE_LIMIT_MULTIPLIER = 2
export const FILMSTRIP_CACHE_LIMIT_MINIMUM = 32
export const FILMSTRIP_CACHE_LIMIT_MAXIMUM = 160

/** Swift L21：日志分类。 */
export const FILMSTRIP_LOGGER_CATEGORY = 'timeline-filmstrip'

// ---------------------------------------------------------------- 接口

/** Swift L28-31：一个采样时刻 —— 时间值与容差都存成 1/600 秒的整数。 */
export interface FilmstripSample {
  readonly timeValue: number
  readonly toleranceValue: number
}

/** Swift L33-38：一块瓦片。 */
export interface FilmstripTile {
  readonly index: number
  readonly origin: number
  readonly width: number
  readonly sample: FilmstripSample
}

/** Swift L51-54：源身份 —— 输入源 + 主源时间偏移。 */
export interface FilmstripSourceIdentity {
  readonly inputID: string
  readonly timeOffset: number
}

// ---------------------------------------------------------------- 网格

/**
 * Swift L124-126：源宽高比。
 *
 * 只有宽高都有限且为正时才用源的比例，否则退回 16:9。这一道判定挡的是
 * 「预览还没准备好」（0×0）的那一帧 —— 除以 0 会得到 Infinity，
 * 瓦片宽度变成 Infinity，索引计算直接变成 NaN。
 */
export function filmstripSourceAspect(width: number, height: number): number {
  const usable = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
  return usable ? width / height : FILMSTRIP_DEFAULT_ASPECT
}

/**
 * Swift L129：瓦片宽度 = 瓦片高度 × 源宽高比，且不小于 40。
 *
 * 注释（L127-128）解释了为什么「短片段只裁横向不缩高度」：让所有瓦片等高，
 * 胶片条才是一条连续的带子；若按宽度反推高度，1 秒片段会变成一个小方块，
 * 整条时间线的视觉节奏就断了。
 */
export function filmstripTileWidth(tileHeight: number, aspect: number): number {
  const safeHeight = Number.isFinite(tileHeight) ? tileHeight : 0
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : FILMSTRIP_DEFAULT_ASPECT
  return Math.max(safeHeight * safeAspect, FILMSTRIP_MINIMUM_TILE_WIDTH)
}

/**
 * Swift L130-132：可见瓦片的索引区间 `[first, end)`。
 *
 * `first` 用 `floor` 且夹到 0（视口左界为负时不能取负索引），
 * `end` 用 `ceil` 且夹到画布宽（右界超出时不生成画布外的瓦片）。
 */
export function filmstripVisibleIndexRange(input: {
  readonly tileWidth: number
  readonly visibleLower: number
  readonly visibleUpper: number
  readonly canvasWidth: number
}): { readonly first: number; readonly end: number } {
  if (!Number.isFinite(input.tileWidth) || input.tileWidth <= 0) return { first: 0, end: 0 }
  const first = Math.max(Math.floor(Math.max(input.visibleLower, 0) / input.tileWidth), 0)
  const end = Math.ceil(Math.min(input.visibleUpper, input.canvasWidth) / input.tileWidth)
  return { first, end: Number.isFinite(end) ? end : first }
}

/**
 * Swift L118-151：可见瓦片列表。
 *
 * 五道前置判定合在一个 guard 里（L119-122），任何一条不成立就返回空数组 ——
 * 布局还没定（宽或高为 0）、源时长无效（0 或非有限）、视口完全在画布左侧，
 * 这四种情况下去算索引都会得到无意义的大范围。
 */
export function filmstripVisibleTiles(input: {
  readonly sizeWidth: number
  readonly sizeHeight: number
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly sourceStart: number
  readonly sourceDuration: number
  readonly visibleLower: number
  readonly visibleUpper: number
}): FilmstripTile[] {
  const { sizeWidth, sizeHeight, sourceStart, sourceDuration } = input
  const usable =
    Number.isFinite(sizeWidth) &&
    sizeWidth > 0 &&
    Number.isFinite(sizeHeight) &&
    sizeHeight > 0 &&
    Number.isFinite(sourceStart) &&
    Number.isFinite(sourceDuration) &&
    sourceDuration > 0 &&
    input.visibleUpper > 0 &&
    input.visibleLower < sizeWidth
  if (!usable) return []

  const aspect = filmstripSourceAspect(input.sourceWidth, input.sourceHeight)
  const tileWidth = filmstripTileWidth(sizeHeight, aspect)
  const { first, end } = filmstripVisibleIndexRange({
    tileWidth,
    visibleLower: input.visibleLower,
    visibleUpper: input.visibleUpper,
    canvasWidth: sizeWidth,
  })
  if (end <= first) return []

  const firstTimeValue = Math.ceil(sourceStart * FILMSTRIP_TIME_SCALE)
  const lastTimeValue = Math.max(
    firstTimeValue,
    Math.floor((sourceStart + sourceDuration) * FILMSTRIP_TIME_SCALE) - 1
  )

  const tiles: FilmstripTile[] = []
  for (let index = first; index < end; index += 1) {
    const origin = index * tileWidth
    const width = Math.min(tileWidth, sizeWidth - origin)
    const rawTime = sourceStart + sourceDuration * ((origin + width / 2) / sizeWidth)
    const timeValue = Math.min(
      Math.max(filmstripRoundHalfAwayFromZero(rawTime * FILMSTRIP_GRID_STEPS_PER_SECOND) * FILMSTRIP_GRID_MULTIPLIER, firstTimeValue),
      lastTimeValue
    )
    const time = timeValue / FILMSTRIP_TIME_SCALE
    tiles.push({
      index,
      origin,
      width,
      sample: {
        timeValue,
        toleranceValue: filmstripToleranceValue({
          width,
          canvasWidth: sizeWidth,
          sourceStart,
          sourceDuration,
          time,
        }),
      },
    })
  }
  return tiles
}

/**
 * Swift 的 `rounded()` 是 toNearestOrAwayFromZero，不是银行家舍入。
 *
 * `Math.round(-0.5)` 是 `-0`，Swift 的 `(-0.5).rounded()` 是 `-1`。
 * 这里的入参（时间 × 15）恒为正，但函数仍按 Swift 语义实现，
 * 以免将来被复用到负值上时静默偏差一格。
 */
export function filmstripRoundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/**
 * Swift L143-147：瓦片容差。
 *
 * 先取三者的最小值：0.12 秒上限、瓦片占源时长的四分之一、以及到片段左右边界的距离；
 * 再把负值夹到 0（中心点落在片段外时「到左边界的距离」会是负的）。
 *
 * 「瓦片占时长的四分之一」这一项决定了容差随缩放变化：放大时瓦片覆盖的时间变短，
 * 容差也跟着变短，缩略图才不会取到远处的一帧。
 */
export function filmstripToleranceValue(input: {
  readonly width: number
  readonly canvasWidth: number
  readonly sourceStart: number
  readonly sourceDuration: number
  readonly time: number
}): number {
  if (!Number.isFinite(input.canvasWidth) || input.canvasWidth <= 0) return 0
  const share = input.width / input.canvasWidth
  const tolerance = Math.max(
    Math.min(
      FILMSTRIP_MAXIMUM_TOLERANCE,
      input.sourceDuration * share / 4,
      input.time - input.sourceStart,
      input.sourceStart + input.sourceDuration - input.time
    ),
    0
  )
  return Math.floor(tolerance * FILMSTRIP_TOLERANCE_BUCKETS_PER_SECOND) * FILMSTRIP_TOLERANCE_BUCKET_SCALE
}

// ---------------------------------------------------------------- 请求

/**
 * Swift L154-157：落进优先区间的瓦片。
 *
 * 用「瓦片右界 > 优先区左界 且 瓦片左界 < 优先区右界」而不是区间包含判断 ——
 * 部分重叠也要算优先，否则半露在视口边缘的瓦片会被排到后面，用户会先看到
 * 空白再看到画面。
 */
export function filmstripPriorityTiles(
  tiles: readonly FilmstripTile[],
  priorityLower: number,
  priorityUpper: number
): FilmstripTile[] {
  return tiles.filter(
    (tile) => tile.origin + tile.width > priorityLower && tile.origin < priorityUpper
  )
}

/**
 * Swift L158-162：优先瓦片排在前，再按时间值去重。
 *
 * 去重要按**时间值**而不是索引：一次缩放之后相邻瓦片很可能落到同一个格点上，
 * 重复请求同一帧会让解码器排队做无用功。
 */
export function filmstripOrderedSamples(
  tiles: readonly FilmstripTile[],
  priorityIndices: ReadonlySet<number>
): FilmstripSample[] {
  const priority: FilmstripTile[] = []
  const rest: FilmstripTile[] = []
  for (const tile of tiles) {
    if (priorityIndices.has(tile.index)) priority.push(tile)
    else rest.push(tile)
  }
  const seen = new Set<number>()
  const samples: FilmstripSample[] = []
  for (const tile of [...priority, ...rest]) {
    if (seen.has(tile.sample.timeValue)) continue
    seen.add(tile.sample.timeValue)
    samples.push(tile.sample)
  }
  return samples
}

/**
 * Swift L225-228：请求是否仍然有效。
 *
 * 三个条件缺一不可：任务没被取消、代数没变（换了一段工程）、源身份没变
 * （同一个工程里换了主源的时间偏移也要重来）。
 */
export function filmstripRequestIsCurrent(input: {
  readonly cancelled: boolean
  readonly requestGeneration: number | null
  readonly currentGeneration: number | null
  readonly requestSource: FilmstripSourceIdentity | null
  readonly currentSource: FilmstripSourceIdentity | null
}): boolean {
  if (input.cancelled) return false
  if (input.requestGeneration !== input.currentGeneration) return false
  return filmstripSourceIdentityEquals(input.requestSource, input.currentSource)
}

/** Swift L51-54：源身份相等（输入 + 时间偏移）。 */
export function filmstripSourceIdentityEquals(
  a: FilmstripSourceIdentity | null,
  b: FilmstripSourceIdentity | null
): boolean {
  if (a === null || b === null) return a === b
  return a.inputID === b.inputID && a.timeOffset === b.timeOffset
}

/**
 * Swift L170-172：两个请求前置条件。
 *
 * `isEnabled` 是片段可见性、`isEditorActive` 是编辑器窗口是否在前台 ——
 * 后台窗口的时间线不解码缩略图，这一条能省掉大量 CPU。
 */
export function filmstripShouldLoad(input: {
  readonly isEnabled: boolean
  readonly isEditorActive: boolean
  readonly hasSource: boolean
  readonly sampleCount: number
}): boolean {
  return input.isEnabled && input.isEditorActive && input.hasSource && input.sampleCount > 0
}

/**
 * Swift L185：第一道延迟。
 *
 * 优先区为空意味着这次请求完全不覆盖用户正看着的区域（只是缓冲区里的邻居），
 * 所以等 180 毫秒让别人先跑。
 */
export function filmstripInitialDelayMs(priorityTimesEmpty: boolean): number {
  return priorityTimesEmpty ? FILMSTRIP_BUFFERED_DELAY_MS : FILMSTRIP_PRIORITY_DELAY_MS
}

/** Swift L217：第 `attempt` 次失败后的退避。越界返回 null 表示不再重试。 */
export function filmstripRetryDelayMs(attempt: number): number | null {
  if (!Number.isFinite(attempt) || attempt < 0) return null
  const index = Math.trunc(attempt)
  if (index >= FILMSTRIP_RETRY_DELAYS_MS.length) return null
  return FILMSTRIP_RETRY_DELAYS_MS[index]
}

/** Swift L216：`attempt < 2` 时才退避（第三次失败后直接放弃）。 */
export function filmstripShouldRetry(attempt: number): boolean {
  return attempt < FILMSTRIP_RETRY_ATTEMPTS - 1
}

/**
 * Swift L204-209：新解出一帧之后要不要立刻发布。
 *
 * 第一帧立即发（用户马上能看到东西），之后攒 3 帧发一批 ——
 * 每解一帧就发布会让 SwiftUI 每帧都重画一次整个 Canvas。
 */
export function filmstripShouldPublishAfterDecode(input: {
  readonly hasPublishedNewFrame: boolean
  readonly unpublishedCount: number
}): boolean {
  return !input.hasPublishedNewFrame || input.unpublishedCount >= FILMSTRIP_PUBLISH_BATCH
}

// ---------------------------------------------------------------- 淡入

/**
 * Swift L80-81：淡入进度 `(now - startedAt) / 0.18`，夹到 [0, 1]。
 */
export function filmstripRevealProgress(startedAtMs: number, nowMs: number): number {
  const elapsed = (nowMs - startedAtMs) / 1000
  return Math.min(Math.max(elapsed / FILMSTRIP_REVEAL_DURATION, 0), 1)
}

/**
 * Swift L89：新帧的不透明度 `1 - (1 - p)^3`。
 *
 * 三次缓出：前 20% 的时间里就到 0.49，所以旧帧被盖住得很快，
 * 中间不会出现「两帧都半透明」的糊锅状态。
 */
export function filmstripRevealOpacity(progress: number): number {
  const safe = Math.min(Math.max(Number.isFinite(progress) ? progress : 0, 0), 1)
  return 1 - Math.pow(1 - safe, 3)
}

/**
 * Swift L79-89：这一帧该不该走交叉淡入。
 *
 * 三个条件：此刻的缓存里确实有这个时刻的帧（而不是「最近帧」回退出来的）、
 * 有它的 reveal 记录、且还在 0.18 秒窗口内。
 *
 * 第二条最关键：如果只有最近帧而没有精确帧，说明这是缩放的中间态，
 * 做淡入会让画面看起来在「抖」。
 */
export function filmstripUsesCrossfade(input: {
  readonly exactFrameExists: boolean
  readonly hasReveal: boolean
  readonly elapsedSeconds: number
}): boolean {
  return input.exactFrameExists && input.hasReveal && input.elapsedSeconds < FILMSTRIP_REVEAL_DURATION
}

/**
 * Swift L107-109：清理过期 reveal 时保留哪些。
 *
 * 180 毫秒后统一扫一遍，把超过 0.18 秒的清掉。用延时清理而不是每帧比较，
 * 是因为 reveal 记录只增不减会一直占内存（一小时的时间线滚动下来有上千条）。
 */
export function filmstripPrunesReveal(input: {
  readonly startedAtMs: number
  readonly nowMs: number
}): boolean {
  return (input.nowMs - input.startedAtMs) / 1000 >= FILMSTRIP_REVEAL_DURATION
}

// ---------------------------------------------------------------- 最近帧

/**
 * Swift L244-250：精确命中优先，否则找时间上最近的。
 *
 * 距离相同时取**更早**的那一帧（`$0.key < $1.key`）。取更晚的会让画面
 * 略微「超前」，在快速运动的素材上和音频对不上，观众能看出来。
 */
export function filmstripNearestTime(time: number, times: readonly number[]): number | null {
  if (times.length === 0) return null
  let best: number | null = null
  let bestDistance = Infinity
  for (const candidate of times) {
    if (candidate === time) return candidate
    const distance = Math.abs(candidate - time)
    if (distance < bestDistance || (distance === bestDistance && best !== null && candidate < best)) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/**
 * Swift L230-234：可用帧 = 本地已解出的（限定在源片段内）+ 会话缓存。
 *
 * `merging` 时保留**本地**的值（`{ existing, _ in existing }`）：本地的可能是
 * 刚解出的新帧，会话缓存里的是上一轮的旧帧。
 */
export function filmstripMergeFrames<T>(
  local: ReadonlyMap<number, T>,
  shared: ReadonlyMap<number, T>
): Map<number, T> {
  const merged = new Map<number, T>(shared)
  for (const [key, value] of local) merged.set(key, value)
  return merged
}

/**
 * Swift L236-242：本地帧里落在源片段区间内的那些。
 *
 * 上界用 `time < sourceStart + sourceDuration`（严格小于）而不是 `<=`：
 * 片段末尾那一刻的帧属于下一段，包含进来会在片段交界处看到重复的一帧。
 */
export function filmstripCompatibleTimes(input: {
  readonly times: readonly number[]
  readonly sourceStart: number
  readonly sourceDuration: number
}): number[] {
  const end = input.sourceStart + input.sourceDuration
  const result: number[] = []
  for (const timeValue of input.times) {
    const time = timeValue / FILMSTRIP_TIME_SCALE
    if (time >= input.sourceStart && time < end) result.push(timeValue)
  }
  return result
}

// ---------------------------------------------------------------- 缓存保留

/**
 * Swift L270：保留上限 `min(max(count * 2, 32), 160)`。
 *
 * 下限 32 是因为视口通常有 10~20 块瓦片，留两倍余量保证小范围滚动不重解；
 * 上限 160 是内存阀门 —— 一张 4K 缩略图约 33 MB，160 帧已经接近 5 GB，
 * 所以真实实现里还有额外的字节数限制（见会话缓存）。
 */
export function filmstripCacheLimit(requestedCount: number): number {
  const count = Number.isFinite(requestedCount) ? Math.max(requestedCount, 0) : 0
  return Math.min(Math.max(count * FILMSTRIP_CACHE_LIMIT_MULTIPLIER, FILMSTRIP_CACHE_LIMIT_MINIMUM), FILMSTRIP_CACHE_LIMIT_MAXIMUM)
}

/**
 * Swift L271-273：保留优先级 —— 优先区 0、本次请求 1、其他 2。
 *
 * 「其他」不直接丢掉，而是排在最后：滚动一点点回来时它们还是热的。
 */
export function filmstripRetentionRank(input: {
  readonly timeValue: number
  readonly priorityTimes: ReadonlySet<number>
  readonly requestedTimes: ReadonlySet<number>
}): number {
  if (input.priorityTimes.has(input.timeValue)) return 0
  if (input.requestedTimes.has(input.timeValue)) return 1
  return 2
}

/**
 * Swift L274-278：保留顺序 —— 先按 rank，再按离视口中心的时间距离，最后按时间值。
 *
 * 中心值用请求样本的时间**平均值**（L266-267），不是中位数：
 * 平均值对「两端各有一半」的视口能给出真正的中点。
 */
export function filmstripRetentionOrder(input: {
  readonly times: readonly number[]
  readonly priorityTimes: ReadonlySet<number>
  readonly requestedTimes: ReadonlySet<number>
  readonly centerTimeValue: number
}): number[] {
  const ranked = input.times.map((timeValue) => ({
    timeValue,
    rank: filmstripRetentionRank({
      timeValue,
      priorityTimes: input.priorityTimes,
      requestedTimes: input.requestedTimes,
    }),
    distance: Math.abs(timeValue - input.centerTimeValue),
  }))
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    if (a.distance !== b.distance) return a.distance - b.distance
    return a.timeValue - b.timeValue
  })
  return ranked.map((entry) => entry.timeValue)
}

/**
 * Swift L266-267：请求样本的中心时刻（时间值的算术平均）。
 *
 * 空样本返回 0 —— 此时没有瓦片要保留，中心值只用于排序，取 0 无害。
 */
export function filmstripCenterTimeValue(samples: readonly FilmstripSample[]): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const sample of samples) sum += sample.timeValue
  return sum / samples.length
}

/**
 * Swift L279-290：哪些时刻需要一条「上一帧」用于淡入。
 *
 * 只给「本轮新出现、且上一轮能就近找到一帧」的时刻建记录。上一轮找不到的
 * 说明它本来就是空白，没有旧图可淡 —— 直接出现就好。
 */
export function filmstripRevealTargets(input: {
  readonly retainedTimes: readonly number[]
  readonly previousTimes: readonly number[]
  readonly reducesMotion: boolean
}): number[] {
  if (input.reducesMotion) return []
  const previous = new Set(input.previousTimes)
  return input.retainedTimes.filter((timeValue) => !previous.has(timeValue))
}

// ---------------------------------------------------------------- 绘制

/**
 * Swift L252-262：把一帧画到瓦片矩形里。
 *
 * 三步：按高度等比缩放（`scale = height / frame.height`）→ 在瓦片内水平居中
 * （`(tile.width - picture.width) / 2`）→ 垂直居中。
 *
 * 注释（L127-128）说的是「短片段横向裁剪」：这里矩形宽度可能大于瓦片宽度，
 * 超出部分由调用方 `clip(to:)` 裁掉，所以画面是「填满高度、两侧出血」，
 * 而不是被压扁。
 */
export function filmstripTileRect(input: {
  readonly tileOrigin: number
  readonly tileWidth: number
  readonly drawingOrigin: number
  readonly frameWidth: number
  readonly frameHeight: number
  readonly height: number
}): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const safeFrameHeight = Number.isFinite(input.frameHeight) && input.frameHeight > 0 ? input.frameHeight : 1
  const scale = input.height / safeFrameHeight
  const pictureWidth = input.frameWidth * scale
  const pictureHeight = safeFrameHeight * scale
  return {
    x: input.tileOrigin - input.drawingOrigin + (input.tileWidth - pictureWidth) / 2,
    y: (input.height - pictureHeight) / 2,
    width: pictureWidth,
    height: pictureHeight,
  }
}

/**
 * Swift L64-65 / L97-98：画布宽度与偏移。
 *
 * 画布宽度取 `max(drawingEnd - drawingOrigin, 1)` —— 至少 1 像素，
 * 否则空瓦片列表会得到一个 0 宽的 Canvas，SwiftUI 在 0 宽视图上不调用 draw。
 * 注释（L96）说明这一条是为了「一小时长的片段放到最大时不要分配整篇位图」。
 */
export function filmstripCanvasMetrics(tiles: readonly FilmstripTile[]): {
  readonly drawingOrigin: number
  readonly drawingEnd: number
  readonly canvasWidth: number
} {
  const drawingOrigin = tiles.length > 0 ? tiles[0].origin : 0
  const drawingEnd = tiles.length > 0 ? tiles[tiles.length - 1].origin + tiles[tiles.length - 1].width : drawingOrigin
  return { drawingOrigin, drawingEnd, canvasWidth: Math.max(drawingEnd - drawingOrigin, 1) }
}

/**
 * Swift L72-73：动画时间轴是否暂停。
 *
 * 三个条件任意一个成立就暂停：没有进行中的淡入、胶片条被禁用、编辑器不在前台。
 * 暂停的 `TimelineView` 不产生 tick，也不重画 Canvas。
 */
export function filmstripTimelinePaused(input: {
  readonly revealCount: number
  readonly isEnabled: boolean
  readonly isEditorActive: boolean
}): boolean {
  return input.revealCount === 0 || !input.isEnabled || !input.isEditorActive
}
