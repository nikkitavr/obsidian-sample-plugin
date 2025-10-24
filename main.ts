import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, TreeBuilderSettings, TreePref } from './settings';
import { TreeBuilderSettingTab } from './settings-tab';
import { registerEventHandlers } from './event-handlers';

export default class TreeBuilderPlugin extends Plugin {
	settings: TreeBuilderSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new TreeBuilderSettingTab(this.app, this));
		this.exposeConsoleHelpers();
		registerEventHandlers(this);
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
