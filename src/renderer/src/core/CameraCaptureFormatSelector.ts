/**
 * 摄像头采集格式选择 —— Swift CameraCaptureFormatSelector.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/CameraCaptureFormatSelector.swift（34 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - 过滤非法尺寸（宽或高为 0）              L11-14
 *   - highestPixels（按像素数取最大）         L16-23
 *   - 竖屏优先设备直接给最大                    L25
 *   - 横屏优先：先筛横屏，再筛 1080p +5% 以内   L26-32
 *
 * 原注释：摄像头的画中画显示不需要盲目上 4K —— 横屏格式优先选 1080p 档以内的
 * 最高像素；该档位为空时退回最高像素横屏；手机屏幕或只有竖屏格式的设备保持原始方向。
 *
 * 选择顺序是**筛选后取最大**，不是「取最大的合格项再判断」：先把不合格的剔掉，
 * 剩下的按像素数取最大，这样「1080p 里像素最多的那个」自然就是 1080p。
 */

/** 1080p 的像素数。 */
export const CAMERA_FULL_HD_PIXELS = 1920 * 1080

/** 档位容差：允许超过 1080p 5%（有些设备报 1936×1088 之类的对齐尺寸）。 */
export const CAMERA_FULL_HD_PIXEL_HEADROOM = 1.05

export interface CameraFormatDimensions {
  readonly width: number
  readonly height: number
}

/** 一个候选在入参数组里的原始下标 + 尺寸。 */
interface IndexedFormat {
  readonly index: number
  readonly width: number
  readonly height: number
}

function pixelsOf(format: IndexedFormat): number {
  return format.width * format.height
}

/**
 * Swift 的 `candidates.max { a, b in a.pixels < b.pixels }!.offset`：
 * 只在**严格更大**时替换，因此并列时保留先出现的那个（下标最小）。
 */
function highestPixels(candidates: readonly IndexedFormat[]): number {
  let best = candidates[0]
  for (const candidate of candidates) {
    if (pixelsOf(candidate) > pixelsOf(best)) best = candidate
  }
  return best.index
}

/**
 * Swift `preferredFormatIndex(dimensions:prefersLandscape:)`。
 * 返回入参数组下标；无任何合法尺寸时返回 null（调用方回退到设备默认格式）。
 */
export function preferredCameraFormatIndex(
  dimensions: readonly CameraFormatDimensions[],
  prefersLandscape: boolean
): number | null {
  const valid: IndexedFormat[] = []
  dimensions.forEach((dimension, index) => {
    if (dimension.width > 0 && dimension.height > 0) {
      valid.push({ index, width: dimension.width, height: dimension.height })
    }
  })
  if (valid.length === 0) return null

  if (!prefersLandscape) return highestPixels(valid)

  const landscape = valid.filter((format) => format.width >= format.height)
  if (landscape.length === 0) return highestPixels(valid)

  const cap = Math.trunc(CAMERA_FULL_HD_PIXELS * CAMERA_FULL_HD_PIXEL_HEADROOM)
  const withinCap = landscape.filter((format) => pixelsOf(format) <= cap)
  return highestPixels(withinCap.length === 0 ? landscape : withinCap)
}

/** 是否为横屏格式（宽 ≥ 高）。UI 用它给格式列表分组。 */
export function cameraFormatIsLandscape(format: CameraFormatDimensions): boolean {
  return format.width >= format.height
}
