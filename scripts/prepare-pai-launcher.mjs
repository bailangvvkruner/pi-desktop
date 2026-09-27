import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

export function preparePaiLauncher({ root = repositoryRoot, executableName = 'Pi Desktop.exe' } = {}) {
  if (process.platform !== 'win32') throw new Error('The native pai launcher must be built on Windows.');
  if (typeof executableName !== 'string' || !/^[^<>:"/\\|?*\x00-\x1f]+\.exe$/i.test(executableName)) {
    throw new Error('The pai application name must be an .exe filename without directory components.');
  }
  const windowsDirectory = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const compiler = ['Framework64', 'Framework']
    .map((framework) => join(windowsDirectory, 'Microsoft.NET', framework, 'v4.0.30319', 'csc.exe'))
    .find(existsSync);
  if (!compiler) throw new Error('The Windows .NET Framework C# compiler was not found.');
  const source = join(resolve(root), 'scripts', 'pai-launcher.cs');
  const executable = join(resolve(root), 'packages', 'desktop', 'out', 'pai', 'pai.exe');
  mkdirSync(dirname(executable), { recursive: true });
  const generatedSource = join(dirname(executable), 'pai-launcher.generated.cs');
  const placeholder = 'private const string ApplicationName = "Pi Desktop.exe";';
  const template = readFileSync(source, 'utf8');
  if (!template.includes(placeholder)) throw new Error('The pai launcher application name placeholder is missing.');
  // Filename validation excludes C# literal delimiters and control characters.
  // Encode non-ASCII characters so compiler locale never changes the filename.
  const literal = '"' + executableName.replace(/[^\x20-\x7e]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`) + '"';
  writeFileSync(generatedSource, template.replace(placeholder, () => `private const string ApplicationName = ${literal};`), 'utf8');
  try {
    const result = spawnSync(compiler, [
      '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/codepage:65001',
      '/reference:System.Windows.Forms.dll', `/out:${executable}`, generatedSource,
    ], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    if (result.error || result.status !== 0) {
      throw new Error(`Failed to compile the pai launcher: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`);
    }
  } finally {
    unlinkSync(generatedSource);
  }
  return executable;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(`Built ${preparePaiLauncher()}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
