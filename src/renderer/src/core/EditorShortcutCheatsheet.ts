/**
 * Swift source: Sources/DogSCApp/EditorShortcutCheatsheet.swift（126 行）@ 567fd6e
 *
 * L22-57  → 四组快捷键表（播放与浏览 / 剪辑 / 运镜与轨道 / 通用）
 * L59-65  → keyColumnWidth：等宽 11pt 量宽，最小 96，留 16pt 余量
 * L67-125 → 面板尺寸 344 + keyColumn × 480
 *
 * 原注释：这些条目以前散落在 tooltip 与右键菜单里，能不能发现全看有没有恰好
 * 悬停在那个控件上。现在由一张静态表统一持有 —— 快捷键一改，这张表同一次提交里改。
 *
 * 这张表是**唯一的真相来源**，UI 载体由 React 渲染。
 */

export interface EditorShortcutEntry {
  readonly keys: string
  readonly action: string
}

export interface EditorShortcutGroup {
  readonly title: string
  readonly entries: readonly EditorShortcutEntry[]
}

export const EDITOR_SHORTCUT_GROUPS: readonly EditorShortcutGroup[] = [
  {
    title: '播放与浏览',
    entries: [
      { keys: '空格', action: '播放 / 暂停' },
      { keys: '← / →', action: '向前 / 向后移动 1 帧' },
      { keys: 'Shift + ← / →', action: '向前 / 向后移动 5 帧' },
      { keys: '悬停时间线', action: '预览所指帧，不移动播放头' },
      { keys: '拖动总览条', action: '快速定位播放头与可视范围' },
      { keys: '滚轮 / 捏合', action: '以指针为锚缩放时间线' },
    ],
  },
  {
    title: '剪辑',
    entries: [
      { keys: 'S', action: '在播放头分割选中动画；未选动画时分割主片段' },
      { keys: 'Q', action: '修剪动画起点；未选动画时波纹删除前段' },
      { keys: 'W', action: '修剪动画终点；未选动画时波纹删除后段' },
      { keys: 'D / Delete', action: '删除当前选中项' },
      { keys: '⇧ / ⌘ 点击主片段', action: '连续选择 / 增减选择主片段' },
      { keys: '⌥ 点击主片段', action: '在点击处直接切分' },
      { keys: '悬停剪切缝', action: '合并或还原该处剪切' },
    ],
  },
  {
    title: '运镜与轨道',
    entries: [
      { keys: '⌘C / ⌘V', action: '复制效果片段 / 在鼠标所指位置粘贴副本' },
      { keys: '⌘⇧V', action: '向选中的同类组件粘贴属性，保留位置与时长' },
      { keys: '拖动缩放轨空白', action: '创建缩放片段' },
      { keys: '拖动运动轨空白', action: '创建屏幕 3D / 摄像运动' },
      { keys: '双击同步轨空白', action: '添加摄像头同步点' },
      { keys: '双击分栏柄', action: '恢复时间线默认高度' },
    ],
  },
  {
    title: '通用',
    entries: [
      { keys: '⌘Z', action: '撤销' },
      { keys: '⌘⇧Z', action: '重做' },
      { keys: '⌘O', action: '打开项目' },
      { keys: '⌘E', action: '导出成片' },
      { keys: '⌥X', action: '导出选中的主片段范围' },
      { keys: '⌥⌘I', action: '显示 / 隐藏检查器' },
      { keys: 'Esc', action: '取消裁切 / 中止时间线拖动' },
    ],
  },
]

/** 快捷键列的最小宽度与余量（Swift L59-65）。 */
export const SHORTCUT_KEY_COLUMN_MINIMUM = 96
export const SHORTCUT_KEY_COLUMN_PADDING = 16
export const SHORTCUT_KEY_FONT_SIZE = 11

/** 面板尺寸（Swift L121）：解释列固定 344，高度 480。 */
export const SHORTCUT_PANEL_EXPLANATION_WIDTH = 344
export const SHORTCUT_PANEL_HEIGHT = 480

/** 内容内边距与组间距。 */
export const SHORTCUT_PANEL_PADDING = 18
export const SHORTCUT_GROUP_SPACING = 16
export const SHORTCUT_ENTRY_GAP = 10

/** 键帽样式：圆角 6、内边距 8/4、0.75pt 描边（不透明度 0.12）。 */
export const SHORTCUT_KEYCAP = {
  cornerRadius: 6,
  horizontalPadding: 8,
  verticalPadding: 4,
  strokeWidth: 0.75,
  strokeOpacity: 0.12,
  fontSize: 11,
} as const

export const SHORTCUT_PANEL_TEXT = {
  title: '快捷键速查',
  close: '关闭',
  closeAccessibility: '关闭快捷键速查',
} as const

/**
 * 键位列宽（Swift L59-64）：所有键位文本按**等宽 11pt** 量宽取最大，再加 16pt
 * 余量，下限 96。这样切换语言后长手势（如 `Shift + ← / →`）不会挤掉解释列。
 *
 * `measure` 注入测量函数（Swift 用 NSString.size(withAttributes:)；Windows 侧
 * 由渲染层用 canvas.measureText 提供），保证本函数纯净可断言。
 */
export function shortcutKeyColumnWidth(
  measure: (text: string) => number,
  groups: readonly EditorShortcutGroup[] = EDITOR_SHORTCUT_GROUPS
): number {
  const widest = groups
    .flatMap((group) => group.entries)
    .reduce((max, entry) => Math.max(max, measure(entry.keys)), 0)
  return Math.ceil(Math.max(SHORTCUT_KEY_COLUMN_MINIMUM, widest + SHORTCUT_KEY_COLUMN_PADDING))
}

/** 面板总宽（Swift L121 `344 + keyColumnWidth`）。 */
export function shortcutPanelWidth(keyColumnWidth: number): number {
  return SHORTCUT_PANEL_EXPLANATION_WIDTH + keyColumnWidth
}

/** 条目总数（供测试断言表格没被误删）。 */
export function shortcutEntryCount(groups: readonly EditorShortcutGroup[] = EDITOR_SHORTCUT_GROUPS): number {
  return groups.reduce((sum, group) => sum + group.entries.length, 0)
}
