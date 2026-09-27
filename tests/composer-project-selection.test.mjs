import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { useChatStore } from '../packages/ui/src/store.ts';

const project = 'C:/projects/one';
const home = 'C:/home/PiDesktopWorkspace';
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture() {
  const calls = [];
  let nextSession = 0;
  const bridge = {
    async switchWorkspace(cwd, options) {
      calls.push({ cwd, options });
      const fresh = options?.fresh === true;
      const sessionId = fresh ? `new-${++nextSession}` : 'saved';
      useChatStore.getState().handleEvent({ type: 'ready', cwd, sessionId, sessionPath: `${cwd}/${sessionId}.jsonl`,
        model: 'model', modelProvider: 'provider', thinkingLevel: 'off', availableThinkingLevels: ['off'],
        messages: fresh ? [] : [{ id: 'old', role: 'user', text: 'Existing conversation', status: 'done', order: 1 }], activities: [] });
    },
    async listWorkspaces() { return [project, home]; },
    async listSessions(cwd) { return [{ path: `${cwd}/saved.jsonl`, id: 'saved', firstMessage: 'Existing conversation', messageCount: 1 }]; },
    async pickWorkspace() { return home; },
  };
  useChatStore.setState({ bridge, cwd: project, sessionId: 'draft', sessionPath: `${project}/draft.jsonl`, status: 'idle' });
  return { bridge, calls };
}

beforeEach(() => useChatStore.setState(useChatStore.getInitialState(), true));

test('new-conversation project choices request a fresh session even when the destination has saved history', async () => {
  const host = fixture();
  const visited = [];
  const unsubscribe = useChatStore.subscribe(state => visited.push(state.sessionId));
  try {
    await useChatStore.getState().switchWorkspace(home, { fresh: true });
    assert.equal(useChatStore.getState().cwd, home);
    assert.equal(useChatStore.getState().sessionId, 'new-1');
    assert.deepEqual(useChatStore.getState().messages, []);
    assert.equal(useChatStore.getState().sessions[0].id, 'saved', 'saved conversations stay available in the sidebar');
    assert.ok(!visited.includes('saved'), 'switching a draft must never briefly activate the saved conversation');
    await useChatStore.getState().switchWorkspace(home, { fresh: true });
    assert.equal(useChatStore.getState().sessionId, 'new-2', 'an explicit new-session request is honored in the current workspace too');
    assert.equal(host.calls.length, 2);
    assert.equal(useChatStore.getState().navigationPending, false);
  } finally { unsubscribe(); }
});

test('ordinary workspace navigation continues to restore saved conversations', async () => {
  const host = fixture();
  await useChatStore.getState().switchWorkspace(home);
  assert.equal(useChatStore.getState().sessionId, 'saved');
  assert.equal(useChatStore.getState().messages[0].text, 'Existing conversation');
  assert.deepEqual(host.calls, [{ cwd: home, options: undefined }]);
  await useChatStore.getState().switchWorkspace(home);
  assert.equal(host.calls.length, 1, 'ordinary selection of the active workspace is still a no-op');
});

test('opening a folder for a new conversation forwards fresh intent; cancel leaves the current draft intact', async () => {
  const host = fixture();
  await useChatStore.getState().pickWorkspace({ fresh: true });
  assert.deepEqual(host.calls, [{ cwd: home, options: { fresh: true } }]);
  assert.equal(useChatStore.getState().sessionId, 'new-1');
  host.bridge.pickWorkspace = async () => null;
  await useChatStore.getState().pickWorkspace({ fresh: true });
  assert.equal(host.calls.length, 1);
  assert.equal(useChatStore.getState().sessionId, 'new-1');
  assert.equal(useChatStore.getState().navigationPending, false);
});

test('a late folder selection cannot replace a newer navigation with a new conversation', async () => {
  const host = fixture();
  const picker = deferred();
  host.bridge.pickWorkspace = () => picker.promise;
  const selecting = useChatStore.getState().pickWorkspace({ fresh: true });
  assert.equal(useChatStore.getState().navigationPending, true);
  await useChatStore.getState().switchWorkspace(home);
  picker.resolve(project);
  await selecting;
  assert.deepEqual(host.calls, [{ cwd: home, options: undefined }]);
  assert.equal(useChatStore.getState().sessionId, 'saved');
  assert.equal(useChatStore.getState().navigationPending, false);
});

test('fresh navigation stays pending through refresh and reports failures without changing the draft', async () => {
  const host = fixture();
  const refresh = deferred();
  host.bridge.listSessions = () => refresh.promise;
  const selecting = useChatStore.getState().switchWorkspace(home, { fresh: true });
  await settle();
  assert.equal(useChatStore.getState().navigationPending, true);
  assert.equal(useChatStore.getState().navigationRequestId, 1);
  refresh.resolve([]);
  await selecting;
  assert.equal(useChatStore.getState().navigationPending, false);
  const original = useChatStore.getState().sessionPath;
  host.bridge.switchWorkspace = async () => { throw new Error('Cannot open project'); };
  await assert.rejects(useChatStore.getState().switchWorkspace(project, { fresh: true }), /Cannot open project/);
  assert.equal(useChatStore.getState().sessionPath, original);
  assert.equal(useChatStore.getState().error, 'Cannot open project');
  assert.equal(useChatStore.getState().navigationPending, false);
});
