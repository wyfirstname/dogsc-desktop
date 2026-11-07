/**
 * 检查器动效 —— 页面到达/离开的时钟、子页滑动、滚动标题、画布读数 HUD。
 *
 * Swift source: Sources/DogSCApp/EditorInspectorMotion.swift（351 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - ConsoleRevealKey / EnvironmentValues.consoleReveal           L5-17
 *   - Animation.consoleReveal（0.62 / 0.82）                       L19-22
 *   - ConsoleRevealModifier（40 / 0.96 / 900 归一化 × 0.3）         L26-50
 *   - enum EditorPageTiming（outgoing = 0.14）                     L59-61
 *   - ConsoleDropModifier（26 / 0.985）                            L64-73
 *   - AnyTransition.consolePage（timingCurve 0.5,0,0.9,0.5）       L75-87
 *   - EditorSubpagePhase / editorSubpage(edge:)                    L93-127
 *   - ConsolePageArrival（14 / 0.42 / 0.86）                       L132-151
 *   - EditorRollingTitle（size 38、height ×1.22）                  L157-173
 *   - RollingGlyph（travel ×1.1、tracking −0.03、delay 0.04+i×0.07）L175-239
 *   - EditorConsoleHUD（1.6s / 0.9s）                              L246-276
 *   - EditorConsoleHUDOverlay（20/8、18×18、28 高胶囊）             L278-350
 *     · Bracket（四角括号，半径 5）                                 L320-349
 *
 * 原注释（L10-12）：
 *   True for a moment after a page is switched to: its modules rise into
 *   place and its knobs sweep up to their values. Selecting something else
 *   inside the same page never replays it.
 *
 * 原注释（L20）：A little life on arrival, settled well within half a second.
 *
 * 原注释（L24-25）：
 *   Modules assemble when a page arrives: each rises from below, later ones
 *   a beat after earlier ones (ordered by where they sit in the page).
 *
 * 原注释（L43-44）：
 *   Start once the outgoing page has left (see consolePage), so the two pages
 *   never show through each other.
 *
 * 原注释（L56-58）：
 *   One clock for a page change: the outgoing page is fully gone before the
 *   incoming one starts to appear. Overlapping two half-transparent pages
 *   read as a rendering fault, not as motion.
 *
 * 原注释（L89-92）：
 *   A sub-page inside a section (wallpaper / grid / motion / custom): the
 *   outgoing one slides out toward the side it came from and is gone before
 *   the incoming one slides in from the chosen side and settles with a little
 *   spring — the same "leave first, then arrive" clock as a page change.
 *
 * 原注释（L129-131）：
 *   The incoming page as a whole waits for the outgoing one, then rises in.
 *   Loose items (notes, buttons) arrive with it; sections additionally
 *   assemble one after another when the task itself changed.
 *
 * 原注释（L155-156）：
 *   A page name whose characters roll up and out, then the new ones roll in,
 *   one after another.
 *
 * 原注释（L193-195）：
 *   Only the current glyph determines its advance. A transparent old glyph
 *   must not keep a wider Chinese character's layout in English.
 *
 * 原注释（L243-245）：
 *   While a knob, slider or curve node is being moved, the canvas itself says
 *   what is changing: the frame corners draw in and a small readout appears.
 *   The inspector controls post here; the stage draws it.
 *
 * 原注释（L264-265）：
 *   The gesture ended: keep the readout a moment so the final value can be
 *   read, then let it go.
 *
 * 迁移说明：`ViewModifier` / `AnyTransition` → 纯函数，返回「起始态 / 终止态
 * + 动画参数」这种可被 CSS transition 或 requestAnimationFrame 直接消费的描述。
 * 保留的四条时钟规则：
 *   1) 出场 0.14s 必须**先完成**，入场动画统一带 0.12 的延迟；
 *   2) 子页出场距离是入场距离的 18/26 —— 进来得多、出去得少；
 *   3) 滚动标题的每个字按索引错开 0.07s；
 *   4) 减弱动态时全部退化成瞬时（HUD 例外：它只是不缩放，仍要淡出）。
 */

import { springAnimation, type EditorAnimation } from './EditorDesignTokens'

// ---------------------------------------------------------------- 页面时钟

/**
 * Swift L59-61：整套页面切换唯一的时钟。
 *
 * 0.14 秒是「出去的那一页完全消失」所需的时间。所有「进来」的动作
 * 都用 `0.14 − 0.02 = 0.12` 作为延迟，留 0.02 秒的空档防止视觉粘连。
 */
export const EDITOR_PAGE_OUTGOING = 0.14

/** Swift L119、L142：入场延迟 = outgoing − 0.02。 */
export const EDITOR_PAGE_INCOMING_DELAY = EDITOR_PAGE_OUTGOING - 0.02

/**
 * Swift L21：`Animation.consoleReveal`。
 *
 * response 0.62、阻尼 0.82 —— 比录制器的 morph（0.5 / 0.82）更慢一点，
 * 因为检查器模块的位移距离更大（40pt）。
 */
export const CONSOLE_REVEAL_SPRING = { response: 0.62, dampingFraction: 0.82 } as const

// ---------------------------------------------------------------- 模块进场

/**
 * Swift L32-36：一个模块「还没出现」时的样子。
 *
 * 三个量必须同时生效：完全透明、下移 40、缩到 0.96 且锚点在上缘。
 * 锚点是 top 而不是 center，这样模块是「从下面升起」而不是「从中心胀开」。
 */
export const CONSOLE_REVEAL_OFFSET_Y = 40
export const CONSOLE_REVEAL_SCALE = 0.96
export const CONSOLE_REVEAL_ANCHOR = 'top' as const

/**
 * Swift L45：延迟归一化的两个端点。
 *
 * `min(max(minY, 0), 900)` 把模块在滚动容器里的纵坐标夹到 0..900，
 * 再除以 900 得到 0..1，最后乘 0.3 —— 越靠下的模块越晚动，
 * 但最多只多等 0.3 秒。900 大致是三屏的高度，超过三屏的偏移不再加速。
 */
export const CONSOLE_REVEAL_DISTANCE_CAP = 900
export const CONSOLE_REVEAL_MAX_EXTRA_DELAY = 0.3

/**
 * Swift L45：单个模块的入场延迟。
 *
 * 例：`minY = 0` → 0.14；`minY = 450` → 0.14 + 0.15 = 0.29；
 * `minY = 900` 及以上 → 0.44。
 */
export function consoleRevealDelay(minY: number): number {
  const clamped = Math.min(Math.max(minY, 0), CONSOLE_REVEAL_DISTANCE_CAP)
  return EDITOR_PAGE_OUTGOING + (clamped / CONSOLE_REVEAL_DISTANCE_CAP) * CONSOLE_REVEAL_MAX_EXTRA_DELAY
}

/**
 * Swift L32：是否处于「隐藏」态。
 *
 * 三条件缺一不可：这一页刚被切过来（`reveals`）、本模块还没出现过
 * （`!shown`）、且没有开启减弱动态。
 */
export function consoleRevealHidden(reveals: boolean, shown: boolean, reduces: boolean): boolean {
  return reveals && !shown && !reduces
}

/** Swift L33-36：隐藏态下的样式。 */
export function consoleRevealStyle(hidden: boolean): { opacity: number; offsetY: number; scale: number } {
  return hidden
    ? { opacity: 0, offsetY: CONSOLE_REVEAL_OFFSET_Y, scale: CONSOLE_REVEAL_SCALE }
    : { opacity: 1, offsetY: 0, scale: 1 }
}

/** Swift L46：入场动画 = 0.62/0.82 的弹簧 + 上面算出的延迟。 */
export function consoleRevealAnimation(minY: number, reduces: boolean): (EditorAnimation & { delay?: number }) | null {
  if (reduces) return null
  return { ...springAnimation(CONSOLE_REVEAL_SPRING), delay: consoleRevealDelay(minY) }
}

// ---------------------------------------------------------------- 页面离开

/**
 * Swift L64-72：离开的那一页怎么掉下去。
 *
 * 透明、下移 26、缩到 0.985，锚点同样在上缘。
 */
export const CONSOLE_DROP_OFFSET_Y = 26
export const CONSOLE_DROP_SCALE = 0.985

/** Swift L84：加速下落曲线。`timingCurve(0.5, 0, 0.9, 0.5)` —— 起步慢、收尾快。 */
export const CONSOLE_DROP_TIMING_CURVE = [0.5, 0, 0.9, 0.5] as const

/** Swift L66-71：离开态的样式。 */
export function consoleDropStyle(dropped: boolean): { opacity: number; offsetY: number; scale: number } {
  return dropped
    ? { opacity: 0, offsetY: CONSOLE_DROP_OFFSET_Y, scale: CONSOLE_DROP_SCALE }
    : { opacity: 1, offsetY: 0, scale: 1 }
}

/**
 * Swift L76-87：`consolePage` 是不对称过渡。
 *
 * 入场是 `identity` —— 新页面由 `ConsolePageArrival` 自己负责升起，
 * 过渡本身不做任何事；只有出场带动作。这样两套动画不会叠加成
 * 「又淡又滑」的糊状。
 */
export interface PageTransitionSpec {
  readonly insertion: 'identity' | 'spring'
  readonly removal: 'drop' | 'opacity'
  readonly removalDuration: number
}

export function consolePageTransition(reduces: boolean): PageTransitionSpec {
  if (reduces) return { insertion: 'identity', removal: 'opacity', removalDuration: 0 }
  return { insertion: 'identity', removal: 'drop', removalDuration: EDITOR_PAGE_OUTGOING }
}

// ---------------------------------------------------------------- 子页滑动

/** 子页可以从四个方向进来。 */
export type EditorSubpageEdge = 'leading' | 'trailing' | 'top' | 'bottom'

/**
 * Swift L106-111：入场位移。
 *
 * 左右 26、上下 14 —— 水平方向的距离明显大于垂直方向，
 * 因为侧滑需要「划过一整块面板」的观感，而升降只需要一点提示。
 */
export function editorSubpageIncomingOffset(edge: EditorSubpageEdge): { width: number; height: number } {
  switch (edge) {
    case 'leading':
      return { width: -26, height: 0 }
    case 'trailing':
      return { width: 26, height: 0 }
    case 'top':
      return { width: 0, height: -14 }
    case 'bottom':
    default:
      return { width: 0, height: 14 }
  }
}

/**
 * Swift L112-113：出场位移 = 入场位移取反后乘 18/26。
 *
 * 这个比例是「退出去得比进来得少」的实现方式：进来 26，出去只有 18。
 * 垂直方向套用同一个比例（14 × 18/26 ≈ 9.69），不是另取一个数。
 */
export const EDITOR_SUBPAGE_OUTGOING_RATIO = 18 / 26

export function editorSubpageOutgoingOffset(edge: EditorSubpageEdge): { width: number; height: number } {
  const incoming = editorSubpageIncomingOffset(edge)
  return {
    width: (-incoming.width * EDITOR_SUBPAGE_OUTGOING_RATIO),
    height: (-incoming.height * EDITOR_SUBPAGE_OUTGOING_RATIO),
  }
}

/** Swift L116-119：入场弹簧 0.4 / 0.84，延迟与页面一致（0.12）。 */
export const EDITOR_SUBPAGE_SPRING = { response: 0.4, dampingFraction: 0.84 } as const

/** Swift L116：子页的透明度与缩放端点。 */
export const EDITOR_SUBPAGE_OPACITY = 0
export const EDITOR_SUBPAGE_SCALE = 0.985

/** Swift L114-125：子页过渡的完整描述。 */
export interface SubpageTransitionSpec {
  readonly insertionOffset: { width: number; height: number }
  readonly removalOffset: { width: number; height: number }
  readonly inactiveOpacity: number
  readonly inactiveScale: number
  readonly insertionAnimation: (EditorAnimation & { delay?: number }) | null
  readonly removalAnimation: (EditorAnimation & { delay?: number }) | null
}

export function editorSubpageTransition(edge: EditorSubpageEdge, reduces: boolean): SubpageTransitionSpec {
  const insertionOffset = editorSubpageIncomingOffset(edge)
  const removalOffset = editorSubpageOutgoingOffset(edge)
  if (reduces) {
    return {
      insertionOffset: { width: 0, height: 0 },
      removalOffset: { width: 0, height: 0 },
      inactiveOpacity: EDITOR_SUBPAGE_OPACITY,
      inactiveScale: 1,
      insertionAnimation: null,
      removalAnimation: null,
    }
  }
  return {
    insertionOffset,
    removalOffset,
    inactiveOpacity: EDITOR_SUBPAGE_OPACITY,
    inactiveScale: EDITOR_SUBPAGE_SCALE,
    insertionAnimation: { ...springAnimation(EDITOR_SUBPAGE_SPRING), delay: EDITOR_PAGE_INCOMING_DELAY },
    removalAnimation: { kind: 'easeOut', duration: EDITOR_PAGE_OUTGOING },
  }
}

// ---------------------------------------------------------------- 整页到达

/**
 * Swift L132-151：进来的那一页整体升起。
 *
 * 位移只有 14（比模块的 40 小得多），因为整页升起只是「落位」，
 * 真正的层次感由各模块自己的 40 提供。
 */
export const CONSOLE_PAGE_ARRIVAL_OFFSET_Y = 14
export const CONSOLE_PAGE_ARRIVAL_SPRING = { response: 0.42, dampingFraction: 0.86 } as const

/** Swift L136：隐藏态判定 —— 整页不依赖 `reveals`，只依赖 `shown`。 */
export function consolePageArrivalHidden(shown: boolean, reduces: boolean): boolean {
  return !shown && !reduces
}

/** Swift L137-139：整页到达的样式。 */
export function consolePageArrivalStyle(hidden: boolean): { opacity: number; offsetY: number } {
  return hidden ? { opacity: 0, offsetY: CONSOLE_PAGE_ARRIVAL_OFFSET_Y } : { opacity: 1, offsetY: 0 }
}

// ---------------------------------------------------------------- 滚动标题

/**
 * Swift L159-167：标题默认 38pt，容器高 = size × 1.22。
 *
 * 1.22 是给上下留出的裁剪余量：字形上移/下移都会超出基线盒，
 * 容器不留余量就会把「正在滚出去的那个字」切掉一半。
 */
export const EDITOR_ROLLING_TITLE_SIZE = 38
export const EDITOR_ROLLING_TITLE_HEIGHT_RATIO = 1.22

/** Swift L235：字距 = −size × 0.03（大字号要收紧，否则字间像散开）。 */
export const EDITOR_ROLLING_TITLE_TRACKING_RATIO = -0.03

/** Swift L167：容器高度。 */
export function editorRollingTitleHeight(size = EDITOR_ROLLING_TITLE_SIZE): number {
  return size * EDITOR_ROLLING_TITLE_HEIGHT_RATIO
}

/** Swift L192：单个字形滚动行程 = size × 1.1。 */
export const EDITOR_ROLLING_GLYPH_TRAVEL_RATIO = 1.1

/** Swift L192：行程。 */
export function editorRollingGlyphTravel(size: number): number {
  return size * EDITOR_ROLLING_GLYPH_TRAVEL_RATIO
}

/**
 * Swift L198-207：两个字形在过渡中的位置与可见度。
 *
 * 旧字：向上移 `−travel × p`，透明度 `max(0, 1 − p×3)`（p 到 1/3 就全没了），
 *       模糊 `6 × p`（越往上越糊）。
 * 新字：从下方 `travel × (1 − p)` 升到 0，透明度 `min(1, p×2.4)`，
 *       模糊 `8 × (1 − min(p,1))`（一开始最糊）。
 *
 * 注意两者用的淡出速度不同：旧字 3 倍速退场、新字 2.4 倍速进场，
 * 这样中点附近总有一层是半透明的，不会出现「两个字同时清楚」的瞬间。
 */
export interface RollingGlyphPhase {
  readonly offsetY: number
  readonly opacity: number
  readonly blur: number
}

export function editorRollingGlyphPhases(size: number, progress: number): { previous: RollingGlyphPhase; current: RollingGlyphPhase } {
  const p = progress
  const travel = editorRollingGlyphTravel(size)
  return {
    previous: {
      offsetY: -travel * p,
      opacity: Math.max(0, 1 - p * 3),
      blur: 6 * p,
    },
    current: {
      offsetY: travel * (1 - p),
      opacity: Math.min(1, p * 2.4),
      blur: 8 * (1 - Math.min(p, 1)),
    },
  }
}

/** Swift L223：滚动弹簧 0.66 / 0.74（阻尼偏低，允许一点点回弹）。 */
export const EDITOR_ROLLING_SPRING = { response: 0.66, dampingFraction: 0.74 } as const

/** Swift L223：每个字错开 0.07 秒，外加 0.04 的统一起步延迟。 */
export const EDITOR_ROLLING_GLYPH_DELAY_BASE = 0.04
export const EDITOR_ROLLING_GLYPH_DELAY_STEP = 0.07

/** Swift L223：第 `index` 个字的延迟。 */
export function editorRollingGlyphDelay(index: number): number {
  return EDITOR_ROLLING_GLYPH_DELAY_BASE + index * EDITOR_ROLLING_GLYPH_DELAY_STEP
}

/**
 * Swift L213-228：一次字符变化的处理。
 *
 * 用 `revision` 计数防止「连续快速改名」时旧的 completion 回调
 * 把新的 `previous` 清掉 —— 只有最新那次完成才允许清空。
 * 返回 `null` 表示减弱动态：直接换字，不留旧字。
 */
export function editorRollingGlyphChange(
  previousCharacter: string,
  nextCharacter: string,
  revision: number,
  reduces: boolean,
  index = 0
): { previous: string | null; current: string; progress: number; revision: number; animation: (EditorAnimation & { delay?: number }) | null } {
  if (previousCharacter === nextCharacter) {
    return { previous: null, current: nextCharacter, progress: 1, revision, animation: null }
  }
  const nextRevision = revision + 1
  if (reduces) {
    return { previous: null, current: nextCharacter, progress: 1, revision: nextRevision, animation: null }
  }
  return {
    previous: previousCharacter,
    current: nextCharacter,
    progress: 0,
    revision: nextRevision,
    animation: { ...springAnimation(EDITOR_ROLLING_SPRING), delay: editorRollingGlyphDelay(index) },
  }
}

// ---------------------------------------------------------------- HUD

/**
 * Swift L246-276：画布上的数值读数。
 *
 * 手势进行中每次更新都把隐藏计时重置到 1.6 秒；手势结束时缩短到 0.9 秒 ——
 * 松手之后读数要尽快让位给画面。
 */
export const EDITOR_CONSOLE_HUD_HOLD_SECONDS = 1.6
export const EDITOR_CONSOLE_HUD_RELEASE_SECONDS = 0.9

/** HUD 的三块状态。用来替代 `@Published`。 */
export interface EditorConsoleHUDState {
  readonly label: string
  readonly value: string
  readonly isActive: boolean
}

/** 初始态。 */
export const EDITOR_CONSOLE_HUD_IDLE: EditorConsoleHUDState = { label: '', value: '', isActive: false }

/**
 * Swift L255-262：`show(title:text:)` / `show(label:value:)`。
 *
 * 两个入口做的是同一件事 —— 第一个只是把参数顺序换成「标题 / 文本」，
 * 因为调用点的语义不同（有的是「哪个旋钮」，有的是「哪一行」）。
 */
export function editorConsoleHUDShow(label: string, value: string): { state: EditorConsoleHUDState; hideAfter: number } {
  return { state: { label, value, isActive: true }, hideAfter: EDITOR_CONSOLE_HUD_HOLD_SECONDS }
}

/** Swift L266：手势结束。 */
export function editorConsoleHUDRelease(): { hideAfter: number } {
  return { hideAfter: EDITOR_CONSOLE_HUD_RELEASE_SECONDS }
}

/** Swift L273：隐藏 —— 只翻 `isActive`，保留最后的值（下次出现时先显示旧值再跳变会闪）。 */
export function editorConsoleHUDHide(state: EditorConsoleHUDState): EditorConsoleHUDState {
  return { ...state, isActive: false }
}

/**
 * Swift L284：四角括号的内缩。
 *
 * 激活时缩到 20（括住画面内部），静止时缩到 8（贴着边缘）。
 * 所以「激活」在视觉上是括号**往内收**——这就是「画面被聚焦」的信号。
 */
export const EDITOR_CONSOLE_HUD_INSET_ACTIVE = 20
export const EDITOR_CONSOLE_HUD_INSET_IDLE = 8

/** Swift L284：当前内缩。 */
export function editorConsoleHUDInset(isActive: boolean): number {
  return isActive ? EDITOR_CONSOLE_HUD_INSET_ACTIVE : EDITOR_CONSOLE_HUD_INSET_IDLE
}

/** Swift L289-290：每个括号 18×18，描边 2.2，圆角接头。 */
export const EDITOR_CONSOLE_HUD_BRACKET_SIZE = 18
export const EDITOR_CONSOLE_HUD_BRACKET_LINE_WIDTH = 2.2
export const EDITOR_CONSOLE_HUD_BRACKET_RADIUS = 5

/** Swift L290：括号的投影。 */
export const EDITOR_CONSOLE_HUD_BRACKET_SHADOW_ALPHA = 0.45
export const EDITOR_CONSOLE_HUD_BRACKET_SHADOW_RADIUS = 2

/** Swift L292-293：括号中心点。 */
export function editorConsoleHUDCornerPosition(
  corner: number,
  size: { width: number; height: number },
  isActive: boolean
): { x: number; y: number } {
  const inset = editorConsoleHUDInset(isActive)
  const offset = inset + EDITOR_CONSOLE_HUD_BRACKET_SIZE / 2
  return {
    x: corner % 2 === 0 ? offset : size.width - offset,
    y: corner < 2 ? offset : size.height - offset,
  }
}

/** Swift L305-311：读数胶囊。 */
export const EDITOR_CONSOLE_HUD_CAPSULE_HEIGHT = 28
export const EDITOR_CONSOLE_HUD_CAPSULE_PADDING = 12
export const EDITOR_CONSOLE_HUD_LABEL_SPACING = 7
export const EDITOR_CONSOLE_HUD_BACKGROUND_ALPHA = 0.58
export const EDITOR_CONSOLE_HUD_LABEL_OPACITY = 0.78
export const EDITOR_CONSOLE_HUD_FONT_SIZE = 12

/** Swift L308-309：胶囊位置（相对左下角）。 */
export function editorConsoleHUDCapsuleOffset(isActive: boolean): { leading: number; bottom: number } {
  const inset = editorConsoleHUDInset(isActive)
  return { leading: inset + 4, bottom: inset + 2 }
}

/** Swift L311：未激活时再往下沉 6pt（淡出时有一点「落下去」的感觉）。 */
export const EDITOR_CONSOLE_HUD_HIDDEN_OFFSET_Y = 6

/** Swift L310-311：胶囊的透明度与纵偏移。 */
export function editorConsoleHUDStyle(isActive: boolean): { opacity: number; offsetY: number } {
  return isActive
    ? { opacity: 1, offsetY: 0 }
    : { opacity: 0, offsetY: EDITOR_CONSOLE_HUD_HIDDEN_OFFSET_Y }
}

/** Swift L314：HUD 的弹簧 0.42 / 0.8。 */
export const EDITOR_CONSOLE_HUD_SPRING = { response: 0.42, dampingFraction: 0.8 } as const

/** Swift L314：动画（减弱动态时为 null）。 */
export function editorConsoleHUDAnimation(reduces: boolean): EditorAnimation | null {
  return reduces ? null : springAnimation(EDITOR_CONSOLE_HUD_SPRING)
}

/** Swift L320-349：一个括号的路径 —— 圆角 5，向内的那一侧开口。 */
export interface BracketCommand {
  readonly op: 'M' | 'L' | 'Q'
  readonly points: readonly (readonly [number, number])[]
}

export function editorConsoleHUDBracketPath(corner: number, size: number): BracketCommand[] {
  const r = EDITOR_CONSOLE_HUD_BRACKET_RADIUS
  switch (corner) {
    case 0:
      return [
        { op: 'M', points: [[0, size]] },
        { op: 'L', points: [[0, r]] },
        { op: 'Q', points: [[0, 0], [r, 0]] },
        { op: 'L', points: [[size, 0]] },
      ]
    case 1:
      return [
        { op: 'M', points: [[0, 0]] },
        { op: 'L', points: [[size - r, 0]] },
        { op: 'Q', points: [[size, 0], [size, r]] },
        { op: 'L', points: [[size, size]] },
      ]
    case 2:
      return [
        { op: 'M', points: [[0, 0]] },
        { op: 'L', points: [[0, size - r]] },
        { op: 'Q', points: [[0, size], [r, size]] },
        { op: 'L', points: [[size, size]] },
      ]
    default:
      return [
        { op: 'M', points: [[0, size]] },
        { op: 'L', points: [[size - r, size]] },
        { op: 'Q', points: [[size, size], [size, size - r]] },
        { op: 'L', points: [[size, 0]] },
      ]
  }
}
