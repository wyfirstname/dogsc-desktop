/**
 * 编辑器线性图标目录 —— 把 SF Symbol 名字映射到自绘的 18pt 线网格字形。
 *
 * Swift source: Sources/DogSCApp/EditorSymbol.swift（142 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - enum EditorSymbolCatalog                         L6-93   → EDITOR_SYMBOL_CATALOG / editorSymbolKind
 *   - static func kind(for systemName:)                L7-92   → editorSymbolKind
 *   - struct EditorSymbol                              L97-117 → editorSymbolSize / EDITOR_SYMBOL_SCALE
 *   - static let scale                                 L103    → EDITOR_SYMBOL_SCALE
 *   - init(_:size:)                                    L105-108 → editorSymbolSize
 *   - struct EditorSymbolLabel                         L121-142 → EDITOR_SYMBOL_LABEL_DEFAULT_SIZE
 *
 * 原注释（L3-5）：
 *   The editor draws its own line glyphs (AppLineIcon, the recorder's 18 pt
 *   grid) instead of mixing in system symbols. Call sites keep the familiar
 *   symbol names; a name without a drawn glyph still renders the system one.
 *
 * 迁移说明：`AppLineIcon` 是 macOS 端的手绘 Path，Windows 侧用
 * `<EditorLineIcon kind=… size=…/>`（内联 SVG）承载。本文件只保留「名字 → 字形」
 * 的查表与字号吸附 —— 这两件事有 124 条对应关系，必须逐条可断言。
 */

/**
 * 自绘字形的全部种类 —— 即 `AppLineIcon.Kind` 枚举（AppLineIcon.swift L6-20，共 93 个）。
 * 编辑器目录只用到其中 77 个；其余（record / shield / bell / pause / fit / share …）
 * 属于录制器与设置页，等 AppLineIcon.swift 自己那批迁移时再补绘制。
 */
export type AppLineIconKind =
  | 'settings'
  | 'sliders'
  | 'record'
  | 'shield'
  | 'info'
  | 'appearance'
  | 'sun'
  | 'moon'
  | 'globe'
  | 'shapeCircle'
  | 'shapeRounded'
  | 'shapeWide'
  | 'bell'
  | 'speaker'
  | 'box'
  | 'download'
  | 'sparkle'
  | 'display'
  | 'window'
  | 'microphone'
  | 'cursor'
  | 'camera'
  | 'folder'
  | 'check'
  | 'checkCircle'
  | 'warning'
  | 'refresh'
  | 'code'
  | 'feedback'
  | 'cup'
  | 'external'
  | 'chevron'
  | 'person'
  | 'close'
  | 'arrowLeft'
  | 'scene'
  | 'opening'
  | 'zoom'
  | 'cursorMotion'
  | 'undo'
  | 'redo'
  | 'plus'
  | 'trash'
  | 'pencil'
  | 'share'
  | 'chevronDown'
  | 'layers'
  | 'play'
  | 'pause'
  | 'stop'
  | 'previousFrame'
  | 'nextFrame'
  | 'scissors'
  | 'minus'
  | 'waveform'
  | 'eye'
  | 'eyeOff'
  | 'fit'
  | 'grid'
  | 'crop'
  | 'layout'
  | 'film'
  | 'magnet'
  | 'clock'
  | 'cube'
  | 'link'
  | 'photoAdd'
  | 'paste'
  | 'expand'
  | 'aspect'
  | 'target'
  | 'move'
  | 'pin'
  | 'speed'
  | 'drop'
  | 'halfCircle'
  | 'bookmark'
  | 'swap'
  | 'speakerOff'
  | 'cameraOff'
  | 'search'
  | 'noSymbol'
  | 'chevronLeft'
  | 'chevronUp'
  | 'noFrame'
  | 'portrait'
  | 'arrowRight'
  | 'arrowUpLeft'
  | 'arrowDownRight'
  | 'deleteLeft'
  | 'deleteRight'
  | 'list'
  | 'presets'

/** 兼容短名：本文件的查表结果用的就是这套种类。 */
export type EditorLineIconKind = AppLineIconKind

/**
 * Swift L103：编辑器只在这五档字号上取字形。
 *   12 = 行内/角标，14 = 行与按钮，16 = 工具栏/磁贴，18 = 大磁贴，20 = 空状态
 */
export const EDITOR_SYMBOL_SCALE: readonly number[] = [12, 14, 16, 18, 20]

/** Swift L126 / L133：`EditorSymbolLabel` 的默认字号。 */
export const EDITOR_SYMBOL_LABEL_DEFAULT_SIZE = 14

/** Swift L7-92 的完整查表。键是 SF Symbol 名，值是自绘字形。 */
export const EDITOR_SYMBOL_CATALOG: Readonly<Record<string, AppLineIconKind>> = {
  'arrow.uturn.backward': 'undo',
  'arrow.uturn.left': 'undo',
  'arrow.uturn.forward': 'redo',
  'arrow.uturn.right': 'redo',
  gearshape: 'settings',
  'gearshape.fill': 'settings',
  plus: 'plus',
  'plus.circle': 'plus',
  'plus.circle.fill': 'plus',
  minus: 'minus',
  'minus.circle': 'minus',
  'slider.horizontal.3': 'sliders',
  'moon.stars.fill': 'moon',
  'moon.fill': 'moon',
  'sun.max.fill': 'sun',
  'sun.max': 'sun',
  trash: 'trash',
  'trash.fill': 'trash',
  folder: 'folder',
  'square.3.layers.3d': 'layers',
  'square.stack.3d.up': 'layers',
  'square.stack': 'layers',
  'rectangle.stack': 'layers',
  'rectangle.inset.filled': 'layout',
  'square.on.square': 'layout',
  'rectangle.on.rectangle': 'layout',
  macwindow: 'window',
  photo: 'scene',
  'photo.on.rectangle.angled': 'scene',
  grid: 'grid',
  waveform: 'waveform',
  'waveform.path': 'waveform',
  'waveform.path.ecg': 'waveform',
  'waveform.path.ecg.rectangle': 'waveform',
  film: 'film',
  'film.stack': 'film',
  'film.stack.fill': 'film',
  'timeline.selection': 'film',
  crop: 'crop',
  scissors: 'scissors',
  viewfinder: 'zoom',
  scope: 'target',
  'sparkles.rectangle.stack': 'opening',
  sparkles: 'sparkle',
  sparkle: 'sparkle',
  'speaker.wave.2': 'speaker',
  'speaker.wave.2.fill': 'speaker',
  'speaker.slash': 'speakerOff',
  'speaker.slash.fill': 'speakerOff',
  mic: 'microphone',
  'mic.fill': 'microphone',
  video: 'camera',
  'video.fill': 'camera',
  'video.badge.ellipsis': 'camera',
  'video.slash': 'cameraOff',
  'video.slash.fill': 'cameraOff',
  display: 'display',
  pencil: 'pencil',
  magnet: 'magnet',
  eye: 'eye',
  'eye.fill': 'eye',
  'eye.slash': 'eyeOff',
  'eye.slash.fill': 'eyeOff',
  clock: 'clock',
  'clock.badge.checkmark': 'clock',
  cube: 'cube',
  'cube.transparent': 'cube',
  'move.3d': 'cube',
  link: 'link',
  'link.badge.plus': 'link',
  'photo.badge.plus': 'photoAdd',
  'doc.on.clipboard': 'paste',
  'arrow.up.left.and.arrow.down.right': 'expand',
  aspectratio: 'aspect',
  'hand.draw': 'move',
  'arrow.triangle.2.circlepath': 'refresh',
  'arrow.clockwise': 'refresh',
  'arrow.counterclockwise': 'refresh',
  'rotate.right': 'refresh',
  'mappin.and.ellipse': 'pin',
  speedometer: 'speed',
  'drop.halffull': 'drop',
  'circle.lefthalf.filled': 'halfCircle',
  bookmark: 'bookmark',
  'bookmark.fill': 'bookmark',
  'arrow.left.and.right': 'swap',
  magnifyingglass: 'search',
  'plus.magnifyingglass': 'search',
  'slash.circle': 'noSymbol',
  'chevron.left': 'chevronLeft',
  'chevron.up': 'chevronUp',
  'chevron.right': 'chevron',
  'chevron.down': 'chevronDown',
  xmark: 'close',
  checkmark: 'check',
  'checkmark.circle': 'checkCircle',
  'checkmark.circle.fill': 'checkCircle',
  'exclamationmark.triangle': 'warning',
  'exclamationmark.triangle.fill': 'warning',
  info: 'info',
  'info.circle': 'info',
  'play.fill': 'play',
  play: 'play',
  'rectangle.slash': 'noFrame',
  rectangle: 'shapeWide',
  'rectangle.fill': 'shapeWide',
  'rectangle.portrait': 'portrait',
  'arrow.left': 'arrowLeft',
  'arrow.right': 'arrowRight',
  'square.and.arrow.down': 'download',
  'cursorarrow.motionlines': 'cursorMotion',
  cursorarrow: 'cursor',
  person: 'person',
  'person.fill': 'person',
  'arrow.up.left': 'arrowUpLeft',
  'arrow.down.right': 'arrowDownRight',
  'delete.left': 'deleteLeft',
  'delete.right': 'deleteRight',
  'list.number': 'list',
  'list.bullet': 'list',
  'rectangle.3.group': 'presets',
  circle: 'shapeCircle',
  square: 'shapeRounded',
  'square.fill': 'shapeRounded',
}

/*
 * Swift L88-90：
 *   // Layer order keeps the system glyphs: their front/back distinction
 *   // has no drawn equivalent yet.
 *   default: nil
 *
 * 「图层顺序」类符号（square.N.layers.3d / square.N.stack.3d 系列）刻意**不进表**：
 * 它们靠前后遮挡表达层级，线网格画不出这个区别。这些名字落到 default，退回系统符号。
 * 表中未出现的一切名字都走这条路径 —— 这是设计的退路，不是缺漏。
 */

/** Swift L7-92：查表。没有自绘版本的返回 null（调用方退回系统符号）。 */
export function editorSymbolKind(systemName: string): AppLineIconKind | null {
  return EDITOR_SYMBOL_CATALOG[systemName] ?? null
}

/**
 * Swift L105-108：
 *   self.size = Self.scale.min { abs($0 - size) < abs($1 - size) } ?? size
 *
 * `min(by:)` 用**严格小于**比较，并列时保留先出现的元素 —— 也就是更小的那一档。
 * 所以 13 → 12（不是 14），19 → 18（不是 20）。
 * 空表时回退原值（Swift 的 `?? size`）。
 */
export function editorSymbolSize(size: number): number {
  if (!Number.isFinite(size)) return EDITOR_SYMBOL_LABEL_DEFAULT_SIZE
  let best: number | null = null
  for (const candidate of EDITOR_SYMBOL_SCALE) {
    if (best === null) {
      best = candidate
      continue
    }
    if (Math.abs(candidate - size) < Math.abs(best - size)) best = candidate
  }
  return best ?? size
}

/** 一组符号名到字形的批量映射（供导出/快照断言用）。 */
export function editorSymbolKinds(systemNames: readonly string[]): (AppLineIconKind | null)[] {
  return systemNames.map(editorSymbolKind)
}
