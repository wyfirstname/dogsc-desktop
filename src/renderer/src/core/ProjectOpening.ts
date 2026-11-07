/**
 * 工程打开快照 —— Swift ProjectOpening.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/ProjectOpening.swift（219 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - struct ProjectOpenSnapshot        (L6-219)  → ProjectOpenSnapshot / loadProjectOpenSnapshot
 *       · isSaved                       L17-19    → snapshotIsSaved / isWorkingProject
 *       · load(at:) 归一化 + 中断标记    L21-27
 *       · 素材重定位 relocated(...)     L29-86
 *       · 三条录制 URL 解析              L89-119
 *       · 五类警告                       L121-162
 *       · 鼠标事件轨加载（可失败）       L163-172
 *       · 遗留运镜/自动缩放轨道修复      L174-205
 *
 * 原注释（L4-5）：
 *   A fully resolved project payload. Loading happens before AppModel publishes
 *   any of these values, so the editor cannot observe mixed project/media state.
 *
 * 迁移说明：
 *   ProjectStore（磁盘读写、相对路径解析、事件解码）在 Electron 侧属于主进程，
 *   这里把它抽成 `ProjectOpenResolver` 注入接口；本文件保留**全部决策顺序、
 *   重定位尝试范围、警告文案与判定条件**。所有字符串为原版中文文案的逐字副本。
 */

import type { ProjectMediaReference } from './ProjectMediaModel'
import type { RecorderProject } from './ProjectMediaModel'
import { recorderZoomAnimations } from './ProjectMediaModel'
import type { BackgroundSource } from './ProjectModel'
import type { ProjectTimeline } from './ProjectTimeline'
import type { PointerEventRecord, ZoomAnimationClip, ZoomEasingPreset } from './ZoomAnimation'
import { repairingLegacyAutomaticAnimations } from './AutoZoomPlanner'
import { repairingPersistedRippleTransitions } from './ProjectTimelineEditing'
import { upgradeLegacyMotionDefaults } from './LegacyMotionDefaultsUpgrade'

// ------------------------------------------------------------ 注入接口

/** Swift `ProjectStore.loadProject` 的返回值（L27）。 */
export interface LoadedProject {
  readonly project: RecorderProject
  /** Swift `RecordingSession`：包根 + 媒体目录约定，TS 侧不透明。 */
  readonly session: unknown
  /** Swift `loaded.recoveredFromPreviousRevision`（L122）。 */
  readonly recoveredFromPreviousRevision: boolean
}

/**
 * ProjectStore 的五项能力（原版全在 `ProjectStore` 静态方法里）。
 * 全部由主进程实现；渲染层只消费结果。
 */
export interface ProjectOpenResolver {
  /** `ProjectStore.isRecoverableProject(at:)` L26 */
  isRecoverableProject(normalizedPath: string): boolean
  /** `ProjectStore.isWorkingProject(_:)` L18 */
  isWorkingProject(normalizedPath: string): boolean
  /** `ProjectStore.loadProject(at:)` L27，失败抛错 */
  loadProject(normalizedPath: string): LoadedProject
  /** `ProjectStore.resolve(relativePath:session:)` L34：解析到绝对路径，不存在返回 null */
  resolve(relativePath: string | null | undefined, session: unknown): string | null
  /** `ProjectStore.relocatedRelativePath(for:session:allowedDirectories:)` L35：包内安全重定位 */
  relocatedRelativePath(
    path: string,
    session: unknown,
    allowedDirectories: readonly string[]
  ): string | null
  /** `FileManager.default.fileExists(atPath:)` L148 */
  fileExists(absolutePath: string): boolean
  /** `ProjectStore.loadPointerEvents(project:session:)` L165，失败抛错 */
  loadPointerEvents(project: RecorderProject, session: unknown): PointerEventRecord[]
  /** `Task.checkCancellation()` 的等价物；抛出即中止 */
  checkCancellation?(): void
}

// ------------------------------------------------------------ 快照结构

/** Swift L6-16。 */
export interface ProjectOpenSnapshot {
  /** 归一化后的**包目录**（不是 project.json） */
  readonly normalizedPath: string
  readonly session: unknown
  readonly project: RecorderProject
  readonly recordingURL: string | null
  readonly cameraRecordingURL: string | null
  readonly microphoneRecordingURL: string | null
  readonly pointerEvents: PointerEventRecord[]
  readonly wasInterrupted: boolean
  readonly warnings: string[]
}

/** Swift L17-19：`!ProjectStore.isWorkingProject(normalizedURL)`。 */
export function snapshotIsSaved(
  snapshot: ProjectOpenSnapshot,
  resolver: Pick<ProjectOpenResolver, 'isWorkingProject'>
): boolean {
  return !resolver.isWorkingProject(snapshot.normalizedPath)
}

// ------------------------------------------------------------ 路径归一化

/** 包内主文件（Swift L23）。 */
export const PROJECT_PACKAGE_ENTRY_FILE = 'project.json'

/**
 * Swift L23-25：
 *   let normalizedURL = packageURL.lastPathComponent == "project.json"
 *       ? packageURL.deletingLastPathComponent() : packageURL
 *
 * 同时兼作 Windows 反斜杠路径的兼容处理。
 */
export function normalizeProjectPackagePath(packagePath: string): string {
  const separator = packagePath.includes('\\') && !packagePath.includes('/') ? '\\' : '/'
  const trimmed = packagePath.replace(/[\\/]+$/, '')
  const lastSeparator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const lastComponent = lastSeparator >= 0 ? trimmed.slice(lastSeparator + 1) : trimmed
  if (lastComponent !== PROJECT_PACKAGE_ENTRY_FILE) return trimmed === '' ? packagePath : trimmed
  const parent = trimmed.slice(0, lastSeparator)
  if (parent === '') return separator
  return parent
}

/** Swift L93-101 的临时代理后缀。 */
export const CAMERA_TIMESTAMP_REPAIRED_SUFFIX = '-timestamp-repaired.mov'

/**
 * Swift L97-111：自动生成的时间戳代理没有恢复真实口型同步，不能悄悄留作工程素材源。
 * 把自动保存下临时路径的工程迁回未改动的摄像头原始录制，再暴露手动对齐流程。
 *
 * 返回 `null` 表示不做迁移（后缀不匹配、或原始 .mov 解析不到）。
 */
export function originalCameraRecordingPath(
  relativePath: string,
  resolver: Pick<ProjectOpenResolver, 'resolve'>,
  session: unknown
): string | null {
  if (!relativePath.endsWith(CAMERA_TIMESTAMP_REPAIRED_SUFFIX)) return null
  const originalRelativePath =
    relativePath.slice(0, relativePath.length - CAMERA_TIMESTAMP_REPAIRED_SUFFIX.length) + '.mov'
  if (resolver.resolve(originalRelativePath, session) == null) return null
  return originalRelativePath
}

// ------------------------------------------------------------ 警告文案

/** Swift L121-162 的十种警告，文案逐字照搬（`appLocalized` 的中文即为原文）。 */
export const PROJECT_OPEN_WARNING = {
  recoveredFromPreviousRevision: '项目主文件损坏，已恢复到上一个完整保存版本。',
  relocatedMedia: (count: number) => `已在项目包内安全重新定位 ${count} 项素材。`,
  missingMainMediaReference: '项目没有主录屏素材引用。',
  missingScreenMedia: '项目引用的主录屏素材不存在或路径无效。',
  missingCameraMedia: '项目引用的摄像头素材不存在或路径无效。',
  missingMicrophoneMedia: '项目引用的麦克风素材不存在或路径无效。',
  missingBackgroundMedia: '项目引用的背景素材不存在或路径无效。',
  missingSystemBackground: '该系统背景在当前设备上不存在。',
  missingStickers: (count: number) => `有 ${count} 项贴图素材不存在或路径无效。`,
  brokenPointerEvents: (description: string) => `鼠标事件轨损坏：${description}`
} as const

// ------------------------------------------------------------ 加载

/**
 * Swift L21-218 `ProjectOpenSnapshot.load(at:)` 的完整移植。
 *
 * 决策顺序（不可调整，警告顺序即用户可见顺序）：
 *   1. 归一化包路径、读中断标记；
 *   2. 加载工程；
 *   3. 五类相对素材重定位（media / events / assets 三个允许目录）；
 *   4. 解析三条录制 URL，并把 `-timestamp-repaired.mov` 迁回原始 .mov；
 *   5. 依序产警告（主文件恢复 → 重定位计数 → 主屏缺失 → 摄像头 → 麦克风
 *      → 背景 → 系统背景 → 贴图缺失 → 事件轨损坏）；
 *   6. 遗留自动缩放轨道重分组 + 运镜默认值升级 + 波纹转场修复。
 */
export function loadProjectOpenSnapshot(
  packagePath: string,
  resolver: ProjectOpenResolver
): ProjectOpenSnapshot {
  resolver.checkCancellation?.()
  const normalizedPath = normalizeProjectPackagePath(packagePath)
  const wasInterrupted = resolver.isRecoverableProject(normalizedPath)
  const loaded = resolver.loadProject(normalizedPath)
  const project: RecorderProject = loaded.project
  const session = loaded.session

  // L29-42：记录重定位声明（用于警告计数，不做去重以外的处理）
  const relocatedDeclarations = new Set<string>()
  const relocated = (path: string, directories: readonly string[]): string => {
    if (resolver.resolve(path, session) != null) return path
    const repaired = resolver.relocatedRelativePath(path, session, directories)
    if (repaired == null) return path
    relocatedDeclarations.add(`${path} → ${repaired}`)
    return repaired
  }

  // L44-68：清单内的四类相对素材
  if (project.media != null) {
    const media = project.media
    media.screen.relativePath = relocated(media.screen.relativePath, ['media'])
    if (media.camera != null) {
      media.camera.relativePath = relocated(media.camera.relativePath, ['media'])
    }
    if (media.microphone != null) {
      media.microphone.relativePath = relocated(media.microphone.relativePath, ['media'])
    }
    if (media.pointerEvents != null) {
      media.pointerEvents.relativePath = relocated(media.pointerEvents.relativePath, ['events'])
    }
    project.media = media
  }

  // L69-80：画布背景（仅工程相对的两种）
  switch (project.canvas.backgroundSource.kind) {
    case 'projectImage':
      project.canvas.backgroundSource = {
        kind: 'projectImage',
        relativePath: relocated(project.canvas.backgroundSource.relativePath, ['assets'])
      }
      break
    case 'projectVideo':
      project.canvas.backgroundSource = {
        kind: 'projectVideo',
        relativePath: relocated(project.canvas.backgroundSource.relativePath, ['assets'])
      }
      break
    default:
      break
  }

  // L81-86：贴图
  const stickerClips = project.timeline.stickerClips ?? []
  for (const clip of stickerClips) {
    clip.relativePath = relocated(clip.relativePath, ['assets'])
  }

  resolver.checkCancellation?.()

  // L89-92
  const recordingURL = resolver.resolve(project.media?.screen.relativePath ?? null, session)

  // L97-111：时间戳代理回迁
  const cameraReference: ProjectMediaReference | null = project.media?.camera ?? null
  if (cameraReference != null) {
    const original = originalCameraRecordingPath(cameraReference.relativePath, resolver, session)
    if (original != null) {
      cameraReference.relativePath = original
      cameraReference.sourceTimeScale = null
      cameraReference.sourceEndTime = null
    }
  }

  // L112-119
  const cameraRecordingURL = resolver.resolve(project.media?.camera?.relativePath ?? null, session)
  const microphoneRecordingURL = resolver.resolve(
    project.media?.microphone?.relativePath ?? null,
    session
  )

  // L121-172：警告
  const warnings: string[] = []
  if (loaded.recoveredFromPreviousRevision) {
    warnings.push(PROJECT_OPEN_WARNING.recoveredFromPreviousRevision)
  }
  if (relocatedDeclarations.size > 0) {
    warnings.push(PROJECT_OPEN_WARNING.relocatedMedia(relocatedDeclarations.size))
  }
  if (project.media == null) {
    warnings.push(PROJECT_OPEN_WARNING.missingMainMediaReference)
  } else if (recordingURL == null) {
    warnings.push(PROJECT_OPEN_WARNING.missingScreenMedia)
  }
  if (project.media?.camera != null && cameraRecordingURL == null) {
    warnings.push(PROJECT_OPEN_WARNING.missingCameraMedia)
  }
  if (project.media?.microphone != null && microphoneRecordingURL == null) {
    warnings.push(PROJECT_OPEN_WARNING.missingMicrophoneMedia)
  }

  const background: BackgroundSource = project.canvas.backgroundSource
  if (background.kind === 'projectImage' || background.kind === 'projectVideo') {
    if (resolver.resolve(background.relativePath, session) == null) {
      warnings.push(PROJECT_OPEN_WARNING.missingBackgroundMedia)
    }
  } else if (background.kind === 'systemImage' || background.kind === 'systemVideo') {
    if (!resolver.fileExists(background.absolutePath)) {
      warnings.push(PROJECT_OPEN_WARNING.missingSystemBackground)
    }
  }

  // L154-162：同一路径只计一次
  const missingStickerPaths = new Set<string>()
  for (const clip of project.timeline.stickerClips ?? []) {
    if (resolver.resolve(clip.relativePath, session) == null) missingStickerPaths.add(clip.relativePath)
  }
  if (missingStickerPaths.size > 0) {
    warnings.push(PROJECT_OPEN_WARNING.missingStickers(missingStickerPaths.size))
  }

  // L163-172：事件轨可失败，失败降级为空轨 + 警告
  let pointerEvents: PointerEventRecord[]
  try {
    pointerEvents = resolver.loadPointerEvents(project, session)
  } catch (error) {
    pointerEvents = []
    warnings.push(PROJECT_OPEN_WARNING.brokenPointerEvents(errorDescription(error)))
  }

  resolver.checkCancellation?.()

  // L174-205：遗留修复
  // 对比一整条自动缩放轨道与几十万条指针事件属于不可变后台快照的工作，
  // 不能放在主线程发布步骤里。
  const originalMotion = project.motion
  const originalAutomaticTrack = recorderZoomAnimations.get(project)
  const regroupedAutomaticTrack = repairingLegacyAutomaticAnimations(
    originalAutomaticTrack,
    pointerEvents,
    {
      easing: originalMotion.defaultZoomEasing as ZoomEasingPreset,
      transitionDuration: originalMotion.defaultZoomTransitionDuration
    }
  )
  const upgradedMotion = upgradeLegacyMotionDefaults(originalMotion)
  project.motion = upgradedMotion

  if (
    !zoomClipArraysEqual(regroupedAutomaticTrack, originalAutomaticTrack) &&
    upgradedMotion.defaultZoomEasing !== originalMotion.defaultZoomEasing
  ) {
    // 重分组把 easing 也按旧默认重写过了，这里把 automatic 片段同步到新默认，
    // 但不触碰用户手写的其它 easing。
    recorderZoomAnimations.set(
      project,
      regroupedAutomaticTrack.map((clip) => {
        const upgraded: ZoomAnimationClip = { ...clip }
        if (upgraded.origin === 'automatic' && upgraded.easing === originalMotion.defaultZoomEasing) {
          upgraded.easing = upgradedMotion.defaultZoomEasing as ZoomEasingPreset
        }
        return upgraded
      })
    )
  } else {
    recorderZoomAnimations.set(project, regroupedAutomaticTrack)
  }

  project.timeline = repairingPersistedRippleTransitions(
    project.timeline,
    project.motion.defaultZoomTransitionDuration
  )

  resolver.checkCancellation?.()

  return {
    normalizedPath,
    session,
    project,
    recordingURL,
    cameraRecordingURL,
    microphoneRecordingURL,
    pointerEvents,
    wasInterrupted,
    warnings
  }
}

/** Swift 数组值语义比较（`regroupedAutomaticTrack != originalAutomaticTrack`）。 */
export function zoomClipArraysEqual(
  a: readonly ZoomAnimationClip[],
  b: readonly ZoomAnimationClip[]
): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false
  }
  return true
}

/** Swift `appErrorDescription(error)`。 */
export function errorDescription(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 便于其它模块复用的空时间线引用（Swift `project.timeline` 恒存在）。 */
export type { ProjectTimeline }
