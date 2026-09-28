import { useCallback, useSyncExternalStore } from 'react';
import { WorkbenchMemoryStore, WORKBENCH_MEMORY_KEY, type WorkbenchMemory } from './workbenchMemory';

let memory: WorkbenchMemoryStore | undefined;
const listeners = new Set<() => void>();
function store() {
  if (!memory) { let saved: string | null = null; try { saved = localStorage.getItem(WORKBENCH_MEMORY_KEY); } catch {} memory = new WorkbenchMemoryStore(saved); }
  return memory;
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useWorkbenchMemory(cwd: string) {
  const get = useCallback(() => store().read(cwd), [cwd]);
  const state = useSyncExternalStore(subscribe, get, get);
  function update<K extends keyof WorkbenchMemory>(key: K, value: WorkbenchMemory[K] | ((previous: WorkbenchMemory[K]) => WorkbenchMemory[K])) {
    const previous = store().read(cwd);
    const next = typeof value === 'function' ? value(previous[key]) : value;
    if (previous[key] === next) return;
    store().write(cwd, { ...previous, [key]: next });
    try { localStorage.setItem(WORKBENCH_MEMORY_KEY, store().serialize()); } catch {}
    for (const listener of listeners) listener();
  }
  return { state, update };
}
