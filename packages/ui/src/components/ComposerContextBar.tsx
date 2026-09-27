import { useEffect, useRef, useState } from 'react';
import type { WorkspaceBranches } from '@pidesktop/shared';
import { useT } from '../i18n';
import { useChatStore } from '../store';
import { isConversationWorkspace, sidebarProjectPaths } from '../sidebarOrganization';
import { Icon } from './Icons';
import { SidebarPopover } from './SidebarPopover';

function errorText(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function workspaceName(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

/**
 * Project and branch controls for an empty conversation, with a direct action
 * to return to a conversation outside any project.
 */
export function ComposerContextBar() {
	const cwd = useChatStore((state) => state.cwd);
	const workspaces = useChatStore((state) => state.workspaces);
	const conversationWorkspaces = useChatStore((state) => state.conversationWorkspaces);
	const isHome = !workspaces.includes(cwd) || isConversationWorkspace(cwd, conversationWorkspaces);
	return (
		<div className="pd-composer-context">
			<ProjectChip isHome={isHome} />
			{!isHome && <BranchChip />}
		</div>
	);
}

function ProjectChip({ isHome }: { isHome: boolean }) {
	const { t } = useT();
	const cwd = useChatStore((state) => state.cwd);
	const workspaces = useChatStore((state) => state.workspaces);
	const conversationWorkspaces = useChatStore((state) => state.conversationWorkspaces);
	const newSession = useChatStore((state) => state.newSession);
	const switchWorkspace = useChatStore((state) => state.switchWorkspace);
	const pickWorkspace = useChatStore((state) => state.pickWorkspace);
	const navigationPending = useChatStore((state) => state.navigationPending);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const canDetach = Boolean(cwd) && !isHome;
	const projects = sidebarProjectPaths(workspaces, null, conversationWorkspaces);
	function clearProject() {
		if (!canDetach || navigationPending) return;
		setOpen(false);
		setError(null);
		void newSession().catch((cause) => setError(errorText(cause)));
	}

	if (!cwd) {
		return (
			<div className="pd-context-chip-wrap" onKeyDown={(event) => { if (event.key === 'Escape' && error) { event.stopPropagation(); setError(null); } }}>
				<button type="button" className="pd-context-chip" disabled={navigationPending} aria-label={t('composer.projectChoose')} onClick={() => { setError(null); void pickWorkspace({ fresh: true }).catch((cause) => setError(errorText(cause))); }}>
					<Icon name="folder" width="15" height="15" />
					<span className="pd-context-chip-label">{t('composer.projectChoose')}</span>
					<Icon name="chevronDown" width="13" height="13" />
				</button>
				{error && <div className="pd-chat-title-error pd-context-chip-error" role="alert">{t('chat.menuActionFailed', { message: error })}</div>}
			</div>
		);
	}

	return (
		<div className="pd-context-chip-wrap pd-context-project" onKeyDown={(event) => { if (event.key === 'Escape' && error) { event.stopPropagation(); setError(null); } }}>
			{canDetach && <button type="button" className="pd-context-project-clear" disabled={navigationPending} aria-label={t('composer.projectClear')} title={t('composer.projectClear')} onClick={clearProject}>
				<Icon name="close" width="13" height="13" />
			</button>}
			<button ref={anchorRef} type="button" className="pd-context-chip" disabled={navigationPending} aria-haspopup="menu" aria-expanded={open} aria-label={t('composer.projectMenuLabel')} onClick={() => { setError(null); setOpen((value) => !value); }}>
				<Icon name="folder" width="15" height="15" />
				<span className="pd-context-chip-label">{isHome ? t('composer.projectChoose') : workspaceName(cwd)}</span>
				<Icon name="chevronDown" width="13" height="13" />
			</button>
			{open && anchorRef.current && <SidebarPopover anchor={anchorRef.current} label={t('composer.projectMenuLabel')} placement="top" onClose={() => setOpen(false)}>
				{projects.map((workspace) => (
					<button type="button" key={workspace} role="menuitemradio" aria-checked={workspace === cwd} className="pd-context-menu-row is-wide" disabled={navigationPending || workspace === cwd} onClick={() => { setOpen(false); void switchWorkspace(workspace, { fresh: true }).catch((cause) => setError(errorText(cause))); }}>
						<span className="pd-context-menu-main"><Icon name="folder" width="15" height="15" />{workspaceName(workspace)}</span>
						{workspace === cwd ? <Icon name="check" width="15" height="15" /> : null}
						{workspace !== cwd && <small className="pd-context-menu-sub">{workspace}</small>}
					</button>
				))}
				<hr />
				<button type="button" role="menuitem" className="pd-context-menu-row is-wide" disabled={navigationPending} onClick={() => { setOpen(false); void pickWorkspace({ fresh: true }).catch((cause) => setError(errorText(cause))); }}>
					<span className="pd-context-menu-main"><Icon name="plus" width="15" height="15" />{t('composer.projectOpen')}</span>
				</button>
				{canDetach && <button type="button" role="menuitem" className="pd-context-menu-row is-wide" disabled={navigationPending} onClick={clearProject}>
					<span className="pd-context-menu-main"><Icon name="home" width="15" height="15" />{t('composer.projectClear')}</span>
				</button>}
			</SidebarPopover>}
			{error && <div className="pd-chat-title-error pd-context-chip-error" role="alert">{t('chat.menuActionFailed', { message: error })}</div>}
		</div>
	);
}

interface BranchState {
	loading: boolean;
	error: string | null;
	branches: WorkspaceBranches | null;
	dirtyCount: number;
}

const BRANCH_IDLE: BranchState = { loading: true, error: null, branches: null, dirtyCount: 0 };

function BranchChip() {
	const { t } = useT();
	const bridge = useChatStore((state) => state.bridge);
	const cwd = useChatStore((state) => state.cwd);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [switching, setSwitching] = useState<string | null>(null);
	const [state, setState] = useState<BranchState>(BRANCH_IDLE);
	const aliveRef = useRef(true);
	useEffect(() => {
		aliveRef.current = true;
		return () => { aliveRef.current = false; };
	}, []);

	async function refresh() {
		if (!bridge || !cwd) return;
		setState((current) => ({ ...current, loading: true, error: null }));
		try {
			const [branches, status] = await Promise.all([bridge.getWorkspaceBranches(), bridge.getWorkspaceGitStatus()]);
			const latest = useChatStore.getState();
			if (!aliveRef.current || latest.bridge !== bridge || latest.cwd !== cwd) return;
			setState({ loading: false, error: null, branches, dirtyCount: status.entries.length });
		} catch (cause) {
			const latest = useChatStore.getState();
			if (!aliveRef.current || latest.bridge !== bridge || latest.cwd !== cwd) return;
			setState((current) => ({ ...current, loading: false, error: errorText(cause) }));
		}
	}

	useEffect(() => {
		setState(BRANCH_IDLE);
		setSwitching(null);
		if (bridge && cwd) void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [bridge, cwd]);

	const branches = state.branches;
	if (!bridge || !cwd || !branches || !branches.isRepository) return null;
	const label = branches.current ?? t('composer.branchDetached');
	const visible = branches.branches.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()));

	return (
		<div className="pd-context-chip-wrap">
			<button ref={anchorRef} type="button" className="pd-context-chip" aria-haspopup="menu" aria-expanded={open} aria-label={`${t('composer.branchLabel')}: ${label}`} onClick={() => { const next = !open; setOpen(next); setQuery(''); if (next) void refresh(); }}>
				<Icon name="gitBranch" width="15" height="15" />
				<span className="pd-context-chip-label">{label}</span>
				<Icon name="chevronDown" width="13" height="13" />
			</button>
			{open && anchorRef.current && <SidebarPopover anchor={anchorRef.current} label={t('composer.branchLabel')} placement="top" dialog onClose={() => { setOpen(false); setSwitching(null); }}>
				<input className="pd-context-branch-search" type="text" value={query} placeholder={t('composer.branchSearchPlaceholder')} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); anchorRef.current?.focus(); } }} />
				<div className="pd-context-branch-list">
					{state.loading ? <p className="pd-context-branch-note" role="status">{t('composer.branchLoading')}</p>
						: visible.length === 0 ? <p className="pd-context-branch-note">{t('composer.branchEmpty')}</p>
							: visible.map((name) => {
								const current = name === branches.current;
								return <button type="button" key={name} role="menuitemradio" aria-checked={current} className="pd-context-menu-row" disabled={switching !== null} onClick={() => { if (current || !bridge) return; setSwitching(name); setState((value) => ({ ...value, error: null })); void bridge.checkoutWorkspaceBranch(name).then(() => { if (!aliveRef.current) return; setSwitching(null); setOpen(false); void refresh(); }).catch((cause) => { if (!aliveRef.current) return; setSwitching(null); setState((value) => ({ ...value, error: errorText(cause) })); }); }}>
									<span className="pd-context-menu-main"><Icon name="gitBranch" width="15" height="15" />{name}{switching === name ? <span className="pd-context-branch-switching" role="status">{t('composer.branchSwitching')}</span> : null}</span>
									{current ? <Icon name="check" width="15" height="15" /> : null}
									{current && state.dirtyCount > 0 ? <small className="pd-context-menu-sub">{t('composer.branchDirty', { count: state.dirtyCount })}</small> : null}
								</button>;
							})}
				</div>
				{state.error && <div className="pd-sidebar-error pd-context-branch-error" role="alert">{state.error}</div>}
			</SidebarPopover>}
		</div>
	);
}
