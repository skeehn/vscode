/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionContext } from 'vscode';
import { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { ModelManager } from './model-manager.js';
import { ToolSystem } from './tools/tool-system.js';
import { MemorySystem } from './memory/memory-system.js';
import { AgentUI } from './ui/agent-ui.js';

export async function activate(context: ExtensionContext): Promise<void> {
	console.log('AI Agent extension is now active!');

	try {
		// Create instantiation service
		const instantiationService = createInstantiationService(context);

		// Initialize core components
		const modelManager = instantiationService.createInstance(ModelManager);
		const toolSystem = instantiationService.createInstance(ToolSystem);
		const memorySystem = instantiationService.createInstance(MemorySystem);

		// Create agent orchestrator
		const agentOrchestrator = instantiationService.createInstance(AgentOrchestrator);

		// Create UI components
		const agentUI = instantiationService.createInstance(AgentUI);

		// Register commands
		await registerCommands(context, agentOrchestrator, agentUI);

		// Setup configuration
		await setupConfiguration();

		console.log('AI Agent extension initialized successfully');

	} catch (error) {
		console.error('Failed to activate AI Agent extension:', error);
		throw error;
	}
}

export function deactivate(): void {
	console.log('AI Agent extension is now deactivated!');
}

async function registerCommands(
	context: ExtensionContext,
	agentOrchestrator: AgentOrchestrator,
	agentUI: AgentUI
): Promise<void> {
	const commands = [
		{
			command: 'agent.startChat',
			title: 'Start AI Agent Chat',
			handler: async () => {
				await agentUI.showChatInterface();
			}
		},
		{
			command: 'agent.askQuestion',
			title: 'Ask AI Agent a Question',
			handler: async () => {
				const question = await vscode.window.showInputBox({
					prompt: 'What would you like to ask the AI agent?',
					placeHolder: 'Enter your question here...'
				});

				if (question) {
					const request = {
						id: `question_${Date.now()}`,
						type: 'chat' as const,
						content: question,
						context: {
							filePath: vscode.window.activeTextEditor?.document.uri.fsPath,
							selection: vscode.window.activeTextEditor?.selection ? vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection) : undefined,
							workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
							language: vscode.window.activeTextEditor?.document.languageId
						}
					};

					const response = await agentOrchestrator.execute(request);
					await agentUI.showSuccessMessage(`Response: ${response.content.substring(0, 100)}...`);
				}
			}
		},
		{
			command: 'agent.explainCode',
			title: 'Explain Selected Code',
			handler: async () => {
				const activeEditor = vscode.window.activeTextEditor;
				if (!activeEditor) {
					await agentUI.showErrorMessage('No active editor found');
					return;
				}

				const selection = activeEditor.selection;
				const selectedText = activeEditor.document.getText(selection);

				if (!selectedText) {
					await agentUI.showErrorMessage('No code selected');
					return;
				}

				const request = {
					id: `explain_${Date.now()}`,
					type: 'analysis' as const,
					content: `Explain this code:\n\n${selectedText}`,
					context: {
						filePath: activeEditor.document.uri.fsPath,
						selection: selectedText,
						workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
						language: activeEditor.document.languageId
					}
				};

				const progressIndicator = agentUI.showProgressIndicator('Analyzing code...');
				try {
					const response = await agentOrchestrator.execute(request);
					await vscode.window.showInformationMessage(
						`Code Explanation: ${response.content.substring(0, 200)}...`
					);
				} finally {
					progressIndicator.dispose();
				}
			}
		},
		{
			command: 'agent.refactorCode',
			title: 'Refactor Selected Code',
			handler: async () => {
				const activeEditor = vscode.window.activeTextEditor;
				if (!activeEditor) {
					await agentUI.showErrorMessage('No active editor found');
					return;
				}

				const selection = activeEditor.selection;
				const selectedText = activeEditor.document.getText(selection);

				if (!selectedText) {
					await agentUI.showErrorMessage('No code selected');
					return;
				}

				const request = {
					id: `refactor_${Date.now()}`,
					type: 'refactor' as const,
					content: `Refactor this code to improve readability and maintainability:\n\n${selectedText}`,
					context: {
						filePath: activeEditor.document.uri.fsPath,
						selection: selectedText,
						workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
						language: activeEditor.document.languageId
					}
				};

				const progressIndicator = agentUI.showProgressIndicator('Refactoring code...');
				try {
					const response = await agentOrchestrator.execute(request);

					// Replace selected text with refactored version
					const edit = new vscode.WorkspaceEdit();
					edit.replace(activeEditor.document.uri, selection, response.content);
					await vscode.workspace.applyEdit(edit);

					await agentUI.showSuccessMessage('Code refactored successfully');
				} finally {
					progressIndicator.dispose();
				}
			}
		},
		{
			command: 'agent.debugCode',
			title: 'Debug Selected Code',
			handler: async () => {
				const activeEditor = vscode.window.activeTextEditor;
				if (!activeEditor) {
					await agentUI.showErrorMessage('No active editor found');
					return;
				}

				const selection = activeEditor.selection;
				const selectedText = activeEditor.document.getText(selection);

				if (!selectedText) {
					await agentUI.showErrorMessage('No code selected');
					return;
				}

				const request = {
					id: `debug_${Date.now()}`,
					type: 'debug' as const,
					content: `Debug this code and identify potential issues:\n\n${selectedText}`,
					context: {
						filePath: activeEditor.document.uri.fsPath,
						selection: selectedText,
						workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
						language: activeEditor.document.languageId
					}
				};

				const progressIndicator = agentUI.showProgressIndicator('Debugging code...');
				try {
					const response = await agentOrchestrator.execute(request);
					await vscode.window.showInformationMessage(
						`Debug Analysis: ${response.content.substring(0, 200)}...`
					);
				} finally {
					progressIndicator.dispose();
				}
			}
		},
		{
			command: 'agent.generateTests',
			title: 'Generate Tests for Code',
			handler: async () => {
				const activeEditor = vscode.window.activeTextEditor;
				if (!activeEditor) {
					await agentUI.showErrorMessage('No active editor found');
					return;
				}

				const selection = activeEditor.selection;
				const selectedText = activeEditor.document.getText(selection) || activeEditor.document.getText();

				const request = {
					id: `test_${Date.now()}`,
					type: 'test' as const,
					content: `Generate comprehensive unit tests for this code:\n\n${selectedText}`,
					context: {
						filePath: activeEditor.document.uri.fsPath,
						selection: selectedText,
						workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
						language: activeEditor.document.languageId
					}
				};

				const progressIndicator = agentUI.showProgressIndicator('Generating tests...');
				try {
					const response = await agentOrchestrator.execute(request);

					// Create new test file
					const testFileName = activeEditor.document.uri.fsPath.replace(/\.(js|ts|py)$/, '.test.$1');
					const testUri = vscode.Uri.file(testFileName);

					const edit = new vscode.WorkspaceEdit();
					edit.createFile(testUri, { overwrite: true });
					await vscode.workspace.applyEdit(edit);

					// Write test content
					const testEdit = new vscode.WorkspaceEdit();
					testEdit.insert(testUri, new vscode.Position(0, 0), response.content);
					await vscode.workspace.applyEdit(testEdit);

					// Open test file
					const testDocument = await vscode.workspace.openTextDocument(testUri);
					await vscode.window.showTextDocument(testDocument);

					await agentUI.showSuccessMessage('Test file generated successfully');
				} finally {
					progressIndicator.dispose();
				}
			}
		},
		{
			command: 'agent.runCommand',
			title: 'Run Terminal Command',
			handler: async () => {
				const command = await vscode.window.showInputBox({
					prompt: 'Enter terminal command to run',
					placeHolder: 'e.g., npm test, git status, python -m pytest'
				});

				if (command) {
					const request = {
						id: `command_${Date.now()}`,
						type: 'command' as const,
						content: `Execute this terminal command: ${command}`,
						context: {
							workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
						}
					};

					const progressIndicator = agentUI.showProgressIndicator(`Running: ${command}`);
					try {
						const response = await agentOrchestrator.execute(request);
						await vscode.window.showInformationMessage(
							`Command Output: ${response.content.substring(0, 200)}...`
						);
					} finally {
						progressIndicator.dispose();
					}
				}
			}
		},
		{
			command: 'agent.analyzeProject',
			title: 'Analyze Project',
			handler: async () => {
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				if (!workspaceFolder) {
					await agentUI.showErrorMessage('No workspace folder found');
					return;
				}

				const request = {
					id: `analyze_${Date.now()}`,
					type: 'analysis' as const,
					content: `Analyze this project structure and provide insights about the codebase, architecture, and potential improvements.`,
					context: {
						workspace: workspaceFolder.uri.fsPath
					}
				};

				const progressIndicator = agentUI.showProgressIndicator('Analyzing project...');
				try {
					const response = await agentOrchestrator.execute(request);
					await vscode.window.showInformationMessage(
						`Project Analysis: ${response.content.substring(0, 200)}...`
					);
				} finally {
					progressIndicator.dispose();
				}
			}
		},
		{
			command: 'agent.switchModel',
			title: 'Switch AI Model',
			handler: async () => {
				const selectedModel = await agentUI.showModelSelector();
				if (selectedModel) {
					await agentUI.showSuccessMessage(`Switched to model: ${selectedModel}`);
				}
			}
		},
		{
			command: 'agent.showStatus',
			title: 'Show Agent Status',
			handler: async () => {
				const status = agentOrchestrator.getStatus();
				await vscode.window.showInformationMessage(
					`Agent Status:\n` +
					`Active: ${status.isActive}\n` +
					`Model: ${status.currentModel}\n` +
					`Requests: ${status.activeRequests.length}\n` +
					`Memory: ${Math.round(status.memoryUsage / 1024)}KB`
				);
			}
		}
	];

	// Register all commands
	for (const cmd of commands) {
		context.subscriptions.push(
			vscode.commands.registerCommand(cmd.command, cmd.handler)
		);
	}

	// Register context menu commands
	context.subscriptions.push(
		vscode.commands.registerCommand('agent.explainSelection', async () => {
			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor || activeEditor.selection.isEmpty) {
				await agentUI.showErrorMessage('No text selected');
				return;
			}

			const selectedText = activeEditor.document.getText(activeEditor.selection);
			const request = {
				id: `explain_selection_${Date.now()}`,
				type: 'analysis' as const,
				content: `Explain this code selection:\n\n${selectedText}`,
				context: {
					filePath: activeEditor.document.uri.fsPath,
					selection: selectedText,
					language: activeEditor.document.languageId
				}
			};

			const response = await agentOrchestrator.execute(request);
			await vscode.window.showInformationMessage(
				`Explanation: ${response.content.substring(0, 200)}...`
			);
		})
	);
}

async function setupConfiguration(): Promise<void> {
	// Configuration is handled by the individual components
	// This function can be used for any global setup needed
}

function createInstantiationService(context: ExtensionContext): IInstantiationService {
	// This would create a proper instantiation service
	// For now, return a placeholder
	return {
		createInstance: <T>(ctor: any, ...args: any[]): T => {
			// Simple instantiation - in real implementation would use proper DI
			return new ctor(...args);
		},
		invokeFunction: <T>(fn: (accessor: any) => T): T => {
			return fn({} as any);
		}
	} as any;
}

// Placeholder VSCode API imports
declare const vscode: any;