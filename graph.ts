export interface Node {
	pathId: string;
	marked_as_folder: boolean;
}

export interface Graph {
	title: string;
	parentToChildIds: Map<String, Set<String>>;
	childToParentIds: Map<String, Set<String>>;
	rootNodesIds: Set<String>;
	nodes: Map<String, Node>;

	addNode(node: Node): void;
	removeNode(nodeId: String): void;
	addEdge(parentId: String, childId: String): void;
	removeEdge(parentId: String, childId: String): void;
}

