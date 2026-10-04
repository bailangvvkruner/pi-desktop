/**
 * Mermaid auto-render budget (zcode-style): oversized or overly complex
 * diagrams stay as source text instead of freezing the conversation, and
 * hidden documents defer rendering until they become visible again.
 */

export const MERMAID_AUTO_RENDER_MAX_SOURCE_CHARS = 20_000;
export const MERMAID_AUTO_RENDER_MAX_LINES = 600;
export const MERMAID_AUTO_RENDER_MAX_COMPLEXITY_SCORE = 1_500;

export type MermaidAutoRenderSkipReason =
  | 'document-hidden'
  | 'source-too-large'
  | 'line-count-too-large'
  | 'complexity-too-large';

export interface MermaidAutoRenderMetrics {
  sourceChars: number;
  lineCount: number;
  edgeLikeTokenCount: number;
  nodeLikeTokenCount: number;
  complexityScore: number;
}

export type MermaidAutoRenderDecision =
  | { shouldRender: true; metrics: MermaidAutoRenderMetrics }
  | { shouldRender: false; reason: MermaidAutoRenderSkipReason; metrics: MermaidAutoRenderMetrics };

/** Edge-like connectors: sequence, flowchart and class arrows in one pass. */
const EDGE_LIKE = /-->|->|==>|=>|-\.->|--|~~>|<-|<--/g;
// Node-like shapes anywhere on the line: an identifier directly followed by a
// shape delimiter. Multiple nodes can share one line, so no ^ anchor here.
const NODE_LIKE = /\b[A-Za-z0-9_$-]+\s*(?=[[({<])/g;

export function measureMermaidSource(source: string): MermaidAutoRenderMetrics {
  const edgeLikeTokenCount = [...source.matchAll(EDGE_LIKE)].length;
  const nodeLikeTokenCount = [...source.matchAll(NODE_LIKE)].length;
  return {
    sourceChars: source.length,
    lineCount: source.split('\n').length,
    edgeLikeTokenCount,
    nodeLikeTokenCount,
    // Edges cost double: each one becomes a path plus a label in the SVG.
    complexityScore: edgeLikeTokenCount * 2 + nodeLikeTokenCount,
  };
}

export function decideMermaidAutoRender(source: string, options: { documentVisible: boolean }): MermaidAutoRenderDecision {
  const metrics = measureMermaidSource(source);
  if (!options.documentVisible) return { shouldRender: false, reason: 'document-hidden', metrics };
  if (metrics.sourceChars > MERMAID_AUTO_RENDER_MAX_SOURCE_CHARS) return { shouldRender: false, reason: 'source-too-large', metrics };
  if (metrics.lineCount > MERMAID_AUTO_RENDER_MAX_LINES) return { shouldRender: false, reason: 'line-count-too-large', metrics };
  if (metrics.complexityScore > MERMAID_AUTO_RENDER_MAX_COMPLEXITY_SCORE) return { shouldRender: false, reason: 'complexity-too-large', metrics };
  return { shouldRender: true, metrics };
}
