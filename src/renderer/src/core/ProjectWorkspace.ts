/**
 * Swift source: Sources/DogSCApp/ProjectWorkspace.swift（111 行）@ 567fd6e
 *
 * L8-15   → RecordingSessionWorkspacePort（录制期间只需这五个成员）
 * L20-54  → ProjectWorkspace：唯一工程文档 + 持久化世代生命周期
 * L77-110 → activate / flush / move / moveAndInvalidate / flushAndInvalidate / invalidate
 *
 * 原注释：录制编排只消费**不可变快照**，从不拥有或复制工作区文档；UI 策略、
 * 应用阶段、媒体呈现与录制控制刻意留在 AppModel。
 *
 * Windows 侧用一个窄接口表达持久化控制器，工作区本身只做转发 + 变更订阅，
 * 这样「文档是唯一可变所有者」这条不会被任何调用方绕开。
 */

import type { ProjectDocument } from './ProjectDocument'

export interface RecordingSessionLike {
  readonly id: string
}

export interface ProjectSaveReceipt {
  readonly savedAt: number
}

export interface ProjectMoveReceipt {
  readonly destination: string
}

/** 录制期间的窄接口（Swift `RecordingSessionWorkspacePort`）。 */
export interface RecordingSessionWorkspacePort {
  readonly session: RecordingSessionLike | null
  activate(session: RecordingSessionLike, isSaved: boolean): void
  flush(project: unknown): Promise<ProjectSaveReceipt | null>
  invalidateCurrentSession(): Promise<RecordingSessionLike | null>
}

/**
 * 持久化控制器接口（Swift `ProjectSessionPersistenceController` 的最小面）。
 * `scheduleAutosave` 只在文档真的换了内容后被调用 —— 由工作区订阅负责触发。
 */
export interface ProjectSessionPersistencePort {
  readonly session: RecordingSessionLike | null
  readonly isSaved: boolean
  readonly status: 'clean' | 'saving' | 'failed'
  onStateChange?: () => void
  onFailure?: (message: string) => void
  scheduleAutosave(project: unknown): void
  activate(session: RecordingSessionLike, isSaved: boolean): void
  flush(project: unknown): Promise<ProjectSaveReceipt | null>
  move(project: unknown, destination: string): Promise<ProjectMoveReceipt | null>
  moveAndInvalidate(project: unknown, destination: string): Promise<ProjectMoveReceipt | null>
  flushAndInvalidate(project: unknown): Promise<RecordingSessionLike | null>
  invalidateCurrentSession(): Promise<RecordingSessionLike | null>
}

/**
 * 工作区：持有唯一文档，把持久化控制器的事件转成自身变更通知。
 *
 * 订阅顺序（Swift L39-53）不可调换：文档变更先转发 `objectWillChange`，
 * 再触发自动保存调度 —— 反过来的话，UI 会在「已排队保存」的旧快照上重绘一帧。
 */
export class ProjectWorkspace implements RecordingSessionWorkspacePort {
  readonly document: ProjectDocument
  onFailure?: (message: string) => void
  onStateChange?: () => void
  private readonly persistence: ProjectSessionPersistencePort
  private lastProject: unknown

  constructor(document: ProjectDocument, persistence: ProjectSessionPersistencePort) {
    this.document = document
    this.persistence = persistence
    this.lastProject = (document as unknown as { project?: unknown }).project
    persistence.onStateChange = () => this.onStateChange?.()
    persistence.onFailure = (message) => this.onFailure?.(message)
  }

  get session(): RecordingSessionLike | null {
    return this.persistence.session
  }

  get isSaved(): boolean {
    return this.persistence.isSaved
  }

  get status(): 'clean' | 'saving' | 'failed' {
    return this.persistence.status
  }

  /**
   * 文档替换后调用：与上次快照不同才排自动保存（对应 Swift 的 `$project.dropFirst()`）。
   * 保存的是**不可变快照**，文档之后怎么改都不会影响这一份写入。
   */
  notifyProjectChanged(project: unknown): void {
    if (project === this.lastProject) return
    this.lastProject = project
    this.persistence.scheduleAutosave(project)
  }

  activate(session: RecordingSessionLike, isSaved: boolean): void {
    this.persistence.activate(session, isSaved)
  }

  async flush(project: unknown): Promise<ProjectSaveReceipt | null> {
    return this.persistence.flush(project)
  }

  async move(project: unknown, destination: string): Promise<ProjectMoveReceipt | null> {
    return this.persistence.move(project, destination)
  }

  async moveAndInvalidate(
    project: unknown,
    destination: string
  ): Promise<ProjectMoveReceipt | null> {
    return this.persistence.moveAndInvalidate(project, destination)
  }

  async flushAndInvalidate(project: unknown): Promise<RecordingSessionLike | null> {
    return this.persistence.flushAndInvalidate(project)
  }

  async invalidateCurrentSession(): Promise<RecordingSessionLike | null> {
    return this.persistence.invalidateCurrentSession()
  }
}
