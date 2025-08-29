/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Ollama } from 'ollama';
import { EventEmitter } from '../../../base/common/event.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import {
	IAgentModel,
	IModelCapabilities,
	IModelConfiguration,
	IChatMessage,
	IChatResponse,
	ICompletionRequest,
	ICompletionResponse,
	IEmbeddingRequest,
	IEmbeddingResponse,
	IOllamaModel
} from './model.js';

export class OllamaModel extends Disposable implements IOllamaModel {
	private readonly _onLoad = this._register(new EventEmitter<void>());
	readonly onLoad = this._onLoad.event;

	private readonly _onUnload = this._register(new EventEmitter<void>());
	readonly onUnload = this._onUnload.event;

	private readonly _onError = this._register(new EventEmitter<Error>());
	readonly onError = this._onError.event;

	private _client: Ollama | null = null;
	private _isLoaded = false;
	private _localModels: string[] = [];

	constructor(
		readonly id: string,
		readonly configuration: IModelConfiguration
	) {
		super();
	}

	get capabilities(): IModelCapabilities {
		return {
			supportsChat: true,
			supportsCompletion: true,
			supportsEmbedding: this.isEmbeddingModel(),
			supportsVision: this.isVisionModel(),
			supportsAudio: false, // Ollama doesn't support audio yet
			supportsFunctionCalling: false,
			maxContextLength: this.getMaxContextLength(),
			maxOutputTokens: this.getMaxOutputTokens(),
			supportedInputTypes: this.getSupportedInputTypes(),
			supportedOutputTypes: this.getSupportedOutputTypes()
		};
	}

	async initialize(): Promise<void> {
		try {
			this._client = new Ollama({
				host: this.configuration.endpoint || 'http://localhost:11434'
			});

			await this.pullModel();
			await this.listLocalModels();
			this._isLoaded = true;
			this._onLoad.fire();
		} catch (error) {
			this._onError.fire(error as Error);
			throw error;
		}
	}

	isLoaded(): boolean {
		return this._isLoaded;
	}

	async pullModel(): Promise<void> {
		if (!this._client) {
			throw new Error('Ollama client not initialized');
		}

		try {
			await this._client.pull({
				model: this.configuration.modelId,
				stream: false
			});
		} catch (error) {
			this._onError.fire(error as Error);
			throw error;
		}
	}

	async listLocalModels(): Promise<readonly string[]> {
		if (!this._client) {
			throw new Error('Ollama client not initialized');
		}

		try {
			const response = await this._client.list();
			this._localModels = response.models.map(model => model.name);
			return this._localModels;
		} catch (error) {
			this._onError.fire(error as Error);
			throw error;
		}
	}

	async chat(
		messages: readonly IChatMessage[],
		options?: {
			temperature?: number;
			maxTokens?: number;
			functions?: readonly any[];
			stream?: boolean;
		},
		token?: CancellationToken
	): Promise<IChatResponse> {
		if (!this._client) {
			throw new Error('Ollama client not initialized');
		}

		const ollamaMessages = messages.map(msg => ({
			role: msg.role,
			content: msg.content,
			images: this.extractImages(msg)
		}));

		try {
			const response = await this._client.chat({
				model: this.configuration.modelId,
				messages: ollamaMessages,
				stream: false,
				options: {
					temperature: options?.temperature ?? this.configuration.temperature,
					num_predict: options?.maxTokens ?? this.configuration.maxTokens,
					...this.configuration.parameters
				}
			});

			return {
				content: response.message.content,
				role: 'assistant',
				finishReason: response.done ? 'stop' : 'length',
				usage: response.prompt_eval_count && response.eval_count ? {
					promptTokens: response.prompt_eval_count,
					completionTokens: response.eval_count,
					totalTokens: response.prompt_eval_count + response.eval_count
				} : undefined,
				metadata: {
					model: response.model,
					created_at: response.created_at,
					total_duration: response.total_duration,
					load_duration: response.load_duration,
					prompt_eval_duration: response.prompt_eval_duration,
					eval_duration: response.eval_duration
				}
			};
		} catch (error) {
			this._onError.fire(error as Error);
			throw error;
		}
	}

	async complete(
		request: ICompletionRequest,
		token?: CancellationToken
	): Promise<ICompletionResponse> {
		if (!this._client) {
			throw new Error('Ollama client not initialized');
		}

		try {
			const response = await this._client.generate({
				model: this.configuration.modelId,
				prompt: request.prompt,
				stream: false,
				options: {
					temperature: request.temperature ?? this.configuration.temperature,
					num_predict: request.maxTokens ?? this.configuration.maxTokens,
					...this.configuration.parameters
				}
			});

			return {
				text: response.response,
				finishReason: response.done ? 'stop' : 'length',
				usage: response.prompt_eval_count && response.eval_count ? {
					promptTokens: response.prompt_eval_count,
					completionTokens: response.eval_count,
					totalTokens: response.prompt_eval_count + response.eval_count
				} : undefined
			};
		} catch (error) {
			this._onError.fire(error as Error);
			throw error;
		}
	}

	async embed(
		request: IEmbeddingRequest,
		token?: CancellationToken
	): Promise<IEmbeddingResponse> {
		if (!this._client || !this.isEmbeddingModel()) {
			throw new Error('Ollama client not initialized or model does not support embeddings');
		}

		try {
			const inputs = Array.isArray(request.input) ? request.input : [request.input];
			const responses = await Promise.all(
				inputs.map(input => this._client!.embeddings({
					model: this.configuration.modelId,
					prompt: input
				}))
			);

			return {
				embeddings: responses.map(response => response.embedding),
				model: this.configuration.modelId,
				usage: {
					promptTokens: inputs.reduce((sum, input) => sum + this.estimateTokens(input), 0),
					totalTokens: inputs.reduce((sum, input) => sum + this.estimateTokens(input), 0)
				}
			};
		} catch (error) {
			this._onError.fire(error as Error);
			throw error;
		}
	}

	private isEmbeddingModel(): boolean {
		const modelId = this.configuration.modelId.toLowerCase();
		return modelId.includes('embed') ||
			modelId.includes('nomic-embed') ||
			modelId.includes('snowflake');
	}

	private isVisionModel(): boolean {
		const modelId = this.configuration.modelId.toLowerCase();
		return modelId.includes('llava') ||
			modelId.includes('bakllava') ||
			modelId.includes('moondream');
	}

	private getMaxContextLength(): number {
		const modelId = this.configuration.modelId.toLowerCase();

		if (modelId.includes('llama2:70b')) return 4096;
		if (modelId.includes('llama2:13b')) return 4096;
		if (modelId.includes('llama2:7b')) return 4096;
		if (modelId.includes('codellama:34b')) return 16384;
		if (modelId.includes('codellama:13b')) return 16384;
		if (modelId.includes('codellama:7b')) return 16384;
		if (modelId.includes('mistral:7b')) return 8192;
		if (modelId.includes('orca-mini')) return 2048;
		if (modelId.includes('phi')) return 2048;

		return 4096; // Default
	}

	private getMaxOutputTokens(): number {
		return Math.min(1024, this.getMaxContextLength() / 4);
	}

	private getSupportedInputTypes(): string[] {
		const types = ['text'];
		if (this.isVisionModel()) types.push('image');
		return types;
	}

	private getSupportedOutputTypes(): string[] {
		return ['text'];
	}

	private extractImages(message: IChatMessage): string[] | undefined {
		if (typeof message.content === 'string') {
			return undefined;
		}

		return message.content
			.filter(part => part.type === 'image' && typeof part.content === 'string')
			.map(part => part.content as string);
	}

	private estimateTokens(text: string): number {
		// Rough estimation: 1 token ≈ 4 characters for most models
		return Math.ceil(text.length / 4);
	}

	dispose(): void {
		this._client = null;
		this._isLoaded = false;
		this._localModels = [];
		this._onUnload.fire();
		super.dispose();
	}
}
