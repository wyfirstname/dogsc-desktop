/**
 * 场景预设 —— 保存 / 应用 / 删除一整套外观，含背景资产迁移与四条告知。
 *
 * Swift source: Sources/DogSCApp/EditorScenePresets.swift（333 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - activeScenePreset / scenePresetIsModified                 L6-18  → scenePresetIsModified
 *   - isKnownScenePresetBackground（五条件 + 文件存在）          L20-28 → scenePresetBackgroundIsKnown
 *   - stylePresetNameConflict（忽略大小写 + 排除自身）           L30-35 → scenePresetNameConflict
 *   - nextStylePresetName（「场景 N」递增）                      L37-44 → scenePresetNextName
 *   - beginSavingScenePreset                                    L46-51 → scenePresetBeginEditing
 *   - stylePresetControl（空/非空两态）                          L54-72 → scenePresetMenuButtonTitle
 *   - scenePresetMenu（列表高 84×n 夹 320、四项告知）             L74-162 → SCENE_PRESET_*
 *   - scenePresetLabel（超 14 字截成 13 + 省略号）               L164-184 → scenePresetLabelText
 *   - setDefaultScenePreset                                     L186-189 → scenePresetDefaultButtonTitle
 *   - requestScenePresetApplication（裁切尺寸不同需确认）         L191-198 → scenePresetRequiresSourceConfirmation
 *   - saveCurrentStylePreset（背景资产 retain + 失败回滚）        L200-247 → SCENE_PRESET_SAVE_ERROR
 *   - applyStylePreset（六条命令 + 四条告知）                     L249-315 → scenePresetNotices
 *   - deleteStylePreset                                         L317-331 → scenePresetDeleteOutcome
 *
 * 原注释（L202）：guard 里四个前置条件（非空 / 无重名 / 未在保存中）。
 *
 * 迁移说明：SwiftUI 视图 → React 组件。这里保留七件纯逻辑：
 * 名称冲突（忽略大小写）、「场景 N」递增命名、标签截断、列表高度夹取、
 * 应用前的源尺寸确认判定、四条告知的拼装、以及删除时的连带清理。
 */

// ---------------------------------------------------------------- 名称

/** Swift L39：自动命名的前缀。 */
export const SCENE_PRESET_NAME_PREFIX = '场景'

/**
 * Swift L37-44：下一个可用名 —— 取第一个没被占用的 `场景 N`（N 从 1 起）。
 *
 * 比较用 `localizedCaseInsensitiveCompare`，所以已存在「场景 1」时
 * 用户手写的「场景1」（无空格）**不**算冲突，但「场景 １」（全角）在某些
 * 语言环境下会算。这里按 `localizedCaseInsensitiveCompare` 的语义退化为
 * 「忽略大小写 + 忽略前后空白」的精确比较。
 */
export function scenePresetNextName(existingNames: readonly string[]): string {
  const taken = new Set(existingNames.map(scenePresetNameKey))
  let index = 1
  while (taken.has(scenePresetNameKey(`${SCENE_PRESET_NAME_PREFIX} ${index}`))) {
    index += 1
  }
  return `${SCENE_PRESET_NAME_PREFIX} ${index}`
}

/** Swift L33：比较用的键 —— 忽略大小写。 */
export function scenePresetNameKey(name: string): string {
  return name.toLowerCase()
}

/**
 * Swift L30-35：重名判定。
 *
 * `$0.id != updatingStylePresetID` 这一条不能省：更新已有预设时，
 * 它自己的名字当然和它自己相同，不排除的话「更新」永远报重名。
 */
export function scenePresetNameConflict(input: {
  readonly name: string
  readonly savedNames: readonly string[]
  readonly savedIDs: readonly string[]
  readonly updatingID: string | null
}): boolean {
  const key = scenePresetNameKey(input.name.trim())
  return input.savedIDs.some((id, index) => {
    if (input.updatingID !== null && id === input.updatingID) return false
    return scenePresetNameKey(input.savedNames[index].trim()) === key
  })
}

/** Swift L201：保存前要去掉前后空白（用户常在名字后面多打一个空格）。 */
export function scenePresetTrimmedName(name: string): string {
  return name.replace(/^\s+|\s+$/g, '')
}

/**
 * Swift L202：四个前置条件 —— 名字非空、无重名、不在保存中。
 *
 * 第三个 `!isSavingStylePreset` 挡的是连点：保存是异步的（要复制背景文件），
 * 用户很容易在第一次还没写完时再点一次。
 */
export function scenePresetCanSave(input: {
  readonly name: string
  readonly hasConflict: boolean
  readonly isSaving: boolean
}): boolean {
  return scenePresetTrimmedName(input.name).length > 0 && !input.hasConflict && !input.isSaving
}

/** Swift L46-51：开始编辑时把编辑态清干净（新名字或原标题、清错误、开命名框）。 */
export function scenePresetBeginEditing(input: {
  readonly existingName: string | null
  readonly nextName: string
}): { readonly updatingIDSet: true; readonly name: string; readonly error: null } {
  return {
    updatingIDSet: true,
    name: input.existingName ?? input.nextName,
    error: null,
  }
}

// ---------------------------------------------------------------- 标签

/** Swift L168：超过 14 个字符就截断。 */
export const SCENE_PRESET_LABEL_TRUNCATE_THRESHOLD = 14

/** Swift L168：截断后保留前 13 个字符再加省略号（总长仍是 14）。 */
export const SCENE_PRESET_LABEL_PREFIX_LENGTH = 13

/** Swift L168：省略号。 */
export const SCENE_PRESET_LABEL_ELLIPSIS = '…'

/**
 * Swift L168：`title.count > 14 ? String(title.prefix(13)) + "…" : title`。
 *
 * 总数保持 14 —— 截断后长度不增，工具栏按钮的宽度才不会因为名字长而变。
 */
export function scenePresetLabelText(title: string): string {
  if (title.length <= SCENE_PRESET_LABEL_TRUNCATE_THRESHOLD) return title
  return title.slice(0, SCENE_PRESET_LABEL_PREFIX_LENGTH) + SCENE_PRESET_LABEL_ELLIPSIS
}

/**
 * Swift L55-71：按钮标题 —— 有预设时用当前预设名，没有时用占位词。
 *
 * 空列表时按钮直接变成「保存场景」（没有可切换的东西），
 * 有列表时才是「<当前预设名> / 场景预设」并带下拉折角。
 */
export function scenePresetMenuButtonTitle(input: {
  readonly hasSavedPresets: boolean
  readonly activeName: string | null
}): string {
  if (!input.hasSavedPresets) return SCENE_PRESET_EMPTY_SAVE_LABEL
  return input.activeName ?? SCENE_PRESET_DEFAULT_LABEL
}

/** Swift L57：空列表时的按钮文案。 */
export const SCENE_PRESET_EMPTY_SAVE_LABEL = '保存场景'

/** Swift L62：有列表但未选中任何预设时的占位文案。 */
export const SCENE_PRESET_DEFAULT_LABEL = '场景预设'

/** Swift L77：弹层标题。 */
export const SCENE_PRESET_MENU_TITLE = '场景预设'

/** Swift L153：更新按钮文案。 */
export const SCENE_PRESET_UPDATE_LABEL = '更新此预设…'

/** Swift L175 / L183：已修改徽标（一个小圆点 + 无障碍文本）。 */
export const SCENE_PRESET_MODIFIED_BADGE = '已修改'

/** Swift L172 / L173：徽点直径 9、字号 5（点里没有字，字号只影响对齐盒）。 */
export const SCENE_PRESET_MODIFIED_DOT_SIZE = 9
export const SCENE_PRESET_MODIFIED_DOT_FONT_SIZE = 5

/** Swift L59 / L65 / L112：工具栏按钮圆角 16。 */
export const SCENE_PRESET_BUTTON_CORNER_RADIUS = 16

// ---------------------------------------------------------------- 已修改

/**
 * Swift L10-18：预设是否已被改动。
 *
 * 三步：没有快照就是 false（没选中任何预设）→ 若当前背景源就是预设自己
 * 记着的那个已知源，先把背景源换成快照里的，避免「只是重新选中了同一个
 * 背景文件」被判成修改 → 整体比较。
 *
 * 第二步是这一段的精髓：背景源在应用预设时会被重写成新的相对路径，
 * 直接比较会把刚应用完的预设立刻标成「已修改」。
 */
export function scenePresetIsModified(input: {
  readonly hasSnapshot: boolean
  /** 当前背景源是否已知属于这个预设（决定要不要先做源替换）。 */
  readonly backgroundSourceIsKnown: boolean
  /** 直接比较的结果（不做源替换）。 */
  readonly matchesRaw: boolean
  /** 把背景源替换成快照里的那个之后比较的结果。 */
  readonly matchesWithSubstitutedSource: boolean
}): boolean {
  if (!input.hasSnapshot) return false
  const matches = input.backgroundSourceIsKnown
    ? input.matchesWithSubstitutedSource
    : input.matchesRaw
  return !matches
}

/**
 * Swift L20-28：背景源是否「已知属于这个预设」。
 *
 * 五个条件：预设 id 匹配、资产可用、快照里的资产就是这个、源在当前会话的
 * 已知源集合里、且文件确实还在磁盘上。
 *
 * 最后一条（`fileExists`）挡的是「用户把壁纸文件删了」——此时不该把它当作
 * 已知源，否则应用预设时会沿用一条指向不存在文件的路径。
 */
export function scenePresetBackgroundIsKnown(input: {
  readonly activePresetIDMatches: boolean
  readonly assetAvailable: boolean
  readonly snapshotAssetMatches: boolean
  readonly sourceInActiveSet: boolean
  readonly fileExists: boolean
}): boolean {
  return (
    input.activePresetIDMatches &&
    input.assetAvailable &&
    input.snapshotAssetMatches &&
    input.sourceInActiveSet &&
    input.fileExists
  )
}

// ---------------------------------------------------------------- 列表

/** Swift L147：每行 84 高。 */
export const SCENE_PRESET_ROW_HEIGHT = 84

/** Swift L147：列表高度上限 320。 */
export const SCENE_PRESET_LIST_MAXIMUM_HEIGHT = 320

/**
 * Swift L147：`min(count × 84, 320)`。
 *
 * 不设下限：空列表时高度 0，`ScrollView` 自然塌掉；但调用方只在
 * 有预设时才渲染这一段，所以不会出现「一条 0 高的滚动区」。
 */
export function scenePresetListHeight(count: number): number {
  const safe = Number.isFinite(count) ? Math.max(count, 0) : 0
  return Math.min(safe * SCENE_PRESET_ROW_HEIGHT, SCENE_PRESET_LIST_MAXIMUM_HEIGHT)
}

/** Swift L161：弹层定宽 320、内边距 18。 */
export const SCENE_PRESET_POPOVER_WIDTH = 320
export const SCENE_PRESET_POPOVER_PADDING = 18

/** Swift L75：弹层内各段间距 12；每张卡片内行距 8。 */
export const SCENE_PRESET_MENU_SPACING = 12
export const SCENE_PRESET_CARD_SPACING = 8

/** Swift L96-98：行首图标 14，装在 28 见方里。 */
export const SCENE_PRESET_ROW_ICON_SIZE = 14
export const SCENE_PRESET_ROW_ICON_FRAME = 28

/** Swift L95 / L111：图标与文字间距 10，行内边距 12。 */
export const SCENE_PRESET_ROW_SPACING = 10
export const SCENE_PRESET_ROW_PADDING = 12

/** Swift L110：行标题 13 中粗。 */
export const SCENE_PRESET_ROW_TITLE_FONT_SIZE = 13

/** Swift L82：新建按钮 30 见方、图标 14。 */
export const SCENE_PRESET_ADD_BUTTON_SIZE = 30
export const SCENE_PRESET_ADD_BUTTON_ICON_SIZE = 14

/** Swift L128：删除按钮 26 × 24、图标 14。 */
export const SCENE_PRESET_DELETE_BUTTON_WIDTH = 26
export const SCENE_PRESET_DELETE_BUTTON_HEIGHT = 24

/** Swift L122：默认按钮高 26；L154：更新按钮高 36。 */
export const SCENE_PRESET_DEFAULT_BUTTON_HEIGHT = 26
export const SCENE_PRESET_UPDATE_BUTTON_HEIGHT = 36

/** Swift L140：选中卡片的描边宽 1.5。 */
export const SCENE_PRESET_CARD_BORDER_WIDTH = 1.5

/** Swift L140：选中时描边不透明 1，否则 0（保留布局但不画）。 */
export function scenePresetCardBorderAlpha(active: boolean): number {
  return active ? 1 : 0
}

/** Swift L97：选中行图标用主文字色，否则次要色。 */
export function scenePresetRowIconTone(active: boolean): 'primaryText' | 'secondaryText' {
  return active ? 'primaryText' : 'secondaryText'
}

/** Swift L100：选中行图标底板用选择洗色，否则 `chrome(0.06)`。 */
export function scenePresetRowIconBackgroundAlpha(active: boolean): number | null {
  return active ? null : 0.06
}

/** Swift L106-109：选中时显示勾选标记。 */
export function scenePresetRowCheckmarkVisible(active: boolean): boolean {
  return active
}

/** Swift L116-134：卡片底部工具条的左右内边距 8、底边距 8、行距 8。 */
export const SCENE_PRESET_CARD_FOOTER_PADDING = 8
export const SCENE_PRESET_CARD_FOOTER_SPACING = 8

/** Swift L120 / L121：默认按钮的两态文案与图标。 */
export function scenePresetDefaultButtonTitle(isDefault: boolean): string {
  return isDefault ? '新录制默认' : '设为新录制默认'
}

export function scenePresetDefaultButtonSymbol(isDefault: boolean): string {
  return isDefault ? 'checkmark.circle.fill' : 'circle'
}

/**
 * Swift L118：点已默认的预设会取消默认（传 nil），点别的会把它设为默认。
 *
 * 这个「再点一次取消」的行为没有额外按钮，是列表里唯一可逆的开关，
 * 用户很快就能发现。
 */
export function scenePresetDefaultToggleTarget(currentDefaultID: string | null, presetID: string): string | null {
  return currentDefaultID === presetID ? null : presetID
}

/** Swift L158：底部的默认状态说明。 */
export function scenePresetDefaultHintText(hasDefault: boolean): string {
  return hasDefault ? '新录制将应用已选默认场景' : '新录制沿用上次外观'
}

/** Swift L129 / L131：删除按钮的提示与无障碍标签。 */
export function scenePresetDeleteHelpText(name: string): string {
  return `删除预设：${name}`
}

// ---------------------------------------------------------------- 应用前的确认

/**
 * Swift L191-198：应用前要不要先确认源尺寸。
 *
 * 只有三个条件同时成立才挂起：预设包含裁切信息、裁切不是全画幅、
 * 且预设记着的源尺寸与当前项目的源尺寸**不同**。
 *
 * 为什么要确认：裁切是相对源像素的矩形，把 4K 上裁的半屏套到 1080p 上
 * 会裁到完全不同的位置 —— 用户看到的是「预设套错了」，不如先问一句。
 */
export function scenePresetRequiresSourceConfirmation(input: {
  readonly includesCrop: boolean
  readonly cropIsFull: boolean
  readonly presetSourceDimensions: { readonly width: number; readonly height: number } | null
  readonly currentSourceDimensions: { readonly width: number; readonly height: number } | null
}): boolean {
  if (!input.includesCrop || input.cropIsFull) return false
  if (input.presetSourceDimensions === null) return false
  const current = input.currentSourceDimensions
  if (current === null) return true
  return (
    input.presetSourceDimensions.width !== current.width ||
    input.presetSourceDimensions.height !== current.height
  )
}

// ---------------------------------------------------------------- 告知

/**
 * Swift L299-309：应用预设之后的四条告知。
 *
 * 每一条都对应一个「用户以为生效了但其实没有」的情况：
 *   1. 背景未包含或不可用 → 已保留当前背景
 *   2. 旧版预设没有裁切字段 → 已保留当前裁切与摄像头显隐
 *   3. 摄像头布局应用了但项目没有摄像头素材 → 看不到效果
 *
 * 三条不是错误，所以不做成错误提示，而是拼成一段多行说明。
 */
export const SCENE_PRESET_NOTICE_MISSING_BACKGROUND =
  '此预设的背景未包含或已不可用，已保留当前背景。'
export const SCENE_PRESET_NOTICE_LEGACY_PRESET =
  '这是旧版外观预设，已保留当前裁切和摄像头显隐。更新此预设后可保存完整场景。'
export const SCENE_PRESET_NOTICE_NO_CAMERA_MEDIA =
  '摄像头布局已应用；当前项目没有摄像头素材。'

/** Swift L309：多条告知用两个换行连接（段间距，不是行距）。 */
export const SCENE_PRESET_NOTICE_SEPARATOR = '\n\n'

export function scenePresetNotices(input: {
  readonly hasAvailableBackground: boolean
  readonly includesCrop: boolean
  readonly cameraVisible: boolean
  readonly projectHasCameraMedia: boolean
}): string[] {
  const notices: string[] = []
  if (!input.hasAvailableBackground) notices.push(SCENE_PRESET_NOTICE_MISSING_BACKGROUND)
  if (!input.includesCrop) notices.push(SCENE_PRESET_NOTICE_LEGACY_PRESET)
  if (input.cameraVisible && !input.projectHasCameraMedia) {
    notices.push(SCENE_PRESET_NOTICE_NO_CAMERA_MEDIA)
  }
  return notices
}

/** Swift L309：拼成一段文本；空数组时调用方不显示（`if !notices.isEmpty`）。 */
export function scenePresetNoticesText(notices: readonly string[]): string {
  return notices.join(SCENE_PRESET_NOTICE_SEPARATOR)
}

/** Swift L243：保存失败的文案。 */
export const SCENE_PRESET_SAVE_ERROR = '预设未保存。请确认背景文件可读取后重试。'

/**
 * Swift L240-245：失败时先把已复制的背景资产丢掉，再报错。
 *
 * 顺序很重要：`discardUncommittedCopy` 是异步的，如果先报错再丢，
 * 用户看到的错误和磁盘上的残留文件会不同步。另外 `!Task.isCancelled`
 * 让用户主动取消时不弹错误（取消不是失败）。
 */
export function scenePresetShouldReportSaveError(cancelled: boolean): boolean {
  return !cancelled
}

/** Swift L312：应用失败时报错走 host 的 `reportError`（与保存失败同一出口）。 */
export function scenePresetShouldReportApplyError(cancelled: boolean): boolean {
  return !cancelled
}

/**
 * Swift L276-278：应用前重新校验项目未变。
 *
 * 背景资产导入是异步的（可能要复制几百 MB），期间用户完全可能改了别的东西。
 * 不校验的话，把结果写回去会覆盖掉他刚做的修改。
 */
export function scenePresetShouldRejectStaleProject(projectChanged: boolean): boolean {
  return projectChanged
}

/** Swift L277：拒绝时的错误域。 */
export const SCENE_PRESET_STALE_STATE_DOMAIN = '场景配置'

/** Swift L288：撤销栈里的动作名。 */
export function scenePresetApplyActionName(name: string): string {
  return `应用场景预设“${name}”`
}

/**
 * Swift L280-288：一次应用要提交六条命令。
 *
 * 画布 / 相机 / 光标 / 运动 / 音频各一条，开场序列只在**变了**的时候才提交
 * （`baseline.openingSequence == result.openingSequence ? nil : ...`）。
 *
 * 用 `performBatch` 而不是逐条 `perform`：六条命令必须是一次撤销单元，
 * 否则用户要按六次 ⌘Z 才能退回应用预设之前。
 */
export const SCENE_PRESET_APPLY_COMMANDS = [
  'replacingCanvas',
  'replacingCamera',
  'replacingCursor',
  'replacingMotion',
  'replacingAudio',
  'replaceOpening',
] as const

/** Swift L286-287：开场序列相等时该条命令为 nil（被过滤）。 */
export function scenePresetOpeningCommandNeeded(openingChanged: boolean): boolean {
  return openingChanged
}

// ---------------------------------------------------------------- 删除

/**
 * Swift L317-331：删除预设的连带清理。
 *
 * 三件事：把它从列表里过滤掉、如果是默认就清掉默认、
 * 如果是当前活跃的就把活跃态也清掉。
 *
 * 顺序上先保存再改内存：保存失败时（`catch`）内存不会被改动，
 * 界面保持原样，用户重试即可。
 */
export function scenePresetDeleteOutcome(input: {
  readonly deletingID: string
  readonly defaultID: string | null
  readonly activeID: string | null
}): {
  readonly clearsDefault: boolean
  readonly clearsActive: boolean
} {
  return {
    clearsDefault: input.defaultID === input.deletingID,
    clearsActive: input.activeID === input.deletingID,
  }
}

/**
 * Swift L238：保存成功后把该预设设为活跃，并把「已知背景源」集合重置为
 * 「只有这一个源」（或空）。
 *
 * 这一步让「刚保存的预设」立刻显示为未修改 —— 否则新存的预设会马上带上
 * 一个「已修改」小点，看起来像保存失败了。
 */
export function scenePresetKnownBackgroundSourcesAfterSave(input: {
  readonly hasBackgroundAsset: boolean
  readonly backgroundSource: string | null
}): string[] {
  if (!input.hasBackgroundAsset || input.backgroundSource === null) return []
  return [input.backgroundSource]
}

/**
 * Swift L292-298：应用成功后重建「已知背景源」集合。
 *
 * 先把上一次会话的已知源带上（`knownBackgroundSources`），再把这次的
 * 背景源加进去（若不在）。带上旧的是为了让 Undo 恢复出来的引用
 * 也能被认成「同一份资产」，不必重新导入。
 */
export function scenePresetKnownBackgroundSourcesAfterApply(input: {
  readonly previousKnownSources: readonly string[]
  readonly newBackgroundSource: string | null
}): string[] {
  if (input.newBackgroundSource === null) return []
  const sources = [...input.previousKnownSources]
  if (!sources.includes(input.newBackgroundSource)) sources.push(input.newBackgroundSource)
  return sources
}

/** Swift L217 / L261：背景资产缺失时抛 `fileReadNoSuchFile`。 */
export const SCENE_PRESET_MISSING_BACKGROUND_ERROR = 'fileReadNoSuchFile'
