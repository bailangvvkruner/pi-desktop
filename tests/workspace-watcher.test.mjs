import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { classifyWorkspaceChange, createWorkspaceWatcher } from '../packages/desktop/src/main/workspaceWatcher.ts';

test('watcher classification keeps tree and Git signals apart and ignores dependency churn', () => {
  assert.deepEqual(classifyWorkspaceChange('src/app.ts'), { files: true, git: true });
  assert.deepEqual(classifyWorkspaceChange('src\\app.ts'), { files: true, git: true });
  assert.deepEqual(classifyWorkspaceChange('.git/index'), { files: false, git: true });
  assert.deepEqual(classifyWorkspaceChange('.git\\refs\\heads\\main'), { files: false, git: true });
  assert.deepEqual(classifyWorkspaceChange('.git/HEAD'), { files: false, git: true });
  assert.equal(classifyWorkspaceChange('.git/objects/ab/cdef'), null);
  assert.equal(classifyWorkspaceChange('.git/index.lock'), null);
  assert.equal(classifyWorkspaceChange('node_modules/react/index.js'), null);
  assert.equal(classifyWorkspaceChange('packages/ui/node_modules/x'), null);
  assert.deepEqual(classifyWorkspaceChange(null), { files: true, git: true });
});

test('watcher debounces bursts into one event for the watched workspace and stops cleanly', async (t) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'pi-desktop-watch-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  const events = [];
  const watcher = createWorkspaceWatcher((event) => events.push(event));
  watcher.watch(root);
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (let index = 0; index < 5; index += 1) writeFileSync(join(root, 'src', `f${index}.txt`), String(index));
  const deadline = Date.now() + 5000;
  while (!events.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(events.length, 1, 'a burst of writes produces a single debounced event');
  assert.deepEqual(events[0], { cwd: root, files: true, git: true });
  watcher.stop();
  writeFileSync(join(root, 'after-stop.txt'), 'x');
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(events.length, 1, 'no events after stop');
});
