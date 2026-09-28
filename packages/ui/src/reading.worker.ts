import { analyzeReading } from './readingHighlight';
import type { ReadingInput } from './readingWorkerTypes';
self.onmessage = (event: MessageEvent<ReadingInput>) => {
  try { self.postMessage(analyzeReading(event.data)); }
  catch { self.postMessage({ html: [], words: {} }); }
};
