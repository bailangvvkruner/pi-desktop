// Terminal-only Electron integration check. Never attaches to an existing app.
// Run after pnpm build: node tests/fixtures/workspace-drop/native-smoke.cjs
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { existsSync } = require('node:fs');
const { mkdir, mkdtemp, realpath, rm, writeFile } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { promisify } = require('node:util');

const workspace = resolve(__dirname, '../../..');
const preload = join(workspace, 'packages/desktop/out/preload/index.mjs');

async function launch() {
  assert(existsSync(preload), 'Build the actual preload first with pnpm build');
  const desktopRequire = createRequire(join(workspace, 'packages/desktop/package.json'));
  const executable = desktopRequire('electron');
  const temporaryParent = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryParent, 'pi-native-workspace-drop-'));
  const env = { ...process.env, PI_NATIVE_DROP_SMOKE_ROOT: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  let child;
  let timeout;
  let timedOut = false;
  try {
    child = spawn(executable, [__filename, '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => process.stdout.write(chunk));
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    const closed = new Promise((res, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => res({ code, signal }));
    });
    timeout = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') {
        // Only the exact isolated process started above and its children.
        void promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
      } else child.kill('SIGKILL');
    }, 25_000);
    const result = await closed;
    assert(!timedOut, 'Hidden Electron smoke test timed out');
    assert.equal(result.code, 0, `Hidden Electron exited with ${result.code ?? result.signal}`);
  } finally {
    clearTimeout(timeout);
    const target = resolve(directory);
    assert.equal(dirname(target), temporaryParent, 'Refusing to remove a path outside the owned temporary directory');
    assert(target.startsWith(join(temporaryParent, 'pi-native-workspace-drop-')), 'Unexpected smoke test directory');
    await rm(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
  }
}

async function smoke() {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const directory = process.env.PI_NATIVE_DROP_SMOKE_ROOT;
  assert(directory, 'Launch this fixture with Node so its temporary directory is isolated');
  const profile = join(directory, 'profile');
  await mkdir(profile);
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  app.setPath('logs', join(directory, 'logs'));
  app.disableHardwareAcceleration();
  const project = join(directory, 'native 项目 folder');
  await mkdir(project);
  const html = join(directory, 'drop.html');
  await writeFile(html, `<!doctype html><meta charset="utf-8"><title>Hidden workspace drop smoke</title>
    <style>html,body { margin:0; width:100%; height:100%; } #drop { width:100vw; height:100vh; }</style>
    <div id="drop">Drop target</div>
    <script>
      window.dropReady = new Promise(resolve => { window.finishDrop = resolve; });
      document.addEventListener('dragover', event => event.preventDefault());
      document.addEventListener('drop', async event => {
        event.preventDefault();
        try {
          const items = Array.from(event.dataTransfer.items).filter(item => item.kind === 'file');
          const entries = items.map(item => {
            const entry = item.webkitGetAsEntry();
            return { name: entry?.name, isDirectory: entry?.isDirectory, isFile: entry?.isFile };
          });
          const files = items.map(item => item.getAsFile()).filter(Boolean);
          const accepted = await window.piDesktop.addDroppedWorkspaces(files);
          window.finishDrop({ entries, names: files.map(file => file.name), accepted });
        } catch (error) { window.finishDrop({ error: String(error) }); }
      });
    </script>`);
  let window;
  let status = 1;
  const captured = [];
  const registered = [];
  try {
    await app.whenReady();
    ipcMain.handle('workspace:add-dropped', (event, paths) => {
      assert.equal(event.sender, window.webContents);
      assert.equal(event.senderFrame, window.webContents.mainFrame);
      assert(Array.isArray(paths));
      captured.push(paths);
      registered.push(...paths);
      return paths;
    });
    window = new BrowserWindow({
      show: false, width: 600, height: 400,
      webPreferences: { preload, contextIsolation: true, sandbox: false, nodeIntegration: false, backgroundThrottling: false },
    });
    window.webContents.on('preload-error', (_event, path, error) => console.error('Preload failed:', path, error));
    await window.loadFile(html);
    assert.equal(window.isVisible(), false);
    assert.equal(await window.webContents.executeJavaScript('typeof window.piDesktop?.addDroppedWorkspaces'), 'function');
    window.webContents.debugger.attach('1.3');
    const data = { items: [], files: [project], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await window.webContents.debugger.sendCommand('Input.dispatchDragEvent', { type, x: 150, y: 120, data });
    }
    const result = await window.webContents.executeJavaScript(`Promise.race([
      window.dropReady,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Native directory drop was not delivered')), 5000))
    ])`);
    assert.equal(result.error, undefined, result.error);
    assert.deepEqual(result.entries, [{ name: 'native 项目 folder', isDirectory: true, isFile: false }]);
    assert.deepEqual(result.names, ['native 项目 folder']);
    assert.deepEqual(result.accepted, [project]);
    assert.deepEqual(captured, [[project]], 'The real preload must deliver the native directory path across contextBridge');
    const virtual = await window.webContents.executeJavaScript(`window.piDesktop.addDroppedWorkspaces([new File(['virtual'], 'fake-folder')])`);
    assert.deepEqual(virtual, []);
    assert.deepEqual(captured, [[project], []]);
    assert.deepEqual(registered, [project], 'A JavaScript-created File cannot register a native path');
    assert.equal(window.isVisible(), false, 'The fixture must never reveal its hidden test window');
    console.log(JSON.stringify({ status: 'passed', electron: process.versions.electron, nativeDirectoryEntry: result.entries[0], nativePathCrossedContextBridge: true, virtualFileIgnored: true, hiddenWindow: true }));
    status = 0;
  } catch (error) {
    console.error(error);
  } finally {
    if (window && !window.isDestroyed()) {
      if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
      window.destroy();
    }
    ipcMain.removeHandler('workspace:add-dropped');
    app.exit(status);
  }
}

if (process.versions.electron) {
  void smoke().catch(error => { console.error(error); require('electron').app.exit(1); });
} else {
  void launch().catch(error => { console.error(error); process.exitCode = 1; });
}
