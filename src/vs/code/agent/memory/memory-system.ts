/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { IAgentRequest, IAgentResponse } from '../agent-orchestrator.js';

export interface IMemoryEntry {
	id: string;
	type: 'conversation' | 'knowledge' | 'pattern' | 'context';
	content: any;
	metadata: {
		timestamp: number;
		source: string;
		relevance: number;
		tags: string[];
	};
}

export interface IConversationContext {
	messages: IChatMessage[];
	summary: string;
	keyTopics: string[];
	lastActivity: number;
}

export interface IKnowledgeGraph {
	nodes: IKnowledgeNode[];
	edges: IKnowledgeEdge[];
}

export interface IKnowledgeNode {
	id: string;
	type: 'concept' | 'function' | 'class' | 'file' | 'pattern';
	label: string;
	properties: Record<string, any>;
}

export interface IKnowledgeEdge {
	source: string;
	target: string;
	type: 'references' | 'implements' | 'imports' | 'related' | 'contains';
	weight: number;
}

export interface ICodePattern {
	id: string;
	pattern: string;
	description: string;
	examples: string[];
	confidence: number;
	lastUsed: number;
}

export interface IMemorySystem {
	storeInteraction(request: IAgentRequest, response: IAgentResponse): Promise<void>;
	getConversationHistory(requestId: string): Promise<IChatMessage[]>;
	searchRelevantKnowledge(query: string): Promise<IKnowledgeEntry[]>;
	getCodePatterns(language?: string): Promise<ICodePattern[]>;
	buildKnowledgeGraph(projectPath: string): Promise<IKnowledgeGraph>;
	getMemoryUsage(): number;
	clearMemory(type?: string): Promise<void>;
}

export interface IKnowledgeEntry {
	content: string;
	relevance: number;
	source: string;
	type: string;
}

export interface IChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: number;
}

export class MemorySystem extends Disposable implements IMemorySystem {
	private readonly memory = new Map<string, IMemoryEntry>();
	private readonly conversations = new Map<string, IConversationContext>();
	private readonly knowledgeGraph: IKnowledgeGraph = { nodes: [], edges: [] };
	private readonly codePatterns = new Map<string, ICodePattern[]>();
	private readonly disposables = this._register(new DisposableStore());

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService
	) {
		super();

		this.initializeMemorySystem();
	}

	private async initializeMemorySystem(): Promise<void> {
		try {
			await this.loadPersistedMemory();
			this.logService.info('Memory System: Initialized successfully');
		} catch (error) {
			this.logService.error('Memory System: Failed to initialize', error);
		}
	}

	async storeInteraction(request: IAgentRequest, response: IAgentResponse): Promise<void> {
		try {
			// Store conversation
			const conversationId = request.id;
			const conversation = this.conversations.get(conversationId) || {
				messages: [],
				summary: '',
				keyTopics: [],
				lastActivity: Date.now()
			};

			conversation.messages.push({
				role: 'user',
				content: request.content,
				timestamp: Date.now()
			});

			conversation.messages.push({
				role: 'assistant',
				content: response.content,
				timestamp: Date.now()
			});

			conversation.lastActivity = Date.now();
			this.conversations.set(conversationId, conversation);

			// Extract and store knowledge
			await this.extractKnowledge(request, response);

			// Update conversation summary
			await this.updateConversationSummary(conversationId);

			// Persist memory periodically
			await this.persistMemory();

			this.logService.debug('Memory System: Interaction stored', { requestId: request.id });

		} catch (error) {
			this.logService.error('Memory System: Failed to store interaction', error);
		}
	}

	async getConversationHistory(requestId: string): Promise<IChatMessage[]> {
		const conversation = this.conversations.get(requestId);
		return conversation?.messages || [];
	}

	async searchRelevantKnowledge(query: string): Promise<IKnowledgeEntry[]> {
		const results: IKnowledgeEntry[] = [];

		// Search through stored knowledge
		for (const [key, entry] of this.memory.entries()) {
			if (entry.type === 'knowledge' || entry.type === 'pattern') {
				const relevance = this.calculateRelevance(query, entry.content);
				if (relevance > 0.3) { // Minimum relevance threshold
					results.push({
						content: typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content),
						relevance,
						source: entry.metadata.source,
						type: entry.type
					});
				}
			}
		}

		// Search knowledge graph
		const graphResults = await this.searchKnowledgeGraph(query);
		results.push(...graphResults);

		// Sort by relevance and return top results
		return results
			.sort((a, b) => b.relevance - a.relevance)
			.slice(0, 10);
	}

	async getCodePatterns(language?: string): Promise<ICodePattern[]> {
		if (language) {
			return this.codePatterns.get(language) || [];
		}

		// Return all patterns
		const allPatterns: ICodePattern[] = [];
		for (const patterns of this.codePatterns.values()) {
			allPatterns.push(...patterns);
		}
		return allPatterns;
	}

	async buildKnowledgeGraph(projectPath: string): Promise<IKnowledgeGraph> {
		try {
			this.logService.info('Memory System: Building knowledge graph', { projectPath });

			// Analyze project structure
			const projectAnalysis = await this.analyzeProjectStructure(projectPath);

			// Extract code entities
			const entities = await this.extractCodeEntities(projectAnalysis);

			// Build relationships
			const relationships = await this.buildRelationships(entities);

			// Update knowledge graph
			this.knowledgeGraph.nodes = entities;
			this.knowledgeGraph.edges = relationships;

			this.logService.info('Memory System: Knowledge graph built', {
				nodes: entities.length,
				edges: relationships.length
			});

			return this.knowledgeGraph;

		} catch (error) {
			this.logService.error('Memory System: Failed to build knowledge graph', error);
			return { nodes: [], edges: [] };
		}
	}

	getMemoryUsage(): number {
		let totalSize = 0;

		// Calculate conversation memory
		for (const conversation of this.conversations.values()) {
			totalSize += conversation.messages.reduce((size, msg) => size + msg.content.length, 0);
		}

		// Calculate knowledge memory
		for (const entry of this.memory.values()) {
			totalSize += JSON.stringify(entry).length;
		}

		// Calculate knowledge graph memory
		totalSize += JSON.stringify(this.knowledgeGraph).length;

		return totalSize;
	}

	async clearMemory(type?: string): Promise<void> {
		if (type === 'conversations') {
			this.conversations.clear();
		} else if (type === 'knowledge') {
			for (const [key, entry] of this.memory.entries()) {
				if (entry.type === 'knowledge') {
					this.memory.delete(key);
				}
			}
		} else if (type === 'patterns') {
			this.codePatterns.clear();
		} else if (type === 'graph') {
			this.knowledgeGraph.nodes = [];
			this.knowledgeGraph.edges = [];
		} else {
			// Clear all memory
			this.conversations.clear();
			this.memory.clear();
			this.codePatterns.clear();
			this.knowledgeGraph.nodes = [];
			this.knowledgeGraph.edges = [];
		}

		await this.persistMemory();
		this.logService.info('Memory System: Memory cleared', { type: type || 'all' });
	}

	private async extractKnowledge(request: IAgentRequest, response: IAgentResponse): Promise<void> {
		// Extract patterns from code if present
		if (request.context?.language && response.content.includes('```')) {
			await this.extractCodePatterns(request, response);
		}

		// Extract general knowledge
		const knowledgeEntry: IMemoryEntry = {
			id: `knowledge_${Date.now()}_${Math.random()}`,
			type: 'knowledge',
			content: {
				request: request.content,
				response: response.content,
				context: request.context
			},
			metadata: {
				timestamp: Date.now(),
				source: 'conversation',
				relevance: 0.8,
				tags: this.extractTags(request.content + ' ' + response.content)
			}
		};

		this.memory.set(knowledgeEntry.id, knowledgeEntry);
	}

	private async extractCodePatterns(request: IAgentRequest, response: IAgentResponse): Promise<void> {
		const language = request.context?.language;
		if (!language) return;

		// Extract code blocks from response
		const codeBlocks = this.extractCodeBlocks(response.content);
		const patterns = this.codePatterns.get(language) || [];

		for (const block of codeBlocks) {
			const pattern: ICodePattern = {
				id: `pattern_${Date.now()}_${Math.random()}`,
				pattern: block.code,
				description: this.generatePatternDescription(block.code, language),
				examples: [block.code],
				confidence: 0.7,
				lastUsed: Date.now()
			};

			patterns.push(pattern);
		}

		this.codePatterns.set(language, patterns);
	}

	private extractCodeBlocks(content: string): Array<{ code: string; language?: string }> {
		const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
		const blocks: Array<{ code: string; language?: string }> = [];

		let match;
		while ((match = codeBlockRegex.exec(content)) !== null) {
			blocks.push({
				code: match[2].trim(),
				language: match[1]
			});
		}

		return blocks;
	}

	private generatePatternDescription(code: string, language: string): string {
		// Simple pattern description generation
		if (code.includes('function') || code.includes('def ')) {
			return 'Function definition pattern';
		} else if (code.includes('class ')) {
			return 'Class definition pattern';
		} else if (code.includes('import ') || code.includes('from ')) {
			return 'Import statement pattern';
		} else {
			return 'Code snippet pattern';
		}
	}

	private extractTags(text: string): string[] {
		const tags: string[] = [];
		const words = text.toLowerCase().split(/\W+/);

		// Extract programming-related keywords
		const keywords = ['function', 'class', 'import', 'export', 'async', 'await', 'try', 'catch', 'if', 'for', 'while'];
		for (const word of words) {
			if (keywords.includes(word)) {
				tags.push(word);
			}
		}

		return [...new Set(tags)]; // Remove duplicates
	}

	private calculateRelevance(query: string, content: any): number {
		const queryWords = query.toLowerCase().split(/\W+/);
		const contentText = typeof content === 'string' ? content : JSON.stringify(content);
		const contentWords = contentText.toLowerCase().split(/\W+/);

		let matches = 0;
		for (const queryWord of queryWords) {
			if (contentWords.includes(queryWord)) {
				matches++;
			}
		}

		return matches / queryWords.length;
	}

	private async searchKnowledgeGraph(query: string): Promise<IKnowledgeEntry[]> {
		const results: IKnowledgeEntry[] = [];

		// Search nodes
		for (const node of this.knowledgeGraph.nodes) {
			const relevance = this.calculateRelevance(query, node.label + ' ' + JSON.stringify(node.properties));
			if (relevance > 0.4) {
				results.push({
					content: `Knowledge: ${node.label} (${node.type})`,
					relevance,
					source: 'knowledge_graph',
					type: 'graph_node'
				});
			}
		}

		return results;
	}

	private async analyzeProjectStructure(projectPath: string): Promise<IProjectAnalysis> {
		// This would analyze the project structure
		// For now, return a placeholder
		return {
			path: projectPath,
			files: [],
			dependencies: {},
			languages: []
		};
	}

	private async extractCodeEntities(analysis: IProjectAnalysis): Promise<IKnowledgeNode[]> {
		const entities: IKnowledgeNode[] = [];

		// Extract entities from files
		for (const file of analysis.files) {
			if (file.type === 'code') {
				const fileEntities = await this.extractEntitiesFromFile(file.path);
				entities.push(...fileEntities);
			}
		}

		return entities;
	}

	private async extractEntitiesFromFile(filePath: string): Promise<IKnowledgeNode[]> {
		const entities: IKnowledgeNode[] = [];

		try {
			const uri = URI.file(filePath);
			const content = await this.fileService.readFile(uri);
			const text = content.value.toString();

			// Simple entity extraction (would be enhanced with proper parsing)
			const functionRegex = /function\s+(\w+)|\bdef\s+(\w+)|\bclass\s+(\w+)/g;
			let match;

			while ((match = functionRegex.exec(text)) !== null) {
				const name = match[1] || match[2] || match[3];
				entities.push({
					id: `entity_${filePath}_${name}`,
					type: match[0].includes('class') ? 'class' : 'function',
					label: name,
					properties: {
						file: filePath,
						line: text.substring(0, match.index).split('\n').length
					}
				});
			}

		} catch (error) {
			this.logService.warn('Memory System: Failed to extract entities from file', { filePath, error });
		}

		return entities;
	}

	private async buildRelationships(entities: IKnowledgeNode[]): Promise<IKnowledgeEdge[]> {
		const edges: IKnowledgeEdge[] = [];

		// Build relationships between entities
		for (let i = 0; i < entities.length; i++) {
			for (let j = i + 1; j < entities.length; j++) {
				const entity1 = entities[i];
				const entity2 = entities[j];

				// Simple relationship detection
				if (entity1.properties.file === entity2.properties.file) {
					edges.push({
						source: entity1.id,
						target: entity2.id,
						type: 'related',
						weight: 0.5
					});
				}
			}
		}

		return edges;
	}

	private async updateConversationSummary(conversationId: string): Promise<void> {
		const conversation = this.conversations.get(conversationId);
		if (!conversation) return;

		// Generate summary of conversation
		const messages = conversation.messages;
		const topics = new Set<string>();

		for (const message of messages) {
			const words = message.content.toLowerCase().split(/\W+/);
			const keywords = ['function', 'class', 'error', 'bug', 'fix', 'test', 'api', 'database'];
			for (const word of words) {
				if (keywords.includes(word)) {
					topics.add(word);
				}
			}
		}

		conversation.keyTopics = Array.from(topics);
		conversation.summary = `Conversation with ${messages.length} messages covering: ${conversation.keyTopics.join(', ')}`;
	}

	private async loadPersistedMemory(): Promise<void> {
		try {
			const memoryUri = URI.file(this.getMemoryFilePath());
			const content = await this.fileService.readFile(memoryUri);
			const data = JSON.parse(content.value.toString());

			// Restore memory from persisted data
			if (data.conversations) {
				for (const [id, conversation] of Object.entries(data.conversations)) {
					this.conversations.set(id, conversation as IConversationContext);
				}
			}

			if (data.memory) {
				for (const [id, entry] of Object.entries(data.memory)) {
					this.memory.set(id, entry as IMemoryEntry);
				}
			}

			if (data.knowledgeGraph) {
				this.knowledgeGraph = data.knowledgeGraph;
			}

			if (data.codePatterns) {
				for (const [language, patterns] of Object.entries(data.codePatterns)) {
					this.codePatterns.set(language, patterns as ICodePattern[]);
				}
			}

			this.logService.info('Memory System: Persisted memory loaded');

		} catch (error) {
			// Memory file doesn't exist or is corrupted, start fresh
			this.logService.info('Memory System: No persisted memory found, starting fresh');
		}
	}

	private async persistMemory(): Promise<void> {
		try {
			const data = {
				conversations: Object.fromEntries(this.conversations),
				memory: Object.fromEntries(this.memory),
				knowledgeGraph: this.knowledgeGraph,
				codePatterns: Object.fromEntries(this.codePatterns)
			};

			const memoryUri = URI.file(this.getMemoryFilePath());
			const buffer = VSBuffer.fromString(JSON.stringify(data, null, 2));
			await this.fileService.writeFile(memoryUri, buffer);

		} catch (error) {
			this.logService.error('Memory System: Failed to persist memory', error);
		}
	}

	private getMemoryFilePath(): string {
		const config = this.configurationService.getValue('agent.memory');
		const memoryPath = config?.path || '.vscode/agent-memory.json';
		return memoryPath;
	}
}

// Placeholder interfaces
interface IProjectAnalysis {
	path: string;
	files: Array<{ path: string; type: string }>;
	dependencies: Record<string, string>;
	languages: string[];
}

// Import missing types
import { URI } from '../../../base/common/uri.js';
import { VSBuffer } from '../../../base/common/buffer.js';