import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { useT } from '../i18n';
import { ContentPreviewDialog } from './ContentPreviewDialog';

const MIN_SCALE = 0.2;
const MAX_SCALE = 6;
const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

/**
 * Full-window diagram view with zoom, fit and drag-to-pan (ZCode
 * diagram-preview-dialog). The SVG markup is the already sanitized Mermaid
 * output rendered inline in the conversation.
 */
export function DiagramPreviewDialog({ svg, title, onClose }: { svg: string; title: string; onClose(): void }) {
	const { t } = useT();
	const viewport = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
	const drag = useRef<{ pointer: number; x: number; y: number; originX: number; originY: number } | null>(null);

	/** Natural diagram size from its viewBox; Mermaid's width="100%" collapses inside the unsized pan layer. */
	const naturalSize = (graphic: SVGSVGElement) => {
		const box = graphic.viewBox?.baseVal;
		return { width: box?.width || Number.parseFloat(graphic.getAttribute('width') ?? '') || 800, height: box?.height || Number.parseFloat(graphic.getAttribute('height') ?? '') || 600 };
	};
	const fit = () => {
		const frame = viewport.current?.getBoundingClientRect();
		const graphic = content.current?.querySelector('svg');
		if (!frame || !graphic) return;
		const { width, height } = naturalSize(graphic);
		graphic.style.width = `${width}px`;
		graphic.style.height = `${height}px`;
		graphic.style.maxWidth = 'none';
		// Small diagrams are not blown up past 200% just to fill the window.
		const scale = clampScale(Math.min(2, (frame.width - 48) / width, (frame.height - 48) / height));
		setView({ scale, x: (frame.width - width * scale) / 2, y: (frame.height - height * scale) / 2 });
	};
	// The dialog opens (showModal) after this child mounts, so fit once it has a size and
	// keep fitting on resize until the reader zooms or pans.
	const interacted = useRef(false);
	useEffect(() => {
		interacted.current = false;
		const frame = requestAnimationFrame(() => { if (!interacted.current) fit(); });
		const observer = new ResizeObserver(() => { if (!interacted.current) fit(); });
		if (viewport.current) observer.observe(viewport.current);
		return () => { cancelAnimationFrame(frame); observer.disconnect(); };
	}, [svg]);

	/** Zoom around a viewport point so the content under it stays put. */
	const zoomAt = (factor: number, pointX?: number, pointY?: number) => setView((current) => {
		interacted.current = true;
		const frame = viewport.current?.getBoundingClientRect();
		const cx = pointX ?? (frame ? frame.width / 2 : 0), cy = pointY ?? (frame ? frame.height / 2 : 0);
		const scale = clampScale(current.scale * factor);
		const ratio = scale / current.scale;
		return { scale, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio };
	});
	const onWheel = (event: WheelEvent<HTMLDivElement>) => {
		const frame = viewport.current?.getBoundingClientRect();
		if (!frame) return;
		zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - frame.left, event.clientY - frame.top);
	};
	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		interacted.current = true;
		drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, originX: view.x, originY: view.y };
	};
	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const state = drag.current;
		if (!state || state.pointer !== event.pointerId) return;
		setView((current) => ({ ...current, x: state.originX + event.clientX - state.x, y: state.originY + event.clientY - state.y }));
	};
	const endDrag = () => { drag.current = null; };

	return <ContentPreviewDialog title={title} onClose={onClose} bodyClassName="pd-diagram-preview-body"
		onKeyDown={(event) => {
			if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(1.25); }
			else if (event.key === '-') { event.preventDefault(); zoomAt(0.8); }
			else if (event.key === '0') { event.preventDefault(); fit(); }
		}}
		toolbar={<>
			<button type="button" onClick={() => zoomAt(0.8)} aria-label={t('chat.diagram.zoomOut')}>−</button>
			<output>{Math.round(view.scale * 100)}%</output>
			<button type="button" onClick={() => zoomAt(1.25)} aria-label={t('chat.diagram.zoomIn')}>+</button>
			<button type="button" onClick={() => { interacted.current = false; fit(); }}>{t('chat.diagram.fit')}</button>
			<span className="pd-diagram-preview-hint">{t('chat.diagram.panHint')}</span>
		</>}>
		<div ref={viewport} className="pd-diagram-preview-viewport" onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
			<div ref={content} className="pd-diagram-preview-content" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} dangerouslySetInnerHTML={{ __html: svg }} />
		</div>
	</ContentPreviewDialog>;
}
