import { useState } from 'react';
import type { UiApprovalDecision, UiApprovalDetails, UiApprovalScope } from '@pidesktop/shared';
import { useT } from '../i18n';
import './approvalCard.css';

export function ApprovalCard({ approval, pending, onRespond }: { approval: UiApprovalDetails; pending: boolean; onRespond: (decision: UiApprovalDecision) => void }) {
  const { locale } = useT();
  const label = (zh: string, en: string) => locale === 'zh-CN' ? zh : en;
  const [scope, setScope] = useState<UiApprovalScope>('once');
  const [feedback, setFeedback] = useState('');
  const scopes = approval.scopes ?? ['once'];
  const names: Record<UiApprovalScope, string> = { once: label('仅本次操作', 'This operation'), session: label('当前会话', 'This conversation'), workspace: label('当前工作区', 'This workspace') };
  return <div className="pd-approval-card">
    {approval.source && <p className="pd-approval-source">{label('请求来源', 'Requested by')}：{approval.source}</p>}
    {approval.cwd && <p>{label('工作目录', 'Working directory')}：<code>{approval.cwd}</code></p>}
    {approval.command && <div><strong>{label('将要执行的命令', 'Command to execute')}</strong><pre className="pd-approval-command">{approval.command}</pre></div>}
    {approval.files?.map((file, index) => <details key={`${index}-${file.path}`} open={approval.files?.length === 1} className="pd-approval-file">
      <summary>{file.path}</summary>{file.diff !== undefined ? <pre className="pd-approval-diff">{file.diff.split('\n').map((line, lineIndex) => <span key={lineIndex} className={line.startsWith('+') ? 'is-addition' : line.startsWith('-') ? 'is-deletion' : undefined}>{line}{'\n'}</span>)}</pre> : <p>{label('此请求未提供修改预览。', 'No change preview was supplied.')}</p>}
    </details>)}
    <label className="pd-approval-scope">{label('授权范围', 'Allow for')}<select value={scope} disabled={pending} onChange={event => setScope(event.target.value as UiApprovalScope)}>{scopes.map(value => <option key={value} value={value}>{names[value]}</option>)}</select></label>
    <label className="pd-approval-feedback">{label('拒绝时的修改建议（可选）', 'Feedback when declining (optional)')}<textarea maxLength={4000} rows={2} value={feedback} disabled={pending} onChange={event => setFeedback(event.target.value)} placeholder={label('例如：只检查文件，不修改内容', 'For example: inspect the file without changing it')} /></label>
    <div className="pd-extension-request-actions"><button type="button" disabled={pending} onClick={() => onRespond({ approved: false, scope: 'once', ...(feedback.trim() ? { feedback: feedback.trim() } : {}) })}>{label('拒绝', 'Decline')}</button><button type="button" className="is-primary" disabled={pending} onClick={() => onRespond({ approved: true, scope })}>{label('允许', 'Allow')}</button></div>
  </div>;
}
