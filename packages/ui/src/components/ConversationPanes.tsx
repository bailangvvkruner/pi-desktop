import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentSnapshot } from '@pidesktop/shared';
import { useChatStore } from '../store';
import { useT } from '../i18n';
import { closePane, MAX_CONVERSATION_PANES, paneLeaves, parsePaneLayout, replacePane, setPaneRatio, splitPane, type PaneNode, type PaneSession } from '../conversationPanes';
import { selectPaneSession } from '../paneSessionActivation';
import { ScopedErrorBoundary } from './ScopedErrorBoundary';
import './conversationPanes.css';

const STORAGE = 'pi-desktop.conversation-panes.v1';
function initialLayout() {
  try { const saved = parsePaneLayout(sessionStorage.getItem(STORAGE)); if (saved) return saved; } catch {}
  return { tree: { kind: 'pane', id: 'primary', session: null } as PaneNode, active: 'primary' };
}
const previewComponents = { a: ({ children }: { children?: ReactNode }) => <span>{children}</span>, img: ({ alt }: { alt?: string }) => <span>{alt}</span> };
const PanePreview = memo(function PanePreview({ snapshot, chinese }: { snapshot?: AgentSnapshot; chinese: boolean }) {
  const label = (zh: string, en: string) => chinese ? zh : en;
  return <div className="pd-pane-preview">
    {!snapshot && <p>{label('选择会话，或点击“继续”加载内容。', 'Choose a conversation, or Continue to load it.')}</p>}
    {snapshot && <><div className="pd-pane-preview-status">{snapshot.status === 'busy' ? label('正在运行', 'Running') : label('会话预览', 'Conversation preview')}</div>{snapshot.messages.slice(-120).map(message => <article key={message.id} className={`pd-pane-message is-${message.role}`}><strong>{message.role === 'user' ? label('你', 'You') : label('助手', 'Assistant')}</strong>{message.thinking && <details><summary>{label('思考过程', 'Thinking')}</summary><p>{message.thinking}</p></details>}<div className="pd-markdown"><Markdown remarkPlugins={[remarkGfm]} components={previewComponents}>{message.text}</Markdown></div></article>)}{snapshot.activities.slice(-8).map(activity => <details key={activity.id}><summary>{activity.tool} · {activity.status}</summary><pre>{activity.detail}</pre></details>)}</>}
  </div>;
});

function Divider({ node, onResize }: { node: Extract<PaneNode, {kind: 'split'}>; onResize(ratio: number): void }) {
  const drag = useRef<{ start: number; size: number; ratio: number; next: number; frame: number } | null>(null);
  const stop = (element: HTMLDivElement, pointerId: number) => {
    const state = drag.current;
    if (!state) return;
    cancelAnimationFrame(state.frame); drag.current = null;
    onResize(state.next);
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  };
  useEffect(() => () => { if (drag.current) cancelAnimationFrame(drag.current.frame); }, []);
  return <div className="pd-pane-divider" role="separator" tabIndex={0} aria-label={node.direction === 'horizontal' ? '调整左右窗格 / Resize columns' : '调整上下窗格 / Resize rows'} aria-orientation={node.direction === 'horizontal' ? 'vertical' : 'horizontal'} aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(node.ratio)}
    onPointerDown={event => { if (event.button !== 0) return; const box = event.currentTarget.parentElement!.getBoundingClientRect(); drag.current = { start: node.direction === 'horizontal' ? event.clientX : event.clientY, size: node.direction === 'horizontal' ? box.width : box.height, ratio: node.ratio, next: node.ratio, frame: 0 }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
    onPointerMove={event => { const state = drag.current; if (!state) return; state.next = Math.max(20, Math.min(80, state.ratio + ((node.direction === 'horizontal' ? event.clientX : event.clientY) - state.start) / Math.max(1, state.size) * 100)); cancelAnimationFrame(state.frame); const parent = event.currentTarget.parentElement; state.frame = requestAnimationFrame(() => parent?.style.setProperty('--pd-pane-ratio', `${state.next}%`)); }}
    onPointerUp={event => stop(event.currentTarget, event.pointerId)} onPointerCancel={event => stop(event.currentTarget, event.pointerId)} onLostPointerCapture={event => stop(event.currentTarget, event.pointerId)}
    onKeyDown={event => { if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return; event.preventDefault(); onResize(event.key === 'Home' ? 20 : event.key === 'End' ? 80 : node.ratio + (['ArrowLeft','ArrowUp'].includes(event.key) ? -5 : 5)); }} />;
}

export function ConversationPanes({ children }: { children: ReactNode }) {
  const { locale } = useT(); const label = (zh: string, en: string) => locale === 'zh-CN' ? zh : en;
  const [layout, setLayout] = useState(initialLayout);
  const snapshots = useRef<Record<string, AgentSnapshot>>({});
  const [, updatePreviews] = useState(0);
  const [liveHost] = useState(() => { const host = document.createElement('div'); host.className = 'pd-pane-live-host'; return host; });
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const state = useChatStore();
  const target = useRef<string | null>(null), operation = useRef(0);
  useEffect(() => () => { operation.current += 1; }, []);
  const leaves = paneLeaves(layout.tree);
  const session = state.sessionId ? { cwd: state.cwd, sessionId: state.sessionId, sessionPath: state.sessionPath, title: (state.sessions.find(s => s.path === state.sessionPath)?.name || state.messages.find(m => m.role === 'user')?.text || label('新会话', 'New conversation')).slice(0, 200) } : null;
  useLayoutEffect(() => {
    if (!session || state.navigationPending || state.sessionLoading || target.current) return;
    setLayout(previous => {
      const leaf = paneLeaves(previous.tree).find(p => p.id === previous.active)!;
      if (JSON.stringify(leaf.session) === JSON.stringify(session)) return previous;
      return { ...previous, tree: replacePane(previous.tree, leaf.id, { ...leaf, session }) };
    });
    const snapshot: AgentSnapshot = { sequence: 0, cwd: state.cwd, sessionId: state.sessionId, sessionPath: state.sessionPath, messages: state.messages, activities: state.activities, runs: state.runs, status: state.status, error: state.error, model: state.model, modelName: state.modelName, modelProvider: state.modelProvider, thinkingLevel: state.thinkingLevel || 'off', availableThinkingLevels: state.availableThinkingLevels, contextUsage: state.contextUsage, queuedCount: state.queuedCount, queuedMessages: state.queuedMessages, fileChanges: state.fileChanges, historyTotal: state.historyTotal };
    snapshots.current[layout.active] = snapshot;
  }, [state.cwd, state.sessionId, state.sessionPath, state.messages, state.activities, state.runs, state.status, state.navigationPending, state.sessionLoading, layout.active, busy]);
  useEffect(() => { try { sessionStorage.setItem(STORAGE, JSON.stringify(layout)); } catch {} }, [layout]);
  useEffect(() => {
    if (!state.bridge?.getResidentSessionSnapshot || leaves.length < 2) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (!document.hidden) for (const pane of leaves) {
        if (pane.id === layout.active || !pane.session || cancelled) continue;
        try {
          const snapshot = await state.bridge!.getResidentSessionSnapshot({ cwd: pane.session.cwd, sessionId: pane.session.sessionId, sessionPath: pane.session.sessionPath });
          if (!cancelled && snapshot && snapshot.sequence !== snapshots.current[pane.id]?.sequence) { snapshots.current[pane.id] = snapshot; updatePreviews(value => value + 1); }
        } catch { /* Keep the last preview; activation will surface recovery errors. */ }
      }
      if (!cancelled) timer = setTimeout(refresh, 1500);
    };
    void refresh(); return () => { cancelled = true; clearTimeout(timer); };
  }, [layout.tree, layout.active, state.bridge]);
  const activate = async (id: string, selected: PaneSession) => {
    if (busy || state.navigationPending) return;
    const request = ++operation.current; target.current = id; setBusy(true); setError(null);
    try {
      const result = await selectPaneSession(useChatStore.getState, selected, () => operation.current === request);
      if (result === 'cancelled') return;
      if (result === 'released') throw new Error(label('此草稿已释放，请新建会话。已输入的草稿仍保存在项目中。', 'This draft has been released. Start a new conversation; its input is still saved in the workspace.'));
      if (operation.current === request) setLayout(previous => ({ ...previous, active: id, tree: replacePane(previous.tree, id, { kind: 'pane', id, session: selected }) }));
    } catch (reason) { if (operation.current === request) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (operation.current === request) { target.current = null; setBusy(false); } }
  };
  const add = (direction: 'horizontal' | 'vertical') => setLayout(previous => ({ ...previous, tree: splitPane(previous.tree, previous.active, direction, crypto.randomUUID()) }));
  const remove = (id: string) => {
    if (id === layout.active || busy) return;
    setLayout(previous => ({ ...previous, tree: closePane(previous.tree, id) ?? previous.tree }));
    delete snapshots.current[id];
  };
  const choices = Object.entries(state.sessionsByWorkspace).flatMap(([cwd, sessions]) => sessions.filter(s => !s.archived).map(s => ({ cwd, sessionId: s.id, sessionPath: s.path, title: s.name || s.firstMessage || label('未命名会话', 'Untitled conversation') })));
  const render = (node: PaneNode): ReactNode => {
    if (node.kind === 'split') return <div key={node.id} className={`pd-pane-split is-${node.direction}`} style={{ '--pd-pane-ratio': `${node.ratio}%` } as CSSProperties}><div className="pd-pane-branch">{render(node.first)}</div><Divider node={node} onResize={ratio => setLayout(previous => ({ ...previous, tree: setPaneRatio(previous.tree, node.id, ratio) }))} /><div className="pd-pane-branch">{render(node.second)}</div></div>;
    const active = node.id === layout.active, snapshot = snapshots.current[node.id];
    return <section key={node.id} className={`pd-conversation-pane${active ? ' is-active' : ''}`} data-pane-id={node.id} aria-label={node.session?.title || label('会话窗格', 'Conversation pane')}>
      {leaves.length > 1 && <header className="pd-pane-header"><strong>{node.session?.title || label('选择会话', 'Choose conversation')}</strong>{active ? <span>{label('当前编辑', 'Editing')}</span> : <><button type="button" disabled={busy || !node.session} onClick={() => node.session && void activate(node.id, node.session)}>{label('继续', 'Continue')}</button><button type="button" disabled={busy} aria-label={label('关闭窗格', 'Close pane')} onClick={() => remove(node.id)}>×</button></>}</header>}
      {active ? <div className="pd-pane-live-slot" ref={element => { if (element && liveHost.parentElement !== element) element.appendChild(liveHost); }} /> : <>
        <select className="pd-pane-session-picker" aria-label={label('选择窗格会话', 'Choose pane conversation')} disabled={busy || state.navigationPending} value="" onChange={event => { const choice = choices[Number(event.target.value)]; if (choice) void activate(node.id, choice); }}><option value="">{label('打开其他会话…', 'Open another conversation…')}</option>{choices.map((s, index) => <option key={`${s.cwd}-${s.sessionPath}`} value={index}>{s.title.slice(0, 70)} · {s.cwd.split(/[\\/]/).at(-1)}</option>)}</select>
        <ScopedErrorBoundary scope="conversation" resetKeys={[node.session?.sessionId, node.session?.sessionPath]}><PanePreview snapshot={snapshot} chinese={locale === 'zh-CN'} /></ScopedErrorBoundary>
      </>}
    </section>;
  };
  return <div className="pd-conversation-panes"><div className="pd-pane-toolbar"><button type="button" disabled={leaves.length >= MAX_CONVERSATION_PANES || busy} onClick={() => add('horizontal')}>{label('左右分屏', 'Split columns')}</button><button type="button" disabled={leaves.length >= MAX_CONVERSATION_PANES || busy} onClick={() => add('vertical')}>{label('上下分屏', 'Split rows')}</button>{leaves.length > 1 && <button type="button" disabled={busy} onClick={() => { const leaf = leaves.find(p => p.id === layout.active)!; setLayout({ tree: leaf, active: leaf.id }); snapshots.current = snapshots.current[leaf.id] ? { [leaf.id]: snapshots.current[leaf.id]! } : {}; }}>{label('单窗格', 'Single pane')}</button>}</div>{error && <p className="pd-pane-error" role="alert">{error}</p>}<div className="pd-pane-tree">{render(layout.tree)}</div>{createPortal(<ScopedErrorBoundary scope="conversation" resetKeys={[state.cwd, state.sessionId, state.sessionPath]}>{children}</ScopedErrorBoundary>, liveHost)}</div>;
}
