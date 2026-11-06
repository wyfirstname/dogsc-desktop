/**
 * 背景渲染 / 光标资源映射 / 开场转场进度。
 *
 * Swift source:
 *   - Sources/DogSCApp/EditorBackgroundInspector.swift @ 567fd6e（背景选项）
 *   - Sources/DogSCApp/EditorCursor.swift + SharedFrameCursorRenderer.swift（光标呈现）
 *   - Sources/DogSCApp/EditorOpeningTimeline.swift / EditorOpeningTiming.swift（开场时间线）
 *
 * 说明：图案背景用 CSS 渐变复刻 Swift 侧 Canvas 图案（网格 / 星阵 / 点阵 / 等角网），
 * 动态背景用 CSS 动画复刻「流金缓移网格 / 暖星漫步点阵 / 蓝白流体云幕」；
 * 图片/视频背景交给 BackgroundLayer 直接渲染媒体元素。
 */
import type {
  BackgroundPatternPreset,
  BackgroundSource,
  CursorClickEffectStyle,
  CursorStyle,
  DynamicBackgroundPreset,
  OpeningSequence,
} from './ProjectModel'

/** Swift CursorAssetID 是字符串 RawRepresentable；TS 侧用字符串别名。 */
type CursorAssetID = string

// ---------------------------------------------------------------- 背景图案

/** 五个静态图案的 CSS 层（大小由 patternScale 控制）。 */
function patternCss(preset: BackgroundPatternPreset, scale: number): { image: string; size: string } {
  const cell = 28 * scale
  switch (preset) {
    case '黑曜石网格':
      return {
        image: [
          `linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px)`,
          `linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px)`,
          `radial-gradient(ellipse at 30% 20%, #101423 0%, #070810 70%)`,
        ].join(', '),
        size: `${cell}px ${cell}px, ${cell}px ${cell}px, cover`,
      }
    case '工程白网格':
      return {
        image: [
          `linear-gradient(rgba(20,40,80,0.10) 1px, transparent 1px)`,
          `linear-gradient(90deg, rgba(20,40,80,0.10) 1px, transparent 1px)`,
          `radial-gradient(ellipse at 50% 0%, #f4f7fb 0%, #dfe6ef 75%)`,
        ].join(', '),
        size: `${cell}px ${cell}px, ${cell}px ${cell}px, cover`,
      }
    case '暗夜星阵': {
      const star = (o: number) =>
        `radial-gradient(circle at center, rgba(255,255,255,${o}) 0 1.2px, transparent 1.6px)`
      return {
        image: [
          star(0.9),
          star(0.45),
          `radial-gradient(ellipse at 70% 80%, #141a33 0%, #05060d 70%)`,
        ].join(', '),
        size: `${cell}px ${cell}px, ${cell * 2.3}px ${cell * 2.3}px, cover`,
      }
    }
    case '建筑极简点': {
      const dot = (o: number) =>
        `radial-gradient(circle at center, rgba(30,40,60,${o}) 0 1.6px, transparent 2px)`
      return {
        image: [
          dot(0.55),
          dot(0.25),
          `radial-gradient(ellipse at 20% 10%, #f6f4ef 0%, #e8e4dc 75%)`,
        ].join(', '),
        size: `${cell}px ${cell}px, ${cell * 2}px ${cell * 2}px, cover`,
      }
    }
    case '立体等角网':
      return {
        image: [
          `repeating-linear-gradient(60deg, rgba(120,160,220,0.35) 0 1px, transparent 1px ${cell}px)`,
          `repeating-linear-gradient(-60deg, rgba(120,160,220,0.35) 0 1px, transparent 1px ${cell}px)`,
          `radial-gradient(ellipse at 50% 100%, #0d1526 0%, #060a14 70%)`,
        ].join(', '),
        size: 'cover',
      }
  }
}

/** 三个动态背景的 CSS 层。 */
function dynamicCss(preset: DynamicBackgroundPreset, scale: number): { image: string; size: string } {
  const cell = 28 * scale
  switch (preset) {
    case '赛博微流网格':
      return {
        image: [
          `linear-gradient(rgba(255,205,120,0.16) 1px, transparent 1px)`,
          `linear-gradient(90deg, rgba(255,205,120,0.16) 1px, transparent 1px)`,
          `radial-gradient(ellipse at 50% 50%, #191531 0%, #090818 75%)`,
        ].join(', '),
        size: `${cell}px ${cell}px, ${cell}px ${cell}px, cover`,
      }
    case '星辉漫步点阵':
      return {
        image: [
          `radial-gradient(circle at center, rgba(255,214,150,0.85) 0 1.3px, transparent 1.8px)`,
          `radial-gradient(ellipse at 30% 70%, #2a2038 0%, #0c0a16 75%)`,
        ].join(', '),
        size: `${cell * 1.6}px ${cell * 1.6}px, cover`,
      }
    case '极光流体星云':
      return {
        image:
          `radial-gradient(ellipse at 30% 30%, #2b5fb0 0%, transparent 55%),` +
          `radial-gradient(ellipse at 75% 65%, #7fb6e8 0%, transparent 50%),` +
          `radial-gradient(ellipse at 50% 50%, #12233f 0%, #070d18 80%)`,
        size: '200% 200%',
      }
  }
}

export interface BackgroundLayerStyle {
  backgroundImage?: string
  backgroundSize?: string
  animation?: string
}

const ANIMATED_PRESETS = new Set<DynamicBackgroundPreset>(['赛博微流网格', '星辉漫步点阵', '极光流体星云'])

/** 图案/动态背景 → 可直接挂在 div 上的样式；媒体背景返回 undefined（由 BackgroundLayer 渲染）。 */
export function backgroundLayerStyle(
  source: BackgroundSource,
  patternScale: number,
  patternOpacity: number
): BackgroundLayerStyle | undefined {
  if (source.kind === 'pattern') {
    const css = patternCss(source.patternPreset, patternScale)
    return { backgroundImage: css.image, backgroundSize: css.size }
  }
  if (source.kind === 'dynamicFlow') {
    const preset = source.dynamicPreset
    const css = dynamicCss(preset, patternScale)
    const style: BackgroundLayerStyle = {
      backgroundImage: css.image,
      backgroundSize: css.size,
    }
    if (ANIMATED_PRESETS.has(preset)) {
      // 背景位移动画，复刻原版缓慢漂移的观感
      style.animation = `dogsc-dynamic-drift ${preset === '极光流体星云' ? 18 : 26}s ease-in-out infinite alternate`
    }
    return style
  }
  return undefined
}

/** 把动态背景动画的 keyframes 注入 document（幂等）。 */
export function ensureBackgroundKeyframes(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dogsc-bg-keyframes')) return
  const style = document.createElement('style')
  style.id = 'dogsc-bg-keyframes'
  style.textContent = `
@keyframes dogsc-dynamic-drift {
  from { background-position: 0% 0%, 0% 0%, 0% 0%; }
  to   { background-position: ${'56px 32px, -40px 24px, 12% 18%'}; }
}
`
  document.head.appendChild(style)
}

// ---------------------------------------------------------------- 光标资源

export interface CursorAssetOption {
  id: CursorAssetID
  label: string
  /** 预览/覆盖层里的 CSS cursor 值；hidden 用 none。 */
  cssCursor: string
}

export const CURSOR_ASSET_OPTIONS: readonly CursorAssetOption[] = [
  { id: 'system.automatic', label: '自动（跟随系统）', cssCursor: 'default' },
  { id: 'system.arrow', label: '系统箭头', cssCursor: 'default' },
  { id: 'system.pointing-hand', label: '指向手势', cssCursor: 'pointer' },
  { id: 'system.crosshair', label: '十字准星', cssCursor: 'crosshair' },
  { id: 'system.ibeam', label: '文本 I 型', cssCursor: 'text' },
  { id: 'system.open-hand', label: '张开手掌', cssCursor: 'grab' },
  { id: 'system.closed-hand', label: '握拳', cssCursor: 'grabbing' },
  { id: 'system.not-allowed', label: '禁止', cssCursor: 'not-allowed' },
  { id: 'system.touch-dot', label: '触控圆点', cssCursor: 'default' },
  { id: 'system.hidden', label: '隐藏光标', cssCursor: 'none' },
]

export function cursorAssetOption(id: string): CursorAssetOption {
  return (
    CURSOR_ASSET_OPTIONS.find(o => o.id === id) ??
    // 退役的生成样式统一回落系统箭头（与 ProjectModel 解码一致）
    CURSOR_ASSET_OPTIONS[1]
  )
}

export const CLICK_EFFECT_OPTIONS: readonly { value: CursorClickEffectStyle; label: string }[] = [
  { value: 'ripple', label: '涟漪扩散' },
  { value: 'glow', label: '柔和光晕' },
  { value: 'pulse', label: '弹性双环' },
  { value: 'burst', label: '聚焦微闪' },
  { value: 'none', label: '无效果' },
]

/**
 * 光标点击动效的 CSS（复刻 SharedFrameCursorRenderer 的四类反馈）。
 * duration 与 ProjectModel.cursorClickEffectDuration 一致。
 */
export function clickEffectKeyframes(): string {
  return `
@keyframes dogsc-click-ripple { from { transform: translate(-50%,-50%) scale(0.3); opacity: 0.9; } to { transform: translate(-50%,-50%) scale(2.2); opacity: 0; } }
@keyframes dogsc-click-glow { 0% { transform: translate(-50%,-50%) scale(0.8); opacity: 0.95; } 60% { opacity: 0.5; } 100% { transform: translate(-50%,-50%) scale(1.6); opacity: 0; } }
@keyframes dogsc-click-pulse { 0% { transform: translate(-50%,-50%) scale(0.5); } 40% { transform: translate(-50%,-50%) scale(1.4); } 60% { transform: translate(-50%,-50%) scale(1.1); } 80% { transform: translate(-50%,-50%) scale(1.7); } 100% { transform: translate(-50%,-50%) scale(2); opacity: 0; } }
@keyframes dogsc-click-burst { from { transform: translate(-50%,-50%) scale(1); opacity: 1; } to { transform: translate(-50%,-50%) scale(2.6); opacity: 0; } }
`
}

export function clickEffectAnimationName(style: CursorClickEffectStyle): string | null {
  switch (style) {
    case 'ripple': return 'dogsc-click-ripple'
    case 'glow': return 'dogsc-click-glow'
    case 'pulse': return 'dogsc-click-pulse'
    case 'burst': return 'dogsc-click-burst'
    default: return null
  }
}

// ---------------------------------------------------------------- 开场转场

export interface OpeningElementProgress {
  /** 0 → 1；0 表示元素尚未入场（应完全隐藏），1 表示入场完成。 */
  progress: number
}

/**
 * 开场时间线（EditorOpeningTiming）：按 elementOrder 依次 stagger。
 * 这里只需要屏幕元素的进度（我们预览里唯一的参与元素）。
 */
export function openingScreenProgress(opening: OpeningSequence, outputTime: number): OpeningElementProgress {
  if (!opening.isEnabled) return { progress: 1 }
  const order = opening.elementOrder
  const index = order.indexOf('屏幕')
  if (index < 0) return { progress: 1 }
  const start = index * opening.stagger
  const end = start + Math.max(opening.duration - (order.length - 1) * opening.stagger, 0.18)
  if (outputTime >= end) return { progress: 1 }
  if (outputTime <= start) return { progress: 0 }
  const t = (outputTime - start) / (end - start)
  // swift 曲线：缓入缓出（与 ElementMotion 的默认手感一致）
  const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  return { progress: eased }
}

/**
 * 开场阶段屏幕元素的额外变换（EditorOpeningTimeline 的 preset 语义）。
 * progress=1 时返回 none（不影响正常运镜）。
 */
export function openingCardTransform(preset: OpeningSequence['preset'], progress: number): string {
  if (progress >= 1) return 'none'
  switch (preset) {
    case '聚拢':
      return `scale(${(0.72 + 0.28 * progress).toFixed(4)})`
    case '侧滑':
      return `translateX(${((1 - progress) * 22).toFixed(2)}%)`
    case '轻 3D':
      return `perspective(1200px) rotateX(${((1 - progress) * 24).toFixed(2)}deg) scale(${(0.9 + 0.1 * progress).toFixed(4)})`
  }
}

/** 光标预览覆盖层的大小（px）。style.size 的基准 1.0 = 24px。 */
export function cursorOverlaySize(style: CursorStyle): number {
  return 24 * style.size
}
