import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createErrorReport, redactErrorText } from '../packages/ui/src/errorReport.ts';

test('copied report removes credentials and nested conversation payloads but keeps useful failure context', () => {
  const error = 'Connection refused ECONNREFUSED\nAuthorization: Bearer secret-value\n' + JSON.stringify({ status: 503, request: { messages: [{ role: 'user', content: 'private conversation' }], api_key: 'private-key' }, endpoint: 'https://user:pass@example.com/api?token=private-query' });
  const report = createErrorReport(error, 'conversation', 'operation-error', 'error');
  assert.match(report.text, /ECONNREFUSED/);
  for (const secret of ['secret-value', 'private conversation', 'private-key', 'private-query', 'user:pass']) assert.ok(!report.text.includes(secret));
  assert.match(report.text, /503/);
  assert.equal(report.diagnostic.id, report.id);
  assert.deepEqual(Object.keys(report.diagnostic).sort(), ['id', 'kind', 'outcome', 'scope']);
  assert.ok(!JSON.stringify(report.diagnostic).includes('ECONNREFUSED'));
});

test('redaction handles malformed responses and bounds unusually large payloads', () => {
  const error = '400 Bad request\n{"api_key":"hidden-key", "messages":[{"content":"private text"';
  const text = redactErrorText(error);
  assert.match(text, /400 Bad request/);
  assert.doesNotMatch(text, /hidden-key|private text/);
  assert.doesNotMatch(redactErrorText('Request failed\nRequest body:\nprivate prompt\nprivate continuation'), /private/);
  assert.doesNotMatch(redactErrorText('Command failed: cli --password "hidden password" --token secret-token'), /hidden password|secret-token/);
  const large = redactErrorText('{'.repeat(100000));
  assert.ok(large.length < 65000);
  assert.match(large, /omitted|truncated/);
});
