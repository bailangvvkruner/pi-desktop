import type { DiffSource } from './workbenchReading';

export interface WorkbenchMemory {
  tab: 'files' | 'git' | 'command' | 'terminal';
  directory: string;
  selectedFile: string | null;
  diffPath: string | null;
  diffSource: DiffSource;
}
const initial: WorkbenchMemory = { tab: 'files', directory: '', selectedFile: null, diffPath: null, diffSource: 'unstaged' };
export const WORKBENCH_MEMORY_KEY = 'pi-desktop.workbench-workspaces.v1';
export function workspaceMemoryKey(cwd: string): string {
  const key = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:\//i.test(key) ? key.toLowerCase() : key;
}
function safeRelative(value: unknown): value is string { return typeof value === 'string' && value.length <= 4096 && !/^(?:[a-z]:|[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)|[\u0000-\u001f]/i.test(value); }
function sanitize(value: Partial<WorkbenchMemory>): WorkbenchMemory {
  return { tab: ['files', 'git', 'command', 'terminal'].includes(value.tab ?? '') ? value.tab! : 'files',
    directory: safeRelative(value.directory) ? value.directory : '', selectedFile: safeRelative(value.selectedFile) ? value.selectedFile : null,
    diffPath: safeRelative(value.diffPath) ? value.diffPath : null, diffSource: value.diffSource === 'staged' ? 'staged' : 'unstaged' };
}
/** Only navigation coordinates are persisted: file content, terminal output and commands are never cached. */
export class WorkbenchMemoryStore {
  private entries = new Map<string, WorkbenchMemory>();
  constructor(serialized?: string | null) {
    try { for (const [key, value] of JSON.parse(serialized ?? '[]')) if (typeof key === 'string' && value && typeof value === 'object') this.write(key, value); } catch { /* Old or damaged storage starts empty. */ }
  }
  read(cwd: string): WorkbenchMemory { return this.entries.get(workspaceMemoryKey(cwd)) ?? initial; }
  write(cwd: string, value: WorkbenchMemory): void {
    const key = workspaceMemoryKey(cwd); if (!key) return;
    this.entries.delete(key); this.entries.set(key, sanitize(value));
    while (this.entries.size > 50) this.entries.delete(this.entries.keys().next().value!);
  }
  serialize(): string { return JSON.stringify([...this.entries]); }
}
