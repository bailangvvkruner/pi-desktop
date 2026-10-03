// zcode-style anchoring: a pending plugin/extension question docks with the
// composer at the conversation bottom; the empty draft stops centering it
// mid-screen like a modal.
// node tests/fixtures/model-settings/run.mjs --run --scenario=../extension-inline/scenarios.mjs
function installEmptyChatFixture() {
  const fixture = window.__modelReview, bridge = window.piDesktop;
  const clone = value => structuredClone(value);
  const home = fixture.snapshot.cwd;
  // Fresh empty conversation (new session, no messages).
  Object.assign(fixture.snapshot, { cwd: home, sessionId: 'draft', sessionPath: home + '\\draft.jsonl', status: 'idle', messages: [], activities: [], runs: [], historyTotal: 0, error: null });
  bridge.listWorkspaces = async () => [home];
  bridge.listSessions = async () => [];
  window.__emptyChatReview = {
    ask: request => fixture.emit('onExtensionDialog', request),
    answer: (id, value) => { fixture.calls.push({ name: 'respondExtensionDialog', args: [id, value] }); fixture.emit('onExtensionDialogClosed', id); },
  };
  fixture.emitAgent({ ...clone(fixture.snapshot), type: 'ready' });
}

export default async function extensionInlineScenarios(review) {
  const q = JSON.stringify;
  const card = '.pd-extension-request[role="region"]';
  const cardBox = `(() => { const box = document.querySelector(${q(card)})?.getBoundingClientRect(); return box ? { top: Math.round(box.top), bottom: Math.round(box.bottom), centerY: Math.round(box.y + box.height / 2) } : null; })()`;
  const check = (value, message) => { if (value !== true) throw new Error(`Scenario check failed: ${message} (got ${JSON.stringify(value)})`); };
  await review.waitFor('window.__modelReview?.ready === true && Boolean(document.querySelector(".pd-composer-shell > textarea"))');
  await review.viewport(1440, 1000);
  await review.reducedMotion(true);
  await review.reloadWithFixture(`(${installEmptyChatFixture.toString()})()`);
  await review.waitFor(`document.querySelector('.pd-conversation-body')?.classList.contains('is-empty') === true`);

  // Empty draft + pending question: the card docks at the conversation bottom,
  // never hovering at the vertical middle of the screen.
  await review.evaluate(`window.__emptyChatReview.ask({ id: 'probe', kind: 'select', title: '插件询问：选择运行模式', message: '新会话开始时插件提出的问题', options: ['快速模式', '完整模式'] })`);
  await review.waitFor(`Boolean(document.querySelector(${q(card)}))`);
  await review.assert(`document.querySelector('.pd-conversation-body').classList.contains('has-extension-request')`, 'A pending question marks the conversation body');
  const sunk = await review.evaluate(cardBox);
  check(sunk.centerY > 600 && sunk.bottom <= 988, `empty-draft card docks near the bottom (centerY=${sunk?.centerY}, bottom=${sunk?.bottom})`);
  const geometry = await review.evaluate(`(() => { const card2 = document.querySelector(${q(card)}); const input = document.querySelector('.pd-composer-shell'); const box = card2.getBoundingClientRect(); const inputBox = input.getBoundingClientRect(); return { aboveComposer: box.bottom <= inputBox.top + 1, inColumn: Math.abs((box.left + box.right) / 2 - (inputBox.left + inputBox.right) / 2) <= 2 }; })()`);
  check(geometry.aboveComposer, 'the card sits directly above the composer');
  check(geometry.inColumn, 'the card shares the composer column width');
  await review.screenshot('extension-empty-docked');

  // Answering the question releases the draft back to its centered empty state.
  await review.evaluate(`window.__emptyChatReview.answer('probe', '快速模式')`);
  await review.waitFor(`!document.querySelector(${q(card)})`);
  await review.assert(`!document.querySelector('.pd-conversation-body').classList.contains('has-extension-request')`, 'Answering releases the anchored layout');
  await review.screenshot('extension-empty-released');

  // A running conversation keeps the same bottom dock (existing behavior).
  await review.evaluate(`(() => { const fixture = window.__modelReview; Object.assign(fixture.snapshot, { messages: [{ id: 'u1', order: 1, runId: 'r1', role: 'user', status: 'done', text: '帮我检查这个项目的测试', attachments: [] }, { id: 'a1', order: 2, runId: 'r1', role: 'assistant', status: 'done', text: '开始分析。', thinking: '', thinkingTruncated: false }], activities: [], runs: [], historyTotal: 2 }); fixture.emitAgent({ ...structuredClone(fixture.snapshot), type: 'ready' }); })()`);
  await review.waitFor(`!document.querySelector('.pd-conversation-body').classList.contains('is-empty')`);
  await review.evaluate(`window.__emptyChatReview.ask({ id: 'probe2', kind: 'confirm', title: '确认执行修改？', message: '插件准备写入文件' })`);
  await review.waitFor(`Boolean(document.querySelector(${q(card)}))`);
  const live = await review.evaluate(cardBox);
  check(live.centerY > 600 && live.bottom <= 988, `active-conversation card stays docked at the bottom (centerY=${live?.centerY}, bottom=${live?.bottom})`);
  await review.screenshot('extension-active-docked');
}
