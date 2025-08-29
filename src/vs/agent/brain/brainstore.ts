/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';

export interface IKnowledgeNode {
	readonly id: string;
	readonly type: 'concept' | 'entity' | 'fact' | 'pattern' | 'relationship';
	readonly content: string;
	readonly metadata: Record<string, any>;
	readonly embedding: number[];
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly confidence: number;
	readonly source: URI;
	readonly tags: readonly string[];
}

export interface IKnowledgeEdge {
	readonly id: string;
	readonly sourceId: string;
	readonly targetId: string;
	readonly type: 'relates_to' | 'depends_on' | 'implements' | 'extends' | 'references' | 'similar_to';
	readonly weight: number;
	readonly properties: Record<string, any>;
	readonly createdAt: Date;
}

export interface IKnowledgeGraph {
	readonly nodes: readonly IKnowledgeNode[];
	readonly edges: readonly IKnowledgeEdge[];

	addNode(node: Omit<IKnowledgeNode, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>;
	addEdge(edge: Omit<IKnowledgeEdge, 'id' | 'createdAt'>): Promise<string>;
	removeNode(nodeId: string): Promise<void>;
	removeEdge(edgeId: string): Promise<void>;

	getNode(nodeId: string): Promise<IKnowledgeNode | undefined>;
	getNodesByType(type: IKnowledgeNode['type']): Promise<readonly IKnowledgeNode[]>;
	getNeighbors(nodeId: string): Promise<readonly IKnowledgeNode[]>;
	getPath(startId: string, endId: string): Promise<readonly IKnowledgeNode[]>;

	searchSimilar(query: string, limit?: number): Promise<readonly IKnowledgeNode[]>;
	searchByTags(tags: readonly string[]): Promise<readonly IKnowledgeNode[]>;
}

export interface IMemoryEntry {
	readonly id: string;
	readonly type: 'conversation' | 'task' | 'decision' | 'learning' | 'error';
	readonly content: string;
	readonly metadata: Record<string, any>;
	readonly embedding: number[];
	readonly timestamp: Date;
	readonly importance: number;
	readonly context: string;
	readonly relatedEntries: readonly string[];
}

export interface IVectorStore {
	addEntry(entry: Omit<IMemoryEntry, 'id' | 'timestamp'>): Promise<string>;
	addEntries(entries: readonly Omit<IMemoryEntry, 'id' | 'timestamp'>[]): Promise<readonly string[]>;
	removeEntry(id: string): Promise<void>;
	getEntry(id: string): Promise<IMemoryEntry | undefined>;
	searchSimilar(query: string, limit?: number, threshold?: number): Promise<readonly IMemoryEntry[]>;
	searchByType(type: IMemoryEntry['type'], limit?: number): Promise<readonly IMemoryEntry[]>;
	searchByContext(context: string, limit?: number): Promise<readonly IMemoryEntry[]>;
}

export interface IBrainStore extends IDisposable {
	readonly knowledgeGraph: IKnowledgeGraph;
	readonly vectorStore: IVectorStore;

	readonly onKnowledgeAdded: Event<IKnowledgeNode>;
	readonly onMemoryAdded: Event<IMemoryEntry>;

	initialize(): Promise<void>;
	indexWorkspace(workspace: URI): Promise<void>;
	indexFile(file: URI): Promise<void>;
	indexConversation(messages: readonly IConversationMessage[]): Promise<void>;

	retrieve(query: string, context?: IRetrievalContext): Promise<IRetrievalResult>;
	reason(query: string, context?: IReasoningContext): Promise<IReasoningResult>;

	learn(pattern: string, context: string): Promise<void>;
	forget(pattern: string): Promise<void>;

	getStatistics(): Promise<IBrainStatistics>;
	optimize(): Promise<void>;
}

export interface IConversationMessage {
	readonly role: 'user' | 'assistant' | 'system';
	readonly content: string;
	readonly timestamp: Date;
	readonly metadata?: Record<string, any>;
}

export interface IRetrievalContext {
	readonly maxResults?: number;
	readonly types?: readonly IKnowledgeNode['type'][];
	readonly tags?: readonly string[];
	readonly timeRange?: {
		start: Date;
		end: Date;
	};
	readonly sources?: readonly URI[];
}

export interface IRetrievalResult {
	readonly nodes: readonly IKnowledgeNode[];
	readonly memories: readonly IMemoryEntry[];
	readonly score: number;
	readonly reasoning: string;
}

export interface IReasoningContext {
	readonly depth?: number;
	readonly breadth?: number;
	readonly strategy?: 'dfs' | 'bfs' | 'hybrid';
	readonly maxIterations?: number;
}

export interface IReasoningResult {
	readonly conclusion: string;
	readonly confidence: number;
	readonly reasoning: readonly string[];
	readonly evidence: readonly IKnowledgeNode[];
	readonly relatedNodes: readonly IKnowledgeNode[];
}

export interface IBrainStatistics {
	readonly totalNodes: number;
	readonly totalEdges: number;
	readonly totalMemories: number;
	readonly storageSize: number;
	readonly averageConfidence: number;
	readonly knowledgeDomains: readonly {
		domain: string;
		nodeCount: number;
	}[];
}

export interface IBrainStoreConfiguration {
	readonly embedding: {
		model: string;
		dimensions: number;
	};
	readonly vectorStore: {
		type: 'chroma' | 'faiss' | 'pinecone' | 'weaviate' | 'redis';
		config: Record<string, any>;
	};
	readonly graphStore: {
		type: 'memory' | 'persistent';
		config: Record<string, any>;
	};
	readonly indexing: {
		maxFileSize: number;
		supportedExtensions: readonly string[];
		chunkSize: number;
		chunkOverlap: number;
	};
	readonly reasoning: {
		maxDepth: number;
		maxBreadth: number;
		confidenceThreshold: number;
	};
}

export const IBrainStore = Symbol('IBrainStore');
