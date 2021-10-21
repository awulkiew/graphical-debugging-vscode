import * as vscode from 'vscode';
import { GraphicalWatch, GraphicalWatchEventData, GraphicalWatchEventType, GraphicalWatchVariable } from './graphicalwatch';
import { Debugger, Endianness } from './debugger';
import { Webview } from './webview';
import * as load from './loader'
import * as draw from './drawable'
import * as colors from './colors.json'


async function handleVariable(dbg: Debugger, gwVariable: GraphicalWatchVariable) {
	gwVariable.description = 'not available';
	const expr = await dbg.evaluate(gwVariable.name);
	if (expr && expr.type) {
		const type: string = expr.type;
		gwVariable.description = type;
		const variable: load.Variable = new load.Variable(gwVariable.name, type);
		const loader = await load.getLoader(dbg, variable);
		if (loader instanceof load.Loader) {
			const drawable = await loader.load(dbg, variable);
			if (drawable) {
				const themeColors = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? colors.light : colors.dark;
				const colorStr = gwVariable.color >= 0 ? themeColors.colors[gwVariable.color] : themeColors.color;
				return drawable.toPlotly(colorStr);
			}
		}
	}
	return {};
}

let messageData = {
	color: '#888',
	gridcolor: '#888',
	activecolor: '#888',
	traces: [] as any
};

function setMessageColors(colorTheme: vscode.ColorTheme, messageData: any) {
	if (colorTheme.kind === vscode.ColorThemeKind.Light) {
		messageData.color = '#111';
		messageData.gridcolor = '#777';
		messageData.activecolor = '#aaa';
	} else { // Dark or HighContrast
		messageData.color = '#eee';
		messageData.gridcolor = '#888';
		messageData.activecolor = '#bbb';
	}
}


export function activate(context: vscode.ExtensionContext) {
	
	const debugHelper: Debugger = new Debugger(context);
	const graphicalWatch: GraphicalWatch = new GraphicalWatch();
	const webview: Webview = new Webview(context);

	// TODO: get variables asynchroniously?
	
	debugHelper.onStopped(async () => {
		const language = debugHelper.language();
		const machineInfo = await debugHelper.machineInfo();
		if (language)
			console.log(language);
		if (machineInfo) {
			console.log('pointer size: ' + machineInfo.pointerSize.toString());
			console.log(machineInfo.endianness === Endianness.Little ? 'little endian' : 'big endian');
		}

		messageData.traces = [];
		for (let variable of graphicalWatch.variables) {
			messageData.traces.push(await handleVariable(debugHelper, variable));
		}
		graphicalWatch.refreshAll();

		if (messageData.traces.length > 0) {
			setMessageColors(vscode.window.activeColorTheme, messageData);
			webview.showAndPostMessage(messageData);
		}

		// let expr2 = await debugHelper.evaluate("&arrd[0]");
		// if (expr2 && expr2.memoryReference) {
		// 	let buffer = await debugHelper.readMemoryBuffer(expr2.memoryReference, 0, 10240);
		// 	if (buffer) {
		// 		let bufferLength = buffer.length;
		// 		let a = buffer.readDoubleLE(0);
		// 		let b = buffer.readDoubleLE(8);
		// 		let c = buffer.readDoubleLE(16);
		// 		let d = buffer.readDoubleLE(24);
		// 	}
		// }
	});

	// TODO: cancel processing of variables
	debugHelper.onUnavailable(() => {
		for (let variable of graphicalWatch.variables) {
			variable.description = 'not available';
		}
		graphicalWatch.refreshAll();
	});

	graphicalWatch.onChange(async (e: GraphicalWatchEventData) => {
		if (e.eventType === GraphicalWatchEventType.Add
			|| e.eventType === GraphicalWatchEventType.Edit) {
			if (e.variable) {
				if (debugHelper.isStopped()) {
					const d = await handleVariable(debugHelper, e.variable);
					if (e.eventType === GraphicalWatchEventType.Add)
						messageData.traces.push(d);
					else {
						const i = graphicalWatch.variables.indexOf(e.variable);
						if (i >= 0 && i < messageData.traces.length)
							messageData.traces[i] = d;
					}
					setMessageColors(vscode.window.activeColorTheme, messageData);
					webview.showAndPostMessage(messageData);
				} else {
					e.variable.description = 'not available';
				}
				graphicalWatch.refresh(e.variable);
			}
		} else if (e.eventType === GraphicalWatchEventType.Remove) {
			if (e.variable) {
				const i = graphicalWatch.variables.indexOf(e.variable);
				if (i >= 0 && i < messageData.traces.length) {
					messageData.traces.splice(i, 1);
					if (messageData.traces.length > 0) {
						webview.showAndPostMessage(messageData);
					} else {
						webview.hide();
					}
				}
			}
		} else if (e.eventType === GraphicalWatchEventType.RemoveAll) {
			messageData.traces = [];
			webview.hide();
		}
	});

	vscode.window.onDidChangeActiveColorTheme((e: vscode.ColorTheme) => {
		setMessageColors(e, messageData);
		const themeColors = e.kind === vscode.ColorThemeKind.Light ? colors.light : colors.dark;		
		// TODO: This only works for Plots
		for (let i = 0; i < graphicalWatch.variables.length; ++i) {
			let variable = graphicalWatch.variables[i];
			const colorStr = variable.color >= 0 ? themeColors.colors[variable.color] : themeColors.color;
			messageData.traces[i].line = { color: colorStr };
		}
		webview.postMessage(messageData);
	});

	console.log('Congratulations, your extension is now active!');
}

export function deactivate() {

}

