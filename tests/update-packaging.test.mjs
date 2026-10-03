import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import YAML from 'yaml';
import { prepareUpdateConfig } from '../scripts/prepare-update-config.mjs';
import { WINDOWS_PTY_PREBUILD_CONFIG, verifyWindowsPtyPrebuilds } from '../scripts/windows-pty-prebuild.mjs';

const defaultUrl = 'https://github.com/shuaichao171/pi-desktop/releases/latest/download/';
function fixture(t) {
  const base = realpathSync.native(tmpdir());
  const root = mkdtempSync(join(base, 'pi-update-packaging-'));
  const source = join(root, 'packages', 'desktop', 'build', 'update-config.json');
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, JSON.stringify({ url: defaultUrl }));
  t.after(() => { assert.equal(dirname(resolve(root)), base); rmSync(root, { recursive: true, force: true }); });
  return { root, source };
}

test('packaged client and updater metadata share the configured feed; temporary overrides do not alter tracked defaults', (t) => {
  const { root, source } = fixture(t);
  for (const override of [undefined, '', 'https://updates.example.com/desktop/']) {
    const prepared = prepareUpdateConfig({ root, env: { PI_DESKTOP_UPDATE_URL: override } });
    const expected = override || defaultUrl;
    assert.equal(prepared.url, expected);
    assert.deepEqual(prepared.publish, { provider: 'generic', url: expected });
    assert.deepEqual(JSON.parse(readFileSync(prepared.output, 'utf8')), { url: expected });
    assert.deepEqual(JSON.parse(readFileSync(source, 'utf8')), { url: defaultUrl });
  }
  assert.equal(prepareUpdateConfig({ root, env: {} }).url, defaultUrl);
});

test('invalid feed overrides fail before replacing the last valid generated config', (t) => {
  const { root } = fixture(t);
  const valid = prepareUpdateConfig({ root, env: {} });
  for (const url of ['http://example.com/', 'https://user:password@example.com/', 'https://example.com/?token=secret', 'https://example.com/file', ' ']) {
    assert.throws(() => prepareUpdateConfig({ root, env: { PI_DESKTOP_UPDATE_URL: url } }), /HTTPS directory/);
    assert.equal(JSON.parse(readFileSync(valid.output, 'utf8')).url, defaultUrl);
  }
});

test('default builder feed matches the shipped source configuration and copies generated client settings', () => {
  const config = YAML.parse(readFileSync(new URL('../packages/desktop/electron-builder.yml', import.meta.url), 'utf8'));
  const source = JSON.parse(readFileSync(new URL('../packages/desktop/build/update-config.json', import.meta.url), 'utf8'));
  assert.equal(config.publish.url, source.url);
  assert.equal(config.publish.provider, 'generic');
  assert.deepEqual(config.extraResources.find((entry) => entry.to === 'update-config.json'), { from: 'out/update-config.json', to: 'update-config.json' });
  assert.equal(config.win.verifyUpdateCodeSignature, true, 'signed releases retain publisher verification');
});

test('Windows packaging entries ship node-pty prebuilds instead of running node-gyp', () => {
  assert.deepEqual(WINDOWS_PTY_PREBUILD_CONFIG, { npmRebuild: false });
  // Both Windows entries must opt out of native rebuilds; the debug entry used to
  // invoke node-gyp and fail on machines without Visual Studio.
  for (const entry of ['dist-win.mjs', 'dist-debug.mjs']) {
    const source = readFileSync(new URL(`../scripts/${entry}`, import.meta.url), 'utf8');
    assert.match(source, /\.\.\.WINDOWS_PTY_PREBUILD_CONFIG/, `${entry} must reuse the shared no-rebuild config`);
    assert.match(source, /verifyWindowsPtyPrebuilds\(require\)/, `${entry} must verify the shipped prebuilds`);
  }
});

test('only Windows ships the native pai command outside the application archive', () => {
  const config = YAML.parse(readFileSync(new URL('../packages/desktop/electron-builder.yml', import.meta.url), 'utf8'));
  assert.deepEqual(config.win.extraFiles.find((entry) => entry.to === 'bin/pai.exe'), { from: 'out/pai/pai.exe', to: 'bin/pai.exe' });
  assert.ok(config.files.includes('!out/pai/**'), 'the Windows helper must not enter the shared ASAR payload');
  for (const scope of [config, config.mac, config.linux]) {
    assert.ok(!(scope.extraFiles ?? []).some((entry) => /pai/.test(typeof entry === 'string' ? entry : entry.from)));
  }
});

test('Windows installer and unpacked packaging both await pai preparation before building', () => {
  const entry = new URL('../scripts/dist-win.mjs', import.meta.url).href;
  for (const args of [[], ['--dir']]) {
    // Exercise the actual packaging entry without downloading Electron or writing
    // artifacts. A deferred preparation catches building before the helper exists.
    const script = `
      import { registerHooks } from 'node:module';
      globalThis.packaging = { prepared: false, events: [] };
      const sources = {
        'electron-builder': { format: 'commonjs', source: \`
          exports.Arch = { x64: 'x64' };
          exports.Platform = { WINDOWS: { createTarget: (names, arch) => ({ names, arch }) } };
          exports.build = async (options) => {
            if (!globalThis.packaging.prepared) throw new Error('pai launcher was not prepared before packaging');
            globalThis.packaging.events.push('build');
            globalThis.packaging.targets = options.targets;
          };
        \` },
        './prepare-update-config.mjs': { format: 'module', source: 'export const prepareUpdateConfig = () => ({ publish: {} });' },
        './prepare-pai-launcher.mjs': { format: 'module', source: \`
          export async function preparePaiLauncher() {
            await Promise.resolve();
            globalThis.packaging.prepared = true;
            globalThis.packaging.events.push('prepare-pai');
          }
        \` },
        './windows-pty-prebuild.mjs': { format: 'module', source: 'export const WINDOWS_PTY_PREBUILD_CONFIG = { npmRebuild: false }; export function verifyWindowsPtyPrebuilds() {}' },
      };
      registerHooks({
        resolve(specifier, context, next) {
          return Object.hasOwn(sources, specifier) ? { url: 'packaging-test:' + specifier, shortCircuit: true } : next(specifier, context);
        },
        load(url, context, next) {
          return url.startsWith('packaging-test:') ? { ...sources[url.slice('packaging-test:'.length)], shortCircuit: true } : next(url, context);
        },
      });
      process.argv = ['node', ...${JSON.stringify(args)}];
      await import(${JSON.stringify(entry)});
      console.log(JSON.stringify(globalThis.packaging));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const captured = JSON.parse(result.stdout.trim());
    assert.deepEqual(captured.events, ['prepare-pai', 'build']);
    assert.deepEqual(captured.targets, { names: args.length ? ['dir'] : ['nsis', 'portable'], arch: 'x64' });
  }
});

test('missing node-pty Windows prebuilds abort packaging before node-gyp runs', (t) => {
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'pi-pty-prebuilds-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => verifyWindowsPtyPrebuilds({ resolve: () => join(root, 'package.json') }), { code: 'ENOENT' });
});
