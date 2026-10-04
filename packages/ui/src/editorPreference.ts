/**
 * The app chosen in the workspace "Open with" picker (ZCode editorPreference).
 * File:line jumps reuse it when it is an editor; the backend falls back to VS
 * Code for the file manager, terminals or a missing app.
 */
export const OPENER_STORAGE_KEY = 'pi-desktop.opener.v1';

export function readPreferredOpener(): string | null {
	try {
		const value = window.localStorage.getItem(OPENER_STORAGE_KEY);
		return typeof value === 'string' && value ? value : null;
	} catch {
		return null;
	}
}

export function writePreferredOpener(id: string): void {
	try { window.localStorage.setItem(OPENER_STORAGE_KEY, id); } catch { /* preferences are best-effort */ }
}

/** Editor id for file:line jumps, or undefined to let the backend choose. */
export function preferredEditorId(): string | undefined {
	const id = readPreferredOpener();
	return id && id !== 'explorer' ? id : undefined;
}
