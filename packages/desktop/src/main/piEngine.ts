/**
 * Custom Pi engine support (user-managed SDK installs).
 *
 * The desktop app normally runs the bundled, lockfile-pinned
 * `@earendil-works/pi-coding-agent` SDK. Users may instead point it at a
 * complete npm install of any released SDK version. This module owns:
 *
 *   - structural validation of a candidate engine directory (probe),
 *   - locating the bundled SDK (for version comparison and status display),
 *   - installing a module-resolution redirect that re-points the bare SDK
 *     specifier at the custom engine before the agent host loads it.
 *
 * It must stay importable from the Electron main process, the agent host
 * utility process, and plain Node tests: only node: built-ins are used.
 */
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { UiPiEngineProbe, UiPiEngineSelection } from '@pidesktop/shared';

export const PI_ENGINE_PACKAGE_NAME = '@earendil-works/pi-coding-agent';

/** Runtime exports the desktop adapter layer imports from the SDK. A custom engine missing any of these fails fast. */
export const REQUIRED_SDK_EXPORTS = [
	'DefaultPackageManager',
	'ModelRuntime',
	'ProjectTrustStore',
	'SessionManager',
	'SettingsManager',
	'createAgentSessionFromServices',
	'createAgentSessionRuntime',
	'createAgentSessionServices',
	'getAgentDir',
	'hasTrustRequiringProjectResources',
	'parseFrontmatter',
	'readStoredCredential',
] as const;

/** Settings shape guard shared by desktopSettings validation and the IPC patch path. */
export function isValidPiEngineSelection(value: unknown): value is UiPiEngineSelection {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as { mode?: unknown; path?: unknown };
	if (candidate.mode === 'builtin') return true;
	if (candidate.mode === 'custom') return typeof candidate.path === 'string' && candidate.path.trim() !== '';
	return false;
}

interface EnginePackageManifest {
	name?: unknown;
	version?: unknown;
}

function readPackageManifest(dir: string): EnginePackageManifest | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
		return typeof parsed === 'object' && parsed !== null ? parsed as EnginePackageManifest : null;
	} catch {
		return null;
	}
}

function parseVersion(version: string | null | undefined): { major: number; minor: number; patch: number } | null {
	if (!version) return null;
	const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
	if (!match) return null;
	return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Accepts either the SDK package directory itself or an install root that
 * contains `node_modules/@earendil-works/pi-coding-agent`.
 */
export function resolveEnginePackageDir(inputPath: string): string | null {
	const trimmed = inputPath.trim();
	if (!trimmed) return null;
	const direct = resolve(trimmed);
	if (readPackageManifest(direct)?.name === PI_ENGINE_PACKAGE_NAME) return direct;
	const nested = join(direct, 'node_modules', '@earendil-works', 'pi-coding-agent');
	if (readPackageManifest(nested)?.name === PI_ENGINE_PACKAGE_NAME) return nested;
	return null;
}

/**
 * Structural probe of a custom engine directory. Never throws; problems
 * describe why the directory cannot drive the agent host, warnings describe
 * risks the user should acknowledge before switching.
 */
export function probePiEngine(inputPath: string, builtinVersion?: string | null): UiPiEngineProbe {
	const problems: string[] = [];
	const warnings: string[] = [];
	const trimmed = inputPath.trim();
	if (!trimmed) {
		return { ok: false, packageDir: null, version: null, problems: ['未提供引擎目录'], warnings };
	}
	const candidate = resolve(trimmed);
	const candidateManifest = readPackageManifest(candidate);
	if (candidateManifest && candidateManifest.name !== PI_ENGINE_PACKAGE_NAME && candidateManifest.name !== undefined) {
		problems.push(`目录中的包名是 ${String(candidateManifest.name)}，需要 ${PI_ENGINE_PACKAGE_NAME}`);
	}
	const packageDir = resolveEnginePackageDir(trimmed);
	if (!packageDir) {
		problems.push(`未找到 ${PI_ENGINE_PACKAGE_NAME}；请选择 npm 安装目录（包含 node_modules\\@earendil-works\\pi-coding-agent）或包目录本身`);
		return { ok: false, packageDir: null, version: null, problems, warnings };
	}
	const manifest = readPackageManifest(packageDir);
	const version = typeof manifest?.version === 'string' && manifest.version.trim() ? manifest.version.trim() : null;
	if (!version) problems.push('package.json 缺少有效版本号');
	if (!existsSync(join(packageDir, 'dist', 'index.js'))) problems.push('缺少 SDK 入口文件 dist\\index.js');
	const dependenciesInstalled = existsSync(join(packageDir, 'node_modules'))
		|| packageDir.includes(`${sep}node_modules${sep}`);
	if (!dependenciesInstalled) {
		warnings.push('未检测到 node_modules 依赖目录；请使用 npm 安装引擎（勿直接复制文件），否则运行时会缺少依赖');
	}
	if (typeof registerHooks !== 'function') {
		problems.push(`当前运行时（Node ${process.versions.node ?? 'unknown'}）不支持引擎重定向，需要 Node 22.15+`);
	}
	const custom = parseVersion(version);
	const builtin = parseVersion(builtinVersion ?? null);
	if (version && builtinVersion && custom && builtin) {
		if (custom.major !== builtin.major) warnings.push(`与内置引擎（${builtinVersion}）主版本不同，桌面适配层可能不兼容`);
		else if (custom.major === builtin.major && (custom.minor < builtin.minor || (custom.minor === builtin.minor && custom.patch < builtin.patch))) {
			warnings.push(`版本低于内置引擎（${builtinVersion}），建议使用不低于内置的版本`);
		}
	} else if (version && builtinVersion) {
		warnings.push('无法解析引擎版本号，无法与内置引擎比较');
	}
	return { ok: problems.length === 0, packageDir, version, problems, warnings };
}

let builtinEngineCache: { dir: string; version: string } | null | undefined;

/** Locates the bundled SDK install shipped with the app; null when unresolvable. */
export function readBuiltinEngineInfo(): { dir: string; version: string } | null {
	if (builtinEngineCache !== undefined) return builtinEngineCache;
	try {
		// The SDK is ESM-only (no `require` export condition), so package
		// resolution cannot be trusted here. Walk up from this module toward the
		// app root and match the first node_modules entry — the same order Node uses.
		let current = dirname(fileURLToPath(import.meta.url));
		let dir: string | null = null;
		for (;;) {
			const candidate = join(current, 'node_modules', '@earendil-works', 'pi-coding-agent');
			if (readPackageManifest(candidate)?.name === PI_ENGINE_PACKAGE_NAME) { dir = candidate; break; }
			const parent = dirname(current);
			if (parent === current) break;
			current = parent;
		}
		const manifest = dir ? readPackageManifest(dir) : null;
		builtinEngineCache = dir && typeof manifest?.version === 'string' && manifest.version ? { dir, version: manifest.version } : null;
	} catch {
		builtinEngineCache = null;
	}
	return builtinEngineCache;
}

/**
 * Installs the process-wide module redirect for the custom engine. Must run
 * before the first import of the SDK in this process (the agent host calls it
 * from its dependency-free bootstrap entry).
 */
export function installEngineRedirect(engineDir: string): { ok: true; packageDir: string; version: string | null } | { ok: false; problems: string[] } {
	const probe = probePiEngine(engineDir);
	if (!probe.ok || !probe.packageDir) return { ok: false, problems: probe.problems };
	const entryUrl = pathToFileURL(join(probe.packageDir, 'dist', 'index.js')).href;
	registerHooks({
		resolve(specifier, context, nextResolve) {
			if (specifier === PI_ENGINE_PACKAGE_NAME) return { url: entryUrl, shortCircuit: true };
			return nextResolve(specifier, context);
		},
	});
	return { ok: true, packageDir: probe.packageDir, version: probe.version };
}

/** Returns the required SDK export names missing from a loaded engine module. */
export function missingSdkExports(sdk: object): string[] {
	return REQUIRED_SDK_EXPORTS.filter((name) => !(name in sdk));
}
