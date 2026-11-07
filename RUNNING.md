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

## 十、OverlayTimeline / CameraMotion 转写（批次推进）

- `OverlayTimeline.ts`：马赛克剪辑（NormalizedOverlayRect / OverlayTiming /
  MosaicClip，含 v9 像素块预设迁移）与贴图剪辑（StickerClip 22 字段 +
  StickerAnimationPreset.automaticExit）。HexColor 持久化为 hexString。
- `CameraMotion.ts`：摄像头运动轨（布局/位置/尺寸/圆角/不透明度的定时过渡）。
  索引+扫描双路径、returnFalloff、隐藏目标原地淡出、离散布局先 resolve 成
  连续值（圆→矩形→全屏可平滑过渡）；cameraMotionClipsNeedRepair 乱序修复。
- verify-model：162 → 218 项断言全过。
- 已推送 https://github.com/wyfirstname/dogsc-desktop.git（main）。
  推送网络为 SNI 间歇阻断，工具脚本 `.workbuddy/tools/push_retry.sh`
  探测连接窗口后用 `http.curloptResolve` 直连（不动仓库配置）。
- 下一批：PointerTrack(894) / ProjectPointerTrack(469)。

## 十一、PointerTrack / ProjectPointerTrack 批次

- `src/renderer/src/core/PointerTrack.ts`（Swift PointerTrack.swift，894 行）：PointerClickPhase / PointerSample / PointerTrackEvaluation / PointerTrack 类 / PointerInterpolator 门面。核心算法：240Hz 二阶弹簧积分（BoundedMemoizationCache 容量 2）+ 亚像素抖动阈值 0.00035 + 点击锚定（±0.18s 支撑窗、五次 smootherStep、相邻点击中点止步）+ C1 三次 Hermite 插值（PCHIP/Fritsch-Carlson 单调切向，tangentScale 按响应度 0.25~1.2）+ 拖尾倾斜（smooth/medium/rapid/none 四档参数，idleDecay 0.18s）。位置与可见性解耦：隐藏光标不影响自动运镜。
- `src/renderer/src/core/ProjectPointerTrack.ts`（Swift ProjectPointerTrack.swift，469 行）：输出时钟域评估。保留片段段表 + 首点击时间缓存 + 剪辑桥接（CUR-005，0.28s 五次 smootherstep 端点连接）+ 自动运镜稳定区跟随（120Hz 采样、rest area 22% 内缩、屏幕弹簧积分、LRU×4 缓存）+ 源不连续检测。
- `TimelineMap.ts` 补齐 Swift TimelineMap.mapPointerEventSegments（L439-500）：按片段分组映射指针事件到输出时钟，起点无精确事件时注入 move 位置种子；导出 `TimelineMappedPointerSegment` / `firstEventIndexAtOrAfter`。
- verify-model 断言 218 → 259（+41）：smootherStep/连续运动判定/单调切向/线性插值/可见性解耦/点击相位/弹簧收敛/预热缓存/乱序规范化/门面/二分切片/raw 插值/段表/剪辑桥接/种子注入。
- MotionStyle 中文 rawValue 对照：smooth→'平滑'、medium→'适中'、rapid→'快速'、none→'无'；CursorStyle.clickEffectStyle.duration → cursorClickEffectDuration()。

## 十三、FrameScene 批次（含五个依赖层）

本批是「一帧画面」的完整契约：预览与导出都只读 `FrameRenderPlan`，不再各自解释工程。

- `src/renderer/src/core/CameraContentFill.ts`（Swift 110 行）：`cameraContentFillLayout` 的 aspect-fill × 1.01 overscan（抹一像素接缝）、焦点裁剪、`contentScale` 夹取 1~4；`destinationPoint` 在目标孔径中心做水平镜像，避免绕全局原点翻转的平移跳变。
- `src/renderer/src/core/CursorRenderGeometry.ts`（Swift 358 行）：`CursorAssetMetrics`（热点归一化 + `scaleReferenceHeight`）、`cursorRenderLayout`（1080 短边 44px 基准，线宽 2px@1080）、`cursorClickGeometry` 五种反馈几何（ripple/glow/pulse/burst 的全部直径/线宽/透明度/辉光曲线）。
- `src/renderer/src/core/FocusEffect.ts`（Swift 118 行）：`FocusEffect` 完整字段与 `isValid` 校验、`focusEffectScene`（3D 运镜聚焦独占优先级 + 缺 shape 时按线性/固定/不压暗解释 + `pointer`/`animation`/`fixed` 三种目标）、`focusEffectProgress` 进入/保持/回落三相位。ZoomAnimation.ts 的 `FocusEffect` 桩已替换为对本文件的 re-export。
- `src/renderer/src/core/StickerTransition.ts`（Swift 266 行）：`FrameStickerBackdropScene`（四项取最大合并 + 线性插值）、`StickerTransitionTrack`（端点分组、极短贴图不连自身首尾、相邻接力预算 `min(exit)/min(enter)`、短重叠背景桥接只在共享处理不为零时生效）。
- `src/renderer/src/core/TimelineMediaPlan.ts`（Swift 375 行）：`TimelineMediaPlan.fromPrimary/fromAuxiliary`（剪切边界复用主片段时长以避免微孔丢相机帧、同步锚点曲线校正、可用区间夹取）、`ProjectTimelineMediaPlan.build`（主/系统声/相机/麦克风/指针五条时钟）、`inferredSourceTimeScale`。
- `src/renderer/src/core/FrameScene.ts`（Swift 1284 行）：`FrameScene` 全量结构（ColorContract / Shadow / Background / Screen / Chrome / Mosaic / Camera / Cursor / Sticker / Backdrop / LayerRole / RenderPlan）+ `FrameSceneEvaluator` 三入口 ——
  - `scene()`：zoom 轨道解析 → 指针评估（含剪辑重锚）→ 自动运镜焦点与继承焦点 → `compositionSceneEvaluate` → 开场序列（`openingSample` 逐元素缩放/位移/3D 姿态 + overshoot 夹取 1.04）→ 屏幕阴影/装饰/投影四角 → 打码过渡进度 → 相机（内容填充、镜像焦点、开场缩放）→ 光标 → 贴图（+ 开场偏移/缩放/透明度叠加）→ 图层顺序（spotlight 在 base 之上、camera 仅在可见时、stickers 最后）。
  - `renderPlan()`：时间夹取 + `cameraTimeline.contains` 归属判定（避免 ulps 矛盾丢一帧相机）。
  - `refreshingCursor()`：只刷新指针路径/形状/点击相位，保留缓存的视频与壁纸相位。
- 依赖补齐：`ProjectTimeline.ts` 增加 `mosaicClips` / `stickerClips`（+`makeProjectTimeline` 缺省），`ProjectMediaModel.ts` 用 `decodeMosaicClip` / `decodeStickerClip` 解码；`ScreenMotionClip.focusEffect` 从 `unknown` 收紧为 `FocusEffect | null`。
- verify-model 断言 292 → 416（+124）：内容填充缩放/可见源、光标布局与四种点击几何、聚焦有效性/相位/目标、贴图桥接与背景抑制、媒体切片边界与辅助时钟、场景图层顺序、开场淡入与稳定、贴图动画路径、打码过渡、屏幕框装饰、光标裁切（画布外返回 null）、refreshingCursor 相位保持。

## 十四、RecorderCore 收官（8 文件 / 2,332 行）

`Sources/RecorderCore/` 至此 **44/44 全部映射完毕**，纯逻辑层无剩余。

- `ExportPolicy.ts`（68 行）：`RequiredProjectMedia` 按**后期状态**（静音/隐藏/背景源）而非录制开关判定导出所需文件；`exportVideoBitrate` 按像素数分三档上限（1080p 65M / 1440p 100M / 4K 130M），下限 12M，公式 `pixels × fps / 6`。
- `RecordingPerformanceDiagnostics.ts`（156 行）：采样值非负/0~100 夹取；`RecordingPerformanceSummary` 滚动峰值（连续两次录制的摘要可累加，不必重扫 JSONL）；`unknown` 热状态严重度为 −1，不覆盖已观测值。
- `AudioCaptureDiagnostics.ts`（57 行）：包驱动计数（非 PCM 帧）、六类丢弃求和、每秒钟数（`elapsed=0 → 0`）。
- `CameraCaptureDiagnostics.ts`（207 行）：25 字段恢复清单；`decode` 对完整性闸门之前的旧清单补中性默认（不把诊断演进变成兼容断裂）；`received/appendedFramesPerSecond` 用 `N−1` 分母且 `N>1` 才计算。
- `ScreenMotionCreationStyle.ts`（45 行）：从片段抽出可复用样式（回落取手授意图）；`isValid` 覆盖 13 个数值含贝塞尔控制点；`clip(timing:)` 的回落时长取 `min(样式, 旧值)`——样式不能放大回落。
- `ProjectValidator.ts`（210 行）：**只校验不修复**的唯一边界。10 类域错误 + 中文文案；timeline 走 `ProjectTimelineEditing.validate` 并把 `duplicateClipID`/`overlappingClips` 翻译为带具体 id 的稳定错误；开场三条不变量（stagger 上限 + 无重复 + elementOrder 是全集排列）。
- `AutoZoomPlanner.ts`（651 行）：点击聚类 → 空间焦点组（跨度阈值 `visibleExtent × 0.50 / 0.70`）→ 指针活动延长保持（idle 1.4s + settle 0.55s，**同时收缩回落避免 effectEndTime 越界**）→ 折叠相接自动包络；`repairingLegacyAutomaticAnimations` 用「与已知历史配方逐字段一致」识别未改动自动轨，四种历史配方全认。
- `EditorTimeline.ts`（938 行）：创建拟合/手动/移动/调整共用「相接或让足回落窗口」不变量，洞口一律**吸附**到最近合法位；命中测试含有序快路径（二分）与无序 z 序回退；运动轨（`TransitionTiming`）与缩放轨（`ZoomAnimationClip`）双套但同规则；`zoomSegments(from:keyframes)` 段起点取爬升前那一帧。
- 依赖补齐：`ZoomAnimation.ts` 新增 `PointerClick` / `makePointerClick`（Swift L21-30）、`makeKeyframe`（Swift L356-368）；`MotionStyle.defaultScreenMotion` 从 `unknown` 收紧为 `ScreenMotionCreationStyle | null`。
- verify-model 断言 416 → 606（+190）：码率三档与上下限、诊断夹取与滚动峰值、旧清单解码、样式回落取小、10 类校验错误、点击聚类/空间分组/活动延长/包络折叠、创建拟合洞口吸附、命中测试手柄、运动回落归一、关键帧段表。

## 十五、时间线几何 / 磁吸 / 交互纯决策（7 文件 / 2,824 行）

SwiftUI 视图层的可移植部分：这些文件虽在 App 目标里，但主体是纯计算与状态机，
Electron 侧由 React 持有视图状态，本批只搬「取值与公式」。

- `core/EditorTimelineGeometry.ts`（合并 3 个源文件）
  - 片段几何：`interactionRange`（交互面裁到文档可见范围，避免放大后出现几万点宽的手势平面）、`waveformBand`（底部 26% 波形带）。
  - 标尺：`majorStep` 取 1/2/5×10ⁿ、`scaleLayers` **在整个尺度区间交叉淡化相邻两级**（到边界整套换刻度会让连续缩放看起来跳）、`visibleTicks` 只生成缓冲视口内刻度、`label` 整百分秒省略（"0:18" / "0:18.50"）。
  - 行高：compact / regular 双套，`overlayHeight = max(rows×34+16, motionHeight)`，`viewHeight` 至少 80pt，`documentHeight = max(canvasHeight, viewportHeight)`。
  - 帧吸附：`snappedTimelineTime` 首/尾半帧直接归端点（保留非整数帧的媒体时长），`snappedEditableTime` 同一规则但边界由调用方给。
- `core/EditorTimelineMagneticSnap.ts`（185 行）：**捕获 7pt / 脱开 14pt** 双阈值；候选点从已提交数据缓存并在首次按手势起点屏蔽「自吸」；`suppressed` 是「脱离」而非永久黑名单；`validate(edges:)` 保证不对外宣称合法时序没走到的磁吸。`magneticTargets` 收集可见轨端点 + 播放头（scrub 时排除）+ 排除拖动片段与联动伙伴。
- `core/EditorTimelineAuthoredOrder.ts`（46 行）：单次线性逆序检查，真逆序才稳定排序；返回 `{items,didSort}` 而非原地改。
- `core/EditorTimelineInteraction.ts`（合并 Interaction + ZoomTransport，约 840 行纯逻辑）
  - 主轨呈现：`leadingGap`/`trailingGap` 要求源区间单调（乱序工程不显示还原缺口）、`segmentJunctions` 跳过倒回接缝、`displaySegments` 把修剪/变速草稿叠成「松手后的样子」（左修剪乘 playbackRate，Ripple 保持手授编辑点连续）、`trimDraftOrigin` 手势起点一次性算两侧可还原余量、`snappedCutX` 7pt 边界优先回落播放头。
  - 修剪三入口：增量版 / 绝对位置版（片段自己改宽度时增量会漂移）/ 预览相位版（右边缘显示最后一帧 = proposed − frame）。
  - 缩放：`EditorTimelineZoomAnchor`（保留指针下的**语义时刻**跨整串滚轮事件存活）、上限 480× → **4096×**、每单位 deltaY ×1.24、`ZoomInputCoalescer` 累计目标但每帧最多发布一次、目标文档宽 = 视口 × 缩放（不再从上一帧原生宽反推，避免第二个所有者）。
  - 选择策略：片段身份来自持久化源序列而非异步媒体计划；被删片段的选择回退**中性画布**（时间选择不得隐含空间操作）；`SelectionReveal` 播放头已在片段内则不动。
  - 手势：`GestureIntent` 一次 mouse-down 锁一个语义目标，`Ownership.begin` 跨意图抢占一律失败 —— 空白创建手势再也抢不走片段上的按下。
- verify-model 断言 606 → 791（+185）。
