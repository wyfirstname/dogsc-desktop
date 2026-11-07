/**
 * 采集窗口层级与卡片定位 —— 层级算术的唯一所有者。
 *
 * Swift source: Sources/DogSCApp/CaptureWindowPresentationPolicy.swift（178 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - enum CaptureWindowPresentationRole            L4-9   → CaptureWindowPresentationRole
 *   - enum CaptureWindowLevelPolicy                 L14-39 → captureWindowLevel
 *   - overlayLevel / activeRecorderLevel            L15-20 → NS_WINDOW_LEVEL_*
 *   - enum CaptureOverlayScreenPolicy               L41-67
 *   - keyScreenIndex(pointer:screenFrames:)         L43-48 → captureOverlayKeyScreenIndex
 *   - largestIntersectionIndex(targetFrame:…)       L50-66 → captureLargestIntersectionIndex
 *   - enum CaptureSelectionCardPlacement            L73-142
 *   - edgeInset / attachmentGap                     L74-75 → CAPTURE_SELECTION_CARD_EDGE_INSET / …GAP
 *   - globalCenter(anchorFrame:cardSize:…)          L77-115 → captureSelectionCardGlobalCenter
 *   - localCenter(anchorFrame:cardSize:…)           L117-132 → captureSelectionCardLocalCenter
 *   - clamp(_:lower:upper:)                         L134-141 → clampCenter
 *   - enum RecorderCaptureSourceAccessibilityID     L144-158 → RECORDER_CAPTURE_SOURCE_ACCESSIBILITY_IDS
 *   - enum RecorderCaptureSourceAnchorResolver      L160-174 → recorderFrame（宿主读取）
 *   - let cameraPreviewWindowIdentifier             L176-178 → CAMERA_PREVIEW_WINDOW_IDENTIFIER
 *
 * 原注释（L11-13）：
 *   The only owner of capture-window level arithmetic. Selection and recording
 *   guides share one overlay band. Display/window/area selection hides the
 *   setup bar; preparation, recording and device setup keep controls above it.
 *
 * 原注释（L69-72）：
 *   Geometry for the device card that belongs to the recorder bar. The card is
 *   centred on the complete recorder bar and attached above/below it. Anchoring
 *   to the individual source button made Display and Device cards visibly drift
 *   left because those buttons live at the bar's leading edge.
 *
 * 迁移说明：`NSWindow.Level` 的绝对值在 Windows 侧由 `setAlwaysOnTop(true, level)`
 * 的档位表达；这里保留**相对关系**（浮起 / 浮起+1 / 浮起+2 / +3）。
 */

import { rectIntersection } from './EditorTextInputHitTesting'

export type { RectLike as CaptureIntersectionRect } from './EditorTextInputHitTesting'

/** macOS 的 `NSWindow.Level.floating`（NSFloatingWindowLevel = 3）。 */
export const NS_WINDOW_LEVEL_FLOATING = 3

/** Swift L15-17：覆盖层。 */
export const NS_WINDOW_LEVEL_CAPTURE_OVERLAY = NS_WINDOW_LEVEL_FLOATING + 1

/** Swift L18-20：活跃录制器。 */
export const NS_WINDOW_LEVEL_ACTIVE_RECORDER = NS_WINDOW_LEVEL_FLOATING + 2

/** Swift L4-9。 */
export type CaptureWindowPresentationRole =
  | { readonly kind: 'selectionOverlay' }
  | { readonly kind: 'recordingGuideOverlay' }
  | { readonly kind: 'recorderPanel'; readonly phase: AppPhase; readonly selectionActive: boolean }
  | { readonly kind: 'recorderMemo' }

/** 应用阶段（Swift `AppPhase`）。 */
export type AppPhase =
  | 'setup'
  | 'preparing'
  | 'recording'
  | 'finishing'
  | 'editor'
  | 'recordingComplete'

/**
 * Swift L22-38。
 *
 *   recorderMemo            → activeRecorder + 1（永远压在最上面）
 *   selectionOverlay / guide → overlay
 *   recorderPanel(setup, selectionActive)         → activeRecorder
 *   recorderPanel(preparing|recording)            → activeRecorder
 *   recorderPanel(setup 未选择 | finishing | editor | recordingComplete) → floating
 *
 * 设备卡片属于「setup + 已开始选择」这一格 —— 选区覆盖层必须盖在它上面，
 * 但录制中的控制条又必须盖在覆盖层上面，所以两者差了 1 级。
 */
export function captureWindowLevel(role: CaptureWindowPresentationRole): number {
  switch (role.kind) {
    case 'recorderMemo':
      return NS_WINDOW_LEVEL_ACTIVE_RECORDER + 1
    case 'selectionOverlay':
    case 'recordingGuideOverlay':
      return NS_WINDOW_LEVEL_CAPTURE_OVERLAY
    case 'recorderPanel': {
      if (role.phase === 'preparing' || role.phase === 'recording') {
        return NS_WINDOW_LEVEL_ACTIVE_RECORDER
      }
      if (role.phase === 'setup' && role.selectionActive) {
        return NS_WINDOW_LEVEL_ACTIVE_RECORDER
      }
      return NS_WINDOW_LEVEL_FLOATING
    }
  }
}

/**
 * Swift L43-48：
 *   screenFrames.firstIndex(where: { $0.contains(pointer) }) ?? screenFrames.indices.first
 *
 * 指针在缝隙里（显示器之间的空隙）时回退到**第一块**屏 —— 而不是 nil，
 * 因为覆盖层必须画在某块屏上。
 */
export function captureOverlayKeyScreenIndex(
  pointer: { readonly x: number; readonly y: number },
  screenFrames: readonly CaptureRect[]
): number | null {
  const index = screenFrames.findIndex((frame) => rectContains(frame, pointer))
  if (index >= 0) return index
  return screenFrames.length > 0 ? 0 : null
}

/**
 * Swift L50-66：取与目标矩形**相交面积最大**的那块屏。
 * 严格大于：面积并列时保留先出现的（复刻 `if area > bestArea`）。
 */
export function captureLargestIntersectionIndex(
  targetFrame: CaptureRect,
  screenFrames: readonly CaptureRect[]
): number | null {
  let bestIndex: number | null = null
  let bestArea = 0
  for (let index = 0; index < screenFrames.length; index += 1) {
    const intersection = rectIntersection(targetFrame, screenFrames[index])
    if (intersection === null) continue
    const area = intersection.width * intersection.height
    if (area > bestArea) {
      bestArea = area
      bestIndex = index
    }
  }
  return bestIndex
}

export interface CaptureRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface CaptureSize {
  readonly width: number
  readonly height: number
}

/** Swift L74-75。 */
export const CAPTURE_SELECTION_CARD_EDGE_INSET = 16
export const CAPTURE_SELECTION_CARD_ATTACHMENT_GAP = 12

/**
 * Swift L77-115。
 *
 *   1. 安全区 = visibleFrame 四边各内缩 16。
 *   2. 没有锚点（面板还没上屏）→ 落在可见区正中。
 *   3. 水平：以锚点中轴为中心，夹进 `[safe.minX + 半宽, safe.maxX − 半宽]`。
 *   4. 竖直：优先放**下方**（`anchor.minY − gap − 半高`），放不下再放上方，
 *      两者都放不下就把下方的值夹进安全区。
 *
 * 第 4 步的「优先下方」是产品决定：卡片从面板向下长出来，不遮挡菜单栏，
 * 也避免在屏幕顶部时把面板顶出可见区。
 */
export function captureSelectionCardGlobalCenter(input: {
  readonly anchorFrame: CaptureRect | null
  readonly cardSize: CaptureSize
  readonly visibleFrame: CaptureRect
}): { readonly x: number; readonly y: number } {
  const safe = insetRect(input.visibleFrame, CAPTURE_SELECTION_CARD_EDGE_INSET)
  const anchor = input.anchorFrame
  if (anchor === null || anchor.width <= 0 || anchor.height <= 0) {
    return { x: input.visibleFrame.x + input.visibleFrame.width / 2, y: input.visibleFrame.y + input.visibleFrame.height / 2 }
  }
  const halfWidth = input.cardSize.width / 2
  const halfHeight = input.cardSize.height / 2
  const minCenterX = safe.x + halfWidth
  const maxCenterX = safe.x + safe.width - halfWidth
  const centerX = clampCenter(anchor.x + anchor.width / 2, minCenterX, maxCenterX)

  const belowY = anchor.y - CAPTURE_SELECTION_CARD_ATTACHMENT_GAP - halfHeight
  const aboveY = anchor.y + anchor.height + CAPTURE_SELECTION_CARD_ATTACHMENT_GAP + halfHeight
  const minCenterY = safe.y + halfHeight
  const maxCenterY = safe.y + safe.height - halfHeight

  let centerY: number
  if (belowY >= minCenterY) {
    centerY = belowY
  } else if (aboveY <= maxCenterY) {
    centerY = aboveY
  } else {
    centerY = clampCenter(belowY, minCenterY, maxCenterY)
  }
  return { x: centerX, y: centerY }
}

/**
 * Swift L117-132：全局 → 屏内（AppKit 的左上原点）。
 *   x = global.x − screen.minX
 *   y = screen.maxY − global.y
 */
export function captureSelectionCardLocalCenter(input: {
  readonly anchorFrame: CaptureRect | null
  readonly cardSize: CaptureSize
  readonly screenFrame: CaptureRect
  readonly visibleFrame: CaptureRect
}): { readonly x: number; readonly y: number } {
  const global = captureSelectionCardGlobalCenter(input)
  return {
    x: global.x - input.screenFrame.x,
    y: input.screenFrame.y + input.screenFrame.height - global.y,
  }
}

/** Swift L134-141：安全区比卡片还窄时给中点，而不是返回一个上下界颠倒的夹取值。 */
export function clampCenter(value: number, lower: number, upper: number): number {
  if (!(lower <= upper)) return (lower + upper) / 2
  return Math.min(Math.max(value, lower), upper)
}

/** Swift L144-149。 */
export const RECORDER_CAPTURE_SOURCE_ACCESSIBILITY_IDS = {
  display: 'recorder.capture-source.display',
  window: 'recorder.capture-source.window',
  area: 'recorder.capture-source.area',
  device: 'recorder.capture-source.device',
} as const

export type CapturedSource = keyof typeof RECORDER_CAPTURE_SOURCE_ACCESSIBILITY_IDS

/** Swift L150-157。 */
export function recorderCaptureSourceAccessibilityID(source: CapturedSource): string {
  return RECORDER_CAPTURE_SOURCE_ACCESSIBILITY_IDS[source]
}

/** Swift L176-178。 */
export const CAMERA_PREVIEW_WINDOW_IDENTIFIER = 'cn.laogou.dogsc.camera-preview'

/** Swift L168-173：录制器主窗口的帧；空或零尺寸一律视为不可用。 */
export function recorderAnchorFrame(frame: CaptureRect | null): CaptureRect | null {
  if (frame === null) return null
  if (!(frame.width > 0) || !(frame.height > 0)) return null
  return frame
}

function insetRect(rect: CaptureRect, inset: number): CaptureRect {
  return {
    x: rect.x + inset,
    y: rect.y + inset,
    width: rect.width - inset * 2,
    height: rect.height - inset * 2,
  }
}

function rectContains(
  rect: CaptureRect,
  point: { readonly x: number; readonly y: number }
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/** `CGRect.intersection`：不相交返回 null（对应 `isNull / isEmpty`）。 */
/**
 * 迁移复用：`CGRect.intersection` 的唯一实现在 `EditorTextInputHitTesting`
 * （批次 14 已落地并断言过）。此处曾另写一份同名实现，esbuild 报
 * `Multiple exports with the same name`；两份几何一旦漂移就会出现
 * 「命中测试说相交、卡片定位说不相交」的诡异现象，所以改为复用。
 * `CaptureRect` 与 `RectLike` 结构相同（三个 number + width/height），可直接传入。
 */
export { rectIntersection } from './EditorTextInputHitTesting'
