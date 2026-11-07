/**
 * 编辑器临时提示卡 —— Swift EditorTransientNotice.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorTransientNotice.swift（78 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - 三条特殊文案改写（同轨道冲突 / 剩余不够 / 项目已打开前缀）  L11-23
 *   - 存活时长 = 详情字数 × 0.08，夹 [5, 10] 秒                L27
 *   - 卡片几何（352 宽 / 14 内边距 / 圆角 16 / 进度条 2pt）      L28-63
 *   - reduce motion 时不跑进度条动画，但仍按时关闭              L67-76
 *
 * 原注释：这是**短暂反馈**。持续性失败有自己的保存/预览状态条目，
 * 这张卡片永远不会占住工作区等用户手动关闭。
 */

export const TRANSIENT_NOTICE_METRICS = {
  width: 352,
  padding: 14,
  cornerRadius: 16,
  sectionSpacing: 12,
  iconRowSpacing: 11,
  iconSize: 17,
  iconFrame: 30,
  titleSize: 13,
  detailSize: 12,
  textSpacing: 5,
  closeGlyphSize: 12.5,
  closeButtonSize: 24,
  progressHeight: 2,
  progressLeading: 41,
} as const

/** 每秒字数：详情越长停留越久。 */
export const TRANSIENT_NOTICE_SECONDS_PER_CHARACTER = 0.08
export const TRANSIENT_NOTICE_MINIMUM_SECONDS = 5
export const TRANSIENT_NOTICE_MAXIMUM_SECONDS = 10

/** 项目打开但有警告时的固定前缀（去掉它作为详情正文）。 */
export const TRANSIENT_NOTICE_PROJECT_OPENED_PREFIX = '项目已打开，但'

/** 上游的两条「粘贴失败」原文 —— 只有**完全相等**时才改写文案。 */
export const TRANSIENT_NOTICE_SAME_TRACK_MESSAGE =
  '此处已有同轨道动画，无法粘贴完整片段。请在足够长的空白处粘贴。'
export const TRANSIENT_NOTICE_INSUFFICIENT_TAIL_MESSAGE =
  '此位置到片尾的时长不足，无法粘贴完整片段。请选择更靠前的位置。'

export interface TransientNoticeContent {
  readonly title: string
  readonly detail: string
}

/**
 * Swift `content`：三条改写 + 兜底。
 *
 * 注意前缀匹配是「以『项目已打开，但』开头」，改写后详情是**去掉前缀的余下部分** ——
 * 标题固定、正文才是真正的警告。
 */
export function transientNoticeContent(message: string): TransientNoticeContent {
  if (message === TRANSIENT_NOTICE_SAME_TRACK_MESSAGE) {
    return { title: '这里已有片段', detail: '移到空白处，或贴近边缘再粘贴' }
  }
  if (message === TRANSIENT_NOTICE_INSUFFICIENT_TAIL_MESSAGE) {
    return { title: '剩余空间不够', detail: '移到更靠前的位置，保留完整片段' }
  }
  if (message.startsWith(TRANSIENT_NOTICE_PROJECT_OPENED_PREFIX)) {
    return {
      title: '项目已打开，需要留意',
      detail: message.slice(TRANSIENT_NOTICE_PROJECT_OPENED_PREFIX.length),
    }
  }
  return { title: '操作未完成', detail: message }
}

/** Swift L27：`min(max(字数 × 0.08, 5), 10)`。 */
export function transientNoticeLifetime(detail: string): number {
  return Math.min(
    Math.max(detail.length * TRANSIENT_NOTICE_SECONDS_PER_CHARACTER, TRANSIENT_NOTICE_MINIMUM_SECONDS),
    TRANSIENT_NOTICE_MAXIMUM_SECONDS
  )
}

/** reduce motion 时进度条**不**做线性收缩（但仍按同一时长关闭）。 */
export function transientNoticeAnimatesProgress(reduceMotion: boolean): boolean {
  return !reduceMotion
}

/**
 * 进度条填充宽度（按剩余比例）。
 * 卡片 352 宽、左右各 14 内边距、进度条再让出 41pt（与图标列对齐）→ 满格 283pt。
 */
export function transientNoticeProgressWidth(cardWidth: number, remaining: number): number {
  const ratio = Math.min(Math.max(remaining, 0), 1)
  const track =
    cardWidth - 2 * TRANSIENT_NOTICE_METRICS.padding - TRANSIENT_NOTICE_METRICS.progressLeading
  return Math.max(track, 0) * ratio
}
