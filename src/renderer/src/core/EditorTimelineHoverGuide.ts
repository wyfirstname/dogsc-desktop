/**
 * 时间线悬浮参考线 —— 鼠标移动直接改图层，不重建时间线的 SwiftUI 树。
 *
 * Swift source: Sources/DogSCApp/EditorTimelineHoverGuide.swift（204 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct NativeTimelineHoverGuideView（NSViewRepresentable）  L7-33
 *   - final class NativeTimelineHoverGuideNSView                  L36-204
 *     · 引导层 1 pt、虚线 [3,4]                                    L55-56 → TIMELINE_HOVER_GUIDE_DASH
 *     · 徽标 62×18、圆角 9、描边 0.75、阴影 0.34/4/(0,2)           L59-68 → TIMELINE_HOVER_BADGE_*
 *     · 标签等宽数字、字号 9、垂直居中                              L70-78 → timelineHoverBadgeLabelFrame
 *     · configure（duration 夹到 0、重建路径、重挂滚动观察）        L86-121 → timelineHoverGuideConfigurePlan
 *     · updateBackingScale（contentsScale）                        L146-153
 *     · updateColors（线的 0.34、描边 0.18、文字 0.92）             L164-175 → TIMELINE_HOVER_GUIDE_ALPHA
 *     · updatePosition（x 夹取 / 徽标夹取 / 百分秒格式化）           L177-201 → timelineHoverGuideLayout
 *
 * 原注释（L5-6）：
 *   A passive guide above clips and below the real playhead. Mouse movement
 *   updates this view directly without rebuilding the timeline's SwiftUI tree.
 *
 * 迁移说明：`CAShapeLayer` + `NSView` → 一个绝对定位的 div；`NSScrollView` 的
 * `boundsDidChangeNotification` → 滚动容器的 `scroll` 事件。保留的纯逻辑是
 * **三处夹取**：线位置夹在 [0, width]、徽标左边界不小于可视区 +3、徽标右边界
 * 不小于左边界且不超过可视区 −65。三处都很容易写成对称形式而后各差一个像素。
 */

/** Swift L55：参考线宽 1 pt。 */
export const TIMELINE_HOVER_GUIDE_LINE_WIDTH = 1

/** Swift L56：虚线 3 实 4 空。 */
export const TIMELINE_HOVER_GUIDE_DASH: readonly number[] = [3, 4]

/** Swift L59：徽标尺寸。 */
export const TIMELINE_HOVER_BADGE_WIDTH = 62
export const TIMELINE_HOVER_BADGE_HEIGHT = 18

/** Swift L60-65：徽标圆角与阴影。 */
export const TIMELINE_HOVER_BADGE_CORNER_RADIUS = 9
export const TIMELINE_HOVER_BADGE_BORDER_WIDTH = 0.75
export const TIMELINE_HOVER_BADGE_SHADOW_OPACITY = 0.34
export const TIMELINE_HOVER_BADGE_SHADOW_RADIUS = 4
export const TIMELINE_HOVER_BADGE_SHADOW_OFFSET_Y = 2

/** Swift L70：标签字号 9、medium。 */
export const TIMELINE_HOVER_BADGE_LABEL_FONT_SIZE = 9

/** Swift L168-172：三处透明度。 */
export const TIMELINE_HOVER_GUIDE_STROKE_ALPHA = 0.34
export const TIMELINE_HOVER_GUIDE_BORDER_ALPHA = 0.18
export const TIMELINE_HOVER_GUIDE_TEXT_ALPHA = 0.92

/** Swift L191：徽标与可视区左边缘的最小间隙。 */
export const TIMELINE_HOVER_BADGE_LEADING_GAP = 3

/**
 * Swift L192：`min(visible.maxX, bounds.width) − 65`。
 *
 * 65 = 62（徽标宽） + 3（右边缘间隙）。写成 62 会让徽标贴到边界外。
 */
export const TIMELINE_HOVER_BADGE_TRAILING_INSET =
  TIMELINE_HOVER_BADGE_WIDTH + TIMELINE_HOVER_BADGE_LEADING_GAP

/** 一个矩形（可视区 / 视图边界共用）。 */
export interface TimelineHoverRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Swift L177-201 的输出。 */
export interface TimelineHoverGuideLayout {
  /** 引导线是否显示（禁用或宽度为 0 时隐藏）。 */
  readonly showsGuide: boolean
  /** 线的左边缘（已减去 0.5 让 1 pt 线落在像素中心）。 */
  readonly lineX: number
  readonly lineWidth: number
  readonly lineHeight: number
  /** 徽标左下角。 */
  readonly badgeX: number
  readonly badgeY: number
  /** 当前百分秒（用于判断是否需要重写文本）。 */
  readonly centiseconds: number
  readonly label: string
}

/** Swift L195-199 的 `String(format: "%d:%02d.%02d", …)`。 */
export function timelineHoverTimecodeLabel(centiseconds: number): string {
  const total = Math.max(centiseconds, 0)
  const minutes = Math.trunc(total / 6_000)
  const seconds = Math.trunc(total / 100) % 60
  const hundredths = total % 100
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`
}

/**
 * Swift L177-201：位置计算的全部夹取。
 *
 * 四个细节：
 *   - 输入点已经是**视口坐标**（`viewportPoint`），所以加 `visible.minX` 得到文档坐标
 *   - 线 x 夹在 `[0, bounds.width]`，然后 **减 0.5** 再铺 1 pt 宽（像素对齐）
 *   - 徽标左界 `max(visible.minX, 0) + 3`；右界 `max(min(visible.maxX, w) − 65, 左界)`
 *     —— 注意右界不小于左界，可视区极窄时徽标会贴在左界而不是被夹成负宽
 *   - 百分秒用 `floor` 而不是 `round`：时间码宁可早一帧，也不要显示尚未到达的时刻
 */
export function timelineHoverGuideLayout(input: {
  readonly isEnabled: boolean
  readonly viewportPoint: { readonly x: number; readonly y: number } | null
  readonly bounds: TimelineHoverRect
  readonly visible: TimelineHoverRect
  readonly duration: number
  readonly canvasHeight: number
  readonly badgeY: number
}): TimelineHoverGuideLayout {
  if (!input.isEnabled || input.viewportPoint == null || !(input.bounds.width > 0)) {
    return {
      showsGuide: false,
      lineX: 0,
      lineWidth: TIMELINE_HOVER_GUIDE_LINE_WIDTH,
      lineHeight: input.canvasHeight,
      badgeX: 0,
      badgeY: input.badgeY,
      centiseconds: 0,
      label: timelineHoverTimecodeLabel(0),
    }
  }
  const visible = input.visible
  const bounds = input.bounds
  const duration = Math.max(input.duration, 0)
  const x = Math.min(
    Math.max(input.viewportPoint.x + visible.x, 0),
    bounds.width
  )
  const badgeMinX = Math.max(visible.x, 0) + TIMELINE_HOVER_BADGE_LEADING_GAP
  const badgeMaxX = Math.max(
    Math.min(visible.x + visible.width, bounds.width) - TIMELINE_HOVER_BADGE_TRAILING_INSET,
    badgeMinX
  )
  const centiseconds = Math.max(
    Math.trunc((x / bounds.width) * duration * 100),
    0
  )
  return {
    showsGuide: true,
    lineX: x - 0.5,
    lineWidth: TIMELINE_HOVER_GUIDE_LINE_WIDTH,
    lineHeight: input.canvasHeight,
    badgeX: Math.min(
      Math.max(x - TIMELINE_HOVER_BADGE_WIDTH / 2, badgeMinX),
      badgeMaxX
    ),
    badgeY: input.badgeY,
    centiseconds,
    label: timelineHoverTimecodeLabel(centiseconds),
  }
}

/**
 * Swift L70-78：徽标里的标签 frame。
 *
 * `ceil(高度)` 与 `floor((18 − 高度) / 2)` 一个向上一个向下 —— 上是「不裁字」，
 * 下是「垂直居中偏上 0.5 px」。两个方向故意不同。
 */
export function timelineHoverBadgeLabelFrame(intrinsicHeight: number): TimelineHoverRect {
  const height = Math.ceil(intrinsicHeight)
  return {
    x: 0,
    y: Math.floor((TIMELINE_HOVER_BADGE_HEIGHT - height) / 2),
    width: TIMELINE_HOVER_BADGE_WIDTH,
    height,
  }
}

/** Swift L86-121：`configure` 的三件事各自是否需要动作。 */
export interface TimelineHoverGuideConfigurePlan {
  /** 观察对象换了（需要重挂 observer）。 */
  readonly rebindsLocation: boolean
  /** 画布高度变了（需要重建线路径）。 */
  readonly rebuildsPath: boolean
  /** 滚动容器换了（需要重挂滚动观察）。 */
  readonly rebindsScrollView: boolean
}

/**
 * Swift L89-119。
 *
 * 三个 `!==` 比较都是**引用**比较：`duration` / `badgeY` / `isEnabled` 是从
 * SwiftUI 传下来的值，变了不用重建任何东西（下次 `updatePosition` 自然生效），
 * 所以这里不产生动作位。
 */
export function timelineHoverGuideConfigurePlan(input: {
  readonly locationChanged: boolean
  readonly canvasHeightChanged: boolean
  readonly scrollViewChanged: boolean
}): TimelineHoverGuideConfigurePlan {
  return {
    rebindsLocation: input.locationChanged,
    rebuildsPath: input.canvasHeightChanged,
    rebindsScrollView: input.scrollViewChanged,
  }
}

/** Swift L146-153：没有窗口时按 2 倍算（Retina 默认），不是 1。 */
export function timelineHoverBackingScale(windowBackingScaleFactor: number | null): number {
  return windowBackingScaleFactor ?? 2
}

/**
 * Swift L54 / L131-134 的悬浮位置状态机。
 *
 * 只有百分秒真正变化时才重写文本 —— 一次拖运会有几百帧，每帧重设
 * `stringValue` 会让 TextField 反复走排版。
 */
export class TimelineHoverGuideState {
  private lastCentiseconds: number | null = null
  private labelValue = timelineHoverTimecodeLabel(0)

  get label(): string {
    return this.labelValue
  }

  get centisecondsValue(): number | null {
    return this.lastCentiseconds
  }

  /** 返回 true 表示文本被改写（宿主据此跳过 DOM 更新）。 */
  updateCentiseconds(centiseconds: number): boolean {
    if (centiseconds === this.lastCentiseconds) return false
    this.lastCentiseconds = centiseconds
    this.labelValue = timelineHoverTimecodeLabel(centiseconds)
    return true
  }
}
