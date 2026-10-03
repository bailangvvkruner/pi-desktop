import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const piEngineUrl = new URL('../packages/desktop/src/main/piEngine.ts', import.meta.url);

/** Creates a fake but structurally complete engine install and returns its install root. */
function createFakeEngine(root, { version = '9.9.9-fake', withDeps = true, withEntry = true, name = '@earendil-works/pi-coding-agent' } = {}) {
  const pkgDir = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent');
  mkdirSync(join(pkgDir, 'dist'), { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version, main: './dist/index.js' }));
  if (withEntry) writeFileSync(join(pkgDir, 'dist', 'index.js'), `export const VERSION = ${JSON.stringify(version)};\nexport const __FAKE_ENGINE__ = true;\n`);
  if (withDeps) mkdirSync(join(pkgDir, 'node_modules'));
  return root;
}

test('probePiEngine validates structure, versions and dependency hints', async (t) => {
  const { probePiEngine, resolveEnginePackageDir } = await import(piEngineUrl);
  const temp = mkdtempSync(join(tmpdir(), 'pi-engine-probe-'));
  t.after(async () => { rmSync(temp, { recursive: true, force: true }); });

  await t.test('accepts a complete install root and normalizes to the package dir', () => {
    const root = createFakeEngine(join(temp, 'ok'));
    const probe = probePiEngine(root);
    assert.equal(probe.ok, true, probe.problems.join(';'));
    assert.equal(probe.version, '9.9.9-fake');
    assert.equal(probe.packageDir, join(root, 'node_modules', '@earendil-works', 'pi-coding-agent'));
    assert.equal(resolveEnginePackageDir(`  ${root}  `), probe.packageDir);
  });

  await t.test('accepts the package dir itself and tolerates whitespace', () => {
    const root = createFakeEngine(join(temp, 'direct'));
    const pkgDir = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent');
    const probe = probePiEngine(` ${pkgDir} `);
    assert.equal(probe.ok, true, probe.problems.join(';'));
    assert.equal(probe.packageDir, pkgDir);
  });

  await t.test('reports missing entry and dependency hints as problems/warnings', () => {
    const noEntry = createFakeEngine(join(temp, 'no-entry'), { withEntry: false });
    assert.equal(probePiEngine(noEntry).ok, false);
    assert.ok(probePiEngine(noEntry).problems.some((problem) => problem.includes('index.js')));
    // A package dir outside any node_modules tree without bundled deps gets a warning, not a problem.
    const bare = join(temp, 'bare-engine', 'pi-coding-agent');
    mkdirSync(join(bare, 'dist'), { recursive: true });
    writeFileSync(join(bare, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.0.0' }));
    writeFileSync(join(bare, 'dist', 'index.js'), 'export const VERSION = "1.0.0";');
    const bareProbe = probePiEngine(bare);
    assert.equal(bareProbe.ok, true);
    assert.equal(bareProbe.warnings.some((warning) => warning.includes('node_modules')), true);
  });

  await t.test('rejects foreign packages and empty input', () => {
    const foreign = createFakeEngine(join(temp, 'foreign'), { name: '@other/package' });
    assert.equal(probePiEngine(foreign).ok, false);
    assert.equal(probePiEngine('   ').ok, false);
    assert.equal(probePiEngine(join(temp, 'missing')).ok, false);
  });

  await t.test('compares versions against the bundled engine', () => {
    const older = createFakeEngine(join(temp, 'older'), { version: '1.0.0' });
    assert.ok(probePiEngine(older, '1.2.0').warnings.some((warning) => warning.includes('低于')));
    const nextMajor = createFakeEngine(join(temp, 'major'), { version: '2.0.0' });
    assert.ok(probePiEngine(nextMajor, '1.0.0').warnings.some((warning) => warning.includes('主版本')));
    const patch = createFakeEngine(join(temp, 'patch'), { version: '1.0.1' });
    assert.equal(probePiEngine(patch, '1.0.0').warnings.length, 0);
    const weird = createFakeEngine(join(temp, 'weird'), { version: 'not-a-version' });
    assert.ok(probePiEngine(weird, '1.0.0').warnings.some((warning) => warning.includes('版本')));
  });
});

test('selection validation and required exports', async (t) => {
  const { isValidPiEngineSelection, missingSdkExports, REQUIRED_SDK_EXPORTS } = await import(piEngineUrl);
  await t.test('selection shapes', () => {
    assert.equal(isValidPiEngineSelection({ mode: 'builtin' }), true);
    assert.equal(isValidPiEngineSelection({ mode: 'custom', path: 'D:\\engine' }), true);
    assert.equal(isValidPiEngineSelection({ mode: 'custom', path: '' }), false);
    assert.equal(isValidPiEngineSelection({ mode: 'custom', path: ' ' }), false);
    assert.equal(isValidPiEngineSelection(null), false);
    assert.equal(isValidPiEngineSelection('builtin'), false);
  });
  await t.test('missing exports are listed', () => {
    assert.deepEqual(missingSdkExports({}), [...REQUIRED_SDK_EXPORTS]);
    const complete = Object.fromEntries(REQUIRED_SDK_EXPORTS.map((name) => [name, () => {}]));
    assert.deepEqual(missingSdkExports(complete), []);
  });
});

test('readBuiltinEngineInfo resolves the bundled SDK from this repository', async () => {
  const { readBuiltinEngineInfo } = await import(piEngineUrl);
  const info = readBuiltinEngineInfo();
  assert.ok(info, 'bundled SDK should resolve from node_modules');
  assert.match(info.version, /^\d+\.\d+\.\d+/);
});

// The redirect is process-wide, so it runs in a child process: installing the
// hook must make the bare SDK specifier load the fake engine instead.
test('installEngineRedirect re-points the SDK specifier (child process)', async (t) => {
  const { installEngineRedirect } = await import(piEngineUrl);
  const temp = mkdtempSync(join(tmpdir(), 'pi-engine-redirect-'));
  t.after(async () => { rmSync(temp, { recursive: true, force: true }); });
  const root = createFakeEngine(join(temp, 'engine'), { version: '3.2.1-fake' });
  const pkgDir = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent');

  assert.equal(installEngineRedirect(join(temp, 'not-an-engine')).ok, false, 'invalid engine directories are refused');

  const child = `
import { installEngineRedirect } from ${JSON.stringify(piEngineUrl.href)};
const result = installEngineRedirect(${JSON.stringify(pkgDir)});
if (!result.ok) { console.error('REDIRECT_FAILED:' + result.problems.join(';')); process.exit(1); }
const sdk = await import('@earendil-works/pi-coding-agent');
console.log('MARKER:' + (sdk.__FAKE_ENGINE__ === true ? 'fake' : 'real') + ':VERSION=' + String(sdk.VERSION));
`;
  const script = join(temp, 'child.mjs');
  writeFileSync(script, child);
  const run = spawnSync(process.execPath, ['--no-warnings', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, `child failed: ${run.stderr}`);
  assert.match(run.stdout, /MARKER:fake:VERSION=3\.2\.1-fake/);
});
