/**
 * 应用本地化 —— 一份不可变的语言快照，SwiftUI 与原生标签共用。
 *
 * Swift source: Sources/DogSCApp/AppLocalization.swift（159 行）@ 567fd6e
 * 逐结构行号对照（Swift 行号）：
 *   - final class AppLocalization                     L8-75
 *   - private struct Language（identifier / bundle / cache）L11-18 → AppLanguageSnapshot
 *   - private init（启动时解析一次）                    L24-28   → resolveAppLanguage
 *   - var locale                                      L38      → appLocaleTag
 *   - localizedString(_:)（先查缓存）                   L40-45   → LocalizedStringCache
 *   - apply(_:)（标识符变了才发布）                      L47-56   → AppLocalizationStore.apply
 *   - resolve(_:)（全局域优先于应用域）                  L58-74   → resolveAppLanguage
 *   - Notification.Name.appLanguageDidChange          L77-79   → APP_LANGUAGE_DID_CHANGE
 *   - final class AppLanguageBinding                  L83-95   → 通知订阅语义
 *   - final class AppWindowLocalization               L100-141 → localizeWindowTitle
 *   - func appLocalizeWindowTitle                     L143-147 → localizeWindowTitle
 *   - final class LocalizedStringCache                L149-159 → LocalizedStringCache
 *
 * 原注释（L5-7）：
 *   One immutable language snapshot is shared by SwiftUI and native labels.
 *   Reads can also come from error-formatting workers: the lock protects only
 *   that snapshot, while all changes and UI notifications belong to MainActor.
 *
 * 迁移说明：`Bundle.preferredLocalizations(from:forPreferences:)` 在这里按
 * 「语言子标签优先匹配」实现 —— 只关心 en 与 zh 两种语言，且明确记录这个近似。
 * `NSMapTable` 的弱键窗口标题表在 Electron 侧由主进程按 window.id 维护。
 */

/** Swift L68：支持的语言，顺序即优先级（同分时靠前者胜）。 */
export const APP_SUPPORTED_LANGUAGES: readonly string[] = ['en', 'zh-Hans']

/** Swift L70：解析不出时的回落语言。 */
export const APP_LANGUAGE_FALLBACK = 'en'

/** Swift L78。 */
export const APP_LANGUAGE_DID_CHANGE = 'cn.laogou.dogsc.language.changed'

/** Swift L11-18。 */
export interface AppLanguageSnapshot {
  readonly identifier: string
  /** Swift 的 `Locale(identifier:)`；Web 侧即 BCP-47 标签。 */
  readonly locale: string
}

/**
 * Swift L58-70：
 *   let systemLanguages = CFPreferencesCopyValue("AppleLanguages", …) ?? Locale.preferredLanguages
 *   let identifier = Bundle.preferredLocalizations(from: ["en", "zh-Hans"],
 *                       forPreferences: preference.preferredLanguages ?? systemLanguages).first ?? "en"
 *
 * 注释（L59-60）是个陷阱提醒：用户删掉应用域覆盖后，**不能**让应用域回灌到
 * System 结果里 —— 所以要先读全局域。这个先后顺序在这里表达为
 * `preferenceLanguages ?? systemLanguages`：显式覆盖优先，否则用系统。
 *
 * 匹配规则（Apple 的算法比这里复杂，但只有两种语言时的结果一致）：
 * 按偏好顺序逐条看，语言子标签命中即选中；`zh` 一律落到 `zh-Hans`。
 */
export function resolveAppLanguage(input: {
  readonly preferenceLanguages: readonly string[] | null
  readonly systemLanguages: readonly string[]
}): string {
  const candidates = input.preferenceLanguages ?? input.systemLanguages
  for (const tag of candidates) {
    const language = tag.split('-')[0].toLowerCase()
    if (language === 'zh') return 'zh-Hans'
    if (language === 'en') return 'en'
  }
  return APP_LANGUAGE_FALLBACK
}

/** Swift L17 / L38。 */
export function appLanguageSnapshot(identifier: string): AppLanguageSnapshot {
  return { identifier, locale: identifier }
}

/** Swift L72：找不到对应 lproj 时回落到主 bundle —— 即原样返回 key。 */
export function appLocalizedString(
  key: string,
  table: Readonly<Record<string, string>>
): string {
  const hit = table[key]
  return hit === undefined ? key : hit
}

/**
 * Swift L149-159。
 *
 * 为什么需要它：视图 body 在每次更新时都会问同一批标签（一次时间线拖动会重跑
 * 几百次）。缓存把「标 key → 查表」的重复开销压掉。
 *
 * 注意 `resolve` 是闭包：只有未命中才会被调用，命中时零成本。
 */
export class LocalizedStringCache {
  private readonly values = new Map<string, string>()

  get size(): number {
    return this.values.size
  }

  string(key: string, resolve: () => string): string {
    const hit = this.values.get(key)
    if (hit !== undefined) return hit
    const value = resolve()
    this.values.set(key, value)
    return value
  }

  /** 语言切换时整批作废（Swift 换的是整个 Language 结构体，缓存随之丢弃）。 */
  reset(): void {
    this.values.clear()
  }
}

/**
 * Swift L47-56：
 *   let next = Self.resolve(preference)
 *   guard lock.withLock({ current.identifier != next.identifier }) else { return false }
 *   …withMutation… { current = next }
 *
 * 标识符没变就**不发布** —— 用户在没有实际变化的偏好上点两下不该触发全应用重绘。
 */
export class AppLocalizationStore {
  private snapshot: AppLanguageSnapshot
  private readonly cache = new LocalizedStringCache()
  private readonly table: Readonly<Record<string, string>>

  constructor(input: {
    readonly identifier: string
    readonly table: Readonly<Record<string, string>>
  }) {
    this.snapshot = appLanguageSnapshot(input.identifier)
    this.table = input.table
  }

  get language(): AppLanguageSnapshot {
    return this.snapshot
  }

  get locale(): string {
    return appLocaleTag(this.snapshot)
  }

  /** Swift L40-45。 */
  localizedString(key: string): string {
    return this.cache.string(key, () => appLocalizedString(key, this.table))
  }

  /** Swift L47-56。返回是否真的切换了（供宿主决定要不要广播通知）。 */
  apply(identifier: string): boolean {
    if (this.snapshot.identifier === identifier) return false
    this.snapshot = appLanguageSnapshot(identifier)
    this.cache.reset()
    return true
  }
}

/** Swift L38：`Language.locale`。 */
export function appLocaleTag(snapshot: AppLanguageSnapshot): string {
  return snapshot.locale
}

/**
 * Swift L104-120 + L130-140：窗口标题只翻译「应用显式提供」的那些。
 *
 *   text = arguments.isEmpty ? appLocalized(key)
 *                            : String(format: appLocalized(key), arguments...)
 *   return prefix.map { "\($0) \(translated)" } ?? translated
 *
 * 注释（L97-99）：弱键表避免延长面板寿命；用户自建的项目名留在原主人手里，
 * 不变成翻译键。所以这里是「显式注册的标题」而不是「所有窗口标题」。
 */
export function localizeWindowTitle(input: {
  readonly key: string
  readonly prefix: string | null
  readonly arguments: readonly string[]
  readonly translate: (key: string) => string
}): string {
  const template = input.translate(input.key)
  const translated =
    input.arguments.length === 0 ? template : formatWithArguments(template, input.arguments)
  return input.prefix === null ? translated : `${input.prefix} ${translated}`
}

/**
 * Swift 的 `String(format:arguments:)` 子集：只处理 `%@`。
 * 其它占位符（`%d` / `%.1f`）不在这里实现 —— 上游窗口标题只用 `%@`。
 */
export function formatWithArguments(template: string, args: readonly string[]): string {
  let index = 0
  return template.replace(/%@/g, () => {
    const value = args[index]
    index += 1
    return value === undefined ? '%@' : value
  })
}
