import * as vscode from 'vscode';
import * as path from 'path';

export class Webview {
	constructor(
		private _context: vscode.ExtensionContext
	) {}

	showAndPostMessage(data: any, viewColumn: vscode.ViewColumn = vscode.ViewColumn.Nine) {
		if (this._panel) {
			this._panel.reveal(viewColumn);
			this._panel.webview.postMessage(data);
		} else {
			this._panel = vscode.window.createWebviewPanel(
				'graphicalWatchWebview',
				'Graphical Watch', {
					viewColumn: viewColumn,
				  	preserveFocus: true
				}, {
					enableScripts: true,
					localResourceRoots: [vscode.Uri.file(path.join(this._context.extensionPath, 'resources'))]
				});
			this._panel.onDidDispose(
				() => {
					this._panel = undefined;
				},
				null,
				this._context.subscriptions);
			const plotlyPath = vscode.Uri.file(
				path.join(this._context.extensionPath, 'resources', 'plotly-2.4.2.min.js')
			);
			const plotlySrc = this._panel.webview.asWebviewUri(plotlyPath);
			this._panel.webview.html = this.getWebviewContent(plotlySrc);

			// Wait a while before sending message to newly created window.
			setTimeout(() => {
				this._panel?.webview.postMessage(data);
			}, 1000);
		}
	}

	postMessage(data: any) {
		this._panel?.webview.postMessage(data);
	}

	hide() {
		this._panel?.dispose();
	}

	private getWebviewContent(plotlySrc: vscode.Uri) {
		return `<!DOCTYPE html>
				<html lang="en" style="margin:0;padding:0;height:100%;">
				<head>
					<meta charset="UTF-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<title>Graphical Watch</title>
					<script src="${plotlySrc}"></script>
					<script>
						function getLayout(color, gridcolor, activecolor) {
							return {
								showlegend: false,
								margin: { b:25, l:30, r:15, t:25 },
								paper_bgcolor: '#0000',
								plot_bgcolor: '#0000',
								modebar: {
									bgcolor: '#0000',
									color: gridcolor,
									activecolor: activecolor
								},
								xaxis: {
									color: color,
									gridcolor: gridcolor
								},
								yaxis: {
									color: color,
									gridcolor: gridcolor
								}
							};
						};
						var layout = getLayout('#888', '#888', '#888');
						var config = {
							modeBarButtonsToRemove: ['select', 'lasso', 'resetScale', 'toImage', 'sendDataToCloud'],
							displaylogo: false,
							responsive: true,
							scrollZoom: true
						};
						var traces = [];
					</script>
				</head>
				<body style="margin:0;padding:0;height:100%;">
					<div id="plot" style="margin:0;padding:0;width:100%;height:100%;"></div>
					<script>
						window.addEventListener('message', event => {
							plot = document.getElementById('plot');
							layout = getLayout(event.data.color, event.data.gridcolor, event.data.activecolor);
							traces = event.data.traces;
							Plotly.newPlot(plot, traces, layout, config);
						});
					</script>
				</body>
			</html>`;
	}

	private _panel: vscode.WebviewPanel | undefined = undefined;
}