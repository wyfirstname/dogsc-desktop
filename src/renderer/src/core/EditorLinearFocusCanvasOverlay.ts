/**
 * EditorLinearFocusCanvasOverlay —— 画布上的线性虚化直接操作层。
 *
 * Swift source: Sources/DogSCApp/EditorLinearFocusCanvasOverlay.swift（223 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L6-17    struct EditorLinearFocusCanvasOverlay（四个 Handle 情形）
 *   L19-29   crop / plane / shortEdge
 *   L30-49   mapper / center / projected / tangent / offset / projectedAngle
 *   L51-84   body（清晰带 + 四条边界 + 两个把手）
 *   L88-120  clearBandPath —— 先在源空间裁剪再投影
 *   L122-131 guide —— 实线 / 虚线两条边界
 *   L135-153 linePath —— 源空间求交再投影
 *   L155-159 handlePoint —— 夹到画布内 18 点
 *   L160-178 handle
 *   L179-216 drag —— 四种 handle 的位移解释
 *   L217-222 finish
 *
 * 迁移说明：
 *   `ProjectedScreenPointMapper` 在 Web 侧由 `ScreenProjection` 提供，这里把
 *   投影降成注入的 `project` / `unproject` 两个函数。保留的纯几何是：
 *     1. 源平面（source plane）的推导 —— 裁切宽高比 × 源宽高比
 *     2. 四种 handle 的拖拽解释（位置 / 旋转 / 区域 / 羽化）
 *     3. 清晰带的**源空间**半平面裁剪（Sutherland-Hodgman 两次）
 *     4. 边界的**源空间**线段裁剪（Liang-Barsky 式区间求交）
 *     5. 旋转把手沿切向偏移 `shortEdge * 0.36`
 *
 * 为什么要先在源空间裁再投影：一条旋转过的带子直接做命中测试会变成一个
 * 覆盖整块 UI 的矩形；先在源图上裁到凸多边形，投影后的形状才和看到的边缘
 * 对得上。
 */

import type { FocusEffect } from './FocusEffect'
import {
  focusEffectClearHalfWidth,
  focusEffectFeatherWidth,
  normalizedAngle,
} from './FocusEffect'

/** Swift L17：四种把手的身份。`region` / `feather` 还带 ±1 的侧别。 */
export type LinearFocusHandle =
  | { readonly kind: 'position' }
  | { readonly kind: 'direction' }
  | { readonly kind: 'region'; readonly side: -1 | 1 }
  | { readonly kind: 'feather'; readonly side: -1 | 1 }

export interface LinearFocusPoint {
  readonly x: number
  readonly y: number
}

export interface LinearFocusRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Swift L180：拖拽最小距离 2 点。 */
export const LINEAR_FOCUS_MINIMUM_DRAG = 2
/** Swift L174：把手 28×28。 */
export const LINEAR_FOCUS_HANDLE_SIZE = 28
/** Swift L157-158：把手位置夹到画布内 18 点。 */
export const LINEAR_FOCUS_HANDLE_EDGE_INSET = 18
/** Swift L72：旋转把手沿切向的距离系数。 */
export const LINEAR_FOCUS_ROTATION_HANDLE_FACTOR = 0.36
/** Swift L124：虚线 = [4, 6]。 */
export const LINEAR_FOCUS_FEATHER_DASH: readonly number[] = [4, 6]
/** Swift L124：常态线宽 1，悬停 1.5。 */
export const LINEAR_FOCUS_GUIDE_WIDTH = 1
export const LINEAR_FOCUS_GUIDE_ACTIVE_WIDTH = 1.5
/** Swift L127：命中路径宽 10 点。 */
export const LINEAR_FOCUS_HIT_WIDTH = 10
/** Swift L125-126：黑色垫底线透明度 0.38，白线常态 0.8。 */
export const LINEAR_FOCUS_SHADOW_ALPHA = 0.38
export const LINEAR_FOCUS_LINE_ALPHA = 0.8
/** Swift L171：未悬停时把手透明度 0.65。 */
export const LINEAR_FOCUS_HANDLE_IDLE_ALPHA = 0.65
/** Swift L141：方向分量绝对值小于 1e-5 视为平行。 */
export const LINEAR_FOCUS_PARALLEL_EPSILON = 0.000_01

/**
 * Swift L19-28：源平面（source plane）。
 *
 * 三步：
 *   w = crop.width × max(sourceAspect, 0.01)，h = crop.height
 *   scale = min(base.w / w, base.h / h) × final.w / base.w
 *   rect  = final 居中放一块 w×scale × h×scale
 *
 * `scale` 里出现两次 `base.width`（一次除、一次乘）—— 这是刻度换算：
 * `min(...)` 把源宽高比映进 base，再按 `final/base` 把 base 放大到 final。
 * 两次都夹到 0.001 以免除零，但**夹的是分母**，所以 0 宽会得到 0 缩放而不是
 * 一个巨大值。
 */
export function linearFocusPlane(input: {
  readonly crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly sourceAspect: number
  readonly baseRect: LinearFocusRect
  readonly finalRect: LinearFocusRect
}): LinearFocusRect {
  const w = input.crop.width * Math.max(input.sourceAspect, 0.01)
  const h = input.crop.height
  const scale =
    Math.min(
      input.baseRect.width / Math.max(w, 0.001),
      input.baseRect.height / Math.max(h, 0.001)
    ) * (input.finalRect.width / Math.max(input.baseRect.width, 0.001))
  const width = w * scale
  const height = h * scale
  return {
    x: input.finalRect.x + (input.finalRect.width - width) / 2,
    y: input.finalRect.y + (input.finalRect.height - height) / 2,
    width,
    height,
  }
}

/** Swift L29：`min(plane.width, plane.height)` —— 清晰宽与羽化都按短边算。 */
export function linearFocusShortEdge(plane: LinearFocusRect): number {
  return Math.min(plane.width, plane.height)
}

/**
 * Swift L31-34：把归一化中心点映射进源平面。
 *
 * 分母是 `crop.width` / `crop.height`（裁切后的范围），不是 1 ——
 * 于是「裁切后可见区域的正中」正好落在平面正中。
 */
export function linearFocusCenter(input: {
  readonly effect: FocusEffect
  readonly plane: LinearFocusRect
  readonly crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}): LinearFocusPoint {
  return {
    x:
      input.plane.x +
      ((input.effect.center.x - input.crop.x) / input.crop.width) * input.plane.width,
    y:
      input.plane.y +
      ((input.effect.center.y - input.crop.y) / input.crop.height) * input.plane.height,
  }
}

/** Swift L39-42：切向单位向量。角度缺省按 0（指向 +x）。 */
export function linearFocusTangent(angleDegrees: number | null): LinearFocusPoint {
  const angle = ((angleDegrees ?? 0) * Math.PI) / 180
  return { x: Math.cos(angle), y: Math.sin(angle) }
}

/** Swift L52：法向 = 切向逆时针转 90°（`(-t.y, t.x)`）。 */
export function linearFocusNormal(tangent: LinearFocusPoint): LinearFocusPoint {
  return { x: -tangent.y, y: tangent.x }
}

/** Swift L43-45：沿方向平移。 */
export function linearFocusOffset(
  point: LinearFocusPoint,
  direction: LinearFocusPoint,
  distance: number
): LinearFocusPoint {
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
  }
}

/**
 * Swift L46-49：投影后的切向角（度）。
 *
 * 取「中心点」与「沿切向偏移 2 点」两点，各自投影后再求 atan2。
 * 这就是把手图标要旋转的角度 —— 透视投影会改变视觉角度，直接用
 * `effect.angleDegrees` 会让图标和实际边缘错开。
 */
export function linearFocusProjectedAngle(input: {
  readonly point: LinearFocusPoint
  readonly tangent: LinearFocusPoint
  readonly project: (point: LinearFocusPoint) => LinearFocusPoint
}): number {
  const a = input.project(input.point)
  const b = input.project(linearFocusOffset(input.point, input.tangent, 2))
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

/** Swift L54-55：清晰带的半宽与羽化宽（都按短边）。 */
export function linearFocusBandMetrics(input: {
  readonly effect: FocusEffect
  readonly shortEdge: number
}): { readonly radius: number; readonly feather: number } {
  return {
    radius: focusEffectClearHalfWidth(input.effect, input.shortEdge),
    feather: focusEffectFeatherWidth(input.effect, input.shortEdge),
  }
}

/**
 * Swift L64-69：四条边界的落点。
 *
 * 对 side ∈ {-1, +1} 各给两条：
 *   inner = center + n × radius × side       （实线，清晰区边界）
 *   outer = center + n × (radius + feather) × side（虚线，羽化终点）
 */
export function linearFocusGuidePoints(input: {
  readonly center: LinearFocusPoint
  readonly normal: LinearFocusPoint
  readonly radius: number
  readonly feather: number
}): readonly {
  readonly side: -1 | 1
  readonly inner: LinearFocusPoint
  readonly outer: LinearFocusPoint
}[] {
  return ([-1, 1] as const).map((side) => ({
    side,
    inner: linearFocusOffset(input.center, input.normal, input.radius * side),
    outer: linearFocusOffset(input.center, input.normal, (input.radius + input.feather) * side),
  }))
}

/** Swift L72：旋转把手在切向上 `shortEdge * 0.36` 处。 */
export function linearFocusRotationHandlePoint(input: {
  readonly center: LinearFocusPoint
  readonly tangent: LinearFocusPoint
  readonly shortEdge: number
}): LinearFocusPoint {
  return linearFocusOffset(
    input.center,
    input.tangent,
    input.shortEdge * LINEAR_FOCUS_ROTATION_HANDLE_FACTOR
  )
}

/**
 * Swift L155-159：把手位置的画布夹取。
 *
 * 上下界写成 `max(画布边 − 18, 18)` —— 画布小于 36 点时不产生负区间，
 * 而是把唯一可行位置定在 18。
 */
export function linearFocusHandlePoint(input: {
  readonly point: LinearFocusPoint
  readonly canvasSize: { readonly width: number; readonly height: number }
  readonly inset?: number
}): LinearFocusPoint {
  const inset = input.inset ?? LINEAR_FOCUS_HANDLE_EDGE_INSET
  return {
    x: Math.min(Math.max(input.point.x, inset), Math.max(input.canvasSize.width - inset, inset)),
    y: Math.min(Math.max(input.point.y, inset), Math.max(input.canvasSize.height - inset, inset)),
  }
}

/**
 * Swift L94-113：清晰带的源空间裁剪。
 *
 * 对每条边（法向的 ±1 侧）做一次半平面裁剪，保留 `distance <= 0` 的点：
 *   distance(p) = ((p − center) · normal) × side − radius
 *
 * 于是 side=+1 保留 `·n <= radius`，side=-1 保留 `·n >= -radius`，
 * 两条边一夹就得到带宽 `2 × radius` 的条带。
 *
 * 求交点的参数用 `previous / (previous − current)`（因为条件是 `<= 0`，
 * 两端异号时该分数天然落在 [0,1]）。**用 `(a<=0) !== (b<=0)` 判断跨越**，
 * 不比较绝对值大小 —— 两端都 ≤ 0 或都 > 0 时一律不插点。
 */
export function clipPolygonByHalfPlane(input: {
  readonly vertices: readonly LinearFocusPoint[]
  readonly center: LinearFocusPoint
  readonly normal: LinearFocusPoint
  readonly radius: number
  readonly side: -1 | 1
}): LinearFocusPoint[] {
  if (input.vertices.length === 0) return []
  const distance = (point: LinearFocusPoint): number =>
    ((point.x - input.center.x) * input.normal.x +
      (point.y - input.center.y) * input.normal.y) *
      input.side -
    input.radius
  const clipped: LinearFocusPoint[] = []
  let previous = input.vertices[input.vertices.length - 1]!
  let previousDistance = distance(previous)
  for (const current of input.vertices) {
    const currentDistance = distance(current)
    if (previousDistance <= 0 !== currentDistance <= 0) {
      const fraction = previousDistance / (previousDistance - currentDistance)
      clipped.push({
        x: previous.x + (current.x - previous.x) * fraction,
        y: previous.y + (current.y - previous.y) * fraction,
      })
    }
    if (currentDistance <= 0) clipped.push(current)
    previous = current
    previousDistance = currentDistance
  }
  return clipped
}

/**
 * Swift L88-120：清晰带的完整裁剪 + 门槛。
 *
 * 三条前置：有投影器、平面宽高为正、两次裁剪后仍有至少 3 个顶点。
 * 任一不满足就返回空多边形 —— 空路径不参与命中测试，等价于「这一帧没有
 * 可拖的清晰带」。
 */
export function linearFocusClearBandVertices(input: {
  readonly plane: LinearFocusRect
  readonly center: LinearFocusPoint
  readonly normal: LinearFocusPoint
  readonly radius: number
  readonly hasProjector: boolean
}): LinearFocusPoint[] {
  if (!input.hasProjector) return []
  if (!(input.plane.width > 0) || !(input.plane.height > 0)) return []
  const corners: readonly LinearFocusPoint[] = [
    { x: input.plane.x, y: input.plane.y },
    { x: input.plane.x + input.plane.width, y: input.plane.y },
    { x: input.plane.x + input.plane.width, y: input.plane.y + input.plane.height },
    { x: input.plane.x, y: input.plane.y + input.plane.height },
  ]
  let vertices: readonly LinearFocusPoint[] = corners
  for (const side of [-1, 1] as const) {
    vertices = clipPolygonByHalfPlane({
      vertices,
      center: input.center,
      normal: input.normal,
      radius: input.radius,
      side,
    })
  }
  return vertices.length >= 3 ? vertices.slice() : []
}

/**
 * Swift L135-153：把一条无限长的边界线裁到源平面上。
 *
 * 对 x、y 各求一次参数区间，取交集：
 *   direction 分量绝对值 < 1e-5 → 该轴必须直接落在 [min, max] 内，否则整条线不可见
 *   否则 a = (min − pos)/dir、b = (max − pos)/dir，lower = max(lower, min(a,b))，
 *   upper = min(upper, max(a,b))
 *
 * 最后 `lower <= upper` 才算有交集。返回的 lower/upper 是**沿切向的参数**，
 * 用它们去 offset 端点就能得到投影前的线段。
 */
export function linearFocusLineClip(input: {
  readonly point: LinearFocusPoint
  readonly tangent: LinearFocusPoint
  readonly plane: LinearFocusRect
}): { readonly lower: number; readonly upper: number } | null {
  let lower = -Number.MAX_VALUE
  let upper = Number.MAX_VALUE
  const axes: readonly [number, number, number, number][] = [
    [input.point.x, input.tangent.x, input.plane.x, input.plane.x + input.plane.width],
    [input.point.y, input.tangent.y, input.plane.y, input.plane.y + input.plane.height],
  ]
  for (const [position, direction, minimum, maximum] of axes) {
    if (Math.abs(direction) < LINEAR_FOCUS_PARALLEL_EPSILON) {
      if (position < minimum || position > maximum) return null
      continue
    }
    const a = (minimum - position) / direction
    const b = (maximum - position) / direction
    lower = Math.max(lower, Math.min(a, b))
    upper = Math.min(upper, Math.max(a, b))
  }
  if (lower > upper) return null
  return { lower, upper }
}

/**
 * Swift L182-191：拖拽的两条前置。
 *
 * ① 选中项必须**就是**这个片段的 screenMotion —— 多选或切走之后手势仍在
 *    追踪，但没有写入目标。
 * ② 已经借出的交互 id 必须仍是当前的 —— 别的控件接管了交互就放弃。
 */
export function linearFocusDragAccepted(input: {
  readonly selectionIsOwnClip: boolean
  readonly hasInteractionID: boolean
  readonly interactionIDMatches: boolean
}): boolean {
  if (!input.selectionIsOwnClip) return false
  if (!input.hasInteractionID) return false
  return input.interactionIDMatches
}

/**
 * Swift L192-210：四种 handle 的位移解释。
 *
 *  - `position`：`dx / plane.width × crop.width`（把点位移换算回归一化），
 *    再夹进裁切范围 `[crop.x, crop.x + crop.width]`。
 *  - `direction`：用**起点**与**当前点**相对中心的角度差，且必须走
 *    `atan2(sin δ, cos δ)` 规约到 (−π, π] —— 直接相减会在跨越 ±π 时
 *    让角度跳 360°。
 *  - `region(side)`：`size += normalDelta × side × 2 / shortEdge`，
 *    夹到 [0.1, 1]。乘 2 是因为 `size` 是**整条带宽**而 `radius` 是半宽。
 *  - `feather(side)`：`softness += normalDelta × side / (shortEdge × 0.4)`，
 *    夹到 [0, 1]。分母里的 0.4 与 `featherWidth` 的实现成对。
 *
 * 四种情形都会把 `shape` 强制为 `linear`、`target` 强制为 `fixed`、
 * `dimming` 清零 —— 线性带的直接操作一旦生效，之前若是径向/跟随指针/带压暗，
 * 都必须先归到这条分支的语义上。
 */
export type LinearFocusDragResult =
  | { readonly kind: 'center'; readonly center: { readonly x: number; readonly y: number } }
  | { readonly kind: 'angle'; readonly angleDegrees: number }
  | { readonly kind: 'size'; readonly size: number }
  | { readonly kind: 'softness'; readonly softness: number }

export function linearFocusDragResult(input: {
  readonly handle: LinearFocusHandle
  readonly effect: FocusEffect
  readonly delta: LinearFocusPoint
  readonly normalDelta: number
  readonly plane: LinearFocusRect
  readonly crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly shortEdge: number
  readonly startAngle: number
  readonly currentAngle: number
}): LinearFocusDragResult {
  switch (input.handle.kind) {
    case 'position': {
      const x =
        input.effect.center.x +
        (input.delta.x / Math.max(input.plane.width, 1)) * input.crop.width
      const y =
        input.effect.center.y +
        (input.delta.y / Math.max(input.plane.height, 1)) * input.crop.height
      return {
        kind: 'center',
        center: {
          x: Math.min(Math.max(x, input.crop.x), input.crop.x + input.crop.width),
          y: Math.min(Math.max(y, input.crop.y), input.crop.y + input.crop.height),
        },
      }
    }
    case 'direction': {
      const raw = input.currentAngle - input.startAngle
      const delta = Math.atan2(Math.sin(raw), Math.cos(raw))
      return {
        kind: 'angle',
        angleDegrees: normalizedAngle(
          (input.effect.angleDegrees ?? 0) + (delta * 180) / Math.PI
        ),
      }
    }
    case 'region': {
      const size =
        input.effect.size +
        (input.normalDelta * input.handle.side * 2) / Math.max(input.shortEdge, 1)
      return { kind: 'size', size: Math.min(Math.max(size, 0.1), 1) }
    }
    case 'feather': {
      const softness =
        input.effect.softness +
        (input.normalDelta * input.handle.side) / Math.max(input.shortEdge * 0.4, 1)
      return { kind: 'softness', softness: Math.min(Math.max(softness, 0), 1) }
    }
  }
}

/**
 * Swift L195：`normalDelta = dx × (−t.y) + dy × t.x` —— 位移在法向上的投影。
 *
 * 这一点很重要：沿切向拖动不该改变带宽，只有法向分量算数。
 */
export function linearFocusNormalDelta(input: {
  readonly delta: LinearFocusPoint
  readonly tangent: LinearFocusPoint
}): number {
  return input.delta.x * -input.tangent.y + input.delta.y * input.tangent.x
}

/** Swift L78-79：显式关掉隐式动画 —— 否则旋转会从 359° 倒卷回 0°。 */
export function linearFocusSuppressesImplicitAnimation(): boolean {
  return true
}

/** Swift L81-83：交互 id 变了就丢弃自己借出的那份（origin / interactionID 双清）。 */
export function linearFocusShouldDropOwnedInteraction(input: {
  readonly ownedInteractionID: string | null
  readonly currentInteractionID: string | null
}): boolean {
  if (input.ownedInteractionID == null) return false
  return input.ownedInteractionID !== input.currentInteractionID
}

/** Swift L62 / L130：两条帮助文案。 */
export const LINEAR_FOCUS_HELP_POSITION = '拖动清晰区域移动位置'
export const LINEAR_FOCUS_HELP_REGION = '拖动实线调整清晰区域'
export const LINEAR_FOCUS_HELP_FEATHER = '拖动虚线调整羽化范围'
export const LINEAR_FOCUS_TITLE_POSITION = '移动清晰带'
export const LINEAR_FOCUS_TITLE_DIRECTION = '旋转清晰带'
export const LINEAR_FOCUS_COMMIT_ACTION = '调整线性虚化'
