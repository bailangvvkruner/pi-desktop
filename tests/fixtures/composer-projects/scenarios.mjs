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
    paths, history, navigation: [], completed: 0, newSessions: 0, picks: [], nextPick: null, conversationWorkspaces: [],
    drafts: new Map(), draftReads: [], inputEvents: [], submitted: [],
    deferNextNavigation: false, pendingNavigation: null,
  };
  const mock = (name, implementation) => {
    bridge[name] = async (...args) => {
      fixture.calls.push({ name, args: clone(args) });
      return implementation(...args);
    };
  };
  state.publish = (cwd, fresh) => {
    if (!fresh && !history[cwd]) throw new Error('Unknown fixture workspace: ' + cwd);
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
  const navigate = async (kind, cwd, fresh, options) => {
    const call = { kind, cwd, fresh: Boolean(fresh), options: clone(options) };
    state.navigation.push(call);
    if (state.deferNextNavigation) {
      state.deferNextNavigation = false;
      try {
        await new Promise((resolve, reject) => { state.pendingNavigation = { resolve, reject }; });
      } catch (error) {
        call.error = error.message;
        throw error;
      } finally { state.pendingNavigation = null; }
    }
    // Omitting fresh really restores nonempty history, reproducing the reported regression.
    state.publish(cwd, Boolean(fresh));
    await Promise.resolve();
    call.sessionId = fixture.snapshot.sessionId;
    state.completed++;
  };
  mock('getDefaultWorkspace', () => paths.home);
  mock('listWorkspaces', () => [...Object.values(paths), ...state.conversationWorkspaces]);
  mock('listConversationWorkspaces', () => [paths.home, ...state.conversationWorkspaces]);
  mock('listSessions', cwd => history[cwd] ? [clone(history[cwd])] : []);
  mock('listSessionGroups', () => []);
  mock('listPinnedWorkspaces', () => []);
  mock('switchWorkspace', (cwd, options) => navigate('workspace', cwd, options?.fresh));
  mock('newSession', options => {
    const cwd = options?.cwd ?? paths.home + '/conversation-' + (state.conversationWorkspaces.length + 1);
    if (!options?.cwd) state.conversationWorkspaces.push(cwd);
    return navigate('new-session', cwd, true, options);
  });
  mock('submitInput', request => {
    state.submitted.push({ ...clone(request), cwd: fixture.snapshot.cwd });
    return { id: request.id, state: 'accepted' };
  });
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
  const clear = '.pd-context-project-clear[aria-label="不使用项目"]';
  const menu = '.pd-sidebar-popover[role="menu"]';
  const q = JSON.stringify;
  const blank = `Boolean(document.querySelector('.pd-main.is-empty .pd-empty-state')) && !document.querySelector('.pd-message-row') && !document.querySelector('.pd-session-loading')`;
  async function readyBlank(name, completed, message) {
    const target = name === 'standalone' ? `${state}.conversationWorkspaces.at(-1)` : `${state}.paths[${q(name)}]`;
    await review.waitFor(`${state}.completed === ${completed} && ${snapshot}.cwd === ${target} && ${blank} && document.querySelector(${q(chip)})?.textContent.trim() === ${q(name === 'standalone' ? '选择项目' : name)} && document.querySelector(${q(input)})?.disabled === false && ${state}.draftReads.includes(JSON.stringify([${snapshot}.cwd, ${snapshot}.sessionPath]))`);
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
  await review.reloadWithFixture(`(${installComposerProjectsFixture.toString()})()`);
  await review.waitFor(`document.querySelector('.pd-message-list')?.textContent.includes('已有历史：project-a') && !document.querySelector('.pd-new-session').disabled`);

  await review.click('[data-mode="project"]');
  await review.click('.pd-sidebar-group[data-project-path="C:/composer-projects/project-a"] .pd-group-more:not([aria-haspopup])');
  await readyBlank('project-a', 1, 'Project New conversation clears the previously visible project history');
  await review.assert(`${state}.navigation[0].options.cwd === ${state}.paths['project-a']`, 'Project-level creation passes its explicit directory to newSession');
  await review.waitFor(`Boolean(document.querySelector(${q(clear)}))`);
  await review.assert(`(() => { const clear = document.querySelector(${q(clear)}), chip = document.querySelector(${q(chip)}); return !clear.disabled && clear.getBoundingClientRect().right <= chip.getBoundingClientRect().left && Boolean(clear.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING); })()`, 'The direct no-project button is visible to the left of the project selector');
  await openMenu();
  await review.assert(`[...document.querySelectorAll(${q(menu + ' [role="menuitem"]')})].some(item => item.textContent.trim() === '不使用项目')`, 'The project menu retains its no-project action alongside the direct removal button');
  await review.key('Escape');
  const retryDraft = '退出项目失败时，保留这段尚未发送的内容。';
  await typeDraft(retryDraft, 'The project conversation holds an editable draft before removing its project');
  await review.evaluate(`${state}.beforeFailure = { cwd: ${snapshot}.cwd, sessionId: ${snapshot}.sessionId, sessionPath: ${snapshot}.sessionPath }; ${state}.deferNextNavigation = true`);
  await review.click(clear);
  await review.waitFor(`Boolean(${state}.pendingNavigation) && document.querySelector(${q(clear)})?.disabled === true && document.querySelector(${q(chip)})?.disabled === true && document.querySelector(${q(input)})?.disabled === true`);
  await review.key('Enter');
  await review.assert(`${state}.navigation.length === 2 && ${state}.completed === 1 && ${state}.submitted.length === 0 && ${snapshot}.sessionId === ${state}.beforeFailure.sessionId && document.querySelector(${q(input)}).value === ${q(retryDraft)}`, 'Pending removal disables project actions and input, prevents repeated navigation, and retains the current draft');
  await review.evaluate(`${state}.pendingNavigation.reject(new Error('模拟项目切换失败'))`);
  await review.waitFor(`document.querySelector('.pd-context-chip-error')?.textContent.includes('模拟项目切换失败') && document.querySelector(${q(clear)})?.disabled === false && document.querySelector(${q(input)})?.disabled === false`);
  await review.assert(`${snapshot}.cwd === ${state}.beforeFailure.cwd && ${snapshot}.sessionId === ${state}.beforeFailure.sessionId && ${snapshot}.sessionPath === ${state}.beforeFailure.sessionPath && !document.querySelector('.pd-message-row') && document.querySelector(${q(input)}).value === ${q(retryDraft)} && !document.querySelector('.pd-send-button').disabled`, 'A failed removal keeps the project, session, and unsent draft and releases the controls for retry');
  await review.screenshot('composer-projects-detach-failed-retry');
  await review.click(clear);
  await readyBlank('standalone', 2, 'Removing the project creates a blank conversation in a new independent folder despite existing root history');
  await review.assert(`${state}.navigation.at(-1).kind === 'new-session' && !${state}.navigation.at(-1).options?.cwd && ${snapshot}.cwd !== ${state}.paths.home && ${snapshot}.sessionId !== ${state}.history[${state}.paths.home].id && !document.querySelector(${q(clear)}) && document.querySelectorAll('.pd-composer-context .pd-context-chip').length === 1`, 'The direct removal opens a fresh independent session, hides the removal and branch buttons, and displays only the project selector');
  await typeDraft('不使用项目后，可以正常输入新对话。', 'The detached new conversation accepts typing and enables Send');
  await review.screenshot('composer-projects-detached-new-conversation');
  await review.click('.pd-send-button');
  await review.waitFor(`${state}.submitted.length === 1 && document.querySelector(${q(input)})?.value === ''`);
  await review.assert(`${state}.submitted[0].cwd === ${state}.conversationWorkspaces.at(-1) && ${state}.submitted[0].sessionId === ${snapshot}.sessionId && ${state}.submitted[0].text === '不使用项目后，可以正常输入新对话。'`, 'Sending without a project submits the text to the fresh independent conversation');

  await openMenu();
  await review.assert(`[...document.querySelectorAll(${q(menu + ' [role="menuitemradio"]')})].length === 2 && ![...document.querySelectorAll(${q(menu + ' .pd-context-menu-main')})].some(item => item.textContent.trim() === 'home' || item.textContent.includes('conversation-'))`, 'The refreshed menu lists only explicit projects without exposing the storage root or automatic conversation directories');
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
  await review.record('composer-project-submitted-inputs', `${state}.submitted`);
  await review.screenshot('composer-projects-folder-cancel-preserves-draft');
}

if (process.argv.includes('--check')) {
  let count = 0;
  const compile = expression => { new Function(expression); count++; };
  await composerProjectsScenarios({
    evaluate: async expression => compile(expression), waitFor: async expression => compile(expression),
    assert: async expression => compile(expression), record: async (_name, expression) => compile(expression),
    reloadWithFixture: async expression => compile(expression),
    click: async () => {}, clickText: async () => {}, fill: async () => {}, key: async () => {},
    settle: async () => {}, screenshot: async () => {}, viewport: async () => {}, reducedMotion: async () => {},
  });
  console.log(`Prepared ${count} composer-project expressions; no browser launched.`);
}
