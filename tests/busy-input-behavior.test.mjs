import assert from 'node:assert/strict';
import { test } from 'node:test';

const STORAGE_KEY = 'pi-desktop:busy-input-behavior';
let importNumber = 0;

function memoryStorage(initial) {
  const values = new Map(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

async function withStore(storage, run, blocked = false) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget();
  Object.defineProperty(target, 'localStorage', blocked
    ? { get() { throw new Error('Storage disabled'); } }
    : { value: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  try {
    const store = await import(`../packages/ui/src/busyInputBehavior.ts?test=${++importNumber}`);
    await run(store, target);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  }
}

test('busy input defaults to queue and reads existing unversioned preferences', async () => {
  for (const [saved, expected] of [[undefined, 'followUp'], ['steer', 'steer'], ['followUp', 'followUp'], ['queue', 'followUp'], ['', 'followUp']]) {
    await withStore(memoryStorage(saved), store => assert.equal(store.getBusyInputBehavior(), expected));
  }
});

test('busy input changes update all subscribers immediately and persist across reloads', async () => {
  const storage = memoryStorage();
  await withStore(storage, store => {
    const composerChanges = [];
    const settingsChanges = [];
    const unsubscribeComposer = store.subscribeBusyInputBehavior(() => composerChanges.push(store.getBusyInputBehavior()));
    const unsubscribeSettings = store.subscribeBusyInputBehavior(() => settingsChanges.push(store.getBusyInputBehavior()));
    assert.equal(store.setBusyInputBehavior('steer'), true);
    assert.equal(storage.getItem(STORAGE_KEY), 'steer');
    assert.deepEqual(composerChanges, ['steer']);
    assert.deepEqual(settingsChanges, ['steer']);
    assert.equal(store.setBusyInputBehavior('steer'), true);
    assert.deepEqual(composerChanges, ['steer'], 'unchanged values do not trigger redundant renders');
    unsubscribeComposer();
    assert.equal(store.setBusyInputBehavior('followUp'), true);
    assert.deepEqual(composerChanges, ['steer']);
    assert.deepEqual(settingsChanges, ['steer', 'followUp']);
    unsubscribeSettings();
    assert.equal(store.setBusyInputBehavior('steer'), true);
  });
  await withStore(storage, store => assert.equal(store.getBusyInputBehavior(), 'steer'));
});

test('unavailable storage preserves the current session preference and reports write failure', async () => {
  for (const [storage, blocked] of [
    [undefined, false],
    [null, true],
    [{ getItem() { throw new Error('Read denied'); }, setItem() { throw new Error('Write denied'); } }, false],
    [{ getItem: () => 'followUp', setItem() { throw new Error('Quota exceeded'); } }, false],
  ]) {
    await withStore(storage, store => {
      const updates = [];
      assert.equal(store.getBusyInputBehavior(), 'followUp');
      const unsubscribe = store.subscribeBusyInputBehavior(() => updates.push(store.getBusyInputBehavior()));
      assert.equal(store.setBusyInputBehavior('steer'), false);
      assert.equal(store.getBusyInputBehavior(), 'steer');
      assert.deepEqual(updates, ['steer']);
      unsubscribe();
      const unsubscribeAgain = store.subscribeBusyInputBehavior(() => {});
      assert.equal(store.getBusyInputBehavior(), 'steer', 'remounting consumers keeps the in-memory preference');
      unsubscribeAgain();
    }, blocked);
  }
});

test('saving the same choice retries persistence after storage recovers', async () => {
  const storage = memoryStorage();
  const setItem = storage.setItem;
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  await withStore(storage, store => {
    assert.equal(store.setBusyInputBehavior('steer'), false);
    assert.equal(store.getBusyInputBehavior(), 'steer');
    storage.setItem = setItem;
    assert.equal(store.setBusyInputBehavior('steer'), true);
    assert.equal(storage.getItem(STORAGE_KEY), 'steer');
  });
});

test('other windows sync only local preference changes and reset to queue on clear', async () => {
  const storage = memoryStorage();
  await withStore(storage, (store, target) => {
    const updates = [];
    const unsubscribe = store.subscribeBusyInputBehavior(() => updates.push(store.getBusyInputBehavior()));
    const dispatch = (key, newValue, storageArea = storage) => target.dispatchEvent(Object.assign(new Event('storage'), { key, newValue, storageArea }));
    dispatch('another-preference', 'steer');
    dispatch(STORAGE_KEY, 'steer', memoryStorage());
    assert.equal(store.getBusyInputBehavior(), 'followUp');
    dispatch(STORAGE_KEY, 'steer');
    assert.equal(store.getBusyInputBehavior(), 'steer');
    dispatch(null, null);
    assert.equal(store.getBusyInputBehavior(), 'followUp');
    dispatch(STORAGE_KEY, 'steer');
    dispatch(STORAGE_KEY, 'invalid');
    assert.deepEqual(updates, ['steer', 'followUp', 'steer', 'followUp']);
    unsubscribe();
  });
});
