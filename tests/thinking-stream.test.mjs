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
async function fixture(t, deltaType) {
  const root = await mkdtemp(join(tmpdir(), 'pi-thinking-stream-'));
  const cwd = join(root, 'project'); await mkdir(cwd);
  const saved = new Map(['PI_CODING_AGENT_DIR', 'PI_OFFLINE'].map(key => [key, process.env[key]]));
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent'); process.env.PI_OFFLINE = '1';
  const firstDelta = deferred(), finish = deferred(), requests = [], sockets = new Set();
  const reasoningText = 'First exposed reasoning. Second exposed reasoning.';
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
    for (const delta of ['First exposed reasoning. ', 'Second exposed reasoning.']) {
      send({ type: deltaType, item_id: reasoning.id, output_index: 0, summary_index: 0, content_index: 0, delta });
    }
    response.flushHeaders(); firstDelta.resolve();
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
  return { service, events, requests, finish, reasoningText, finalText };
}

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
