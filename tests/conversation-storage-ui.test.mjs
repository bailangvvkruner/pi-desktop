import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { useChatStore } from '../packages/ui/src/store.ts';
import { buildSidebarProjectGroups, collectSidebarSessions, sidebarProjectPaths } from '../packages/ui/src/sidebarOrganization.ts';

const project = 'C:/projects/example';
const originalRoot = 'C:/Users/review/PiDesktopWorkspace';
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const state = { root: originalRoot, folders: [], calls: [], sequence: 0, fail: false };
  const originalSession = { path: project + '/old.jsonl', id: 'old', firstMessage: 'Original project history', messageCount: 1 };
  const bridge = {
    async newSession(options) {
      state.calls.push(options);
      if (state.fail) throw new Error('Cannot create conversation folder');
      const cwd = options?.cwd ?? `${state.root}/conversation-${++state.sequence}`;
      if (!options?.cwd) state.folders.push(cwd);
      useChatStore.getState().handleEvent({ type: 'ready', cwd, sessionId: `new-${state.calls.length}`, sessionPath: cwd + '/new.jsonl',
        model: 'model', modelProvider: 'provider', thinkingLevel: 'off', availableThinkingLevels: ['off'], messages: [], activities: [] });
    },
    async listWorkspaces() { return [project, ...state.folders]; },
    async listConversationWorkspaces() { return [originalRoot, state.root, ...state.folders]; },
    async getDefaultWorkspace() { return state.root; },
    async listSessions(cwd) { return cwd === project ? [originalSession] : [{ path: cwd + '/new.jsonl', id: cwd, firstMessage: 'Conversation history', messageCount: 1 }]; },
  };
  useChatStore.setState({ bridge, cwd: project, sessionId: 'old', sessionPath: originalSession.path, status: 'idle', workspaces: [project],
    sessionsByWorkspace: { [project]: [originalSession] } });
  return { state, bridge };
}

beforeEach(() => useChatStore.setState(useChatStore.getInitialState(), true));

test('default new conversations refresh their independent directories and keep history out of the project list', async () => {
  const { state } = fixture();
  await useChatStore.getState().newSession();
  const first = useChatStore.getState().cwd;
  await useChatStore.getState().newSession();
  const second = useChatStore.getState().cwd;
  assert.notEqual(first, second);
  assert.deepEqual(state.calls, [undefined, undefined]);
  const current = useChatStore.getState();
  const projects = sidebarProjectPaths(current.workspaces, null, current.conversationWorkspaces);
  assert.deepEqual(projects, [project]);
  const groups = buildSidebarProjectGroups(collectSidebarSessions(current.workspaces, current.sessionsByWorkspace), projects);
  assert.deepEqual(groups.projects[0].sessions.map(session => session.path), [project + '/old.jsonl']);
  assert.deepEqual(new Set(groups.unassigned.map(session => session.workspace)), new Set([first, second]));
  assert.equal(current.navigationPending, false);
});

test('changing the storage root keeps old automatic conversations hidden and preserves a user project inside the root', async () => {
  const { state, bridge } = fixture();
  await useChatStore.getState().newSession();
  const old = useChatStore.getState().cwd;
  state.root = 'D:/Saved conversations';
  const nestedProject = state.root + '/user-created-project';
  bridge.listWorkspaces = async () => [project, nestedProject, ...state.folders];
  await useChatStore.getState().newSession();
  const current = useChatStore.getState();
  assert.ok(current.cwd.startsWith(state.root + '/'));
  assert.ok(current.conversationWorkspaces.includes(old));
  assert.ok(current.sessionsByWorkspace[old].length > 0);
  assert.deepEqual(sidebarProjectPaths(current.workspaces, null, current.conversationWorkspaces), [project, nestedProject]);
});

test('an explicit project used as the storage root remains visible when backend metadata excludes it', async () => {
  const { state, bridge } = fixture();
  state.root = project;
  bridge.listConversationWorkspaces = async () => [originalRoot, ...state.folders];
  await useChatStore.getState().newSession();
  const current = useChatStore.getState();
  assert.equal(current.defaultWorkspace, project);
  assert.deepEqual(sidebarProjectPaths(current.workspaces, null, current.conversationWorkspaces), [project]);
});

test('project-scoped new conversations forward the selected project instead of allocating a default folder', async () => {
  const { state } = fixture();
  await useChatStore.getState().newSession({ cwd: project });
  assert.deepEqual(state.calls, [{ cwd: project }]);
  assert.deepEqual(state.folders, []);
  assert.equal(useChatStore.getState().cwd, project);
});

test('folder creation errors preserve the active conversation and release navigation controls', async () => {
  const { state } = fixture();
  state.fail = true;
  await assert.rejects(useChatStore.getState().newSession(), /Cannot create conversation folder/);
  const current = useChatStore.getState();
  assert.equal(current.cwd, project);
  assert.equal(current.sessionId, 'old');
  assert.equal(current.navigationPending, false);
  assert.equal(current.error, 'Cannot create conversation folder');
});

test('navigation remains pending until automatic-directory metadata arrives', async () => {
  const { bridge } = fixture();
  const original = bridge.listConversationWorkspaces;
  let release;
  bridge.listConversationWorkspaces = () => new Promise(resolve => { release = async () => resolve(await original()); });
  const operation = useChatStore.getState().newSession();
  await settle();
  assert.equal(useChatStore.getState().navigationPending, true);
  await release();
  await operation;
  const current = useChatStore.getState();
  assert.equal(current.navigationPending, false);
  assert.ok(current.conversationWorkspaces.includes(current.cwd));
});
