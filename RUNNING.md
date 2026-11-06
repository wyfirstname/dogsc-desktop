# DogSC for Windows — 运行说明

原项目：[laogou717/dogsc](https://github.com/laogou717/dogsc)（macOS · Swift + ScreenCaptureKit）
本项目：把其源码转写为 **Electron + React + Ant Design**，使其可在 Windows 上原生运行。
转写基线 commit：`567fd6e`（见 `mappings.json`）

---

## 一、环境要求

| 项目 | 版本 |
| --- | --- |
| Node.js | ≥ 20（本机实测 22.22.2） |
| npm | ≥ 10 |
| 操作系统 | Windows 10 1809+ / Windows 11（x64） |

首次安装依赖：

```bash
cd F:\dogsc-workspace\dogsc-win
npm install
```

> 若 `node_modules/electron/dist/electron.exe` 不存在（部分镜像会跳过 postinstall），
> 手动补一次下载：
> ```bash
> node node_modules/electron/install.js
> ```

---

## 二、日常运行（开发）

```bash
npm start
```

首次运行前需要先构建一次产物：

```bash
npm run build      # 渲染进程 + 主进程 + preload，三步一次跑完
npm start
```

或者一步到位：

```bash
npm run dev:electron
```

### 关于 `ELECTRON_RUN_AS_NODE`

某些开发环境（IDE 内嵌终端、部分 Agent 宿主）会注入环境变量 `ELECTRON_RUN_AS_NODE=1`。
此时 `electron.exe` 会退化成纯 Node 运行时，`require('electron')` 返回的是可执行文件**路径字符串**
而不是 API 对象，主进程随即报错：

```
TypeError: Cannot read properties of undefined (reading 'whenReady')
```

`npm start` 已经通过 `scripts/launch.mjs` 在子进程中剥离该变量，**不需要你手动处理**。

如果绕过 npm 直接调用 electron，请自行清理：

```bash
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS ./node_modules/electron/dist/electron.exe .
```

---

## 三、打绿色包（免安装 exe）

```bash
npm run dist
```

产物输出到 `release/`：

```
release/DogSC-0.1.0-win-x64-portable.exe
```

这是一个 **单文件便携版**：双击即用，无需安装，可拷到 U 盘。
运行时会把自身解压到临时目录，退出后保留用户数据（不写注册表）。

### 打包配置要点（`package.json` 的 `build` 字段）

- `files`：只打 `dist/**` 与 `package.json`，源码不进包
- `extraResources`：把 `ffmpeg-static` 的 `ffmpeg.exe` 放到 `resources/ffmpeg/ffmpeg.exe`
- 主进程运行时通过 `app.isPackaged` 判断走哪条路径（见 `src/main/index.ts` 的 `resolveFfmpegPath`）
- `compression: maximum`：体积优先

---

## 四、界面截图（用于比对上游原版）

```bash
npm run capture
```

无头启动窗口 → 等渲染完成 → 截图 → 退出，输出到
`F:\dogsc-workspace\ref\dogsc-win-ui.png`。

用途：与原项目 `docs/images/editor.png` 逐区域比对布局还原度。

---

## 四之二、录制链路自检

```bash
node scripts/verify-recording.mjs   # 录制 → 落盘 → 转 mp4
node scripts/verify-import.mjs      # 录制 → 自动导入 → 缩略图 → 画布可播放
```

全绿则输出 `ALL OK — 整条链路可用`。改了录制/导入相关代码后建议都跑一次。

### 数据流（当前版本）

```
录制完成 ──→ 自动 describeMedia ──→ 自动载入编辑器（画布 + 时间线）
                                        │
导入视频（顶栏「导入」/ 空状态按钮）──→ 外部文件自动复制进 Videos\DogSC
                                        │
最近录制（导入菜单里）──────────→ 选一条即载入
```

- 时间线：真实时长标尺 + 胶片缩略图（ffmpeg 单次调用抽 12 帧，约 0.8s）+ 可拖拽播放头
- 画布：`<video>` 直接播放，点画布或空格键播放/暂停，时间线点击/拖动定位
- 录制产物与导入副本统一放在 `%USERPROFILE%\Videos\DogSC\`

### 已知平台特性（不是 bug）

`desktopCapturer.getSources` 单次调用约 **3 秒**，属系统级窗口枚举开销，
加 `withThumbnails: false` 也压不下去。因此 UI 侧做了两件事：

1. **启动后 1.2 秒静默预热**并缓存 15 秒 —— 之后点录制是 **25 ms 响应**
2. 弹窗**立即打开**，内容异步补入，不再 await 完才弹

若超过 15 秒未操作导致缓存过期，首次打开仍需等一次枚举（约 3 秒）。

---

## 五、上游更新对比

原项目更新后，用它找出「哪些 Swift 文件变了、对应的 TS 文件要跟着改」：

```bash
npm run upstream:check              # 自动 git fetch 后对比
npm run upstream:check -- --no-fetch   # 只看本地已知状态
npm run upstream:check -- --json       # 机器可读输出
```

工作方式：

1. 读取 `mappings.json` 的 `baseline`（当前转写基线 commit）
2. 在 `../upstream-dogsc` 执行 `git fetch origin`
3. `git diff --name-status <baseline>..origin/main -- Sources/`
4. 用 `mappings.json` 的 `files` 表把 Swift 路径翻译成 TS 路径
5. 输出「新增 / 修改 / 删除 / 改名」清单，并指出本地需要改哪些文件

全部改完、确认对齐后，提升基线：

```bash
npm run upstream:check -- --bump <新commit>
```

---

## 六、目录结构

```
dogsc-win/
├─ src/
│  ├─ main/index.ts          主进程：窗口、录屏源枚举、ffmpeg 导出 IPC
│  ├─ preload/index.ts       contextBridge 白名单 API
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ App.tsx                    三栏布局（EditorView.swift）
│        ├─ components/
│        │  ├─ CanvasPreview.tsx       画布预览（EditorCanvasPreview.swift）
│        │  ├─ InspectorPanel.tsx      右侧检查器（EditorInspectorView.swift）
│        │  ├─ TimelineView.tsx        Canvas 2D 手绘时间线（EditorTimelineView.swift）
│        │  └─ RecordButton.tsx        录制按钮 + 选源弹窗
│        └─ core/                      RecorderCore 转写层
│           ├─ MediaTimeRange.ts
│           ├─ HexColor.ts
│           ├─ MotionStyle.ts
│           └─ ZoomAnimation.ts        缩放动画 + 贝塞尔 + 弹簧 + 轨道插值
├─ scripts/
│  ├─ launch.mjs             启动器（处理 ELECTRON_RUN_AS_NODE）
│  ├─ capture-ui.mjs         界面截图
│  └─ check-upstream.mjs     上游变更检测
├─ mappings.json             Swift → TS 来源映射 + 基线 commit
└─ release/                  打包产物
```

---

## 七、转写进度

RecorderCore 共 44 个 Swift 文件（616 KB），已完成：

| Swift 源文件 | TS 目标文件 | 状态 |
| --- | --- | --- |
| `MediaTimeRange.swift` | `core/MediaTimeRange.ts` | ✅ |
| `HexColor.swift` | `core/HexColor.ts` | ✅ |
| `ProjectModel.swift`（MotionStyle 部分） | `core/MotionStyle.ts` | ✅ |
| `ProjectModel.swift`（1323 行，其余全部） | `core/ProjectModel.ts` | ✅ |
| `CanvasCustomAspectRatio.swift`（32 行） | `core/CanvasCustomAspectRatio.ts` | ✅ |
| `ScreenFrameDefaults.swift`（56 行） | `core/ScreenFrameDefaults.ts` | ✅ |
| `ExportSettings.swift`（19 行） | `core/ExportSettings.ts` | ✅ |
| `ProjectMediaModel.swift`（411 行） | `core/ProjectMediaModel.ts` | ✅ |
| `ScreenMotion.swift`（611 行） | `core/ScreenMotion.ts` | ✅ |
| `MediaTimeline.swift`（121 行） | `core/MediaTimeline.ts` | ✅ |
| `ZoomAnimation.swift`（944 行） | `core/ZoomAnimation.ts` | ✅ |
| `ScreenProjection.swift`（360 行） | `core/ScreenProjection.ts` | ✅ |
| `ProjectTimeline.swift` | `core/ProjectTimeline.ts` | ✅ |
| `TimelineMap.swift`（305 行） | `core/TimelineMap.ts` | ✅ |
| `ProjectTimelineEditing.swift`（935 行） | `core/ProjectTimelineEditing.ts` | ✅ |
| `ProjectTimelineEditingTransforms.swift`（1168 行） | `core/ProjectTimelineEditing.ts`（合并） | ✅ |
| `ProjectTimelineRetime.swift`（215 行） | `core/ProjectTimelineEditing.ts`（合并） | ✅ |
| `CaptureConfiguration.swift`（492 行） | `core/CaptureConfiguration.ts` | ✅ |
| `RecordingMarker.swift` | `core/RecordingMarker.ts` | ✅ |
| `ElementMotion.swift` | `core/ElementMotion.ts` | ✅ |
| `PointerEventTimelineOrdering.swift` | `core/PointerEventTimelineOrdering.ts` | ✅ |
| `PointerTimelineAlignment.swift` | `core/PointerTimelineAlignment.ts` | ✅ |
| `ZoomTransitionResolution.swift` | `core/ZoomTransitionResolution.ts` | ✅（ZoomAnimation TODO 已消除） |
| `TimelineTrackOrdering.swift` | `core/TimelineTrackOrdering.ts` | ✅（同上） |
| `BoundedMemoizationCache.swift` | `core/BoundedMemoizationCache.ts` | ✅ |
| `OutputFrameSchedule.swift` | `core/OutputFrameSchedule.ts` | ✅ |

剪辑功能已接入 UI（工具条 + 时间线交互）：

- **分割**：`S` 键或工具条剪刀按钮，在播放头处一分为二
- **删除**：`Delete` / `Backspace`，波纹删除（后续片段自动前移，效果轨道跟着搬家）
- **变速**：工具条下拉（1×~100×），保持输出时钟上的动画时长
- **裁切**：时间线上拖片段两端；**向外拖 = 把裁掉的素材拖回来**
- **还原**：双击删除接点还原被删素材
- **撤销/重做**：`Ctrl+Z` / `Ctrl+Shift+Z`
- **缩放**：`Ctrl+滚轮`，放大后可横向滚动精确裁切
- 播放头按 `TimelineMap` 映射：预览播放的是剪辑后的时间线，
  已删除区间被真正跳过；变速片段预览上限 16×（HTMLMediaElement 限制），
  导出时由 ffmpeg 精确处理

验证方式：`npm run verify:editing`（71 项数值断言）与
`node scripts/verify-editing-ui.mjs`（驱动真实 UI 的端到端验证）。
基础批次另有 `npm run verify:batch1`（53 项断言）、
`npm run verify:model`（162 项断言，ProjectModel + ScreenMotion +
ProjectMediaModel + MediaTimeline 批次）。

ProjectModel 批次说明：Swift `HexColor`（Codable 结构体）在 TS 侧以
`'#RRGGBB'` 字符串持久化（`borderHex`/`clickColor`），解析仍走 `HexColor.parse`，
语义与原版一致；`MotionStyle.ts` 补齐了 `defaultZoomScale`/`defaultScreenMotion`
两个字段（后者待 `ScreenMotionCreationStyle.swift` 转写后收紧类型）。

## 七之一、来源映射（上游差异追踪）

`mappings.json` 记录「Swift 源文件 → TS 目标文件」的完整对照与基线 commit。
上游更新后运行 `npm run upstream:check`：脚本会列出每个变更的 Swift 文件
对应本仓库哪个 TS 文件、新增了哪些待转写文件。**每转写一个文件都必须
同步登记 mappings.json**，这是差异优化的依据。

`ZoomAnimation.ts` 中留有两处 TODO 桩，待对应 Swift 文件转写后接入：


## 八、渲染层三大特性接入（背景 / 光标 / 开场转场）

模型层（ProjectModel.ts 的 BackgroundSource / CursorStyle / OpeningSequence）
此前已转写但未接入渲染层——不是漏复制，而是上游渲染核心（FrameScene /
CompositionScene / SharedFrameCursorRenderer 等）尚在待转写队列。本轮把
编辑器预览侧的最小闭环接通：

- `core/BackgroundRender.ts`：图案背景（5 预设 CSS 复刻）、动态背景
  （3 预设 + 漂移动画）、开场进度/变换（EditorOpeningTiming 语义）。
- `components/BackgroundLayer.tsx`：按 backgroundSource 渲染图案/动态/图片/视频。
- `components/CursorOverlay.tsx`：光标资源 SVG 映射 + 四类点击反馈动效
  （时长与 cursorClickEffectDuration 一致），预览期由真实鼠标驱动。
- InspectorPanel 新增「转场」页与受控的「画面」「光标」页；App 增加
  canvasStyle/cursorStyle/opening 状态与 `media:pickBackground` IPC。
- 调试钩子扩展 setCanvasStyle/setCursorStyle/setOpening；
  `npm run verify:render-ui` 做真实 UI 截图验证（背景图案、光标覆盖层、
  聚拢开场 transform 均确认渲染，0 控制台错误）。

导出侧（ffmpeg 合成背景/光标/转场）仍待 FrameScene/CompositionScene/
PointerTrack 等转写后实现。

## 九、导出管线最小闭环（TimelineMap → ffmpeg 拼接）

导出按钮接通剪辑结果：`export:timeline` IPC 把 TimelineMap 的保留片段
（sourceStart / sourceDuration / playbackRate）交给 ffmpeg
`trim + setpts`（视频）/ `atrim + atempo 链`（音频）逐段变速裁切，
再 `concat` 拼接输出 MP4。保存对话框默认存到录制目录；
进度经 `export:progress`（0~100）实时推送，完成后可在文件夹中显示。

- 对照上游：DirectExportPipeline / TimelineCompositionBuilder 的
  「保留片段顺序拼接」语义；背景/光标/转场/摄像头合成待
  FrameScene / CompositionScene 转写后接入。
- 端到端验证：`npm run verify:export-ui` —— 真实 UI 分割+删除制造剪辑，
  导出后校验输出时长与期望一致（本轮实测 6.370s vs 6.370s，误差 0.000s）。
