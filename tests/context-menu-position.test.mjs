import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextMenuPosition } from '../packages/ui/src/contextMenuPosition.ts';

test('context menus begin at the pointer when space is available', () => {
  assert.deepEqual(contextMenuPosition({ x: 170, y: 240 }, { width: 216, height: 270 }, { width: 1440, height: 1000 }), { left: 170, top: 240 });
});

test('edge placement keeps the whole menu in view while retaining the unaffected axis', () => {
  const size = { width: 216, height: 270 }, viewport = { width: 680, height: 600 };
  assert.deepEqual(contextMenuPosition({ x: 670, y: 200 }, size, viewport), { left: 456, top: 200 });
  assert.deepEqual(contextMenuPosition({ x: 100, y: 590 }, size, viewport), { left: 100, top: 322 });
  assert.deepEqual(contextMenuPosition({ x: 670, y: 590 }, size, viewport), { left: 456, top: 322 });
  assert.deepEqual(contextMenuPosition({ x: 0, y: 0 }, size, viewport), { left: 8, top: 8 });
});
