/**
 * 编辑器工作区布局 —— Swift EditorWorkspaceLayout.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorWorkspaceLayout.swift（82 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - minimumWindowSize 840×600                       L9
 *   - compression：窗口压力 + 屏幕压力取大、夹 [0,1]    L13-19
 *   - 各尺寸的 regular→compact 插值                    L21-36
 *   - value(regular:compact:)                         L38-40
 *   - timelineHeight(preferred:availableHeight:)      L42-50
 *   - EditorChromeScaleLayout（提案除以 scale）        L56-74
 *
 * 原注释：1080p 屏幕上即便把编辑器最大化也仍然需要紧凑控件 —— 所以既要看**窗口**空间，
 * 也要看**所在屏幕**的可用点数；大桌面保持既有布局。**后备像素与录制/导出尺寸
 * 永远不进入这个计算**（它们与 UI 缩放无关）。
 */

/** 窗口最小尺寸。 */
export const EDITOR_MINIMUM_WINDOW_SIZE = { width: 840, height: 600 } as const

/** Swift EditorInterfaceRadius 的固定值（EditorDesignTokens 尚未转写，先按需内联）。 */
export const EDITOR_INTERFACE_RADIUS = {
  compact: 8,
  control: 10,
  group: 12,
  card: 14,
  floating: 20,
  tile: 18,
} as const

export interface EditorWorkspaceLayoutInput {
  readonly width: number
  readonly height: number
  /** 所在屏幕的可用点数；null 表示「不知道」（单屏已知时传具体值）。 */
  readonly screenWidth?: number | null
  readonly screenHeight?: number | null
}

/**
 * Swift L13-19：`max(窗口压力, 屏幕压力)`，其中
 * 窗口压力 = `max((1440-w)/360, (820-h)/220)`、屏幕压力 = `max((2048-sw)/640, (1200-sh)/260)`。
 * 结果夹到 [0,1] —— 0 表示完全常规、1 表示完全紧凑，中间线性过渡。
 */
export function editorWorkspaceCompression(input: EditorWorkspaceLayoutInput): number {
  const windowPressure = Math.max((1440 - input.width) / 360, (820 - input.height) / 220)
  const screenPressure =
    input.screenWidth != null && input.screenHeight != null
      ? Math.max((2048 - input.screenWidth) / 640, (1200 - input.screenHeight) / 260)
      : 0
  return Math.min(Math.max(Math.max(windowPressure, screenPressure), 0), 1)
}

/** Swift `value(regular:compact:)`：按压缩度线性插值。 */
export function editorWorkspaceValue(
  compression: number,
  regular: number,
  compact: number
): number {
  return regular + (compact - regular) * compression
}

export interface EditorWorkspaceMetrics {
  readonly compression: number
  readonly isCompact: boolean
  readonly chromeScale: number
  readonly toolbarHeight: number
  readonly outerInset: number
  readonly timelineGap: number
  readonly surfaceRadius: number
  readonly inspectorLogicalWidth: number
  readonly inspectorWidth: number
  readonly railWidth: number
  readonly workspaceEdge: number
  readonly workspaceGap: number
  readonly canvasToolbarOffset: number
  readonly compactTimelineControls: boolean
  readonly iconOnlyTimelineControls: boolean
}

/** Swift L21-36 的全部派生尺寸。 */
export function editorWorkspaceMetrics(input: EditorWorkspaceLayoutInput): EditorWorkspaceMetrics {
  const compression = editorWorkspaceCompression(input)
  const value = (regular: number, compact: number): number =>
    editorWorkspaceValue(compression, regular, compact)
  const chromeScale = value(1, 0.86)
  const inspectorLogicalWidth = value(
    Math.min(Math.max(input.width * 0.23, 384), 432),
    384
  )
  const isCompact = compression > 0
  return {
    compression,
    isCompact,
    chromeScale,
    toolbarHeight: value(72, 56),
    outerInset: value(16, 10),
    timelineGap: value(12, 8),
    surfaceRadius: EDITOR_INTERFACE_RADIUS.floating * chromeScale,
    inspectorLogicalWidth,
    inspectorWidth: inspectorLogicalWidth * chromeScale,
    railWidth: 72 * chromeScale,
    workspaceEdge: value(40, 12),
    workspaceGap: value(60, 16),
    canvasToolbarOffset: 46 * chromeScale,
    compactTimelineControls: isCompact && input.width < 1320,
    iconOnlyTimelineControls: isCompact && input.width < 1120,
  }
}

/**
 * Swift L42-50：时间线高度。
 *
 * - 预算 = `max(可用高 − (320→260 的固定占用) − (gap+inset), 170)`；
 * - 紧凑时再压到 `max(min(预算, 可用高×44%), 170)` —— 多条轨道可见时不能让时间线
 *   把监视器/检查器挤出屏幕；
 * - 上限取「常规预算」与「紧凑预算」的插值，首选高度向**上**取整后夹进去。
 */
export function editorTimelineHeight(
  compression: number,
  preferred: number | null,
  availableHeight: number
): number {
  const timelineGap = editorWorkspaceValue(compression, 12, 8)
  const outerInset = editorWorkspaceValue(compression, 16, 10)
  const surrounding = timelineGap + outerInset
  const budget = Math.max(
    availableHeight - editorWorkspaceValue(compression, 320, 260) - surrounding,
    170
  )
  const compactBudget = Math.max(Math.min(budget, availableHeight * 0.44), 170)
  const preferredHeight = preferred ?? editorWorkspaceValue(compression, 300, 228)
  return Math.min(
    Math.ceil(preferredHeight),
    editorWorkspaceValue(compression, budget, compactBudget)
  )
}

/**
 * Swift `EditorChromeScaleLayout`：先按**未缩放**的提案问子视图要尺寸，再乘 scale 报给上层；
 * 放置时把整块区域除以 scale 后交给子视图。这样表面、悬停形状、控件与命中区一起缩小。
 * 预览渲染器与时间线文档**故意留在自己的原生坐标系**里，不参与缩放。
 */
export function editorChromeUnscaledSize(
  scale: number,
  proposal: { readonly width: number | null; readonly height: number | null }
): { readonly width: number | null; readonly height: number | null } {
  if (!(scale > 0)) return proposal
  return {
    width: proposal.width == null ? null : proposal.width / scale,
    height: proposal.height == null ? null : proposal.height / scale,
  }
}

/** 子视图算出的未缩放尺寸 → 实际占用（乘 scale）。 */
export function editorChromeScaledSize(
  scale: number,
  content: { readonly width: number; readonly height: number }
): { readonly width: number; readonly height: number } {
  return { width: content.width * scale, height: content.height * scale }
}
