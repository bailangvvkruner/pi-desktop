import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';

/**
 * Full-window preview shell for wide tables and diagrams (ZCode markdown-table
 * preview / diagram-preview-dialog). Shares the image preview's dialog styling.
 */
export function ContentPreviewDialog({ title, toolbar, children, onClose, onKeyDown, bodyClassName = '' }: { title: string; toolbar?: ReactNode; children: ReactNode; onClose(): void; onKeyDown?(event: KeyboardEvent<HTMLDialogElement>): void; bodyClassName?: string }) {
	const { t } = useT();
	const titleId = useId();
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		dialog.current?.showModal();
		return () => { dialog.current?.close(); if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); };
	}, []);
	return createPortal(<dialog ref={dialog} className="pd-image-preview pd-content-preview" aria-modal="true" aria-labelledby={titleId}
		onCancel={(event) => { event.preventDefault(); onClose(); }}
		onKeyDown={(event) => { event.stopPropagation(); onKeyDown?.(event); }}>
		<header><strong id={titleId}>{title}</strong><button type="button" onClick={onClose} autoFocus>{t('preview.close')}</button></header>
		{toolbar && <div className="pd-image-preview-toolbar">{toolbar}</div>}
		<div className={`pd-image-preview-body ${bodyClassName}`.trim()}>{children}</div>
	</dialog>, document.body);
}
