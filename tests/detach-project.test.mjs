import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { useChatStore } from '../packages/ui/src/store.ts';

const project = 'C:/projects/one';
const standalone = 'C:/conversations/new';
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function ready(cwd = standalone, sessionId = 'standalone', messages = []) {
  return { type: 'ready', cwd, sessionId, sessionPath: `${cwd}/${sessionId}.jsonl`,
    model: 'model', modelProvider: 'provider', thinkingLevel: 'off', availableThinkingLevels: ['off'],
    contextUsage: null, messages, activities: [], fileChanges: [] };
}
function fixture() {
  const activation = deferred();
  const submissions = [];
  const bridge = {
    newSession: () => activation.promise,
    listWorkspaces: async () => [project, standalone],
    listConversationWorkspaces: async () => [standalone],
    getDefaultWorkspace: async () => 'C:/conversations',
    listSessions: async () => [],
    submitInput: async request => {
      submissions.push(request);
      useChatStore.getState().handleEvent({ type: 'user-message', id: 'accepted', order: 0, text: request.text, attachments: request.attachments });
      return { id: request.id, state: 'accepted' };
    },
    abort: async () => { throw new Error('Must not abort the previous project'); },
  };
  useChatStore.setState({ bridge, cwd: project, sessionId: 'source', sessionPath: `${project}/source.jsonl`, status: 'idle', workspaces: [project] });
  return { activation, bridge, submissions, publish: () => useChatStore.getState().handleEvent(ready()) };
}
beforeEach(() => useChatStore.setState(useChatStore.getInitialState(), true));

test('detaching stays editable through reset and submits the visible input once after activation, without waiting for sidebar refresh', async () => {
  const host = fixture();
  const refresh = deferred();
  host.bridge.listSessions = () => refresh.promise;
  const preparing = useChatStore.getState().detachProject();
  assert.equal(useChatStore.getState().cwd, '');
  assert.equal(useChatStore.getState().status, 'idle');
  assert.equal(useChatStore.getState().sessionLoading, false);
  assert.deepEqual(useChatStore.getState().sessionPreparation.draftScope, { cwd: project, sessionPath: `${project}/source.jsonl` });
  useChatStore.getState().handleEvent({ type: 'reset', cwd: standalone });
  useChatStore.getState().handleEvent({ type: 'status', status: 'busy' });
  assert.equal(useChatStore.getState().cwd, '');
  assert.equal(useChatStore.getState().status, 'idle');

  const attachments = [{ kind: 'text', name: 'notes.txt', mimeType: 'text/plain', text: 'notes' }];
  const sending = useChatStore.getState().send('Send while preparing', undefined, attachments, 'input-1');
  assert.equal(useChatStore.getState().messages[0].text, 'Send while preparing');
  assert.deepEqual(useChatStore.getState().messages[0].attachments, attachments);
  assert.equal(host.submissions.length, 0);
  host.publish();
  await settle();
  assert.equal(host.submissions.length, 0, 'ready before activation completes must not submit early');
  assert.equal(useChatStore.getState().messages.length, 1);
  host.activation.resolve();
  await preparing;
  await sending;
  assert.equal(host.submissions.length, 1);
  assert.equal(host.submissions[0].sessionId, 'standalone');
  assert.equal(host.submissions[0].id, 'input-1');
  assert.equal(host.submissions[0].behavior, undefined, 'preparation is not an agent run requiring follow-up delivery');
  assert.deepEqual(host.submissions[0].attachments, attachments);
  assert.equal(useChatStore.getState().messages.length, 1, 'the real event replaces its optimistic message');
  assert.equal(useChatStore.getState().messages[0].id, 'accepted');
  assert.equal(useChatStore.getState().sessions[0].firstMessage, 'Send while preparing');
  assert.equal(useChatStore.getState().navigationPending, false);
  assert.equal(useChatStore.getState().sessionPreparation, null);
  assert.deepEqual(useChatStore.getState().draftTransfer.to, { cwd: standalone, sessionPath: `${standalone}/standalone.jsonl` });
  refresh.resolve([]);
  await settle();
});

test('failed preparation rejects the waiting send, restores the original scope, and allows a fresh retry', async () => {
  const host = fixture();
  const preparing = useChatStore.getState().detachProject();
  const prepareError = assert.rejects(preparing, /Cannot create conversation/);
  const sendError = assert.rejects(useChatStore.getState().send('Retain my draft', undefined, [], 'retry-input'), /Cannot create conversation/);
  host.activation.reject(new Error('Cannot create conversation'));
  await Promise.all([prepareError, sendError]);
  assert.equal(host.submissions.length, 0);
  assert.equal(useChatStore.getState().cwd, project);
  assert.equal(useChatStore.getState().sessionId, 'source');
  assert.equal(useChatStore.getState().status, 'idle');
  assert.equal(useChatStore.getState().navigationPending, false);
  assert.equal(useChatStore.getState().messages.length, 0);
  host.bridge.newSession = async () => host.publish();
  await useChatStore.getState().detachProject();
  assert.equal(useChatStore.getState().cwd, standalone);
  assert.equal(useChatStore.getState().error, null);
});

test('stopping a waiting input never aborts the old project and does not submit after readiness', async () => {
  const host = fixture();
  const preparing = useChatStore.getState().detachProject();
  const cancelled = assert.rejects(useChatStore.getState().send('Cancel this input', undefined, [], 'cancel-input'), { name: 'AbortError' });
  await useChatStore.getState().abort();
  await cancelled;
  assert.equal(useChatStore.getState().messages.length, 0);
  assert.equal(useChatStore.getState().status, 'idle');
  host.publish();
  host.activation.resolve();
  await preparing;
  assert.equal(host.submissions.length, 0);
  assert.equal(useChatStore.getState().cwd, standalone);
  await useChatStore.getState().send('A later input', undefined, [], 'later-input');
  assert.equal(host.submissions[0].sessionId, 'standalone');
});

test('navigating elsewhere cancels the local waiting input instead of sending it to another session', async () => {
  const host = fixture();
  const preparing = useChatStore.getState().detachProject();
  const cancelled = assert.rejects(useChatStore.getState().send('Never route elsewhere', undefined, [], 'scoped-input'), { name: 'AbortError' });
  host.bridge.switchWorkspace = async cwd => {
    await host.activation.promise;
    useChatStore.getState().handleEvent(ready(cwd, 'elsewhere'));
  };
  const navigating = useChatStore.getState().switchWorkspace('C:/another');
  await cancelled;
  host.activation.resolve();
  await Promise.all([preparing, navigating]);
  assert.equal(host.submissions.length, 0);
  assert.equal(useChatStore.getState().sessionId, 'elsewhere');
  assert.equal(useChatStore.getState().messages.length, 0);
});

test('a rejected backend submission removes the optimistic message permanently', async () => {
  const host = fixture();
  host.bridge.submitInput = async () => { throw new Error('Provider unavailable'); };
  const preparing = useChatStore.getState().detachProject();
  const failed = assert.rejects(useChatStore.getState().send('Try again', undefined, [], 'failed-input'), /Provider unavailable/);
  host.publish();
  host.activation.resolve();
  await Promise.all([preparing, failed]);
  assert.equal(useChatStore.getState().messages.length, 0);
  assert.equal(useChatStore.getState().status, 'idle', 'a rejected input must not leave the local waiting status busy');
  host.publish();
  assert.equal(useChatStore.getState().messages.length, 0, 'resync must not resurrect a failed optimistic input');
});

test('commands without a user-message event clear the local waiting message and status', async () => {
  const host = fixture();
  const commands = [];
  host.bridge.executeSlashCommand = async request => { commands.push(request); };
  const preparing = useChatStore.getState().detachProject();
  const sending = useChatStore.getState().send('/name New title', undefined, [], 'name-input');
  host.publish();
  host.activation.resolve();
  await Promise.all([preparing, sending]);
  assert.equal(commands[0].sessionId, 'standalone');
  assert.equal(useChatStore.getState().messages.length, 0);
  assert.equal(useChatStore.getState().status, 'idle');
  host.publish();
  assert.equal(useChatStore.getState().messages.length, 0);
});

test('expanded prompt commands replace their waiting text with the actual accepted input', async () => {
  const host = fixture();
  host.bridge.executeSlashCommand = async () => {
    useChatStore.getState().handleEvent({ type: 'user-message', id: 'expanded', order: 0, text: 'Expanded prompt template' });
    useChatStore.getState().handleEvent({ type: 'status', status: 'busy' });
  };
  const preparing = useChatStore.getState().detachProject();
  const sending = useChatStore.getState().send('/my-template', undefined, [], 'template-input');
  host.publish();
  host.activation.resolve();
  await Promise.all([preparing, sending]);
  assert.equal(useChatStore.getState().messages.length, 1);
  assert.equal(useChatStore.getState().messages[0].text, 'Expanded prompt template');
  assert.equal(useChatStore.getState().status, 'busy', 'an actual agent run retains its own busy state');
});
