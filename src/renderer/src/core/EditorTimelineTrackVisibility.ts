/**
 * 时间线轨道显隐 —— 轨道管理器的按钮、空轨道提示、显隐面板。
 *
 * Swift source: Sources/DogSCApp/EditorTimelineTrackVisibility.swift（324 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - struct TimelineTrackManagerLabel                        L3-50  → TIMELINE_TRACK_MANAGER_*
 *   - struct TimelineTrackVisibilityRowButtonStyle            L52-87 → timelineTrackRow*
 *   - timelineEmptyTrackHint（可视宽度兜底、虚线投放槽）        L93-133 → TIMELINE_EMPTY_HINT_*
 *   - timelineTrackManager（按钮 + 弹层 + 帮助）               L135-163 → TIMELINE_TRACK_MANAGER_HELP
 *   - visibleOptionalTrackCount（四条判定）                    L165-172 → timelineVisibleOptionalTrackCount
 *   - timelineTrackVisibilityPanel（标题 + 计徽 + 四行）        L177-230 → TIMELINE_TRACK_PANEL_*
 *   - timelineTrackVisibilityRow（四行各自的色/计数/开关）      L232-285 → timelineTrackVisibilityRow*
 *   - optionalTimelineLabel（四条轨道的图标）                  L287-307 → timelineOptionalTrackSymbol
 *   - setTimelineTrack（先取消手势再开合）                     L309-322 → timelineSetTrackCancelsGesture
 *
 * 原注释（L90-92）：
 *   Empty optional lanes use one quiet instruction instead of appearing as
 *   broken blank space. The hint never owns the click or drag gesture; the
 *   lane remains the sole interaction surface.
 *
 * 原注释（L99-100）：
 *   `0...1` is the bridge's initial sentinel. Give the first frame a
 *   realistic viewport instead of squeezing the hint into one point.
 *
 * 原注释（L117-118）：
 *   A recessed drop slot: the dashed edge reads "place content here" instead
 *   of a dead row, and the fill sits below every lane tint.
 *
 * 原注释（L174-176）：
 *   The track panel in the editor's own grammar: a title, then one tile of
 *   rows, each with its lane colour, a count and a real switch. Space
 *   separates the parts; there are no rules.
 *
 * 迁移说明：`ButtonStyle` / `View` → React 组件。保留的纯逻辑：
 * 轨道计数的四条判定、空轨道提示的可视宽度兜底、三态透明度阶梯、
 * 以及「隐藏只收起编辑区、不停用效果」这套文案。
 */

// ---------------------------------------------------------------- 管理器按钮

/** Swift L6：管理器标签的水平内缩默认值 16。 */
export const TIMELINE_TRACK_MANAGER_INSET = 16

/** Swift L12 / L11：图标 15.5，装在 20 宽的定宽里（对齐下方文字基线）。 */
export const TIMELINE_TRACK_MANAGER_ICON_SIZE = 15.5
export const TIMELINE_TRACK_MANAGER_ICON_FRAME = 20

/** Swift L10：「图标 · 文字 · 折角」三块间距 8。 */
export const TIMELINE_TRACK_MANAGER_SPACING = 8

/** Swift L16-17：标签文字 11 号、「轨道」。 */
export const TIMELINE_TRACK_MANAGER_LABEL_FONT_SIZE = 11
export const TIMELINE_TRACK_MANAGER_LABEL = '轨道'

/** Swift L20-22：折角图标 10.5，装在 24 宽的定宽里（保证展开/收起时宽度不跳）。 */
export const TIMELINE_TRACK_MANAGER_CHEVRON_SIZE = 10.5
export const TIMELINE_TRACK_MANAGER_CHEVRON_FRAME = 24

/** Swift L28：折叠时左右内缩固定 16（不用 layout 值，因为折叠态没有文字）。 */
export const TIMELINE_TRACK_MANAGER_COLLAPSED_INSET = 16

/**
 * Swift L27：整行文字色 —— 悬停或已展开时 0.96，否则 0.74。
 *
 * 两者都不是纯白：编辑器面板底色本身不是纯黑，纯白会让文字「浮」在面板上。
 */
export function timelineTrackManagerAlpha(hovered: boolean, presented: boolean): number {
  return hovered || presented ? 0.96 : 0.74
}

/** Swift L23：折角颜色 —— 悬停或展开时 0.82，否则 0.46。 */
export function timelineTrackManagerChevronAlpha(hovered: boolean, presented: boolean): number {
  return hovered || presented ? 0.82 : 0.46
}

/**
 * Swift L32：三态背景 —— 展开用 `EditorStateWash.open`、悬停 `hover`、常态 0。
 *
 * 展开态的洗色比悬停深，这样「面板开着」这个状态在鼠标移开之后仍然可见。
 */
export function timelineTrackManagerBackgroundAlpha(input: {
  readonly presented: boolean
  readonly hovered: boolean
}): number {
  if (input.presented) return TIMELINE_TRACK_MANAGER_OPEN_WASH
  return input.hovered ? TIMELINE_TRACK_MANAGER_HOVER_WASH : 0
}

/** Swift EditorStateWash：两种洗色的具体值（同批次内其他文件也用同一组）。 */
export const TIMELINE_TRACK_MANAGER_OPEN_WASH = 0.14
export const TIMELINE_TRACK_MANAGER_HOVER_WASH = 0.08

/** Swift L38：三态描边 —— 展开 0.18、悬停 0.11、常态 0。 */
export function timelineTrackManagerBorderAlpha(input: {
  readonly presented: boolean
  readonly hovered: boolean
}): number {
  if (input.presented) return 0.18
  return input.hovered ? 0.11 : 0
}

/** Swift L39：描边宽 0.75（比 1 细，贴合 8 号圆角的紧凑控件）。 */
export const TIMELINE_TRACK_MANAGER_BORDER_WIDTH = 0.75

/** Swift L33 / L36 / L42：圆角取紧凑级（8）。 */
export const TIMELINE_TRACK_MANAGER_CORNER_RADIUS = 8

/** Swift L160-161：帮助与无障碍标签是同一句。 */
export const TIMELINE_TRACK_MANAGER_HELP = '管理动画轨道'

/** Swift L162：无障碍值 —— 「%d 条显示」。 */
export function timelineTrackManagerAccessibilityValue(count: number): string {
  return `${count} 条显示`
}

/** Swift L143：水平内缩按折叠态切换（展开时 regular 12 / compact 6）。 */
export function timelineTrackManagerHorizontalInset(input: {
  readonly collapsed: boolean
  readonly regular: number
  readonly compact: number
}): number {
  return input.collapsed ? TIMELINE_TRACK_MANAGER_COLLAPSED_INSET : input.regular
}

// ---------------------------------------------------------------- 行按钮

/** Swift L64：禁用时整体 0.42。 */
export const TIMELINE_TRACK_ROW_DISABLED_OPACITY = 0.42

/** Swift L67 / L69：圆角取控件级（10）。 */
export const TIMELINE_TRACK_ROW_CORNER_RADIUS = 10

/** Swift L71：按下缩到 0.985（与采集器按钮同幅度）。 */
export function timelineTrackRowScale(pressed: boolean, enabled: boolean): number {
  return pressed && enabled ? 0.985 : 1
}

/**
 * Swift L81-85：三态背景 —— 禁用 0、按下 0.11、悬停 0.065、常态 0。
 *
 * 禁用的判定放在最前：不可用的行即便被系统标成 pressed 也不该有底色。
 */
export function timelineTrackRowBackgroundAlpha(input: {
  readonly enabled: boolean
  readonly pressed: boolean
  readonly hovered: boolean
}): number {
  if (!input.enabled) return 0
  if (input.pressed) return 0.11
  return input.hovered ? 0.065 : 0
}

/** Swift L77-78：按下与可用性变化都挂同一条交互弹簧。 */
export const TIMELINE_TRACK_ROW_ANIMATION = { response: 0.26, dampingFraction: 0.82 } as const

// ---------------------------------------------------------------- 空轨道提示

/**
 * Swift L101-103：可视宽度的兜底。
 *
 * 桥接层首帧会给 `0...1` 这个哨兵区间，此时测量宽度只有 1 点 ——
 * 直接把提示压进 1 点会看不到任何东西。所以「测量值 ≤ 1」时改用
 * `min(max(documentWidth, 1), 1200)`：至少 1 点、最多 1200 点。
 */
export function timelineEmptyHintVisibleWidth(input: {
  readonly measuredWidth: number
  readonly documentWidth: number
}): number {
  if (Number.isFinite(input.measuredWidth) && input.measuredWidth > 1) {
    return input.measuredWidth
  }
  const documentWidth = Number.isFinite(input.documentWidth) ? input.documentWidth : 0
  return Math.min(Math.max(documentWidth, 1), TIMELINE_EMPTY_HINT_MAXIMUM_WIDTH)
}

/** Swift L103：兜底宽度上限 1200。 */
export const TIMELINE_EMPTY_HINT_MAXIMUM_WIDTH = 1200

/** Swift L104：加号与文字间距 7。 */
export const TIMELINE_EMPTY_HINT_SPACING = 7

/** Swift L105-106：加号图标 13.5，字号 11 半粗。 */
export const TIMELINE_EMPTY_HINT_PLUS_SIZE = 13.5
export const TIMELINE_EMPTY_HINT_FONT_SIZE = 12

/** Swift L107 / L111：加号 0.40、文字 0.48。 */
export const TIMELINE_EMPTY_HINT_PLUS_ALPHA = 0.4
export const TIMELINE_EMPTY_HINT_TEXT_ALPHA = 0.48

/** Swift L114-115：左右内边距 13、行高 28。 */
export const TIMELINE_EMPTY_HINT_PADDING = 13
export const TIMELINE_EMPTY_HINT_HEIGHT = 28

/** Swift L119：圆角 14（比行按钮大，因为这是个「槽」而不是「按钮」）。 */
export const TIMELINE_EMPTY_HINT_CORNER_RADIUS = 14

/**
 * Swift L120-124：填充 0.030、虚线描边 0.14 / 宽 1 / `[5, 4]`。
 *
 * 填充只有 0.030 —— 注释（L117-118）说「填充位于所有轨道色之下」，
 * 再深一点就会和轨道本身的色带打架，让人以为这块已经有内容了。
 */
export const TIMELINE_EMPTY_HINT_FILL_ALPHA = 0.03
export const TIMELINE_EMPTY_HINT_BORDER_ALPHA = 0.14
export const TIMELINE_EMPTY_HINT_BORDER_WIDTH = 1
export const TIMELINE_EMPTY_HINT_BORDER_DASH = [5, 4] as const

/** Swift L127：左侧缩进 regular 26 / compact 22（与轨道标签的图标对齐）。 */
export const TIMELINE_EMPTY_HINT_LEADING_REGULAR = 26
export const TIMELINE_EMPTY_HINT_LEADING_COMPACT = 22

/** Swift L127：按布局取左缩进。 */
export function timelineEmptyHintLeading(compact: boolean): number {
  return compact ? TIMELINE_EMPTY_HINT_LEADING_COMPACT : TIMELINE_EMPTY_HINT_LEADING_REGULAR
}

/**
 * Swift L130：提示不接收点击。
 *
 * 注释（L91）说得很明确：提示永远不拥有点击或拖拽手势，轨道本身才是
 * 唯一的交互面。少了这一条，用户在空轨道上按下想拖时间线，会点到提示上。
 */
export function timelineEmptyHintAcceptsHitTesting(): boolean {
  return false
}

/** Swift L129：提示的水平偏移 = 可视区间下界。 */
export function timelineEmptyHintOffsetX(visibleLowerBound: number): number {
  return Number.isFinite(visibleLowerBound) ? visibleLowerBound : 0
}

// ---------------------------------------------------------------- 轨道计数

/** Swift L167-170：四条可选轨道的稳定顺序。 */
export const TIMELINE_OPTIONAL_TRACKS = ['zoom', 'screenMotion', 'cameraMotion', 'overlays'] as const

/** Swift L189：分母固定 4（`visibleOptionalTrackCount / 4`）。 */
export const TIMELINE_OPTIONAL_TRACK_COUNT_MAXIMUM = 4

/**
 * Swift L165-172：可见的可选轨道数。
 *
 * 前三条按「集合里有没有这个轨道」计，第四条 `overlays` 按「与 overlays
 * 集合是否有交集」计 —— 因为叠加是一个轨道组（马赛克 + 贴图），
 * 任一组员可见就算这一条轨道可见。
 */
export function timelineVisibleOptionalTrackCount(input: {
  readonly zoom: boolean
  readonly screenMotion: boolean
  readonly cameraMotion: boolean
  readonly overlays: boolean
}): number {
  let count = 0
  if (input.zoom) count += 1
  if (input.screenMotion) count += 1
  if (input.cameraMotion) count += 1
  if (input.overlays) count += 1
  return count
}

/** Swift L189：计徽文本 `${count} / 4`。 */
export function timelineTrackCountBadgeText(count: number): string {
  const safe = Number.isFinite(count) ? Math.max(Math.trunc(count), 0) : 0
  return `${safe} / ${TIMELINE_OPTIONAL_TRACK_COUNT_MAXIMUM}`
}

/**
 * Swift L241-243：某条轨道当前是否可见。
 *
 * `overlays` 走交集判定，其余走包含判定。写成一个函数是为了让
 * 面板行与 `visibleOptionalTrackCount` 用同一份规则 —— 两处各写一遍
 * 很容易在改叠加组时漏掉一处。
 */
export function timelineTrackIsVisible(
  track: (typeof TIMELINE_OPTIONAL_TRACKS)[number],
  visible: { readonly zoom: boolean; readonly screenMotion: boolean; readonly cameraMotion: boolean; readonly overlays: boolean }
): boolean {
  switch (track) {
    case 'zoom':
      return visible.zoom
    case 'screenMotion':
      return visible.screenMotion
    case 'cameraMotion':
      return visible.cameraMotion
    case 'overlays':
      return visible.overlays
  }
}

/** Swift L245：`%d 个内容`。 */
export function timelineTrackContentCountText(count: number): string {
  const safe = Number.isFinite(count) ? Math.max(Math.trunc(count), 0) : 0
  return `${safe} 个内容`
}

// ---------------------------------------------------------------- 面板

/** Swift L227：面板定宽 300。 */
export const TIMELINE_TRACK_PANEL_WIDTH = 300

/** Swift L226：面板内边距 12。 */
export const TIMELINE_TRACK_PANEL_PADDING = 12

/** Swift L178：标题区与行区之间间距 12。 */
export const TIMELINE_TRACK_PANEL_SECTION_SPACING = 12

/** Swift L180 / L182 / L185：标题 14 半粗、副标题 11。 */
export const TIMELINE_TRACK_PANEL_TITLE_FONT_SIZE = 14
export const TIMELINE_TRACK_PANEL_DETAIL_FONT_SIZE = 11

/** Swift L180：标题栈行距 3。 */
export const TIMELINE_TRACK_PANEL_TITLE_STACK_SPACING = 3

/** Swift L179：标题与计徽间距 10。 */
export const TIMELINE_TRACK_PANEL_HEADER_SPACING = 10

/** Swift L181 / L184：面板的两句文案。 */
export const TIMELINE_TRACK_PANEL_TITLE = '轨道显示'
export const TIMELINE_TRACK_PANEL_DETAIL = '隐藏只收起编辑区，不会停用效果'

/** Swift L194-195：计徽高 24、左右内边距 9、底色 0.06。 */
export const TIMELINE_TRACK_COUNT_BADGE_HEIGHT = 24
export const TIMELINE_TRACK_COUNT_BADGE_PADDING = 9
export const TIMELINE_TRACK_COUNT_BADGE_BACKGROUND_ALPHA = 0.06

/** Swift L221-222：行区是一个 6 内边距的 tile，行间距 2。 */
export const TIMELINE_TRACK_ROW_TILE_PADDING = 6
export const TIMELINE_TRACK_ROW_SPACING = 2

/** Swift L223 / L250：tile 圆角取 tile 级（18），行内图标底板用紧凑级（8）。 */
export const TIMELINE_TRACK_TILE_CORNER_RADIUS = 18
export const TIMELINE_TRACK_ROW_ICON_CORNER_RADIUS = 8

/** Swift L246：行内四块间距 11。 */
export const TIMELINE_TRACK_ROW_INNER_SPACING = 11

/** Swift L248-249：行图标 15，装在 30 见方的底板里。 */
export const TIMELINE_TRACK_ROW_ICON_SIZE = 15
export const TIMELINE_TRACK_ROW_ICON_FRAME = 30

/** Swift L251-252：不可见时去饱和到 0.2、不透明度 0.7。 */
export function timelineTrackRowIconSaturation(visible: boolean): number {
  return visible ? 1 : 0.2
}

export function timelineTrackRowIconOpacity(visible: boolean): number {
  return visible ? 1 : 0.7
}

/** Swift L254-257：行标题 13 中粗、副标题 11，行距 2。 */
export const TIMELINE_TRACK_ROW_TITLE_FONT_SIZE = 13
export const TIMELINE_TRACK_ROW_DETAIL_FONT_SIZE = 11
export const TIMELINE_TRACK_ROW_TEXT_SPACING = 2

/** Swift L280-282：行高 48、左右内边距 8、禁用 0.45。 */
export const TIMELINE_TRACK_ROW_HEIGHT = 48
export const TIMELINE_TRACK_ROW_PADDING = 8
export const TIMELINE_TRACK_ROW_UNAVAILABLE_OPACITY = 0.45

/** Swift L284：可见性变化用 `SpringMotion.settle`。 */
export const TIMELINE_TRACK_ROW_SETTLE_ANIMATION = { response: 0.34, dampingFraction: 0.88 } as const

/** Swift L264：文字块与开关之间至少 6。 */
export const TIMELINE_TRACK_ROW_TOGGLE_SPACER_MIN = 6

/** Swift L258 / L277：不可用时的副标题文案。 */
export const TIMELINE_TRACK_UNAVAILABLE_DETAIL = '当前不可用'

/**
 * Swift L258：副标题 —— 可用时显示内容数，不可用时显示原因。
 *
 * 原因优先于计数：摄像头没有素材时显示「无摄像头素材」比显示「0 个内容」
 * 有用得多，后者会让人以为素材被删了。
 */
export function timelineTrackRowDetailText(input: {
  readonly enabled: boolean
  readonly clipCount: number
  readonly disabledDetail: string | null
}): string {
  if (!input.enabled) return input.disabledDetail ?? TIMELINE_TRACK_UNAVAILABLE_DETAIL
  return timelineTrackContentCountText(input.clipCount)
}

// ---------------------------------------------------------------- 四行

/** Swift L202-220：四行的标题与图标（面板里的正式名称）。 */
export const TIMELINE_TRACK_ROW_DEFINITIONS = [
  { track: 'zoom', title: '缩放', symbol: 'magnifyingglass' },
  { track: 'screenMotion', title: '屏幕 3D', symbol: 'cube.transparent' },
  { track: 'cameraMotion', title: '摄像运动', symbol: 'video' },
  { track: 'overlays', title: '叠加', symbol: 'square.on.square' },
] as const

/** Swift L293-298：轨道标签上的图标（比面板里的多一层语义）。 */
export function timelineOptionalTrackSymbol(track: string): string {
  switch (track) {
    case 'zoom':
      return 'plus.magnifyingglass'
    case 'screenMotion':
      return 'cube.transparent'
    case 'cameraMotion':
      return 'video'
    case 'overlays':
      return 'square.3.layers.3d'
    default:
      return 'square.stack'
  }
}

/** Swift L270：开关的无障碍值。 */
export function timelineTrackVisibilityValueLabel(visible: boolean): string {
  return visible ? '轨道状态 · 显示' : '轨道状态 · 隐藏'
}

/** Swift L269：开关的无障碍标签 `%@轨道`。 */
export function timelineTrackToggleAccessibilityLabel(localizedTitle: string): string {
  return `${localizedTitle}轨道`
}

/**
 * Swift L271-278：开关的悬停提示。
 *
 * 可用时是「隐藏“X”轨道；隐藏不会停用效果」这类双向说明，
 * 不可用时直接给原因 —— 用户在灰掉的开关上悬停，最想知道的就是「为什么不能点」。
 */
export function timelineTrackToggleHelpText(input: {
  readonly enabled: boolean
  readonly visible: boolean
  readonly localizedTitle: string
  readonly disabledDetail: string | null
}): string {
  if (!input.enabled) return input.disabledDetail ?? TIMELINE_TRACK_UNAVAILABLE_DETAIL
  const action = input.visible
    ? `隐藏“${input.localizedTitle}”轨道`
    : `显示“${input.localizedTitle}”轨道`
  return `${action}；隐藏不会停用效果`
}

/**
 * Swift L313-321：切轨道之前先取消进行中的时间线手势。
 *
 * 不取消的话，用户正在拖时间线时点开关，拖动的手势状态会带着旧的
 * 轨道布局继续算，最后一帧会画在一个已经不存在的轨道上。
 */
export function timelineSetTrackCancelsGesture(): boolean {
  return true
}

/** Swift L315：标签与轨道用同一条 `SpringMotion.settle` 一起开合。 */
export const TIMELINE_TRACK_SETTLE_ANIMATION = { response: 0.34, dampingFraction: 0.88 } as const
