/**
 * EditorCanvasDragFeedback —— 画布直接操作的读数徽标与吸附参考线。
 *
 * Swift source: Sources/DogSCApp/EditorCanvasDragFeedback.swift（259 行）@ 567fd6e
 *
 * 逐结构对照：
 *   L5-10    struct CanvasManipulationReadout（图标 / 标题 / 值 / objectY）
 *   L13-25   directCanvasManipulationSelection —— 八条优先级
 *   L27-29   isDirectCanvasManipulation
 *   L31-103  canvasManipulationFeedback（两条吸附线 + 交点圆点 + 读数徽标）
 *   L91-96   徽标高低的翻转规则（`objectY > 0.65` 时贴顶）
 *   L105-200 canvasManipulationReadout —— 按选中类型分派
 *   L202-217 normalizedPositionReadout / percent
 *   L219-233 canvasSnapGuide
 *   L235-258 clearCanvasManipulationPresentation —— 21 个字段 + 两个调度
 *
 * 迁移说明：
 *   这个文件几乎是纯展示，但它有三处「文案与阈值」是产品行为的载体，
 *   不能随手改：
 *     1. 读数徽标要**避开被拖的对象**：对象在下半屏就贴到顶部，
 *        否则会正好盖住手指看的地方。
 *     2. 百分比一律 `round(value × 100)`，不保留小数 —— 拖拽时小数位跳得
 *        让人头晕。
 *     3. 贴图旋转吸附到 ±180 / ±90 / 0 时显示「已吸附」，且精度从一位小数
 *        变成整数度。
 */

/** Swift L170：五个吸附角度。 */
export const CANVAS_MANIPULATION_SNAP_ANGLES: readonly number[] = [-180, -90, 0, 90, 180]

/** Swift L171：判定吸附的容差（度）。 */
export const CANVAS_MANIPULATION_SNAP_TOLERANCE = 0.001

/** Swift L93：`objectY > 0.65` 时徽标翻到顶部。 */
export const CANVAS_MANIPULATION_READOUT_FLIP_THRESHOLD = 0.65

/** Swift L94-95：徽标距画布上下边缘 22 点。 */
export const CANVAS_MANIPULATION_READOUT_EDGE_INSET = 22

/** Swift L79-90：徽标的排版常量。 */
export const CANVAS_MANIPULATION_READOUT_HEIGHT = 32
export const CANVAS_MANIPULATION_READOUT_CORNER_RADIUS = 9
export const CANVAS_MANIPULATION_READOUT_HORIZONTAL_PADDING = 12
export const CANVAS_MANIPULATION_READOUT_SPACING = 7
export const CANVAS_MANIPULATION_READOUT_DIVIDER_WIDTH = 1
export const CANVAS_MANIPULATION_READOUT_DIVIDER_HEIGHT = 13
export const CANVAS_MANIPULATION_READOUT_FONT_SIZE = 12
export const CANVAS_MANIPULATION_READOUT_BORDER_WIDTH = 0.75
export const CANVAS_MANIPULATION_READOUT_SHADOW_OPACITY = 0.25
export const CANVAS_MANIPULATION_READOUT_SHADOW_RADIUS = 6
export const CANVAS_MANIPULATION_READOUT_SHADOW_OFFSET_Y = 2
export const CANVAS_MANIPULATION_READOUT_BACKGROUND: readonly [number, number, number] = [
  0.11, 0.12, 0.13,
]
export const CANVAS_MANIPULATION_READOUT_BACKGROUND_ALPHA = 0.96
/** Swift L71-77：标题 0.82 白、分隔线 0.25 白、数值纯白。 */
export const CANVAS_MANIPULATION_TITLE_ALPHA = 0.82
export const CANVAS_MANIPULATION_DIVIDER_ALPHA = 0.25

/** Swift L55-61：吸附交点的圆点。 */
export const CANVAS_SNAP_DOT_SIZE = 7
export const CANVAS_SNAP_DOT_BORDER_WIDTH = 1.25
export const CANVAS_SNAP_DOT_SHADOW_OPACITY = 0.38
export const CANVAS_SNAP_DOT_SHADOW_RADIUS = 4

/** Swift L228-231：吸附参考线。 */
export const CANVAS_SNAP_GUIDE_WIDTH = 1
export const CANVAS_SNAP_GUIDE_DASH: readonly number[] = [3, 3]
export const CANVAS_SNAP_GUIDE_ALPHA = 0.88

/** Swift L5-10：一条读数。 */
export interface CanvasManipulationReadout {
  readonly systemImage: string
  readonly title: string
  readonly value: string
  readonly objectY: number
}

/**
 * Swift L13-25：八条优先级。
 *
 * 顺序即语义：缩放优先于拖动（同一个手势里两者都可能为真，缩放要赢，
 * 否则读数会在「大小」和「位置」之间闪）；贴图旋转优先于贴图缩放；
 * 马赛克的拖动与缩放最后，且只能退回 `editorStore.interaction?.selection`
 * —— 因为马赛克没有自己的 origin 作用域，它的选中项只能从交互里读。
 */
export interface CanvasManipulationFlags {
  readonly screenScaleOrigin: boolean
  readonly screenScaleSelection: string | null
  readonly screenDragOrigin: boolean
  readonly screenDragSelection: string | null
  readonly cameraSizeOrigin: boolean
  readonly cameraSizeSelection: string | null
  readonly cameraDragOrigin: boolean
  readonly cameraDragSelection: string | null
  readonly stickerRotationID: string | null
  readonly overlayResizeSelection: string | null
  readonly overlayDragSelection: string | null
  readonly mosaicDragOrResizeActive: boolean
  readonly interactionSelection: string | null
}

export function canvasManipulationDirectSelection(
  flags: CanvasManipulationFlags
): string | null {
  if (flags.screenScaleOrigin) return flags.screenScaleSelection
  if (flags.screenDragOrigin) return flags.screenDragSelection
  if (flags.cameraSizeOrigin) return flags.cameraSizeSelection
  if (flags.cameraDragOrigin) return flags.cameraDragSelection
  if (flags.stickerRotationID != null) return `sticker:${flags.stickerRotationID}`
  if (flags.overlayResizeSelection != null) return flags.overlayResizeSelection
  if (flags.overlayDragSelection != null) return flags.overlayDragSelection
  if (flags.mosaicDragOrResizeActive) return flags.interactionSelection
  return null
}

/**
 * Swift L91-96：徽标的 y。
 *
 * 对象在画布下部（`objectY > 0.65`）就贴到 `y = 22`；
 * 否则贴到底部 `max(height − 22, 22)` —— 外层夹取保证画布极矮时
 * 不会算出负数（那会让徽标跑到画布外）。
 */
export function canvasManipulationReadoutY(input: {
  readonly objectY: number
  readonly canvasHeight: number
}): number {
  if (input.objectY > CANVAS_MANIPULATION_READOUT_FLIP_THRESHOLD) {
    return CANVAS_MANIPULATION_READOUT_EDGE_INSET
  }
  return Math.max(
    input.canvasHeight - CANVAS_MANIPULATION_READOUT_EDGE_INSET,
    CANVAS_MANIPULATION_READOUT_EDGE_INSET
  )
}

/**
 * 定点格式化（Swift `String(format: "%.Nf", v)`）。
 *
 * 必须自己实现而不是 `toFixed` 了事：`toFixed` 对负零会输出 `-0.0`，
 * 角度恰好是 -0 时读数是「-0.0°」—— 而这个值在吸附判定里等于 0。
 */
export function canvasManipulationFixed(value: number, digits: number): string {
  const normalized = Object.is(value, -0) ? 0 : value
  return normalized.toFixed(digits)
}

/** Swift L215-217：`Int((value × 100).rounded())%`。 */
export function canvasManipulationPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** Swift L202-213：`X n% · Y n%`。 */
export function canvasManipulationPositionValue(point: {
  readonly x: number
  readonly y: number
}): string {
  return `X ${canvasManipulationPercent(point.x)} · Y ${canvasManipulationPercent(point.y)}`
}

/** Swift L154：`W n% · H n%`（马赛克区域大小）。 */
export function canvasManipulationMosaicSizeValue(rect: {
  readonly width: number
  readonly height: number
}): string {
  return `W ${canvasManipulationPercent(rect.width)} · H ${canvasManipulationPercent(rect.height)}`
}

/** Swift L161：`X n% · Y n%`（马赛克中心）。 */
export function canvasManipulationMosaicCenterValue(rect: {
  readonly x: number;
  readonly y: number
  readonly width: number
  readonly height: number
}): string {
  return canvasManipulationPositionValue({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  })
}

/** Swift L187：`W n%`（贴图宽度）。 */
export function canvasManipulationStickerWidthValue(width: number): string {
  return `W ${canvasManipulationPercent(width)}`
}

/**
 * Swift L169-181：贴图旋转读数。
 *
 * 吸附到五个角度之一（容差 0.001 度）时输出整数度 + 「已吸附」；
 * 否则输出一位小数。两套格式共用一个 format 字符串分支。
 */
export function canvasManipulationStickerRotationValue(rotationDegrees: number): string {
  const snapped = CANVAS_MANIPULATION_SNAP_ANGLES.some(
    (angle) => Math.abs(rotationDegrees - angle) < CANVAS_MANIPULATION_SNAP_TOLERANCE
  )
  return snapped
    ? `${canvasManipulationFixed(rotationDegrees, 0)}° · 已吸附`
    : `${canvasManipulationFixed(rotationDegrees, 1)}°`
}

/** Swift L135：摄像头大小读数（百分比整数）。 */
export function canvasManipulationCameraScaleValue(scale: number): string {
  return `${Math.round(scale * 100)}%`
}

/**
 * Swift L117：屏幕大小读数用 `EditorSliderValueFormat.compact(scale, unit: "×")`。
 *
 * 与摄像头那条**不一致**是上游的现状：屏幕缩放走通用数值格式化，
 * 摄像头走百分比。改统一会同时改变两处既有 UI，所以照抄。
 */
export function canvasManipulationScreenScaleValue(
  compact: (value: number, unit: string) => string,
  scale: number
): string {
  return compact(scale, '×')
}

/** Swift L109-125：屏幕分支的两条读数（缩放 / 位置）。 */
export function canvasManipulationScreenReadout(input: {
  readonly isScaling: boolean
  readonly position: { readonly x: number; readonly y: number }
  readonly scale: number
  readonly compact: (value: number, unit: string) => string
}): CanvasManipulationReadout {
  if (input.isScaling) {
    return {
      systemImage: 'arrow.up.left.and.arrow.down.right',
      title: '屏幕大小',
      value: canvasManipulationScreenScaleValue(input.compact, input.scale),
      objectY: input.position.y,
    }
  }
  return canvasManipulationPositionReadout('rectangle.on.rectangle', '屏幕位置', input.position)
}

/** Swift L127-143：摄像头分支的两条读数。 */
export function canvasManipulationCameraReadout(input: {
  readonly isScaling: boolean
  readonly position: { readonly x: number; readonly y: number }
  readonly scale: number
}): CanvasManipulationReadout {
  if (input.isScaling) {
    return {
      systemImage: 'arrow.up.left.and.arrow.down.right',
      title: '摄像头大小',
      value: canvasManipulationCameraScaleValue(input.scale),
      objectY: input.position.y,
    }
  }
  return canvasManipulationPositionReadout('video.fill', '摄像头位置', input.position)
}

/** Swift L202-213：位置读数的构造器（三处复用）。 */
export function canvasManipulationPositionReadout(
  systemImage: string,
  title: string,
  position: { readonly x: number; readonly y: number }
): CanvasManipulationReadout {
  return {
    systemImage,
    title,
    value: canvasManipulationPositionValue(position),
    objectY: position.y,
  }
}

/**
 * Swift L145-163：马赛克分支。
 *
 * `objectY` 用的是**区域中心**（`rect.y + height / 2`），不是左上角 ——
 * 徽标翻到哪一边要按用户看到的区域中心判断，用左上角会让高区域的徽标
 * 提前翻上去。
 */
export function canvasManipulationMosaicReadout(input: {
  readonly isResizing: boolean
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}): CanvasManipulationReadout {
  const objectY = input.rect.y + input.rect.height / 2
  if (input.isResizing) {
    return {
      systemImage: 'viewfinder',
      title: '区域大小',
      value: canvasManipulationMosaicSizeValue(input.rect),
      objectY,
    }
  }
  return {
    systemImage: 'viewfinder',
    title: '区域位置',
    value: canvasManipulationMosaicCenterValue(input.rect),
    objectY,
  }
}

/**
 * Swift L165-195：贴图分支，三条优先级：旋转 → 大小 → 位置。
 *
 * 旋转优先于大小：旋转把手在贴图外圈，拖动它时 `overlayResizeSelection`
 * 也可能同时为真（选中项相同），此时必须显示角度而不是宽度。
 */
export function canvasManipulationStickerReadout(input: {
  readonly isRotating: boolean
  readonly rotationDegrees: number
  readonly isResizing: boolean
  readonly width: number
  readonly position: { readonly x: number; readonly y: number }
}): CanvasManipulationReadout {
  if (input.isRotating) {
    return {
      systemImage: 'rotate.right',
      title: '贴图旋转',
      value: canvasManipulationStickerRotationValue(input.rotationDegrees),
      objectY: input.position.y,
    }
  }
  if (input.isResizing) {
    return {
      systemImage: 'photo',
      title: '贴图大小',
      value: canvasManipulationStickerWidthValue(input.width),
      objectY: input.position.y,
    }
  }
  return canvasManipulationPositionReadout('photo', '贴图位置', input.position)
}

/**
 * Swift L235-258：结束一次直接操作时要清空的 21 个字段（+ 两次预览清除调度）。
 *
 * 顺序按「作用域 → 尺寸 → 叠加层 → 马赛克 → 贴图 → 参考线 → 合成器抑制」
 * 排。漏掉任何一个的表现各不相同：漏 `canvasSnapGuideX` 会让参考线留在画面上，
 * 漏 `screenCompositorSuppressed` 会让预览一直停在低清。
 */
export const CANVAS_MANIPULATION_CLEAR_ORDER: readonly string[] = [
  'screenDragOrigin',
  'screenDragScope',
  'screenScaleOrigin',
  'screenScaleScope',
  'cameraDragOrigin',
  'cameraDragScope',
  'cameraSizeOrigin',
  'cameraSizeScope',
  'overlayDragOrigin',
  'overlayDragSelection',
  'mosaicDragOrigin',
  'mosaicResizeOrigin',
  'mosaicResizeCorner',
  'stickerResizeOrigin',
  'stickerRotationOrigin',
  'overlayResizeSelection',
  'canvasSnapGuideX',
  'canvasSnapGuideY',
  'screenCompositorSuppressed',
  'cameraCompositorSuppressed',
]

/** Swift L256-257：最后两次调度（清拖动预览）。 */
export const CANVAS_MANIPULATION_CLEAR_SCHEDULES: readonly string[] = [
  'scheduleScreenDragPreviewClear',
  'scheduleCameraDragPreviewClear',
]

/**
 * Swift L31-103：吸附参考线的两个端点。
 *
 * 竖线从 `(gx × w, 0)` 到 `(gx × w, h)`，横线从 `(0, gy × h)` 到 `(w, gy × h)`。
 * 归一化值直接乘画布尺寸 —— 吸附发生在归一化空间，画到屏幕上才换算。
 */
export function canvasSnapGuideSegments(input: {
  readonly guideX: number | null
  readonly guideY: number | null
  readonly canvasSize: { readonly width: number; readonly height: number }
}): {
  readonly vertical: { readonly from: { x: number; y: number }; readonly to: { x: number; y: number } } | null
  readonly horizontal: { readonly from: { x: number; y: number }; readonly to: { x: number; y: number } } | null
  readonly crossing: { readonly x: number; readonly y: number } | null
} {
  const vertical =
    input.guideX == null
      ? null
      : {
          from: { x: input.guideX * input.canvasSize.width, y: 0 },
          to: { x: input.guideX * input.canvasSize.width, y: input.canvasSize.height },
        }
  const horizontal =
    input.guideY == null
      ? null
      : {
          from: { x: 0, y: input.guideY * input.canvasSize.height },
          to: { x: input.canvasSize.width, y: input.guideY * input.canvasSize.height },
        }
  const crossing =
    input.guideX == null || input.guideY == null
      ? null
      : {
          x: input.guideX * input.canvasSize.width,
          y: input.guideY * input.canvasSize.height,
        }
  return { vertical, horizontal, crossing }
}

/** Swift L97：读数徽标关掉隐式动画 —— 拖拽时数字变也不能有过渡。 */
export function canvasManipulationSuppressesAnimation(): boolean {
  return true
}
