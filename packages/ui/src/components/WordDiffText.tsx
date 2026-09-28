import type { ReactNode } from 'react';
import type { WordRange } from '../wordDiff';
export function WordDiffText({ text, ranges }: { text: string; ranges: WordRange[] }) {
  const pieces: ReactNode[] = []; let cursor = 0;
  for (const range of ranges) { pieces.push(text.slice(cursor, range.start), <mark className="pd-diff-word" key={range.start}>{text.slice(range.start, range.end)}</mark>); cursor = range.end; }
  pieces.push(text.slice(cursor)); return <>{pieces}</>;
}
