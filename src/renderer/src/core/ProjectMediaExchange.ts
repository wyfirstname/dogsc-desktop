/**
 * 工程源文件交换 —— 把录到的源文件导出成一个文件夹，以及换掉摄像头素材。
 *
 * Swift source: Sources/DogSCApp/ProjectMediaExchange.swift（164 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct ProjectSourceMediaFiles                L5-9   → ProjectSourceMediaFiles
 *   - struct ImportedCameraMedia                    L11-15 → ImportedCameraMedia
 *   - enum ProjectMediaExchangeError                L17-29 → mediaExchangeErrorMessage
 *   - exportSources(_:projectTitle:into:)           L32-63 → exportFolderBaseName / uniqueExportFolderName / mediaCopyExtension
 *   - inspectCameraReplacement(_:)                  L65-72 → SRC-003 的校验宽松度
 *   - importCameraReplacement(camera:session:)      L74-98 → cameraReplacementFolderName / cameraRelativePath
 *   - inspect(url:requiredMediaType:)                L100-122 → mediaInspectionAccepts / 两条错误文案
 *   - copy(_:to:baseName:)                          L124-142 → mediaCopyExtension / MEDIA_COPY_FALLBACK_EXTENSION
 *   - uniqueExportFolder(parent:baseName:)          L144-155 → uniqueExportFolderName
 *   - sanitizedFilename(_:)                         L157-163 → sanitizedMediaFilename
 *
 * 迁移说明：`FileManager` / `AVURLAsset` / `UUID` 在 Windows 侧分别对应
 * `fs.promises`、主进程 ffprobe 与 `crypto.randomUUID()`。本文件保留四件纯逻辑：
 * 文件名消毒、去重目录名、扩展名回退、素材可用性判据。
 */

import type { MediaTimeRange } from './MediaTimeRange'

/** Swift L5-9。 */
export interface ProjectSourceMediaFiles {
  readonly screen: string
  readonly camera: string | null
  readonly microphone: string | null
}

/** Swift L11-15。 */
export interface ImportedCameraMedia {
  readonly folderURL: string
  readonly cameraRelativePath: string
  readonly cameraURL: string
}

/** Swift L48-57：导出时的固定文件名前缀。 */
export const PROJECT_MEDIA_EXPORT_BASENAMES = {
  screen: '屏幕',
  camera: '摄像头',
  microphone: '麦克风',
} as const

/** Swift L40：导出目录后缀。 */
export const PROJECT_MEDIA_EXPORT_FOLDER_SUFFIX = '-源文件'

/** Swift L133-134：没有扩展名时的回退。 */
export const MEDIA_COPY_FALLBACK_EXTENSION = { audio: 'm4a', video: 'mov' } as const

/** Swift L115：时长下限。0.01 秒以下视为「没有可用轨」。 */
export const MEDIA_MINIMUM_DURATION = 0.01

/** Swift L162：消毒后为空时的兜底名。 */
export const UNTITLED_RECORDING_NAME = '未命名录制'

/** Swift L79：替换目录名前缀。 */
export const CAMERA_REPLACEMENT_FOLDER_PREFIX = 'camera-replacement-'

/**
 * Swift L157-163：
 *   let parts = value.components(separatedBy: CharacterSet(charactersIn: "/:"))
 *   let result = parts.joined(separator: "-").trimmingCharacters(in: .whitespacesAndNewlines)
 *   return result.isEmpty ? "未命名录制" : result
 *
 * 只把 `/` 与 `:` 换成 `-`（macOS 上 `:` 是旧式路径分隔符，且 Finder 里显示为 `/`）。
 * 不做全量白名单过滤 —— 用户的项目名里可以有中文、空格、括号。
 */
export function sanitizedMediaFilename(value: string): string {
  const joined = value.split(/[/:]/).join('-').trim()
  return joined === '' ? UNTITLED_RECORDING_NAME : joined
}

/** Swift L40：`sanitizedFilename(projectTitle) + "-源文件"`。 */
export function exportFolderBaseName(projectTitle: string): string {
  return `${sanitizedMediaFilename(projectTitle)}${PROJECT_MEDIA_EXPORT_FOLDER_SUFFIX}`
}

/**
 * Swift L144-155：
 *   candidate = parent/baseName
 *   suffix = 2
 *   while exists(candidate) { candidate = parent/"\(baseName)-\(suffix)"; suffix += 1 }
 *
 * 从 2 开始而不是 1 —— 第二个同名目录叫 `名字-2`，读起来才是「第二份」。
 */
export function uniqueExportFolderName(
  baseName: string,
  exists: (name: string) => boolean
): string {
  let suffix = 2
  let candidate = baseName
  while (exists(candidate)) {
    candidate = `${baseName}-${suffix}`
    suffix += 1
  }
  return candidate
}

/**
 * Swift L133-136：
 *   let fallback = baseName == "麦克风" || baseName == "microphone" ? "m4a" : "mov"
 *   let fileExtension = source.pathExtension.isEmpty ? fallback : source.pathExtension.lowercased()
 *
 * 认两个名字是因为调用方可能传中文或英文基名；`lowercased()` 让 `MOV` 与 `mov` 归一。
 */
export function mediaCopyExtension(sourcePath: string, baseName: string): string {
  const fallback =
    baseName === PROJECT_MEDIA_EXPORT_BASENAMES.microphone || baseName === 'microphone'
      ? MEDIA_COPY_FALLBACK_EXTENSION.audio
      : MEDIA_COPY_FALLBACK_EXTENSION.video
  const lastSegment = sourcePath.split(/[\\/]/).pop() ?? ''
  const dot = lastSegment.lastIndexOf('.')
  // Swift 的 `pathExtension` 对 `.hidden` 返回空：点必须在首字符之后。
  if (dot <= 0 || dot === lastSegment.length - 1) return fallback
  return lastSegment.slice(dot + 1).toLowerCase()
}

/** Swift L130-132：源文件不在就抛 `fileNoSuchFile`。 */
export function mediaCopySourceIsReadable(exists: boolean): boolean {
  return exists
}

/**
 * Swift L113-120：
 *   guard !tracks.isEmpty, duration.isFinite, duration > 0.01 else { throw … }
 *
 * 三条缺一不可。`tracks.isEmpty` 挡住「容器里有视频轨但解不出帧」这类文件；
 * 0.01 秒的下限挡住只有一两帧的伪素材。
 */
export function mediaInspectionAccepts(input: {
  readonly trackCount: number
  readonly duration: number
}): boolean {
  if (input.trackCount <= 0) return false
  if (!Number.isFinite(input.duration)) return false
  return input.duration > MEDIA_MINIMUM_DURATION
}

/**
 * Swift L66-71（SRC-003）：
 *   外部提供的摄像头文件是**独立**的辅助源。它既不需要音轨，也不需要与
 *   屏幕/麦克风同长。短一点的摄像头就按自己的时长结束为止 —— 与工程里
 *   「被中断或刻意裁短的摄像头轨」表现一致。
 *
 * 所以这里**只**校验视频轨，不校验时长一致性。
 */
export function cameraReplacementRequirements(): { readonly requiredMediaType: 'video' } {
  return { requiredMediaType: 'video' }
}

/** Swift L79-82。 */
export function cameraReplacementFolderName(uuid: string): string {
  return `${CAMERA_REPLACEMENT_FOLDER_PREFIX}${uuid.toLowerCase()}`
}

/** Swift L91：`"media/\(folderName)/\(cameraURL.lastPathComponent)"`。 */
export function cameraRelativePath(folderName: string, fileName: string): string {
  return `media/${folderName}/${fileName}`
}

/** 错误类别（Swift `ProjectMediaExchangeError`）。 */
export type ProjectMediaExchangeErrorKind = 'missingProjectMedia' | 'invalidMedia'

/**
 * Swift L21-28：
 *   missingProjectMedia(name) → String(format: appLocalized("项目没有可导出的%@源文件。"), appLocalized(name))
 *   invalidMedia(reason)      → appLocalized(reason)
 *
 * 注意 `missingProjectMedia` 里的 name 会**再翻译一次** —— 传进来的是 key，
 * 不是已经翻好的字符串。
 */
export function mediaExchangeErrorMessage(
  kind: ProjectMediaExchangeErrorKind,
  detail: string,
  translate: (key: string) => string = (key) => key
): string {
  if (kind === 'invalidMedia') return translate(detail)
  return formatSingleArgument(translate('项目没有可导出的%@源文件。'), translate(detail))
}

/** Swift L107：`选择的文件不存在：%@`（参数是完整路径）。 */
export function missingMediaFileMessage(
  path: string,
  translate: (key: string) => string = (key) => key
): string {
  return formatSingleArgument(translate('选择的文件不存在：%@'), path)
}

/**
 * Swift L116-119：`"%@ 没有可用的%@轨。"`（文件名 + 「音频」/「视频」）。
 * 两类原因共用一句文案，是因为对用户而言后果一样：这个文件用不了。
 */
export function missingMediaTrackMessage(
  fileName: string,
  requiredMediaType: 'audio' | 'video',
  translate: (key: string) => string = (key) => key
): string {
  const kind = requiredMediaType === 'audio' ? '音频' : '视频'
  return formatTwoArguments(translate('%@ 没有可用的%@轨。'), fileName, translate(kind))
}

function formatSingleArgument(template: string, value: string): string {
  const index = template.indexOf('%@')
  if (index < 0) return template
  return template.slice(0, index) + value + template.slice(index + 2)
}

function formatTwoArguments(template: string, first: string, second: string): string {
  return formatSingleArgument(formatSingleArgument(template, first), second)
}

/** 导出源文件的执行计划（宿主按顺序落地）。 */
export interface MediaExportPlan {
  readonly folderName: string
  readonly copies: readonly { readonly source: string; readonly baseName: string; readonly extension: string }[]
}

/**
 * Swift L36-62：先算去重目录名，再逐个拷；任一失败就把整个目录删掉再抛。
 * 「删掉整个目录」是全有或全无 —— 半个源文件包比没有更糟。
 */
export function mediaExportPlan(input: {
  readonly sources: ProjectSourceMediaFiles
  readonly projectTitle: string
  readonly exists: (name: string) => boolean
}): MediaExportPlan {
  const base = exportFolderBaseName(input.projectTitle)
  const folderName = uniqueExportFolderName(base, input.exists)
  const copies: { source: string; baseName: string; extension: string }[] = [
    {
      source: input.sources.screen,
      baseName: PROJECT_MEDIA_EXPORT_BASENAMES.screen,
      extension: mediaCopyExtension(input.sources.screen, PROJECT_MEDIA_EXPORT_BASENAMES.screen),
    },
  ]
  if (input.sources.camera !== null) {
    copies.push({
      source: input.sources.camera,
      baseName: PROJECT_MEDIA_EXPORT_BASENAMES.camera,
      extension: mediaCopyExtension(input.sources.camera, PROJECT_MEDIA_EXPORT_BASENAMES.camera),
    })
  }
  if (input.sources.microphone !== null) {
    copies.push({
      source: input.sources.microphone,
      baseName: PROJECT_MEDIA_EXPORT_BASENAMES.microphone,
      extension: mediaCopyExtension(input.sources.microphone, PROJECT_MEDIA_EXPORT_BASENAMES.microphone),
    })
  }
  return { folderName, copies }
}

/** 导出源文件里真正会被读到的时长范围（上游不裁切，整段拷）。 */
export function mediaExportRange(range: MediaTimeRange): MediaTimeRange {
  return range
}
