/**
 * 不可变播放轨道构建的廉价校验门。
 *
 * Swift source: Sources/RecorderCore/TimelineTrackOrdering.swift @ laogou717/dogsc 567fd6e
 *
 * 编辑器手授数组通常本来就有确定的开始时间顺序，拖拽约束也防止片段越过
 * 邻居。复用这个判断可以避免每次交互草稿都排序并分配一整个新数组；
 * 畸形/历史输入仍走原始修复路径。
 */

import type { ZoomAnimationClip } from './ZoomAnimation'
import { clipDuration } from './ZoomAnimation'
import type { ScreenMotionClip } from './ProjectTimeline'

function zoomPrecedes(lhs: ZoomAnimationClip, rhs: ZoomAnimationClip): boolean {
  return lhs.startTime === rhs.startTime
    ? lhs.id < rhs.id
    : lhs.startTime < rhs.startTime
}

export function zoomAnimationsNeedRepair(animations: ZoomAnimationClip[]): boolean {
  for (let index = 0; index < animations.length; index++) {
    if (!(clipDuration(animations[index]) > 0.001)) return true
    if (index > 0 && zoomPrecedes(animations[index], animations[index - 1])) {
      return true
    }
  }
  return false
}

export function screenMotionClipsNeedRepair(clips: ScreenMotionClip[]): boolean {
  return motionClipsNeedRepair(clips, clip => ({ id: clip.id, startTime: clip.timing.startTime }))
}

function motionClipsNeedRepair<T>(
  clips: T[],
  identity: (clip: T) => { id: string; startTime: number }
): boolean {
  if (clips.length <= 1) return false
  for (let index = 1; index < clips.length; index++) {
    const current = identity(clips[index])
    const previous = identity(clips[index - 1])
    if (current.startTime < previous.startTime) return true
    if (current.startTime === previous.startTime && current.id < previous.id) return true
  }
  return false
}
