/**
 * 缩放过渡求解：检查器、预览与导出共用的唯一裁剪逻辑。
 *
 * Swift source: Sources/RecorderCore/ZoomTransitionResolution.swift @ laogou717/dogsc 567fd6e
 *
 * 关键语义：修剪输出尾巴时**工程手授的范围保持不变**，所以之后还原媒体
 * 不会摧毁隐藏的动画内容；只有「实际求值的窗口」被拟合到末尾。
 *
 * （requestedEnterDuration / requestedExitDuration / preserveTransitionIntent
 *  已在 ZoomAnimation.ts 中按同文件扩展转写。）
 */

import type { TimeInterval, ZoomAnimationClip } from './ZoomAnimation'
import {
  clipDuration,
  requestedEnterDuration,
  requestedExitDuration,
  ZOOM_INTERP,
} from './ZoomAnimation'

export function resolveZoomTransitions(
  animations: ZoomAnimationClip[],
  outputDuration: TimeInterval
): ZoomAnimationClip[] {
  if (!Number.isFinite(outputDuration) || !(outputDuration > 0)) return []
  const ordered = animations
    .filter(c => c.startTime < outputDuration && clipDuration(c) > 0.001)
    .sort((lhs, rhs) =>
      lhs.startTime === rhs.startTime
        ? (lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0)
        : lhs.startTime - rhs.startTime
    )

  return ordered.map((authored, index) => {
    const clip = { ...authored }
    const next = index + 1 < ordered.length ? ordered[index + 1] : null
    const requestedEnter = Math.max(requestedEnterDuration(clip), 0)
    const requestedExit = Math.max(requestedExitDuration(clip), 0)
    if (next) {
      const gap = Math.max(next.startTime - clip.endTime, 0)
      clip.exitDuration =
        gap <= ZOOM_INTERP.adjacencyTolerance ? 0 : Math.min(requestedExit, gap)
    } else {
      const available = Math.max(outputDuration - clip.startTime, 0)
      // 短缩放保留真实的进入与回落；长缩放只缩短最后的保持段，
      // 工程里手授的过渡时长永远不动。
      const exit = Math.min(requestedExit, Math.max(available - Math.min(requestedEnter, available * 0.5), 0))
      clip.endTime = Math.min(clip.endTime, outputDuration - exit)
      if (clip.endTime < authored.endTime - 0.000001) {
        clip.exitProgressOffset = 0
      }
      clip.exitDuration = Math.min(requestedExit, Math.max(outputDuration - clip.endTime, 0))
    }
    clip.enterDuration = Math.min(requestedEnter, clipDuration(clip))
    return clip
  })
}
