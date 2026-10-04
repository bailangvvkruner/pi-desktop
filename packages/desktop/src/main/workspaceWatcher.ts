import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { WorkspaceChangeEvent } from '@pidesktop/shared';

/**
 * Workspace change signal for the workbench (ZCode gitAutoRefresh): one
 * debounced event tells the renderer to re-read the file tree and/or Git
 * status. No file contents or paths cross IPC; the renderer re-reads through
 * the existing bounded services.
 *
 * Windows and macOS watch the tree recursively with native APIs. Linux
 * recursive watching walks every directory (node_modules), so it watches only
 * the workspace root and its .git directory, like ZCode.
 */

const DEBOUNCE_MS = 400;
// Dependency and build folders churn during installs/builds without changing what
// the tree pane shows at the top level; Git internals other than refs/index/HEAD
// change on every object write.
const IGNORED_SEGMENTS = new Set(['node_modules', '.pnpm-store', '.next', '.turbo', '.cache', '__pycache__', '.venv', 'target']);

/** Classifies a watcher filename (relative, either separator) as file-tree and/or Git relevant. */
export function classifyWorkspaceChange(filename: string | null): { files: boolean; git: boolean } | null {
	// Some platforms omit the filename; treat it as a change to everything.
	if (!filename) return { files: true, git: true };
	const segments = filename.split(/[\\/]+/).filter(Boolean);
	if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) return null;
	if (segments[0] === '.git') {
		const inner = segments.slice(1).join('/');
		if (!inner) return { files: false, git: true };
		if (inner === 'HEAD' || inner === 'index' || inner === 'MERGE_HEAD' || inner === 'packed-refs' || inner.startsWith('refs/')) return { files: false, git: true };
		return null;
	}
	// Working-tree edits change both the tree and the Git status.
	return { files: true, git: true };
}

export function createWorkspaceWatcher(emit: (event: WorkspaceChangeEvent) => void, platform: NodeJS.Platform = process.platform) {
	let watchers: FSWatcher[] = [];
	let cwd: string | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending = { files: false, git: false };

	const flush = (): void => {
		timer = null;
		if (!cwd || (!pending.files && !pending.git)) return;
		emit({ cwd, files: pending.files, git: pending.git });
		pending = { files: false, git: false };
	};
	const record = (prefix: string, filename: string | Buffer | null): void => {
		const name = filename === null ? null : prefix + String(filename);
		const change = classifyWorkspaceChange(name);
		if (!change) return;
		pending = { files: pending.files || change.files, git: pending.git || change.git };
		timer ??= setTimeout(flush, DEBOUNCE_MS);
	};
	const open = (path: string, prefix: string, recursive: boolean): void => {
		try {
			const watcher = watch(path, { recursive, persistent: false }, (_event, filename) => record(prefix, filename));
			// A deleted or inaccessible directory ends its watcher; refresh still works manually.
			watcher.on('error', () => { watcher.close(); watchers = watchers.filter((item) => item !== watcher); });
			watchers.push(watcher);
		} catch { /* .git may not exist; the root may be unreadable */ }
	};

	return {
		/** Watches `next` (or stops with null). Calling again with the same path is a no-op. */
		watch(next: string | null): void {
			if (next === cwd) return;
			this.stop();
			cwd = next;
			if (!next) return;
			const recursive = platform !== 'linux';
			open(next, '', recursive);
			if (!recursive) open(join(next, '.git'), '.git/', false);
		},
		stop(): void {
			for (const watcher of watchers) watcher.close();
			watchers = [];
			if (timer) clearTimeout(timer);
			timer = null;
			pending = { files: false, git: false };
			cwd = null;
		},
	};
}
