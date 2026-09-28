export const MAX_PROMPT_HISTORY = 30;
const PREFIX = 'pi-desktop.prompt-history.v1:';
type HistoryStorage = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): HistoryStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

/** Prompts remain local and are shared only by conversations in the same workspace. */
export function readPromptHistory(cwd: string, target = storage()): string[] {
  try {
    const value: unknown = JSON.parse(target?.getItem(PREFIX + encodeURIComponent(cwd)) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).slice(-MAX_PROMPT_HISTORY);
  } catch { return []; }
}

export function appendPromptHistory(entries: readonly string[], text: string): string[] {
  const value = text.trim();
  const bounded = entries.slice(-MAX_PROMPT_HISTORY);
  if (!value || bounded.at(-1)?.trim() === value) return bounded;
  return [...bounded, value].slice(-MAX_PROMPT_HISTORY);
}

export function savePromptHistory(cwd: string, text: string, target = storage()): void {
  try { target?.setItem(PREFIX + encodeURIComponent(cwd), JSON.stringify(appendPromptHistory(readPromptHistory(cwd, target), text))); } catch { /* Sending remains available if local storage is full. */ }
}

export function promptHistoryDirection(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean; keyCode?: number }): 'up' | 'down' | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing || event.keyCode === 229) return null;
  return event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : null;
}

/** A snapshot prevents concurrent sends in other panes from moving the browse cursor. */
export class PromptHistoryCursor {
  private entries: readonly string[] = [];
  private draft = '';
  index: number | null = null;
  reset(): void { this.index = null; this.entries = []; this.draft = ''; }
  cancel(): string | null {
    if (this.index === null) return null;
    const draft = this.draft; this.reset(); return draft;
  }
  navigate(entries: readonly string[], text: string, direction: 'up' | 'down'): string | null {
    if (this.index !== null && this.entries[this.index] !== text) this.reset();
    if (this.index === null) {
      // Never intercept ordinary multiline editing, selections, or an unsent prompt.
      if (text.trim() || !entries.length) return null;
      this.entries = [...entries]; this.draft = text; this.index = this.entries.length - 1;
    } else if (direction === 'up') this.index = Math.max(0, this.index - 1);
    else if (this.index === this.entries.length - 1) return this.cancel();
    else this.index++;
    return this.entries[this.index] ?? null;
  }
}
