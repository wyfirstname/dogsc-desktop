/**
 * 录制窗口的无障碍标识符 —— Swift RecorderAccessibility.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/RecorderAccessibility.swift（10 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - phaseSetup / phasePreparing / phaseRecording / phaseFinishing  L2-5
 *   - permissionGate                                                L6
 *   - recordingPauseResume / recordingStop                          L8-9
 *
 * 迁移说明：Swift 侧这些字符串喂给 `accessibilityIdentifier`（XCUITest 与 VoiceOver
 * 都靠它定位）；Windows 侧对应 DOM `id` / `data-testid` / `aria-*`。**字面量必须与
 * 上游完全一致** —— 它们是测试契约，不是文案。
 */

export const RECORDER_ACCESSIBILITY_ID = {
  phaseSetup: 'recorder.phase.setup',
  phasePreparing: 'recorder.phase.preparing',
  phaseRecording: 'recorder.phase.recording',
  phaseFinishing: 'recorder.phase.finishing',
  permissionGate: 'recorder.permission-gate',
  recordingPauseResume: 'recorder.recording.pause-resume',
  recordingStop: 'recorder.recording.stop',
} as const

export type RecorderAccessibilityID =
  (typeof RECORDER_ACCESSIBILITY_ID)[keyof typeof RECORDER_ACCESSIBILITY_ID]

/** 录制阶段的四态（Swift 里是四个独立的 static let，没有枚举收口）。 */
export type RecorderAccessibilityPhase = 'setup' | 'preparing' | 'recording' | 'finishing'

/**
 * 阶段 → 标识符。Swift 侧由调用方按当前阶段手写选择，这里收成一个函数，
 * 避免拼错字符串（拼错不会编译报错，只会让 UI 测试找不到元素）。
 */
export function recorderPhaseAccessibilityID(phase: RecorderAccessibilityPhase): RecorderAccessibilityID {
  switch (phase) {
    case 'setup':
      return RECORDER_ACCESSIBILITY_ID.phaseSetup
    case 'preparing':
      return RECORDER_ACCESSIBILITY_ID.phasePreparing
    case 'recording':
      return RECORDER_ACCESSIBILITY_ID.phaseRecording
    case 'finishing':
      return RECORDER_ACCESSIBILITY_ID.phaseFinishing
  }
}
