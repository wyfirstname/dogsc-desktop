/**
 * 元素运镜曲线样式 —— Swift EditorMotionCurveStyle.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorMotionCurveStyle.swift（27 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - ElementMotionCurve.editorTitle    L4-10  → editorMotionCurveTitle
 *   - ElementMotionCurve.editorSymbol   L12-18 → editorMotionCurveSymbol
 *   - ElementMotionCurve.editorDetail   L20-26 → editorMotionCurveDetail
 *
 * 文案逐字照搬；`editorSymbol` 是 SF Symbols 名，Windows 侧换图标集但语义保留
 * （顺滑 = 波形、利落 = 闪电、柔和 = 风）。
 */

import type { ElementMotionCurve } from './ElementMotion'

/** Swift L4-10。 */
export function editorMotionCurveTitle(curve: ElementMotionCurve): string {
  switch (curve) {
    case 'smooth':
      return '顺滑'
    case 'swift':
      return '利落'
    case 'gentle':
      return '柔和'
  }
}

/**
 * Swift L12-18。
 * 返回 SF Symbols 原名，便于与上游逐字对比；Windows 图标映射由视图层决定。
 */
export function editorMotionCurveSymbol(curve: ElementMotionCurve): string {
  switch (curve) {
    case 'smooth':
      return 'waveform.path'
    case 'swift':
      return 'bolt.fill'
    case 'gentle':
      return 'wind'
  }
}

/** Swift L20-26。 */
export function editorMotionCurveDetail(curve: ElementMotionCurve): string {
  switch (curve) {
    case 'smooth':
      return '均衡加减速，适合大多数元素。'
    case 'swift':
      return '快速进入并干净收尾，节奏更明确。'
    case 'gentle':
      return '起落更慢，适合较大的画面和样机。'
  }
}

/** 下拉项：标题 + 图标 + 说明（视图层直接渲染）。 */
export interface EditorMotionCurveOption {
  readonly curve: ElementMotionCurve
  readonly title: string
  readonly symbol: string
  readonly detail: string
}

export function editorMotionCurveOption(curve: ElementMotionCurve): EditorMotionCurveOption {
  return {
    curve,
    title: editorMotionCurveTitle(curve),
    symbol: editorMotionCurveSymbol(curve),
    detail: editorMotionCurveDetail(curve)
  }
}
