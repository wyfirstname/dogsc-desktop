/**
 * 聚焦效果检查器 —— 运镜与屏幕 3D 片段共用的「聚焦 / 线性虚化」面板。
 *
 * Swift source: Sources/DogSCApp/EditorFocusEffectInspector.swift（135 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorFocusEffectInspector            L7-135
 *   - private var effect                           L13-21 → focusEffectInspectorSelectionEffect
 *   - private var isLinear                         L23-26 → focusEffectInspectorIsLinear
 *   - body（分区标题）                              L29     → focusEffectInspectorTitle
 *   - body（启用开关 + 无障碍标签）                  L35-39 → focusEffectInspectorToggleProposal / …AccessibilityLabel
 *   - body（线性：方向滑块）                         L43-51 → FOCUS_EFFECT_INSPECTOR_ROTATION_SLIDER
 *   - body（径向：目标分段控件 + 位置盘）             L53-77 → FOCUS_EFFECT_TARGET_TITLES / …PositionPadVisible
 *   - body（三个百分号滑块 + 暗角）                  L79-82 → FOCUS_EFFECT_INSPECTOR_SLIDERS / …SliderVisible
 *   - parameter(_:keyPath:range:effect:)           L87-98 → focusEffectInspectorSlider
 *   - update(_:)                                   L100-120 → normalizeFocusEffectForLinear / focusEffectInspectorUpdatedEffect
 *   - updateTextDraftValidity(_:)                  L122-129 → FOCUS_EFFECT_INSPECTOR_ACTION_NAME
 *   - commit()                                     L131-134 → FOCUS_EFFECT_INSPECTOR_ACTION_NAME
 *
 * 迁移说明：SwiftUI 的 body 由 React 端 <FocusEffectInspector> 承载；本文件保留
 * 取值公式、可见性决策与设计常量。`editorStore.beginContinuousInteraction` /
 * `updateInteraction` / `cancelInteraction` 属于编辑器事务，已由
 * EditorInteractionLifecycle.ts 承担，这里只输出「要下发什么」。
 */

import type { EditorSelection } from './EditorTimelineInteraction'
import type { RecorderProject } from './ProjectMediaModel'
import type { FocusEffect, FocusEffectTarget } from './FocusEffect'
import { FOCUS_EFFECT_TARGETS, makeFocusEffect } from './FocusEffect'
import type { NormalizedPoint } from './ZoomAnimation'

/** Swift L127 / L133：所有聚焦编辑共用同一个撤销动作名。 */
export const FOCUS_EFFECT_INSPECTOR_ACTION_NAME = '调整聚焦'

/** Swift L57-60 / L36 / L39：分段控件与无障碍文案。 */
export const FOCUS_EFFECT_TARGET_TITLES: Readonly<Record<FocusEffectTarget, string>> = {
  animation: '随运镜',
  pointer: '随鼠标',
  fixed: '固定',
}

/** Swift L29：分区标题。 */
export const FOCUS_EFFECT_INSPECTOR_TITLES = {
  radial: '聚焦',
  linear: '线性虚化',
} as const

/** Swift L39：开关的无障碍标签。 */
export const FOCUS_EFFECT_INSPECTOR_TOGGLE_LABELS = {
  radial: '启用聚焦',
  linear: '启用线性虚化',
} as const

/** Swift L43-51：线性模式下唯一的滑块（角度）。 */
export interface FocusEffectRotationSlider {
  readonly key: 'angleDegrees'
  readonly title: '方向'
  readonly min: 0
  readonly max: 360
  readonly format: 'degrees'
}

export const FOCUS_EFFECT_INSPECTOR_ROTATION_SLIDER: FocusEffectRotationSlider = {
  key: 'angleDegrees',
  title: '方向',
  min: 0,
  max: 360,
  format: 'degrees',
}

export type FocusEffectPercentKey = 'size' | 'blur' | 'softness' | 'dimming'

/** Swift L79-82：三个百分号滑块 + 暗角。顺序即渲染顺序。 */
export interface FocusEffectPercentSlider {
  readonly key: FocusEffectPercentKey
  readonly title: string
  readonly min: number
  readonly max: number
  readonly format: 'percent'
  /** 线性虚化隐藏暗角（Swift L82 `if !isLinear`）。 */
  readonly hiddenWhenLinear: boolean
}

export const FOCUS_EFFECT_INSPECTOR_SLIDERS: readonly FocusEffectPercentSlider[] = [
  { key: 'size', title: '清晰范围', min: 0.1, max: 1, format: 'percent', hiddenWhenLinear: false },
  { key: 'blur', title: '模糊程度', min: 0, max: 1, format: 'percent', hiddenWhenLinear: false },
  { key: 'softness', title: '羽化范围', min: 0, max: 1, format: 'percent', hiddenWhenLinear: false },
  { key: 'dimming', title: '暗角', min: 0, max: 1, format: 'percent', hiddenWhenLinear: true },
]

/**
 * Swift L13-21：按选中项取回当前的 FocusEffect。
 * 只有 zoom / screenMotion 两类选中项带聚焦效果；其余返回 null。
 */
export function focusEffectInspectorSelectionEffect(
  selection: EditorSelection | null,
  project: RecorderProject
): FocusEffect | null {
  if (selection === null) return null
  switch (selection.kind) {
    case 'zoom': {
      const clip = project.timeline.zoomClips.find((item) => item.id === selection.id)
      return clip?.focusEffect ?? null
    }
    case 'screenMotion': {
      const clip = project.timeline.screenMotionClips.find((item) => item.id === selection.id)
      return clip?.focusEffect ?? null
    }
    default:
      return null
  }
}

/**
 * Swift L23-26：
 *   if case .screenMotion = selection { return true }
 *   return effect?.shape == .linear
 *
 * 屏幕 3D 片段**永远**按线性虚化呈现 —— 即便 effect 为空或 shape 为 nil。
 */
export function focusEffectInspectorIsLinear(
  selection: EditorSelection | null,
  effect: FocusEffect | null
): boolean {
  if (selection !== null && selection.kind === 'screenMotion') return true
  return effect?.shape === 'linear'
}

/** Swift L29。 */
export function focusEffectInspectorTitle(isLinear: boolean): string {
  return isLinear ? FOCUS_EFFECT_INSPECTOR_TITLES.linear : FOCUS_EFFECT_INSPECTOR_TITLES.radial
}

/** Swift L39。 */
export function focusEffectInspectorAccessibilityLabel(isLinear: boolean): string {
  return isLinear
    ? FOCUS_EFFECT_INSPECTOR_TOGGLE_LABELS.linear
    : FOCUS_EFFECT_INSPECTOR_TOGGLE_LABELS.radial
}

/**
 * Swift L35-38：开关写入。
 *   set: { update($0 ? FocusEffect(linear: isLinear) : nil); commit() }
 * 打开时新建整套刻意缺省值（线性或径向），关闭时置 nil。
 */
export function focusEffectInspectorToggleProposal(
  isLinear: boolean,
  isOn: boolean
): FocusEffect | null {
  if (!isOn) return null
  return makeFocusEffect({ linear: isLinear })
}

/**
 * Swift L100-106：线性化归一 —— 在任何写入之前强制三件事。
 *   effect?.shape = .linear
 *   effect?.target = .fixed
 *   effect?.dimming = 0
 * 径向模式原样返回（同一个对象引用语义由调用方负责）。
 */
export function normalizeFocusEffectForLinear(
  effect: FocusEffect | null,
  isLinear: boolean
): FocusEffect | null {
  if (!isLinear || effect === null) return effect
  return { ...effect, shape: 'linear', target: 'fixed', dimming: 0 }
}

/**
 * Swift L107：`guard editorStore.selection == selection else { return }`。
 * 选择在拖拽过程中被别的操作改掉时，这一帧的写入必须丢弃。
 */
export function focusEffectInspectorAcceptsUpdate(
  storeSelection: EditorSelection | null,
  selection: EditorSelection | null
): boolean {
  return editorSelectionEqual(storeSelection, selection)
}

/** 选择相等：kind 相同且（需要时）id 相同。 */
export function editorSelectionEqual(
  a: EditorSelection | null,
  b: EditorSelection | null
): boolean {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind) return false
  const aID = 'id' in a ? a.id : null
  const bID = 'id' in b ? b.id : null
  return aID === bID
}

/**
 * Swift L43-51 / L62-67 / L70-76 / L89-97 的 onChanged 共同形状：
 * 复制一份、改一个字段、交给 update(_:)。始终返回**新对象**，
 * 因为 Swift 的 `var updated = effect` 是值拷贝。
 */
export function focusEffectInspectorSlider(
  effect: FocusEffect,
  key: FocusEffectPercentKey | 'angleDegrees',
  value: number
): FocusEffect {
  return { ...effect, [key]: value }
}

/** Swift L62-67：切换聚焦目标。 */
export function focusEffectInspectorTargetChange(
  effect: FocusEffect,
  target: FocusEffectTarget
): FocusEffect {
  return { ...effect, target }
}

/** Swift L70-76：位置盘拖动。 */
export function focusEffectInspectorCenterChange(
  effect: FocusEffect,
  center: NormalizedPoint
): FocusEffect {
  return { ...effect, center: { x: center.x, y: center.y } }
}

/** Swift L69-77：只有「固定」目标才显示聚焦位置盘，且线性模式没有目标概念。 */
export function focusEffectInspectorPositionPadVisible(
  effect: FocusEffect | null,
  isLinear: boolean
): boolean {
  if (isLinear || effect === null) return false
  return effect.target === 'fixed'
}

/** Swift L82：暗角在线性模式下隐藏；其余三个滑块始终可见。 */
export function focusEffectInspectorSliderVisible(
  slider: FocusEffectPercentSlider,
  isLinear: boolean
): boolean {
  return !(slider.hiddenWhenLinear && isLinear)
}

/** Swift L42-78：线性模式只显示方向滑块，不显示目标分段控件。 */
export function focusEffectInspectorTargetPickerVisible(isLinear: boolean): boolean {
  return !isLinear
}

/** 分段控件的选项顺序即 Swift `FocusEffectTarget.allCases`。 */
export function focusEffectInspectorTargetOptions(): FocusEffectTarget[] {
  return [...FOCUS_EFFECT_TARGETS]
}

/**
 * Swift L108-119：写入规划 —— 把「改哪一段的哪个字段」变成可断言的数据。
 * 找不到目标 id 时返回 null（Swift 里 guard 直接 return，不产生事务）。
 */
export interface FocusEffectInspectorWritePlan {
  readonly selectionKind: 'zoom' | 'screenMotion'
  readonly clipID: string
  readonly effect: FocusEffect | null
}

export function focusEffectInspectorWritePlan(
  selection: EditorSelection | null,
  proposed: FocusEffect | null
): FocusEffectInspectorWritePlan | null {
  if (selection === null) return null
  if (selection.kind !== 'zoom' && selection.kind !== 'screenMotion') return null
  return { selectionKind: selection.kind, clipID: selection.id, effect: proposed }
}

/** 把写入计划落到工程副本上；目标不存在时返回 false。 */
export function applyFocusEffectWritePlan(
  project: RecorderProject,
  plan: FocusEffectInspectorWritePlan
): boolean {
  if (plan.selectionKind === 'zoom') {
    const index = project.timeline.zoomClips.findIndex((item) => item.id === plan.clipID)
    if (index < 0) return false
    project.timeline.zoomClips[index].focusEffect = plan.effect
    return true
  }
  const index = project.timeline.screenMotionClips.findIndex((item) => item.id === plan.clipID)
  if (index < 0) return false
  project.timeline.screenMotionClips[index].focusEffect = plan.effect
  return true
}
