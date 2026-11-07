/**
 * Swift source: Sources/DogSCApp/EditorTimelineRecordingMarkers.swift（104 行）@ 567fd6e
 *
 * L5-14   → EditorRecordingMarker（label / timestamp）
 * L17-20  → recordingMarkers 派生
 * L28-56  → recordingMarkerRuler：可见索引 + 书签几何 + 偏移
 * L58-68  → seekRecordingMarker：跳转后按 24pt 边距滚入视野
 * L70-77  → removeRecordingMarker（先提交交互再整体替换工程 → 可撤销）
 * L82-96  → TimelineRecordingBookmarkShape（细书签，不是工具条按钮）
 * L98-104 → 按下态 0.55 不透明度
 */

/** 书签字形尺寸（`frame(width: 8, height: 10)`）。 */
export const MARKER_BOOKMARK_GLYPH_WIDTH = 8
export const MARKER_BOOKMARK_GLYPH_HEIGHT = 10

/** 命中区尺寸（`frame(width: 18, height: 20)`）。 */
export const MARKER_BOOKMARK_HIT_WIDTH = 18
export const MARKER_BOOKMARK_HIT_HEIGHT = 20

/** 水平偏移 = 时间比例 × 宽度 − 9（让 18pt 命中区居中在时间点上）。 */
export const MARKER_BOOKMARK_HALF_HIT = 9

/** 书签相对标尺顶部的垂直偏移（`timelineRulerHeight - 21`）。 */
export const MARKER_BOOKMARK_RULER_INSET = 21

/** 书签颜色 `Color(red: 0.65, green: 0.47, blue: 0.22)`。 */
export const MARKER_BOOKMARK_RGB = { red: 0.65, green: 0.47, blue: 0.22 } as const

/** 按下态不透明度。 */
export const MARKER_BOOKMARK_PRESSED_OPACITY = 0.55

/** 滚入视野的边距：距左右边界不足 24pt 才算「看不见」。 */
export const MARKER_SCROLL_MARGIN = 24
/** 滚动后把目标放在视口 40% 处（而不是正中间）。 */
export const MARKER_SCROLL_CENTER_FRACTION = 0.4

export interface RecordingMarkerLike {
  readonly id: string
  readonly number: number
}

export interface EditorRecordingMarker {
  readonly id: string
  readonly number: number
  readonly outputTime: number
  /** `标记 N`。 */
  readonly label: string
  /** `mm:ss.cc`，按 outputTime 向下取整到百分秒。 */
  readonly timestamp: string
}

/**
 * 时间戳（Swift L10-13）：先 `floor(outputTime × 100)` 再拆位。
 *
 * 负数一律夹到 0 —— 标记理论上不会落在 0 之前，但 reorder 草稿期间
 * `outputTime` 可能瞬时为负，格式化前必须兜住，否则会打印 `-1:59.99`。
 */
export function recordingMarkerTimestamp(outputTime: number): string {
  const value = Math.max(Math.floor(outputTime * 100), 0)
  const mm = Math.floor(value / 6000)
  const ss = Math.floor(value / 100) % 60
  const cc = value % 100
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cc).padStart(2, '0')}`
}

export function makeEditorRecordingMarker(
  marker: RecordingMarkerLike,
  outputTime: number
): EditorRecordingMarker {
  return {
    id: marker.id,
    number: marker.number,
    outputTime,
    label: `标记 ${marker.number}`,
    timestamp: recordingMarkerTimestamp(outputTime),
  }
}

/**
 * 只把落在可视时间范围内的标记交给渲染（Swift L32-33）。
 * 时间线可以有几百个标记，全量布局会让每帧都做一次 `offset` 计算。
 */
export function visibleRecordingMarkerIndices(
  markers: readonly { readonly outputTime: number }[],
  range: { readonly lower: number; readonly upper: number }
): number[] {
  const indices: number[] = []
  markers.forEach((marker, index) => {
    if (marker.outputTime >= range.lower && marker.outputTime <= range.upper) indices.push(index)
  })
  return indices
}

/** 书签的水平偏移（Swift L52-53）。 */
export function recordingMarkerOffsetX(input: {
  readonly outputTime: number
  readonly duration: number
  readonly width: number
}): number {
  return (input.outputTime / Math.max(input.duration, 0.001)) * input.width - MARKER_BOOKMARK_HALF_HIT
}

/**
 * 不显示标尺书签的条件（Swift L30）：恢复剪切模式，或正在裁切 / 重排草稿。
 *
 * 这三种状态下时间线上的位置与输出时间不一致，书签画上去会指错地方。
 */
export function recordingMarkerRulerHidden(input: {
  readonly isRestoreCutMode: boolean
  readonly hasTrimDraft: boolean
  readonly hasReorderDraft: boolean
}): boolean {
  return input.isRestoreCutMode || input.hasTrimDraft || input.hasReorderDraft
}

export interface MarkerScrollPlan {
  readonly scrolls: boolean
  readonly targetX: number
}

/**
 * 跳转后是否需要滚动（Swift L58-68）。
 *
 * 目标已经离边缘 ≥ 24pt 就**不动视口** —— 每次点标记都跳动视口比不滚更烦人。
 * 需要滚动时把目标放在视口 40% 处，留出右侧更多上下文。
 */
export function recordingMarkerScrollPlan(input: {
  readonly outputTime: number
  readonly timelineDuration: number
  readonly timelineContentWidth: number
  readonly viewportMinX: number
  readonly viewportMaxX: number
  readonly viewportWidth: number
  readonly documentWidth: number
}): MarkerScrollPlan {
  const x =
    (input.outputTime / Math.max(input.timelineDuration, 0.001)) * input.timelineContentWidth
  const visible =
    x >= input.viewportMinX + MARKER_SCROLL_MARGIN && x <= input.viewportMaxX - MARKER_SCROLL_MARGIN
  if (visible) return { scrolls: false, targetX: input.viewportMinX }
  const width = Math.max(input.documentWidth, input.viewportWidth)
  const proposed = x - input.viewportWidth * MARKER_SCROLL_CENTER_FRACTION
  return {
    scrolls: true,
    targetX: Math.min(Math.max(proposed, 0), Math.max(width - input.viewportWidth, 0)),
  }
}

/** 悬停提示与无障碍值：`标记 N · mm:ss.cc`。 */
export function recordingMarkerHelpText(marker: EditorRecordingMarker, timelineTimestamp: (time: number) => string): string {
  return `${marker.label} · ${timelineTimestamp(marker.outputTime)}`
}

export const RECORDING_MARKER_MENU_TEXT = {
  seek: '跳转到标记',
  remove: '删除录制标记',
} as const
