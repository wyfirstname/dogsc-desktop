/**
 * 采集内容过滤器 —— Swift CaptureSurfaceFilter.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/CaptureSurfaceFilter.swift（54 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - 排除自身进程                                        L14
 *   - hidesDock 时追加 com.apple.dock                     L15-19
 *   - editorWindows = 自身进程且命中 CaptureEditorWindows  L21-25
 *   - hidesDesktopFiles 时把 Finder 桌面窗口放进例外名单   L27-32
 *   - SCContentFilter(display:excluding:excepting:)       L34-38
 *   - finderDesktopWindowIDs（layer < 0 才算桌面）         L41-53
 *
 * 原注释：**初次采集、可见性开关、编辑器外观三者共用同一套策略**。
 * `exceptingWindows`（例外 = 单独放回来）与 `excludingApplications`（排除整个 App）
 * 是两套语义：编辑器窗口属于「被排除的 App 里要单独放回来的窗口」，Finder 桌面图标
 * 也走同一条例外通道 —— 因此两者可以共存，不会互相覆盖。
 */

export interface CaptureSurfaceApplication {
  readonly processID: number
  readonly bundleIdentifier: string | null
}

export interface CaptureSurfaceWindow {
  readonly windowID: number
  readonly ownerProcessID: number
}

export interface CaptureSurfaceFilterInput {
  readonly configuration: {
    readonly hidesDock: boolean
    readonly hidesDesktopFiles: boolean
  }
  readonly applications: readonly CaptureSurfaceApplication[]
  readonly windows: readonly CaptureSurfaceWindow[]
  /** 自身进程（Swift `getpid()`）。 */
  readonly ownProcessID: number
  /** 属于编辑器、需要单独放回来的窗口 id（Swift `CaptureEditorWindows.shared.includes`）。 */
  readonly editorWindowIDs: readonly number[]
  /** Finder 桌面图标窗口 id（`finderDesktopWindowIDs` 的结果）。 */
  readonly finderDesktopWindowIDs: readonly number[]
}

export interface CaptureSurfaceFilterPlan {
  /** 整体排除的应用（自身进程，可选 Dock）。 */
  readonly excludedApplications: readonly CaptureSurfaceApplication[]
  /** 从被排除的 App 里单独放回来的窗口（编辑器窗口 + 可选 Finder 桌面）。 */
  readonly exceptingWindowIDs: readonly number[]
  /** 其中属于编辑器的那部分（UI 需要据此隐藏自己的浮层）。 */
  readonly editorWindowIDs: readonly number[]
}

export const FINDER_BUNDLE_IDENTIFIER = 'com.apple.finder'
export const DOCK_BUNDLE_IDENTIFIER = 'com.apple.dock'

/**
 * Swift init 的完整决策。
 *
 * 顺序不影响结果，但**编辑器窗口的筛选条件是两条**（自身进程 **且** 在编辑器集合里）：
 * 只按进程筛会把录制面板/浮层也当成「例外」放回画面里。
 */
export function captureSurfaceFilterPlan(input: CaptureSurfaceFilterInput): CaptureSurfaceFilterPlan {
  const excludedApplications: CaptureSurfaceApplication[] = input.applications.filter(
    (application) => application.processID === input.ownProcessID
  )
  if (input.configuration.hidesDock) {
    for (const application of input.applications) {
      if (application.bundleIdentifier === DOCK_BUNDLE_IDENTIFIER) {
        excludedApplications.push(application)
      }
    }
  }

  const editorSet = new Set(input.editorWindowIDs)
  const editorWindows = input.windows.filter(
    (window) => window.ownerProcessID === input.ownProcessID && editorSet.has(window.windowID)
  )
  const exceptingWindowIDs = editorWindows.map((window) => window.windowID)

  if (input.configuration.hidesDesktopFiles) {
    const desktopIDs = new Set(input.finderDesktopWindowIDs)
    for (const window of input.windows) {
      if (desktopIDs.has(window.windowID)) exceptingWindowIDs.push(window.windowID)
    }
  }

  return {
    excludedApplications,
    exceptingWindowIDs,
    editorWindowIDs: editorWindows.map((window) => window.windowID),
  }
}

export interface WindowInfoDescription {
  readonly ownerProcessID: number
  readonly ownerBundleIdentifier: string | null
  readonly layer: number
  readonly windowNumber: number
}

/**
 * Swift L45-52：只认 **Finder 且 layer < 0** 的窗口 —— 桌面图标所在的窗口层级是负数，
 * 普通 Finder 窗口是 0 以上。漏掉这条会把访达窗口也藏掉。
 */
export function finderDesktopWindowIDs(
  descriptions: readonly WindowInfoDescription[]
): readonly number[] {
  const ids: number[] = []
  for (const description of descriptions) {
    if (
      description.ownerBundleIdentifier === FINDER_BUNDLE_IDENTIFIER &&
      description.layer < 0
    ) {
      ids.push(description.windowNumber)
    }
  }
  return ids
}
