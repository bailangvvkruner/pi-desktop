/**
 * Code selections → chat (ZCode codeCommentContext): a file preview or diff
 * quotes whole lines with their location, so the agent receives
 * `path:start-end` plus the exact code instead of a bare snippet.
 */

export const CODE_QUOTE_EVENT = 'pd:quote-code';

export interface CodeQuote {
	cwd: string;
	path: string;
	/** 1-based, inclusive; omitted when the lines have no number (diff headers). */
	startLine?: number;
	endLine?: number;
	text: string;
	diff?: boolean;
}

export function isCodeQuote(value: unknown): value is CodeQuote {
	if (!value || typeof value !== 'object') return false;
	const quote = value as Partial<CodeQuote>;
	const line = (item: unknown) => item === undefined || (typeof item === 'number' && Number.isSafeInteger(item) && item > 0);
	return typeof quote.cwd === 'string' && typeof quote.path === 'string' && quote.path.length > 0 && quote.path.length <= 4096
		&& typeof quote.text === 'string' && quote.text.trim().length > 0 && quote.text.length <= 200_000
		&& line(quote.startLine) && line(quote.endLine);
}

export function requestCodeQuote(quote: CodeQuote): void {
	window.dispatchEvent(new CustomEvent<CodeQuote>(CODE_QUOTE_EVENT, { detail: quote }));
}

/** `src/a.ts:12-18`, `src/a.ts:12`, or the bare path. */
export function codeQuoteLocation(quote: Pick<CodeQuote, 'path' | 'startLine' | 'endLine'>): string {
	if (!quote.startLine) return quote.path;
	return quote.endLine && quote.endLine !== quote.startLine ? `${quote.path}:${quote.startLine}-${quote.endLine}` : `${quote.path}:${quote.startLine}`;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
	ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js', json: 'json', py: 'python', rs: 'rust', go: 'go',
	java: 'java', kt: 'kotlin', cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', rb: 'ruby', php: 'php', swift: 'swift',
	css: 'css', scss: 'scss', html: 'html', htm: 'html', vue: 'vue', svelte: 'svelte', md: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'toml',
	sh: 'bash', ps1: 'powershell', sql: 'sql', xml: 'xml',
};

/** A fenced block that cannot be closed early by backticks inside the code. */
export function formatCodeQuote(quote: CodeQuote): { block: string; source: string } {
	const source = codeQuoteLocation(quote);
	const extension = /\.([A-Za-z0-9]+)$/.exec(quote.path)?.[1]?.toLowerCase() ?? '';
	const language = quote.diff ? 'diff' : LANGUAGE_BY_EXTENSION[extension] ?? '';
	const longestRun = Math.max(2, ...[...quote.text.matchAll(/`+/g)].map((match) => match[0].length));
	const fence = '`'.repeat(longestRun + 1);
	const body = quote.text.replace(/\n+$/, '');
	return { source, block: `[${source}]\n${fence}${language}\n${body}\n${fence}\n` };
}

/** Appends the block after the current draft, separated by a blank line. */
export function appendCodeQuote(draft: string, quote: CodeQuote): { text: string; block: string; source: string } {
	const { block, source } = formatCodeQuote(quote);
	return { text: `${draft}${draft && !draft.endsWith('\n') ? '\n\n' : draft ? '\n' : ''}${block}`, block, source };
}
