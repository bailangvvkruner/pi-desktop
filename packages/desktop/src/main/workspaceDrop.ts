import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

function workspaceKey(path: string): string {
	return process.platform === 'win32' ? path.toLowerCase() : path;
}

/** Validate the whole drop before the caller persists any projects. */
export async function prepareWorkspaceDrop(value: unknown, registered: string[]): Promise<{
	workspaces: string[];
	accepted: string[];
	added: string[];
}> {
	if (!Array.isArray(value) || value.length > 256 || value.some((path) =>
		typeof path !== 'string' || !path || path.length > 32768 || path.includes('\0') || !isAbsolute(path))) {
		throw new Error('拖入的项目路径无效');
	}
	const directories: string[] = [];
	const seen = new Set<string>();
	for (const path of value as string[]) {
		let canonical: string;
		try {
			canonical = await realpath(path);
			if (!(await stat(canonical)).isDirectory()) continue;
		} catch (error) {
			throw new Error(`无法读取拖入的文件夹：${path}`, { cause: error });
		}
		const key = workspaceKey(canonical);
		if (!seen.has(key)) { seen.add(key); directories.push(canonical); }
	}

	const workspaces = [...new Set(registered)];
	const accepted: string[] = [];
	const added: string[] = [];
	if (directories.length === 0) return { workspaces, accepted, added };
	const existing = new Map<string, string>();
	const canonicalWorkspaces = await Promise.all(workspaces.map(async (path) => {
		// Removed saved projects must not prevent a different folder from being added.
		return realpath(path).catch(() => resolve(path));
	}));
	workspaces.forEach((path, index) => {
		const key = workspaceKey(canonicalWorkspaces[index]!);
		if (!existing.has(key)) existing.set(key, path);
	});
	for (const path of directories) {
		const key = workspaceKey(path);
		const known = existing.get(key);
		if (known !== undefined) { accepted.push(known); continue; }
		existing.set(key, path);
		workspaces.push(path);
		accepted.push(path);
		added.push(path);
	}
	return { workspaces, accepted, added };
}
