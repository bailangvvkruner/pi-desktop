import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { createProjectCreator, validateProjectName } from '../packages/desktop/src/main/projectCreation.ts';

async function fixture(t) {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(join(temp, 'pi-project-create-'));
  t.after(async () => {
    assert.equal(dirname(root), temp);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test('project names reject traversal, invalid Windows names and oversized directory components', () => {
  for (const value of [undefined, null, {}, 5, '', '  ', '.', '..', '../outside', '..\\outside', 'a/b', 'a\\b', 'C:project', 'a\0b', 'a\nb', 'a?b', 'a*b', '<name>', 'a|b', 'a"b', 'name.', 'name ', 'CON', 'con.txt', 'NUL', 'COM1', 'lpt9.md', 'COM¹', 'CONOUT$', 'x'.repeat(121), '项'.repeat(86)]) {
    assert.throws(() => validateProjectName(value, 'zh-CN'), Error, String(value));
  }
  for (const name of ['我的项目', 'project name', 'project.v2', '.project', 'COM10', 'console', 'x'.repeat(120), '项'.repeat(85)]) {
    assert.equal(validateProjectName(name, 'zh-CN'), name);
  }
  assert.throws(() => validateProjectName('', 'en-US'), /Enter a project name/);
  assert.throws(() => validateProjectName('COM1', 'en-US'), /reserved by Windows/);
});

test('project creation makes a new documents subfolder, registers it and never accepts existing files or directories', async (t) => {
  const root = await fixture(t);
  const projects = join(root, 'Documents', 'Pi Desktop');
  const registered = [];
  const create = createProjectCreator({ getProjectsDirectory: () => projects, getLocale: () => 'zh-CN', register: async (cwd) => { registered.push(cwd); } });
  const project = join(projects, '我的项目');
  assert.equal(await create('我的项目'), project);
  assert.equal((await lstat(project)).isDirectory(), true);
  assert.deepEqual(registered, [project]);
  await writeFile(join(project, 'keep.txt'), 'user files');
  await assert.rejects(create('我的项目'), /已存在同名/);
  assert.equal(await readFile(join(project, 'keep.txt'), 'utf8'), 'user files');
  await writeFile(join(projects, 'file'), 'existing file');
  await assert.rejects(create('file'), /已存在同名/);
  assert.equal(await readFile(join(projects, 'file'), 'utf8'), 'existing file');
  assert.deepEqual(registered, [project]);
});

test('invalid names never create the parent directory or invoke registration', async (t) => {
  const root = await fixture(t);
  const projects = join(root, 'projects');
  const create = createProjectCreator({ getProjectsDirectory: () => projects, getLocale: () => 'zh-CN', register: async () => assert.fail('invalid project must not register') });
  await assert.rejects(create('../outside'), /项目名称/);
  assert.deepEqual(await readdir(root), []);
});

test('a registration failure safely retries its own directory and preserves any user files', async (t) => {
  const root = await fixture(t);
  const project = join(root, 'retry');
  let calls = 0;
  const create = createProjectCreator({ getProjectsDirectory: () => root, getLocale: () => 'en-US', register: async (cwd) => { assert.equal(cwd, project); if (++calls === 1) throw new Error('disk write failed'); } });
  await assert.rejects(create('retry'), /folder was created.*Retry/);
  await writeFile(join(project, 'keep.txt'), 'user files');
  assert.equal(await create('retry'), project);
  assert.equal(await readFile(join(project, 'keep.txt'), 'utf8'), 'user files');
  assert.equal(calls, 2);
  await assert.rejects(create('retry'), /already exists/);
});

test('retry cannot adopt a directory replaced by another directory or a junction', async (t) => {
  const root = await fixture(t);
  let calls = 0;
  const create = createProjectCreator({ getProjectsDirectory: () => root, getLocale: () => 'zh-CN', register: async () => { calls++; throw new Error('save failed'); } });
  await assert.rejects(create('replaced'), /文件夹已创建/);
  await rename(join(root, 'replaced'), join(root, 'original'));
  await mkdir(join(root, 'replaced'));
  await writeFile(join(root, 'replaced', 'keep.txt'), 'replacement content');
  await assert.rejects(create('replaced'), /已存在同名/);
  assert.equal(calls, 1);
  assert.equal(await readFile(join(root, 'replaced', 'keep.txt'), 'utf8'), 'replacement content');
  await assert.rejects(create('linked'), /文件夹已创建/);
  await rename(join(root, 'linked'), join(root, 'linked-original'));
  await symlink(join(root, 'original'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(create('linked'), /已存在同名/);
  assert.equal(calls, 2);
});

test('simultaneous creates cannot overwrite or register a same-name project twice', async (t) => {
  const root = await fixture(t);
  const registered = [];
  const create = createProjectCreator({ getProjectsDirectory: () => root, getLocale: () => 'zh-CN', register: async (cwd) => { registered.push(cwd); } });
  const results = await Promise.allSettled([create('same'), create('same')]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /已存在同名/);
  assert.deepEqual(registered, [join(root, 'same')]);
});
