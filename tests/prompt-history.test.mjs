import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendPromptHistory, MAX_PROMPT_HISTORY, PromptHistoryCursor, promptHistoryDirection, readPromptHistory, savePromptHistory } from '../packages/ui/src/promptHistory.ts';

test('prompt history retains thirty nonempty submissions and only deduplicates consecutive prompts', () => {
  let entries = [];
  for (let i = 0; i < 50; i++) entries = appendPromptHistory(entries, `Prompt ${i}`);
  assert.equal(entries.length, MAX_PROMPT_HISTORY);
  assert.equal(entries[0], 'Prompt 20');
  assert.deepEqual(appendPromptHistory(entries, '   '), entries);
  assert.deepEqual(appendPromptHistory(entries, '  Prompt 49  '), entries);
  assert.deepEqual(appendPromptHistory(['A', 'B'], 'A'), ['A', 'B', 'A']);
});

test('history is isolated by workspace and malformed or unavailable storage never blocks sending', () => {
  const records = new Map();
  const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  savePromptHistory('C:/project A', ' first ', storage);
  savePromptHistory('C:/project B', 'second', storage);
  assert.deepEqual(readPromptHistory('C:/project A', storage), ['first']);
  assert.deepEqual(readPromptHistory('C:/project B', storage), ['second']);
  const broken = { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('full'); } };
  assert.doesNotThrow(() => savePromptHistory('C:/project A', 'third', broken));
  assert.deepEqual(readPromptHistory('C:/project A', broken), []);
  assert.deepEqual(readPromptHistory('x', { ...storage, getItem: () => '{bad' }), []);
  assert.deepEqual(readPromptHistory('x', { ...storage, getItem: () => '[null,2,"","good"]' }), ['good']);
});

test('history cursor browses a stable snapshot and restores the original unsent draft', () => {
  const cursor = new PromptHistoryCursor();
  assert.equal(cursor.navigate(['first', '/second\nline'], ' \n', 'up'), '/second\nline');
  assert.equal(cursor.navigate(['unrelated new entry'], '/second\nline', 'up'), 'first');
  assert.equal(cursor.navigate([], 'first', 'up'), 'first');
  assert.equal(cursor.navigate([], 'first', 'down'), '/second\nline');
  assert.equal(cursor.navigate([], '/second\nline', 'down'), ' \n');
  assert.equal(cursor.index, null);
  assert.equal(cursor.navigate(['again'], '', 'down'), 'again');
  assert.equal(cursor.cancel(), '');
  assert.equal(cursor.cancel(), null);
});

test('history never replaces an edited prompt or intercepts multiline cursor movement', () => {
  const cursor = new PromptHistoryCursor();
  assert.equal(cursor.navigate(['old'], 'unsent\nwork', 'up'), null);
  assert.equal(cursor.navigate(['old'], '', 'up'), 'old');
  assert.equal(cursor.navigate(['old'], 'old with edits', 'down'), null);
  assert.equal(cursor.cancel(), null);
  assert.equal(cursor.navigate([], '', 'up'), null);
});

test('history navigation ignores IME composition, legacy IME keys and modifier shortcuts', () => {
  const key = { key: 'ArrowUp', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
  assert.equal(promptHistoryDirection(key), 'up');
  assert.equal(promptHistoryDirection({ ...key, key: 'ArrowDown' }), 'down');
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing']) assert.equal(promptHistoryDirection({ ...key, [modifier]: true }), null);
  assert.equal(promptHistoryDirection({ ...key, keyCode: 229 }), null);
});
