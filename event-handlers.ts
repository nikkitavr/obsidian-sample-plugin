import { TFile } from 'obsidian';
import type { EventRef, Plugin, TAbstractFile } from 'obsidian';
import { GraphOrchestrator } from './graph-orchestrator';
import type { Logger } from './graph-builder';
import type { TreeBuilderSettings } from './settings';
import { snapshot } from 'utils';

const PLUGIN_PREFIX = '[TreeBuilderPlugin]';

interface TreeBuilderPlugin extends Plugin {
        settings: TreeBuilderSettings;
}

export function registerEventHandlers(plugin: TreeBuilderPlugin): void {
        const logger = createLogger();
        const orchestrator = new GraphOrchestrator(
                plugin.app.vault,
                plugin.app.metadataCache,
                plugin.settings,
                logger,
        );
        
        const registrar = new EventRegistrar(plugin, orchestrator, logger);
        logger.info(`${PLUGIN_PREFIX} Start bootstrapping graphs.`);
        orchestrator.bootstrap();
        logger.info(`${PLUGIN_PREFIX} Graphs bootstrapped.`);

        plugin.app.workspace.onLayoutReady(() => {
                logger.info(`${PLUGIN_PREFIX} Workspace layout ready.`);
                registrar.register();
                logger.info(`${PLUGIN_PREFIX} Event handlers registered.`);

                plugin.register(() => orchestrator.drain());
                logger.info(`${PLUGIN_PREFIX} Graph drain registered.`);
        });
}

class EventRegistrar {
        constructor(
                private readonly plugin: Plugin,
                private readonly orchestrator: GraphOrchestrator,
                private readonly logger: Logger,
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
                        this.logger.debug(`${PLUGIN_PREFIX} File created: ${file.path}`);
                        this.orchestrator.handleFileCreated(file);
                }
        }

        private onFileDeleted(file: TAbstractFile): void {
                this.logger.debug(`${PLUGIN_PREFIX} Vault delete: ${file.path}`);
                this.orchestrator.handleFileDeleted(file);
        }

        private onFileRenamed(file: TAbstractFile, oldPath: string): void {
                this.logger.debug(`${PLUGIN_PREFIX} Vault rename: ${oldPath} → ${file.path}`);
                this.orchestrator.handleFileRenamed(file, oldPath);
        }

        private onMetadataChanged(file: TAbstractFile | null): void {
                if (file instanceof TFile) {
                        this.logger.debug(`${PLUGIN_PREFIX} Metadata changed: ${file.path}`);
                        this.orchestrator.handleMetadataChanged(file);
                }
        }
}

type LoggerFn = (...values: unknown[]) => void;

function createLogger(): Logger {
  const wrap = (fn: LoggerFn) => (...values: unknown[]) =>
    fn(...values.map(snapshot));

  return {
        debug: wrap(console.debug),
        info: wrap(console.info),
        warn: wrap(console.warn),
  };
}
