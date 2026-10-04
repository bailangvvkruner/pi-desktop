/**
 * Restores backslashes CommonMark consumed inside Windows paths (ZCode
 * windowsFileLinkEscapeRemarkPlugin).
 *
 * In Markdown `\X` is an escape whenever X is ASCII punctuation, so
 * `E:\proj\.github\ci.yml` parses as `E:\proj.github\ci.yml` and
 * `C:\work\_draft` as `C:\work_draft`: the loss happens at parse time, so later
 * link handling can no longer recover it. This plugin re-reads the original
 * source slice of each affected node and only rewrites when unescaping that
 * slice reproduces the parsed value exactly; ambiguous cases stay unchanged.
 */

interface MarkdownPoint { offset?: number }
interface MarkdownNode {
	type: string;
	url?: string;
	title?: string | null;
	value?: string;
	children?: MarkdownNode[];
	position?: { start?: MarkdownPoint; end?: MarkdownPoint };
}

/** Drive-letter absolute paths and single-backslash UNC remnants. */
const WINDOWS_DESTINATION = /^(?:[a-zA-Z]:[\\/]|\\)/u;
/** Drive paths inside prose, up to whitespace or characters that end a path in text. */
const WINDOWS_PATH_IN_TEXT = /[a-zA-Z]:\\[^\s<>"'`|*?]*/gu;
// CommonMark: `\X` yields X only for ASCII punctuation (!-/ :-@ [-` {-~).
const PUNCTUATION_ESCAPE = /\\([!-/:-@[-`{-~])/gu;

export function unescapeCommonMarkPunctuation(raw: string): string {
	return raw.replace(PUNCTUATION_ESCAPE, '$1');
}

function sourceSlice(node: MarkdownNode, source: string): string | null {
	const start = node.position?.start?.offset;
	const end = node.position?.end?.offset;
	return typeof start === 'number' && typeof end === 'number' && end > start ? source.slice(start, end) : null;
}

function rawDestination(node: MarkdownNode, slice: string): string | null {
	if (node.type === 'definition') {
		const marker = slice.indexOf(']:');
		return marker < 0 ? null : slice.slice(marker + 2).trim();
	}
	if (!slice.endsWith(')')) return null;
	// Windows paths never contain "](", so the last separator is the destination start.
	const marker = slice.lastIndexOf('](');
	return marker < 0 ? null : slice.slice(marker + 2, -1).trim();
}

function recoverDestination(node: MarkdownNode, source: string): string | null {
	const url = node.url;
	if (typeof url !== 'string' || !WINDOWS_DESTINATION.test(url)) return null;
	// Titles and <angle> destinations use other syntax; never guess their bounds.
	if (node.title !== null && node.title !== undefined) return null;
	const slice = sourceSlice(node, source);
	const raw = slice === null ? null : rawDestination(node, slice);
	if (!raw || raw.startsWith('<') || raw === url) return null;
	return unescapeCommonMarkPunctuation(raw) === url ? raw : null;
}

/** Prose keeps its other escapes; only the Windows path tokens get their backslashes back. */
function recoverText(node: MarkdownNode, source: string): string | null {
	const value = node.value;
	if (typeof value !== 'string' || !/[a-zA-Z]:/u.test(value)) return null;
	const raw = sourceSlice(node, source);
	if (!raw || raw === value || !/[a-zA-Z]:\\/u.test(raw) || unescapeCommonMarkPunctuation(raw) !== value) return null;
	let result = '', last = 0;
	for (const match of raw.matchAll(WINDOWS_PATH_IN_TEXT)) {
		result += unescapeCommonMarkPunctuation(raw.slice(last, match.index)) + match[0];
		last = match.index + match[0].length;
	}
	result += unescapeCommonMarkPunctuation(raw.slice(last));
	return result === value ? null : result;
}

export function remarkWindowsPathEscapes() {
	return (tree: unknown, file: unknown) => {
		const source = String(file ?? '');
		if (!source.includes('\\')) return;
		const visit = (node: MarkdownNode): void => {
			if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
				const raw = recoverDestination(node, source);
				if (raw !== null) node.url = raw;
			} else if (node.type === 'text') {
				const value = recoverText(node, source);
				if (value !== null) node.value = value;
			}
			node.children?.forEach(visit);
		};
		visit(tree as MarkdownNode);
	};
}
