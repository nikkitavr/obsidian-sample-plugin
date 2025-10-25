import { TFile } from 'obsidian';
import type { EventRef, Plugin, TAbstractFile } from 'obsidian';
import { GraphOrchestrator } from './graph-orchestrator';
import { ConsoleLogger, Notifier, snapshot } from 'utils';


export class EventRegistrar {
        private readonly logger = ConsoleLogger.create(EventRegistrar);
        
        constructor(
                private readonly plugin: Plugin,
                private readonly orchestrator: GraphOrchestrator,
                private readonly notifier: Notifier,
        ) {}

        register(): void {
                const { vault, metadataCache } = this.plugin.app;

                const refs: EventRef[] = [
                        vault.on('create', (file) => this.onFileCreated(file)),
                        vault.on('delete', (file) => this.onFileDeleted(file)),
                        vault.on('rename', (file, oldPath) => this.onFileRenamed(file, oldPath)),
                        metadataCache.on('changed', (file) => this.onMetadataChanged(file)),
                ];

                for (const ref of refs) {
                        this.plugin.registerEvent(ref);
                }
        }

        private onFileCreated(file: TAbstractFile): void {
                if (file instanceof TFile) {
                        this.logger.debug(`File created: ${file.path}`);
                        try {
                                this.orchestrator.handleFileCreated(file);
                        } catch (error) {
                                let message = `Failed to handle file created: `;
                                this.logger.error(message, error);
                                this.notifier.error(message + snapshot(error));
                        }
                }
        }

        private onFileDeleted(file: TAbstractFile): void {
                this.logger.debug(`Vault delete: ${file.path}`);
                try {
                        this.orchestrator.handleFileDeleted(file);
                } catch (error) {
                        let message = `Failed to handle file deleted: `;
                        this.logger.error(message, error);
                        this.notifier.error(message + snapshot(error));
                }
        }

        private onFileRenamed(file: TAbstractFile, oldPath: string): void {
                this.logger.debug(`Vault rename: ${oldPath} → ${file.path}`);
                try {
                        this.orchestrator.handleFileRenamed(file, oldPath);
                } catch (error) {
                        let message = `Failed to handle file renamed: `;
                        this.logger.error(message, error);
                        this.notifier.error(message + snapshot(error));
                }
        }

        private onMetadataChanged(file: TAbstractFile | null): void {
                if (file instanceof TFile) {
                        this.logger.debug(`Metadata changed: ${file.path}`);
                        try {
                                this.orchestrator.handleMetadataChanged(file);
                        } catch (error) {
                                let message = `Failed to handle metadata changed: `;
                                this.logger.error(message, error);
                                this.notifier.error(message + snapshot(error));
                        }
                }
        }
}

