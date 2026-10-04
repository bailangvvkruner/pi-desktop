import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendCodeQuote, codeQuoteLocation, formatCodeQuote, isCodeQuote } from '../packages/ui/src/codeQuote.ts';

test('code quotes carry their location and a language fence', () => {
  assert.equal(codeQuoteLocation({ path: 'src/a.ts', startLine: 12, endLine: 18 }), 'src/a.ts:12-18');
  assert.equal(codeQuoteLocation({ path: 'src/a.ts', startLine: 7, endLine: 7 }), 'src/a.ts:7');
  assert.equal(codeQuoteLocation({ path: 'src/a.ts' }), 'src/a.ts');
  const { block, source } = formatCodeQuote({ cwd: '/w', path: 'src/a.ts', startLine: 3, endLine: 4, text: 'const a = 1;\nconst b = 2;\n' });
  assert.equal(source, 'src/a.ts:3-4');
  assert.equal(block, '[src/a.ts:3-4]\n```ts\nconst a = 1;\nconst b = 2;\n```\n');
  assert.match(formatCodeQuote({ cwd: '/w', path: 'x.ts', text: '+a\n-b', diff: true }).block, /^\[x\.ts\]\n```diff\n/);
});

test('fences outgrow backticks inside the quoted code and drafts get a blank-line separator', () => {
  const { block } = formatCodeQuote({ cwd: '/w', path: 'README.md', startLine: 1, endLine: 3, text: '```js\ncode\n```' });
  assert.ok(block.startsWith('[README.md:1-3]\n````markdown\n'));
  assert.ok(block.endsWith('\n````\n'));
  assert.equal(appendCodeQuote('Please review', { cwd: '/w', path: 'a.py', startLine: 2, endLine: 2, text: 'x = 1' }).text, 'Please review\n\n[a.py:2]\n```python\nx = 1\n```\n');
  assert.equal(appendCodeQuote('', { cwd: '/w', path: 'a', text: 'x' }).text, '[a]\n```\nx\n```\n');
});

test('only well-formed quotes are accepted from window events', () => {
  assert.equal(isCodeQuote({ cwd: '/w', path: 'a.ts', text: 'x', startLine: 1, endLine: 2 }), true);
  for (const value of [null, {}, { cwd: '/w', path: '', text: 'x' }, { cwd: '/w', path: 'a', text: '   ' }, { cwd: '/w', path: 'a', text: 'x', startLine: 0 }, { cwd: 1, path: 'a', text: 'x' }]) {
    assert.equal(isCodeQuote(value), false);
  }
});
