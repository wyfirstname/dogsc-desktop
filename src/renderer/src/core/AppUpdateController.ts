/**
 * Swift source: Sources/DogSCApp/AppUpdateController.swift（76 行）@ 567fd6e
 *
 * L14    → APP_FORMAL_BUNDLE_IDENTIFIER
 * L24-26 → appIsFormalRelease
 * L28-36 → appUpdateVersionDescription
 * L38-45 → appUpdateAvailabilityDescription
 * L47-60 → 启动闸门（didStart 一次性）
 * L62-68 → 检查更新前的激活顺序
 * L70-75 → 自动检查开关
 *
 * 原注释：本地开发**故意**用不同的 bundle id。它可以渲染更新控件以便视觉评审，
 * 但绝不允许用正式版 `DogSC.app` 的发布替换掉开发版。
 *
 * Windows 侧：Sparkle 不存在，更新检查由主进程实现；这里保留「正式版 / 开发版」
 * 判定、文案与启动闸门 —— 它们是「开发版不许自我替换」这条规则的全部依据。
 */

/** 正式版 bundle id（Swift `cn.laogou.dogsc`）。 */
export const APP_FORMAL_BUNDLE_IDENTIFIER = 'cn.laogou.dogsc'

/** 版本信息缺失时的占位符（Swift `"—"`）。 */
export const APP_UPDATE_PLACEHOLDER = '—'

export const APP_UPDATE_TEXT = {
  automaticOn: '每天自动检查 GitHub Release；发现新版后可直接下载、替换并重新打开。',
  automaticOff: '自动检查已关闭；仍可随时手动检查并直接安装新版。',
  development: '开发版不会替换正式版；发布后的 DogSC 才会连接 GitHub 更新源。',
} as const

/** 是否正式发布包（只有它才允许连更新源）。 */
export function appIsFormalRelease(bundleIdentifier: string | null | undefined): boolean {
  return bundleIdentifier === APP_FORMAL_BUNDLE_IDENTIFIER
}

/** 版本展示：`"1.2（34）"`；两者缺一个就用占位符，不吞掉另一半。 */
export function appUpdateVersionDescription(
  version: string | null | undefined,
  build: string | null | undefined
): string {
  const resolvedVersion = version ?? APP_UPDATE_PLACEHOLDER
  const resolvedBuild = build ?? APP_UPDATE_PLACEHOLDER
  return `${resolvedVersion}（${resolvedBuild}）`
}

/** 可用性说明三态（Swift L38-45）。 */
export function appUpdateAvailabilityDescription(input: {
  readonly isFormalRelease: boolean
  readonly automaticallyChecksForUpdates: boolean
}): string {
  if (!input.isFormalRelease) return APP_UPDATE_TEXT.development
  return input.automaticallyChecksForUpdates
    ? APP_UPDATE_TEXT.automaticOn
    : APP_UPDATE_TEXT.automaticOff
}

export type AppUpdateStartDecision = 'alreadyStarted' | 'development' | 'start'

/**
 * 启动闸门（Swift L47-50）：`didStart` 先置位再判断，所以开发版也会把
 * 「已尝试过」记下来 —— 保证之后任何调用都不会重复启动 updater。
 */
export function appUpdateStartDecision(input: {
  readonly didStart: boolean
  readonly isFormalRelease: boolean
}): AppUpdateStartDecision {
  if (input.didStart) return 'alreadyStarted'
  if (!input.isFormalRelease) return 'development'
  return 'start'
}

/** 手动检查是否被允许（开发版直接 return，连激活应用都不做）。 */
export function appUpdateCheckAllowed(isFormalRelease: boolean): boolean {
  return isFormalRelease
}

/**
 * 检查更新时的动作顺序（Swift L62-68）：先激活应用再弹更新 UI。
 * 少这一步，后台进程弹出的更新窗口会落在别的应用后面，用户以为没反应。
 */
export const APP_UPDATE_CHECK_SEQUENCE = ['startIfEligible', 'activateApplication', 'checkForUpdates'] as const

export interface AppUpdatePort {
  /** 读当前自动检查设置。 */
  readonly readAutomaticallyChecksForUpdates: () => boolean
  /** 启动 updater。 */
  startUpdater: () => void
  checkForUpdates: () => void
  activateApplication: () => void
  writeAutomaticallyChecksForUpdates: (enabled: boolean) => void
}

export interface AppUpdateState {
  readonly isReady: boolean
  readonly automaticallyChecksForUpdates: boolean
  readonly didStart: boolean
}

/**
 * 控制器本体：单实例、只启动一次、开发版全程空转但状态可读（供 UI 视觉评审）。
 */
export class AppUpdateController {
  private readonly port: AppUpdatePort
  private readonly isFormalRelease: boolean
  private state: AppUpdateState = {
    isReady: false,
    automaticallyChecksForUpdates: false,
    didStart: false,
  }

  constructor(port: AppUpdatePort, isFormalRelease: boolean) {
    this.port = port
    this.isFormalRelease = isFormalRelease
  }

  get snapshot(): AppUpdateState {
    return this.state
  }

  get availabilityDescription(): string {
    return appUpdateAvailabilityDescription({
      isFormalRelease: this.isFormalRelease,
      automaticallyChecksForUpdates: this.state.automaticallyChecksForUpdates,
    })
  }

  startIfEligible(): void {
    const decision = appUpdateStartDecision({
      didStart: this.state.didStart,
      isFormalRelease: this.isFormalRelease,
    })
    if (decision === 'alreadyStarted') return
    this.state = { ...this.state, didStart: true }
    if (decision === 'development') return
    this.port.startUpdater()
    this.state = {
      ...this.state,
      isReady: true,
      automaticallyChecksForUpdates: this.port.readAutomaticallyChecksForUpdates(),
    }
  }

  checkForUpdates(): void {
    if (!appUpdateCheckAllowed(this.isFormalRelease)) return
    this.startIfEligible()
    if (!this.state.isReady) return
    this.port.activateApplication()
    this.port.checkForUpdates()
  }

  setAutomaticallyChecksForUpdates(enabled: boolean): void {
    if (!appUpdateCheckAllowed(this.isFormalRelease)) return
    this.startIfEligible()
    if (this.state.isReady) this.port.writeAutomaticallyChecksForUpdates(enabled)
    this.state = { ...this.state, automaticallyChecksForUpdates: enabled }
  }
}
