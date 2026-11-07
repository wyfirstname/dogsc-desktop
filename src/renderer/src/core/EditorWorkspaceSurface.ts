/**
 * 编辑器工作区表面 —— 浮动岛材质、页面交接动画、点阵舞台。
 *
 * Swift source: Sources/DogSCApp/EditorWorkspaceSurface.swift（306 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorFloatingSurface（三层投影）                    L7-21  → EDITOR_FLOATING_*
 *   - struct EditorIslandEdge（0.5 外描边 + 0.5 内斜面）           L26-37 → EDITOR_ISLAND_*
 *   - struct EditorCapsuleIsland（胶囊变体，投影打七折）            L40-49 → EDITOR_CAPSULE_*
 *   - enum EditorSwapTiming（四组曲线）                           L59-71 → EDITOR_SWAP_*
 *   - func editorSwapEdge（按选项顺序定方向）                     L74-77 → editorSwapEdge
 *   - struct EditorPagePhase / EditorLabelPhase                   L82-100 → editorPageTransition*
 *   - extension AnyTransition.editorPage / editorSwap / editorLabel L102-132 → editorLabel*
 *   - struct EditorScrollEdgeFade（上 10 下 14 的遮罩）            L136-148 → EDITOR_SCROLL_EDGE_FADE_*
 *   - enum EditorChoiceStyle                                     L151-156 → EDITOR_CHOICE_*
 *   - struct EditorWorkspaceGrid（光池 + 24 点阵 + 暗角）          L162-207 → EDITOR_WORKSPACE_GRID_*
 *   - extension InspectorTab.lineIcon                            L209-221 → inspectorTabLineIcon
 *   - enum EditorWorkspaceGeometry.aspectRatio                    L225-233 → editorWorkspaceAspectRatio
 *   - struct EditorSoftRaisedButtonStyle                         L236-282 → editorSoftButton*
 *   - struct EditorStageDots（18 点阵、无光池）                    L286-306 → EDITOR_STAGE_DOTS_*
 *
 * 原注释（L4-6）：
 *   Shared material for the independent tools surrounding the video: the
 *   recorder's island. One solid shape, a machined top edge that fades toward
 *   the bottom, and a soft cast shadow. Parameter groups inside stay flat.
 *
 * 原注释（L23-25）：
 *   The recorder's top-lit rim, shared by every island shape in the editor:
 *   a hairline that defines the silhouette on any backdrop, with a lit bevel
 *   just inside it that fades toward the bottom.
 *
 * 原注释（L158-161）：
 *   A static workspace stage, outside the rendered video. Never enters export
 *   or a per-frame timeline: only size/appearance changes redraw it.
 *
 * 迁移说明：ViewModifier → CSS/内联样式对象；`AnyTransition` → 一组
 * 「进入/退出」参数（位移边、时长、曲线）。三层投影、双描边、四组曲线、
 * 两套点阵的几何全部保留成可断言的常量与函数。
 */

import { EDITOR_INTERFACE_RADIUS } from './EditorWorkspaceLayout'

// ---------------------------------------------------------------- 浮动岛

/** Swift L8：默认圆角取浮动级（20）。 */
export const EDITOR_FLOATING_CORNER_RADIUS = EDITOR_INTERFACE_RADIUS.floating

/**
 * Swift L17-19：三层投影 —— 接触影 1.5/1、柔和影 18/9、环境影 44/22。
 *
 * 三层而不是一层，是因为单一投影无法同时表达「贴着面」（1.5 半径的实线边）
 * 和「浮在空中」（44 半径的大范围灰雾）。三层叠加后近处锐、远处散，
 * 这正是 macOS 悬浮面板的观感来源。
 */
export const EDITOR_FLOATING_SHADOWS = [
  { radius: 1.5, offsetY: 1, name: 'contact' },
  { radius: 18, offsetY: 9, name: 'soft' },
  { radius: 44, offsetY: 22, name: 'ambient' },
] as const

/**
 * Swift L45-47：胶囊变体的投影 —— 半径不变但**不透明度打折**（0.75 / 0.8）。
 *
 * 胶囊岛比矩形岛小得多（一条工具条），满强度的 44 半径环境影会让它看起来
 * 像浮在雾里而不是贴在画布上。
 */
export const EDITOR_CAPSULE_SHADOWS = [
  { radius: 1.5, offsetY: 1, alpha: 1, name: 'contact' },
  { radius: 14, offsetY: 6, alpha: 0.75, name: 'soft' },
  { radius: 30, offsetY: 14, alpha: 0.8, name: 'ambient' },
] as const

/**
 * Swift L30-33：双层描边 —— 外层 0.5 实线定轮廓，内层内缩 0.5 后 1 宽的
 * 上亮下透明渐变做「机加工斜面」。
 *
 * 内层要 `inset(by: 0.5)` 才能和外层严丝合缝地并排：不内缩的话两条线会重叠，
 * 渐变的上半段会被外层的实色盖住，斜面就看不见了。
 */
export const EDITOR_ISLAND_OUTLINE_WIDTH = 0.5
export const EDITOR_ISLAND_HIGHLIGHT_INSET = 0.5
export const EDITOR_ISLAND_HIGHLIGHT_WIDTH = 1

// ---------------------------------------------------------------- 交接曲线

/**
 * Swift L62：插入曲线 `timingCurve(0.2, 0.8, 0.2, 1, duration: 0.34)`。
 *
 * 两个控制点的 y 都远高于 x（0.8 / 1 对 0.2 / 0.2），所以是强缓出：
 * 前 1/4 时间就走完 70% 的距离，剩下 3/4 时间在慢慢收尾。注释（L60-61）
 * 强调这是「交叉淡化而不是接力」—— 新内容在旧内容开始离开的同一时刻就开始到达，
 * 中间永远不会出现空帧。
 */
export const EDITOR_SWAP_INSERTION = {
  x1: 0.2,
  y1: 0.8,
  x2: 0.2,
  y2: 1,
  duration: 0.34,
} as const

/** Swift L63：移除曲线 `timingCurve(0.4, 0, 1, 1, duration: 0.18)` —— 强缓入、快走完。 */
export const EDITOR_SWAP_REMOVAL = {
  x1: 0.4,
  y1: 0,
  x2: 1,
  y2: 1,
  duration: 0.18,
} as const

/** Swift L65：原地交叉淡化 `timingCurve(0.4, 0, 0.2, 1, duration: 0.3)`（S 形）。 */
export const EDITOR_SWAP_CROSSFADE = {
  x1: 0.4,
  y1: 0,
  x2: 0.2,
  y2: 1,
  duration: 0.3,
} as const

/**
 * Swift L68-70：几何展开用 `spring(response: 0.4, dampingFraction: 0.84)`，
 * 降低动态效果时返回 null（不插值）。
 *
 * 0.84 的阻尼比刚好在「有一点回弹」和「不晃」之间：0.9 以上看起来发木，
 * 0.7 以下会明显回弹两下。
 */
export const EDITOR_SWAP_LAYOUT_SPRING = { response: 0.4, dampingFraction: 0.84 } as const

/** Swift L68-70：几何展开动画（降低动态效果时为 null）。 */
export function editorSwapLayoutAnimation(
  reducesMotion: boolean
): { readonly response: number; readonly dampingFraction: number } | null {
  return reducesMotion ? null : EDITOR_SWAP_LAYOUT_SPRING
}

/** Swift L104：降低动态效果时的替代过渡 —— 纯淡入淡出 0.16 秒。 */
export const EDITOR_PAGE_REDUCED_FADE_DURATION = 0.16

/** Swift L128-130：标签插入 `easeOut(0.24).delay(0.06)`，移除 `easeIn(0.08)`。 */
export const EDITOR_LABEL_INSERTION = { duration: 0.24, delay: 0.06 } as const
export const EDITOR_LABEL_REMOVAL_DURATION = 0.08

/** Swift L97：标签隐藏时缩到 0.9（锚点在 leading）。 */
export const EDITOR_LABEL_HIDDEN_SCALE = 0.9

/** Swift L98：标签隐藏时模糊 4。 */
export const EDITOR_LABEL_HIDDEN_BLUR = 4

// ---------------------------------------------------------------- 方向

/**
 * Swift L74-77：按选项在列表中的先后决定漂移方向。
 *
 * 用户从「第 1 项」切到「第 3 项」时新内容从右侧进来，切回时从左侧进来 ——
 * 方向和列表的阅读顺序一致，所以箭头键连续按两下会看到方向反转，
 * 这种「原路返回」的观感是这套过渡的核心。
 *
 * `firstIndex(of:) ?? 0` 的兜底不能省：选项不在列表里（动态生成的选项）时
 * 退化成「永远向前」，总比崩溃好。
 */
export function editorSwapEdge<T>(
  input: {
    readonly from: T
    readonly to: T
    readonly order: readonly T[]
    readonly vertical?: boolean
  }
): 'top' | 'bottom' | 'leading' | 'trailing' {
  const fromIndex = input.order.indexOf(input.from)
  const toIndex = input.order.indexOf(input.to)
  const forward = (toIndex === -1 ? 0 : toIndex) >= (fromIndex === -1 ? 0 : fromIndex)
  if (input.vertical === true) return forward ? 'bottom' : 'top'
  return forward ? 'trailing' : 'leading'
}

/**
 * Swift L103-112：页面交接的进入/退出参数。
 *
 * 进入时位移是 `drift`（由调用方按方向算出），退出时**不带**位移 ——
 * 旧页面原地淡出。这一处不对称是对的：两边都位移会让画面看起来在「滑走」，
 * 而这里想要的是「旧的化掉、新的浮上来」。
 */
export function editorPageTransition(
  reducesMotion: boolean
): {
  readonly reducesMotion: boolean
  readonly insertionDuration: number
  readonly removalDuration: number
  readonly insertionOffsetY: number
  readonly removalOffsetY: number
} {
  if (reducesMotion) {
    return {
      reducesMotion: true,
      insertionDuration: EDITOR_PAGE_REDUCED_FADE_DURATION,
      removalDuration: EDITOR_PAGE_REDUCED_FADE_DURATION,
      insertionOffsetY: 0,
      removalOffsetY: 0,
    }
  }
  return {
    reducesMotion: false,
    insertionDuration: EDITOR_SWAP_INSERTION.duration,
    removalDuration: EDITOR_SWAP_REMOVAL.duration,
    insertionOffsetY: 1,
    removalOffsetY: 0,
  }
}

/** Swift L82-90：页面阶段的隐藏态 —— 完全透明并偏移 `drift`。 */
export function editorPagePhase(input: {
  readonly hidden: boolean
  readonly driftX: number
  readonly driftY: number
}): { readonly opacity: number; readonly offsetX: number; readonly offsetY: number } {
  return input.hidden
    ? { opacity: 0, offsetX: input.driftX, offsetY: input.driftY }
    : { opacity: 1, offsetX: 0, offsetY: 0 }
}

/** Swift L92-100：标签阶段的隐藏态 —— 透明 + 缩到 0.9 + 模糊 4。 */
export function editorLabelPhase(hidden: boolean): {
  readonly opacity: number
  readonly scale: number
  readonly blur: number
} {
  return hidden ? { opacity: 0, scale: EDITOR_LABEL_HIDDEN_SCALE, blur: EDITOR_LABEL_HIDDEN_BLUR } : { opacity: 1, scale: 1, blur: 0 }
}

/**
 * Swift L118-122：编辑器的唯一「内容替换」过渡。
 *
 * 注释（L119-120）说得很直接：其他原地页面用的是已批准的背景页交接，
 * 不要另造一个不相关的交叉淡化。所以 `editorSwap` 直接转发到子页过渡，
 * 全编辑器只有一个替换动画，观感才统一。
 */
export function editorSwapUsesSubpageTransition(): boolean {
  return true
}

// ---------------------------------------------------------------- 滚动边缘

/**
 * Swift L137-138：内容滚到岛边缘时向上 10 / 向下 14 的渐变消隐。
 *
 * 下边比上边多 4，因为岛的下沿通常有更长的投影带 —— 遮罩太短会看到投影
 * 和内容在同一条线上被切。
 */
export const EDITOR_SCROLL_EDGE_FADE_TOP = 10
export const EDITOR_SCROLL_EDGE_FADE_BOTTOM = 14

/** Swift L142-144：两段渐变的色标顺序（上：透明→黑；下：黑→透明）。 */
export const EDITOR_SCROLL_EDGE_FADE_STOPS = ['clear→black', 'black→clear'] as const

// ---------------------------------------------------------------- 舞台点阵

/**
 * Swift L178-180：光池版点阵 —— 间距 24、起点 12、点径 1.2。
 *
 * 起点 12 = 间距的一半，所以第一列点在 x=12，最后一列后面留 12 的空隙，
 * 网格在边缘处是「半个格」，视觉上更像无限延伸而不是被裁断。
 */
export const EDITOR_WORKSPACE_GRID_SPACING = 24
export const EDITOR_WORKSPACE_GRID_ORIGIN = 12
export const EDITOR_WORKSPACE_GRID_DOT_SIZE = 1.2

/** Swift L184：浅色 0.11、深色 0.075（深色下点要更淡，否则像噪点）。 */
export const EDITOR_WORKSPACE_GRID_ALPHA_LIGHT = 0.11
export const EDITOR_WORKSPACE_GRID_ALPHA_DARK = 0.075

/** Swift L172 / L190：光池中心 (0.5, 0.42)，半径 0.62 倍最长边。 */
export const EDITOR_WORKSPACE_GRID_LIGHT_CENTER_Y = 0.42
export const EDITOR_WORKSPACE_GRID_LIGHT_RADIUS_RATIO = 0.62

/** Swift L188-193：点阵遮罩 —— 中心 (0.5, 0.45)，0.08 起 0.6 止，中间停 0.35。 */
export const EDITOR_WORKSPACE_GRID_MASK_CENTER_Y = 0.45
export const EDITOR_WORKSPACE_GRID_MASK_START_RATIO = 0.08
export const EDITOR_WORKSPACE_GRID_MASK_END_RATIO = 0.6
export const EDITOR_WORKSPACE_GRID_MASK_MID_ALPHA = 0.35

/** Swift L195-200：暗角 —— 中心 (0.5, 0.45)，0.36 起 0.85 止。 */
export const EDITOR_WORKSPACE_GRID_VIGNETTE_START_RATIO = 0.36
export const EDITOR_WORKSPACE_GRID_VIGNETTE_END_RATIO = 0.85

/**
 * Swift L290-295：纯点阵版（无光池、无暗角）—— 间距 18、点径 1.6（每边 0.8）。
 *
 * 这一版给「画布正后方」用。光池会让缩放视图里的亮度判断失准（用户以为画布
 * 变亮了），所以画布后面只有均匀的点。
 */
export const EDITOR_STAGE_DOTS_SPACING = 18
export const EDITOR_STAGE_DOTS_SIZE = 1.6
export const EDITOR_STAGE_DOTS_HALF = 0.8

/** Swift L299：浅色 0.13、深色 0.09。 */
export const EDITOR_STAGE_DOTS_ALPHA_LIGHT = 0.13
export const EDITOR_STAGE_DOTS_ALPHA_DARK = 0.09

/**
 * Swift L166-168：光池半径按「最长边」而不是宽或高算。
 *
 * 用宽会让竖屏画布的光池变成一条窄柱，用长边则总是覆盖到最远的角。
 */
export function editorWorkspaceGridReach(width: number, height: number): number {
  const w = Number.isFinite(width) ? Math.max(width, 0) : 0
  const h = Number.isFinite(height) ? Math.max(height, 0) : 0
  return Math.max(w, h)
}

/** Swift L184：按配色方案取点阵不透明度。 */
export function editorWorkspaceGridAlpha(dark: boolean): number {
  return dark ? EDITOR_WORKSPACE_GRID_ALPHA_DARK : EDITOR_WORKSPACE_GRID_ALPHA_LIGHT
}

/** Swift L299：按配色方案取纯点阵不透明度。 */
export function editorStageDotsAlpha(dark: boolean): number {
  return dark ? EDITOR_STAGE_DOTS_ALPHA_DARK : EDITOR_STAGE_DOTS_ALPHA_LIGHT
}

// ---------------------------------------------------------------- 画布比例

/**
 * Swift L225-233：工具栏与预览共用同一个比例。
 *
 * 三步：源尺寸无效 → 退回 16:9；有固定比例 → 直接用它；否则用
 * 「源比例 × 裁剪比例」，下限 0.01。
 *
 * 下限 0.01 挡的是裁剪后的极端细条（裁到 1 像素宽），否则会得到 0 或负数，
 * 后续按比例分配高度时直接除零。`max(sourceSize.height, 1)` 是第二道保险 ——
 * 宽高比计算里除数是高度。
 *
 * 注释（L223-224）解释了为什么工具栏要和预览同比例：不同比例会让宽屏上出现
 * 一条「没有人用的信箱黑边」，把工具和画布视觉上切开。
 */
export function editorWorkspaceAspectRatio(input: {
  readonly fixedAspectRatio: number | null
  readonly cropWidth: number
  readonly cropHeight: number
  readonly sourceWidth: number
  readonly sourceHeight: number
}): number {
  const sourceWidth = Number.isFinite(input.sourceWidth) ? input.sourceWidth : 0
  const sourceHeight = Number.isFinite(input.sourceHeight) ? input.sourceHeight : 0
  const usableSource = sourceWidth > 0 && sourceHeight > 0
  if (input.fixedAspectRatio !== null && Number.isFinite(input.fixedAspectRatio)) {
    return input.fixedAspectRatio
  }
  const width = usableSource ? sourceWidth : 16
  const height = usableSource ? sourceHeight : 9
  const cropWidth = Number.isFinite(input.cropWidth) && input.cropWidth > 0 ? input.cropWidth : 1
  const cropHeight = Number.isFinite(input.cropHeight) && input.cropHeight > 0 ? input.cropHeight : 1
  return Math.max((width / Math.max(height, 1)) * (cropWidth / cropHeight), 0.01)
}

// ---------------------------------------------------------------- 软按钮

/**
 * Swift L254-270：主按钮（胶囊 + 白金渐变 + 内斜面 + 按压缩影）。
 *
 * 三层叠加：渐变本体、0.5 内缩的顶部亮边（`onAccent.opacity(0.28)` → 透明）、
 * 以及按下/悬停时的深色覆盖（0.16 / 0.06 / 0）。第三层是「按下去变暗」的来源，
 * 因为胶囊的填充是渐变，改透明度会让整块变亮而不是变暗。
 */
export function editorSoftPrimaryOverlayAlpha(pressed: boolean, hovered: boolean): number {
  if (pressed) return 0.16
  return hovered ? 0.06 : 0
}

/**
 * Swift L265：主按钮的光晕 —— 悬停时完全不透明且半径 12，常态 0.55 / 7。
 *
 * 悬停时光晕变大变亮，是「这个按钮可以被点」的唯一视觉提示（主按钮没有描边）。
 */
export function editorSoftPrimaryGlowAlpha(hovered: boolean): number {
  return hovered ? 1 : 0.55
}

/** Swift L265：光晕半径 —— 悬停 12、常态 7。 */
export function editorSoftPrimaryGlowRadius(hovered: boolean): number {
  return hovered ? 12 : 7
}

/** Swift L265：光晕 y 偏移固定 3。 */
export const EDITOR_SOFT_BUTTON_GLOW_OFFSET_Y = 3

/**
 * Swift L268：次要按钮填充 —— 按下 0.15、悬停 0.13、常态 0.05。
 *
 * 写的是 `EditorStateWash.pressed + 0.05` / `hover + 0.05`，而 hover / pressed
 * 分别是 0.08 / 0.10，所以实际值是 0.13 / 0.15。常态固定 0.05 不走这个加法。
 */
export function editorSoftSecondaryFillAlpha(pressed: boolean, hovered: boolean): number {
  if (pressed) return 0.15
  return hovered ? 0.13 : 0.05
}

/** Swift L269：次要按钮描边 —— 悬停 0.08、常态 0.045，宽 0.5。 */
export function editorSoftSecondaryBorderAlpha(hovered: boolean): number {
  return hovered ? 0.08 : 0.045
}

export const EDITOR_SOFT_BUTTON_BORDER_WIDTH = 0.5

/** Swift L274：按下缩到 0.96（比引导页的 0.98 更明显 —— 这是个圆形小按钮）。 */
export const EDITOR_SOFT_BUTTON_PRESS_SCALE = 0.96

/** Swift L275：禁用时整体不透明度 0.38。 */
export const EDITOR_SOFT_BUTTON_DISABLED_OPACITY = 0.38

/** Swift L273：焦点环 —— 主按钮 0.65、次要 0.40。 */
export function editorSoftButtonFocusAlpha(primary: boolean): number {
  return primary ? 0.65 : 0.4
}

/**
 * Swift L277：禁用瞬间要清掉悬停态。
 *
 * 不是美观问题：按钮被禁用时若 `isHovered` 还是 true，样式会停在「悬停亮」
 * 的版本，用户会以为它还能点。
 */
export function editorSoftButtonForgetsHover(enabled: boolean): boolean {
  return !enabled
}

/** Swift L238-239 / L249-250：按下与悬停都要求按钮可用。 */
export function editorSoftButtonInteractionState(input: {
  readonly isEnabled: boolean
  readonly isPressed: boolean
  readonly isHovered: boolean
}): { readonly pressed: boolean; readonly hovered: boolean } {
  return {
    pressed: input.isPressed && input.isEnabled,
    hovered: input.isHovered && input.isEnabled,
  }
}

// ---------------------------------------------------------------- 检查器图标

/** Swift L209-220：六个检查器页签的手绘图标名。 */
export type InspectorTabLineIcon =
  | 'scene'
  | 'opening'
  | 'zoom'
  | 'cursorMotion'
  | 'camera'
  | 'speaker'

/**
 * Swift L211-220：页签 → 手绘图标。
 *
 * 这些是「手绘对应物」，和 `icon`（SF Symbol）并列存在 —— SF Symbol 在
 * 不同系统版本上粗细会变，而手绘图标用的是录制器自己的描边，跨版本一致。
 */
export function inspectorTabLineIcon(
  tab: 'frame' | 'opening' | 'zoom' | 'cursor' | 'camera' | 'audio'
): InspectorTabLineIcon {
  switch (tab) {
    case 'frame':
      return 'scene'
    case 'opening':
      return 'opening'
    case 'zoom':
      return 'zoom'
    case 'cursor':
      return 'cursorMotion'
    case 'camera':
      return 'camera'
    case 'audio':
      return 'speaker'
  }
}
