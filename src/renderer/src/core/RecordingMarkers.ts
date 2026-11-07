/**
 * 录制标记 —— Swift RecordingMarkers.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/RecordingMarkers.swift（81 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - canAddRecordingMarker（四条件）                    L8-11
 *   - recordingMarkerSourceTime（主机时钟 → 源时间）      L13-19
 *   - addRecordingMarker（0.3s 去抖 + 递增编号）          L21-28
 *   - RecordingMarkerHotKey：签名 0x44474D4B、⌃⌥M        L31-80
 *
 * 原注释：注册快捷键可以在**其它应用里**触发生效，不需要事件拦截也不需要额外隐私授权；
 * 它的生命周期严格限制在「正在录制」期间。
 *
 * 迁移说明：Windows 侧用 RegisterHotKey 做同样的事；本文件搬「三态可用性 + 0.3s 去抖
 * + 编号取 max+1」这三条判定，注册本身由主进程完成。
 */

/** 快捷键签名 `'DGMK'`。 */
export const RECORDING_MARKER_HOTKEY_SIGNATURE = 0x4447_4d4b

/** 快捷键 id（同一签名下只有一个）。 */
export const RECORDING_MARKER_HOTKEY_ID = 1

/** 虚拟键码 M（Swift `kVK_ANSI_M`）。 */
export const RECORDING_MARKER_HOTKEY_KEY_CODE = 0x4d

/** 修饰键：Control + Option。 */
export const RECORDING_MARKER_HOTKEY_MODIFIERS = ['control', 'option'] as const

/** 连按/双击的忽略窗口：0.3 秒。这是「记一个提示点」，不是逐帧采样。 */
export const RECORDING_MARKER_DEBOUNCE_SECONDS = 0.3

export type RecorderPhaseName = 'setup' | 'preparing' | 'recording' | 'finishing'

export interface RecordingMarkerState {
  readonly phase: RecorderPhaseName
  readonly isPaused: boolean
  readonly isPauseTransitioning: boolean
  /** 主机时钟换算出的源时间；null 表示当前拿不到（还没写第一帧）。 */
  readonly sourceTime: number | null
}

/** Swift L8-11：四个条件必须同时成立。 */
export function canAddRecordingMarker(state: RecordingMarkerState): boolean {
  return (
    state.phase === 'recording' &&
    !state.isPaused &&
    !state.isPauseTransitioning &&
    state.sourceTime != null
  )
}

export interface RecordingMarkerLike {
  readonly sourceTime: number
  readonly number: number
}

/**
 * Swift L25：与上一个标记相距不足 0.3s 就丢弃 —— 键重复（按住不放）与双击
 * 会产生一批几乎同时的标记，那不是用户想要的。
 */
export function recordingMarkerIsTooSoon(
  markers: readonly RecordingMarkerLike[],
  sourceTime: number
): boolean {
  if (markers.length === 0) return false
  const previous = markers[markers.length - 1]
  return sourceTime - previous.sourceTime < RECORDING_MARKER_DEBOUNCE_SECONDS
}

/** Swift L26：编号取现有最大 +1（删除中间标记后不会复用编号）。 */
export function nextRecordingMarkerNumber(markers: readonly RecordingMarkerLike[]): number {
  let maximum = 0
  for (const marker of markers) {
    if (marker.number > maximum) maximum = marker.number
  }
  return maximum + 1
}

/**
 * `addRecordingMarker` 的完整判定：返回要追加的标记，或 null（不追加）。
 * 注意源时间还要求 `isFinite` —— 主机时钟在某些挂起状态下会给出 NaN。
 */
export function recordingMarkerToAppend(
  state: RecordingMarkerState,
  markers: readonly RecordingMarkerLike[]
): RecordingMarkerLike | null {
  if (!canAddRecordingMarker(state)) return null
  const sourceTime = state.sourceTime as number
  if (!Number.isFinite(sourceTime)) return null
  if (recordingMarkerIsTooSoon(markers, sourceTime)) return null
  return { sourceTime, number: nextRecordingMarkerNumber(markers) }
}

/** 快捷键只在录制期间注册（Swift `phase == .recording` 时 register，否则 unregister）。 */
export function recordingMarkerHotKeyShouldBeRegistered(phase: RecorderPhaseName): boolean {
  return phase === 'recording'
}

/** 注册成功后 UI 才能显示「⌃⌥M 可打点」的提示。 */
export function recordingMarkerShortcutAvailable(
  registered: boolean,
  registrationSucceeded: boolean
): boolean {
  return registered && registrationSucceeded
}
