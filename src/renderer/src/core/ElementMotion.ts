/**
 * 元素进出场共用的时间语言。
 *
 * Swift source: Sources/RecorderCore/ElementMotion.swift @ laogou717/dogsc 567fd6e
 *
 * 方向与距离属于视觉预设（贴图从左滑入、屏幕的轻 3D 开场等）。
 * 这里只拥有「进度如何走过那条路径」，让原本不同的元素共享可预期的
 * 运动节奏。
 */

export type ElementMotionCurve = 'smooth' | 'swift' | 'gentle'

export const ELEMENT_MOTION_CURVES: readonly ElementMotionCurve[] = [
  'smooth',
  'swift',
  'gentle',
]

/**
 * 求归一化进度值，不依赖任何渲染后端。
 * 出场动画传入剩余进度（1 → 0），同一条曲线自然先落到目标再加速离开。
 */
export function elementMotionProgress(
  linearProgress: number,
  curve: ElementMotionCurve
): number {
  const x = Math.min(Math.max(Number.isFinite(linearProgress) ? linearProgress : 0, 0), 1)
  switch (curve) {
    case 'smooth':
      // 五次平滑（quintic smoothstep）
      return x * x * x * (x * (x * 6 - 15) + 10)
    case 'swift':
      // 历史 DogSC 贴图/开场节奏，兼容默认
      return 1 - Math.pow(1 - x, 4)
    case 'gentle':
      return 1 - Math.pow(1 - x, 3)
  }
}
