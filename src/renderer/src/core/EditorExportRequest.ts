/**
 * 导出请求 —— Swift EditorExportRequest.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorExportRequest.swift（431 行）
 *               + Sources/DogSCApp/VideoExporter.swift 的 `ExportAssetRole`（L7-23）
 *               + Sources/DogSCApp/EditorMediaSession.swift 的 `EditorMediaFileVersion`（L11-29）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - enum ExportOutputKind                     L4-11   → ExportOutputKind + fileExtension
 *   - enum EditorExportScope                    L16-28  → EditorExportScope 联合 + 取值
 *   - struct EditorExportAsset                  L31-85  → validateExistingLocalFile / validateCurrentVersion
 *   - struct EditorExportAssets                 L89-128 → EditorExportAssets + inputURLs
 *   - struct EditorExportRequest                L131-165 → EditorExportRequest
 *   - enum EditorExportRequestError             L167-212 → EditorExportRequestError + 文案
 *   - EditorExportRequestBuilder.make(...)      L214-343 → buildEditorExportRequest
 *   - makeDefaultOutputURL(...)                 L345-374 → defaultExportOutputPath
 *   - makeOutputURL(in:baseName:outputKind:)    L376-399 → exportOutputPath
 *   - exportFileNameComponent(_:)               L401-414 → exportFileNameComponent
 *   - requiredAsset / requiredWallpaper         L416-430
 *
 * 原注释（L29-31）：
 *   One export input frozen to the exact on-disk file generation inspected by
 *   the editor. Keeping URL and version together prevents a path from silently
 *   resolving to replacement media after the user presses Export.
 *
 * 关键不变量：**请求里冻结的是「路径 + 文件代次」**，不是路径本身；文件在预览准备
 * 之后被替换，导出必须报错而不是悄悄编到别的素材上。
 */

import type { MediaTimeRange } from './MediaTimeRange'
import type { RecorderProject } from './ProjectMediaModel'
import { exportFileTransactionCollides } from './ExportFileTransaction'

// ------------------------------------------------------------ ExportOutputKind

export type ExportOutputKind = 'video' | 'audio'
export const EXPORT_OUTPUT_KINDS: readonly ExportOutputKind[] = ['video', 'audio']

/** Swift L10。 */
export function exportOutputFileExtension(kind: ExportOutputKind): string {
  return kind === 'video' ? 'mp4' : 'm4a'
}

// ------------------------------------------------------------ ExportAssetRole

/** Swift VideoExporter.swift L7-23。 */
export type ExportAssetRole =
  | 'screenRecording'
  | 'cameraRecording'
  | 'microphoneRecording'
  | 'wallpaper'
  | 'sticker'

export function exportAssetRoleDisplayName(role: ExportAssetRole): string {
  switch (role) {
    case 'screenRecording':
      return '主录屏'
    case 'cameraRecording':
      return '摄像头'
    case 'microphoneRecording':
      return '麦克风'
    case 'wallpaper':
      return '背景素材'
    case 'sticker':
      return '贴图'
  }
}

// ------------------------------------------------------ EditorMediaFileVersion

/** Swift EditorMediaSession.swift L11-29。 */
export interface EditorMediaFileVersion {
  readonly standardizedPath: string
  readonly fileSystemNumber: bigint | null
  readonly fileNumber: bigint | null
  readonly fileSize: bigint | null
  readonly modificationDate: number | null
}

export interface FileAttributes {
  readonly systemNumber?: bigint | null
  readonly systemFileNumber?: bigint | null
  readonly size?: bigint | null
  readonly modificationDate?: number | null
}

export function editorMediaFileVersion(
  path: string,
  attributes?: FileAttributes | null
): EditorMediaFileVersion {
  return {
    standardizedPath: path,
    fileSystemNumber: attributes?.systemNumber ?? null,
    fileNumber: attributes?.systemFileNumber ?? null,
    fileSize: attributes?.size ?? null,
    modificationDate: attributes?.modificationDate ?? null
  }
}

export function editorMediaFileVersionEquals(
  a: EditorMediaFileVersion,
  b: EditorMediaFileVersion
): boolean {
  return (
    a.standardizedPath === b.standardizedPath &&
    a.fileSystemNumber === b.fileSystemNumber &&
    a.fileNumber === b.fileNumber &&
    a.fileSize === b.fileSize &&
    a.modificationDate === b.modificationDate
  )
}

// ------------------------------------------------------------ EditorExportScope

/** Swift L16-28。 */
export type EditorExportScope =
  | { readonly kind: 'fullProject' }
  | { readonly kind: 'timelineRange'; readonly range: MediaTimeRange; readonly selectedSegmentCount: number }

/** Swift L22-25。 */
export function editorExportScopeOutputRange(scope: EditorExportScope): MediaTimeRange | null {
  return scope.kind === 'timelineRange' ? scope.range : null
}

/** Swift L27-28。 */
export function editorExportScopeSelectedSegmentCount(scope: EditorExportScope): number {
  return scope.kind === 'timelineRange' ? scope.selectedSegmentCount : 0
}

// ------------------------------------------------------------ 错误

export type EditorExportRequestErrorKind =
  | 'editorSessionMismatch'
  | 'mediaGenerationMismatch'
  | 'sourceSequenceMismatch'
  | 'mediaManifestMismatch'
  | 'missingAssetReference'
  | 'missingAssetFile'
  | 'nonFileAsset'
  | 'assetVersionChanged'
  | 'invalidOutputURL'
  | 'outputCollidesWithInput'
  | 'invalidOutputRange'

/** Swift L167-212 的中文文案，逐字照搬（`%@`/`\(path)` 用插值表达）。 */
export function editorExportRequestErrorMessage(
  kind: EditorExportRequestErrorKind,
  detail: {
    role?: ExportAssetRole
    path?: string
    value?: string
    expectedSession?: string
    actualSession?: string
  } = {}
): string {
  const roleName = detail.role != null ? exportAssetRoleDisplayName(detail.role) : ''
  switch (kind) {
    case 'editorSessionMismatch':
      return '导出素材不属于当前编辑会话，请等待预览重新准备。'
    case 'mediaGenerationMismatch':
      return '导出素材已经被新的编辑代次取代，请重新导出。'
    case 'sourceSequenceMismatch':
      return '剪辑时间线已变化，请等待预览更新后重试。'
    case 'mediaManifestMismatch':
      return '项目素材清单已变化，请等待预览更新后重试。'
    case 'missingAssetReference':
      return `项目需要${roleName}素材，但当前编辑会话没有对应文件。`
    case 'missingAssetFile':
      return `${roleName}素材不存在：${detail.path ?? ''}。`
    case 'nonFileAsset':
      return `${roleName}素材不是可用的本地文件：${detail.value ?? ''}。`
    case 'assetVersionChanged':
      return `${roleName}素材在导出前已变化：${detail.path ?? ''}。请重新打开或刷新项目。`
    case 'invalidOutputURL':
      return `导出位置不是本地文件路径：${detail.value ?? ''}。`
    case 'outputCollidesWithInput':
      return `导出位置不能覆盖项目素材：${detail.path ?? ''}。`
    case 'invalidOutputRange':
      return '所选片段已经变化，无法确定有效的导出范围。请重新选择片段。'
  }
}

export class EditorExportRequestError extends Error {
  readonly kind: EditorExportRequestErrorKind
  readonly role: ExportAssetRole | null
  readonly path: string | null
  readonly value: string | null

  constructor(
    kind: EditorExportRequestErrorKind,
    detail: { role?: ExportAssetRole; path?: string; value?: string } = {}
  ) {
    super(editorExportRequestErrorMessage(kind, detail))
    this.name = 'EditorExportRequestError'
    this.kind = kind
    this.role = detail.role ?? null
    this.path = detail.path ?? null
    this.value = detail.value ?? null
  }
}

// ------------------------------------------------------------ 素材

/** Swift L31-85：一个导出输入，冻结到「编辑器检查时的那个文件代次」。 */
export interface EditorExportAsset {
  readonly url: string
  readonly version: EditorMediaFileVersion
}

/** 文件系统端口（主进程实现）。 */
export interface ExportAssetFileSystem {
  fileExists(path: string): boolean
  isDirectory(path: string): boolean
  attributes(path: string): FileAttributes | null
}

export function isFileURLPath(path: string): boolean {
  return !path.includes('://')
}

/**
 * Swift L67-85：必须是本地文件（非 URL scheme）、必须存在、不能是目录。
 * 三条检查顺序不可换 —— 目录会被报成 `nonFileAsset` 而不是「不存在」。
 */
export function validateExistingLocalFile(
  path: string,
  role: ExportAssetRole,
  fileSystem: ExportAssetFileSystem
): void {
  if (!isFileURLPath(path)) {
    throw new EditorExportRequestError('nonFileAsset', { role, value: path })
  }
  if (!fileSystem.fileExists(path)) {
    throw new EditorExportRequestError('missingAssetFile', { role, path })
  }
  if (fileSystem.isDirectory(path)) {
    throw new EditorExportRequestError('nonFileAsset', { role, value: path })
  }
}

/** Swift L46-65：重新读一次磁盘属性并与冻结的代次比对。 */
export function validateCurrentVersion(
  asset: EditorExportAsset,
  role: ExportAssetRole,
  fileSystem: ExportAssetFileSystem
): void {
  validateExistingLocalFile(asset.url, role, fileSystem)
  const current = editorMediaFileVersion(asset.url, fileSystem.attributes(asset.url))
  if (!editorMediaFileVersionEquals(current, asset.version)) {
    throw new EditorExportRequestError('assetVersionChanged', { role, path: asset.url })
  }
}

/** Swift L40-44 / L56-62。 */
export function makeExportAssetFromPath(
  url: string,
  role: ExportAssetRole,
  fileSystem: ExportAssetFileSystem
): EditorExportAsset {
  validateExistingLocalFile(url, role, fileSystem)
  return { url, version: editorMediaFileVersion(url, fileSystem.attributes(url)) }
}

/** Swift L89-128。 */
export interface EditorExportAssets {
  readonly source: EditorExportAsset
  readonly camera: EditorExportAsset | null
  readonly microphone: EditorExportAsset | null
  readonly wallpaper: EditorExportAsset | null
  readonly stickers: Readonly<Record<string, EditorExportAsset>>
}

/**
 * Swift L111-126：按固定顺序校验 source → camera → microphone → wallpaper →
 * stickers（字典顺序不保证，但每个都必须校验）。
 */
export function validateCurrentAssetVersions(
  assets: EditorExportAssets,
  fileSystem: ExportAssetFileSystem
): void {
  validateCurrentVersion(assets.source, 'screenRecording', fileSystem)
  if (assets.camera != null) validateCurrentVersion(assets.camera, 'cameraRecording', fileSystem)
  if (assets.microphone != null) {
    validateCurrentVersion(assets.microphone, 'microphoneRecording', fileSystem)
  }
  if (assets.wallpaper != null) validateCurrentVersion(assets.wallpaper, 'wallpaper', fileSystem)
  for (const sticker of Object.values(assets.stickers)) {
    validateCurrentVersion(sticker, 'sticker', fileSystem)
  }
}

/** Swift L126-131：输出路径冲突检测的输入集合。 */
export function exportAssetInputURLs(assets: EditorExportAssets): string[] {
  const urls: string[] = [assets.source.url]
  if (assets.camera != null) urls.push(assets.camera.url)
  if (assets.microphone != null) urls.push(assets.microphone.url)
  if (assets.wallpaper != null) urls.push(assets.wallpaper.url)
  for (const sticker of Object.values(assets.stickers)) urls.push(sticker.url)
  return urls
}

// ------------------------------------------------------------ 请求

/** Swift L131-165。 */
export interface EditorExportRequest {
  readonly editorSessionID: string
  readonly mediaGeneration: number
  readonly project: RecorderProject
  readonly mediaPlan: { readonly outputDuration: number }
  readonly assets: EditorExportAssets
  readonly outputURL: string
  readonly outputKind: ExportOutputKind
  readonly outputRange: MediaTimeRange | null
}

// ------------------------------------------------------------ 文件名

/**
 * Swift L401-414：
 * 去首尾空白 → 空则 nil；`/`、`:`、换行、控制字符替换成分隔；再用 `-` 连起来。
 * 这是「用户手输文件名」唯一的净化闸门。
 */
export function exportFileNameComponent(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  // 与 Foundation 的 CharacterSet 对齐：/ : 换行 控制字符
  const forbidden = /[/:\n\r\u0000-\u001f\u007f]/u
  const pieces = trimmed
    .split(forbidden)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '')
  const cleaned = pieces.join('-')
  return cleaned === '' ? null : cleaned
}

/**
 * Swift L376-399：先净化主干名，再在目录里找第一个不冲突的 `-2`、`-3`……后缀。
 * 目录创建由调用方（主进程）负责；这里只做名字决策。
 */
export function exportOutputPath(options: {
  folder: string
  baseName: string
  outputKind: ExportOutputKind
  fileExists: (path: string) => boolean
}): string {
  const cleanedBase = exportFileNameComponent(options.baseName)
  if (cleanedBase == null) {
    throw new EditorExportRequestError('invalidOutputURL', { value: options.baseName })
  }
  const extension = exportOutputFileExtension(options.outputKind)
  const folder = options.folder.replace(/[\\/]+$/, '')
  let candidate = `${folder}/${cleanedBase}.${extension}`
  let suffix = 2
  while (options.fileExists(candidate)) {
    candidate = `${folder}/${cleanedBase}-${suffix}.${extension}`
    suffix += 1
  }
  return candidate
}

/** `yyyy-MM-dd-HH-mm-ss`（Swift DateFormatter 的等价实现，输入为 UTC 毫秒）。 */
export function exportTimestampText(dateMilliseconds: number): string {
  const date = new Date(dateMilliseconds)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-` +
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  )
}

/**
 * Swift L345-374：有工程名就用工程名，没有就用「成片/音频 + 时间戳」。
 * 视频总会带 `fps` 后缀（导出帧率是用户可见事实）。
 */
export function defaultExportOutputPath(options: {
  folder: string
  projectName: string | null
  frameRate: number
  outputKind: ExportOutputKind
  timestampMilliseconds: number
  fileExists: (path: string) => boolean
}): string {
  const projectName = options.projectName != null ? exportFileNameComponent(options.projectName) : null
  let baseName: string
  if (options.outputKind === 'video') {
    baseName =
      projectName != null
        ? `${projectName}-${options.frameRate}fps`
        : `成片-${exportTimestampText(options.timestampMilliseconds)}-${options.frameRate}fps`
  } else {
    baseName =
      projectName != null
        ? `${projectName}-音频`
        : `音频-${exportTimestampText(options.timestampMilliseconds)}`
  }
  return exportOutputPath({
    folder: options.folder,
    baseName,
    outputKind: options.outputKind,
    fileExists: options.fileExists
  })
}

// ------------------------------------------------------------ 构建

/** Swift `RequiredProjectMedia`（RecorderCore ExportPolicy.swift）的判定字段。 */
export interface RequiredProjectMediaFlags {
  readonly cameraVideo: boolean
  readonly microphoneAudio: boolean
  readonly backgroundImage: boolean
  readonly backgroundVideo: boolean
}

/** 预览准备产物（Swift `EditorPreparedMedia` 的等价快照）。 */
export interface PreparedExportMedia {
  readonly editorSessionID: string
  readonly generation: number
  readonly sourceSequenceKey: string
  readonly sourceAsset: EditorExportAsset
  readonly cameraAsset: EditorExportAsset | null
  readonly microphoneAsset: EditorExportAsset | null
  readonly sourceVideoTimeRange: MediaTimeRange | null
}

export interface BuildEditorExportRequestInput {
  editorSessionID: string
  mediaGeneration: number
  project: RecorderProject
  prepared: PreparedExportMedia
  /** 工程素材清单存在（`project.media != nil`） */
  hasMediaManifest: boolean
  /** 预览准备时的源序列键（用于比对时间线是否被改过） */
  projectSourceSequenceKey: string
  /** 预览准备时的素材清单键（用于比对清单是否变过） */
  preparedManifestKey: string
  projectManifestKey: string
  requiredMedia: RequiredProjectMediaFlags
  wallpaperPath: string | null
  stickerPaths: Readonly<Record<string, string>>
  outputURL: string | null
  outputKind: ExportOutputKind
  outputRange: MediaTimeRange | null
  fileSystem: ExportAssetFileSystem
  /** 由调用方按当前工程重建媒体计划（Swift `ProjectTimelineMediaPlan(...)`） */
  buildMediaPlan: (primaryVideoRange: MediaTimeRange) => { readonly outputDuration: number }
  /** 默认输出路径（`outputURL == null` 时用） */
  defaultOutputPath: () => string
}

/**
 * Swift L214-343 `EditorExportRequestBuilder.make` 的完整校验流水线。
 *
 * 顺序即错误优先级：会话 → 代次 → 源序列 → 清单 → 清单存在 → 逐个素材 →
 * 代次复核 → 输出路径（本地/扩展名/不覆盖输入） → 源视频轨 → 重建计划 → 范围夹取。
 */
export function buildEditorExportRequest(input: BuildEditorExportRequestInput): EditorExportRequest {
  // L225-245
  if (input.prepared.editorSessionID !== input.editorSessionID) {
    throw new EditorExportRequestError('editorSessionMismatch')
  }
  if (input.prepared.generation !== input.mediaGeneration) {
    throw new EditorExportRequestError('mediaGenerationMismatch')
  }
  if (input.prepared.sourceSequenceKey !== input.projectSourceSequenceKey) {
    throw new EditorExportRequestError('sourceSequenceMismatch')
  }
  if (input.preparedManifestKey !== input.projectManifestKey) {
    throw new EditorExportRequestError('mediaManifestMismatch')
  }
  if (!input.hasMediaManifest) {
    throw new EditorExportRequestError('missingAssetReference', { role: 'screenRecording' })
  }

  // L247-278：按后期状态决定要哪些素材
  const isVideo = input.outputKind === 'video'
  const source = input.prepared.sourceAsset
  const camera =
    isVideo && input.requiredMedia.cameraVideo
      ? requireAsset(input.prepared.cameraAsset, 'cameraRecording')
      : null
  const microphone = input.requiredMedia.microphoneAudio
    ? requireAsset(input.prepared.microphoneAsset, 'microphoneRecording')
    : null
  const wallpaper =
    isVideo && (input.requiredMedia.backgroundImage || input.requiredMedia.backgroundVideo)
      ? requireWallpaper(input.wallpaperPath, input.fileSystem)
      : null
  const stickerPaths = isVideo
    ? new Set(Object.keys(input.project.timeline.stickerClips ?? {}).length > 0
        ? (input.project.timeline.stickerClips ?? []).map((clip) => clip.relativePath)
        : [])
    : new Set<string>()
  const stickers: Record<string, EditorExportAsset> = {}
  for (const relativePath of stickerPaths) {
    const stickerURL = input.stickerPaths[relativePath]
    if (stickerURL == null) {
      throw new EditorExportRequestError('missingAssetReference', { role: 'sticker' })
    }
    stickers[relativePath] = makeExportAssetFromPath(stickerURL, 'sticker', input.fileSystem)
  }

  const assets: EditorExportAssets = { source, camera, microphone, wallpaper, stickers }

  // L280-281：预览准备之后被替换的素材必须在这里被拦下
  validateCurrentAssetVersions(assets, input.fileSystem)

  // L283-303：输出路径
  const resolvedOutputURL = input.outputURL ?? input.defaultOutputPath()
  if (!isFileURLPath(resolvedOutputURL)) {
    throw new EditorExportRequestError('invalidOutputURL', { value: resolvedOutputURL })
  }
  const expectedExtension = exportOutputFileExtension(input.outputKind)
  const actualExtension = resolvedOutputURL.split('.').pop()?.toLowerCase() ?? ''
  if (actualExtension !== expectedExtension) {
    throw new EditorExportRequestError('invalidOutputURL', {
      value: `音视频类型与扩展名不匹配：${resolvedOutputURL}`
    })
  }
  if (exportFileTransactionCollides(resolvedOutputURL, exportAssetInputURLs(assets))) {
    throw new EditorExportRequestError('outputCollidesWithInput', { path: resolvedOutputURL })
  }

  // L305-307
  const primaryVideoRange = input.prepared.sourceVideoTimeRange
  if (primaryVideoRange == null) {
    throw new EditorExportRequestError('mediaManifestMismatch')
  }
  const mediaPlan = input.buildMediaPlan(primaryVideoRange)

  // L320-336：范围夹取。容差取 `ulp * 8` 与 1e-6 的较大者 ——
  // 用户拖到末尾时浮点尾数会略微超出成片时长，不能因此报错。
  let validatedOutputRange: MediaTimeRange | null = null
  if (input.outputRange != null) {
    const tolerance = Math.max(
      Math.abs(mediaPlan.outputDuration) * Number.EPSILON * 8,
      0.000001
    )
    const start = Math.max(input.outputRange.start, 0)
    const end = Math.min(input.outputRange.end, mediaPlan.outputDuration)
    if (
      !(input.outputRange.start >= -tolerance) ||
      !(input.outputRange.end <= mediaPlan.outputDuration + tolerance) ||
      !(end > start)
    ) {
      throw new EditorExportRequestError('invalidOutputRange')
    }
    validatedOutputRange = { start, end }
  }

  return {
    editorSessionID: input.editorSessionID,
    mediaGeneration: input.mediaGeneration,
    project: input.project,
    mediaPlan,
    assets,
    outputURL: resolvedOutputURL,
    outputKind: input.outputKind,
    outputRange: validatedOutputRange
  }
}

function requireAsset(
  asset: EditorExportAsset | null,
  role: ExportAssetRole
): EditorExportAsset {
  if (asset == null) throw new EditorExportRequestError('missingAssetReference', { role })
  return asset
}

function requireWallpaper(
  path: string | null,
  fileSystem: ExportAssetFileSystem
): EditorExportAsset {
  if (path == null) throw new EditorExportRequestError('missingAssetReference', { role: 'wallpaper' })
  return makeExportAssetFromPath(path, 'wallpaper', fileSystem)
}
