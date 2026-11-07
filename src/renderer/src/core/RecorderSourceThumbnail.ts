/**
 * 录制源缩略图 —— Swift RecorderSourceThumbnail.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/RecorderSourceThumbnail.swift（32 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - window 命中优先（desktopIndependentWindow）           L14-16
 *   - display 命中（排除自身进程的窗口）                     L17-20
 *   - 都没有 → nil                                          L21
 *   - config: width 256 / height 按宽高比 / 隐藏光标 / fit   L22-26
 *   - 捕获后再次检查取消                                    L28
 *
 * 原注释：这是**小尺寸、一次性**的真实源预览。没有磁盘缓存也没有采集循环 ——
 * 每次选择只请求一帧，并且排除自家的浮层窗口（否则截图里会拍到录制面板自己）。
 *
 * 迁移说明：ScreenCaptureKit 在 Windows 侧换成 desktopCapturer；本文件搬的是
 * 「选哪个源、要多大、要不要光标」这三条决策，采集本身由主进程端口完成。
 */

/** 缩略图固定宽度。 */
export const SOURCE_THUMBNAIL_WIDTH = 256

/** 高度下限：极端宽高比（如超宽屏 32:9 反算、或 0 宽）不能产生 0/负高度。 */
export const SOURCE_THUMBNAIL_MINIMUM_HEIGHT = 2

/** 缩略图不留光标（预览里出现光标会误导用户以为录制会拍到自己）。 */
export const SOURCE_THUMBNAIL_SHOWS_CURSOR = false

/** 缩放到贴合（不裁切）。 */
export const SOURCE_THUMBNAIL_SCALES_TO_FIT = true

/**
 * Swift L23-24：`height = max(2, Int(256 * h / max(w, 1)))`。
 * `Int()` 向零截断，因此这里用 `Math.trunc` 而不是四舍五入 —— 差 1px 会让
 * 缩略图与源比例出现可见的拉伸。
 */
export function sourceThumbnailSize(
  sourceWidth: number,
  sourceHeight: number
): { readonly width: number; readonly height: number } {
  const safeWidth = Math.max(sourceWidth, 1)
  const scaled = Math.trunc((SOURCE_THUMBNAIL_WIDTH * sourceHeight) / safeWidth)
  return {
    width: SOURCE_THUMBNAIL_WIDTH,
    height: Math.max(SOURCE_THUMBNAIL_MINIMUM_HEIGHT, scaled),
  }
}

export interface SourceThumbnailCandidate {
  readonly windowID: number | null
  readonly displayID: number | null
  readonly availableWindowIDs: readonly number[]
  readonly availableDisplayIDs: readonly number[]
}

export type SourceThumbnailTarget =
  | { readonly kind: 'window'; readonly windowID: number }
  | { readonly kind: 'display'; readonly displayID: number; readonly excludesOwnApplications: true }
  | null

/**
 * Swift L14-21 的源选择：窗口优先（用户在列表里点了某个窗口就是想要那个窗口），
 * 其次显示器（此时必须排除自身进程的窗口，否则缩略图里会拍到自己的浮层），
 * 两者都不可用返回 null（调用方显示占位而不是旧图）。
 */
export function resolveSourceThumbnailTarget(candidate: SourceThumbnailCandidate): SourceThumbnailTarget {
  if (candidate.windowID != null && candidate.availableWindowIDs.includes(candidate.windowID)) {
    return { kind: 'window', windowID: candidate.windowID }
  }
  if (candidate.displayID != null && candidate.availableDisplayIDs.includes(candidate.displayID)) {
    return { kind: 'display', displayID: candidate.displayID, excludesOwnApplications: true }
  }
  return null
}
