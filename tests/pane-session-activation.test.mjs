import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { useChatStore } from '../packages/ui/src/store.ts';
import { selectPaneSession } from '../packages/ui/src/paneSessionActivation.ts';
import { sessionOpenMetrics } from '../packages/ui/src/sessionOpenMetrics.ts';

beforeEach(() => {
  sessionOpenMetrics.cancel();
  useChatStore.setState(useChatStore.getInitialState(), true);
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return {promise,resolve,reject};
}
const selected = {cwd:'workspace',sessionId:'pane-session',sessionPath:'pane-file',title:'Pane'};
function fixture() {
  const resident = deferred(), calls = [];
  const bridge = {
    activateResidentSession: () => resident.promise,
    switchSession: async path => { calls.push(path); useChatStore.setState({sessionId:path,sessionPath:path}); },
    listSessions:async () => [],listWorkspaces:async () => ['workspace'],
  };
  useChatStore.setState({bridge,cwd:'workspace',sessionId:'current',sessionPath:'current-file',status:'idle'});
  return {resident,calls};
}

test('superseded pane resident activation does not start fallback or claim a released draft', async () => {
  for (const sessionPath of ['pane-file',null]) {
    const {resident,calls} = fixture();
    const pending = selectPaneSession(useChatStore.getState,{...selected,sessionPath});
    await useChatStore.getState().selectSession('workspace','user-selected-file');
    resident.resolve(false);
    assert.equal(await pending,'cancelled');
    assert.deepEqual(calls,['user-selected-file']);
    assert.equal(useChatStore.getState().sessionPath,'user-selected-file');
  }
});

test('stale resident errors are ignored after replacement navigation', async () => {
  const {resident,calls} = fixture();
  const pending = selectPaneSession(useChatStore.getState,selected);
  await useChatStore.getState().selectSession('workspace','user-selected-file');
  resident.reject(new Error('obsolete runtime failure'));
  assert.equal(await pending,'cancelled');
  assert.deepEqual(calls,['user-selected-file']);
  assert.equal(useChatStore.getState().error,null);
});

test('a current cache miss loads the session and a current released draft is explicit', async () => {
  const {resident,calls} = fixture();
  const pending = selectPaneSession(useChatStore.getState,selected);
  resident.resolve(false);
  assert.equal(await pending,'selected');
  assert.deepEqual(calls,['pane-file']);
  assert.equal(await selectPaneSession(useChatStore.getState,{...selected,sessionPath:null}),'released');
});

test('replacement bridges and unmounted panes cannot trigger a stale fallback', async () => {
  for (const reason of ['bridge','unmount']) {
    const {resident,calls} = fixture();
    let mounted = true;
    const pending = selectPaneSession(useChatStore.getState,selected,() => mounted);
    if (reason === 'bridge') useChatStore.setState({bridge:{...useChatStore.getState().bridge}});
    else mounted = false;
    resident.resolve(false);
    assert.equal(await pending,'cancelled',reason);
    assert.deepEqual(calls,[],reason);
  }
});
