# ZCode 借鉴跟进（2026-10）

本文记录第二轮从 `reference/zcode` 借鉴并落地的十项设定：入口、行为边界与验证方式。第一轮内容见 [ZCode 对照与体验改进](./zcode-experience-improvements.md)。

## 功能总览

| # | 功能 | 入口 | 主要参考 |
|---|---|---|---|
| 1 | 任务完成提示音 | 设置 → 常规 → 任务提示音 | `lib/taskNotificationSound.ts` |
| 4 | 输入占位符语义细分 | 输入框 | `lib/chatPlaceholder.ts` |
| 5 | 文件类型徽标 | 文件树、搜索结果、变更列表 | `lib/fileDisplay.tsx` |
| 7 | 工作台文件搜索 | 工作台 → 文件页搜索框 | `workspace-file-search/` |
| 8 | 预览扩展（图片/Markdown/PDF/PPTX） | 工作台 → 文件预览 | `previewPane*Content.tsx`、`officeFilePreview.ts` |
| 9 | 文件树右键菜单 | 文件树右键或「…」按钮、工具栏「＋」 | `WorkspaceFileTree.tsx` |
| 10 | Mermaid 图表渲染 | 对话中的 mermaid 代码块 | `mermaidLanguage`、`mermaidRenderBudget.ts` |
| 11 | Git 提交图 | 工作台 → Git → 提交历史 | `git-graph/layoutAlgorithm.ts` |
| 12 | 查找范围切换 | 会话内查找条（Ctrl+F） | `quickpick/conversationFindSearch.ts` |
| 13 | 搜索历史 | 全局搜索空态「最近搜索」 | `command-center/commandCenterSearchHistory.ts` |

## 行为细节

**提示音（1）**：WebAudio 合成双音（A5→D6），不随包分发音频资产；仅在 `busy → idle` 且窗口未聚焦时播放，播放失败静默不影响通知链路；设置开关独立于系统通知，存于渲染层 localStorage。

**占位符（4）**：无历史对话＝新任务邀请、有历史且空闲＝继续提问、忙碌时保留排队/引导提示；连接错误与连接中状态优先级更高。

**文件徽标（5）**：`fileDisplay.ts` 按扩展名映射到 2–4 字符标签与 18 个颜色类别（代码/标记/样式/数据/配置/文档/图片/Office 三件套/PDF/压缩包/音视频/脚本等）；目录仍用文件夹图标。应用于工作台文件树、全局搜索文件行与变更卡文件行（`FileLabel`）。

**文件搜索（7）**：文件页工具栏搜索框，150ms 防抖复用既有 `searchWorkspaceFiles`（含目录）；搜索中替代目录浏览，Enter 打开首项，目录结果点击后进入目录浏览；Backspace/← 清除搜索。上限与截断提示沿用服务的 400 项限制。

**预览扩展（8）**：工作台按扩展名路由——图片/PDF/Office 走有界的 `previewResultFile`（图片 `img`、PDF 内建查看器 iframe、Office 走 Worker 解析）；`.md/.markdown` 用文本通道读取后以对话 Markdown 管线渲染；其余维持 1 MB UTF-8 文本。PPTX 解析新增：解压 `ppt/slides/slideN.xml`，按序抽取 `a:t` 文本，上限 100 张幻灯片／每张 300 段文本／共用 200 万字符，超限标记截断；对应对话内 Office 预览同步支持 `pptx` 格式。

**右键菜单（9）**：目录项提供新建文件/新建文件夹；所有项提供重命名与删除；根目录经工具栏「＋」进入同一菜单。新建/重命名走内联表单，删除为回收站语义（`shell.trashItem`），均需二次确认或显式提交。名称校验（`WorkbenchService.validateEntryName`，纯函数可测）：拒绝空/超长/分隔符/`<>:"|?*`/控制字符/结尾点空格/Windows 保留设备名。变更操作校验工作区未切换（generation + 路径双查），重命名/删除后同步修正当前选中与目录。

**Mermaid（10）**：`mermaidBudget.ts` 三重预算——源码 2 万字符、600 行、复杂度评分 1500（边×2＋节点）；文档不可见时跳过，可见后自动补渲染。`MermaidDiagram` 懒加载 mermaid（构建产物独立分包约 1.2 MB，无图表不加载），`securityLevel: 'strict'`，主题跟随 `data-theme`（MutationObserver）；超限/解析失败回退为源码文本并给出原因。代码块头部提供「查看源码/查看图表」切换，折叠行为仅作用于源码视图。

**提交图（11）**：`getWorkspaceGitGraph`（上限 200）一次 `git log`（含 `%P` 父提交）加 `for-each-ref`/`HEAD` 标注引用。`gitGraphLayout.ts` 纯函数泳道布局（VSCode 风格）：首父继承泳道、合并父占空闲泳道、未加载父虚线出界；8 色循环泳道，HEAD 圆环放大。替换原纯文本历史列表。

**查找范围（12）**：查找条新增「对话/变更」切换（仅有差异记录时显示）。变更范围用 `changesFind.ts` 在 `UiFileChange.diff` 与路径上做大小写不敏感字面匹配，计数显示「N 个文件 · M 处匹配」；Enter/上下按钮逐文件循环并直接打开对应审查窗口（`ComposerChanges` 暴露的命令式句柄）；切换回对话范围恢复原高亮绘制，两范围互不干扰。

**搜索历史（13）**：`searchHistory.ts`（localStorage，上限 8 条，置顶去重）；选中任一命令/会话/文件结果时记录当前搜索词；空态首屏展示「最近搜索」，支持单条移除与一键清除。

## 依赖说明

`mermaid@11` 为新增依赖。本机 pnpm 11.11.0 的 `add`/`install` 均无法完成新增解析，按 ROADMAP 记录的既定方案处理：`corepack pnpm@12 install --lockfile-only --pm-on-fail=ignore --registry=https://registry.npmjs.org` 生成 lockfile（npmmirror 当时不可达），再用 11.11.0 `--frozen-lockfile` 回装。验证 `pnpm install --frozen-lockfile` 通过。

截图验证用的临时 Vite server 需要从 `packages/ui` 解析 `tailwindcss`（正式渲染层从 desktop 包解析）；已在 `packages/ui/node_modules/tailwindcss` 建 junction，属 node_modules 内的临时链接，重新安装依赖后如需复跑验证脚本可重建。

## 验证

- `pnpm typecheck`、`pnpm test`（854 项：852 通过、0 失败、2 跳过）、`pnpm build` 全绿；mermaid 构建产物独立按需分包。
- 新增测试：`tests/mermaid-budget.test.mjs`（5 项：预算三阈值、隐藏文档、复杂度）、`tests/git-graph-layout.test.mjs`（5 项：线性/分支合并/出界虚线/孤儿/泳道复用）、`tests/changes-find.test.mjs`（4 项：diff+路径匹配、空查询、二进制路径兜底、字面计数）。既有 VM 型测试（search-selection、app-shell-storage）补充了新模块 mock 与 `document.hasFocus`。
- 隔离无界面 Chromium 验证（`out/zcode-review-run.mjs`，脚本与截图在忽略目录 `out/`）：徽标渲染、搜索缩窄到 1 项、菜单四操作与新建经桥落盘、Markdown/图片/PDF/PPTX（2 张幻灯片）四类预览、提交图 4 节点含 HEAD 环与引用徽标、查找双范围切换、mermaid 真实渲染出 svg；深浅主题各出一张截图（`out/review-ui/zcode-followups-*.png`），无控制台错误，测试浏览器已关闭。

测试使用模拟数据；截图与断言验证实现行为，不代表真实项目的性能基准。
