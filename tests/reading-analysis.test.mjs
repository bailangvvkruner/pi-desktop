import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedWords, diffWordRanges } from '../packages/ui/src/wordDiff.ts';
import { analyzeReading, splitHighlightedLines } from '../packages/ui/src/readingHighlight.ts';

test('word diff marks changed identifiers and Unicode while preserving equal text', () => {
  const before = 'const color = "深色";', after = 'const color = "浅色";';
  const [a, b] = changedWords(before, after);
  assert.equal(a.map(range => before.slice(range.start, range.end)).join(''), '深');
  assert.equal(b.map(range => after.slice(range.start, range.end)).join(''), '浅');
  assert.deepEqual(changedWords('same', 'same'), [[], []]);
  assert.deepEqual(changedWords('a'.repeat(5000), 'b'), [[], []]);
});
test('diff word pairing stays within adjacent replacement groups and retains prefix offsets', () => {
  const rows = [{ kind: 'removed', text: '-old value' }, { kind: 'added', text: '+new value' }, { kind: 'context', text: ' equal' }, { kind: 'added', text: '+fresh' }];
  const ranges = diffWordRanges(rows, 1);
  assert.equal(rows[0].text.slice(ranges[0][0].start, ranges[0][0].end), 'old');
  assert.equal(rows[1].text.slice(ranges[1][0].start, ranges[1][0].end), 'new');
  assert.equal(ranges[3], undefined);
});
test('background highlighting retains multiline comment spans and escapes raw HTML', () => {
  const result = analyzeReading({ text: '/* first\nsecond */\nconst html = "<script>";', path: 'a.ts', mode: 'text' });
  assert.match(result.html[0], /hljs-comment/);
  assert.match(result.html[1], /hljs-comment/);
  assert.match(result.html[2], /&lt;script&gt;/);
  assert.doesNotMatch(result.html.join(''), /<script>/);
  assert.deepEqual(splitHighlightedLines('<span class="x">a\nb</span>'), ['<span class="x">a</span>', '<span class="x">b</span>']);
  assert.deepEqual(analyzeReading({ text: 'x'.repeat(1_000_001), path: 'a.ts', mode: 'text' }), { html: [], words: {} });
});
