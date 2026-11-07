# 项目协作偏好（长期有效，agent 必须遵守）

## 文档输出格式

- **一律输出 Markdown（`.md`），不要生成 HTML。**
  - 博文、说明文档、报告、总结、笔记，全部用 `.md`。
  - 需要配图时，图片**以 base64 data URI 内嵌在 Markdown 里**：
    `![图注](data:image/png;base64,....)`
  - 不要为了「好看」而新建 HTML 文件；如确实需要网页形态，先问用户。
- 截图直接用系统/应用实机截图，不需要额外生成插画。
- **截图必须先脱敏再使用**：实机截图里凡出现本机真实信息的区域 ——
  画布/预览里录到的窗口内容、时间线缩略图、文件路径、文件名、用户名、
  项目名里的时间戳等 —— 一律先用像素化马赛克盖住（PIL 缩块 + 轻模糊，
  不可逆），确认无敏感信息残留后才能写进交付物。

## 代码与验证约定（本项目既有规则）

- 逐文件转写：每个 Swift 文件对应一个 TS 文件，文件头标注
  `Swift source: <path>（N 行）@ <基线 commit>` 与逐结构行号对照。
- 每完成一批：三份 tsconfig（`tsconfig.json` / `tsconfig.main.json` / `tsconfig.preload.json`）
  全部 `--noEmit` 通过 → 追加 verify-model 断言 → 登记 `mappings.json` → 追加 `RUNNING.md` → 提交。
- `scripts/verify-model.mjs` 尾部两行
  （`console.log(MODEL-RESULT ...)` 与 `if (failed > 0) process.exit(1)`）必须始终在文件最末尾，
  新批次代码插到它们之前。
