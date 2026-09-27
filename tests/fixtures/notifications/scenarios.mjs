// Real built renderer with isolated, deferred bridge responses; no external actions.
// node tests/fixtures/model-settings/run.mjs --run --scenario=../notifications/scenarios.mjs
function installNotificationFixture(pai = false) {
  const fixture = window.__modelReview, bridge = window.piDesktop;
  const state = window.__notificationsReview = { holdDrafts: true, drafts: [], created: 0, dismissed: [] };
  const emptyDraft = () => ({ version: 0, text: '', attachments: [], missing: [] });
  const originalInfo = bridge.getAppInfo;
  bridge.getAppInfo = async () => ({ ...await originalInfo(), windowMode: pai ? 'pai' : 'full' });
  bridge.getInputDraft = async () => state.holdDrafts ? new Promise(resolve => { state.drafts.push(resolve); }) : emptyDraft();
  state.resolveDrafts = () => { state.holdDrafts = false; state.drafts.splice(0).forEach(resolve => resolve(emptyDraft())); };
  bridge.newSession = async () => {
    state.created++;
    await new Promise(resolve => { state.finishNew = resolve; });
    state.holdDrafts = true;
    Object.assign(fixture.snapshot, { sessionId: 'new-review-' + state.created, sessionPath: fixture.snapshot.cwd + '/new-' + state.created + '.jsonl', messages: [], activities: [], runs: [], historyTotal: 0, status: 'idle', error: null });
    fixture.emitAgent({ ...structuredClone(fixture.snapshot), type: 'ready' });
    fixture.emitAgent({ type: 'status', status: 'idle' });
  };
  bridge.openWorkspaceInVsCode = async () => { throw new Error('未找到可用的编辑器，请配置后重试。'); };
  bridge.respondExtensionDialog = async id => { state.dismissed.push(id); fixture.emit('onExtensionDialogClosed', id); };
  bridge.listWorkspaceEntries = async () => [];
  bridge.getWorkspaceGitLog = async () => [];
  state.showNotices = () => {
    if (!pai) fixture.emit('onUpdateStateChanged', { phase: 'ready', currentVersion: '0.1.7', availableVersion: '0.1.8' });
    fixture.emit('onExtensionDialog', { id: 'notice-review', kind: 'notify', title: '插件通知', message: '通知显示在对话区域上方，并与其他提示依次排列。', notificationType: 'info', timeout: 60000 });
  };
}

export default async function notificationScenarios(review) {
  const state = 'window.__notificationsReview';
  const noHints = '!document.querySelector(".pd-composer-attachment-hint[role=status]") && !document.querySelector(".pd-operation-notice")';
  const centered = `(() => {
    const main = document.querySelector('.pd-main-view').getBoundingClientRect();
    const center = document.querySelector('.pd-notification-center').getBoundingClientRect();
    return Math.abs(center.x + center.width / 2 - main.x - main.width / 2) < 1 && center.top >= main.top + 56 && center.top < main.top + 90 && center.left >= main.left && center.right <= main.right && document.documentElement.scrollWidth <= innerWidth;
  })()`;
  async function openEditorNotice() {
    await review.click('.pd-chat-header-more');
    await review.clickText('.pd-sidebar-popover [role=menuitem]', '在 VS Code 中打开');
    await review.waitFor('Boolean(document.querySelector(".pd-operation-notice.is-error"))');
  }
  await review.reloadWithFixture(`(${installNotificationFixture.toString()})()`);
  await review.reducedMotion(true);
  await review.waitFor(`${state}.drafts.length > 0`);
  await review.fill('.pd-composer-shell > textarea', '恢复完成之前保留草稿');
  await review.assert(`${noHints} && document.querySelector('.pd-send-button').disabled && document.querySelector('.pd-composer-add-attachment').disabled`, 'Restoring a draft is quiet and retains send/attachment safeguards');
  await review.evaluate(`${state}.resolveDrafts()`);
  await review.waitFor('!document.querySelector(".pd-send-button").disabled');
  await review.click('.pd-new-session');
  await review.waitFor(`${state}.created === 1`);
  await review.assert(noHints, 'Creating a conversation does not show a pending New session notification');
  await review.evaluate(`${state}.finishNew()`);
  await review.waitFor(`${state}.drafts.length > 0`);
  await review.assert(noHints, 'The new conversation restores its empty draft without an adding-context hint');
  await review.screenshot('new-conversation-without-hints');
  await review.evaluate(`${state}.resolveDrafts()`);
  await review.waitFor('!document.querySelector(".pd-composer-add-attachment").disabled');
  await openEditorNotice();
  await review.evaluate(`${state}.showNotices()`);
  await review.waitFor('Boolean(document.querySelector(".pd-extension-notice")) && Boolean(document.querySelector(".pd-update-notice"))');
  await review.mouseMove(1000, 700);
  await review.assert(centered, 'All notification types are centered on the conversation rather than the whole window');
  await review.assert(`(() => {
    const groups = [...document.querySelectorAll('.pd-notification-center > *')].filter(e => e.getBoundingClientRect().height > 0).map(e => e.getBoundingClientRect());
    return groups.length === 3 && groups.every((rect, index) => !index || rect.top >= groups[index - 1].bottom);
  })()`, 'Operation, update, and plugin notices occupy separate rows without overlap');
  await review.screenshot('notifications-conversation-top');
  await review.click('.pd-workbench-toggle');
  await review.waitFor('document.querySelector(".pd-workbench")?.classList.contains("is-open")');
  await review.assert(centered, 'Notifications follow the chat width when the workbench opens');
  await review.screenshot('notifications-with-workbench');
  await review.click('.pd-workbench-toggle');
  await review.click('.pd-sidebar-collapse');
  await review.assert(centered, 'Notifications recenter when the sidebar collapses');
  await review.viewport(680, 800);
  await review.assert(centered, 'Narrow windows keep notifications within the conversation');
  await review.screenshot('notifications-narrow');
  await review.click('.pd-operation-notice-heading button');
  await review.click('.pd-update-notice-secondary');
  await review.click('.pd-extension-notice button');
  await review.assert('!document.querySelector(".pd-operation-notice,.pd-update-notice,.pd-extension-notice") && window.__notificationsReview.dismissed.includes("notice-review")', 'All notification controls remain usable at the new location');

  await review.reloadWithFixture(`(${installNotificationFixture.toString()})(true)`);
  await review.waitFor('Boolean(document.querySelector(".pd-app-shell.is-pai"))');
  await review.evaluate(`${state}.resolveDrafts()`);
  await openEditorNotice();
  await review.evaluate(`${state}.showNotices()`);
  await review.waitFor('Boolean(document.querySelector(".pd-extension-notice"))');
  await review.assert(centered, 'The standalone pai window shares the top-center notification layout');
  await review.screenshot('notifications-pai');
}
