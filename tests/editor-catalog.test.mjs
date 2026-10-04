import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { detectEditors, editorArguments, EDITOR_DEFINITIONS } from '../packages/desktop/src/main/editorCatalog.ts';

const definition = (id) => EDITOR_DEFINITIONS.find((item) => item.id === id);

test('each editor family receives its own file:line syntax; folders open plainly', () => {
  assert.deepEqual(editorArguments(definition('cursor'), 'C:\\w\\a.ts', 12, 4), ['-g', 'C:\\w\\a.ts:12:4']);
  assert.deepEqual(editorArguments(definition('vscode'), 'C:\\w\\a.ts', 12), ['-g', 'C:\\w\\a.ts:12']);
  assert.deepEqual(editorArguments(definition('idea'), '/w/A.java', 7, 3), ['--line', '7', '--column', '3', '/w/A.java']);
  assert.deepEqual(editorArguments(definition('zed'), '/w/a.rs', 9), ['/w/a.rs:9']);
  assert.deepEqual(editorArguments(definition('sublime'), '/w/a.py'), ['/w/a.py']);
  assert.deepEqual(editorArguments(definition('windows-terminal'), 'C:\\w'), ['-d', 'C:\\w']);
  assert.deepEqual(editorArguments(definition('webstorm'), 'C:\\w'), ['C:\\w']);
  assert.equal(new Set(EDITOR_DEFINITIONS.map((item) => item.id)).size, EDITOR_DEFINITIONS.length, 'ids are unique');
});

test('Windows detection finds per-user installs and versioned JetBrains folders', { skip: process.platform !== 'win32' }, async (t) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'pi-desktop-editors-')));
  const saved = { LOCALAPPDATA: process.env.LOCALAPPDATA, ProgramFiles: process.env.ProgramFiles };
  t.after(() => { Object.assign(process.env, saved); rmSync(root, { recursive: true, force: true }); });
  const local = join(root, 'Local'), programFiles = join(root, 'Program Files');
  mkdirSync(join(local, 'Programs', 'cursor'), { recursive: true });
  writeFileSync(join(local, 'Programs', 'cursor', 'Cursor.exe'), '');
  for (const version of ['IntelliJ IDEA 2024.1', 'IntelliJ IDEA 2025.2']) {
    mkdirSync(join(programFiles, 'JetBrains', version, 'bin'), { recursive: true });
    writeFileSync(join(programFiles, 'JetBrains', version, 'bin', 'idea64.exe'), '');
  }
  process.env.LOCALAPPDATA = local;
  process.env.ProgramFiles = programFiles;
  const detected = await detectEditors('win32');
  const byId = new Map(detected.map((item) => [item.definition.id, item]));
  assert.equal(byId.get('cursor')?.target, join(local, 'Programs', 'cursor', 'Cursor.exe'));
  assert.equal(byId.get('idea')?.target, join(programFiles, 'JetBrains', 'IntelliJ IDEA 2025.2', 'bin', 'idea64.exe'), 'the newest version wins');
  assert.equal(byId.has('windsurf'), false);
  assert.ok(detected.every((item) => item.definition.windows), 'only Windows-capable definitions are detected');
});
