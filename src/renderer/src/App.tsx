/**
 * DogSC 主窗口
 *
 * 布局复刻自 laogou717/dogsc 的 EditorView（docs/images/editor.png）：
 *   ┌──────────────────────────────────────────────┐
 *   │  顶栏：项目名 / 撤销重做 / 导出               │
 *   ├──────────────────────────────┬───────────────┤
 *   │                              │  检查器面板    │
 *   │        画布预览区            │  (画面/运镜/  │
 *   │   （带背景的居中预览）        │   光标/音频)  │
 *   ├──────────────────────────────┴───────────────┤
 *   │  时间线：轨道 + 胶片缩略图 + 播放头            │
 *   └──────────────────────────────────────────────┘
 *
 * 数据流：
 *   录制完成 ─┬─→ onAssetReady ─┐
 *   导入视频 ─┴─────────────────┴─→ store.openAsset → 画布 + 时间线同步
 *
 * 剪辑数据流：
 *   用户操作 → ProjectTimelineEditing.*（纯函数，抛错即拒绝）
 *           → store.applyEdit（自动压入撤销栈）
 *           → timeline 变化 → TimelineMap 重算 → 时间线/画布重绘
 *
 * Swift source: Sources/DogSCApp/EditorView.swift @ laogou717/dogsc 567fd6e
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Layout,
  Button,
  Space,
  Tooltip,
  Dropdown,
  message,
  Modal,
  List,
  Typography,
  Select,
  Divider,
  Progress,
} from 'antd'
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  ExportOutlined,
  UndoOutlined,
  RedoOutlined,
  ImportOutlined,
  FolderOpenOutlined,
  CaretRightOutlined,
  DownOutlined,
  ScissorOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import CanvasPreview from './components/CanvasPreview'
import InspectorPanel from './components/InspectorPanel'
import TimelineView, { primeThumbnailCache } from './components/TimelineView'
import RecordButton from './components/RecordButton'
import { useEditorStore } from './store/useEditorStore'
import { formatTimecode, formatFileSize } from './core/MediaAsset'
import type { ScreenMotionState } from './core/ScreenTransform'
import { DEFAULT_SCREEN_MOTION } from './core/ScreenTransform'
import * as Editing from './core/ProjectTimelineEditing'
import { MAXIMUM_PLAYBACK_RATE, MINIMUM_PLAYBACK_RATE } from './core/ProjectTimeline'
import { randomUUID } from './core/ProjectTimeline'
import type { CanvasStyle, CursorStyle, OpeningSequence } from './core/ProjectModel'
import {
  makeCanvasStyle,
  makeCursorStyle,
  makeOpeningSequence,
} from './core/ProjectModel'

const { Header, Sider, Content, Footer } = Layout

export default function App() {
  const [tab, setTab] = useState('canvas')
  const store = useEditorStore()
  const { project, timeline, map } = store
  const asset = project.asset

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [recent, setRecent] = useState<{ path: string; name: string; size: number; createdAt: number }[]>([])
  const seekingFromTimeline = useRef(false)

  /** 当前选中的主片段 id（剪辑操作的作用对象）。 */
  const [selectedSegmentID, setSelectedSegmentID] = useState<string | null>(null)
  /** 裁切拖拽中的预览值：提交前不写入 store，避免撤销栈被拖拽淹没。 */
  const trimPreviewRef = useRef<{
    segmentID: string
    edge: 'left' | 'right'
    time: number
  } | null>(null)

  // 3D 运镜状态（每个项目独立；切换资产时重置）
  const [motion, setMotion] = useState<ScreenMotionState>(DEFAULT_SCREEN_MOTION)
  // 导出状态
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportPct, setExportPct] = useState(0)
  const [exportResult, setExportResult] = useState<{ ok: boolean; output?: string; error?: string } | null>(null)
  // 画布样式 / 光标样式 / 开场转场（对应原版 CanvasStyle / CursorStyle / OpeningSequence）
  const [canvasStyle, setCanvasStyle] = useState<CanvasStyle>(() => makeCanvasStyle())
  const [cursorStyle, setCursorStyle] = useState<CursorStyle>(() => makeCursorStyle())
  const [opening, setOpening] = useState<OpeningSequence>(() => makeOpeningSequence())
  // 是否显示画布 3D 编辑手柄：只在「运镜」页签时显示，避免干扰播放
  const showHandles = tab === 'motion' && !!asset

  const outputDuration = store.outputDuration
  const sourceDuration = store.sourceDuration

  // 资产变化时重置播放状态
  useEffect(() => {
    setCurrentTime(0)
    setDuration(asset?.duration ?? 0)
    setPlaying(false)
    setMotion({ ...DEFAULT_SCREEN_MOTION })
    setSelectedSegmentID(null)
    trimPreviewRef.current = null
    if (asset?.thumbnails?.length) primeThumbnailCache(asset.thumbnails)
  }, [asset])

  /** 统一的剪辑执行入口：捕获校验错误并提示用户。 */
  const runEdit = useCallback(
    (label: string, edit: (t: typeof timeline, d: number) => typeof timeline): boolean => {
      try {
        let changed = false
        store.applyEdit((current, fullSourceDuration) => {
          const next = edit(current, fullSourceDuration)
          changed = next !== current
          return next
        })
        return changed
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        message.warning(`${label}失败：${reason}`)
        return false
      }
    },
    [store, timeline]
  )

  // ---------------------------------------------------------------- 剪辑操作

  const splitAtPlayhead = useCallback(() => {
    if (!map || outputDuration <= 0) return
    const newID = randomUUID()
    const ok = runEdit('分割', (t, d) =>
      Editing.splitPrimarySegment(t, currentTime, newID, d)
    )
    if (ok) {
      setSelectedSegmentID(newID)
      message.success('已在播放头处分割')
    }
  }, [map, outputDuration, currentTime, runEdit])

  const deleteSelected = useCallback(() => {
    const id = selectedSegmentID ?? map?.segmentAtOutputTime(currentTime)?.id ?? null
    if (!id) {
      message.info('请先在时间线上选中要删除的片段')
      return
    }
    const ok = runEdit('删除', (t, d) => Editing.removePrimarySegment(t, id, d))
    if (ok) {
      setSelectedSegmentID(null)
      setCurrentTime(t => Math.min(t, Math.max(store.outputDuration - 0.05, 0)))
      message.success('片段已删除，后续内容已自动前移')
    }
  }, [selectedSegmentID, map, currentTime, runEdit, store.outputDuration])

  const setRate = useCallback(
    (rate: number) => {
      const id = selectedSegmentID ?? map?.segmentAtOutputTime(currentTime)?.id ?? null
      if (!id) {
        message.info('请先在时间线上选中片段')
        return
      }
      const ok = runEdit('变速', (t, d) => Editing.settingPlaybackRate(rate, id, t, d))
      if (ok) message.success(`已设为 ${rate}× 播放`)
    },
    [selectedSegmentID, map, currentTime, runEdit]
  )

  const restoreJunction = useCallback(
    (previousID: string, nextID: string) => {
      const ok = runEdit('还原', (t, d) =>
        Editing.restorePrimaryGap(t, previousID, nextID, randomUUID(), d)
      )
      if (ok) message.success('已还原被删掉的素材')
      else message.info('这里没有可还原的素材')
    },
    [runEdit]
  )

  // 裁切预览：只更新本地播放头，不动 store
  const handleTrimPreview = useCallback(
    (segmentID: string, edge: 'left' | 'right', outputTime: number) => {
      trimPreviewRef.current = { segmentID, edge, time: outputTime }
      setCurrentTime(outputTime)
    },
    []
  )

  const handleTrimCommit = useCallback(
    (segmentID: string, edge: 'left' | 'right') => {
      const preview = trimPreviewRef.current
      trimPreviewRef.current = null
      if (!preview || preview.segmentID !== segmentID) return
      const target = preview.time
      runEdit('裁切', (t, d) => Editing.trimPrimarySegment(t, segmentID, edge, target, d))
    },
    [runEdit]
  )

  // ---------------------------------------------------------------- 导入 / 录制

  const handleImport = useCallback(async () => {
    const r = await window.dogsc.importMedia()
    if (!r.ok) {
      if (!r.canceled) message.error(`导入失败：${r.error ?? '未知错误'}`)
      return
    }
    const adopted = await window.dogsc.adoptMedia(r.path!)
    const finalPath = adopted.ok && adopted.path ? adopted.path : r.path!
    store.openAsset({
      id: `imp-${Date.now()}`,
      path: finalPath,
      name: r.name ?? '导入视频',
      duration: r.duration ?? 0,
      width: r.width ?? 0,
      height: r.height ?? 0,
      fps: r.fps ?? 0,
      size: r.size ?? 0,
      origin: 'import',
      createdAt: Date.now(),
      thumbnails: r.thumbnails ?? [],
    })
    message.success('已导入')
  }, [store])

  const handleAssetReady = useCallback(
    (a: Parameters<typeof store.openAsset>[0]) => {
      store.openAsset(a)
    },
    [store]
  )

  const openRecent = useCallback(async () => {
    const list = await window.dogsc.listRecordings()
    setRecent(list)
    setRecentOpen(true)
  }, [])

  const pickRecent = useCallback(
    async (p: string) => {
      setRecentOpen(false)
      const desc = await window.dogsc.describeMedia(p)
      if (!desc.ok || !desc.path) {
        message.error(`载入失败：${desc.error ?? '未知错误'}`)
        return
      }
      store.openAsset({
        id: `rec-${Date.now()}`,
        path: desc.path,
        name: desc.name ?? '录制',
        duration: desc.duration ?? 0,
        width: desc.width ?? 0,
        height: desc.height ?? 0,
        fps: desc.fps ?? 0,
        size: desc.size ?? 0,
        origin: 'recording',
        createdAt: Date.now(),
        thumbnails: desc.thumbnails ?? [],
      })
    },
    [store]
  )

  const togglePlay = useCallback(() => {
    if (!asset) return
    setPlaying(p => !p)
  }, [asset])

  /** 背景媒体选择：图片 → systemImage，视频 → systemVideo（EditorBackgroundInspector 的媒体页签）。 */
  const pickBackgroundMedia = useCallback(async () => {
    const r = await window.dogsc.pickBackgroundMedia()
    if (!r.ok) {
      if (!r.canceled) message.error(`背景选择失败：${r.error ?? '未知错误'}`)
      return
    }
    setCanvasStyle(style =>
      makeCanvasStyle({
        ...style,
        backgroundSource:
          r.kind === 'image'
            ? { kind: 'systemImage', absolutePath: r.path! }
            : { kind: 'systemVideo', absolutePath: r.path! },
      })
    )
  }, [])

  /** 导出成片：把 TimelineMap 的保留片段交给 ffmpeg 拼接。 */
  const runExport = useCallback(async () => {
    if (!asset || !map || map.segments.length === 0) return
    setExportOpen(true)
    setExporting(true)
    setExportPct(0)
    setExportResult(null)
    const unsub = window.dogsc.onExportProgress(pct => setExportPct(pct))
    try {
      const r = await window.dogsc.exportTimeline({
        input: asset.path,
        segments: map.segments.map(s => ({
          sourceStart: s.sourceStart,
          sourceDuration: s.sourceDuration,
          playbackRate: s.playbackRate,
        })),
      })
      if (r.code === -2) {
        setExportOpen(false)
      } else if (r.code === 0) {
        setExportResult({ ok: true, output: r.output })
        message.success('导出完成')
      } else {
        setExportResult({ ok: false, error: r.stderr })
        message.error(`导出失败：${r.stderr.slice(0, 120)}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setExportResult({ ok: false, error: msg })
      message.error(`导出失败：${msg}`)
    } finally {
      unsub()
      setExporting(false)
    }
  }, [asset, map])

  /**
   * 开发期调试钩子：把载入资产、运镜与剪辑操作暴露到 window，
   * 供自动化脚本驱动 UI（正常用户操作不会用到）。
   */
  useEffect(() => {
    interface DebugApi {
      loadAsset: (a: Parameters<typeof store.openAsset>[0]) => void
      setMotion: (m: ScreenMotionState) => void
      setTab: (t: string) => void
      setCanvasStyle: (s: CanvasStyle) => void
      setCursorStyle: (s: CursorStyle) => void
      setOpening: (o: OpeningSequence) => void
      split: (t: number) => void
      remove: (id: string) => void
      setRate: (id: string, rate: number) => void
      trim: (id: string, edge: 'left' | 'right', t: number) => void
      seek: (t: number) => void
      state: () => unknown
      timeline: () => unknown
    }
    const w = window as unknown as { __dogscDebug?: DebugApi }
    w.__dogscDebug = {
      loadAsset: a => store.openAsset(a),
      setMotion: m => setMotion(m),
      setTab: t => setTab(t),
      setCanvasStyle: s => setCanvasStyle(s),
      setCursorStyle: s => setCursorStyle(s),
      setOpening: o => setOpening(o),
      split: t => {
        runEdit('分割', (tl, d) => Editing.splitPrimarySegment(tl, t, randomUUID(), d))
      },
      remove: id => {
        runEdit('删除', (tl, d) => Editing.removePrimarySegment(tl, id, d))
      },
      setRate: (id, rate) => {
        runEdit('变速', (tl, d) => Editing.settingPlaybackRate(rate, id, tl, d))
      },
      trim: (id, edge, t) => {
        runEdit('裁切', (tl, d) => Editing.trimPrimarySegment(tl, id, edge, t, d))
      },
      seek: t => setCurrentTime(t),
      state: () => ({
        currentTime,
        outputDuration,
        sourceDuration,
        playing,
        selectedSegmentID,
        canvasStyle,
        cursorStyle,
        opening,
        segments:
          map?.segments.map(s => ({
            id: s.id,
            sourceStart: s.sourceStart,
            sourceDuration: s.sourceDuration,
            playbackRate: s.playbackRate,
            outputStart: s.outputStart,
            outputEnd: s.outputStart + s.sourceDuration / s.playbackRate,
          })) ?? [],
      }),
      timeline: () => timeline,
    }
    return () => {
      delete w.__dogscDebug
    }
  })

  const handleSeek = useCallback((t: number) => {
    seekingFromTimeline.current = true
    setCurrentTime(t)
    seekingFromTimeline.current = false
  }, [])

  // 快捷键：空格播放/暂停、S 分割、Delete 删除、Ctrl+Z 撤销、Ctrl+Shift+Z 重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inField =
        !!target &&
        typeof target.closest === 'function' &&
        !!target.closest('input,textarea,[contenteditable="true"]')
      if (inField) return

      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        splitAtPlayhead()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, splitAtPlayhead, deleteSelected, store])

  const importMenu = {
    items: [
      { key: 'file', icon: <ImportOutlined />, label: '导入视频文件…' },
      { key: 'recent', icon: <FolderOpenOutlined />, label: '打开最近录制…' },
      { key: 'dir', icon: <FolderOpenOutlined />, label: '打开录制目录' },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'file') void handleImport()
      else if (key === 'recent') void openRecent()
      else void window.dogsc.openRecordings()
    },
  }

  const rateOptions = useMemo(
    () =>
      [1, 1.5, 2, 4, 8, 16, 32, 64, MAXIMUM_PLAYBACK_RATE]
        .filter(r => r >= MINIMUM_PLAYBACK_RATE)
        .map(r => ({ value: r, label: `${r}×` })),
    []
  )

  const activeSegment = selectedSegmentID
    ? map?.segmentByID(selectedSegmentID) ?? null
    : map?.segmentAtOutputTime(currentTime) ?? null

  return (
    <Layout style={{ height: '100vh', background: '#141414' }}>
      {/* 顶栏 */}
      <Header
        style={{
          height: 48,
          lineHeight: '48px',
          padding: '0 16px',
          background: '#1f1f1f',
          borderBottom: '1px solid #303030',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <Space>
          <span style={{ color: '#d9d9d9', fontWeight: 500 }}>DogSC</span>
          <Typography.Text style={{ color: '#8c8c8c', fontSize: 12 }} ellipsis>
            {project.title}
          </Typography.Text>
          {asset && (
            <Typography.Text style={{ color: '#595959', fontSize: 11 }}>
              {store.timeline.sourceSequence.kind === 'edited'
                ? `${store.timeline.sourceSequence.segments.length} 段 · `
                : ''}
              {formatTimecode(outputDuration)}
              {Math.abs(outputDuration - sourceDuration) > 0.02 && (
                <span style={{ color: '#73d13d' }}>
                  {' '}
                  (原 {formatTimecode(sourceDuration)})
                </span>
              )}
            </Typography.Text>
          )}
        </Space>
        <Space>
          <Dropdown menu={importMenu} trigger={['click']}>
            <Button type="text" icon={<ImportOutlined />}>
              导入 <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>
          <Tooltip title="撤销 (Ctrl+Z)">
            <Button
              type="text"
              icon={<UndoOutlined />}
              disabled={!store.canUndo}
              onClick={store.undo}
            />
          </Tooltip>
          <Tooltip title="重做 (Ctrl+Shift+Z)">
            <Button
              type="text"
              icon={<RedoOutlined />}
              disabled={!store.canRedo}
              onClick={store.redo}
            />
          </Tooltip>
          <Button type="primary" icon={<ExportOutlined />} disabled={!asset} onClick={() => void runExport()}>
            导出
          </Button>
        </Space>
      </Header>

      <Layout>
        {/* 中间：画布预览 */}
        <Content style={{ position: 'relative', background: '#0f0f0f' }}>
          <CanvasPreview
            asset={asset}
            timelineMap={map}
            currentTime={currentTime}
            playing={playing}
            onTimeUpdate={t => {
              if (!seekingFromTimeline.current) setCurrentTime(t)
            }}
            onDurationChange={d => setDuration(d)}
            onTogglePlay={togglePlay}
            onImport={() => void handleImport()}
            onOpenRecordings={() => void window.dogsc.openRecordings()}
            motion={motion}
            onMotionChange={setMotion}
            showHandles={showHandles}
            canvasStyle={canvasStyle}
            cursorStyle={cursorStyle}
            opening={opening}
          />

          {/* 悬浮播放控制条 */}
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.65)',
              borderRadius: 20,
              padding: '6px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span
              onClick={togglePlay}
              style={{ cursor: asset ? 'pointer' : 'default', display: 'flex' }}
            >
              {playing ? (
                <PauseCircleOutlined style={{ fontSize: 20, color: '#fff' }} />
              ) : (
                <PlayCircleOutlined style={{ fontSize: 20, color: asset ? '#fff' : '#595959' }} />
              )}
            </span>
            <span style={{ color: '#d9d9d9', fontVariantNumeric: 'tabular-nums' }}>
              {formatTimecode(currentTime)} / {formatTimecode(outputDuration || duration)}
            </span>
            <CaretRightOutlined
              title="导入视频"
              onClick={() => void handleImport()}
              style={{ color: '#8c8c8c', cursor: 'pointer' }}
            />
          </div>

          {/* 悬浮录制按钮 */}
          <RecordButton onAssetReady={handleAssetReady} />
        </Content>

        {/* 右侧：检查器 */}
        <Sider width={300} theme="dark" style={{ borderLeft: '1px solid #303030' }}>
          <InspectorPanel
            activeTab={tab}
            onTabChange={setTab}
            motion={motion}
            onMotionChange={setMotion}
            canvasStyle={canvasStyle}
            onCanvasStyleChange={setCanvasStyle}
            cursorStyle={cursorStyle}
            onCursorStyleChange={setCursorStyle}
            opening={opening}
            onOpeningChange={setOpening}
            onPickBackgroundMedia={() => void pickBackgroundMedia()}
          />
        </Sider>
      </Layout>

      {/* 底部：剪辑工具条 + 时间线 */}
      <Footer style={{ padding: 0, height: 224, borderTop: '1px solid #303030' }}>
        <div
          style={{
            height: 44,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            background: '#1c1c1c',
            borderBottom: '1px solid #262626',
          }}
        >
          <Tooltip title="在播放头处分割 (S)">
            <Button
              size="small"
              type="text"
              icon={<ScissorOutlined />}
              disabled={!asset}
              onClick={splitAtPlayhead}
            />
          </Tooltip>
          <Tooltip title="删除选中片段，后续前移 (Delete)">
            <Button
              size="small"
              type="text"
              icon={<DeleteOutlined />}
              disabled={!asset}
              onClick={deleteSelected}
            />
          </Tooltip>
          <Divider type="vertical" style={{ margin: '0 2px' }} />
          <ThunderboltOutlined style={{ color: '#8c8c8c', fontSize: 13 }} />
          <Select
            size="small"
            style={{ width: 88 }}
            disabled={!asset}
            value={
              activeSegment && Math.abs(activeSegment.playbackRate - 1) > 0.001
                ? activeSegment.playbackRate
                : 1
            }
            options={rateOptions}
            onChange={v => setRate(v)}
          />
          <Divider type="vertical" style={{ margin: '0 2px' }} />
          <Typography.Text style={{ color: '#8c8c8c', fontSize: 11 }}>
            {activeSegment
              ? `片段 源 ${formatTimecode(activeSegment.sourceStart)} → ${formatTimecode(
                  activeSegment.sourceStart + activeSegment.sourceDuration
                )}（${activeSegment.sourceDuration.toFixed(2)}s）`
              : '点击时间线选中片段'}
          </Typography.Text>
          <div style={{ flex: 1 }} />
          <Typography.Text style={{ color: '#595959', fontSize: 11 }}>
            Ctrl+滚轮 缩放 · 拖两端裁切 · 双击接点还原
          </Typography.Text>
        </div>
        <div style={{ height: 180 }}>
          <TimelineView
            asset={asset}
            timelineMap={map}
            currentTime={currentTime}
            duration={outputDuration || duration || asset?.duration || 0}
            selectedSegmentID={selectedSegmentID}
            onSelectSegment={setSelectedSegmentID}
            onSeek={handleSeek}
            onTrimPreview={handleTrimPreview}
            onTrimCommit={handleTrimCommit}
            onRestoreJunction={restoreJunction}
          />
        </div>
      </Footer>

      {/* 导出进度 / 结果 */}
      <Modal
        title="导出成片"
        open={exportOpen}
        onCancel={() => { if (!exporting) setExportOpen(false) }}
        footer={
          exportResult?.ok ? (
            <Space>
              <Button
                type="primary"
                onClick={() => void window.dogsc.revealFile(exportResult.output!)}
              >
                在文件夹中显示
              </Button>
              <Button onClick={() => setExportOpen(false)}>关闭</Button>
            </Space>
          ) : (
            <Button disabled={exporting} onClick={() => setExportOpen(false)}>
              {exporting ? '导出中…' : '关闭'}
            </Button>
          )
        }
        width={480}
      >
        {exporting ? (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Typography.Text>
              正在按 {map?.segments.length ?? 0} 个片段拼接（{formatTimecode(outputDuration)}）
              {Math.abs(outputDuration - sourceDuration) > 0.02 &&
                `，已剪掉 ${formatTimecode(sourceDuration - outputDuration)}`}
            </Typography.Text>
            <Progress percent={exportPct} status="active" />
          </Space>
        ) : exportResult?.ok ? (
          <Typography.Text>已导出：{exportResult.output}</Typography.Text>
        ) : exportResult ? (
          <Typography.Text type="danger">导出失败：{exportResult.error}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">准备中…</Typography.Text>
        )}
      </Modal>

      {/* 最近录制列表 */}
      <Modal
        title="最近录制"
        open={recentOpen}
        onCancel={() => setRecentOpen(false)}
        footer={null}
        width={560}
      >
        {recent.length === 0 ? (
          <Typography.Text type="secondary">录制目录里还没有视频</Typography.Text>
        ) : (
          <List
            dataSource={recent}
            renderItem={item => (
              <List.Item
                style={{ cursor: 'pointer' }}
                onClick={() => void pickRecent(item.path)}
                actions={[
                  <Typography.Link
                    key="reveal"
                    onClick={e => {
                      e.stopPropagation()
                      void window.dogsc.revealFile(item.path)
                    }}
                  >
                    定位
                  </Typography.Link>,
                ]}
              >
                <List.Item.Meta
                  title={item.name}
                  description={`${formatFileSize(item.size)} · ${new Date(
                    item.createdAt
                  ).toLocaleString()}`}
                />
              </List.Item>
            )}
          />
        )}
      </Modal>
    </Layout>
  )
}
