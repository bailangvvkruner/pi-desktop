import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countOccurrences, findChangeMatches } from '../packages/ui/src/changesFind.ts';

function change(path, diff) {
  return { path, kind: 'modified', additions: 1, deletions: 0, diff };
}

test('matches inside diffs and paths, case-insensitively', () => {
  const result = findChangeMatches([
    change('src/app.ts', '+const retryCount = 2;\n-const retryCount = 1;'),
    change('docs/README.md', 'No hits here'),
    change('lib/retry.ts', '+// retry logic'),
  ], 'RETRY');
  // src/app.ts: two diff hits; lib/retry.ts: one path hit + one diff hit.
  assert.equal(result.total, 4);
  assert.deepEqual(result.files.map(file => file.path), ['src/app.ts', 'lib/retry.ts']);
  assert.deepEqual(result.files.map(file => file.count), [2, 2]);
});

test('empty or blank queries return no matches', () => {
  assert.deepEqual(findChangeMatches([change('a.ts', '+retry')], '   '), { files: [], total: 0 });
  assert.deepEqual(findChangeMatches([change('a.ts', '+retry')], ''), { files: [], total: 0 });
});

test('changes without diffs still match on their path', () => {
  const result = findChangeMatches([{ path: 'images/logo.png', kind: 'added', additions: null, deletions: null, diff: null, preview: 'binary' }], 'logo');
  assert.equal(result.total, 1);
  assert.equal(result.files[0].path, 'images/logo.png');
});

test('countOccurrences counts literal, non-overlapping hits', () => {
  assert.equal(countOccurrences('aXaXaX', 'ax'), 3);
  assert.equal(countOccurrences('www', 'ww'), 1);
  assert.equal(countOccurrences('abc', ''), 0);
});
