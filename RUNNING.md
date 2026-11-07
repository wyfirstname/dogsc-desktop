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

## 十六、媒体探测 / 黑边检测 / 工程打开（4 文件 / 1,100 行）

进入 `Sources/DogSCApp/` 后第一批「非 SwiftUI 视图」文件：它们是打开工程与
喂给编辑器数据的前置环节，主体是纯算术与决策，Electron 侧由主进程提供原始
数据、渲染层保留计算。

- `core/MediaAnalysis.ts`（Swift 327 行）
  - `MediaAssetInventory`：时长取 `max(容器时长, 视频轨终点, 音频轨终点)`，容器时长非有限或 ≤0 按 0 处理；宽高/帧率**只在视频轨真的存在时间区间时**才采信，宽高取整、帧率必须有限且 >0。
  - `TimestampedWaveformAccumulator`：`record(peak:)` 走 `bucketIndex` 单调映射取最大；`recordInterleavedPCM` 是性能关键 —— 旧写法把每个解码帧反算呈现时间再除整轨时长，几分钟 48kHz 录音要做几千万次同样的映射；桶边界线性，所以**按桶算一次帧区间直接扫 Int16**，对全部声道取最大与「逐帧取声道最大再取桶最大」数学等价。右开边界用半个源帧压回最后一个被触达的桶（不依赖固定 epsilon）。
  - `waveformFrameBoundary`：`ceil(raw − max(|raw|,1)×ulpOfOne×16)`，让精确 PCM 边界被表示成 4799.999999999 / 4800.000000001 时映射一致。
  - `normalizedSamples`：噪声底 0.012，抬升后 `pow(elevated, 0.95)` —— **静音必须为 0**，UI 不得自造最低绿色条。
  - `MediaAnalyzer.inspect/waveform` 的 AVFoundation 部分改为主进程 ffprobe/ffmpeg，纯算术留在 `mediaInventoryFromProbe` 与 `MediaWaveformSession`。
- `core/CameraLetterboxAnalysis.ts`（Swift 335 行）
  - 网格：`min(width, 360)` 宽 + 等比高度；原注释记录了踩坑（90×160 时一格≈12 源像素，边界插值在 PIP 底部留整条黑缝）。
  - 竖屏优先走 `centralDetailedBand`：行细节 `rowDetail` 做 radius=2 平滑、阈值 `max(2.2, 中位数×0.45)`、允许间隙 `max(1.2%, 2)`，取**离中心最近**（并列取更长）的连续纹理带；带高必须落在 20%~80%，否则视为整帧损坏。亮留白与绿色错帧纹理极低，自然被排除。
  - 回退路径：行/列平均亮度阈值 8.0，两轴任一检出即可（行/列均值会互相稀释），黑边至少占某一维 3%。
  - `conservativeBounds`：**确认有黑边的一侧内收一整格** —— 下采样后首/末行是黑边与内容的插值混合行，宁可少不到 3 个源像素，也不能让解码缩放把混合行拉成可见黑缝。
  - `stableCrop`：0.065 容差聚类，取最大簇中位数（等量时取中位面积更小的），**不能取并集** —— 一帧亮绿色错帧就能把全片裁切区扩到损坏区。
  - `coreImageCropRect`：`NormalizedCrop` 左上角原点、Core Image 左下角原点，`y = 1 − crop.y − crop.height`；非对称黑边不翻转会裁错一边并在 PIP 顶部留缝。
  - 缓存：`CameraLetterboxCache` 容量 8，**进行中与 nil 结果都缓存**（sync-point 编辑只改时钟不改像素）。
- `core/ProjectOpening.ts`（Swift 219 行）
  - 载入顺序即用户可见顺序：归一化包路径（`project.json` → 父目录）→ 中断标记 → 加载 → 五类相对素材重定位（media / events / assets 三个允许目录）→ 解析三条录制 URL → 依序产 9 种警告 → 读事件轨（可失败降级为空 + 警告）→ 遗留修复。
  - `-timestamp-repaired.mov` 回迁：自动生成的时间戳代理没有恢复真实口型同步，不能悄悄留作工程素材源；只在原始 `.mov` 能解析到时迁回，并清空 `sourceTimeScale` / `sourceEndTime`。
  - 遗留修复：`repairingLegacyAutomaticAnimations` 重分组 + `LegacyMotionDefaultsUpgrade` 升级 + `repairingPersistedRippleTransitions`；重分组把 easing 按旧默认重写过时，把 `automatic` 片段同步到新默认，**不触碰用户手写的其它 easing**。
  - 贴图缺失按**路径集合**计数（同一文件被多次引用只报一次）。
- `core/LegacyMotionDefaultsUpgrade.ts`（Swift AppModel.swift L99-139）
  - 只升级未被改动过的旧预设：屏幕弹簧 1/180/24 → 2.4/210/42、光标弹簧 1/260/30 → 2.8/450/66、`三次方缓动 0.55s` → `弹簧 0.7s`；`弹簧 0.6s` 仅改时长为 0.7s（不动用户手写时长）。任一参数对不上就整块保持原样。
- 依赖补齐：`MediaTimeRange.ts` 增加 `bucketIndex`（Swift L28-38）。
- verify-model 断言 791 → 959（+168）：桶映射边界、波形最小值/曲率/噪声底、帧边界容差与夹取、单声道/立体声 PCM 扫描、取消回调节律、探测结果三路取 max 与有效性闸门、网格尺寸、纹理带间隙桥接、合成位图的包围盒与内收一格、竖屏分支、离群帧聚类、Core Image y 翻转、缓存单飞与淘汰、9 种打开警告的顺序与文案、时间戳代理回迁、遗留运镜升级。

## 十七、文件边界 / 看门狗 / 平台策略（8 文件 / 281 行）

这一批全是「短小但决定行为边界」的支撑件：它们不做视觉，只定义**何时算卡住、
删到哪去、写盘顺序、限流上限**。逐文件 1:1 转写。

- `core/ExportFileTransaction.ts`（33 行）：输出路径与任一输入路径**符号链接别名也算同一文件**（`standardizedFileURL.resolvingSymlinksInPath()`）；临时文件必须落在输出同目录（跨卷 rename 会失败），命名 `.基线.dogsc-export-<uuid>.tmp.<ext>`，隐藏文件避免污染视野；落地走 `replace`（已存在，原子替换）/ `move`（不存在）两条路径。
- `core/ExportActivityWatchdog.ts`（54 行）：超时默认 120s，检查周期 `min(timeout/2, 2)`；**读与写都算进度** —— 解码长加速区间不能被当成卡住的输出帧；`stopped` 是单向闩锁，触发后不再复活。DispatchSourceTimer 换成可注入 `WatchdogScheduler`，主进程用 `intervalWatchdogScheduler()`。
- `core/ProjectPackageDisposal.ts`（36 行）：大录制包**绝不在主线程移动或递归删除**（APFS 元数据、外接卷、访达废纸篓记账都可能阻塞，哪怕动作看起来只是改名）。删除一律走回收站；`removeIfPresent` 用 `try?` 语义吞错，清理失败不打断主流程。
- `core/ProjectDocument.ts`（24 行）：全应用**唯一**的可变工程所有者，唯一写入口 `replace` 返回布尔让调用方区分「真提交」与「空操作」；编辑器不得持有第二份持久化快照。
- `core/ProjectCatalogSnapshot.ts`（19 行）：两个不同集合 —— `recent` 只展示前 8 条，但 `recoverable` 用**完整 50 条**候选去筛（第 9~50 条里的可恢复工程仍要出现）。
- `core/RecordingRecoveryJournal.ts`（44 行）：所有恢复写都排进**同一条串行队列**，心跳写与终态写共用队列，因此进行中的心跳永远不可能覆盖更晚的 `complete` / `failed` / `discarded` 清单；先追加性能样本（受 `appendsPerformanceSample` 与监视器存在双重门控），再写清单并带上此刻 `summary`。
- `core/ScreenCaptureFrameMetadata.ts`（31 行）：只从第一份附件字典取 `status`，不整份桥接 CFArray/CFDictionary（每帧都做会拖慢采集）；未知 rawValue 按失败初始化器返回 null。
- `core/CaptureStreamCadence.ts`（40 行）：产品录制上限 60 FPS —— 120Hz 合成器/独立窗口要无限更新只会产出 60 FPS 导出留不住的帧，还把同一份实时 HEVC 预算摊到两倍画面上；屏幕类源最少间隔 1/60s，**设备源返回 .zero**（摄像头自有帧率协商）；表面池深度 8（多三张 4K NV12 约 42 MiB，换取编码器短暂占用旧表面时 WindowServer 仍能出帧）；录制期间禁用空闲睡眠。
- verify-model 断言 959 → 1062（+103）：路径归一化与符号链接冲突、临时文件命名、落地模式、看门狗首次/重复间隔与延迟触发/单向闩锁/取消、回收站永不永久删除、取消前后两处检查、文档空写不通知、目录快照双集合语义、恢复日志顺序与串行化、帧状态解码、限流上限与表面池。

## 十八、并发许可 / 就绪判定 / 选区几何（8 文件 / 331 行）

- `core/EditorThumbnailPermits.ts`（49 行）：无定时器的并发闸门。`release()` 是「**转移**许可」而非归还计数 —— 有等待者时直接交给队首，`active` 不变；取消把排队项**立即**摘掉，切换显示模式时不必等整批跑完。
- `core/RecorderStartAvailability.ts`（47 行）：开录前每个启用的实时输入都必须产出真实媒体。选好摄像头 ≠ 就绪 —— 权限、USB 协商、首帧投递都还可能在路上；`preparing` 是唯一禁止开录的状态，`needsCaptureTarget` 优先于它。
- `core/CaptureDisplayResolution.ts`（67 行）：全应用唯一的显示器身份策略。给了 ID 就是选定了隐私边界，**绝不降级到另一块屏**（找不到返回 null）；只有没显式要 ID 时才允许默认选择。
- `core/EditorInteractionLifecycle.ts`（29 行）：导出/窗口失活/关窗/换工程四类外部动作一律先 `cancel` 瞬时手势草稿 —— 鼠标抬起前自动提交会把「误触中断」变成持久化编辑；输入控件的显式自动保存策略由 store 自己处理，不走这条兜底。
- `core/CaptureAreaSelectionLayout.ts`（26 行）：工具栏只在**可用区**（去掉菜单栏/程序坞）里摆，选区矩形仍按整屏算；贴下方 → 贴上方 → 夹进安全区的三级回落，横向夹在安全区内。
- `core/CaptureAreaSelectionMotion.ts`（38 行）：0.32s 可中断过渡，ease-out cubic **不带回弹**（选区边缘必须留在屏幕上）；`reduceMotion` 直接跳到 1；进度到 1 时先 stop 再回调，保证最后一帧恰好是 1。
- `core/RecordingPointerFinalization.ts`（49 行）：采集轨全部停止后的重活（对齐 + 自动运镜规划）在后台跑，结果整块作为不可变值返回；三步间各一次取消检查；写盘前后也各一次 —— 取消必须能打断一次大文件写。
- `core/ScenePresetBackgroundAsset.ts`（47 行）：预设资产与工程包分离（搬走源工程后场景仍可用）；`filename` 只接受纯文件名，带分隔符或 `.` / `..` 一律拒绝 —— 这是防止资产逃出 Assets 目录的唯一闸门；保留副本命名 `scene-<UUID>.<ext>`，扩展名缺省按 mov/png 兜底。
- verify-model 断言 1062 → 1181（+119）：许可转移/排队/取消三态、就绪三级判定、显示器身份不降级、外部动作一律取消草稿、工具栏三级回落与横向夹取、缓动曲线与 reduceMotion、指针收尾的取消次数与写盘次序、资产文件名闸门与来源枚举。

## 十九、导出状态 / 进度中继 / 屏幕拓扑（3 文件 / 483 行）

- `core/ExportStatus.ts`（85 行）：`ExportStage` 四阶段（仅 `processing` 区分纯音频）；剩余时间标签是**五级优先级**——取消中 > 卡住 20s > 正在写入 > 无估算 > 有估算，顺序即用户看到的话。`durationText` 一律**向上取整**（4.2s 显示 0:05），非有限值按 0，≥1 小时走 `h:mm:ss`。
- `core/ExportStatus.ts` 的 `ExportTimeEstimator`：只保留最近 24 秒样本；进度真正前进才刷新 `lastAdvance`；**近期与前半段速率比值必须落在 0.65~1.55**，否则直接隐藏估算 —— 加特效会显著改变编码速度，宁可不显示也不显示一个已经开始说谎的倒计时；结果向上取整到 5 秒。
- `core/ExportProgressRelay.ts`（85 行）：纯状态机做合流。`submit` 只在「尚未安排投递」时返回 true，后续值覆盖 `latestValue`（**永不丢最新值、永不排队**）；`takePendingForDelivery` 取出即清空；`invalidate` 三字段全清。中继默认 15 次/秒（`round(1e9/ups)` 纳秒），渲染器可能比实时更快出帧，逐帧投递会让进度上报和编码器抢 CPU、并反复重建整个导出面板。
- `core/ScreenTopology.ts`（313 行）：显示器**身份只有 id** —— 数组顺序与本地化名称都不是身份；同一 id 重复出现时后者胜出；`nodes` 恒按 id 升序。主屏用 CoreGraphics 的稳定主屏 id，且必须真的在列表里（`NSScreen.main` 会跟着键盘焦点窗口变）。
  - `ScreenTopologyDelta` 把变化分成 added / removed / geometry / mode 四类，同一块屏可能**同时**出现在 geometry 与 mode 里；`isEmpty` 五条件全空。
  - `ScreenTopologyReconfigurationState` 用无符号回绕代次作废旧拓扑下捕获的工作。
  - `ScreenTopologyMonitor`：一次系统通知只合并成一次「稳定刷新」，`stop()` 之后在途刷新全部作废（lifecycleGeneration 比对）。
- verify-model 断言 1181 → 1287（+106）：阶段/标题/五级标签/向上取整与边界、估算器的线性/过缓/过急/速率突变/完成/窗口裁剪七种情形、合流状态机三态与闸门、节流纳秒换算、拓扑节点夹取与 facts 分离、快照去重/排序/主屏存在性、Delta 四类与主屏变化、重配置代次、监视器合并刷新与 stop 作废在途刷新。

## 二十、缩放包络编辑器几何（1 文件 / 345 行）

`EditorZoomEnvelope.swift` 是 SwiftUI 视图，但「把一条缩放画成合成器包络」的全部决策
都在视图外可算：本批只搬几何与命中/拖拽，Canvas 绘制与 HUD 文案留给 React。

- 坐标：`x` 时间线性、`y` **对数**（2× 与 4× 屏幕等距是包络可读的前提）；倍数夹到 `[0.9, 6.4]`，所以 1× 以下仍能画到轴下方一点，不会贴死底边。
- `total` 在拖动期间**冻结**（`frozenTotal ?? max(curveDuration, 0.001)`）—— 否则拖动进入段时横轴会跟着变，手势会自己漂走。
- `effectiveEnter`：进入时长为 0 且左侧有相邻片段时用工程默认过渡时长（说明是延续段落而非用户设 0），但不超过片段自身时长。
- 拖拽夹取三节点不对称：进入 `clamp(t, 0, min(duration, 3))`（不能超过本体），保持只改倍数，退出 `clamp(t - duration, 0, 3)`（本来就是追加段）；峰值 `clamp(…, 1.05, 6)`，下限 1.05 保证「拖到平」也还是放大。
- 命中：悬停 22pt、起手 26pt，半径内取最近；退出段不存在时只暴露前两个节点。
- 采样：`max(宽度/3, 24)` 步；播放头只在 `[startTime, startTime + curveDuration]` 内才画；参考线固定 1/2/3/4/6×；阶段名只在跨度 > 30pt 时显示，窄面板下自动隐去避免叠字。
- 缓存键含轨道身份、片段 id、运动样式、步数、绘图区与 total —— 采样已解析轨道是最贵的一步，片段与邻接未变就不重采样。
- verify-model 断言 1287 → 1366（+79）：常量、绘图区最小 1pt、坐标映射与对数往返、0.9 下限、三节点位置、命中半径与取近、六种拖拽夹取、采样步数与曲线端点、播放头三态、参考线、阶段标签可见性、缓存键五字段比对。

## 二十一、旋钮 / 遮罩 / 播放观察者等 8 个交互支撑件（8 文件 / 438 行）

- `core/EditorKnobDrag.ts`（55 行）：角度以 **12 点为 0、顺时针为正**（`atan2(x, -y)`），每步只取**最短有向差**（>180 减 360、<−180 加 360）—— 跨底部接缝与按 Shift 都不会把之前的位移重新解释成反向。离圆心 <6pt 时角度无意义，锚点清空、等离开死区再重新锚定，绝不跳半圈。滚轮只在**垂直为主**时生效，单次夹到 ±0.08 再乘精细倍率 0.2。
- `core/EditorMotionCurveStyle.ts`（27 行）：顺滑/利落/柔和 的标题、SF Symbol 名与说明文案逐字照搬。
- `core/EditorCanvasSleepPresentation.ts`（46 行）：只拥有休眠遮罩动画；0.26s easeInOut，reduce motion 时长为 0。**只有最新一次过渡的回调有效**（revision 比对）—— 同一次淡入淡出中的第二次失焦会替换 completion，但必须等这次结束。
- `core/RecorderPanelTransition.ts`（57 行）：录制窗口透明度唯一所有者。reduce motion 时用 0.10s 而非 0.18s；被取消的淡出可以晚到，但**只有最新一次可见性请求**才有权 orderOut（revision + wantsVisible 双条件）。
- `core/EditorPlaybackTimelineObserver.ts`（63 行）：弱引用观察者表 + **一次 tick 一个事务**。原注释记录实测：每个观察者各自包 CATransaction 时，每次提交都是顶层提交，会把整个 AppKit 显示周期跑一遍，占主线程约 44%；外层包一个事务后它们变成嵌套提交，窗口每 tick 只提交一次。
- `core/EditorTimelineCameraSync.ts`（58 行）：同步点轨中心线 41pt、振幅 14pt，偏移归一化夹到 ±1；标签恒带符号（`+12 ms` / `-12 ms`）；拖动草稿优先于已提交锚点；删除锚点后按源时间映射回输出时间试听，被删锚点若正选中则清空选择。
- `core/EditorTextInputHitTesting.ts`（60 行）：两条判据 —— 活动 field editor 可能被重挂到输入框之外，命中它自身可见区就直接算「点到了文本输入」；否则从命中节点沿父链找可编辑 NSTextField/NSTextView。锚点视图 `hitTest` 恒返回 nil，永不拦截鼠标。
- `core/EditorPlaybackInitialFrameWaiter.ts`（72 行）：一次性首帧桥接。`requestNotificationOfMediaDataChange` 在没有 pull delegate 时无效，所以必须先装 delegate；结果只定一次（超时/取消/通知都收敛到同一条 `finish`），定完立刻摘 delegate、清计时器 —— 不必用 8ms 轮询把编辑器叫醒。
- verify-model 断言 1366 → 1499（+133）：旋钮角度四象限与死区、步进/精细/夹取、接缝最短路径、跨圆心重锚定、滚轮五类守卫、三套文案、遮罩 revision 竞态四态、面板 show/hide 幂等与过期回调、观察者事务单次提交与过期清理、同步点 y/label/草稿/删除决策、文本输入命中两条判据、首帧等待的成功/超时/取消/缓存四种结局。

## 二十二、导出请求构建（1 文件 / 431 行 + 2 处符号合并）

`EditorExportRequest.swift` 是「按下导出」到「真正开编」之间唯一的闸门：它把编辑器检查过的
素材**冻结成路径 + 文件代次**，任何代次漂移都在这里变成可读的中文错误，而不是悄悄编到别的文件上。

- 代次冻结：`EditorExportAsset = { url, version }`，`version` 取 inode 号（`NSFileSystemFileNumber` /
  `NSFileSystemNumber`）+ 大小 + 修改时间。只比路径不够 —— 同路径被覆盖后路径完全一样。
- 校验流水线顺序即错误优先级（`buildEditorExportRequest`）：会话 → 代次 → 源序列键 → 清单键 →
  清单存在 → 逐个素材（摄像头/麦克风/背景/贴图按**后期状态**决定要不要）→ 代次复核 → 输出路径
  （本地 → 扩展名 → 不覆盖输入）→ 源视频轨 → 重建媒体计划 → 范围夹取。
- 只导音频时不要求摄像头与背景素材 —— 但麦克风仍按 `requiredMedia.microphoneAudio` 要。
- 贴图清单来自 `project.timeline.stickerClips` 的 `relativePath`，用 `stickerURLs[relativePath]` 查表；
  表里没有就是 `missingAssetReference`（而不是「文件不存在」）—— 这两类错误对用户是不同动作。
- 输出路径三段：`isFileURLPath` 拒掉带 scheme 的地址（`file://` 也算，因为 port 层只接裸路径）；
  扩展名必须与 `outputKind` 一致（大小写不敏感）；最后用 `exportFileTransactionCollides`
  与全部输入 URL 比对，防止导出覆盖项目素材。
- 范围夹取容差 = `max(|成片时长| × ulp × 8, 1e-6)`：用户把播放头拖到末尾时浮点尾数会略微超出，
  不能因此报错；夹取后要求 `end > start`，「选了 0 长度片段」仍然报 `invalidOutputRange`。
- 文案：`nonFileAsset` 模板是 `"\(displayName)素材不是可用的本地文件"`，而 `wallpaper` 的
  displayName 就是「背景素材」，所以会输出「背景素材素材不是…」—— 上游原样如此，照搬不改写。
- verify-model 断言 1499 → 1599（+100）：两种输出扩展名、五种素材名、文件代次五字段比对与
  inode 缺失、范围/片段计数取值、11 类中文文案逐字、本地路径四态（含 `file://`）、素材三类校验
  顺序、文件名净化六种输入（`/` `:` 换行 控制字符 首尾空白 空串）、`-2`/`-3` 不覆盖、
  默认名四条分支（有名/无名 × 视频/音频）、构建器正常路径 + 十类错误优先级 + 摄像头只在视频要、
  浮点容差夹取到 `[0, 时长]`。

## 二十三、UI 小件与运行时身份（12 文件 / 303 行）

这一批是「设计常量 + 一条判定」的短文件。它们本身没有复杂逻辑，但每个都藏着一个
**改错不会报错、只会让界面悄悄变丑/行为悄悄变怪**的细节，所以逐条搬数值而不是重写。

- `core/RecorderAccessibility.ts`（10 行）：7 个无障碍标识符逐字照搬（`recorder.phase.setup` 等）。这些是测试契约，不是文案 —— 改一个字符 UI 测试就找不到元素。
- `core/EditorMagnetIcon.ts`（13 行）：线性图标按 `min(w,h) × 1.15` 放大后再塞回原框架。1.15 不是随手取的：图标从「实心吸附符」改成 18pt 线网格后视觉变轻，靠这 15% 补齐分量。
- `core/AppIdentity.ts`（15 行）：显示名读 bundle 而不是硬编码 —— 开发版与发布版故意不同名。空白/缺失一律退回 `DogSC`。
- `core/AppWindowSurface.ts`（17 行）：圆角半径夹到 `min(w,h)/2`，否则改尺寸过程中圆角会互相切掉。必须在 WindowServer 采样阴影前生效，包括中间帧。
- `core/EditorLinearFocusRotationHandle.ts`（24 行）：**只有字形转**，28pt 圆盘与命中区恒不动 —— 圆盘跟着转会让拖动中的进出边界变形。激活态底色 0.13 / 描边 0.85，常态 0.19 / 0.6。
- `core/RecorderViewStyle.ts`（27 行）：`Color ↔ HexColor` 桥的量化规则：夹 [0,1] → ×255 → **四舍五入**（不是截断）。用截断的话取色器每往返一次颜色就暗一档。
- `core/SharedFrameCompositor.ts`（28 行）：合成只做「空 extent 短路 → 复用 `preparedBackground` 或现算 → 叠加 → 裁到 extent」。背景每帧重算是最贵的一步，所以 `preparedBackground` 的复用顺序不能动。
- `core/RecorderIslandLayout.ts`（32 行）：胶囊弹簧期间原生窗口只提供绘制空间。`peak` 取旧/新/当前摆放三者逐轴最大，canvas 左右各留 `max(16, ceil(peak.w × 5%))`、上下共 32pt 给过冲与 6pt 模糊；**重指向时 canvas 只增不减**，否则正在跑的弹簧被裁边。
- `core/RecorderSourceThumbnail.ts`（32 行）：一次一帧、无缓存、排除自身进程窗口。缩略图宽固定 256，高 `trunc(256 × h / max(w,1))`（向零截断），下限 2px；源选择窗口优先、显示器兜底、都没有返回 null（显示占位而不是旧图）。
- `core/CameraCaptureFormatSelector.ts`（34 行）：横屏优先时**先筛后取最大** —— 先剔掉竖屏，再剔掉像素超过 1080p×1.05 的，剩下的取像素最多；该档为空退回全部横屏；竖屏优先设备直接给最大。并列保留下标最小者（对应 Swift `max(by:)` 的严格大于）。
- `core/SettingsAppearanceMiniature.ts`（35 行）：缩略图是按几何画的小界面而非截图。「跟随系统」叠两层（浅底 + 深色右半遮罩），一层展示两种结果。
- `core/EditorAppearanceToggleButton.ts`（36 行）：工作区边缘只放一个动作，三态偏好留在设置。点击目标是**具体**浅/深 —— 由生效配色而非存储偏好推出，否则「跟随系统」下点一下像没反应。reduce motion 时过渡退化为纯透明度，动画回落到 0.18s 缓出（不是无动画）。
- verify-model 断言 1599 → 1740（+141）：标识符逐字与阶段映射、磁铁图标 `min×1.15` 与框架/字形分离、显示名四种兜底、圆角夹取四态、旋转手柄两套色值与「只转字形」、通道四舍五入/夹取/NaN、颜色往返两次不漂移、合成器零尺寸短路与背景复用调用序列、胶囊 peak/留白/只增不减、缩略图三种宽高比与源选择三态、格式选择六种组合（含并列与非法下标）、缩略图三层叠放与几何常量、切换按钮两向文案/无障碍三件套/过渡与动画回落。

## 二十四、引导高亮 / 支持面板 / 采集过滤 / 字体（6 文件 / 289 行）

- `core/FirstUseTourHighlight.ts`（41 行）：高亮框走与录制源表面同一条形状路径。段宽 `(宽 − (段数−1)×间距)/段数` —— 间距只出现在段**之间**，两端不预留；`corners: .top/.bottom` 让共用卡片只有外侧两角是圆的。AppKit 的调光层原点在左下，路径必须`y' = minY + maxY − y` 翻转，否则 `.top` 的圆角会跑到下边。
- `core/AppSupportSheet.ts`（53 行）：赞赏码**原样显示**（`scaledToFit` 不裁切 —— 裁掉一角就扫不出来），400×400、圆角 8、0.75pt 发丝边；图片缺失时用同尺寸占位文案，弹窗高度不跳动。
- `core/CameraCaptureSessionEventMonitor.ts`（54 行）：AVCaptureSession 的失败通道只有通知，没有返回值。这里把它收成三态事件（runtimeError / interrupted / interruptionEnded）；**通知里没带错误也必须造一条**「未知运行错误」——吞掉事件等于让录制继续跑在死摄像头上，最后产出轨道错位的成片。`dispose()` 取代 deinit（Windows 无确定析构时机），并且幂等。
- `core/CaptureSurfaceFilter.ts`（54 行）：`excludingApplications`（排除整 App）与 `exceptingWindows`（从被排除的 App 里单独放回窗口）是两套语义，编辑器窗口与 Finder 桌面图标共用例外通道 —— 所以两者可以共存。编辑器窗口的条件是**两条**（自身进程 **且** 在编辑器集合）；Finder 桌面只认 `layer < 0` 的窗口，否则连访达窗口一起藏掉。
- `core/RecorderSaveActions.ts`（62 行）：动作行 36pt / 图标 18 / 间距 10 / 左右 8，按下 0.98 + `easeOut 0.13`，禁用时整体 0.4；视觉层关掉命中与无障碍，整行只由原生首点目标承担。有说明文案时**不再画箭头**（detail 优先于 chevron），否则右侧同时出现「12 MB」和「›」像两级菜单。开关行 34pt（比动作行低 2pt）。
- `core/AppTypography.ts`（64 行）：随包只有三个字面（55/65/75），因此 semibold/bold/heavy/black **全部落到 75_SemiBold**、light/thin 落到 55 —— 上游取舍照搬。等宽（时码）永远系统字体：写进成片的文字不能被替换字体影响。语义字号表 26/22/18/16/13/12/11/10，`.headline` 默认 semibold。量宽固定用 55_Regular。
- verify-model 断言 1740 → 1859（+119）：段划分（宽/首末 x/高度/角半径）、三档 corners、inset 与单段、Y 翻转；面板全部尺寸与三种图片态；会话三类事件 + 空白错误合成 + 未知通知返回 null + 观察者挂载/释放；过滤计划在两种配置下的排除/例外集合、Finder 桌面 `layer<0`；保存行几何与 detail/chevron 四态；字体字面映射九种字重、语义字号、等宽与未注册回退、headline 默认字重。

## 二十五、滑块行程 / 标记 / 工作区布局 / 暂停帧 / 裁切呈现 / 键盘桥（6 文件 / 500 行）

- `core/EditorSliderScale.ts`（79 行）：**只有物理行程变**，绑定与存储值仍是参数原单位。对数映射用 `log1p(delta/knee)/log1p(span/knee)` 而不是 `log`：膝盖以下近似线性、以上近似对数，且 0 处不发散。反解用 `expm1` 并夹到上界。刻度先按 1/2/5×10ⁿ 生成候选（对数固定 10⁻³…10⁶ × 1/2/5），再用「与上一刻度 ≥38pt 且距右端 ≥38pt」过滤 —— 后者保证末刻不贴边。倍数 knee=1、秒 0.5、点 `max(span/8,1)`；下界为负一律线性。
- `core/RecordingMarkers.ts`（81 行）：打点可用性四条件（录制中 / 未暂停 / 未在暂停过渡 / 拿得到源时间）；与上一个标记相差 <0.3s 丢弃（键重复与双击不是用户意图）；编号取 `max+1`，删除中间标记也不复用。快捷键签名 `0x44474D4B`、⌃⌥M，**只在录制期间注册**（注册式快捷键在别的应用里也生效，且不需要事件拦截与额外权限）。
- `core/EditorWorkspaceLayout.ts`（82 行）：压缩度 = `max(窗口压力, 屏幕压力)` 夹 [0,1]；1080p 屏幕上即便最大化也紧凑，大桌面保持原布局，**后备像素与导出尺寸永不进入计算**。所有尺寸按压缩度在 regular/compact 之间线性插值（工具条 72→56、外边距 16→10、轨道间距 12→8、边缘 40→12、间距 60→16、色标 1→0.86）。时间线高度预算留出固定占用后再夹 `[170, 可用高×44%]`（紧凑时）。`EditorChromeScaleLayout` 把提案**除以** scale 再问子视图，报尺寸时乘回去 —— 表面、悬停形状、控件与命中区一起缩。
- `core/EditorPlaybackPausedFrames.ts`（84 行）：暂停帧按 `floor(t×fps)/fps` 对齐（fps 下限 1，否则除零）。屏幕与摄像头各自生成器**并发**解码，把刷新时间降到两者较慢者；生成器由请求对象持有到整个请求结束（只取消 Task 时它们仍在后台解码）。回主线程后四重过期检查（代次/seek/解码令牌/播放中）全过才贴图，否则画面会闪回。摄像头帧三结局：写入 / 不需要就清空 / 解码失败保留旧图。
- `core/EditorCropPresentation.ts`（87 行）：纯呈现适配器，不持有任何布尔量 —— 工具**与**选择同时为 crop 才进入。三个表面（工具栏/检查器/画布）分别取值，因此「工具栏已切画布没切」这种漂移可断言。`permits` 是同步闸门：常规工具栏只放行三个进入动作，裁切工具栏只放行 reset/cancel/confirm —— 阻止排队中的常规动作在裁切开始后执行。草稿走 RecorderCore 的 `clamped(minimumSize: 0.02)`。
- `core/EditorSliderKeyboardBridge.ts`（87 行）：时间线有窗口级方向键监视器，正在编辑的滑块必须是真第一响应者才会让它让位 —— 否则调参数时电影走一帧。右/上 = +1、左/下 = −1；按下 cmd/ctrl/option 一律交还系统；Shift = 精细。焦点只在「未请求→请求」那一帧抢占（否则 Tab 走不掉），点到别的窗口或控件外即释放，焦点变化异步回报。
- verify-model 断言 1859 → 2012（+153）：线性/对数行程与反解往返、四种比例选择与负区间线性、1/2/5 台阶与 38pt 过滤、退化为单值；标记四条件、0.3s 去抖、编号与 NaN 拒绝、快捷键三常量与注册时机；压缩度三态（含屏幕压力与中间插值 0.409…）、全部派生尺寸、时间线高度四档、缩放提案双向换算；暂停帧对齐/四重过期/摄像头三结局/令牌回绕；裁切三模式与进入双条件、clamp 四边、permits 矩阵四格；方向键映射与修饰键让位、焦点三判据。

## 二十六、提示卡 / 预览采样 / 弹出菜单 / 纯音频导出（4 文件 / 335 行）

- `core/EditorTransientNotice.ts`（78 行）：三条文案改写（同轨道冲突、剩余不够、`项目已打开，但` 前缀剥掉作为正文）+ 「操作未完成」兜底；存活时长 = 详情字数 × 0.08 夹 [5,10] 秒。这是**短暂反馈**：持续性失败有自己的状态条目，卡片永不占住工作区。reduce motion 时进度条不做线性收缩，但关闭时机不变。进度条让出 41pt 与图标列对齐（满格 283pt）。
- `core/PreviewAnimationPreparation.ts`（79 行）：显示循环用 60fps 栅格（四舍五入），**暂停/导出路径故意不量化**。区间按开场→缩放→屏幕运动→镜头运动→马赛克→贴图收集；缩放进入段 `min(时长, 0.6)`。预热只取「未结束且已进 8 秒视野」的区间，每段采 `start + max(min(entry/2, 半长), 1/60)`，开场额外采 82% 处（错峰出场的摄像头/贴图那时才就位），去重升序后最多 4 个点。
- `core/EditorPopover.ts`（89 行）：**空格仍是走带键** —— 只有聚焦的菜单触发器处理 Return/↓ 的按下，且任一修饰键存在就让位（否则 ⌘↓ 被菜单吃掉）。焦点入口是 1×1 透明可聚焦视图而不是让内容变成控件（嵌套输入框要保留自己的响应者）。`targetsPresentedContent`：事件窗口 ≠ 第一响应者所在窗口时，工作区的键盘监视器必须让路，否则菜单里按空格会同时触发播放。
- `core/AudioOnlyExportPipeline.ts`（89 行）：导出编辑器里听到的那一份音频（同样剪切/重定时/分段混音），不启动视频渲染器也不编码占位帧。两条音轨都空才报 `noAudioToExport`；静音即 0、否则音量夹 [0,1]（工程里出现 1.4 会让 AVAudioMix 直接报错）；范围缺省 = 全片；进度轮询 120ms 且夹到 0.99，收尾补 1；取消优先于一般失败；重定时用 `spectral`（其它算法变速会带金属音）。
- verify-model 断言 2012 → 2099（+87）：三条改写 + 前缀剥离 + 兜底、存活时长四档、进度条三档宽度；60fps 量化四态、区间六类与进入段上限、预热两处窗口（4 点 / 3 点）与容量截断；弹出层按键四类让位 + 空格不拦截 + 呈现窗口三判据；音频轨存在性三态、音量五态、范围缺省、进度夹取、取消判定、错误文案含详情。

## 二十七、检查器与窗口交互（12 文件 / 990 行）

这一批全是「编辑器外壳」的支撑件：ESC 归属、相位条、权限引导、更新器闸门、壁纸手风琴、
拖动刷帧、标题栏交互、色彩配置、裁切命令闸门、检查器派生文案、页签栏、窗口淡化。
共同点是**每条判断都对应一个用户能摸到的后果**，所以全部按原样搬判定而不是重写。

- `core/EscapeDismissibleWindow.ts`（13 行）：有附着 sheet 时 ESC 交还响应链，否则关窗。顺序颠倒会让 Esc 连窗口一起关，用户丢掉 sheet 里的未保存输入。
- `core/EditorZoomPhaseBar.ts`（70 行）：三段宽度按**实际时长占比**切，`total` 用 0.001 兜底防 NaN；`hold` 单独 `max(duration - enterDuration, 0)`，进入段被挤压时保持段归零而不是负宽；渐变位置 clamp 到 1，否则胶囊右端出现硬边。段宽 > 58 才显示文案。
- `core/EditorTheme` 外部依赖：phase 条的「进入 / 保持 / 退出」文案与图标照搬（arrow.down.right / viewfinder / arrow.up.left）。
- `core/PermissionTourFlow.ts`（74 行）：**只表达呈现状态**，从不授权。三条不变量：用户在系统设置里操作期间即使轮询看到成功也保留来源步骤（否则切回来发现已跳步）；返回时来源步仍未授权就停在原步；`advance` 落到 `ready` 但权限不齐则退回第一个缺口。`ready` 不接受 `openedSettings`。
- `core/AppUpdateController.ts`（76 行）：开发版**永不替换正式版**。`didStart` 先置位再判分支，所以开发版也会记住「已尝试」，后续任何调用都不会重复启动 updater；手动检查的顺序是 启动 → 激活应用 → 检查，少一步更新窗口会落在别的应用后面。
- `core/EditorWallpaperAccordion.ts`（88 行）：权重 hover 5 / 选中 3.4 / 其余 1；**hover 优先于选中**，且 hover 存在时选中片不再享受 3.4 —— 否则指针扫过会出现两条同时张开，用户分不清哪条是将选中。可用宽先扣 `(n-1)×4` 间距；展开且宽 > 72 才显示标题胶囊。
- `core/EditorPlaybackScrubbing.ts`（90 行）：拖动刷帧三条不变量 —— 指针时钟不等待解码（`latestOutputTime` 立刻前进）；**一次只允许一个 seek 在飞**（固定 33ms 的「取消再 seek」会把解码器饿死在密集录制上）；落地前三重校验（会话代次 / 媒体代次 / seek token）。松手优先用未消化的待办目标。
- `core/EditorWindowChromeInteraction.ts`（91 行）：双击标题栏空白处的三级回退 —— 新版字符串 → 旧版布尔 → AppKit 长期默认 **zoom**（不是 none）。空白 chrome 接受首点但不抢键盘焦点，单击一律转成窗口拖动。
- `core/CoreImageFrameColorProfile.ts`（92 行）：非 `sdrDesktop` 直接抛「只支持桌面 SDR 成片」，不降级；工作空间线性 sRGB、输出 sRGB、709 电视范围；Metal 上下文的选项必须与 CPU 版逐项相同，否则预览与导出会分叉。
- `core/EditorViewCropAndPreset.ts`（95 行）：`permits` 是同步闸门 —— 裁切进行中常规工具栏动作全部挡下，排队中的「切比例」不会迟到执行；开始裁切额外停播 + 让位；草稿写回只在裁切进行中放行，避免普通浏览时误触画布四角改到工程；外部动作后把 `crop` 选择退回 `screen`。
- `core/EditorInspectorScopeControls.ts`（97 行）：背景模糊只在壁纸媒体源出现；运镜「已按可用时间适配」的容差 0.001 要**同时**比进入、退出与**结束时刻**（只比前两项会漏掉末段整体被提前）；「恢复继承」只在真被覆盖时出现。
- `core/EditorInspectorTabBar.ts`（99 行）：六个页签按 `CaseIterable` 顺序（画面/开场/运镜/光标/摄像头/声音），44pt 命中、只有选中态显示名字、选中 padding 14/16；不可用页签降到 0.35 并给出「为什么没有」；裁切期间整条 0.45，两档透明度**相乘**而非取最小。
- `core/WindowAppearanceTransition.ts`（101 行）：外观切换只在「真的会变 + 前台 + 可见 + 未最小化 + 未被遮挡 + 未开减少动态」时才淡化（0.34s），否则直接赋值；通用 crossfade 先冻快照再改，两拍（0.05s）后按 `(0.4,0,0.2,1)` 淡出；快照优先取窗口服务器已合成像素（含 Metal 画布），失败才回退主线程重绘，且永不接收点击。
- verify-model 断言 2099 → 2387（+288）：ESC 两态；相位条四组几何（常规 / 全零 / 被挤压）、渐变四点、缝线与文案阈值；权限引导初始化三态、设置往返两条路径、`advance` guard 与复盘连按、撤销权限回退；更新器版本三种拼接、可用性三文案、启动闸门三态、开发版零副作用、正式版调用序列与自动检查写回；手风琴权重矩阵与三组布局（含空列表）、切片三态；刷帧夹取四态、合并器、单飞 + 追最新 + 代次丢弃 + 松手取待办；标题栏九种 token 与三级回退；色彩配置五处常量与抛错消息；裁切命令闸门矩阵（常规 / 裁切各四动作）、草稿优先级与 clamp、外部动作选择修正、命令包装两路；检查器派生文案与容差判定；页签可用性、帮助文案、无障碍标识（中文 rawValue）、两档透明度相乘；窗口淡化六条件与四种快照分支。

## 二十八、录制外壳与时间线外观（10 文件 / 1,255 行）

- `core/EditorTimelineRecordingMarkers.ts`（104 行）：书签不是按钮 —— 8×10 细书签字形塞在 18×20 命中区里，`offset = 比例×宽 − 9` 让命中区居中在时间点。时间戳 `floor(t×100)` 后拆位，负数夹 0（重排草稿期间 `outputTime` 可能瞬时为负）。跳转后**只有目标离边界不足 24pt 才滚动**，滚动位置放在视口 40% 而不是正中。恢复剪切 / 裁切 / 重排三种状态下不画书签（时间线位置与输出时间不一致，画上去会指错）。
- `core/EditorPersistenceIndicator.ts`（109 行）：徽章反映**写入管线**不是计时器 —— 干净快照 + 有草稿仍然是「编辑中」。失败态琥珀 0.10/0.25，常态 0.045/0.06。保存中呼吸点 `reduce motion` 时恒定满幅（不闪），否则三角波 + smoothstep 同步改缩放与透明度。
- `core/ProjectWorkspace.ts`（111 行）：唯一文档 + 持久化世代。订阅顺序不可换：先转发变更再排自动保存，反过来 UI 会在旧快照上重绘一帧。`RecordingSessionWorkspacePort` 只暴露录制真正需要的五个成员。
- `core/CaptureDeviceResolution.ts`（117 行）：**角色是身份的一部分** —— 同名但角色不同的设备永不满足请求；自动选择只能由显式 `automatic` 表达，绝不从「精确查找失败」推断；iOS 端点永远要求精确 ID。六条文案按「有没有指定 ID」分叉（没找到 vs 已断开）。
- `core/CameraRuntimeFormatMonitor.ts`（119 行）：环形窗口 31 格；帧率先看样本时长，样本不足 8 个时才回退窗口估算 `(n−1)/(last−first)`；上报收敛 —— 分辨率变了立刻报，否则必须「距上次 ≥ 1s」**且**「帧率差 ≥ 0.5」同时成立，否则灯光抖动会把状态栏刷成心电图。fourCC 非可打印字符回退 `0x%08X`。
- `core/EditorFramePreview.ts`（120 行）：边距 = `min(14 + padding/360 × 舞台高×26%, min(舞台宽高)×42%)` —— 小舞台里边距按比例缩但不吃掉画面；标题条 11 / 机身 4.5；缩放夹 [0.6, 1.6]；内容圆角 `3 + clamp(radius,0,160)/160×9`；外框圆角 设备 bezel×3 / none 用内容圆角 / 其余 6；阴影 `0.18 + 0.4×clamp`。
- `core/RecorderPanelInteraction.ts`（121 行）：拖动手柄 22×40（两列各 3 个 2pt 点）。指针区域判定三态 —— 没启用/没岛/岛不在本窗口 → ignore；**鼠标按着 → keep**（接收方要稳定到收到 mouse-up，哪怕指针已离开岛）；否则按圆角矩形判定。监听器安装幂等，停用时本地与全局一起摘。
- `core/EditorShortcutCheatsheet.ts`（126 行）：四组 26 条快捷键成为**唯一真相来源**；键位列宽 = `ceil(max(96, 最长键位 + 16))`（等宽 11pt 量宽由渲染层注入 `measure`），面板宽 = 344 + 键位列。
- `core/RecordingProjectEditor.ts`（130 行）：跨保存屏障要五条同时成立；打开项目四态（ignore / createModel / reuseModel / reject）；阶段观察回到 `setup` 才算释放（带错误就先报告再释放）；替换用 `flushAndInvalidate` 并关项目，退出只 `flush` 并回到 `editor` —— 取消退出的用户还要继续编辑。
- `core/EditorTimelineClipChrome.ts`（129 行）：四态优先级 editing > selected > hovered > idle（正在编辑的片段必然也选中，先判 selected 就丢掉更强描边）；有轨道色时静止 0.45 / 悬停 0.7，中性主录屏卡 0.1 / 0.2（中性卡上 0.45 像被选中）；选中/编辑换成 1.5pt 实环；只有墨色淡入淡出 0.14s，几何与媒体不动。
- verify-model 断言 2387 → 2620（+233）：时间戳五态与负数、偏移与零时长、三种隐藏态、滚动三向夹取；徽章四态与呼吸点四帧；工作区自动保存去重与转发；设备解析（角色不匹配 / 无默认 / iOS 永不自动 / 精确命中）与六条文案；环形窗口回绕与帧率窗口估算、抑制与复位、fourCC 两路；画面预览四组几何（none / browser / device / 位置）与壁纸参数；指针判定八态与圆角命中；快捷键表 26 条与列宽三算；保存屏障七态、打开四态、阶段观察三态、两条落盘路径与失败文案；片段外观四态数值、两套静止透明度、三种 ring 来源。

## 二十九、采集与预览管线（6 文件 / 649 行）

- `core/ExportLoopingWallpaperVideoReader.ts`（92 行）：壁纸按**输出时间**循环，且有意静音（工程声音只归录到的系统/麦克风轨）。重置条件三种：没建过、进下一圈、**本地时间倒退**——第三种最易漏，同圈回拖时 reader 已越过目标，不重建只能拿到后面的帧，画面会「跳一下」。采样命中容差 0.5ms。
- `core/RecorderInputToggle.ts`（92 行）：保留原生开关与响应者，但 `focusRingType = .none`，改用中性胶囊（0.40 墨色）表达键盘焦点。焦点回报延到下一个运行循环，且送达时**重新读** firstResponder —— 在视图更新期间发布状态会触发 SwiftUI 警告，快速 Tab 还会写回过期状态。
- `core/SampleBufferTimeRetimer.ts`（96 行）：`offset ≤ 0` 或非数值直接原样返回（从 0 开始的录制走快路径，省一次数组拷贝与一次缓冲复制）；只减**有效**时间戳，`.invalid` 保持 invalid —— 给数字会让后续算出垃圾值。
- `core/CameraCaptureDeviceConfigurator.ts`（112 行）：先按选择器挑尺寸，再在同尺寸里取**节奏范围最宽**的格式，但从不设置具体 FPS（设备权威）；并列时保留先出现的（复刻 `max(by:)` 的严格小于）；选择器返回 null 时**什么都不做**，绝不随便降级到 480p。
- `core/SharedPreviewEffectPreparation.ts`（127 行）：签名只取 17 个「有无分支」+ 输出尺寸 + 贴图分支，不取动画坐标（否则每个滑块 tick 都重新预热）；预热前三重过期检查（代次/纪元/色彩契约）；签名历史上限 16，超了整批清空；缩小走 Lanczos，放大只做仿射。
- `core/EditorTimelineLaneLabel.ts`（130 行）：22pt 图标瓦片 + 标题 + 悬停浮出的隐藏按钮（常驻会占掉标题宽度）；折叠态内边距 15、名字挪进 tooltip；换轨转场「先出后进」（0.1s 淡出 / 0.22s 淡入 + 上移 6pt 延迟 0.12s），reduce motion 退化为纯透明度。
- verify-model 断言 2620 → 2757（+137）：循环位置四态、三种重置条件（含回拖）、采样推进四例、时长非法抛错；开关行布局与焦点三判据；重定基四态与无效时间戳保持；格式选择（并列保留首个、排除无帧率、非法尺寸跳过、精确不支持文案）；预热签名分支/尺寸/去重/过期/容量/缩放两路；轨道标签内边距、隐藏按钮三条件、分隔线两档、转场六参、行高表。

## 三十、聚焦检查器 / 性能采样 / 完成过渡 / 图标目录 / 关于页 / 样式预设（8 文件 / 1,117 行）

这一批横跨三类东西：一个检查器面板的取值与可见性、两个纯测量件（性能采样与完成过渡时钟）、
四个外观件（键盘焦点环、图标目录、关于页、编辑窗口过滤），外加场景样式预设的存取。
同一批里把「值怎么算」和「什么时候可见」拆开写，是为了让 React 侧只负责画。

- `core/EditorFocusEffectInspector.ts`（135 行）：屏幕 3D 片段**永远**按线性虚化呈现，即便 effect 为空 —— 这是 `isLinear` 的第一条分支，不能只靠 `shape`。线性化在写入前强制三件事（shape=linear / target=fixed / dimming=0），因为线性模式的「固定」不是用户选项而是没有目标概念。暗角只在线性下隐藏，其余三个滑块常驻。`guard editorStore.selection == selection` 变成 `focusEffectInspectorAcceptsUpdate`：拖拽途中被别的操作改掉选择时这一帧的写入必须丢弃，否则会把效果写到错误片段上。
- `core/RecordingPerformanceMonitor.ts`（136 行）：UInt64 计数器用 bigint + `BigInt.asUintN(64, …)` 复刻 `&-` 环绕；墙钟间隔为 0 时 CPU 百分比给 0 而不是除零。三条不变量：拿不到计数器时返回 null **且不推进上一帧快照**（否则下一拍会算出跨两拍的增量，读数直接腰斩）；summary 只累积真正产出的样本；`summary` 读出是快照拷贝。可用磁盘字节数三级回退（重要用途容量 → 容量 → 文件系统剩余），因为某些虚拟卷不暴露 URL 容量键。
- `core/CaptureEditorWindowFilter.ts`（137 行）：只登记标识符匹配的那**一个**窗口，窗口号必须为正整数；注销旧窗口不会误删新窗口（`editorWindow === window`）。刷新调度是单飞 —— 任务在跑时新请求直接丢弃而不是排队。注释里的 `@Published emits before storage changes` 是关键字：必须用**发出来的那份集合**做比较，否则「打开第一个编辑器」会被误判成没有变化，导致新建的窗口不被排除、录进画面。退避表 `[100,250,500,1000,1500]` 只为跨过 WindowServer 与 SCK 目录之间的发现延迟，不覆盖整个录制期。
- `core/RecordingCompletionTransition.ts`（137 行）：进度曲线 `1 − (1−t)⁴(1+4t)`，导数 `20t(1−t)³` 非负、t=1/4 处最大、两端为零 —— 加速后恰好停住，没有过冲也没有回摆。降低动态效果时时长 0.32 → 0.14，且**几何瞬间到位**（geometry 恒 1），只有透明度仍然渐变；两层不透明度之和恒为 1，所以交接期间不存在空帧。两张卡片都贴底边对齐，展开时预览向上长出来，而不是把动作按钮沿下边缘拖动。
- `core/AppControlFocusAppearance.ts`（141 行）：焦点环只由键盘导航触发。四条判定：只认 48/123/124/125/126（Tab 与四向箭头）；带 ⌘/⌃/⌥ 时**不动**（⌘Tab 是切应用不是应用内导航）；普通字母键既不开也不关（打字不该点亮焦点环）；任何指针按下立刻关掉。可见性三条件缺一不可（启用 + 有焦点 + 当前是导航态），`explicitFocus` 给定时**取代** isFocused 而不是相或。引用计数而非布尔：多个根同时挂载时只有最后一个卸载才拆监视器，监视器全局唯一。
- `core/EditorSymbol.ts`（142 行）：124 个 SF Symbol 名映射到 77 种自绘字形；图层顺序类符号（`square.N.layers.3d` 系列）刻意留在表外 —— 前后遮挡的语义线网格画不出来，退回系统符号是设计退路。字号吸附用严格小于比较，并列时保留更小的一档（13 → 12、19 → 18），与 Swift `min(by:)` 行为一致。
- `core/AppAboutSettingsView.ts`（144 行）：副标题、图标 76、入场 0.84/6pt 延迟 0.14s、三个出口磁贴、底部更新条。两个启用条件刻意不同：检查更新按钮要「正式版 **且** 分发器就绪」，自动检查开关只要求「正式版」（那是持久偏好，不需要分发器）。悬停位移的 y 只给外部链接 —— chevron 表示展开面板，不该有「跳出去」的手势语言。
- `core/EditorStylePresetStore.ts`（146 行）：预设带走静态呈现默认值，媒体/剪切/时序动画/录制时钟修正留在工程里。两条保护：背景三重闸门（有覆盖用覆盖 → 不含背景 / 有预设资产 / 当前背景不可用则保留原背景 → 才用预设背景），绝不把坏路径写进工程；隐式「上次使用」把 formatVersion 压回 1，于是裁切与摄像头可见性**不跟着走**——裁切只通过显式选择的场景预设传递。`matchesConfiguration` 比较六项配置但不比 includesBackground / formatVersion，那是簿记不是配置。
- verify-model 断言 2757 → 3151（+394）：聚焦检查器标题/无障碍文案/目标名、四个滑块的区间与线性隐藏、选择取回六态、线性判定四态、开关提案五值、线性化归一不动原对象、选择相等五态、写入计划与两条落地路径（含目标缺失）；性能采样（环绕减法、三类 CPU 边界、增量首次为空、磁盘三级回退、热状态五映射、样本七值、监视器首拍零增量 / 第二拍 100% / 缺计数器不推进快照 / summary 拷贝隔离）；编辑窗口（登记四拒、注册表替换与保留、刷新两源、退避表、失败文案、守卫五态、集合相等四态、重试循环四场景、类生命周期十一态）；完成过渡（时长两档、进度五点与单调/无过冲/夹取、几何两路、四边插值四例、互补不透明度、单帧七值、初始状态、布局）；键盘焦点（键码表、修饰键三类、事件动作七态、可见性七态、引用计数八态）；图标目录（124 项 / 77 种、抽查 10 条映射、未知与图层顺序回退、字号吸附七例）；关于页（22 个常量、磁贴三组、入场三态、悬停位移四态、无障碍标识两路、启用条件五态）；样式预设（格式版本与裁切三态、构造七值、应用九条路径、三重背景闸门、配置比较三态、背景可用性七态、存储往返与默认 ID、隐式快照不带裁切、显式预设带裁切、值相等四态）。

## 三十一、悬浮预览 / 配色 / 波形缓存 / 旋钮输入 / 本地化 / 动作菜单 / 源文件交换 / 设备生命周期（8 文件 / 1,480 行）

这一批的共同点是**状态机**：悬浮预览的让位、旋钮的滚轮轮次、设备目录的刷新爆发、
波形缓存的溢出淘汰。四处都靠「代次 + 单飞」防串台，写法几乎同构，所以放在一批里
对照着看更容易发现哪一处漏了一重校验。

- `core/EditorPlaybackHoverPreview.ts`（147 行）：逻辑时钟全程不动，只把**传输层**物理 seek 到所指帧。`isPlaying` 在渲染 tick 里写死为 false —— 悬浮只可能发生在暂停态。结束时的四种组合值得记住：只排了任务没在飞（`needsTransportRestore` 为假）→ 作废代次但不归还位置；在飞但还没发布时刻 → 也要归还（物理位置已经偏了）；`restoreTransport: false` 的四个入口（显式 seek / 按下拖动 / 起播 / 媒体重建）自己决定位置，悬浮只让位不归还。注释里那句「即使 seek 没发布时刻也要作废代次」是防「关闭悬浮后落地的结果复活出一帧没有参考线的悬浮画面」。
- `core/EditorInspectorPalette.ts`（149 行）：六个页签**全部**石墨黑（UX-184 第六轮的决定），一轨一色只留给时间线效果轨：绿 80°、琥珀 45°、珊瑚 18°、青绿 172°、玫红 340°。每个角色一次性给出 light/dark 两份值：`soft` 是本色 0.24/0.20，`softInk` 深色用「本色 +38% 白」（选中的洗更浓时仍保 5.7:1），`text` 浅色用专门的深色（4.5:1）深色用本色。
- `core/EditorTimelineWaveformCache.ts`（149 行）：九段身份字段顺序不可变，缺字段用 `-` 占位（跳过一个字段会让「有版本」与「无版本」的两条不同素材撞键）；时长取 `end − start` 而不是 `end`（否则同素材的前后半段共用键）；读到版本不符／数量不符／有非 [0,1] 值就**删文件**再返回 null。溢出按修改时间升序淘汰，命中时把修改时间改成现在 —— LRU 的近似。
- `core/EditorKnobInput.ts`（153 行）：滚轮的判定顺序即语义 —— 先四条前置（启用 / 是键盘窗口 / 没在旋转 / 没按 ⌘），再惯性阶段（有就收尾并**不消费**），再 ended/cancelled 阶段，最后才算增量。惯性必须掐断，否则手指离开触控板后参数还在变。`mouseDown` 先 `finishWheel()`：按下即结束滚轮编辑，两者不共存；`mouseUp` 在 `onDragEnd` 之前**再发一次** `onDragChange` —— 松手位置才是最终值。收尾定时器必须带代次，否则连续滚动会被上一轮的超时打断。
- `core/AppLocalization.ts`（159 行）：语言解析先读全局域再读应用域（注释里的陷阱：用户删掉覆盖后应用域不能回灌到 System 结果）。标识符没变就不发布 —— 在无实际变化的偏好上点两下不该触发全应用重绘。`LocalizedStringCache` 的存在理由是「一次时间线拖运会重跑几百次取标签」；换语言时整批作废。窗口标题只翻译应用显式注册的那些，用户自建的项目名不变成翻译键。
- `core/EditorActionMenu.ts`（159 行）：宽度 `min(360, max(270, ceil(内容宽) + 2))`，内容是三项里取最大 —— 分隔行贡献 0（否则只有分隔行会得到宽度 2），信息行 `文本+36`，动作行 `max(标题,详情) + 88 + 有图标时 34`。计高按 15/40/40/56 累加后夹到 360。行底色四级：按下 → 悬停 → 选中 0.045 → 无；禁用时即使按下也只剩选中色。Return 键带任何修饰键都不执行。
- `core/ProjectMediaExchange.ts`（164 行）：文件名只把 `/` 与 `:` 换成 `-` 再 trim（用户的项目名里可以有中文、空格、括号），空则「未命名录制」；去重目录名从 `-2` 开始（第二份才叫「第二份」）；扩展名回退认「麦克风/microphone」两个基名，`.hidden` 与 `b.` 都回退；素材校验三条（有轨 / 有限 / > 0.01s）缺一不可。SRC-003：外部摄像头文件是**独立**辅助源，不需要音轨也不需要与屏幕同长 —— 短一点就按自己的时长结束。
- `core/CaptureDeviceLifecycle.ts`（165 行）：代次 `&+ 1` 后回绕到 0 时改 1（0 是「从未开始」的哨兵，被当代次会让所有未开始的域都判为有效）。刷新爆发是累计时刻 `0/250/500/1k/2k/3k/5k`，每次调度都取消上一轮**并**换代次（只 cancel 不换代次，取消落在检查点之后时那一轮还会再刷一次）。通知必须校验会话 id —— `stop()` 时通知可能已经排在队列里。
- verify-model 断言 3151 → 3526（+375）：悬浮预览（tick 空/夹取/六个字段、允许悬浮四态、目标夹取、调度四态、结束计划六种组合、发布四重门、在飞计数、状态机十三步）；配色（rgb 往返、白化、alpha 两档、五条轨的 hex 与三段映射、页签全主轨、选择映射九态、wash 两档）；波形缓存（版本/上限/目录拼接、样本五判、包络四态、九段身份字段与两段区间可区分、位模式四例、溢出淘汰三态与最旧先删、条目资格三态）；旋钮（四常量、跟踪选项、命中三态、收尾三态、指针五态、按下两件事、滚轮九态与反向翻转、轮次代次、收尾计划两态）；本地化（语言解析七态、快照、缓存只解一次、store 切换不发布/发布、`%@` 替换三例、窗口标题三例）；动作菜单（九个常量、宽度七例含图标列与夹取、计高四例、行高/图标/对勾、前景三档、点位五态、偏移缩放各三态、Return 三态、无障碍两例）；源文件交换（九个常量、消毒六例、目录去重三例、扩展名七例、校验五例、两条错误文案、三条消息、导出计划四例）；设备生命周期（四域、代次三例、延迟表、通知三态、继续三态、类生命周期十四步）。

## 三十二、录制支撑 / 摄像头帧规范化 / 窗口几何与层级 / 调色面板 / 场景预设（6 文件 / 1,040 行）

这一批全是「录制侧的外围件」加上两个编辑器面板。它们的共同点是：真正难的部分不在
UI，而在**崩溃之后能不能把话说清楚**（错误文案分级、取消与失败的区分），以及
**多屏坐标怎么换算**（macOS 原点在左下、Windows 在左上，y 只要翻一次就不该再翻第二次）。
TS 侧 1,623 行。

- `core/CaptureRecordingSupport.ts`（289 行）：`recorderSetupErrorRecoveryForMessage` 是双形态的 —— 中文前缀（"权限"/"摄像头"…）走一套固定建议，其它语言按当前语言的规范文案匹配；这是上游为了兼容「系统抛来的本地化错误串」和「自己拼的串」两条来源而做的妥协。`isPermissionMessage` 用 `includes('权限')` 是**有意宽松**：宁可多认一次权限问题，也不要在真权限失败时给「请检查设备连接」的误导。`captureFinishOutcome` 的 `succeeded = !hasError || successfullyFinishedFlag` 保留了一个不对称：有错误但成功标志已置位算成功（停止时先报 finished 再报 error 的竞态），反之不成立。`captureActivityRecordingRequestID` 刻意**不**认 `livePreview` 的请求 id —— 悬浮预览不是录制请求，拿它去配会误停录制。
- `core/CameraSampleWriterFrameNormalizer.ts`（263 行）：`cameraFrameOutputDimensions` 源尺寸为 0 时兜底 1（否则下游除零）；`cameraFrameNeedsNormalization` 把**像素格式不同**也算作需要规范化 —— 尺寸一致但 BGRA vs 420f 仍必须过 `VTPixelTransferSession`。类里五条错误文案按「建 session 失败 / 建 buffer 失败 / 建池失败 / 转换失败 / 回调失败」分级，前三条是配置问题（重试无用），后两条是运行时问题。
- `core/CaptureWindowGeometry.ts`（261 行）：`resolveCaptureWindowGeometry` 的 y 翻转只有一处 `mainDisplayHeight − (bounds.y + bounds.height)`，并且只用**主屏**高度而不是目标屏 —— 这是 `CGWindowListCopyWindowInfo` 给的是「全局左上原点」坐标，而 AppKit 窗口给的是「主屏左下原点」坐标，两个参考系只能靠主屏高度桥接。`captureWindowLookupPublication` 查到窗口不属于自己就返回 null（不发布），避免把别的进程的同名窗口当成自己的。`CaptureWindowGeometryRuntime` 带代次，轮询回包晚于 resize 时丢弃。
- `core/CaptureWindowPresentationPolicy.ts`（272 行）：层级四档 `floating = 3`（`NSFloatingWindowLevel` 的真实数值）→ overlay `+1` → activeRecorder `+2` → memo `+3`，Windows 侧用 `setAlwaysOnTop(true, level)` 的档位表达相对关系。`captureSelectionCardGlobalCenter` 优先放下方、放不下再翻上方 —— 上游注释说明「锚在录制条整体而非单个来源按钮」是因为 Display/Device 两个按钮在条的最左侧，锚单个按钮会让卡片明显左飘。`clampCenter` 在上下界颠倒时给中点而不是硬夹（否则卡片会飞到屏幕外）。几何相交**复用** `EditorTextInputHitTesting.rectIntersection`：本批原写了一份同名实现，esbuild 直接报 `Multiple exports with the same name`，顺手改成单一实现 —— 两份几何一旦漂移就会出现「命中测试说相交、卡片定位说不相交」。
- `core/EditorColorPalette.ts`（300 行）：`hsbFromRgb` / `hsbToRgb` 是自算的 HSV ⇄ RGB。这里踩到一个真实 bug：把 RGB 分量的归一化写成 `value % 1`，于是 `1 % 1 === 0`，纯红 `(1,0,0)` 直接变全黑。修法是拆成两个函数 —— 色相用 `wrapUnit`（环绕，`1.25 → 0.25`），分量用 `clampUnit`（钳制，保留 1）。`colorPaletteRebase` 只有饱和度 > 0.0001 才采用新色相，注释那句「黑白灰没有有意义的色相，保留用户色相，否则提高亮度/饱和度会突然跳红」是这条规则的全部理由。饱和亮度面的拖拽分母用 `max(size, 1)`，无障碍值输出「饱和度 50%，亮度 80%」。
- `core/EditorScenePresetSheet.ts`（238 行）：`scenePresetSaveEnabled` 三条同时成立才可保存（有名字 / 有变化 / 不是在预设模式下）—— 「有变化」用与基线做深比较，避免用同名预设覆盖自己。`scenePresetPreviewSize` 是双 `min` 公式（先按宽比、再按高比），所以预览永远不裁切。`sceneCropSummary` 输出「上 50 · 下 50 · 左 100 · 右 100 px」，四边全 0 时输出「完整画面」。
- verify-model 断言 3526 → 3785（+259）：录制支撑（三态文案、角色显示名、双形态恢复建议、权限判定四例、取消标志、活动 id 五例、完成结果四态、采样时基）；帧规范化（尺寸兜底、三态判定、动作五态、五条文案、类生命周期）；窗口几何（y 翻转两例、主屏高度、发布三态、代次轮询）；层级策略（四档数值、角色映射七态、关键屏三态、最大相交三态、卡片定位四例含翻转、夹取三态）；调色面板（rgb 往返四色、环绕、十六进制大写、rebase 三态、面拖拽、无障碍串）；场景预设（保存三条件、预览尺寸两例、裁切摘要四例含取整）。

至此 `Sources/DogSCApp/**` 已转写 175 个文件（映射表 175 / 285）。

## 三十三、预览诊断 / 录制就绪 / 选择反馈与状态机 / 设备目录 / 音频增益（7 文件 / 1,375 行）

这一批是「录制前」和「录制中」的骨架件：先问能不能录（权限/空间/刷新率），
再让用户选来源（状态机 + token），选中之后给反馈（按下 100 ms 的凹坑），
录制时按段应用音量（不靠 AVFoundation 插值），出问题时有诊断样本。
TS 侧 2,331 行。

- `core/PreviewFrameDiagnostics.ts`（454 行）：只在 `DOGSC_PREVIEW_DIAGNOSTICS=1` 时工作，且是**字符串**比较 —— 设成 `true` 不生效。四道上限：最多 3 个采集批次、单批 10 秒、单批 900 个测量、在飞渲染信息 4 个。第 4 个 epoch 被拒时**不能**更新 `lastEpoch`，否则该 epoch 后续的帧会以为自己开了新批次。`presented(time)` 里 `time > 0` 才记账 —— 命令缓冲完成不等于 WindowServer 显示过帧，所以 `addPresentedHandler` 才是唯一证据。`presentedFPS` 用 `shown − 1`（帧间隔数，首帧没有前驱）。`deadlineDelayMS` 把提前送达夹到 0，否则负延迟会把均值拉低到看不出问题。
- `core/CaptureReadiness.ts`（305 行）：三件事各留了一条「不知道就放过」的口子 —— 磁盘容量为 null 视为够用、刷新率为 null 视为能显示、找不到显示器时用 1920×1080/60 占位。空间不足文案必须给三个数：需要、可用、**还差多少**（`estimated − available`，可用先夹到 0）。`estimateRecordingBytes` 里 ProRes 用 `max(宽×高×帧率×2, 1e8)` 故意偏保守，系统音频固定预留 192 kbps，比特转字节是除 8。`ByteCountFormatter(.file)` 用 1000 进制自算（用 1024 会与 Finder 对不上）。`availableDiskCapacity` 要沿目录向上找到第一个存在的祖先，因为首次启动时工作目录还不存在。
- `core/AppChoiceFeedback.ts`（214 行）：按钮的 action 与 `isPressed=false` 的观察可能以任意顺序到达，`activate` 用「按住中 或 刚松手 50 ms 内」把这次点击认成已被原生按下消费过，只标记不重开 —— 若在这里再 `begin` 一次，短按会多亮 100 ms。松手后不足 0.10 秒要补足，让轻点和长按得到同一道明暗凹坑。已选中的控件整组缩到 0.96，未选中的只让图标缩到 0.90（整块缩放会让文字抖动）。
- `core/CaptureSelectionState.ts`（355 行）：`materializing` 必须先清空九个来源字段再按 target 填回，否则上次选择的 `windowID` 会残留。三处「降级到全部系统声音」的理由不同（窗口拿不到 bundle / 区域不属于任何 App / 设备录制没有「所选窗口 App」）。`choose` 是唯一无条件生效的事件；`confirm` 还多一条 source 比对。**协调器的 `confirm/unlock/cancel` 靠值比较判断「有没有变化」**——写成引用比较会让「对同一个已确认目标点两次」两次都返回 true，宿主重复触发开始录制。
- `core/CaptureSelectionTransition.ts`（420 行）：淡入 0.18 秒、淡出 0.16 秒（关闭要利索），降低动态效果时不动画但**仍然要关闭**。卡片的 frame 在动画之外直接赋值，指针跟踪不能等布局过渡。`hide` 在「从未显示过 + 要动画」时是完全 no-op —— 此时播一次淡出会让卡片闪一下。`animate` 在 `initialAlpha == alpha` 时不播动画但仍要设 `isHidden`，否则 alpha 已是 0 的卡片永远不会真正隐藏。中断一律换代次，让上一轮的完成回调失效。
- `core/CaptureDeviceCatalog.ts`（284 行）：格式过滤三条（宽 > 0、高 > 0、至少一个帧率区间），去重按「宽×高」而不是帧率，排序为像素数降序、同像素按宽度降序。默认设备只补给 `automatic` 的摄像头/麦克风，iOS 端点永远要求精确 ID（「系统默认的那个 iPhone」不存在）。iOS 端点还要 `modelID === "iOS Device"`。`resolveLiveDevice` 的一个反直觉点：未连接的默认设备不补进候选，但 `defaultUniqueID` 仍然传下去，于是策略找不到它 → 解析失败（而不是静默回落到第一个候选）。Windows 侧用共享 pending promise 把并发枚举折叠成一次。
- `core/TimelineAudioGainProcessor.ts`（299 行）：直接在 PCM 上乘增益，不靠 AVFoundation 在剪切点之间插值。三条分支：不需要分段 → 整轨设默认增益；需要且 tap 建成功 → 整轨设 1、缩放全交给分段；需要但 tap 建失败 → **整轨静音**（宁可全静音，也不能让用户明确静音的片段按全局增益播出来）。分段锚在资产起点、按协商的 PCM 采样率推进（不用 range.duration，那是源时钟上的值，快剪会错位）。半开区间：剪切点上的第一帧属于下一段。`0.000_0001` 只用来消浮点噪声，写成 1e-3 会真的跳过边界那一帧。缩放方式按格式选：float32/float64 走快路径，int16/int32 逐个乘，未知格式一律 memset 0。
- verify-model 断言 3785 → 4095（+310）：预览诊断（六常量、环境解析三例、enqueue、百分位四例、统计四例、FPS 三例、延迟两例、窗口两例、采样四例、渲染信息换算、类 12 步、上限 901 帧、预留/释放、报告统计四例）；录制就绪（H.264 包络与原生、picker 标签、快照五例、空间三例、文案、刷新率三例、沿目录上溯三例、估算三例、current 三例、权限四例、字节格式化五例）；选择反馈（六常量、Return 四例、短按补足、长按立即、activate 不重开、无原生触发、两个缩放各三例）；选择状态机（token 四例、source 四例、materialize 七例、reduce 十一例、值比较四例、协调器十四步）；选择过渡（七常量、淡入淡出五例、窗口过渡四例、卡片 show 三例、hide 四例、animate 三例、motion 四例、卡片状态机九步）；设备目录（格式标签三例、目录角色三例、资格四例、分辨率去重排序三例、默认查询四例、解析五例、调度器三例）；音频增益（常量、夹取四例、区间三例、三条分支三例、二分五例、边界帧三例、分段五例、缩放六例、采样数四例）。

至此 `Sources/DogSCApp/**` 已转写 182 个文件（映射表 182 / 285）。

## 三十四、窗口桥 / 悬浮参考线 / 连续圆角 / 画布比例 / 设置窗 / 倾斜板 / 标记列表 / 录制运行安全（8 文件 / 1,794 行）

这一批把「编辑器的骨架」补齐了：窗口标题与活跃态、时间线上的悬浮参考线、
squircle 遮罩的缓存策略、画布比例面板、设置窗口的高度弹簧、3D 倾斜板、
录制标记浮层，以及录制运行的值语义所有权。TS 侧 2,227 行。

- `core/EditorWindowLifecycleBridge.ts`（250 行）：活跃态是**四项与**（应用激活 / 未隐藏 / 未最小化 / 可见 / 未遮挡），少任何一项都会让「窗口被完全遮挡时仍在跑预览渲染」回来。窗口标题两条分支的分隔符不同 —— 无项目名是空格（`DogSC 编辑器`），有项目名是破折号（`片子 — DogSC`）。红绿灯对齐的 y 用 `round((46 − 按钮高) / 2)`，1x 屏上不取整会跳像素。`reset()` 必须把 `lastActivity` / `lastScreenSize` 归 null，否则重新挂载时「状态没变」会吞掉第一次通知。
- `core/EditorTimelineHoverGuide.ts`（232 行）：三处夹取各有讲究 —— 线 x 夹 `[0, width]` 后减 0.5 做像素对齐；徽标左界 `max(visible.minX, 0) + 3`；右界 `max(min(visible.maxX, w) − 65, 左界)`，右界**不小于左界**（可视区极窄时贴左界而不是夹成负宽）。65 = 62 徽标宽 + 3 间隙。百分秒用 `floor` 而不是 `round` —— 时间码宁可早一帧，也不要显示尚未到达的时刻。
- `core/ContinuousCornerMask.ts`（304 行）：缓存键必须带小数宽高（取整会让相邻动画帧共用遮罩）但半径用**夹取后**的值（超过半宽后形状不再变，可复用）。圆形判定要两个条件：半径满格**且**宽高差 < 0.5 —— 只判第一条会让 400×100 的胶囊被当成圆。九宫格阈值是**严格大于** `cap*2+2`，改成 `>=` 时 `growAmount` 变 0，中间 2 px 会被拉没。拉伸结果四条校验（有输出 / 有限 / 非空 / extent 差 < 0.001），不过就回退整路径而不是近似圆角。
- `core/EditorCanvasRatioSelector.ts`（260 行）：`selectedPreset` 有三层折返（编辑中 → 自定义；竖版 `9:16`/`3:4`/`1:2.39` → 对应横版；其余原样）—— 竖版没有独立按钮，方向由开关决定。自定义校验是**不夹取**的：越界返回 null 让按钮禁用，用户能看到输入被判无效。`%.3f` 去尾零用正则 `\.?0+$`，`16 → "16"`、`3.5 → "3.5"`、`0.3333 → "0.333"`。工具栏值标签**只显示原值**，绝不拼真实数字 —— 否则超长输入会把工具栏撑宽。
- `core/AppSettingsWindowController.ts`（329 行）：高度上限 `min(640, max(屏高 − 100, 420))`，下限 420 在内层（漏掉会让小屏上高度掉到 300 出头、页面被截断）。居中公式带 `typical / 2` 项：让「标准页」看起来居中，小页从标准页顶部往下缩而不是从中心向上长。`show()` 之后的呈现必须同时满足「代次最新 + 应用已激活 + 有窗口」，任一不满足就不做 —— 绝不用猜一个延迟或提窗口层级绕过。高度弹簧三次重定目标都要从「当前高度 + 当前速度」续接，否则连续翻页时窗口会跳一下。
- `core/EditorTiltPad.ts`（242 行）：把手映射与拖拽反解是一对**刻意不对称**的公式 —— x 用 `+0.5`（向右为正）、y 用 `0.5 −`（屏幕 y 向下，向上倾为正）。写成对称会让向上拖动时画面向下倾。1.4° 死区是软吸附：拖到 1.3° 读数直接跳 0（不是累积到 1.4 才生效）。编辑角度文本时要关掉面板的命中测试，否则点输入框会被手势抢走焦点。
- `core/EditorMarkerListControl.ts`（273 行）：列表高度是四层嵌套 `min(count*44 − 3, max(44, min(261, maxHeight − 120)))`，顺序不能动（内层留 120 给头部底栏、中层保证至少一行、外层不超过实际需要）。`−3` 是让 n 行 + (n−1) 个 3 pt 间距刚好装下。浮层定位优先放下方，放不下才翻上方，且翻上去之后还要再夹一次上沿 —— 否则会顶出屏幕。关闭顺序必须先摘子窗口再 orderOut/close。
- `core/ScreenRecorderRunSafety.ts`（337 行）：四个不变量：`streamGeneration` 只在进入新运行时递增（所以迟到的旧回调永远匹配不上）；`markCapturing` 在已有 `terminalError` 时拒绝；`claimTerminal` 只在 `capturing` 生效（`starting` 期间必须走 `deferTerminalDuringStart`，两条路径不能混）；`end` 后所有查询返回 null/false。表面更新三态判定里**取消优先** —— 已取消的更新即使身份完全匹配也不应用，否则会往废弃图层写像素。辅助音频流永远不能终止整次录制，它的丢失只降级一条音轨。
- verify-model 断言 4095 → 4474（+379）：窗口桥（三常量、标题三例、活跃六态、红绿灯三例、容器帧、对齐三例、尺寸四例、观察者九步）；悬浮参考线（十五常量、时间码五例、布局六例、标签帧三例、配置两例、状态机五步）；连续圆角（四常量、缓存键、半径两例、三种遮罩、圆判定四例、图集五例、切片、平移两例、拉伸参数、校验六例、成本两例、缓存九步）；画布比例（十四常量、方向三例、选中五例、自定义七例、数字格式六例、字段两例、方向四例、缩略四例、图标五例、方向开关四例、标题两例）；设置窗（十常量、上限四例、初始两例、居中、呈现四例、目标四例、瞬时三例、弹簧帧、弹簧九步、脱离两例）；倾斜板（二十一常量、夹取三例、中立两例、把手四例、反解四例、预览四例、把手尺寸两例、拖拽七步）；标记列表（二十五常量、高度六例、透明度两例、层级、定位五例、关闭顺序、事件六态、呈现器六步）；运行安全（生命周期十四步、延迟终止九步、错误码五例、一次性认领四例）。

至此 `Sources/DogSCApp/**` 已转写 190 个文件（映射表 190 / 285）。

## 三十五、预览帧流水线 / drawable 提交 / 图层退役 / 窗口可见性 / 合并波形 / 样机转盘（6 文件 / 1,567 行）

这一批是「预览表面」的收口：帧级视觉签名与两张缓存、Metal drawable 的
十一步提交决策、背衬图层的后台退役与恢复、窗口可见性控制器，
以及两条纯 UI 的几何 —— 系统声 + 麦克风的合并包络、样机转盘的圆环投影。
TS 侧 2,328 行。

- `core/SharedPreviewFramePipeline.ts`（724 行）：这一层是把四个策略与两张缓存收敛成可断言的纯函数。三个细节值得记：① 跳过 `cursor` 比较层序时**必须逐项对齐**而不能先各自过滤再比 —— 过滤会丢掉相对位置，让 `[screen, camera, cursor]` 与 `[camera, screen]` 被误判相等；② 视觉签名的「时间例外」只在 `dynamicFlow` 背景上生效（动态背景把 `scene.time` 当可见相位，其它背景的时间只是溯源信息）；③ 光标像素尺寸用 `max(ceil(v − 1e-6), 1)`，旋转/投影的基向量算术会把 110 算成 110.00000000000003，直接 `ceil` 会变成 111 并白分配一张位图。光标位图缓存 12 条 / 2 MB 双淘汰，命中时把条目**移到末尾**；单条目超成本上限时不缓存但仍返回（这一帧要用）。
- `core/SharedPreviewRenderPipeline.ts`（286 行）：`renderDrawable` 的十一步提前返回被整成一张决策表 —— 每条路径都要回答「回调哪个 completion、是否 commit」。三处不对称是刻意的：`missing-device` 只回调 `submission(false)`、**不回调** presentation（还没碰过 drawable，主线程不能误以为这一帧被拒）；`retired-epoch` 是唯一「submission 成功 + presentation false + 仍然 commit」的组合，commit 只为让已编码的 GPU 工作正常释放；只有 `presented` 才 `scheduleEffectPreparation`。另外注意 `discarded-stale-paused` 虽然 submission 成功，但它提前 return、`didSubmit` 仍是 false，所以诊断上**照样记一次 failure**。
- `core/SharedPreviewLayerRetirement.ts`（247 行）：九个字段的图层配置表被创建与修复两个方向共用 —— 从后台回来时 AppKit 会把**同一个**图层对象还回来（`device = nil`、2×2 drawable、`isHidden = true`），不重新跑一遍完整配置第一次恢复渲染就直接 bail、窗口全黑。子层清单只有一份，摘除与挂回共用同一顺序（顺序即 z 序，错了会出现「光标被涟漪盖住」）。退役四步 bail 里唯一的例外是「代次已过期」—— 它**连收尾都不做**，因为新流程已经在跑，旧请求再收尾会把新图层一起拆掉。`install` 的顺序也有意义：先递增代次作废在飞的退役，再开 `wantsLayer`。
- `core/SharedPreviewWindowVisibility.ts`（382 行）：12 个通知落到五种处理路径。`didChangeScreen` 只重配帧率且**不 return**（继续走遮挡更新）；`didUpdate` 走的是「不带明确前台信号」那条，必须靠「遮挡可见 / key window / main window」之一兜住，否则一次普通布局更新就会把挂起的预览叫起来。帧率上限 `min(max(屏上限 ?? 60, 1), 60)` 三个值全相等 —— 这是锁定不是区间。挂起时 `transitionRevision += 1` 排第一步，之后派发的所有异步封面回调都会因代次不符被丢弃；`finishSuspension` 的 `!hasRetiredForSuspension` 保证过渡完成、1 秒看门狗、无回调立即收尾这三条路只退役一次。
- `core/EditorTimelineMergedWaveform.ts`（319 行）：每格在 0.2 / 0.5 / 0.8 三处取样并**取最大值**（只取中点会漏掉短促鼓点），两路通道是 `max` 合并而不是相加（相加会让「系统声和麦克风同时有声」画成冲出画面的柱子）。幅度三道闸的顺序不能换：增益 ≤ 0 直接 0（省一次取样）、峰值非有限或 ≤ 0.001 直接 0（NaN 会污染后面的 max）、显示增益在乘音量增益**之前**先钳到 1（3 倍显示增益 + 0.5 音量 = 0.5）。展开只对「超过 1」的那截做插值。区间切分有一处照抄不修的不对称：遇到零收在上一个非零格，循环结束却收在**最后一格** —— 改成「收在最后一个非零格」会让末尾波形比音频早结束、看上去像被裁掉了。
- `core/EditorMockupTurntable.ts`（370 行）：`wrapped` 把任意角度环绕到 `[-n/2, n/2]`，用的是 Swift `rounded()` 的默认规则 **toNearestOrAwayFromZero** 而不是银行家舍入 —— `Math.round(-3.5)` 给 -3、Swift 给 -4，转盘角度会变负，所以显式实现了 `mockupTurntableRounded`。边界行为值得记住：`wrapped(3, 6)` 商 0.5 远离零取整为 1 → **-3**，也就是正中对面那一格一律往左归。拖拽符号是负的（手指右拖 → 转盘逆时针 → 前面换成左边的卡），松手只认 55% 的预测位移。卡片的 `isFront = |offset| < 0.5` 与 `facing = cos(angle)` 不是同一件事：`count=3` 时 offset 0.4 的卡 facing 为正却不在前排。

- verify-model 断言 4474 → 4936（+462）：预览帧流水线（像素尺寸八例、层序九例、签名十三例、场景八例、位图缓存十五步、背景缓存八例、帧连续性四例、挂帧五例、挂起五例、退役四例、在飞三例、丢弃三例、呈现两例、光标分离六例、矩形十例、光标相机八例、光栅计划九例）；drawable 提交（尺寸六例、契约三例、决策十一态、上报三例、时刻两例、翻转、四段耗时四例、重建四例）；图层退役（配置九例、修复两例、恢复五例、尺寸两例、清屏两例、子层四例、三条出路三例、四步 bail 八例、静默两例、收尾四例、代次三例、安装六步）；窗口可见性（预算两例、帧率六例、区间三例、通知十二例、路由十七例、前台八例、更新三例、挂起十步、封面四例、调度三例、就绪四例、代次两例、收尾四例、连结三例、恢复八步、开关两例）；合并波形（五常量、采样点七例、请求四例、幅度七例、包络三例、几何十四例、峰高三例、区间九例、边缘四例、动画七例、相等三例、缓存两例、取消三例）；样机转盘（九常量、取整三例、环绕六例、选中四例、吸附四例、箭头三例、拖拽五例、投影二十四例、选中四例、点击三例、同步五例、弹簧三例、名称七例、杂项六例）。

至此 `Sources/DogSCApp/**` 已转写 196 个文件（映射表 196 / 285）。

## 三十六、画布求值 / 栅格策略 / 线性虚化 / 叠加层渲染 / 键盘焦点滚动 / 拖拽读数（6 文件 / 1,386 行）

这一批把「画布上的直接操作」整条链补上了：工程求值成布局、预览栅格档位、
线性虚化的四类把手与源空间裁剪、马赛克与贴图的叠加几何、键盘焦点的最小
滚动、以及拖拽时的读数徽标与吸附参考线。TS 侧 2,050 行。

- `core/EditorCanvasPreviewLayout.ts`（233 行）：装配代码里六处容易错的判定被提取成纯函数。三处要点：① `stickerTrack` 能复用就复用 —— `StickerTransitionTrack` 构造要扫全部片段建进入时间索引，每帧重建会让 60 Hz 预览明显变慢；一旦暂停授权改过 `enterDuration` 就必须重建。② 只有 `origin === 'automatic'` 的缩放片段参与自动构图，继承焦点取「上一个片段的**终点**」——用起点会让两段交界处跳一下。③ 暂停授权遍历**全部**贴图片段（不只选中的那个），否则两张图连着粘贴时先贴的那张一直停在 opacity 0；但参加接力的条目必须跳过，它们的交接本来就靠双方入场动画，压掉只会变成硬切。
- `core/EditorCanvasPreviewSupport.ts`（219 行）：`pixelSize` 的 `displayScale` 参数**被显式忽略**（Swift 里写作 `_`）——「流畅」是用户主动选的性能档，不是 backing scale 的别名；在 Retina 上按 2× 合成会让大编辑窗口接近 4K 工作量，这个开关就等于没装，所以低清档固定 1× point raster，把像素量稳定降到四分之一。`drawablePixelSize` 只把超上限的长边**等比**压回，分别夹取会把 20000×1000 压成 16384×1000、画面横向压扁。播放取帧先归到 60 Hz 网格（用 `rounded` 不用 `floor`）但光标仍按原时刻刷新，否则慢放时光标会一顿一顿地跳。
- `core/EditorLinearFocusCanvasOverlay.ts`（407 行）：四类把手共用一套源空间几何。清晰带的命中区必须在**源空间**用 Sutherland-Hodgman 裁两次半平面再投影——直接对旋转后的带子做命中测试会变成一个盖住整块 UI 的矩形。边界线也要先在源空间求参数区间（`lower/upper` 沿切向）再投影。四种拖拽解释里有两处非对称：`region` 的位移要乘 2（`size` 是整条带宽而 `radius` 是半宽），`direction` 必须走 `atan2(sin δ, cos δ)` 规约（直接相减跨 ±π 会跳 360°）。四种情形都会把 `shape` 强制为 `linear`、`target` 强制为 `fixed`、`dimming` 清零。
- `core/SharedFrameOverlayRenderer.ts`（324 行）：不实现滤镜，只保留决定「看起来对不对」的几何与阈值。归一化矩形转像素时 y 要写成 `1 − ny − nh`（归一化以左上为原点，CI 的 extent 以左下为原点），漏掉马赛克会上下颠倒。模糊半径 `(4 + intensity × 44) × progress`，采样框外扩 3 倍半径后才跑高斯（3σ 有效半径），这是 5K 工程里拖马赛克不至于每次全画幅模糊的原因。贴图高度由源图宽高比推出而非独立字段，所以永远不会被拉伸；阴影 y 偏移与旋转数学角**都取反**（两处坐标系差异）。
- `core/AppKeyboardFocusScrollView.ts`（247 行）：位置记忆有两种刻度——flipped 用 `viewport.minY − document.minY`、非 flipped 用 `document.maxY − viewport.maxY`，记完还要 `max(offset, 0)`（内容比视口短时差值为负，记成负的会让整块内容被推出视口）。还原时 `min(topOffset, max(docH − clipH, 0))` 双层夹取。焦点滚动只在「启用本机制 + 显示键盘焦点 + 控件可用」三条同时成立时登记目标——少了 `showsKeyboardFocus` 这一条，用户点一下鼠标就会整页滚一下。
- `core/EditorCanvasDragFeedback.ts`（351 行）：八条优先级的读数分派（缩放优先于拖动、贴图旋转优先于贴图缩放、马赛克只能退回交互里读选中项）。徽标 y 在 `objectY > 0.65` 时翻到顶部 22 —— 对象在下半屏就贴顶，否则正好盖住手指看的地方。百分比一律 `round(v × 100)` 不留小数；贴图旋转吸附到 ±180/±90/0（容差 0.001°）时精度从一位小数变成整数度并加「已吸附」。`-0` 要显式归一成 `0`，否则角度恰好为 -0 时读数会是「-0.0°」。

- verify-model 断言 4936 → 5324（+388）：画布求值（源像素三例、轨道两例、自动片段三例、相机焦点三例、继承四例、重新锚定三例、首帧判定三例、授权计划十一例、两条注释常量、布局六字段）；栅格策略（档位八例、低清两例、完整六例、drawable五例、可见性两例、轨道变换两例、采样六例、字段与复用三例）；线性虚化（十二常量、源平面五例、中心四例、切向法向五例、投影角三例、带宽三例、四条边界五例、旋转把手、把手夹取四例、半平面裁剪六例、清晰带四例、线段裁剪六例、拖拽前置四例、法向投影两例、四种拖拽十四例、其余六例）；叠加层（十一常量、模糊门槛三例、马赛克矩形十三例、半径三例、采样框三例、圆角、贴图矩形八例、圆角三例、边框三例、阴影六例、旋转三例、不透明度三例、裁剪五例、矩形工具三例）；键盘滚动（两常量、请求三例、动画三例、记忆三例、还原三例、y 换算三例、调度五例、记忆前置三例、目标四例、偏好三例、桥四例、记忆槽六步）；拖拽读数（二十六常量、八条优先级九例、徽标 y 四例、格式化五例、五种值四例、旋转四例、三条读数分支十一例、清空顺序四例、参考线八例）。

至此 `Sources/DogSCApp/**` 已转写 202 个文件（映射表 202 / 285）。

## 三十七、壁纸视频播放 / 缩放焦点地图 / 十六进制颜色 / 录制待机小岛 / 录制浮层 / 录制作业（6 文件 / 1,626 行）

这一批回到「录制前的门口」和「预览的外围」：壁纸视频的时钟对齐、缩放焦点
地图的几何、颜色输入的草稿状态机、录制待机小岛的轮盘与电平条、录制浮层的
屏幕夹取与生命周期，以及一次录制作业从计划到代数收尾的全过程。TS 侧 2,104 行。

- `core/PreviewWallpaperVideoPlayback.ts`（281 行）：壁纸播放的核心是「两套时钟谁说话」。暂停时的重同步容差是 `1/120` 秒（半帧），播放时是 `0.25` 秒——暂停时画面必须严丝合缝，播放中只要不追上就行，用小容差会让播放器每秒被 seek 十几次直接卡死。循环边界的 `0.08` 秒余量是为了避开 AVPlayer 在 `itemDidPlayToEnd` 前后那段「时间还在走但帧已经不动」的窗口，贴边 seek 会得到一个黑帧。就绪轮询 `500 × 10ms`（5 秒）而不是无限等，超时后报 `timed-out` 让上层退回静态壁纸；`wallpaperConfigureNeedsRebuild` 只在「源、目标尺寸、色彩空间、循环」四者都相同时复用现有 pipeline，像素格式变化必须重建（`420YpCbCr8BiPlanarVideoRange` 与 Metal 兼容变体的 buffer 布局不同）。`WALLPAPER_INVALIDATE_ORDER` 固定 13 步，先停通知观察者再拆 layer，否则拆到一半会收到 `failedToPlayToEndTime` 进去重入。
- `core/EditorZoomViews.ts`（349 行）：焦点地图高度是 `312` 基准按宽高比收缩，但夹在 `150 ~ 200` 之间——低于 150 十字准星和圆点会叠在一起，高于 200 会抢走时间线的高度。`zoomClamp01` 对非有限值返回 **0.5**（居中）而不是 0：`NaN` 传下来当作「左上角」会让画面突然甩到边角，居中至少看起来像没动。参考框取画面 `0.75` 并虚线 `[4,4]`，准星线宽 `2.5/3.5` 不对称是为了在浅色画面上也能看清。`zoomThumbnailRequestID` 用 `${gen}#${t.toFixed(3)}`：只带代数会在暂停时拿到旧图，只带时刻会在复位时拿到上一段工程的图。`zoomTimelinePaused` 时刷新间隔从 1/30 秒拉到暂停档，避免暂停状态下还在每帧重取缩略图。
- `core/EditorHexColorInput.ts`（295 行）：`HexColorDraft` 把「已提交值 / 输入框文本 / 解析结果」分成三个字段——只存文本就分不清「用户正在改」和「值被外部改了」。`isDirty` 用文本比对而非值比对，所以把 `#D8B26A` 改成 `#d8b26a` 也算脏（大小写不同但颜色相同），提交时会归一成大写。非法输入的提示固定为「请输入 6 位十六进制颜色，例如 #D8B26A」，6 位而不是 3 位是因为短写法在工程文件里存的是展开后的 6 位，允许 3 位会让回读时看起来「被改过」。失焦时若非法要回填 picker 的草稿文本而不是回退到已提交值——用户刚在取色器里挑的颜色不该因为输了个错就被丢掉。`HEX_COLOR_ESCAPE_STEP_ORDER` 四步：按键 → 收起取色器 → 还原文本 → 交还焦点。
- `core/RecorderSetupSurface.ts`（337 行）：待机小岛 56 高、左右各 8，输入图标区先留 6、录制钮前留 4、按钮 44 见方（正好是 macOS 的最小可点区）。轮盘滚动用 `(index + step % count + count) % count` —— 少一个 `+count` 在 JS 里负模会得到负数，向上滚一格直接越界。`recorderWheelKeyStep` 里 125/124 是下/上箭头键码、126/123 是上/下，两对都认是因为外接键盘和内置键盘报的不一样。电平条响应表 `[0.62, 1, 0.8, 0.5, 0.9, 0.7, 0.55, 0.95]` 是刻意不均匀的——等距会让八根条一起呼吸，看着像在闪；增益 1.6 后再乘响应，所以静止噪声不会点亮（阈值 0.02）。`RECORDER_LEVEL_BAR_RESPONSE[input.index % ...]` 这处我在初稿里误写成 `index`（函数参数里没有这个名字），编译器直接拦下了。
- `core/RecorderPopover.ts`（403 行）：浮层的水平夹取右界是 `visible.maxX − width` 而不是 `maxX`，否则右边缘会整块出屏。垂直方向优先放锚点**下方**（`anchor.minY − height − 16`），放不下才翻到上方 `min(anchor.maxY + 16, visible.maxY − height)`——翻上去之后还要再夹一次上沿，否则 300 高的面板在高锚点上会顶出屏幕顶端（这一处我一开始把下方公式写成了 `+16`，断言 `316 vs 284` 直接暴露）。`recorderPopoverToggleStep` 同 id 再点就是 `dismiss`（不是重新弹出）。单选行的内圈半径是 `0.01` 而不是 `0`：Core Graphics 里半径 0 的圆在部分缩放下会画不出来，0.01 是个肉眼不可见的保险值。`RECORDER_POPOVER_DISMISS_ORDER` 八步先 `orderOut` 再交还 key window，顺序反了会出现一瞬间两个窗口都认为自己有焦点。
- `core/RecordingRun.ts`（439 行）：十种计划错误各自有面向用户的中文描述，因为录制的失败大多发生在「点下去之后」，只给错误码用户无从下手。`CaptureInputDeviceRequest` **永远是 `exact`**：录制一旦开始就不能悄悄换成默认麦克风，用户看到的输入源必须就是他选的。设备录制时 `pointerEvents` 写 `null`（不是空数组）——iOS 设备录制没有系统光标，"没有"和"空列表"在工程文件里必须可区分，否则回放时会去找一个不存在的资源。`RecordingRunState.end` 在代数不匹配时**保留**当前 run：旧 run 的收尾回调晚到是常态（ffmpeg 收尾是异步的），把新 run 清掉就等于丢了一次录制。`RECORDING_TRACK_BITS` 用位掩码（1/2/4/8/16）而不是计数，因为「视频+音频+光标」这类组合既要判断单个也要判断并集。区域录制的 y 要翻转（`screenHeight − y − height`），窗口录制则要过三道校验（存在、可见、未最小化）才允许降级。

- verify-model 断言 5324 → 5832（+508）：壁纸播放（十三常量、本地时刻四例、重建六例、同步四态五例、同步步骤三例、暂停 seek 三例、排队 seek 两例、帧拷贝三例、容差两例、就绪三例、失效顺序十三步、预热两例、准备所有权三例）；缩放地图（十六常量、夹取四例、地图矩形五例、高度三例、焦点点三例、归一化四例、居中三例、参考框三例、准星四例、命中三例、圆点两例、边框两例、暂停两例、六态编辑六例、缩略图 id 三例、消失三例、命中测试两例、坐标控件三例）；颜色输入（草稿八例、提示串、八组尺寸、验证三例、色块三例、文本更新三例、提交四例、失焦四例、回填三例、四步顺序、重基三例、取色器切换三例、初值两例、交互步骤四例、预览两例、事务提交两例、调色板两例）；待机小岛（二十常量、模式三层五例、源标签四例、轮盘滚动四例、行程两例、键步四例、点击步两例、麦克风环三例、电平四例、激活两例、图标两例、无障碍三例、字形六例、取景器两例、导览两例）；录制浮层（十五常量、切换三例、可见框四例、最大高两例、初始高三例、x 三例、y 三例、重排三例、层级、两个标识、main、本地事件四例、五步顺序、key 还原两例、八步消失、视口高两例、实测高三例、按钮圆角、表面偏移两例、行视觉六例、行尺寸七例、列表三项）；录制作业（十种错误十一例、目标四态五例、输入设备五例、请求三例、请求顺序三例、相对路径两例、清单三例、可用性三例、位掩码五例、并集四例、启用两例、run 五例、指针捕获四态六例、区域回退三例、窗口降级、列表选项三例、adding 两例）。

至此 `Sources/DogSCApp/**` 已转写 208 个文件（映射表 208 / 285）。
