/**
 * 连续圆角遮罩 —— Apple 风格 squircle（G2 连续曲率）的等价生成参数。
 *
 * Swift source: Sources/DogSCApp/ContinuousCornerMask.swift（218 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - enum ContinuousCornerMask                       L10-191
 *     · mask(rect:radius:)（四条前置 + 缓存键）        L17-70  → continuousCornerMaskPlan
 *     · 缓存键 "WxH@R"                                L32     → continuousCornerMaskCacheKey
 *     · 圆形判定（半径满格且宽高差 < 0.5）             L41-47  → continuousCornerIsCircle
 *     · 九宫格阈值 cap = ceil(radius*2+2)              L54-55  → continuousCornerAtlasPlan
 *     · surfaceBackedMask（1 字节覆盖率缓冲）          L77-174
 *       - 绘制尺寸 cap*2+2                            L91-92  → continuousCornerAtlasPlan.drawingSize
 *       - 九宫格 origins/lengths                      L127-128 → CORNER_ATLAS_SLICES
 *       - 拉伸断点 breakpoint0/1 与 growAmount         L156-158 → continuousCornerStretchPlan
 *       - 几何校验（extent 必须等于目标尺寸）           L160-166 → continuousCornerStretchAccepts
 *     · fallbackMask（CIRoundedRectangleGenerator）    L176-189
 *   - final class ContinuousCornerMaskCache            L196-218
 *     · countLimit 48 / totalCostLimit 64 MB           L202-203 → CORNER_MASK_CACHE_LIMITS
 *     · setObject cost = max(cost, 1)                  L211-213 → continuousCornerCacheCost
 *
 * 原注释（L30-31）：
 *   Fractional edges and radii affect coverage even when the backing dimensions
 *   match. Never reuse a neighbouring animation frame's mask.
 *
 * 原注释（L49-53）：
 *   Only the four corners contain changing coverage. A full 5K coverage buffer on
 *   every zoom tick spends the CPU frame budget painting an otherwise solid
 *   rectangle. Rasterize the SAME path into a compact nine-part atlas, keeping
 *   pixel-aligned edge samples. Circles/capsules and large overlapping corners
 *   keep the full path.
 *
 * 原注释（L72-76）：
 *   A cached `CIImage(cgImage:)` is still uploaded with `replaceRegion` on every
 *   separate Core Image render. Drawing the same vector mask once into an
 *   IOSurface-backed coverage buffer lets preview/export import it directly into
 *   Metal. One byte of coverage replaces four identical BGRA channels.
 *
 * 迁移说明：`CVPixelBuffer` / `CIFilter.ninePartStretched` / `NSCache` 在 Windows
 * 侧没有对应物。这里保留三件决定**正确性**的纯逻辑：
 *   1. 缓存键必须包含小数尺寸与小数半径（用整数键会让相邻动画帧共用遮罩）
 *   2. 九宫格阈值的精确不等式（`w > cap*2+2`，不是 `>=`）
 *   3. 拉伸后的 extent 校验（差 0.001 就算失败 → 回退整路径）
 * 实际栅格化交给 Canvas / Skia。
 */

/** Swift L202：缓存条目上限。 */
export const CORNER_MASK_CACHE_COUNT_LIMIT = 48

/** Swift L203：缓存成本上限（64 MB）。 */
export const CORNER_MASK_CACHE_COST_LIMIT = 64 * 1024 * 1024

/** Swift L64 / L101：覆盖率缓冲是单通道 8 bit。 */
export const CORNER_MASK_BITS_PER_COMPONENT = 8

/** Swift L161-162：extent 允许的误差。 */
export const CORNER_MASK_EXTENT_TOLERANCE = 0.001

/**
 * Swift L32：缓存键 `"WxH@R"`。
 *
 * 用**原始**（未取整）的宽高与**夹取后**的半径 —— 半径夹取是因为超过
 * 半宽/半高之后形状不再变化，复用同一个键能命中；但宽高不能取整，
 * 因为小数边缘直接影响覆盖率。
 */
export function continuousCornerMaskCacheKey(input: {
  readonly width: number
  readonly height: number
  readonly clampedRadius: number
}): string {
  return `${input.width}x${input.height}@${input.clampedRadius}`
}

/** Swift L27：半径夹到半宽半高的较小值。 */
export function continuousCornerClampedRadius(radius: number, width: number, height: number): number {
  return Math.min(radius, Math.min(width, height) / 2)
}

/**
 * Swift L21-26：无尺寸 → 全透明；无半径 → 全白（完全不遮）。
 *
 * 两个返回值的差异很关键：`rect` 空时返回**透明**遮罩（等于把内容裁没了），
 * 半径为 0 时返回**白色**遮罩（等于不裁）。写反会让零半径的贴纸整体消失。
 */
export type ContinuousCornerMaskKind = 'transparent' | 'opaque' | 'rounded'

export function continuousCornerMaskKind(input: {
  readonly width: number
  readonly height: number
  readonly radius: number
}): ContinuousCornerMaskKind {
  if (!(input.width > 0) || !(input.height > 0)) return 'transparent'
  if (!(input.radius > 0)) return 'opaque'
  return 'rounded'
}

/**
 * Swift L41：圆形判定。
 *
 * 两个条件同时成立才走椭圆路径：半径已夹满半宽半高（`>= min/2`）**且**
 * 宽高近似相等（差 < 0.5）。第二个条件是必须的 —— 一个 400×100 的
 * 胶囊在 `radius = 50` 时也满足第一条，但它不是圆。
 */
export function continuousCornerIsCircle(input: {
  readonly width: number
  readonly height: number
  readonly clampedRadius: number
}): boolean {
  return (
    input.clampedRadius >= Math.min(input.width, input.height) / 2 &&
    Math.abs(input.width - input.height) < 0.5
  )
}

/** Swift L54：九宫格切片尺寸。 */
export function continuousCornerAtlasCap(clampedRadius: number): number {
  return Math.ceil(clampedRadius * 2 + 2)
}

/** Swift L91-92 / L127-128：九宫格的几何。 */
export interface ContinuousCornerAtlasPlan {
  readonly usesAtlas: boolean
  readonly cap: number
  /** 九宫格图集的绘制尺寸（cap*2+2）。 */
  readonly drawingWidth: number
  readonly drawingHeight: number
  /** 是否用整路径（圆形/胶囊/大圆角）。 */
  readonly usesFullPath: boolean
}

/**
 * Swift L54-55：`safeWidth > cap * 2 + 2 && safeHeight > cap * 2 + 2`。
 *
 * 是**严格大于**。改成 `>=` 会让图集与目标同尺寸时也走拉伸，
 * 而 `growAmount` 变成 0 后九宫格会把中间 2 px 拉成 0 px，出现一条细缝。
 */
export function continuousCornerAtlasPlan(input: {
  readonly width: number
  readonly height: number
  readonly clampedRadius: number
  readonly isCircle: boolean
}): ContinuousCornerAtlasPlan {
  const safeWidth = Math.max(Math.ceil(input.width), 1)
  const safeHeight = Math.max(Math.ceil(input.height), 1)
  const cap = continuousCornerAtlasCap(input.clampedRadius)
  if (input.isCircle) {
    return {
      usesAtlas: false,
      cap,
      drawingWidth: safeWidth,
      drawingHeight: safeHeight,
      usesFullPath: true,
    }
  }
  const usesAtlas = safeWidth > cap * 2 + 2 && safeHeight > cap * 2 + 2
  return {
    usesAtlas,
    cap,
    drawingWidth: usesAtlas ? cap * 2 + 2 : safeWidth,
    drawingHeight: usesAtlas ? cap * 2 + 2 : safeHeight,
    usesFullPath: !usesAtlas,
  }
}

/** Swift L127-128：九宫格的九块（起点偏移 + 边长）。 */
export interface CornerAtlasSlice {
  readonly origin: number
  readonly length: number
}

export function continuousCornerAtlasSlices(cap: number): readonly CornerAtlasSlice[] {
  return [
    { origin: 0, length: cap },
    { origin: cap, length: 2 },
    { origin: cap + 2, length: cap },
  ]
}

/**
 * Swift L134-135：每块在绘制时的平移量。
 *
 * 第 2 行/列（index === 2）平移到「目标尺寸 − 图集尺寸」的负值处，
 * 这样图集的右下角采样的是**目标路径**的右下角，而不是重新画一个更小的
 * 圆角矩形。index 0/1 不平移。
 */
export function continuousCornerAtlasTranslation(input: {
  readonly index: number
  readonly drawingSize: number
  readonly targetSize: number
}): number {
  return input.index === 2 ? input.drawingSize - input.targetSize : 0
}

/** Swift L156-158：九宫格拉伸的三个参数。 */
export interface ContinuousCornerStretchPlan {
  readonly breakpoint0: { readonly x: number; readonly y: number }
  readonly breakpoint1: { readonly x: number; readonly y: number }
  readonly growAmount: { readonly x: number; readonly y: number }
}

export function continuousCornerStretchPlan(input: {
  readonly cap: number
  readonly width: number
  readonly height: number
  readonly drawingWidth: number
  readonly drawingHeight: number
}): ContinuousCornerStretchPlan {
  return {
    breakpoint0: { x: input.cap, y: input.cap },
    breakpoint1: { x: input.cap + 2, y: input.cap + 2 },
    growAmount: { x: input.width - input.drawingWidth, y: input.height - input.drawingHeight },
  }
}

/**
 * Swift L160-166：拉伸结果的几何校验。
 *
 * 四条同时成立才采用九宫格结果，否则回退整路径（不是裁剪也不是近似圆角）：
 * 有输出、extent 有限、extent 非空、宽高都与目标相差 < 0.001。
 */
export function continuousCornerStretchAccepts(input: {
  readonly hasOutput: boolean
  readonly isFinite: boolean
  readonly isNull: boolean
  readonly extentWidth: number
  readonly extentHeight: number
  readonly targetWidth: number
  readonly targetHeight: number
}): boolean {
  if (!input.hasOutput) return false
  if (!input.isFinite) return false
  if (input.isNull) return false
  return (
    Math.abs(input.extentWidth - input.targetWidth) < CORNER_MASK_EXTENT_TOLERANCE &&
    Math.abs(input.extentHeight - input.targetHeight) < CORNER_MASK_EXTENT_TOLERANCE
  )
}

/** Swift L211-213：成本至少 1 字节（`NSCache` 里 cost 为 0 等于不计费）。 */
export function continuousCornerCacheCost(cost: number): number {
  return Math.max(cost, 1)
}

/**
 * Swift L67-69：遮罩最终要平移到 `rect.minX/minY`。
 *
 * 缓存里存的是**原点在 0,0** 的遮罩，每次使用都要补一次平移；
 * 直接缓存带位置的遮罩会让同尺寸不同位置的贴纸各占一份缓存。
 */
export function continuousCornerMaskTranslation(input: {
  readonly minX: number
  readonly minY: number
}): { readonly x: number; readonly y: number } {
  return { x: input.minX, y: input.minY }
}

/**
 * Swift L196-218 的 LRU 近似缓存（同时按条目数与字节成本淘汰）。
 *
 * 与 `NSCache` 的等价点：`setObject` 覆盖同名键时先从旧条目上扣掉成本；
 * 条目数或成本超限时从**最旧**开始淘汰。`NSCache` 的淘汰时机不作保证，
 * 所以这里只保证「不超限」，不保证「一定留到最后」。
 */
export class ContinuousCornerMaskCache {
  private readonly entries = new Map<string, number>()
  private totalCost = 0

  get count(): number {
    return this.entries.size
  }

  get cost(): number {
    return this.totalCost
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  set(key: string, cost: number): void {
    const safeCost = continuousCornerCacheCost(cost)
    const previous = this.entries.get(key)
    if (previous != null) {
      this.totalCost -= previous
      this.entries.delete(key)
    }
    this.entries.set(key, safeCost)
    this.totalCost += safeCost
    while (
      this.entries.size > CORNER_MASK_CACHE_COUNT_LIMIT ||
      this.totalCost > CORNER_MASK_CACHE_COST_LIMIT
    ) {
      const oldest = this.entries.keys().next()
      if (oldest.done === true) break
      const oldestCost = this.entries.get(oldest.value) ?? 0
      this.entries.delete(oldest.value)
      this.totalCost -= oldestCost
    }
  }

  removeAll(): void {
    this.entries.clear()
    this.totalCost = 0
  }
}
