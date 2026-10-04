import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MERMAID_AUTO_RENDER_MAX_COMPLEXITY_SCORE,
  MERMAID_AUTO_RENDER_MAX_LINES,
  MERMAID_AUTO_RENDER_MAX_SOURCE_CHARS,
  decideMermaidAutoRender,
  measureMermaidSource,
} from '../packages/ui/src/mermaidBudget.ts';

test('small flowchart passes the budget when the document is visible', () => {
  const source = 'graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Run]\n  C --> D[Done]';
  const decision = decideMermaidAutoRender(source, { documentVisible: true });
  assert.equal(decision.shouldRender, true);
  assert.ok(decision.metrics.edgeLikeTokenCount >= 3);
  assert.ok(decision.metrics.nodeLikeTokenCount >= 3);
});

test('hidden documents defer rendering regardless of size', () => {
  const decision = decideMermaidAutoRender('graph TD\n  A --> B', { documentVisible: false });
  assert.equal(decision.shouldRender, false);
  assert.equal(decision.reason, 'document-hidden');
});

test('oversized character count stays as source text', () => {
  const source = `graph TD\n${'  A[Start] --> B[End]\n'.repeat(1200)}`;
  assert.ok(source.length > MERMAID_AUTO_RENDER_MAX_SOURCE_CHARS);
  const decision = decideMermaidAutoRender(source, { documentVisible: true });
  assert.equal(decision.shouldRender, false);
  assert.equal(decision.reason, 'source-too-large');
});

test('too many lines are rejected before complexity', () => {
  const source = `graph TD\n${'  A\n'.repeat(MERMAID_AUTO_RENDER_MAX_LINES + 1)}`;
  const decision = decideMermaidAutoRender(source, { documentVisible: true });
  assert.equal(decision.shouldRender, false);
  assert.equal(decision.reason, 'line-count-too-large');
});

test('dense edge webs exceed the complexity score even under other caps', () => {
  const edges = Array.from({ length: 450 }, (_, index) => `  N${index} --> M${index} --> K${index}`).join('\n');
  const source = `graph TD\n${edges}`;
  const metrics = measureMermaidSource(source);
  assert.ok(metrics.sourceChars <= MERMAID_AUTO_RENDER_MAX_SOURCE_CHARS);
  assert.ok(metrics.lineCount <= MERMAID_AUTO_RENDER_MAX_LINES);
  assert.ok(metrics.complexityScore > MERMAID_AUTO_RENDER_MAX_COMPLEXITY_SCORE);
  const decision = decideMermaidAutoRender(source, { documentVisible: true });
  assert.equal(decision.shouldRender, false);
  assert.equal(decision.reason, 'complexity-too-large');
});
