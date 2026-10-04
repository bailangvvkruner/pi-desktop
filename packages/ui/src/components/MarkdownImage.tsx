import { useEffect, useState, type ComponentPropsWithoutRef } from 'react';
import { useT } from '../i18n';
import { parseResultFileReference } from '../resultFileReferences';
import { useChatStore } from '../store';
import { ImagePreviewDialog } from './ImagePreviewDialog';
import { Icon } from './Icons';

type ImageProps = ComponentPropsWithoutRef<'img'> & { node?: unknown };
type LoadedImage = { mimeType: string; data: string };

const INLINE_IMAGE = /^data:(image\/(?:png|jpeg|gif|webp|bmp|avif));base64,([A-Za-z0-9+/=]+)$/i;
/** Workspace images resolve once per session view; re-renders while streaming reuse them. */
const workspaceImages = new Map<string, Promise<LoadedImage | null>>();

export function classifyMarkdownImage(src: string | undefined): 'remote' | 'inline' | 'local' | 'none' {
	if (!src) return 'none';
	if (/^https?:\/\//i.test(src)) return 'remote';
	if (INLINE_IMAGE.test(src)) return 'inline';
	return parseResultFileReference(src) ? 'local' : 'none';
}

function loadWorkspaceImage(cwd: string, path: string): Promise<LoadedImage | null> {
	const key = `${cwd}\n${path}`;
	let pending = workspaceImages.get(key);
	if (!pending) {
		const bridge = useChatStore.getState().bridge;
		pending = !bridge ? Promise.resolve(null) : bridge.previewResultFile({ cwd, path }).then((preview) => {
			const match = preview.kind === 'image' ? INLINE_IMAGE.exec(preview.dataUrl ?? '') : null;
			return match ? { mimeType: match[1]!, data: match[2]! } : null;
		}).catch(() => null);
		workspaceImages.set(key, pending);
		if (workspaceImages.size > 64) workspaceImages.delete(workspaceImages.keys().next().value!);
	}
	return pending;
}

/**
 * Markdown images (ZCode markdown-image): remote images never load inside the
 * app (the renderer CSP blocks them) and render as an external link card;
 * inline data images and workspace image files display with a click-to-zoom
 * viewer. Everything else falls back to the alt text.
 */
export function MarkdownImage({ node: _node, src, alt, title }: ImageProps) {
	const { t } = useT();
	const cwd = useChatStore((state) => state.cwd);
	const kind = classifyMarkdownImage(src);
	const label = alt?.trim() || title?.trim() || '';
	const reference = kind === 'local' && src ? parseResultFileReference(src) : null;
	const inline = kind === 'inline' && src ? INLINE_IMAGE.exec(src) : null;
	const [loaded, setLoaded] = useState<LoadedImage | null | undefined>(inline ? { mimeType: inline[1]!, data: inline[2]! } : undefined);
	const [preview, setPreview] = useState(false);
	useEffect(() => {
		if (kind !== 'local' || !reference || !cwd) return;
		let current = true;
		setLoaded(undefined);
		void loadWorkspaceImage(cwd, reference.path).then((image) => { if (current) setLoaded(image); });
		return () => { current = false; };
	}, [kind, reference?.path, cwd]);

	if (kind === 'remote' && src) {
		let host = '';
		try { host = new URL(src).host; } catch { /* malformed URLs still show the alt text */ }
		return <a className="pd-md-image-link" href={src} title={t('chat.image.externalHint')}><Icon name="image" width="14" height="14" /><span>{label || t('chat.image.external')}</span>{host && <small>{host}</small>}</a>;
	}
	if (kind === 'none') return label ? <span className="pd-md-image-alt">[{label}]</span> : null;
	if (loaded === undefined) return <span className="pd-md-image-alt" role="status">{t('chat.image.loading')}</span>;
	if (loaded === null) return <span className="pd-md-image-alt">[{label || reference?.path || t('chat.image.unavailable')}]</span>;
	const name = label || reference?.path.split(/[\\/]/).pop() || 'image';
	return <>
		<button type="button" className="pd-md-image" onClick={() => setPreview(true)} aria-label={name}><img src={`data:${loaded.mimeType};base64,${loaded.data}`} alt={label} /></button>
		{preview && <ImagePreviewDialog images={[{ id: src ?? name, name, attachment: { kind: 'image', name, mimeType: loaded.mimeType, data: loaded.data } }]} initialIndex={0} returnFocus={null} onClose={() => setPreview(false)} />}
	</>;
}
