/**
 * 工程文档 —— Swift ProjectDocument.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/ProjectDocument.swift（24 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - class ProjectDocument   L8-24  → ProjectDocument 类 / replaceProjectSnapshot
 *
 * 原注释（L4-7）：
 *   The single mutable owner of the project currently open in the application.
 *   ProjectWorkspace owns the document lifetime. EditorStore owns editor commands
 *   and transient gestures, but it never keeps a second persisted project snapshot.
 *
 * 即：**整个应用只有一个可变的工程所有者**，编辑器不持有第二份持久化快照。
 */

import type { RecorderProject } from './ProjectMediaModel'

/**
 * Swift L8-24。
 *
 * `@Published private(set)` → TS 侧 `project` 只读 getter，唯一写入口是 `replace`。
 */
export class ProjectDocument {
  private _project: RecorderProject
  private readonly onChange: ((project: RecorderProject) => void) | null

  constructor(project: RecorderProject, onChange?: (project: RecorderProject) => void) {
    this._project = project
    this.onChange = onChange ?? null
  }

  get project(): RecorderProject {
    return this._project
  }

  /**
   * Swift L18-23：发布一份不可变快照；返回 `false` 让调用方区分「真提交」与
   * 「空操作」，不必再算一次 diff。
   */
  replace(replacement: RecorderProject): boolean {
    if (projectsEqual(replacement, this._project)) return false
    this._project = replacement
    this.onChange?.(replacement)
    return true
  }
}

/** 纯函数版（便于断言）。 */
export function replaceProjectSnapshot(
  current: RecorderProject,
  replacement: RecorderProject
): { project: RecorderProject; didCommit: boolean } {
  if (projectsEqual(replacement, current)) return { project: current, didCommit: false }
  return { project: replacement, didCommit: true }
}

/**
 * Swift `RecorderProject: Equatable` 的等价物。
 *
 * 工程是纯数据（无循环引用、无 undefined 语义歧义），用稳定序列化做深比较与
 * 合成 Equatable 等价；键序来自解码器，每次构造走同一条路径。
 */
export function projectsEqual(a: RecorderProject, b: RecorderProject): boolean {
  if (a === b) return true
  return stableStringify(a) === stableStringify(b)
}

/** 键排序后的 JSON，避免字段插入顺序差异造成假不等。 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value != null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) out[key] = sortDeep(source[key])
    return out
  }
  return value
}
