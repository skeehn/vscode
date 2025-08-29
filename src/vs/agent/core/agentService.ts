/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { IAgent, IAgentService, IAgentConfiguration, IAgentContext, IAgentExecutionResult } from './agent.js';
import { IModelManager } from '../models/model.js';
import { IBrainStore } from '../brain/brainstore.js';
import { ITaskManager, ITaskPlanner, ITaskExecutor } from '../tasks/task.js';
import { IAPIManager } from '../api/api.js';
import { IPromptManager } from '../prompts/prompt.js';
import { IMemoryManager } from '../memory/memory.js';

export class AgentService extends Disposable implements IAgentService {
	private readonly _agents = new Map<string, IAgent>();
	private readonly _activeAgents = new Set<string>();

	private readonly _onAgentAdded = this._register(new EventEmitter<IAgent>());
	readonly onAgentAdded = this._onAgentAdded.event;

	private readonly _onAgentRemoved = this._register(new EventEmitter<string>());
	readonly onAgentRemoved = this._onAgentRemoved.event;

	private readonly _onAgentStarted = this._register(new EventEmitter<IAgent>());
	readonly onAgentStarted = this._onAgentStarted.event;

	private readonly _onAgentStopped = this._register(new EventEmitter<IAgent>());
	readonly onAgentStopped = this._onAgentStopped.event;

	constructor(
		private readonly modelManager: IModelManager,
		private readonly brainStore: IBrainStore,
		private readonly taskManager: ITaskManager,
		private readonly taskPlanner: ITaskPlanner,
		private readonly taskExecutor: ITaskExecutor,
		private readonly apiManager: IAPIManager,
		private readonly promptManager: IPromptManager,
		private readonly memoryManager: IMemoryManager
	) {
		super();
	}

	get agents(): readonly IAgent[] {
		return Array.from(this._agents.values());
	}

	async createAgent(config: IAgentConfiguration): Promise<IAgent> {
		const agent = new Agent(
			this.generateAgentId(),
			config,
			this.modelManager,
			this.brainStore,
			this.taskManager,
			this.taskPlanner,
			this.taskExecutor,
			this.apiManager,
			this.promptManager,
			this.memoryManager
		);

		this._agents.set(agent.id, agent);
		this._onAgentAdded.fire(agent);

		return agent;
	}

	getAgent(id: string): IAgent | undefined {
		return this._agents.get(id);
	}

	async removeAgent(id: string): Promise<void> {
		const agent = this._agents.get(id);
		if (!agent) {
			return;
		}

		if (this._activeAgents.has(id)) {
			await this.stopAgent(id);
		}

		this._agents.delete(id);
		this._onAgentRemoved.fire(id);
		agent.dispose();
	}

	async startAgent(id: string): Promise<void> {
		const agent = this._agents.get(id);
		if (!agent) {
			throw new Error(`Agent ${id} not found`);
		}

		if (this._activeAgents.has(id)) {
			return; // Already running
		}

		await agent.initialize();
		this._activeAgents.add(id);
		this._onAgentStarted.fire(agent);
	}

	async stopAgent(id: string): Promise<void> {
		const agent = this._activeAgents.has(id);
		if (!agent) {
			return; // Not running
		}

		const agentInstance = this._agents.get(id);
		if (agentInstance) {
			await agentInstance.stop();
			this._activeAgents.delete(id);
			this._onAgentStopped.fire(agentInstance);
		}
	}

	async executeTask(
		agentId: string,
		taskDescription: string,
		context: IAgentContext
	): Promise<IAgentExecutionResult> {
		const agent = this._agents.get(agentId);
		if (!agent) {
			throw new Error(`Agent ${agentId} not found`);
		}

		if (!this._activeAgents.has(agentId)) {
			await this.startAgent(agentId);
		}

		// Create task from description
		const task = await this.taskPlanner.planTask(taskDescription, {
			workspace: context.workspace,
			activeFiles: context.activeFiles || [],
			gitRepository: context.workspace,
			terminalSession: undefined,
			webviewPanels: [],
			extensions: []
		});

		// Execute task
		await this.taskManager.startTask(task.id);
		const result = await agent.execute(task, context);
		await this.taskManager.stopTask(task.id);

		return result;
	}

	private generateAgentId(): string {
		return `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}
}

export class Agent extends Disposable implements IAgent {
	private readonly _onTaskStart = this._register(new EventEmitter<any>());
	readonly onTaskStart = this._onTaskStart.event;

	private readonly _onTaskComplete = this._register(new EventEmitter<any>());
	readonly onTaskComplete = this._onTaskComplete.event;

	private readonly _onAction = this._register(new EventEmitter<any>());
	readonly onAction = this._onAction.event;

	private _isRunning = false;
	private _currentTask: any | undefined;

	constructor(
		readonly id: string,
		readonly configuration: IAgentConfiguration,
		private readonly modelManager: IModelManager,
		private readonly brainStore: IBrainStore,
		private readonly taskManager: ITaskManager,
		private readonly taskPlanner: ITaskPlanner,
		private readonly taskExecutor: ITaskExecutor,
		private readonly apiManager: IAPIManager,
		private readonly promptManager: IPromptManager,
		private readonly memoryManager: IMemoryManager
	) {
		super();
	}

	get capabilities() {
		return {
			supportsMultiModal: true,
			supportsToolUse: true,
			supportsPlanning: true,
			supportsMemory: true,
			supportsAPIs: true,
			maxContextLength: 8192,
		};
	}

	async initialize(): Promise<void> {
		// Initialize all subsystems
		await Promise.all([
			this.modelManager.createModel({
				modelId: this.configuration.model,
				provider: 'huggingface', // Default to Hugging Face
				temperature: this.configuration.temperature,
				maxTokens: this.configuration.maxTokens,
				parameters: {}
			}),
			this.brainStore.initialize(),
			this.promptManager.initialize()
		]);

		this._isRunning = true;
	}

	async execute(task: any, context: IAgentContext): Promise<IAgentExecutionResult> {
		if (!this._isRunning) {
			throw new Error('Agent is not running');
		}

		this._currentTask = task;
		this._onTaskStart.fire(task);

		try {
			// Get relevant context from brain store
			const brainContext = await this.brainStore.retrieve(task.title + ' ' + task.description, {
				maxResults: 10
			});

			// Get appropriate prompt template
			const promptTemplate = await this.promptManager.getPromptForTask('coding', {
				task: task.title,
				description: task.description,
				context: context,
				knowledge: brainContext
			});

			// Get model for execution
			const model = await this.modelManager.createModel({
				modelId: this.configuration.model,
				provider: 'huggingface',
				temperature: this.configuration.temperature,
				maxTokens: this.configuration.maxTokens,
				parameters: {}
			});

			// Execute with model
			const response = await model.chat([{
				role: 'user',
				content: promptTemplate.renderedPrompt
			}]);

			// Record in memory
			await this.memoryManager.recordConversation({
				role: 'user',
				content: promptTemplate.renderedPrompt
			});

			await this.memoryManager.recordConversation({
				role: 'assistant',
				content: response.content
			});

			const result: IAgentExecutionResult = {
				success: true,
				output: response.content,
				actions: [],
				reasoning: 'Task executed using AI model with context from knowledge base',
				confidence: 0.8,
				executionTime: Date.now() - Date.now() // TODO: Calculate actual execution time
			};

			this._onTaskComplete.fire(task);
			return result;

		} catch (error) {
			// Record error in memory
			await this.memoryManager.recordError(error as Error, `Task execution failed: ${task.title}`);

			throw error;
		} finally {
			this._currentTask = undefined;
		}
	}

	async stop(): Promise<void> {
		if (this._currentTask) {
			await this.taskManager.stopTask(this._currentTask.id);
		}

		this._isRunning = false;
		this._currentTask = undefined;
	}

	async updateConfiguration(config: Partial<IAgentConfiguration>): Promise<void> {
		Object.assign(this.configuration, config);
	}

	async getStatus() {
		return {
			isRunning: this._isRunning,
			currentTask: this._currentTask,
			memoryUsage: process.memoryUsage().heapUsed,
			modelLoaded: true, // TODO: Check actual model status
			apiConnections: 0 // TODO: Check actual API connections
		};
	}
}
