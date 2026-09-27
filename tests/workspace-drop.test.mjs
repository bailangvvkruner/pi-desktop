import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { prepareWorkspaceDrop } from '../packages/desktop/src/main/workspaceDrop.ts';

async function fixture(t) {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(join(temp, 'pi-workspace-drop-'));
  t.after(async () => {
    assert.equal(dirname(root), temp);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test('native folder drops accept directories, ignore files and deduplicate aliases', async (t) => {
  const root = await fixture(t);
  const project = join(root, '项目 folder');
  const alias = join(root, 'alias');
  const file = join(root, 'readme.md');
  await mkdir(project);
  await symlink(project, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(file, '# project');
  const canonical = await realpath(project);
  assert.deepEqual(await prepareWorkspaceDrop([file, project, alias, project], []), {
    workspaces: [canonical], accepted: [canonical], added: [canonical],
  });
  assert.deepEqual(await prepareWorkspaceDrop([file], []), { workspaces: [], accepted: [], added: [] });
  assert.deepEqual(await prepareWorkspaceDrop([], []), { workspaces: [], accepted: [], added: [] });
});

test('re-dropping a saved project preserves its registered identity and stale projects', async (t) => {
  const root = await fixture(t);
  const project = join(root, 'project');
  const alias = join(root, 'saved-alias');
  const fresh = join(root, 'fresh');
  const missing = join(root, 'removed-project');
  await Promise.all([mkdir(project), mkdir(fresh)]);
  await symlink(project, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const canonical = await realpath(fresh);
  assert.deepEqual(await prepareWorkspaceDrop([project, fresh], [alias, missing]), {
    workspaces: [alias, missing, canonical], accepted: [alias, canonical], added: [canonical],
  });
  if (process.platform === 'win32') {
    assert.deepEqual((await prepareWorkspaceDrop([project.toUpperCase()], [alias])).accepted, [alias]);
  }
});

test('invalid drop batches reject before the caller can register any folder', async (t) => {
  const root = await fixture(t);
  const project = join(root, 'project');
  await mkdir(project);
  for (const value of [null, {}, 'project', [null], [''], ['relative-folder'], [`${project}\0`], Array(257).fill(project)]) {
    await assert.rejects(prepareWorkspaceDrop(value, []), /项目路径无效/);
  }
  const registered = [project];
  await assert.rejects(prepareWorkspaceDrop([project, join(root, 'missing')], registered), /无法读取拖入的文件夹/);
  assert.deepEqual(registered, [project]);
});
