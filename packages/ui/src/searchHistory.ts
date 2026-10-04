/**
 * Recent search terms for the global search dialog (zcode-style command-center
 * search history). Terms stay local to this device and cap at a small fixed
 * number so the empty-query view stays scannable.
 */

export const MAX_SEARCH_HISTORY = 8;
const KEY = 'pi-desktop.search-history.v1';
type HistoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): HistoryStorage | undefined {
	try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

/** Parse with validation; anything malformed falls back to an empty history. */
export function readSearchHistory(target = storage()): string[] {
	try {
		const value: unknown = JSON.parse(target?.getItem(KEY) ?? '[]');
		if (!Array.isArray(value)) return [];
		const seen = new Set<string>();
		const entries: string[] = [];
		for (const entry of value) {
			if (typeof entry !== 'string') continue;
			const term = entry.trim().slice(0, 200);
			if (!term || seen.has(term)) continue;
			seen.add(term);
			entries.push(term);
			if (entries.length >= MAX_SEARCH_HISTORY) break;
		}
		return entries;
	} catch { return []; }
}

/** Move-to-front on reuse; only real searches (non-empty, changed) get recorded. */
export function appendSearchHistory(entries: readonly string[], term: string): string[] {
	const value = term.trim().slice(0, 200);
	if (!value) return [...entries];
	const remaining = entries.filter(entry => entry !== value);
	return [value, ...remaining].slice(0, MAX_SEARCH_HISTORY);
}

export function saveSearchTerm(term: string, target = storage()): string[] {
	const next = appendSearchHistory(readSearchHistory(target), term);
	try { target?.setItem(KEY, JSON.stringify(next)); } catch { /* history is best-effort */ }
	return next;
}

export function clearSearchHistory(target = storage()): void {
	try { target?.removeItem(KEY); } catch { /* nothing to clean up */ }
}

export function removeSearchTerm(term: string, target = storage()): string[] {
	const next = readSearchHistory(target).filter(entry => entry !== term.trim());
	try { target?.setItem(KEY, JSON.stringify(next)); } catch { /* history is best-effort */ }
	return next;
}
