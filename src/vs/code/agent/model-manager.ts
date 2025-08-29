/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../base/common/event.js';
import { Disposable, DisposableStore } from '../../base/common/lifecycle.js';
import { ILogService } from '../../platform/log/common/log.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';

export interface IModelInfo {
	name: string;
	provider: string;
	type: 'local' | 'api';
	capabilities: string[];
	contextLength: number;
	costPerToken?: number;
}

export interface IModelRequest {
	messages: IChatMessage[];
	model: string;
	provider: string;
	temperature: number;
	maxTokens: number;
	stream?: boolean;
	tools?: IToolDefinition[];
}

export interface IModelResponse {
	content: string;
	tokens: number;
	finishReason: 'stop' | 'length' | 'tool_calls';
	toolCalls?: IToolCall[];
}

export interface IChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	toolCalls?: IToolCall[];
	toolCallId?: string;
}

export interface IToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface IToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: any;
	};
}

export interface IModelProvider {
	name: string;
	type: 'local' | 'api';
	isAvailable(): Promise<boolean>;
	listModels(): Promise<IModelInfo[]>;
	execute(request: IModelRequest, options?: { signal?: AbortSignal; timeout?: number }): Promise<IModelResponse>;
}

export class ModelManager extends Disposable {
	private readonly providers = new Map<string, IModelProvider>();
	private readonly disposables = this._register(new DisposableStore());
	private currentModel: IModelInfo | null = null;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();

		this.initializeProviders();
	}

	private async initializeProviders(): Promise<void> {
		try {
			// Initialize Hugging Face provider
			const huggingFaceProvider = this.instantiationService.createInstance(HuggingFaceProvider);
			this.providers.set('huggingface', huggingFaceProvider);

			// Initialize Ollama provider
			const ollamaProvider = this.instantiationService.createInstance(OllamaProvider);
			this.providers.set('ollama', ollamaProvider);

			// Initialize API providers
			const openAIProvider = this.instantiationService.createInstance(OpenAIProvider);
			this.providers.set('openai', openAIProvider);

			const anthropicProvider = this.instantiationService.createInstance(AnthropicProvider);
			this.providers.set('anthropic', anthropicProvider);

			const googleProvider = this.instantiationService.createInstance(GoogleProvider);
			this.providers.set('google', googleProvider);

			const azureProvider = this.instantiationService.createInstance(AzureProvider);
			this.providers.set('azure', azureProvider);

			const openRouterProvider = this.instantiationService.createInstance(OpenRouterProvider);
			this.providers.set('openrouter', openRouterProvider);

			this.logService.info('Model Manager: All providers initialized');

			// Set default model
			await this.setDefaultModel();

		} catch (error) {
			this.logService.error('Model Manager: Failed to initialize providers', error);
		}
	}

	async selectModel(taskType: string, preferredModel?: string): Promise<IModelInfo> {
		const config = this.configurationService.getValue('agent.models');

		// If user specified a preferred model, try to use it
		if (preferredModel) {
			const model = await this.findModel(preferredModel);
			if (model) {
				this.currentModel = model;
				return model;
			}
		}

		// Select model based on task type
		const model = await this.selectModelByTaskType(taskType);
		this.currentModel = model;
		return model;
	}

	private async selectModelByTaskType(taskType: string): Promise<IModelInfo> {
		const taskModelMap = {
			conversational: ['gpt-4o', 'claude-3-5-sonnet', 'gemini-pro', 'codellama'],
			instruction: ['codellama', 'starcoder', 'deepseek-coder', 'gpt-4o'],
			analytical: ['claude-3-5-sonnet', 'gpt-4o', 'gemini-pro', 'codellama:13b'],
			code: ['codellama', 'starcoder', 'deepseek-coder', 'gpt-4o'],
			debugging: ['codellama', 'starcoder', 'gpt-4o', 'claude-3-5-sonnet'],
			testing: ['codellama', 'gpt-4o', 'claude-3-5-sonnet', 'starcoder'],
			general: ['codellama', 'gpt-4o', 'claude-3-5-sonnet', 'gemini-pro']
		};

		const preferredModels = taskModelMap[taskType] || taskModelMap.general;

		for (const modelName of preferredModels) {
			const model = await this.findModel(modelName);
			if (model) {
				return model;
			}
		}

		// Fallback to first available model
		const availableModels = await this.getAvailableModels();
		if (availableModels.length > 0) {
			return availableModels[0];
		}

		throw new Error('No models available');
	}

	private async findModel(modelName: string): Promise<IModelInfo | null> {
		for (const provider of this.providers.values()) {
			try {
				const models = await provider.listModels();
				const model = models.find(m => m.name === modelName || m.name.includes(modelName));
				if (model) {
					return model;
				}
			} catch (error) {
				this.logService.warn(`Model Manager: Failed to get models from ${provider.name}`, error);
			}
		}

		return null;
	}

	async execute(request: IModelRequest, options?: { signal?: AbortSignal; timeout?: number }): Promise<IModelResponse> {
		const provider = this.providers.get(request.provider);

		if (!provider) {
			throw new Error(`Provider ${request.provider} not found`);
		}

		try {
			this.logService.info(`Model Manager: Executing request with ${request.model} on ${request.provider}`);

			const response = await provider.execute(request, options);

			this.logService.info(`Model Manager: Request completed`, {
				model: request.model,
				provider: request.provider,
				tokens: response.tokens
			});

			return response;

		} catch (error) {
			this.logService.error(`Model Manager: Request failed`, {
				model: request.model,
				provider: request.provider,
				error
			});

			throw error;
		}
	}

	async getAvailableModels(): Promise<IModelInfo[]> {
		const allModels: IModelInfo[] = [];

		for (const provider of this.providers.values()) {
			try {
				if (await provider.isAvailable()) {
					const models = await provider.listModels();
					allModels.push(...models);
				}
			} catch (error) {
				this.logService.warn(`Model Manager: Failed to get models from ${provider.name}`, error);
			}
		}

		return allModels;
	}

	getCurrentModel(): string {
		return this.currentModel?.name || 'none';
	}

	private async setDefaultModel(): Promise<void> {
		const config = this.configurationService.getValue('agent.models');
		const defaultProvider = config?.default || 'huggingface';

		try {
			const provider = this.providers.get(defaultProvider);
			if (provider) {
				const models = await provider.listModels();
				if (models.length > 0) {
					this.currentModel = models[0];
				}
			}
		} catch (error) {
			this.logService.warn('Model Manager: Failed to set default model', error);
		}
	}
}

// Provider Implementations

class HuggingFaceProvider implements IModelProvider {
	readonly name = 'huggingface';
	readonly type = 'api' as const;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {}

	async isAvailable(): Promise<boolean> {
		const config = this.configurationService.getValue('agent.models.providers.huggingface');
		return !!(config?.apiKey || process.env.HUGGINGFACE_API_KEY);
	}

	async listModels(): Promise<IModelInfo[]> {
		// Return available Hugging Face models for coding
		return [
			{
				name: 'codellama',
				provider: 'huggingface',
				type: 'api',
				capabilities: ['code', 'chat', 'instruction'],
				contextLength: 16384,
				costPerToken: 0.0001
			},
			{
				name: 'starcoder',
				provider: 'huggingface',
				type: 'api',
				capabilities: ['code', 'completion'],
				contextLength: 8192,
				costPerToken: 0.0001
			},
			{
				name: 'deepseek-coder',
				provider: 'huggingface',
				type: 'api',
				capabilities: ['code', 'chat', 'instruction'],
				contextLength: 32768,
				costPerToken: 0.0001
			}
		];
	}

	async execute(request: IModelRequest, options?: { signal?: AbortSignal; timeout?: number }): Promise<IModelResponse> {
		// Implementation would use Hugging Face Inference API
		// This is a placeholder - actual implementation would make HTTP requests
		const config = this.configurationService.getValue('agent.models.providers.huggingface');

		// Simulate API call
		await new Promise(resolve => setTimeout(resolve, 1000));

		return {
			content: `Hugging Face ${request.model} response`,
			tokens: 150,
			finishReason: 'stop'
		};
	}
}

class OllamaProvider implements IModelProvider {
	readonly name = 'ollama';
	readonly type = 'local' as const;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {}

	async isAvailable(): Promise<boolean> {
		const config = this.configurationService.getValue('agent.models.providers.ollama');
		const endpoint = config?.endpoint || 'http://localhost:11434';

		try {
			// Check if Ollama is running
			const response = await fetch(`${endpoint}/api/tags`);
			return response.ok;
		} catch {
			return false;
		}
	}

	async listModels(): Promise<IModelInfo[]> {
		const config = this.configurationService.getValue('agent.models.providers.ollama');
		const endpoint = config?.endpoint || 'http://localhost:11434';

		try {
			const response = await fetch(`${endpoint}/api/tags`);
			const data = await response.json();

			return data.models.map((model: any) => ({
				name: model.name,
				provider: 'ollama',
				type: 'local',
				capabilities: ['code', 'chat', 'instruction'],
				contextLength: 4096, // Default, could be model-specific
				costPerToken: 0 // Local models are free
			}));
		} catch (error) {
			this.logService.warn('Ollama Provider: Failed to list models', error);
			return [];
		}
	}

	async execute(request: IModelRequest, options?: { signal?: AbortSignal; timeout?: number }): Promise<IModelResponse> {
		const config = this.configurationService.getValue('agent.models.providers.ollama');
		const endpoint = config?.endpoint || 'http://localhost:11434';

		const response = await fetch(`${endpoint}/api/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: request.model,
				messages: request.messages,
				stream: false,
				options: {
					temperature: request.temperature,
					num_predict: request.maxTokens
				}
			}),
			signal: options?.signal
		});

		if (!response.ok) {
			throw new Error(`Ollama API error: ${response.statusText}`);
		}

		const data = await response.json();

		return {
			content: data.message.content,
			tokens: data.eval_count || 0,
			finishReason: 'stop'
		};
	}
}

class OpenAIProvider implements IModelProvider {
	readonly name = 'openai';
	readonly type = 'api' as const;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {}

	async isAvailable(): Promise<boolean> {
		const config = this.configurationService.getValue('agent.models.providers.openai');
		return !!(config?.apiKey || process.env.OPENAI_API_KEY);
	}

	async listModels(): Promise<IModelInfo[]> {
		return [
			{
				name: 'gpt-4o',
				provider: 'openai',
				type: 'api',
				capabilities: ['chat', 'code', 'instruction', 'analysis'],
				contextLength: 128000,
				costPerToken: 0.00003
			},
			{
				name: 'gpt-4-turbo',
				provider: 'openai',
				type: 'api',
				capabilities: ['chat', 'code', 'instruction', 'analysis'],
				contextLength: 128000,
				costPerToken: 0.00001
			},
			{
				name: 'gpt-3.5-turbo',
				provider: 'openai',
				type: 'api',
				capabilities: ['chat', 'code', 'instruction'],
				contextLength: 16384,
				costPerToken: 0.000002
			}
		];
	}

	async execute(request: IModelRequest, options?: { signal?: AbortSignal; timeout?: number }): Promise<IModelResponse> {
		const config = this.configurationService.getValue('agent.models.providers.openai');
		const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;

		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model: request.model,
				messages: request.messages,
				temperature: request.temperature,
				max_tokens: request.maxTokens,
				stream: request.stream
			}),
			signal: options?.signal
		});

		if (!response.ok) {
			throw new Error(`OpenAI API error: ${response.statusText}`);
		}

		const data = await response.json();
		const choice = data.choices[0];

		return {
			content: choice.message.content,
			tokens: data.usage.total_tokens,
			finishReason: choice.finish_reason,
			toolCalls: choice.message.tool_calls
		};
	}
}

// Placeholder implementations for other providers
class AnthropicProvider implements IModelProvider {
	readonly name = 'anthropic';
	readonly type = 'api' as const;

	async isAvailable(): Promise<boolean> { return false; }
	async listModels(): Promise<IModelInfo[]> { return []; }
	async execute(request: IModelRequest): Promise<IModelResponse> {
		throw new Error('Anthropic provider not implemented');
	}
}

class GoogleProvider implements IModelProvider {
	readonly name = 'google';
	readonly type = 'api' as const;

	async isAvailable(): Promise<boolean> { return false; }
	async listModels(): Promise<IModelInfo[]> { return []; }
	async execute(request: IModelRequest): Promise<IModelResponse> {
		throw new Error('Google provider not implemented');
	}
}

class AzureProvider implements IModelProvider {
	readonly name = 'azure';
	readonly type = 'api' as const;

	async isAvailable(): Promise<boolean> { return false; }
	async listModels(): Promise<IModelInfo[]> { return []; }
	async execute(request: IModelRequest): Promise<IModelResponse> {
		throw new Error('Azure provider not implemented');
	}
}

class OpenRouterProvider implements IModelProvider {
	readonly name = 'openrouter';
	readonly type = 'api' as const;

	async isAvailable(): Promise<boolean> { return false; }
	async listModels(): Promise<IModelInfo[]> { return []; }
	async execute(request: IModelRequest): Promise<IModelResponse> {
		throw new Error('OpenRouter provider not implemented');
	}
}