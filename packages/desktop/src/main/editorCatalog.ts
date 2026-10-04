import { execFile, spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { win32 as pathWin32, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Installed editors and terminals for "Open with" (ZCode desktop/main/editors.ts).
 * Detection only checks well-known install locations and PATH shims; nothing is
 * downloaded or registered. Each definition knows how to open a folder and,
 * for editors, how to jump to file:line.
 */

/** How an editor accepts "open this file at a line". */
type GotoStyle = 'vscode' | 'jetbrains' | 'colon' | 'none';

export interface EditorDefinition {
	id: string;
	name: string;
	kind: 'editor' | 'terminal';
	goto: GotoStyle;
	/** Windows: executable candidates relative to well-known roots, and PATH command names. */
	windows?: { local?: string[][]; programFiles?: string[][]; jetbrains?: { prefix: string; exe: string }; path?: string; pathApp?: string; absolute?: string[] };
	/** macOS: application bundle names searched in /Applications and ~/Applications. */
	mac?: { apps: string[] };
	/** Linux: command on PATH. */
	linux?: { command: string };
}

const VSCODE_FAMILY = (id: string, name: string, folder: string, exe: string, command: string, macApp: string): EditorDefinition => ({
	id, name, kind: 'editor', goto: 'vscode',
	windows: { local: [[folder, exe]], programFiles: [[folder, exe]], path: command, pathApp: exe },
	mac: { apps: [macApp] }, linux: { command },
});

const JETBRAINS = (id: string, name: string, prefix: string, exe: string, macApp: string, command: string): EditorDefinition => ({
	id, name, kind: 'editor', goto: 'jetbrains',
	windows: { jetbrains: { prefix, exe } }, mac: { apps: [macApp] }, linux: { command },
});

export const EDITOR_DEFINITIONS: EditorDefinition[] = [
	VSCODE_FAMILY('vscode', 'VS Code', 'Microsoft VS Code', 'Code.exe', 'code', 'Visual Studio Code.app'),
	VSCODE_FAMILY('vscode-insiders', 'VS Code Insiders', 'Microsoft VS Code Insiders', 'Code - Insiders.exe', 'code-insiders', 'Visual Studio Code - Insiders.app'),
	VSCODE_FAMILY('cursor', 'Cursor', 'cursor', 'Cursor.exe', 'cursor', 'Cursor.app'),
	VSCODE_FAMILY('windsurf', 'Windsurf', 'Windsurf', 'Windsurf.exe', 'windsurf', 'Windsurf.app'),
	VSCODE_FAMILY('vscodium', 'VSCodium', 'VSCodium', 'VSCodium.exe', 'codium', 'VSCodium.app'),
	{ id: 'trae', name: 'Trae', kind: 'editor', goto: 'vscode', windows: { local: [['Trae', 'Trae.exe'], ['Trae CN', 'Trae CN.exe'], ['Trae CN', 'Trae.exe']], programFiles: [['Trae', 'Trae.exe']] }, mac: { apps: ['Trae.app', 'Trae CN.app'] } },
	{ id: 'zed', name: 'Zed', kind: 'editor', goto: 'colon', windows: { local: [['Zed', 'Zed.exe']], path: 'zed', pathApp: 'Zed.exe' }, mac: { apps: ['Zed.app'] }, linux: { command: 'zed' } },
	{ id: 'sublime', name: 'Sublime Text', kind: 'editor', goto: 'colon', windows: { programFiles: [['Sublime Text', 'sublime_text.exe'], ['Sublime Text 3', 'sublime_text.exe']], path: 'subl', pathApp: 'sublime_text.exe' }, mac: { apps: ['Sublime Text.app'] }, linux: { command: 'subl' } },
	JETBRAINS('idea', 'IntelliJ IDEA', 'IntelliJ IDEA', 'idea64.exe', 'IntelliJ IDEA.app', 'idea'),
	JETBRAINS('webstorm', 'WebStorm', 'WebStorm', 'webstorm64.exe', 'WebStorm.app', 'webstorm'),
	JETBRAINS('pycharm', 'PyCharm', 'PyCharm', 'pycharm64.exe', 'PyCharm.app', 'pycharm'),
	JETBRAINS('goland', 'GoLand', 'GoLand', 'goland64.exe', 'GoLand.app', 'goland'),
	JETBRAINS('clion', 'CLion', 'CLion', 'clion64.exe', 'CLion.app', 'clion'),
	JETBRAINS('rider', 'Rider', 'JetBrains Rider', 'rider64.exe', 'Rider.app', 'rider'),
	{ id: 'windows-terminal', name: 'Windows Terminal', kind: 'terminal', goto: 'none', windows: { absolute: [pathWin32.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'wt.exe')] } },
	{ id: 'terminal', name: 'Terminal', kind: 'terminal', goto: 'none', mac: { apps: ['Terminal.app'] } },
	{ id: 'iterm', name: 'iTerm', kind: 'terminal', goto: 'none', mac: { apps: ['iTerm.app'] } },
];

export interface DetectedEditor {
	definition: EditorDefinition;
	/** Windows .exe / macOS .app / Linux command to launch. */
	target: string;
	/** Executable whose icon the picker shows (Windows/macOS). */
	iconPath?: string;
}

async function isFile(path: string): Promise<boolean> {
	try { return (await stat(path)).isFile(); } catch { return false; }
}
async function isDirectory(path: string): Promise<boolean> {
	try { return (await stat(path)).isDirectory(); } catch { return false; }
}

function windowsRoots() {
	const drive = process.env.SystemDrive || 'C:';
	const programFiles = [...new Set([process.env.ProgramFiles, process.env['ProgramFiles(x86)'], `${drive}\\Program Files`, `${drive}\\Program Files (x86)`].filter((value): value is string => Boolean(value)))];
	const local = pathWin32.join(process.env.LOCALAPPDATA || `${drive}\\Users\\Default\\AppData\\Local`, 'Programs');
	return { programFiles, local };
}

/** `where code` → bin\code.cmd; the real exe sits next to it or one level up. */
async function windowsExeFromPath(command: string, exe: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync('where.exe', [command], { timeout: 2000, windowsHide: true });
		for (const shim of stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
			const directory = pathWin32.dirname(shim);
			for (const candidate of [pathWin32.join(directory, exe), pathWin32.join(pathWin32.dirname(directory), exe)]) if (await isFile(candidate)) return candidate;
		}
	} catch { /* not on PATH */ }
	return null;
}

async function jetbrainsCandidates(prefix: string, exe: string): Promise<string[]> {
	const { programFiles, local } = windowsRoots();
	const roots = [...programFiles.map((root) => pathWin32.join(root, 'JetBrains')), local, pathWin32.join(local, 'JetBrains')];
	const found: string[] = [];
	for (const root of roots) {
		try {
			const names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(prefix.toLowerCase())).map((entry) => entry.name).sort((a, b) => b.localeCompare(a));
			for (const name of names) found.push(pathWin32.join(root, name, 'bin', exe));
		} catch { /* optional install root */ }
	}
	return found;
}

async function detectWindows(definition: EditorDefinition): Promise<DetectedEditor | null> {
	const spec = definition.windows;
	if (!spec) return null;
	const { programFiles, local } = windowsRoots();
	const candidates = [
		...(spec.absolute ?? []),
		...(spec.local ?? []).map((segments) => pathWin32.join(local, ...segments)),
		...(spec.programFiles ?? []).flatMap((segments) => programFiles.map((root) => pathWin32.join(root, ...segments))),
		...(spec.jetbrains ? await jetbrainsCandidates(spec.jetbrains.prefix, spec.jetbrains.exe) : []),
	];
	for (const candidate of candidates) if (await isFile(candidate)) return { definition, target: candidate, iconPath: candidate };
	if (spec.path && spec.pathApp) {
		const fromPath = await windowsExeFromPath(spec.path, spec.pathApp);
		if (fromPath) return { definition, target: fromPath, iconPath: fromPath };
	}
	return null;
}

async function detectMac(definition: EditorDefinition): Promise<DetectedEditor | null> {
	for (const app of definition.mac?.apps ?? []) {
		for (const root of ['/Applications', join(homedir(), 'Applications'), '/System/Applications/Utilities', '/Applications/Utilities']) {
			const path = join(root, app);
			if (await isDirectory(path)) return { definition, target: path, iconPath: path };
		}
	}
	return null;
}

async function detectLinux(definition: EditorDefinition): Promise<DetectedEditor | null> {
	const command = definition.linux?.command;
	if (!command) return null;
	try { await execFileAsync('which', [command], { timeout: 2000 }); return { definition, target: command }; } catch { return null; }
}

/** Detects every installed editor/terminal for this platform, in catalog order. */
export async function detectEditors(platform: NodeJS.Platform = process.platform): Promise<DetectedEditor[]> {
	const detect = platform === 'win32' ? detectWindows : platform === 'darwin' ? detectMac : detectLinux;
	const results = await Promise.all(EDITOR_DEFINITIONS.map((definition) => detect(definition).catch(() => null)));
	return results.filter((item): item is DetectedEditor => item !== null);
}

/** Arguments that open `path` (a folder, or a file at an optional line/column). */
export function editorArguments(definition: EditorDefinition, path: string, line?: number, column?: number): string[] {
	if (definition.id === 'windows-terminal') return ['-d', path];
	if (!line) return [path];
	const location = `${path}:${line}${column ? `:${column}` : ''}`;
	switch (definition.goto) {
		case 'vscode': return ['-g', location];
		case 'jetbrains': return ['--line', String(line), ...(column ? ['--column', String(column)] : []), path];
		case 'colon': return [location];
		default: return [path];
	}
}

/** Launches detached so closing Pi Desktop never closes the editor. */
export async function launchEditor(editor: DetectedEditor, path: string, line?: number, column?: number, platform: NodeJS.Platform = process.platform): Promise<void> {
	const args = editorArguments(editor.definition, path, line, column);
	// macOS bundles open through LaunchServices; line jumps need the app's own CLI, so they open the file.
	const [file, argv] = platform === 'darwin' ? ['open', ['-a', editor.target, path]] as const : [editor.target, args] as const;
	await new Promise<void>((resolve, reject) => {
		// windowsHide stays off: Electron editors honor the hidden start state.
		const child = spawn(file, [...argv], { detached: true, stdio: 'ignore' });
		child.once('error', reject);
		child.once('spawn', () => { child.unref(); resolve(); });
	});
}
