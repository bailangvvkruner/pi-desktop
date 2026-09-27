import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import { managementCopy } from '../managementCopy';

export type SessionTrashTarget = { path: string; title: string };

export function SessionBulkTrashDialog({ sessions, onDelete, onClose }: {
	sessions: SessionTrashTarget[];
	onDelete(path: string): Promise<void>;
	onClose(deleted: string[]): void;
}) {
	const { t, locale } = useT();
	const copy = managementCopy(locale);
	const id = useId();
	const dialog = useRef<HTMLDialogElement>(null);
	const mounted = useRef(false);
	const lock = useRef(false);
	const deleted = useRef(new Set<string>());
	const [remaining, setRemaining] = useState(sessions);
	const [busy, setBusy] = useState(false);
	const [errors, setErrors] = useState<Record<string, string>>({});
	useEffect(() => { mounted.current = true; const node = dialog.current; node?.showModal(); return () => { mounted.current = false; node?.close(); }; }, []);
	function close() { dialog.current?.close(); onClose([...deleted.current]); }
	async function submit() {
		if (lock.current) return;
		lock.current = true; setBusy(true); setErrors({});
		const failures: Record<string, string> = {};
		// Each deletion may switch away from the open conversation. Keep those
		// transitions sequential and never retry an already successful deletion.
		try {
			for (const session of sessions) {
				if (!mounted.current) return;
				if (deleted.current.has(session.path)) continue;
				try {
					await onDelete(session.path);
					deleted.current.add(session.path);
					if (mounted.current) setRemaining(current => current.filter(item => item.path !== session.path));
				} catch (cause) { failures[session.path] = cause instanceof Error ? cause.message : String(cause); }
			}
			if (!mounted.current) return;
			if (deleted.current.size === sessions.length) close();
			else setErrors(failures);
		} finally { lock.current = false; if (mounted.current) setBusy(false); }
	}
	return createPortal(<dialog ref={dialog} className="pd-session-trash-dialog pd-session-bulk-trash-dialog" aria-labelledby={id} onCancel={event => { event.preventDefault(); if (!lock.current) close(); }}>
		<h2 id={id}>{t('sidebar.trashSelectedTitle', { count: remaining.length })}</h2>
		<ul className="pd-session-bulk-trash-list">{remaining.map(session => <li key={session.path}><strong>{session.title}</strong>{errors[session.path] && <p className="pd-session-trash-error" role="alert">{errors[session.path]}</p>}</li>)}</ul>
		{deleted.current.size > 0 && <p role="status">{t('sidebar.trashSelectedProgress', { count: deleted.current.size, total: sessions.length })}</p>}
		<footer><button autoFocus type="button" disabled={busy} onClick={close}>{copy.cancel}</button><button type="button" className="is-danger" disabled={busy} onClick={() => void submit()}>{busy ? copy.deleting : Object.keys(errors).length ? copy.retry : copy.trash}</button></footer>
	</dialog>, document.body);
}
