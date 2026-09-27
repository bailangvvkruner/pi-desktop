import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

class TestTray extends EventEmitter {
  destroyed = false;
  menus = [];
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; }
  setToolTip(value) { this.tooltip = value; }
  popUpContextMenu(menu) { this.menus.push(menu); }
}
globalThis.__testTray = TestTray;
globalThis.__trayLocale = 'en-US';
registerHooks({
  resolve(specifier, context, nextResolve) {
    const sources = {
      electron: `export const app = { isPackaged: false };
        export const Menu = { buildFromTemplate: (template) => template };
        export const nativeImage = { createFromPath: () => ({ isEmpty: () => false }) };
        export const Tray = globalThis.__testTray;`,
      './appLocale': "export const getAppLocale = () => globalThis.__trayLocale;",
    };
    if (sources[specifier]) return { url: `data:text/javascript,${encodeURIComponent(sources[specifier])}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { createAppTray, destroyAppTray, invalidateAppTrayData, updateAppTrayMenu } = await import('../packages/desktop/src/main/tray.ts');
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('tray only exposes show window, settings and quit, with working actions and live locale changes', { skip: process.platform !== 'win32' }, async (t) => {
  t.after(() => { destroyAppTray(); globalThis.__trayLocale = 'en-US'; });
  globalThis.__trayLocale = 'zh-CN';
  const actions = [];
  const tray = createAppTray({
    showMainWindow: () => actions.push('show'),
    onOpenSettings: () => actions.push('settings'),
    quitApp: () => actions.push('quit'),
    getStatus: async () => ({ running: true }),
  });
  await settle();
  tray.emit('right-click');
  const menu = tray.menus[0];
  assert.deepEqual(menu.map((item) => item.label), ['显示界面', '设置', '退出']);
  for (const item of menu) item.click();
  assert.deepEqual(actions, ['show', 'settings', 'quit']);
  globalThis.__trayLocale = 'en-US';
  updateAppTrayMenu();
  tray.emit('right-click');
  assert.deepEqual(tray.menus[1].map((item) => item.label), ['Show window', 'Settings', 'Quit']);
  assert.equal(tray.tooltip, 'Pi Desktop — running');
  tray.emit('click');
  tray.emit('double-click');
  assert.deepEqual(actions, ['show', 'settings', 'quit', 'show', 'show']);
});

test('tray refreshes tooltip status on invalidated menu opens or a five-minute fallback, with no background popups', { skip: process.platform !== 'win32' }, async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000 });
  t.after(() => { destroyAppTray(); t.mock.timers.reset(); });
  let reads = 0;
  const tray = createAppTray({ showMainWindow() {}, onOpenSettings() {}, quitApp() {},
    getStatus: async () => { reads += 1; return { running: reads > 1 }; } });
  await settle();
  assert.equal(reads, 1);
  assert.equal(tray.menus.length, 0);
  t.mock.timers.tick(20_000);
  await settle();
  assert.equal(reads, 1);
  tray.emit('right-click');
  await settle();
  assert.equal(reads, 1, 'a fresh menu reuses the cache');
  assert.equal(tray.menus.length, 1);
  assert.equal(tray.tooltip, 'Pi Desktop');
  invalidateAppTrayData();
  assert.equal(reads, 1, 'events invalidate without querying the host');
  tray.emit('right-click');
  assert.equal(tray.menus.length, 2, 'the menu opens without waiting for the host');
  await settle();
  assert.equal(reads, 2);
  assert.equal(tray.tooltip, 'Pi Desktop — running');
  tray.emit('right-click');
  assert.deepEqual(tray.menus[2].map((item) => item.label), ['Show window', 'Settings', 'Quit']);
  t.mock.timers.tick(5 * 60_000);
  await settle();
  assert.equal(reads, 3);
  assert.equal(tray.menus.length, 3, 'refresh timers must never open menus');
  destroyAppTray();
  t.mock.timers.tick(5 * 60_000);
  await settle();
  assert.equal(reads, 3);
});

test('a tray refresh completing after destruction cannot open a menu or replace new tray data', { skip: process.platform !== 'win32' }, async (t) => {
  t.after(destroyAppTray);
  let resolveStatus;
  const pending = new Promise((resolve) => { resolveStatus = resolve; });
  const old = createAppTray({ showMainWindow() {}, onOpenSettings() {}, quitApp() {}, getStatus: () => pending });
  old.emit('right-click');
  assert.deepEqual(old.menus[0].map((item) => item.label), ['Show window', 'Settings', 'Quit'], 'an unresponsive agent cannot block menu actions');
  destroyAppTray();
  const current = createAppTray({ showMainWindow() {}, onOpenSettings() {}, quitApp() {}, getStatus: async () => ({ running: false }) });
  await settle();
  resolveStatus({ running: true });
  await settle();
  assert.equal(old.menus.length, 1, 'a completed refresh cannot open a delayed popup');
  current.emit('right-click');
  await settle();
  assert.equal(current.tooltip, 'Pi Desktop', 'a stale refresh cannot overwrite the current tooltip');
  assert.deepEqual(current.menus[0].map((item) => item.label), ['Show window', 'Settings', 'Quit']);
});
