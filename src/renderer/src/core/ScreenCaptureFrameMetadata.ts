/**
 * ScreenCaptureKit 帧元数据 —— Swift ScreenCaptureFrameMetadata.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/ScreenCaptureFrameMetadata.swift（31 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - status(of:)   L11-30 → screenCaptureFrameStatus / decodeFrameStatus
 *
 * 原注释（L5-7）：
 *   Reads ScreenCaptureKit's Core Media attachment dictionary without bridging
 *   the complete CFArray/CFDictionary pair into new Swift collections on every
 *   captured frame.
 *
 * 迁移说明：Electron 侧拿不到 CMSampleBuffer，主进程把附件里的 `status` 原样
 * 传过来；这里只做**取值与类型收敛**，跳过整份字典的复制正是原实现的意图。
 */

/** Swift `SCFrameStatus` 的 rawValue。 */
export const SC_FRAME_STATUS = {
  complete: 0,
  idle: 1,
  blank: 2,
  suspended: 3,
  started: 4,
  stopped: 5
} as const

export type SCFrameStatusValue = (typeof SC_FRAME_STATUS)[keyof typeof SC_FRAME_STATUS]

/** Swift `SCStreamFrameInfo.status.rawValue`。 */
export const SC_STREAM_FRAME_INFO_STATUS_KEY = 'status'

/**
 * Swift L11-30：只取第一份附件字典里的 `status`，且必须是数字；
 * 缺失、非数字、数组为空一律返回 null（调用方据此判定「无状态」）。
 */
export function screenCaptureFrameStatus(
  attachments: readonly unknown[] | null | undefined
): SCFrameStatusValue | null {
  if (attachments == null || attachments.length === 0) return null
  const first = attachments[0]
  const status = readAttachmentStatus(first)
  return status == null ? null : decodeFrameStatus(status)
}

/** 从附件对象（字典 / Map / NSNumber 包装）里读 status 原始数值。 */
export function readAttachmentStatus(attachment: unknown): number | null {
  if (attachment == null || typeof attachment !== 'object') return null
  let raw: unknown
  if (attachment instanceof Map) {
    raw = attachment.get(SC_STREAM_FRAME_INFO_STATUS_KEY)
  } else {
    raw = (attachment as Record<string, unknown>)[SC_STREAM_FRAME_INFO_STATUS_KEY]
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  // `as? NSNumber`：数字字符串也接受（桥接层可能把 NSNumber 序列化成字符串）
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Math.trunc(Number(raw))
  }
  return null
}

/** Swift `SCFrameStatus(rawValue:)`：未知值返回 null（原版是失败初始化器）。 */
export function decodeFrameStatus(rawValue: number): SCFrameStatusValue | null {
  const values = Object.values(SC_FRAME_STATUS) as number[]
  return values.includes(rawValue) ? (rawValue as SCFrameStatusValue) : null
}

/** 状态名，用于日志与诊断（原版用 switch 打标签）。 */
export function frameStatusName(status: SCFrameStatusValue | null): string {
  switch (status) {
    case SC_FRAME_STATUS.complete:
      return 'complete'
    case SC_FRAME_STATUS.idle:
      return 'idle'
    case SC_FRAME_STATUS.blank:
      return 'blank'
    case SC_FRAME_STATUS.suspended:
      return 'suspended'
    case SC_FRAME_STATUS.started:
      return 'started'
    case SC_FRAME_STATUS.stopped:
      return 'stopped'
    default:
      return 'unknown'
  }
}

/** 该帧是否携带真实画面（idle/blank/suspended 都不算内容帧）。 */
export function frameStatusHasContent(status: SCFrameStatusValue | null): boolean {
  return status === SC_FRAME_STATUS.complete || status === SC_FRAME_STATUS.started
}
