# 扩展询问与通知

范围：Pi 扩展通过 `ui.select`／`confirm`／`input`／`editor`／`notify` 发起的交互。参考 `D:\codex-re` 的 `pending-request-item-panel-cb4ba83c9960.js`（按请求类型分发的待处理面板、草稿与提交）与 `above-composer-fixed-content-surface-e6a9d6acb6e1.js`（输入框上方的固定内容面）：询问不是全屏模态框，而是输入区附近的普通卡片。

## 展示位置

- 对话页中的询问卡片挂在输入框上方（`.pd-composer-wrap` 内的 `.pd-extension-slot`），占用正常布局空间。不打开模态框、不加遮罩、不设焦点陷阱，也不抢输入焦点和草稿；询问挂起期间可以继续输入、滚动对话和操作侧栏。
- 卡片是输入框同宽的独立表面：标题行包含“等待你的回复”、问题文本、排队数量与收起／展开按钮；下面按类型渲染选项、确认按钮、单行输入或多行编辑。选择项按顺序编号，长选项列表与长文本在卡片内部滚动，卡片整体不超过 min(320px, 36vh)。
- 展开时问题文本完整显示；超长问题（例如 RPC 回退把选项预览折叠进标题）在标题区域内滚动，并保留原文换行，不会只显示两行后被永久截断。收起时保留一行摘要，用于回到对话。
- 非对话页没有输入框时，卡片固定在窗口右下角。已有原生 `<dialog>` 或自定义 `aria-modal` 弹窗时，卡片挂载到该弹窗内部，避免受背景 inert 影响；此时在弹窗内维持 Tab 边界，普通对话卡片不抓 Tab。

## 交互与队列

- 回答方式：点选选项、确认／取消、填写单行文本或编辑多行文本后提交。提交失败保留已填内容并允许重试。
- Escape 只在焦点位于卡片内时取消当前询问：选择／输入／编辑为 `null`，确认为 `false`。输入框中的 Escape 不取消无关的询问。
- 多个请求按到达顺序排队，同时只显示一个；标题行显示“还有 N 项”。超时（`timeout`）与宿主关闭（`closed`）都按协议结束当前询问并推进队列，不会伪造用户回答。
- 通知（`notify`）继续使用右上角浮层，不占用输入区。

## 协议与一致性

- 请求经 `agentExtensionDialog`、`agentExtensionDialogResponse`、`agentExtensionDialogPending`、`agentExtensionDialogClosed` 在 agent 与 renderer 之间传递。卡片按桥接实例分代过滤事件与待处理列表，重复 id、迟到响应和“先关闭后返回”的竞态不会重复提交。
- 焦点只在卡片确实持有焦点且因移除而丢失时还给输入框；其他情况下不打断用户已经移动到的位置。

## 验证入口

- `tests/fixtures/extension-requests/scenarios.mjs`：生产 renderer 中的挂载位置、草稿与焦点保留、侧栏不受阻、折叠、排队、提交／取消、失败重试、超时、宿主关闭、通知、长选项窄屏滚动、已有插件弹窗内的迁移，以及深浅主题与窄窗口截图。
- 2026-09-27 复核：`pnpm build`、UI 类型检查与上述 fixture 通过；另用问卷风格请求（长问题＋折叠预览＋编号选项＋“Type something.”行）确认标题完整可读、换行保留、回答后草稿与焦点不变。截图位于 `out/review/model-settings/runs/`。
