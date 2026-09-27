import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const tick = () => new Promise(resolve => setImmediate(resolve));
const assistant = text => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop', api: 'anthropic-messages',
  provider: 'anthropic', model: 'fixture', timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pi-session-live-title-'));
  const cwd = join(root, 'project'); await mkdir(cwd);
  const saved = new Map(['PI_CODING_AGENT_DIR', 'PI_OFFLINE'].map(key => [key, process.env[key]]));
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent'); process.env.PI_OFFLINE = '1';
  const { AgentService } = await import('../packages/agent/src/index.ts');
  const service = new AgentService(async () => ({ trusted: true, remember: false }));
  t.after(async () => { await service.dispose(); for (const [key, value] of saved) value === undefined ? delete process.env[key] : process.env[key] = value; await rm(root, { recursive: true, force: true }); });
  await service.init({ cwd });
  return { cwd, service };
}

test('first input supplies a live title before Pi flushes its transcript and preserves an explicit name', async t => {
  const { cwd, service } = await fixture(t);
  for (const name of [undefined, '我的手动名称']) {
    if (name) { await service.newSession(); await service.renameSession(service.getSnapshot().sessionPath, name, cwd); }
    const session = service.active.runtime.session;
    const text = name ? '命名会话的第一条消息' : '立即更新会话标题';
    try {
      await session._handleAgentEvent({ type: 'agent_start' });
      await session._handleAgentEvent({ type: 'message_start', message: { role: 'user', content: text, timestamp: Date.now() } });
      const snapshot = service.getSnapshot();
      assert.equal(snapshot.status, 'busy');
      const persisted = (await readFile(snapshot.sessionPath, 'utf8')).trim().split('\n').map(JSON.parse);
      assert.ok(persisted.some(entry => entry.type === 'session'));
      assert.ok(!persisted.some(entry => entry.type === 'message' && entry.message.role === 'user'), 'exercise the real SDK first-turn gap before user messages are flushed');
      const row = (await service.listSessions(cwd)).find(entry => entry.path === snapshot.sessionPath);
      assert.equal(row.firstMessage, text);
      assert.equal(row.name, name);
      assert.equal(row.runtime.phase, 'running');
    } finally { await session._emitAgentSettled(); await tick(); }
  }
});

test('live summaries retain the actual first user message when the renderer history window omits it', async t => {
  const { cwd, service } = await fixture(t);
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  const manager = SessionManager.create(cwd);
  for (let index = 0; index < 230; index++) {
    manager.appendMessage({ role: 'user', content: index === 0 ? 'Original first title' : `Later input ${index}`, timestamp: Date.now() });
    manager.appendMessage(assistant(`Reply ${index}`));
  }
  await service.switchSession(manager.getSessionFile());
  const context = service.active;
  assert.ok(!service.getSnapshot().messages.some(message => message.text === 'Original first title'), 'the first prompt is outside the renderer history page');
  await context.runtime.session._handleAgentEvent({ type: 'agent_start' });
  assert.equal(context.getLiveSidebarEntry({ phase: 'running' }).firstMessage, 'Original first title');
  const row = (await service.listSessions(cwd)).find(entry => entry.path === manager.getSessionFile());
  assert.equal(row.firstMessage, 'Original first title');
  await context.runtime.session._emitAgentSettled();
});

test('a background runtime announces accepted input so its sidebar title can refresh without foreground message leakage', async t => {
  const { cwd, service } = await fixture(t);
  const background = service.active;
  const path = service.getSnapshot().sessionPath;
  await service.newSession();
  const foreground = service.getSnapshot().sessionId;
  const events = [];
  service.onEvent(({ event }) => events.push(event));
  await background.runtime.session._handleAgentEvent({ type: 'agent_start' });
  events.length = 0;
  await background.runtime.session._handleAgentEvent({ type: 'message_start', message: { role: 'user', content: 'Background first prompt', timestamp: Date.now() } });
  assert.ok(events.some(event => event.type === 'sessions-changed' && event.cwd === cwd));
  assert.ok(!events.some(event => event.type === 'user-message'));
  assert.equal(service.getSnapshot().sessionId, foreground);
  assert.equal(service.getSnapshot().messages.length, 0);
  const row = (await service.listSessions(cwd)).find(entry => entry.path === path);
  assert.equal(row.firstMessage, 'Background first prompt');
  await background.runtime.session._emitAgentSettled();
});
