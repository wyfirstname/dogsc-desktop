/**
 * 画布背景层：按 CanvasStyle.backgroundSource 渲染图案 / 动态流 / 图片 / 视频。
 *
 * Swift source:
 *   - Sources/DogSCApp/EditorBackgroundInspector.swift @ 567fd6e
 *   - Sources/DogSCApp/WallpaperImageLoading.swift / PreviewWallpaperVideoPlayback.swift
 *   - Sources/DogSCApp/ExportLoopingWallpaperVideoReader.swift（导出侧，尚未转写）
 */
import { memo, useEffect } from 'react'
import type { BackgroundSource } from '../core/ProjectModel'
import {
  backgroundLayerStyle,
  ensureBackgroundKeyframes,
  clickEffectKeyframes,
} from '../core/BackgroundRender'
import { toFileUrl } from './fileUrl'

interface Props {
  source: BackgroundSource
  patternScale: number
  patternOpacity: number
}

/**
 * 全区背景（铺满预览舞台）。opacity = patternOpacity（图片/视频背景同样受其控制，
 * 与原版「背景不透明度」语义一致）。
 */
const BackgroundLayer = memo(function BackgroundLayer({ source, patternScale, patternOpacity }: Props) {
  // 注入动态背景与点击反馈所需的 keyframes（幂等）
  useEffect(() => {
    ensureBackgroundKeyframes()
  }, [])

  if (source.kind === 'projectImage' || source.kind === 'systemImage') {
    const path = source.kind === 'systemImage' ? source.absolutePath : source.relativePath
    if (!path) return null
    return (
      <img
        src={toFileUrl(path)}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: patternOpacity,
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />
    )
  }

  if (source.kind === 'projectVideo' || source.kind === 'systemVideo') {
    const path = source.kind === 'systemVideo' ? source.absolutePath : source.relativePath
    if (!path) return null
    return (
      <video
        src={toFileUrl(path)}
        autoPlay
        loop
        muted
        playsInline
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: patternOpacity,
          pointerEvents: 'none',
        }}
      />
    )
  }

  const style = backgroundLayerStyle(source, patternScale, patternOpacity)
  if (!style) return null
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        opacity: patternOpacity,
        pointerEvents: 'none',
        ...style,
      }}
    />
  )
})

export default BackgroundLayer
