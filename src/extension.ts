// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import TerminalTool from './tools/terminal';
import replaceTextInFile from './tools/file_interaction';
import { SuperdocsAgent } from './agent/agent';

// import {saveChanges, showChanges, revertChanges} from './tools/change_demo';
import { ChildProcessWithoutNullStreams } from 'child_process';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "superdocs" is now active!');

	const provider = new WebviewViewProvider(context.extensionUri, context);

	context.subscriptions.push(vscode.window.registerWebviewViewProvider(WebviewViewProvider.viewType, provider, {
		webviewOptions: {
			retainContextWhenHidden: true
		}
	}));

}

// This method is called when your extension is deactivated
export function deactivate() {}

class WebviewViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'vscode-chat.chatView';
	private _view?: vscode.WebviewView;
	private snippets?: any[];
	private agent?: SuperdocsAgent;
	private terminalTool?: TerminalTool;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _context: vscode.ExtensionContext
	) {
		this.snippets = [];
		this.terminalTool = new TerminalTool();
	 }

	public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
		console.log("Running resolveWebviewView");

		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			],
			
		}

		webviewView.webview.html = this._getHtmlForWebview(this._context);

		const apiKey = vscode.workspace.getConfiguration('vscode-chat').get("OPENAI_KEY")?.toString();
		if(!apiKey || apiKey.length == 0){
			vscode.window.showErrorMessage("Please set an API Key.");
			return;
		}

		this.agent = new SuperdocsAgent(webviewView.webview, apiKey!);

		webviewView.webview.onDidReceiveMessage(data => {
			console.log("Received message from frontend: ", data);
			if(data.type == "replaceSnippet"){
				replaceTextInFile(data.content.originalCode, data.content.newCode, data.content.filepath);
			} else if (data.type === "saveCurrent") {
				// saveChanges();
			} else if (data.type === "viewChanges") {
				// showChanges();
			} else if (data.type === "revertChanges") {
				// revertChanges();
			} else if (data.type === "response") {
				this.agent?.processResponse(data.content);
			} else if (data.type === "reset"){
				this.agent?.resetConversation();
			} else if (data.type === "deleteSnippet") {
				this.snippets?.splice(data.content.index, 1);
				webviewView.webview.postMessage({
					type: "snippets",
					content: this.snippets
				})
			} else if (data.type === "setSnippetsToPast"){
				for(var i = 0; i < this.snippets!.length; i++){
					this.snippets![i].isCurrent = false;
				}
				webviewView.webview.postMessage({
					type: "snippets",
					content: this.snippets
				})
			} else if (data.type === "initiateChat"){
				this.agent?.sendMessage(data.content);
			} else if  (data.type == "stopExecution") {
				this.agent?.stopGeneration();
			}
		});

		let addSnippet = vscode.commands.registerCommand("vscode-chat.addSnippet", () => {
			console.log("Selecting text");
			const selection = vscode.window.activeTextEditor?.selection;
			const selectedText = vscode.window.activeTextEditor?.document.getText(selection);
			const language = vscode.window.activeTextEditor?.document.languageId;
			const filepath = vscode.window.activeTextEditor?.document.uri.path;
			const relativeFilepath = path.relative(vscode.workspace.workspaceFolders![0].uri.path, filepath!);

			this.snippets?.push({
				code: selectedText,
				language: language,
				filepath: relativeFilepath,
				isCurrent: true
			});
			
			webviewView.webview.postMessage({
				type: "snippets",
				content: this.snippets
			});
		});

		let addTerminal = vscode.commands.registerCommand("vscode-chat.addTerminal", () => {
			console.log("Adding terminal content");
			let content = this.terminalTool?.getTerminalContent();

			this.snippets?.push({
				code: content,
				language: "terminal",
				filepath: "User terminal output"
			})

			webviewView.webview.postMessage({
				type: "snippet",
				content: this.snippets
			})
		});

		this._context.subscriptions.push(addTerminal);
		this._context.subscriptions.push(addSnippet);
	}

	private _getHtmlForWebview(context: vscode.ExtensionContext){
		const jsFile = "vscode.js";
		const cssFile = "vscode.css";
		const localServerUrl = "http://localhost:3000";
	
		let scriptUrl = "";
		let cssUrl = "";
	
		const isProduction = context.extensionMode === vscode.ExtensionMode.Production;
		if (isProduction) {
			scriptUrl = this._view?.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'webview', 'build', jsFile))).toString()!;
			cssUrl = this._view?.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'webview', 'build', cssFile))).toString()!;
		} else {
			scriptUrl = `${localServerUrl}/${jsFile}`; 
		}
	
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			${isProduction ? `<link href="${cssUrl}" rel="stylesheet">` : ''}
		</head>
		<body>
			<div id="root"></div>
	
			<script src="${scriptUrl}" />
		</body>
		</html>`;
	}
}