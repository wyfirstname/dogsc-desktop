/**
 * 显示器解析 —— Swift CaptureDisplayResolution.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/CaptureDisplayResolution.swift（67 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - enum CaptureDisplayResolver          L10-28 → resolveCaptureDisplay
 *   - struct CaptureDisplayIdentity        L30-33 → CaptureDisplayIdentity
 *   - struct CaptureAreaSelectionResult    L35-38 → CaptureAreaSelectionResult
 *   - enum CaptureAreaSelectionOutcome     L40-44 → CaptureAreaSelectionOutcome
 *   - enum AppKitCaptureDisplayResolver    L46-67 → 屏幕句柄注入版
 *
 * 原注释（L5-9）：
 *   The single display-identity policy used at every capture boundary.
 *   A caller that supplies an ID has selected a concrete privacy boundary. That
 *   identity must never degrade to another display. Default selection is allowed
 *   only when no ID was requested explicitly.
 *
 * 这是全应用**唯一**的显示器身份策略：一旦调用方给出 ID，就绝不回落到别的屏。
 */

/** 归一化矩形（Swift `NormalizedRect`）。 */
export interface NormalizedRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Swift L30-33。 */
export interface CaptureDisplayIdentity {
  readonly id: number
  readonly name: string
}

/** Swift L35-38。 */
export interface CaptureAreaSelectionResult {
  readonly display: CaptureDisplayIdentity
  readonly rect: NormalizedRect
}

/** Swift L40-44。 */
export type CaptureAreaSelectionOutcome =
  | { readonly kind: 'selected'; readonly result: CaptureAreaSelectionResult }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'displayUnavailable'; readonly requestedID: number | null }

/**
 * Swift L11-27。
 *
 * 三级回落：显式 ID（命中即返回，**未命中返回 null，不降级**）→ 首选默认 ID
 * → 第一个 ID 非空的候选。
 */
export function resolveCaptureDisplay<Candidate>(
  requestedID: number | null,
  candidates: readonly Candidate[],
  candidateID: (candidate: Candidate) => number | null,
  preferredDefaultID: number | null
): Candidate | null {
  if (requestedID != null) {
    return candidates.find((candidate) => candidateID(candidate) === requestedID) ?? null
  }
  if (preferredDefaultID != null) {
    const preferred = candidates.find((candidate) => candidateID(candidate) === preferredDefaultID)
    if (preferred != null) return preferred
  }
  return candidates.find((candidate) => candidateID(candidate) != null) ?? null
}

/** Swift L57-60 `identity(for:)`。 */
export function captureDisplayIdentity(
  screen: { readonly id: number | null; readonly name: string }
): CaptureDisplayIdentity | null {
  if (screen.id == null) return null
  return { id: screen.id, name: screen.name }
}

/**
 * Swift L48-55 `resolveScreen(requestedID:)`：候选是全部屏幕，
 * 首选默认是主屏（`NSScreen.main`）。Electron 侧由主进程 `screen.getAllDisplays()`
 * 提供等价列表。
 */
export function resolveCaptureDisplayScreen<T extends { readonly id: number | null }>(
  requestedID: number | null,
  screens: readonly T[],
  preferredDefaultID: number | null
): T | null {
  return resolveCaptureDisplay(requestedID, screens, (screen) => screen.id, preferredDefaultID)
}

/** Swift L62-66：`NSScreenNumber` → displayID；缺失即 null。 */
export function screenDeviceDisplayID(
  deviceDescription: Record<string, unknown> | null | undefined
): number | null {
  if (deviceDescription == null) return null
  const raw = deviceDescription.NSScreenNumber
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Math.trunc(Number(raw))
  }
  return null
}

/** 选区结果 → 结果枚举（便于 switch）。 */
export function captureAreaSelectionOutcome(
  result: CaptureAreaSelectionResult | null,
  cancelled: boolean,
  requestedID: number | null
): CaptureAreaSelectionOutcome {
  if (cancelled) return { kind: 'cancelled' }
  if (result != null) return { kind: 'selected', result }
  return { kind: 'displayUnavailable', requestedID }
}
