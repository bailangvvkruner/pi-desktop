import type { UiSessionStats } from '@pidesktop/shared';

export function conversationMetricsAt(stats: UiSessionStats | null, now: number, running = true): { durationMs: number | null; tokensPerSecond: number | null } {
	const timing = stats?.timing;
	if (!timing) return { durationMs: null, tokensPerSecond: null };
	const extra = running ? Math.max(0, now - timing.sampledAt) : 0;
	const latest = timing.latestRun;
	const durationMs = timing.durationMs === null ? null : timing.durationMs + (timing.running ? extra : 0);
	const latestDuration = latest?.durationMs == null ? 0 : latest.durationMs + (latest.running ? extra : 0);
	return { durationMs, tokensPerSecond: latest && latest.outputTokens > 0 && latestDuration > 0 ? latest.outputTokens * 1_000 / latestDuration : null };
}
export function formatMetricTokens(value: number | undefined, locale: string): string {
	if (value === undefined || !Number.isFinite(value) || value < 0) return '—';
	if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M`;
	if (value >= 1_000) return `${(value / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 })}K`;
	return value.toLocaleString(locale);
}
export function formatMetricDuration(milliseconds: number | null): string {
	if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) return '—';
	const seconds = Math.floor(milliseconds / 1_000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
	return hours ? `${hours}h ${minutes % 60}m` : minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}
