/**
 * Swift source: Sources/DogSCApp/EditorPersistenceIndicator.swift（109 行）@ 567fd6e
 *
 * L3-14   → 状态推导：反映**写入管线**，不是计时器
 * L16-41  → 标题 / 无障碍 / 标识符三张表
 * L44-78  → 胶囊：26pt 高、12pt 标记、7pt 间距、11pt 内边距
 * L97-109 → 保存中的呼吸点（6pt，0.8s 往复；reduce motion 时恒定全亮）
 *
 * 原注释：编辑器里的实时草稿还没提交，即使磁盘上的快照是干净的也不能标「已保存」。
 */

export type ProjectPersistenceStatus = 'clean' | 'saving' | 'failed'

export type EditorPersistenceBadgeState = 'saved' | 'saving' | 'editing' | 'failed'

/**
 * 状态推导（Swift L8-14）：
 * - 失败优先级最高（写入管线出事了）；
 * - 保存中次之；
 * - 干净快照还要看**有没有草稿** —— 有草稿就是「编辑中」。
 */
export function editorPersistenceBadgeState(input: {
  readonly status: ProjectPersistenceStatus
  readonly hasDraft: boolean
}): EditorPersistenceBadgeState {
  if (input.status === 'failed') return 'failed'
  if (input.status === 'saving') return 'saving'
  return input.hasDraft ? 'editing' : 'saved'
}

export const EDITOR_PERSISTENCE_TITLES: Readonly<Record<EditorPersistenceBadgeState, string>> = {
  saved: '已保存',
  saving: '正在保存',
  editing: '编辑中',
  failed: '保存失败',
}

export const EDITOR_PERSISTENCE_ACCESSIBILITY: Readonly<Record<EditorPersistenceBadgeState, string>> = {
  saved: '项目已自动保存',
  saving: '正在保存项目',
  editing: '正在编辑项目',
  failed: '查看自动保存失败原因',
}

export const EDITOR_PERSISTENCE_IDENTIFIERS: Readonly<Record<EditorPersistenceBadgeState, string>> = {
  saved: 'editor.persistence.saved',
  saving: 'editor.persistence.saving',
  editing: 'editor.persistence.editing',
  failed: 'editor.persistence.failed',
}

/** 胶囊尺寸（Swift L44 / L51-66）。 */
export const EDITOR_PERSISTENCE_BADGE_METRICS = {
  height: 26,
  markerSize: 12,
  spacing: 7,
  horizontalPadding: 11,
  fontSize: 12,
} as const

/** 失败态与常态的底色 / 描边不透明度（Swift L67-72）。 */
export const EDITOR_PERSISTENCE_BADGE_COLORS = {
  failedFillOpacity: 0.1,
  failedStrokeOpacity: 0.25,
  idleFillOpacity: 0.045,
  idleStrokeOpacity: 0.06,
  strokeWidth: 0.5,
} as const

/** 保存中的呼吸点（Swift L97-109）。 */
export const EDITOR_SAVE_DOT = {
  diameter: 6,
  minScale: 0.6,
  maxScale: 1,
  minOpacity: 0.45,
  maxOpacity: 1,
  period: 0.8,
} as const

/**
 * 呼吸点的当前帧：`reduce motion` 时直接取满幅（不闪），否则按 easeInOut 往复。
 * 返回 [scale, opacity]，两者同步 —— 只缩不变淡会像故障指示灯。
 */
export function editorSaveDotFrame(elapsed: number, reduceMotion: boolean): { scale: number; opacity: number } {
  if (reduceMotion) return { scale: EDITOR_SAVE_DOT.maxScale, opacity: EDITOR_SAVE_DOT.maxOpacity }
  const half = EDITOR_SAVE_DOT.period
  const cycle = ((elapsed % (half * 2)) + half * 2) % (half * 2)
  const t = cycle <= half ? cycle / half : 2 - cycle / half // 三角波
  const eased = t * t * (3 - 2 * t) // smoothstep ≈ easeInOut
  return {
    scale: EDITOR_SAVE_DOT.minScale + (EDITOR_SAVE_DOT.maxScale - EDITOR_SAVE_DOT.minScale) * eased,
    opacity: EDITOR_SAVE_DOT.minOpacity + (EDITOR_SAVE_DOT.maxOpacity - EDITOR_SAVE_DOT.minOpacity) * eased,
  }
}

/** 图标种类（Swift L80-94）：勾 / 呼吸点 / 铅笔 / 警告。 */
export function editorPersistenceMarker(state: EditorPersistenceBadgeState): 'check' | 'progressDot' | 'pencil' | 'warning' {
  switch (state) {
    case 'saved':
      return 'check'
    case 'saving':
      return 'progressDot'
    case 'editing':
      return 'pencil'
    case 'failed':
      return 'warning'
  }
}
