import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ResultFileTarget } from '@pidesktop/shared';
import { useChatStore } from '../store';
import { useT } from '../i18n';
import { parseResultFileReference } from '../resultFileReferences';
import { runWithFeedback } from '../operationFeedback';
import type { ContextMenuPoint } from '../contextMenuPosition';
import { SidebarPopover } from './SidebarPopover';
import { ResultFilePreviewDialog } from './ResultFilePreviewDialog';
import { Icon } from './Icons';
import './resultFileLink.css';

export function ResultFileLink({ href, children, title }: { href?: string; children?: ReactNode; title?: string }) {
  const { locale } = useT();
  const label = (zh: string, en: string) => locale === 'zh-CN' ? zh : en;
  const reference = href ? parseResultFileReference(href) : null;
  const bridge = useChatStore(state => state.bridge);
  const cwd = useChatStore(state => state.cwd);
  const sessionPath = useChatStore(state => state.sessionPath);
  const navigationPending = useChatStore(state => state.navigationPending);
  const anchor = useRef<HTMLAnchorElement>(null);
  const [menu, setMenu] = useState(false);
  const [menuPoint, setMenuPoint] = useState<ContextMenuPoint>();
  const [preview, setPreview] = useState<ResultFileTarget | null>(null);
  useEffect(() => { setMenu(false); setPreview(null); }, [cwd, sessionPath, navigationPending, href]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [menu]);
  if (!reference) return <a href={href} title={title}>{children}</a>;
  const target = { ...reference, cwd };
  const available = Boolean(bridge && cwd && !navigationPending);
  const act = (action: 'open' | 'reveal') => {
    setMenu(false);
    if (!bridge || !available) return;
    void runWithFeedback({
      id: `result-file:${action}:${cwd}:${reference.path}`,
      title: action === 'open' ? label('打开文件', 'Open file') : label('打开所在位置', 'Show in folder'),
      run: () => action === 'open' ? bridge.openResultFile(target) : bridge.revealResultFile(target),
      canRetry: () => useChatStore.getState().cwd === cwd && useChatStore.getState().sessionPath === sessionPath && !useChatStore.getState().navigationPending,
    });
  };
  return <>
    <a ref={anchor} href={href} className="pd-result-file-link" data-result-file={reference.path} title={title ?? reference.path}
      aria-haspopup="menu" aria-expanded={menu} aria-disabled={!available || undefined}
      onClick={event => { event.preventDefault(); act('open'); }} onAuxClick={event => event.preventDefault()}
      onContextMenu={event => { event.preventDefault(); if (available) { setMenuPoint({ x: event.clientX, y: event.clientY }); setMenu(true); } }}
      onKeyDown={event => {
        if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); if (available) { setMenuPoint(undefined); setMenu(true); } }
      }}>{children}</a>
    {menu && anchor.current && <SidebarPopover anchor={anchor.current} point={menuPoint} label={label('文件操作', 'File actions')} onClose={() => setMenu(false)}>
      <button type="button" role="menuitem" onClick={() => act('open')}><span>{label('打开文件', 'Open file')}</span><Icon name="file" width="14" height="14" /></button>
      <button type="button" role="menuitem" onClick={() => { setMenu(false); setPreview(target); }}><span>{label('预览', 'Preview')}</span><Icon name="panelRight" width="14" height="14" /></button>
      <button type="button" role="menuitem" onClick={() => act('reveal')}><span>{label('打开所在位置', 'Show in folder')}</span><Icon name="folder" width="14" height="14" /></button>
    </SidebarPopover>}
    {preview && <ResultFilePreviewDialog target={preview} onClose={() => {
      setPreview(null);
      const current = useChatStore.getState();
      if (current.cwd === cwd && current.sessionPath === sessionPath && !current.navigationPending && anchor.current?.isConnected) anchor.current.focus({ preventScroll: true });
    }} />}
  </>;
}
