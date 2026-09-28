# 工作台阅读与文档预览

工作台按工作目录记住文件 / Git / 命令 / PTY 标签、目录、选中文件、Diff 文件和暂存来源。最多保存 50 个工作区，存入本机 `pi-desktop.workbench-workspaces.v1`。恢复时重新读取内容，不保存文件正文、命令或终端输出。Windows 目录大小写和路径分隔符会归一化。过期的读取及 Git 操作结果不会写入新工作区。

文件语法高亮和词级 Diff 在后台 Worker 中计算。共享池最多运行两个 Worker；切换内容会取消旧请求，异常或超时保留可读的原文。语法高亮限 300,000 字符、10,000 行；词级 Diff 限 1,000,000 字符、200 对替换行，单行最多 256 个词、4,096 字符；超限仍显示完整的行级差异。文件与 Diff 初次显示 400 行，可逐批展开，查找仍覆盖完整原文。

结果文件链接及工作台文件列表支持 `.docx` / `.xlsx` 只读预览，组件按需加载，解析在独立 Worker 中执行。Word 支持正文、标题、粗斜体、下划线和表格；Excel 支持工作表切换、共享字符串、稀疏单元格及已保存的公式结果，不执行公式。图表、图片、复杂分页、合并样式与数字格式请使用默认应用查看。旧 `.doc` / `.xls` 仍使用系统应用。

Office 文件上限 10 MiB；所需 XML 单项 8 MiB、合计解压 24 MiB。预览最多 50 张工作表，每表 1,000 行、100 列，总计 50,000 单元格、2,000,000 字符；Word 顶层最多 2,000 个内容块。超限会明确提示，Excel 初次显示 100 行，可继续展开。解析不会加载外部关系、图片、宏或嵌入对象，也不会将文档 HTML 注入页面。

验证入口：

- `node --test tests/workbench-memory.test.mjs tests/reading-analysis.test.mjs tests/reading-worker-pool.test.mjs tests/office-preview.test.mjs tests/result-files.test.mjs`
- 构建后运行 `node tests/fixtures/model-settings/run.mjs --run --scenario=../ui-improvements/workbench-borrowed.mjs`
- 现有工作台、Git 跨工作区操作及结果文件预览场景继续作为回归检查。
