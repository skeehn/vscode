/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../base/common/cancellation.js';

export interface IModelCapabilities {
	readonly supportsChat: boolean;
	readonly supportsCompletion: boolean;
	readonly supportsEmbedding: boolean;
	readonly supportsVision: boolean;
	readonly supportsAudio: boolean;
	readonly supportsFunctionCalling: boolean;
	readonly maxContextLength: number;
	readonly maxOutputTokens: number;
	readonly supportedInputTypes: readonly string[];
	readonly supportedOutputTypes: readonly string[];
}

export interface IModelConfiguration {
	readonly modelId: string;
	readonly provider: 'huggingface' | 'ollama' | 'openai' | 'anthropic' | 'google' | 'local';
	readonly endpoint?: string;
	readonly apiKey?: string;
	readonly temperature: number;
	readonly topP: number;
	readonly maxTokens: number;
	readonly stopSequences: readonly string[];
	readonly parameters: Record<string, any>;
}

export interface IChatMessage {
	readonly role: 'system' | 'user' | 'assistant' | 'tool';
	readonly content: string | readonly IChatContent[];
	readonly name?: string;
	readonly toolCallId?: string;
	readonly metadata?: Record<string, any>;
}

export interface IChatContent {
	readonly type: 'text' | 'image' | 'audio' | 'video' | 'file';
	readonly content: string | Uint8Array;
	readonly mimeType?: string;
	readonly metadata?: Record<string, any>;
}

export interface IFunctionDefinition {
	readonly name: string;
	readonly description: string;
	readonly parameters: Record<string, any>;
	readonly required?: readonly string[];
}

export interface IToolCall {
	readonly id: string;
	readonly function: {
		readonly name: string;
		readonly arguments: string;
	};
}

export interface IChatResponse {
	readonly content: string;
	readonly role: 'assistant';
	readonly toolCalls?: readonly IToolCall[];
	readonly finishReason: 'stop' | 'length' | 'function_call' | 'content_filter';
	readonly usage?: {
		readonly promptTokens: number;
		readonly completionTokens: number;
		readonly totalTokens: number;
	};
	readonly metadata?: Record<string, any>;
}

export interface ICompletionRequest {
	readonly prompt: string;
	readonly suffix?: string;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly topP?: number;
	readonly stopSequences?: readonly string[];
	readonly stream?: boolean;
	readonly functions?: readonly IFunctionDefinition[];
	readonly metadata?: Record<string, any>;
}

export interface ICompletionResponse {
	readonly text: string;
	readonly finishReason: 'stop' | 'length' | 'function_call';
	readonly usage?: {
		readonly promptTokens: number;
		readonly completionTokens: number;
		readonly totalTokens: number;
	};
}

export interface IEmbeddingRequest {
	readonly input: string | readonly string[];
	readonly model?: string;
	readonly user?: string;
}

export interface IEmbeddingResponse {
	readonly embeddings: readonly number[][];
	readonly model: string;
	readonly usage?: {
		readonly promptTokens: number;
		readonly totalTokens: number;
	};
}

export interface IAgentModel extends IDisposable {
	readonly id: string;
	readonly configuration: IModelConfiguration;
	readonly capabilities: IModelCapabilities;

	readonly onLoad: Event<void>;
	readonly onUnload: Event<void>;
	readonly onError: Event<Error>;

	initialize(): Promise<void>;
	isLoaded(): boolean;

	chat(
		messages: readonly IChatMessage[],
		options?: {
			temperature?: number;
			maxTokens?: number;
			functions?: readonly IFunctionDefinition[];
			stream?: boolean;
		},
		token?: CancellationToken
	): Promise<IChatResponse>;

	complete(
		request: ICompletionRequest,
		token?: CancellationToken
	): Promise<ICompletionResponse>;

	embed(
		request: IEmbeddingRequest,
		token?: CancellationToken
	): Promise<IEmbeddingResponse>;

	generateImage?(
		prompt: string,
		options?: {
			size?: string;
			style?: string;
			quality?: string;
		},
		token?: CancellationToken
	): Promise<Uint8Array>;

	generateAudio?(
		text: string,
		options?: {
			voice?: string;
			speed?: number;
			format?: string;
		},
		token?: CancellationToken
	): Promise<Uint8Array>;
}

export interface IHuggingFaceModel extends IAgentModel {
	readonly modelId: string;
	loadFromHuggingFace(): Promise<void>;
}

export interface IOllamaModel extends IAgentModel {
	readonly modelName: string;
	pullModel(): Promise<void>;
	listLocalModels(): Promise<readonly string[]>;
}

export interface IModelProvider {
	readonly name: string;
	readonly supportedModels: readonly string[];

	createModel(config: IModelConfiguration): Promise<IAgentModel>;
	listAvailableModels(): Promise<readonly string[]>;
	validateConfig(config: IModelConfiguration): Promise<boolean>;
}

export interface IModelManager {
	readonly providers: readonly IModelProvider[];
	readonly loadedModels: readonly IAgentModel[];

	readonly onModelLoaded: Event<IAgentModel>;
	readonly onModelUnloaded: Event<string>;
	readonly onProviderAdded: Event<IModelProvider>;

	registerProvider(provider: IModelProvider): void;
	unregisterProvider(name: string): void;

	createModel(config: IModelConfiguration): Promise<IAgentModel>;
	loadModel(id: string): Promise<IAgentModel>;
	unloadModel(id: string): Promise<void>;

	getModel(id: string): IAgentModel | undefined;
	getModelsByProvider(provider: string): readonly IAgentModel[];
	getModelsByCapability(capability: keyof IModelCapabilities): readonly IAgentModel[];

	preloadModels(modelIds: readonly string[]): Promise<void>;
	optimizeMemory(): Promise<void>;
}

export const IModelManager = Symbol('IModelManager');
