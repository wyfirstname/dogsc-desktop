/**
 * 场景预设背景资产 —— Swift ScenePresetBackgroundAsset.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/ScenePresetBackgroundAsset.swift（47 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - struct ScenePresetBackgroundAsset   L6-8   → ScenePresetBackgroundAsset
 *   - static var directory                L10-13 → SCENE_PRESET_ASSET_DIRECTORY
 *   - var url                             L15-19 → scenePresetAssetPath
 *   - var isAvailable                     L21     → scenePresetAssetIsAvailable
 *   - var availableSource                 L23-26 → scenePresetBackgroundSource
 *   - retain(from:isVideo:)               L28-37 → retainedScenePresetFilename
 *   - discardUncommittedCopy()            L41-46 → discard 语义
 *
 * 原注释（L4-5）：
 *   Immutable preset-owned media. Copies happen off MainActor. Keeping these
 *   separate from project packages lets a scene survive moving its source project.
 */

import type { BackgroundSource } from './ProjectModel'

/** Swift L10-13：`~/Library/Application Support/DogSC/ScenePresets/Assets`。 */
export const SCENE_PRESET_ASSET_SUBDIRECTORY = 'DogSC/ScenePresets/Assets'

/** 各平台的 Application Support 等价目录名（Electron `app.getPath('appData')`）。 */
export function scenePresetAssetDirectory(appDataPath: string): string {
  return `${appDataPath.replace(/[\\/]+$/, '')}/${SCENE_PRESET_ASSET_SUBDIRECTORY}`
}

/** Swift L6-8。 */
export interface ScenePresetBackgroundAsset {
  readonly filename: string
  readonly isVideo: boolean
}

export function makeScenePresetBackgroundAsset(
  filename: string,
  isVideo: boolean
): ScenePresetBackgroundAsset {
  return { filename, isVideo }
}

/**
 * Swift L15-19：
 *   guard !filename.isEmpty, filename == URL(fileURLWithPath: filename).lastPathComponent,
 *         filename != ".", filename != ".." else { return nil }
 *
 * 即**只接受纯文件名**：带路径分隔符、`.`、`..` 一律拒绝 —— 这是防止预设资产
 * 逃出 Assets 目录的唯一闸门。
 */
export function scenePresetAssetPath(
  asset: ScenePresetBackgroundAsset,
  directory: string
): string | null {
  const filename = asset.filename
  if (filename === '') return null
  if (filename.includes('/') || filename.includes('\\')) return null
  if (filename === '.' || filename === '..') return null
  return `${directory.replace(/[\\/]+$/, '')}/${filename}`
}

/** Swift L21。 */
export function scenePresetAssetIsAvailable(
  asset: ScenePresetBackgroundAsset,
  directory: string,
  fileExists: (path: string) => boolean
): boolean {
  const path = scenePresetAssetPath(asset, directory)
  return path != null && fileExists(path)
}

/** Swift L23-26：可用时返回系统绝对路径背景源，否则 null。 */
export function scenePresetBackgroundSource(
  asset: ScenePresetBackgroundAsset,
  directory: string,
  fileExists: (path: string) => boolean
): BackgroundSource | null {
  const path = scenePresetAssetPath(asset, directory)
  if (path == null || !fileExists(path)) return null
  return asset.isVideo
    ? { kind: 'systemVideo', absolutePath: path }
    : { kind: 'systemImage', absolutePath: path }
}

/** Swift L30：扩展名缺省（视频 mov / 图片 png）。 */
export function scenePresetAssetExtension(sourcePath: string, isVideo: boolean): string {
  const name = sourcePath.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return isVideo ? 'mov' : 'png'
  return name.slice(dot + 1)
}

/**
 * Swift L31：`"scene-\(UUID().uuidString).\(ext)"`。
 * UUID 由调用方给（主进程 crypto.randomUUID），便于断言。
 */
export function retainedScenePresetFilename(
  sourcePath: string,
  isVideo: boolean,
  uuid: string
): string {
  return `scene-${uuid}.${scenePresetAssetExtension(sourcePath, isVideo)}`
}

/** Swift L28-37 的纯结果：目标文件名 + 需要确保存在的目录。 */
export function retainedScenePresetAsset(
  sourcePath: string,
  isVideo: boolean,
  uuid: string
): { asset: ScenePresetBackgroundAsset; filename: string } {
  const filename = retainedScenePresetFilename(sourcePath, isVideo, uuid)
  return { asset: makeScenePresetBackgroundAsset(filename, isVideo), filename }
}
