import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, TreeBuilderSettings, TreePref } from './settings';
import { TreeBuilderSettingTab } from './settings-tab';
import { Notifier, ConsoleLogger, snapshot } from './utils';
import { GraphOrchestrator } from './graph-orchestrator';
import { EventRegistrar } from './event-handlers';

export default class TreeBuilderPlugin extends Plugin {
	readonly notifier: Notifier = Notifier.create(TreeBuilderPlugin);
	private readonly logger = ConsoleLogger.create(TreeBuilderPlugin);

	settings: TreeBuilderSettings = DEFAULT_SETTINGS;


	async onload() {
		await this.loadSettings();
		this.addSettingTab(new TreeBuilderSettingTab(this.app, this));
		this.exposeConsoleHelpers();
		this.init();
	}

	init(): void {
			const orchestrator = new GraphOrchestrator(
					this.app.vault,
					this.app.metadataCache,
					this.settings,
					this.notifier,
			);
			const registrar = new EventRegistrar(this, orchestrator, this.notifier);

			this.logger.info(`Start bootstrapping graphs.`);
			try {
				orchestrator.bootstrap();
				this.logger.info(`Graphs bootstrapped.`);
			} catch (error) {
				let message = `Failed to bootstrap graphs: `;
				this.logger.error(message, error);
				this.notifier.error(message + snapshot(error));
			}
	
			this.app.workspace.onLayoutReady(() => {
					this.logger.info(`Workspace layout ready.`);
					registrar.register();
					this.logger.info(`Event handlers registered.`);
	
					this.register(() => orchestrator.drain());
					this.logger.info(`Graph drain registered.`);
			});
	}


	async loadSettings() {
		const storedData = await this.loadData();
		const merged: TreeBuilderSettings = {
			...DEFAULT_SETTINGS,
			...((storedData as Partial<TreeBuilderSettings>) ?? {}),
		};
		this.settings = {
			trees_to_build: Array.isArray(merged.trees_to_build)
				? merged.trees_to_build.map((tree) => this.normalizeTree(tree))
				: [],
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private printSettingsToConsole() {
		console.log(
			'[TreeBuilderPlugin] Current settings:',
			JSON.stringify(this.settings, null, 2),
		);
		new Notice('Tree builder settings logged to console.');
	}

	private normalizeTree(tree: Partial<TreePref> | undefined): TreePref {
		const toStringList = (input: unknown): string[] => {
			if (!Array.isArray(input)) {
				return [];
			}

			return input
				.map((value) => (typeof value === 'string' ? value.trim() : `${value ?? ''}`.trim()))
				.filter((value) => value.length > 0);
		};

		return {
			tree_name: typeof tree?.tree_name === 'string' ? tree.tree_name : '',
			reference_keys: toStringList(tree?.reference_keys),
			branch_tags: toStringList(tree?.branch_tags),
			folders_to_scan: toStringList(tree?.folders_to_scan),
		};
	}

	private exposeConsoleHelpers() {
		const globalWindow = window as typeof window & {
			treeBuilderPluginDebug?: {
				printSettings: () => void;
				getSettings: () => TreeBuilderSettings;
			};
		};

		const api = {
			printSettings: () => this.printSettingsToConsole(),
			getSettings: () => JSON.parse(JSON.stringify(this.settings)),
		};

		globalWindow.treeBuilderPluginDebug = api;
		this.register(() => {
			if (globalWindow.treeBuilderPluginDebug === api) {
				delete globalWindow.treeBuilderPluginDebug;
			}
		});
	}
}
