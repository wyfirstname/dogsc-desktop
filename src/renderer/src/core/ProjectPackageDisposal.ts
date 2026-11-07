/**
 * 工程包处置 —— Swift ProjectPackageDisposal.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/ProjectPackageDisposal.swift（36 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - moveToTrash(_:)            L7-11   → moveProjectPackageToTrash
 *   - removeIfPresent(_:)        L13-18  → removeProjectPackageIfPresent
 *   - perform(priority:operation:) L21-35 → performDisposalWork
 *
 * 原注释（L3-5）：
 *   Large recording packages must never be moved or recursively removed on
 *   MainActor. These operations can block on APFS metadata, external volumes or
 *   Finder's Trash bookkeeping even when the apparent action is just a rename.
 *
 * 迁移说明：Electron 侧对应 `shell.trashItem`（回收站）与 `fs.rm`；渲染层只
 * 决定**先后顺序与取消语义**，真正的 I/O 由注入的 `DisposalFileSystem` 完成。
 * 语义铁律（与 macOS 版一致）：删除走回收站、绝不 `rm -rf`。
 */

/** 取消被触发时抛出的错误（Swift `Task.checkCancellation()` / `CancellationError`）。 */
export class DisposalCancelledError extends Error {
  constructor() {
    super('处置流程已取消。')
    this.name = 'DisposalCancelledError'
  }
}

export interface DisposalFileSystem {
  /** 移入回收站（绝不永久删除）。 */
  trashItem(path: string): void | Promise<void>
  /** 删除单个（已确认存在的）项目。 */
  removeItem(path: string): void | Promise<void>
  fileExists(path: string): boolean
}

/**
 * Swift L21-35：把文件系统工作放到主线程之外，并保留取消语义。
 *
 * 原实现在操作前后各 `Task.checkCancellation()`；取消期间通过
 * `withTaskCancellationHandler` 把取消转发给子任务。TS 侧用
 * `isCancelled` 轮询 + `registerCancellation` 注册回调表达同一契约。
 */
export async function performDisposalWork<T>(
  operation: () => T | Promise<T>,
  options?: {
    isCancelled?: () => boolean
    registerCancellation?: (cancel: () => void) => void
  }
): Promise<T> {
  let cancelled = false
  const cancel = (): void => {
    cancelled = true
  }
  options?.registerCancellation?.(cancel)

  const checkCancellation = (): void => {
    if (cancelled || options?.isCancelled?.()) throw new DisposalCancelledError()
  }

  checkCancellation()
  const result = await operation()
  checkCancellation()
  return result
}

/**
 * Swift L7-11：整包移入回收站（`FileManager.trashItem`）。
 * 优先级 userInitiated —— 用户点删除后立刻可见。
 */
export async function moveProjectPackageToTrash(
  fileSystem: DisposalFileSystem,
  packagePath: string,
  options?: {
    isCancelled?: () => boolean
    registerCancellation?: (cancel: () => void) => void
  }
): Promise<void> {
  await performDisposalWork(() => fileSystem.trashItem(packagePath), options)
}

/**
 * Swift L13-18：不存在就静默返回；存在则删除。
 * 原实现是 `try?` 吞错（清理失败不应打断主流程），这里同样不抛。
 */
export async function removeProjectPackageIfPresent(
  fileSystem: DisposalFileSystem,
  packagePath: string,
  options?: {
    isCancelled?: () => boolean
    registerCancellation?: (cancel: () => void) => void
  }
): Promise<void> {
  try {
    await performDisposalWork(async () => {
      if (!fileSystem.fileExists(packagePath)) return
      await fileSystem.removeItem(packagePath)
    }, options)
  } catch {
    // 与 Swift `try?` 一致：清理失败不影响调用方。
  }
}
