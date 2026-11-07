/**
 * EditorZoomViews —— 缩放焦点地图（缩略图 + 十字准星 + 可拖圆点）。
 *
 * Swift source: Sources/DogSCApp/EditorZoomViews.swift（265 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L5-22    struct ZoomFocusMap（字段 + 四个 @State）
 *   L23-87   body —— TimelineView(30 Hz，四种情况暂停) + 两个百分比输入 + 居中按钮
 *   L79-86   .task(id: thumbnailRequestID) / onDisappear 取消编辑
 *   L89-195  focusSurface —— 地图矩形、缩略图、构图参考框、十字准星、圆点
 *   L193     地图高度 = clamp(312 / max(宽高比, 0.5), 150, 200)
 *   L197-216 focusMapRect(in:) —— 按宽高比放进内缩 8 点的区域
 *   L218-223 normalizedFocus(at:in:)
 *   L225-241 开始 / 结束 / 取消编辑
 *   L243-246 isCentered（容差 0.0005）
 *   L248-250 clamp01（非有限值给 0.5）
 *   L252-255 thumbnailRequestID
 *   L257-264 loadThumbnail
 *
 * 迁移说明：
 *   这一层在 Web 侧就是一张 `<img>` 加几个绝对定位的覆盖元素。保留的纯逻辑：
 *     1. 地图矩形：按源宽高比「放进」内缩区域（先试按高度撑满，放不下再按宽度）
 *     2. 地图高度随宽高比的反比收缩，并夹在 [150, 200]
 *     3. 归一化点与像素点的双向换算（分母一律 `max(w, 1)`，防零宽）
 *     4. `clamp01` 对非有限值给 **0.5 而不是 0** —— 让坏数据落回中心
 *     5. 编辑状态的三个转移（begin / end / cancel）都带「已经处于该状态就 no-op」
 */

/** Swift L193：地图高度的三段夹取。 */
export const ZOOM_MAP_HEIGHT_BASE = 312
export const ZOOM_MAP_MINIMUM_ASPECT = 0.5
export const ZOOM_MAP_MINIMUM_HEIGHT = 150
export const ZOOM_MAP_MAXIMUM_HEIGHT = 200

/** Swift L198：地图四周内缩 8 点。 */
export const ZOOM_MAP_PADDING = 8

/** Swift L108 / L122 / L167：三处圆角。 */
export const ZOOM_MAP_THUMBNAIL_CORNER_RADIUS = 7
export const ZOOM_GUIDE_CORNER_RADIUS = 6
export const ZOOM_MAP_CORNER_RADIUS = 14

/** Swift L124-125：构图参考框的描边。 */
export const ZOOM_GUIDE_STROKE_WIDTH = 0.75
export const ZOOM_GUIDE_STROKE_DASH: readonly number[] = [4, 4]
export const ZOOM_GUIDE_STROKE_ALPHA = 0.65

/** Swift L142-143：十字准星。 */
export const ZOOM_CROSSHAIR_ALPHA = 0.7
export const ZOOM_CROSSHAIR_STROKE_WIDTH = 0.75
export const ZOOM_CROSSHAIR_DASH: readonly number[] = [2.5, 3.5]

/** Swift L156-159：焦点圆点 —— 22 点白盘 + 8 点墨心。 */
export const ZOOM_PUCK_DIAMETER = 22
export const ZOOM_PUCK_PIP_DIAMETER = 8
/** Swift L161：激活时放大到 1.1（降低动态效果时保持 1）。 */
export const ZOOM_PUCK_ACTIVE_SCALE = 1.1

/** Swift L171：地图边框透明度三档。 */
export const ZOOM_MAP_BORDER_ACTIVE_ALPHA = 0.8
export const ZOOM_MAP_BORDER_HOVER_ALPHA = 0.35
export const ZOOM_MAP_BORDER_IDLE_ALPHA = 0

/** Swift L244-245：居中的判定容差。 */
export const ZOOM_CENTER_TOLERANCE = 0.000_5

/** Swift L25：刷新间隔 1/30 秒。 */
export const ZOOM_MAP_REFRESH_INTERVAL = 1 / 30

export interface ZoomPoint {
  readonly x: number
  readonly y: number
}

export interface ZoomRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Swift L248-250：`clamp01`。
 *
 * 非有限值（NaN / Infinity）给 **0.5**，不是 0 —— 坏数据落到画面中心，
 * 用户能看见并修正；落到 0 会看起来像「焦点跑到左上角」。
 */
export function zoomClamp01(value: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0.5, 0), 1)
}

/**
 * Swift L197-216：地图矩形。
 *
 * 先按高度撑满算宽度（`padded.height × aspect`）：
 *   - 放得下 → 按高度，水平居中
 *   - 放不下 → 按宽度，垂直居中
 *
 * 宽高比下限 0.01（防竖屏里除出天文数字），内缩 8 点给描边留位置。
 */
export function zoomFocusMapRect(input: {
  readonly size: { readonly width: number; readonly height: number }
  readonly sourcePixelSize: { readonly width: number; readonly height: number }
}): ZoomRect {
  const padded: ZoomRect = {
    x: ZOOM_MAP_PADDING,
    y: ZOOM_MAP_PADDING,
    width: Math.max(input.size.width - ZOOM_MAP_PADDING * 2, 0),
    height: Math.max(input.size.height - ZOOM_MAP_PADDING * 2, 0),
  }
  const aspect = Math.max(
    input.sourcePixelSize.width / Math.max(input.sourcePixelSize.height, 1),
    0.01
  )
  const widthFromHeight = padded.height * aspect
  if (widthFromHeight <= padded.width) {
    return {
      x: padded.x + padded.width / 2 - widthFromHeight / 2,
      y: padded.y,
      width: widthFromHeight,
      height: padded.height,
    }
  }
  const heightFromWidth = padded.width / aspect
  return {
    x: padded.x,
    y: padded.y + padded.height / 2 - heightFromWidth / 2,
    width: padded.width,
    height: heightFromWidth,
  }
}

/**
 * Swift L193：地图高度。
 *
 * `min(max(312 / max(aspect, 0.5), 150), 200)`
 *
 * 分母的 `max(aspect, 0.5)` 让极窄的竖屏素材也不会把高度撑成 600 多；
 * 外层再夹 [150, 200]，所以地图高度永远在这个区间内。
 */
export function zoomFocusMapHeight(sourcePixelSize: {
  readonly width: number
  readonly height: number
}): number {
  const aspect = sourcePixelSize.width / Math.max(sourcePixelSize.height, 1)
  return Math.min(
    Math.max(ZOOM_MAP_HEIGHT_BASE / Math.max(aspect, ZOOM_MAP_MINIMUM_ASPECT), ZOOM_MAP_MINIMUM_HEIGHT),
    ZOOM_MAP_MAXIMUM_HEIGHT
  )
}

/** Swift L93-96：归一化焦点 → 地图内像素点。 */
export function zoomFocusPoint(input: {
  readonly mapRect: ZoomRect
  readonly focus: ZoomPoint
}): ZoomPoint {
  return {
    x: input.mapRect.x + zoomClamp01(input.focus.x) * input.mapRect.width,
    y: input.mapRect.y + zoomClamp01(input.focus.y) * input.mapRect.height,
  }
}

/**
 * Swift L218-223：拖拽点 → 归一化焦点。
 *
 * 分母用 `max(rect.width, 1)` / `max(rect.height, 1)` —— 地图还没布局时
 * 宽高为 0，不夹分母会算出 Infinity 并让焦点变成 NaN。
 */
export function zoomNormalizedFocus(input: {
  readonly point: ZoomPoint
  readonly rect: ZoomRect
}): ZoomPoint {
  return {
    x: Math.min(
      Math.max((input.point.x - input.rect.x) / Math.max(input.rect.width, 1), 0),
      1
    ),
    y: Math.min(
      Math.max((input.point.y - input.rect.y) / Math.max(input.rect.height, 1), 0),
      1
    ),
  }
}

/** Swift L243-246：已居中（容差 0.0005）。居中按钮据此禁用。 */
export function zoomFocusIsCentered(focus: ZoomPoint): boolean {
  return (
    Math.abs(focus.x - 0.5) < ZOOM_CENTER_TOLERANCE &&
    Math.abs(focus.y - 0.5) < ZOOM_CENTER_TOLERANCE
  )
}

/**
 * Swift L127-132：构图参考框。
 *
 * 宽高各乘 `1 − guideInset × 2`（`compositionGuideInset` 是单侧比例），
 * 然后居中放在地图矩形里。
 */
export function zoomGuideRect(input: {
  readonly mapRect: ZoomRect
  readonly guideInset: number
}): ZoomRect {
  const width = input.mapRect.width * (1 - input.guideInset * 2)
  const height = input.mapRect.height * (1 - input.guideInset * 2)
  return {
    x: input.mapRect.x + input.mapRect.width / 2 - width / 2,
    y: input.mapRect.y + input.mapRect.height / 2 - height / 2,
    width,
    height,
  }
}

/**
 * Swift L134-146：十字准星的两条线。
 *
 * 竖线从 `(px, minY)` 到 `(px, maxY)`，横线从 `(minX, py)` 到 `(maxX, py)`。
 * 只在「正在编辑焦点 或 正在改坐标文本」时出现。
 */
export function zoomCrosshairSegments(input: {
  readonly point: ZoomPoint
  readonly mapRect: ZoomRect
}): {
  readonly vertical: { readonly from: ZoomPoint; readonly to: ZoomPoint }
  readonly horizontal: { readonly from: ZoomPoint; readonly to: ZoomPoint }
} {
  return {
    vertical: {
      from: { x: input.point.x, y: input.mapRect.y },
      to: { x: input.point.x, y: input.mapRect.y + input.mapRect.height },
    },
    horizontal: {
      from: { x: input.mapRect.x, y: input.point.y },
      to: { x: input.mapRect.x + input.mapRect.width, y: input.point.y },
    },
  }
}

/** Swift L97：`isEditingFocus || isCoordinateEditing` —— 圆点与准星共用。 */
export function zoomFocusSurfaceIsActive(input: {
  readonly isEditingFocus: boolean
  readonly isCoordinateEditing: boolean
}): boolean {
  return input.isEditingFocus || input.isCoordinateEditing
}

/** Swift L161-162：圆点缩放。降低动态效果时不做 1.1 的放大。 */
export function zoomPuckScale(input: {
  readonly isActive: boolean
  readonly reducesMotion: boolean
}): number {
  return input.isActive && !input.reducesMotion ? ZOOM_PUCK_ACTIVE_SCALE : 1
}

/** Swift L171：地图边框透明度。 */
export function zoomMapBorderAlpha(input: {
  readonly isActive: boolean
  readonly isHovered: boolean
}): number {
  if (input.isActive) return ZOOM_MAP_BORDER_ACTIVE_ALPHA
  return input.isHovered ? ZOOM_MAP_BORDER_HOVER_ALPHA : ZOOM_MAP_BORDER_IDLE_ALPHA
}

/**
 * Swift L24-28：`TimelineView` 什么时候暂停。
 *
 * 四种情况暂停：不允许播放中刷新、没在播放、正在改坐标文本、正在拖焦点。
 * 后两条是防止「用户正在输入/拖动时被 30 Hz 刷新覆盖」。
 */
export function zoomTimelinePaused(input: {
  readonly refreshesDuringPlayback: boolean
  readonly isPlaying: boolean
  readonly isCoordinateEditing: boolean
  readonly isEditingFocus: boolean
}): boolean {
  return (
    !input.refreshesDuringPlayback ||
    !input.isPlaying ||
    input.isCoordinateEditing ||
    input.isEditingFocus
  )
}

/**
 * Swift L225-241：编辑状态的三个转移。
 *
 * 三个都以「已经处于该状态就 no-op」开头 —— 拖拽手势会连续触发
 * `begin`，重复回调会让宿主的撤销栈里堆满空命令。
 */
export type ZoomFocusEditingStep =
  | 'begin'
  | 'noop-begin'
  | 'end'
  | 'noop-end'
  | 'cancel'
  | 'noop-cancel'

export function zoomFocusEditingStep(input: {
  readonly action: 'begin' | 'end' | 'cancel'
  readonly isEditingFocus: boolean
}): ZoomFocusEditingStep {
  if (input.action === 'begin') {
    return input.isEditingFocus ? 'noop-begin' : 'begin'
  }
  if (!input.isEditingFocus) {
    return input.action === 'end' ? 'noop-end' : 'noop-cancel'
  }
  return input.action
}

/**
 * Swift L252-255：缩略图请求的身份。
 *
 * `"\(素材代次)#\(%.3f 输出时间)"` —— 只用字符串拼，且时间保留三位小数。
 * 三位小数足以区分 30 fps 的相邻帧（0.033），又不会因为浮点噪声
 * 每帧都变成新 id。
 */
export function zoomThumbnailRequestID(input: {
  readonly generation: string | null
  readonly outputTime: number
}): string {
  const generation = input.generation ?? 'none'
  return `${generation}#${input.outputTime.toFixed(3)}`
}

/** Swift L82-86：离开视图时若仍在编辑，走取消而不是正常结束。 */
export function zoomShouldCancelOnDisappear(input: {
  readonly isEditingFocus: boolean
}): boolean {
  return input.isEditingFocus
}

/**
 * Swift L185：`allowsHitTesting(allowsEditing && !isCoordinateEditing)`。
 *
 * 正在输入坐标时必须关掉命中测试，否则点击输入框会被手势抢走焦点。
 */
export function zoomFocusSurfaceAcceptsHitTesting(input: {
  readonly allowsEditing: boolean
  readonly isCoordinateEditing: boolean
}): boolean {
  return input.allowsEditing && !input.isCoordinateEditing
}

/** Swift L34：只有允许编辑时才显示两个百分比输入与居中按钮。 */
export function zoomShowsCoordinateControls(input: {
  readonly allowsEditing: boolean
}): boolean {
  return input.allowsEditing
}
