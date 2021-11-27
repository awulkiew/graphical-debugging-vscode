import * as vscode from 'vscode';
import { GraphicalWatch, GraphicalWatchEventData, GraphicalWatchEventType, GraphicalWatchVariable } from './graphicalwatch';
import { Debugger, Endianness } from './debugger';
import { Webview } from './webview';
import * as load from './loader'
import * as draw from './drawable'
import * as colors from './colors.json'


async function handleVariable(dbg: Debugger, gwVariable: GraphicalWatchVariable): Promise<draw.PlotlyData> {
	gwVariable.type = 'not available';
	const expr = await dbg.evaluate(gwVariable.name);
	if (expr && expr.type) {
		const type: string = expr.type;
		gwVariable.type = type;
		const variable: load.Variable = new load.Variable(gwVariable.name, type);
		const loader = await load.getLoader(dbg, variable);
		if (loader instanceof load.Loader) {
			const drawable = await loader.load(dbg, variable);
			if (drawable) {
				return drawable.toPlotly(gwVariable.color);
			}
		}
	}
	return draw.PlotlyData.empty(gwVariable.color);
}

function systemName(system: draw.System): string {
	switch(system) {
		case draw.System.Cartesian: return 'cartesian';
		case draw.System.Complex: return 'complex';
		case draw.System.Geographic: return 'geographic';
		default: return '';
	}
}

function createMessagePlot(message: any, system: draw.System): number {
	const systemStr = systemName(system);
	for (let i = 0; i < message.plots.length ; ++i)
		if (message.plots[i].system === systemStr)
			return i;
	message.plots.push({
		system: systemStr,
		traces: [] as any
	});
	return message.plots.length - 1;
}

let drawableData: draw.PlotlyData[] = [];

function prepareMessage(potlyData: draw.PlotlyData[], colorTheme: vscode.ColorTheme): any {
	let message = {
		color: '#888',
		gridcolor: '#888',
		activecolor: '#888',
		plots: [] as any
	};
	if (colorTheme.kind === vscode.ColorThemeKind.Light) {
		message.color = '#555';
		message.gridcolor = '#aaa';
		message.activecolor = '#aaa';
	} else { // Dark or HighContrast
		message.color = '#aaa';
		message.gridcolor = '#555';
		message.activecolor = '#bbb';
	}
	const themeColors = colorTheme.kind === vscode.ColorThemeKind.Light ? colors.light : colors.dark;
	for (let d of potlyData) {
		const colorStr = d.colorId >= 0 ? themeColors.colors[d.colorId] : themeColors.color;
		const plotId = createMessagePlot(message, d.system);
		for (let trace of d.traces) {
			if (trace.type === "bar")
				trace.marker = {color: colorStr + '88'};
			else
				trace.line = {color: colorStr + 'CC'};
			if (trace.fill !== undefined && trace.fill !== 'none')
				trace.fillcolor = colorStr + '55';
			trace.hoverinfo = d.system === draw.System.Geographic ? "lon+lat" : "x+y";
			message.plots[plotId].traces.push(trace);
		}
	}
	return message;
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

		if (graphicalWatch.variables.length > 0)
			load.types.update(debugHelper);

		drawableData = [];
		for (let variable of graphicalWatch.variables) {
			const d = await handleVariable(debugHelper, variable);
			drawableData.push(d);
		}
		graphicalWatch.refreshAll();

		const message = prepareMessage(drawableData, vscode.window.activeColorTheme);
		if (message.plots.length > 0) {
			webview.showAndPostMessage(message);
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
			variable.type = 'not available';
		}
		graphicalWatch.refreshAll();
	});

	graphicalWatch.onChange(async (e: GraphicalWatchEventData) => {
		if (e.eventType === GraphicalWatchEventType.Add
			|| e.eventType === GraphicalWatchEventType.Edit) {
			if (e.variable) {
				if (debugHelper.isStopped()) {
					load.types.update(debugHelper);
					const d = await handleVariable(debugHelper, e.variable);
					if (e.eventType === GraphicalWatchEventType.Add) {
						drawableData.push(d);
					} else {
						const i = graphicalWatch.variables.indexOf(e.variable);
						if (i >= 0 && i < drawableData.length) {
							drawableData[i] = d;
						}
					}
					const message = prepareMessage(drawableData, vscode.window.activeColorTheme);
					webview.showAndPostMessage(message);
				} else {
					e.variable.type = 'not available';
				}
				graphicalWatch.refresh(e.variable);
			}
		} else if (e.eventType === GraphicalWatchEventType.Remove) {
			if (e.variable) {
				const i = graphicalWatch.variables.indexOf(e.variable);
				if (i >= 0 && i < drawableData.length) {
					drawableData.splice(i, 1);
					if (drawableData.length > 0) {
						const message = prepareMessage(drawableData, vscode.window.activeColorTheme);
						webview.showAndPostMessage(message);
					} else {
						webview.hide();
					}
				}
			}
		} else if (e.eventType === GraphicalWatchEventType.RemoveAll) {
			drawableData = [];
			webview.hide();
		}
	});

	vscode.window.onDidChangeActiveColorTheme((e: vscode.ColorTheme) => {
		const message = prepareMessage(drawableData, e);
		webview.postMessage(message);
	});

	console.log('Congratulations, your extension is now active!');
}

export function deactivate() {

}

