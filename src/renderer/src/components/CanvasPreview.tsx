/**
 * 画布预览区：居中显示项目画布，支持 3D 运镜变换。
 *
 * Swift source: Sources/DogSCApp/EditorCanvasPreview.swift @ laogou717/dogsc 567fd6e
 * 原版功能：比例裁切、留白、圆角、阴影、背景、样机外框、3D 缩放动画实时预览。
 *
 * 实现要点：
 *   - 视频卡片用 CSS 3D transform（GPU 合成），与 ScreenProjection 同一套旋转顺序
 *   - 叠加 SVG 层绘制投影四边形与四个手柄，手柄位置由 projectScreen 精确算出
 *   - 拖拽卡片内部 → 旋转（X/Y）；拖拽手柄 → 缩放
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Space, Typography } from 'antd'
import { FolderOpenOutlined, ImportOutlined, ReloadOutlined } from '@ant-design/icons'
import type { MediaAsset } from '../core/MediaAsset'
import { formatFileSize, formatTimecode } from '../core/MediaAsset'
import type { ScreenMotionState } from '../core/ScreenTransform'
import { buildScreenTransform, projectCard, quadToPolygonPoints } from '../core/ScreenTransform'
import type { TimelineMap } from '../core/TimelineMap'
import type { CanvasStyle, CursorStyle, OpeningSequence } from '../core/ProjectModel'
import BackgroundLayer from './BackgroundLayer'
import CursorOverlay from './CursorOverlay'
import { openingCardTransform, openingScreenProgress } from '../core/BackgroundRender'

interface Props {
  asset: MediaAsset | null
  /**
   * 剪辑映射。有它时画布播放的是「剪辑后的输出时间线」：
   * 输出时刻先经 map 换算成源时刻，再喂给 <video>；播到片段末尾就跳到
   * 下一个保留片段，已删除的区间因此被真正跳过（而不是静默快进）。
   */
  timelineMap: TimelineMap | null
  currentTime: number
  playing: boolean
  onTimeUpdate: (t: number) => void
  onDurationChange: (d: number) => void
  onTogglePlay: () => void
  onImport: () => void
  onOpenRecordings: () => void
  /** 当前 3D 运镜状态 */
  motion: ScreenMotionState
  onMotionChange: (next: ScreenMotionState) => void
  /** 是否显示 3D 编辑手柄 */
  showHandles: boolean
  /** 画布样式：背景来源 / 图案密度 / 不透明度 / 圆角 / 阴影 */
  canvasStyle: CanvasStyle
  /** 光标样式：预览覆盖层 */
  cursorStyle: CursorStyle
  /** 开场转场：按输出时间驱动入场动画 */
  opening: OpeningSequence
}

type DragMode =
  | { kind: 'rotate'; startX: number; startY: number; base: ScreenMotionState }
  | { kind: 'scale'; startX: number; startY: number; base: ScreenMotionState; startDist: number }
  | { kind: 'move'; startX: number; startY: number; base: ScreenMotionState }

export default function CanvasPreview({
  asset,
  timelineMap,
  currentTime,
  playing,
  onTimeUpdate,
  onDurationChange,
  onTogglePlay,
  onImport,
  onOpenRecordings,
  motion,
  onMotionChange,
  showHandles,
  canvasStyle,
  cursorStyle,
  opening,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })
  const dragRef = useRef<DragMode | null>(null)
  /**
   * 播放期间由 video 的 timeupdate 反向驱动时间线时，必须知道「当前属于
   * 哪个片段」才能把源时刻换成输出时刻。这里记住正在播放的片段索引。
   */
  const playingSegmentRef = useRef<{ id: string; rate: number } | null>(null)

  // 画布（stage）尺寸，供投影计算。
  // 依赖 asset：无资产时走早退分支、stage 不存在；资产载入后 stage 才挂载，
  // effect 需要重跑才能观察到它。
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect
      setStageSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [asset])

  /** 输出时刻 → 源时刻 + 该片段倍速。无映射时退化为原始时钟。 */
  const resolveSourceTime = useCallback(
    (outputTime: number): { sourceTime: number; rate: number } | null => {
      if (!timelineMap) return { sourceTime: outputTime, rate: 1 }
      const segment = timelineMap.segmentAtOutputTime(outputTime)
      if (!segment) {
        // 落在末尾或越界：停在最后一个片段末尾
        const last = timelineMap.segments[timelineMap.segments.length - 1]
        if (!last) return null
        return { sourceTime: last.sourceStart + last.sourceDuration, rate: last.playbackRate }
      }
      return {
        sourceTime: segment.sourceStart + (outputTime - segment.outputStart) * segment.playbackRate,
        rate: segment.playbackRate,
      }
    },
    [timelineMap]
  )

  // 外部时间变化（拖动时间线）时同步到 video
  useEffect(() => {
    const v = videoRef.current
    if (!v || !asset) return
    const resolved = resolveSourceTime(currentTime)
    if (!resolved) return
    playingSegmentRef.current = null
    if (Math.abs(v.currentTime - resolved.sourceTime) > 0.12) {
      v.currentTime = Math.max(resolved.sourceTime, 0)
    }
    // 变速片段：HTMLMediaElement 的原生 playbackRate 支持 0.0625~16，
    // 超过 16× 的压缩（编辑器允许到 100×）在预览里按 16× 播放，
    // 导出时由 ffmpeg setpts 精确处理。
    const rate = Math.min(Math.max(resolved.rate, 0.0625), 16)
    if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate
  }, [currentTime, asset, resolveSourceTime])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !asset) return
    if (playing) void v.play().catch(() => undefined)
    else v.pause()
  }, [playing, asset])

  // ---- 卡片基准尺寸：按画布与资产宽高比适配，留 12% 边距
  const card = useMemo(() => {
    if (!asset || stageSize.w === 0) return { w: 0, h: 0 }
    const aspect = asset.width && asset.height ? asset.width / asset.height : 16 / 9
    const maxW = stageSize.w * 0.76
    const maxH = stageSize.h * 0.76
    let w = maxW
    let h = w / aspect
    if (h > maxH) {
      h = maxH
      w = h * aspect
    }
    return { w, h }
  }, [asset, stageSize])

  const transform = useMemo(
    () => buildScreenTransform(motion, card.w, card.h, stageSize.w, stageSize.h),
    [motion, card, stageSize]
  )

  // 开场转场：输出时间落在开场窗口内时叠加入场变换
  const openingTransform = useMemo(
    () => openingCardTransform(opening.preset, openingScreenProgress(opening, currentTime).progress),
    [opening, currentTime]
  )
  const inOpening = openingTransform !== 'none'

  // 光标覆盖层只在「光标」页签显示，避免干扰正常交互
  const showCursorOverlay = showHandles === false && !!asset

  // 投影四边形（画布坐标），用于手柄定位与命中测试
  const quad = useMemo(
    () => projectCard(motion, card.w, card.h, stageSize.w, stageSize.h),
    [motion, card, stageSize]
  )

  // ---- 拖拽：在卡片内拖动旋转，在手柄处拖动缩放
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!showHandles || !asset || card.w === 0) return
      const rect = stageRef.current!.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top

      // 右下角手柄 → 缩放
      const handle = quad.resizeHandlePoint
      const distToHandle = Math.hypot(px - handle.x, py - handle.y)
      if (distToHandle < 22) {
        const center = quad.center
        dragRef.current = {
          kind: 'scale',
          startX: px,
          startY: py,
          base: { ...motion },
          startDist: Math.max(Math.hypot(px - center.x, py - center.y), 1),
        }
        ;(e.target as Element).setPointerCapture(e.pointerId)
        e.preventDefault()
        return
      }

      // 卡片内 → 旋转
      if (quad.contains({ x: px, y: py })) {
        dragRef.current = {
          kind: 'rotate',
          startX: px,
          startY: py,
          base: { ...motion },
        }
        ;(e.target as Element).setPointerCapture(e.pointerId)
        e.preventDefault()
      }
    },
    [showHandles, asset, card, quad, motion]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const rect = stageRef.current!.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const dx = px - drag.startX
      const dy = py - drag.startY

      if (drag.kind === 'rotate') {
        // 水平拖 = 绕 Y 旋转，垂直拖 = 绕 X 旋转。
        // 灵敏度按卡片宽度归一：拖过整个卡片宽度约转 90 度。
        const sensitivityY = 90 / Math.max(card.w * 0.5, 1)
        const sensitivityX = 90 / Math.max(card.h * 0.5, 1)
        onMotionChange({
          ...drag.base,
          rotationY: clamp(drag.base.rotationY + dx * sensitivityY, -90, 90),
          rotationX: clamp(drag.base.rotationX - dy * sensitivityX, -90, 90),
        })
      } else if (drag.kind === 'scale') {
        const center = quad.center
        const dist = Math.max(Math.hypot(px - center.x, py - center.y), 1)
        const ratio = dist / drag.startDist
        onMotionChange({
          ...drag.base,
          scale: clamp(drag.base.scale * ratio, 0.2, 4),
        })
      }
    },
    [card, quad, onMotionChange]
  )

  const endDrag = useCallback(() => {
    dragRef.current = null
  }, [])

  if (!asset) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0f0f0f 100%)',
        }}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space direction="vertical" size={4}>
              <Typography.Text style={{ color: '#8c8c8c' }}>还没有项目</Typography.Text>
              <Typography.Text style={{ color: '#595959', fontSize: 12 }}>
                录制一段屏幕，或导入已有视频开始编辑
              </Typography.Text>
            </Space>
          }
        >
          <Space>
            <Button type="primary" icon={<ImportOutlined />} onClick={onImport}>
              导入视频
            </Button>
            <Button icon={<FolderOpenOutlined />} onClick={onOpenRecordings}>
              打开录制目录
            </Button>
          </Space>
        </Empty>
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0f0f0f 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 背景：按 backgroundSource 渲染图案/动态流/图片/视频 */}
      <BackgroundLayer
        source={canvasStyle.backgroundSource}
        patternScale={canvasStyle.patternScale}
        patternOpacity={canvasStyle.patternOpacity}
      />

      {/* 3D 舞台 */}
      <div
        ref={stageRef}
        data-dogsc-stage
        style={{
          position: 'absolute',
          inset: '0 0 64px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          perspective: 1600,
          perspectiveOrigin: '50% 50%',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          style={{
            width: card.w,
            height: card.h,
            transformStyle: 'preserve-3d',
            transform: openingTransform === 'none' ? transform : `${transform} ${openingTransform}`,
            transition: dragRef.current || inOpening ? 'none' : 'transform 60ms linear',
            willChange: 'transform',
            borderRadius: canvasStyle.cornerRadius,
            opacity: inOpening && openingScreenProgress(opening, currentTime).progress === 0 ? 0 : 1,
            boxShadow: `0 ${Math.round(canvasStyle.shadowStrength * 160)}px ${Math.round(
              canvasStyle.shadowStrength * 240
            )}px rgba(0,0,0,0.65)`,
            border: canvasStyle.borderWidth > 0 ? `${canvasStyle.borderWidth}px solid ${canvasStyle.borderColor}` : '1px solid #303030',
            overflow: 'hidden',
            cursor: showHandles ? 'grab' : 'pointer',
          }}
          onClick={onTogglePlay}
        >
          <video
            ref={videoRef}
            src={toFileUrl(asset.path)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'block' }}
            onTimeUpdate={e => {
              const v = e.currentTarget
              if (!timelineMap) {
                onTimeUpdate(v.currentTime)
                return
              }
              // 源时刻 → 输出时刻。用「当前视频时间」反查片段，而不是记住
              // 上一次的片段：这样即便用户手动 seek 也不会算错。
              const sourceTime = v.currentTime
              const owner =
                timelineMap.segments.find(
                  s => sourceTime >= s.sourceStart - 0.02 && sourceTime < s.sourceStart + s.sourceDuration - 0.02
                ) ?? null
              if (!owner) {
                onTimeUpdate(timelineMap.outputDuration)
                return
              }
              playingSegmentRef.current = { id: owner.id, rate: owner.playbackRate }
              const outputTime =
                owner.outputStart + (sourceTime - owner.sourceStart) / owner.playbackRate
              onTimeUpdate(Math.min(Math.max(outputTime, 0), timelineMap.outputDuration))
            }}
            onLoadedMetadata={e => {
              const d = e.currentTarget.duration
              if (Number.isFinite(d)) onDurationChange(d)
            }}
          />
        </div>

        {/* 光标样式预览覆盖层 */}
        {showCursorOverlay && card.w > 0 && <CursorOverlay style={cursorStyle} />}

        {/* 手柄层：投影四边形 + 四角 + 缩放手柄 */}
        {showHandles && card.w > 0 && (
          <svg
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
          >
            <polygon
              points={quadToPolygonPoints(quad)}
              fill="none"
              stroke="rgba(90,174,255,0.85)"
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            {quad.corners.map((c, i) => (
              <circle key={i} cx={c.x} cy={c.y} r={3.5} fill="#5aaeff" />
            ))}
            {quad.corners.map((a, i) => {
              const b = quad.corners[(i + 1) % 4]
              return (
                <circle
                  key={`m${i}`}
                  cx={(a.x + b.x) / 2}
                  cy={(a.y + b.y) / 2}
                  r={2.5}
                  fill="rgba(255,255,255,0.65)"
                />
              )
            })}
            <circle
              cx={quad.resizeHandlePoint.x}
              cy={quad.resizeHandlePoint.y}
              r={7}
              fill="#5aaeff"
              stroke="#fff"
              strokeWidth={2}
            />
          </svg>
        )}
      </div>

      {/* 底部信息条 */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          color: '#8c8c8c',
          fontSize: 12,
        }}
      >
        <span>{asset.name}</span>
        <span>
          {asset.width}×{asset.height}
          {asset.fps ? ` · ${asset.fps.toFixed(0)} fps` : ''}
        </span>
        <span>{formatTimecode(asset.duration)}</span>
        <span>{formatFileSize(asset.size)}</span>
        <ReloadOutlined
          title="用系统播放器打开"
          style={{ cursor: 'pointer' }}
          onClick={() => void window.dogsc.openFile(asset.path)}
        />
      </div>
    </div>
  )
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

/** 本地绝对路径 → file:// URL。 */
function toFileUrl(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `file://${encodeURI(withSlash)}`
}
