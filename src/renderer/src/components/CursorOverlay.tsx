/**
 * 光标预览覆盖层：在画布舞台上模拟 CursorStyle 的呈现效果。
 *
 * Swift source:
 *   - Sources/DogSCApp/EditorCursor.swift @ 567fd6e
 *   - Sources/DogSCApp/SharedFrameCursorRenderer.swift（导出侧渲染）
 *
 * 说明：正式成片里的光标来自录制时的 PointerTrack（尚未转写）；
 * 预览阶段用真实鼠标位置驱动，让用户能在编辑器里直观看到
 * 样式 / 大小的实际效果。
 * 用户要求：预览里不绘制点击反馈圆环（clickEffect 仅保留设置项，
 * 待导出管线接入后在成片里生效）。
 */
import { useEffect, useState } from 'react'
import type { CursorStyle } from '../core/ProjectModel'
import { cursorOverlaySize } from '../core/BackgroundRender'

interface Props {
  style: CursorStyle
}

/** 画布舞台内跟随鼠标的光标（不绘制点击反馈）。 */
export default function CursorOverlay({ style: cursorStyle }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  if (!pos) {
    // 尚未拿到鼠标位置：仍挂载事件监听，等第一次 pointermove 再显示
    return <PointerTracker onMove={setPos} />
  }
  const size = cursorOverlaySize(cursorStyle)
  const hidden = cursorStyle.assetID === 'system.hidden'

  return (
    <>
      {!hidden && (
        <div
          data-dogsc-cursor
          style={{
            position: 'absolute',
            left: pos.x,
            top: pos.y,
            width: size,
            height: size,
            transform: 'translate(-30%, -12%)',
            pointerEvents: 'none',
            zIndex: 30,
          }}
        >
          <CursorGlyph assetID={cursorStyle.assetID} size={size} />
        </div>
      )}
      <PointerTracker onMove={setPos} />
    </>
  )
}

/** 监听最近祖先舞台（data-dogsc-stage）的指针移动。 */
function PointerTracker(props: { onMove: (p: { x: number; y: number }) => void }) {
  useEffect(() => {
    const stage = document.querySelector('[data-dogsc-stage]') as HTMLElement | null
    if (!stage) return
    const toLocal = (e: Event) => {
      const rect = stage.getBoundingClientRect()
      const pe = e as PointerEvent
      return { x: pe.clientX - rect.left, y: pe.clientY - rect.top }
    }
    const move = (e: Event) => props.onMove(toLocal(e))
    stage.addEventListener('pointermove', move)
    return () => {
      stage.removeEventListener('pointermove', move)
    }
  })
  return null
}

/** 按 assetID 绘制光标图形（系统箭头等用 SVG，触控圆点用圆）。 */
function CursorGlyph({ assetID, size }: { assetID: string; size: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24' } as const
  switch (assetID) {
    case 'system.pointing-hand':
      return (
        <svg {...common}>
          <path
            d="M10 2c.9 0 1.6.7 1.7 1.6L12 9l6.2 1.2c.9.2 1.5 1 1.4 1.9l-.7 5.6A4 4 0 0 1 15 21h-3.3a4 4 0 0 1-3-1.4L5 15.4a1.6 1.6 0 0 1 2.3-2.2l1.2 1V3.7C8.5 2.8 9.2 2 10 2z"
            fill="#fff"
            stroke="#333"
            strokeWidth="1.1"
          />
        </svg>
      )
    case 'system.crosshair':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" fill="none" stroke="#fff" strokeWidth="1.6" />
          <path d="M12 1v6M12 17v6M1 12h6M17 12h6" stroke="#fff" strokeWidth="1.6" />
        </svg>
      )
    case 'system.ibeam':
      return (
        <svg {...common}>
          <path d="M8 3h8M8 21h8M12 3v18" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )
    case 'system.touch-dot':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" fill="rgba(255,255,255,0.35)" stroke="#fff" strokeWidth="1.4" />
        </svg>
      )
    case 'system.not-allowed':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="#e05555" strokeWidth="2" />
          <path d="M6.2 6.2l11.6 11.6" stroke="#e05555" strokeWidth="2" />
        </svg>
      )
    case 'system.open-hand':
    case 'system.closed-hand':
      return (
        <svg {...common}>
          <path
            d="M7 12V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5v-1a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v6m0-3a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L4.5 15A1.7 1.7 0 0 1 7 12.8"
            fill="#fff"
            stroke="#333"
            strokeWidth="1"
          />
        </svg>
      )
    case 'system.hidden':
      return null
    default:
      // system.arrow / system.automatic
      return (
        <svg {...common}>
          <path
            d="M5 2l14 10.5-6.2.9 3.6 6.4-2.6 1.4-3.5-6.4L6 19z"
            fill="#fff"
            stroke="#222"
            strokeWidth="1.2"
          />
        </svg>
      )
  }
}
