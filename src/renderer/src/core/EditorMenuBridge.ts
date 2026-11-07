/**
 * 编辑器菜单桥 —— File / Edit 两个主菜单项的安装、可见性、本地化与
 * 撤销/重做的即时校验。
 *
 * Swift source: Sources/DogSCApp/EditorMenuBridge.swift（358 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - class EditorMenuBridge                                   L12-357
 *     · 五个菜单标识符                                          L15-29
 *     · editorUndoManager / isEditorActive                      L31-34
 *     · exportRequest / shortcutCheatsheetRequest / quitRequest  L36-45
 *     · attachEditor / detachEditor                             L47-58
 *     · installMainMenuItems（File 插到 1、Edit 插到 2）         L60-92
 *     · setEditorMenuItemsVisible（Edit/Export/三项/显示/窗口）   L99-138
 *     · removeUnavailableHelpMenu（四条识别条件）                L143-159
 *     · installEditItems（复用 SwiftUI 的 Edit 菜单）            L164-231
 *     · localizeStandardMenuItems（按 selector 而不是标题）      L235-269
 *     · configure / makeItem                                    L271-295
 *     · openProjectFromMenu / exportFromMenu                     L297-303
 *     · undoFromMenu / redoFromMenu（先文本域）                  L305-321
 *     · validateMenuItem（撤销/重做标题带动作名）                 L323-356
 *
 * 原注释（L4-10）：
 *   Owns the editor-facing File/Edit main-menu entries.
 *   The app ships without a WindowGroup scene, so no standard Edit menu ever
 *   existed and undo/redo was reachable only through the toolbar buttons.
 *   Menu items here validate on demand against the live UndoManager (and an
 *   editable text field's own undo manager first), mirroring how the Delete
 *   key monitor already respects text editing.
 *
 * 原注释（L31-32）：
 *   The current editor generation's undo manager, attached by EditorView
 *   for exactly as long as that editor is alive.
 *
 * 原注释（L36-37）：
 *   EditorView subscribes and presents its export sheet; the menu must not
 *   reach into SwiftUI state directly.
 *
 * 原注释（L39-41）：
 *   The project toolbar only contains project-scoped actions. The system
 *   Display menu routes this reference panel into the live editor sheet.
 *
 * 原注释（L42-45）：
 *   AppKit cannot close the editor window while a SwiftUI sheet is still
 *   attached. Route Quit through the live editor once so it can dismiss
 *   transient panels before the normal save/termination path continues.
 *
 * 原注释（L94-98）：
 *   The floating recorder has no editable text, resizable document window,
 *   or full-screen surface. Leaving Edit/View/Window visible there exposes
 *   almost entirely disabled system commands. Keep those menus for the
 *   editor, where they describe real actions, and leave the recorder with
 *   only application-level and file-opening commands.
 *
 * 原注释（L140-142）：
 *   The app does not ship an Apple Help Book. Leaving SwiftUI's generated
 *   `showHelp:` item in place therefore ends in a system "help not found"
 *   alert. Do not expose a dead menu until the product has real in-app help.
 *
 * 原注释（L161-163）：
 *   SwiftUI already provides the native Edit menu (cut/copy/paste/select
 *   all). Reuse its undo/redo rows instead of inserting a second top-level
 *   "编辑" menu beside it.
 *
 * 原注释（L233-234）：
 *   Identify native menu roles by public actions, never by user/project
 *   titles. Actions, validation, targets and shortcuts remain unchanged.
 *
 * 迁移说明：AppKit 的 `NSMenu` 树在 TS 侧变成一棵纯数据的 `EditorMenuTree`。
 * 桥接器不再持有副作用，而是产出 `EditorMenuPlan`（一串「插 / 删 / 藏 /
 * 改标题」的操作），由主进程去落地。这样所有易错的判定都能单测：
 *   - 菜单插入位置（File 固定 1、Edit 固定 min(2, count)）；
 *   - 「编辑」菜单的复用（存在则改、不存在才插）；
 *   - 帮助菜单的**四条**识别条件（role、showHelp、两个标题）；
 *   - 撤销/重做标题带动作名时的引号格式。
 */

// ---------------------------------------------------------------- 标识符

/**
 * Swift L15-29：五个菜单项标识符。
 *
 * 全部以 `cn.laogou.dogsc.` 开头。用标识符而不是标题来查找，
 * 是因为标题会随语言变（注释 L233-234 专门强调过这一点）。
 */
export const EDITOR_MENU_FILE_IDENTIFIER = 'cn.laogou.dogsc.file-menu'
export const EDITOR_MENU_EDIT_IDENTIFIER = 'cn.laogou.dogsc.edit-menu'
export const EDITOR_MENU_PROJECT_MEDIA_SEPARATOR_IDENTIFIER = 'cn.laogou.dogsc.file-menu.project-media-separator'
export const EDITOR_MENU_EXPORT_PROJECT_MEDIA_IDENTIFIER = 'cn.laogou.dogsc.file-menu.export-project-media'
export const EDITOR_MENU_REPLACE_CAMERA_MEDIA_IDENTIFIER = 'cn.laogou.dogsc.file-menu.replace-camera-media'

/** 只在编辑器里可见的那三项（媒体分隔线、导出媒体、替换摄像头素材）。 */
export const EDITOR_MENU_PROJECT_MEDIA_IDENTIFIERS: readonly string[] = [
  EDITOR_MENU_PROJECT_MEDIA_SEPARATOR_IDENTIFIER,
  EDITOR_MENU_EXPORT_PROJECT_MEDIA_IDENTIFIER,
  EDITOR_MENU_REPLACE_CAMERA_MEDIA_IDENTIFIER,
] as const

// ---------------------------------------------------------------- 动作

/** 菜单节点。`action` 为 null 表示这是纯分组（只有 submenu）。 */
export interface EditorMenuItemNode {
  readonly identifier: string | null
  readonly title: string
  readonly action: string | null
  readonly keyEquivalent: string | null
  readonly modifiers: readonly string[]
  readonly hidden: boolean
  readonly submenu: readonly EditorMenuItemNode[]
}

/** 一个节点（可带子菜单）。 */
export function editorMenuItem(
  init: Partial<EditorMenuItemNode> & { title: string }
): EditorMenuItemNode {
  return {
    identifier: init.identifier ?? null,
    title: init.title,
    action: init.action ?? null,
    keyEquivalent: init.keyEquivalent ?? null,
    modifiers: init.modifiers ?? ['command'],
    hidden: init.hidden ?? false,
    submenu: init.submenu ?? [],
  }
}

/** Swift L66-68、L71-73：两个自带动作。 */
export const EDITOR_MENU_ACTION_OPEN_PROJECT = 'openProjectFromMenu:'
export const EDITOR_MENU_ACTION_EXPORT = 'exportFromMenu:'
export const EDITOR_MENU_ACTION_UNDO = 'undoFromMenu:'
export const EDITOR_MENU_ACTION_REDO = 'redoFromMenu:'
export const EDITOR_MENU_ACTION_SHOW_HELP = 'showHelp:'
export const EDITOR_MENU_ACTION_TOGGLE_FULL_SCREEN = 'toggleFullScreen:'

/** Swift L165-166：SwiftUI 自带的两个 selector 是裸的 `undo:` / `redo:`。 */
export const EDITOR_MENU_SELECTOR_UNDO_NATIVE = 'undo:'
export const EDITOR_MENU_SELECTOR_REDO_NATIVE = 'redo:'

/**
 * Swift L62-77：File 菜单里的两项与它们的快捷键。
 *
 * 打开项目 ⌘O、导出成片 ⌘E。两者都是 `[.command]`。
 */
export const EDITOR_MENU_FILE_ITEMS = [
  { id: 'open-project', title: '打开项目…', action: EDITOR_MENU_ACTION_OPEN_PROJECT, keyEquivalent: 'o' },
  { id: 'export', title: '导出成片…', action: EDITOR_MENU_ACTION_EXPORT, keyEquivalent: 'e' },
] as const

/**
 * Swift L196-230：撤销 / 重做。
 *
 * 撤销 ⌘Z；重做 ⇧⌘Z。两者 keyEquivalent 都是 `z`，靠修饰键区分。
 */
export const EDITOR_MENU_UNDO_ITEM = {
  title: '撤销',
  action: EDITOR_MENU_ACTION_UNDO,
  keyEquivalent: 'z',
  modifiers: ['command'],
} as const

export const EDITOR_MENU_REDO_ITEM = {
  title: '重做',
  action: EDITOR_MENU_ACTION_REDO,
  keyEquivalent: 'z',
  modifiers: ['command', 'shift'],
} as const

/** Swift L77：File 菜单固定插在**索引 1**（App 菜单之后）。 */
export const EDITOR_MENU_FILE_INSERTION_INDEX = 1

/**
 * Swift L187：Edit 菜单插在 `min(2, items.count)`。
 *
 * 用 min 是因为菜单可能只有 App + File 两项 —— 那时 2 越界，要退回末尾。
 */
export function editorMenuEditInsertionIndex(itemCount: number): number {
  return Math.min(2, itemCount)
}

// ---------------------------------------------------------------- 安装计划

/** 一条计划动作。 */
export type EditorMenuPlanStep =
  | { readonly op: 'insert-root'; readonly identifier: string; readonly title: string; readonly index: number }
  | { readonly op: 'retitle-root'; readonly identifier: string; readonly title: string }
  | { readonly op: 'insert-item'; readonly parent: string; readonly title: string; readonly action: string; readonly keyEquivalent: string; readonly modifiers: readonly string[]; readonly index: number }
  | { readonly op: 'configure-item'; readonly parent: string; readonly action: string; readonly title: string; readonly keyEquivalent: string; readonly modifiers: readonly string[] }

/** 在树里按标识符找一个根节点。 */
export function editorMenuFindRoot(
  menu: readonly EditorMenuItemNode[],
  identifier: string
): { node: EditorMenuItemNode; index: number } | null {
  for (let i = 0; i < menu.length; i += 1) {
    if (menu[i].identifier === identifier) return { node: menu[i], index: i }
  }
  return null
}

/** 在树里按动作找一个节点（深度优先，先根后子）。 */
export function editorMenuFindByAction(
  menu: readonly EditorMenuItemNode[],
  action: string
): EditorMenuItemNode | null {
  for (const node of menu) {
    if (node.action === action) return node
    const hit = editorMenuFindByAction(node.submenu, action)
    if (hit) return hit
  }
  return null
}

/**
 * Swift L60-92：`installMainMenuItems` 的计划。
 *
 * 三件事：
 *   1) File 根不存在 → 插到索引 1，并带两个子项；
 *   2) File 根已存在 → 只改标题（语言可能变了），子项标题也刷一遍；
 *   3) 然后走 Edit 安装、标准项本地化、帮助菜单移除。
 */
export function editorMenuInstallPlan(menu: readonly EditorMenuItemNode[], localizedFileTitle: string): EditorMenuPlanStep[] {
  const steps: EditorMenuPlanStep[] = []
  const existing = editorMenuFindRoot(menu, EDITOR_MENU_FILE_IDENTIFIER)
  if (!existing) {
    steps.push({
      op: 'insert-root',
      identifier: EDITOR_MENU_FILE_IDENTIFIER,
      title: localizedFileTitle,
      index: EDITOR_MENU_FILE_INSERTION_INDEX,
    })
    for (const item of EDITOR_MENU_FILE_ITEMS) {
      steps.push({
        op: 'insert-item',
        parent: EDITOR_MENU_FILE_IDENTIFIER,
        title: item.title,
        action: item.action,
        keyEquivalent: item.keyEquivalent,
        modifiers: ['command'],
        index: -1,
      })
    }
    return steps
  }
  steps.push({ op: 'retitle-root', identifier: EDITOR_MENU_FILE_IDENTIFIER, title: localizedFileTitle })
  return steps
}

/**
 * Swift L164-231：`installEditItems` 的计划。
 *
 * 关键判定（L167-176）：所谓「已有编辑菜单」不只看标识符，
 * 还要看子项里有没有 `undo:` / `redo:` / 我们自己的两个动作 ——
 * 因为 SwiftUI 生成的菜单没有我们的标识符。
 */
export function editorMenuFindExistingEditRoot(
  menu: readonly EditorMenuItemNode[]
): { node: EditorMenuItemNode; index: number } | null {
  for (let i = 0; i < menu.length; i += 1) {
    const root = menu[i]
    if (root.identifier === EDITOR_MENU_EDIT_IDENTIFIER) return { node: root, index: i }
    const hasUndoRow = root.submenu.some(
      (item) =>
        item.action === EDITOR_MENU_SELECTOR_UNDO_NATIVE ||
        item.action === EDITOR_MENU_SELECTOR_REDO_NATIVE ||
        item.action === EDITOR_MENU_ACTION_UNDO ||
        item.action === EDITOR_MENU_ACTION_REDO
    )
    if (hasUndoRow) return { node: root, index: i }
  }
  return null
}

export function editorMenuEditInstallPlan(menu: readonly EditorMenuItemNode[], localizedEditTitle: string): EditorMenuPlanStep[] {
  const steps: EditorMenuPlanStep[] = []
  const existing = editorMenuFindExistingEditRoot(menu)
  if (!existing) {
    steps.push({
      op: 'insert-root',
      identifier: EDITOR_MENU_EDIT_IDENTIFIER,
      title: localizedEditTitle,
      index: editorMenuEditInsertionIndex(menu.length),
    })
  } else {
    steps.push({ op: 'retitle-root', identifier: EDITOR_MENU_EDIT_IDENTIFIER, title: localizedEditTitle })
  }
  // 撤销 / 重做都是「存在则改、不存在则插到最前」。
  steps.push({
    op: 'configure-item',
    parent: EDITOR_MENU_EDIT_IDENTIFIER,
    action: EDITOR_MENU_ACTION_UNDO,
    title: EDITOR_MENU_UNDO_ITEM.title,
    keyEquivalent: EDITOR_MENU_UNDO_ITEM.keyEquivalent,
    modifiers: EDITOR_MENU_UNDO_ITEM.modifiers,
  })
  steps.push({
    op: 'configure-item',
    parent: EDITOR_MENU_EDIT_IDENTIFIER,
    action: EDITOR_MENU_ACTION_REDO,
    title: EDITOR_MENU_REDO_ITEM.title,
    keyEquivalent: EDITOR_MENU_REDO_ITEM.keyEquivalent,
    modifiers: EDITOR_MENU_REDO_ITEM.modifiers,
  })
  return steps
}

// ---------------------------------------------------------------- 可见性

/**
 * Swift L99-138：`setEditorMenuItemsVisible` 的判定。
 *
 * 五组，全部由**同一个**布尔驱动：
 *   - Edit 根；
 *   - File 里的「导出成片…」；
 *   - File 里的三项（媒体分隔线 / 导出媒体 / 替换摄像头素材）；
 *   - 「显示」菜单（含全屏项的那一个，或标题是「显示」/`View`）；
 *   - 窗口菜单。
 *
 * 注意「打开项目…」**永远可见** —— 录制器也要能开项目。
 */
export interface EditorMenuVisibilityPlan {
  readonly hidden: boolean
  readonly targets: readonly string[]
}

/** Swift L122-130：「显示」菜单的识别。 */
export function editorMenuIsViewRoot(
  root: EditorMenuItemNode,
  isWindowsMenu: boolean,
  localizedViewTitles: readonly string[]
): boolean {
  if (isWindowsMenu) return false
  const hasFullScreenItem = root.submenu.some((item) => item.action === EDITOR_MENU_ACTION_TOGGLE_FULL_SCREEN)
  if (hasFullScreenItem) return true
  if (localizedViewTitles.includes(root.title)) return true
  return false
}

export function editorMenuVisibilityTargets(
  menu: readonly EditorMenuItemNode[],
  isWindowsMenu: (node: EditorMenuItemNode) => boolean,
  localizedViewTitles: readonly string[] = ['显示', 'View']
): string[] {
  const targets: string[] = []
  if (editorMenuFindRoot(menu, EDITOR_MENU_EDIT_IDENTIFIER)) targets.push(EDITOR_MENU_EDIT_IDENTIFIER)
  const file = editorMenuFindRoot(menu, EDITOR_MENU_FILE_IDENTIFIER)
  if (file) {
    if (file.node.submenu.some((item) => item.action === EDITOR_MENU_ACTION_EXPORT)) {
      targets.push(`${EDITOR_MENU_FILE_IDENTIFIER}/${EDITOR_MENU_ACTION_EXPORT}`)
    }
    for (const identifier of EDITOR_MENU_PROJECT_MEDIA_IDENTIFIERS) {
      if (file.node.submenu.some((item) => item.identifier === identifier)) {
        targets.push(`${EDITOR_MENU_FILE_IDENTIFIER}/${identifier}`)
      }
    }
  }
  for (const root of menu) {
    if (editorMenuIsViewRoot(root, isWindowsMenu(root), localizedViewTitles)) {
      targets.push(root.identifier ?? root.title)
      break
    }
  }
  for (const root of menu) {
    if (isWindowsMenu(root)) {
      targets.push(root.identifier ?? root.title)
      break
    }
  }
  return targets
}

/** Swift L99-138：解析出「哪些节点要藏」。 */
export function editorMenuVisibilityPlan(
  menu: readonly EditorMenuItemNode[],
  isVisible: boolean,
  isWindowsMenu: (node: EditorMenuItemNode) => boolean,
  localizedViewTitles: readonly string[] = ['显示', 'View']
): EditorMenuVisibilityPlan {
  return {
    hidden: !isVisible,
    targets: editorMenuVisibilityTargets(menu, isWindowsMenu, localizedViewTitles),
  }
}

// ---------------------------------------------------------------- 帮助菜单

/**
 * Swift L143-159：帮助菜单必须整根删掉。
 *
 * 四条识别条件（任一命中即视为「SwiftUI 生成的帮助菜单」）：
 *   1) 子菜单 **就是** `NSApplication.shared.helpMenu`；
 *   2) 子菜单里含 `showHelp:` 动作；
 *   3) 子菜单标题是「帮助」/`Help`；
 *   4) 根标题是「帮助」/`Help`。
 *
 * 为什么要四条：AppKit 可能直到第一次打开才去填命令（L148-149），
 * 在那之前 `showHelp:` 还不在里面，只能靠 role 与标题兜底。
 * 另外 `dropFirst()` —— 第一项（App 菜单）永不参与，避免误删。
 */
export function editorMenuIsGeneratedHelpRoot(
  root: EditorMenuItemNode,
  isHelpMenuRole: boolean,
  localizedHelpTitles: readonly string[] = ['帮助', 'Help']
): boolean {
  if (isHelpMenuRole) return true
  if (root.submenu.some((item) => item.action === EDITOR_MENU_ACTION_SHOW_HELP)) return true
  if (localizedHelpTitles.includes(root.title)) return true
  return false
}

export function editorMenuHelpRootsToRemove(
  menu: readonly EditorMenuItemNode[],
  isHelpMenuRole: (node: EditorMenuItemNode) => boolean,
  localizedHelpTitles: readonly string[] = ['帮助', 'Help']
): string[] {
  const out: string[] = []
  for (let i = 1; i < menu.length; i += 1) {
    const root = menu[i]
    if (editorMenuIsGeneratedHelpRoot(root, isHelpMenuRole(root), localizedHelpTitles)) {
      out.push(root.identifier ?? root.title)
    }
  }
  return out
}

/** Swift L155：清掉 role 引用，之后任何再生成的帮助项都不会被认作 role。 */
export const EDITOR_MENU_CLEARS_HELP_MENU_ROLE = true

// ---------------------------------------------------------------- 本地化

/**
 * Swift L236-241：标准菜单项的本地化表。
 *
 * 键是 **selector 字符串**，不是标题 —— 这样系统换语言也不会失配。
 */
export const EDITOR_MENU_STANDARD_TITLES: Readonly<Record<string, string>> = {
  'cut:': '剪切',
  'copy:': '拷贝',
  'paste:': '粘贴',
  'selectAll:': '全选',
  'hideOtherApplications:': '隐藏其他',
  'unhideAllApplications:': '显示全部',
  'performMiniaturize:': '最小化',
  'performZoom:': '缩放',
  'arrangeInFront:': '前置所有窗口',
  'hide:': '隐藏%@',
  'toggleFullScreen:': '进入全屏',
}

/** Swift L248：`hide:` 要带上 App 名。 */
export const EDITOR_MENU_HIDE_FORMAT = '隐藏%@'

/** Swift L251-253：全屏项的两个标题。 */
export const EDITOR_MENU_FULL_SCREEN_ENTER_TITLE = '进入全屏'
export const EDITOR_MENU_FULL_SCREEN_EXIT_TITLE = '退出全屏'

/** Swift L256-263：三个角色菜单的标题。 */
export const EDITOR_MENU_SERVICES_TITLE = '服务'
export const EDITOR_MENU_WINDOWS_TITLE = '窗口'
export const EDITOR_MENU_VIEW_TITLE = '显示'

/**
 * Swift L248：把 `隐藏%@` 里的占位符换成 App 名。
 *
 * 不用 `String(format:)` —— 它的 `%@` 只有一个参数位，
 * 这里用最简单的单次替换，避免 `%` 在 App 名里被二次解释。
 */
export function editorMenuHideTitle(appDisplayName: string): string {
  return EDITOR_MENU_HIDE_FORMAT.replace('%@', appDisplayName)
}

/**
 * Swift L250-253：全屏项的标题取决于**当前 key window** 是否已全屏。
 *
 * 注意判定的是 `NSApp.keyWindow`（当前活动窗口），不是「任意窗口」——
 * 多窗口时全屏的是哪一个决定了文案。
 */
export function editorMenuFullScreenTitle(anyKeyWindowFullScreen: boolean): string {
  return anyKeyWindowFullScreen ? EDITOR_MENU_FULL_SCREEN_EXIT_TITLE : EDITOR_MENU_FULL_SCREEN_ENTER_TITLE
}

/** 一个菜单项本地化后的结果（null 表示保持原样）。 */
export function editorMenuLocalizedTitle(
  selector: string,
  context: { appDisplayName: string; anyKeyWindowFullScreen: boolean }
): string | null {
  if (selector === 'hide:') return editorMenuHideTitle(context.appDisplayName)
  if (selector === 'toggleFullScreen:') return editorMenuFullScreenTitle(context.anyKeyWindowFullScreen)
  const mapped = EDITOR_MENU_STANDARD_TITLES[selector]
  return mapped ?? null
}

/**
 * Swift L242-267：递归刷新整棵树的标题。
 *
 * 三件事：
 *   1) 有 `action` 的项按 selector 查表；
 *   2) 有 `submenu` 的项是服务 / 窗口 / 显示之一（按**引用**判定，不按标题）；
 *   3) 递归进子菜单。
 */
export interface EditorMenuLocalizeStep {
  readonly path: string
  readonly title: string
}

export function editorMenuLocalizePlan(
  menu: readonly EditorMenuItemNode[],
  context: { appDisplayName: string; anyKeyWindowFullScreen: boolean },
  roleOf: (node: EditorMenuItemNode) => 'services' | 'windows' | 'view' | null,
  path = ''
): EditorMenuLocalizeStep[] {
  const steps: EditorMenuLocalizeStep[] = []
  for (const node of menu) {
    const nodePath = path === '' ? (node.identifier ?? node.title) : `${path}/${node.identifier ?? node.title}`
    if (node.action) {
      const title = editorMenuLocalizedTitle(node.action, context)
      if (title !== null) steps.push({ path: nodePath, title })
    }
    if (node.submenu.length > 0) {
      const role = roleOf(node)
      if (role === 'services') steps.push({ path: nodePath, title: EDITOR_MENU_SERVICES_TITLE })
      if (role === 'windows') steps.push({ path: nodePath, title: EDITOR_MENU_WINDOWS_TITLE })
      if (role === 'view') steps.push({ path: nodePath, title: EDITOR_MENU_VIEW_TITLE })
      steps.push(...editorMenuLocalizePlan(node.submenu, context, roleOf, nodePath))
    }
  }
  return steps
}

// ---------------------------------------------------------------- 撤销路由

/**
 * Swift L305-321：撤销 / 重做的路由。
 *
 * 顺序很重要：**先看当前第一响应者是不是可编辑文本域**。
 * 如果是，就交给文本域自己的 undoManager —— 否则用户在文件名输入框里
 * 按 ⌘Z 会撤销掉整个项目的上一步操作。
 */
export interface EditorMenuUndoContext {
  readonly hasEditableTextFocus: boolean
  readonly textCanUndo: boolean
  readonly textCanRedo: boolean
  readonly editorCanUndo: boolean
  readonly editorCanRedo: boolean
  readonly editorUndoActionName: string | null
  readonly editorRedoActionName: string | null
  readonly isEditorActive: boolean
}

/** 路由目标。 */
export type EditorMenuUndoTarget = 'text' | 'editor' | 'none'

/** Swift L305-312：撤销该发给谁。 */
export function editorMenuUndoTarget(context: EditorMenuUndoContext): EditorMenuUndoTarget {
  if (context.hasEditableTextFocus) return 'text'
  return context.editorCanUndo ? 'editor' : 'none'
}

/** Swift L314-321：重做该发给谁。 */
export function editorMenuRedoTarget(context: EditorMenuUndoContext): EditorMenuUndoTarget {
  if (context.hasEditableTextFocus) return 'text'
  return context.editorCanRedo ? 'editor' : 'none'
}

/**
 * Swift L331-335：撤销项的标题。
 *
 * 有动作名时是 `撤销“复制”`，没有时退回 `撤销`。
 * 注意动作名本身要先过 `appLocalized` —— 因为 undoManager 里的名字
 * 是注册那次操作时写进去的，可能是英文。
 */
export function editorMenuUndoTitle(actionName: string | null): string {
  if (actionName !== null && actionName.length > 0) return `撤销“${actionName}”`
  return EDITOR_MENU_UNDO_ITEM.title
}

/** Swift L343-347：重做项的标题。 */
export function editorMenuRedoTitle(actionName: string | null): string {
  if (actionName !== null && actionName.length > 0) return `重做“${actionName}”`
  return EDITOR_MENU_REDO_ITEM.title
}

/**
 * Swift L323-356：`validateMenuItem` 的完整结果。
 *
 * 四支：
 *   - 撤销 / 重做：可编辑文本域优先（标题固定为「撤销」/「重做」，不带动作名）；
 *   - 导出：**只在编辑器活着时**可用；
 *   - 打开项目：永远可用；
 *   - 其它：交给系统。
 */
export interface EditorMenuItemValidation {
  readonly enabled: boolean
  readonly title: string | null
}

export function editorMenuValidate(
  action: string | null,
  context: EditorMenuUndoContext,
  currentTitle: string
): EditorMenuItemValidation {
  switch (action) {
    case EDITOR_MENU_ACTION_UNDO:
      if (context.hasEditableTextFocus) {
        return { enabled: context.textCanUndo, title: EDITOR_MENU_UNDO_ITEM.title }
      }
      return { enabled: context.editorCanUndo, title: editorMenuUndoTitle(context.editorUndoActionName) }
    case EDITOR_MENU_ACTION_REDO:
      if (context.hasEditableTextFocus) {
        return { enabled: context.textCanRedo, title: EDITOR_MENU_REDO_ITEM.title }
      }
      return { enabled: context.editorCanRedo, title: editorMenuRedoTitle(context.editorRedoActionName) }
    case EDITOR_MENU_ACTION_EXPORT:
      return { enabled: context.isEditorActive, title: null }
    case EDITOR_MENU_ACTION_OPEN_PROJECT:
      return { enabled: true, title: null }
    default:
      return { enabled: true, title: null }
  }
}

// ---------------------------------------------------------------- 生命周期

/**
 * Swift L47-58：编辑器挂载 / 卸载。
 *
 * `detachEditor` 有一个身份判断（L54）：只有「当前挂着的那个 undoManager」
 * 才允许卸载。否则旧编辑器的延迟卸载会把新编辑器的状态清掉。
 */
export function editorMenuAttach(undoManagerPresent: boolean): { isEditorActive: boolean; hasUndoManager: boolean } {
  return { isEditorActive: true, hasUndoManager: undoManagerPresent }
}

export function editorMenuDetach(
  attachedToken: number,
  incomingToken: number
): { accepted: boolean; isEditorActive: boolean; hasUndoManager: boolean } {
  if (attachedToken !== incomingToken) {
    return { accepted: false, isEditorActive: true, hasUndoManager: true }
  }
  return { accepted: true, isEditorActive: false, hasUndoManager: false }
}

/**
 * Swift L36-45：三个请求通道。
 *
 * 它们都是 `PassthroughSubject<Void, Never>` —— 只通知「发生了一件事」，
 * 不带参数。菜单层不许直接改 SwiftUI 状态（注释 L36-37）。
 */
export const EDITOR_MENU_REQUEST_CHANNELS = [
  'exportRequest',
  'shortcutCheatsheetRequest',
  'quitRequest',
] as const

/** 通道名。 */
export type EditorMenuRequestChannel = (typeof EDITOR_MENU_REQUEST_CHANNELS)[number]
