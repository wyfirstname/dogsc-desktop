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
