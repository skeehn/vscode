/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { pipeline, Pipeline } from '@huggingface/transformers';
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
	IHuggingFaceModel
} from './model.js';

export class HuggingFaceModel extends Disposable implements IHuggingFaceModel {
	private readonly _onLoad = this._register(new EventEmitter<void>());
	readonly onLoad = this._onLoad.event;

	private readonly _onUnload = this._register(new EventEmitter<void>());
	readonly onUnload = this._onUnload.event;

	private readonly _onError = this._register(new EventEmitter<Error>());
	readonly onError = this._onError.event;

	private _pipeline: Pipeline | null = null;
	private _isLoaded = false;

	constructor(
		readonly id: string,
		readonly configuration: IModelConfiguration
	) {
		super();
	}

	get capabilities(): IModelCapabilities {
		return {
			supportsChat: this.isTextGenerationModel(),
			supportsCompletion: this.isTextGenerationModel(),
			supportsEmbedding: this.isEmbeddingModel(),
			supportsVision: this.isVisionModel(),
			supportsAudio: this.isAudioModel(),
			supportsFunctionCalling: false, // Hugging Face models don't natively support function calling
			maxContextLength: this.getMaxContextLength(),
			maxOutputTokens: this.getMaxOutputTokens(),
			supportedInputTypes: this.getSupportedInputTypes(),
			supportedOutputTypes: this.getSupportedOutputTypes()
		};
	}

	async initialize(): Promise<void> {
		try {
			await this.loadFromHuggingFace();
		} catch (error) {
			this._onError.fire(error as Error);
			throw error;
		}
	}

	isLoaded(): boolean {
		return this._isLoaded;
	}

	async loadFromHuggingFace(): Promise<void> {
		if (this._isLoaded) {
			return;
		}

		try {
			this._pipeline = await pipeline(this.configuration.modelId, {
				...this.configuration.parameters,
				device: 'auto',
				dtype: 'auto'
			});

			this._isLoaded = true;
			this._onLoad.fire();
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
		if (!this._pipeline || !this.isTextGenerationModel()) {
			throw new Error('Model not loaded or not a text generation model');
		}

		const prompt = this.convertMessagesToPrompt(messages);
		const generationOptions = {
			temperature: options?.temperature ?? this.configuration.temperature,
			max_new_tokens: options?.maxTokens ?? this.configuration.maxTokens,
			do_sample: true,
			pad_token_id: this._pipeline.tokenizer.pad_token_id ?? null,
			...this.configuration.parameters
		};

		try {
			const output = await this._pipeline(prompt, generationOptions);
			const generatedText = this.extractGeneratedText(output, prompt);

			return {
				content: generatedText,
				role: 'assistant',
				finishReason: 'stop',
				usage: {
					promptTokens: this.estimateTokens(prompt),
					completionTokens: this.estimateTokens(generatedText),
					totalTokens: this.estimateTokens(prompt + generatedText)
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
		if (!this._pipeline || !this.isTextGenerationModel()) {
			throw new Error('Model not loaded or not a text generation model');
		}

		const generationOptions = {
			temperature: request.temperature ?? this.configuration.temperature,
			max_new_tokens: request.maxTokens ?? this.configuration.maxTokens,
			do_sample: true,
			pad_token_id: this._pipeline.tokenizer.pad_token_id ?? null,
			...this.configuration.parameters
		};

		try {
			const output = await this._pipeline(request.prompt, generationOptions);
			const generatedText = this.extractGeneratedText(output, request.prompt);

			return {
				text: generatedText,
				finishReason: 'stop',
				usage: {
					promptTokens: this.estimateTokens(request.prompt),
					completionTokens: this.estimateTokens(generatedText),
					totalTokens: this.estimateTokens(request.prompt + generatedText)
				}
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
		if (!this._pipeline || !this.isEmbeddingModel()) {
			throw new Error('Model not loaded or not an embedding model');
		}

		try {
			const inputs = Array.isArray(request.input) ? request.input : [request.input];
			const outputs = await Promise.all(
				inputs.map(input => this._pipeline!(input, { pooling: 'mean', normalize: true }))
			);

			const embeddings = outputs.map(output => Array.from(output.data));

			return {
				embeddings,
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

	private isTextGenerationModel(): boolean {
		const modelId = this.configuration.modelId.toLowerCase();
		return modelId.includes('gpt') ||
			modelId.includes('llama') ||
			modelId.includes('mistral') ||
			modelId.includes('falcon') ||
			modelId.includes('opt') ||
			modelId.includes('bloom');
	}

	private isEmbeddingModel(): boolean {
		const modelId = this.configuration.modelId.toLowerCase();
		return modelId.includes('embed') ||
			modelId.includes('sentence') ||
			modelId.includes('bert') ||
			modelId.includes('roberta');
	}

	private isVisionModel(): boolean {
		const modelId = this.configuration.modelId.toLowerCase();
		return modelId.includes('vision') ||
			modelId.includes('clip') ||
			modelId.includes('blip') ||
			modelId.includes('vit');
	}

	private isAudioModel(): boolean {
		const modelId = this.configuration.modelId.toLowerCase();
		return modelId.includes('whisper') ||
			modelId.includes('wav2vec') ||
			modelId.includes('hubert');
	}

	private getMaxContextLength(): number {
		const modelId = this.configuration.modelId.toLowerCase();

		if (modelId.includes('gpt-4')) return 8192;
		if (modelId.includes('gpt-3.5')) return 4096;
		if (modelId.includes('llama-2-70b')) return 4096;
		if (modelId.includes('llama-2-13b')) return 4096;
		if (modelId.includes('llama-2-7b')) return 4096;
		if (modelId.includes('mistral-7b')) return 8192;
		if (modelId.includes('falcon-40b')) return 2048;
		if (modelId.includes('opt-30b')) return 2048;

		return 2048; // Default
	}

	private getMaxOutputTokens(): number {
		return Math.min(1024, this.getMaxContextLength() / 2);
	}

	private getSupportedInputTypes(): string[] {
		const types = ['text'];
		if (this.isVisionModel()) types.push('image');
		if (this.isAudioModel()) types.push('audio');
		return types;
	}

	private getSupportedOutputTypes(): string[] {
		const types = ['text'];
		if (this.isVisionModel()) types.push('image');
		return types;
	}

	private convertMessagesToPrompt(messages: readonly IChatMessage[]): string {
		return messages.map(msg => {
			switch (msg.role) {
				case 'system':
					return `System: ${msg.content}`;
				case 'user':
					return `User: ${msg.content}`;
				case 'assistant':
					return `Assistant: ${msg.content}`;
				default:
					return msg.content;
			}
		}).join('\n\n');
	}

	private extractGeneratedText(output: any, prompt: string): string {
		if (typeof output === 'string') {
			return output;
		}

		if (Array.isArray(output) && output.length > 0) {
			const generated = output[0].generated_text || output[0].text || '';
			return generated.replace(prompt, '').trim();
		}

		return '';
	}

	private estimateTokens(text: string): number {
		// Rough estimation: 1 token ≈ 4 characters for most models
		return Math.ceil(text.length / 4);
	}

	dispose(): void {
		this._pipeline = null;
		this._isLoaded = false;
		this._onUnload.fire();
		super.dispose();
	}
}
