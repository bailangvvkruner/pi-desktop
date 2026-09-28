import { useEffect, useState } from 'react';
import type { ReadingAnalysis, ReadingInput } from './readingWorkerTypes';
import { requestReadingAnalysis } from './readingWorkerPool';
const empty: ReadingAnalysis = { html: [], words: {} };
/** Failure leaves the immediately rendered plain text intact; cleanup cancels stale background work. */
export function useReadingAnalysis(text: string, path: string, mode: ReadingInput['mode'], enabled = true): ReadingAnalysis {
  const [result, setResult] = useState<{ text: string; path: string; mode: string; analysis: ReadingAnalysis } | null>(null);
  useEffect(() => {
    if (!enabled || !text || text.length > 1_000_000 || typeof Worker === 'undefined') return;
    let active = true;
    const cancel = requestReadingAnalysis({ text, path, mode }, analysis => { if (active) setResult({ text, path, mode, analysis }); });
    return () => { active = false; cancel(); };
  }, [text, path, mode, enabled]);
  return enabled && result?.text === text && result.path === path && result.mode === mode ? result.analysis : empty;
}
