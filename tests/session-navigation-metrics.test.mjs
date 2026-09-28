import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { useChatStore } from '../packages/ui/src/store.ts';
import { sessionOpenMetrics } from '../packages/ui/src/sessionOpenMetrics.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
beforeEach(() => {
  sessionOpenMetrics.cancel();
  useChatStore.setState(useChatStore.getInitialState(), true);
});
function fixture() {
  const events = [];
  const bridge = {
    recordUiDiagnostic: async event => { events.push(event); },
    listWorkspaces: async () => ['workspace'], listSessions: async () => [],
    pickWorkspace: async () => null, activateResidentSession: async () => false,
    switchSession: async () => {},
  };
  useChatStore.setState({bridge,cwd:'workspace',sessionPath:'current-file',sessionId:'current-id',status:'idle'});
  return {bridge,events};
}
function paint() {
  const state = useChatStore.getState();
  const token = sessionOpenMetrics.rendered(state.cwd, state.sessionPath, state.sessionId);
  if (token !== null) sessionOpenMetrics.painted(token);
  return token;
}
function ready(scope, resumeKind) {
  const state = useChatStore.getState();
  state.handleEvent({type:'ready',cwd:state.cwd,sessionPath:state.sessionPath,sessionId:state.sessionId,
    model:'test',modelProvider:'test',thinkingLevel:'off',availableThinkingLevels:[],contextUsage:null,
    messages:[],activities:[],fileChanges:[],...scope,...(resumeKind ? {resumeKind} : {})});
}

test('cancelling the native workspace picker records cancellation instead of painting the current session as a success', async () => {
  const {events} = fixture();
  await useChatStore.getState().pickWorkspace();
  assert.equal(paint(), null);
  await tick();
  assert.deepEqual(events.map(e => e.outcome), ['cancelled']);
  assert.equal(events[0].temperature, undefined);
  assert.equal(useChatStore.getState().navigationPending, false);
});

test('missing resident sessions cannot record success using an old session in the same workspace', async () => {
  const {bridge,events} = fixture();
  bridge.activateResidentSession = async () => {
    ready({}, 'warm'); // A late snapshot for the visible session must not match another target.
    return false;
  };
  assert.equal(await useChatStore.getState().selectResidentSession('workspace','missing-id',null), false);
  assert.equal(paint(), null);
  await tick();
  assert.deepEqual(events.map(e => e.outcome), ['cancelled']);
});

test('a retained unsaved session is identified by id and the ready event supplies actual runtime temperature', async () => {
  const {bridge,events} = fixture();
  useChatStore.setState({sessionPath:null,sessionId:'first-draft'});
  bridge.activateResidentSession = async scope => { ready(scope, 'warm'); return true; };
  assert.equal(await useChatStore.getState().selectResidentSession('workspace','second-draft',null), true);
  assert.equal(sessionOpenMetrics.rendered('workspace',null,'first-draft'), null);
  assert.notEqual(paint(), null);
  await tick();
  assert.equal(events[0].temperature, 'warm');
  bridge.switchSession = async path => ready({sessionPath:path,sessionId:'evicted-session'});
  for (let attempt = 0; attempt < 2; attempt++) {
    await useChatStore.getState().switchSession('evicted-file');
    assert.notEqual(paint(), null);
  }
  await tick();
  assert.deepEqual(events.map(e => e.temperature), ['warm','cold','cold']);
});

test('reselecting the current session without ready reuses only its displayed snapshot', async () => {
  const {events} = fixture();
  await useChatStore.getState().switchSession('current-file');
  assert.notEqual(paint(), null);
  await tick();
  assert.equal(events[0].temperature, 'warm');
  await useChatStore.getState().switchSession('another-file');
  assert.equal(paint(), null, 'a different target needs a ready event');
  sessionOpenMetrics.cancel();
  await tick();
  assert.deepEqual(events.map(e => e.outcome), ['success','cancelled']);
});

test('replacing the bridge cancels its pending navigation and rejects the old completion', async () => {
  const {bridge,events} = fixture();
  let finish;
  bridge.switchSession = () => new Promise(resolve => { finish = resolve; });
  const pending = useChatStore.getState().switchSession('another-file');
  const state = useChatStore.getState();
  const nextBridge = {...bridge,onAgentEvent:() => () => {},getAppInfo:async () => null,getSnapshot:async () => ({...state,sessionRuntimes:[]})};
  useChatStore.getState().setBridge(nextBridge);
  finish();
  await pending;
  await tick();
  assert.equal(paint(), null);
  assert.deepEqual(events.map(e => e.outcome), ['cancelled']);
  assert.equal(useChatStore.getState().navigationRequestId, 0);
});
