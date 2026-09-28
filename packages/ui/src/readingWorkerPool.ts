import type { ReadingAnalysis, ReadingInput } from './readingWorkerTypes';
type Job = { input: ReadingInput; done(value: ReadingAnalysis): void; cancelled: boolean };
type Slot = { worker: Worker; job: Job | null; timer?: ReturnType<typeof setTimeout> };
const queue: Job[] = [], slots = new Set<Slot>();
const empty: ReadingAnalysis = { html: [], words: {} };
function dispose(slot: Slot) { clearTimeout(slot.timer); slot.worker.terminate(); slots.delete(slot); }
function pump() {
  while (queue.length) {
    let slot = [...slots].find(value => !value.job);
    if (!slot) {
      if (slots.size >= 2) return;
      try {
        slot = { worker: new Worker(new URL('./reading.worker.ts', import.meta.url), { type: 'module' }), job: null };
        slots.add(slot);
        const currentSlot = slot;
        slot.worker.onmessage = (event: MessageEvent<ReadingAnalysis>) => {
          if (!slots.has(currentSlot)) return;
          clearTimeout(currentSlot.timer);
          const job = currentSlot.job; currentSlot.job = null;
          if (job && !job.cancelled) job.done(event.data);
          currentSlot.timer = setTimeout(() => dispose(currentSlot), 5000);
          pump();
        };
        slot.worker.onerror = () => { if (!slots.has(currentSlot)) return; const job = currentSlot.job; dispose(currentSlot); if (job && !job.cancelled) job.done(empty); pump(); };
      } catch { while (queue.length) { const job = queue.shift()!; if (!job.cancelled) job.done(empty); } return; }
    }
    const job = queue.shift()!;
    if (job.cancelled) continue;
    clearTimeout(slot.timer); slot.job = job;
    const currentSlot = slot;
    slot.timer = setTimeout(() => { dispose(currentSlot); if (!job.cancelled) job.done(empty); pump(); }, 10_000);
    try { slot.worker.postMessage(job.input); } catch { dispose(slot); job.done(empty); }
  }
}
/** Bound concurrent work and retained requests when many expanded tool diffs mount together. */
export function requestReadingAnalysis(input: ReadingInput, done: Job['done']): () => void {
  if (typeof Worker === 'undefined') { done(empty); return () => {}; }
  const job: Job = { input, done, cancelled: false };
  while (queue.length >= 32) { const previous = queue.shift()!; previous.cancelled = true; previous.done(empty); }
  queue.push(job); pump();
  return () => {
    job.cancelled = true;
    const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
    for (const slot of slots) if (slot.job === job) { dispose(slot); break; }
    pump();
  };
}
