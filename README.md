# DogSC Desktop（Windows 版）

把 macOS 录屏剪辑工具 [laogou717/dogsc](https://github.com/laogou717/dogsc) 的源码逐文件转写为 **Electron + React + TypeScript + Ant Design** 的 Windows 版本，并打免安装绿色包。

## 下载

免安装绿色包（无需安装，解压即用）：

> **百度网盘**：https://pan.baidu.com/s/18QJFUBMfvwps3mQelFjSig?pwd=sd56 （提取码 `sd56`）

也可自行构建：`npm run dist` 生成 `release/DogSC-0.1.0-win-x64-portable.exe`。

## 功能现状

- 屏幕录制（Electron 桌面捕获）与视频导入
- 时间线剪辑：分割 / 删除（波纹前移）/ 两端裁切 / 变速 / 双击接点还原 / 撤销重做
- 编辑器预览：3D 运镜、背景源（5 种图案 / 3 种动态流 / 图片 / 视频）、光标样式与大小、开场转场（聚拢 / 侧滑 / 轻 3D）
- 导出成片：按剪辑时间线 ffmpeg 拼接（trim + setpts/atempo + concat），实时进度
- 上游同步：`mappings.json` 记录 Swift → TS 逐文件映射（含基线 commit `567fd6e`），`npm run upstream:check` 对比上游更新

## 环境要求

- Node.js ≥ 20
- npm（或 pnpm）
- Windows 10/11

## 安装与运行

```bash
npm install
npm run dev:electron    # 编译并启动应用
npm run dist            # 打免安装绿色包（release/DogSC-0.1.0-win-x64-portable.exe）
```

## 验证

```bash
npm run verify:editing      # 剪辑引擎 71 项断言
npm run verify:batch1       # 基础批次 53 项断言
npm run verify:model        # 项目模型 + 运动轨 218 项断言
npm run verify:export-ui    # 导出端到端（真实 UI，校验输出时长）
npm run verify:render-ui    # 背景/光标/转场渲染端到端（真实 UI 截图）
```

## 目录结构

```
src/main       Electron 主进程（录制、ffmpeg、IPC）
src/preload    白名单 API 桥
src/renderer   React 界面
  core/        逐文件转写的业务模型（对应上游 Sources/RecorderCore）
  components/  界面组件（对应上游 Sources/DogSCApp）
mappings.json  上游文件映射与基线（差异优化的依据）
RUNNING.md     转写进度、验证方式与决策记录
```

## 与上游保持同步

1. `npm run upstream:check` — 列出上游变更文件与本仓库的对应转写目标
2. 按文件逐个转写并同步登记 `mappings.json`
3. 跑全量 verify 后提交

## License

遵循上游项目许可。
