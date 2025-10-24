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
export function registerEventHandlers(plugin: Plugin): void {
	plugin.app.workspace.onLayoutReady(() => {

		registerVaultEvents(plugin.app.vault, plugin);
		registerMetadataCacheEvents(plugin.app.metadataCache, plugin);
		console.log(`${PLUGIN_PREFIX} Workspace layout ready.`);
	});
}

function registerVaultEvents(vault: Vault, plugin: Plugin): void {
	const registrations: EventRef[] = [
		vault.on('create', (file) => logFileEvent('File created', file)),
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
