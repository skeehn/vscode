/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../base/common/event.js';
import { Disposable, DisposableStore } from '../../base/common/lifecycle.js';
import { ILogService } from '../../platform/log/common/log.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';

import { ModelManager } from './model-manager.js';
import { ToolSystem } from './tools/tool-system.js';
import { MemorySystem } from './memory/memory-system.js';
import { AgentUI } from './ui/agent-ui.js';

export interface IAgentRequest {
	id: string;
	type: 'chat' | 'command' | 'analysis' | 'refactor' | 'debug' | 'test';
	content: string;
	context?: {
		filePath?: string;
		selection?: string;
		workspace?: string;
		language?: string;
	};
	options?: {
		model?: string;
		provider?: string;
		streaming?: boolean;
		timeout?: number;
	};
}

export interface IAgentResponse {
	id: string;
	requestId: string;
	content: string;
	tools?: IAgentToolResult[];
	error?: string;
	metadata?: {
		model: string;
		provider: string;
		tokens: number;
		duration: number;
	};
}

export interface IAgentToolResult {
	name: string;
	result: any;
	error?: string;
	duration: number;
}

export interface IAgentOrchestrator {
	readonly onDidReceiveResponse: Event<IAgentResponse>;
	readonly onDidStartRequest: Event<IAgentRequest>;
	readonly onDidEndRequest: Event<string>;

	execute(request: IAgentRequest): Promise<IAgentResponse>;
	cancel(requestId: string): Promise<void>;
	getStatus(): IAgentStatus;
}

export interface IAgentStatus {
	isActive: boolean;
	activeRequests: string[];
	availableModels: string[];
	currentModel: string;
	memoryUsage: number;
}

export class AgentOrchestrator extends Disposable implements IAgentOrchestrator {
	private readonly _onDidReceiveResponse = this._register(new EventEmitter<IAgentResponse>());
	public readonly onDidReceiveResponse = this._onDidReceiveResponse.event;

	private readonly _onDidStartRequest = this._register(new EventEmitter<IAgentRequest>());
	public readonly onDidStartRequest = this._onDidStartRequest.event;

	private readonly _onDidEndRequest = this._register(new EventEmitter<string>());
	public readonly onDidEndRequest = this._onDidEndRequest.event;

	private readonly activeRequests = new Map<string, AbortController>();
	private readonly disposables = this._register(new DisposableStore());

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();

		this.initializeComponents();
	}

	private async initializeComponents(): Promise<void> {
		try {
			// Initialize core components
			this.modelManager = this.instantiationService.createInstance(ModelManager);
			this.toolSystem = this.instantiationService.createInstance(ToolSystem);
			this.memorySystem = this.instantiationService.createInstance(MemorySystem);
			this.ui = this.instantiationService.createInstance(AgentUI);

			this.logService.info('Agent Orchestrator: Components initialized successfully');
		} catch (error) {
			this.logService.error('Agent Orchestrator: Failed to initialize components', error);
		}
	}

	async execute(request: IAgentRequest): Promise<IAgentResponse> {
		const startTime = Date.now();
		const abortController = new AbortController();
		this.activeRequests.set(request.id, abortController);

		try {
			this._onDidStartRequest.fire(request);
			this.logService.info(`Agent Orchestrator: Starting request ${request.id}`, { type: request.type });

			// Select appropriate model based on request
			const model = await this.selectModel(request);

			// Gather context from memory system
			const context = await this.gatherContext(request);

			// Prepare the request for the model
			const modelRequest = await this.prepareModelRequest(request, context, model);

			// Execute tools if needed
			const toolResults = await this.executeTools(request);

			// Get response from model
			const modelResponse = await this.modelManager.execute(modelRequest, {
				signal: abortController.signal,
				timeout: request.options?.timeout || 30000
			});

			// Process and enhance the response
			const enhancedResponse = await this.enhanceResponse(modelResponse, toolResults, context);

			// Store in memory for future context
			await this.memorySystem.storeInteraction(request, enhancedResponse);

			const response: IAgentResponse = {
				id: `${request.id}_response`,
				requestId: request.id,
				content: enhancedResponse.content,
				tools: toolResults,
				metadata: {
					model: model.name,
					provider: model.provider,
					tokens: enhancedResponse.tokens || 0,
					duration: Date.now() - startTime
				}
			};

			this._onDidReceiveResponse.fire(response);
			this.logService.info(`Agent Orchestrator: Completed request ${request.id}`, {
				duration: response.metadata!.duration,
				tokens: response.metadata!.tokens
			});

			return response;

		} catch (error) {
			const errorResponse: IAgentResponse = {
				id: `${request.id}_error`,
				requestId: request.id,
				content: '',
				error: error instanceof Error ? error.message : 'Unknown error occurred'
			};

			this.logService.error(`Agent Orchestrator: Request ${request.id} failed`, error);
			return errorResponse;

		} finally {
			this.activeRequests.delete(request.id);
			this._onDidEndRequest.fire(request.id);
		}
	}

	async cancel(requestId: string): Promise<void> {
		const controller = this.activeRequests.get(requestId);
		if (controller) {
			controller.abort();
			this.activeRequests.delete(requestId);
			this.logService.info(`Agent Orchestrator: Cancelled request ${requestId}`);
		}
	}

	getStatus(): IAgentStatus {
		return {
			isActive: this.activeRequests.size > 0,
			activeRequests: Array.from(this.activeRequests.keys()),
			availableModels: this.modelManager?.getAvailableModels() || [],
			currentModel: this.modelManager?.getCurrentModel() || 'none',
			memoryUsage: this.memorySystem?.getMemoryUsage() || 0
		};
	}

	private async selectModel(request: IAgentRequest): Promise<IModelInfo> {
		// Model selection logic based on request type and complexity
		const config = this.configurationService.getValue('agent.models');

		switch (request.type) {
			case 'chat':
				return this.modelManager.selectModel('conversational', request.options?.model);
			case 'command':
				return this.modelManager.selectModel('instruction', request.options?.model);
			case 'analysis':
				return this.modelManager.selectModel('analytical', request.options?.model);
			case 'refactor':
				return this.modelManager.selectModel('code', request.options?.model);
			case 'debug':
				return this.modelManager.selectModel('debugging', request.options?.model);
			case 'test':
				return this.modelManager.selectModel('testing', request.options?.model);
			default:
				return this.modelManager.selectModel('general', request.options?.model);
		}
	}

	private async gatherContext(request: IAgentRequest): Promise<IAgentContext> {
		const context: IAgentContext = {
			conversation: await this.memorySystem.getConversationHistory(request.id),
			workspace: request.context?.workspace,
			file: request.context?.filePath,
			selection: request.context?.selection,
			language: request.context?.language,
			relevantKnowledge: await this.memorySystem.searchRelevantKnowledge(request.content)
		};

		return context;
	}

	private async prepareModelRequest(
		request: IAgentRequest,
		context: IAgentContext,
		model: IModelInfo
	): Promise<IModelRequest> {
		// Prepare the request with context and instructions
		const systemPrompt = await this.generateSystemPrompt(request.type, context);

		return {
			messages: [
				{ role: 'system', content: systemPrompt },
				...context.conversation.map(c => ({ role: c.role, content: c.content })),
				{ role: 'user', content: request.content }
			],
			model: model.name,
			provider: model.provider,
			temperature: this.getTemperatureForRequestType(request.type),
			maxTokens: this.getMaxTokensForRequestType(request.type)
		};
	}

	private async executeTools(request: IAgentRequest): Promise<IAgentToolResult[]> {
		const tools = this.toolSystem.getToolsForRequest(request);

		if (tools.length === 0) {
			return [];
		}

		const results: IAgentToolResult[] = [];

		for (const tool of tools) {
			try {
				const startTime = Date.now();
				const result = await this.toolSystem.executeTool(tool, request);
				const duration = Date.now() - startTime;

				results.push({
					name: tool.name,
					result,
					duration
				});
			} catch (error) {
				results.push({
					name: tool.name,
					result: null,
					error: error instanceof Error ? error.message : 'Tool execution failed',
					duration: 0
				});
			}
		}

		return results;
	}

	private async enhanceResponse(
		modelResponse: IModelResponse,
		toolResults: IAgentToolResult[],
		context: IAgentContext
	): Promise<IEnhancedResponse> {
		// Enhance the model response with tool results and context
		let enhancedContent = modelResponse.content;

		if (toolResults.length > 0) {
			enhancedContent += '\n\nTool Results:\n';
			for (const tool of toolResults) {
				enhancedContent += `**${tool.name}**: ${tool.error || JSON.stringify(tool.result)}\n`;
			}
		}

		return {
			content: enhancedContent,
			tokens: modelResponse.tokens,
			confidence: modelResponse.confidence || 0.8
		};
	}

	private async generateSystemPrompt(type: string, context: IAgentContext): Promise<string> {
		const basePrompt = `You are an expert AI coding assistant integrated into VSCode.
You have access to powerful tools and can help with various coding tasks.`;

		const typeSpecificPrompts = {
			chat: 'You are having a conversation about coding. Be helpful and engaging.',
			command: 'Execute the requested coding task using available tools.',
			analysis: 'Analyze the provided code and provide insights.',
			refactor: 'Refactor the code to improve quality, maintainability, and performance.',
			debug: 'Debug the issue and provide solutions.',
			test: 'Generate or improve tests for the codebase.'
		};

		return `${basePrompt}\n\n${typeSpecificPrompts[type] || 'Help with the coding task.'}`;
	}

	private getTemperatureForRequestType(type: string): number {
		const temperatures = {
			chat: 0.7,
			command: 0.3,
			analysis: 0.2,
			refactor: 0.3,
			debug: 0.2,
			test: 0.3
		};

		return temperatures[type] || 0.5;
	}

	private getMaxTokensForRequestType(type: string): number {
		const maxTokens = {
			chat: 2048,
			command: 4096,
			analysis: 8192,
			refactor: 8192,
			debug: 4096,
			test: 4096
		};

		return maxTokens[type] || 4096;
	}

	dispose(): void {
		this.activeRequests.clear();
		super.dispose();
	}
}

// Import statements for missing types
import { EventEmitter } from '../../base/common/eventEmitter.js';

// Placeholder interfaces that would be defined elsewhere
interface IModelInfo {
	name: string;
	provider: string;
}

interface IAgentContext {
	conversation: any[];
	workspace?: string;
	file?: string;
	selection?: string;
	language?: string;
	relevantKnowledge: any[];
}

interface IModelRequest {
	messages: any[];
	model: string;
	provider: string;
	temperature: number;
	maxTokens: number;
}

interface IModelResponse {
	content: string;
	tokens?: number;
	confidence?: number;
}

interface IEnhancedResponse {
	content: string;
	tokens?: number;
	confidence: number;
}