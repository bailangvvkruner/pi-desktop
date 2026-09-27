import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { useChatStore } from '../packages/ui/src/store.ts';

const cwd = 'C:\\title-project';
const path = 'C:\\title-project\\session.jsonl';
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const summary = (overrides = {}) => ({ path, id: 'session', firstMessage: '', modified: '2026-09-27T00:00:00.000Z', messageCount: 0, ...overrides });

beforeEach(() => useChatStore.setState(useChatStore.getInitialState(), true));

function setup(entry) {
  let listed = entry ? [entry] : [];
  const bridge = { listSessions: async () => listed, prompt: async () => {} };
  useChatStore.setState({ bridge, cwd, sessionPath: path, sessionId: 'session', status: 'idle',
    sessions: listed, sessionsByWorkspace: { [cwd]: listed } });
  return { bridge, list: (sessions) => { listed = sessions; } };
}

test('accepted first input updates both title caches before any asynchronous session refresh returns', async () => {
  const host = setup();
  const read = deferred();
  host.bridge.listSessions = () => read.promise;
  useChatStore.getState().handleEvent({ type: 'status', status: 'busy' });
  useChatStore.getState().handleEvent({ type: 'user-message', id: 'user-1', order: 1, text: '修复项目的标题\n先检查输入流程' });
  const state = useChatStore.getState();
  assert.equal(state.status, 'busy');
  assert.equal(state.sessions[0].firstMessage, '修复项目的标题\n先检查输入流程');
  assert.deepEqual(state.sessionsByWorkspace[cwd], state.sessions);
  assert.equal(state.messages[0].text, state.sessions[0].firstMessage);
  read.resolve([summary({ firstMessage: state.messages[0].text, messageCount: 1 })]);
  await settle();
  assert.equal(useChatStore.getState().sessions[0].firstMessage, state.messages[0].text);
});

test('first input preserves an explicit name and stale pre-send session reads cannot erase the accepted title', async () => {
  const named = summary({ name: '我的手动标题', firstMessage: '(no messages)', pinned: true, order: 3 });
  const host = setup(named);
  const stale = deferred();
  host.bridge.listSessions = () => stale.promise;
  const refresh = useChatStore.getState().refreshSessions();
  const latest = summary({ ...named, firstMessage: '真实已接受输入', messageCount: 1 });
  host.bridge.listSessions = async () => [latest];
  useChatStore.getState().handleEvent({ type: 'user-message', id: 'user-1', order: 1, text: latest.firstMessage });
  assert.equal(useChatStore.getState().sessions[0].name, named.name);
  assert.equal(useChatStore.getState().sessions[0].firstMessage, latest.firstMessage);
  await settle();
  stale.resolve([named]);
  await refresh;
  assert.deepEqual(useChatStore.getState().sessions, [latest]);
});

test('follow-up inputs do not replace an existing first-message title', async () => {
  const first = summary({ firstMessage: '第一条输入', messageCount: 1 });
  const host = setup(first);
  useChatStore.setState({ messages: [{ id: 'user-1', order: 1, role: 'user', text: first.firstMessage, status: 'done' }] });
  host.list([first]);
  useChatStore.getState().handleEvent({ type: 'user-message', id: 'user-2', order: 2, text: '后续问题' });
  assert.equal(useChatStore.getState().sessions[0].firstMessage, first.firstMessage);
  await settle();
  assert.equal(useChatStore.getState().sessions[0].firstMessage, first.firstMessage);
});

test('a title refresh after switching projects updates only its original cache', async () => {
  const host = setup();
  const read = deferred();
  host.bridge.listSessions = () => read.promise;
  useChatStore.getState().handleEvent({ type: 'user-message', id: 'user-1', order: 1, text: '原项目标题' });
  const otherCwd = 'D:\\other-project';
  const other = summary({ path: 'D:\\other-project\\other.jsonl', id: 'other', name: '另一个会话' });
  useChatStore.setState({ cwd: otherCwd, sessionPath: other.path, sessionId: other.id, sessions: [other],
    sessionsByWorkspace: { ...useChatStore.getState().sessionsByWorkspace, [otherCwd]: [other] }, messages: [] });
  read.resolve([summary({ firstMessage: '原项目标题', messageCount: 1 })]);
  await settle();
  assert.deepEqual(useChatStore.getState().sessions, [other]);
  assert.equal(useChatStore.getState().sessionsByWorkspace[cwd][0].firstMessage, '原项目标题');
  assert.equal(useChatStore.getState().sessionId, other.id);
});

test('unaccepted inputs and delayed prompt completion never assign a title to another session', async () => {
  const host = setup();
  host.bridge.prompt = async () => { throw new Error('Request was rejected'); };
  await assert.rejects(useChatStore.getState().send('没有被接受的输入'), /rejected/);
  assert.deepEqual(useChatStore.getState().sessions, []);
  const request = deferred();
  host.bridge.prompt = () => request.promise;
  const pending = useChatStore.getState().send('稍后返回的旧请求');
  const other = summary({ path: 'C:\\other.jsonl', id: 'other', name: '手动命名' });
  useChatStore.setState({ sessionId: other.id, sessionPath: other.path, sessions: [other], sessionsByWorkspace: { [cwd]: [other] } });
  request.resolve();
  await pending;
  assert.deepEqual(useChatStore.getState().sessions, [other]);
});
