import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { UiConversationRun, UiSessionStats } from '@pidesktop/shared';
import { readConversationRuns } from './conversationRuns.ts';

/** Use the full selected branch, rather than the paginated renderer timeline. */
export function sessionTiming(entries: SessionEntry[], live: UiConversationRun | null, now = Date.now()): NonNullable<UiSessionStats['timing']> {
	const { runs, entryRuns } = readConversationRuns(entries, live);
	const elapsed = (run: UiConversationRun): number | null => run.finishedAt !== null
		? Math.max(0, run.finishedAt - run.startedAt)
		: run.status === 'running' ? Math.max(0, now - run.startedAt) : null;
	const hasUntrackedMessages = entries.some(entry => entry.type === 'message'
		&& (entry.message.role === 'user' || entry.message.role === 'assistant') && !entryRuns.has(entry.id));
	const durations = runs.map(elapsed);
	const latest = runs.at(-1);
	let outputTokens = 0;
	if (latest) for (const entry of entries) {
		if (entry.type !== 'message' || entry.message.role !== 'assistant' || entryRuns.get(entry.id) !== latest.id) continue;
		const output = entry.message.usage?.output;
		if (Number.isFinite(output) && output > 0) outputTokens += output;
	}
	return {
		sampledAt: now,
		durationMs: hasUntrackedMessages || durations.some(value => value === null) ? null : durations.reduce<number>((sum, value) => sum + (value ?? 0), 0),
		running: runs.some(run => run.status === 'running'),
		latestRun: latest ? { id: latest.id, durationMs: elapsed(latest), outputTokens, running: latest.status === 'running' } : null,
	};
}
