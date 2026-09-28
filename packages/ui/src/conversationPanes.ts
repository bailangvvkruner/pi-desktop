export interface PaneSession { cwd: string; sessionId: string; sessionPath: string | null; title: string }
export type PaneNode = { kind: 'pane'; id: string; session: PaneSession | null } | { kind: 'split'; id: string; direction: 'horizontal' | 'vertical'; ratio: number; first: PaneNode; second: PaneNode };
export const MAX_CONVERSATION_PANES = 4;
export const paneLeaves = (node: PaneNode): Extract<PaneNode, { kind: 'pane' }>[] => node.kind === 'pane' ? [node] : [...paneLeaves(node.first), ...paneLeaves(node.second)];
export function replacePane(node: PaneNode, id: string, replacement: PaneNode): PaneNode {
  if (node.id === id) return replacement;
  return node.kind === 'pane' ? node : { ...node, first: replacePane(node.first, id, replacement), second: replacePane(node.second, id, replacement) };
}
export function splitPane(tree: PaneNode, id: string, direction: 'horizontal' | 'vertical', newId: string): PaneNode {
  const leaf = paneLeaves(tree).find(pane => pane.id === id);
  if (!leaf || paneLeaves(tree).length >= MAX_CONVERSATION_PANES || paneLeaves(tree).some(pane => pane.id === newId)) return tree;
  return replacePane(tree, id, { kind: 'split', id: `split-${newId}`, direction, ratio: 50, first: leaf, second: { kind: 'pane', id: newId, session: null } });
}
export function closePane(node: PaneNode, id: string): PaneNode | null {
  if (node.kind === 'pane') return node.id === id ? null : node;
  const first = closePane(node.first, id), second = closePane(node.second, id);
  return !first ? second : !second ? first : { ...node, first, second };
}
export function setPaneRatio(node: PaneNode, id: string, ratio: number): PaneNode {
  if (node.kind === 'pane') return node;
  if (node.id === id) return { ...node, ratio: Math.max(20, Math.min(80, ratio)) };
  return { ...node, first: setPaneRatio(node.first, id, ratio), second: setPaneRatio(node.second, id, ratio) };
}
/** Reload persistence stores identities only. Never serialize transcripts or drafts. */
export function parsePaneLayout(raw: string | null): { tree: PaneNode; active: string } | null {
  try {
    if (!raw || raw.length > 160_000) return null;
    const saved = JSON.parse(raw);
    const ids = new Set<string>(); let leaves = 0;
    const parse = (v: any, depth: number): PaneNode => {
      if (!v || depth > 3 || typeof v.id !== 'string' || !/^[\w-]{1,80}$/.test(v.id) || ids.has(v.id)) throw 0;
      ids.add(v.id);
      if (v.kind === 'split') {
        if (!['horizontal','vertical'].includes(v.direction) || !Number.isFinite(v.ratio)) throw 0;
        return { kind: 'split', id: v.id, direction: v.direction, ratio: Math.max(20, Math.min(80, v.ratio)), first: parse(v.first, depth + 1), second: parse(v.second, depth + 1) };
      }
      if (v.kind !== 'pane' || ++leaves > MAX_CONVERSATION_PANES) throw 0;
      let session: PaneSession | null = null;
      if (v.session) {
        const s = v.session;
        if (typeof s.cwd !== 'string' || s.cwd.length > 32768 || typeof s.sessionId !== 'string' || s.sessionId.length > 256 || s.sessionPath !== null && (typeof s.sessionPath !== 'string' || s.sessionPath.length > 32768) || typeof s.title !== 'string') throw 0;
        session = { cwd: s.cwd, sessionId: s.sessionId, sessionPath: s.sessionPath, title: s.title.slice(0, 200) };
      }
      return { kind: 'pane', id: v.id, session };
    };
    const tree = parse(saved.tree, 0);
    return { tree, active: paneLeaves(tree).some(p => p.id === saved.active) ? saved.active : paneLeaves(tree)[0]!.id };
  } catch { return null; }
}
