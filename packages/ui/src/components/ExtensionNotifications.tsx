import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { UiExtensionDialogRequest } from '@pidesktop/shared';
import { useT } from '../i18n';
import { Icon } from './Icons';
import './extensionNotifications.css';

function NotificationToast({ request, index, count, expanded, paused, onDismiss }: {
	request: UiExtensionDialogRequest;
	index: number;
	count: number;
	expanded: boolean;
	paused: boolean;
	onDismiss(id: string): void;
}) {
	const { t } = useT();
	const dismiss = useRef(onDismiss);
	const remaining = useRef(0);
	dismiss.current = onDismiss;
	useEffect(() => {
		remaining.current = request.timeout && request.timeout > 0 ? request.timeout : 6000;
	}, [request.id, request.timeout]);
	useEffect(() => {
		if (paused) return;
		const started = performance.now();
		const timer = window.setTimeout(() => dismiss.current(request.id), remaining.current);
		return () => {
			window.clearTimeout(timer);
			remaining.current = Math.max(0, remaining.current - (performance.now() - started));
		};
	}, [request.id, request.timeout, paused]);
	return <div
		className={`pd-extension-notice is-${request.notificationType ?? 'info'}`}
		data-notification-id={request.id}
		style={{ '--notice-depth': Math.min(index, 2), zIndex: count - index } as CSSProperties}
		role={request.notificationType === 'error' ? 'alert' : 'status'}
	>
		<div><strong>{request.title}</strong>{request.message && <p>{request.message}</p>}</div>
		<button type="button" tabIndex={expanded || index === 0 ? 0 : -1} onClick={() => onDismiss(request.id)} aria-label={t('extension.noticeClose', { title: request.title })}>
			<Icon name="close" width="15" height="15" />
		</button>
	</div>;
}

export function ExtensionNotifications({ requests, onDismiss }: { requests: UiExtensionDialogRequest[]; onDismiss(id: string): void }) {
	const { t } = useT();
	const stack = useRef<HTMLDivElement>(null);
	const transferFocus = useRef(false);
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const expanded = hovered || focused;
	// Keep keyed cards mounted so new arrivals do not restart older timers.
	const newestFirst = [...requests].reverse();
	useLayoutEffect(() => {
		if (transferFocus.current && document.activeElement === document.body) {
			stack.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
		}
		transferFocus.current = false;
		setFocused(stack.current?.contains(document.activeElement) ?? false);
	}, [requests]);
	function dismiss(id: string) {
		transferFocus.current = document.activeElement?.closest<HTMLElement>('.pd-extension-notice')?.dataset.notificationId === id;
		onDismiss(id);
	}
	return <div
		ref={stack}
		className={`pd-extension-notifications${expanded ? ' is-expanded' : ''}`}
		style={{ '--stack-peek': `${Math.min(requests.length - 1, 2) * 12}px` } as CSSProperties}
		role="region"
		aria-label={t('extension.notifications')}
		tabIndex={0}
		onMouseEnter={() => setHovered(true)}
		onMouseLeave={() => setHovered(false)}
		onFocusCapture={() => setFocused(true)}
		onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
	>
		{newestFirst.map((request, index) => <NotificationToast key={request.id} request={request} index={index} count={requests.length} expanded={expanded} paused={expanded} onDismiss={dismiss} />)}
	</div>;
}
