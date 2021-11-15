import * as path from 'path';
import * as vscode from 'vscode';

export class Colors {
	pull(): number {
		for (let i = 0 ; i < this.colors.length ; ++i) {
			if (this.colors[i]) {
				this.colors[i] = false;
				return i;
			}
		}
		return -1;
	}

	push(i : number) {
		if (i >= 0 && i < this.colors.length)
			this.colors[i] = true;
	}

	reset() {
		this.colors = Array(12).fill(true);
	}

	private colors: boolean[] = Array(12).fill(true);
}

export class GraphicalWatchVariable extends vscode.TreeItem {
	constructor(name: string, color: number) {
		super(name, vscode.TreeItemCollapsibleState.None);
		this.description = '';
		this.tooltip = '';
		this.contextValue = 'watchVariable';

		this.color = color;
		const colorStr = 'color' + (color >= 0 ? color.toString() : '') + '.svg';
		this.iconPath = {
			light: path.join(__filename, '..', '..', 'resources', 'light', colorStr),
			dark: path.join(__filename, '..', '..', 'resources', 'dark', colorStr)
		};
	}

	get name(): string { return this.label as string; }
	set name(n : string) { this.label = n; }
	get type(): string { return this.description as string; }
	set type(t : string) { this.description = t; this.tooltip = t; }
	readonly color: number = -1;
}

type TreeDataEventParameter = GraphicalWatchVariable | undefined | null | void;

export enum GraphicalWatchEventType { Add, Edit, Remove, RemoveAll };

export class GraphicalWatchEventData {
	constructor(
		readonly eventType: GraphicalWatchEventType,
		readonly variable?: GraphicalWatchVariable
	) {}
}

export class GraphicalWatchProvider implements vscode.TreeDataProvider<GraphicalWatchVariable> {
	constructor() { }
	
	private _onDidChangeTreeData: vscode.EventEmitter<TreeDataEventParameter> = new vscode.EventEmitter<TreeDataEventParameter>();
	readonly onDidChangeTreeData: vscode.Event<TreeDataEventParameter> = this._onDidChangeTreeData.event;

	// These are needed because they work differently than the ones required for the TreeView to properly refresh the view
	private _onChange: vscode.EventEmitter<GraphicalWatchEventData> = new vscode.EventEmitter<GraphicalWatchEventData>();
	readonly onChange: vscode.Event<GraphicalWatchEventData> = this._onChange.event;

	add(): void {
		vscode.window.showInputBox({title: "Add", value: ""}).then((input: string | undefined) => {
			if (input && input != '') {
				const c = this._colors.pull();
				const item = new GraphicalWatchVariable(input, c);
				this._variables.push(item);
				this._onDidChangeTreeData.fire();
				this._onChange.fire(new GraphicalWatchEventData(GraphicalWatchEventType.Add, item));
			}
		});
	}

	edit(item: GraphicalWatchVariable): void {
		vscode.window.showInputBox({title: "Edit", value: item.name}).then((input: string | undefined) => {
			if (input && input != '' && input != item.name) {
				item.name = input;
				this._onDidChangeTreeData.fire(item);
				this._onChange.fire(new GraphicalWatchEventData(GraphicalWatchEventType.Edit, item));
			}
		});
	}

	remove(item: GraphicalWatchVariable): void {
		const i = this._variables.indexOf(item);
		if (i >= 0) {
			let item = this._variables[i];
			this._onChange.fire(new GraphicalWatchEventData(GraphicalWatchEventType.Remove, item));
			this._variables.splice(i, 1);
			this._colors.push(item.color);
			this._onDidChangeTreeData.fire();
		}
	}

	removeAll(): void {
		this._variables = [];
		this._colors.reset();
		this._onDidChangeTreeData.fire();
		this._onChange.fire(new GraphicalWatchEventData(GraphicalWatchEventType.RemoveAll));
	}

	refreshAll() {
		this._onDidChangeTreeData.fire();
	}

	refresh(element: GraphicalWatchVariable) {
		this._onDidChangeTreeData.fire(element);
	}

	getTreeItem(element: GraphicalWatchVariable): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element;
	}

	getChildren(element?: GraphicalWatchVariable): vscode.ProviderResult<GraphicalWatchVariable[]> {
		if (element)
			return Promise.resolve([]);	
		else
			return Promise.resolve(this._variables);
	}

	get variables(): GraphicalWatchVariable[] { return this._variables; }

	private _variables: GraphicalWatchVariable[] = [];
	private _colors: Colors = new Colors();
}

export class GraphicalWatch {
	constructor() {
		this.provider = new GraphicalWatchProvider();
		this.treeView = vscode.window.createTreeView('graphicalWatch', { treeDataProvider: this.provider });
		vscode.commands.registerCommand('graphicalWatch.add', () => this.provider.add());
		vscode.commands.registerCommand('graphicalWatch.removeAll', () => this.provider.removeAll());
		vscode.commands.registerCommand('graphicalWatch.edit', (item: GraphicalWatchVariable) => this.provider.edit(item));
		vscode.commands.registerCommand('graphicalWatch.remove', (item: GraphicalWatchVariable) => this.provider.remove(item));
	}

	refreshAll() { this.provider.refreshAll(); }
	refresh(element: GraphicalWatchVariable) { this.provider.refresh(element); }

	get onChange(): vscode.Event<GraphicalWatchEventData> { return this.provider.onChange; }
	get variables(): GraphicalWatchVariable[] { return this.provider.variables; }

	private provider: GraphicalWatchProvider;
	private treeView: vscode.TreeView<GraphicalWatchVariable>;
}