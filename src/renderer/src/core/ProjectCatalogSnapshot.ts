/**
 * 工程目录快照 —— Swift ProjectCatalogSnapshot.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/ProjectCatalogSnapshot.swift（19 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - struct ProjectCatalogSnapshot   L6-8   → ProjectCatalogSnapshot
 *   - static func load()              L10-18 → loadProjectCatalogSnapshot
 *
 * 原注释（L3-5）：
 *   Immutable filesystem snapshot for recorder/Dock/status-menu presentation.
 *   Directory enumeration and recovery-manifest reads can touch slow external
 *   volumes, so callers load this away from MainActor and publish it atomically.
 */

/** Swift L11：候选上限 50。 */
export const PROJECT_CATALOG_RECENT_QUERY_LIMIT = 50
/** Swift L13：展示上限 8（`prefix(8)`）。 */
export const PROJECT_CATALOG_PRESENTED_RECENT_LIMIT = 8

export interface ProjectCatalogSnapshot {
  readonly recent: readonly string[]
  readonly recoverable: readonly string[]
}

export interface ProjectCatalogResolver {
  /** Swift `ProjectStore.recentProjectURLs(limit:)` */
  recentProjectPaths(limit: number): readonly string[]
  /** Swift `ProjectStore.recoverableProjectURLs(recentCandidates:)` */
  recoverableProjectPaths(recentCandidates: readonly string[]): readonly string[]
}

/**
 * Swift L10-18。
 *
 * 注意两个不同的集合：`recent` 只展示前 8 条，但 `recoverable` 是拿**完整 50 条**
 * 候选去筛的 —— 第 9~50 条里的可恢复工程仍要出现在「恢复」列表里。
 */
export function loadProjectCatalogSnapshot(resolver: ProjectCatalogResolver): ProjectCatalogSnapshot {
  const recentCandidates = resolver.recentProjectPaths(PROJECT_CATALOG_RECENT_QUERY_LIMIT)
  return {
    recent: recentCandidates.slice(0, PROJECT_CATALOG_PRESENTED_RECENT_LIMIT),
    recoverable: resolver.recoverableProjectPaths(recentCandidates)
  }
}

export function projectCatalogSnapshotEquals(
  a: ProjectCatalogSnapshot,
  b: ProjectCatalogSnapshot
): boolean {
  const sameList = (x: readonly string[], y: readonly string[]): boolean =>
    x.length === y.length && x.every((value, index) => value === y[index])
  return sameList(a.recent, b.recent) && sameList(a.recoverable, b.recoverable)
}
