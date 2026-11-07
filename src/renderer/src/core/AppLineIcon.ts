/**
 * 应用线条图标 —— 18 点绘图网格、圆头接头、开放式轮廓。
 *
 * Swift source: Sources/DogSCApp/AppLineIcon.swift（353 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct AppLineIcon                                     L5-39
 *     · enum Kind（93 种）                                    L6-22
 *     · strokeWidth(for:)（≥24 → size/14，否则夹 1.2..1.55）   L30-32
 *     · body（stroke round/round + frame size×size）           L34-39
 *   - private struct Drawing（Shape）                        L41-352
 *     · line / circle / rounded 三个局部助手                  L46-56
 *     · switch kind 的全部分支                                L57-347
 *     · 最后统一 scale(rect.width/18) + translate             L348-349
 *
 * 原注释（L3-4）：
 *   The recorder's 18-point drawing grid, rounded joins and open silhouettes.
 *   Settings and its small actions share one stroke instead of mixing symbol weights.
 *
 * 原注释（L27-29）：
 *   One line weight across icon sizes: small glyphs no longer thin out
 *   to a hairline and toolbar glyphs no longer turn heavy. Large display
 *   icons keep their proportion.
 *
 * 迁移说明：SwiftUI 的 `Path` 在浏览器里没有对等物，这里把每个图标展开成
 * 一串**绘制指令**（`IconOp`），坐标全部落在 18×18 的設計网格上，
 * 使用时乘以 `size / 18` 即可。这样做的两个好处：
 *   1) 图标几何是可断言的纯数据（能算包围盒、指令数、中心点）；
 *   2) 任何一个渲染后端（Canvas 2D、SVG、WebGL）都能消费同一份表。
 *
 * 为什么不用 SVG path 字符串：`addArc(tangent1End:tangent2End:radius:)`
 * 这种「折角倒圆」在 SVG 里没有直接语法，而用指令表可以保留
 * 「控制点 = 折角顶点」这一事实（见 `zoom` 与 `CaptureViewfinder`）。
 *
 * 三个必须照抄的细节：
 *   - `strokeWidth` 在 ≥24 时是 `size / 14`（线性放粗），否则夹在 1.2..1.55；
 *   - 所有指令最后统一缩放到 `rect` 尺寸，网格常量是 18；
 *   - `checkCircle` / `eyeOff` / `redo` / `nextFrame` / `deleteRight`
 *     都是「同一份几何 + 一个条件」，不是各自独立的图案。
 */

/** 网格边长。所有坐标都在 0..18 内。 */
export const APP_LINE_ICON_GRID = 18

/** Swift L25：默认尺寸。 */
export const APP_LINE_ICON_DEFAULT_SIZE = 18

/**
 * Swift L6-22：93 种图标。
 *
 * 这份列表的顺序与 Swift 完全一致 —— 包括 `arrowUpLeft, arrowDownRight`
 * 与 `deleteLeft, deleteRight` 这种「一对」的相邻关系。
 */
export const APP_LINE_ICON_KINDS = [
  'settings',
  'sliders',
  'record',
  'shield',
  'info',
  'appearance',
  'sun',
  'moon',
  'globe',
  'shapeCircle',
  'shapeRounded',
  'shapeWide',
  'bell',
  'speaker',
  'box',
  'download',
  'sparkle',
  'display',
  'window',
  'microphone',
  'cursor',
  'camera',
  'folder',
  'check',
  'checkCircle',
  'warning',
  'refresh',
  'code',
  'feedback',
  'cup',
  'external',
  'chevron',
  'person',
  'close',
  'arrowLeft',
  'scene',
  'opening',
  'zoom',
  'cursorMotion',
  'undo',
  'redo',
  'plus',
  'trash',
  'pencil',
  'share',
  'chevronDown',
  'layers',
  'play',
  'pause',
  'stop',
  'previousFrame',
  'nextFrame',
  'scissors',
  'minus',
  'waveform',
  'eye',
  'eyeOff',
  'fit',
  'grid',
  'crop',
  'layout',
  'film',
  'magnet',
  'clock',
  'cube',
  'link',
  'photoAdd',
  'paste',
  'expand',
  'aspect',
  'target',
  'move',
  'pin',
  'speed',
  'drop',
  'halfCircle',
  'bookmark',
  'swap',
  'speakerOff',
  'cameraOff',
  'search',
  'noSymbol',
  'chevronLeft',
  'chevronUp',
  'noFrame',
  'portrait',
  'arrowRight',
  'arrowUpLeft',
  'arrowDownRight',
  'deleteLeft',
  'deleteRight',
  'list',
  'presets',
] as const

/** 图标名。 */
export type AppLineIconKind = (typeof APP_LINE_ICON_KINDS)[number]

/**
 * Swift L30-32：线宽。
 *
 *   size ≥ 24 → size / 14      （大图标按比例放粗，保持视觉重量）
 *   否则      → size / 12 夹到 1.2 .. 1.55
 *
 * 为什么小图标要夹：18 时是 1.5，14 时是 1.167 会被抬到 1.2，
 * 12 时是 1.0 也被抬到 1.2 —— 这样 12~18 之间的图标看起来一样粗，
 * 不会出现「越小的图标越淡」。
 */
export function appLineIconStrokeWidth(size: number): number {
  if (size >= 24) return size / 14
  return Math.min(Math.max(size / 12, 1.2), 1.55)
}

// ---------------------------------------------------------------- 指令模型

/**
 * 一条绘制指令。
 *
 * `L` 是**折线**（第一个点 moveTo，后续点 lineTo）——
 * 对应 Swift 里那个 `func line(_ points:)` 助手，它一次画多段。
 */
export type IconOp =
  | { readonly op: 'M'; readonly x: number; readonly y: number }
  | { readonly op: 'L'; readonly points: readonly (readonly [number, number])[] }
  | { readonly op: 'Q'; readonly cx: number; readonly cy: number; readonly x: number; readonly y: number }
  | { readonly op: 'C'; readonly c1x: number; readonly c1y: number; readonly c2x: number; readonly c2y: number; readonly x: number; readonly y: number }
  | { readonly op: 'E'; readonly x: number; readonly y: number; readonly r: number }
  | { readonly op: 'O'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly op: 'R'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r: number }
  | { readonly op: 'Z' }
  | { readonly op: 'MX'; readonly ops: readonly IconOp[] }

/** Swift L46-50：`line(_ points:)`。 */
function ln(...flat: number[]): IconOp {
  const points: [number, number][] = []
  for (let i = 0; i + 1 < flat.length; i += 2) points.push([flat[i], flat[i + 1]])
  return { op: 'L', points }
}

/** Swift L51-53：`circle(_:_:_:)`。 */
function ci(x: number, y: number, r: number): IconOp {
  return { op: 'E', x, y, r }
}

/** Swift L51-53：`addEllipse(in:)` 的矩形形式（例如地球的经线）。 */
function el(x: number, y: number, w: number, h: number): IconOp {
  return { op: 'O', x, y, w, h }
}

/** Swift L54-56：`rounded(_:_:_:_:_:)`。 */
function rr(x: number, y: number, w: number, h: number, r: number): IconOp {
  return { op: 'R', x, y, w, h, r }
}

/** `path.move(to:)`。 */
function mv(x: number, y: number): IconOp {
  return { op: 'M', x, y }
}

/** `path.addLine(to:)`。 */
function lt(x: number, y: number): IconOp {
  return { op: 'L', points: [[x, y]] }
}

/** `path.addQuadCurve(to:control:)`。 */
function q(cx: number, cy: number, x: number, y: number): IconOp {
  return { op: 'Q', cx, cy, x, y }
}

/** `path.addCurve(to:control1:control2:)`。 */
function cv(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): IconOp {
  return { op: 'C', c1x, c1y, c2x, c2y, x, y }
}

/** `path.closeSubpath()`。 */
const CL: IconOp = { op: 'Z' }

/** `path.addPath(q.applying(CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: 18, ty: 0)))`。 */
function mirrorX(...ops: IconOp[]): IconOp {
  return { op: 'MX', ops }
}

// ---------------------------------------------------------------- 几何表

/** Swift L57-347：每个图标一份指令表。 */
const ICON_GEOMETRY: Record<AppLineIconKind, () => readonly IconOp[]> = {
  /** Swift L58-65：48 个采样点的齿轮 —— 每 6 个里有 4 个短齿（半径 6）。 */
  settings: () => {
    const ops: IconOp[] = []
    const points: [number, number][] = []
    for (let i = 0; i < 48; i += 1) {
      const angle = (i * Math.PI) / 24 - Math.PI / 2
      const radius = [0, 1, 4, 5].includes(i % 6) ? 6 : 7.5
      points.push([9 + Math.cos(angle) * radius, 9 + Math.sin(angle) * radius])
    }
    ops.push({ op: 'L', points })
    ops.push(CL, ci(9, 9, 2.5))
    return ops
  },

  /** Swift L66-69：三条滑轨，滑块位置各不相同。 */
  sliders: () => [
    ln(2, 4, 5, 4),
    ci(7, 4, 1.8),
    ln(9, 4, 16, 4),
    ln(2, 9, 10, 9),
    ci(12, 9, 1.8),
    ln(14, 9, 16, 9),
    ln(2, 14, 4, 14),
    ci(6, 14, 1.8),
    ln(8, 14, 16, 14),
  ],

  /** Swift L70-71：录制 —— 实心点 + 外圈。 */
  record: () => [ci(9, 9, 7), ci(9, 9, 2.6)],

  /** Swift L72-79：盾牌 + 里面的一把锁。 */
  shield: () => [
    mv(9, 1.5),
    lt(15, 4),
    lt(15, 9),
    q(15, 14, 9, 16.5),
    q(3, 14, 3, 9),
    lt(3, 4),
    CL,
    rr(6.8, 8, 4.4, 4, 0.8),
    mv(7.5, 8),
    cv(7.5, 4.5, 10.5, 4.5, 10.5, 8),
  ],

  /** Swift L80-81：信息圆 + 一点 + 一竖。 */
  info: () => [ci(9, 9, 7), ci(9, 5, 0.35), ln(8, 8, 9, 8, 9, 13), ln(7.7, 13, 10.3, 13)],

  /** Swift L82-83：圆形遮罩选项。 */
  shapeCircle: () => [ci(9, 9, 6.5)],

  /** Swift L84-85：圆角矩形遮罩选项。 */
  shapeRounded: () => [rr(2.5, 2.5, 13, 13, 4)],

  /** Swift L86-87：宽矩形遮罩选项（16:9 的示意）。 */
  shapeWide: () => [rr(1.5, 4.5, 15, 9, 2.5)],

  /** Swift L88-90：地球 —— 外圆 + 一条竖向椭圆 + 赤道。 */
  globe: () => [ci(9, 9, 7), el(5.6, 2, 6.8, 14), ln(2, 9, 16, 9)],

  /** Swift L91-93：外观 —— 圆 + 中轴 + 两条偏心的竖线。 */
  appearance: () => [ci(9, 9, 6.7), ln(9, 2.3, 9, 15.7), ln(5, 4, 5, 14), ln(7, 3, 7, 15)],

  /** Swift L94-99：太阳 —— 内核 3.2，八道光芒从 5.5 到 7.4。 */
  sun: () => {
    const ops: IconOp[] = [ci(9, 9, 3.2)]
    for (let i = 0; i < 8; i += 1) {
      const a = (i * Math.PI) / 4
      ops.push(ln(9 + Math.cos(a) * 5.5, 9 + Math.sin(a) * 5.5, 9 + Math.cos(a) * 7.4, 9 + Math.sin(a) * 7.4))
    }
    return ops
  },

  /** Swift L100-103：月牙 —— 两段三次贝塞尔，第二段的控制点故意在画布外。 */
  moon: () => [mv(11, 2), cv(6, 7, 11, 13, 16, 11), cv(10, 22, -5, 7, 11, 2)],

  /** Swift L104-109：铃铛 + 顶部小柄 + 底部弧。 */
  bell: () => [
    mv(3, 12.5),
    q(4.5, 11, 4.5, 8),
    cv(4.5, 0.5, 13.5, 0.5, 13.5, 8),
    q(13.5, 11, 15, 12.5),
    CL,
    ln(9, 1.5, 9, 2.5),
    mv(7, 15),
    q(9, 17, 11, 15),
  ],

  /** Swift L110-113：喇叭 + 两道声波。 */
  speaker: () => [
    ln(2, 6, 5, 6, 9, 2.7, 9, 15.3, 5, 12, 2, 12, 2, 6),
    mv(12, 6),
    q(14.5, 9, 12, 12),
    mv(14.5, 3.5),
    q(18.5, 9, 14.5, 14.5),
  ],

  /** Swift L114-116：立方体箱 —— 一个闭合轮廓 + 两条内线。 */
  box: () => [
    ln(2.5, 5.3, 9, 2, 15.5, 5.3, 15.5, 12.7, 9, 16, 2.5, 12.7, 2.5, 5.3, 9, 9, 15.5, 5.3),
    ln(9, 9, 9, 16),
    ln(5.8, 3.7, 12, 7.2),
  ],

  /** Swift L117-119：下载 —— 箭头 + 一个开口托盘。 */
  download: () => [
    ln(9, 1.8, 9, 11),
    ln(5.5, 7.5, 9, 11, 12.5, 7.5),
    mv(3, 9),
    lt(3, 13.5),
    q(3, 15.5, 5, 15.5),
    lt(13, 15.5),
    q(15, 15.5, 15, 13.5),
    lt(15, 9),
  ],

  /** Swift L120-122：星芒 + 一个小十字。 */
  sparkle: () => [
    ln(10.5, 4, 12, 8.5, 16, 10, 12, 11.5, 10.5, 16, 9, 11.5, 5, 10, 9, 8.5, 10.5, 4),
    ln(4, 1.8, 4, 6.2),
    ln(1.8, 4, 6.2, 4),
  ],

  /** Swift L123-124：显示器 —— 屏幕 + 支架 + 底座。 */
  display: () => [rr(2, 2.5, 14, 10, 2), ln(9, 12.5, 9, 15.5), ln(5.5, 15.5, 12.5, 15.5)],

  /** Swift L125-126：窗口 —— 标题栏分隔线 + 两个圆点。 */
  window: () => [rr(2, 3, 14, 12, 2), ln(2, 6.5, 16, 6.5), ci(4.5, 4.8, 0.2), ci(6.5, 4.8, 0.2)],

  /** Swift L127-130：麦克风 —— 胶囊 + 下方弧 + 杆 + 底座。 */
  microphone: () => [
    rr(6.5, 1.5, 5, 10, 2.5),
    mv(4, 8),
    cv(4, 16, 14, 16, 14, 8),
    ln(9, 14, 9, 16.5),
    ln(6, 16.5, 12, 16.5),
  ],

  /** Swift L131-132：鼠标指针 —— 一条闭合折线。 */
  cursor: () => [ln(3, 1.5, 14, 9, 9.5, 9.5, 12, 15, 9, 16.5, 6.5, 11, 3, 14, 3, 1.5)],

  /** Swift L133-134：摄像头 —— 机身 + 右侧镜头三角。 */
  camera: () => [rr(1.5, 4.5, 10.5, 9, 2), ln(12, 7, 16.5, 4.5, 16.5, 13.5, 12, 11)],

  /** Swift L135-136：文件夹 —— 带标签的完整轮廓，最后一段是「内折」。 */
  folder: () => [
    mv(2, 6),
    lt(2, 4),
    q(2, 2.5, 4, 2.5),
    lt(7, 2.5),
    lt(9, 4.5),
    lt(14, 4.5),
    q(16, 4.5, 16, 6.5),
    lt(16, 13.5),
    q(16, 15.5, 14, 15.5),
    lt(4, 15.5),
    q(2, 15.5, 2, 13.5),
    lt(2, 6),
    lt(12, 6),
  ],

  /** Swift L137-139：对勾；`checkCircle` 只是多一个外圈。 */
  check: () => [ln(5, 9, 8, 12, 13, 6)],

  /** Swift L137-139：带圆的对勾。 */
  checkCircle: () => [ci(9, 9, 7), ln(5, 9, 8, 12, 13, 6)],

  /** Swift L140-141：警告三角 + 感叹号。 */
  warning: () => [ln(9, 2, 16.5, 15, 1.5, 15, 9, 2), ln(9, 6, 9, 10), ci(9, 12.5, 0.3)],

  /** Swift L142-144：刷新 —— 两段弧 + 两个箭头。 */
  refresh: () => [
    mv(3, 7),
    cv(5, -0.5, 13, 1, 14.5, 4.5),
    ln(14.5, 1.5, 14.5, 5, 11, 5),
    mv(15, 11),
    cv(13, 18.5, 5, 17, 3.5, 13.5),
    ln(3.5, 16.5, 3.5, 13, 7, 13),
  ],

  /** Swift L145-146：代码 —— 两个尖括号 + 一条斜杠。 */
  code: () => [ln(5, 4.5, 1.5, 9, 5, 13.5), ln(13, 4.5, 16.5, 9, 13, 13.5), ln(10.5, 3, 7.5, 15)],

  /** Swift L147-148：反馈气泡 —— 圆角框 + 左下小尾 + 两条文字线。 */
  feedback: () => [
    mv(5, 2.5),
    lt(13, 2.5),
    q(16, 2.5, 16, 5.5),
    lt(16, 10),
    q(16, 13, 13, 13),
    lt(8, 13),
    lt(4, 16),
    lt(4, 12.8),
    q(2, 12.5, 2, 10),
    lt(2, 5.5),
    q(2, 2.5, 5, 2.5),
    ln(5.5, 6.5, 12.5, 6.5),
    ln(5.5, 9.5, 10, 9.5),
  ],

  /** Swift L149-151：咖啡杯 —— 杯体 + 把手 + 碟 + 两缕热气。 */
  cup: () => [
    mv(3, 5),
    lt(12, 5),
    lt(12, 10),
    cv(12, 16, 3, 16, 3, 10),
    CL,
    mv(12, 6),
    cv(18, 4, 18, 12, 12, 11),
    ln(2, 16, 14, 16),
    ln(5, 1.5, 5, 2.5),
    ln(9, 1.5, 9, 2.5),
  ],

  /** Swift L152-153：外链 —— 斜箭 + 右上角。 */
  external: () => [ln(4, 14, 14, 4), ln(6, 4, 14, 4, 14, 12)],

  /** Swift L154-155：右向尖角。 */
  chevron: () => [ln(6, 3.5, 11.5, 9, 6, 14.5)],

  /** Swift L156-158：人像 —— 头 + 肩。 */
  person: () => [ci(9, 6, 3), mv(2.5, 16), cv(3, 10, 15, 10, 15.5, 16)],

  /** Swift L159-160：叉。 */
  close: () => [ln(4.5, 4.5, 13.5, 13.5), ln(13.5, 4.5, 4.5, 13.5)],

  /** Swift L161-162：左箭头。 */
  arrowLeft: () => [ln(14.5, 9, 3.5, 9), ln(8.5, 4, 3.5, 9, 8.5, 14)],

  /** Swift L163-166：场景 —— 画框 + 折线山形 + 一个小太阳。 */
  scene: () => [
    rr(2, 3.5, 14, 11, 2.5),
    ln(4.8, 12, 8, 8.6, 10.4, 11, 11.8, 9.6, 13.6, 11.6),
    ci(12.2, 6.6, 1.1),
  ],

  /** Swift L167-169：片头 —— 画框 + 播放三角。 */
  opening: () => [rr(2, 3, 14, 12, 2.5), ln(7.6, 6.6, 11.8, 9, 7.6, 11.4, 7.6, 6.6)],

  /** Swift L170-177：变焦 —— 四个折角 + 中心点。 */
  zoom: () => {
    const ops: IconOp[] = []
    const corners: [number, number, number, number][] = [
      [2.5, 2.5, 1, 1],
      [15.5, 2.5, -1, 1],
      [15.5, 15.5, -1, -1],
      [2.5, 15.5, 1, -1],
    ]
    for (const [cx, cy, dx, dy] of corners) {
      // 折角倒圆：`addArc(tangent1End: (cx, cy), tangent2End: (cx+3.6dx, cy), radius: 1.6)`
      // 在 90° 折角上等价于一段以折角为控制点的二次贝塞尔。
      ops.push(mv(cx, cy + 3.6 * dy))
      ops.push(q(cx, cy, cx + 3.6 * dx, cy))
    }
    ops.push(ci(9, 9, 2.4))
    return ops
  },

  /** Swift L178-180：指针运动 —— 指针 + 左侧三条速度线。 */
  cursorMotion: () => [
    ln(7, 2.5, 15.5, 8.2, 11.9, 8.7, 13.8, 13, 11.6, 14, 9.8, 9.8, 7, 12.4, 7, 2.5),
    ln(1.8, 6.5, 4, 6.5),
    ln(2.6, 10, 4.4, 10),
    ln(1.8, 13.5, 5, 13.5),
  ],

  /** Swift L181-187：撤销 —— 一个折返箭头，`redo` 是它的镜像。 */
  undo: () => [
    mv(7, 3.8),
    lt(3.8, 7),
    lt(7, 10.2),
    mv(3.8, 7),
    lt(11, 7),
    cv(15.8, 7, 15.8, 14.2, 11, 14.2),
    lt(6.5, 14.2),
  ],

  /** Swift L181-187：重做 = 沿 x=9 镜像的撤销箭头。 */
  redo: () => [
    mirrorX(
      mv(7, 3.8),
      lt(3.8, 7),
      lt(7, 10.2),
      mv(3.8, 7),
      lt(11, 7),
      cv(15.8, 7, 15.8, 14.2, 11, 14.2),
      lt(6.5, 14.2)
    ),
  ],

  /** Swift L188-189：加号。 */
  plus: () => [ln(9, 3.5, 9, 14.5), ln(3.5, 9, 14.5, 9)],

  /** Swift L190-193：垃圾桶 —— 盖沿 + 提手 + 桶身 + 两条竖纹。 */
  trash: () => [
    ln(2.5, 4.5, 15.5, 4.5),
    ln(6.8, 4.5, 7.4, 2.2, 10.6, 2.2, 11.2, 4.5),
    ln(4, 4.5, 4.9, 14.4, 6.4, 15.8, 11.6, 15.8, 13.1, 14.4, 14, 4.5),
    ln(7.4, 7.6, 7.6, 12.6),
    ln(10.6, 7.6, 10.4, 12.6),
  ],

  /** Swift L194-195：铅笔 —— 一个闭合笔形 + 笔头分隔线。 */
  pencil: () => [
    ln(3, 15, 3.6, 11.6, 12, 3.2, 14.8, 6, 6.4, 14.4, 3, 15),
    ln(10.4, 4.8, 13.2, 7.6),
  ],

  /** Swift L196-198：分享 —— 上箭头 + 托盘。 */
  share: () => [
    ln(9, 11, 9, 2),
    ln(5.5, 5.5, 9, 2, 12.5, 5.5),
    mv(5.5, 8.5),
    lt(4.5, 8.5),
    q(3, 8.5, 3, 10),
    lt(3, 14),
    q(3, 15.5, 4.5, 15.5),
    lt(13.5, 15.5),
    q(15, 15.5, 15, 14),
    lt(15, 10),
    q(15, 8.5, 13.5, 8.5),
    lt(12.5, 8.5),
  ],

  /** Swift L199-200：下箭头。 */
  chevronDown: () => [ln(4, 6.5, 9, 11.5, 14, 6.5)],

  /** Swift L201-202：图层。 */
  layers: () => [ln(9, 2.5, 16, 6.5, 9, 10.5, 2, 6.5, 9, 2.5), ln(2, 10.5, 9, 14.5, 16, 10.5)],

  /** Swift L203-204：播放。 */
  play: () => [ln(5.5, 3.5, 14, 9, 5.5, 14.5, 5.5, 3.5)],

  /** Swift L205-206：暂停。 */
  pause: () => [ln(6, 3.5, 6, 14.5), ln(12, 3.5, 12, 14.5)],

  /** Swift L207-208：停止。 */
  stop: () => [rr(4, 4, 10, 10, 2)],

  /** Swift L209-214：上一帧。 */
  previousFrame: () => [mv(3.5, 3.5), lt(3.5, 14.5), mv(14, 3.5), lt(6, 9), lt(14, 14.5), CL],

  /** Swift L209-214：下一帧 = 沿 x=9 镜像。 */
  nextFrame: () => [mirrorX(mv(3.5, 3.5), lt(3.5, 14.5), mv(14, 3.5), lt(6, 9), lt(14, 14.5), CL)],

  /** Swift L215-217：剪刀 —— 两个环 + 两条交叉线。 */
  scissors: () => [ci(4.5, 4.5, 2.3), ci(4.5, 13.5, 2.3), ln(6.3, 6, 15, 14.5), ln(6.3, 12, 15, 3.5)],

  /** Swift L218-219：减号。 */
  minus: () => [ln(3.5, 9, 14.5, 9)],

  /** Swift L220-223：波形 —— 五根高度不同的竖线。 */
  waveform: () => {
    const bars: [number, number][] = [
      [2, 3],
      [5.5, 8],
      [9, 13],
      [12.5, 7],
      [16, 3],
    ]
    return bars.map(([x, height]) => ln(x, 9 - height / 2, x, 9 + height / 2))
  },

  /** Swift L224-228：眼睛。 */
  eye: () => [
    mv(1.5, 9),
    cv(5, 2, 13, 2, 16.5, 9),
    cv(13, 16, 5, 16, 1.5, 9),
    ci(9, 9, 2.3),
  ],

  /** Swift L224-229：闭眼 = 眼睛 + 一道斜杠。 */
  eyeOff: () => [
    mv(1.5, 9),
    cv(5, 2, 13, 2, 16.5, 9),
    cv(13, 16, 5, 16, 1.5, 9),
    ci(9, 9, 2.3),
    ln(3, 2.5, 15, 15.5),
  ],

  /** Swift L230-233：适应窗口 —— 左右两条竖边 + 两个向内尖角。 */
  fit: () => [
    ln(2.5, 3, 2.5, 15),
    ln(15.5, 3, 15.5, 15),
    ln(5.5, 6, 8.5, 9, 5.5, 12),
    ln(12.5, 6, 9.5, 9, 12.5, 12),
  ],

  /** Swift L234-237：网格 —— 外框 + 两竖两横。 */
  grid: () => [
    rr(2.5, 2.5, 13, 13, 2),
    ln(7, 2.5, 7, 15.5),
    ln(11, 2.5, 11, 15.5),
    ln(2.5, 7, 15.5, 7),
    ln(2.5, 11, 15.5, 11),
  ],

  /** Swift L238-240：裁剪 —— 两个缺角的 L。 */
  crop: () => [ln(5, 2, 5, 13, 16, 13), ln(2, 5, 13, 5, 13, 16)],

  /** Swift L241-243：布局 —— 外框 + 内框。 */
  layout: () => [rr(2, 3, 14, 12, 2), rr(5, 6, 8, 6, 1)],

  /** Swift L244-252：磁铁 —— 马蹄形 + 两道横纹。 */
  magnet: () => [
    mv(3.5, 2.5),
    lt(3.5, 9),
    cv(3.5, 17, 14.5, 17, 14.5, 9),
    lt(14.5, 2.5),
    mv(7, 2.5),
    lt(7, 9),
    cv(7, 12.2, 11, 12.2, 11, 9),
    lt(11, 2.5),
    ln(3.5, 2.5, 7, 2.5),
    ln(11, 2.5, 14.5, 2.5),
    ln(3.5, 5.5, 7, 5.5),
    ln(11, 5.5, 14.5, 5.5),
  ],

  /** Swift L253-254：时钟。 */
  clock: () => [ci(9, 9, 7), ln(9, 5, 9, 9, 12, 11)],

  /** Swift L255-257：立方体 —— 六边形 + 三条内棱。 */
  cube: () => [
    ln(9, 1.8, 15.5, 5.5, 15.5, 12.5, 9, 16.2, 2.5, 12.5, 2.5, 5.5, 9, 1.8),
    ln(2.5, 5.5, 9, 9.2, 15.5, 5.5),
    ln(9, 9.2, 9, 16.2),
  ],

  /** Swift L258-259：链接 —— 两个重叠的圆角胶囊。 */
  link: () => [rr(1.5, 6, 9, 6, 3), rr(7.5, 6, 9, 6, 3)],

  /** Swift L260-264：添加图片 —— 画框 + 山形 + 太阳 + 右侧加号。 */
  photoAdd: () => [
    rr(1.5, 2.5, 12, 10, 2),
    ln(3.8, 10.5, 6.6, 7.4, 8.8, 9.6, 10.2, 8.2, 11.6, 9.6),
    ci(10, 5.4, 0.9),
    ln(14.5, 10.5, 14.5, 16.5),
    ln(11.5, 13.5, 17.5, 13.5),
  ],

  /** Swift L265-267：粘贴 —— 纸 + 夹子 + 两条文字线。 */
  paste: () => [
    rr(3.5, 3, 11, 13.5, 2),
    rr(6.5, 1.5, 5, 3, 1.2),
    ln(6.5, 8.5, 11.5, 8.5),
    ln(6.5, 11.5, 10, 11.5),
  ],

  /** Swift L268-270：展开 —— 两个对角箭头。 */
  expand: () => [ln(3, 8, 3, 3, 8, 3), ln(3, 3, 7.5, 7.5), ln(15, 10, 15, 15, 10, 15), ln(15, 15, 10.5, 10.5)],

  /** Swift L271-273：比例 —— 画框 + 两个对角折角。 */
  aspect: () => [rr(1.5, 3.5, 15, 11, 2.5), ln(4.5, 8.5, 4.5, 6.5, 6.5, 6.5), ln(13.5, 9.5, 13.5, 11.5, 11.5, 11.5)],

  /** Swift L274-277：目标 —— 双环 + 四个刻度。 */
  target: () => [
    ci(9, 9, 6),
    ci(9, 9, 1.2),
    ln(9, 1.5, 9, 4),
    ln(9, 14, 9, 16.5),
    ln(1.5, 9, 4, 9),
    ln(14, 9, 16.5, 9),
  ],

  /** Swift L278-281：移动 —— 十字 + 四个箭头。 */
  move: () => [
    ln(9, 2, 9, 16),
    ln(2, 9, 16, 9),
    ln(6.8, 4.2, 9, 2, 11.2, 4.2),
    ln(6.8, 13.8, 9, 16, 11.2, 13.8),
    ln(4.2, 6.8, 2, 9, 4.2, 11.2),
    ln(13.8, 6.8, 16, 9, 13.8, 11.2),
  ],

  /** Swift L282-287：图钉 —— 三段贝塞尔 + 中心点。 */
  pin: () => [
    mv(9, 16),
    cv(6, 12.5, 3.5, 10, 3.5, 7),
    cv(3.5, 0, 14.5, 0, 14.5, 7),
    cv(14.5, 10, 12, 12.5, 9, 16),
    ci(9, 7, 2),
  ],

  /** Swift L288-291：速度 —— 半圆表盘 + 指针 + 轴心。 */
  speed: () => [mv(2, 12.5), cv(2, 3, 16, 3, 16, 12.5), ln(9, 12, 12.5, 7), ci(9, 12, 1)],

  /** Swift L292-296：水滴 —— 左侧两段弧（右侧对称）。 */
  drop: () => [mv(9, 2), cv(9, 2, 2.5, 16, 9, 16), mv(9, 2), cv(9, 2, 15.5, 16, 9, 16)],

  /** Swift L297-299：半圆 —— 圆 + 中轴 + 两条递减竖线。 */
  halfCircle: () => [ci(9, 9, 7), ln(9, 2, 9, 16), ln(6, 3, 6, 15), ln(3.6, 5, 3.6, 13)],

  /** Swift L300-301：书签。 */
  bookmark: () => [ln(4.5, 2, 13.5, 2, 13.5, 16, 9, 12.5, 4.5, 16, 4.5, 2)],

  /** Swift L302-303：交换 —— 横线 + 两端相反箭头。 */
  swap: () => [ln(2, 9, 16, 9), ln(5, 6, 2, 9, 5, 12), ln(13, 6, 16, 9, 13, 12)],

  /** Swift L304-306：静音喇叭 —— 喇叭 + 叉。 */
  speakerOff: () => [
    ln(2, 6, 5, 6, 9, 2.7, 9, 15.3, 5, 12, 2, 12, 2, 6),
    ln(12, 6.5, 16.5, 11.5),
    ln(16.5, 6.5, 12, 11.5),
  ],

  /** Swift L307-309：关闭摄像头 —— 机身 + 斜杠。 */
  cameraOff: () => [rr(1.5, 4.5, 10.5, 9, 2), ln(12, 7, 16.5, 4.5, 16.5, 13.5, 12, 11), ln(1.5, 2, 16.5, 16)],

  /** Swift L310-311：搜索 —— 环 + 柄。 */
  search: () => [ci(7.8, 7.8, 5.2), ln(11.6, 11.6, 16, 16)],

  /** Swift L312-313：禁止 —— 环 + 斜杠。 */
  noSymbol: () => [ci(9, 9, 7), ln(4, 14, 14, 4)],

  /** Swift L314-315：左尖角。 */
  chevronLeft: () => [ln(12, 3.5, 6.5, 9, 12, 14.5)],

  /** Swift L316-317：上尖角。 */
  chevronUp: () => [ln(4, 11.5, 9, 6.5, 14, 11.5)],

  /** Swift L318-319：无边框 —— 画框 + 斜杠。 */
  noFrame: () => [rr(2, 3.5, 14, 11, 2.5), ln(3, 16, 15, 2)],

  /** Swift L320-321：竖屏。 */
  portrait: () => [rr(4.5, 1.5, 9, 15, 2.5)],

  /** Swift L322-323：右箭头。 */
  arrowRight: () => [ln(3.5, 9, 14.5, 9), ln(9.5, 4, 14.5, 9, 9.5, 14)],

  /** Swift L324-325：左上箭头。 */
  arrowUpLeft: () => [ln(14, 14, 4, 4), ln(4, 10, 4, 4, 10, 4)],

  /** Swift L326-327：右下箭头。 */
  arrowDownRight: () => [ln(4, 4, 14, 14), ln(14, 8, 14, 14, 8, 14)],

  /** Swift L328-336：退格键。 */
  deleteLeft: () => [
    mv(6, 3.5),
    lt(15, 3.5),
    q(16.5, 3.5, 16.5, 5),
    lt(16.5, 13),
    q(16.5, 14.5, 15, 14.5),
    lt(6, 14.5),
    lt(1.5, 9),
    CL,
    mv(8.5, 6.5),
    lt(13, 11.5),
    mv(13, 6.5),
    lt(8.5, 11.5),
  ],

  /** Swift L328-336：右退格 = 沿 x=9 镜像。 */
  deleteRight: () => [
    mirrorX(
      mv(6, 3.5),
      lt(15, 3.5),
      q(16.5, 3.5, 16.5, 5),
      lt(16.5, 13),
      q(16.5, 14.5, 15, 14.5),
      lt(6, 14.5),
      lt(1.5, 9),
      CL,
      mv(8.5, 6.5),
      lt(13, 11.5),
      mv(13, 6.5),
      lt(8.5, 11.5)
    ),
  ],

  /** Swift L337-338：列表 —— 三个点 + 三条线。 */
  list: () => {
    const ops: IconOp[] = []
    for (const y of [4.5, 9, 13.5]) {
      ops.push(ci(3.5, y, 0.6), ln(7, y, 15.5, y))
    }
    return ops
  },

  /** Swift L339-340：预设 —— 两个方块 + 一条横长条。 */
  presets: () => [rr(2, 2.5, 6, 6, 1.6), rr(10, 2.5, 6, 6, 1.6), rr(2, 10.5, 14, 5, 1.6)],

  /** Swift L341-346：胶片 —— 画框 + 两条竖隔 + 四段齿孔。 */
  film: () => {
    const ops: IconOp[] = [rr(2, 3, 14, 12, 2), ln(5.5, 3, 5.5, 15), ln(12.5, 3, 12.5, 15)]
    for (const y of [7, 11]) {
      ops.push(ln(2, y, 5.5, y), ln(12.5, y, 16, y))
    }
    return ops
  },
}

/** 取一个图标的原始指令表。 */
export function appLineIconOps(kind: AppLineIconKind): readonly IconOp[] {
  return ICON_GEOMETRY[kind]()
}

/** 93 种图标的指令数（不展开镜像），用于冒烟断言。 */
export function appLineIconOpCount(kind: AppLineIconKind): number {
  return ICON_GEOMETRY[kind]().length
}

// ---------------------------------------------------------------- 展开

/**
 * 展开后的路径指令（镜像已解算）。
 *
 * `points` 全部是 18 网格坐标；`op` 与 SVG 的 M/L/Q/C/Z 一一对应，
 * `R` 与 `E`/`O` 是「形状」而不是「路径」，渲染端自行处理。
 */
export type IconCommand =
  | { readonly op: 'M'; readonly x: number; readonly y: number }
  | { readonly op: 'L'; readonly x: number; readonly y: number }
  | { readonly op: 'Q'; readonly cx: number; readonly cy: number; readonly x: number; readonly y: number }
  | { readonly op: 'C'; readonly c1x: number; readonly c1y: number; readonly c2x: number; readonly c2y: number; readonly x: number; readonly y: number }
  | { readonly op: 'E'; readonly x: number; readonly y: number; readonly r: number }
  | { readonly op: 'O'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly op: 'R'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r: number }
  | { readonly op: 'Z' }

/**
 * Swift L348-349：把 18 网格贴到目标尺寸上。
 *
 * 注意这是**非等比**的：`scaleX = rect.width / 18`、`scaleY = rect.height / 18`。
 * 图标永远按正方形用，所以两者相等；但保留这个不对称能让断言发现
 * 「有人用图标去填一个长方形」。
 */
export interface IconScale {
  readonly scaleX: number
  readonly scaleY: number
  readonly offsetX: number
  readonly offsetY: number
}

export function appLineIconScale(size: number): IconScale {
  return { scaleX: size / APP_LINE_ICON_GRID, scaleY: size / APP_LINE_ICON_GRID, offsetX: 0, offsetY: 0 }
}

/** 镜像函数：`x' = 18 − x`（对应 `CGAffineTransform(a: -1, d: 1, tx: 18)`）。 */
function mirrorPoint(x: number): number {
  return APP_LINE_ICON_GRID - x
}

/**
 * 把一条指令按镜像解算成 `IconCommand[]`。
 *
 * 镜像时**圆弧的绕向会反转**，但因为是描边而不是填充，
 * 绕向不影响观感，所以直接用 `18 − x` 逐个坐标翻转即可。
 */
function expandOp(op: IconOp, mirrored: boolean, out: IconCommand[]): void {
  const fx = (x: number): number => (mirrored ? mirrorPoint(x) : x)
  switch (op.op) {
    case 'M':
      out.push({ op: 'M', x: fx(op.x), y: op.y })
      break
    case 'L': {
      for (let i = 0; i < op.points.length; i += 1) {
        const [x, y] = op.points[i]
        out.push({ op: i === 0 ? 'M' : 'L', x: fx(x), y })
      }
      break
    }
    case 'Q':
      out.push({ op: 'Q', cx: fx(op.cx), cy: op.cy, x: fx(op.x), y: op.y })
      break
    case 'C':
      out.push({
        op: 'C',
        c1x: fx(op.c1x),
        c1y: op.c1y,
        c2x: fx(op.c2x),
        c2y: op.c2y,
        x: fx(op.x),
        y: op.y,
      })
      break
    case 'E':
      out.push({ op: 'E', x: fx(op.x), y: op.y, r: op.r })
      break
    case 'O':
      // 椭圆镜像后左边界变成 `18 − x − w`。
      out.push({ op: 'O', x: mirrored ? mirrorPoint(op.x + op.w) : op.x, y: op.y, w: op.w, h: op.h })
      break
    case 'R':
      out.push({ op: 'R', x: mirrored ? mirrorPoint(op.x + op.w) : op.x, y: op.y, w: op.w, h: op.h, r: op.r })
      break
    case 'Z':
      out.push({ op: 'Z' })
      break
    case 'MX':
      for (const inner of op.ops) expandOp(inner, !mirrored, out)
      break
    default:
      break
  }
}

/** 展开一个图标的全部路径指令。 */
export function appLineIconCommands(kind: AppLineIconKind): IconCommand[] {
  const out: IconCommand[] = []
  for (const op of appLineIconOps(kind)) expandOp(op, false, out)
  return out
}

// ---------------------------------------------------------------- 度量

/** 一个矩形。 */
export interface IconBounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
  readonly width: number
  readonly height: number
}

/**
 * 计算包围盒。
 *
 * 用控制点而不是真实曲线极值 —— 贝塞尔的实际极值可能略小于控制点凸包，
 * 所以这个盒子是「不小于真实」的。对图标来说这正好：它给的是
 * 「这个图标至少要占多大地方」，而不是「墨迹的精确外接框」。
 */
export function appLineIconBounds(kind: AppLineIconKind): IconBounds {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const add = (x: number, y: number): void => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const cmd of appLineIconCommands(kind)) {
    switch (cmd.op) {
      case 'M':
      case 'L':
        add(cmd.x, cmd.y)
        break
      case 'Q':
        add(cmd.cx, cmd.cy)
        add(cmd.x, cmd.y)
        break
      case 'C':
        add(cmd.c1x, cmd.c1y)
        add(cmd.c2x, cmd.c2y)
        add(cmd.x, cmd.y)
        break
      case 'E':
        add(cmd.x - cmd.r, cmd.y - cmd.r)
        add(cmd.x + cmd.r, cmd.y + cmd.r)
        break
      case 'O':
      case 'R':
        add(cmd.x, cmd.y)
        add(cmd.x + cmd.w, cmd.y + cmd.h)
        break
      default:
        break
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/** 图标是否完全落在 18×18 网格内（留 `pad` 的余量）。 */
export function appLineIconFitsGrid(kind: AppLineIconKind, pad = 0): boolean {
  const b = appLineIconBounds(kind)
  return b.minX >= -pad && b.minY >= -pad && b.maxX <= APP_LINE_ICON_GRID + pad && b.maxY <= APP_LINE_ICON_GRID + pad
}

/** 图标墨迹的中心点（用来对齐不同图标的视觉重心）。 */
export function appLineIconCenter(kind: AppLineIconKind): { x: number; y: number } {
  const b = appLineIconBounds(kind)
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
}

/**
 * Swift L34-39：一个图标的渲染描述。
 *
 * 描边参数（`lineCap: .round`、`lineJoin: .round`）是这套图标的身份 ——
 * 注释 L3 说的「rounded joins and open silhouettes」就是这两行。
 */
export interface AppLineIconRender {
  readonly kind: AppLineIconKind
  readonly size: number
  readonly strokeWidth: number
  readonly lineCap: 'round'
  readonly lineJoin: 'round'
  readonly commands: readonly IconCommand[]
  readonly bounds: IconBounds
  readonly hiddenFromAX: boolean
}

export function appLineIconRender(kind: AppLineIconKind, size = APP_LINE_ICON_DEFAULT_SIZE): AppLineIconRender {
  return {
    kind,
    size,
    strokeWidth: appLineIconStrokeWidth(size),
    lineCap: 'round',
    lineJoin: 'round',
    commands: appLineIconCommands(kind),
    bounds: appLineIconBounds(kind),
    hiddenFromAX: true,
  }
}

/** 命令种类统计。用于确认某个图标确实被展开成了预期的形状。 */
export function appLineIconCommandSummary(kind: AppLineIconKind): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const cmd of appLineIconCommands(kind)) {
    summary[cmd.op] = (summary[cmd.op] ?? 0) + 1
  }
  return summary
}

/**
 * 镜像成对的图标。
 *
 * 这一组的**指令数必须完全相等** —— 它们是同一份几何沿 x=9 翻转
 * （`redo` / `nextFrame` / `deleteRight`），或者只是端点顺序相反
 * （`chevronLeft` / `chevronUp` / `arrowLeft` / `arrowUpLeft`）。
 * 一旦其中一个被单独改动，这条不变量就会破掉。
 */
export const APP_LINE_ICON_MIRROR_PAIRS: readonly (readonly [AppLineIconKind, AppLineIconKind])[] = [
  ['undo', 'redo'],
  ['previousFrame', 'nextFrame'],
  ['deleteLeft', 'deleteRight'],
  ['chevron', 'chevronLeft'],
  ['chevronDown', 'chevronUp'],
  ['arrowLeft', 'arrowRight'],
  ['arrowUpLeft', 'arrowDownRight'],
] as const

/**
 * 叠加成对的图标：第二个在第一个的基础上「加一笔」。
 *
 * 实测指令数差额并不统一，所以只约束「不小于」：
 *   check   3 → checkCircle 4   （多一个外圈，+1）
 *   eye     4 → eyeOff      6   （多一道斜杠，而斜杠是两点折线 → +2）
 *   speaker 11 → speakerOff 11  （把两段弧换成两条直线，指令数不变）
 *   camera  5 → cameraOff   7   （多一道斜杠，+2）
 *
 * 这就是为什么不能像镜像组那样断言「完全相等」：`speakerOff` 是**替换**，
 * 不是叠加。把它归进「叠加组」只是为了标明两者的血缘关系。
 */
export const APP_LINE_ICON_ADDITIVE_PAIRS: readonly (readonly [AppLineIconKind, AppLineIconKind])[] = [
  ['check', 'checkCircle'],
  ['eye', 'eyeOff'],
  ['speaker', 'speakerOff'],
  ['camera', 'cameraOff'],
] as const
