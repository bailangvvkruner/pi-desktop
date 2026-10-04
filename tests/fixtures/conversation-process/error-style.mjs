// Visual verification: zcode-style process text differentiation and collapsed command errors.
// Prepare: node tests/fixtures/conversation-process/scenarios.mjs --check
// Run after build: node tests/fixtures/model-settings/run.mjs --run --scenario=../conversation-process/error-style.mjs
export default async function conversationErrorStyleScenarios(review) {
  const turn = '.pd-conversation-turn[data-run-id="verify"]';
  await review.waitFor('window.__modelReview?.ready === true');
  await review.reducedMotion(true);
  await review.viewport(1440, 1000);
  await review.evaluate(`(() => {
    const fixture = window.__modelReview;
    const state = window.__processReview = { path: fixture.snapshot.sessionPath };
    state.visible = node => !!node && !node.closest('[hidden],[inert],[aria-hidden="true"]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
    const now = Date.now();
    const messages = [
      { id: 'verify-user', runId: 'verify', order: 0, role: 'user', text: '检查错误样式与过程文字区分', status: 'done' },
      {
        id: 'verify-analysis', runId: 'verify', order: 1, role: 'assistant', status: 'done',
        thinking: '先查看构建脚本，失败时只需要标记，不应整段展开。',
        thinkingStatus: 'done',
        text: '我先检查构建配置，然后运行构建验证。这个中间说明是模型的真实输出。',
      },
      { id: 'verify-final', runId: 'verify', order: 5, role: 'assistant', status: 'done', text: '构建脚本存在类型错误，已在另一个改动中修复。这是最终回答。' },
    ];
    const activities = [
      { id: 'read-config', runId: 'verify', order: 2, tool: 'read', title: '读取构建配置', status: 'done', detail: 'export default { main: "src/main.ts" }', files: ['electron.vite.config.ts'], startedAt: now - 9000, endedAt: now - 8000 },
      { id: 'run-build', runId: 'verify', order: 3, tool: 'bash', title: '构建项目', command: 'pnpm typecheck', status: 'error', exitCode: 1, detail: 'src/main.ts(42,7): error TS2345: Argument of type string is not assignable to parameter of type number.', startedAt: now - 7000, endedAt: now - 6000 },
      { id: 'run-checks', runId: 'verify', order: 4, tool: 'bash', title: '运行回归检查', command: 'pnpm test', status: 'done', detail: '13 tests passed.', exitCode: 0, startedAt: now - 5000, endedAt: now - 3000 },
    ];
    const runs = [{ id: 'verify', startedAt: now - 10000, finishedAt: now - 2000, status: 'completed' }];
    Object.assign(fixture.snapshot, { sessionId: state.path, sessionPath: state.path, messages, activities, runs, historyTotal: messages.length, status: 'idle', error: null });
    fixture.emitAgent({ ...structuredClone(fixture.snapshot), type: 'ready' });
    fixture.emitAgent({ type: 'status', status: 'idle' });
  })()`);
  await review.waitFor(`document.querySelector('${turn} .pd-turn-summary') !== null`);
  await review.record('before-click', `(() => { const button=document.querySelector('${turn} .pd-turn-summary'); return { tag: button?.tagName, expanded: button?.getAttribute('aria-expanded'), steps: Boolean(document.querySelector('${turn} .pd-turn-steps')), items: document.querySelectorAll('${turn} .pd-activity-item').length }; })()`);
  await review.click(`${turn} .pd-turn-summary`);
  await review.waitFor(`document.querySelector('${turn} .pd-turn-summary')?.getAttribute('aria-expanded') === 'true'`, 4000);
  await review.click(`${turn} .pd-thinking-summary`);
  await review.waitFor(`window.__processReview.visible(document.querySelector('${turn} .pd-thinking-markdown'))`, 4000);

  // The failed command must stay collapsed by default (zcode behavior).
  await review.assert(`(() => { const failed = [...document.querySelectorAll('${turn} .pd-activity-item')].find(item => item.className.includes('is-error')); return failed?.querySelector('.pd-activity-head')?.getAttribute('aria-expanded') === 'false'; })()`, 'Failed command stays collapsed by default');
  await review.assert(`(() => { const failed = [...document.querySelectorAll('${turn} .pd-activity-item')].find(item => item.className.includes('is-error')); return failed.querySelector('.pd-activity-exit')?.textContent.includes('1') && failed.querySelector('.pd-activity-status')?.textContent.includes('失败'); })()`, 'The collapsed failure still shows its exit code and status');

  // Thinking text must be visually distinct from intermediate assistant prose.
  await review.assert(`(() => { const s = window.__processReview; const prose = getComputedStyle(document.querySelector('[data-message-id="verify-analysis"] .pd-markdown')); const thinking = getComputedStyle(document.querySelector('${turn} .pd-thinking-markdown')); s.proseColor = prose.color; s.thinkingColor = thinking.color; return prose.color !== thinking.color; })()`, 'Intermediate prose and thinking text use different colors');
  await review.screenshot('error-style-settled-process');

  // The error detail stays reachable by expanding the row on demand.
  await review.click(`${turn} .pd-activity-item.is-error .pd-activity-head`);
  await review.waitFor(`document.querySelector('${turn} .pd-activity-item.is-error .pd-activity-head')?.getAttribute('aria-expanded') === 'true'`, 4000);
  await review.assert(`(() => { const failed = document.querySelector('${turn} .pd-activity-item.is-error'); return [...failed.querySelectorAll('.pd-activity-output')].some(node => window.__processReview.visible(node) && node.textContent.includes('TS2345')); })()`, 'Expanding the failed command exposes the retained error output');
  await review.screenshot('error-style-failed-tool-expanded');
}
