import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasWorkspaceEntryDrag, isWorkspaceEntryContext, readWorkspaceEntryDrag, writeWorkspaceEntryDrag, WORKSPACE_ENTRY_DRAG_MIME } from '../packages/ui/src/workspaceContextTransfer.ts';

function transfer() {
  const data = new Map();
  return { data, get types() { return [...data.keys()]; }, setData: (type, value) => data.set(type, value), getData: (type) => data.get(type) ?? '', effectAllowed: 'all' };
}

test('file tree entries round-trip through a drag as workspace-relative context requests', () => {
  const dataTransfer = transfer();
  writeWorkspaceEntryDrag(dataTransfer, { kind: 'file', workspace: 'E:\\work\\app', path: 'src/main.ts' });
  assert.ok(hasWorkspaceEntryDrag(dataTransfer));
  assert.equal(dataTransfer.getData('text/plain'), 'src/main.ts');
  assert.equal(dataTransfer.effectAllowed, 'copy');
  assert.deepEqual(readWorkspaceEntryDrag(dataTransfer), { kind: 'file', workspace: 'E:\\work\\app', path: 'src/main.ts' });
});

test('foreign or malformed drag payloads and requests are rejected', () => {
  const dataTransfer = transfer();
  assert.equal(hasWorkspaceEntryDrag(dataTransfer), false);
  dataTransfer.setData(WORKSPACE_ENTRY_DRAG_MIME, '{not json');
  assert.equal(readWorkspaceEntryDrag(dataTransfer), null);
  dataTransfer.setData(WORKSPACE_ENTRY_DRAG_MIME, JSON.stringify({ kind: 'session', workspace: '/w', path: '/w/s.jsonl' }));
  assert.equal(readWorkspaceEntryDrag(dataTransfer), null);
  for (const value of [null, {}, { kind: 'file', workspace: '', path: 'a' }, { kind: 'file', workspace: '/w', path: '' }, { kind: 'directory', workspace: '/w', path: 'a\nb' }]) {
    assert.equal(isWorkspaceEntryContext(value), false);
  }
  assert.equal(isWorkspaceEntryContext({ kind: 'directory', workspace: '/w', path: 'docs' }), true);
});
