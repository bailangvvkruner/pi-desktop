/**
 * File-type descriptor system (zcode-style `fileDisplay`): every file name maps
 * to a short type label plus a color category so file trees, search results and
 * change lists share one visual language. Pure data — safe for tests.
 */

export type FileDisplayKind =
	| 'code'
	| 'markup'
	| 'style'
	| 'data'
	| 'config'
	| 'doc'
	| 'image'
	| 'office-doc'
	| 'office-sheet'
	| 'office-slides'
	| 'pdf'
	| 'archive'
	| 'audio'
	| 'video'
	| 'shell'
	| 'text'
	| 'other';

export interface FileDisplayDescriptor {
	/** Short badge label, already uppercase, at most 4 characters. */
	label: string;
	kind: FileDisplayKind;
}

/** Extension → explicit label override. Missing entries fall back to the raw extension. */
const EXTENSION_LABELS: Record<string, string> = {
	js: 'JS', mjs: 'JS', cjs: 'JS', jsx: 'JSX',
	ts: 'TS', tsx: 'TSX', mts: 'TS', cts: 'TS',
	py: 'PY', pyi: 'PY', rb: 'RB', php: 'PHP',
	rs: 'RS', go: 'GO', java: 'JV', kt: 'KT',
	swift: 'SW', dart: 'DA', scala: 'SC', lua: 'LUA',
	c: 'C', h: 'H', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'H++', hh: 'H++',
	cs: 'C#', fs: 'FS', m: 'M', mm: 'M++',
	json: '{}', jsonc: '{}', geojson: 'GEO',
	html: '<>', htm: '<>', xml: 'XML', svg: 'SVG',
	css: 'CSS', scss: 'SCS', sass: 'SAS', less: 'LES',
	vue: 'VUE', svelte: 'SVE', astro: 'AST',
	md: 'MD', mdx: 'MD', markdown: 'MD', rst: 'RST', adoc: 'ADC', tex: 'TEX',
	yml: 'YML', yaml: 'YML', toml: 'TML', ini: 'INI', env: 'ENV', properties: 'PRP',
	sh: 'SH', bash: 'SH', zsh: 'SH', fish: 'SH',
	ps1: 'PS1', psm1: 'PS1', bat: 'BAT', cmd: 'CMD',
	png: 'IMG', jpg: 'IMG', jpeg: 'IMG', gif: 'IMG', webp: 'IMG', bmp: 'IMG', ico: 'ICO', avif: 'IMG', tif: 'IMG', tiff: 'IMG',
	pdf: 'PDF',
	doc: 'DOC', docx: 'DOC', odt: 'DOC', rtf: 'DOC',
	xls: 'XLS', xlsx: 'XLS', csv: 'CSV', tsv: 'TSV', ods: 'XLS',
	ppt: 'PPT', pptx: 'PPT', odp: 'PPT',
	zip: 'ZIP', '7z': '7Z', rar: 'RAR', tar: 'TAR', gz: 'GZ', bz2: 'BZ2', xz: 'XZ',
	mp3: 'AUD', wav: 'AUD', flac: 'AUD', ogg: 'AUD', m4a: 'AUD',
	mp4: 'VID', mov: 'VID', avi: 'VID', mkv: 'VID', webm: 'VID',
	txt: 'TXT', log: 'LOG', sql: 'SQL', graphql: 'GQL', proto: 'PBT', wasm: 'WASM', lock: 'LCK',
};

const EXTENSION_KINDS: Record<string, FileDisplayKind> = {};
for (const extension of ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'py', 'pyi', 'rb', 'php', 'rs', 'go', 'java', 'kt', 'swift', 'dart', 'scala', 'lua', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'cs', 'fs', 'm', 'mm', 'wasm']) EXTENSION_KINDS[extension] = 'code';
for (const extension of ['html', 'htm', 'xml']) EXTENSION_KINDS[extension] = 'markup';
for (const extension of ['css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro']) EXTENSION_KINDS[extension] = 'style';
for (const extension of ['json', 'jsonc', 'geojson', 'sql', 'graphql', 'proto']) EXTENSION_KINDS[extension] = 'data';
for (const extension of ['yml', 'yaml', 'toml', 'ini', 'env', 'properties', 'lock']) EXTENSION_KINDS[extension] = 'config';
for (const extension of ['md', 'mdx', 'markdown', 'rst', 'adoc', 'tex', 'txt', 'log']) EXTENSION_KINDS[extension] = 'doc';
for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tif', 'tiff', 'svg']) EXTENSION_KINDS[extension] = 'image';
for (const extension of ['doc', 'docx', 'odt', 'rtf']) EXTENSION_KINDS[extension] = 'office-doc';
for (const extension of ['xls', 'xlsx', 'csv', 'tsv', 'ods']) EXTENSION_KINDS[extension] = 'office-sheet';
for (const extension of ['ppt', 'pptx', 'odp']) EXTENSION_KINDS[extension] = 'office-slides';
EXTENSION_KINDS['pdf'] = 'pdf';
for (const extension of ['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz']) EXTENSION_KINDS[extension] = 'archive';
for (const extension of ['mp3', 'wav', 'flac', 'ogg', 'm4a']) EXTENSION_KINDS[extension] = 'audio';
for (const extension of ['mp4', 'mov', 'avi', 'mkv', 'webm']) EXTENSION_KINDS[extension] = 'video';
for (const extension of ['sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd']) EXTENSION_KINDS[extension] = 'shell';

export function extensionOf(name: string): string {
	const leaf = name.split(/[\\/]/).at(-1) ?? name;
	const dot = leaf.lastIndexOf('.');
	// No suffix, a leading dot only (.gitignore), or a trailing dot: no extension.
	if (dot <= 0 || dot === leaf.length - 1) return '';
	return leaf.slice(dot + 1).toLowerCase();
}

/** True for dotfiles like `.gitignore` — rendered with a dot badge instead of a type. */
export function isDotfileName(name: string): boolean {
	const leaf = name.split(/[\\/]/).at(-1) ?? name;
	return leaf.length > 1 && leaf.startsWith('.') && !leaf.slice(1).includes('.');
}

export function resolveFileDisplay(name: string): FileDisplayDescriptor {
	const extension = extensionOf(name);
	if (!extension) {
		if (isDotfileName(name)) return { label: '•', kind: 'config' };
		return { label: '•', kind: 'other' };
	}
	const label = EXTENSION_LABELS[extension] ?? extension.slice(0, 4).toUpperCase();
	return { label, kind: EXTENSION_KINDS[extension] ?? 'other' };
}
