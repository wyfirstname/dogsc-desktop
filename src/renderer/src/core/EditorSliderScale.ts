/**
 * 滑块物理行程 —— Swift EditorSliderScale.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorSliderScale.swift（79 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - fraction(_:in:) 线性 / 对数（log1p 归一）        L9-19
 *   - value(_:in:) 反解（expm1，夹到上界）             L21-31
 *   - ticks(in:width:) 线性 1/2/5 台阶 + 对数 10^-3..10^6  L33-64
 *   - sliderScale(in:)：按值格式选比例                  L67-78
 *
 * 原注释：**只有物理行程变**——绑定、存储值与精确输入都保持参数原本的单位。
 * 这就是为什么倍数滑块的 1× 与 2× 在中段而不在 1/6 处，而存储的仍然是 1.0/2.0。
 *
 * 对数映射用 `log1p(delta/knee) / log1p(span/knee)`：让 0 附近保持有限斜率，
 * 因此膝盖（knee）以下的区间近似线性、以上近似对数 —— 直接 `log(delta)` 会在 0 处发散。
 */

export type EditorSliderScale =
  | { readonly kind: 'linear' }
  | { readonly kind: 'logarithmic'; readonly knee: number }

export const EDITOR_SLIDER_SCALE_LINEAR: EditorSliderScale = { kind: 'linear' }

/** 膝盖下限：0 或负值会让 `log1p` 除零，统一抬到 1e-6。 */
export const EDITOR_SLIDER_MINIMUM_KNEE = 0.000001

/** 刻度之间最小像素距离（低于它就丢弃，避免标签叠字）。 */
export const EDITOR_SLIDER_TICK_MINIMUM_SPACING = 38

export function logarithmicSliderScale(knee: number): EditorSliderScale {
  return { kind: 'logarithmic', knee }
}

/**
 * Swift `fraction(_:in:)`：值 → 0..1 行程。
 * span ≤ 0 或非有限值一律 0（滑块退化成一个点，不画 NaN 宽度）。
 */
export function sliderFraction(scale: EditorSliderScale, value: number, range: { lower: number; upper: number }): number {
  const span = range.upper - range.lower
  if (!(span > 0) || !Number.isFinite(value)) return 0
  const delta = Math.min(Math.max(value - range.lower, 0), span)
  if (scale.kind === 'linear') return delta / span
  const knee = Math.max(scale.knee, EDITOR_SLIDER_MINIMUM_KNEE)
  return Math.log1p(delta / knee) / Math.log1p(span / knee)
}

/** Swift `value(_:in:)`：0..1 行程 → 值。对数侧最后夹到上界（浮点可能略超）。 */
export function sliderValue(scale: EditorSliderScale, fraction: number, range: { lower: number; upper: number }): number {
  const clamped = Math.min(Math.max(fraction, 0), 1)
  const span = range.upper - range.lower
  if (!(span > 0)) return range.lower
  if (scale.kind === 'linear') return range.lower + clamped * span
  const knee = Math.max(scale.knee, EDITOR_SLIDER_MINIMUM_KNEE)
  return Math.min(range.lower + knee * Math.expm1(clamped * Math.log1p(span / knee)), range.upper)
}

/** 线性刻度的「1/2/5 × 10^n」台阶：不小于 `rawStep` 的最小档。 */
export function linearTickStep(span: number): number {
  const rawStep = span / 4
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const unit = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= rawStep) ?? 10
  return unit * magnitude
}

/**
 * Swift `ticks(in:width:)`。
 *
 * 结果恒以 `lowerBound` 开头、`upperBound` 结尾；中间候选按像素间距过滤：
 * 与上一个刻度相距 ≥ 38pt **且** 距右端 ≥ 38pt 才保留（后者保证末刻不会贴着边界）。
 */
export function sliderTicks(
  scale: EditorSliderScale,
  range: { lower: number; upper: number },
  width: number
): readonly number[] {
  const span = range.upper - range.lower
  if (!(span > 0)) return [range.lower]

  const candidates: number[] = []
  if (scale.kind === 'linear') {
    const step = linearTickStep(span)
    let mark = Math.ceil(range.lower / step) * step
    while (mark < range.upper) {
      candidates.push(mark)
      mark += step
    }
  } else {
    for (let exponent = -3; exponent <= 6; exponent += 1) {
      for (const multiplier of [1, 2, 5]) {
        const mark = multiplier * Math.pow(10, exponent)
        if (mark >= range.lower && mark <= range.upper) candidates.push(mark)
      }
    }
  }

  const result: number[] = [range.lower]
  for (const candidate of [...candidates].sort((a, b) => a - b)) {
    const x = sliderFraction(scale, candidate, range) * width
    const previousX = sliderFraction(scale, result[result.length - 1], range) * width
    if (x - previousX >= EDITOR_SLIDER_TICK_MINIMUM_SPACING && width - x >= EDITOR_SLIDER_TICK_MINIMUM_SPACING) {
      result.push(candidate)
    }
  }
  result.push(range.upper)
  return result
}

/** Swift `EditorSliderValueFormat`（取值来自参数检查器的值格式）。 */
export type EditorSliderValueFormat =
  | 'multiplier'
  | 'seconds'
  | 'points'
  | 'percent'
  | 'decibels'
  | 'angle'

/**
 * Swift L67-78：下界 < 0 一律线性（负值取对数没有意义）；
 * 倍数 knee=1、秒 knee=0.5、点 = `max(span/8, 1)`；
 * 透明度/音量/位置/带符号角度保持线性 —— 否则 50% 会落在奇怪的位置。
 */
export function sliderScaleForValueFormat(
  format: EditorSliderValueFormat,
  range: { lower: number; upper: number }
): EditorSliderScale {
  if (range.lower < 0) return EDITOR_SLIDER_SCALE_LINEAR
  switch (format) {
    case 'multiplier':
      return logarithmicSliderScale(1)
    case 'seconds':
      return logarithmicSliderScale(0.5)
    case 'points':
      return logarithmicSliderScale(Math.max((range.upper - range.lower) / 8, 1))
    default:
      return EDITOR_SLIDER_SCALE_LINEAR
  }
}
