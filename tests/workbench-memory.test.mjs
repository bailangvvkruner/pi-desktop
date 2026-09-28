import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkbenchMemoryStore, workspaceMemoryKey } from '../packages/ui/src/workbenchMemory.ts';

test('workbench remembers each workspace independently and survives serialization', () => {
  const store = new WorkbenchMemoryStore();
  const a = { tab: 'git', directory: 'src', selectedFile: 'src/app.ts', diffPath: 'src/app.ts', diffSource: 'staged' };
  store.write('C:\\Work\\A\\', a);
  store.write('C:/Work/B', { ...a, tab: 'files', selectedFile: 'README.md', diffSource: 'unstaged' });
  assert.deepEqual(store.read('c:/work/a'), a);
  assert.equal(store.read('C:/Work/B').selectedFile, 'README.md');
  assert.equal(new WorkbenchMemoryStore(store.serialize()).read('C:/Work/A').diffSource, 'staged');
  assert.notEqual(workspaceMemoryKey('/work/A'), workspaceMemoryKey('/work/a'));
});
test('workbench cache is bounded and rejects unsafe restored paths', () => {
  const store = new WorkbenchMemoryStore();
  for (let i = 0; i < 60; i++) store.write(`/work/${i}`, { tab: 'git', directory: 'src', selectedFile: 'src/app.ts', diffPath: null, diffSource: 'unstaged' });
  assert.equal(JSON.parse(store.serialize()).length, 50);
  assert.equal(store.read('/work/0').tab, 'files');
  assert.equal(store.read('/work/59').tab, 'git');
  const invalid = new WorkbenchMemoryStore(JSON.stringify([['/work/bad', { tab: 'wrong', directory: '../escape', selectedFile: 'C:/secret', diffPath: '/etc/passwd' }]]));
  assert.deepEqual(invalid.read('/work/bad'), { tab: 'files', directory: '', selectedFile: null, diffPath: null, diffSource: 'unstaged' });
  assert.equal(new WorkbenchMemoryStore('broken').read('/work').tab, 'files');
});
