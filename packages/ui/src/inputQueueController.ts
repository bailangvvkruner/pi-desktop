import type { InputFeatureBridge, UiInputQueue, UiInputQueueMutation, UiInputQueueScope } from '../../shared/src/inputFeatures';

type Action = UiInputQueueMutation['action'];
type Bridge = Pick<InputFeatureBridge, 'getInputQueue' | 'mutateInputQueue'>;
interface Job {
  action: Action; id?: string; text?: string; beforeId?: string | null;
  epoch: number; requestId: string; resolve(queue: UiInputQueue | null): void;
}
export interface InputQueueState {
  queue: UiInputQueue | null;
  error: string;
  pendingRows: ReadonlyMap<string, Action>;
  pendingGlobal: boolean;
  activeRow: string | null;
}

/** Serialize mutations while reserving only their target rows. Each dispatch uses the newest version. */
export class InputQueueController {
  private bridge: Bridge;
  private scope: UiInputQueueScope;
  private isCurrent: () => boolean;
  private enabled = false;
  private epoch = 0;
  private readGeneration = 0;
  private jobs: Job[] = [];
  private running = false;
  private listeners = new Set<() => void>();
  private state: InputQueueState = { queue: null, error: '', pendingRows: new Map(), pendingGlobal: false, activeRow: null };

  constructor(bridge: Bridge, scope: UiInputQueueScope, isCurrent: () => boolean = () => true) {
    this.bridge = bridge; this.scope = scope; this.isCurrent = isCurrent;
  }
  getSnapshot = (): InputQueueState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<InputQueueState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.epoch++; this.readGeneration++;
      for (const job of this.jobs.splice(0)) job.resolve(null);
      this.update({ pendingRows: new Map(), pendingGlobal: false, activeRow: null });
    }
  }
  private current(epoch: number): boolean { return this.enabled && this.epoch === epoch && this.isCurrent(); }
  private accept(next: UiInputQueue): UiInputQueue | null {
    if (next.scope && (next.scope.cwd !== this.scope.cwd || next.scope.sessionPath !== this.scope.sessionPath || next.scope.sessionId !== this.scope.sessionId)) return null;
    if (this.state.queue && next.version < this.state.queue.version) return this.state.queue;
    this.update({ queue: next }); return next;
  }
  refresh = async (clearError = true): Promise<UiInputQueue | null> => {
    const epoch = this.epoch, generation = ++this.readGeneration;
    if (!this.current(epoch)) return null;
    try {
      const next = await this.bridge.getInputQueue(this.scope);
      if (!this.current(epoch) || generation !== this.readGeneration) return null;
      const accepted = this.accept(next);
      if (accepted && clearError) this.update({ error: '' });
      return accepted;
    } catch (cause) {
      if (this.current(epoch) && generation === this.readGeneration && clearError) this.update({ error: cause instanceof Error ? cause.message : String(cause) });
      return null;
    }
  };
  mutate = (action: Action, id?: string, text?: string, beforeId?: string | null): Promise<UiInputQueue | null> => {
    if (!this.current(this.epoch) || !this.state.queue || (id ? this.state.pendingRows.has(id) : this.state.pendingGlobal)) return Promise.resolve(null);
    const rows = new Map(this.state.pendingRows);
    if (id) rows.set(id, action);
    this.update({ pendingRows: rows, pendingGlobal: id ? this.state.pendingGlobal : true, error: '' });
    return new Promise(resolve => {
      this.jobs.push({ action, id, text, beforeId, epoch: this.epoch, requestId: crypto.randomUUID(), resolve });
      void this.drain();
    });
  };
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let job: Job | undefined;
      while ((job = this.jobs.shift())) {
        const request = job;
        let result: UiInputQueue | null = null;
        try {
          if (!this.current(request.epoch) || !this.state.queue) continue;
          this.readGeneration++;
          this.update({ activeRow: request.id ?? null });
          const { action, id, text, beforeId, requestId } = request;
          const next = await this.bridge.mutateInputQueue({ scope: this.scope, action, id, text, beforeId, requestId, expectedVersion: this.state.queue.version });
          if (this.current(request.epoch)) result = this.accept(next);
        } catch (cause) {
          if (this.current(request.epoch)) {
            const message = cause instanceof Error ? cause.message : String(cause);
            // A lost reply may already have applied the action; refresh instead of replaying it.
            const refreshed = await this.refresh(false);
            if (this.current(request.epoch)) {
              if (!refreshed) {
                this.update({ queue: null });
                for (const waiting of this.jobs.splice(0)) waiting.resolve(null);
                this.update({ pendingRows: new Map(), pendingGlobal: false });
              }
              this.update({ error: message });
            }
          }
        } finally {
          if (this.current(request.epoch)) {
            const rows = new Map(this.state.pendingRows);
            if (request.id) rows.delete(request.id);
            this.update({ pendingRows: rows, pendingGlobal: request.id ? this.state.pendingGlobal : false, activeRow: null });
          }
          request.resolve(result);
        }
      }
    } finally { this.running = false; }
  }
}
