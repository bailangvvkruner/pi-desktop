import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'electron') return { url: `data:text/javascript,${encodeURIComponent(`
    export const BrowserWindow = { fromWebContents: sender => globalThis.__dataWindow?.webContents === sender ? globalThis.__dataWindow : null };
    export const ipcMain = { handle: (channel, handler) => globalThis.__dataHandlers.set(channel, handler) };
    export const dialog = { showSaveDialog: (...args) => globalThis.__dataSaveDialog(...args), showOpenDialog: (...args) => globalThis.__dataOpenDialog(...args) };
  `)}`, shortCircuit: true };
  if (specifier.startsWith('./') && context.parentURL?.endsWith('.ts') && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const { registerDataFeaturesIpc } = await import('../packages/desktop/src/main/dataFeaturesIpc.ts');
const { createSessionTrash } = await import('../packages/desktop/src/main/sessionTrash.ts');
const { piSessionDirectory } = await import('../packages/desktop/src/main/indexedSearch.ts');
const { DATA_FEATURE_CHANNELS: channels } = await import('../packages/shared/src/dataFeatures.ts');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pi-data-ipc-')), cwd = join(root, 'project'), sessionsRoot = join(root, 'sessions');
  t.after(() => rm(root, { recursive: true, force: true })); await mkdir(cwd); await mkdir(piSessionDirectory(sessionsRoot, cwd), { recursive: true });
  const source = join(piSessionDirectory(sessionsRoot, cwd), 'original.jsonl');
  await writeFile(source, JSON.stringify({ type: 'session', version: 3, id: 'original', cwd, timestamp: new Date().toISOString() }) + '\n');
  globalThis.__dataHandlers = new Map();
  const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: {} } }; globalThis.__dataWindow = win;
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const trash = createSessionTrash(() => join(root, 'session-trash'));
  const context = { userData: root, sessionsRoot, trash, getWorkspace: () => cwd, getWorkspaces: async () => [cwd],
    listSources: async () => [{ path: source, cwd }], applyMetadata: async () => {}, removeMetadata: async () => {},
    isSessionRunning: async () => false, releaseSessionInputs: async () => {}, searchSessions: async () => {}, searchFiles: async () => {},
    rebuildIndex: async () => ({ indexed: 0 }), cancelSearch: async () => {}, getSearchRules: async () => ({}), setSearchRules: async () => {} };
  return { root, cwd, source, event, trash, context, invoke: (channel, ...args) => globalThis.__dataHandlers.get(channel)(event, ...args) };
}

test('restoration IPC rolls back partially written metadata before removing its destination and supports retry', async t => {
  const f = await fixture(t), applied = new Set(), rolledBack = []; let fail = true;
  const trashPath = await f.trash.trashSession(f.source, { cwd: f.cwd, metadata: { pinned: true } });
  f.context.applyMetadata = async items => { for (const item of items) applied.add(item.path); if (fail) throw new Error('group metadata failed'); };
  f.context.removeMetadata = async paths => { rolledBack.push(...paths); for (const path of paths) applied.delete(path); };
  registerDataFeaturesIpc(f.context);
  const request = { id: basename(trashPath), cwd: f.cwd };
  await assert.rejects(f.invoke(channels.restoreSessionTrash, request), /group metadata failed/);
  assert.deepEqual(rolledBack, [f.source]); assert.equal(applied.size, 0); await assert.rejects(readFile(f.source), { code: 'ENOENT' });
  assert.equal((await f.trash.list()).entries.length, 1);
  fail = false; assert.equal((await f.invoke(channels.restoreSessionTrash, request)).path, f.source);
  assert.equal(applied.has(f.source), true); assert.equal((await f.trash.list()).entries.length, 0);
});

test('backup IPC rechecks running sources after the picker and rejects foreign or destroyed renderers', async t => {
  const f = await fixture(t), output = join(f.root, 'export.pibackup'); let reads = 0;
  f.context.listSources = async () => { reads++; if (reads === 2) throw new Error('session started while picker open'); return [{ path: f.source, cwd: f.cwd }]; };
  globalThis.__dataSaveDialog = async () => ({ canceled: false, filePath: output });
  registerDataFeaturesIpc(f.context);
  assert.throws(() => globalThis.__dataHandlers.get(channels.listSessionTrash)({ ...f.event, senderFrame: {} }), /Invalid renderer/);
  await assert.rejects(f.invoke(channels.exportSessionsBackup), /session started/); assert.equal(reads, 2);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
  globalThis.__dataSaveDialog = async () => { globalThis.__dataWindow = null; return { canceled: false, filePath: output }; };
  await assert.rejects(f.invoke(channels.exportSessionsBackup), /window is no longer/);
  assert.equal(reads, 3, 'destroyed sender is rejected before source enumeration resumes');
});

test('import IPC rejects a target workspace removed while the picker was open', async t => {
  const f = await fixture(t); let open = true;
  f.context.getWorkspaces = async () => open ? [f.cwd] : [];
  globalThis.__dataOpenDialog = async () => { open = false; return { canceled: false, filePaths: [f.source] }; };
  registerDataFeaturesIpc(f.context);
  await assert.rejects(f.invoke(channels.importSessions, 'native', f.cwd), /目标工作区/);
  await assert.rejects(readFile(join(f.root, 'session-import-journal')), { code: 'ENOENT' });
});

test('backup IPC cannot overwrite a source through directory aliases or Windows path casing', async t => {
  const f = await fixture(t), original = await readFile(f.source, 'utf8');
  const alias = join(f.root, 'session-alias');
  await symlink(dirname(f.source), alias, process.platform === 'win32' ? 'junction' : 'dir');
  registerDataFeaturesIpc(f.context);
  const targets = [join(alias, basename(f.source))];
  if (process.platform === 'win32') targets.push(f.source.toUpperCase());
  for (const filePath of targets) {
    globalThis.__dataSaveDialog = async () => ({ canceled: false, filePath });
    await assert.rejects(f.invoke(channels.exportSessionsBackup), /备份目标不能覆盖原会话/);
    assert.equal(await readFile(f.source, 'utf8'), original, 'the original transcript remains intact');
  }
  const output = join(f.root, 'complete.pibackup');
  globalThis.__dataSaveDialog = async () => ({ canceled: false, filePath: output });
  assert.equal(await f.invoke(channels.exportSessionsBackup), output);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).sessions[0].jsonl, original);
});

test('queued search rule updates remain attached to the workspace that submitted them', async t => {
  const f = await fixture(t), second = join(f.root, 'second'); await mkdir(second);
  let active = f.cwd, releaseFirst, firstStarted;
  const started = new Promise(resolve => { firstStarted = resolve; });
  const gate = new Promise(resolve => { releaseFirst = resolve; });
  t.after(() => releaseFirst());
  const values = new Map(), updates = [];
  f.context.getWorkspace = () => active;
  f.context.getWorkspaces = async () => [f.cwd, second];
  f.context.setSearchRules = async (cwd, rules) => {
    updates.push({ cwd, rules });
    if (updates.length === 1) { firstStarted(); await gate; }
    values.set(cwd, rules);
  };
  f.context.getSearchRules = async cwd => values.get(cwd);
  registerDataFeaturesIpc(f.context);
  const firstRules = { ignoredDirectories: ['cache'], include: [], exclude: [], maxFileBytes: 1024 };
  const secondRules = { ...firstRules, ignoredDirectories: ['cache', 'generated'] };
  const first = f.invoke(channels.setProjectSearchRules, firstRules);
  await started;
  const queued = f.invoke(channels.setProjectSearchRules, secondRules);
  active = second;
  releaseFirst();
  await Promise.all([first, queued]);
  assert.deepEqual(updates.map(item => item.cwd), [f.cwd, f.cwd]);
  assert.deepEqual(JSON.parse(await readFile(join(f.root, 'project-search-rules.json'), 'utf8')), { [f.cwd]: secondRules });
});
