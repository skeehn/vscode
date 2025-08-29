/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';

export interface IMemoryEntry {
	readonly id: string;
	readonly type: 'conversation' | 'task' | 'decision' | 'learning' | 'error' | 'insight';
	readonly content: string;
	readonly summary?: string;
	readonly metadata: Record<string, any>;
	readonly embedding: number[];
	readonly timestamp: Date;
	readonly importance: number;
	readonly confidence: number;
	readonly context: string;
	readonly tags: readonly string[];
	readonly relatedEntries: readonly string[];
	readonly source: URI;
}

export interface IMemoryQuery {
	readonly query: string;
	readonly type?: IMemoryEntry['type'];
	readonly tags?: readonly string[];
	readonly dateRange?: {
		start: Date;
		end: Date;
	};
	readonly minImportance?: number;
	readonly minConfidence?: number;
	readonly context?: string;
	readonly limit?: number;
	readonly offset?: number;
}

export interface IMemorySearchResult {
	readonly entries: readonly IMemoryEntry[];
	readonly totalCount: number;
	readonly score: number;
	readonly facets: {
		readonly types: Record<string, number>;
		readonly tags: Record<string, number>;
		readonly dates: readonly { date: string; count: number }[];
	};
}

export interface IMemoryStore extends IDisposable {
	readonly onEntryAdded: Event<IMemoryEntry>;
	readonly onEntryUpdated: Event<IMemoryEntry>;
	readonly onEntryRemoved: Event<string>;

	addEntry(entry: Omit<IMemoryEntry, 'id' | 'timestamp'>): Promise<string>;
	addEntries(entries: readonly Omit<IMemoryEntry, 'id' | 'timestamp'>[]): Promise<readonly string[]>;
	updateEntry(id: string, updates: Partial<IMemoryEntry>): Promise<void>;
	removeEntry(id: string): Promise<void>;

	getEntry(id: string): Promise<IMemoryEntry | undefined>;
	search(query: IMemoryQuery): Promise<IMemorySearchResult>;
	getRelatedEntries(id: string, limit?: number): Promise<readonly IMemoryEntry[]>;

	getEntriesByType(type: IMemoryEntry['type'], limit?: number): Promise<readonly IMemoryEntry[]>;
	getEntriesByTag(tag: string, limit?: number): Promise<readonly IMemoryEntry[]>;
	getEntriesByContext(context: string, limit?: number): Promise<readonly IMemoryEntry[]>;
	getEntriesByDateRange(start: Date, end: Date, limit?: number): Promise<readonly IMemoryEntry[]>;

	getRecentEntries(limit?: number): Promise<readonly IMemoryEntry[]>;
	getImportantEntries(threshold?: number, limit?: number): Promise<readonly IMemoryEntry[]>;

	consolidateEntries(entries: readonly IMemoryEntry[]): Promise<IMemoryEntry>;
	compressOldEntries(threshold: Date): Promise<number>;

	getStatistics(): Promise<IMemoryStatistics>;
	optimize(): Promise<void>;
}

export interface IMemoryStatistics {
	readonly totalEntries: number;
	readonly entriesByType: Record<string, number>;
	readonly entriesByTag: Record<string, number>;
	readonly averageImportance: number;
	readonly averageConfidence: number;
	readonly oldestEntry: Date;
	readonly newestEntry: Date;
	readonly storageSize: number;
	readonly compressionRatio: number;
}

export interface IConversationMemory {
	readonly conversationId: string;
	readonly messages: readonly IConversationMessage[];
	readonly summary?: string;
	readonly topics: readonly string[];
	readonly participants: readonly string[];
	readonly startTime: Date;
	readonly endTime?: Date;
	readonly metadata: Record<string, any>;
}

export interface IConversationMessage {
	readonly id: string;
	readonly role: 'user' | 'assistant' | 'system';
	readonly content: string;
	readonly timestamp: Date;
	readonly metadata?: Record<string, any>;
	readonly toolCalls?: readonly IToolCall[];
	readonly toolResults?: readonly IToolResult[];
}

export interface IToolCall {
	readonly id: string;
	readonly name: string;
	readonly arguments: Record<string, any>;
	readonly timestamp: Date;
}

export interface IToolResult {
	readonly callId: string;
	readonly success: boolean;
	readonly result: any;
	readonly error?: string;
	readonly timestamp: Date;
}

export interface ITaskMemory {
	readonly taskId: string;
	readonly description: string;
	readonly steps: readonly ITaskStep[];
	readonly result?: any;
	readonly error?: string;
	readonly startTime: Date;
	readonly endTime?: Date;
	readonly metadata: Record<string, any>;
}

export interface ITaskStep {
	readonly id: string;
	readonly description: string;
	readonly action: string;
	readonly parameters: Record<string, any>;
	readonly result?: any;
	readonly error?: string;
	readonly startTime: Date;
	readonly endTime?: Date;
	readonly duration?: number;
}

export interface ILearningMemory {
	readonly id: string;
	readonly type: 'pattern' | 'insight' | 'lesson' | 'improvement';
	readonly content: string;
	readonly context: string;
	readonly confidence: number;
	readonly applicability: readonly string[];
	readonly examples: readonly string[];
	readonly timestamp: Date;
	readonly metadata: Record<string, any>;
}

export interface IMemoryManager extends IDisposable {
	readonly store: IMemoryStore;

	readonly onConversationStarted: Event<string>;
	readonly onConversationEnded: Event<string>;
	readonly onTaskStarted: Event<string>;
	readonly onTaskCompleted: Event<string>;

	recordConversation(message: Omit<IConversationMessage, 'id' | 'timestamp'>): Promise<string>;
	recordTask(task: Omit<ITaskMemory, 'taskId'>): Promise<string>;
	recordLearning(learning: Omit<ILearningMemory, 'id' | 'timestamp'>): Promise<string>;
	recordError(error: Error, context: string): Promise<string>;

	getConversation(conversationId: string): Promise<IConversationMemory | undefined>;
	getTask(taskId: string): Promise<ITaskMemory | undefined>;
	getLearning(learningId: string): Promise<ILearningMemory | undefined>;

	searchConversations(query: string, limit?: number): Promise<readonly IConversationMemory[]>;
	searchTasks(query: string, limit?: number): Promise<readonly ITaskMemory[]>;
	searchLearnings(query: string, limit?: number): Promise<readonly ILearningMemory[]>;

	getConversationsByParticipant(participant: string, limit?: number): Promise<readonly IConversationMemory[]>;
	getTasksByStatus(status: 'running' | 'completed' | 'failed', limit?: number): Promise<readonly ITaskMemory[]>;
	getLearningsByType(type: ILearningMemory['type'], limit?: number): Promise<readonly ILearningMemory[]>;

	summarizeConversation(conversationId: string): Promise<string>;
	summarizeTask(taskId: string): Promise<string>;
	extractInsights(conversationId: string): Promise<readonly string[]>;

	getMemoryContext(query: string, limit?: number): Promise<IMemoryContext>;
}

export interface IMemoryContext {
	readonly relevantConversations: readonly IConversationMemory[];
	readonly relevantTasks: readonly ITaskMemory[];
	readonly relevantLearnings: readonly ILearningMemory[];
	readonly insights: readonly string[];
	readonly patterns: readonly string[];
	readonly confidence: number;
}

export interface IMemoryConfiguration {
	readonly storage: {
		readonly type: 'memory' | 'file' | 'database';
		readonly path?: string;
		readonly connectionString?: string;
	};
	readonly embedding: {
		readonly model: string;
		readonly dimensions: number;
	};
	readonly retention: {
		readonly conversationDays: number;
		readonly taskDays: number;
		readonly learningDays: number;
		readonly compressionThreshold: number;
	};
	readonly indexing: {
		readonly chunkSize: number;
		readonly chunkOverlap: number;
		readonly batchSize: number;
	};
	readonly search: {
		readonly defaultLimit: number;
		readonly similarityThreshold: number;
		readonly maxResults: number;
	};
}

export const IMemoryManager = Symbol('IMemoryManager');
export const IMemoryStore = Symbol('IMemoryStore');
