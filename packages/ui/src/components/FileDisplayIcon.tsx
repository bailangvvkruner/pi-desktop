import { resolveFileDisplay } from '../fileDisplay';

/**
 * Colored file-type badge (zcode-style descriptor icon). Directories keep the
 * folder glyph; every file gets a compact label tinted by its category.
 */
export function FileDisplayIcon({ name, size = 15 }: { name: string; size?: number }) {
	const descriptor = resolveFileDisplay(name);
	return (
		<span
			className={`pd-file-badge is-${descriptor.kind}`}
			data-file-kind={descriptor.kind}
			aria-hidden="true"
			style={{ width: size, height: size, fontSize: Math.max(6, Math.round(size * 0.46)) }}
		>
			{descriptor.label}
		</span>
	);
}
