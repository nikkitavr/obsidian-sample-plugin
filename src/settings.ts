export interface TreePref {
	tree_name: string;
	reference_keys: string[];
	branch_tags: string[];
	folders_to_scan: string[];
}

export interface TreeBuilderSettings {
	trees_to_build: TreePref[];
}

export const DEFAULT_SETTINGS: TreeBuilderSettings = {
	trees_to_build: [],
};
