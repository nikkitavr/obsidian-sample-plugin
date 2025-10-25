import { MetadataCache, TAbstractFile, TFile, Vault } from 'obsidian';
import { GraphStore, Node } from './graph';
import { GraphBuilder, NodeComputation } from './graph-builder';
import { TreeBuilderSettings, TreePref } from './settings';
import { ConsoleLogger, Notifier, snapshot } from './utils';

const DEFAULT_DEBOUNCE_MS = 300;

interface NodeSnapshot {
        node: Node;
        parentIds: Set<string>;
}

interface TreeGraphContext {
        id: string;
        pref: TreePref;
        graph: GraphStore;
        builder: GraphBuilder;
        nodeSnapshots: Map<string, NodeSnapshot>;
        entryPaths: Set<string>;
        queue: DebouncedPathQueue;
}

type Path = string;

export class GraphOrchestrator {
        private readonly contexts = new Map<string, TreeGraphContext>();
        private readonly logger = ConsoleLogger.create(GraphOrchestrator);

        constructor(
                private readonly vault: Vault, //todo: replace to vaultProvider / repository
                private readonly metadataCache: MetadataCache, //todo: replace to metadataCacheProvider / repository
                private readonly settings: TreeBuilderSettings,
                private readonly notifier: Notifier,
                private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
        ) {
                this.initializeContexts();
        }

        bootstrap(): void {
                for (const context of this.contexts.values()) {
                        this.logger.debug(`[GraphOrchestrator] Bootstraping context ${context.id}`);
                        this.refreshEntryPaths(context);
                        this.logger.debug(`[GraphOrchestrator] entryPaths:  `, context.entryPaths);
                        this.rebuildContext(context);
                        this.logger.debug(`[GraphOrchestrator] End bootstraping context ${context.id}`);
                }
        }

        graphs(): Map<string, GraphStore> {
                return new Map(
                        Array.from(this.contexts.entries()).map(([key, context]) => [key, context.graph] as [string, GraphStore])
                );
        }

        drain(): void {
                for (const context of this.contexts.values()) {
                        context.queue.drain();
                }
        }

        handleFileCreated(file: TFile): void {
                if (!this.isMarkdown(file)) {
                        return;
                }

                for (const context of this.contexts.values()) {
                        let queued = false;
                        if (this.isPathInTree(file.path, context.pref)) {
                                context.entryPaths.add(file.path);
                                queued = true;
                        }

                        if (context.nodeSnapshots.has(file.path)) {
                                queued = true;
                        }

                        if (queued) {
                                context.queue.enqueue(file.path);
                        }
                }
        }

        handleMetadataChanged(file: TFile): void {
                if (!this.isMarkdown(file)) {
                        return;
                }

                for (const context of this.contexts.values()) {
                        if (
                                this.isPathInTree(file.path, context.pref) ||
                                context.nodeSnapshots.has(file.path)
                        ) {
                                context.queue.enqueue(file.path);
                        }
                }
        }

        handleFileRenamed(file: TAbstractFile, oldPath: string): void {
                if (!(file instanceof TFile) || !this.isMarkdown(file)) {
                        return;
                }

                const newPath = file.path;

                for (const context of this.contexts.values()) {
                        const wasKnown = context.nodeSnapshots.has(oldPath) || this.isPathInTree(oldPath, context.pref);
                        const isNowEntry = this.isPathInTree(newPath, context.pref);

                        if (!wasKnown && !context.nodeSnapshots.has(oldPath)) {
                                continue;
                        }

                        if (context.entryPaths.delete(oldPath)) {
                                this.logger.debug('Removed entry path after rename', oldPath);
                        }

                        if (isNowEntry) {
                                context.entryPaths.add(newPath);
                        }

                        if (context.nodeSnapshots.has(oldPath)) {
                                this.renameNode(context, oldPath, newPath);
                        }

                        context.queue.flushNow([newPath]);
                }
        }

        handleFileDeleted(file: TAbstractFile): void {
                if (!(file instanceof TFile) || !this.isMarkdown(file)) {
                        return;
                }

                const path = file.path;

                for (const context of this.contexts.values()) {
                        if (!context.nodeSnapshots.has(path) && !this.isPathInTree(path, context.pref)) {
                                continue;
                        }

                        context.entryPaths.delete(path);
                        this.removeNode(context, path);
                        this.pruneOrphans(context);
                }
        }

        private initializeContexts(): void {
                this.contexts.clear();

                this.settings.trees_to_build.forEach((tree, index) => {
                        const id = `${tree.tree_name || 'tree'}#${index}`;
                        const graph = new GraphStore(tree.tree_name || `Tree ${index + 1}`);
                        const builder = new GraphBuilder({
                                metadataCache: this.metadataCache,
                                vault: this.vault,
                                tree,
                                notifier: this.notifier,
                        });

                        const context: TreeGraphContext = {
                                id,
                                pref: tree,
                                graph,
                                builder,
                                nodeSnapshots: new Map(),
                                entryPaths: new Set(),
                                queue: new DebouncedPathQueue(this.debounceMs, (paths) => {
                                        this.processIncrementalUpdate(id, paths);
                                }),
                        };

                        this.contexts.set(id, context);
                        this.logger.debug(
                                `Context ${id}`,
                                {
                                        id,
                                        pref: snapshot(context.pref),
                                        graph: snapshot(context.graph),
                                        nodeSnapshots: snapshot(context.nodeSnapshots),
                                        entryPaths: snapshot(context.entryPaths),
                                        builderOptionsTree: snapshot(tree),
                                }
                        );
                        

                });
        }

        private refreshEntryPaths(context: TreeGraphContext): void {
                context.entryPaths.clear();
                for (const file of this.vault.getFiles()) {
                        if (!this.isMarkdown(file)) {
                                continue;
                        }
                        if (this.isPathInTree(file.path, context.pref)) {
                                context.entryPaths.add(file.path);
                        }
                }
        }

        private rebuildContext(context: TreeGraphContext): void {
                const computations = context.builder.buildFromEntryPaths(context.entryPaths);
                this.logger.debug(`[GraphOrchestrator] computations from builder: `, computations);
                this.resetGraphFromComputations(context, computations);
                this.logger.debug(`[GraphOrchestrator] graph reseted & context rebuilded: \n`,
                        `nodeSnapshots: `, context.nodeSnapshots,
                        `graph: `, context.graph);
        }

        private processIncrementalUpdate(treeId: string, paths: Iterable<Path>): void {
                const context = this.contexts.get(treeId);
                if (!context) {
                        return;
                }

                const targets = new Set<string>();
                for (const path of paths) {
                        targets.add(path);
                        if (this.isPathInTree(path, context.pref)) {
                                targets.add(path);
                                if (this.isExistingMarkdown(path)) {
                                        context.entryPaths.add(path);
                                }
                        }
                }

                if (targets.size === 0) {
                        return;
                }

                const computations = context.builder.buildFromEntryPaths(targets);
                this.applyComputations(context, computations);
                this.pruneOrphans(context);
        }

        private resetGraphFromComputations(
                context: TreeGraphContext,
                computations: Map<string, NodeComputation>,
        ): void {
                context.graph.clear();
                context.nodeSnapshots.clear();

                for (const { node, parentIds } of computations.values()) {
                        context.graph.addNode(node);
                        context.nodeSnapshots.set(node.pathId, {
                                node,
                                parentIds: new Set(parentIds),
                        });
                }

                for (const { node, parentIds } of computations.values()) {
                        this.ensureParentsExist(context, parentIds);
                        for (const parentId of parentIds) {
                                context.graph.addEdge(parentId, node.pathId);
                        }
                }
        }

        private applyComputations(context: TreeGraphContext, computations: Map<string, NodeComputation>): void {
                const previousParents = new Map<string, Set<string>>();

                for (const [nodeId, computation] of computations) {
                        const existing = context.nodeSnapshots.get(nodeId);
                        previousParents.set(nodeId, new Set(existing?.parentIds ?? []));

                        context.graph.addNode(computation.node);
                        if (existing) {
                                existing.node = computation.node;
                                existing.parentIds = new Set(computation.parentIds);
                        } else {
                                context.nodeSnapshots.set(nodeId, {
                                        node: computation.node,
                                        parentIds: new Set(computation.parentIds),
                                });
                        }
                }

                for (const computation of computations.values()) {
                        this.ensureParentsExist(context, computation.parentIds);
                }

                for (const [nodeId, computation] of computations) {
                        const updatedSnapshot = context.nodeSnapshots.get(nodeId);
                        if (!updatedSnapshot) {
                                continue;
                        }

                        const newParents = updatedSnapshot.parentIds;
                        const previous = previousParents.get(nodeId) ?? new Set<string>();

                        for (const parentId of previous) {
                                if (!newParents.has(parentId)) {
                                        context.graph.removeEdge(parentId, nodeId);
                                }
                        }

                        for (const parentId of newParents) {
                                context.graph.addEdge(parentId, nodeId);
                        }
                }
        }

        private ensureParentsExist(context: TreeGraphContext, parentIds: ReadonlySet<string>): void {
                for (const parentId of parentIds) {
                        if (context.nodeSnapshots.has(parentId)) {
                                const parentSnapshot = context.nodeSnapshots.get(parentId)!;
                                context.graph.addNode(parentSnapshot.node);
                                continue;
                        }

                        const phantomNode: Node = {
                                pathId: parentId,
                                marked_as_folder: false,
                                isPhantom: true,
                        };

                        context.graph.addNode(phantomNode);
                        context.nodeSnapshots.set(parentId, {
                                node: phantomNode,
                                parentIds: new Set(),
                        });
                }
        }

        private pruneOrphans(context: TreeGraphContext): void {
                const removable: string[] = [];
                for (const [nodeId, snapshot] of context.nodeSnapshots.entries()) {
                        if (context.entryPaths.has(nodeId)) {
                                continue;
                        }
                        const parents = context.graph.childToParentIds.get(nodeId);
                        const children = context.graph.parentToChildIds.get(nodeId);
                        const hasParents = parents && parents.size > 0;
                        const hasChildren = children && children.size > 0;
                        if (!hasParents && !hasChildren) {
                                removable.push(nodeId);
                        }
                }

                for (const nodeId of removable) {
                        context.graph.removeNode(nodeId);
                        context.nodeSnapshots.delete(nodeId);
                }
        }

        private removeNode(context: TreeGraphContext, nodeId: string): void {
                        context.graph.removeNode(nodeId);
                        context.nodeSnapshots.delete(nodeId);
        }

        private renameNode(context: TreeGraphContext, oldId: string, newId: string): void {
                if (oldId === newId) {
                        return;
                }

                const snapshot = context.nodeSnapshots.get(oldId);
                if (!snapshot) {
                        return;
                }

                const parents = new Set(context.graph.childToParentIds.get(oldId) ?? []);
                const children = new Set(context.graph.parentToChildIds.get(oldId) ?? []);

                context.graph.removeNode(oldId);
                context.nodeSnapshots.delete(oldId);

                snapshot.node = { ...snapshot.node, pathId: newId, isPhantom: false };
                snapshot.parentIds = new Set(parents);
                context.nodeSnapshots.set(newId, snapshot);
                context.graph.addNode(snapshot.node);

                for (const parentId of parents) {
                        this.ensureParentsExist(context, new Set([parentId]));
                        context.graph.addEdge(parentId, newId);
                }

                for (const childId of children) {
                        const childSnapshot = context.nodeSnapshots.get(childId);
                        if (childSnapshot) {
                                childSnapshot.parentIds.delete(oldId);
                                childSnapshot.parentIds.add(newId);
                        }
                        context.graph.addEdge(newId, childId);
                }
        }

        private isMarkdown(file: TFile): boolean {
                return file.extension.toLowerCase() === 'md';
        }

        private isExistingMarkdown(path: string): boolean {
                const abstract = this.vault.getAbstractFileByPath(path);
                return abstract instanceof TFile && this.isMarkdown(abstract);
        }

        private isPathInTree(path: string, tree: TreePref): boolean {
                if (tree.folders_to_scan.length === 0) {
                        return true;
                }

                for (const folder of tree.folders_to_scan) {
                        const normalizedFolder = this.normalizeFolder(folder);
                        if (normalizedFolder.length === 0) {
                                return true;
                        }
                        if (path === normalizedFolder || path.startsWith(`${normalizedFolder}/`)) {
                                return true;
                        }
                }

                return false;
        }

        private normalizeFolder(folder: string): string {
                return folder.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '');
        }
}

class DebouncedPathQueue {
        private readonly pending = new Set<string>();
        private timer: number | null = null;

        constructor(
                private readonly delay: number,
                private readonly onFlush: (paths: Iterable<string>) => void,
        ) {}

        enqueue(path: string): void {
                this.pending.add(path);
                if (this.timer === null) {
                        this.timer = window.setTimeout(() => {
                                this.flush();
                        }, this.delay);
                }
        }

        flushNow(extra?: Iterable<string>): void {
                if (extra) {
                        for (const path of extra) {
                                this.pending.add(path);
                        }
                }
                this.flush();
        }

        drain(): void {
                this.flush();
        }

        private flush(): void {
                if (this.timer !== null) {
                        window.clearTimeout(this.timer);
                        this.timer = null;
                }

                if (this.pending.size === 0) {
                        return;
                }

                const snapshot = Array.from(this.pending.values());
                this.pending.clear();
                this.onFlush(snapshot);
        }
}
