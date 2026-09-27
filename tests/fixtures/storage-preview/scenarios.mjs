// Isolated renderer regression: delayed cleanup previews must match the current criteria.
export default async function storagePreviewScenarios(review) {
  await review.waitFor('window.__modelReview?.ready === true');
  await review.evaluate(`(() => {
    const bridge = window.piDesktop;
    const state = window.__storageReview = { previews: [], cleanups: [] };
    bridge.listSessionTrash = async () => ({ entries: [], retentionDays: 0 });
    bridge.getProjectSearchRules = async () => ({ ignoredDirectories: [], include: [], exclude: [], maxFileBytes: 102400 });
    bridge.getStorageSnapshot = async () => ({ items: [], skipped: [], limited: false });
    bridge.previewStorageCleanup = async request => {
      state.previews.push(structuredClone(request));
      return new Promise(resolve => { state.finish = () => resolve({
        id: request.requestId, bytes: 1024, expiresAt: '2099-01-01T00:00:00Z',
        files: [{ path: 'C:/fixture/logs/review.log', category: 'diagnostics', bytes: 1024 }],
      }); });
    };
    bridge.executeStorageCleanup = async id => { state.cleanups.push(id); return { removed: 1, releasedBytes: 1024, failed: [] }; };
  })()`);
  await review.click('.pd-settings-entry');
  await review.clickText('.pd-settings-nav button', '数据管理');
  await review.clickText('.pd-management-subnav button', '存储空间');
  const panel = '[data-setting="storage"]';
  const controls = panel + ' button';
  const plan = panel + ' .pd-management-plan';
  const days = panel + ' input[type="number"]';
  await review.clickText(controls, '生成清理预览');
  await review.waitFor('window.__storageReview.previews.length === 1');
  await review.fill(days, '60');
  await review.evaluate('window.__storageReview.finish()');
  await review.waitFor(`![...document.querySelectorAll('${controls}')].find(button => button.textContent === '生成清理预览').disabled`);
  await review.assert(`!document.querySelector('${plan}') && window.__storageReview.cleanups.length === 0`, 'Changing retention during a pending preview discards the obsolete cleanup plan');
  await review.clickText(controls, '生成清理预览');
  await review.waitFor('window.__storageReview.previews.length === 2');
  await review.assert('window.__storageReview.previews[1].olderThanDays === 60', 'A new preview uses the latest retention period');
  await review.click(panel + ' input[type="checkbox"]');
  await review.evaluate('window.__storageReview.finish()');
  await review.waitFor(`![...document.querySelectorAll('${controls}')].find(button => button.textContent === '生成清理预览').disabled`);
  await review.assert(`!document.querySelector('${plan}')`, 'Changing cleanup categories also invalidates an in-flight plan');
  await review.click(panel + ' input[type="checkbox"]');
  await review.clickText(controls, '生成清理预览');
  await review.evaluate('window.__storageReview.finish()');
  await review.waitFor(`Boolean(document.querySelector('${plan}'))`);
  await review.assert('window.__storageReview.previews[2].categories.includes("diagnostics") && window.__storageReview.cleanups.length === 0', 'The latest matching plan is displayed without deleting anything');
  await review.mouseMove(650, 30);
  await review.screenshot('storage-preview-current-criteria');
  await review.clickText(controls, '确认清理以上文件');
  await review.waitFor('window.__storageReview.cleanups.length === 1');
  await review.assert('window.__storageReview.cleanups[0] === window.__storageReview.previews[2].requestId', 'Explicit confirmation executes only the current displayed plan');
}
