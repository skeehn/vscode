/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';

export interface IPromptTemplate {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly version: string;
	readonly author: string;
	readonly createdAt: Date;
	readonly updatedAt: Date;

	readonly template: string;
	readonly variables: readonly IPromptVariable[];
	readonly examples: readonly IPromptExample[];
	readonly metadata: Record<string, any>;

	readonly category: string;
	readonly tags: readonly string[];
	readonly complexity: 'simple' | 'medium' | 'complex' | 'expert';

	readonly requiredCapabilities: readonly string[];
	readonly supportedModels: readonly string[];
}

export interface IPromptVariable {
	readonly name: string;
	readonly type: 'string' | 'number' | 'boolean' | 'object' | 'array';
	readonly description: string;
	readonly required: boolean;
	readonly defaultValue?: any;
	readonly validation?: IPromptValidation;
	readonly examples: readonly any[];
}

export interface IPromptValidation {
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly pattern?: string;
	readonly enum?: readonly any[];
	readonly custom?: (value: any) => boolean;
}

export interface IPromptExample {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly variables: Record<string, any>;
	readonly expectedOutput: string;
	readonly tags: readonly string[];
}

export interface ICompiledPrompt {
	readonly template: IPromptTemplate;
	readonly variables: Record<string, any>;
	readonly renderedPrompt: string;
	readonly metadata: {
		readonly compiledAt: Date;
		readonly variableCount: number;
		readonly tokenEstimate: number;
		readonly warnings: readonly string[];
	};
}

export interface IPromptChain {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly steps: readonly IPromptChainStep[];
	readonly metadata: Record<string, any>;
}

export interface IPromptChainStep {
	readonly id: string;
	readonly name: string;
	readonly templateId: string;
	readonly condition?: string;
	readonly inputMapping: Record<string, string>;
	readonly outputMapping: Record<string, string>;
	readonly retryPolicy?: IPromptRetryPolicy;
}

export interface IPromptRetryPolicy {
	readonly maxRetries: number;
	readonly backoffStrategy: 'fixed' | 'exponential' | 'linear';
	readonly baseDelay: number;
	readonly maxDelay: number;
	readonly retryCondition?: (output: string) => boolean;
}

export interface IPromptEngine {
	compile(template: IPromptTemplate, variables: Record<string, any>): Promise<ICompiledPrompt>;
	render(template: IPromptTemplate, variables: Record<string, any>): string;

	validateVariables(template: IPromptTemplate, variables: Record<string, any>): IPromptValidationResult;
	estimateTokens(prompt: string): number;

	executeChain(chain: IPromptChain, initialVariables: Record<string, any>): Promise<IPromptChainResult>;
}

export interface IPromptValidationResult {
	readonly valid: boolean;
	readonly errors: readonly string[];
	readonly warnings: readonly string[];
	readonly suggestions: readonly string[];
}

export interface IPromptChainResult {
	readonly success: boolean;
	readonly steps: readonly IPromptChainStepResult[];
	readonly finalOutput: string;
	readonly totalTokens: number;
	readonly executionTime: number;
	readonly errors: readonly string[];
}

export interface IPromptChainStepResult {
	readonly stepId: string;
	readonly success: boolean;
	readonly input: Record<string, any>;
	readonly output: string;
	readonly tokens: number;
	readonly executionTime: number;
	readonly retryCount: number;
	readonly error?: string;
}

export interface IPromptLibrary {
	readonly templates: readonly IPromptTemplate[];
	readonly chains: readonly IPromptChain[];

	readonly onTemplateAdded: Event<IPromptTemplate>;
	readonly onTemplateUpdated: Event<IPromptTemplate>;
	readonly onChainAdded: Event<IPromptChain>;
	readonly onChainUpdated: Event<IPromptChain>;

	addTemplate(template: Omit<IPromptTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>;
	updateTemplate(id: string, updates: Partial<IPromptTemplate>): Promise<void>;
	removeTemplate(id: string): Promise<void>;

	addChain(chain: Omit<IPromptChain, 'id'>): Promise<string>;
	updateChain(id: string, updates: Partial<IPromptChain>): Promise<void>;
	removeChain(id: string): Promise<void>;

	getTemplate(id: string): IPromptTemplate | undefined;
	getChain(id: string): IPromptChain | undefined;

	searchTemplates(query: string, filters?: IPromptSearchFilters): Promise<readonly IPromptTemplate[]>;
	searchChains(query: string, filters?: IPromptSearchFilters): Promise<readonly IPromptChain[]>;

	importTemplates(uri: URI): Promise<readonly string[]>;
	exportTemplate(id: string, uri: URI): Promise<void>;
	importChains(uri: URI): Promise<readonly string[]>;
	exportChain(id: string, uri: URI): Promise<void>;
}

export interface IPromptSearchFilters {
	readonly category?: string;
	readonly tags?: readonly string[];
	readonly complexity?: IPromptTemplate['complexity'];
	readonly author?: string;
	readonly capabilities?: readonly string[];
	readonly models?: readonly string[];
	readonly dateRange?: {
		start: Date;
		end: Date;
	};
}

export interface IPromptOptimizer {
	optimizePrompt(template: IPromptTemplate, targetModel: string): Promise<IPromptTemplate>;
	optimizeChain(chain: IPromptChain, targetModel: string): Promise<IPromptChain>;

	analyzePerformance(template: IPromptTemplate, results: readonly IPromptPerformanceResult[]): Promise<IPromptAnalysis>;
	suggestImprovements(template: IPromptTemplate, analysis: IPromptAnalysis): Promise<readonly string[]>;

	generateVariations(template: IPromptTemplate, count: number): Promise<readonly IPromptTemplate[]>;
	compareTemplates(templates: readonly IPromptTemplate[], testCases: readonly string[]): Promise<IPromptComparison>;
}

export interface IPromptPerformanceResult {
	readonly templateId: string;
	readonly input: string;
	readonly output: string;
	readonly tokens: number;
	readonly executionTime: number;
	readonly quality: number; // 0-1 score
	readonly metadata: Record<string, any>;
}

export interface IPromptAnalysis {
	readonly clarity: number;
	readonly specificity: number;
	readonly efficiency: number;
	readonly robustness: number;
	readonly strengths: readonly string[];
	readonly weaknesses: readonly string[];
	readonly recommendations: readonly string[];
}

export interface IPromptComparison {
	readonly templates: readonly {
		readonly id: string;
		readonly averageQuality: number;
		readonly averageTokens: number;
		readonly averageTime: number;
		readonly winRate: number;
	}[];
	readonly bestTemplate: string;
	readonly insights: readonly string[];
}

export interface IPromptManager {
	readonly library: IPromptLibrary;
	readonly engine: IPromptEngine;
	readonly optimizer: IPromptOptimizer;

	initialize(): Promise<void>;

	loadBuiltInPrompts(): Promise<void>;
	createPromptFromTask(description: string, context: string): Promise<IPromptTemplate>;
	createChainFromWorkflow(steps: readonly string[]): Promise<IPromptChain>;

	getPromptForTask(taskType: string, context: Record<string, any>): Promise<IPromptTemplate>;
	getChainForWorkflow(workflowType: string): Promise<IPromptChain>;

	optimizeForModel(template: IPromptTemplate, modelId: string): Promise<IPromptTemplate>;
	testPrompt(template: IPromptTemplate, testCases: readonly string[]): Promise<IPromptPerformanceResult[]>;
}

export const IPromptManager = Symbol('IPromptManager');
export const IPromptLibrary = Symbol('IPromptLibrary');
export const IPromptEngine = Symbol('IPromptEngine');
export const IPromptOptimizer = Symbol('IPromptOptimizer');
