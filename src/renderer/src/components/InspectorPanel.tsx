/**
 * 检查器面板：右侧参数区，对应原版的 EditorInspectorView。
 *
 * Swift source: Sources/DogSCApp/EditorInspectorView.swift @ 567fd6e
 * 原版标签页：画面（比例/背景/样机）、运镜（缩放/跟随/3D）、
 *            光标（样式/点击反馈）、音频、导出设置。
 *
 * 当前状态：
 *   - 画面页：背景来源（图案/动态流/图片/视频）+ 密度/不透明度/圆角/阴影/边框 全部接通真实状态
 *   - 开场页：转场预设/时长/错峰/开关，实时驱动画布入场动画
 *   - 光标页：资源/大小/点击反馈 全部接通真实状态（预览覆盖层实时呈现）
 *   - 运镜页：3D 部分已接通真实状态；跟随/自动缩放待 PointerTrack 转写
 *   - 音频页：仍是布局骨架
 */
import { Tabs, Segmented, Slider, Switch, Select, Space, Button, Row, Col, ColorPicker, InputNumber } from 'antd'
import {
  ReloadOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  PictureOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import type { ScreenMotionState } from '../core/ScreenTransform'
import { DEFAULT_SCREEN_MOTION, isIdentityMotion } from '../core/ScreenTransform'
import type {
  BackgroundSource,
  CanvasStyle,
  CursorClickEffectStyle,
  CursorStyle,
  OpeningSequence,
} from '../core/ProjectModel'
import {
  BACKGROUND_PATTERN_PRESETS,
  CURSOR_ASSET_TOUCH_DOT,
  DYNAMIC_BACKGROUND_PRESETS,
  dynamicBackgroundDisplayName,
} from '../core/ProjectModel'
import { CLICK_EFFECT_OPTIONS, CURSOR_ASSET_OPTIONS } from '../core/BackgroundRender'

export interface InspectorPanelProps {
  activeTab: string
  onTabChange: (k: string) => void
  motion: ScreenMotionState
  onMotionChange: (next: ScreenMotionState) => void
  canvasStyle: CanvasStyle
  onCanvasStyleChange: (next: CanvasStyle) => void
  cursorStyle: CursorStyle
  onCursorStyleChange: (next: CursorStyle) => void
  opening: OpeningSequence
  onOpeningChange: (next: OpeningSequence) => void
  onPickBackgroundMedia: () => void
}

export default function InspectorPanel(props: InspectorPanelProps) {
  return (
    <div style={{ padding: '12px 16px', height: '100%', overflowY: 'auto' }}>
      <Tabs
        activeKey={props.activeTab}
        onChange={props.onTabChange}
        size="small"
        items={[
          {
            key: 'canvas',
            label: '画面',
            children: (
              <CanvasTab
                canvasStyle={props.canvasStyle}
                onChange={props.onCanvasStyleChange}
                onPickBackgroundMedia={props.onPickBackgroundMedia}
              />
            ),
          },
          {
            key: 'motion',
            label: '运镜',
            children: (
              <MotionTab motion={props.motion} onMotionChange={props.onMotionChange} />
            ),
          },
          {
            key: 'opening',
            label: '转场',
            children: (
              <OpeningTab opening={props.opening} onChange={props.onOpeningChange} />
            ),
          },
          {
            key: 'cursor',
            label: '光标',
            children: (
              <CursorTab cursorStyle={props.cursorStyle} onChange={props.onCursorStyleChange} />
            ),
          },
          { key: 'audio', label: '音频', children: <AudioTab /> },
        ]}
      />
    </div>
  )
}

// ---------------------------------------------------------------- 画面

/** 「画面」页：背景来源 + 画布外观，全部受控（对应 EditorBackgroundInspector） */
function CanvasTab(props: {
  canvasStyle: CanvasStyle
  onChange: (next: CanvasStyle) => void
  onPickBackgroundMedia: () => void
}) {
  const { canvasStyle, onChange } = props
  const patch = (part: Partial<CanvasStyle>) => onChange({ ...canvasStyle, ...part })
  const source = canvasStyle.backgroundSource

  const setSource = (next: BackgroundSource) => patch({ backgroundSource: next })

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Field label="背景来源">
        <Segmented
          block
          size="small"
          value={source.kind === 'pattern' ? 'pattern' : source.kind === 'dynamicFlow' ? 'dynamicFlow' : 'media'}
          options={[
            { value: 'pattern', label: '图案' },
            { value: 'dynamicFlow', label: '动态' },
            { value: 'media', label: '媒体' },
          ]}
          onChange={v => {
            if (v === 'pattern') setSource({ kind: 'pattern', patternPreset: BACKGROUND_PATTERN_PRESETS[0] })
            else if (v === 'dynamicFlow')
              setSource({ kind: 'dynamicFlow', dynamicPreset: DYNAMIC_BACKGROUND_PRESETS[0] })
            else props.onPickBackgroundMedia()
          }}
        />
      </Field>

      {source.kind === 'pattern' && (
        <Field label="图案预设">
          <Select
            size="small"
            style={{ width: '100%' }}
            value={source.patternPreset}
            options={BACKGROUND_PATTERN_PRESETS.map(p => ({ value: p, label: p }))}
            onChange={v => setSource({ kind: 'pattern', patternPreset: v })}
          />
        </Field>
      )}

      {source.kind === 'dynamicFlow' && (
        <Field label="动态预设">
          <Select
            size="small"
            style={{ width: '100%' }}
            value={source.dynamicPreset}
            options={DYNAMIC_BACKGROUND_PRESETS.map(p => ({ value: p, label: dynamicBackgroundDisplayName(p) }))}
            onChange={v => setSource({ kind: 'dynamicFlow', dynamicPreset: v })}
          />
        </Field>
      )}

      {(source.kind === 'projectImage' ||
        source.kind === 'systemImage' ||
        source.kind === 'projectVideo' ||
        source.kind === 'systemVideo') && (
        <Field label={source.kind.includes('Image') ? '背景图片' : '背景视频'}>
          <Button size="small" icon={source.kind.includes('Image') ? <PictureOutlined /> : <VideoCameraOutlined />} onClick={props.onPickBackgroundMedia}>
            重新选择文件
          </Button>
        </Field>
      )}

      <Field label={`背景不透明度 ${(canvasStyle.patternOpacity * 100).toFixed(0)}%`}>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={canvasStyle.patternOpacity}
          onChange={v => patch({ patternOpacity: v })}
          style={{ width: '100%' }}
        />
      </Field>

      <Field label={`图案密度 ${canvasStyle.patternScale.toFixed(2)}×`}>
        <Slider
          min={0.4}
          max={6}
          step={0.05}
          value={canvasStyle.patternScale}
          onChange={v => patch({ patternScale: v })}
          style={{ width: '100%' }}
        />
      </Field>

      <Field label={`圆角 ${canvasStyle.cornerRadius}px`}>
        <Slider
          min={0}
          max={64}
          value={canvasStyle.cornerRadius}
          onChange={v => patch({ cornerRadius: v })}
          style={{ width: '100%' }}
        />
      </Field>

      <Field label={`阴影强度 ${(canvasStyle.shadowStrength * 100).toFixed(0)}%`}>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={canvasStyle.shadowStrength}
          onChange={v => patch({ shadowStrength: v })}
          style={{ width: '100%' }}
        />
      </Field>

      <Field label="边框">
        <Row gutter={8}>
          <Col span={12}>
            <InputNumber
              size="small"
              min={0}
              max={24}
              value={canvasStyle.borderWidth}
              onChange={v => patch({ borderWidth: v ?? 0 })}
              addonAfter="px"
              style={{ width: '100%' }}
            />
          </Col>
          <Col span={12}>
            <ColorPicker
              size="small"
              value={canvasStyle.borderColor}
              onChange={c => patch({ borderColor: c.toHexString() })}
              showText
            />
          </Col>
        </Row>
      </Field>
    </Space>
  )
}

// ---------------------------------------------------------------- 开场转场

/** 「转场」页：开场时间线（对应 EditorOpeningTimeline / ProjectOpening） */
function OpeningTab(props: { opening: OpeningSequence; onChange: (next: OpeningSequence) => void }) {
  const { opening, onChange } = props
  const patch = (part: Partial<OpeningSequence>) => {
    const next = { ...opening, ...part }
    // 时长/错峰约束由 makeOpeningSequence 的归一化语义负责，这里手动夹取
    next.duration = Math.min(Math.max(next.duration, 0.4), 8)
    const gapCount = Math.max(next.includedElements.length - 1, 0)
    const maxStagger = gapCount > 0 ? Math.min(1.2, (next.duration - 0.18) / gapCount) : 1.2
    next.stagger = Math.min(Math.max(next.stagger, 0), maxStagger)
    onChange(next)
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Field label="启用开场转场">
        <Switch checked={opening.isEnabled} onChange={v => patch({ isEnabled: v })} size="small" />
      </Field>
      <Field label="转场预设">
        <Segmented
          block
          size="small"
          disabled={!opening.isEnabled}
          value={opening.preset}
          options={[
            { value: '聚拢', label: '聚拢' },
            { value: '侧滑', label: '侧滑' },
            { value: '轻 3D', label: '轻 3D' },
          ]}
          onChange={v => patch({ preset: v as OpeningSequence['preset'] })}
        />
      </Field>
      <Field label={`总时长 ${opening.duration.toFixed(2)}s`}>
        <Slider
          min={0.4}
          max={8}
          step={0.1}
          disabled={!opening.isEnabled}
          value={opening.duration}
          onChange={v => patch({ duration: v })}
          style={{ width: '100%' }}
        />
      </Field>
      <Field label={`错峰间隔 ${opening.stagger.toFixed(2)}s`}>
        <Slider
          min={0}
          max={1.2}
          step={0.02}
          disabled={!opening.isEnabled}
          value={opening.stagger}
          onChange={v => patch({ stagger: v })}
          style={{ width: '100%' }}
        />
      </Field>
      <div style={{ color: '#595959', fontSize: 11, lineHeight: 1.6 }}>
        提示：把播放头拖回 0 秒再按空格播放，可以看到屏幕元素的入场动画。
        摄像头与贴图元素待对应轨道接入后参与。
      </div>
    </Space>
  )
}

// ---------------------------------------------------------------- 运镜

/** 「运镜」页：3D 变换控制，实时驱动画布 */
function MotionTab(props: {
  motion: ScreenMotionState
  onMotionChange: (next: ScreenMotionState) => void
}) {
  const { motion, onMotionChange } = props
  const isDefault = isIdentityMotion(motion)

  const patch = (part: Partial<ScreenMotionState>) => onMotionChange({ ...motion, ...part })

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>3D 运镜</span>
        <Space size={2}>
          <Button
            size="small"
            type="text"
            title="左转 15°"
            icon={<RotateLeftOutlined />}
            onClick={() => patch({ rotationY: Math.max(motion.rotationY - 15, -90) })}
          />
          <Button
            size="small"
            type="text"
            title="右转 15°"
            icon={<RotateRightOutlined />}
            onClick={() => patch({ rotationY: Math.min(motion.rotationY + 15, 90) })}
          />
          <Button
            size="small"
            type="text"
            title="重置运镜"
            disabled={isDefault}
            icon={<ReloadOutlined />}
            onClick={() => onMotionChange({ ...DEFAULT_SCREEN_MOTION })}
          />
        </Space>
      </div>

      <SliderRow
        label="水平旋转 Y"
        value={motion.rotationY}
        min={-90}
        max={90}
        step={1}
        unit="°"
        onChange={v => patch({ rotationY: v })}
      />
      <SliderRow
        label="垂直旋转 X"
        value={motion.rotationX}
        min={-90}
        max={90}
        step={1}
        unit="°"
        onChange={v => patch({ rotationX: v })}
      />
      <SliderRow
        label="画面旋转 Z"
        value={motion.rotationZ}
        min={-180}
        max={180}
        step={1}
        unit="°"
        onChange={v => patch({ rotationZ: v })}
      />
      <SliderRow
        label="透视强度"
        value={motion.perspective}
        min={0}
        max={2}
        step={0.05}
        unit=""
        onChange={v => patch({ perspective: v })}
      />
      <SliderRow
        label="缩放"
        value={motion.scale}
        min={0.2}
        max={4}
        step={0.01}
        unit="×"
        onChange={v => patch({ scale: v })}
      />

      <div>
        <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 6 }}>位置</div>
        <Row gutter={8}>
          <Col span={12}>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={motion.position.x}
              tooltip={{ formatter: v => `${((v ?? 0) * 100).toFixed(0)}%` }}
              onChange={v => patch({ position: { ...motion.position, x: v } })}
            />
          </Col>
          <Col span={12}>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={motion.position.y}
              tooltip={{ formatter: v => `${((v ?? 0) * 100).toFixed(0)}%` }}
              onChange={v => patch({ position: { ...motion.position, y: v } })}
            />
          </Col>
        </Row>
      </div>

      <Space size={4} wrap>
        {[
          { label: '正面', v: { rotationX: 0, rotationY: 0, rotationZ: 0 } },
          { label: '侧倾', v: { rotationX: 0, rotationY: 35, rotationZ: 0 } },
          { label: '俯视', v: { rotationX: 30, rotationY: 0, rotationZ: 0 } },
          { label: '倾斜', v: { rotationX: 12, rotationY: -18, rotationZ: -6 } },
        ].map(p => (
          <Button key={p.label} size="small" onClick={() => patch(p.v)}>
            {p.label}
          </Button>
        ))}
      </Space>

      <div style={{ color: '#595959', fontSize: 11, lineHeight: 1.6 }}>
        提示：在画布上拖拽卡片可直接旋转；拖拽右下角蓝色手柄缩放。
      </div>
    </Space>
  )
}

// ---------------------------------------------------------------- 光标

/** 「光标」页：资源/大小/点击反馈，全部受控（对应 EditorCursorInspector） */
function CursorTab(props: { cursorStyle: CursorStyle; onChange: (next: CursorStyle) => void }) {
  const { cursorStyle, onChange } = props
  const patch = (part: Partial<CursorStyle>) => onChange({ ...cursorStyle, ...part })

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Field label="光标资源">
        <Select
          size="small"
          style={{ width: '100%' }}
          value={cursorStyle.assetID}
          options={CURSOR_ASSET_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
          onChange={v => patch({ assetID: v })}
        />
      </Field>
      <Field label={`光标大小 ${cursorStyle.size.toFixed(2)}×`}>
        <Slider
          min={0.25}
          max={6}
          step={0.05}
          value={cursorStyle.size}
          onChange={v => patch({ size: v })}
          style={{ width: '100%' }}
        />
      </Field>
      <Field label="点击反馈样式">
        <Select
          size="small"
          style={{ width: '100%' }}
          value={cursorStyle.clickEffectStyle}
          options={CLICK_EFFECT_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
          onChange={(v: CursorClickEffectStyle) => patch({ clickEffectStyle: v })}
        />
      </Field>
      {cursorStyle.clickEffectStyle !== 'none' && (
        <>
          <Field label={`反馈不透明度 ${(cursorStyle.clickOpacity * 100).toFixed(0)}%`}>
            <Slider
              min={0.05}
              max={1}
              step={0.05}
              value={cursorStyle.clickOpacity}
              onChange={v => patch({ clickOpacity: v })}
              style={{ width: '100%' }}
            />
          </Field>
          <Field label={`反馈缩放 ${cursorStyle.clickScale.toFixed(2)}×`}>
            <Slider
              min={0.4}
              max={3}
              step={0.05}
              value={cursorStyle.clickScale}
              onChange={v => patch({ clickScale: v })}
              style={{ width: '100%' }}
            />
          </Field>
        </>
      )}
      <Field label="静止时隐藏">
        <Switch
          size="small"
          checked={cursorStyle.hideWhenIdle}
          onChange={v => patch({ hideWhenIdle: v })}
        />
      </Field>
      {cursorStyle.hideWhenIdle && (
        <Field label={`静止阈值 ${cursorStyle.idleDelay.toFixed(1)}s`}>
          <Slider
            min={0.2}
            max={8}
            step={0.1}
            value={cursorStyle.idleDelay}
            onChange={v => patch({ idleDelay: v })}
            style={{ width: '100%' }}
          />
        </Field>
      )}
      <div style={{ color: '#595959', fontSize: 11, lineHeight: 1.6 }}>
        提示：把鼠标移到画布上即可预览光标样式；在画布内点击可预览点击反馈动效。
        {cursorStyle.assetID === CURSOR_ASSET_TOUCH_DOT && ' 触控圆点适合演示类视频。'}
      </div>
    </Space>
  )
}

function SliderRow(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          color: '#8c8c8c',
          fontSize: 12,
          marginBottom: 2,
        }}
      >
        <span>{props.label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: '#d9d9d9' }}>
          {props.step < 1 ? props.value.toFixed(2) : Math.round(props.value)}
          {props.unit}
        </span>
      </div>
      <Slider
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={props.onChange}
        style={{ width: '100%' }}
      />
    </div>
  )
}

function AudioTab() {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Field label="录制麦克风">
        <Switch defaultChecked size="small" />
      </Field>
      <Field label="系统声音">
        <Switch defaultChecked size="small" />
      </Field>
      <Field label="音量">
        <Slider defaultValue={100} style={{ width: '100%' }} />
      </Field>
    </Space>
  )
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 6 }}>{props.label}</div>
      {props.children}
    </div>
  )
}
