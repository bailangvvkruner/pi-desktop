import type { PaneSession } from './conversationPanes.ts';

interface ActivationSource {
  bridge: unknown;
  navigationRequestId: number;
  cwd: string;
  sessionId: string | null;
  sessionPath: string | null;
  selectResidentSession(cwd: string, sessionId: string, sessionPath: string | null): Promise<boolean>;
  selectSession(cwd: string, path: string): Promise<boolean>;
}

/** A false resident result can mean either a cache miss or a superseding navigation. */
export async function selectPaneSession(read: () => ActivationSource, selected: PaneSession, isMounted = () => true): Promise<'selected' | 'cancelled' | 'released'> {
  const start = read();
  if (start.cwd === selected.cwd && start.sessionId === selected.sessionId && start.sessionPath === selected.sessionPath) return 'selected';
  let request = start.navigationRequestId;
  const current = () => isMounted() && read().bridge === start.bridge && read().navigationRequestId === request;
  try {
    const resident = start.selectResidentSession(selected.cwd, selected.sessionId, selected.sessionPath);
    request = read().navigationRequestId;
    const retained = await resident;
    if (!current()) return 'cancelled';
    if (retained) return 'selected';
    if (!selected.sessionPath) return 'released';
    const loaded = read().selectSession(selected.cwd, selected.sessionPath);
    request = read().navigationRequestId;
    const completed = await loaded;
    return current() && completed ? 'selected' : 'cancelled';
  } catch (error) {
    if (!current()) return 'cancelled';
    throw error;
  }
}
