import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreSubmittedDraft } from '../packages/ui/src/composerDrafts.ts';

const image = name => ({ kind: 'image', name, mimeType: 'image/png', data: 'YQ==' });

test('a failed optimistic send restores the exact draft and attachment identity for an idempotent retry', () => {
  const submitted = { text: '  Keep the original draft  ', attachments: [image('original.png')] };
  const drafts = new Map([['detached', { text: '', attachments: [] }]]);
  const restored = restoreSubmittedDraft(drafts, 'detached', submitted);
  assert.equal(restored, submitted);
  assert.equal(drafts.get('detached').attachments, submitted.attachments);
});

test('recovery preserves text and attachments added while project preparation was pending', () => {
  const original = image('original.png'), later = image('later.png');
  const submitted = { text: 'First message', attachments: [original] };
  const drafts = new Map([['detached', { text: 'Next draft', attachments: [original, later] }]]);
  assert.deepEqual(restoreSubmittedDraft(drafts, 'detached', submitted), {
    text: 'First message\n\nNext draft', attachments: [original, later],
  });
});

test('cancelling project preparation after navigation restores only the originating draft', () => {
  const unrelated = { text: 'Other conversation', attachments: [image('other.png')] };
  const submitted = { text: 'Waiting message', attachments: [image('waiting.png')] };
  const drafts = new Map([['origin', { text: '', attachments: [] }], ['unrelated', unrelated]]);
  restoreSubmittedDraft(drafts, 'origin', submitted);
  assert.equal(drafts.get('origin'), submitted);
  assert.equal(drafts.get('unrelated'), unrelated);
});

test('an attachment-only message and newer text both survive failure without an extra separator', () => {
  const submitted = { text: '', attachments: [image('original.png')] };
  const drafts = new Map([['detached', { text: 'New text', attachments: [] }]]);
  assert.deepEqual(restoreSubmittedDraft(drafts, 'detached', submitted), {
    text: 'New text', attachments: submitted.attachments,
  });
});
