import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  do { if (predicate()) return true; await delay(10); } while (Date.now() < deadline);
  return false;
}

/** A real local HTTP stream stays open until the test explicitly ends reasoning. */
async function fixture(t, deltaType, { initialDeltas = ['First exposed reasoning. ', 'Second exposed reasoning.'], laterDeltas = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pi-thinking-stream-'));
  const cwd = join(root, 'project'); await mkdir(cwd);
  const saved = new Map(['PI_CODING_AGENT_DIR', 'PI_OFFLINE'].map(key => [key, process.env[key]]));
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent'); process.env.PI_OFFLINE = '1';
  const firstDelta = deferred(), continueThinking = deferred(), finish = deferred(), requests = [], sockets = new Set();
  const reasoningText = [...initialDeltas, ...laterDeltas].join('');
  const finalText = 'Completed local stream.';
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    requests.push({ url: request.url, body: JSON.parse(raw) });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    const reasoning = { id: 'reasoning-local', type: 'reasoning', summary: [{ type: 'summary_text', text: reasoningText }] };
    const answer = { id: 'answer-local', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: finalText, annotations: [] }] };
    send({ type: 'response.created', response: { id: 'response-local', status: 'in_progress', output: [] } });
    send({ type: 'response.output_item.added', output_index: 0, item: { ...reasoning, summary: [] } });
    for (const delta of initialDeltas) {
      send({ type: deltaType, item_id: reasoning.id, output_index: 0, summary_index: 0, content_index: 0, delta });
    }
    response.flushHeaders(); firstDelta.resolve();
    if (laterDeltas.length) {
      await continueThinking.promise;
      if (response.destroyed) return;
      for (const delta of laterDeltas) {
        send({ type: deltaType, item_id: reasoning.id, output_index: 0, summary_index: 0, content_index: 0, delta });
      }
    }
    await finish.promise;
    if (response.destroyed) return;
    send({ type: 'response.output_item.done', output_index: 0, item: reasoning });
    send({ type: 'response.output_item.added', output_index: 1, item: { ...answer, status: 'in_progress', content: [] } });
    send({ type: 'response.output_text.delta', output_index: 1, item_id: answer.id, content_index: 0, delta: finalText });
    send({ type: 'response.output_item.done', output_index: 1, item: answer });
    send({ type: 'response.completed', response: { id: 'response-local', status: 'completed', output: [reasoning, answer], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } } });
    response.end();
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let service;
  t.after(async () => {
    continueThinking.resolve();
    finish.resolve();
    await service?.dispose();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of saved) value === undefined ? delete process.env[key] : process.env[key] = value;
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  });
  const { AgentService } = await import('../packages/agent/src/index.ts');
  service = new AgentService(async () => ({ trusted: true, remember: false }));
  await service.init({ cwd });
  await service.saveCustomProvider({ provider: 'thinking-stream-fixture', name: 'Thinking Stream Fixture',
    api: 'openai-responses', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-fixture-key', mode: 'create',
    models: [{ id: 'thinking-model', name: 'Thinking Model', reasoning: true, input: ['text'], contextWindow: 32000, maxTokens: 1024 }] });
  await service.setModel('thinking-stream-fixture', 'thinking-model');
  await service.setThinkingLevel('high');
  const events = [];
  service.onEvent(({ event }) => events.push(structuredClone(event)));
  await service.prompt('Use this synthetic stream to verify live reasoning.');
  assert.ok(await waitFor(() => requests.length === 1), 'the real AgentService must reach the local Responses endpoint');
  await firstDelta.promise;
  const restore = async () => {
    const sessionPath = service.getSnapshot().sessionPath;
    assert.ok(sessionPath, 'the completed response must have a persisted session');
    await service.dispose();
    service = new AgentService();
    await service.init({ cwd, sessionPath });
    return service.getSnapshot();
  };
  return { service, events, requests, continueThinking, finish, reasoningText, finalText, restore };
}

test('real Responses SSE keeps exposing latest reasoning after the retained window is full', async t => {
  const initial = 'OLD_START\n' + 'Earlier exposed reasoning. '.repeat(2000);
  const latest = '\nLatest reasoning arrived after the length limit.';
  const f = await fixture(t, 'response.reasoning_summary_text.delta', { initialDeltas: [initial], laterDeltas: [latest] });
  const initialTail = initial.slice(-48_000);
  assert.ok(await waitFor(() => f.events.some(event => event.type === 'assistant-thinking'
    && event.thinking === initialTail && event.thinkingTruncated)), 'the first live projection retains the bounded latest reasoning');
  assert.equal(f.service.getSnapshot().status, 'busy');
  assert.ok(!f.events.some(event => event.type === 'assistant-end'));

  const firstEventCount = f.events.length;
  f.continueThinking.resolve();
  const expectedTail = f.reasoningText.slice(-48_000);
  assert.ok(await waitFor(() => f.events.slice(firstEventCount).some(event => event.type === 'assistant-thinking'
    && event.thinking === expectedTail && event.thinkingStatus === 'streaming' && event.thinkingTruncated)),
  'a second live projection exposes new reasoning before assistant completion, even at the same retained length');
  assert.ok(!f.events.some(event => event.type === 'assistant-end'), 'the stream is still open when its new tail reaches the renderer');
  const live = f.service.getSnapshot().messages.at(-1);
  assert.equal(live.thinking, expectedTail);
  assert.equal(live.thinking.length, initialTail.length);
  assert.equal(live.thinkingTruncated, true);
  assert.ok(live.thinking.endsWith(latest));
  assert.ok(!live.thinking.includes('OLD_START'));

  f.finish.resolve();
  assert.ok(await waitFor(() => f.service.getSnapshot().status === 'idle'));
  const ended = f.events.findLast(event => event.type === 'assistant-end');
  assert.equal(ended.thinking, expectedTail);
  assert.equal(ended.thinkingStatus, 'done');
  assert.equal(ended.thinkingTruncated, true);
  assert.equal(ended.text, f.finalText);
  const restored = (await f.restore()).messages.at(-1);
  assert.equal(restored.thinking, expectedTail, 'reopening the persisted session restores the same latest reasoning');
  assert.equal(restored.thinkingStatus, 'done');
  assert.equal(restored.thinkingTruncated, true);
  assert.equal(restored.text, f.finalText);
});

for (const deltaType of ['response.reasoning_summary_text.delta', 'response.reasoning_text.delta', 'response.reasoning.delta']) {
  test(`real Responses SSE exposes ${deltaType} before assistant completion`, async t => {
    const f = await fixture(t, deltaType);
    const live = await waitFor(() => f.events.some(event => event.type === 'assistant-thinking' && event.thinking === f.reasoningText), 1000);
    // Capture before opening the terminal half of the stream. Looking only at
    // restored history misses regressions where final output masks dropped deltas.
    const before = { events: f.events.map(event => event.type), snapshot: f.service.getSnapshot() };
    f.finish.resolve();
    assert.ok(await waitFor(() => f.service.getSnapshot().status === 'idle'), 'the synthetic response should finish normally');
    assert.equal(f.requests[0].url, '/v1/responses');
    assert.equal(f.requests[0].body.stream, true);
    assert.equal(f.requests[0].body.reasoning.summary, 'auto');
    assert.equal(f.requests[0].body.reasoning.effort, 'high');
    assert.equal(f.service.getSnapshot().messages.at(-1).thinking, f.reasoningText, 'final history retains exposed reasoning');
    assert.equal(f.service.getSnapshot().messages.at(-1).text, f.finalText);
    assert.equal(before.snapshot.status, 'busy');
    assert.ok(!before.events.includes('assistant-end'), 'the live checkpoint precedes assistant completion');
    assert.ok(live, `reasoning must reach the renderer before completion; observed event types: ${before.events.join(', ')}`);
    assert.equal(before.snapshot.messages.at(-1).thinking, f.reasoningText);
    assert.equal(before.snapshot.messages.at(-1).thinkingStatus, 'streaming');
  });
}
