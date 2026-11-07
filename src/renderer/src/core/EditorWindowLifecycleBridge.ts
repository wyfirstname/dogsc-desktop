/**
 * 编辑器窗口生命周期桥 —— 窗标题、活跃态、以及把红绿灯按钮对齐到自绘标题栏。
 *
 * Swift source: Sources/DogSCApp/EditorWindowLifecycleBridge.swift（189 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorWindowLifecycleBridge（NSViewRepresentable）  L7-33
 *   - final class WindowObservationView                         L35-178
 *     · viewDidMoveToWindow（六组通知注册）                      L62-107
 *     · layout → alignTrafficLights                            L109-112
 *     · alignTrafficLights（46 pt 标题条 + 三个按钮定位）        L117-137 → editorTrafficLightOrigin
 *     · updateScreenSize（去重 + 异步复检）                      L139-146 → editorScreenSizeDecision
 *     · updateActivity（四项与）                                L148-158 → editorWindowIsActive
 *     · updateWindowTitle                                      L160-166 → editorWindowTitle
 *     · stopObserving（清空时把 lastActivity/lastScreenSize 归 nil）L172-177
 *   - EnvironmentValues.editorIsActive                          L180-189
 *
 * 原注释（L4-6）：
 *   Observes only the NSWindow that hosts this editor. A resign-key event ends
 *   any transient editor gesture through the store's shared lifecycle policy,
 *   so no half-finished preview survives a window switch.
 *
 * 原注释（L114-116）：
 *   The editor draws its own 46 pt title bar. Grow the native title-bar strip to
 *   the same height and centre the traffic lights in it, so the window controls
 *   sit on the bar's midline like every other control.
 *
 * 原注释（L153-154）：
 *   NSView attachment may occur during SwiftUI's update pass.
 *
 * 迁移说明：`NSViewRepresentable` → React 的 ref 挂载；六组 `NotificationCenter`
 * 观察者 → `BrowserWindow` 的 `focus`/`blur`/`minimize`/`restore`/`resize`/
 * `closed` 事件 + `screen` 变化。红绿灯按钮在 Windows 侧由系统绘制，但
 * **标题栏高度 46 pt 的约定仍然有效**（自绘工具栏要与之一致），所以对齐算术
 * 保留为可断言函数。窗口标题的两条分支（空标题回退）是最容易被改错的地方。
 */

/** Swift L122 / `EditorChromeMetrics.titleBarHeight`：自绘标题栏高度。 */
export const EDITOR_TITLE_BAR_HEIGHT = 46

/** Swift L132：第一个红绿灯按钮的左边距。 */
export const EDITOR_TRAFFIC_LIGHT_LEADING_INSET = 16

/** Swift L132：相邻红绿灯按钮的间距。 */
export const EDITOR_TRAFFIC_LIGHT_SPACING = 20

/** Swift L128：三个按钮的类型顺序（关闭 → 最小化 → 缩放）。 */
export const EDITOR_TRAFFIC_LIGHT_BUTTONS = ['closeButton', 'miniaturizeButton', 'zoomButton'] as const

export type EditorTrafficLightButton = (typeof EDITOR_TRAFFIC_LIGHT_BUTTONS)[number]

/**
 * Swift L160-166：窗口标题。
 *
 * 两条分支的分隔符不同 —— 无项目名时是空格（`DogSC 编辑器`），
 * 有项目名时是破折号（`片子 — DogSC`）。项目名只 trim 首尾空白，
 * 中间的空格与中文一律保留。
 */
export function editorWindowTitle(input: {
  readonly projectTitle: string
  readonly appDisplayName: string
  readonly editorSuffix?: string
}): string {
  const trimmed = input.projectTitle.trim()
  const suffix = input.editorSuffix ?? '编辑器'
  if (trimmed.length === 0) return `${input.appDisplayName} ${suffix}`
  return `${trimmed} — ${input.appDisplayName}`
}

/**
 * Swift L148-151：活跃态是**四项与**。
 *
 *   `isActive && !isHidden && !isMiniaturized && isVisible && occlusionVisible`
 *
 * 少任何一项都会让「窗口被完全遮挡时仍在跑预览渲染」这类问题回来。
 */
export function editorWindowIsActive(input: {
  readonly applicationIsActive: boolean
  readonly applicationIsHidden: boolean
  readonly windowIsMiniaturized: boolean
  readonly windowIsVisible: boolean
  readonly windowIsOccluded: boolean
}): boolean {
  return (
    input.applicationIsActive &&
    !input.applicationIsHidden &&
    !input.windowIsMiniaturized &&
    input.windowIsVisible &&
    input.windowIsOccluded
  )
}

/** Swift L124-126：原生标题条容器要撑到自绘栏的高度。 */
export interface EditorTitleBarFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function editorTitleBarContainerFrame(input: {
  readonly windowWidth: number
  readonly windowHeight: number
  readonly barHeight: number
}): EditorTitleBarFrame {
  return {
    x: 0,
    y: input.windowHeight - input.barHeight,
    width: input.windowWidth,
    height: input.barHeight,
  }
}

/**
 * Swift L131-135：第 `index` 个红绿灯按钮的原点。
 *
 * y 用 `((barHeight − buttonHeight) / 2).rounded()` —— 向上取整到整数点，
 * 否则 1x 屏上按钮会在两次 resize 之间跳一个像素。
 */
export function editorTrafficLightOrigin(input: {
  readonly index: number
  readonly barHeight: number
  readonly buttonHeight: number
}): { readonly x: number; readonly y: number } {
  return {
    x: EDITOR_TRAFFIC_LIGHT_LEADING_INSET + input.index * EDITOR_TRAFFIC_LIGHT_SPACING,
    y: Math.round((input.barHeight - input.buttonHeight) / 2),
  }
}

/**
 * Swift L118：全屏时不碰标题条。
 *
 * 全屏下原生标题条被系统接管，改 frame 会让按钮错位到屏幕外。
 */
export function editorShouldAlignTrafficLights(input: {
  readonly hasWindow: boolean
  readonly isFullScreen: boolean
  readonly hasTitlebarAccessory: boolean
}): boolean {
  return input.hasWindow && !input.isFullScreen && input.hasTitlebarAccessory
}

/** Swift L139-146：屏幕可视尺寸变化的两步判定。 */
export interface EditorScreenSizeDecision {
  /** 与上次相同 → 连异步排期都不做。 */
  readonly schedule: boolean
  readonly nextLastScreenSize: EditorScreenSizeLike | null
}

export interface EditorScreenSizeLike {
  readonly width: number
  readonly height: number
}

export function editorScreenSizeDecision(input: {
  readonly lastScreenSize: EditorScreenSizeLike | null
  readonly screenSize: EditorScreenSizeLike | null
}): EditorScreenSizeDecision {
  if (input.screenSize == null) return { schedule: false, nextLastScreenSize: input.lastScreenSize }
  const last = input.lastScreenSize
  if (last != null && last.width === input.screenSize.width && last.height === input.screenSize.height) {
    return { schedule: false, nextLastScreenSize: last }
  }
  return { schedule: true, nextLastScreenSize: input.screenSize }
}

/**
 * Swift L142-145 / L154-157：异步回调落地前的**复检**。
 *
 * 挂载发生在 SwiftUI 的 update pass 里，同步回调会在视图还没接上窗口时触发。
 * 排到下一个主线程回合之后必须再确认「期望值仍是当前值」，否则一次快速
 * 缩放会连着发出两个互相矛盾的尺寸通知。
 */
export function editorDeferredDispatchShouldRun<T>(expected: T, current: T): boolean {
  return expected === current
}

/**
 * Swift L35-178 的观察者本体（无 AppKit，只维护去重状态）。
 *
 * `reset()` 对应 `stopObserving()`：**必须**把 `lastActivity` 与
 * `lastScreenSize` 归 null，否则重新挂载时「状态没变」会吞掉第一次通知 ——
 * 新窗口会一直等不到第一次活跃态。
 */
export class EditorWindowObservation {
  private lastActivity: boolean | null = null
  private lastScreenSize: EditorScreenSizeLike | null = null
  private readonly onActivityChanged: (active: boolean) => void
  private readonly onScreenSizeChanged: (size: EditorScreenSizeLike) => void
  private readonly schedule: (task: () => void) => void

  constructor(input: {
    readonly onActivityChanged: (active: boolean) => void
    readonly onScreenSizeChanged: (size: EditorScreenSizeLike) => void
    /** 等价于 `DispatchQueue.main.async`。 */
    readonly schedule?: (task: () => void) => void
  }) {
    this.onActivityChanged = input.onActivityChanged
    this.onScreenSizeChanged = input.onScreenSizeChanged
    this.schedule = input.schedule ?? ((task) => queueMicrotask(task))
  }

  get activityValue(): boolean | null {
    return this.lastActivity
  }

  get screenSizeValue(): EditorScreenSizeLike | null {
    return this.lastScreenSize
  }

  /** Swift L148-158：只有翻转才通知，且通知前再复检一次。 */
  updateActivity(input: {
    readonly applicationIsActive: boolean
    readonly applicationIsHidden: boolean
    readonly windowIsMiniaturized: boolean
    readonly windowIsVisible: boolean
    readonly windowIsOccluded: boolean
  }): boolean {
    const active = editorWindowIsActive(input)
    if (active === this.lastActivity) return false
    this.lastActivity = active
    this.schedule(() => {
      if (this.lastActivity !== active) return
      this.onActivityChanged(active)
    })
    return true
  }

  /** Swift L139-146。 */
  updateScreenSize(screenSize: EditorScreenSizeLike | null): boolean {
    const decision = editorScreenSizeDecision({
      lastScreenSize: this.lastScreenSize,
      screenSize,
    })
    if (!decision.schedule || screenSize == null) return false
    this.lastScreenSize = decision.nextLastScreenSize
    this.schedule(() => {
      const last = this.lastScreenSize
      if (last == null || last.width !== screenSize.width || last.height !== screenSize.height) return
      this.onScreenSizeChanged(screenSize)
    })
    return true
  }

  /** Swift L172-177。 */
  reset(): void {
    this.lastActivity = null
    this.lastScreenSize = null
  }
}
