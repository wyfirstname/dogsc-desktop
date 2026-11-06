/**
 * 3D 运镜渲染：把 ScreenMotionState 转成 CSS transform，并计算投影四边形。
 *
 * Swift source: Sources/RecorderCore/ScreenMotion.swift @ laogou717/dogsc 567fd6e
 * 对照实现：
 *   ScreenMotionState.rotationX/Y/Z + perspective + scale + position
 *     → buildScreenTransform()（CSS）+ projectScreen()（数学四边形）
 *
 * 为何两套并存：
 *   - CSS transform 负责「真的画出来」（GPU 合成，60fps 无压力）
 *   - projectScreen 负责「算命中与手柄位置」（拖拽交互需要精确的四角坐标）
 *   两者用同一组旋转顺序（X→Y→Z）与同一透视公式，所以视觉与交互一致。
 *
 * 坐标约定：
 *   CSS transform-origin 在卡片中心；rotationX/Y/Z 均为角度。
 *   perspective 距离 = 卡片最长边 × 2 / depth（与 ScreenProjection 同公式）。
 */

import type { CompositionPoint, CompositionRect } from './CompositionGeometry'
import { projectScreen, type ProjectedScreenQuad } from './ScreenProjection'

/** 3D 运镜的可编辑状态。对应 Swift ScreenMotionState。 */
export interface ScreenMotionState {
  /** 卡片中心在画布中的归一化位置（0.5, 0.5 = 居中）。 */
  position: { x: number; y: number }
  /** 额外缩放，1 = 适配画布。 */
  scale: number
  /** 绕水平轴俯仰，正值上边缘向后倒。 */
  rotationX: number
  /** 绕垂直轴左右转，正值右边缘向后。 */
  rotationY: number
  /** 画面内旋转。 */
  rotationZ: number
  /** 透视强度 0~2。0 = 正交（无近大远小），0.65 = 默认。 */
  perspective: number
}

export const DEFAULT_SCREEN_MOTION: ScreenMotionState = {
  position: { x: 0.5, y: 0.5 },
  scale: 1,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  perspective: 0.65,
}

/** Swift: ScreenMotionState.init 的 clamp 规则。 */
export function makeScreenMotionState(
  overrides: Partial<ScreenMotionState> = {}
): ScreenMotionState {
  return {
    position: overrides.position ?? { x: 0.5, y: 0.5 },
    scale: Math.max(overrides.scale ?? 1, 0.01),
    rotationX: clamp(overrides.rotationX ?? 0, -90, 90),
    rotationY: clamp(overrides.rotationY ?? 0, -90, 90),
    rotationZ: clamp(overrides.rotationZ ?? 0, -180, 180),
    perspective: clamp(overrides.perspective ?? 0.65, 0, 2),
  }
}

export function isIdentityMotion(m: ScreenMotionState): boolean {
  return (
    m.rotationX === 0 &&
    m.rotationY === 0 &&
    m.rotationZ === 0 &&
    m.scale === 1 &&
    m.position.x === 0.5 &&
    m.position.y === 0.5
  )
}

/**
 * 构建 CSS 3D transform 字符串。
 *
 * @param motion   运镜状态
 * @param cardW    卡片在画布中的基准宽度（px）
 * @param cardH    卡片在画布中的基准高度（px）
 * @param canvasW  画布宽度（px），用于把归一化 position 转为位移
 * @param canvasH  画布高度（px）
 */
export function buildScreenTransform(
  motion: ScreenMotionState,
  cardW: number,
  cardH: number,
  canvasW: number,
  canvasH: number
): string {
  const longEdge = Math.max(cardW, cardH, 1)
  const depth = clamp(motion.perspective, 0, 2)
  const cameraDistance = depth > 0 ? (longEdge * 2) / Math.max(depth, 0.0001) : 0

  // 归一化位置 → 相对中心的像素位移
  const dx = (motion.position.x - 0.5) * canvasW
  const dy = (motion.position.y - 0.5) * canvasH

  const parts: string[] = []
  if (cameraDistance > 0) parts.push(`perspective(${cameraDistance.toFixed(2)}px)`)
  if (dx || dy) parts.push(`translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`)
  if (motion.rotationZ) parts.push(`rotateZ(${motion.rotationZ.toFixed(3)}deg)`)
  if (motion.rotationY) parts.push(`rotateY(${motion.rotationY.toFixed(3)}deg)`)
  if (motion.rotationX) parts.push(`rotateX(${motion.rotationX.toFixed(3)}deg)`)
  if (motion.scale !== 1) parts.push(`scale(${motion.scale.toFixed(4)})`)
  return parts.join(' ') || 'none'
}

/**
 * 计算投影后的四边形（画布像素坐标）。
 *
 * 卡片基准矩形以画布中心为原点铺开后，应用 position 偏移，再交给
 * projectScreen 做 3D 投影。返回的 quad 用于命中测试与手柄绘制。
 */
export function projectCard(
  motion: ScreenMotionState,
  cardW: number,
  cardH: number,
  canvasW: number,
  canvasH: number
): ProjectedScreenQuad {
  const centerX = canvasW / 2 + (motion.position.x - 0.5) * canvasW
  const centerY = canvasH / 2 + (motion.position.y - 0.5) * canvasH
  const rect: CompositionRect = {
    x: centerX - (cardW * motion.scale) / 2,
    y: centerY - (cardH * motion.scale) / 2,
    width: cardW * motion.scale,
    height: cardH * motion.scale,
  }
  return projectScreen({
    rect,
    rotationX: motion.rotationX,
    rotationY: motion.rotationY,
    rotationZ: motion.rotationZ,
    perspective: motion.perspective,
    anchor: { x: centerX, y: centerY },
  })
}

/** 把画布像素坐标的四边形转成 SVG polygon 的 points 字符串。 */
export function quadToPolygonPoints(quad: ProjectedScreenQuad): string {
  return quad.corners.map((p: CompositionPoint) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}
