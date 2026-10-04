import { useEffect, useSyncExternalStore, useState } from 'react';
import type mermaidApi from 'mermaid';
import { decideMermaidAutoRender, type MermaidAutoRenderSkipReason } from '../mermaidBudget';
import { useT } from '../i18n';
import { DiagramPreviewDialog } from './DiagramPreviewDialog';
import { Icon } from './Icons';

/** One shared lazy import: the mermaid bundle never loads until a diagram appears. */
let mermaidPromise: Promise<typeof mermaidApi> | null = null;
function loadMermaid(): Promise<typeof mermaidApi> {
	mermaidPromise ??= import('mermaid').then(module => module.default);
	return mermaidPromise;
}

let renderSerial = 0;

const themeListeners = new Set<() => void>();
let observedTheme: string | null = null;
function subscribeTheme(listener: () => void): () => void {
	themeListeners.add(listener);
	if (typeof document !== 'undefined' && themeListeners.size === 1) {
		// The app flips document.documentElement.dataset.theme between 'light' and 'dark'.
		themeObserver = new MutationObserver(() => {
			const next = document.documentElement.dataset.theme ?? '';
			if (next !== observedTheme) { observedTheme = next; for (const notify of themeListeners) notify(); }
		});
		themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		observedTheme = document.documentElement.dataset.theme ?? '';
	}
	return () => {
		themeListeners.delete(listener);
		if (!themeListeners.size && themeObserver) { themeObserver.disconnect(); themeObserver = null; }
	};
}
let themeObserver: MutationObserver | null = null;
function currentTheme(): string { return (typeof document !== 'undefined' ? document.documentElement.dataset.theme : '') ?? ''; }
function useDocumentTheme(): string {
	return useSyncExternalStore(subscribeTheme, currentTheme, () => '');
}

const visibilityListeners = new Set<() => void>();
function subscribeVisibility(listener: () => void): () => void {
	visibilityListeners.add(listener);
	if (typeof document !== 'undefined' && visibilityListeners.size === 1) {
		document.addEventListener('visibilitychange', onVisibilityChange);
	}
	return () => {
		visibilityListeners.delete(listener);
		if (!visibilityListeners.size && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
	};
}
function onVisibilityChange(): void { for (const notify of visibilityListeners) notify(); }
function currentVisibility(): boolean { return typeof document === 'undefined' || document.visibilityState === 'visible'; }
function useDocumentVisible(): boolean {
	return useSyncExternalStore(subscribeVisibility, currentVisibility, () => true);
}

/**
 * Renders a mermaid diagram with the zcode budget: hidden documents defer,
 * oversized sources stay as text, and every failure falls back to the source.
 */
export function MermaidDiagram({ source }: { source: string }) {
	const { t } = useT();
	const theme = useDocumentTheme();
	const visible = useDocumentVisible();
	const [svg, setSvg] = useState<string | null>(null);
	const [preview, setPreview] = useState(false);
	const [skipped, setSkipped] = useState<MermaidAutoRenderSkipReason | 'render-failed' | null>(null);

	useEffect(() => {
		const decision = decideMermaidAutoRender(source, { documentVisible: visible });
		if (!decision.shouldRender) { setSkipped(decision.reason); setSvg(null); return; }
		let cancelled = false;
		// A streaming reply changes the source on every chunk; wait for it to settle
		// so partial (usually unparsable) sources never trigger a full render.
		const timer = setTimeout(() => {
			const id = `pd-mermaid-${++renderSerial}`;
			void loadMermaid().then(async mermaid => {
				if (cancelled) return;
				mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'default' });
				const { svg } = await mermaid.render(id, source);
				if (!cancelled) { setSvg(svg); setSkipped(null); }
			}).catch(() => {
				// Parse errors and render breaks both degrade to readable source text.
				if (!cancelled) { setSkipped('render-failed'); setSvg(null); }
			});
		}, 250);
		return () => { cancelled = true; clearTimeout(timer); };
	}, [source, theme, visible]);

	if (svg) return <div className="pd-mermaid-frame">
		<div className="pd-mermaid-diagram" role="img" aria-label={t('chat.diagram.aria')} dangerouslySetInnerHTML={{ __html: svg }} />
		<button type="button" className="pd-mermaid-expand" onClick={() => setPreview(true)} aria-label={t('chat.diagram.fullscreen')} title={t('chat.diagram.fullscreen')}><Icon name="maximize" width="13" height="13" /></button>
		{preview && <DiagramPreviewDialog svg={svg} title={t('chat.diagram.aria')} onClose={() => setPreview(false)} />}
	</div>;
	const reasonKey = skipped === 'render-failed' ? 'chat.diagram.renderFailed'
		: skipped === 'source-too-large' || skipped === 'line-count-too-large' || skipped === 'complexity-too-large' ? 'chat.diagram.tooLarge'
		: skipped === 'document-hidden' ? 'chat.diagram.hidden' : null;
	return <>
		{reasonKey && <p className="pd-mermaid-notice" role="status">{t(reasonKey)}</p>}
		<pre className="pd-mermaid-source"><code>{source}</code></pre>
	</>;
}
