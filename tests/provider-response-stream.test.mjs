import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeResponsesReasoningStream } from '../packages/agent/src/providerResponseStream.ts';

const encoder = new TextEncoder();
const alias = 'response.reasoning.delta';
const standard = 'response.reasoning_text.delta';
const frame = (type = alias, delta = '正在思考') => `event: ${type}\ndata: ${JSON.stringify({ type, output_index: 0, item_id: 'reasoning-1', delta })}\n\n`;
const response = (body, options = {}) => new Response(body, { headers: { 'content-type': 'text/event-stream' }, ...options });
const chunks = (bytes, size) => new ReadableStream({
  start(controller) { for (let offset = 0; offset < bytes.length; offset += size) controller.enqueue(bytes.slice(offset, offset + size)); controller.close(); },
});

test('the first reasoning delta reaches the reader while the upstream stream is still open', { timeout: 2000 }, async () => {
  let upstream;
  let cancelled;
  const source = new ReadableStream({ start(controller) { upstream = controller; }, cancel(reason) { cancelled = reason; } });
  const reader = normalizeResponsesReasoningStream(response(source)).body.getReader();
  upstream.enqueue(encoder.encode(frame()));
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.equal(new TextDecoder().decode(first.value), frame(standard));
  await reader.cancel('stop after first token');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, 'stop after first token', 'consumer cancellation reaches the original response body');
});

test('standard reasoning, signatures, final results, unrelated types and malformed frames remain byte-for-byte intact', async () => {
  const input = frame(standard) + frame('response.reasoning_summary_text.delta')
    + 'data: {"type":"response.reasoning.delta","delta":null}\n\n'
    + 'data: {"type":"response.completed","response":{"signature":"response.reasoning.delta","id":9007199254740993}}\n\n'
    + 'data: {invalid JSON}\n\ndata: [DONE]\n\n';
  assert.equal(await normalizeResponsesReasoningStream(response(input)).text(), input);
});

test('UTF-8, CRLF and multiline JSON survive every network byte boundary with only the alias fields changed', async () => {
  const input = '\uFEFF: keepalive\r\nevent: response.reasoning.delta\r\nid: 7\r\n'
    + 'data: {"delta":"中文💡","nested":{"type":"response.reasoning.delta"},\r\n'
    + 'data: "type" : "response.reasoning.delta", "signature":"opaque-response.reasoning.delta", "id":9007199254740993}\r\n\r\n'
    + 'event: response.completed\r\ndata: {"type":"response.completed","response":{"output":[]}}\r\n\r\n';
  const expected = input.replace('event: response.reasoning.delta', 'event: response.reasoning_text.delta')
    .replace('"type" : "response.reasoning.delta"', '"type" : "response.reasoning_text.delta"');
  for (const size of [1, 2, 3, 17, 64, 1024]) {
    const actual = await normalizeResponsesReasoningStream(response(chunks(encoder.encode(input), size))).arrayBuffer();
    assert.deepEqual(Buffer.from(actual), Buffer.from(expected), `chunk size ${size}`);
  }
});

test('LF, CRLF and CR frames normalize independently across a mixed stream', async () => {
  const input = ['\n', '\r\n', '\r'].map(newline => frame().replaceAll('\n', newline)).join('');
  const expected = ['\n', '\r\n', '\r'].map(newline => frame(standard).replaceAll('\n', newline)).join('');
  assert.equal(await normalizeResponsesReasoningStream(response(chunks(encoder.encode(input), 7))).text(), expected);
});

test('large frames pass through before completion and normalization resumes on the following frame', { timeout: 2000 }, async () => {
  let upstream;
  const reader = normalizeResponsesReasoningStream(response(new ReadableStream({ start(controller) { upstream = controller; } }))).body.getReader();
  const prefix = 'data: {"type":"response.completed","padding":"' + 'x'.repeat(80 * 1024);
  upstream.enqueue(encoder.encode(prefix));
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), prefix, 'an unfinished large frame must not buffer the response');
  upstream.enqueue(encoder.encode('"}\n\n' + frame()));
  upstream.close();
  let tail = '';
  for (;;) { const result = await reader.read(); if (result.done) break; tail += new TextDecoder().decode(result.value); }
  assert.equal(tail, '"}\n\n' + frame(standard));
});

test('upstream abort errors reach pending readers without fabricating a final event', async () => {
  let upstream;
  const reader = normalizeResponsesReasoningStream(response(new ReadableStream({ start(controller) { upstream = controller; } }))).body.getReader();
  const pending = reader.read();
  const aborted = new DOMException('The request was aborted', 'AbortError');
  upstream.error(aborted);
  await assert.rejects(pending, error => error === aborted);
});

test('response metadata is retained while stale length is removed and ineligible responses are untouched', async () => {
  const original = response(frame(), { status: 201, statusText: 'Created', headers: { 'content-type': 'Text/Event-Stream; charset=utf-8', 'content-length': '123', 'x-provider-request': 'request-7' } });
  Object.defineProperties(original, { url: { value: 'https://provider.invalid/v1/responses' }, redirected: { value: true }, type: { value: 'cors' } });
  const normalized = normalizeResponsesReasoningStream(original);
  assert.equal(normalized.status, 201);
  assert.equal(normalized.statusText, 'Created');
  assert.equal(normalized.url, original.url);
  assert.equal(normalized.redirected, true);
  assert.equal(normalized.type, 'cors');
  assert.equal(normalized.headers.get('x-provider-request'), 'request-7');
  assert.equal(normalized.headers.get('content-length'), null);
  assert.equal(await normalized.text(), frame(standard));
  for (const source of [response(frame(), { status: 400 }), new Response(frame(), { headers: { 'content-type': 'application/json' } }), new Response(null, { status: 204 })]) {
    assert.equal(normalizeResponsesReasoningStream(source), source);
  }
});
