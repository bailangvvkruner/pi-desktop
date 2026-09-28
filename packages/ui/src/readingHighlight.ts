import hljs from 'highlight.js/lib/common';
import { readingRows } from './workbenchReading.ts';
import { parsePiEditDiff } from './unifiedDiff.ts';
import { diffWordRanges } from './wordDiff.ts';
import type { ReadingAnalysis, ReadingInput } from './readingWorkerTypes';
const LANGUAGES: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', py: 'python', sh: 'bash', ps1: 'powershell', yml: 'yaml', md: 'markdown', h: 'cpp', rs: 'rust', cs: 'csharp' };
/** Retain multiline tokens while making every line an independently valid HTML fragment. */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = []; const stack: string[] = []; let line = '';
  for (const piece of html.split(/(<span\b[^>]*>|<\/span>|\n)/g)) {
    if (piece === '\n') { lines.push(line + '</span>'.repeat(stack.length)); line = stack.join(''); }
    else { line += piece; if (piece.startsWith('<span')) stack.push(piece); else if (piece === '</span>') stack.pop(); }
  }
  lines.push(line + '</span>'.repeat(stack.length)); return lines;
}
export function analyzeReading(input: ReadingInput): ReadingAnalysis {
  const { text, path, mode } = input;
  if (text.length > 1_000_000) return { html: [], words: {} };
  const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
  const language = LANGUAGES[extension] ?? extension;
  const rows = mode === 'edit' ? parsePiEditDiff(text) : readingRows(text, mode === 'diff');
  const words = mode === 'text' ? {} : diffWordRanges(rows, mode === 'diff' ? 1 : 0);
  let html: string[] = [];
  if (text.length <= 300_000 && rows.length <= 10_000 && hljs.getLanguage(language)) {
    if (mode === 'text') html = splitHighlightedLines(hljs.highlight(text, { language, ignoreIllegals: true }).value);
    else html = rows.map(row => row.text.length > 4096 ? '' : hljs.highlight(row.text, { language, ignoreIllegals: true }).value);
  }
  return { html, words };
}
