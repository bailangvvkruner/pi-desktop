import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const marker = 'Pi Desktop pai launcher';
const managedNames = ['pai.cmd', 'pai.ps1', 'pai-launcher.ps1', 'pai-launcher.json'];

export function createPaiLauncherFiles({ executable, arguments: prefixArguments = [] }) {
  return {
    'pai.cmd': [
      '@echo off',
      `rem ${marker} (managed by scripts/install-pai.mjs)`,
      'setlocal DisableDelayedExpansion',
      '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0pai-launcher.ps1" %*',
      'exit /b %errorlevel%',
      '',
    ].join('\r\n'),
    'pai.ps1': [
      `# ${marker} (managed by scripts/install-pai.mjs)`,
      "& (Join-Path $PSScriptRoot 'pai-launcher.ps1') @args",
      'exit $LASTEXITCODE',
      '',
    ].join('\r\n'),
    'pai-launcher.ps1': readFileSync(new URL('./pai-launcher.ps1', import.meta.url), 'utf8'),
    'pai-launcher.json': `${JSON.stringify({ managedBy: marker, executable, arguments: prefixArguments }, null, 2)}\n`,
  };
}

export function resolvePaiTarget({ exe, dev, root = repositoryRoot }) {
  if (exe && dev) throw new Error('Choose either --exe or --dev.');
  if (exe) {
    const executable = resolve(exe);
    if (!existsSync(executable) || !statSync(executable).isFile()) throw new Error(`Application executable not found: ${executable}`);
    if (!executable.toLowerCase().endsWith('.exe')) throw new Error('--exe must point to the installed Pi Desktop .exe.');
    return { executable, arguments: [] };
  }
  if (!dev) throw new Error('Specify --dev for this checkout or --exe "C:\\path\\Pi Desktop.exe" for an installed app.');
  const desktop = join(resolve(root), 'packages', 'desktop');
  const entry = join(desktop, 'out', 'main', 'index.js');
  if (!existsSync(entry)) throw new Error('The desktop build is missing. Run pnpm build before installing the development launcher.');
  const require = createRequire(join(desktop, 'package.json'));
  const executable = require('electron');
  if (!existsSync(executable)) throw new Error(`Electron executable not found: ${executable}`);
  return { executable, arguments: [desktop] };
}

export function installPaiCommand({ commandDirectory, target }) {
  const directory = resolve(commandDirectory);
  const files = createPaiLauncherFiles(target);
  // Validate every existing file before writing anything. Never replace an
  // unrelated command that happens to have the same name on the user's PATH.
  for (const name of managedNames) {
    const file = join(directory, name);
    if (existsSync(file) && !readFileSync(file, 'utf8').includes(marker)) {
      throw new Error(`Refusing to replace an existing unmanaged command file: ${file}`);
    }
  }
  if (existsSync(join(directory, 'pai.exe'))) {
    throw new Error(`pai.exe already exists in ${directory}; choose a different command directory.`);
  }
  mkdirSync(directory, { recursive: true });
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(directory, name), contents, 'utf8');
  return managedNames.map((name) => join(directory, name));
}

function main() {
  if (process.platform !== 'win32') throw new Error('The pai command installer currently supports Windows.');
  const { values } = parseArgs({ options: {
    exe: { type: 'string' },
    dev: { type: 'boolean' },
    'command-dir': { type: 'string' },
    help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: pnpm install:pai --dev | --exe "C:\\path\\Pi Desktop.exe" [--command-dir "C:\\path\\bin"]');
    return;
  }
  const commandDirectory = values['command-dir'] ?? (process.env.APPDATA ? join(process.env.APPDATA, 'npm') : undefined);
  if (!commandDirectory) throw new Error('APPDATA is unavailable; specify --command-dir.');
  const target = resolvePaiTarget(values);
  const installed = installPaiCommand({ commandDirectory, target });
  console.log(`Installed pai command in ${dirname(installed[0])}\nApplication: ${target.executable}\nType pai in a folder address bar or terminal to open a chat window.`);
  const onPath = (process.env.PATH ?? '').split(';').some((entry) => resolve(entry).toLowerCase() === resolve(commandDirectory).toLowerCase());
  if (!onPath) console.log('This directory is not on the current PATH. Add it to your user PATH and open a new Explorer/terminal session.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
