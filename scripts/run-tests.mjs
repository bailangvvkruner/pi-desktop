// Test bootstrap: normalizes TMP/TEMP to their long (non-8.3) form before
// running the suite. On some Windows machines TEMP points at the short-path
// form (C:\Users\NAME~1\...); fs.watch on such directories trips libuv's
// case-insensitive prefix assertion (src\win\fs-event.c) and aborts the whole
// test process. Tests (and the SDK code they host) derive their temp roots
// from os.tmpdir(), so exporting the resolved long path up front removes the
// trigger for every spawned test process.
import { spawnSync } from 'node:child_process';
import { readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flags = argv.filter((argument) => argument.startsWith('--'));
const explicitFiles = argv.filter((argument) => !argument.startsWith('--'));
const files = explicitFiles.length > 0
  ? explicitFiles
  : readdirSync(join('.', 'tests'))
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => join('tests', name))
    .sort();
const defaultFlags = flags.some((flag) => flag.startsWith('--test-concurrency'))
  ? []
  : ['--test-concurrency=4'];

let longTemp = tmpdir();
try { longTemp = realpathSync.native(tmpdir()); } catch { /* keep the plain form when native resolution fails */ }

const result = spawnSync(process.execPath, ['--test', ...defaultFlags, ...flags, ...files], {
  stdio: 'inherit',
  env: { ...process.env, TMP: longTemp, TEMP: longTemp, TMPDIR: longTemp },
});
process.exit(result.status ?? 1);
