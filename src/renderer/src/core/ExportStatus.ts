/**
 * 导出状态与耗时估算 —— Swift ExportStatus.swift 的 TypeScript 转写。
 *
 * Swift source: Sources/DogSCApp/ExportStatus.swift（85 行）
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 逐结构对照（Swift 行号 → 本文件）：
 *   - enum ExportStage             L3-14  → ExportStage / exportStageTitle
 *   - struct ExportStatus          L18-46 → ExportStatus + 三个标签
 *   - struct ExportTimeEstimator   L48-85 → ExportTimeEstimator
 *
 * 原注释（L16-17）：
 *   One-second UI telemetry; media workers still use the coalesced progress
 *   relay. Uptime avoids wall-clock changes and no timer survives a finished job.
 */

/** Swift L3-4：`Int` rawValue 顺序即阶段顺序。 */
export const EXPORT_STAGES = ['preparing', 'processing', 'finishing', 'cancelling'] as const
export type ExportStage = (typeof EXPORT_STAGES)[number]

export function exportStageRawValue(stage: ExportStage): number {
  return EXPORT_STAGES.indexOf(stage)
}

export function exportStageFromRawValue(rawValue: number): ExportStage | null {
  return EXPORT_STAGES[rawValue] ?? null
}

/** Swift L6-13：只有 `processing` 区分纯音频。 */
export function exportStageTitle(stage: ExportStage, audioOnly: boolean): string {
  switch (stage) {
    case 'preparing':
      return '正在准备素材'
    case 'processing':
      return audioOnly ? '正在处理音频' : '正在合成与编码'
    case 'finishing':
      return '正在完成文件'
    case 'cancelling':
      return '正在取消导出'
  }
}

/** Swift L18-46。 */
export interface ExportStatus {
  readonly stage: ExportStage
  readonly elapsed: number
  readonly remaining: number | null
  readonly secondsWithoutProgress: number
  readonly audioOnly: boolean
}

/** Swift 默认值：`.preparing` / 0 / nil / 0 / false。 */
export function makeExportStatus(overrides: Partial<ExportStatus> = {}): ExportStatus {
  return {
    stage: overrides.stage ?? 'preparing',
    elapsed: overrides.elapsed ?? 0,
    remaining: overrides.remaining ?? null,
    secondsWithoutProgress: overrides.secondsWithoutProgress ?? 0,
    audioOnly: overrides.audioOnly ?? false
  }
}

export function exportStatusTitle(status: ExportStatus): string {
  return exportStageTitle(status.stage, status.audioOnly)
}

export function exportStatusElapsedLabel(status: ExportStatus): string {
  return `已用时 ${exportDurationText(status.elapsed)}`
}

/** Swift L29-37 的五级优先级，顺序不可调整。 */
export function exportStatusRemainingLabel(status: ExportStatus): string {
  if (status.stage === 'cancelling') return '正在释放导出资源…'
  if (status.secondsWithoutProgress >= 20) return '暂未收到新进度，可继续等待或取消后重试'
  if (status.stage === 'finishing') return '正在写入最终文件…'
  if (status.remaining == null) return '正在估算剩余时间…'
  return `预计剩余约 ${exportDurationText(status.remaining)}`
}

/**
 * Swift L39-45：
 *   let value = max(Int(seconds.isFinite ? seconds.rounded(.up) : 0), 0)
 *
 * 即**向上取整**（4.2s → 0:05），非有限值按 0；≥1 小时走 `h:mm:ss`。
 */
export function exportDurationText(seconds: number): string {
  const value = Math.max(Math.trunc(Number.isFinite(seconds) ? Math.ceil(seconds) : 0), 0)
  if (value >= 3600) {
    const h = Math.floor(value / 3600)
    const m = Math.floor(value / 60) % 60
    const s = value % 60
    return `${h}:${pad2(m)}:${pad2(s)}`
  }
  return `${Math.floor(value / 60)}:${pad2(value % 60)}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** Swift L48-53 的内部样本。 */
interface EstimatorSample {
  readonly time: number
  readonly progress: number
}

/**
 * Swift L48-85。
 *
 * 原注释（L75-77）：
 *   Effects can change encoding speed substantially. Hide an estimate when the
 *   recent and earlier halves disagree instead of counting down a number that
 *   no longer describes the current workload.
 *
 * 也就是「宁可显示估算中，也不显示一个已经开始说谎的倒计时」。
 */
export class ExportTimeEstimator {
  private samples: EstimatorSample[] = []
  private lastProgress = 0
  private lastAdvance = 0

  /** Swift L54-58。 */
  restart(elapsed: number, progress: number): void {
    this.samples = []
    this.lastProgress = progress
    this.lastAdvance = elapsed
  }

  /** Swift L60-84。 */
  sample(elapsed: number, progress: number): { remaining: number | null; idle: number } {
    // L61-64：进度真的前进了才更新「最后一次前进」
    if (progress > this.lastProgress + 0.000001) {
      this.lastProgress = progress
      this.lastAdvance = elapsed
    }
    this.samples.push({ time: elapsed, progress })
    // L66：只保留最近 24 秒
    this.samples = this.samples.filter((sample) => sample.time >= elapsed - 24)
    const idle = Math.max(elapsed - this.lastAdvance, 0)

    const first = this.samples[0]
    if (
      !(idle < 5) ||
      !(progress >= 0.03) ||
      !(progress < 1) ||
      first == null ||
      !(elapsed - first.time >= 10)
    ) {
      return { remaining: null, idle }
    }
    const midpoint = (first.time + elapsed) / 2
    const middle = this.samples.find((sample) => sample.time >= midpoint)
    if (middle == null) return { remaining: null, idle }

    const firstRate = (middle.progress - first.progress) / Math.max(middle.time - first.time, 0.001)
    const lastRate = (progress - middle.progress) / Math.max(elapsed - middle.time, 0.001)
    // L78-79：近期与前半段速率比值必须落在 0.65…1.55，否则隐藏估算
    if (!(firstRate > 0) || !(lastRate > 0)) return { remaining: null, idle }
    const ratio = lastRate / firstRate
    if (!(ratio >= 0.65 && ratio <= 1.55)) return { remaining: null, idle }

    const rate = (progress - first.progress) / (elapsed - first.time)
    const estimate = (1 - progress) / rate
    if (!Number.isFinite(estimate) || !(estimate > 0)) return { remaining: null, idle }
    // L83：向上取整到 5 秒，避免显示跳动的小数
    return { remaining: Math.ceil(estimate / 5) * 5, idle }
  }
}
