/**
 * 悬浮录制按钮与录制流程。
 *
 * 录制链路：
 *   desktopCapturer 选源 → getUserMedia 拿流 → MediaRecorder 落 webm
 *   → ArrayBuffer 经 IPC 交给主进程写盘（Recordings 目录）
 *   → ffmpeg 转 mp4 → 提示并可一键定位文件。
 *
 * 性能约定（针对「点击卡顿 / 录制掉帧」）：
 *   1. 弹窗立即打开，源列表与缩略图异步补入 —— 点击零等待。
 *   2. MediaRecorder 实例放 useRef，不进 state，避免重渲染与深比较。
 *   3. 录制码率与帧率由屏幕尺寸推导并设上限，避免 VP9 软编打满单核。
 *
 * Swift source: Sources/DogSCApp/AppModel+CaptureLifecycle.swift @ 567fd6e
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Modal, Select, Skeleton, Space, Typography, message } from 'antd'
import { FolderOpenOutlined, LoadingOutlined, VideoCameraOutlined } from '@ant-design/icons'
import type { MediaAsset } from '../core/MediaAsset'

declare global {
  interface Window {
    dogsc: {
      listCaptureSources: (opts?: {
        withThumbnails?: boolean
        thumbnailWidth?: number
      }) => Promise<
        {
          id: string
          name: string
          type: 'screen' | 'window'
          thumbnail: string | null
          appIcon?: string | null
        }[]
      >
      loadThumbnails: (width?: number) => Promise<{ id: string; thumbnail: string | null }[]>
      saveRecording: (data: ArrayBuffer, name?: string) => Promise<{ path: string; dir: string; size: number }>
      exportToMp4: (o: { input: string; output?: string; fps?: number }) => Promise<{
        code: number
        output: string
        dir?: string
        stderr: string
      }>
      describeMedia: (p: string) => Promise<{
        ok: boolean
        path?: string
        name?: string
        duration?: number
        width?: number
        height?: number
        fps?: number
        size?: number
        thumbnails?: string[]
        error?: string
      }>
      importMedia: () => Promise<{
        ok: boolean
        canceled?: boolean
        path?: string
        name?: string
        duration?: number
        width?: number
        height?: number
        fps?: number
        size?: number
        thumbnails?: string[]
        error?: string
      }>
      listRecordings: () => Promise<{ path: string; name: string; size: number; createdAt: number }[]>
      openFile: (p: string) => Promise<boolean>
      adoptMedia: (p: string) => Promise<{ ok: boolean; path?: string; error?: string }>
      exportTimeline: (o: {
        input: string
        segments: { sourceStart: number; sourceDuration: number; playbackRate: number }[]
        output?: string
      }) => Promise<{ code: number; output: string; dir?: string; stderr: string }>
      onExportProgress: (cb: (pct: number) => void) => () => void
      pickBackgroundMedia: () => Promise<{
        ok: boolean
        canceled?: boolean
        kind?: 'image' | 'video'
        path?: string
        error?: string
      }>
      revealFile: (p: string) => Promise<boolean>
      openRecordings: () => Promise<string>
    }
  }
}

interface Props {
  /** 录制完成后回调，把资产交给上层自动导入工程。 */
  onAssetReady: (asset: MediaAsset) => void
}

type Source = Awaited<ReturnType<typeof window.dogsc.listCaptureSources>>[number]

/** 录制参数上限：兼顾画质与 CPU，避免软编吃满单核导致 UI 掉帧。 */
const MAX_LONG_EDGE = 1920
const MAX_FPS = 30
const BITRATE_PER_PIXEL = 0.09 // bpp，经验值：1080p30 ≈ 5.6 Mbps

export default function RecordButton({ onAssetReady }: Props) {
  const [open, setOpen] = useState(false)
  const [loadingSources, setLoadingSources] = useState(false)
  const [sources, setSources] = useState<Source[]>([])
  const [selected, setSelected] = useState<string>()
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)

  // MediaRecorder 与流放 ref：不触发渲染，也避免闭包拿到旧值
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  // 源列表缓存：getSources 单次要 ~3s（系统枚举全部窗口），
  // 启动后预热一次，之后打开弹窗直接命中缓存，点开即见。
  const cacheRef = useRef<{ at: number; list: Source[] } | null>(null)
  const thumbCacheRef = useRef<{ at: number; map: Map<string, string | null> } | null>(null)
  const CACHE_TTL = 15_000

  const freshSources = useCallback(async (): Promise<Source[]> => {
    const c = cacheRef.current
    if (c && Date.now() - c.at < CACHE_TTL) return c.list
    const list = await window.dogsc.listCaptureSources({ withThumbnails: false })
    cacheRef.current = { at: Date.now(), list }
    return list
  }, [])

  const freshThumbnails = useCallback(async (): Promise<Map<string, string | null>> => {
    const c = thumbCacheRef.current
    if (c && Date.now() - c.at < CACHE_TTL) return c.map
    const thumbs = await window.dogsc.loadThumbnails(320)
    const map = new Map(thumbs.map(t => [t.id, t.thumbnail]))
    thumbCacheRef.current = { at: Date.now(), map }
    return map
  }, [])

  // 空闲时静默预热（列表 + 缩略图并行），避开启动竞态
  useEffect(() => {
    const id = window.setTimeout(() => {
      void Promise.allSettled([freshSources(), freshThumbnails()]).then(([l, t]) => {
        if (l.status !== 'fulfilled') return
        if (t.status === 'fulfilled') {
          setSources(
            l.value.map(s => ({ ...s, thumbnail: t.value.get(s.id) ?? s.thumbnail }))
          )
        }
      })
    }, 1200)
    return () => window.clearTimeout(id)
  }, [freshSources, freshThumbnails])

  /**
   * 立即开框，源列表异步补入。
   * 之前是 await 完 getSources 才 setOpen(true)，而 getSources 要逐窗口截图，
   * 窗口多时会卡几百毫秒到一两秒。
   */
  const openPicker = useCallback(() => {
    setOpen(true)
    // 命中缓存就直接填充，弹窗一开就有内容
    if (cacheRef.current) {
      const cachedThumbs = thumbCacheRef.current?.map
      setSources(
        cacheRef.current.list.map(s => ({
          ...s,
          thumbnail: cachedThumbs?.get(s.id) ?? s.thumbnail
        }))
      )
    }
    void refreshSources()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshSources() {
    // 缓存新鲜就不重复枚举，只补缩略图
    const cached = cacheRef.current && Date.now() - cacheRef.current.at < CACHE_TTL
    if (!cached) setLoadingSources(true)

    // 列表与缩略图并行发起：getSources 单次约 3s，串行会翻倍。
    // 缩略图失败不影响列表可用。
    const [listResult, thumbsResult] = await Promise.allSettled([
      freshSources(),
      freshThumbnails()
    ])

    if (listResult.status === 'rejected') {
      setLoadingSources(false)
      const err = listResult.reason
      message.error(`枚举录制源失败：${err instanceof Error ? err.message : String(err)}`)
      return
    }

    const list = listResult.value
    setSources(list)
    setSelected(prev => prev ?? list.find(s => s.type === 'screen')?.id ?? list[0]?.id)
    setLoadingSources(false)

    if (thumbsResult.status === 'fulfilled') {
      const map = thumbsResult.value
      setSources(prev => prev.map(s => ({ ...s, thumbnail: map.get(s.id) ?? s.thumbnail })))
    }
  }

  /** 根据采集到的实际轨道尺寸推导码率，并限制帧率上限。 */
  function pickRecorderOptions(stream: MediaStream): MediaRecorderOptions {
    const settings = stream.getVideoTracks()[0]?.getSettings() ?? {}
    const width = settings.width ?? 1920
    const height = settings.height ?? 1080
    const longEdge = Math.max(width, height)
    const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1
    const w = Math.round(width * scale)
    const h = Math.round(height * scale)
    const bitrate = Math.min(Math.round(w * h * MAX_FPS * BITRATE_PER_PIXEL), 12_000_000)

    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ]
    const mimeType = candidates.find(m => MediaRecorder.isTypeSupported(m)) ?? ''

    return {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: bitrate,
      audioBitsPerSecond: 128_000
    }
  }

  async function startRecording() {
    if (!selected) {
      message.warning('请先选择一个屏幕或窗口')
      return
    }
    setBusy('正在启动采集…')
    const startedAt = Date.now()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // Electron 旧式约束：mandatory 不能与新式的 frameRate:{ideal,max}
          // 或 advanced 混用，否则 Chrome 直接抛
          // "Malformed constraint: Cannot use both optional/mandatory and specific or advanced constraints."
          // 因此帧率也用旧式 min/max 表达。
          // @ts-expect-error chrome 专有字段
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selected,
            maxFrameRate: MAX_FPS,
            minFrameRate: 1
          }
        }
      })
      streamRef.current = stream

      const rec = new MediaRecorder(stream, pickRecorderOptions(stream))
      recorderRef.current = rec
      chunksRef.current = []

      rec.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onerror = e => {
        message.error(`录制出错：${(e as unknown as { error?: Error }).error?.message ?? '未知错误'}`)
        cleanup()
      }
      rec.onstop = () => {
        void handleStop(startedAt)
      }

      // 每 2 秒切一个 chunk，降低单块内存峰值
      rec.start(2000)
      setRecording(true)
      setElapsed(0)
      setOpen(false)
      timerRef.current = window.setInterval(
        () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
        1000
      )
    } catch (err) {
      message.error(`无法开始录制：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  function stopRecording() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    try {
      recorderRef.current?.stop()
    } catch {
      // stop 在非 recording 状态会抛错，忽略
    }
    setRecording(false)
  }

  function cleanup() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    recorderRef.current = null
    setRecording(false)
  }

  /** 停止后：拼 Blob → 交主进程写盘 → ffmpeg 转 mp4。 */
  async function handleStop(startedAt: number) {
    const chunks = chunksRef.current
    chunksRef.current = []
    cleanup()

    if (chunks.length === 0) {
      message.warning('没有录到任何数据')
      return
    }

    const key = 'export'
    setBusy('正在保存录制…')
    message.loading({ content: '正在保存录制…', key, duration: 0 })

    try {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const buffer = await blob.arrayBuffer()

      const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const saved = await window.dogsc.saveRecording(buffer, `DogSC_${stamp}`)

      message.loading({ content: '正在转码 mp4…', key, duration: 0 })
      const r = await window.dogsc.exportToMp4({ input: saved.path, fps: MAX_FPS })

      if (r.code === 0) {
        // 自动导入：录制完成即成为当前项目（对齐原版 Recording → Project 语义）
        message.loading({ content: '正在载入到编辑器…', key, duration: 0 })
        const desc = await window.dogsc.describeMedia(r.output)
        if (desc.ok && desc.path) {
          onAssetReady({
            id: `rec-${Date.now()}`,
            path: desc.path,
            name: desc.name ?? '录制',
            duration: desc.duration ?? 0,
            width: desc.width ?? 0,
            height: desc.height ?? 0,
            fps: desc.fps ?? 0,
            size: desc.size ?? 0,
            origin: 'recording',
            createdAt: Date.now(),
            thumbnails: desc.thumbnails ?? [],
          })
          message.success({ content: '录制完成，已载入编辑器', key, duration: 3 })
        } else {
          message.success({
            content: (
              <Space>
                <span>已保存 mp4（载入编辑器失败）</span>
                <Typography.Link onClick={() => window.dogsc.revealFile(r.output)}>
                  打开所在文件夹
                </Typography.Link>
              </Space>
            ),
            key,
            duration: 6
          })
        }
      } else {
        // webm 已经落盘，即便转码失败用户也不至于丢失录制
        message.error({
          content: (
            <Space direction="vertical" size={2}>
              <span>转码失败，但 webm 已保留</span>
              <Typography.Link onClick={() => window.dogsc.revealFile(saved.path)}>
                打开 webm 所在文件夹
              </Typography.Link>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {r.stderr.slice(-200)}
              </Typography.Text>
            </Space>
          ),
          key,
          duration: 10
        })
      }
    } catch (err) {
      message.error({
        content: `保存失败：${err instanceof Error ? err.message : String(err)}`,
        key,
        duration: 8
      })
    } finally {
      setBusy(null)
    }
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <>
      <Button
        type="primary"
        danger={recording}
        shape="circle"
        size="large"
        icon={busy ? <LoadingOutlined /> : <VideoCameraOutlined />}
        disabled={!!busy}
        onClick={recording ? stopRecording : openPicker}
        style={{ position: 'absolute', right: 24, bottom: 16, width: 48, height: 48 }}
      />
      {recording && (
        <div
          style={{
            position: 'absolute',
            right: 80,
            bottom: 26,
            color: '#ff4d4f',
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          ● {mmss}
        </div>
      )}

      <Modal
        title="选择录制源"
        open={open}
        onOk={startRecording}
        onCancel={() => setOpen(false)}
        okText="开始录制"
        cancelText="取消"
        width={640}
        okButtonProps={{ disabled: loadingSources || !selected, loading: !!busy }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {loadingSources && sources.length === 0 ? (
            <Skeleton active paragraph={{ rows: 2 }} />
          ) : (
            <Select
              style={{ width: '100%' }}
              placeholder="选择屏幕或窗口"
              value={selected}
              onChange={setSelected}
              showSearch
              optionFilterProp="label"
              options={sources.map(s => ({
                value: s.id,
                label: `${s.type === 'screen' ? '屏幕' : '窗口'} · ${s.name || s.id}`
              }))}
              optionRender={o => {
                const src = sources.find(s => s.id === o.value)
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {src?.thumbnail ? (
                      <img src={src.thumbnail} style={{ width: 64, borderRadius: 4 }} />
                    ) : (
                      <div
                        style={{
                          width: 64,
                          height: 36,
                          borderRadius: 4,
                          background: 'rgba(128,128,128,0.18)',
                          flexShrink: 0
                        }}
                      />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {o.label}
                      </span>
                      <span style={{ color: '#888', fontSize: 12 }}>
                        {src?.type === 'screen' ? '整屏采集' : '单个窗口'}
                      </span>
                    </div>
                  </div>
                )
              }}
            />
          )}

          {sources.length > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              共 {sources.length} 个可采集对象 · 上限 {MAX_LONG_EDGE}p / {MAX_FPS}fps，
              录制时请避免同时进行其他重负载操作
            </Typography.Text>
          )}

          <Button icon={<FolderOpenOutlined />} onClick={() => void window.dogsc.openRecordings()} block>
            打开录制目录
          </Button>
        </Space>
      </Modal>
    </>
  )
}
