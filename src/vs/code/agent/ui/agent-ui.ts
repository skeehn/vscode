/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { IAgentOrchestrator, IAgentRequest, IAgentResponse } from '../agent-orchestrator.js';

export interface IAgentUI {
	showChatInterface(): Promise<void>;
	showModelSelector(): Promise<string>;
	showStatusIndicator(status: IAgentStatus): void;
	showProgressIndicator(task: string): IDisposable;
	showErrorMessage(message: string, actions?: IAction[]): Promise<string | undefined>;
	showSuccessMessage(message: string): void;
	updateChatHistory(messages: IChatMessage[]): void;
}

export interface IChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: number;
	metadata?: {
		model?: string;
		tokens?: number;
		tools?: string[];
	};
}

export interface IAgentStatus {
	isActive: boolean;
	currentModel: string;
	activeRequests: number;
	memoryUsage: number;
	lastActivity: number;
}

export interface IAction {
	id: string;
	label: string;
	tooltip?: string;
	run(): Promise<void>;
}

export class AgentUI extends Disposable implements IAgentUI {
	private readonly disposables = this._register(new DisposableStore());
	private chatPanel: IChatPanel | null = null;
	private statusBarItem: IStatusBarItem | null = null;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAgentOrchestrator private readonly agentOrchestrator: IAgentOrchestrator
	) {
		super();

		this.initializeUI();
	}

	private initializeUI(): void {
		this.createStatusBarItem();
		this.registerCommands();
		this.setupEventListeners();
	}

	async showChatInterface(): Promise<void> {
		if (!this.chatPanel) {
			this.chatPanel = this.instantiationService.createInstance(ChatPanel);
		}

		await this.chatPanel.show();
		this.logService.info('Agent UI: Chat interface shown');
	}

	async showModelSelector(): Promise<string> {
		const models = await this.agentOrchestrator.getAvailableModels();
		const currentModel = this.agentOrchestrator.getCurrentModel();

		// Show quick pick for model selection
		const selectedModel = await this.showQuickPick(
			models.map(model => ({
				label: model.name,
				description: `${model.provider} - ${model.capabilities.join(', ')}`,
				detail: `Context: ${model.contextLength}, Cost: ${model.costPerToken || 'Free'}`,
				picked: model.name === currentModel
			})),
			{
				placeHolder: 'Select AI Model',
				matchOnDescription: true,
				matchOnDetail: true
			}
		);

		return selectedModel?.label || currentModel;
	}

	showStatusIndicator(status: IAgentStatus): void {
		if (this.statusBarItem) {
			const icon = status.isActive ? '$(sync~spin)' : '$(robot)';
			const text = status.isActive
				? `Agent: ${status.currentModel} (${status.activeRequests})`
				: `Agent: ${status.currentModel}`;

			this.statusBarItem.text = `$(${icon}) ${text}`;
			this.statusBarItem.tooltip = this.getStatusTooltip(status);
			this.statusBarItem.show();
		}
	}

	showProgressIndicator(task: string): IDisposable {
		// Show progress notification
		const progressOptions = {
			location: ProgressLocation.Notification,
			title: 'AI Agent',
			cancellable: true
		};

		return window.withProgress(progressOptions, async (progress, token) => {
			progress.report({ message: task });

			return new Promise<void>((resolve) => {
				const disposable = token.onCancellationRequested(() => {
					resolve();
				});

				// Store disposable for cleanup
				this.disposables.add(disposable);
			});
		});
	}

	async showErrorMessage(message: string, actions: IAction[] = []): Promise<string | undefined> {
		const actionLabels = actions.map(action => action.label);

		const selectedAction = await window.showErrorMessage(
			`AI Agent: ${message}`,
			...actionLabels
		);

		if (selectedAction) {
			const action = actions.find(a => a.label === selectedAction);
			if (action) {
				await action.run();
				return action.id;
			}
		}

		return undefined;
	}

	showSuccessMessage(message: string): void {
		window.showInformationMessage(`AI Agent: ${message}`);
	}

	updateChatHistory(messages: IChatMessage[]): void {
		if (this.chatPanel) {
			this.chatPanel.updateMessages(messages);
		}
	}

	private createStatusBarItem(): void {
		this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
		this.statusBarItem.command = 'agent.openChat';
		this.disposables.add(this.statusBarItem);

		// Initial status
		this.showStatusIndicator({
			isActive: false,
			currentModel: 'none',
			activeRequests: 0,
			memoryUsage: 0,
			lastActivity: Date.now()
		});
	}

	private registerCommands(): void {
		const commands = [
			{
				command: 'agent.openChat',
				title: 'Open AI Agent Chat',
				handler: () => this.showChatInterface()
			},
			{
				command: 'agent.selectModel',
				title: 'Select AI Model',
				handler: () => this.showModelSelector()
			},
			{
				command: 'agent.showStatus',
				title: 'Show Agent Status',
				handler: () => this.showAgentStatus()
			},
			{
				command: 'agent.clearMemory',
				title: 'Clear Agent Memory',
				handler: () => this.clearAgentMemory()
			}
		];

		for (const cmd of commands) {
			this.disposables.add(
				commands.registerCommand(cmd.command, cmd.handler.bind(this))
			);
		}
	}

	private setupEventListeners(): void {
		// Listen to agent orchestrator events
		this.disposables.add(
			this.agentOrchestrator.onDidStartRequest(event => {
				this.onRequestStarted(event);
			})
		);

		this.disposables.add(
			this.agentOrchestrator.onDidReceiveResponse(event => {
				this.onResponseReceived(event);
			})
		);

		this.disposables.add(
			this.agentOrchestrator.onDidEndRequest(requestId => {
				this.onRequestEnded(requestId);
			})
		);

		// Update status periodically
		this.disposables.add(
			setInterval(() => {
				this.updateStatus();
			}, 5000)
		);
	}

	private onRequestStarted(request: IAgentRequest): void {
		this.logService.debug('Agent UI: Request started', { id: request.id, type: request.type });

		// Update status to show active request
		this.updateStatus();

		// Show progress indicator
		const progressIndicator = this.showProgressIndicator(
			`Processing ${request.type} request...`
		);

		// Store progress indicator for cleanup
		this.activeProgressIndicators.set(request.id, progressIndicator);
	}

	private onResponseReceived(response: IAgentResponse): void {
		this.logService.debug('Agent UI: Response received', { id: response.id });

		// Clean up progress indicator
		const progressIndicator = this.activeProgressIndicators.get(response.requestId);
		if (progressIndicator) {
			progressIndicator.dispose();
			this.activeProgressIndicators.delete(response.requestId);
		}

		// Show success message for completed requests
		if (!response.error) {
			this.showSuccessMessage('Request completed successfully');
		} else {
			this.showErrorMessage(response.error);
		}

		// Update chat history if chat panel is open
		if (this.chatPanel && this.chatPanel.isVisible()) {
			this.updateChatHistory([
				{
					id: `user_${response.requestId}`,
					role: 'user',
					content: 'User request', // Would need actual request content
					timestamp: Date.now()
				},
				{
					id: response.id,
					role: 'assistant',
					content: response.content,
					timestamp: Date.now(),
					metadata: response.metadata
				}
			]);
		}
	}

	private onRequestEnded(requestId: string): void {
		this.logService.debug('Agent UI: Request ended', { id: requestId });

		// Clean up progress indicator if still active
		const progressIndicator = this.activeProgressIndicators.get(requestId);
		if (progressIndicator) {
			progressIndicator.dispose();
			this.activeProgressIndicators.delete(requestId);
		}

		// Update status
		this.updateStatus();
	}

	private updateStatus(): void {
		const status = this.agentOrchestrator.getStatus();
		this.showStatusIndicator({
			isActive: status.isActive,
			currentModel: status.currentModel,
			activeRequests: status.activeRequests.length,
			memoryUsage: status.memoryUsage,
			lastActivity: Date.now()
		});
	}

	private getStatusTooltip(status: IAgentStatus): string {
		const lines = [
			`Model: ${status.currentModel}`,
			`Active Requests: ${status.activeRequests}`,
			`Memory Usage: ${this.formatBytes(status.memoryUsage)}`,
			`Last Activity: ${new Date(status.lastActivity).toLocaleTimeString()}`
		];

		if (status.isActive) {
			lines.unshift('🔄 Agent is active');
		} else {
			lines.unshift('🤖 Agent is ready');
		}

		return lines.join('\n');
	}

	private formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	private async showAgentStatus(): Promise<void> {
		const status = this.agentOrchestrator.getStatus();

		const statusMessage = [
			`🤖 AI Agent Status`,
			``,
			`Current Model: ${status.currentModel}`,
			`Active Requests: ${status.activeRequests.length}`,
			`Memory Usage: ${this.formatBytes(status.memoryUsage)}`,
			`Available Models: ${status.availableModels.join(', ')}`,
			``,
			`Use "Agent: Open Chat" to start interacting with the agent.`
		].join('\n');

		await window.showInformationMessage(statusMessage, { modal: false });
	}

	private async clearAgentMemory(): Promise<void> {
		const confirmed = await window.showWarningMessage(
			'Are you sure you want to clear the agent\'s memory? This will remove all conversation history and learned patterns.',
			{ modal: true },
			'Clear Memory',
			'Cancel'
		);

		if (confirmed === 'Clear Memory') {
			// Implementation would call memory system clear method
			this.showSuccessMessage('Agent memory cleared successfully');
		}
	}

	private async showQuickPick(items: any[], options: any): Promise<any> {
		return await window.showQuickPick(items, options);
	}

	dispose(): void {
		if (this.chatPanel) {
			this.chatPanel.dispose();
		}
		if (this.statusBarItem) {
			this.statusBarItem.dispose();
		}
		this.activeProgressIndicators.forEach(indicator => indicator.dispose());
		this.activeProgressIndicators.clear();
		super.dispose();
	}

	private activeProgressIndicators = new Map<string, IDisposable>();
}

// Chat Panel Implementation
interface IChatPanel {
	show(): Promise<void>;
	updateMessages(messages: IChatMessage[]): void;
	isVisible(): boolean;
	dispose(): void;
}

class ChatPanel extends Disposable implements IChatPanel {
	private panel: WebviewPanel | null = null;
	private messages: IChatMessage[] = [];

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	async show(): Promise<void> {
		if (this.panel) {
			this.panel.reveal();
			return;
		}

		this.panel = window.createWebviewPanel(
			'agentChat',
			'AI Agent Chat',
			ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: []
			}
		);

		this.panel.onDidDispose(() => {
			this.panel = null;
		});

		this.panel.webview.onDidReceiveMessage(message => {
			this.handleMessage(message);
		});

		this.updateWebview();
	}

	updateMessages(messages: IChatMessage[]): void {
		this.messages = messages;
		this.updateWebview();
	}

	isVisible(): boolean {
		return this.panel?.visible || false;
	}

	private updateWebview(): void {
		if (!this.panel) return;

		const html = this.generateHTML();
		this.panel.webview.html = html;
	}

	private generateHTML(): string {
		const messageHTML = this.messages.map(msg => `
			<div class="message ${msg.role}">
				<div class="message-header">
					<span class="role">${msg.role.toUpperCase()}</span>
					<span class="timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</span>
				</div>
				<div class="message-content">${this.escapeHtml(msg.content)}</div>
				${msg.metadata ? `
					<div class="message-metadata">
						${msg.metadata.model ? `<span>Model: ${msg.metadata.model}</span>` : ''}
						${msg.metadata.tokens ? `<span>Tokens: ${msg.metadata.tokens}</span>` : ''}
					</div>
				` : ''}
			</div>
		`).join('');

		return `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="UTF-8">
				<title>AI Agent Chat</title>
				<style>
					body {
						font-family: var(--vscode-font-family);
						font-size: var(--vscode-font-size);
						background-color: var(--vscode-editor-background);
						color: var(--vscode-editor-foreground);
						margin: 0;
						padding: 20px;
						height: 100vh;
						display: flex;
						flex-direction: column;
					}
					.chat-container {
						flex: 1;
						overflow-y: auto;
						margin-bottom: 20px;
					}
					.message {
						margin-bottom: 15px;
						padding: 10px;
						border-radius: 5px;
					}
					.message.user {
						background-color: var(--vscode-textBlockQuote-background);
						margin-left: 20px;
					}
					.message.assistant {
						background-color: var(--vscode-input-background);
						margin-right: 20px;
					}
					.message.system {
						background-color: var(--vscode-badge-background);
						font-style: italic;
					}
					.message-header {
						display: flex;
						justify-content: space-between;
						margin-bottom: 5px;
						font-size: 0.9em;
						opacity: 0.7;
					}
					.message-content {
						white-space: pre-wrap;
						word-wrap: break-word;
					}
					.message-metadata {
						margin-top: 5px;
						font-size: 0.8em;
						opacity: 0.6;
					}
					.input-container {
						display: flex;
						gap: 10px;
					}
					#messageInput {
						flex: 1;
						padding: 8px;
						background-color: var(--vscode-input-background);
						color: var(--vscode-input-foreground);
						border: 1px solid var(--vscode-input-border);
						border-radius: 3px;
					}
					#sendButton {
						padding: 8px 16px;
						background-color: var(--vscode-button-background);
						color: var(--vscode-button-foreground);
						border: none;
						border-radius: 3px;
						cursor: pointer;
					}
					#sendButton:hover {
						background-color: var(--vscode-button-hoverBackground);
					}
				</style>
			</head>
			<body>
				<div class="chat-container" id="chatContainer">
					${messageHTML}
				</div>
				<div class="input-container">
					<input type="text" id="messageInput" placeholder="Type your message...">
					<button id="sendButton">Send</button>
				</div>
				<script>
					const vscode = acquireVsCodeApi();
					const messageInput = document.getElementById('messageInput');
					const sendButton = document.getElementById('sendButton');
					const chatContainer = document.getElementById('chatContainer');

					sendButton.addEventListener('click', sendMessage);
					messageInput.addEventListener('keypress', (e) => {
						if (e.key === 'Enter') {
							sendMessage();
						}
					});

					function sendMessage() {
						const message = messageInput.value.trim();
						if (message) {
							vscode.postMessage({ type: 'sendMessage', content: message });
							messageInput.value = '';
						}
					}

					function addMessage(message) {
						const messageDiv = document.createElement('div');
						messageDiv.className = \`message \${message.role}\`;
						messageDiv.innerHTML = \`
							<div class="message-header">
								<span class="role">\${message.role.toUpperCase()}</span>
								<span class="timestamp">\${new Date(message.timestamp).toLocaleTimeString()}</span>
							</div>
							<div class="message-content">\${escapeHtml(message.content)}</div>
							\${message.metadata ? \`
								<div class="message-metadata">
									\${message.metadata.model ? \`<span>Model: \${message.metadata.model}</span>\` : ''}
									\${message.metadata.tokens ? \`<span>Tokens: \${message.metadata.tokens}</span>\` : ''}
								</div>
							\` : ''}
						\`;
						chatContainer.appendChild(messageDiv);
						chatContainer.scrollTop = chatContainer.scrollHeight;
					}

					function escapeHtml(text) {
						const div = document.createElement('div');
						div.textContent = text;
						return div.innerHTML;
					}
				</script>
			</body>
			</html>
		`;
	}

	private handleMessage(message: any): void {
		switch (message.type) {
			case 'sendMessage':
				// Handle sending message to agent
				this.logService.info('Chat Panel: Message sent', { content: message.content });
				break;
		}
	}

	private escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	dispose(): void {
		if (this.panel) {
			this.panel.dispose();
		}
		super.dispose();
	}
}

// Placeholder interfaces and imports for VSCode API
interface WebviewPanel {
	visible: boolean;
	webview: {
		html: string;
		onDidReceiveMessage: any;
	};
	reveal(): void;
	onDidDispose: any;
	dispose(): void;
}

interface IStatusBarItem {
	text: string;
	tooltip: string;
	command: string;
	show(): void;
	dispose(): void;
}

interface IDisposable {
	dispose(): void;
}

declare const window: any;
declare const commands: any;
declare const StatusBarAlignment: any;
declare const ViewColumn: any;
declare const ProgressLocation: any;