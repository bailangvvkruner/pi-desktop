import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-session-discovery-'));
  const cwd = join(root, 'Workspace');
  mkdirSync(cwd);
  const saved = new Map(['PI_CODING_AGENT_DIR', 'PI_OFFLINE'].map(key => [key, process.env[key]]));
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  process.env.PI_OFFLINE = '1';
  const [{ AgentService }, { SessionManager }] = await Promise.all([
    import('../packages/agent/src/index.ts'), import('@earendil-works/pi-coding-agent'),
  ]);
  const services = [];
  t.after(async () => {
    await Promise.all(services.map(service => service.dispose()));
    for (const [key, value] of saved) value === undefined ? delete process.env[key] : process.env[key] = value;
    const target = resolve(root);
    if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe temporary path');
    rmSync(target, { recursive: true, force: true });
  });
  const service = () => { const value = new AgentService(); services.push(value); return value; };
  const persist = (workspace, name) => {
    const manager = SessionManager.create(workspace);
    // Header-only, named conversations are valid persisted SDK sessions.
    writeFileSync(manager.getSessionFile(), JSON.stringify(manager.getHeader()) + '\n');
    SessionManager.open(manager.getSessionFile(), undefined, workspace).appendSessionInfo(name);
    return manager.getSessionFile();
  };
  return { root, cwd, service, persist, SessionManager };
}

test('a refresh after local and external writes does not reuse an earlier pending scan', async t => {
  const { cwd, service: createService, persist, SessionManager } = await fixture(t);
  const service = createService();
  const path = persist(cwd, 'Old name');
  await service.init({ cwd, sessionPath: path });
  let scanned, release;
  const reached = new Promise(resolve => { scanned = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const original = SessionManager.list;
  let calls = 0;
  SessionManager.list = async (...args) => {
    const first = calls++ === 0;
    const rows = await original.apply(SessionManager, args);
    if (first) { scanned(); await gate; }
    return rows;
  };
  try {
    const pending = service.listSessions(cwd);
    await reached;
    await service.renameSession(path, 'New name', cwd);
    const externalPath = persist(cwd, 'Created by another Pi process');
    const refreshed = service.listSessions(cwd);
    release();
    const [before, after] = await Promise.all([pending, refreshed]);
    assert.equal(before.find(row => row.path === path).name, 'Old name');
    assert.equal(after.find(row => row.path === path).name, 'New name');
    assert.ok(after.some(row => row.path === externalPath), 'an external session created before refresh must be visible');
  } finally {
    release();
    SessionManager.list = original;
  }
});

test('header ownership checks retain the SDK directory boundary and reject path aliases', async t => {
  const { root, cwd, service: createService, persist } = await fixture(t);
  const service = createService();
  const path = persist(cwd, 'Canonical session');
  await service.init({ cwd, sessionPath: path });
  const runtime = service.active;
  const outside = join(root, 'export.jsonl');
  copyFileSync(path, outside);
  await assert.rejects(service.switchSession(outside), /不属于当前工作区/);
  await assert.rejects(service.init({ cwd, sessionPath: outside }), /不属于指定工作区/);
  await assert.rejects(service.renameSession(outside, 'Must not modify export', cwd), /不属于当前工作区/);
  assert.equal(readFileSync(outside, 'utf8'), readFileSync(path, 'utf8'));

  const other = join(root, 'Other');
  mkdirSync(other);
  const foreign = persist(other, 'Foreign session');
  const misplaced = join(dirname(path), 'foreign.jsonl');
  copyFileSync(foreign, misplaced);
  await assert.rejects(service.switchSession(foreign), /不属于当前工作区/);
  await assert.rejects(service.switchSession(misplaced), /不属于当前工作区/);

  const aliases = [dirname(path) + sep + '.' + sep + basename(path)];
  if (process.platform === 'win32') {
    aliases.push(join(dirname(path).toUpperCase(), basename(path)));
    aliases.push(join(dirname(path), basename(path).slice(0, -6).toUpperCase() + '.jsonl'));
  }
  for (const alias of aliases) {
    assert.notEqual(alias, path);
    await assert.rejects(service.switchSession(alias), /不属于当前工作区/);
  }
  assert.equal(service.active, runtime);
  assert.equal(service.contexts.size, 1, 'rejected aliases must not create a second writer for the session');
});

test('the header fast path accepts SDK-listed paths for either Windows workspace spelling', async t => {
  const { cwd, service: createService, persist, SessionManager } = await fixture(t);
  const path = persist(cwd, 'Saved session');
  const workspaces = process.platform === 'win32' ? [cwd, cwd.toUpperCase()] : [cwd];
  for (const workspace of workspaces) {
    const listed = await SessionManager.list(workspace);
    assert.equal(listed.length, 1);
    const service = createService();
    const original = SessionManager.list;
    SessionManager.list = async () => { throw new Error('Opening a valid listed header must not scan every session'); };
    try {
      await service.init({ cwd: workspace, sessionPath: listed[0].path });
      assert.equal(service.getSnapshot().sessionId, listed[0].id);
    } finally { SessionManager.list = original; }
    await service.dispose();
  }

  // The SDK skips malformed physical lines preceding a valid legacy header.
  writeFileSync(path, 'legacy damaged prefix\n' + readFileSync(path, 'utf8'));
  const service = createService();
  await service.init({ cwd, sessionPath: path });
  assert.equal(service.getSnapshot().sessionId, (await SessionManager.list(cwd))[0].id);
});
