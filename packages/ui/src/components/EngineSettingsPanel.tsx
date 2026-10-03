import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../i18n';
import { useChatStore } from '../store';
import type { SettingsDraftState } from '../settingsLeaveGuard';
import type { UiPiEngineProbe, UiPiEngineStatus } from '@pidesktop/shared';
import { Icon } from './Icons';
import './engineSettingsPanel.css';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

type EngineMode = 'builtin' | 'custom';

/**
 * Settings section for choosing which Pi engine drives the agent host: the
 * bundled SDK (default) or a user-managed npm install. A saved change applies
 * after the app restarts; the panel offers a one-click relaunch.
 */
export function EngineSettingsPanel({ onDraftStateChange }: { onDraftStateChange(state: SettingsDraftState): void }) {
	const { t, locale } = useT();
	const bridge = useChatStore(state => state.bridge);
	const id = useId();
	const mounted = useRef(false);
	const lock = useRef(false);
	const probeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [status, setStatus] = useState<UiPiEngineStatus | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [mode, setMode] = useState<EngineMode>('builtin');
	const [path, setPath] = useState('');
	const [savedMode, setSavedMode] = useState<EngineMode | null>(null);
	const [savedPath, setSavedPath] = useState<string>('');
	const [probe, setProbe] = useState<UiPiEngineProbe | null>(null);
	const [probing, setProbing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [restarting, setRestarting] = useState(false);
	const [pending, setPending] = useState<'pick' | 'save' | 'restart' | null>(null);

	const dirty = savedMode !== null && (mode !== savedMode || (mode === 'custom' && path.trim() !== savedPath));
	const disabled = !bridge || savedMode === null || pending !== null;
	const saveRef = useRef<() => Promise<boolean>>(async () => false);
	const saveDraft = useCallback(() => saveRef.current(), []);

	useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (probeTimer.current) clearTimeout(probeTimer.current); }; }, []);
	useEffect(() => { onDraftStateChange({ dirty, saving: pending !== null, save: dirty ? saveDraft : undefined }); }, [dirty, pending, saveDraft, onDraftStateChange]);
	useEffect(() => () => onDraftStateChange({ dirty: false, saving: false }), [onDraftStateChange]);

	// Load the effective selection plus what the running host actually loaded.
	useEffect(() => {
		if (!bridge?.getPiEngineStatus) return;
		let current = true;
		setStatus(null); setLoadError(null); setError(null); setSaved(false);
		void bridge.getPiEngineStatus().then(next => {
			if (!current) return;
			setStatus(next);
			setMode(next.selection.mode);
			setPath(next.selection.mode === 'custom' ? next.selection.path : '');
			setSavedMode(next.selection.mode);
			setSavedPath(next.selection.mode === 'custom' ? next.selection.path : '');
		}).catch((cause: unknown) => { if (current) setLoadError(errorText(cause)); });
		return () => { current = false; };
	}, [bridge, attempt]);

	const runProbe = useCallback((candidate: string) => {
		const trimmed = candidate.trim();
		setProbe(null);
		if (!bridge?.probePiEngine || !trimmed) return;
		setProbing(true);
		void bridge.probePiEngine(trimmed).then(next => { if (mounted.current) setProbe(next); })
			.catch((cause: unknown) => { if (mounted.current) setProbe({ ok: false, packageDir: null, version: null, problems: [errorText(cause)], warnings: [] }); })
			.finally(() => { if (mounted.current) setProbing(false); });
	}, [bridge]);

	// Debounced probe while typing a custom path; also re-probes the saved path on load.
	useEffect(() => {
		if (!bridge?.probePiEngine || mode !== 'custom') return;
		if (probeTimer.current) clearTimeout(probeTimer.current);
		const trimmed = path.trim();
		if (!trimmed) { setProbe(null); return; }
		probeTimer.current = setTimeout(() => runProbe(trimmed), 500);
		return () => { if (probeTimer.current) clearTimeout(probeTimer.current); };
	}, [bridge, mode, path, runProbe]);

	async function chooseDirectory() {
		if (!bridge?.pickPiEngineDirectory || disabled || lock.current) return;
		lock.current = true; setPending('pick'); setError(null); setSaved(false);
		try {
			const picked = await bridge.pickPiEngineDirectory();
			if (mounted.current && useChatStore.getState().bridge === bridge && picked) {
				setPath(picked);
				runProbe(picked);
			}
		} catch (cause) { if (mounted.current) setError(errorText(cause)); }
		finally { lock.current = false; if (mounted.current) setPending(null); }
	}

	async function save(): Promise<boolean> {
		if (!bridge?.setDesktopSettings || disabled || lock.current) return false;
		if (mode === 'custom' && !path.trim()) return false;
		lock.current = true; setPending('save'); setError(null); setSaved(false);
		const current = () => mounted.current && useChatStore.getState().bridge === bridge;
		try {
			const settings = await bridge.setDesktopSettings({ piEngine: mode === 'custom' ? { mode: 'custom', path: path.trim() } : { mode: 'builtin' } });
			if (!current()) return false;
			const selection = settings.piEngine ?? { mode: 'builtin' as const };
			setMode(selection.mode);
			setSavedMode(selection.mode);
			setPath(selection.mode === 'custom' ? selection.path : '');
			setSavedPath(selection.mode === 'custom' ? selection.path : '');
			if (bridge.getPiEngineStatus) void bridge.getPiEngineStatus().then(next => { if (current()) setStatus(next); }).catch(() => {});
			if (!current()) return false;
			setSaved(true);
			return true;
		} catch (cause) { if (current()) setError(errorText(cause)); return false; }
		finally { lock.current = false; if (mounted.current) setPending(null); }
	}
	saveRef.current = save;

	async function relaunch() {
		if (!bridge?.relaunchApp || restarting) return;
		setRestarting(true);
		setPending('restart');
		try { await bridge.relaunchApp(); } catch (cause) { if (mounted.current) setError(errorText(cause)); setRestarting(false); setPending(null); }
	}

	const builtinVersion = status?.builtinVersion ?? null;
	const activeLabel = status?.active
		? status.active.mode === 'builtin'
			? t('settings.engineActiveBuiltin', { version: status.active.version ?? '—' })
			: t('settings.engineActiveCustom', { version: status.active.version ?? '—' })
		: null;

	return <section className="pd-conversation-storage" data-setting="pi-engine" aria-labelledby={`${id}-title`}>
		<div className="pd-settings-section-head"><h2 id={`${id}-title`}>{t('settings.engine')}</h2><p id={`${id}-description`}>{t('settings.engineDescription')}</p></div>
		{loadError ? <div className="pd-conversation-storage-error" role="alert"><p>{t('settings.engineLoadFailed')}：{loadError}</p><button type="button" className="pd-conversation-storage-choose" onClick={() => setAttempt(value => value + 1)}>{t('projectCreate.retry')}</button></div> : savedMode === null ? <p className="pd-settings-feedback" role="status">{t('settings.engineLoading')}</p> : <>
			<div className="pd-settings-section-head"><h3>{t('settings.engineStatus')}</h3><p>{activeLabel ? t('settings.engineActiveLine', { engine: activeLabel }) : t('settings.engineIdleLine')}</p></div>
			{status?.pendingRestart && <div className="pd-conversation-storage-error" role="status"><p>{t('settings.enginePendingRestart')}</p><button type="button" className="pd-conversation-storage-choose" data-action="relaunch-app" disabled={pending !== null} onClick={() => void relaunch()}>{t(restarting ? 'settings.engineRestarting' : 'settings.engineRestart')}</button></div>}
			<div className="pd-settings-section-head"><h3>{t('settings.engineMode')}</h3><p>{t('settings.engineModeDescription')}</p></div>
			<div className="pd-language-options" data-setting="engine-mode" role="group" aria-label={t('settings.engineMode')}>
				<button type="button" className={mode === 'builtin' ? 'is-selected' : ''} aria-pressed={mode === 'builtin'} disabled={pending !== null} onClick={() => { setMode('builtin'); setError(null); setSaved(false); }}>{t('settings.engineBuiltin', { version: builtinVersion ?? '—' })}</button>
				<button type="button" className={mode === 'custom' ? 'is-selected' : ''} aria-pressed={mode === 'custom'} disabled={pending !== null} onClick={() => { setMode('custom'); setError(null); setSaved(false); }}>{t('settings.engineCustom')}</button>
			</div>
			{mode === 'custom' && <form onSubmit={event => { event.preventDefault(); if (dirty) void save(); }} aria-busy={pending !== null}>
				<div className="pd-settings-section-head"><h3>{t('settings.enginePath')}</h3><p>{t('settings.enginePathDescription')}</p></div>
				<textarea rows={2} name="piEngineDirectory" aria-label={t('settings.enginePath')} aria-describedby={`${id}-description`} value={path} disabled={disabled} autoComplete="off" spellCheck={false} placeholder={locale === 'zh-CN' ? '例如 D:\\engines\\pi\\node_modules\\@earendil-works\\pi-coding-agent' : 'e.g. D:\\engines\\pi\\node_modules\\@earendil-works\\pi-coding-agent'} onChange={event => { setPath(event.target.value); setError(null); setSaved(false); }} onKeyDown={event => {
					if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (dirty) void save(); }
				}} />
				<div className="pd-conversation-storage-actions">
					<button type="button" className="pd-conversation-storage-choose" data-action="choose-engine-directory" disabled={disabled} onClick={() => void chooseDirectory()}><Icon name="folder" width="15" height="15" />{t(pending === 'pick' ? 'projectCreate.choosing' : 'settings.engineChoose')}</button>
					<button type="button" className="pd-conversation-storage-choose" disabled={disabled || !path.trim() || probing} onClick={() => runProbe(path)}>{t(probing ? 'settings.engineChecking' : 'settings.engineCheck')}</button>
					<button type="submit" className="pd-settings-primary" data-action="save-engine-settings" disabled={disabled || !dirty || !path.trim()}>{t(pending === 'save' ? 'settings.processing' : 'settings.engineSave')}</button>
				</div>
				{probing && <p className="pd-settings-feedback" role="status">{t('settings.engineChecking')}</p>}
				{!probing && probe && probe.ok && <p className="pd-settings-feedback" role="status">{t('settings.engineProbeOk', { version: probe.version ?? '—' })}</p>}
				{!probing && probe && !probe.ok && <p className="pd-conversation-storage-error" role="alert">{t('settings.engineProbeProblems', { problems: probe.problems.join('；') })}</p>}
				{probe && probe.warnings.length > 0 && <p className="pd-conversation-storage-error" role="alert">{t('settings.engineWarnings', { warnings: probe.warnings.join('；') })}</p>}
				<p className="pd-engine-note">{t('settings.engineInstallHint')}</p>
				<p className="pd-engine-note">{t('settings.engineSharedNote')}</p>
				<p className="pd-engine-note">{t('settings.engineRiskNote')}</p>
				{error && <p className="pd-conversation-storage-error" role="alert">{error}</p>}
				{saved && <p className="pd-settings-feedback" role="status">{t('settings.engineSavedRestart')}</p>}
				{saved && status?.pendingRestart && <div className="pd-conversation-storage-actions"><button type="button" className="pd-settings-primary" data-action="relaunch-app-after-save" disabled={pending !== null} onClick={() => void relaunch()}>{t(restarting ? 'settings.engineRestarting' : 'settings.engineRestart')}</button></div>}
			</form>}
		</>}
	</section>;
}
