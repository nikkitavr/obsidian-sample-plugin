import { ConsoleLogger } from './utils';

//TODO кэшировать дерево с версионированием + thread safe locks на операции

export interface Node {
        pathId: string;
        marked_as_folder: boolean;
        /**
         * Synthetic nodes are created for unresolved wikilinks so the graph retains
         * structural integrity even when a target does not yet exist on disk.
         */
        isPhantom?: boolean;
}

export interface TreeNode {
        node: Node;
        childs: TreeNode[];
}

export interface HeaderNode {
        name: string;
        roots: TreeNode[];
}

export interface Graph {
        title: string;
        parentToChildIds: Map<string, Set<string>>;
        childToParentIds: Map<string, Set<string>>;
        rootNodesIds: Set<string>;
        nodes: Map<string, Node>;

        addNode(node: Node): void;
        removeNode(nodeId: string): void;
        addEdge(parentId: string, childId: string): void;
        removeEdge(parentId: string, childId: string): void;
        toTree(): HeaderNode | null;
}

/**
 * Mutable in-memory graph implementation. It keeps adjacency maps in sync and
 * recalculates root status as nodes and edges are updated.
 */
export class GraphStore implements Graph {
        readonly parentToChildIds = new Map<string, Set<string>>();
        readonly childToParentIds = new Map<string, Set<string>>();
        readonly rootNodesIds = new Set<string>();
        readonly nodes = new Map<string, Node>();
        private readonly logger = ConsoleLogger.create(GraphStore);

        constructor(public readonly title: string) {}

        addNode(node: Node): void {
                this.nodes.set(node.pathId, node);
                if (!this.childToParentIds.has(node.pathId)) {
                        this.childToParentIds.set(node.pathId, new Set());
                }
                this.recalculateRoot(node.pathId);
        }

        removeNode(nodeId: string): void {
                this.nodes.delete(nodeId);
                const parents = this.childToParentIds.get(nodeId);
                if (parents) {
                        for (const parentId of parents) {
                                this.removeEdge(parentId, nodeId);
                        }
                }
                this.childToParentIds.delete(nodeId);

                const children = this.parentToChildIds.get(nodeId);
                if (children) {
                        for (const childId of children) {
                                const parentSet = this.childToParentIds.get(childId);
                                if (parentSet) {
                                        parentSet.delete(nodeId);
                                        this.recalculateRoot(childId);
                                }
                        }
                }
                this.parentToChildIds.delete(nodeId);
                this.rootNodesIds.delete(nodeId);
        }

        addEdge(parentId: string, childId: string): void {
                if (!this.nodes.has(parentId) || !this.nodes.has(childId)) {
                        return;
                }

                const childSet = this.ensureSet(this.parentToChildIds, parentId);
                childSet.add(childId);

                const parentSet = this.ensureSet(this.childToParentIds, childId);
                parentSet.add(parentId);

                this.recalculateRoot(childId);
        }

        removeEdge(parentId: string, childId: string): void {
                const childSet = this.parentToChildIds.get(parentId);
                if (childSet) {
                        childSet.delete(childId);
                        if (childSet.size === 0) {
                                this.parentToChildIds.delete(parentId);
                        }
                }

                const parentSet = this.childToParentIds.get(childId);
                if (parentSet) {
                        parentSet.delete(parentId);
                        if (parentSet.size === 0) {
                                this.childToParentIds.delete(childId);
                        }
                }

                this.recalculateRoot(childId);
        }

        clear(): void {
                this.parentToChildIds.clear();
                this.childToParentIds.clear();
                this.rootNodesIds.clear();
                this.nodes.clear();
        }

        toTree(): HeaderNode | null {
                const cycle = this.findDirectedCycle();
                if (cycle) {
                        this.logger.warn(
                                `Unable to convert graph "${this.title}" to tree. Directed cycle detected: ${cycle.join(
                                        ' -> ',
                                )}`,
                        );
                        return null;
                }

                const cache = new Map<string, TreeNode>();
                const buildTreeNode = (nodeId: string): TreeNode | null => {
                        const existing = cache.get(nodeId);
                        if (existing) {
                                return existing;
                        }

                        const node = this.nodes.get(nodeId);
                        if (!node) {
                                this.logger.warn(
                                        `Skipping missing node "${nodeId}" while converting graph "${this.title}" to tree.`,
                                );
                                return null;
                        }

                        const treeNode: TreeNode = {
                                node,
                                childs: [],
                        };
                        cache.set(nodeId, treeNode);

                        const childIds = this.parentToChildIds.get(nodeId);
                        if (childIds) {
                                for (const childId of childIds) {
                                        const childTreeNode = buildTreeNode(childId);
                                        if (childTreeNode) {
                                                treeNode.childs.push(childTreeNode);
                                        }
                                }
                        }

                        return treeNode;
                };

                const roots: TreeNode[] = [];
                const rootIds =
                        this.rootNodesIds.size > 0
                                ? Array.from(this.rootNodesIds)
                                : Array.from(this.nodes.keys()).filter(
                                          (nodeId) => (this.childToParentIds.get(nodeId)?.size ?? 0) === 0,
                                  );

                for (const rootId of rootIds) {
                        const treeNode = buildTreeNode(rootId);
                        if (treeNode) {
                                roots.push(treeNode);
                        }
                }

                return {
                        name: this.title,
                        roots,
                };
        }

        private recalculateRoot(nodeId: string): void {
                const parentSet = this.childToParentIds.get(nodeId);
                if (parentSet && parentSet.size > 0) {
                        this.rootNodesIds.delete(nodeId);
                        return;
                }

                if (this.nodes.has(nodeId)) {
                        this.rootNodesIds.add(nodeId);
                } else {
                        this.rootNodesIds.delete(nodeId);
                }
        }

        private ensureSet(map: Map<string, Set<string>>, key: string): Set<string> {
                let existing = map.get(key);
                if (!existing) {
                        existing = new Set();
                        map.set(key, existing);
                }
                return existing;
        }

        private findDirectedCycle(): string[] | null {
                const visited = new Set<string>();
                const visiting = new Set<string>();
                const stack: string[] = [];

                const dfs = (nodeId: string): string[] | null => {
                        visiting.add(nodeId);
                        stack.push(nodeId);

                        const childIds = this.parentToChildIds.get(nodeId);
                        if (childIds) {
                                for (const childId of childIds) {
                                        if (visiting.has(childId)) {
                                                const cycleStart = stack.indexOf(childId);
                                                const cyclePath = stack.slice(cycleStart);
                                                cyclePath.push(childId);
                                                return cyclePath;
                                        }

                                        if (!visited.has(childId)) {
                                                const cycle = dfs(childId);
                                                if (cycle) {
                                                        return cycle;
                                                }
                                        }
                                }
                        }

                        stack.pop();
                        visiting.delete(nodeId);
                        visited.add(nodeId);
                        return null;
                };

                for (const nodeId of this.nodes.keys()) {
                        if (!visited.has(nodeId)) {
                                const cycle = dfs(nodeId);
                                if (cycle) {
                                        return cycle;
                                }
                        }
                }

                return null;
        }
}
