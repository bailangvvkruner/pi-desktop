import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestReadingAnalysis } from '../packages/ui/src/readingWorkerPool.ts';

test('background reader caps workers, cancels stale work, reuses workers and falls back on failure', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previous = globalThis.Worker;
  const workers = [];
  class FakeWorker {
    constructor() { this.inputs = []; this.terminated = false; workers.push(this); }
    postMessage(value) { this.inputs.push(value); }
    terminate() { this.terminated = true; }
    complete(value) { this.onmessage({ data: value }); }
  }
  globalThis.Worker = FakeWorker;
  t.after(() => { t.mock.timers.tick(30_000); globalThis.Worker = previous; });
  const received = [];
  const enqueue = text => requestReadingAnalysis({ text, path: 'a.ts', mode: 'text' }, value => received.push({ text, value }));
  const cancelA = enqueue('A'); enqueue('B'); enqueue('C');
  assert.equal(workers.length, 2);
  assert.deepEqual(workers.map(worker => worker.inputs[0].text), ['A', 'B']);
  cancelA();
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[2].inputs[0].text, 'C');
  workers[0].complete({ html: ['stale'], words: {} });
  assert.equal(received.length, 0);
  workers[1].complete({ html: ['B'], words: {} });
  enqueue('D');
  assert.equal(workers.length, 3);
  assert.equal(workers[1].inputs.at(-1).text, 'D');
  workers[1].onerror();
  assert.deepEqual(received.at(-1), { text: 'D', value: { html: [], words: {} } });
  workers[2].complete({ html: ['C'], words: {} });
  t.mock.timers.tick(5001);
  assert.equal(workers.every(worker => worker.terminated), true);
});
