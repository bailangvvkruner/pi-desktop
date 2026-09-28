import { Component, type ReactNode } from 'react';
import type { UiDiagnosticEvent } from '@pidesktop/shared';
import { useT } from '../i18n';
import { ErrorDetails } from './ErrorDetails';

export interface ScopedErrorBoundaryProps { children: ReactNode; scope: UiDiagnosticEvent['scope']; resetKeys?: readonly unknown[]; onReset?: () => void }
export function resetKeysChanged(previous: readonly unknown[] = [], current: readonly unknown[] = []): boolean {
  return previous.length !== current.length || previous.some((value, index) => !Object.is(value, current[index]));
}
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(typeof value === 'string' ? value : 'Unknown rendering failure'); }
function ScopedFailure({ error, scope, onRetry }: { error: Error; scope: UiDiagnosticEvent['scope']; onRetry: () => void }) {
  const { locale } = useT();
  return <section className="pd-scoped-error" role="alert"><strong>{locale === 'zh-CN' ? '此区域暂时无法显示' : 'This area could not be displayed'}</strong><button type="button" onClick={onRetry}>{locale === 'zh-CN' ? '重试此区域' : 'Retry this area'}</button><ErrorDetails error={error.stack ?? error.message} scope={scope} kind="render-error" /></section>;
}
/** Rendering failures stay local. A different file/session automatically gets a fresh subtree. */
export class ScopedErrorBoundary extends Component<ScopedErrorBoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error: asError(error) }; }
  componentDidUpdate(previous: ScopedErrorBoundaryProps) {
    if (this.state.error && (previous.scope !== this.props.scope || resetKeysChanged(previous.resetKeys, this.props.resetKeys))) this.setState({ error: null });
  }
  private retry = () => {
    try { this.props.onReset?.(); this.setState({ error: null }); }
    catch (error) { this.setState({ error: asError(error) }); }
  };
  render() { return this.state.error ? <ScopedFailure error={this.state.error} scope={this.props.scope} onRetry={this.retry} /> : this.props.children; }
}
