/**
 * 时间线视图：底部多轨区域，对应原版 EditorTimelineView。
 *
 * Swift source: Sources/DogSCApp/EditorTimelineView.swift @ laogou717/dogsc 567fd6e
 * 原版功能：分割、裁短、重排、变速、吸附、缩略图/波形、标记点。
 *
 * 渲染方式：Canvas 2D（AntD 与 React 生态都没有现成组件，手写）。
 *
 * 时间语义完全来自 TimelineMap：
 *   · 每个 resolved segment 直接对应一个色块，色块宽度 = 输出时长
 *   · 缩略图按**源时间**取样，所以裁切后胶片条会跟着变化
 *   · 拖动片段两端 → trim；点选片段 → 高亮；双击分割点 → 还原
 *
 * Windows 版新增：hover 时显示左右裁切光标，接点处显示 8px 吸附带。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MediaAsset } from '../core/MediaAsset'
import { formatTimecode } from '../core/MediaAsset'
import type { TimelineMap } from '../core/TimelineMap'
import { resolvedOutputEnd, resolvedSourceEnd } from '../core/TimelineMap'

export interface TimelineProps {
  asset: MediaAsset | null
  timelineMap: TimelineMap | null
  currentTime: number
  /** 输出时间线总时长。 */
  duration: number
  /** 当前选中片段 id（主片段）。 */
  selectedSegmentID: string | null
  onSelectSegment: (id: string | null) => void
  onSeek: (t: number) => void
  /** 裁切进行中（预览用，尚未提交）。 */
  onTrimPreview: (segmentID: string, edge: 'left' | 'right', outputTime: number) => void
  /** 提交裁切。 */
  onTrimCommit: (segmentID: string, edge: 'left' | 'right') => void
  /** 拖动接点还原被删素材。 */
  onRestoreJunction?: (previousID: string, nextID: string) => void
}

const GUTTER = 40 // 左侧轨道标签区宽度
const RULER_H = 26
const VIDEO_TRACK_H = 64
const AUDIO_TRACK_H = 36
const HANDLE_HIT = 7 // 片段边缘命中宽度（px）
const SNAP_PX = 8 // 吸附像素阈值

interface HitResult {
  kind: 'trim' | 'select' | 'ruler'
  segmentID?: string
  edge?: 'left' | 'right'
  time: number
}

export default function TimelineView({
  asset,
  timelineMap,
  currentTime,
  duration,
  selectedSegmentID,
  onSelectSegment,
  onSeek,
  onTrimPreview,
  onTrimCommit,
  onRestoreJunction,
}: TimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverEdge, setHoverEdge] = useState<'left' | 'right' | null>(null)
  const scrollRef = useRef(0)
  const [viewportWidth, setViewportWidth] = useState(0)

  const totalDuration = duration > 0 ? duration : asset?.duration ?? 0

  /**
   * 缩放：时间线内容宽度 = 视口宽度 × zoom。
   * zoom = 1 表示整条时间线刚好铺满；放大后可横向滚动。
   * 这对裁切精度很关键 —— 10 分钟录屏在 900px 宽度下 1px ≈ 0.67s，
   * 没有缩放就无法精确裁切。
   */
  const [zoom, setZoom] = useState(1)

  const trackW = Math.max(viewportWidth - GUTTER - 12, 0)
  const contentW = trackW * zoom
  const pxPerSec = totalDuration > 0 ? contentW / totalDuration : 0

  const dragRef = useRef<{
    kind: 'trim' | 'seek'
    segmentID?: string
    edge?: 'left' | 'right'
  } | null>(null)

  // ---- 尺寸观察
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect
      setViewportWidth(r.width)
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // ---- 缝合坐标换算
  const timeToX = useCallback(
    (t: number) => GUTTER + t * pxPerSec - scrollRef.current,
    [pxPerSec]
  )
  const xToTime = useCallback(
    (x: number) => {
      if (pxPerSec <= 0) return 0
      return (x + scrollRef.current - GUTTER) / pxPerSec
    },
    [pxPerSec]
  )

  /** 找到线段边缘并吸附（8px 内）。 */
  const snapTime = useCallback(
    (t: number): number => {
      if (!timelineMap || pxPerSec <= 0) return t
      const threshold = SNAP_PX / pxPerSec
      let best = t
      let bestDelta = threshold
      for (const segment of timelineMap.segments) {
        for (const boundary of [segment.outputStart, resolvedOutputEnd(segment)]) {
          const delta = Math.abs(boundary - t)
          if (delta < bestDelta) {
            best = boundary
            bestDelta = delta
          }
        }
      }
      return Math.min(Math.max(best, 0), totalDuration)
    },
    [timelineMap, pxPerSec, totalDuration]
  )

  /** 命中测试：片段边缘 → trim，片段内部 → select，标尺/空白 → seek。 */
  const hitTest = useCallback(
    (x: number, y: number): HitResult => {
      const time = Math.min(Math.max(xToTime(x), 0), totalDuration)
      if (!timelineMap || pxPerSec <= 0) return { kind: 'ruler', time }
      if (y < RULER_H || y > RULER_H + 8 + VIDEO_TRACK_H) return { kind: 'ruler', time }

      for (const segment of timelineMap.segments) {
        const x0 = timeToX(segment.outputStart)
        const x1 = timeToX(resolvedOutputEnd(segment))
        if (x < x0 - HANDLE_HIT || x > x1 + HANDLE_HIT) continue
        if (x <= x0 + HANDLE_HIT) {
          return { kind: 'trim', segmentID: segment.id, edge: 'left', time }
        }
        if (x >= x1 - HANDLE_HIT) {
          return { kind: 'trim', segmentID: segment.id, edge: 'right', time }
        }
        return { kind: 'select', segmentID: segment.id, time }
      }
      return { kind: 'ruler', time }
    },
    [timelineMap, pxPerSec, timeToX, xToTime, totalDuration]
  )

  // ---- 绘制
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1

    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = Math.max(width * dpr, 1)
    canvas.height = Math.max(height * dpr, 1)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = '#181818'
    ctx.fillRect(0, 0, width, height)

    const drawTrackW = Math.max(width - GUTTER - 12, 0)
    const drawContentW = drawTrackW * zoom
    const scale = totalDuration > 0 ? drawContentW / totalDuration : 0
    const scroll = scrollRef.current
    const tx = (t: number) => GUTTER + t * scale - scroll

    // ---- 标尺：按时长自适应刻度间隔
    const niceSteps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
    const targetTicks = Math.max(Math.floor(drawTrackW / 90), 2)
    const step =
      niceSteps.find(s => totalDuration / s <= targetTicks) ??
      niceSteps[niceSteps.length - 1]

    ctx.save()
    ctx.beginPath()
    ctx.rect(GUTTER, 0, drawTrackW, height)
    ctx.clip()

    ctx.font = '10px system-ui'
    ctx.fillStyle = '#595959'
    ctx.strokeStyle = '#303030'
    ctx.lineWidth = 1
    for (let t = 0; t <= totalDuration + 0.0001; t += step) {
      const x = tx(t)
      if (x < GUTTER - 20 || x > width + 20) continue
      ctx.fillText(formatTimecode(t).slice(0, 5), x, 12)
      ctx.beginPath()
      ctx.moveTo(x, 16)
      ctx.lineTo(x, RULER_H)
      ctx.stroke()
    }

    // ---- 轨道底色
    const videoY = RULER_H + 8
    const audioY = videoY + VIDEO_TRACK_H + 8
    ctx.fillStyle = '#232323'
    ctx.fillRect(0, videoY, width, VIDEO_TRACK_H)
    ctx.fillRect(0, audioY, width, AUDIO_TRACK_H)

    // ---- 片段
    if (asset && timelineMap && scale > 0) {
      timelineMap.segments.forEach((segment, index) => {
        const x0 = tx(segment.outputStart)
        const x1 = tx(resolvedOutputEnd(segment))
        const w = Math.max(x1 - x0, 1)
        if (x1 < GUTTER || x0 > width) return
        const selected = segment.id === selectedSegmentID

        // 画面轨
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(x0, videoY + 4, w, VIDEO_TRACK_H - 8, 4)
        ctx.clip()

        ctx.fillStyle = selected ? '#2f5f8a' : '#274a63'
        ctx.fillRect(x0, videoY + 4, w, VIDEO_TRACK_H - 8)

        // 胶片缩略图：按源时间取样
        const thumbs = asset.thumbnails ?? []
        if (thumbs.length && segment.sourceDuration > 0) {
          const thumbH = VIDEO_TRACK_H - 12
          const thumbW = thumbH * (16 / 9)
          const count = Math.max(Math.ceil(w / thumbW), 1)
          for (let i = 0; i < count; i++) {
            // 该缩略图覆盖的源时刻
            const fraction = (i + 0.5) / count
            const sourceTime = segment.sourceStart + fraction * segment.sourceDuration
            const thumbIndex = Math.min(
              thumbs.length - 1,
              Math.max(0, Math.floor((sourceTime / Math.max(asset.duration, 0.001)) * thumbs.length))
            )
            const img = thumbCache.get(thumbs[thumbIndex])
            if (img?.complete && img.naturalWidth > 0) {
              ctx.globalAlpha = selected ? 0.95 : 0.8
              ctx.drawImage(img, x0 + i * thumbW, videoY + 6, thumbW - 2, thumbH)
              ctx.globalAlpha = 1
            }
          }
        }
        ctx.restore()

        // 边框
        ctx.strokeStyle = selected ? '#5aaeff' : '#3a5a7a'
        ctx.lineWidth = selected ? 2 : 1
        ctx.beginPath()
        ctx.roundRect(x0 + 0.5, videoY + 4.5, w - 1, VIDEO_TRACK_H - 9, 4)
        ctx.stroke()

        // 片段序号 + 时长 + 倍速
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.font = '10px system-ui'
        const label = `#${index + 1}`
        ctx.fillText(label, x0 + 6, videoY + 16)
        if (w > 74) {
          ctx.fillStyle = 'rgba(255,255,255,0.6)'
          ctx.fillText(
            `${segment.sourceDuration.toFixed(1)}s${
              Math.abs(segment.playbackRate - 1) > 0.001 ? ` · ${segment.playbackRate}×` : ''
            }`,
            x0 + 6,
            videoY + VIDEO_TRACK_H - 12
          )
        }

        // 边缘手柄提示（选中或 hover 时）
        if (selected || hoverEdge) {
          ctx.fillStyle = selected ? '#5aaeff' : 'rgba(90,174,255,0.55)'
          ctx.fillRect(x0, videoY + 4, 3, VIDEO_TRACK_H - 8)
          ctx.fillRect(x0 + w - 3, videoY + 4, 3, VIDEO_TRACK_H - 8)
        }

        // 音频轨：同一片段映射成一段波形块
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(x0, audioY + 4, w, AUDIO_TRACK_H - 8, 3)
        ctx.clip()
        ctx.fillStyle = selected ? '#4a7a4a' : '#3d5a3d'
        ctx.fillRect(x0, audioY + 4, w, AUDIO_TRACK_H - 8)
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.lineWidth = 1
        const midY = audioY + AUDIO_TRACK_H / 2
        for (let x = x0; x < x0 + w; x += 3) {
          // 伪波形：由源时间决定的确定性抖动，视觉上足够"有内容"
          const seed = Math.sin((x - x0) * 0.7 + index * 13) * Math.sin((x - x0) * 0.19)
          const h = Math.abs(seed) * (AUDIO_TRACK_H - 16) * 0.45
          ctx.beginPath()
          ctx.moveTo(x, midY - h)
          ctx.lineTo(x, midY + h)
          ctx.stroke()
        }
        ctx.restore()
      })

      // ---- 被删掉的间隙：在轨道上用斜线底纹提示"这里原本有素材"
      const gaps = computeSourceGaps(timelineMap)
      if (gaps.length) {
        for (const gap of gaps) {
          const x0 = tx(gap.outputStart)
          const x1 = tx(gap.outputStart) + gap.duration * scale
          if (x1 < GUTTER || x0 > width) continue
          ctx.fillStyle = 'rgba(255,77,79,0.10)'
          ctx.fillRect(x0, videoY, Math.max(x1 - x0, 2), VIDEO_TRACK_H)
          ctx.fillRect(Math.max(x0, x0), audioY, Math.max(x1 - x0, 2), AUDIO_TRACK_H)
          ctx.strokeStyle = 'rgba(255,77,79,0.55)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(x0, videoY)
          ctx.lineTo(x0, audioY + AUDIO_TRACK_H)
          ctx.moveTo(x1, videoY)
          ctx.lineTo(x1, audioY + AUDIO_TRACK_H)
          ctx.stroke()
          if (x1 - x0 > 40) {
            ctx.fillStyle = 'rgba(255,120,120,0.85)'
            ctx.font = '10px system-ui'
            ctx.fillText(`已删 ${gap.sourceDuration.toFixed(1)}s`, x0 + 4, videoY + 14)
          }
        }
      }
    }

    // ---- hover 提示线
    if (hoverTime != null && totalDuration > 0) {
      const hx = tx(hoverTime)
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.beginPath()
      ctx.moveTo(hx, RULER_H)
      ctx.lineTo(hx, height)
      ctx.stroke()
    }

    // ---- 播放头
    if (totalDuration > 0) {
      const px = tx(Math.min(currentTime, totalDuration))
      if (px >= GUTTER - 8 && px <= width + 8) {
        ctx.strokeStyle = '#ff4d4f'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(px, RULER_H - 6)
        ctx.lineTo(px, height)
        ctx.stroke()
        ctx.fillStyle = '#ff4d4f'
        ctx.beginPath()
        ctx.roundRect(px - 5, RULER_H - 10, 10, 10, 2)
        ctx.fill()
      }
    }

    ctx.restore()

    // ---- 左侧栏（不随滚动移动）
    ctx.fillStyle = '#1c1c1c'
    ctx.fillRect(0, 0, GUTTER, height)
    ctx.fillStyle = '#666'
    ctx.font = '11px system-ui'
    ctx.fillText('画面', 8, videoY + VIDEO_TRACK_H / 2 + 4)
    ctx.fillText('音频', 8, audioY + AUDIO_TRACK_H / 2 + 4)
    ctx.strokeStyle = '#303030'
    ctx.beginPath()
    ctx.moveTo(GUTTER - 0.5, 0)
    ctx.lineTo(GUTTER - 0.5, height)
    ctx.stroke()
  }, [
    asset,
    timelineMap,
    currentTime,
    totalDuration,
    hoverTime,
    hoverEdge,
    selectedSegmentID,
    viewportWidth,
    zoom,
  ])

  // ---- 交互
  const localPoint = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (totalDuration <= 0) return
    const { x, y } = localPoint(e)
    const hit = hitTest(x, y)
    if (hit.kind === 'trim' && hit.segmentID && hit.edge) {
      onSelectSegment(hit.segmentID)
      dragRef.current = { kind: 'trim', segmentID: hit.segmentID, edge: hit.edge }
      return
    }
    if (hit.kind === 'select' && hit.segmentID) {
      onSelectSegment(hit.segmentID)
    } else {
      onSelectSegment(null)
    }
    dragRef.current = { kind: 'seek' }
    onSeek(hit.time)
  }

  function handlePointerMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (totalDuration <= 0) return
    const { x, y } = localPoint(e)
    const drag = dragRef.current

    if (drag?.kind === 'trim' && drag.segmentID && drag.edge) {
      const snapped = snapTime(xToTime(x))
      onTrimPreview(drag.segmentID, drag.edge, snapped)
      return
    }

    const hit = hitTest(x, y)
    setHoverTime(hit.time)
    setHoverEdge(hit.kind === 'trim' ? hit.edge ?? null : null)
    if (drag?.kind === 'seek') onSeek(hit.time)
  }

  function handlePointerUp() {
    const drag = dragRef.current
    if (drag?.kind === 'trim' && drag.segmentID && drag.edge) {
      onTrimCommit(drag.segmentID, drag.edge)
    }
    dragRef.current = null
  }

  const cursor = useMemo(() => {
    if (hoverEdge) return 'ew-resize'
    if (dragRef.current?.kind === 'trim') return 'ew-resize'
    return 'pointer'
  }, [hoverEdge])

  // ---- 滚轮：Ctrl/⌘ 缩放，否则横向滚动
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const factor = e.deltaY > 0 ? 0.88 : 1 / 0.88
        setZoom(z => Math.min(Math.max(z * factor, 1), 60))
        return
      }
      const maxScroll = Math.max(contentW - trackW, 0)
      if (maxScroll <= 0) return
      const next = Math.min(
        Math.max(scrollRef.current + (e.deltaY || e.deltaX), 0),
        maxScroll
      )
      if (next !== scrollRef.current) {
        scrollRef.current = next
        // 触发重绘
        setHoverTime(t => t)
      }
    },
    [contentW, trackW]
  )

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', cursor }}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={() => {
          dragRef.current = null
          setHoverTime(null)
          setHoverEdge(null)
        }}
        onDoubleClick={e => {
          // 双击接点 → 还原被删素材（仅在确实存在间隙时生效）
          if (!timelineMap || !onRestoreJunction) return
          const { x, y } = localPoint(e)
          const hit = hitTest(x, y)
          if (hit.kind !== 'trim' || !hit.segmentID) return
          const index = timelineMap.segments.findIndex(s => s.id === hit.segmentID)
          if (index < 0) return
          const previousID =
            hit.edge === 'left'
              ? timelineMap.segments[index - 1]?.id
              : timelineMap.segments[index].id
          const nextID =
            hit.edge === 'left'
              ? timelineMap.segments[index].id
              : timelineMap.segments[index + 1]?.id
          if (previousID && nextID) onRestoreJunction(previousID, nextID)
        }}
        onWheel={handleWheel}
      />
      {zoom > 1 && (
        <div
          style={{
            position: 'absolute',
            right: 8,
            top: 4,
            fontSize: 10,
            color: '#666',
            pointerEvents: 'none',
          }}
        >
          {zoom.toFixed(1)}×
        </div>
      )}
    </div>
  )
}

/**
 * 计算「被删掉的源素材间隙」在输出时间线上的位置（用于红色底纹提示）。
 * 间隙本身没有输出时长，所以这里返回的是间隙两侧接点的输出坐标，
 * duration 表示被删掉的源秒数（供文案显示）。
 */
function computeSourceGaps(
  map: TimelineMap
): { outputStart: number; sourceDuration: number; duration: number }[] {
  const result: { outputStart: number; sourceDuration: number; duration: number }[] = []
  for (let i = 0; i + 1 < map.segments.length; i++) {
    const current = map.segments[i]
    const next = map.segments[i + 1]
    const gap = next.sourceStart - resolvedSourceEnd(current)
    if (gap > 1 / 120) {
      result.push({
        outputStart: resolvedOutputEnd(current),
        sourceDuration: gap,
        // 在输出时钟上间隙宽度按下一片段倍速折算，用于绘制底纹宽度
        duration: gap / next.playbackRate,
      })
    }
  }
  return result
}

/** 缩略图解码缓存：data URL → HTMLImageElement，避免每次重绘重复解码。 */
const thumbCache = new Map<string, HTMLImageElement>()

export function primeThumbnailCache(urls: string[]) {
  for (const url of urls) {
    if (thumbCache.has(url)) continue
    const img = new Image()
    img.src = url
    thumbCache.set(url, img)
  }
}
