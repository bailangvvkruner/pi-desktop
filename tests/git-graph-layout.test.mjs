import assert from 'node:assert/strict';
import { test } from 'node:test';

import { layoutGitGraph } from '../packages/ui/src/gitGraphLayout.ts';

test('linear history stays on a single lane', () => {
  const commits = [
    { hash: 'c3', parents: ['c2'] },
    { hash: 'c2', parents: ['c1'] },
    { hash: 'c1', parents: [] },
  ];
  const layout = layoutGitGraph(commits);
  assert.deepEqual(layout.lanes, [0, 0, 0]);
  assert.equal(layout.laneCount, 1);
  for (const edge of layout.edges) {
    assert.equal(edge.loaded, true);
    assert.equal(edge.fromLane, 0);
    assert.equal(edge.toLane, 0);
  }
});

test('a branch and its merge produce two lanes that reconverge', () => {
  // main:    m1 -- m2 -- m4 (merge)
  // branch:        \-- b1 -/
  const commits = [
    { hash: 'm4', parents: ['m2', 'b1'] },
    { hash: 'b1', parents: ['m2'] },
    { hash: 'm2', parents: ['m1'] },
    { hash: 'm1', parents: [] },
  ];
  const layout = layoutGitGraph(commits);
  // The merge commit and main sit on lane 0; the side branch gets lane 1.
  assert.equal(layout.lanes[0], 0);
  assert.equal(layout.lanes[1], 1);
  assert.equal(layout.lanes[2], 0);
  assert.equal(layout.lanes[3], 0);
  assert.equal(layout.laneCount, 2);
  // Both merge edges land on the merge row and stay loaded.
  const mergeEdges = layout.edges.filter(edge => edge.fromIndex === 0);
  assert.equal(mergeEdges.length, 2);
  assert.ok(mergeEdges.every(edge => edge.loaded));
});

test('parents outside the loaded window end in dashed overflow edges', () => {
  const commits = [{ hash: 'c1', parents: ['root'] }];
  const layout = layoutGitGraph(commits);
  assert.equal(layout.edges.length, 1);
  assert.equal(layout.edges[0].loaded, false);
  assert.equal(layout.edges[0].toIndex, -1);
});

test('an orphan commit with no parents produces no edges', () => {
  const layout = layoutGitGraph([{ hash: 'init', parents: [] }]);
  assert.deepEqual(layout.edges, []);
  assert.deepEqual(layout.lanes, [0]);
});

test('two independent branches reuse freed lanes', () => {
  const commits = [
    { hash: 'b2', parents: ['b1'] },
    { hash: 'a2', parents: ['a1'] },
    { hash: 'b1', parents: [] },
    { hash: 'a1', parents: [] },
  ];
  const layout = layoutGitGraph(commits);
  assert.ok(layout.laneCount <= 2);
  // Only b2→b1 and a2→a1 carry edges; roots have no parents.
  assert.equal(layout.edges.length, 2);
});
