/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AgentService } from '../core/agentService.js';
import { ModelManager } from '../models/modelManager.js';
import { BrainStore } from '../brain/brainstore.js';
import { TaskManager } from '../tasks/taskManager.js';
import { TaskPlanner } from '../tasks/taskPlanner.js';
import { TaskExecutor } from '../tasks/taskExecutor.js';
import { APIManager } from '../api/apiManager.js';
import { PromptManager } from '../prompts/promptManager.js';
import { MemoryManager } from '../memory/memoryManager.js';
import { IAgentConfiguration } from '../core/agent.js';

export class AgentExtension {
	private agentService: AgentService | undefined;
	private context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
	}

	async activate(): Promise<void> {
		// Initialize core services
		const modelManager = new ModelManager();
		const brainStore = new BrainStore();
		const taskManager = new TaskManager();
		const taskPlanner = new TaskPlanner();
		const taskExecutor = new TaskExecutor();
		const apiManager = new APIManager();
		const promptManager = new PromptManager();
		const memoryManager = new MemoryManager();

		// Create agent service
		this.agentService = new AgentService(
			modelManager,
			brainStore,
			taskManager,
			taskPlanner,
			taskExecutor,
			apiManager,
			promptManager,
			memoryManager
		);

		// Register VSCode commands
		this.registerCommands();

		// Register webview providers
		this.registerWebviews();

		// Setup status bar
		this.setupStatusBar();

		// Setup context menu actions
		this.setupContextMenus();

		vscode.window.showInformationMessage('VSCode AI Agent is now active!');
	}

	private registerCommands(): void {
		const commands = [
			vscode.commands.registerCommand('vscode-agent.createAgent', this.createAgent.bind(this)),
			vscode.commands.registerCommand('vscode-agent.executeTask', this.executeTask.bind(this)),
			vscode.commands.registerCommand('vscode-agent.showAgentPanel', this.showAgentPanel.bind(this)),
			vscode.commands.registerCommand('vscode-agent.configureAgent', this.configureAgent.bind(this)),
			vscode.commands.registerCommand('vscode-agent.viewMemory', this.viewMemory.bind(this)),
			vscode.commands.registerCommand('vscode-agent.managePrompts', this.managePrompts.bind(this)),
			vscode.commands.registerCommand('vscode-agent.connectAPI', this.connectAPI.bind(this)),
			vscode.commands.registerCommand('vscode-agent.trainModel', this.trainModel.bind(this)),
			vscode.commands.registerCommand('vscode-agent.analyzeCodebase', this.analyzeCodebase.bind(this)),
			vscode.commands.registerCommand('vscode-agent.generateTests', this.generateTests.bind(this)),
			vscode.commands.registerCommand('vscode-agent.optimizeCode', this.optimizeCode.bind(this)),
			vscode.commands.registerCommand('vscode-agent.reviewCode', this.reviewCode.bind(this)),
			vscode.commands.registerCommand('vscode-agent.debugCode', this.debugCode.bind(this)),
			vscode.commands.registerCommand('vscode-agent.deployApplication', this.deployApplication.bind(this))
		];

		this.context.subscriptions.push(...commands);
	}

	private registerWebviews(): void {
		const provider = new AgentPanelProvider(this.context.extensionUri, this.agentService!);
		this.context.subscriptions.push(
			vscode.window.registerWebviewViewProvider('vscode-agent.panel', provider)
		);
	}

	private setupStatusBar(): void {
		const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		statusBarItem.command = 'vscode-agent.showAgentPanel';
		statusBarItem.text = '$(robot) Agent';
		statusBarItem.tooltip = 'VSCode AI Agent - Click to open agent panel';
		statusBarItem.show();

		this.context.subscriptions.push(statusBarItem);
	}

	private setupContextMenus(): void {
		// Register context menu for files
		const fileMenu = vscode.commands.registerCommand('vscode-agent.analyzeFile', async (uri: vscode.Uri) => {
			await this.analyzeFile(uri);
		});

		// Register context menu for code selection
		const selectionMenu = vscode.commands.registerCommand('vscode-agent.explainCode', async () => {
			await this.explainSelection();
		});

		this.context.subscriptions.push(fileMenu, selectionMenu);
	}

	private async createAgent(): Promise<void> {
		const config: IAgentConfiguration = {
			model: 'microsoft/DialoGPT-medium', // Default Hugging Face model
			temperature: 0.7,
			maxTokens: 1024,
			systemPrompt: 'You are an AI coding assistant integrated into VSCode.',
			tools: ['file_operations', 'terminal', 'search'],
			apis: [],
			memory: {
				enabled: true,
				type: 'hybrid'
			},
			reasoning: {
				enabled: true,
				strategy: 'planning'
			}
		};

		try {
			const agent = await this.agentService!.createAgent(config);
			vscode.window.showInformationMessage(`Agent created: ${agent.id}`);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to create agent: ${error}`);
		}
	}

	private async executeTask(): Promise<void> {
		const taskDescription = await vscode.window.showInputBox({
			prompt: 'Enter task description',
			placeHolder: 'e.g., Create a React component for user authentication'
		});

		if (!taskDescription) {
			return;
		}

		const agents = this.agentService!.agents;
		if (agents.length === 0) {
			vscode.window.showErrorMessage('No agents available. Create an agent first.');
			return;
		}

		const agentId = agents[0].id; // Use first available agent
		const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
		const activeEditor = vscode.window.activeTextEditor;

		if (!workspace) {
			vscode.window.showErrorMessage('No workspace open');
			return;
		}

		try {
			const result = await this.agentService!.executeTask(agentId, taskDescription, {
				workspace,
				activeEditor: activeEditor?.document.uri,
				selection: activeEditor?.selection ? activeEditor.document.getText(activeEditor.selection) : undefined,
				visibleFiles: vscode.window.visibleTextEditors.map(editor => editor.document.uri),
				activeFiles: vscode.window.visibleTextEditors.map(editor => editor.document.uri)
			});

			vscode.window.showInformationMessage(`Task completed: ${result.output.substring(0, 100)}...`);
		} catch (error) {
			vscode.window.showErrorMessage(`Task execution failed: ${error}`);
		}
	}

	private async showAgentPanel(): Promise<void> {
		const panel = vscode.window.createWebviewPanel(
			'vscode-agent',
			'AI Agent',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				localResourceRoots: [this.context.extensionUri]
			}
		);

		const html = this.getWebviewContent();
		panel.webview.html = html;
	}

	private async configureAgent(): Promise<void> {
		// Open configuration UI
		vscode.commands.executeCommand('workbench.action.openSettings', 'vscode-agent');
	}

	private async viewMemory(): Promise<void> {
		// Open memory viewer
		vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('vscode-agent://memory'));
	}

	private async managePrompts(): Promise<void> {
		// Open prompt manager
		vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('vscode-agent://prompts'));
	}

	private async connectAPI(): Promise<void> {
		// Open API connection manager
		vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('vscode-agent://apis'));
	}

	private async trainModel(): Promise<void> {
		// Open model training interface
		vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('vscode-agent://training'));
	}

	private async analyzeCodebase(): Promise<void> {
		const workspace = vscode.workspace.workspaceFolders?.[0];
		if (!workspace) {
			vscode.window.showErrorMessage('No workspace open');
			return;
		}

		await this.executeTask('Analyze the entire codebase structure, identify patterns, and provide insights about the architecture');
	}

	private async generateTests(): Promise<void> {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			vscode.window.showErrorMessage('No active editor');
			return;
		}

		const fileName = activeEditor.document.fileName;
		await this.executeTask(`Generate comprehensive unit tests for the file: ${fileName}`);
	}

	private async optimizeCode(): Promise<void> {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			vscode.window.showErrorMessage('No active editor');
			return;
		}

		await this.executeTask('Optimize the selected code for performance, readability, and maintainability');
	}

	private async reviewCode(): Promise<void> {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			vscode.window.showErrorMessage('No active editor');
			return;
		}

		await this.executeTask('Review the code for bugs, security issues, and best practices');
	}

	private async debugCode(): Promise<void> {
		await this.executeTask('Debug the current application and identify issues');
	}

	private async deployApplication(): Promise<void> {
		await this.executeTask('Deploy the application to production environment');
	}

	private async analyzeFile(uri: vscode.Uri): Promise<void> {
		const content = await vscode.workspace.fs.readFile(uri);
		const text = Buffer.from(content).toString('utf8');

		await this.executeTask(`Analyze the file: ${uri.fsPath}\n\nContent:\n${text.substring(0, 2000)}`);
	}

	private async explainSelection(): Promise<void> {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor || !activeEditor.selection) {
			vscode.window.showErrorMessage('No code selected');
			return;
		}

		const selectedText = activeEditor.document.getText(activeEditor.selection);
		await this.executeTask(`Explain what this code does:\n\n${selectedText}`);
	}

	private getWebviewContent(): string {
		return `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="UTF-8">
				<title>VSCode AI Agent</title>
				<style>
					body { font-family: Arial, sans-serif; padding: 20px; }
					.agent-panel { display: flex; flex-direction: column; height: 100vh; }
					.header { background: #007acc; color: white; padding: 10px; }
					.content { flex: 1; padding: 10px; }
					.footer { padding: 10px; border-top: 1px solid #ccc; }
				</style>
			</head>
			<body>
				<div class="agent-panel">
					<div class="header">
						<h2>🤖 VSCode AI Agent</h2>
					</div>
					<div class="content">
						<p>Welcome to the VSCode AI Agent! This is a world-class coding agent powered by:</p>
						<ul>
							<li>🤗 Hugging Face Transformers</li>
							<li>🦙 Ollama Local Models</li>
							<li>🧠 GraphRAG Knowledge Base</li>
							<li>⚡ Vercel AI Framework</li>
							<li>🔗 LangChain Integration</li>
						</ul>
						<p>Use the command palette (Ctrl+Shift+P) to access agent features:</p>
						<ul>
							<li><code>vscode-agent.createAgent</code> - Create a new AI agent</li>
							<li><code>vscode-agent.executeTask</code> - Execute a coding task</li>
							<li><code>vscode-agent.analyzeCodebase</code> - Analyze entire codebase</li>
							<li><code>vscode-agent.generateTests</code> - Generate unit tests</li>
							<li><code>vscode-agent.optimizeCode</code> - Optimize code performance</li>
						</ul>
					</div>
					<div class="footer">
						<p>Ready to supercharge your coding workflow!</p>
					</div>
				</div>
			</body>
			</html>
		`;
	}
}

class AgentPanelProvider implements vscode.WebviewViewProvider {
	constructor(
		private extensionUri: vscode.Uri,
		private agentService: AgentService
	) { }

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};

		webviewView.webview.html = this.getWebviewContent();

		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.command) {
				case 'executeTask':
					try {
						const result = await this.agentService.executeTask(
							message.agentId,
							message.task,
							message.context
						);
						webviewView.webview.postMessage({
							command: 'taskResult',
							result: result
						});
					} catch (error) {
						webviewView.webview.postMessage({
							command: 'taskError',
							error: error
						});
					}
					break;
			}
		});
	}

	private getWebviewContent(): string {
		return `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="UTF-8">
				<title>Agent Panel</title>
				<style>
					body { font-family: var(--vscode-font-family); padding: 10px; }
					.task-input { width: 100%; margin: 10px 0; }
					button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 10px; }
				</style>
			</head>
			<body>
				<h3>Execute Task</h3>
				<textarea class="task-input" id="taskInput" placeholder="Describe what you want the agent to do..."></textarea>
				<button onclick="executeTask()">Execute</button>
				<div id="result"></div>

				<script>
					const vscode = acquireVsCodeApi();

					function executeTask() {
						const task = document.getElementById('taskInput').value;
						if (task.trim()) {
							vscode.postMessage({
								command: 'executeTask',
								task: task,
								agentId: 'default',
								context: {}
							});
						}
					}

					window.addEventListener('message', event => {
						const message = event.data;
						const resultDiv = document.getElementById('result');

						switch (message.command) {
							case 'taskResult':
								resultDiv.innerHTML = '<pre>' + JSON.stringify(message.result, null, 2) + '</pre>';
								break;
							case 'taskError':
								resultDiv.innerHTML = '<p style="color: red;">Error: ' + message.error + '</p>';
								break;
						}
					});
				</script>
			</body>
			</html>
		`;
	}
}
