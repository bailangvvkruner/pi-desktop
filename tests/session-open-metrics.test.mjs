import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionOpenMetrics } from '../packages/ui/src/sessionOpenMetrics.ts';
import { normalizeUiDiagnostic } from '../packages/shared/src/uiDiagnostics.ts';

test('session metrics require matched data, navigation completion and paint; replaced requests cancel', () => {
  let now = 0; const events = []; const metrics = createSessionOpenMetrics(() => now);
  metrics.begin(1, {cwd:'private-workspace',path:'private-file'}, e => events.push(e));
  now = 10; metrics.snapshot('other', 'file'); metrics.rpc(1);
  metrics.settled(1, false); assert.equal(metrics.rendered('private-workspace','private-file'), null);
  now = 15; metrics.snapshot('private-workspace','private-file');
  now = 20; assert.equal(metrics.rendered('private-workspace','private-file'), 1);
  metrics.painted(0); assert.equal(events.length, 0);
  now = 25; metrics.painted(1);
  assert.equal(events[0].outcome, 'success');
  assert.deepEqual(events[0].phases, {rpcMs:10,snapshotMs:15,renderMs:5,paintMs:5});
  assert.equal(JSON.stringify(events).includes('private'), false);
  metrics.begin(2, {cwd:'private-workspace',path:'private-file'}, e => events.push(e));
  metrics.begin(3, {}, e => events.push(e));
  assert.equal(events[1].outcome, 'cancelled'); assert.equal(events[1].temperature, undefined);
  metrics.settled(3, true); assert.equal(events[2].outcome, 'failure');
  metrics.painted(3); assert.equal(events.length, 3);
});

test('temperature follows runtime ready metadata rather than earlier visits', () => {
  const events = [], metrics = createSessionOpenMetrics();
  for (const [request, resumeKind] of [[1, 'cold'], [2, 'warm'], [3, 'cold']]) {
    metrics.begin(request, {cwd:'workspace',path:'file'}, e => events.push(e));
    metrics.snapshot('workspace', 'file', 'session', resumeKind);
    metrics.settled(request, false);
    metrics.painted(metrics.rendered('workspace', 'file', 'session'));
  }
  assert.deepEqual(events.map(e => e.temperature), ['cold', 'warm', 'cold']);
  assert.ok(events.every(e => e.outcome === 'success'));
});

test('resident targets match the complete scope including unsaved session identity', () => {
  const events = [], metrics = createSessionOpenMetrics();
  metrics.begin(1, {cwd:'workspace',path:null,sessionId:'new-draft'}, e => events.push(e));
  metrics.snapshot('workspace', null, 'old-draft', 'warm');
  metrics.snapshot('workspace', 'saved-file', 'new-draft', 'warm');
  metrics.settled(1, false);
  assert.equal(metrics.rendered('workspace', null, 'old-draft'), null);
  assert.equal(metrics.rendered('workspace', null, 'new-draft'), null);
  metrics.snapshot('workspace', null, 'new-draft', 'warm');
  assert.equal(metrics.rendered('workspace', 'saved-file', 'new-draft'), null);
  metrics.painted(metrics.rendered('workspace', null, 'new-draft'));
  assert.equal(events[0].outcome, 'success');
});

test('only the already displayed explicit target can reuse a snapshot without a ready event', () => {
  const scope = {cwd:'workspace',path:'file',sessionId:'session'};
  const events = [], metrics = createSessionOpenMetrics();
  metrics.begin(1, scope, e => events.push(e), scope);
  metrics.reuseSnapshot(1, scope.cwd, scope.path, scope.sessionId);
  metrics.settled(1, false);
  metrics.painted(metrics.rendered(scope.cwd, scope.path, scope.sessionId));
  assert.equal(events[0].temperature, 'warm');
  for (const [request, target] of [[2, {}], [3, {cwd:'workspace'}], [4, {...scope,sessionId:'other'}]]) {
    metrics.begin(request, target, e => events.push(e), scope);
    metrics.reuseSnapshot(request, scope.cwd, scope.path, scope.sessionId);
    metrics.settled(request, false);
    assert.equal(metrics.rendered(scope.cwd, scope.path, scope.sessionId), null);
    metrics.cancel(request);
  }
  assert.deepEqual(events.map(e => e.outcome), ['success','cancelled','cancelled','cancelled']);
});

test('an earlier painted scope or bridge generation cannot finish the next navigation', () => {
  const events = [], metrics = createSessionOpenMetrics();
  metrics.begin(1, {}, e => events.push(e));
  metrics.snapshot('first-workspace', 'first-file', 'first-session');
  metrics.settled(1, false);
  const obsolete = metrics.rendered('first-workspace', 'first-file', 'first-session');
  metrics.cancel();
  // setBridge resets request IDs, but a queued animation frame still carries its old token.
  metrics.begin(1, {}, e => events.push(e));
  metrics.snapshot('second-workspace', 'second-file', 'second-session');
  metrics.settled(1, false);
  assert.equal(metrics.rendered('first-workspace', 'first-file', 'first-session'), null);
  const current = metrics.rendered('second-workspace', 'second-file', 'second-session');
  metrics.painted(obsolete);
  assert.equal(events.length, 1);
  metrics.painted(current);
  assert.deepEqual(events.map(e => e.outcome), ['cancelled','success']);
});

test('diagnostic input allowlists values and drops arbitrary messages, paths and credentials', () => {
  const base = {id:'test-12345678',scope:'conversation',kind:'render-error',outcome:'failure'};
  assert.deepEqual(normalizeUiDiagnostic({...base,password:'secret',message:'raw',code:'https://secret',phases:{rpcMs:1.239,snapshotMs:NaN,paintMs:-1,raw:'secret'}}), {...base,phases:{rpcMs:1.24}});
  for (const patch of [{id:'C:/private'}, {scope:'private'}, {kind:'raw'}, {outcome:'raw'}, {scope:['conversation']}, {kind:['render-error']}, {outcome:['failure']}]) assert.equal(normalizeUiDiagnostic({...base,...patch}), null);
});
