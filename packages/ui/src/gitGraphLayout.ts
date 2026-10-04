/**
 * Commit-graph lane layout (zcode git-graph style, simplified VSCode lanes).
 * Pure logic so tests can cover branching and merging without Electron.
 *
 * Commits arrive newest-first with their parent hashes. The layout walks them
 * in order, tracking which parent hash occupies each lane:
 *  - a commit renders on the lane its hash occupies (or a free lane);
 *  - its first parent inherits that lane when possible;
 *  - additional parents (merges) take free lanes;
 *  - parents outside the loaded window end in a dashed "overflow" edge.
 */

export interface GitGraphInputCommit {
  hash: string;
  parents: string[];
}

export interface GitGraphEdge {
  /** Index of the child commit row. */
  fromIndex: number;
  fromLane: number;
  /** Index of the parent commit row; -1 when the parent is not loaded. */
  toIndex: number;
  toLane: number;
  loaded: boolean;
}

export interface GitGraphLayout {
  /** Lane index per commit row. */
  lanes: number[];
  edges: GitGraphEdge[];
  laneCount: number;
}

export function layoutGitGraph(commits: readonly GitGraphInputCommit[]): GitGraphLayout {
  const loaded = new Map<string, number>();
  commits.forEach((commit, index) => loaded.set(commit.hash, index));

  // Lanes hold the hash of the commit that will render there, or null (free).
  const lanes: (string | null)[] = [];
  const rowLanes: number[] = [];
  const edges: GitGraphEdge[] = [];

  const laneOf = (hash: string): number => lanes.indexOf(hash);
  const freeLane = (): number => {
    const index = lanes.indexOf(null);
    return index >= 0 ? index : (lanes.push(null) - 1);
  };
  const occupy = (lane: number, hash: string): void => { while (lanes.length <= lane) lanes.push(null); lanes[lane] = hash; };

  commits.forEach((commit, index) => {
    let lane = laneOf(commit.hash);
    if (lane < 0) lane = freeLane();
    // The commit consumes its own lane slot; parents may refill it below.
    lanes[lane] = null;
    rowLanes.push(lane);

    commit.parents.forEach((parent, parentIndex) => {
      const parentRow = loaded.get(parent);
      // First parent inherits the commit lane whenever that keeps the trunk straight.
      if (parentIndex === 0 && parentRow !== undefined) {
        const existing = laneOf(parent);
        if (existing >= 0 && existing !== lane) {
          edges.push({ fromIndex: index, fromLane: lane, toIndex: parentRow, toLane: existing, loaded: true });
          return;
        }
        occupy(lane, parent);
        edges.push({ fromIndex: index, fromLane: lane, toIndex: parentRow, toLane: lane, loaded: true });
        return;
      }
      const existing = laneOf(parent);
      if (existing >= 0) {
        edges.push({ fromIndex: index, fromLane: lane, toIndex: loaded.get(parent)!, toLane: existing, loaded: true });
        return;
      }
      if (parentRow === undefined) {
        // Parent beyond the loaded window: dashed edge leaving the graph.
        edges.push({ fromIndex: index, fromLane: lane, toIndex: -1, toLane: lane, loaded: false });
        return;
      }
      const target = freeLane();
      occupy(target, parent);
      edges.push({ fromIndex: index, fromLane: lane, toIndex: parentRow, toLane: target, loaded: true });
    });
  });

  return { lanes: rowLanes, edges, laneCount: Math.max(1, lanes.length) };
}
