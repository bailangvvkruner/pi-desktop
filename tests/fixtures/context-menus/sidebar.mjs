// Isolated renderer interactions; no real sessions or projects are changed.
function installContextMenusFixture() {
  const fixture = window.__modelReview, bridge = window.piDesktop;
  const cwd = 'C:\\context-menu-review\\project';
  const rows = Array.from({ length: 14 }, (_, index) => ({ id: `session-${index}`, path: `${cwd}\\session-${index}.jsonl`, name: index ? `对话 ${index + 1}` : '右键菜单位置验证', firstMessage: '菜单位置', modified: '2026-09-27T00:00:00Z', messageCount: 2 }));
  const state = { groups: [
    { id: 'context-top', name: '菜单位置分组', sessionPaths: rows.slice(0, 12).map(row => row.path) },
    { id: 'context-bottom', name: '底部分组', sessionPaths: [rows[12].path] },
  ], writes: [] };
  bridge.getDefaultWorkspace = async () => 'C:\\context-menu-review\\home';
  bridge.listWorkspaces = async () => [cwd];
  bridge.listSessions = async workspace => workspace === cwd ? structuredClone(rows) : [];
  bridge.listSessionGroups = async () => structuredClone(state.groups);
  bridge.updateSessionGroups = async change => { state.writes.push(structuredClone(change)); return structuredClone(state.groups); };
  Object.assign(fixture.snapshot, { cwd, sessionId: rows[0].id, sessionPath: rows[0].path });
  window.__contextMenusReview = state;
}

export default async function sidebarContextMenus(review) {
  const q = JSON.stringify;
  const menu = '.pd-sidebar-popover[role="menu"]';
  const session = '.pd-session-item .pd-session-row';
  const project = '.pd-sidebar-group[data-project-path] .pd-sidebar-group-toggle';
  const more = '.pd-sidebar-group[data-project-path] .pd-group-more[aria-haspopup="menu"]';
  const group = '.pd-sidebar-group[data-section-key="group:context-top"]';
  const groupToggle = `${group} .pd-sidebar-group-toggle`;
  const groupMore = `${group} .pd-group-more[aria-haspopup="menu"]`;
  const dialog = '.pd-sidebar-popover[role="dialog"]';
  const pointFor = selector => review.evaluate(`(() => { const node = document.querySelector(${q(selector)}); node.scrollIntoView({ block: 'nearest' }); const r = node.getBoundingClientRect(); return { x: r.left + 42, y: r.top + r.height / 2 }; })()`);
  async function assertPosition(point, message) {
    await review.assert(`(() => { const r = document.querySelector(${q(menu)}).getBoundingClientRect(); return Math.abs(r.left - Math.max(8, Math.min(${point.x}, innerWidth - r.width - 8))) < 1 && Math.abs(r.top - Math.max(8, Math.min(${point.y}, innerHeight - r.height - 8))) < 1 && r.right <= innerWidth - 7 && r.bottom <= innerHeight - 7; })()`, message);
  }
  async function right(selector) {
    const point = await pointFor(selector);
    await review.rightClick(point.x, point.y);
    await review.waitFor(`Boolean(document.querySelector(${q(menu)}))`);
    return point;
  }
  await review.reloadWithFixture(`(${installContextMenusFixture.toString()})()`);
  await review.viewport(1440, 900);
  await review.reducedMotion(true);
  await review.click('[data-mode="project"]');
  await review.waitFor('document.querySelectorAll(".pd-session-row").length === 14');
  let point = await right(session);
  await assertPosition(point, 'Conversation menu begins at the right-click point');
  await review.screenshot('conversation-menu-at-pointer');
  await review.key('Escape');
  await review.key('F10', { shift: true });
  await review.waitFor(`Boolean(document.querySelector(${q(menu)}))`);
  await review.assert(`(() => { const r = document.querySelector(${q(session)}).getBoundingClientRect(), m = document.querySelector(${q(menu)}).getBoundingClientRect(); return Math.abs(m.top - (r.bottom + 5)) < 1 && document.activeElement?.getAttribute('role') === 'menuitem'; })()`, 'Keyboard conversation menu uses its row and focuses an action');
  await review.key('Escape');
  point = await right(project);
  await assertPosition(point, 'Project menu begins at the right-click point');
  await review.screenshot('project-menu-at-pointer');
  await review.key('Escape');
  await review.assert(`document.activeElement === document.querySelector(${q(more)})`, 'Escape restores focus to the project menu control');
  await review.key('F10', { shift: true });
  await review.waitFor(`Boolean(document.querySelector(${q(menu)}))`);
  await review.assert(`(() => { const r = document.querySelector(${q(project)}).parentElement.getBoundingClientRect(), m = document.querySelector(${q(menu)}).getBoundingClientRect(); return Math.abs(m.top - (r.bottom + 5)) < 1; })()`, 'Keyboard project menus do not reuse a previous mouse position');
  await review.key('Escape');
  await review.click(more);
  await review.assert(`(() => { const r = document.querySelector(${q(more)}).getBoundingClientRect(), m = document.querySelector(${q(menu)}).getBoundingClientRect(); return Math.abs(m.top - (r.bottom + 5)) < 1; })()`, 'The more button keeps its existing anchored placement');
  await review.key('Escape');
  await review.viewport(960, 600);
  point = await right('.pd-session-item[data-session-path$="session-13.jsonl"] .pd-session-row');
  await assertPosition(point, 'A conversation menu near the bottom stays fully inside the window');
  await review.screenshot('conversation-menu-bottom-edge');
  await review.key('Escape');
  await review.assert(`!document.querySelector(${q(menu)})`, 'Menus remain dismissible with Escape');

  await review.viewport(1440, 900);
  await review.click('[data-mode="grouped"]');
  await review.waitFor(`Boolean(document.querySelector(${q(groupToggle)}))`);
  const expandedBefore = await review.evaluate(`document.querySelector(${q(groupToggle)}).getAttribute('aria-expanded')`);
  point = await right(groupToggle);
  await assertPosition(point, 'Custom group menu begins at the right-click point');
  await review.assert(`(() => { const items = [...document.querySelectorAll(${q(menu + ' [role="menuitem"]')})]; return items.length === 2 && items.some(item => item.textContent === '重命名分组') && items.some(item => item.textContent === '解散分组'); })()`, 'A custom group context menu exposes its existing rename and dissolve actions');
  await review.mouseMove(point.x + 12, point.y);
  await review.assert(`document.querySelector(${q(groupToggle)}).getAttribute('aria-expanded') === ${q(expandedBefore)} && !document.querySelector('.pd-sidebar-drag-ghost') && window.__contextMenusReview.writes.length === 0`, 'Right-clicking a draggable group does not collapse it, begin a drag, or modify groups');
  await review.screenshot('custom-group-menu-at-pointer');
  await review.key('Escape');
  await review.assert(`!document.querySelector(${q(menu)}) && document.activeElement === document.querySelector(${q(groupMore)})`, 'Escape restores focus to the custom group menu control');
  await review.key('F10', { shift: true });
  await review.waitFor(`Boolean(document.querySelector(${q(menu)}))`);
  await review.assert(`(() => { const r = document.querySelector(${q(groupToggle)}).parentElement.getBoundingClientRect(), m = document.querySelector(${q(menu)}).getBoundingClientRect(); return Math.abs(m.top - (r.bottom + 5)) < 1 && document.activeElement?.getAttribute('role') === 'menuitem'; })()`, 'Keyboard group menus anchor to the heading without reusing mouse coordinates and focus an action');
  await review.key('Escape');
  await review.click(groupMore);
  await review.assert(`(() => { const r = document.querySelector(${q(groupMore)}).getBoundingClientRect(), m = document.querySelector(${q(menu)}).getBoundingClientRect(); return Math.abs(m.top - (r.bottom + 5)) < 1 && document.querySelector(${q(groupMore)}).getAttribute('aria-expanded') === 'true'; })()`, 'The custom group more button retains its anchored menu and expanded state');
  await review.click(groupMore);
  await review.assert(`!document.querySelector(${q(menu)}) && document.querySelector(${q(groupMore)}).getAttribute('aria-expanded') === 'false'`, 'The same custom group more button toggles its menu closed');
  await right(groupToggle);
  await review.clickText(`${menu} [role=menuitem]`, '重命名分组');
  await review.assert(`Boolean(document.querySelector(${q(dialog)})) && document.activeElement === document.querySelector('#pd-sidebar-group-name') && document.activeElement.value === '菜单位置分组'`, 'Renaming from a right-click group menu focuses the editor for the selected group');
  await review.fill('#pd-sidebar-group-name', '取消的重命名');
  await review.key('Escape');
  await review.assert(`!document.querySelector(${q(dialog)}) && document.activeElement === document.querySelector(${q(groupMore)}) && window.__contextMenusReview.writes.length === 0 && document.querySelector(${q(groupToggle)}).textContent.includes('菜单位置分组')`, 'Cancelling group rename returns focus to its menu button and preserves the group');

  await review.viewport(960, 600);
  point = await right('.pd-sidebar-group[data-section-key="group:context-bottom"] .pd-sidebar-group-toggle');
  await assertPosition(point, 'A custom group menu near the bottom stays fully inside the window');
  await review.assert(`document.querySelector(${q(menu)}).getBoundingClientRect().top < ${point.y}`, 'The bottom group actually exercises upward viewport clamping');
  await review.screenshot('custom-group-menu-bottom-edge');
  await review.key('Escape');
  await review.assert(`!document.querySelector(${q(menu)})`, 'The bottom custom group menu remains dismissible with Escape');
}
