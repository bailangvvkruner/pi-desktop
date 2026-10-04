# ZCode 界面对照与打磨（2026-10）

对照 `reference/zcode` 的 `DESIGN.md` 与对话界面组件后落地的界面逻辑与视觉一致性改进。功能借鉴见 [第三轮](./zcode-round3-2026-10.md)。

## 界面逻辑

| # | 改进 | 参考 |
|---|---|---|
| 0 | 回合标题显示语义摘要（「读取 3 个文件 · 搜索 2 次」），只读回合标为「已探索 / 正在探索」。此前第三轮的摘要只出现在非内联工具组，而对话中的工具组均以内联方式渲染，实际界面看不到 | `v4/conversationAssistantWorkItems.ts` |
| 1 | 长用户消息（超过约 120px）折叠并渐隐，提供「展开全文 / 收起」；查找或搜索命中时自动展开 | `v4/ConversationUserInputBody.tsx` |
| 2 | Markdown 表格悬停工具条：复制 Markdown、复制 CSV、下载 CSV（带 BOM，Excel 识别中文）、大窗口查看 | `components/ai-elements/markdown-table.tsx` |
| 3 | 代码块「自动换行」开关（全局记忆）；Mermaid 图表全屏查看，支持缩放、适应窗口、拖动平移与滚轮缩放 | `code-block.tsx`、`diagram-preview-dialog.tsx` |
| 4 | Markdown 图片：外链图片不在应用内加载（渲染层 CSP 本就会拦截，此前显示破图），改为外链卡片；`data:` 图片与工作区图片文件（经有界预览服务读取）直接显示并可点击放大；其他协议回退为替代文字 | `components/ai-elements/markdown-image.tsx` |

## 视觉一致性（按 ZCode DESIGN.md）

- **圆角（6）**：新增 `--pd-radius-xs`（4px）、`--pd-radius-dialog`（16px，对话框外壳）、`--pd-radius-pill`；全部 325 处像素圆角归入 xs/sm/md/lg/xl/dialog/pill 七档，`50%` 圆形与 `0` 保留。
- **字号（7）**：剩余硬编码字号（数据恢复与 MCP 页标题 21px/15px、管理面板 12/13px、工作台小标题 9px、更新说明标题 12.5px、指标 11px）改为字号变量；移除未定义的 `--pd-font-subheading`、`--pd-font-code` 及已定义变量上的多余回退值。拖拽手柄字形保留像素尺寸（属图标几何）。
- **颜色（8）**：修复从未定义的变量导致的真实显示问题——`--pd-text-soft`（一直使用固定 `#999`）、`--pd-subtle`（提交对话框次要文字无弱化）、`--pd-hover`（两个按钮无悬停背景）、`--pd-accent`（Git 提交图分支徽标与 HEAD 高亮、工作台搜索框聚焦边框均失效）。新增链接色、滚动条、终端背景、窗口关闭悬停与提交图泳道变量（含浅色主题值）；遮罩统一使用 `--pd-overlay`；引用块边线改用 `--pd-border-strong`。文件类型徽标与主题预览色板属分类/示意颜色，按 ZCode 规则保留固定值。
- **层级（9）**：全局层级改为 `--pd-z-*` 语义变量（抽屉、面板、提示、弹出层、模态、选择器、搜索、菜单、上下文菜单、拖拽、通知等），数值与原先一致；组件内局部层级（1–6）保持字面量。提示框基础层级从变量读取，仍按祖先层级 +1 浮于所属选择器之上。

## 验证

- `pnpm typecheck`、`pnpm test`（874 项：872 通过、0 失败、2 跳过）、`pnpm build` 通过；`git diff --check` 无问题。
- 新增/扩展测试：`markdown-enhancements.test.mjs`（表格导出）、`result-file-markdown.test.mjs`（外链图片卡片、data 图片、危险协议回退、表格工具条）、`tool-activity.test.mjs`（回合标题的探索与混合摘要）。
- 隔离无界面 Electron 验证（`out/zcode4-review-run.mjs`）：长消息折叠高度与展开、回合摘要、表格复制 Markdown/CSV 内容与大窗口、外链卡片与工作区图片加载、代码换行前后溢出、Mermaid 全屏缩放与可见尺寸；深浅主题截图 `out/review-ui/ui4-*.png`，无控制台错误。第三轮验证脚本在样式迁移后重跑通过。
