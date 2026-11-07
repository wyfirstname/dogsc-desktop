/**
 * 场景样式预设 —— 一套可复用的「呈现默认值」快照，以及它的存取。
 *
 * Swift source: Sources/DogSCApp/EditorStylePresetStore.swift（146 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct EditorStylePreset                      L7-97
 *   - var includesCrop                              L23    → editorStylePresetIncludesCrop
 *   - init(id:name:project:sourceDimensions:…)      L25-47 → makeEditorStylePreset
 *   - applying(to:backgroundOverride:)（画布）       L56-64 → applyEditorStylePreset
 *   - applying(to:backgroundOverride:)（其它）       L65-74 → applyEditorStylePreset
 *   - matchesConfiguration(of:zoomCreationScale:)   L77-82 → editorStylePresetMatchesConfiguration
 *   - hasAvailableBackground                        L84-87 → editorStylePresetHasAvailableBackground
 *   - backgroundIsAvailable(_:)                     L89-96 → editorStylePresetBackgroundIsAvailable
 *   - enum EditorStylePresetStore                   L100-145
 *   - load() / save(_:)                             L109-118 → load / save
 *   - defaultPresetID                               L120-123 → defaultPresetID
 *   - rememberLastUsedStyle(from:)                  L127-132 → rememberLastUsedStyle
 *   - applyingLastUsedStyle(to:)                    L134-145 → applyingLastUsedStyle
 *
 * 原注释（L4-6）：
 *   A reusable scene configuration. Media, cuts, timed animations and recording
 *   clock corrections stay with the project; all static presentation defaults
 *   travel together, including crop and camera visibility.
 *
 * 迁移说明：`UserDefaults(suiteName:)` + `JSONEncoder` 在 Windows 侧对应主进程
 * 的 `app.getPath('userData')/editor-style-presets.json`；这里用
 * `EditorStylePresetStoragePort` 抽象读写，便于断言。
 */

import type {
  AudioStyle,
  BackgroundSource,
  CameraStyle,
  CanvasDimensions,
  CanvasStyle,
  CursorStyle,
  OpeningSequence,
} from './ProjectModel'
import type { MotionStyle } from './MotionStyle'
import type { RecorderProject } from './ProjectMediaModel'
import type { ScenePresetBackgroundAsset } from './ScenePresetBackgroundAsset'
import { scenePresetBackgroundSource } from './ScenePresetBackgroundAsset'

/** Swift L102：沿用旧键，用户的预设要能扛过这次覆盖度升级。 */
export const EDITOR_STYLE_PRESET_KEY = 'editor-style-presets-v1'

/** Swift L103。 */
export const EDITOR_LAST_USED_STYLE_KEY = 'editor-last-used-style-v1'

/** Swift L104。 */
export const EDITOR_DEFAULT_PRESET_ID_KEY = 'editor-scene-preset.default-id'

/** Swift L41：新预设的格式版本。2 = 包含裁切与摄像头可见性。 */
export const EDITOR_STYLE_PRESET_FORMAT_VERSION = 2

/** Swift L129：记住「上次使用」时显式降级为 1，让裁切**不**跟着走。 */
export const EDITOR_LAST_USED_STYLE_FORMAT_VERSION = 1

/** Swift L128：隐式快照的名字。 */
export const EDITOR_LAST_USED_STYLE_NAME = '上次使用'

/** Swift L7-21。 */
export interface EditorStylePreset {
  id: string
  name: string
  canvas: CanvasStyle
  camera: CameraStyle
  motion: MotionStyle
  cursor: CursorStyle
  includesBackground: boolean
  /** 缺省表示「老的部分预设」，1 视为不含裁切。 */
  formatVersion?: number | null
  sourceDimensions?: CanvasDimensions | null
  audio?: AudioStyle | null
  opening?: OpeningSequence | null
  backgroundAsset?: ScenePresetBackgroundAsset | null
}

/** 深拷贝：Swift 的值语义（`var result = baseline` 之后改它不影响入参）。 */
function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(cloneValue) as unknown as T
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = cloneValue(item)
  }
  return out as T
}

/** 结构相等（Swift `Equatable` 的等价物）：键序无关、数组有序。 */
export function styleValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    return a.every((item, index) => styleValueEqual(item, b[index]))
  }
  const aKeys = Object.keys(a as Record<string, unknown>).sort()
  const bKeys = Object.keys(b as Record<string, unknown>).sort()
  if (aKeys.length !== bKeys.length) return false
  if (!aKeys.every((key, index) => key === bKeys[index])) return false
  return aKeys.every((key) =>
    styleValueEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key]
    )
  )
}

/**
 * Swift L23：`(formatVersion ?? 1) >= 2`。
 * 缺字段**不等于** false —— 缺字段表示这是老预设，所以按 1 解释。
 */
export function editorStylePresetIncludesCrop(preset: EditorStylePreset): boolean {
  return (preset.formatVersion ?? 1) >= 2
}

export interface EditorStylePresetInit {
  readonly id?: string
  readonly name: string
  readonly project: RecorderProject
  readonly sourceDimensions?: CanvasDimensions | null
  readonly zoomCreationScale?: number | null
}

/**
 * Swift L25-47。
 *
 * 两点值得记住：
 *   1. L37：`motion.defaultZoomScale = project.motion.defaultZoomScale ?? zoomCreationScale`
 *      —— 工程自己有值时工程优先，否则退到调用方给的创建倍率。
 *   2. L43-46：背景是 projectImage/projectVideo 时 `includesBackground = false`，
 *      因为工程私有媒体不能跟着预设走（只有系统图/视频或图案才能）。
 */
export function makeEditorStylePreset(input: EditorStylePresetInit): EditorStylePreset {
  const project = input.project
  const motion: MotionStyle = cloneValue(project.motion)
  motion.defaultZoomScale = project.motion.defaultZoomScale ?? input.zoomCreationScale ?? null
  const includesBackground =
    project.canvas.backgroundSource.kind === 'projectImage' ||
    project.canvas.backgroundSource.kind === 'projectVideo'
      ? false
      : true
  return {
    id: input.id ?? '',
    name: input.name,
    canvas: cloneValue(project.canvas),
    camera: cloneValue(project.camera),
    motion,
    cursor: cloneValue(project.cursorStyle),
    includesBackground,
    audio: cloneValue(project.audio),
    opening: cloneValue(project.openingSequence),
    formatVersion: EDITOR_STYLE_PRESET_FORMAT_VERSION,
    sourceDimensions: input.sourceDimensions ?? null,
    backgroundAsset: null,
  }
}

/**
 * Swift L51-75。
 *
 * 背景的三重闸门（L58-63）：
 *   1. 有 backgroundOverride → 用它（调用方在提交命令前已做工程私有拷贝）。
 *   2. 否则若「不含背景」或「有预设资产」或「当前背景不可用」→ 保留 baseline 的背景。
 *      —— 绝不把一条坏路径落到工程里。
 *   3. 其余情况才用预设自己的背景。
 *
 * 裁切与摄像头可见性的保留（L57 / L66）与 includesCrop 严格绑定：
 * 隐式的「上次使用」（formatVersion = 1）永远不会覆盖用户的裁切。
 */
export function applyEditorStylePreset(input: {
  readonly preset: EditorStylePreset
  readonly baseline: RecorderProject
  readonly backgroundOverride?: BackgroundSource | null
  /** 判断系统图片/视频背景是否还在磁盘上。缺省视为「都在」。 */
  readonly fileExists?: (path: string) => boolean
}): RecorderProject {
  const preset = input.preset
  const baseline = input.baseline
  const fileExists = input.fileExists ?? (() => true)
  const result = cloneValue(baseline)
  const appliedCanvas: CanvasStyle = cloneValue(preset.canvas)
  const includesCrop = editorStylePresetIncludesCrop(preset)
  if (!includesCrop) appliedCanvas.crop = cloneValue(baseline.canvas.crop)

  const override = input.backgroundOverride ?? null
  if (override !== null) {
    appliedCanvas.backgroundSource = override
  } else if (
    !preset.includesBackground ||
    (preset.backgroundAsset ?? null) !== null ||
    !editorStylePresetBackgroundIsAvailable(appliedCanvas.backgroundSource, fileExists)
  ) {
    appliedCanvas.backgroundSource = cloneValue(baseline.canvas.backgroundSource)
  }

  result.canvas = appliedCanvas
  result.camera = cloneValue(preset.camera)
  if (!includesCrop) result.camera.isHidden = baseline.camera.isHidden
  result.motion = cloneValue(preset.motion)
  if (result.motion.defaultZoomScale === null || result.motion.defaultZoomScale === undefined) {
    result.motion.defaultZoomScale = baseline.motion.defaultZoomScale ?? null
  }
  result.cursorStyle = cloneValue(preset.cursor)
  if (preset.audio !== null && preset.audio !== undefined) {
    result.audio = cloneValue(preset.audio)
  }
  if (preset.opening !== null && preset.opening !== undefined) {
    result.openingSequence = cloneValue(preset.opening)
  }
  return result
}

/**
 * Swift L77-82：拿工程现炒一份同样形状的预设再逐字段比。
 * 注意比较项**不含** includesBackground / formatVersion / backgroundAsset ——
 * 这是「配置是否一致」，不是「对象是否完全相同」。
 */
export function editorStylePresetMatchesConfiguration(
  preset: EditorStylePreset,
  project: RecorderProject,
  zoomCreationScale: number | null = null
): boolean {
  const current = makeEditorStylePreset({
    id: preset.id,
    name: preset.name,
    project,
    zoomCreationScale,
  })
  return (
    styleValueEqual(preset.canvas, current.canvas) &&
    styleValueEqual(preset.camera, current.camera) &&
    styleValueEqual(preset.motion, current.motion) &&
    styleValueEqual(preset.cursor, current.cursor) &&
    styleValueEqual(preset.audio, current.audio) &&
    styleValueEqual(preset.opening, current.opening)
  )
}

/**
 * Swift L84-87：
 *   if let backgroundAsset { return backgroundAsset.isAvailable }
 *   return includesBackground && backgroundIsAvailable(canvas.backgroundSource)
 *
 * 有资产就以资产为准（工程私有的那份拷贝在不在），没有资产才看背景源本身。
 */
export function editorStylePresetHasAvailableBackground(input: {
  readonly preset: EditorStylePreset
  readonly assetDirectory?: string
  readonly fileExists?: (path: string) => boolean
}): boolean {
  const fileExists = input.fileExists ?? (() => true)
  const asset = input.preset.backgroundAsset ?? null
  if (asset !== null) {
    const path = scenePresetAssetPathOrNull(asset, input.assetDirectory ?? '')
    return path !== null && fileExists(path)
  }
  if (!input.preset.includesBackground) return false
  return editorStylePresetBackgroundIsAvailable(input.preset.canvas.backgroundSource, fileExists)
}

/** Swift L89-96：只有系统图/视频需要碰磁盘；工程私有的永远不可用（不属于预设）。 */
export function editorStylePresetBackgroundIsAvailable(
  source: BackgroundSource,
  fileExists: (path: string) => boolean
): boolean {
  switch (source.kind) {
    case 'systemImage':
      return fileExists(source.absolutePath)
    case 'systemVideo':
      return fileExists(source.absolutePath)
    case 'projectImage':
    case 'projectVideo':
      return false
    case 'pattern':
    case 'dynamicFlow':
      return true
  }
}

function scenePresetAssetPathOrNull(
  asset: ScenePresetBackgroundAsset,
  directory: string
): string | null {
  const filename = asset.filename
  if (filename === '') return null
  if (filename.includes('/') || filename.includes('\\')) return null
  if (filename === '.' || filename === '..') return null
  return `${directory.replace(/[\\/]+$/, '')}/${filename}`
}

// ---------------------------------------------------------------- 存取

/** Swift L105-107 的 `UserDefaults(suiteName:)` 抽象。 */
export interface EditorStylePresetStoragePort {
  read(key: string): string | null
  write(key: string, value: string | null): void
}

/** Swift L109-114：解不开就当空列表，不抛。 */
export function loadEditorStylePresets(
  storage: EditorStylePresetStoragePort
): EditorStylePreset[] {
  const raw = storage.read(EDITOR_STYLE_PRESET_KEY)
  if (raw === null || raw === '') return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as EditorStylePreset[]
  } catch {
    return []
  }
}

/** Swift L116-118：save 会抛 —— 磁盘写失败必须让调用方知道。 */
export function saveEditorStylePresets(
  storage: EditorStylePresetStoragePort,
  presets: EditorStylePreset[]
): void {
  storage.write(EDITOR_STYLE_PRESET_KEY, JSON.stringify(presets))
}

/** Swift L120-123。 */
export function readDefaultPresetID(storage: EditorStylePresetStoragePort): string | null {
  const raw = storage.read(EDITOR_DEFAULT_PRESET_ID_KEY)
  return raw === null || raw === '' ? null : raw
}

export function writeDefaultPresetID(
  storage: EditorStylePresetStoragePort,
  id: string | null
): void {
  storage.write(EDITOR_DEFAULT_PRESET_ID_KEY, id)
}

/**
 * Swift L125-132。
 *
 * 注释（L125-126）：隐式的「上次使用」继承必须对素材来源安全 ——
 * 裁切**只**通过显式选择的场景预设传递（包括显式指定默认预设）。
 * 所以这里把 formatVersion 显式压回 1。
 */
export function rememberLastUsedStyle(
  storage: EditorStylePresetStoragePort,
  project: RecorderProject
): EditorStylePreset {
  const snapshot = makeEditorStylePreset({
    id: '',
    name: EDITOR_LAST_USED_STYLE_NAME,
    project,
  })
  snapshot.formatVersion = EDITOR_LAST_USED_STYLE_FORMAT_VERSION
  storage.write(EDITOR_LAST_USED_STYLE_KEY, JSON.stringify(snapshot))
  return snapshot
}

/**
 * Swift L134-145。
 *   1. 有显式默认预设 → 用它，并把它的资产解析成背景覆盖源。
 *   2. 否则读「上次使用」快照 → 应用它（不带背景覆盖）。
 *   3. 都没有 → 原样返回。
 */
export function applyingLastUsedStyle(input: {
  readonly storage: EditorStylePresetStoragePort
  readonly project: RecorderProject
  readonly assetDirectory?: string
  readonly fileExists?: (path: string) => boolean
}): RecorderProject {
  const fileExists = input.fileExists ?? (() => true)
  const directory = input.assetDirectory ?? ''
  const defaultID = readDefaultPresetID(input.storage)
  if (defaultID !== null) {
    const selected = loadEditorStylePresets(input.storage).find((item) => item.id === defaultID)
    if (selected !== undefined) {
      const asset = selected.backgroundAsset ?? null
      const override =
        asset === null ? null : scenePresetBackgroundSource(asset, directory, fileExists)
      return applyEditorStylePreset({
        preset: selected,
        baseline: input.project,
        backgroundOverride: override,
        fileExists,
      })
    }
  }
  const raw = input.storage.read(EDITOR_LAST_USED_STYLE_KEY)
  if (raw === null || raw === '') return cloneValue(input.project)
  let snapshot: EditorStylePreset
  try {
    snapshot = JSON.parse(raw) as EditorStylePreset
  } catch {
    return cloneValue(input.project)
  }
  return applyEditorStylePreset({
    preset: snapshot,
    baseline: input.project,
    fileExists,
  })
}

/** 一键清掉三处存储（调试/重置用；上游没有对应 API，仅供宿主复用同一组键）。 */
export function clearEditorStylePresetStorage(storage: EditorStylePresetStoragePort): void {
  storage.write(EDITOR_STYLE_PRESET_KEY, null)
  storage.write(EDITOR_LAST_USED_STYLE_KEY, null)
  storage.write(EDITOR_DEFAULT_PRESET_ID_KEY, null)
}
