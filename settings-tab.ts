import { App, PluginSettingTab, Setting } from 'obsidian';
import type TreeBuilderPlugin from './main';
import { TreePref } from './settings';

export class TreeBuilderSettingTab extends PluginSettingTab {
	private readonly arrayDelimiterHint =
		'Use commas or new lines to separate values.';

	constructor(app: App, private plugin: TreeBuilderPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Tree builder settings' });

		if (!this.plugin.settings.trees_to_build.length) {
			containerEl.createEl('p', {
				text: 'No tree configurations yet. Add one to start building trees.',
				cls: 'setting-item-description',
			});
		}

		this.plugin.settings.trees_to_build.forEach((tree, index) => {
			this.renderTreeConfiguration(containerEl, tree, index);
		});

		const addSetting = new Setting(containerEl)
			.setName('Trees to build')
			.setDesc('Manage the list of trees that the plugin will generate.');

		addSetting.addButton((button) => {
			button
				.setButtonText('Add tree')
				.setTooltip('Create a new tree configuration')
				.setCta()
				.onClick(() => this.addTree());
		});
	}

	private renderTreeConfiguration(parent: HTMLElement, tree: TreePref, index: number) {
		const section = parent.createDiv({ cls: 'tree-builder-section' });

		new Setting(section)
			.setName(`Tree ${index + 1}`)
			.setDesc('Configure how this tree is built.')
			.addExtraButton((btn) =>
				btn
					.setIcon('trash')
					.setTooltip('Remove this tree')
					.onClick(() => this.removeTree(index)));

		new Setting(section)
			.setName('Tree name')
			.setDesc('Unique identifier for the generated tree.')
			.addText((text) => {
				text
					.setPlaceholder('e.g. Project overview')
					.setValue(tree.tree_name)
					.onChange(async (value) => {
						tree.tree_name = value.trim();
						await this.plugin.saveSettings();
					});
			});

		this.renderArraySetting(section, {
			label: 'Reference keys',
			description: 'Frontmatter keys that act as references.',
			value: tree.reference_keys,
			onChange: (values) => {
				tree.reference_keys = values;
			},
		});

		this.renderArraySetting(section, {
			label: 'Branch tags',
			description: 'Tags that should create branches.',
			value: tree.branch_tags,
			onChange: (values) => {
				tree.branch_tags = values;
			},
		});

		this.renderArraySetting(section, {
			label: 'Folders to scan',
			description: 'Vault folders that will be inspected for tree nodes.',
			value: tree.folders_to_scan,
			onChange: (values) => {
				tree.folders_to_scan = values;
			},
		});
	}

	private renderArraySetting(
		parent: HTMLElement,
		options: {
			label: string;
			description: string;
			value: string[];
			onChange: (values: string[]) => void;
		},
	) {
		new Setting(parent)
			.setName(options.label)
			.setDesc(`${options.description} ${this.arrayDelimiterHint}`)
			.addTextArea((textArea) => {
				textArea
					.setPlaceholder('value-1, value-2, value-3')
					.setValue(options.value.join(', '))
					.onChange(async (value) => {
						options.onChange(this.parseList(value));
						await this.plugin.saveSettings();
					});

				textArea.inputEl.cols = 40;
				textArea.inputEl.rows = 3;
			});
	}

	private async addTree() {
		this.plugin.settings.trees_to_build.push(this.createEmptyTree());
		await this.plugin.saveSettings();
		this.display();
	}

	private async removeTree(index: number) {
		this.plugin.settings.trees_to_build.splice(index, 1);
		await this.plugin.saveSettings();
		this.display();
	}

	private createEmptyTree(): TreePref {
		return {
			tree_name: '',
			reference_keys: [],
			branch_tags: [],
			folders_to_scan: [],
		};
	}

	private parseList(value: string): string[] {
		return value
			.split(/[\n,]/)
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
	}
}
