import { TFile, TFolder } from 'obsidian';
import type {
	CachedMetadata,
	EventRef,
	MetadataCache,
	Plugin,
	TAbstractFile,
	Vault,
	Workspace,
} from 'obsidian';

const PLUGIN_PREFIX = '[TreeBuilderPlugin]';

/**
 * Registers workspace, vault, and metadata events for basic logging.
 * Call from the plugin's `onload` hook.
 */
export function registerEventLogging(plugin: Plugin): void {
	registerWorkspaceEvents(plugin.app.workspace);
	registerVaultEvents(plugin.app.vault, plugin);
	registerMetadataCacheEvents(plugin.app.metadataCache, plugin);
}

function registerWorkspaceEvents(workspace: Workspace): void {
	workspace.onLayoutReady(() => {
		console.log(`${PLUGIN_PREFIX} Workspace layout ready.`);
	});
}

function registerVaultEvents(vault: Vault, plugin: Plugin): void {
	const registrations: EventRef[] = [
		vault.on('create', (file) => logFileEvent('File created', file)),
		vault.on('modify', (file) => logFileEvent('File modified', file)),
		vault.on('delete', (file) => logFileEvent('File deleted', file)),
		vault.on('rename', (file, oldPath) =>
			console.log(`${PLUGIN_PREFIX} File renamed: ${oldPath} → ${file.path}`),
		),
	];

	registrations.forEach((ref) => plugin.registerEvent(ref));
}

function registerMetadataCacheEvents(cache: MetadataCache, plugin: Plugin): void {
	const registrations: EventRef[] = [
		cache.on('changed', (file, _data, metadata) => {
			logMetadataChangedEvent('Metadata changed', file, metadata);
		}),
		cache.on('deleted', (file) => {
			logMetadataEvent('Metadata deleted', file);
		}),
		cache.on('resolve', (file) => {
			logMetadataEvent('Metadata resolve.', file);

		}),
		cache.on('resolved', () => {
			const activeFile = plugin.app.workspace.getActiveFile();
			const context = activeFile ? `Active file: ${activeFile.path}` : 'No active file.';
			console.log(`${PLUGIN_PREFIX} Metadata resolved ${context}`);
		}),
	];

	registrations.forEach((ref) => plugin.registerEvent(ref));
}

function logFileEvent(message: string, file: TAbstractFile): void {
	const type = file instanceof TFolder ? 'folder' : file instanceof TFile ? 'file' : 'item';
	console.log(`${PLUGIN_PREFIX} ${message}: ${file.path} (${type})`);
}

function logMetadataEvent(message: string, file: TFile, metadata?: CachedMetadata | null): void {
	const cacheInfo = metadata ? ` (cache keys: ${Object.keys(metadata).join(', ')})` : '';
	console.log(`${PLUGIN_PREFIX} ${message}: ${file.path}${cacheInfo}`);
}

function logMetadataChangedEvent(message: string, file: TFile, metadata?: CachedMetadata | null): void {
	const cacheInfo = metadata ? ` (cache keys: ${Object.keys(metadata).join(', ')})` : '';
	console.log(`${PLUGIN_PREFIX} ${message}: ${file.path}${cacheInfo}`); 
}
