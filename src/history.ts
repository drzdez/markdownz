// Per-tab navigation history kept as a tree instead of a linear stack.
//
// Going back and then following a different link does not discard the old
// "forward" branch; it adds a sibling. Going forward from a node with several
// children lets the user pick the branch (defaulting to the one visited last).

import { samePath } from "./paths";

export interface HistoryNode {
  id: number;
  path: string;
  parent: number | null;
  children: number[];
  /** Child most recently visited from this node; the default forward target. */
  lastChild: number | null;
  scroll: number;
  title?: string;
}

export interface HistoryState {
  nodes: HistoryNode[];
  current: number;
}

export class HistoryTree {
  private nodes = new Map<number, HistoryNode>();
  private nextId = 0;
  private currentId: number;

  constructor(path: string) {
    this.currentId = this.add(path, null).id;
  }

  static fromJSON(state: HistoryState): HistoryTree {
    if (!state.nodes.length) throw new Error("empty history");
    const tree = Object.create(HistoryTree.prototype) as HistoryTree;
    tree.nodes = new Map(state.nodes.map((n) => [n.id, { ...n, children: [...n.children] }]));
    tree.nextId = Math.max(...state.nodes.map((n) => n.id)) + 1;
    tree.currentId = tree.nodes.has(state.current) ? state.current : state.nodes[0].id;
    return tree;
  }

  toJSON(): HistoryState {
    return { nodes: [...this.nodes.values()], current: this.currentId };
  }

  get current(): HistoryNode {
    return this.nodes.get(this.currentId)!;
  }

  get root(): HistoryNode {
    let node = this.current;
    while (node.parent !== null) node = this.nodes.get(node.parent)!;
    return node;
  }

  node(id: number): HistoryNode | undefined {
    return this.nodes.get(id);
  }

  childrenOf(node: HistoryNode): HistoryNode[] {
    return node.children.map((id) => this.nodes.get(id)!);
  }

  get canBack(): boolean {
    return this.current.parent !== null;
  }

  get canForward(): boolean {
    return this.current.children.length > 0;
  }

  /** Follows a link from the current node. Revisiting an existing child reuses it. */
  navigate(path: string): HistoryNode {
    const from = this.current;
    const existing = this.childrenOf(from).find((c) => samePath(c.path, path));
    const target = existing ?? this.add(path, from.id);
    from.lastChild = target.id;
    this.currentId = target.id;
    return target;
  }

  back(): HistoryNode | null {
    const parent = this.current.parent;
    if (parent === null) return null;
    this.nodes.get(parent)!.lastChild = this.currentId;
    this.currentId = parent;
    return this.current;
  }

  /** Forward targets, the default (last visited) one first. */
  forwardOptions(): HistoryNode[] {
    const children = this.childrenOf(this.current);
    const last = this.current.lastChild;
    return children.sort((a, b) => Number(b.id === last) - Number(a.id === last));
  }

  /** Moves forward to `childId`, or to the only child when there is exactly one. */
  forward(childId?: number): HistoryNode | null {
    const children = this.current.children;
    const id = childId ?? (children.length === 1 ? children[0] : undefined);
    if (id === undefined || !children.includes(id)) return null;
    this.current.lastChild = id;
    this.currentId = id;
    return this.current;
  }

  /** Jumps anywhere in the tree; ancestors remember the path so forward retraces it. */
  goto(id: number): HistoryNode | null {
    let node = this.nodes.get(id);
    if (!node) return null;
    this.currentId = id;
    while (node.parent !== null) {
      const parent: HistoryNode = this.nodes.get(node.parent)!;
      parent.lastChild = node.id;
      node = parent;
    }
    return this.current;
  }

  private add(path: string, parent: number | null): HistoryNode {
    const node: HistoryNode = { id: this.nextId++, path, parent, children: [], lastChild: null, scroll: 0 };
    this.nodes.set(node.id, node);
    if (parent !== null) this.nodes.get(parent)!.children.push(node.id);
    return node;
  }
}
