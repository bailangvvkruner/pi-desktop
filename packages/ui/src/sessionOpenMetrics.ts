import type { UiDiagnosticEvent } from '@pidesktop/shared';

type Target = { cwd?: string; path?: string | null; sessionId?: string };
type Scope = { cwd: string; path: string | null; sessionId?: string };
type Navigation = { request: number; paintToken: number; target: Target; retainedScope?: Scope; snapshotScope?: Scope; started: number; snapshot?: number; rpc?: number; committed?: number; ready: boolean; id: string; temperature?: 'warm' | 'cold'; report(event: UiDiagnosticEvent): void };
const matches = (target: Target, scope: Scope) => (target.cwd === undefined || target.cwd === scope.cwd)
  && (target.path === undefined || target.path === scope.path) && (target.sessionId === undefined || target.sessionId === scope.sessionId);
/** Durations are local only; paths are used for matching and never reported. */
export function createSessionOpenMetrics(now = () => performance.now()) {
  let current: Navigation | null = null;
  let generation = 0;
  const finish = (outcome: UiDiagnosticEvent['outcome'], paint?: number) => {
    const n = current;
    if (!n) return;
    current = null;
    n.report({ id: n.id, scope: 'session-navigation', kind: 'session-open', outcome, ...(n.temperature ? { temperature: n.temperature } : {}), durationMs: now() - n.started,
      phases: { ...(n.rpc === undefined ? {} : { rpcMs: n.rpc - n.started }), ...(n.snapshot === undefined ? {} : { snapshotMs: n.snapshot - n.started }),
        ...(n.committed === undefined || n.snapshot === undefined ? {} : { renderMs: n.committed - n.snapshot }), ...(paint === undefined || n.committed === undefined ? {} : { paintMs: paint - n.committed }) } });
  };
  return {
    begin(request: number, target: Target, report: Navigation['report'], retainedScope?: Scope) {
      finish('cancelled');
      current = { request, target, report, paintToken: ++generation, started: now(), ready: false, id: crypto.randomUUID(),
        ...((target.path !== undefined || target.sessionId !== undefined) && retainedScope && matches(target, retainedScope) ? { retainedScope } : {}) };
    },
    snapshot(cwd: string, path: string | null, sessionId?: string, resumeKind: 'warm' | 'cold' = 'cold') {
      const scope = { cwd, path, sessionId };
      if (!current || !matches(current.target, scope)) return;
      if (current.snapshot === undefined || !current.snapshotScope || !matches(current.snapshotScope, scope)) {
        current.snapshot = now(); current.snapshotScope = scope; current.temperature = resumeKind; current.committed = undefined;
      }
    },
    reuseSnapshot(request: number, cwd: string, path: string | null, sessionId: string) {
      const n = current, scope = { cwd, path, sessionId };
      // 只允许重新选择导航开始时已显示的同一会话；新建、取消及目标未激活不能用旧画面冒充成功。
      if (n?.request === request && n.snapshot === undefined && n.retainedScope && matches(n.retainedScope, scope) && matches(n.target, scope)) {
        n.snapshot = now(); n.snapshotScope = scope; n.temperature = 'warm';
      }
    },
    rpc(request: number) { if (current?.request === request) current.rpc = now(); },
    settled(request: number, failed: boolean) { if (current?.request === request) { if (failed) finish('failure'); else current.ready = true; } },
    rendered(cwd: string, path: string | null, sessionId?: string): number | null {
      const n = current;
      const scope = { cwd, path, sessionId };
      if (!n?.ready || n.snapshot === undefined || !n.snapshotScope || !matches(n.target, scope) || !matches(n.snapshotScope, scope)) return null;
      n.committed = now();
      return n.paintToken;
    },
    painted(token: number) { if (current?.paintToken === token && current.ready && current.committed !== undefined) finish('success', now()); },
    cancel(request?: number) { if (request === undefined || current?.request === request) finish('cancelled'); },
  };
}
export const sessionOpenMetrics = createSessionOpenMetrics();
