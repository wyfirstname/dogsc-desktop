/**
 * 导出文件事务 —— Swift ExportFileTransaction.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/ExportFileTransaction.swift（33 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - collides(outputURL:inputURLs:)          L7-10   → exportFileTransactionCollides
 *   - makeTemporaryURL(for:)                  L12-19  → temporaryExportPath
 *   - promote(temporaryURL:to:)               L21-28  → exportPromotionMode
 *   - canonicalPath(_:)                       L30-32  → canonicalExportPath
 *
 * 原注释（L3-5）：
 *   File-system boundary shared by export request validation and final output
 *   publication. Keeping this independent from AVFoundation makes stale-temp
 *   and path-alias behavior deterministic and directly testable.
 *
 * 迁移说明：`standardizedFileURL.resolvingSymlinksInPath()` 的符号链接解析需要
 * 真实文件系统，故抽成 `resolveSymlinks` 注入；纯路径归一化在此完成。
 */

/** Swift L30-32 的纯部分：标准化路径（折叠 `.` / `..` / 重复分隔符）。 */
export function canonicalExportPath(
  path: string,
  resolveSymlinks?: (standardized: string) => string
): string {
  const standardized = normalizePath(path)
  return resolveSymlinks ? normalizePath(resolveSymlinks(standardized)) : standardized
}

/** POSIX 语义的路径标准化（不访问文件系统）。 */
export function normalizePath(path: string): string {
  const isAbsolute = path.startsWith('/')
  const segments = path.split('/')
  const stack: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop()
      } else if (!isAbsolute) {
        stack.push('..')
      }
      continue
    }
    stack.push(segment)
  }
  const joined = stack.join('/')
  if (isAbsolute) return '/' + joined
  return joined === '' ? '.' : joined
}

/** Swift L7-10：输出路径与任一输入路径是同一文件（含符号链接别名）即视为冲突。 */
export function exportFileTransactionCollides(
  outputPath: string,
  inputPaths: readonly string[],
  resolveSymlinks?: (standardized: string) => string
): boolean {
  const outputCanonical = canonicalExportPath(outputPath, resolveSymlinks)
  return inputPaths.some(
    (input) => canonicalExportPath(input, resolveSymlinks) === outputCanonical
  )
}

/** 拆分目录 / 无扩展名主干 / 扩展名（Swift URL 语义）。 */
export function splitFilePath(path: string): {
  folder: string
  base: string
  fileExtension: string
} {
  const normalized = normalizePath(path)
  const separator = normalized.lastIndexOf('/')
  const folder = separator <= 0 ? (separator === 0 ? '/' : '.') : normalized.slice(0, separator)
  const name = separator < 0 ? normalized : normalized.slice(separator + 1)
  // Swift `pathExtension`：最后一个非首位点之后的部分；前导点视为隐藏文件的一部分。
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return { folder, base: name, fileExtension: '' }
  return { folder, base: name.slice(0, dot), fileExtension: name.slice(dot + 1) }
}

/** Swift L12-19 的临时文件名模板。 */
export const EXPORT_TEMP_INFIX = 'dogsc-export'
export const EXPORT_TEMP_DEFAULT_EXTENSION = 'mp4'

/**
 * Swift L12-19：把临时文件放在**输出同目录**（跨卷 rename 会失败），
 * 名字 `.基线.dogsc-export-<uuid>.tmp.<扩展名>`，隐藏文件避免污染用户视野。
 */
export function temporaryExportPath(finalPath: string, uuid: string): string {
  const { folder, base, fileExtension } = splitFilePath(finalPath)
  const ext = fileExtension === '' ? EXPORT_TEMP_DEFAULT_EXTENSION : fileExtension
  const token = uuid.toLowerCase()
  const name = `.${base}.${EXPORT_TEMP_INFIX}-${token}.tmp.${ext}`
  return folder === '.' ? name : `${folder}/${name}`
}

/** Swift L21-28 的两条落地路径。 */
export type ExportPromotionMode = 'replace' | 'move'

/** 目标已存在 → `replaceItemAt`（原子替换），否则 → `moveItem`。 */
export function exportPromotionMode(finalExists: boolean): ExportPromotionMode {
  return finalExists ? 'replace' : 'move'
}

/** 便于主进程直接执行的描述（不做实际 I/O）。 */
export interface ExportPromotionPlan {
  readonly mode: ExportPromotionMode
  readonly temporaryPath: string
  readonly finalPath: string
}

export function exportPromotionPlan(
  temporaryPath: string,
  finalPath: string,
  finalExists: boolean
): ExportPromotionPlan {
  return { mode: exportPromotionMode(finalExists), temporaryPath, finalPath }
}
