/**
 * 工程状态：单个当前项目 + 当前媒体资产 + 剪辑时间线。
 *
 * 原项目语义（Sources/RecorderCore/ProjectModel.swift）：
 * 录制完成即成为项目，不存在"空时间线"的中间态。
 * 因此这里也只维护「当前项目」，导入与录制都走 openAsset 这一条路。
 *
 * 剪辑层（Sources/RecorderCore/ProjectTimeline.swift）：
 * `timeline.sourceSequence` 是唯一的剪辑决策来源，
 * `TimelineMap` 每次用它 + 资产时长推导出输出时间线。
 * 撤销/重做只保存 ProjectTimeline 快照 —— 它足够小（几百字节~几 KB）。
 */
import { useCallback, useMemo, useState } from 'react'
import type { EditorProject, MediaAsset } from '../core/MediaAsset'
import { makeEmptyProject, makeProjectFromAsset } from '../core/MediaAsset'
import { type ProjectTimeline, makeProjectTimeline } from '../core/ProjectTimeline'
import { TimelineMap } from '../core/TimelineMap'

export interface EditorStore {
  project: EditorProject
  loading: boolean
  /** 剪辑决策（源序列 + 效果轨道）。 */
  timeline: ProjectTimeline
  /** 由 timeline + 资产时长推导的时间线映射；无资产时为 null。 */
  map: TimelineMap | null
  /** 输出时间线时长（剪辑后）。 */
  outputDuration: number
  /** 原始录屏时长（未剪辑）。 */
  sourceDuration: number
  canUndo: boolean
  canRedo: boolean
  /** 打开一个媒体资产（录制或导入）。 */
  openAsset: (asset: MediaAsset) => void
  /** 关闭项目，回到空状态。 */
  closeProject: () => void
  setLoading: (v: boolean) => void
  /**
   * 应用一次剪辑操作。编辑函数抛错时状态不变，错误向上抛出由调用方提示。
   * 返回操作后的新时间线，便于调用方做后续吸附。
   */
  applyEdit: (edit: (timeline: ProjectTimeline, fullSourceDuration: number) => ProjectTimeline) => void
  undo: () => void
  redo: () => void
}

const HISTORY_LIMIT = 100

export function useEditorStore(): EditorStore {
  const [project, setProject] = useState<EditorProject>(() => makeEmptyProject())
  const [loading, setLoading] = useState(false)
  const [timeline, setTimeline] = useState<ProjectTimeline>(() => makeProjectTimeline())
  const [undoStack, setUndoStack] = useState<ProjectTimeline[]>([])
  const [redoStack, setRedoStack] = useState<ProjectTimeline[]>([])

  const sourceDuration = project.asset?.duration ?? 0

  const map = useMemo(() => {
    if (!project.asset || sourceDuration <= 0) return null
    try {
      return new TimelineMap(timeline.sourceSequence, sourceDuration)
    } catch {
      // 理论上不可达：所有编辑操作都经过校验。真出现时退化为全片。
      return new TimelineMap({ kind: 'fullRecording' }, sourceDuration)
    }
  }, [project.asset, sourceDuration, timeline.sourceSequence])

  const openAsset = useCallback((asset: MediaAsset) => {
    setProject(makeProjectFromAsset(asset))
    setTimeline(makeProjectTimeline())
    setUndoStack([])
    setRedoStack([])
  }, [])

  const closeProject = useCallback(() => {
    setProject(makeEmptyProject())
    setTimeline(makeProjectTimeline())
    setUndoStack([])
    setRedoStack([])
  }, [])

  const applyEdit = useCallback(
    (edit: (t: ProjectTimeline, fullSourceDuration: number) => ProjectTimeline) => {
      if (sourceDuration <= 0) return
      // 关键：编辑函数必须在 setState 之外执行。
      // 若放进 setTimeline(updater)，React 会把更新器推迟到渲染阶段调用，
      // 编辑校验抛出的错误会变成 uncaught 渲染错误，导致整个应用白/黑屏
      // （try/catch 只能捕获这里同步抛出的错误）。
      const next = edit(timeline, sourceDuration)
      if (next === timeline) return
      setUndoStack(stack => [...stack, timeline].slice(-HISTORY_LIMIT))
      setRedoStack([])
      setTimeline(next)
    },
    [sourceDuration, timeline]
  )

  const undo = useCallback(() => {
    setUndoStack(stack => {
      if (stack.length === 0) return stack
      const previous = stack[stack.length - 1]
      setTimeline(current => {
        setRedoStack(redo => [...redo, current])
        return previous
      })
      return stack.slice(0, -1)
    })
  }, [])

  const redo = useCallback(() => {
    setRedoStack(stack => {
      if (stack.length === 0) return stack
      const next = stack[stack.length - 1]
      setTimeline(current => {
        setUndoStack(undo => [...undo, current])
        return next
      })
      return stack.slice(0, -1)
    })
  }, [])

  return useMemo(
    () => ({
      project,
      loading,
      timeline,
      map,
      outputDuration: map?.outputDuration ?? sourceDuration,
      sourceDuration,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      openAsset,
      closeProject,
      setLoading,
      applyEdit,
      undo,
      redo,
    }),
    [
      project,
      loading,
      timeline,
      map,
      sourceDuration,
      undoStack.length,
      redoStack.length,
      openAsset,
      closeProject,
      applyEdit,
      undo,
      redo,
    ]
  )
}
