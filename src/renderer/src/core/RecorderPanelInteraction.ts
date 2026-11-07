/**
 * Swift source: Sources/DogSCApp/RecorderPanelInteraction.swift（121 行）@ 567fd6e
 *
 * L7-29   → RecorderDragGrip（22×40 的拖动手柄，两列各 3 个 2pt 点）
 * L31-36  → RecorderHostingView：hosting 视图也要接受首点
 * L38-91  → RecorderPanelPointerRegion：只有可见岛能接收指针
 * L93-121 → RecorderIslandInteractionRegion（布局即边界，不硬编码尺寸）
 *
 * 原注释：窗口包含用于绘制阴影的空间，但只有可见的那块岛可以接收指针输入。
 * 单靠 NSView.hitTest 无法把点击穿透到**另一个进程**，所以要在下一次 mouse-down
 * 之前改变窗口的接受状态。
 */

/** 手柄尺寸与点位。 */
export const DRAG_GRIP_WIDTH = 22
export const DRAG_GRIP_HEIGHT = 40
export const DRAG_GRIP_DOT_DIAMETER = 2
export const DRAG_GRIP_DOT_SPACING = 3
export const DRAG_GRIP_COLUMN_SPACING = 3
export const DRAG_GRIP_DOTS_PER_COLUMN = 3

export const DRAG_GRIP_ACCESSIBILITY_IDENTIFIER = 'recorder.window-drag-grip'
export const DRAG_GRIP_LABEL = '拖动录制条'

export type PanelPointerDecision = 'ignore' | 'keep' | 'accept'

/**
 * 岛内命中判定（Swift L76-90）。
 *
 * 三种输入值得注意：
 * - 没启用 / 没岛视图 / 岛不在这个窗口 → 立刻 `ignore`；
 * - **鼠标仍按着** → `keep`（不改变现状）：接收方必须稳定到原生控件或窗口拖动
 *   收到 mouse-up 为止，哪怕指针已经离开岛；
 * - 否则按椭圆（实际是按短边为半径的圆角矩形）判定，落在外面就 `ignore`。
 */
export function panelPointerDecision(input: {
  readonly enabled: boolean
  readonly hasIslandView: boolean
  readonly islandBelongsToWindow: boolean
  readonly pressedMouseButtons: number
  readonly pointer: { readonly x: number; readonly y: number } | null
  readonly island: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}): PanelPointerDecision {
  if (!input.enabled || !input.hasIslandView || !input.islandBelongsToWindow) return 'ignore'
  if (input.pressedMouseButtons !== 0) return 'keep'
  if (input.pointer === null) return 'ignore'
  const radius = Math.min(input.island.width, input.island.height) / 2
  return roundedRectContains(input.island, radius, input.pointer) ? 'accept' : 'ignore'
}

/** 圆角矩形命中（Swift `NSBezierPath(roundedRect:xRadius:yRadius:)`）。 */
export function roundedRectContains(
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  radius: number,
  point: { readonly x: number; readonly y: number }
): boolean {
  if (
    point.x < rect.x ||
    point.y < rect.y ||
    point.x > rect.x + rect.width ||
    point.y > rect.y + rect.height
  ) {
    return false
  }
  const r = Math.min(radius, Math.min(rect.width, rect.height) / 2)
  if (r <= 0) return true
  const clampedX = Math.min(Math.max(point.x, rect.x + r), rect.x + rect.width - r)
  const clampedY = Math.min(Math.max(point.y, rect.y + r), rect.y + rect.height - r)
  const dx = point.x - clampedX
  const dy = point.y - clampedY
  return dx * dx + dy * dy <= r * r
}

/** 需要监听的鼠标事件（Swift L59）：移动 + 三种 mouse-up。 */
export const PANEL_POINTER_EVENTS = ['mouseMoved', 'leftMouseUp', 'rightMouseUp', 'otherMouseUp'] as const

/**
 * 监听器的生命周期：启用时装一次（本地 + 全局），停用时两个都摘。
 * 重复启用不会叠加 —— 已经装过就只做一次刷新。
 */
export function panelPointerMonitorAction(input: {
  readonly enabled: boolean
  readonly hasLocalMonitor: boolean
  readonly hasGlobalMonitor: boolean
}): 'install' | 'remove' | 'refresh' {
  if (input.enabled && !input.hasLocalMonitor) return 'install'
  if (!input.enabled && (input.hasLocalMonitor || input.hasGlobalMonitor)) return 'remove'
  return 'refresh'
}

/** 岛上的交互视图形状：永不参与命中（`hitTest → nil`），只负责上报几何。 */
export const ISLAND_INTERACTION_VIEW_ACCEPTS_HIT_TEST = false

/** hosting 视图必须接受首点，否则未激活面板的第一下点击被吃去激活窗口。 */
export const RECORDER_HOSTING_ACCEPTS_FIRST_MOUSE = true
