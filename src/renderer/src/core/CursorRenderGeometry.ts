/**
 * CursorRenderGeometry —— 光标的标准尺寸/热点摆放 + 点击反馈几何。
 *
 * Swift source: Sources/RecorderCore/CursorRenderGeometry.swift @ laogou717/dogsc 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct CursorAssetPoint / CursorAssetSize        L3-21   → 同名接口
 *   - struct CursorAssetMetrics                        L25-44  → CursorAssetMetrics
 *   - struct CursorClickGeometryFrame                  L46-109 → CursorClickGeometryFrame
 *   - struct CursorRenderLayout                        L111-136→ CursorRenderLayout
 *   - enum CursorRenderGeometry（layout / clickGeometry）
 *                                                      L141-358→ cursorRenderLayout / cursorClickGeometry
 *
 * 预览与导出都向这里传左上原点坐标；只有导出渲染器最后做一次 Y 轴转换。
 * 点击反馈在光标形状改变时仍沿用用户选择的尺寸。
 */

import type { CompositionPoint } from './CompositionGeometry'
import type { CursorClickEffectStyle } from './ProjectModel'
import type { HexColor } from './HexColor'

export interface CursorAssetPoint {
  x: number
  y: number
}

export interface CursorAssetSize {
  width: number
  height: number
}

/**
 * Swift CursorAssetMetrics（L25-44）。热点使用归一化图像坐标（左上原点）。
 * `scaleReferenceHeight` 是映射到用户标准光标尺寸的图像空间高度；系统形状
 * 共用箭头的参考值以保持原生比例。
 */
export interface CursorAssetMetrics {
  hotspot: CursorAssetPoint
  intrinsicSize: CursorAssetSize
  clickColor: HexColor
  scaleReferenceHeight: number
}

export function makeCursorAssetMetrics(init: {
  hotspot: CursorAssetPoint
  intrinsicSize: CursorAssetSize
  clickColor: HexColor
  scaleReferenceHeight?: number
}): CursorAssetMetrics {
  return {
    hotspot: init.hotspot,
    intrinsicSize: init.intrinsicSize,
    clickColor: init.clickColor,
    scaleReferenceHeight: init.scaleReferenceHeight ?? init.intrinsicSize.height,
  }
}

/** Swift CursorClickGeometryFrame（L46-109）。 */
export interface CursorClickGeometryFrame {
  style: CursorClickEffectStyle
  progress: number
  // 主外环 / 主形状
  primaryDiameter: number
  primaryLineWidth: number
  primaryOpacity: number
  primaryIsFilled: boolean
  primaryGlowRadius: number
  // 次级内部元素（火星点 / 内环 / 光芯）
  secondaryDiameter: number
  secondaryLineWidth: number
  secondaryOpacity: number
  secondaryIsFilled: boolean
  secondaryGlowRadius: number
  // 强调射线 / 迸射
  accentOffset: number
  accentSize: number
  accentOpacity: number
  /** 最大占位直径。 */
  maxFootprintDiameter: number
}

/** Swift CursorRenderLayout（L111-136）。 */
export interface CursorRenderLayout {
  /** 图像左上角原点，与指针同一坐标空间。 */
  origin: CompositionPoint
  size: CursorAssetSize
  pointer: CompositionPoint
  clickDiameter: number
  clickLineWidth: number
  /** 点击反馈在光标形状改变时仍用用户选择的尺寸。 */
  clickEffectHeight: number
}

/** Swift CursorRenderGeometry.canonicalHeight / canonicalShortEdge（L142-143）。 */
export const CURSOR_CANONICAL_HEIGHT = 44
export const CURSOR_CANONICAL_SHORT_EDGE = 1080

/**
 * Swift CursorRenderGeometry.layout(pointer:canvasShortEdge:styleSize:metrics:)（L145-185）。
 */
export function cursorRenderLayout(
  pointer: CompositionPoint,
  canvasShortEdge: number,
  styleSize: number,
  metrics: CursorAssetMetrics
): CursorRenderLayout | null {
  if (
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y) ||
    !Number.isFinite(canvasShortEdge) ||
    !(canvasShortEdge > 0) ||
    !Number.isFinite(metrics.hotspot.x) ||
    !Number.isFinite(metrics.hotspot.y) ||
    !Number.isFinite(metrics.intrinsicSize.width) ||
    !Number.isFinite(metrics.intrinsicSize.height) ||
    !(metrics.intrinsicSize.width > 0) ||
    !(metrics.intrinsicSize.height > 0) ||
    !Number.isFinite(metrics.scaleReferenceHeight) ||
    !(metrics.scaleReferenceHeight > 0)
  ) {
    return null
  }

  const multiplier = Math.min(Math.max(styleSize, 0.25), 6)
  const referenceHeight = Math.max(
    ((canvasShortEdge * CURSOR_CANONICAL_HEIGHT) / CURSOR_CANONICAL_SHORT_EDGE) * multiplier,
    1
  )
  const imageScale = referenceHeight / metrics.scaleReferenceHeight
  const height = metrics.intrinsicSize.height * imageScale
  const width = metrics.intrinsicSize.width * imageScale
  const hotspotX = Math.min(Math.max(metrics.hotspot.x, 0), 1)
  const hotspotY = Math.min(Math.max(metrics.hotspot.y, 0), 1)
  const lineWidth = Math.max(
    referenceHeight * 0.08,
    (canvasShortEdge * 2) / CURSOR_CANONICAL_SHORT_EDGE
  )
  return {
    origin: { x: pointer.x - width * hotspotX, y: pointer.y - height * hotspotY },
    size: { width, height },
    pointer,
    clickDiameter: referenceHeight * 1.45,
    clickLineWidth: lineWidth,
    clickEffectHeight: referenceHeight,
  }
}

function clickFrame(
  style: CursorClickEffectStyle,
  progress: number,
  frame: Omit<
    CursorClickGeometryFrame,
    'style' | 'progress' | 'maxFootprintDiameter' | 'accentOffset' | 'accentSize' | 'accentOpacity'
  > & {
    accentOffset?: number
    accentSize?: number
    accentOpacity?: number
    /** 显式最大占位直径；0 表示按主/次形状与强调射线推导。 */
    maxFootprintDiameter?: number
  }
): CursorClickGeometryFrame {
  const accentOffset = frame.accentOffset ?? 0
  const accentSize = frame.accentSize ?? 0
  const accentOpacity = frame.accentOpacity ?? 0
  const explicit = frame.maxFootprintDiameter ?? 0
  return {
    style,
    progress,
    primaryDiameter: frame.primaryDiameter,
    primaryLineWidth: frame.primaryLineWidth,
    primaryOpacity: frame.primaryOpacity,
    primaryIsFilled: frame.primaryIsFilled,
    primaryGlowRadius: frame.primaryGlowRadius,
    secondaryDiameter: frame.secondaryDiameter,
    secondaryLineWidth: frame.secondaryLineWidth,
    secondaryOpacity: frame.secondaryOpacity,
    secondaryIsFilled: frame.secondaryIsFilled,
    secondaryGlowRadius: frame.secondaryGlowRadius,
    accentOffset,
    accentSize,
    accentOpacity,
    // Swift init 的缺省推导（L105-107）。
    maxFootprintDiameter:
      explicit > 0
        ? explicit
        : Math.max(
            frame.primaryDiameter + frame.primaryGlowRadius * 2,
            frame.secondaryDiameter + frame.secondaryGlowRadius * 2,
            (accentOffset + accentSize) * 2
          ),
  }
}

/**
 * Swift CursorRenderGeometry.clickGeometry(style:progress:baseHeight:opacityMultiplier:scaleMultiplier:)（L187-357）。
 */
export function cursorClickGeometry(
  style: CursorClickEffectStyle,
  progress: number,
  baseHeight: number,
  opacityMultiplier = 1.0,
  scaleMultiplier = 1.0
): CursorClickGeometryFrame | null {
  if (style === ('none' as CursorClickEffectStyle) || !(progress >= 0) || !(progress <= 1) || !(baseHeight > 0)) return null

  const userScale = Math.min(Math.max(scaleMultiplier, 0.4), 3.0)
  const userOpacity = Math.min(Math.max(opacityMultiplier, 0.05), 1.0)
  const scaledHeight = baseHeight * userScale

  switch (style) {
    case 'ripple': {
      const e = 1.0 - Math.pow(1.0 - progress, 3.0)
      const primaryDiameter = scaledHeight * (0.45 + 1.45 * e)
      const primaryLineWidth = Math.max(scaledHeight * (0.075 - 0.04 * progress), 1.2)
      const primaryOpacity = Math.max(userOpacity * 0.95 * (1.0 - Math.pow(progress, 1.3)), 0)
      const primaryGlow = scaledHeight * 0.1 * (1.0 - progress)

      let secondaryDiameter: number
      let secondaryOpacity: number
      let secondaryIsFilled: boolean
      let secondaryGlow: number
      if (progress < 0.35) {
        const dotP = progress / 0.35
        secondaryDiameter = scaledHeight * 0.28 * (1.0 - dotP)
        secondaryOpacity = Math.max(userOpacity * 0.85 * (1.0 - dotP), 0)
        secondaryIsFilled = true
        secondaryGlow = scaledHeight * 0.08 * (1.0 - dotP)
      } else {
        secondaryDiameter = 0
        secondaryOpacity = 0
        secondaryIsFilled = false
        secondaryGlow = 0
      }

      return clickFrame('ripple', progress, {
        primaryDiameter,
        primaryLineWidth,
        primaryOpacity,
        primaryIsFilled: false,
        primaryGlowRadius: primaryGlow,
        secondaryDiameter,
        secondaryLineWidth: 0,
        secondaryOpacity,
        secondaryIsFilled,
        secondaryGlowRadius: secondaryGlow,
        maxFootprintDiameter: scaledHeight * 2.2,
      })
    }

    case 'glow': {
      let primaryDiameter: number
      let primaryOpacity: number
      if (progress < 0.18) {
        const pBloom = progress / 0.18
        primaryDiameter = scaledHeight * (0.75 + 0.5 * (1.0 - Math.pow(1.0 - pBloom, 2.0)))
        primaryOpacity = Math.max(userOpacity * 0.78 * pBloom, 0)
      } else {
        const pFade = (progress - 0.18) / 0.82
        primaryDiameter = scaledHeight * (1.25 + 0.55 * pFade)
        primaryOpacity = Math.max(userOpacity * 0.78 * (1.0 - Math.pow(pFade, 1.4)), 0)
      }
      const primaryGlow = scaledHeight * 0.3
      const secondaryDiameter = primaryDiameter * 0.5
      const secondaryOpacity = primaryOpacity * 0.75
      const secondaryGlow = scaledHeight * 0.18

      return clickFrame('glow', progress, {
        primaryDiameter,
        primaryLineWidth: 0,
        primaryOpacity,
        primaryIsFilled: true,
        primaryGlowRadius: primaryGlow,
        secondaryDiameter,
        secondaryLineWidth: 0,
        secondaryOpacity,
        secondaryIsFilled: true,
        secondaryGlowRadius: secondaryGlow,
        maxFootprintDiameter: scaledHeight * 2.2,
      })
    }

    case 'pulse': {
      const e = 1.0 - Math.pow(1.0 - progress, 2.5)
      const primaryDiameter = scaledHeight * (0.5 + 1.25 * e)
      const primaryLineWidth = Math.max(scaledHeight * 0.065, 1.2)
      const primaryOpacity = Math.max(userOpacity * 0.9 * (1.0 - progress), 0)
      const primaryGlow = scaledHeight * 0.1 * (1.0 - progress)

      let secondaryDiameter: number
      let secondaryLineWidth: number
      let secondaryOpacity: number
      let secondaryIsFilled: boolean
      let secondaryGlow: number
      if (progress <= 0.55) {
        const innerP = progress / 0.55
        const innerE = Math.sin(innerP * Math.PI)
        secondaryDiameter = scaledHeight * (0.25 + 0.45 * innerE)
        secondaryLineWidth = 0
        secondaryOpacity = Math.max(userOpacity * 0.55 * (1.0 - innerP), 0)
        secondaryIsFilled = true
        secondaryGlow = scaledHeight * 0.12 * (1.0 - innerP)
      } else {
        secondaryDiameter = 0
        secondaryLineWidth = 0
        secondaryOpacity = 0
        secondaryIsFilled = false
        secondaryGlow = 0
      }

      return clickFrame('pulse', progress, {
        primaryDiameter,
        primaryLineWidth,
        primaryOpacity,
        primaryIsFilled: false,
        primaryGlowRadius: primaryGlow,
        secondaryDiameter,
        secondaryLineWidth,
        secondaryOpacity,
        secondaryIsFilled,
        secondaryGlowRadius: secondaryGlow,
        maxFootprintDiameter: scaledHeight * 2.0,
      })
    }

    case 'burst': {
      const primaryDiameter = Math.max(scaledHeight * (0.35 - 0.18 * progress), 1.0)
      const primaryOpacity = Math.max(userOpacity * 0.95 * (1.0 - Math.pow(progress, 2.0)), 0)
      const primaryGlow = scaledHeight * 0.14 * (1.0 - progress)

      const secondaryDiameter = scaledHeight * (0.45 + 0.55 * progress)
      const secondaryLineWidth = Math.max(scaledHeight * 0.035, 1.0)
      const secondaryOpacity = Math.max(userOpacity * 0.55 * (1.0 - progress), 0)
      const secondaryGlow = scaledHeight * 0.08 * (1.0 - progress)

      const burstE = 1.0 - Math.pow(1.0 - progress, 2.0)
      const accentOffset = scaledHeight * (0.28 + 0.38 * burstE)
      const accentSize = Math.max(scaledHeight * 0.075 * (1.0 - progress), 1.2)
      const accentOpacity = Math.max(userOpacity * 0.85 * (1.0 - progress), 0)

      return clickFrame('burst', progress, {
        primaryDiameter,
        primaryLineWidth: 0,
        primaryOpacity,
        primaryIsFilled: true,
        primaryGlowRadius: primaryGlow,
        secondaryDiameter,
        secondaryLineWidth,
        secondaryOpacity,
        secondaryIsFilled: false,
        secondaryGlowRadius: secondaryGlow,
        accentOffset,
        accentSize,
        accentOpacity,
        maxFootprintDiameter: scaledHeight * 1.8,
      })
    }

    case 'none':
      return null
  }
}
