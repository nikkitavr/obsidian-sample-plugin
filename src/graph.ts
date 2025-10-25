export interface Node {
        pathId: string;
        marked_as_folder: boolean;
        /**
         * Synthetic nodes are created for unresolved wikilinks so the graph retains
         * structural integrity even when a target does not yet exist on disk.
         */
        isPhantom?: boolean;
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
}

