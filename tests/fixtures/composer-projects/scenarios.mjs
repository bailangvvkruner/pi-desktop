// Prepare only: node tests/fixtures/composer-projects/scenarios.mjs --check
// Run after building: node tests/fixtures/model-settings/run.mjs --run --scenario=../composer-projects/scenarios.mjs
// The real renderer receives trusted clicks/text; workspace and session operations stay in memory.

function installComposerProjectsFixture() {
  const fixture = window.__modelReview, bridge = window.piDesktop;
  const clone = value => structuredClone(value);
  const paths = Object.fromEntries(['home', 'project-a', 'project-b'].map(name => [name, 'C:/composer-projects/' + name]));
  const history = Object.fromEntries(Object.entries(paths).map(([name, cwd]) => [cwd, {
    id: 'history-' + name, path: cwd + '/history.jsonl', name: name + ' 已有对话',
    firstMessage: '已有历史：' + name, modified: '2026-09-27T00:00:00Z', messageCount: 2,
  }]));
  const state = window.__composerProjectsReview = {
    paths, history, navigation: [], completed: 0, newSessions: 0, picks: [], nextPick: null,
    drafts: new Map(), draftReads: [], inputEvents: [],
  };
  const mock = (name, implementation) => {
    bridge[name] = async (...args) => {
      fixture.calls.push({ name, args: clone(args) });
      return implementation(...args);
    };
  };
  state.publish = (cwd, fresh) => {
    if (!history[cwd]) throw new Error('Unknown fixture workspace: ' + cwd);
    const row = history[cwd], id = fresh ? 'new-' + (++state.newSessions) : row.id;
    const messages = fresh ? [] : [
      { id: row.id + '-user', order: 0, role: 'user', text: row.firstMessage, status: 'done' },
      { id: row.id + '-assistant', order: 1, role: 'assistant', text: '这是已存在的对话，不能替代新建对话。', status: 'done' },
    ];
    Object.assign(fixture.snapshot, {
      cwd, sessionId: id, sessionPath: fresh ? cwd + '/' + id + '.jsonl' : row.path,
      messages, activities: [], runs: [], historyTotal: messages.length, status: 'idle', error: null,
      fileChanges: [], queuedCount: 0, queuedMessages: [],
    });
    fixture.emitAgent({ type: 'reset', cwd });
    fixture.emitAgent({ ...clone(fixture.snapshot), type: 'ready' });
    fixture.emitAgent({ type: 'status', status: 'idle' });
  };
  const navigate = async (kind, cwd, fresh) => {
    const call = { kind, cwd, fresh: Boolean(fresh) };
    state.navigation.push(call);
    // Omitting fresh really restores nonempty history, reproducing the reported regression.
    state.publish(cwd, Boolean(fresh));
    await Promise.resolve();
    call.sessionId = fixture.snapshot.sessionId;
    state.completed++;
  };
  mock('getDefaultWorkspace', () => paths.home);
  mock('listWorkspaces', () => Object.values(paths));
  mock('listSessions', cwd => history[cwd] ? [clone(history[cwd])] : []);
  mock('listSessionGroups', () => []);
  mock('listPinnedWorkspaces', () => []);
  mock('switchWorkspace', (cwd, options) => navigate('workspace', cwd, options?.fresh));
  mock('newSession', () => navigate('new-session', fixture.snapshot.cwd, true));
  mock('pickWorkspace', () => {
    const picked = state.nextPick;
    state.nextPick = null;
    state.picks.push(picked);
    return picked;
  });
  mock('getWorkspaceBranches', () => ({ isRepository: false, current: null, detached: false, branches: [] }));
  mock('getWorkspaceGitStatus', () => ({ isRepository: false, branch: null, entries: [], truncated: false }));
  const key = scope => JSON.stringify([scope.cwd, scope.sessionPath]);
  mock('getInputDraft', scope => {
    state.draftReads.push(key(scope));
    return clone(state.drafts.get(key(scope)) ?? { version: 0, text: '', attachments: [], missing: [] });
  });
  mock('saveInputDraft', request => {
    const draft = { version: request.expectedVersion + 1, text: request.text, attachments: [], missing: [] };
    state.drafts.set(key(request), draft);
    return clone(draft);
  });
  document.addEventListener('input', event => {
    if (event.target instanceof HTMLTextAreaElement && event.target.closest('.pd-composer-shell')) {
      state.inputEvents.push({ trusted: event.isTrusted, text: event.target.value, sessionId: fixture.snapshot.sessionId });
    }
  }, true);
  state.publish(paths['project-a'], false);
}

export default async function composerProjectsScenarios(review) {
  const state = 'window.__composerProjectsReview', snapshot = 'window.__modelReview.snapshot';
  const input = '.pd-composer-shell > textarea', chip = '.pd-context-chip[aria-label="切换项目"]';
  const menu = '.pd-sidebar-popover[role="menu"]';
  const q = JSON.stringify;
  const blank = `Boolean(document.querySelector('.pd-main.is-empty .pd-empty-state')) && !document.querySelector('.pd-message-row') && !document.querySelector('.pd-session-loading')`;
  async function readyBlank(name, completed, message) {
    await review.waitFor(`${state}.completed === ${completed} && ${snapshot}.cwd === ${state}.paths[${q(name)}] && ${blank} && document.querySelector(${q(chip)})?.textContent.trim() === ${q(name)} && document.querySelector(${q(input)})?.disabled === false && ${state}.draftReads.includes(JSON.stringify([${snapshot}.cwd, ${snapshot}.sessionPath]))`);
    await review.settle();
    await review.assert(`${blank} && ${snapshot}.messages.length === 0 && ${snapshot}.sessionId.startsWith('new-') && document.querySelector(${q(input)}).value === ''`, message);
  }
  async function typeDraft(text, message) {
    await review.fill(input, text);
    await review.waitFor(`document.querySelector('.pd-send-button')?.disabled === false`);
    await review.assert(`${blank} && document.querySelector(${q(input)}).value === ${q(text)} && document.activeElement === document.querySelector(${q(input)})`, message);
  }
  async function openMenu() {
    await review.click(chip);
    await review.waitFor(`Boolean(document.querySelector(${q(menu)})) && [...document.querySelectorAll(${q(menu + ' [role="menuitem"]')})].some(button => button.textContent.trim() === '打开项目…' && !button.disabled)`);
  }
  await review.waitFor('window.__modelReview?.ready === true && Boolean(document.querySelector(".pd-new-session"))');
  await review.viewport(1440, 1000);
  await review.reducedMotion(true);
  await review.evaluate(`(${installComposerProjectsFixture.toString()})()`);
  await review.waitFor(`document.querySelector('.pd-message-list')?.textContent.includes('已有历史：project-a') && !document.querySelector('.pd-new-session').disabled`);

  await review.click('.pd-new-session');
  await readyBlank('project-a', 1, 'New conversation clears the previously visible project history');
  await openMenu();
  await review.clickText(menu + ' [role="menuitem"]', '不使用项目');
  await readyBlank('home', 2, 'Removing the project keeps a new blank conversation even when home has an existing conversation');
  await review.assert(`${state}.navigation[1].fresh && ${snapshot}.sessionId !== ${state}.history[${state}.paths.home].id`, 'The home selection requests a fresh session instead of restoring the home history');
  await typeDraft('不使用项目后，可以正常输入新对话。', 'The detached new conversation accepts typing and enables Send');
  await review.screenshot('composer-projects-detached-new-conversation');

  await openMenu();
  await review.clickText(menu + ' .pd-context-menu-main', 'project-b');
  await readyBlank('project-b', 3, 'Selecting another existing project keeps the new-conversation page');
  await typeDraft('切换项目后仍可正常新建对话。', 'An existing project with history still provides an editable fresh conversation');

  await review.evaluate(`${state}.nextPick = ${state}.paths['project-a']`);
  await openMenu();
  await review.clickText(menu + ' [role="menuitem"]', '打开项目…');
  await readyBlank('project-a', 4, 'Opening a folder through the new-conversation picker creates a fresh session there');
  await review.assert(`${state}.picks.length === 1 && ${state}.picks[0] === ${state}.paths['project-a'] && ${state}.navigation.slice(1).every(call => call.fresh)`, 'Every composer project action forwards the fresh-session option');
  const retainedDraft = '取消文件夹选择后，保留当前新对话和输入内容。';
  await typeDraft(retainedDraft, 'The opened folder starts an editable new conversation');

  await review.evaluate(`${state}.beforeCancel = { cwd: ${snapshot}.cwd, sessionId: ${snapshot}.sessionId, sessionPath: ${snapshot}.sessionPath, navigation: ${state}.navigation.length }; ${state}.nextPick = null`);
  await openMenu();
  await review.clickText(menu + ' [role="menuitem"]', '打开项目…');
  await review.waitFor(`${state}.picks.length === 2 && !document.querySelector(${q(menu)})`);
  await review.settle();
  await review.assert(`${state}.picks[1] === null && ${state}.navigation.length === ${state}.beforeCancel.navigation && ${snapshot}.cwd === ${state}.beforeCancel.cwd && ${snapshot}.sessionId === ${state}.beforeCancel.sessionId && ${snapshot}.sessionPath === ${state}.beforeCancel.sessionPath && ${blank} && document.querySelector(${q(input)}).value === ${q(retainedDraft)} && !document.querySelector('.pd-send-button').disabled`, 'Cancelling the folder dialog preserves the current blank session, project, draft, and enabled Send button');
  await openMenu();
  await review.assert(`[...document.querySelectorAll(${q(menu + ' [role="menuitem"]')})].every(button => !button.disabled)`, 'Cancelling releases navigation state so another project action remains available');
  await review.key('Escape');
  await typeDraft(retainedDraft + ' 继续编辑。', 'Typing continues normally after the folder dialog is cancelled');
  await review.assert(`${state}.inputEvents.length >= 4 && ${state}.inputEvents.every(event => event.trusted)`, 'All composer edits were produced by trusted keyboard input');
  await review.record('composer-project-navigation', `${state}.navigation`);
  await review.record('composer-project-folder-results', `${state}.picks`);
  await review.screenshot('composer-projects-folder-cancel-preserves-draft');
}

if (process.argv.includes('--check')) {
  let count = 0;
  const compile = expression => { new Function(expression); count++; };
  await composerProjectsScenarios({
    evaluate: async expression => compile(expression), waitFor: async expression => compile(expression),
    assert: async expression => compile(expression), record: async (_name, expression) => compile(expression),
    click: async () => {}, clickText: async () => {}, fill: async () => {}, key: async () => {},
    settle: async () => {}, screenshot: async () => {}, viewport: async () => {}, reducedMotion: async () => {},
  });
  console.log(`Prepared ${count} composer-project expressions; no browser launched.`);
}
