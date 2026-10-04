import { useSyncExternalStore } from 'react';

/**
 * Line wrapping for conversation code blocks (ZCode codeBlock.wrapLines). One
 * choice applies to every block and is remembered on this device.
 */
const KEY = 'pi-desktop.code-wrap.v1';
const listeners = new Set<() => void>();

function read(): boolean {
	try { return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'; } catch { return false; }
}

let wrapped = read();

export function setCodeWrap(next: boolean): void {
	if (wrapped === next) return;
	wrapped = next;
	try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* the choice still applies to this window */ }
	for (const listener of listeners) listener();
}

export function useCodeWrap(): [boolean, (next: boolean) => void] {
	const value = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => wrapped, () => false);
	return [value, setCodeWrap];
}
