/**
 * 有界 LRU 备忘缓存。
 *
 * Swift source: Sources/RecorderCore/BoundedMemoizationCache.swift @ laogou717/dogsc 567fd6e
 *
 * 用途：昂贵的确定性渲染路径，其参数键会随检查器滑杆连续变化。
 * 保留所有历史参数值会让长录制上的一次手势变成无界的预计算样本数组。
 *
 * JS 单线程：NSCondition 的跨线程等待/广播不再需要；「同键并发构建」
 * 的语义退化为同步路径（build 期间不可能有第二个调用者插入），
 * API 形状与 Swift 保持一致以便逐行对照。
 */

export class BoundedMemoizationCache<Key, Value> {
  private readonly capacity: number
  private readonly values = new Map<Key, Value>()

  constructor(capacity: number) {
    this.capacity = Math.max(capacity, 1)
  }

  /** 命中返回缓存值并刷新新旧序；未命中则构建并入库（可能驱逐最旧项）。 */
  value(key: Key, build: () => Value): Value {
    const existing = this.values.get(key)
    if (existing !== undefined) {
      this.markRecentlyUsed(key)
      return existing
    }
    const created = build()
    this.values.set(key, created)
    this.markRecentlyUsed(key)
    this.evictOverflow()
    return created
  }

  /**
   * 仅当构建**完整完成**才入库。给可取消的后台预热用：
   * 被取消的部分结果绝不能占住缓存，然后在播放线程冒充完整渲染路径。
   */
  valueIfBuilt(key: Key, build: () => Value | null | undefined): Value | null {
    const existing = this.values.get(key)
    if (existing !== undefined) {
      this.markRecentlyUsed(key)
      return existing
    }
    const created = build()
    if (created === null || created === undefined) return null
    this.values.set(key, created)
    this.markRecentlyUsed(key)
    this.evictOverflow()
    return created
  }

  get count(): number {
    return this.values.size
  }

  private markRecentlyUsed(key: Key): void {
    const existing = this.values.get(key)
    if (existing !== undefined) {
      this.values.delete(key)
      this.values.set(key, existing)
    }
  }

  private evictOverflow(): void {
    while (this.values.size > this.capacity) {
      const oldest = this.values.keys().next().value
      if (oldest === undefined) break
      this.values.delete(oldest)
    }
  }
}
