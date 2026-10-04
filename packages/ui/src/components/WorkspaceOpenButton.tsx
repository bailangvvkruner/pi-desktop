import type { WorkspaceOpener } from '@pidesktop/shared';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { useChatStore } from '../store';
import { Icon, type IconName } from './Icons';
import { SidebarPopover } from './SidebarPopover';
import { readPreferredOpener, writePreferredOpener } from '../editorPreference';

// zcode WorkspaceEditorButtonGroup: a segmented control whose main button opens
// the workspace with the selected app and whose chevron offers an open-with
// picker. Only explicit choices persist; otherwise the first opener is used.
function fallbackIcon(opener: WorkspaceOpener): IconName {
	return opener.kind === 'terminal' ? 'terminal' : opener.id === 'explorer' ? 'folder' : 'code';
}

function errorText(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

/** Renders the backend-provided editor icon, falling back to a lucide glyph. */
function OpenerIcon({ opener }: { opener: WorkspaceOpener }) {
	if (opener.icon) return <img src={opener.icon} alt='' className='pd-opener-icon' width='15' height='15' />;
	return <Icon name={fallbackIcon(opener)} width='15' height='15' />;
}

export function WorkspaceOpenButton({ cwd }: { cwd: string | null }) {
	const { t } = useT();
	const bridge = useChatStore((state) => state.bridge);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [openers, setOpeners] = useState<WorkspaceOpener[]>([]);
	const [selected, setSelected] = useState<string | null>(() => readPreferredOpener());
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setOpeners([]);
		bridge?.listWorkspaceOpeners().then((list) => { if (!cancelled) setOpeners(list); }).catch(() => { /* picker stays hidden */ });
		return () => { cancelled = true; };
	}, [bridge]);

	const currentOpener = openers.find((entry) => entry.id === selected) ?? openers[0] ?? null;
	if (!cwd || !bridge || currentOpener === null) return null;

	const launch = async (id: string) => {
		setError(null);
		try {
			if (id === 'explorer') await bridge.openWorkspaceFolder(cwd);
			else if (bridge.openWorkspaceWith) await bridge.openWorkspaceWith(cwd, id);
			else await bridge.openWorkspaceInVsCode(cwd);
		} catch (cause) {
			setError(errorText(cause));
		}
	};

	const choose = (id: string) => {
		setSelected(id);
		writePreferredOpener(id);
		setOpen(false);
		void launch(id);
	};

	const current = currentOpener.id;
	// Detected apps carry their own product name; the file manager label is localized.
	const labelOf = (opener: WorkspaceOpener) => opener.name ?? t(`chat.opener.${opener.id}`);
	const currentLabel = labelOf(currentOpener);
	const mainLabel = t('chat.openInOpener', { name: currentLabel });
	return (
		<div className="pd-workspace-open-wrap" onKeyDown={(event) => { if (event.key === 'Escape' && error) { event.stopPropagation(); setError(null); } }}>
			<div className="pd-workspace-open">
				<button type="button" className="pd-workspace-open-main" aria-label={mainLabel} title={mainLabel} onClick={() => void launch(current)}><OpenerIcon opener={currentOpener} /></button>
				<button ref={anchorRef} type="button" className="pd-workspace-open-menu" aria-haspopup="menu" aria-expanded={open} aria-label={t('chat.selectOpener')} onClick={() => { setError(null); setOpen((value) => !value); }}><Icon name="chevronDown" width="13" height="13" /></button>
			</div>
			{open && anchorRef.current && <SidebarPopover anchor={anchorRef.current} label={t('chat.selectOpener')} onClose={() => setOpen(false)}>
				{openers.map((opener) => (
					<button type="button" key={opener.id} role="menuitemradio" aria-checked={opener.id === current} className="pd-context-menu-row" onClick={() => choose(opener.id)}>
						<span className="pd-context-menu-main"><OpenerIcon opener={opener} />{labelOf(opener)}</span>
						{opener.id === current ? <Icon name="check" width="15" height="15" /> : null}
					</button>
				))}
			</SidebarPopover>}
			{error && <div className="pd-chat-title-error pd-workspace-open-error" role="alert">{t('chat.menuActionFailed', { message: error })}</div>}
		</div>
	);
}
