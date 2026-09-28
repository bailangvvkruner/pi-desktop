import type { WordRange } from './wordDiff';
export interface ReadingInput { text: string; path: string; mode: 'text' | 'diff' | 'edit' }
export interface ReadingAnalysis { html: string[]; words: Record<number, WordRange[]> }
