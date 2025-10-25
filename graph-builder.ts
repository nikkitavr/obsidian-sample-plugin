import { CachedMetadata, MetadataCache, TAbstractFile, TFile, Vault } from 'obsidian';
import { Node } from './graph';
import { TreePref } from './settings';

export interface NodeComputation {
        node: Node;
        parentIds: ReadonlySet<string>;
}

export interface GraphBuilderOptions {
        metadataCache: MetadataCache;
        vault: Vault;
        tree: TreePref;
        logger: Logger;
}

export interface Logger {
        debug: (...values: unknown[]) => void;
        info: (...values: unknown[]) => void;
        warn: (...values: unknown[]) => void;
}

const INVALID_LOG_THROTTLE_KEY = 'invalid';

export class GraphBuilder {
        private readonly loggedWarnings = new Set<string>();

        constructor(private readonly options: GraphBuilderOptions) {}

        buildFromEntryPaths(paths: Iterable<string>): Map<string, NodeComputation> {
                const results = new Map<string, NodeComputation>();
                const visiting = new Set<string>();

                const visit = (path: string) => {
                        if (results.has(path) || visiting.has(path)) {
                                return;
                        }

                        visiting.add(path);
                        const computation = this.computeForPath(path);
                        results.set(path, computation);
                        visiting.delete(path);

                        for (const parentId of computation.parentIds) {
                                if (!results.has(parentId)) {
                                        visit(parentId);
                                }
                        }
                };

                for (const path of paths) {
                        visit(path);
                }

                return results;
        }

        private computeForPath(path: string): NodeComputation {
                const file = this.getFileByPath(path);
                const metadata = file ? this.options.metadataCache.getFileCache(file) ?? null : null;
                const parentIds = metadata ? this.extractParentIds(path, metadata) : new Set<string>();
                const markedAsFolder = metadata ? this.shouldMarkAsFolder(metadata) : false;

                const node: Node = {
                        pathId: path,
                        marked_as_folder: markedAsFolder,
                        isPhantom: !file,
                };

                return { node, parentIds };
        }

        private extractParentIds(path: string, metadata: CachedMetadata): Set<string> {
                const parents = new Set<string>();

                if (!metadata.frontmatter) {
                        return parents;
                }

                for (const key of this.options.tree.reference_keys) {
                        if (!Object.prototype.hasOwnProperty.call(metadata.frontmatter, key)) {
                                continue;
                        }

                        const rawValue = metadata.frontmatter[key];
                        if (typeof rawValue === 'string') {
                                this.extractFromFrontmatterValue(rawValue, path, parents, key);
                                continue;
                        }

                        if (Array.isArray(rawValue)) {
                                for (const value of rawValue) {
                                        if (typeof value === 'string') {
                                                this.extractFromFrontmatterValue(value, path, parents, key);
                                        } else {
                                                this.warnOnce(`${key}:${INVALID_LOG_THROTTLE_KEY}`);
                                        }
                                }
                                continue;
                        }

                        this.warnOnce(`${key}:${INVALID_LOG_THROTTLE_KEY}`);
                }

                return parents;
        }

        private extractFromFrontmatterValue(
                rawValue: string,
                sourcePath: string,
                parents: Set<string>,
                key: string,
        ) {
                const linkTargets = this.getLinkTargets(rawValue);
                if (linkTargets.length === 0) {
                        this.warnOnce(`${key}:${INVALID_LOG_THROTTLE_KEY}`);
                        return;
                }

                for (const target of linkTargets) {
                        const resolved = this.options.metadataCache.getFirstLinkpathDest(target, sourcePath);
                        if (resolved) {
                                parents.add(resolved.path);
                                continue;
                        }

                        parents.add(this.createPhantomPath(target));
                }
        }

        private shouldMarkAsFolder(metadata: CachedMetadata): boolean {
                const tags = this.collectTags(metadata);
                const target = new Set(
                        this.options.tree.branch_tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
                );

                for (const tag of tags) {
                        if (target.has(tag)) {
                                return true;
                        }
                }

                return false;
        }

        private collectTags(metadata: CachedMetadata): Set<string> {
                const tags = new Set<string>();

                const cachedTags = metadata.tags ?? [];
                for (const tag of cachedTags) {
                        if (tag.tag) {
                                tags.add(tag.tag);
                        }
                }

                const frontmatterTags = metadata.frontmatter?.tags;
                if (typeof frontmatterTags === 'string') {
                        tags.add(frontmatterTags);
                } else if (Array.isArray(frontmatterTags)) {
                        for (const tag of frontmatterTags) {
                                if (typeof tag === 'string') {
                                        tags.add(tag);
                                }
                        }
                }

                return tags;
        }

        private getLinkTargets(raw: string): string[] {
                const regex = /\[\[([^\]]+)\]\]/g;
                const results: string[] = [];
                let match: RegExpExecArray | null;
                while ((match = regex.exec(raw)) !== null) {
                        const target = match[1];
                        const [link] = target.split('|', 1);
                        const cleaned = link.split('#', 1)[0].trim();
                        if (cleaned.length > 0) {
                                results.push(cleaned);
                        }
                }
                return results;
        }

        private createPhantomPath(target: string): string {
                const sanitized = target
                        .replace(/\\/g, '/')
                        .replace(/[<>:"|?*]/g, '-')
                        .replace(/\s+/g, ' ')
                        .trim();
                const withExtension = sanitized.endsWith('.md') ? sanitized : `${sanitized}.md`;
                return `phantoms/${withExtension}`;
        }

        private getFileByPath(path: string): TFile | null {
                const abstractFile: TAbstractFile | null = this.options.vault.getAbstractFileByPath(path);
                if (abstractFile instanceof TFile) {
                        return abstractFile;
                }
                return null;
        }

        private warnOnce(key: string): void {
                if (this.loggedWarnings.has(key)) {
                        return;
                }
                this.loggedWarnings.add(key);
                this.options.logger.warn(
                        '[TreeBuilderPlugin] Ignoring malformed frontmatter value for key:',
                        key.split(':')[0],
                );
        }
}
