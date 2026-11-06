/**
 * ScreenProjection — 3D 屏幕投影几何。
 *
 * Swift source: Sources/RecorderCore/ScreenProjection.swift @ laogou717/dogsc 567fd6e
 *
 * 转写对照：
 *   ProjectedScreenPointMapper  → ProjectedScreenPointMapper（单应矩阵正/逆变换）
 *   ProjectedScreenQuad         → ProjectedScreenQuad（四角 + bounds + 命中测试）
 *   ScreenProjection.project    → projectScreen()（绕 X→Y→Z 旋转 + 透视除法）
 *
 * 关键设计（原文注释照录）：
 *   输入与输出都用「左上原点」画布坐标。预览与导出因此可以消费同一组四个角，
 *   只做各自的 API 坐标转换。perspective == 0 是正交投影；值越大深度越强，
 *   但不改变未旋转的卡片外观。
 */

import type { CompositionPoint, CompositionRect } from './CompositionGeometry'
import { rectMid } from './CompositionGeometry'

const EPSILON = 0.000_000_001

// ---------------------------------------------------------------- Point mapper

/**
 * 把源矩形内的任意点，通过屏幕四角定义的单应矩阵（homography）投影。
 *
 * 采用标准单位正方形 → 四边形的透视变换：
 *   x' = (a·u + b·v + tl.x) / (px·u + py·v + 1)
 *   y' = (d·u + e·v + tl.y) / (px·u + py·v + 1)
 * 其中 (u,v) 是点在源矩形内的归一化坐标。
 */
export class ProjectedScreenPointMapper {
  private readonly sourceRect: CompositionRect
  private readonly topLeft: CompositionPoint
  private readonly a: number
  private readonly b: number
  private readonly d: number
  private readonly e: number
  private readonly perspectiveX: number
  private readonly perspectiveY: number

  private constructor(
    sourceRect: CompositionRect,
    topLeft: CompositionPoint,
    a: number,
    b: number,
    d: number,
    e: number,
    perspectiveX: number,
    perspectiveY: number
  ) {
    this.sourceRect = sourceRect
    this.topLeft = topLeft
    this.a = a
    this.b = b
    this.d = d
    this.e = e
    this.perspectiveX = perspectiveX
    this.perspectiveY = perspectiveY
  }

  /** 对应 Swift `fileprivate init?(quad:sourceRect:)`，失败返回 null。 */
  static make(quad: ProjectedScreenQuad, sourceRect: CompositionRect): ProjectedScreenPointMapper | null {
    if (
      !Number.isFinite(sourceRect.width) ||
      !Number.isFinite(sourceRect.height) ||
      sourceRect.width <= 0 ||
      sourceRect.height <= 0 ||
      !quad.corners.every(c => Number.isFinite(c.x) && Number.isFinite(c.y))
    ) {
      return null
    }

    const dx1 = quad.topRight.x - quad.bottomRight.x
    const dx2 = quad.bottomLeft.x - quad.bottomRight.x
    const dx3 =
      quad.topLeft.x - quad.topRight.x + quad.bottomRight.x - quad.bottomLeft.x
    const dy1 = quad.topRight.y - quad.bottomRight.y
    const dy2 = quad.bottomLeft.y - quad.bottomRight.y
    const dy3 =
      quad.topLeft.y - quad.topRight.y + quad.bottomRight.y - quad.bottomLeft.y
    const denominator = dx1 * dy2 - dx2 * dy1

    let perspectiveX: number
    let perspectiveY: number
    if (Math.abs(dx3) <= EPSILON && Math.abs(dy3) <= EPSILON) {
      perspectiveX = 0
      perspectiveY = 0
    } else {
      if (Math.abs(denominator) <= EPSILON) return null
      perspectiveX = (dx3 * dy2 - dx2 * dy3) / denominator
      perspectiveY = (dx1 * dy3 - dx3 * dy1) / denominator
    }

    const topLeft = quad.topLeft
    const a = quad.topRight.x - quad.topLeft.x + perspectiveX * quad.topRight.x
    const b = quad.bottomLeft.x - quad.topLeft.x + perspectiveY * quad.bottomLeft.x
    const d = quad.topRight.y - quad.topLeft.y + perspectiveX * quad.topRight.y
    const e = quad.bottomLeft.y - quad.topLeft.y + perspectiveY * quad.bottomLeft.y

    return new ProjectedScreenPointMapper(
      sourceRect,
      topLeft,
      a,
      b,
      d,
      e,
      perspectiveX,
      perspectiveY
    )
  }

  /** 源坐标 → 画布坐标。 */
  project(point: CompositionPoint): CompositionPoint | null {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
    const x = (point.x - this.sourceRect.x) / this.sourceRect.width
    const y = (point.y - this.sourceRect.y) / this.sourceRect.height
    const divisor = this.perspectiveX * x + this.perspectiveY * y + 1
    if (!Number.isFinite(divisor) || Math.abs(divisor) <= EPSILON) return null
    const projected = {
      x: (this.a * x + this.b * y + this.topLeft.x) / divisor,
      y: (this.d * x + this.e * y + this.topLeft.y) / divisor,
    }
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return null
    return projected
  }

  /**
   * 与渲染器所用同一单应矩阵的精确逆变换。
   * 编辑倾斜平面时不能用它的上/左边缘近似透视。
   */
  unproject(point: CompositionPoint): CompositionPoint | null {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
    const aa = this.a - point.x * this.perspectiveX
    const bb = this.b - point.x * this.perspectiveY
    const dd = this.d - point.y * this.perspectiveX
    const ee = this.e - point.y * this.perspectiveY
    const determinant = aa * ee - bb * dd
    if (Math.abs(determinant) <= EPSILON) return null
    const x = point.x - this.topLeft.x
    const y = point.y - this.topLeft.y
    const u = (x * ee - bb * y) / determinant
    const v = (aa * y - x * dd) / determinant
    const result = {
      x: this.sourceRect.x + u * this.sourceRect.width,
      y: this.sourceRect.y + v * this.sourceRect.height,
    }
    return Number.isFinite(result.x) && Number.isFinite(result.y) ? result : null
  }
}

// ---------------------------------------------------------------- Quad

/** 一个被投影后的屏幕四边形。 */
export class ProjectedScreenQuad {
  readonly topLeft: CompositionPoint
  readonly topRight: CompositionPoint
  readonly bottomRight: CompositionPoint
  readonly bottomLeft: CompositionPoint

  constructor(
    topLeft: CompositionPoint,
    topRight: CompositionPoint,
    bottomRight: CompositionPoint,
    bottomLeft: CompositionPoint
  ) {
    this.topLeft = topLeft
    this.topRight = topRight
    this.bottomRight = bottomRight
    this.bottomLeft = bottomLeft
  }

  /** 轴对齐包围盒。 */
  get bounds(): CompositionRect {
    const points = this.corners
    const minX = Math.min(...points.map(p => p.x))
    const maxX = Math.max(...points.map(p => p.x))
    const minY = Math.min(...points.map(p => p.y))
    const maxY = Math.max(...points.map(p => p.y))
    return { x: minX, y: minY, width: Math.max(maxX - minX, 0), height: Math.max(maxY - minY, 0) }
  }

  /**
   * 与未投影屏幕同语义顺序的四角。
   * 显式保留顺序，让编辑器交互几何跟随渲染器实际消费的四边形，
   * 而不是退回到它的轴对齐包围盒。
   */
  get corners(): CompositionPoint[] {
    return [this.topLeft, this.topRight, this.bottomRight, this.bottomLeft]
  }

  /**
   * 交互用的投影中心。对透视四边形而言，刻意取四个可见角的平均，
   * 而不是轴对齐包围盒的中心。
   */
  get center(): CompositionPoint {
    const c = this.corners
    return {
      x: c.reduce((s, p) => s + p.x, 0) / 4,
      y: c.reduce((s, p) => s + p.y, 0) / 4,
    }
  }

  /**
   * 语义上的右下角始终是缩放手柄，即使在旋转之后。
   * 用 bounds.maxX/maxY 会让手柄在绕 Z 或 Y 旋转后跑到无关的角上。
   */
  get resizeHandlePoint(): CompositionPoint {
    return this.bottomRight
  }

  /** 投影任意源矩形内的点（与四角同一单应矩阵）。 */
  project(point: CompositionPoint, sourceRect: CompositionRect): CompositionPoint | null {
    return this.projector(sourceRect)?.project(point) ?? null
  }

  /** 构建单位正方形单应矩阵，同一显示帧内多个覆盖层角点可复用。 */
  projector(sourceRect: CompositionRect): ProjectedScreenPointMapper | null {
    return ProjectedScreenPointMapper.make(this, sourceRect)
  }

  /**
   * 把画布空间拖拽转换为沿「语义左上 → 右下」对角线的带符号缩放量。
   * 这样在 3D/Z 旋转后缩放方向仍然直觉，且与该对角线正交的运动不产生贡献。
   */
  semanticResizeDelta(translation: CompositionPoint, referenceLength: number): number {
    if (
      !Number.isFinite(translation.x) ||
      !Number.isFinite(translation.y) ||
      !Number.isFinite(referenceLength)
    ) {
      return 0
    }
    const dx = this.resizeHandlePoint.x - this.topLeft.x
    const dy = this.resizeHandlePoint.y - this.topLeft.y
    const length = Math.hypot(dx, dy)
    if (length <= 0.000001) return 0
    const unitX = dx / length
    const unitY = dy / length
    const projectedTravel = translation.x * unitX + translation.y * unitY
    const identityEquivalentGain = Math.abs(unitX) + Math.abs(unitY)
    return (projectedTravel * identityEquivalentGain) / Math.max(referenceLength, 1)
  }

  /**
   * 判断画布空间中的点是否落在投影后的屏幕内（含边界）。
   * 用 winding number，对顺/逆时针四边形都成立；非有限或退化几何安全返回 false。
   */
  contains(point: CompositionPoint, tolerance = 0.000001): boolean {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(tolerance) ||
      !this.corners.every(c => Number.isFinite(c.x) && Number.isFinite(c.y))
    ) {
      return false
    }

    const epsilon = Math.max(tolerance, 0)
    const corners = this.corners
    let twiceArea = 0
    for (let i = 0; i < corners.length; i++) {
      const start = corners[i]
      const end = corners[(i + 1) % corners.length]
      twiceArea += start.x * end.y - end.x * start.y
    }
    if (Math.abs(twiceArea) <= epsilon) return false

    let windingNumber = 0
    for (let i = 0; i < corners.length; i++) {
      const start = corners[i]
      const end = corners[(i + 1) % corners.length]

      if (pointLiesOnSegment(point, start, end, epsilon)) return true

      if (start.y <= point.y) {
        if (end.y > point.y && cross(start, end, point) > epsilon) windingNumber += 1
      } else if (end.y <= point.y && cross(start, end, point) < -epsilon) {
        windingNumber -= 1
      }
    }
    return windingNumber !== 0
  }
}

function cross(start: CompositionPoint, end: CompositionPoint, point: CompositionPoint): number {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x)
}

function pointLiesOnSegment(
  point: CompositionPoint,
  start: CompositionPoint,
  end: CompositionPoint,
  tolerance: number
): boolean {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= tolerance * tolerance) {
    return Math.hypot(point.x - start.x, point.y - start.y) <= tolerance
  }
  const parameter = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  if (parameter < -tolerance || parameter > 1 + tolerance) return false
  const nearest = { x: start.x + parameter * dx, y: start.y + parameter * dy }
  return Math.hypot(point.x - nearest.x, point.y - nearest.y) <= tolerance
}

// ---------------------------------------------------------------- Projection

export interface ProjectionParams {
  rect: CompositionRect
  rotationX: number
  rotationY: number
  rotationZ: number
  perspective: number
  anchor?: CompositionPoint | null
}

/**
 * 把平面矩形按 rotationX/Y/Z（度）+ perspective 投影为四边形。
 *
 * 旋转顺序：先绕 X，再绕 Y，最后绕 Z。屏幕初始位于 z = 0 平面。
 * 透视：相机距离 = 最大边长 × 2 / depth，投影缩放 = cameraDistance / (cameraDistance − z)。
 */
export function projectScreen(params: ProjectionParams): ProjectedScreenQuad {
  const { rect, rotationX, rotationY, rotationZ, perspective } = params
  const safeWidth = Math.max(rect.width, 0)
  const safeHeight = Math.max(rect.height, 0)

  const anchor = params.anchor
  const pivot =
    anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y) ? anchor : rectMid(rect)

  const maximumDimension = Math.max(rect.width, rect.height, 1)
  const depth = Math.min(Math.max(perspective, 0), 2)
  const cameraDistance = depth > 0 ? (maximumDimension * 2) / Math.max(depth, 0.0001) : Infinity

  const toRad = (deg: number) => (deg * Math.PI) / 180
  const rx = toRad(rotationX)
  const ry = toRad(rotationY)
  const rz = toRad(rotationZ)
  const sinX = Math.sin(rx)
  const cosX = Math.cos(rx)
  const sinY = Math.sin(ry)
  const cosY = Math.cos(ry)
  const sinZ = Math.sin(rz)
  const cosZ = Math.cos(rz)

  const pointAt = (x: number, y: number): CompositionPoint => {
    // 绕 X：屏幕平面上 (x, y, 0) 绕水平轴倾斜
    const xAfterX = x
    const yAfterX = y * cosX
    const zAfterX = y * sinX

    // 绕 Y：绕垂直轴左右转动
    const xAfterY = xAfterX * cosY + zAfterX * sinY
    const yAfterY = yAfterX
    const zAfterY = -xAfterX * sinY + zAfterX * cosY

    // 绕 Z：屏幕平面内旋转
    const xAfterZ = xAfterY * cosZ - yAfterY * sinZ
    const yAfterZ = xAfterY * sinZ + yAfterY * cosZ

    let projectionScale: number
    if (Number.isFinite(cameraDistance)) {
      // 让分母远离零，避免作者极端参数产生 NaN/Infinity
      const denominator = Math.max(cameraDistance - zAfterY, cameraDistance * 0.12)
      projectionScale = cameraDistance / denominator
    } else {
      projectionScale = 1
    }
    return {
      x: pivot.x + xAfterZ * projectionScale,
      y: pivot.y + yAfterZ * projectionScale,
    }
  }

  return new ProjectedScreenQuad(
    pointAt(rect.x - pivot.x, rect.y - pivot.y),
    pointAt(rect.x + safeWidth - pivot.x, rect.y - pivot.y),
    pointAt(rect.x + safeWidth - pivot.x, rect.y + safeHeight - pivot.y),
    pointAt(rect.x - pivot.x, rect.y + safeHeight - pivot.y)
  )
}

/**
 * 生成与 projectScreen 等价的 CSS 3D transform 字符串。
 *
 * 用于在 DOM 层直接渲染 3D 卡片，与上面的数学保持同一旋转顺序和透视规则。
 * CSS 的 perspective 距离与 projectScreen 的 cameraDistance 对应，
 * transform-origin 与 pivot 对应。
 */
export function cssTransformForScreen(params: {
  rotationX: number
  rotationY: number
  rotationZ: number
  perspective: number
  scale: number
  translateX?: number
  translateY?: number
  /** 卡片最长边的像素值，用于推算透视距离 */
  longEdgePx: number
}): string {
  const { rotationX, rotationY, rotationZ, perspective, scale, longEdgePx } = params
  const depth = Math.min(Math.max(perspective, 0), 2)
  // 与 projectScreen 同公式：cameraDistance = maxDim * 2 / depth
  const cameraDistance = depth > 0 ? (longEdgePx * 2) / Math.max(depth, 0.0001) : 0

  const parts: string[] = []
  if (cameraDistance > 0) parts.push(`perspective(${cameraDistance.toFixed(2)}px)`)
  if (params.translateX || params.translateY) {
    parts.push(`translate3d(${(params.translateX ?? 0).toFixed(2)}px, ${(params.translateY ?? 0).toFixed(2)}px, 0)`)
  }
  if (scale !== 1) parts.push(`scale(${scale.toFixed(4)})`)
  // CSS 旋转顺序从右到左应用；要复现 X→Y→Z 需写成 rotateZ rotateY rotateX
  if (rotationZ) parts.push(`rotateZ(${rotationZ.toFixed(3)}deg)`)
  if (rotationY) parts.push(`rotateY(${rotationY.toFixed(3)}deg)`)
  if (rotationX) parts.push(`rotateX(${rotationX.toFixed(3)}deg)`)
  return parts.join(' ')
}
