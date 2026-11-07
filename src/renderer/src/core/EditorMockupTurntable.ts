/**
 * EditorMockupTurntable —— 样机转盘（拖动旋转、松手吸附到最近卡片）。
 *
 * Swift source: Sources/DogSCApp/EditorMockupTurntable.swift（189 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L7-18    struct EditorMockupTurntable（8 个字段 + 6 个 @State）
 *   L19-20   常量 cardWidth = 142 / pointsPerCard = 78
 *   L22-27   count / selectedIndex
 *   L29-92   body（转盘 + 名称 + 圆点指示器 + 三次 onAppear/onChange）
 *   L94-96   settleSpring（降低动态效果时为 nil）
 *   L98-100  wrapped —— 环绕到 [-count/2, count/2)
 *   L102-106 settle(at:)
 *   L108-120 spin 手势（拖动 + 预测端点 * 0.55）
 *   L122-150 card(index:style:) —— 圆形排布的投影
 *   L152-164 arrow
 *   L167-171 Array[safe:]
 *   L173-189 ScreenFrameStyle.turntableName
 *
 * 迁移说明：
 *   SwiftUI 的 `rotation3DEffect` / `scaleEffect` 在 Electron 里由 CSS
 *   `transform: perspective() rotateY() scale()` 承担。这里保留的纯逻辑是：
 *     1. 环绕函数 `wrapped` —— 它决定了「从最后一张往前拨一格」是 +1 而不是
 *        -(n-1)
 *     2. 卡片在圆环上的投影：角度、朝向余弦、缩放、水平偏移、透明度、亮度、
 *        z 序、可点击阈值
 *     3. 拖拽与预测端点的取值（含 0.55 的惯性折扣）
 *     4. 吸附目标的取整与取模（负数也要正回来）
 *     5. 九种框的显示名
 */

/** Swift L19-20 / L42 / L72：转盘的尺寸常量。 */
export const MOCKUP_TURNTABLE_CARD_WIDTH = 142
export const MOCKUP_TURNTABLE_POINTS_PER_CARD = 78
export const MOCKUP_TURNTABLE_VIEW_HEIGHT = 118
export const MOCKUP_TURNTABLE_INDICATOR_SELECTED_WIDTH = 18
export const MOCKUP_TURNTABLE_INDICATOR_WIDTH = 5
export const MOCKUP_TURNTABLE_INDICATOR_HEIGHT = 5

/** Swift L117：松手时只认 55% 的预测位移。 */
export const MOCKUP_TURNTABLE_MOMENTUM = 0.55

/** Swift L112：拖动最小距离 3 点才认成旋转手势。 */
export const MOCKUP_TURNTABLE_MINIMUM_DRAG = 3

/** Swift L140：朝向余弦大于 0.2 才可点击。 */
export const MOCKUP_TURNTABLE_HIT_THRESHOLD = 0.2

/** Swift L22：`Double(max(styles.count, 1))` —— 空数组也不能除以 0。 */
export function mockupTurntableCount(styleCount: number): number {
  return Math.max(styleCount, 1)
}

/**
 * Swift `Double.rounded()` 的默认规则是 **toNearestOrAwayFromZero**（不是
 * 银行家舍入）。`Math.round` 在负数上偏离这个规则：`Math.round(-3.5) === -3`，
 * 而 Swift 给 -4。转盘角度会变负（往左拨过头），所以必须显式实现。
 */
export function mockupTurntableRounded(value: number): number {
  if (!Number.isFinite(value)) return value
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5)
}

/**
 * Swift L98-100：`value - count * (value / count).rounded()`。
 *
 * 这不是普通的取模 —— 它把任意角度环绕到 `[-count/2, count/2]`，于是
 * 「当前在 0，点了最后一张」得到 -1（往左拨一格），而不是 +(n-1)。
 *
 * 边界行为值得记住：`wrapped(3, 6)` → 商 0.5 → 远离零取整为 1 → **-3**。
 * 也就是说正中对面那一格一律往左归。
 */
export function wrappedTurntableOffset(value: number, count: number): number {
  const safeCount = mockupTurntableCount(count)
  return value - safeCount * mockupTurntableRounded(value / safeCount)
}

/**
 * Swift L24-27：当前选中的卡片下标。
 *
 * 三层折返：
 *   1. `styles.firstIndex(of: selected)` —— 通常命中
 *   2. 没命中但 `selected.isDeviceFrame` → 退到 `devicePhone` 的下标
 *      （旧项目的 `deviceTabletPortrait` 等朝向值与 `devicePhone` 共用一张卡）
 *   3. 还是没有 → 0
 */
export function mockupTurntableSelectedIndex(input: {
  readonly styles: readonly string[]
  readonly selected: string
  readonly selectedIsDeviceFrame: boolean
  readonly fallbackDeviceStyle: string
}): number {
  const direct = input.styles.indexOf(input.selected)
  if (direct >= 0) return direct
  if (input.selectedIsDeviceFrame) {
    const device = input.styles.indexOf(input.fallbackDeviceStyle)
    if (device >= 0) return device
  }
  return 0
}

/**
 * Swift L102-106：吸附到某个整数角度，并据此决定要不要回调。
 *
 * 取模那一步写成 `((i % n) + n) % n` —— 因为 target 可能为负（往左拨过头）。
 * JS 的 `%` 对负数返回负数，必须再补一次。
 */
export function mockupTurntableSettle(input: {
  readonly target: number
  readonly styleCount: number
  readonly selectedIndex: number
}): {
  readonly rotation: number
  readonly index: number
  readonly changesSelection: boolean
} {
  const count = mockupTurntableCount(input.styleCount)
  const rounded = mockupTurntableRounded(input.target)
  const index = ((rounded % count) + count) % count
  return {
    rotation: input.target,
    index,
    changesSelection: index !== input.selectedIndex,
  }
}

/**
 * Swift L36-38 / L50：左右箭头与方向键的目标角度。
 *
 * 左箭头是 `(rotation - 1).rounded()`，右箭头是 `(rotation + 1).rounded()`。
 * 先加减再取整，所以拖到 3.4 时按右箭头会跳到 4，而不是 4.4。
 */
export function mockupTurntableArrowTarget(
  rotation: number,
  direction: -1 | 1
): number {
  return mockupTurntableRounded(rotation + direction)
}

/**
 * Swift L110-113：拖拽过程中的角度。
 *
 * `rotation = (dragStart ?? 0) - translation / pointsPerCard`
 *
 * 符号是**负**的：手指往右拖，转盘逆时针转，前面那张换成左边的卡。这与
 * 「往右滑看到左边内容」的常见手势一致。
 */
export function mockupTurntableDragRotation(input: {
  readonly dragStart: number
  readonly translationX: number
  readonly pointsPerCard?: number
}): number {
  const perCard = input.pointsPerCard ?? MOCKUP_TURNTABLE_POINTS_PER_CARD
  return input.dragStart - input.translationX / perCard
}

/**
 * Swift L115-119：松手时的预测终点。
 *
 * `base - predictedEndTranslation / pointsPerCard * 0.55`
 *
 * 用的是 `predictedEndTranslation`（系统预测的手指最终位置），不是
 * `translation`。乘 0.55 是为了「再滑一点就停」的手感 —— 满打满算跟着预测
 * 走会甩过头好几张。
 */
export function mockupTurntableProjectedRotation(input: {
  readonly base: number
  readonly predictedEndTranslationX: number
  readonly pointsPerCard?: number
  readonly momentum?: number
}): number {
  const perCard = input.pointsPerCard ?? MOCKUP_TURNTABLE_POINTS_PER_CARD
  const momentum = input.momentum ?? MOCKUP_TURNTABLE_MOMENTUM
  return input.base - (input.predictedEndTranslationX / perCard) * momentum
}

/**
 * Swift L122-140：一张卡在圆环上的投影。
 *
 * 六个量的推导：
 *   offset  = wrapped(index - rotation)        环绕后的相对位置
 *   angle   = offset * 360 / count             每格占圆周的多少度
 *   facing  = cos(angle)                       朝向：1 = 正对，-1 = 背面
 *   scale   = 0.72 + 0.28 * max(facing, 0)     背面最小 0.72
 *   offsetX = sin(angle) * cardWidth * 0.98 * 0.78
 *   opacity = clamp(facing * 1.25 + 0.05, 0, 1)
 *   bright  = -0.25 * (1 - max(facing, 0))     背面压暗
 *   zIndex  = facing
 *   hitTest = facing > 0.2
 *
 * `isFront = abs(offset) < 0.5` 才是「前排」—— 注意它与 `facing` 不是同一件事：
 * 一张卡可能 facing 为正却不在前排（比如 count=3 时 offset=0.4）。
 */
export interface MockupTurntableCardProjection {
  readonly offset: number
  readonly angle: number
  readonly radians: number
  readonly facing: number
  readonly isFront: boolean
  readonly scale: number
  readonly offsetX: number
  readonly opacity: number
  readonly brightness: number
  readonly zIndex: number
  readonly hitTestable: boolean
  /** Swift L135：`rotation3DEffect(.degrees(-angle * 0.8), perspective: 0.5)`。 */
  readonly rotationYDegrees: number
  readonly perspective: number
  /** Swift L128：旋转半径。 */
  readonly radius: number
}

export function mockupTurntableCardProjection(input: {
  readonly index: number
  readonly rotation: number
  readonly styleCount: number
  readonly cardWidth?: number
}): MockupTurntableCardProjection {
  const count = mockupTurntableCount(input.styleCount)
  const cardWidth = input.cardWidth ?? MOCKUP_TURNTABLE_CARD_WIDTH
  const offset = wrappedTurntableOffset(input.index - input.rotation, count)
  const angle = (offset * 360) / count
  const radians = (angle * Math.PI) / 180
  const facing = Math.cos(radians)
  const radius = cardWidth * 0.98
  return {
    offset,
    angle,
    radians,
    facing,
    isFront: Math.abs(offset) < 0.5,
    scale: 0.72 + 0.28 * Math.max(facing, 0),
    offsetX: Math.sin(radians) * radius * 0.78,
    opacity: Math.max(0, Math.min(1, facing * 1.25 + 0.05)),
    brightness: -0.25 * (1 - Math.max(facing, 0)),
    zIndex: facing,
    hitTestable: facing > MOCKUP_TURNTABLE_HIT_THRESHOLD,
    rotationYDegrees: -angle * 0.8,
    perspective: 0.5,
    radius,
  }
}

/**
 * Swift L131：前排那张卡是否显示为「已选中」。
 *
 * 条件：在前排，且（就是我选的 或 （我是 `devicePhone` 而当前选的是某个
 * 设备框））。第二条让旧项目的朝向值也能把 `devicePhone` 这张卡点亮。
 */
export function mockupTurntableCardIsSelected(input: {
  readonly isFront: boolean
  readonly style: string
  readonly selected: string
  readonly styleIsDevicePhone: boolean
  readonly selectedIsDeviceFrame: boolean
}): boolean {
  if (!input.isFront) return false
  if (input.style === input.selected) return true
  return input.styleIsDevicePhone && input.selectedIsDeviceFrame
}

/**
 * Swift L141-144：点击一张非前排卡的目标角度。
 *
 * `rotation + wrapped(index - rotation)` —— 沿**最短方向**转过去。
 * 直接写 `rotation = index` 会让「从第 1 张点第 8 张」绕一大圈。
 */
export function mockupTurntableTapTarget(input: {
  readonly index: number
  readonly rotation: number
  readonly styleCount: number
}): number {
  const count = mockupTurntableCount(input.styleCount)
  return input.rotation + wrappedTurntableOffset(input.index - input.rotation, count)
}

/**
 * Swift L78-90：两处「外部改了选中项」的反应。
 *
 * `onAppear` 只在第一次把 rotation 对齐到选中下标（`hasPlacedInitial`）。
 * `onChange` 在**拖拽中**直接跳过 —— 手指还在的时候把转盘拽走会打架；
 * 且只有在 |delta| > 0.01 时才动画（避免浮点噪声触发一次无意义弹簧）。
 */
export type MockupTurntableSyncAction =
  | 'place-initial'
  | 'skip-initial-already-placed'
  | 'skip-dragging'
  | 'skip-negligible'
  | 'animate-to-index'

export function mockupTurntableSyncAction(input: {
  readonly kind: 'appear' | 'change'
  readonly hasPlacedInitial: boolean
  readonly isDragging: boolean
  readonly changeDelta: number
}): MockupTurntableSyncAction {
  if (input.kind === 'appear') {
    return input.hasPlacedInitial ? 'skip-initial-already-placed' : 'place-initial'
  }
  if (input.isDragging) return 'skip-dragging'
  return Math.abs(input.changeDelta) > 0.01 ? 'animate-to-index' : 'skip-negligible'
}

/**
 * Swift L94-96：`RecorderMotion.reduces ? nil : .spring(response: 0.62, dampingFraction: 0.74)`。
 *
 * 降低动态效果时返回 null —— 不是缩短时长，而是彻底不做动画。转盘的
 * 3D 旋转是最容易引起眩晕的一类，这里必须完全关掉。
 */
export function mockupTurntableSettleSpring(
  reducesMotion: boolean
): { readonly response: number; readonly dampingFraction: number } | null {
  if (reducesMotion) return null
  return { response: 0.62, dampingFraction: 0.74 }
}

/**
 * Swift L173-189：九种框的转盘显示名。
 *
 * 注意 `devicePhone` 叫「自适应设备框」而不叫「手机」—— 因为它同时代表
 * `devicePhonePortrait` / `devicePhoneLandscape` 这些旧朝向值。
 */
export const MOCKUP_TURNTABLE_STYLE_NAMES: Readonly<Record<string, string>> = {
  none: '无边框',
  windowLight: 'macOS 窗口·浅色',
  windowDark: 'macOS 窗口·深色',
  browserLight: '浏览器·浅色',
  browserDark: '浏览器·深色',
  devicePhone: '自适应设备框',
  deviceTablet: '通用平板样机',
  devicePhonePortrait: '手机·竖屏',
  devicePhoneLandscape: '手机·横屏',
  deviceTabletPortrait: '平板·竖屏',
  deviceTabletLandscape: '平板·横屏',
}

/** Swift L56：`styles[safe: selectedIndex]?.turntableName ?? ""`。 */
export function mockupTurntableStyleName(style: string | undefined): string {
  if (style == null) return ''
  return MOCKUP_TURNTABLE_STYLE_NAMES[style] ?? ''
}

/** Swift L167-171：`indices.contains(index) ? self[index] : nil`。 */
export function mockupTurntableSafeGet<T>(
  values: readonly T[],
  index: number
): T | undefined {
  return index >= 0 && index < values.length ? values[index] : undefined
}

/**
 * Swift L68-75：底部圆点指示器的宽度。
 *
 * 选中的是 18×5 的胶囊，其余是 5×5 的圆点。宽度差 13 点，`HStack(spacing: 6)`
 * 会把整排撑开一点 —— 这是刻意的，让人一眼看出当前在第几张。
 */
export function mockupTurntableIndicatorWidth(isSelected: boolean): number {
  return isSelected
    ? MOCKUP_TURNTABLE_INDICATOR_SELECTED_WIDTH
    : MOCKUP_TURNTABLE_INDICATOR_WIDTH
}

/** Swift L152-164：左右箭头的可访问性标签。 */
export function mockupTurntableArrowLabel(systemName: string): string {
  return systemName.endsWith('left') ? '上一个样机' : '下一个样机'
}

/** Swift L149：卡片的帮助文本（转盘上唯一一句解释 3D 变形的话）。 */
export const MOCKUP_TURNTABLE_HELP_TEXT =
  '边框会和屏幕、光标一起缩放并进行 3D 变形'
