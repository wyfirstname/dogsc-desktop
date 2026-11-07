/**
 * 编辑器外观切换按钮 —— Swift EditorAppearanceToggleButton.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/EditorAppearanceToggleButton.swift（36 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐段对照（Swift 行号 → 本文件）：
 *   - @AppStorage("app.appearance") 默认 .dark          L6-7
 *   - isDark = colorScheme == .dark                     L11
 *   - actionTitle / 图标 / 三态切换                      L12-19
 *   - 过渡：reduce motion 只淡，否则缩放 0.6→1.3 + 淡    L23-25
 *   - 动画：SpringMotion.settle ?? .easeOut(0.18)       L26
 *   - 无障碍：标签「界面外观」/ 值 深色|浅色 / 提示=动作   L30-34
 *
 * 原注释：工作区边缘只放**一个动作**，三态「跟随系统」留在设置里。
 * 「跟随系统」偏好下第一次点击要按当前**生效**配色解析成具体的浅/深 —— 否则用户
 * 点一下会觉得「没反应」（偏好从 system 变成 dark，而界面本来就是 dark）。
 */

/** UserDefaults 键（Swift AppPreferences.appearancePreferenceKey）。 */
export const APPEARANCE_PREFERENCE_KEY = 'app.appearance'

/** @AppStorage 的默认值：深色。 */
export const APPEARANCE_DEFAULT_PREFERENCE = 'dark' as const

export type AppAppearancePreference = 'system' | 'light' | 'dark'

export interface AppearanceToggleState {
  /** 点击后要写入的偏好（永远是具体值，不会写回 system）。 */
  readonly nextPreference: AppAppearancePreference
  /** 图标（当前状态的反向指示）。 */
  readonly symbolName: string
  /** 悬停提示与无障碍提示共用的动作描述。 */
  readonly actionTitle: string
  readonly accessibilityLabel: string
  readonly accessibilityValue: string
  readonly accessibilityIdentifier: string
}

/** Swift `EditorToolbarIconSurface(systemName:)` 的两个取值。 */
export const APPEARANCE_TOGGLE_SYMBOL_DARK = 'moon.stars.fill'
export const APPEARANCE_TOGGLE_SYMBOL_LIGHT = 'sun.max.fill'

/**
 * 由「当前生效是否深色」推出按钮的全部文案与目标状态。
 *
 * `isDark` 来自**生效**配色（`colorScheme`），不是存储的偏好 —— 这正是系统偏好
 * 下点一下就生效的原因。
 */
export function appearanceToggleState(isDark: boolean): AppearanceToggleState {
  return {
    nextPreference: isDark ? 'light' : 'dark',
    symbolName: isDark ? APPEARANCE_TOGGLE_SYMBOL_DARK : APPEARANCE_TOGGLE_SYMBOL_LIGHT,
    actionTitle: isDark ? '切换为浅色外观' : '切换为深色外观',
    accessibilityLabel: '界面外观',
    accessibilityValue: isDark ? '深色' : '浅色',
    accessibilityIdentifier: 'editor.appearance',
  }
}

/** 切换按钮的圆角（`EditorToolbarPressButtonStyle(cornerRadius: 16)`）。 */
export const APPEARANCE_TOGGLE_CORNER_RADIUS = 16

export type AppearanceToggleTransition =
  | { readonly kind: 'opacity' }
  | {
      readonly kind: 'asymmetric'
      readonly insertionScale: number
      readonly removalScale: number
      readonly fadesOpacity: true
    }

/**
 * Swift L23-25：reduce motion 时只做淡入淡出；否则插入从 0.6 放大、移除放大到 1.3。
 * 两侧都叠加透明度，所以即使缩放被系统降级，图标也不会硬切。
 */
export function appearanceToggleTransition(reducesMotion: boolean): AppearanceToggleTransition {
  if (reducesMotion) return { kind: 'opacity' }
  return { kind: 'asymmetric', insertionScale: 0.6, removalScale: 1.3, fadesOpacity: true }
}

export type AppearanceToggleAnimation =
  | { readonly kind: 'spring'; readonly response: number; readonly dampingFraction: number }
  | { readonly kind: 'easeOut'; readonly duration: number }

/**
 * Swift L26 `SpringMotion.settle ?? .easeOut(duration: 0.18)`：
 * settle 在 reduce motion 下为 nil，于是回落到 0.18s 缓出。**注意回落后仍保留动画** ——
 * 只是把空间位移换成了短淡出，不是「无动画」。
 */
export function appearanceToggleAnimation(reducesMotion: boolean): AppearanceToggleAnimation {
  if (reducesMotion) return { kind: 'easeOut', duration: 0.18 }
  return { kind: 'spring', response: 0.38, dampingFraction: 1 }
}
