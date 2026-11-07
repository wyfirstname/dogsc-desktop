/**
 * 位置盘 —— 归一化坐标的紧凑直接操作面。
 *
 * Swift source: Sources/DogSCApp/EditorPositionPad.swift（320 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorPositionPad                                   L7-262
 *     · header（标题 11、居中按钮、detail 10）                    L24-53  → POSITION_PAD_HEADER_*
 *     · coordinateReadouts（X / Y 百分比）                        L71-98  → positionPadPercent*
 *     · positionSurface（inset 12、圆角 14、128 高）              L100-178 → POSITION_PAD_*
 *       · 九点吸附网格（醒 7 / 静 4.5、α 0.5 / 0.22）             L181-201 → POSITION_ANCHOR_*
 *       · 十字虚线（0.75 宽、[2.5,3.5]、α 0.5）                   L121-132 → POSITION_CROSSHAIR_*
 *       · 墨点（光晕 36 / 本体 20 / 内核 6、放大 1.1）             L136-150 → POSITION_PUCK_*
 *       · DragGesture(minimumDistance: 0)                        L153-172 → positionPadPointAt
 *     · nearestAnchor（阈值 0.04）                               L203-208 → POSITION_ANCHOR_TOLERANCE
 *     · regionName（3×3 中文名 + 自定义）                        L210-214 → POSITION_REGION_NAMES
 *     · regionLabel（22 号、28 高、±16 过渡）                     L216-231 → positionPadRegionTransition
 *     · isCentered（0.0005）                                     L233-235 → POSITION_CENTER_TOLERANCE
 *     · gesturePoint（含 snapsToGrid）                            L237-249 → positionPadPointAt
 *     · snappedToGrid（五档锚点、0.035）                          L251-257 → POSITION_GRID_*
 *     · clamp01（非有限 → 0.5）                                   L259-261 → positionPadClamp01
 *   - struct EditorTransactionalPositionPad                      L267-320 → positionPadTransactional*
 *
 * 原注释（L4-6）：
 *   A compact direct-manipulation surface for normalized editor positions.
 *   The visual pad, exact X/Y entry and reset action all share the caller's
 *   single continuous interaction instead of exposing three competing paths.
 *
 * 原注释（L134-135）：
 *   One flat ink puck. It glides to a new position and follows the pointer
 *   exactly while it is being dragged.
 *
 * 原注释（L180）：
 *   Nine quiet dots mark where the position snaps; the nearest one wakes up.
 *
 * 迁移说明：`GeometryReader` + `DragGesture` → div + pointer 事件。
 * 保留四件纯逻辑：坐标 ↔ 像素的双向映射（含 inset）、九宫格吸附与最近锚点、
 * 五档网格吸附、以及「居中」判定的收紧阈值。
 */

import type { NormalizedPoint } from './ZoomAnimation'

// ---------------------------------------------------------------- 尺寸

/**
 * Swift L102：位置盘的可用区内缩 12。
 *
 * 12 是让墨点（本体直径 20、光晕 36）在边角处不被裁掉的最小值 ——
 * 光晕半径 18，内缩 12 之后贴边时还有 6 像素余量。
 */
export const POSITION_PAD_INSET = 12

/** Swift L176：常规高度 128，紧凑高度 112、宽度 158。 */
export const POSITION_PAD_HEIGHT = 128
export const POSITION_PAD_COMPACT_HEIGHT = 112
export const POSITION_PAD_COMPACT_WIDTH = 158

/** Swift L111：盘面圆角 14。 */
export const POSITION_PAD_CORNER_RADIUS = 14

/** Swift L24：标题行与下方内容的间距 9。 */
export const POSITION_PAD_SECTION_SPACING = 9

/** Swift L25：标题与「居中」按钮之间至少 8。 */
export const POSITION_PAD_HEADER_SPACING = 8

/** Swift L26-28：标题字号取自 `EditorTypography.controlLabel`（11）。 */
export const POSITION_PAD_TITLE_FONT_SIZE = 11

/** Swift L39：居中按钮字号 10。 */
export const POSITION_PAD_CENTER_FONT_SIZE = 10

/** Swift L50：说明文字字号 10。 */
export const POSITION_PAD_DETAIL_FONT_SIZE = 10

/** Swift L51：说明文字透明度 0.50。 */
export const POSITION_PAD_DETAIL_ALPHA = 0.5

/** Swift L56：紧凑布局中盘面与右侧读数区的间距 18。 */
export const POSITION_PAD_COMPACT_SPACING = 18

/** Swift L58：紧凑布局中区域名与读数的间距 10。 */
export const POSITION_PAD_COMPACT_STACK_SPACING = 10

// ---------------------------------------------------------------- 盘面填充

/**
 * Swift L112：盘面底色三种来源。
 *
 * 在 tile 里用 `panelSurface`（实色，因为 tile 本身已经有底色，再叠半透明会发灰）；
 * 不在 tile 里则按是否直接编辑给 0.065 / 0.045 两档 —— 编辑时略深一点，
 * 提示「这块现在是活动的」。
 */
export function positionPadSurfaceFillAlpha(input: {
  readonly insideTile: boolean
  readonly isDirectlyEditing: boolean
}): number | null {
  if (input.insideTile) return null
  return input.isDirectlyEditing ? 0.065 : 0.045
}

/** Swift L113-114：填充档位切换用 `SpringMotion.hover`。 */
export const POSITION_PAD_FILL_ANIMATION = { response: 0.24, dampingFraction: 0.86 } as const

// ---------------------------------------------------------------- 坐标映射

/**
 * Swift L259-261：夹到 [0, 1]，非有限值给 **0.5**。
 *
 * 非有限（NaN / Infinity）时给 0.5 而不是 0：上游算出 NaN 通常意味着
 * 「还没有值」，落在左上角会让画面突然甩到边角，居中至少看起来像没动。
 */
export function positionPadClamp01(value: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0.5, 0), 1)
}

/**
 * Swift L103-107：归一化坐标 → 盘面像素坐标。
 *
 * `usableWidth = max(width - inset * 2, 1)` 的下限 1 挡的是「盘面还没布局」
 * （宽 0）的那一帧 —— 除零会得到 Infinity，墨点位置直接跑到画布外。
 */
export function positionPadPointToPixel(input: {
  readonly point: NormalizedPoint
  readonly width: number
  readonly height: number
  readonly inset: number
}): { readonly x: number; readonly y: number } {
  const usableWidth = Math.max(input.width - input.inset * 2, 1)
  const usableHeight = Math.max(input.height - input.inset * 2, 1)
  return {
    x: input.inset + positionPadClamp01(input.point.x) * usableWidth,
    y: input.inset + positionPadClamp01(input.point.y) * usableHeight,
  }
}

/**
 * Swift L237-249：像素坐标 → 归一化坐标（拖拽反解）。
 *
 * `snapsToGrid` 为真时再过一道五档吸附。注意反解**先**归一化**再**吸附，
 * 顺序反了会让吸附容差在像素空间里变成「随盘面尺寸变化」——
 * 同一个 3.5% 的容差在 158 宽的紧凑盘上只有 5 像素，用户根本碰不到。
 */
export function positionPadPointAt(input: {
  readonly locationX: number
  readonly locationY: number
  readonly width: number
  readonly height: number
  readonly inset: number
  readonly snapsToGrid: boolean
}): NormalizedPoint {
  const usableWidth = Math.max(input.width - input.inset * 2, 1)
  const usableHeight = Math.max(input.height - input.inset * 2, 1)
  const point: NormalizedPoint = {
    x: positionPadClamp01((input.locationX - input.inset) / usableWidth),
    y: positionPadClamp01((input.locationY - input.inset) / usableHeight),
  }
  return input.snapsToGrid ? positionPadSnappedToGrid(point) : point
}

/**
 * Swift L252：五档吸附锚点。
 *
 * 三分点（1/3、2/3）和中心点（0.5）都在里面 —— 这是「构图三分法 + 绝对居中」
 * 两种习惯的折中：只要吸附到这几档，用户就不必用读数框去精确输入。
 */
export const POSITION_GRID_ANCHORS = [0, 1 / 3, 0.5, 2 / 3, 1] as const

/**
 * Swift L254：吸附容差 0.035。
 *
 * 取 0.035 而不是 0.05 的原因：1/3 与 0.5 之间只差 0.167，
 * 容差 0.05 会让两者的吸附区在 0.4167 处相接 —— 中间那条缝里手感是断的。
 * 0.035 之后仍有一段真实的「自由区」，用户可以放在任意位置。
 */
export const POSITION_GRID_TOLERANCE = 0.035

/**
 * Swift L251-257：逐轴吸附到最近的锚点。
 *
 * `first(where:)` 且容差是 `<=` —— 命中第一个满足的锚点。锚点列表是升序的，
 * 所以温度相同的两个锚点时总是取**更小**的那个（0 优先于 1/3）。
 */
export function positionPadSnappedToGrid(point: NormalizedPoint): NormalizedPoint {
  return {
    x: positionPadSnapAxis(point.x),
    y: positionPadSnapAxis(point.y),
  }
}

/** Swift L253-255：单轴吸附。 */
export function positionPadSnapAxis(value: number): number {
  for (const anchor of POSITION_GRID_ANCHORS) {
    if (Math.abs(value - anchor) <= POSITION_GRID_TOLERANCE) return anchor
  }
  return value
}

// ---------------------------------------------------------------- 九宫格锚点

/**
 * Swift L203-208：最近的九宫格锚点（行列索引）。
 *
 * 注意用的是 **0.04** 阈值，和网格吸附的 0.035 是两套 —— 前者只影响
 * 「哪颗点醒过来」这个纯视觉提示，后者才改坐标。分成两套是刻意的：
 * 让提示比实际吸附略宽一点，用户会先看到点亮起来，再继续靠近才吸住。
 *
 * x 与 y 必须**同时**命中才返回，否则返回 null（区域名显示「自定义」）。
 */
export function positionPadNearestAnchor(
  point: NormalizedPoint
): { readonly row: number; readonly column: number } | null {
  const row = POSITION_ANCHOR_STEPS.findIndex((step) => Math.abs(point.y - step) < POSITION_ANCHOR_TOLERANCE)
  const column = POSITION_ANCHOR_STEPS.findIndex((step) => Math.abs(point.x - step) < POSITION_ANCHOR_TOLERANCE)
  if (row < 0 || column < 0) return null
  return { row, column }
}

/** Swift L204：九宫格的三档坐标。 */
export const POSITION_ANCHOR_STEPS = [0, 0.5, 1] as const

/** Swift L205-206：锚点命中阈值 0.04。 */
export const POSITION_ANCHOR_TOLERANCE = 0.04

/**
 * Swift L191-194：醒来的点 7、其余 4.5。
 *
 * 两者都小于墨点本体（20），所以九颗点永远不会和墨点争视觉中心。
 */
export function positionPadAnchorDotSize(awake: boolean): number {
  return awake ? 7 : 4.5
}

/** Swift L190：醒来的点 0.5、其余 0.22。 */
export function positionPadAnchorAlpha(awake: boolean): number {
  return awake ? 0.5 : 0.22
}

/** Swift L185-196：九颗点的位置（行列索引 → 像素）。 */
export function positionPadAnchorPosition(input: {
  readonly index: number
  readonly inset: number
  readonly usableWidth: number
  readonly usableHeight: number
}): { readonly row: number; readonly column: number; readonly x: number; readonly y: number } {
  const row = Math.floor(input.index / 3)
  const column = input.index % 3
  return {
    row,
    column,
    x: input.inset + input.usableWidth * (column / 2),
    y: input.inset + input.usableHeight * (row / 2),
  }
}

/**
 * Swift L188：判断某颗点是否「醒着」。
 *
 * 没有最近锚点（`nearest` 为 null）时全部熄灭 —— `nearest.map { ... } ?? false`
 * 这个写法保证了 null 与「不匹配」是同一个结果。
 */
export function positionPadAnchorIsAwake(
  row: number,
  column: number,
  nearest: { readonly row: number; readonly column: number } | null
): boolean {
  if (nearest === null) return false
  return nearest.row === row && nearest.column === column
}

/** Swift L211：九宫格的中文区域名（行 × 列）。 */
export const POSITION_REGION_NAMES = [
  ['左上', '上', '右上'],
  ['左', '居中', '右'],
  ['左下', '下', '右下'],
] as const

/** Swift L212：不在任何锚点上时的区域名。 */
export const POSITION_REGION_CUSTOM = '自定义'

/**
 * Swift L210-214：按当前点取区域名。
 *
 * 输入是 `draggedPoint ?? point` —— 拖拽中用手势的实时点，松手后用手势状态里的值。
 * 这样区域名在拖拽过程中就会实时切换，不必等提交。
 */
export function positionPadRegionName(point: NormalizedPoint): string {
  const anchor = positionPadNearestAnchor(point)
  if (anchor === null) return POSITION_REGION_CUSTOM
  return POSITION_REGION_NAMES[anchor.row][anchor.column]
}

// ---------------------------------------------------------------- 居中判定

/**
 * Swift L233-235：居中判定的阈值 0.0005。
 *
 * 比锚点容差（0.04）严得多，因为这里控制的是「居中按钮是否禁用」——
 * 稍微偏一点就允许用户点一下归位，比要求完全等于 0.5 好用（浮点拖动很难正中）。
 * 但阈值也不能大：0.001 以上的话，用户会看到一个「明明偏了却按不动」的按钮。
 */
export const POSITION_CENTER_TOLERANCE = 0.0005

/** Swift L44 / L233-235：已居中则禁用「居中」按钮。 */
export function positionPadIsCentered(point: NormalizedPoint): boolean {
  return (
    Math.abs(point.x - 0.5) < POSITION_CENTER_TOLERANCE &&
    Math.abs(point.y - 0.5) < POSITION_CENTER_TOLERANCE
  )
}

/** Swift L34：居中按钮提交的值。 */
export const POSITION_CENTER_POINT: NormalizedPoint = { x: 0.5, y: 0.5 }

/** Swift L33：居中动作要挂动画（`SpringMotion.snappy`）。 */
export const POSITION_CENTER_ANIMATION = { response: 0.26, dampingFraction: 0.82 } as const

// ---------------------------------------------------------------- 十字准星

/**
 * Swift L129：十字虚线 —— 宽 0.75、虚线 `[2.5, 3.5]`。
 *
 * 段长 2.5 比间隔 3.5 短，所以看起来是「一串点」而不是「一条虚线」。
 * 只在直接编辑时出现（`isDirectlyEditing`），静止时盘面是干净的。
 */
export const POSITION_CROSSHAIR_LINE_WIDTH = 0.75
export const POSITION_CROSSHAIR_DASH = [2.5, 3.5] as const

/** Swift L128：准星透明度 0.5。 */
export const POSITION_CROSSHAIR_ALPHA = 0.5

/** Swift L157-158：准星的四个端点（两条贯穿线）。 */
export function positionPadCrosshairSegments(input: {
  readonly x: number
  readonly y: number
  readonly inset: number
  readonly usableWidth: number
  readonly usableHeight: number
}): readonly {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}[] {
  return [
    { x1: input.x, y1: input.inset, x2: input.x, y2: input.inset + input.usableHeight },
    { x1: input.inset, y1: input.y, x2: input.inset + input.usableWidth, y2: input.y },
  ]
}

// ---------------------------------------------------------------- 墨点

/**
 * Swift L137-146：三层墨点 —— 光晕 36（编辑时 0.18）、本体 20、内核 6。
 *
 * 内核只有 6 像素，在纯白背景上靠对比度确定精确位置；本体 20 承担可读性；
 * 光晕 36 只在编辑时出现，用来告诉用户「这个点现在是可拖的」。
 */
export const POSITION_PUCK_HALO_SIZE = 36
export const POSITION_PUCK_BODY_SIZE = 20
export const POSITION_PUCK_CORE_SIZE = 6

/** Swift L138：光晕在编辑时不透明度 0.18，其余为 0。 */
export function positionPadPuckHaloAlpha(isDirectlyEditing: boolean): number {
  return isDirectlyEditing ? 0.18 : 0
}

/**
 * Swift L147：编辑时整组放大 1.1（降低动态效果时不动）。
 *
 * 放大的是**整组三层**，所以内核也跟着变大 —— 如果只放大光晕，
 * 编辑和平静两态的视觉重心会偏移。
 */
export function positionPadPuckScale(isDirectlyEditing: boolean, reduceMotion: boolean): number {
  return isDirectlyEditing && !reduceMotion ? 1.1 : 1
}

/** Swift L148：缩放用 `SpringMotion.snappy`；位置在编辑时**不**挂动画（跟随指针）。 */
export const POSITION_PUCK_SCALE_ANIMATION = { response: 0.26, dampingFraction: 0.82 } as const

/** Swift L150：非编辑态的位移用 `SpringMotion.fluid`。 */
export const POSITION_PUCK_GLIDE_ANIMATION = { response: 0.4, dampingFraction: 0.86 } as const

/**
 * Swift L108：是否处于直接编辑。
 *
 * 两个来源：正在拖（`draggedPoint != nil`）或正在输入坐标（`isCoordinateEditing`）。
 * 后者也要算进来，否则用户在 X/Y 框里打字时盘面没有任何反馈。
 */
export function positionPadIsDirectlyEditing(input: {
  readonly isDragging: boolean
  readonly isCoordinateEditing: boolean
}): boolean {
  return input.isDragging || input.isCoordinateEditing
}

/**
 * Swift L105：显示位置取「拖拽中的实时点」优先。
 *
 * `draggedPoint` 是 `@GestureState`，手势结束后自动归 nil，所以这个表达式
 * 天然处理了「松手回到已提交值」——不需要额外的清理逻辑。
 */
export function positionPadDisplayedPoint(
  dragged: NormalizedPoint | null,
  point: NormalizedPoint
): NormalizedPoint {
  return dragged ?? point
}

/** Swift L173：坐标输入期间盘面不接收点击（避免两条输入路径打架）。 */
export function positionPadAcceptsHitTesting(isCoordinateEditing: boolean): boolean {
  return !isCoordinateEditing
}

// ---------------------------------------------------------------- 区域名标签

/** Swift L225：区域名字号 22（比读数大得多，它是这个紧凑布局的主视觉）。 */
export const POSITION_REGION_FONT_SIZE = 22

/** Swift L227：标签固定高度 28，配合 `clipped()` 做上下滑入。 */
export const POSITION_REGION_LABEL_HEIGHT = 28

/** Swift L221-222：进出位移 ±16。 */
export const POSITION_REGION_TRANSITION_OFFSET = 16

/**
 * Swift L219-223：区域名的滑入滑出 —— 进入从下 16 淡入，退出向上 16 淡出。
 *
 * 方向相反是刻意的：新名字从下方顶上来，旧名字向上走掉，视觉上是「滚动」，
 * 和三分法/居中的空间顺序（下 → 上）一致。
 *
 * 两个方向的**起点都是完全透明**，差别只在偏移量的符号：
 * 进入的隐藏态在 +16（下方），退出的隐藏态在 −16（上方）。
 */
export function positionPadRegionTransition(phase: 'insertion' | 'removal'): {
  readonly opacity: number
  readonly offsetY: number
} {
  return {
    opacity: 0,
    offsetY: phase === 'insertion' ? POSITION_REGION_TRANSITION_OFFSET : -POSITION_REGION_TRANSITION_OFFSET,
  }
}

/** Swift L219-223：区域名的可见态（进入的终点 / 退出的起点）。 */
export const POSITION_REGION_VISIBLE_STATE = { opacity: 1, offsetY: 0 } as const

/** Swift L229：区域名切换用 `spring(response: 0.45, dampingFraction: 0.8)`。 */
export const POSITION_REGION_ANIMATION = { response: 0.45, dampingFraction: 0.8 } as const

// ---------------------------------------------------------------- 事务包装

/**
 * Swift L264-266：两种使用方式。
 *
 * 持久化域（画布/相机样式）走 `EditorTransactionalPositionPad`，它把连续交互
 * 包进 store 的事务里；动画与叠加层检查器用「草稿所有者」模式，直接用裸的
 * `EditorPositionPad`。
 *
 * 判据是「改动是否需要进 undo 栈」——持久化样式改了要能撤销，动画草稿不进。
 */
export function positionPadUsesTransaction(isPersistentStyleDomain: boolean): boolean {
  return isPersistentStyleDomain
}

/**
 * Swift L298-301：每次改点之前先开一个连续交互。
 *
 * `beginContinuousInteraction` 是幂等的（返回 Bool 表示是否新开），
 * 所以拖动过程中的每一次变更都调它也不会产生一堆事务。
 */
export function positionPadBeginsInteractionOnEveryChange(): boolean {
  return true
}

/**
 * Swift L316-318：取消时两道校验。
 *
 * 先比 `commandScope`，再（若有 selection）比 selection —— 两者都不匹配就不取消。
 * 少了第二道，用户在 A 片段的位置盘上按下 Esc 会把 B 片段的交互取消掉。
 */
export function positionPadCanCancel(input: {
  readonly interactionCommandScope: string | null
  readonly commandScope: string
  readonly interactionSelection: string | null
  readonly selection: string | null
}): boolean {
  if (input.interactionCommandScope !== input.commandScope) return false
  if (input.selection !== null && input.interactionSelection !== input.selection) return false
  return true
}

/**
 * Swift L75 / L83 / L86：X / Y 读数的无障碍标题与显示格式。
 *
 * 显示用百分比（`EditorSliderValueFormat.percent`），输入也用百分比 ——
 * 归一化坐标对用户没有意义，「37%」才是他能理解的。
 */
export function positionPadAccessibilityTitle(axis: 'X' | 'Y', title: string): string {
  return `${title} ${axis} 坐标`
}

/** Swift L78 / L86：把归一化值格式化成百分比文本（整数百分比）。 */
export function positionPadPercentText(value: number): string {
  const percent = Math.round(positionPadClamp01(value) * 100)
  return `${percent}%`
}
