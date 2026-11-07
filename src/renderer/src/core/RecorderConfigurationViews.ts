/**
 * 录制器配置弹层 —— 麦克风 / 摄像头 / 系统声音三个输入页、电平波形、
 * 保存页，以及摄像头预览图层。
 *
 * Swift source: Sources/DogSCApp/RecorderConfigurationViews.swift（348 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - enum RecorderInputKind                                  L7
 *   - struct RecorderInputPopover                             L9-161
 *     · title / isOn / enabled 三个按 kind 分支                 L12-26
 *     · body（Toggle 行 40 高、spacing 4）                      L29-46
 *     · microphone（设备列表 + 电平波形）                        L48-59
 *     · camera（预览 152 + 两个画面按钮 + 分辨率行 34）           L61-117
 *     · previewButton（28×28 圆）                              L119-131
 *     · systemAudio（全部 / 所选 App）                          L133-148
 *     · deviceList（空态「未发现设备」）                         L150-160
 *   - struct RecorderLevelWave（44 根柱、0.05s 时钟）            L165-193
 *   - struct RecorderSavePopover（宽 300）                      L198-309
 *     · codec 分段（高 30、圆角 15、内衬 2）                     L215-239
 *     · 画质行（高 36、缩进 20）                                L241-270
 *     · 隐藏桌面文件 / Dock 两个开关                            L271-272
 *     · rule / projectAction                                   L300-308
 *   - struct RecorderCameraPreview（NSViewRepresentable）        L311-317
 *   - final class RecorderCameraPreviewView                      L318-347
 *
 * 原注释（L44）：
 *   The list is always current when it opens; nobody should have to ask.
 *
 * 原注释（L74）：
 *   The two things done to the picture sit on the picture.
 *
 * 原注释（L163-164）：
 *   The last couple of seconds of the microphone, scrolling. Quiet rooms draw
 *   a resting line; speech draws itself.
 *
 * 原注释（L195-197）：
 *   Everything that is not needed for every take: where it goes, how it is
 *   encoded, old projects, the memo, and the way out. Controls explain
 *   themselves; there are no captions.
 *
 * 迁移说明：`@ObservedObject var model: AppModel` 在 TS 侧收敛成一个只读的
 * `RecorderConfigurationSnapshot`，弹层不再直接改模型，而是产出一串
 * `RecorderConfigurationIntent`，交给调用方去执行。这样纯逻辑可以单测，
 * 也不会出现「界面里藏着一个 setter」。
 *
 * 保留的硬数值：
 *   - Toggle 行 40 高、内衬 10、字号 15；
 *   - 摄像头预览 152 高、圆角 14、按钮 28×28、组内间距 6、内衬 8；
 *   - 分辨率行 34 高、圆角 10、箭头 9pt 粗体；
 *   - 保存页宽 300、codec 段 30 高、圆角 15、外衬 2；
 *   - 电平波形 44 根柱、间距 2.5、0.05 秒一次、阈值 0.03、增益 1.5、
 *     最小高度 2.5。
 */

import { colorToCSS, colorWithOpacity, type RecorderRGBA } from './EditorDesignTokens'
import {
  RECORDER_CANVAS,
  RECORDER_CHROME,
  RECORDER_FAINT,
  RECORDER_MEDIA_INK,
  RECORDER_MEDIA_OVERLAY,
  RECORDER_MINT,
  RECORDER_MUTED,
  RECORDER_ON_PRIMARY,
  RECORDER_PRIMARY_FILL,
  RECORDER_SELECTION,
  RECORDER_SILVER_ALPHA,
  RECORDER_WELL_ALPHA,
} from './RecorderSurfaceStyle'

// ---------------------------------------------------------------- 输入种类

/** Swift L7：三个输入来源。 */
export type RecorderInputKind = 'microphone' | 'camera' | 'systemAudio'

/** Swift L7：三个来源的固定顺序（弹层按这个顺序切换）。 */
export const RECORDER_INPUT_KINDS: readonly RecorderInputKind[] = [
  'microphone',
  'camera',
  'systemAudio',
] as const

/** 录制源：整屏 / 窗口，还是外接设备。 */
export type RecorderCaptureSource = 'screen' | 'device'

/** Swift L12-14：弹层标题。 */
export function recorderInputTitle(kind: RecorderInputKind, source: RecorderCaptureSource): string {
  switch (kind) {
    case 'microphone':
      return '麦克风'
    case 'camera':
      return '摄像头'
    case 'systemAudio':
    default:
      // 只有设备录制时才是「设备声音」；屏幕录制时是「系统声音」。
      return source === 'device' ? '设备声音' : '系统声音'
  }
}

/** 弹层需要读取的全部录制配置。 */
export interface RecorderConfigurationSnapshot {
  readonly source: RecorderCaptureSource
  readonly recordsMicrophone: boolean
  readonly recordsCamera: boolean
  readonly recordsSystemAudio: boolean
  readonly microphoneDeviceID: string | null
  readonly cameraDeviceID: string | null
  readonly cameraCaptureResolution: string | null
  readonly systemAudioScope: 'all' | 'selectedApplication'
  readonly selectedApplicationBundleIdentifier: string | null
  readonly selectedApplicationName: string | null
}

/** Swift L15-17：该输入当前是否打开。 */
export function recorderInputIsOn(kind: RecorderInputKind, snapshot: RecorderConfigurationSnapshot): boolean {
  switch (kind) {
    case 'microphone':
      return snapshot.recordsMicrophone
    case 'camera':
      return snapshot.recordsCamera
    case 'systemAudio':
    default:
      return snapshot.recordsSystemAudio
  }
}

/**
 * 弹层产出的意图。
 *
 * 对应 Swift L18-26 那个 `Binding<Bool>` 的 setter —— 它按 kind 分成三支，
 * 分别调模型上的三个不同方法。这里改成数据，调用方负责分派。
 */
export type RecorderConfigurationIntent =
  | { readonly kind: 'set-microphone-enabled'; readonly value: boolean; readonly deviceID: string | null }
  | { readonly kind: 'select-camera'; readonly deviceID: string | null }
  | { readonly kind: 'set-system-audio-enabled'; readonly value: boolean; readonly scope: 'all' | 'selectedApplication' }

/**
 * Swift L19-25：开关被点时的意图。
 *
 * 注意摄像头的分支（L22）：打开时选**第一个可用设备**，关闭时传 nil。
 * 它不是「设置一个布尔值」，所以这里必须带上设备 id。
 */
export function recorderInputToggleIntent(
  kind: RecorderInputKind,
  value: boolean,
  snapshot: RecorderConfigurationSnapshot,
  firstAvailableCameraID: string | null
): RecorderConfigurationIntent {
  switch (kind) {
    case 'microphone':
      return { kind: 'set-microphone-enabled', value, deviceID: snapshot.microphoneDeviceID }
    case 'camera':
      return { kind: 'select-camera', deviceID: value ? firstAvailableCameraID : null }
    case 'systemAudio':
    default:
      return { kind: 'set-system-audio-enabled', value, scope: snapshot.systemAudioScope }
  }
}

/** Swift L45：只有非系统声音页才在出现时刷新设备列表。 */
export function recorderInputRefreshesDevicesOnAppear(kind: RecorderInputKind): boolean {
  return kind !== 'systemAudio'
}

// ---------------------------------------------------------------- 行尺寸

/**
 * Swift L31-35：弹层最外层的排版。
 *
 * `spacing: 4` 是行与行之间；Toggle 行自身恒 40 高、水平内衬 10。
 */
export const RECORDER_INPUT_POPOVER_SPACING = 4
export const RECORDER_INPUT_TOGGLE_ROW_HEIGHT = 40
export const RECORDER_INPUT_TOGGLE_ROW_PADDING = 10
export const RECORDER_INPUT_TOGGLE_FONT_SIZE = 15
export const RECORDER_INPUT_TOGGLE_FONT_WEIGHT = 600

/**
 * Swift L53-54：麦克风电平波形块的位置。
 *
 * 高 40，左右内衬 10，上 8 下 6 —— 上下不对称，因为 Toggle 行已经提供了
 * 一段视觉呼吸，所以下面收一点。
 */
export const RECORDER_LEVEL_WAVE_HEIGHT = 40
export const RECORDER_LEVEL_WAVE_PADDING_HORIZONTAL = 10
export const RECORDER_LEVEL_WAVE_PADDING_TOP = 8
export const RECORDER_LEVEL_WAVE_PADDING_BOTTOM = 6

/**
 * Swift L66：摄像头预览高度 152。
 *
 * 152 ≈ 16:9 在 270 宽下的高度再往下取整，比设备列表一屏略高，
 * 让人能看清构图但不至于把分辨率选项挤出弹层。
 */
export const RECORDER_CAMERA_PREVIEW_HEIGHT = 152
export const RECORDER_CAMERA_PREVIEW_RADIUS = 14
export const RECORDER_CAMERA_PREVIEW_PADDING_HORIZONTAL = 10
export const RECORDER_CAMERA_PREVIEW_PADDING_TOP = 6

/**
 * Swift L75、L84：画面上那两个按钮。
 *
 * 组内间距 6、内衬 8；按钮本体 28×28 的圆。28 是「能点但不遮画面」的下限，
 * 再小就低于手指命中面积的经验值。
 */
export const RECORDER_CAMERA_PREVIEW_BUTTON_SPACING = 6
export const RECORDER_CAMERA_PREVIEW_BUTTON_PADDING = 8
export const RECORDER_CAMERA_PREVIEW_BUTTON_SIZE = 28
export const RECORDER_CAMERA_PREVIEW_BUTTON_FONT_SIZE = 11
export const RECORDER_CAMERA_PREVIEW_BUTTON_FONT_WEIGHT = 600
export const RECORDER_CAMERA_PREVIEW_BUTTON_PRESS_RADIUS = 14

/** Swift L87：预览出现的过渡缩放。 */
export const RECORDER_CAMERA_PREVIEW_INSERT_SCALE = 0.96

/**
 * Swift L88-105：分辨率折叠行。
 *
 * 34 高（比 Toggle 行矮 6），水平内衬 10，圆角 10；
 * 右侧箭头 9pt 粗体，展开时转 180°。
 */
export const RECORDER_RESOLUTION_ROW_HEIGHT = 34
export const RECORDER_RESOLUTION_ROW_PADDING = 10
export const RECORDER_RESOLUTION_ROW_RADIUS = 10
export const RECORDER_RESOLUTION_ROW_FONT_SIZE = 12
export const RECORDER_RESOLUTION_CHEVRON_SIZE = 9
export const RECORDER_RESOLUTION_CHEVRON_ROTATION = 180

/** Swift L98：箭头旋转角。 */
export function recorderChevronRotation(expanded: boolean): number {
  return expanded ? RECORDER_RESOLUTION_CHEVRON_ROTATION : 0
}

/** Swift L92：未选分辨率时的占位文案。 */
export const RECORDER_RESOLUTION_PLACEHOLDER = '采集分辨率'

/** Swift L108、L110：分辨率列表第一项永远是「自动」（对应 nil）。 */
export const RECORDER_RESOLUTION_AUTO_TITLE = '自动'

/** Swift L153：设备列表空态。 */
export const RECORDER_DEVICE_LIST_EMPTY_TITLE = '未发现设备'
export const RECORDER_DEVICE_LIST_EMPTY_PADDING_HORIZONTAL = 10
export const RECORDER_DEVICE_LIST_EMPTY_PADDING_VERTICAL = 8

/** Swift L147：系统声音页在总开关关闭时整体 0.4。 */
export const RECORDER_SYSTEM_AUDIO_DISABLED_OPACITY = 0.4

/** Swift L136：设备录制时的说明。 */
export const RECORDER_DEVICE_AUDIO_NOTE = '录制所选设备的声音'
export const RECORDER_DEVICE_AUDIO_NOTE_PADDING_HORIZONTAL = 10
export const RECORDER_DEVICE_AUDIO_NOTE_PADDING_VERTICAL = 6

// ---------------------------------------------------------------- 波形

/**
 * Swift L167-168：44 根柱、2.5 的间距、0.05 秒一拍。
 *
 * 44 根 × 0.05 秒 ≈ 2.2 秒，正是注释说的「最近两秒」。
 */
export const RECORDER_LEVEL_WAVE_SAMPLE_COUNT = 44
export const RECORDER_LEVEL_WAVE_BAR_SPACING = 2.5
export const RECORDER_LEVEL_WAVE_TICK_SECONDS = 0.05

/**
 * Swift L178：高于 0.03 才算「有声」。
 *
 * 这个阈值不是视觉阈值，是**麦克风底噪**阈值：安静房间里电平表的读数
 * 通常在 0.01 上下浮动，0.03 刚好把静止线留在 `faint` 上。
 */
export const RECORDER_LEVEL_WAVE_ACTIVE_THRESHOLD = 0.03

/** Swift L180：高度增益 1.5 倍，但夹到 1。 */
export const RECORDER_LEVEL_WAVE_HEIGHT_GAIN = 1.5

/** Swift L180：最矮 2.5pt —— 静止时也要看得见一条线。 */
export const RECORDER_LEVEL_WAVE_MIN_HEIGHT = 2.5

/** Swift L179：透明度从 0.35 线性升到 1（越新的柱越实）。 */
export const RECORDER_LEVEL_WAVE_MIN_OPACITY = 0.35
export const RECORDER_LEVEL_WAVE_OPACITY_RANGE = 0.65

/** Swift L173：单根柱的宽度。 */
export function recorderLevelWaveBarWidth(totalWidth: number, count = RECORDER_LEVEL_WAVE_SAMPLE_COUNT): number {
  if (count <= 0) return 1
  const spacingTotal = RECORDER_LEVEL_WAVE_BAR_SPACING * (count - 1)
  return Math.max(1, (totalWidth - spacingTotal) / count)
}

/** Swift L180：单根柱的高度。 */
export function recorderLevelWaveBarHeight(containerHeight: number, value: number): number {
  const scaled = Math.min(1, value * RECORDER_LEVEL_WAVE_HEIGHT_GAIN)
  return Math.max(RECORDER_LEVEL_WAVE_MIN_HEIGHT, containerHeight * scaled)
}

/** Swift L179：单根柱的透明度。 */
export function recorderLevelWaveBarOpacity(index: number, count = RECORDER_LEVEL_WAVE_SAMPLE_COUNT): number {
  if (count <= 1) return 1
  return RECORDER_LEVEL_WAVE_MIN_OPACITY + (RECORDER_LEVEL_WAVE_OPACITY_RANGE * index) / (count - 1)
}

/** Swift L178：有声是 mint，无声是 faint。 */
export function recorderLevelWaveBarColor(value: number, appearance: 'light' | 'dark'): RecorderRGBA {
  return value > RECORDER_LEVEL_WAVE_ACTIVE_THRESHOLD ? RECORDER_MINT : RECORDER_FAINT(appearance)
}

/**
 * Swift L186-188：一拍。丢掉最旧的一根，把新的（夹到 0..1）接到末尾。
 *
 * 注意夹取用的是 `min(max(value, 0), 1)` —— 负数与超 1 都要夹，
 * 因为电平源在启动瞬间可能给出 -inf 或 >1 的原始值。
 */
export function recorderLevelWavePush(samples: readonly number[], value: number): number[] {
  const next = samples.slice(1)
  next.push(Math.min(Math.max(value, 0), 1))
  return next
}

/** Swift L167：初始的 44 根全 0。 */
export function recorderLevelWaveInitialSamples(count = RECORDER_LEVEL_WAVE_SAMPLE_COUNT): number[] {
  return new Array<number>(count).fill(0)
}

/** Swift L185-190：一拍是否需要动画（减弱动态时直接换值）。 */
export function recorderLevelWaveAnimates(reduces: boolean): boolean {
  return !reduces
}

/** Swift L190：一拍动画的时长，与时钟周期一致。 */
export const RECORDER_LEVEL_WAVE_TICK_ANIMATION_DURATION = 0.05

// ---------------------------------------------------------------- 保存页

/**
 * Swift L204：保存页固定宽 300。
 *
 * 比输入页宽一档 —— 因为里面有文件名输入框、四个 codec 分段和两条长文案。
 */
export const RECORDER_SAVE_POPOVER_WIDTH = 300

/** Swift L205：外层 spacing 4，与输入页一致。 */
export const RECORDER_SAVE_POPOVER_SPACING = 4

/**
 * Swift L209-212：文件名输入框。
 *
 * 34 高、水平内衬 12、胶囊底（`well`）、外面再留 6/4。
 */
export const RECORDER_SAVE_TEXTFIELD_HEIGHT = 34
export const RECORDER_SAVE_TEXTFIELD_PADDING = 12
export const RECORDER_SAVE_TEXTFIELD_OUTER_HORIZONTAL = 6
export const RECORDER_SAVE_TEXTFIELD_OUTER_VERTICAL = 4
export const RECORDER_SAVE_TEXTFIELD_PLACEHOLDER = '自动命名'

/**
 * Swift L215-239：codec 分段控件。
 *
 * 每段 30 高、圆角 15（正好半高，所以是胶囊），外层 `silver` 胶囊底、
 * 内衬 2。选中段的底色是 `selection`，并且用 `matchedGeometryEffect`
 * 让它在切换时滑动。
 */
export const RECORDER_CODEC_SEGMENT_HEIGHT = 30
export const RECORDER_CODEC_SEGMENT_RADIUS = 15
export const RECORDER_CODEC_SEGMENT_OUTER_PADDING = 2
export const RECORDER_CODEC_SEGMENT_FONT_SIZE = 12

/** Swift L219：`proRes422` 显示成 `ProRes`，其它用 rawValue。 */
export function recorderCodecSegmentLabel(codec: string): string {
  return codec === 'proRes422' ? 'ProRes' : codec
}

/** Swift L233：选中段的无障碍值。 */
export const RECORDER_CODEC_SELECTED_AX_VALUE = '已选择'

/**
 * Swift L241-270：画质折叠行。
 *
 * 36 高（比分辨率行高 2）、内衬 8、图标槽 18、图标与文字间距 10；
 * 展开后的选项组左侧缩进 20，与图标槽对齐。
 */
export const RECORDER_QUALITY_ROW_HEIGHT = 36
export const RECORDER_QUALITY_ROW_PADDING = 8
export const RECORDER_QUALITY_ROW_ICON_SLOT = 18
export const RECORDER_QUALITY_ROW_SPACING = 10
export const RECORDER_QUALITY_ROW_FONT_SIZE = 13
export const RECORDER_QUALITY_GROUP_INDENT = 20
export const RECORDER_QUALITY_LABEL = '画质'

/** Swift L300-302：分隔线。 */
export const RECORDER_SAVE_RULE_HEIGHT = 1
export const RECORDER_SAVE_RULE_PADDING_HORIZONTAL = 8
export const RECORDER_SAVE_RULE_PADDING_VERTICAL = 6

/** Swift L292-294：帧率警告文案的字号与位置。 */
export const RECORDER_SAVE_WARNING_FONT_SIZE = 11
export const RECORDER_SAVE_WARNING_PADDING_HORIZONTAL = 8
export const RECORDER_SAVE_WARNING_PADDING_TOP = 4

/**
 * Swift L206、L271-272、L275-291：这一页的行动行。
 *
 * 顺序即渲染顺序；`separatorBefore` 用来在「选择位置 / 文件名」与
 * 「旧项目」之间、以及「备忘录」与「退出」之间插分隔线。
 */
export interface RecorderSaveActionSpec {
  readonly id: string
  readonly symbol: string
  readonly showsChevron: boolean
  readonly separatorBefore: boolean
}

export const RECORDER_SAVE_ACTION_SPECS: readonly RecorderSaveActionSpec[] = [
  { id: 'destination', symbol: 'folder.fill', showsChevron: true, separatorBefore: false },
  { id: 'open-project', symbol: 'tray.full', showsChevron: false, separatorBefore: true },
  { id: 'most-recent', symbol: 'clock.arrow.circlepath', showsChevron: false, separatorBefore: false },
  { id: 'recover', symbol: 'arrow.counterclockwise', showsChevron: false, separatorBefore: false },
  { id: 'screen-permission', symbol: 'lock.shield', showsChevron: false, separatorBefore: false },
  { id: 'memo', symbol: 'text.alignleft', showsChevron: false, separatorBefore: false },
  { id: 'quit', symbol: 'power', showsChevron: false, separatorBefore: true },
] as const

/** 保存页在某一刻的可变状态。 */
export interface RecorderSavePopoverState extends RecorderConfigurationSnapshot {
  readonly destinationName: string
  readonly recordingTitleDraft: string
  readonly captureCodec: string
  readonly captureResolutionLimit: string
  readonly hidesDesktopFiles: boolean
  readonly hidesDock: boolean
  readonly recentProjectCount: number
  readonly recoverableProjectCount: number
  readonly hasScreenRecordingPermission: boolean
  readonly memoVisible: boolean
  readonly frameRateWarningText: string | null
}

/** 一行行动的可渲染形态。 */
export interface RecorderSaveActionRow {
  readonly id: string
  readonly title: string
  readonly symbol: string
  readonly enabled: boolean
  readonly showsChevron: boolean
  readonly separatorBefore: boolean
}

/**
 * Swift L206-291：按当前状态算出这一页到底有哪几行。
 *
 * 四个条件行（最近项目 / 可恢复项目 / 录屏权限 / 帧率警告）只在需要时出现；
 * 「继续上次项目」与「恢复中断录制」尤其不能常驻 —— 一个永远灰着的
 * 菜单项比没有更让人困惑。
 */
export function recorderSaveActionRows(state: RecorderSavePopoverState): RecorderSaveActionRow[] {
  const rows: RecorderSaveActionRow[] = []
  for (const spec of RECORDER_SAVE_ACTION_SPECS) {
    let title: string
    let enabled = true
    switch (spec.id) {
      case 'destination':
        title = state.destinationName
        break
      case 'open-project':
        title = '打开项目…'
        break
      case 'most-recent':
        if (state.recentProjectCount <= 0) continue
        title = '继续上次项目'
        break
      case 'recover':
        if (state.recoverableProjectCount <= 0) continue
        title = '恢复中断录制'
        break
      case 'screen-permission':
        if (state.hasScreenRecordingPermission) continue
        title = '打开录屏权限设置'
        break
      case 'memo':
        title = state.memoVisible ? '收起备忘录' : '打开备忘录'
        break
      case 'quit':
        title = '退出DogSC'
        break
      default:
        continue
    }
    rows.push({ ...spec, title, enabled })
  }
  return rows
}

/** Swift L214：codec 分段是否出现 —— 设备录制时不出现（设备走另一条编码路径）。 */
export function recorderShowsCodecSegments(state: RecorderSavePopoverState): boolean {
  return state.source !== 'device'
}

/**
 * Swift L271-272：两个「隐藏」开关是否出现。
 *
 * 它们与 codec 同属「整屏录制才需要」的一组，所以判断条件相同。
 */
export function recorderShowsDesktopToggles(state: RecorderSavePopoverState): boolean {
  return state.source !== 'device'
}

/** 两个隐藏开关的标题与图标。 */
export const RECORDER_HIDE_DESKTOP_FILES_ROW = { title: '隐藏桌面文件', symbol: 'menubar.dock.rectangle' } as const
export const RECORDER_HIDE_DOCK_ROW = { title: '隐藏 Dock', symbol: 'dock.rectangle' } as const

/** Swift L292-294：帧率警告是否出现。 */
export function recorderShowsFrameRateWarning(state: RecorderSavePopoverState): boolean {
  return state.frameRateWarningText !== null && state.frameRateWarningText.length > 0
}

// ---------------------------------------------------------------- 系统声音页

/** Swift L138、L141：系统声音的两个范围。 */
export const RECORDER_SYSTEM_AUDIO_ALL_TITLE = '全部系统声音'
export const RECORDER_SYSTEM_AUDIO_APP_TITLE = '所选窗口 App'

/**
 * Swift L141-143：「所选窗口 App」这一行只在真的有选中 App 时可点，
 * 并且把 App 名作为副标题显示 —— 否则用户看不到自己到底选了谁。
 */
export function recorderSelectedAppRowEnabled(state: RecorderConfigurationSnapshot): boolean {
  return state.selectedApplicationBundleIdentifier !== null
}

/** 副标题（未选 App 时为 null）。 */
export function recorderSelectedAppSubtitle(state: RecorderConfigurationSnapshot): string | null {
  return state.selectedApplicationBundleIdentifier === null ? null : state.selectedApplicationName
}

// ---------------------------------------------------------------- 摄像头图层

/**
 * Swift L318-347：`AVSampleBufferDisplayLayer` 的等价物。
 *
 * 三件与画面直接相关的事：
 *   - `videoGravity = .resizeAspectFill`（裁剪填满，不留黑边）；
 *   - 背景色 `chrome × 0.06`（首帧到来之前那一块不是纯黑）；
 *   - 镜像用 `scaleX(−1)` 的仿射变换，绕图层中心翻转。
 */
export const RECORDER_CAMERA_PREVIEW_VIDEO_GRAVITY = 'resizeAspectFill' as const

/** Swift L326、L335：首帧前的底色。 */
export const RECORDER_CAMERA_PREVIEW_BACKGROUND_ALPHA = 0.06

/** Swift L321：默认镜像。 */
export const RECORDER_CAMERA_PREVIEW_DEFAULT_MIRRORED = true

/** Swift L343：镜像的仿射变换。 */
export function recorderCameraPreviewTransform(mirrored: boolean): readonly [number, number, number, number, number, number] {
  return mirrored ? [-1, 0, 0, 1, 0, 0] : [1, 0, 0, 1, 0, 0]
}

/**
 * Swift L340-344：布局时**禁止**隐式动画。
 *
 * 这一层每帧都在改 bounds/position，如果开着隐式动画，窗口一缩放
 * 画面就会「追着」走。所以 `CATransaction.setDisableActions(true)`。
 */
export const RECORDER_CAMERA_PREVIEW_DISABLES_LAYOUT_ACTIONS = true

/** Swift L341-342：图层居中。 */
export function recorderCameraPreviewLayerFrame(bounds: { width: number; height: number }): {
  x: number
  y: number
  width: number
  height: number
} {
  return { x: 0, y: 0, width: bounds.width, height: bounds.height }
}

/** Swift L342：position 取中点。 */
export function recorderCameraPreviewLayerPosition(bounds: { width: number; height: number }): { x: number; y: number } {
  return { x: bounds.width / 2, y: bounds.height / 2 }
}

/** Swift L346：卸载时先脱离 sink，再清空最后一帧。 */
export const RECORDER_CAMERA_PREVIEW_RELEASE_ORDER = ['detach-sink', 'flush-and-remove-image'] as const

/** Swift L334-337：外观切换时重算底色（`performAsCurrentDrawingAppearance`）。 */
export const RECORDER_CAMERA_PREVIEW_REDRAWS_ON_APPEARANCE_CHANGE = true

/** Swift L326、L335：实际底色。 */
export function recorderCameraPreviewBackground(appearance: 'light' | 'dark'): string {
  return colorToCSS(colorWithOpacity(RECORDER_CHROME(appearance), RECORDER_CAMERA_PREVIEW_BACKGROUND_ALPHA))
}

// ---------------------------------------------------------------- 画面按钮

/**
 * Swift L119-131：预览上的小圆钮。
 *
 * 选中（`active`）时用 `primaryFill × 0.95` + `onPrimary` 图标；
 * 未选中时用 `mediaOverlay` + `mediaInk` —— 后者是「压在任何像素上都可读」
 * 的那一对，注释（L46-47）专门交代过画面本身绝不被重新染色。
 */
export function recorderPreviewButtonStyle(
  active: boolean,
  appearance: 'light' | 'dark'
): { background: string; foreground: string; size: number; radius: number } {
  return {
    background: active
      ? colorToCSS(colorWithOpacity(RECORDER_PRIMARY_FILL(appearance), 0.95))
      : colorToCSS(RECORDER_MEDIA_OVERLAY(appearance)),
    foreground: active ? colorToCSS(RECORDER_ON_PRIMARY(appearance)) : colorToCSS(RECORDER_MEDIA_INK(appearance)),
    size: RECORDER_CAMERA_PREVIEW_BUTTON_SIZE,
    radius: RECORDER_CAMERA_PREVIEW_BUTTON_SIZE / 2,
  }
}

/** Swift L76、L79：两个画面按钮的符号与文案。 */
export const RECORDER_CAMERA_PREVIEW_ACTIONS = [
  { id: 'mirror', symbol: 'arrow.left.and.right', title: '镜像画面' },
  { id: 'effects', symbol: 'wand.and.stars', title: '系统视频效果…' },
] as const

/** Swift L79-82：系统视频效果会先关掉弹层，再打开系统面板。 */
export const RECORDER_CAMERA_EFFECTS_ORDER = ['dismiss-popover', 'show-system-video-effects'] as const

// ---------------------------------------------------------------- 颜色辅助

/** 输入页用的颜色（供 UI 层直接取）。 */
export function recorderConfigurationColors(appearance: 'light' | 'dark'): {
  muted: string
  faint: string
  well: string
  silver: string
  selection: string
  mint: string
  canvas: string
} {
  return {
    muted: colorToCSS(RECORDER_MUTED(appearance)),
    faint: colorToCSS(RECORDER_FAINT(appearance)),
    well: colorToCSS(colorWithOpacity(RECORDER_CHROME(appearance), RECORDER_WELL_ALPHA)),
    silver: colorToCSS(colorWithOpacity(RECORDER_CHROME(appearance), RECORDER_SILVER_ALPHA)),
    selection: colorToCSS(RECORDER_SELECTION(appearance)),
    mint: colorToCSS(RECORDER_MINT),
    canvas: colorToCSS(RECORDER_CANVAS(appearance)),
  }
}
