import type { UiContextRequest } from '@pidesktop/shared';

/**
 * Workspace files → composer context (ZCode workspaceFileDrag /
 * workspaceFileComposer). The file tree either dispatches an "add to chat"
 * event or carries the same request through a drag; the composer attaches it
 * through the existing readContext path, so limits and validation stay in one
 * place.
 */

export const ADD_CONTEXT_EVENT = 'pd:add-context';
export const WORKSPACE_ENTRY_DRAG_MIME = 'application/x-pi-desktop-workspace-entry';

type EntryContextRequest = UiContextRequest & { kind: 'file' | 'directory' };

export function isWorkspaceEntryContext(value: unknown): value is EntryContextRequest {
	if (!value || typeof value !== 'object') return false;
	const request = value as Partial<UiContextRequest>;
	return (request.kind === 'file' || request.kind === 'directory')
		&& typeof request.workspace === 'string' && request.workspace.length > 0 && request.workspace.length <= 32_768
		&& typeof request.path === 'string' && request.path.length > 0 && request.path.length <= 32_768
		&& !/[\u0000-\u001f\u007f]/u.test(request.workspace + request.path);
}

/** Asks the mounted composer to attach a workspace file or folder. */
export function requestAddContext(request: EntryContextRequest): void {
	window.dispatchEvent(new CustomEvent<EntryContextRequest>(ADD_CONTEXT_EVENT, { detail: request }));
}

export function writeWorkspaceEntryDrag(transfer: DataTransfer, request: EntryContextRequest): void {
	transfer.setData(WORKSPACE_ENTRY_DRAG_MIME, JSON.stringify(request));
	// Plain-text targets (other inputs, editors) still receive the relative path.
	transfer.setData('text/plain', request.path);
	transfer.effectAllowed = 'copy';
}

export function hasWorkspaceEntryDrag(transfer: DataTransfer): boolean {
	return transfer.types.includes(WORKSPACE_ENTRY_DRAG_MIME);
}

export function readWorkspaceEntryDrag(transfer: DataTransfer): EntryContextRequest | null {
	try {
		const value: unknown = JSON.parse(transfer.getData(WORKSPACE_ENTRY_DRAG_MIME));
		return isWorkspaceEntryContext(value) ? { kind: value.kind, workspace: value.workspace, path: value.path } : null;
	} catch { return null; }
}
