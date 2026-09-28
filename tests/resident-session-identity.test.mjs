import assert from 'node:assert/strict';
import { test } from 'node:test';

test('background snapshot reads are scoped and never activate an unrelated runtime', async () => {
  const { AgentService } = await import('../packages/agent/src/index.ts');
  const service = Object.create(AgentService.prototype);
  let activated = null;
  const a = { cwd:'A', getSnapshot:() => ({cwd:'A',sessionId:'a',sessionPath:null,messages:[]}) };
  const b = { cwd:'B', getSnapshot:() => ({cwd:'B',sessionId:'b',sessionPath:'b.jsonl',messages:[{text:'B'}]}) };
  for (const context of [a,b]) { const identity = context.getSnapshot(); context.matchesSession = scope => scope.cwd === identity.cwd && scope.sessionId === identity.sessionId && scope.sessionPath === identity.sessionPath; }
  service.contexts = new Map([['a', a], ['b', b]]);
  service.runTransition = fn => fn(); service.activate = key => { activated = key; }; service.isSessionReserved = () => false;
  assert.equal(service.getResidentSessionSnapshot({cwd:'A',sessionId:'b',sessionPath:'b.jsonl'}), null);
  assert.equal(service.getResidentSessionSnapshot({cwd:'B',sessionId:'b',sessionPath:'wrong.jsonl'}), null);
  assert.equal(service.getResidentSessionSnapshot({cwd:'B',sessionId:'b',sessionPath:'b.jsonl'}).messages[0].text, 'B');
  assert.equal(activated, null);
  assert.equal(await service.activateResidentSession({cwd:'A',sessionId:'a',sessionPath:null}), true);
  assert.equal(activated, 'a', 'unsaved drafts use their runtime id');
  assert.equal(await service.activateResidentSession({cwd:'A',sessionId:'b',sessionPath:'b.jsonl'}), false);
  assert.equal(activated, 'a');
  service.isSessionReserved = () => true;
  await assert.rejects(service.activateResidentSession({cwd:'B',sessionId:'b',sessionPath:'b.jsonl'}), /切换或删除/);
  assert.throws(() => service.getResidentSessionSnapshot(null), /Invalid/);
});
