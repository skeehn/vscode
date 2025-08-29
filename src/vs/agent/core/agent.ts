/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { IAgentTask } from '../tasks/task.js';
import { IAgentMemory } from '../memory/memory.js';
import { IAgentModel } from '../models/model.js';
import { IAgentAPI } from '../api/api.js';
import { IAgentPrompt } from '../prompts/prompt.js';

export interface IAgentCapabilities {
	readonly supportsMultiModal: boolean;
	readonly supportsToolUse: boolean;
	readonly supportsPlanning: boolean;
	readonly supportsMemory: boolean;
	readonly supportsAPIs: boolean;
	readonly maxContextLength: number;
	readonly supportedModels: string[];
}

export interface IAgentConfiguration {
	readonly model: string;
	readonly temperature: number;
	readonly maxTokens: number;
	readonly systemPrompt: string;
	readonly tools: string[];
	readonly apis: string[];
	readonly memory: {
		enabled: boolean;
		type: 'local' | 'vector' | 'graph' | 'hybrid';
	};
	readonly reasoning: {
		enabled: boolean;
		strategy: 'cot' | 'tot' | 'planning' | 'hybrid';
	};
}

export interface IAgentContext {
	readonly workspace: URI;
	readonly activeEditor?: URI;
	readonly selection?: string;
	readonly visibleFiles: URI[];
	readonly gitStatus?: any;
	readonly terminalContent?: string;
}

export interface IAgentExecutionResult {
	readonly success: boolean;
	readonly output: string;
	readonly actions: IAgentAction[];
	readonly reasoning: string;
	readonly confidence: number;
	readonly executionTime: number;
}

export interface IAgentAction {
	readonly type: 'edit' | 'command' | 'api' | 'search' | 'navigate';
	readonly description: string;
	readonly parameters: Record<string, any>;
	readonly result?: any;
}

export interface IAgent extends IDisposable {
	readonly id: string;
	readonly name: string;
	readonly capabilities: IAgentCapabilities;
	readonly configuration: IAgentConfiguration;

	readonly onTaskStart: Event<IAgentTask>;
	readonly onTaskComplete: Event<IAgentTask>;
	readonly onAction: Event<IAgentAction>;

	initialize(): Promise<void>;
	execute(task: IAgentTask, context: IAgentContext): Promise<IAgentExecutionResult>;
	stop(): Promise<void>;

	updateConfiguration(config: Partial<IAgentConfiguration>): Promise<void>;
	getStatus(): Promise<IAgentStatus>;
}

export interface IAgentStatus {
	readonly isRunning: boolean;
	readonly currentTask?: IAgentTask;
	readonly memoryUsage: number;
	readonly modelLoaded: boolean;
	readonly apiConnections: number;
}

export interface IAgentService {
	readonly agents: readonly IAgent[];

	createAgent(config: IAgentConfiguration): Promise<IAgent>;
	getAgent(id: string): IAgent | undefined;
	removeAgent(id: string): Promise<void>;

	startAgent(id: string): Promise<void>;
	stopAgent(id: string): Promise<void>;
}

export const IAgentService = Symbol('IAgentService');
