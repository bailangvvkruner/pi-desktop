import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import type { UiQueuedMessage } from '@pidesktop/shared';
import type { InputFeatureBridge, UiInputQueueScope } from '../../shared/src/inputFeatures';
import { useChatStore } from './store';
import { InputQueueController } from './inputQueueController';

/** Session-scoped, serialized mutations with independent row feedback. */
export function useInputQueue(items: UiQueuedMessage[]) {
  const bridge = useChatStore(state => state.bridge) as Partial<InputFeatureBridge> | null;
  const cwd = useChatStore(state => state.cwd), sessionPath = useChatStore(state => state.sessionPath), sessionId = useChatStore(state => state.sessionId);
  const loading = useChatStore(state => state.sessionLoading || state.navigationPending), status = useChatStore(state => state.status);
  const available = Boolean(cwd && sessionId && !loading && (status === 'busy' || status === 'idle') && bridge?.getInputQueue && bridge?.mutateInputQueue);
  const scope = useMemo<UiInputQueueScope>(() => ({ cwd, sessionPath, sessionId: sessionId ?? '' }), [cwd, sessionPath, sessionId]);
  const controller = useMemo(() => new InputQueueController({
    getInputQueue: value => bridge!.getInputQueue!(value),
    mutateInputQueue: request => bridge!.mutateInputQueue!(request),
  }, scope, () => {
    const current = useChatStore.getState();
    return current.bridge === bridge && current.cwd === scope.cwd && current.sessionPath === scope.sessionPath && current.sessionId === scope.sessionId
      && !current.navigationPending && !current.sessionLoading && (current.status === 'busy' || current.status === 'idle');
  }), [bridge, scope]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => { controller.setEnabled(available); return () => controller.setEnabled(false); }, [controller, available]);
  useEffect(() => { if (available) void controller.refresh(); }, [controller, items, available]);
  return { ...state, pending: state.pendingRows.size > 0 || state.pendingGlobal, ready: available && Boolean(state.queue), refresh: controller.refresh, mutate: controller.mutate };
}
