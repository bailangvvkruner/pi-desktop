// Built-renderer regression through an owned headless shell; never attaches a user window.
// Prepare: node --check tests/fixtures/conversation-thinking-scroll/scenarios.mjs
// Run after build: node tests/fixtures/model-settings/run.mjs --run --scenario=../conversation-thinking-scroll/scenarios.mjs
export default async function conversationThinkingScrollScenarios(review) {
	await review.waitFor('window.__modelReview?.ready === true');
	await review.reducedMotion(true);
	await review.viewport(1440, 1000);
	await review.evaluate(`(() => {
		const fixture = window.__modelReview;
		const state = window.__thinkingReview = {};
		state.visible = node => !!node && !node.closest('[hidden],[inert],[aria-hidden="true"]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
		const paragraph = index => '第 ' + String(index).padStart(2, '0') + ' 段：' + '思考内容自身的滚动到达边界之后，滚轮必须继续传递给会话滚动，不能把读者困在思考块里。 '.repeat(4);
		const thinking = Array.from({ length: 40 }, (_, index) => paragraph(index + 1)).join('\\n\\n');
		const messages = [
			...Array.from({ length: 4 }, (_, index) => ({ id: 'top-user-' + index, order: index, role: 'user', text: '铺垫问题 ' + (index + 1) + '：'.padEnd(4, '　') + '保持思考块前后都有可滚动内容。 '.repeat(3), status: 'done' })),
			{ id: 'deep-user', order: 4, role: 'user', text: '请深入分析这个滚动问题。', status: 'done' },
			{ id: 'deep-answer', order: 5, role: 'assistant', text: '结论：思考块到达边界后，滚轮可以继续滚动会话。', thinking, thinkingStatus: 'done', status: 'done' },
			...Array.from({ length: 14 }, (_, index) => ({ id: 'tail-user-' + index, order: 6 + index, role: 'user', text: '后续问题 ' + (index + 1) + '：让会话整体保持可滚动。 '.repeat(4), status: 'done' })),
		];
		Object.assign(fixture.snapshot, { messages, activities: [], runs: [], historyTotal: messages.length, status: 'idle', error: null });
		window.piDesktop.listSessions = async () => [];
		fixture.emitAgent({ ...structuredClone(fixture.snapshot), type: 'ready' });
		fixture.emitAgent({ type: 'status', status: 'idle' });
	})()`);
	await review.waitFor('Boolean(document.querySelector("[data-message-id=deep-answer]").closest(".pd-conversation-turn").querySelector("button.pd-turn-summary[aria-expanded=false]"))');
	// Settled turns fold their process by default; open the thinking run first.
	await review.click('.pd-conversation-turn button.pd-turn-summary');
	await review.waitFor('document.querySelectorAll(".pd-thinking-markdown").length === 1 && document.querySelector(".pd-transcript").scrollHeight > document.querySelector(".pd-transcript").clientHeight');
	// Reasoning collapses by default even after the turn opens; only its newest
	// line stays visible in the preview until the reader expands the block.
	await review.assert('(() => { const summary = document.querySelector(".pd-conversation-turn .pd-thinking-summary"); return summary.getAttribute("aria-expanded") === "false" && window.__thinkingReview.visible(summary.querySelector(".pd-thinking-preview")); })()', 'Settled reasoning stays collapsed by default and previews its newest line');
	await review.click('.pd-conversation-turn .pd-thinking-summary');
	await review.evaluate('document.querySelector("[data-message-id=deep-answer]").scrollIntoView({ block: "center" })');
	await review.waitFor('window.__thinkingReview.visible(document.querySelector(".pd-thinking-markdown"))');

	const point = await review.evaluate(`(() => {
		const node = document.querySelector('.pd-thinking-markdown');
		const rect = node.getBoundingClientRect();
		const x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + Math.min(rect.height / 2, 100));
		if (!node.contains(document.elementFromPoint(x, y))) throw new Error('Thinking content is not a usable wheel target');
		return { x, y };
	})()`);
	await review.mouseMove(point.x, point.y);

	await review.assert('(() => { const el = document.querySelector(".pd-thinking-markdown"); return el.scrollHeight > el.clientHeight && el.clientHeight <= 262; })()', 'Long thinking stays height-capped and scrolls inside its own box');
	await review.assert('getComputedStyle(document.querySelector(".pd-thinking-markdown")).overscrollBehavior === "auto"', 'Thinking content lets the wheel chain to the conversation (overscroll-behavior: auto)');
	await review.assert('document.querySelectorAll(".pd-thinking-markdown p").length >= 40', 'Thinking markdown renders fully after memoization');
	await review.screenshot('thinking-scroll-capped');

	// Bottom the inner box out one notch at a time, keeping the transcript away from its own end.
	for (let notch = 0; notch < 40; notch += 1) {
		const inner = await review.evaluate('(() => { const el = document.querySelector(".pd-thinking-markdown"); return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight }; })()');
		if (inner.top >= inner.max - 1) break;
		await review.wheel(point.x, point.y, 200);
	}
	await review.assert('(() => { const el = document.querySelector(".pd-thinking-markdown"); return el.scrollTop + el.clientHeight >= el.scrollHeight - 1; })()', 'Wheel over thinking scrolls the thinking box to its boundary');
	await review.assert('(() => { const el = document.querySelector(".pd-transcript"); return el.scrollTop + el.clientHeight < el.scrollHeight - 1; })()', 'Transcript still has room below when the thinking box bottoms out');
	const before = await review.evaluate('document.querySelector(".pd-transcript").scrollTop');
	await review.wheel(point.x, point.y, 120, 4);
	const after = await review.evaluate('document.querySelector(".pd-transcript").scrollTop');
	if (after <= before) throw new Error('Wheel did not chain from the thinking boundary to the conversation scroll');
	await review.screenshot('thinking-scroll-chained');

	// At the top boundary the same wheel chaining must work in the other direction.
	await review.evaluate('document.querySelector("[data-message-id=deep-answer]").scrollIntoView({ block: "center" }); document.querySelector(".pd-thinking-markdown").scrollTop = 0');
	await review.settle();
	const upPoint = await review.evaluate(`(() => {
		const node = document.querySelector('.pd-thinking-markdown');
		const rect = node.getBoundingClientRect();
		const x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + Math.min(rect.height / 2, 100));
		if (!node.contains(document.elementFromPoint(x, y))) throw new Error('Thinking content is not a usable upward wheel target');
		return { x, y, before: document.querySelector('.pd-transcript').scrollTop };
	})()`);
	await review.wheel(upPoint.x, upPoint.y, -120);
	await review.waitFor('document.querySelector(".pd-transcript").scrollTop < ' + upPoint.before);
	await review.record('transcript-after-up', '(() => ({ transcript: document.querySelector(".pd-transcript").scrollTop, thinking: document.querySelector(".pd-thinking-markdown").scrollTop }))()');

	// Leaving before a deferred anchor save must still preserve the latest reading position.
	await review.evaluate(`(() => {
		const fixture = window.__modelReview, state = window.__thinkingReview;
		state.original = structuredClone(fixture.snapshot);
		const transcript = document.querySelector('.pd-transcript');
		const row = document.querySelector('[data-message-id=tail-user-3]');
		row.scrollIntoView({ block: 'start' });
		transcript.dispatchEvent(new Event('scroll'));
		state.offset = row.getBoundingClientRect().top - transcript.getBoundingClientRect().top;
	})()`);
	await review.evaluate(`(() => {
		const fixture = window.__modelReview;
		const messages = [{ id: 'other-user', order: 0, role: 'user', text: '另一个会话', status: 'done' }];
		Object.assign(fixture.snapshot, { sessionId: 'other-session', sessionPath: 'other-session.jsonl', messages, historyTotal: 1 });
		fixture.emitAgent({ ...structuredClone(fixture.snapshot), type: 'ready' });
	})()`);
	await review.waitFor('Boolean(document.querySelector("[data-message-id=other-user]"))');
	await review.evaluate(`(() => {
		const fixture = window.__modelReview;
		Object.assign(fixture.snapshot, window.__thinkingReview.original);
		fixture.emitAgent({ ...structuredClone(fixture.snapshot), type: 'ready' });
	})()`);
	await review.waitFor('(() => { const row = document.querySelector("[data-message-id=tail-user-3]"); return !!row && Math.abs(row.getBoundingClientRect().top - document.querySelector(".pd-transcript").getBoundingClientRect().top - window.__thinkingReview.offset) < 6; })()');
	await review.screenshot('thinking-scroll-reading-restored');
}
