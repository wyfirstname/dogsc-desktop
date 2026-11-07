/**
 * 文本输入命中测试 —— Swift EditorTextInputHitTesting.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorTextInputHitTesting.swift（60 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - class EditorTextInputRegion            L7-17   → textInputRegionContains
 *   - struct EditorTextInputRegionAnchor     L19-31  → 视图挂载（React 侧）
 *   - class EditorTextInputAnchorView        L33-36  → 锚点视图永不参与命中
 *   - enum EditorTextInputHitTesting         L39-59  → targetsTextInput
 *
 * 原注释（L4-5）：
 *   A live window-space region, independent of SwiftUI's private text-field
 *   wrappers and AppKit's shared field editor. It never intercepts mouse events.
 *
 * 为什么需要它：SwiftUI 的未裁剪宿主祖先可能报告比锚点更大的 `visibleRect`，
 * 而活动的 field editor 可能被临时重挂到 `NSTextField` 之外。两者都会让
 * 「点到了输入框吗」这件事判错，进而破坏插入符定位与选区。
 */

export interface RectLike {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function rectContains(rect: RectLike, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/** Swift `CGRect.intersection`；不相交时返回 null。 */
export function rectIntersection(a: RectLike, b: RectLike): RectLike | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const maxX = Math.min(a.x + a.width, b.x + b.width)
  const maxY = Math.min(a.y + a.height, b.y + b.height)
  if (!(maxX > x) || !(maxY > y)) return null
  return { x, y, width: maxX - x, height: maxY - y }
}

/**
 * Swift L10-16：
 *   窗口必须是同一个；命中区取 `bounds ∩ visibleRect`（限制到真实输入框范围），
 *   注意 `CGRect.null` 与任何点都不相交。
 */
export function textInputRegionContains(
  region: { readonly bounds: RectLike; readonly visibleRect: RectLike },
  event: { readonly windowID: number; readonly locationInWindow: { x: number; y: number } },
  regionWindowID: number | null
): boolean {
  if (regionWindowID == null) return false
  if (event.windowID !== regionWindowID) return false
  const visible = rectIntersection(region.bounds, region.visibleRect)
  if (visible == null) return false
  return rectContains(visible, event.locationInWindow)
}

/** 命中链上的一次节点（AppKit 的 NSView 等价物）。 */
export interface TextInputHitCandidate {
  readonly isEditableTextField: boolean
  readonly isEditableTextView: boolean
  readonly parent: TextInputHitCandidate | null
}

/**
 * Swift L40-58 的纯逻辑版本。
 *
 * 两条判据：
 *   1. 活动 field editor（可能已被重挂到输入框之外）自身可见区内命中 → 直接算
 *      「点到了文本输入」，以保护插入符定位与选区；
 *   2. 否则从命中节点沿父链向上，遇到可编辑 `NSTextField` / `NSTextView` 即算命中。
 */
export function targetsTextInput(input: {
  pointInWindow: { x: number; y: number }
  /** 活动 field editor 的可见命中矩形（无活动编辑器时为 null） */
  fieldEditorBounds: RectLike | null
  /** `contentView.hitTest(...)` 返回的顶层节点（未命中为 null） */
  hitCandidate: TextInputHitCandidate | null
}): boolean {
  if (input.fieldEditorBounds != null && rectContains(input.fieldEditorBounds, input.pointInWindow)) {
    return true
  }
  let candidate = input.hitCandidate
  while (candidate != null) {
    if (candidate.isEditableTextField) return true
    if (candidate.isEditableTextView) return true
    candidate = candidate.parent
  }
  return false
}
