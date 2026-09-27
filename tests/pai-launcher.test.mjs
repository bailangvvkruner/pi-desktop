import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { installPaiCommand, resolvePaiTarget } from '../scripts/install-pai.mjs';

// Cold Windows PowerShell startup can exceed 15 seconds on a shared CI runner.
// These integration tests verify argument handling, not shell startup latency.
const launcherTimeoutMs = 60_000;

function fixture(t) {
  const parent = realpathSync.native(tmpdir());
  const root = mkdtempSync(join(parent, 'pi-pai-launcher-'));
  const bin = join(root, 'bin 中文 & 100% !');
  const cwd = join(root, '项目 空格 & 100% ! (folder)');
  mkdirSync(cwd);
  t.after(() => {
    assert.equal(dirname(resolve(root)), parent);
    rmSync(root, { recursive: true, force: true });
  });
  return { root, bin, cwd };
}

test('pai installation refuses existing commands before changing any files', (t) => {
  const { bin } = fixture(t);
  mkdirSync(bin);
  const existing = join(bin, 'pai.ps1');
  writeFileSync(existing, 'existing user command');
  assert.throws(() => installPaiCommand({ commandDirectory: bin, target: { executable: process.execPath } }), /unmanaged/);
  assert.equal(readFileSync(existing, 'utf8'), 'existing user command');
  assert.equal(existsSync(join(bin, 'pai.cmd')), false);
});

test('pai installation updates its own target without changing unrelated files', (t) => {
  const { bin } = fixture(t);
  installPaiCommand({ commandDirectory: bin, target: { executable: process.execPath, arguments: ['old-app'] } });
  const unrelated = join(bin, 'pi.cmd');
  writeFileSync(unrelated, 'other command');
  installPaiCommand({ commandDirectory: bin, target: { executable: process.execPath, arguments: ['new-app'] } });
  assert.equal(readFileSync(unrelated, 'utf8'), 'other command');
  assert.deepEqual(JSON.parse(readFileSync(join(bin, 'pai-launcher.json'), 'utf8')).arguments, ['new-app']);
});

test('target selection rejects an ambiguous executable, missing build, and missing executable', (t) => {
  const { root } = fixture(t);
  assert.throws(() => resolvePaiTarget({ exe: process.execPath, dev: true }), /either/);
  assert.throws(() => resolvePaiTarget({}), /Specify/);
  assert.throws(() => resolvePaiTarget({ dev: true, root }), /build is missing/);
  assert.throws(() => resolvePaiTarget({ exe: join(root, 'missing.exe') }), /not found/);
});

async function readCaptured(file) {
  for (let count = 0; count < 100; count += 1) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    await setTimeout(50);
  }
  assert.fail('The launcher did not start the harmless argument capture process.');
}

for (const mode of ['cmd-current-directory', 'powershell-current-directory', 'cmd-explicit-directory', 'powershell-explicit-directory']) {
  test(`pai ${mode} preserves Windows directories and argument quoting`, { skip: process.platform !== 'win32' }, async (t) => {
    const { root, bin, cwd } = fixture(t);
    const captureFile = join(root, 'capture.json');
    const captureScript = join(root, 'capture.mjs');
    writeFileSync(captureScript, `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[2], JSON.stringify({ args: process.argv.slice(3), cwd: process.cwd(), runAsNode: process.env.ELECTRON_RUN_AS_NODE }));\n`);
    const specialArguments = ['embedded "quote"', 'trailing\\', 'C:\\', '中文 & % !', ''];
    installPaiCommand({ commandDirectory: bin, target: { executable: process.execPath, arguments: [captureScript, captureFile, ...specialArguments] } });
    const explicit = mode.includes('explicit');
    const powershell = mode.startsWith('powershell');
    const result = powershell
      ? spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(bin, 'pai.ps1'), ...(explicit ? ['-Cwd', cwd] : [])], { cwd: explicit ? root : cwd, encoding: 'utf8', timeout: launcherTimeoutMs, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
      : spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', explicit ? `pai.cmd "${cwd}"` : 'pai.cmd'], { cwd: explicit ? root : cwd, encoding: 'utf8', windowsVerbatimArguments: true, timeout: launcherTimeoutMs, env: { ...process.env, PATH: `${bin};${process.env.PATH}`, ELECTRON_RUN_AS_NODE: '1' } });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const captured = await readCaptured(captureFile);
    assert.deepEqual(captured.args, [...specialArguments, '--pai', '--cwd', cwd]);
    assert.equal(captured.cwd, cwd);
    assert.equal(captured.runAsNode, undefined);
  });
}

test('pai reports invalid directories without starting the application', { skip: process.platform !== 'win32' }, (t) => {
  const { root, bin } = fixture(t);
  const file = join(root, 'not-a-directory.txt');
  writeFileSync(file, 'file');
  installPaiCommand({ commandDirectory: bin, target: { executable: process.execPath } });
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(bin, 'pai.ps1'), '-Cwd', file], { cwd: root, encoding: 'utf8', timeout: launcherTimeoutMs });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /filesystem directory/);
});
