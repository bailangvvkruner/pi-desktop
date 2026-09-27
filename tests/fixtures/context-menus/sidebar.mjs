// Isolated renderer interactions; no real sessions or projects are changed.
function installContextMenusFixture() {
  const fixture = window.__modelReview, bridge = window.piDesktop;
  const cwd = 'C:\\context-menu-review\\project';
  const rows = Array.from({ length: 14 }, (_, index) => ({ id: `session-${index}`, path: `${cwd}\\session-${index}.jsonl`, name: index ? `对话 ${index + 1}` : '右键菜单位置验证', firstMessage: '菜单位置', modified: '2026-09-27T00:00:00Z', messageCount: 2 }));
  bridge.getDefaultWorkspace = async () => 'C:\\context-menu-review\\home';
  bridge.listWorkspaces = async () => [cwd];
  bridge.listSessions = async workspace => workspace === cwd ? structuredClone(rows) : [];
  Object.assign(fixture.snapshot, { cwd, sessionId: rows[0].id, sessionPath: rows[0].path });
}

export default async function sidebarContextMenus(review) {
  const q = JSON.stringify;
  const menu = '.pd-sidebar-popover[role="menu"]';
  const session = '.pd-session-item .pd-session-row';
  const project = '.pd-sidebar-group[data-project-path] .pd-sidebar-group-toggle';
  const more = '.pd-sidebar-group[data-project-path] .pd-group-more[aria-haspopup="menu"]';
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
}
