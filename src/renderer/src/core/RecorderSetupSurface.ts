/**
 * RecorderSetupSurface —— 录制前的「待机小岛」。
 *
 * Swift source: Sources/DogSCApp/RecorderSetupSurface.swift（269 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L8-110   struct RecorderSetupSurface（模式轮盘 + 三个输入图标 + 省略号 + 录制键）
 *   L10-15   `@AppStorage("recorder.capture-mode")` 与 `model.selectedCaptureSource` 的优先级
 *   L52-76   wheel —— 模式名 + 上下箭头，滚动/方向键/点击都能翻
 *   L78-91   recordButton
 *   L93-100  roll(step) —— 环绕取模与方向记忆
 *   L102-109 四种模式的显示名
 *   L114-149 RecorderModeGlyph / RecorderModeShape —— 18 格网格上的矢量字形
 *   L154-203 RecorderModeWheelInput / WheelView —— 滚动累积与方向键
 *   L207-221 RecorderInputGlyph —— 开/关两个 SF Symbol
 *   L225-244 RecorderMicrophoneGlyph —— 随输入电平张开的环
 *   L248-269 RecorderLevelBars —— 一组随电平跳动的细条
 *
 * 迁移说明：
 *   这一层是纯展示，但有三处数值逻辑值得单独断言：
 *     1. 模式轮盘的**环绕取模** `(index + step % count + count) % count`
 *        —— 负数步长与「步长大于总数」都要正确
 *     2. 滚轮累积：触控板与鼠标的 delta 相差 14 倍，一格 26 点
 *     3. 电平条的八段响应曲线（`[0.62, 1, 0.8, 0.5, 0.9, 0.7, 0.55, 0.95]`）
 *        让相邻的条高度不同，看起来才像真的在跳
 */

/** Swift L47：小岛高度 56 点。 */
export const RECORDER_SETUP_HEIGHT = 56
/** Swift L46：左右内边距 8。 */
export const RECORDER_SETUP_HORIZONTAL_PADDING = 8
/** Swift L34：输入图标组左移 6 点。 */
export const RECORDER_SETUP_INPUTS_LEADING = 6
/** Swift L43：录制键左移 4 点。 */
export const RECORDER_SETUP_RECORD_LEADING = 4
/** Swift L23-31 / L36-40：四个按钮都是 44×44。 */
export const RECORDER_SETUP_BUTTON_SIZE = 44
/** Swift L68-69：轮盘左 14、右 11、高 40。 */
export const RECORDER_WHEEL_LEADING = 14
export const RECORDER_WHEEL_TRAILING = 11
export const RECORDER_WHEEL_HEIGHT = 40
/** Swift L187：滚轮一格 26 点。 */
export const RECORDER_WHEEL_NOTCH = 26
/** Swift L186：鼠标滚轮（非精确）的放大倍数。 */
export const RECORDER_WHEEL_LINE_MULTIPLIER = 14
/** Swift L86-87：录制键 36 点红圆 + 12 点白心。 */
export const RECORDER_RECORD_DISC_DIAMETER = 36
export const RECORDER_RECORD_PIP_DIAMETER = 12
/** Swift L119：字形描边 = 尺寸 / 11。 */
export const RECORDER_MODE_GLYPH_STROKE_DIVISOR = 11
/** Swift L128：字形网格 18 格。 */
export const RECORDER_MODE_GLYPH_GRID = 18
/** Swift L230：麦克风环 30 点。 */
export const RECORDER_MICROPHONE_RING_SIZE = 30
/** Swift L235-236：环的缩放与透明度公式系数。 */
export const RECORDER_MICROPHONE_RING_BASE_SCALE = 0.78
export const RECORDER_MICROPHONE_RING_SCALE_GAIN = 0.34
export const RECORDER_MICROPHONE_RING_OPACITY_GAIN = 4
/** Swift L253：八段响应曲线。 */
export const RECORDER_LEVEL_BAR_RESPONSE: readonly number[] = [
  0.62, 1, 0.8, 0.5, 0.9, 0.7, 0.55, 0.95,
]
/** Swift L259：电平放大 1.6 倍后夹到 1。 */
export const RECORDER_LEVEL_BAR_GAIN = 1.6
/** Swift L261-262：条的宽 2.5、最小高 3、间距 2。 */
export const RECORDER_LEVEL_BAR_WIDTH = 2.5
export const RECORDER_LEVEL_BAR_MINIMUM_HEIGHT = 3
export const RECORDER_LEVEL_BAR_SPACING = 2
/** Swift L261：电平超过 0.02 才算「有声音」，条才变绿。 */
export const RECORDER_LEVEL_BAR_ACTIVE_THRESHOLD = 0.02

/** Swift L102-109：四种采集源的中文名。 */
export const RECORDER_CAPTURE_SOURCE_LABELS: Readonly<Record<string, string>> = {
  display: '显示器',
  window: '窗口',
  area: '区域',
  device: '设备',
}

/** Swift L94：轮盘可选的四种模式（顺序即轮盘顺序）。 */
export const RECORDER_CAPTURE_SOURCES: readonly string[] = [
  'display',
  'window',
  'area',
  'device',
]

/**
 * Swift L13-15：当前模式的来源优先级。
 *
 * `model.selectedCaptureSource ?? CaptureSource(rawValue: storedMode) ?? .display`
 *
 * 三层：模型里的当前值 > `@AppStorage` 里记下的上一个选择 > 显示器。
 * 中间那层是「重启 App 后仍然是上次选的窗口模式」的来源。
 */
export function recorderSetupMode(input: {
  readonly selectedCaptureSource: string | null
  readonly storedMode: string | null
}): string {
  if (input.selectedCaptureSource != null) return input.selectedCaptureSource
  if (input.storedMode != null && RECORDER_CAPTURE_SOURCES.includes(input.storedMode)) {
    return input.storedMode
  }
  return 'display'
}

/** Swift L102-109：取显示名。未知模式给空串（不抛错）。 */
export function recorderCaptureSourceLabel(mode: string): string {
  return RECORDER_CAPTURE_SOURCE_LABELS[mode] ?? ''
}

/**
 * Swift L93-100：轮盘翻一格。
 *
 * `(index + step % count + count) % count` —— 三步：先取步长模（允许 |step| > count），
 * 再加一遍 count 抵消负数，最后再取一次模。
 *
 * 注意 `step % count` 对 `step = 0` 是 0，但函数在 `step != 0` 才继续；
 * 而 `step = -count` 会得到 0，也就是「原地转一圈」。
 */
export interface RecorderWheelRoll {
  readonly nextIndex: number
  readonly nextMode: string
  readonly rollsForward: boolean
}

export function recorderWheelRoll(input: {
  readonly step: number
  readonly currentMode: string
  readonly sources?: readonly string[]
}): RecorderWheelRoll | null {
  const sources = input.sources ?? RECORDER_CAPTURE_SOURCES
  if (input.step === 0) return null
  const count = sources.length
  if (count === 0) return null
  const index = sources.indexOf(input.currentMode)
  if (index < 0) return null
  const nextIndex = ((index + (input.step % count)) % count + count) % count
  return {
    nextIndex,
    nextMode: sources[nextIndex]!,
    rollsForward: input.step > 0,
  }
}

/**
 * Swift L183-190：滚轮累积。
 *
 * 触控板报很多细小的 delta，鼠标滚轮报整行 —— 非精确滚动要乘 14 才等效。
 * 累积到 ±26 就发一步，并把 26 从累积量里**减掉**（不是清零）：
 * 清零会让快速滚动丢掉余量，一格一格地卡。
 */
export function recorderWheelTravel(input: {
  readonly travel: number
  readonly scrollingDeltaY: number
  readonly hasPreciseScrollingDeltas: boolean
  readonly phaseBegan: boolean
}): { readonly travel: number; readonly steps: readonly number[] } {
  let travel = input.phaseBegan ? 0 : input.travel
  const delta = input.hasPreciseScrollingDeltas
    ? input.scrollingDeltaY
    : input.scrollingDeltaY * RECORDER_WHEEL_LINE_MULTIPLIER
  travel += delta
  const steps: number[] = []
  while (travel >= RECORDER_WHEEL_NOTCH) {
    travel -= RECORDER_WHEEL_NOTCH
    steps.push(-1)
  }
  while (travel <= -RECORDER_WHEEL_NOTCH) {
    travel += RECORDER_WHEEL_NOTCH
    steps.push(1)
  }
  return { travel, steps }
}

/**
 * Swift L192-198：方向键。
 *
 * 125 = 下、124 = 右 → +1；126 = 上、123 = 左 → -1。其余交给 super。
 */
export function recorderWheelKeyStep(keyCode: number): number {
  if (keyCode === 125 || keyCode === 124) return 1
  if (keyCode === 126 || keyCode === 123) return -1
  return 0
}

/** Swift L181：单击 = 前进一格。 */
export function recorderWheelClickStep(): number {
  return 1
}

/**
 * Swift L230-236：麦克风环。
 *
 * `level` 在关闭时强制 0（不显示「听得见」的假象）；
 * 环的缩放 0.78 → 1.12，透明度是 `min(1, level × 4)` —— 乘 4 是为了让
 * 很轻的声音也能立刻看见（0.25 电平就满不透明）。
 */
export function recorderMicrophoneRing(input: {
  readonly meterValue: number
  readonly enabled: boolean
}): { readonly level: number; readonly scale: number; readonly opacity: number } {
  const level = input.enabled ? Math.min(Math.max(input.meterValue, 0), 1) : 0
  return {
    level,
    scale: RECORDER_MICROPHONE_RING_BASE_SCALE + RECORDER_MICROPHONE_RING_SCALE_GAIN * level,
    opacity: Math.min(1, level * RECORDER_MICROPHONE_RING_OPACITY_GAIN),
  }
}

/**
 * Swift L259：单条电平条的达成比例。
 *
 * `min(1, level × 1.6 × response[i % 8])` —— 乘 1.6 让中等人声就能推到顶，
 * 再乘八段曲线让相邻条的最终高度各不相同。
 */
export function recorderLevelBarReach(input: {
  readonly level: number
  readonly index: number
  readonly active: boolean
}): number {
  const level = input.active ? Math.min(Math.max(input.level, 0), 1) : 0
  const response =
    RECORDER_LEVEL_BAR_RESPONSE[input.index % RECORDER_LEVEL_BAR_RESPONSE.length]!
  return Math.min(1, level * RECORDER_LEVEL_BAR_GAIN * response)
}

/**
 * Swift L262：`3 + (height − 3) × reach`。
 *
 * 下限 3 点 —— 完全没声音时也要留一条可见的细线，否则「静音」与
 * 「组件没渲染」看起来一样。
 */
export function recorderLevelBarHeight(input: {
  readonly height: number
  readonly reach: number
}): number {
  return (
    RECORDER_LEVEL_BAR_MINIMUM_HEIGHT +
    (input.height - RECORDER_LEVEL_BAR_MINIMUM_HEIGHT) * input.reach
  )
}

/** Swift L261：是否算「有声音」—— 决定条是绿色还是淡色。 */
export function recorderLevelBarIsActive(level: number, active: boolean): boolean {
  if (!active) return false
  return Math.min(Math.max(level, 0), 1) > RECORDER_LEVEL_BAR_ACTIVE_THRESHOLD
}

/** Swift L214 / L238：图标开/关两个符号。 */
export function recorderInputGlyphSymbol(input: {
  readonly on: string
  readonly off: string
  readonly enabled: boolean
}): string {
  return input.enabled ? input.on : input.off
}

/** Swift L216：图标颜色角色。 */
export function recorderInputGlyphTone(enabled: boolean): 'ink' | 'faint' {
  return enabled ? 'ink' : 'faint'
}

/** Swift L242：电平的无障碍读数（百分比整数）。 */
export function recorderMicrophoneAccessibilityValue(meterValue: number): string {
  return `${Math.trunc(meterValue * 100)}%`
}

/** Swift L119：字形描边宽度。 */
export function recorderModeGlyphStrokeWidth(size: number): number {
  return size / RECORDER_MODE_GLYPH_STROKE_DIVISOR
}

/** Swift L128：字形的单位格 `rect.width / 18`。 */
export function recorderModeGlyphUnit(rectWidth: number): number {
  return rectWidth / RECORDER_MODE_GLYPH_GRID
}

/** Swift L129-132：字形里两套坐标助手（`r` 给矩形、`p` 给点）。 */
export function recorderModeGlyphRect(input: {
  readonly originX: number
  readonly originY: number
  readonly unit: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  return {
    x: input.originX + input.x * input.unit,
    y: input.originY + input.y * input.unit,
    width: input.width * input.unit,
    height: input.height * input.unit,
  }
}

export function recorderModeGlyphPoint(input: {
  readonly originX: number
  readonly originY: number
  readonly unit: number
  readonly x: number
  readonly y: number
}): { readonly x: number; readonly y: number } {
  return { x: input.originX + input.x * input.unit, y: input.originY + input.y * input.unit }
}

/**
 * Swift L134-146：四个字形各自的形状参数（便于回归对比「四个是不是同一家族」）。
 *
 * 共同点：显示器/窗口/设备都是 `addRoundedRect` + 一条横线；区域用
 * `CaptureViewfinder`。圆角半径都落在 2.4–2.6 格之间。
 */
export const RECORDER_MODE_GLYPH_SHAPES: Readonly<
  Record<string, { readonly rect: readonly [number, number, number, number]; readonly corner: number; readonly bar: readonly [number, number] }>
> = {
  display: { rect: [1.5, 2.5, 15, 10], corner: 2.4, bar: [6, 15.6] },
  window: { rect: [1.5, 3, 15, 12], corner: 2.6, bar: [4.6, 6.2] },
  device: { rect: [5, 1.5, 8, 15], corner: 2.4, bar: [8, 13.6] },
}

/** Swift L142：区域字形用取景框，不是圆角矩形。 */
export function recorderModeGlyphUsesViewfinder(mode: string): boolean {
  return mode === 'area'
}

/**
 * Swift L49：首次使用引导的开关。
 *
 * `phase == .setup && !showsRequiredPermissionGate` —— 权限门没关掉之前
 * 不弹引导，否则引导会盖在权限提示上。
 */
export function recorderSetupTourEnabled(input: {
  readonly phase: string
  readonly showsRequiredPermissionGate: boolean
}): boolean {
  return input.phase === 'setup' && !input.showsRequiredPermissionGate
}
