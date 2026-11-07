/**
 * Swift source: Sources/DogSCApp/PermissionTourFlow.swift（74 行）@ 567fd6e
 *
 * L4-16  → PermissionAccess
 * L18-19 → PermissionStep / PermissionTourAction
 * L26-30 → 构造
 * L32-38 → update
 * L40-44 → openedSettings
 * L46-55 → returnedFromSettings
 * L57-62 → primaryAction
 * L64-68 → advance
 * L70-73 → previous
 *
 * 原注释：**只是呈现状态**。TCC（系统权限）始终由 AppModel 持有；本值从不
 * 授予权限、不改变应用阶段、也不激活其它应用。
 */

export type PermissionStep = 'screen' | 'accessibility' | 'ready'

export const PERMISSION_STEP_ORDER: readonly PermissionStep[] = ['screen', 'accessibility', 'ready']

export interface PermissionAccess {
  readonly screen: boolean
  readonly accessibility: boolean
}

export type PermissionTourAction =
  | { readonly kind: 'openSettings'; readonly step: PermissionStep }
  | { readonly kind: 'advance' }
  | { readonly kind: 'enter' }

export function permissionAccessAllGranted(access: PermissionAccess): boolean {
  return access.screen && access.accessibility
}

/** 第一个还缺的步骤；两个都齐了返回 `ready`（Swift L8）。 */
export function permissionFirstRequiredStep(access: PermissionAccess): PermissionStep {
  if (!access.screen) return 'screen'
  if (!access.accessibility) return 'accessibility'
  return 'ready'
}

/** 某一步当前是否已满足（`ready` 要求全齐）。 */
export function permissionAccessGrants(access: PermissionAccess, step: PermissionStep): boolean {
  switch (step) {
    case 'screen':
      return access.screen
    case 'accessibility':
      return access.accessibility
    case 'ready':
      return permissionAccessAllGranted(access)
  }
}

export function permissionStepIndex(step: PermissionStep): number {
  return PERMISSION_STEP_ORDER.indexOf(step)
}

export class PermissionTourFlow {
  readonly isReview: boolean
  private access: PermissionAccess
  private step_: PermissionStep
  private settingsStep_: PermissionStep | null

  constructor(access: PermissionAccess, isReview: boolean) {
    this.access = access
    this.isReview = isReview
    this.step_ = isReview ? 'screen' : permissionFirstRequiredStep(access)
    this.settingsStep_ = null
  }

  get step(): PermissionStep {
    return this.step_
  }

  get currentStep(): PermissionStep {
    return this.step_
  }

  get currentAccess(): PermissionAccess {
    return this.access
  }

  /** 正在等系统设置返回的那一步；没打开过设置则为 null。 */
  get settingsStep(): PermissionStep | null {
    return this.settingsStep_
  }

  /**
   * 轮询到新的权限状态（Swift L32-38）。
   *
   * 关键：**用户在系统设置里操作期间，焦点不在我们这边**，此时即使轮询已看到
   * 成功也保留来源步骤 —— 否则面板会在用户还没切回来时自己跳步，回来时看到
   * 的是第二步而不是「刚才那步已经好了」。
   */
  update(access: PermissionAccess): void {
    this.access = access
    if (this.settingsStep_ === null && !this.isReview) {
      this.step_ = permissionFirstRequiredStep(access)
    }
    if (this.step_ === 'ready' && !permissionAccessAllGranted(access)) {
      this.step_ = permissionFirstRequiredStep(access)
    }
  }

  /** 点了「打开系统设置」：记住来源步骤，`ready` 不接受（Swift L40-44）。 */
  openedSettings(step: PermissionStep): void {
    if (step === 'ready') return
    this.settingsStep_ = step
    this.step_ = step
  }

  /**
   * 从系统设置返回后重新判定（Swift L46-55）。
   *
   * 来源步骤仍未授权 → 停在原步（继续引导同一项）；已授权 → 回到第一个缺口。
   */
  returnedFromSettings(access: PermissionAccess): void {
    const previous = this.settingsStep_
    this.access = access
    this.settingsStep_ = null
    if (previous !== null && !permissionAccessGrants(access, previous)) {
      this.step_ = previous
    } else {
      this.step_ = permissionFirstRequiredStep(access)
    }
  }

  /** 主按钮该做什么（Swift L57-62）：已满足 → 前进；缺 → 去设置。 */
  primaryAction(): PermissionTourAction {
    if (this.step_ === 'ready') {
      return permissionAccessAllGranted(this.access)
        ? { kind: 'enter' }
        : { kind: 'openSettings', step: permissionFirstRequiredStep(this.access) }
    }
    return permissionAccessGrants(this.access, this.step_)
      ? { kind: 'advance' }
      : { kind: 'openSettings', step: this.step_ }
  }

  /** 前进一格，最多到 `ready`；落到 `ready` 但权限没齐则退回第一个缺口。 */
  advance(): void {
    if (this.primaryAction().kind !== 'advance') return
    const next = Math.min(permissionStepIndex(this.step_) + 1, permissionStepIndex('ready'))
    this.step_ = PERMISSION_STEP_ORDER[next]
    if (this.step_ === 'ready' && !permissionAccessAllGranted(this.access)) {
      this.step_ = permissionFirstRequiredStep(this.access)
    }
  }

  /** 复盘模式才允许后退（Swift L70-73）。 */
  previous(): void {
    if (!this.isReview) return
    const next = Math.max(permissionStepIndex(this.step_) - 1, 0)
    this.step_ = PERMISSION_STEP_ORDER[next]
  }
}
