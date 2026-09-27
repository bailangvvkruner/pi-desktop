import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import { bindingKeysFor, matchesShortcut } from '../shortcuts/bindings';
import type { UiMessage } from '@pidesktop/shared';

/**
 * Floating rail on the left edge of the conversation (Codex pattern): one marker
 * per user message. Hovering a marker previews the turn, clicking (or dragging
 * across markers) scrolls the transcript to that message; Alt+ArrowUp/Down jump
 * between turns from the keyboard.
 */

interface RailItem {
	id: string;
	text: string;
	preview: string;
}

interface HoverState {
	id: string;
	x: number;
	y: number;
}

const MIN_ITEMS = 4;
const READING_LINE_RATIO = 0.4;
const MIN_CONTENT_GAP = 52;
const PREVIEW_ESTIMATE_HEIGHT = 96;

function findRow(scroll: HTMLElement, id: string): HTMLElement | null {
	return scroll.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
}

export const ConversationRail = memo(function ConversationRail({ messages, getScrollElement, markedIds, onJumpToMessage }: { messages: UiMessage[]; getScrollElement(): HTMLElement | null; markedIds?: ReadonlySet<string>; onJumpToMessage?(id: string): void }) {
	const { t } = useT();
	const items = useMemo<RailItem[]>(() => {
		const result: RailItem[] = [];
		messages.forEach((message, index) => {
			if (message.role !== 'user') return;
			let preview = '';
			for (let i = index + 1; i < messages.length; i += 1) {
				const next = messages[i]!;
				// Skip tool-call-only assistant turns (empty text) and use the first written reply.
				if (next.role === 'assistant' && (next.text ?? '').trim()) { preview = next.text ?? ''; break; }
				if (next.role === 'user') break;
			}
			result.push({ id: message.id, text: (message.text ?? '').trim(), preview: preview.trim() });
		});
		return result;
	}, [messages]);
	// Reply tokens change the previews, but not the history navigation structure.
	const itemIdsKey = JSON.stringify(items.map((item) => item.id));
	const itemIds = useMemo<string[]>(() => JSON.parse(itemIdsKey), [itemIdsKey]);

	const [activeId, setActiveId] = useState<string | null>(null);
	const [hover, setHover] = useState<HoverState | null>(null);
	const [hasRoom, setHasRoom] = useState(true);
	const hoverFrameRef = useRef<{ id: string; frame: number } | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const draggingRef = useRef<{ pointerId: number; itemId: string } | null>(null);
	const suppressClickRef = useRef(false);

	const scrollToItem = useCallback((id: string, behavior: ScrollBehavior) => {
		const scroll = getScrollElement();
		const row = scroll ? findRow(scroll, id) : null;
		if (!row || !scroll) return false;
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		row.scrollIntoView({ behavior: reduced ? 'auto' : behavior, block: 'start' });
		return true;
	}, [getScrollElement]);

	const flashItem = useCallback((id: string) => {
		const scroll = getScrollElement();
		const row = scroll ? findRow(scroll, id) : null;
		const bubble = row?.querySelector<HTMLElement>(':scope .pd-user-bubble') ?? row;
		if (!bubble) return;
		bubble.classList.remove('pd-rail-flash');
		void bubble.offsetWidth; // restart the animation
		bubble.classList.add('pd-rail-flash');
	}, [getScrollElement]);

	const jump = useCallback((id: string, behavior: ScrollBehavior = 'auto') => {
		if (onJumpToMessage) { onJumpToMessage(id); return; }
		if (scrollToItem(id, behavior)) flashItem(id);
	}, [scrollToItem, flashItem, onJumpToMessage]);

	const clearHoverFrame = useCallback((id?: string) => {
		const pending = hoverFrameRef.current;
		if (!pending || (id !== undefined && pending.id !== id)) return;
		cancelAnimationFrame(pending.frame);
		hoverFrameRef.current = null;
	}, []);

	const openHover = useCallback((id: string, button: HTMLElement, immediate = false) => {
		clearHoverFrame();
		const place = () => {
			if (!button.isConnected) return;
			const rect = button.getBoundingClientRect();
			const y = Math.min(Math.max(rect.top + rect.height / 2 - PREVIEW_ESTIMATE_HEIGHT / 2, 8), window.innerHeight - PREVIEW_ESTIMATE_HEIGHT - 8);
			const x = rect.right + 12;
			setHover((current) => current?.id === id && current.x === x && current.y === y ? current : { id, x, y });
		};
		if (immediate) { place(); return; }
		// Coalesce pointer events within a frame without delaying every new marker.
		hoverFrameRef.current = { id, frame: requestAnimationFrame(() => { hoverFrameRef.current = null; place(); }) };
	}, [clearHoverFrame]);

	// Track the message at the reading line so the rail reflects the scroll position.
	useLayoutEffect(() => {
		const scroll = getScrollElement();
		if (!scroll) return;
		const ids = new Set(itemIds);
		let frame = 0;
		const update = () => {
			frame = 0;
			if (itemIds.length === 0) { setActiveId(null); return; }
			const rect = scroll.getBoundingClientRect();
			const line = rect.top + rect.height * READING_LINE_RATIO;
			let current: string | null = null;
			// Only inspect mounted user rows; virtualized history may contain thousands of IDs.
			for (const row of scroll.querySelectorAll<HTMLElement>('.pd-message-row.is-user[data-message-id]')) {
				const id = row.dataset.messageId!;
				if (!ids.has(id)) continue;
				if (row.getBoundingClientRect().top <= line) current = id;
				else break;
			}
			setActiveId(current ?? itemIds[0]!);
		};
		const schedule = () => { if (frame === 0) frame = requestAnimationFrame(update); };
		scroll.addEventListener('scroll', schedule, { passive: true });
		const observer = new ResizeObserver(schedule);
		observer.observe(scroll);
		const list = scroll.querySelector('.pd-message-list');
		if (list) observer.observe(list);
		schedule();
		return () => {
			scroll.removeEventListener('scroll', schedule);
			observer.disconnect();
			if (frame !== 0) cancelAnimationFrame(frame);
		};
	}, [itemIds, getScrollElement]);

	// Hide the rail when the transcript content starts too close to the left edge.
	useLayoutEffect(() => {
		const scroll = getScrollElement();
		if (!scroll) return;
		const measure = () => {
			const column = scroll.querySelector<HTMLElement>('.pd-message-column');
			if (!column) { setHasRoom(false); return; }
			setHasRoom(column.getBoundingClientRect().left - scroll.getBoundingClientRect().left >= MIN_CONTENT_GAP);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(scroll);
		window.addEventListener('resize', measure);
		measure();
		return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
	}, [items.length, getScrollElement]);

	// Keep the reading position visible in long rails without moving targets under the pointer.
	useLayoutEffect(() => {
		const list = listRef.current;
		if (!list || !activeId || draggingRef.current || list.matches(':hover') || list.contains(document.activeElement)) return;
		const marker = list.querySelector<HTMLElement>(`[data-rail-id="${CSS.escape(activeId)}"]`);
		if (!marker) return;
		const bounds = list.getBoundingClientRect();
		const rect = marker.getBoundingClientRect();
		if (rect.top < bounds.top) list.scrollTop -= bounds.top - rect.top;
		else if (rect.bottom > bounds.bottom) list.scrollTop += rect.bottom - bounds.bottom;
	}, [activeId, hasRoom, itemIds]);

	// Alt+ArrowUp/Down jumps to the previous/next user message.
	useEffect(() => {
		if (itemIds.length < MIN_ITEMS) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing) return;
			const isPrev = matchesShortcut(event, bindingKeysFor('previousTurn'));
			const isNext = matchesShortcut(event, bindingKeysFor('nextTurn'));
			if (!isPrev && !isNext) return;
			if (getScrollElement() == null) return;
			const index = activeId != null ? itemIds.indexOf(activeId) : -1;
			const next = isNext
				? (index === -1 ? 0 : Math.min(itemIds.length - 1, index + 1))
				: (index === -1 ? itemIds.length - 1 : Math.max(0, index - 1));
			const target = itemIds[next];
			if (!target) return;
			event.preventDefault();
			jump(target);
		};
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [itemIds, activeId, jump, getScrollElement]);

	useEffect(() => () => clearHoverFrame(), [clearHoverFrame]);

	const markerFromPoint = useCallback((clientX: number, clientY: number): HTMLButtonElement | null => {
		const list = listRef.current;
		if (!list) return null;
		const button = document.elementFromPoint(clientX, clientY)?.closest<HTMLButtonElement>('[data-rail-id]');
		return button && list.contains(button) ? button : null;
	}, []);

	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		const button = (event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-rail-id]') : null);
		if (!button) return;
		const id = button.dataset.railId;
		if (!id) return;
		suppressClickRef.current = false;
		button.setPointerCapture(event.pointerId);
		draggingRef.current = { pointerId: event.pointerId, itemId: id };
		openHover(id, button, true);
	};

	const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		const drag = draggingRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		draggingRef.current = null;
		if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
			suppressClickRef.current = false;
			clearHoverFrame();
			setHover(null);
		}
	}, [clearHoverFrame]);

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const drag = draggingRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (event.buttons % 2 === 0) { endDrag(event); return; }
		const button = markerFromPoint(event.clientX, event.clientY);
		const id = button?.dataset.railId;
		if (!button || !id) { clearHoverFrame(); setHover(null); return; }
		if (id !== drag.itemId) {
			draggingRef.current = { ...drag, itemId: id };
			suppressClickRef.current = true;
			jump(id, 'auto');
		}
		openHover(id, button);
	};

	if (items.length < MIN_ITEMS || !hasRoom) return null;

	const previewItem = hover ? items.find((item) => item.id === hover.id) ?? null : null;

	return (
		<nav className="pd-conv-rail" aria-label={t('rail.ariaLabel')} onPointerLeave={() => { clearHoverFrame(); setHover(null); }}>
			<div
				ref={listRef}
				className="pd-conv-rail-list"
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				onLostPointerCapture={endDrag}
			>
				{items.map((item, index) => (
					<button
						key={item.id}
						type="button"
						className={'pd-conv-rail-item' + (markedIds?.has(item.id) ? ' is-marked' : '')}
						data-rail-id={item.id}
						data-previewed={item.id === hover?.id ? 'true' : undefined}
						aria-current={item.id === activeId ? 'true' : undefined}
						aria-label={t('rail.jump', { position: String(index + 1) })}
						onClick={(event) => {
							if (suppressClickRef.current && event.detail !== 0) { suppressClickRef.current = false; return; }
							jump(item.id);
						}}
						onPointerEnter={(event) => { if (draggingRef.current == null) openHover(item.id, event.currentTarget); }}
						onPointerLeave={() => { if (draggingRef.current == null) clearHoverFrame(item.id); }}
						onFocus={(event) => openHover(item.id, event.currentTarget, true)}
						onBlur={() => { clearHoverFrame(item.id); setHover((current) => current?.id === item.id ? null : current); }}
					>
						<span className="pd-conv-rail-line" />
					</button>
				))}
			</div>
			{previewItem && hover && createPortal(
				<div className="pd-conv-rail-preview" style={{ left: hover.x, top: hover.y }} role="tooltip" aria-label={itemTitle(previewItem, t)}>
					<div className="pd-conv-rail-preview-title">{itemTitle(previewItem, t)}</div>
					{previewItem.preview ? <div className="pd-conv-rail-preview-body">{previewItem.preview}</div> : null}
				</div>,
				document.body,
			)}
		</nav>
	);
});

function itemTitle(item: RailItem, t: (key: string, params?: Record<string, string>) => string): string {
	return item.text ? item.text.split(/\r?\n/)[0]! : t('rail.noContent');
}
