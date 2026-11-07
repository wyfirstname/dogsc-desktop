/**
 * 屏幕拓扑 —— Swift ScreenTopology.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/ScreenTopology.swift（313 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐结构对照（Swift 行号 → 本文件）：
 *   - struct ScreenTopologyNode                     L8-39   → ScreenTopologyNode + 两个 facts
 *   - struct ScreenTopologySnapshot                 L43-112 → ScreenTopologySnapshot
 *       · init(generation:nodes:mainDisplayID:)             L48-58
 *       · nodes / node(for:)                                L60-66
 *       · assigningGeneration(_:)                           L68-74
 *       · current(generation:)                              L76-111 → 由注入的节点列表承担
 *   - struct ScreenTopologyDelta                    L116-158 → ScreenTopologyDelta.between
 *   - struct ScreenTopologyReconfigurationState     L163-183 → ScreenTopologyReconfigurationState
 *   - class ScreenTopologyObserverLease             L189-214 → 取消语义并入 monitor
 *   - class ScreenTopologyMonitor                   L221-313 → ScreenTopologyMonitor
 *
 * 原注释（L41-42）：
 *   One stable, post-reconfiguration view of all active screens. Display IDs are
 *   the only keys; neither array order nor localized display names are identity.
 *
 * 原注释（L99-102）：
 *   `NSScreen.main` follows the key window and can therefore change from an
 *   ordinary focus switch. CoreGraphics is the stable identity of the display
 *   configured as the system's main display.
 */

/** 矩形（AppKit 坐标：原点左下，y 向上）。 */
export interface TopologyRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface TopologySize {
  readonly width: number
  readonly height: number
}

/** Swift L8-39：一台当前活动的屏幕。 */
export interface ScreenTopologyNode {
  readonly id: number
  readonly name: string
  readonly frame: TopologyRect
  readonly visibleFrame: TopologyRect
  readonly pixelSize: TopologySize
  readonly backingScale: number
  readonly maximumFramesPerSecond: number
}

/** Swift L29-32：只参与「几何变化」比较的字段。 */
export function screenTopologyGeometryFacts(node: ScreenTopologyNode): string {
  return rectKey(node.frame) + '|' + rectKey(node.visibleFrame)
}

/** Swift L34-38：只参与「模式变化」比较的字段。 */
export function screenTopologyModeFacts(node: ScreenTopologyNode): string {
  return (
    `${node.pixelSize.width}x${node.pixelSize.height}` +
    `@${node.backingScale}` +
    `#${node.maximumFramesPerSecond}`
  )
}

function rectKey(r: TopologyRect): string {
  return `${r.x},${r.y},${r.width},${r.height}`
}

/** Swift L76-98 的值语义部分：像素尺寸/缩放/帧率至少为 1。 */
export function makeScreenTopologyNode(fields: {
  id: number
  name: string
  frame: TopologyRect
  visibleFrame: TopologyRect
  pixelWidth: number
  pixelHeight: number
  backingScale: number
  maximumFramesPerSecond: number
}): ScreenTopologyNode {
  return {
    id: fields.id,
    name: fields.name,
    frame: fields.frame,
    visibleFrame: fields.visibleFrame,
    pixelSize: {
      width: Math.max(fields.pixelWidth, 1),
      height: Math.max(fields.pixelHeight, 1)
    },
    backingScale: Math.max(fields.backingScale, 1),
    maximumFramesPerSecond: Math.max(fields.maximumFramesPerSecond, 1)
  }
}

/** Swift L43-112。 */
export class ScreenTopologySnapshot {
  readonly generation: number
  readonly nodesByID: ReadonlyMap<number, ScreenTopologyNode>
  readonly mainDisplayID: number | null

  /** Swift L48-58：`uniquingKeysWith: { _, newest in newest }` —— 后者胜出。 */
  constructor(generation: number, nodes: readonly ScreenTopologyNode[], mainDisplayID: number | null) {
    this.generation = generation
    const map = new Map<number, ScreenTopologyNode>()
    for (const node of nodes) map.set(node.id, node)
    this.nodesByID = map
    this.mainDisplayID = mainDisplayID
  }

  /** Swift L60-62：按 id 升序 —— 数组顺序与本地化名称都不是身份。 */
  get nodes(): ScreenTopologyNode[] {
    return [...this.nodesByID.values()].sort((a, b) => a.id - b.id)
  }

  /** Swift L64-66。 */
  node(displayID: number): ScreenTopologyNode | null {
    return this.nodesByID.get(displayID) ?? null
  }

  /** Swift L68-74。 */
  assigningGeneration(replacement: number): ScreenTopologySnapshot {
    return new ScreenTopologySnapshot(replacement, this.nodes, this.mainDisplayID)
  }

  /**
   * Swift L102-105：系统主屏 id 必须**真的在列表里**才算数，否则为 null。
   */
  static mainDisplayIDFor(nodes: readonly ScreenTopologyNode[], systemMainDisplayID: number): number | null {
    return nodes.some((node) => node.id === systemMainDisplayID) ? systemMainDisplayID : null
  }

  equals(other: ScreenTopologySnapshot): boolean {
    if (this.generation !== other.generation || this.mainDisplayID !== other.mainDisplayID) return false
    if (this.nodesByID.size !== other.nodesByID.size) return false
    for (const [id, node] of this.nodesByID) {
      const otherNode = other.nodesByID.get(id)
      if (otherNode == null) return false
      if (screenTopologyNodeEquals(node, otherNode)) continue
      return false
    }
    return true
  }
}

export function screenTopologyNodeEquals(a: ScreenTopologyNode, b: ScreenTopologyNode): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    screenTopologyGeometryFacts(a) === screenTopologyGeometryFacts(b) &&
    screenTopologyModeFacts(a) === screenTopologyModeFacts(b)
  )
}

/** Swift L116-158：两次稳定快照之间的分类差异。 */
export class ScreenTopologyDelta {
  readonly previousGeneration: number
  readonly generation: number
  readonly added: ReadonlySet<number>
  readonly removed: ReadonlySet<number>
  readonly geometryChanged: ReadonlySet<number>
  readonly modeChanged: ReadonlySet<number>
  readonly mainChanged: boolean

  private constructor(fields: {
    previousGeneration: number
    generation: number
    added: ReadonlySet<number>
    removed: ReadonlySet<number>
    geometryChanged: ReadonlySet<number>
    modeChanged: ReadonlySet<number>
    mainChanged: boolean
  }) {
    this.previousGeneration = fields.previousGeneration
    this.generation = fields.generation
    this.added = fields.added
    this.removed = fields.removed
    this.geometryChanged = fields.geometryChanged
    this.modeChanged = fields.modeChanged
    this.mainChanged = fields.mainChanged
  }

  /** Swift L125-131。 */
  get isEmpty(): boolean {
    return (
      this.added.size === 0 &&
      this.removed.size === 0 &&
      this.geometryChanged.size === 0 &&
      this.modeChanged.size === 0 &&
      !this.mainChanged
    )
  }

  /**
   * Swift L133-157。
   * 同一块屏可能同时出现在 `geometryChanged` 与 `modeChanged` 里
   * （一次重配置同时改了位置和分辨率）。
   */
  static between(
    previous: ScreenTopologySnapshot,
    replacement: ScreenTopologySnapshot
  ): ScreenTopologyDelta {
    const previousIDs = new Set(previous.nodesByID.keys())
    const replacementIDs = new Set(replacement.nodesByID.keys())
    const commonIDs = [...previousIDs].filter((id) => replacementIDs.has(id))

    const geometryChanged = new Set<number>()
    const modeChanged = new Set<number>()
    for (const displayID of commonIDs) {
      const before = previous.nodesByID.get(displayID)
      const after = replacement.nodesByID.get(displayID)
      if (before == null || after == null) continue
      if (screenTopologyGeometryFacts(before) !== screenTopologyGeometryFacts(after)) {
        geometryChanged.add(displayID)
      }
      if (screenTopologyModeFacts(before) !== screenTopologyModeFacts(after)) {
        modeChanged.add(displayID)
      }
    }

    return new ScreenTopologyDelta({
      previousGeneration: previous.generation,
      generation: replacement.generation,
      added: new Set([...replacementIDs].filter((id) => !previousIDs.has(id))),
      removed: new Set([...previousIDs].filter((id) => !replacementIDs.has(id))),
      geometryChanged,
      modeChanged,
      mainChanged: previous.mainDisplayID !== replacement.mainDisplayID
    })
  }
}

/** Swift L163-183：用于作废「在旧拓扑下捕获的工作」。 */
export class ScreenTopologyReconfigurationState {
  private _generation: number

  constructor(generation = 0) {
    this._generation = generation
  }

  get generation(): number {
    return this._generation
  }

  /**
   * Swift `&+= 1`：无符号回绕加。JS 数字在 2^53 之后就不精确，但代次在进程生命周期
   * 内不可能达到该量级，这里按 2^64 取模表达同一语义。
   */
  advance(): number {
    this._generation = wrapUInt64(this._generation + 1)
    return this._generation
  }

  invalidate(): void {
    this._generation = wrapUInt64(this._generation + 1)
  }

  isCurrent(candidate: number): boolean {
    return candidate === this._generation
  }
}

const UINT64_MODULUS = 18446744073709551616

function wrapUInt64(value: number): number {
  if (value < UINT64_MODULUS) return value
  return value % UINT64_MODULUS
}

/**
 * Swift L221-313：应用级「稳定屏幕事实」来源。它不持有采集状态、不改选区/窗口。
 */
export class ScreenTopologyMonitor {
  private _snapshot: ScreenTopologySnapshot
  onChange: ((snapshot: ScreenTopologySnapshot, delta: ScreenTopologyDelta) => void) | null = null

  private readonly snapshotProvider: (generation: number) => ScreenTopologySnapshot
  private readonly scheduleStableRefresh: (operation: () => void) => void
  private readonly reconfigurationState: ScreenTopologyReconfigurationState
  private running = false
  private refreshIsScheduled = false
  private lifecycleGeneration = 0

  constructor(options: {
    snapshotProvider: (generation: number) => ScreenTopologySnapshot
    scheduleStableRefresh?: (operation: () => void) => void
  }) {
    this.snapshotProvider = options.snapshotProvider
    this.scheduleStableRefresh =
      options.scheduleStableRefresh ??
      ((operation) => {
        const handle = setTimeout(operation, 0)
        if (typeof handle === 'object' && handle != null && 'unref' in handle) {
          ;(handle as { unref?: () => void }).unref?.()
        }
      })
    // Swift L254：初次快照的代次强制归零
    const initial = options.snapshotProvider(0).assigningGeneration(0)
    this._snapshot = initial
    this.reconfigurationState = new ScreenTopologyReconfigurationState(initial.generation)
  }

  get snapshot(): ScreenTopologySnapshot {
    return this._snapshot
  }

  get isRunning(): boolean {
    return this.running
  }

  /** Swift L263-279。重复 start 是空操作。 */
  start(): void {
    if (this.running) return
    this.running = true
    this.lifecycleGeneration = wrapUInt64(this.lifecycleGeneration + 1)
  }

  /** Swift L281-286：停止会作废所有在途的刷新。 */
  stop(): void {
    this.lifecycleGeneration = wrapUInt64(this.lifecycleGeneration + 1)
    this.refreshIsScheduled = false
    this.running = false
  }

  /**
   * Swift L292-304：系统通知到达后先合并成一次「稳定刷新」。
   * 期间 lifecycleGeneration 变了（stop 或重启）就丢弃这次刷新。
   */
  screenParametersDidChange(): void {
    if (!this.running || this.refreshIsScheduled) return
    this.refreshIsScheduled = true
    const scheduledLifecycleGeneration = this.lifecycleGeneration
    this.scheduleStableRefresh(() => {
      if (!this.running) return
      if (this.lifecycleGeneration !== scheduledLifecycleGeneration) return
      if (!this.refreshIsScheduled) return
      this.refreshIsScheduled = false
      this.publishStableSnapshot()
    })
  }

  /** Swift L306-312。 */
  private publishStableSnapshot(): void {
    const generation = this.reconfigurationState.advance()
    const replacement = this.snapshotProvider(generation).assigningGeneration(generation)
    const delta = ScreenTopologyDelta.between(this._snapshot, replacement)
    this._snapshot = replacement
    this.onChange?.(replacement, delta)
  }
}
