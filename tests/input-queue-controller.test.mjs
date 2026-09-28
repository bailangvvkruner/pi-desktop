import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InputQueueController } from '../packages/ui/src/inputQueueController.ts';

const scope = { cwd: 'C:/workspace', sessionPath: 'C:/session.jsonl', sessionId: 'session' };
const snapshot = version => ({ scope, version, paused: false, items: [] });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function setup(extra = {}, current = () => true) {
  const requests = [], responses = [];
  const bridge = {
    getInputQueue: async () => snapshot(1),
    mutateInputQueue: request => { requests.push(request); const response = deferred(); responses.push(response); return response.promise; },
    ...extra,
  };
  const controller = new InputQueueController(bridge, scope, current);
  controller.setEnabled(true); await controller.refresh();
  return { controller, requests, responses, bridge };
}

test('independent rows queue immediately, same row cannot duplicate, and RPC writes remain serial', async () => {
  const { controller, requests, responses } = await setup();
  const first = controller.mutate('steer', 'A');
  const second = controller.mutate('remove', 'B');
  const pause = controller.mutate('pause');
  assert.equal(await controller.mutate('remove', 'A'), null);
  assert.equal(requests.length, 1);
  assert.deepEqual([...controller.getSnapshot().pendingRows], [['A', 'steer'], ['B', 'remove']]);
  assert.equal(controller.getSnapshot().activeRow, 'A');
  assert.equal(controller.getSnapshot().pendingGlobal, true);
  responses[0].resolve(snapshot(2)); await first;
  assert.equal(requests.length, 2);
  assert.equal(requests[1].expectedVersion, 2);
  assert.equal(controller.getSnapshot().activeRow, 'B');
  responses[1].resolve(snapshot(3)); await second;
  assert.equal(requests[2].expectedVersion, 3);
  responses[2].resolve(snapshot(4)); await pause;
  assert.equal(controller.getSnapshot().pendingRows.size, 0);
  assert.equal(controller.getSnapshot().pendingGlobal, false);
  assert.equal(new Set(requests.map(request => request.requestId)).size, 3);
  assert(requests.every(request => request.scope === scope));
});

test('a conflict refreshes the version without replaying the failed action or dropping other rows', async () => {
  let version = 1;
  const { controller, requests, responses } = await setup({ getInputQueue: async () => snapshot(version) });
  const failed = controller.mutate('edit', 'A', 'keep this draft');
  const second = controller.mutate('remove', 'B');
  version = 9; responses[0].reject(new Error('Queue version conflict'));
  assert.equal(await failed, null);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].expectedVersion, 9);
  assert.equal(controller.getSnapshot().error, 'Queue version conflict');
  responses[1].resolve(snapshot(10)); await second;
  assert.equal(controller.getSnapshot().queue.version, 10);
  assert.equal(requests.filter(request => request.id === 'A').length, 1);
});

test('a failed recovery read cancels waiting mutations until an authoritative refresh succeeds', async () => {
  let fail = false;
  const { controller, requests, responses } = await setup({ getInputQueue: async () => { if (fail) throw new Error('offline'); return snapshot(1); } });
  const first = controller.mutate('edit', 'A', 'draft'), second = controller.mutate('remove', 'B');
  fail = true; responses[0].reject(new Error('write failed'));
  assert.equal(await first, null); assert.equal(await second, null);
  assert.equal(requests.length, 1);
  assert.equal(controller.getSnapshot().queue, null);
  assert.equal(controller.getSnapshot().pendingRows.size, 0);
  assert.equal(await controller.mutate('remove', 'C'), null);
  fail = false; await controller.refresh();
  assert.equal(controller.getSnapshot().queue.version, 1);
});

test('switching sessions cancels waiting actions and suppresses a late in-flight response', async () => {
  const { controller, requests, responses } = await setup();
  const first = controller.mutate('beginEdit', 'A'), second = controller.mutate('remove', 'B');
  controller.setEnabled(false);
  assert.equal(await second, null);
  responses[0].resolve(snapshot(2));
  assert.equal(await first, null);
  assert.equal(requests.length, 1);
  assert.equal(controller.getSnapshot().queue.version, 1);
  assert.equal(controller.getSnapshot().pendingRows.size, 0);
});

test('the live scope guard blocks queued writes before React effect cleanup', async () => {
  let current = true;
  const { controller, requests, responses } = await setup({}, () => current);
  const first = controller.mutate('remove', 'A'), second = controller.mutate('remove', 'B');
  current = false; responses[0].resolve(snapshot(2));
  assert.equal(await first, null); assert.equal(await second, null);
  assert.equal(requests.length, 1);
});

test('late and foreign snapshots cannot replace a newer queue', async () => {
  const read = deferred(); let next = snapshot(1);
  const { controller, responses } = await setup({ getInputQueue: () => next });
  next = read.promise; const staleRead = controller.refresh();
  const mutation = controller.mutate('remove', 'A'); responses[0].resolve(snapshot(5)); await mutation;
  read.resolve(snapshot(2)); await staleRead;
  assert.equal(controller.getSnapshot().queue.version, 5);
  next = { ...snapshot(6), scope: { ...scope, sessionPath: 'C:/other.jsonl' } };
  assert.equal(await controller.refresh(), null);
  assert.equal(controller.getSnapshot().queue.version, 5);
});
