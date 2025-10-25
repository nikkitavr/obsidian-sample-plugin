import { CachedMetadata, getAllTags, MetadataCache, TAbstractFile, TFile, Vault } from 'obsidian';
import { Node } from './graph';
import { TreePref } from './settings';
import { ConsoleLogger, Notifier } from 'utils';

export interface NodeComputation {
        node: Node;
        parentIds: ReadonlySet<string>;
}

export interface GraphBuilderOptions {
        metadataCache: MetadataCache;
        vault: Vault;
        tree: TreePref;
        notifier: Notifier;
}


export class GraphBuilder {
        private readonly LOG_KEY_PREFIX_INVALID_THROTTLE = 'invalid_throttle';
        private readonly LOG_KEY_PREFIX_FILE_META_NOT_FOUND = 'file_meta_not_found';

        //todo: introduce ttl for keys?
        private readonly loggedWarnings = new Set<string>();

        private readonly logger = ConsoleLogger.create(GraphBuilder);

        constructor(private readonly options: GraphBuilderOptions) {}

        buildFromEntryPaths(paths: Iterable<string>): Map<string, NodeComputation> {
                const results = new Map<string, NodeComputation>();

                const visit = (path: string, initial: boolean) => {
                        if (results.has(path)) {
                                return;
                        }

                        const computation = this.computeForPath(path, initial);

                        if (computation == null) {
                                return;
                        }

                        results.set(path, computation);

                        for (const parentId of computation.parentIds) {
                                visit(parentId, false);
                        }
                };

                for (const path of paths) {
                        visit(path, true);
                }

                return results;
        }

        private computeForPath(path: string, initial: boolean): NodeComputation | null {
                let parentIds = new Set<string>();
                const file = this.getFileByPath(path);
                if (!file) {
                        return {
                                node: {
                                        pathId: path,
                                        marked_as_folder: false,
                                        isPhantom: true,
                                },
                                parentIds,
                        };
                }

                const metadata: CachedMetadata | null = this.options.metadataCache.getFileCache(file);
                if (!metadata) { 
                        //todo: collect all such files and show in special menu?
                        this.warnOnce(`${this.LOG_KEY_PREFIX_FILE_META_NOT_FOUND}:${file.path}`, 
                                `Failed to get metadata for file: ${file.path} - it will be skipped. 
                                Maybe you should reload obsidian to avoid inconsistent results.`
                        );
                        return null;
                }

                if (this.hasReferenceKeys(metadata)) {
                        parentIds = this.extractParentIds(path, metadata);
                } else if (initial) {
                        return null;
                }

                const markedAsFolder = this.shouldMarkAsFolder(metadata);

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

                //Для каждого ключа из конфига
                for (const key of this.options.tree.reference_keys) {
                        if (!(key in metadata.frontmatter)) {
                                continue;
                        }

                        //Получаем значение ключа из yml
                        let rawValue = metadata.frontmatter[key];
                        //Приводим к массиву
                        if (typeof rawValue === 'string') {
                                rawValue = [rawValue];
                        }

                        //todo extractFromFrontmatterValue is able to extract multiple references from one string, maybe use it?
                        if (Array.isArray(rawValue)) {
                                for (const value of rawValue) {
                                        //Для каждого элемента (потенциальной ссылки) проверяем, что это строка
                                        if (typeof value != 'string') {
                                                this.warnOnce(`${this.LOG_KEY_PREFIX_INVALID_THROTTLE}:${path}:${key}`,
                                                         `Ignoring malformed frontmatter value for file: ${path}, key: ${key}`);
                                                continue;
                                        }

                                        //Получаем реальные пути (или phantoms) из потенциальной ссылки 
                                        const resolved = this.extractFromFrontmatterValue(value, path);
                                        //Если нет путей, то пропускаем
                                        if (resolved.size === 0) {
                                                this.warnOnce(`${this.LOG_KEY_PREFIX_INVALID_THROTTLE}:${path}:${key}`,
                                                                `There is no any link in frontmatter value for file: ${path}, key: ${key}`);
                                                continue;
                                        } 
                        
                                        //Добавляем все найденные пути в родительские
                                        resolved.forEach((resolvedPath) => { parents.add(resolvedPath);});
                                        continue;

                                }
                                continue;
                        }

                        this.warnOnce(`${this.LOG_KEY_PREFIX_INVALID_THROTTLE}:${path}:${key}`,
                                 `Ignoring malformed frontmatter value for file: ${path}, key: ${key}`);
                }

                return parents;
        }

        private extractFromFrontmatterValue(
                rawValue: string,
                sourceFilePath: string,
        ): Set<string> {
                const resolvedPaths = new Set<string>();

                const linkTargets = this.getLinkTargets(rawValue);
                if (linkTargets.length === 0) {
                        return resolvedPaths;
                }

                for (const target of linkTargets) {
                        const resolved = this.options.metadataCache.getFirstLinkpathDest(target, sourceFilePath);
                        if (resolved) {
                                resolvedPaths.add(resolved.path);
                                continue;
                        }

                        resolvedPaths.add(this.createPhantomPath(target));
                }

                return resolvedPaths;
        }

        private shouldMarkAsFolder(metadata: CachedMetadata): boolean {
                const target = new Set(
                        this.options.tree.branch_tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
                );
                if (target.size === 0) {
                        return false;
                }

                const tags = getAllTags(metadata);
                if (!tags || tags.length === 0) {
                        return false;
                }

                for (const tag of tags) {
                        if (target.has(tag)) {
                                return true;
                        }
                }

                return false;
        }

        private hasReferenceKeys(metadata: CachedMetadata | null): boolean {
                if (!metadata?.frontmatter || this.options.tree.reference_keys.length === 0) {
                        return false;
                }

                if (this.options.tree.reference_keys.length === 0) {
                        return false;
                }

                for (const key of this.options.tree.reference_keys) {
                        if (key in metadata.frontmatter) {
                                return true;
                        }
                }

                return false;
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

        private warnOnce(key: string, message: string): void {
                if (this.loggedWarnings.has(key)) {
                        return;
                }
                this.loggedWarnings.add(key);
                this.options.notifier.warn(message);
                this.logger.warn(message);
        }
}
