# 局部错误恢复与结构化审批

## 界面错误

聊天、终端、工作台及文件预览使用 `ScopedErrorBoundary`。错误只替换所属区域，用户可重试；`resetKeys` 随会话、工作区或文件变化时自动复位。关闭预览等外部控制仍可使用。异步业务操作沿用既有重连、重新生成和压缩入口。

错误卡提供完整脱敏详情、复制和最近一天诊断导出。报告包含随机诊断编号、时间、区域、错误类别与脱敏错误文本，不读取会话正文、附件或账户配置。凭据、请求正文、消息载荷与 URL 凭据/查询参数先脱敏。诊断日志仅记编号与枚举元信息，不存原始错误；用户主动复制的报告与导出日志以编号对应。

## 审批协议

旧 `ctx.ui.confirm(title, message, options)` 保持返回 `Promise<boolean>`。桌面扩展可以将 options 声明为 `DesktopApprovalOptions`，增加 `approval`（command、cwd、files 中的 path/diff、source、scopes）和 `onApprovalDecision` 回调。

```ts
const options: DesktopApprovalOptions = {
  approval: { command: 'git diff', source: 'Review extension', scopes: ['once', 'session'] },
  onApprovalDecision(decision) {
    // 扩展负责兑现 scope；拒绝反馈由调用方用于调整下一步操作。
    if (!decision.approved) explainDecline(decision.feedback);
  },
};
const approved = await ctx.ui.confirm('检查变更', '运行以下只读命令', options);
if (!approved) return;
```

结构化元信息来自扩展声明，不作为信任证明。主进程按待处理请求及窗口所有者校验响应；不能批准未提供的范围，拒绝只使用 once。没有回调的扩展强制仅本次授权，避免承诺无法兑现的会话/工作区规则。超时、取消、关闭窗口都按拒绝处理。异步拒绝反馈与所选范围经原 utility-process IPC 返回到扩展，不写日志。

审批正文、文件数量与差异长度有限额；超限明确拒绝，不能截断隐藏待授权内容。卡片失败保留选择和拒绝反馈，重试发送同一待处理请求。

验收覆盖旧确认兼容、命令/diff往返、拒绝反馈、范围伪造拒绝、大小限制、敏感错误脱敏、局部重试与上下文复位。
