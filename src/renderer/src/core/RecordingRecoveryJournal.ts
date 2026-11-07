/**
 * 录制恢复日志 —— Swift RecordingRecoveryJournal.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/RecordingRecoveryJournal.swift（44 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐行对照（Swift 行号 → 本文件）：
 *   - struct RecordingRecoverySnapshot   L7-18  → RecordingRecoverySnapshot / makeRecordingRecoverySnapshot
 *   - actor RecordingRecoveryJournal     L23-44 → RecordingRecoveryJournal
 *
 * 原注释（L20-22）：
 *   Orders every recording-time recovery write away from MainActor. Final-state
 *   writes use the same actor, so an in-flight heartbeat can never overwrite a
 *   later `complete`, `failed` or `discarded` manifest.
 *
 * 即：**所有写入都排在同一个串行队列里**。心跳写与终态写共用队列，因此进行中的
 * 心跳永远不可能覆盖更晚的终态清单。TS 侧用 Promise 链实现同一条串行语义。
 */

import type { CameraCaptureDiagnostics } from './CameraCaptureDiagnostics'
import type { AudioCaptureDiagnostics } from './AudioCaptureDiagnostics'
import type { FrameRateMeasurement, OutputFrameRate } from './CaptureConfiguration'
import type { RecordingPerformanceSample, RecordingPerformanceSummary } from './RecordingPerformanceDiagnostics'

/** Swift L17 默认主屏相对路径。 */
export const RECOVERY_DEFAULT_SCREEN_RELATIVE_PATH = 'media/screen-0001.mp4'

/** 恢复清单里的状态字符串（Swift 侧为 String）。 */
export type RecordingRecoveryState =
  | 'preparing'
  | 'recording'
  | 'paused'
  | 'finalizing'
  | 'complete'
  | 'failed'
  | 'discarded'
  | (string & {})

/** Swift L7-18：一次恢复检查点的不可变输入。 */
export interface RecordingRecoverySnapshot {
  readonly state: RecordingRecoveryState
  readonly session: unknown
  readonly frameRate: OutputFrameRate
  readonly measurement?: FrameRateMeasurement | null
  readonly cameraDiagnostics?: CameraCaptureDiagnostics | null
  readonly systemAudioDiagnostics?: AudioCaptureDiagnostics | null
  readonly microphoneDiagnostics?: AudioCaptureDiagnostics | null
  readonly performanceMonitor?: RecordingPerformanceMonitorPort | null
  readonly appendsPerformanceSample: boolean
  readonly screenRelativePath: string
}

/** `RecordingPerformanceMonitor` 的最小端口（Swift 的 `sample()` / `summary`）。 */
export interface RecordingPerformanceMonitorPort {
  sample(): RecordingPerformanceSample
  readonly summary: RecordingPerformanceSummary
}

export function makeRecordingRecoverySnapshot(init: {
  state: RecordingRecoveryState
  session: unknown
  frameRate: OutputFrameRate
} & Partial<Omit<RecordingRecoverySnapshot, 'state' | 'session' | 'frameRate'>>): RecordingRecoverySnapshot {
  return {
    state: init.state,
    session: init.session,
    frameRate: init.frameRate,
    measurement: init.measurement ?? null,
    cameraDiagnostics: init.cameraDiagnostics ?? null,
    systemAudioDiagnostics: init.systemAudioDiagnostics ?? null,
    microphoneDiagnostics: init.microphoneDiagnostics ?? null,
    performanceMonitor: init.performanceMonitor ?? null,
    appendsPerformanceSample: init.appendsPerformanceSample ?? false,
    screenRelativePath: init.screenRelativePath ?? RECOVERY_DEFAULT_SCREEN_RELATIVE_PATH
  }
}

/** Swift `ProjectStore` 的两次写入（主进程实现）。 */
export interface RecordingRecoveryStore {
  appendRecordingPerformanceSample(sample: RecordingPerformanceSample, session: unknown): void | Promise<void>
  writeRecoveryManifest(fields: {
    state: RecordingRecoveryState
    session: unknown
    frameRate: OutputFrameRate
    measurement: FrameRateMeasurement | null
    cameraDiagnostics: CameraCaptureDiagnostics | null
    systemAudioDiagnostics: AudioCaptureDiagnostics | null
    microphoneDiagnostics: AudioCaptureDiagnostics | null
    performanceSummary: RecordingPerformanceSummary | null
    screenRelativePath: string
  }): void | Promise<void>
}

/**
 * Swift L23-44 `actor RecordingRecoveryJournal`。
 *
 * 顺序不可交换：先追加性能样本（仅当 `appendsPerformanceSample` 且监视器有样本），
 * 再写恢复清单并带上**此刻**的 `summary`。
 */
export class RecordingRecoveryJournal {
  private tail: Promise<void> = Promise.resolve()
  private lastError: unknown = null

  constructor(private readonly store: RecordingRecoveryStore) {}

  /** 串行执行：任何一次 persist 都排在前一次之后。 */
  private enqueue(task: () => Promise<void> | void): Promise<void> {
    const run = this.tail.then(task, task)
    // 队列本身不因单次失败而断裂（Swift 里错误抛给调用方，调用方自行处理）。
    this.tail = run.then(
      () => undefined,
      (error) => {
        this.lastError = error
      }
    )
    return run
  }

  /** 最近一次失败（便于在 UI 上报一次，而不必监听每次心跳）。 */
  get pendingError(): unknown {
    return this.lastError
  }

  /** Swift L24-43。 */
  persist(snapshot: RecordingRecoverySnapshot): Promise<void> {
    return this.enqueue(async () => {
      if (snapshot.appendsPerformanceSample && snapshot.performanceMonitor != null) {
        const sample = snapshot.performanceMonitor.sample()
        await this.store.appendRecordingPerformanceSample(sample, snapshot.session)
      }
      await this.store.writeRecoveryManifest({
        state: snapshot.state,
        session: snapshot.session,
        frameRate: snapshot.frameRate,
        measurement: snapshot.measurement ?? null,
        cameraDiagnostics: snapshot.cameraDiagnostics ?? null,
        systemAudioDiagnostics: snapshot.systemAudioDiagnostics ?? null,
        microphoneDiagnostics: snapshot.microphoneDiagnostics ?? null,
        performanceSummary: snapshot.performanceMonitor?.summary ?? null,
        screenRelativePath: snapshot.screenRelativePath
      })
    })
  }

  /** 等待队列清空（关闭工程 / 测试用）。 */
  async drain(): Promise<void> {
    await this.tail
  }
}
