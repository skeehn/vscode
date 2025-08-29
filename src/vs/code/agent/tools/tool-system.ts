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
import { IAgentRequest } from '../agent-orchestrator.js';

export interface ITool {
	name: string;
	description: string;
	parameters: IToolParameter[];
	execute: (args: any, context: IToolContext) => Promise<any>;
	capabilities: string[];
}

export interface IToolParameter {
	name: string;
	type: 'string' | 'number' | 'boolean' | 'object' | 'array';
	description: string;
	required: boolean;
}

export interface IToolContext {
	request: IAgentRequest;
	workspaceRoot?: string;
	workingDirectory: string;
	timeout: number;
}

export interface IToolResult {
	tool: string;
	result: any;
	error?: string;
	duration: number;
}

export class ToolSystem extends Disposable {
	private readonly tools = new Map<string, ITool>();
	private readonly disposables = this._register(new DisposableStore());

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService
	) {
		super();

		this.initializeTools();
	}

	private initializeTools(): void {
		// File system tools
		this.registerTool(this.createFileReadTool());
		this.registerTool(this.createFileWriteTool());
		this.registerTool(this.createFileSearchTool());
		this.registerTool(this.createDirectoryListTool());

		// Terminal tools
		this.registerTool(this.createTerminalCommandTool());
		this.registerTool(this.createTerminalInteractiveTool());

		// Code analysis tools
		this.registerTool(this.createCodeSearchTool());
		this.registerTool(this.createCodeAnalysisTool());
		this.registerTool(this.createProjectAnalysisTool());

		// Testing tools
		this.registerTool(this.createTestRunnerTool());
		this.registerTool(this.createTestGeneratorTool());

		// Web and API tools
		this.registerTool(this.createWebSearchTool());
		this.registerTool(this.createApiCallTool());

		// Database tools
		this.registerTool(this.createDatabaseQueryTool());

		// Utility tools
		this.registerTool(this.createGrepSearchTool());
		this.registerTool(this.createRunCommandTool());

		this.logService.info('Tool System: All tools initialized', { count: this.tools.size });
	}

	private registerTool(tool: ITool): void {
		this.tools.set(tool.name, tool);
		this.logService.debug(`Tool System: Registered tool ${tool.name}`);
	}

	getToolsForRequest(request: IAgentRequest): ITool[] {
		const config = this.configurationService.getValue('agent.tools');
		const enabledTools = config?.enabled || [];

		return Array.from(this.tools.values()).filter(tool => {
			// Check if tool is enabled
			if (!enabledTools.includes(tool.name) && enabledTools.length > 0) {
				return false;
			}

			// Check if tool capabilities match request type
			return this.toolCapabilitiesMatchRequest(tool, request);
		});
	}

	private toolCapabilitiesMatchRequest(tool: ITool, request: IAgentRequest): boolean {
		const capabilityMap = {
			chat: ['chat', 'general'],
			command: ['fileops', 'terminal', 'code', 'general'],
			analysis: ['analysis', 'code', 'search', 'general'],
			refactor: ['fileops', 'code', 'analysis', 'general'],
			debug: ['debug', 'code', 'terminal', 'analysis', 'general'],
			test: ['testing', 'code', 'terminal', 'general']
		};

		const requiredCapabilities = capabilityMap[request.type] || ['general'];
		return tool.capabilities.some(cap => requiredCapabilities.includes(cap));
	}

	async executeTool(tool: ITool, request: IAgentRequest): Promise<any> {
		const startTime = Date.now();

		try {
			this.logService.info(`Tool System: Executing tool ${tool.name}`, { requestId: request.id });

			const context: IToolContext = {
				request,
				workspaceRoot: request.context?.workspace,
				workingDirectory: request.context?.workspace || process.cwd(),
				timeout: 30000 // Default timeout
			};

			const result = await tool.execute({}, context);

			const duration = Date.now() - startTime;
			this.logService.info(`Tool System: Tool ${tool.name} completed`, {
				requestId: request.id,
				duration
			});

			return result;

		} catch (error) {
			const duration = Date.now() - startTime;
			this.logService.error(`Tool System: Tool ${tool.name} failed`, {
				requestId: request.id,
				error,
				duration
			});

			throw error;
		}
	}

	getAvailableTools(): ITool[] {
		return Array.from(this.tools.values());
	}

	// Tool Implementations

	private createFileReadTool(): ITool {
		return {
			name: 'read_file',
			description: 'Read the contents of a file',
			capabilities: ['fileops', 'analysis', 'general'],
			parameters: [
				{
					name: 'path',
					type: 'string',
					description: 'Path to the file to read',
					required: true
				},
				{
					name: 'encoding',
					type: 'string',
					description: 'File encoding (default: utf8)',
					required: false
				}
			],
			execute: async (args: { path: string; encoding?: string }, context: IToolContext) => {
				const uri = URI.file(args.path);
				const content = await this.fileService.readFile(uri);
				return content.value.toString(args.encoding || 'utf8');
			}
		};
	}

	private createFileWriteTool(): ITool {
		return {
			name: 'write_file',
			description: 'Write content to a file',
			capabilities: ['fileops', 'general'],
			parameters: [
				{
					name: 'path',
					type: 'string',
					description: 'Path to the file to write',
					required: true
				},
				{
					name: 'content',
					type: 'string',
					description: 'Content to write to the file',
					required: true
				},
				{
					name: 'encoding',
					type: 'string',
					description: 'File encoding (default: utf8)',
					required: false
				}
			],
			execute: async (args: { path: string; content: string; encoding?: string }, context: IToolContext) => {
				const uri = URI.file(args.path);
				const buffer = VSBuffer.fromString(args.content, args.encoding || 'utf8');
				await this.fileService.writeFile(uri, buffer);
				return { success: true, path: args.path };
			}
		};
	}

	private createFileSearchTool(): ITool {
		return {
			name: 'search_files',
			description: 'Search for files matching a pattern',
			capabilities: ['fileops', 'search', 'general'],
			parameters: [
				{
					name: 'pattern',
					type: 'string',
					description: 'Glob pattern to match files',
					required: true
				},
				{
					name: 'directory',
					type: 'string',
					description: 'Directory to search in (default: workspace root)',
					required: false
				}
			],
			execute: async (args: { pattern: string; directory?: string }, context: IToolContext) => {
				const searchDir = args.directory || context.workspaceRoot || context.workingDirectory;
				const uri = URI.file(searchDir);

				// Use glob pattern matching
				const results = await this.fileService.findFiles(args.pattern, uri, { dot: false });
				return results.map(uri => uri.fsPath);
			}
		};
	}

	private createDirectoryListTool(): ITool {
		return {
			name: 'list_directory',
			description: 'List contents of a directory',
			capabilities: ['fileops', 'general'],
			parameters: [
				{
					name: 'path',
					type: 'string',
					description: 'Path to the directory to list',
					required: true
				},
				{
					name: 'recursive',
					type: 'boolean',
					description: 'Whether to list recursively',
					required: false
				}
			],
			execute: async (args: { path: string; recursive?: boolean }, context: IToolContext) => {
				const uri = URI.file(args.path);
				const stat = await this.fileService.stat(uri);

				if (stat.isDirectory) {
					const children = await this.fileService.resolve(uri);
					const entries = children.children?.map(child => ({
						name: child.name,
						type: child.isDirectory ? 'directory' : 'file',
						size: child.size,
						mtime: child.mtime
					})) || [];

					return {
						path: args.path,
						entries,
						total: entries.length
					};
				} else {
					throw new Error(`${args.path} is not a directory`);
				}
			}
		};
	}

	private createTerminalCommandTool(): ITool {
		return {
			name: 'run_terminal_command',
			description: 'Execute a terminal command',
			capabilities: ['terminal', 'general'],
			parameters: [
				{
					name: 'command',
					type: 'string',
					description: 'Command to execute',
					required: true
				},
				{
					name: 'cwd',
					type: 'string',
					description: 'Working directory for the command',
					required: false
				},
				{
					name: 'timeout',
					type: 'number',
					description: 'Command timeout in milliseconds',
					required: false
				}
			],
			execute: async (args: { command: string; cwd?: string; timeout?: number }, context: IToolContext) => {
				const { spawn } = await import('child_process');
				const cwd = args.cwd || context.workingDirectory;

				return new Promise((resolve, reject) => {
					const child = spawn(args.command, {
						cwd,
						shell: true,
						stdio: ['pipe', 'pipe', 'pipe']
					});

					let stdout = '';
					let stderr = '';

					child.stdout?.on('data', (data) => {
						stdout += data.toString();
					});

					child.stderr?.on('data', (data) => {
						stderr += data.toString();
					});

					child.on('close', (code) => {
						resolve({
							command: args.command,
							exitCode: code,
							stdout,
							stderr,
							success: code === 0
						});
					});

					child.on('error', (error) => {
						reject(error);
					});

					// Set timeout
					const timeout = args.timeout || context.timeout;
					setTimeout(() => {
						child.kill();
						reject(new Error(`Command timed out after ${timeout}ms`));
					}, timeout);
				});
			}
		};
	}

	private createTerminalInteractiveTool(): ITool {
		return {
			name: 'run_terminal_interactive',
			description: 'Execute an interactive terminal command',
			capabilities: ['terminal', 'general'],
			parameters: [
				{
					name: 'command',
					type: 'string',
					description: 'Command to execute interactively',
					required: true
				},
				{
					name: 'cwd',
					type: 'string',
					description: 'Working directory for the command',
					required: false
				}
			],
			execute: async (args: { command: string; cwd?: string }, context: IToolContext) => {
				// For interactive commands, we'll use a different approach
				// This is a simplified implementation
				const { exec } = await import('child_process');
				const cwd = args.cwd || context.workingDirectory;

				return new Promise((resolve, reject) => {
					exec(args.command, { cwd }, (error, stdout, stderr) => {
						if (error) {
							reject(error);
						} else {
							resolve({
								command: args.command,
								stdout,
								stderr,
								success: true
							});
						}
					});
				});
			}
		};
	}

	private createCodeSearchTool(): ITool {
		return {
			name: 'search_code',
			description: 'Search for code patterns using ripgrep',
			capabilities: ['code', 'search', 'analysis'],
			parameters: [
				{
					name: 'pattern',
					type: 'string',
					description: 'Regex pattern to search for',
					required: true
				},
				{
					name: 'path',
					type: 'string',
					description: 'Path to search in',
					required: false
				},
				{
					name: 'file_type',
					type: 'string',
					description: 'File type filter (e.g., *.js, *.py)',
					required: false
				},
				{
					name: 'case_sensitive',
					type: 'boolean',
					description: 'Whether search is case sensitive',
					required: false
				}
			],
			execute: async (args: {
				pattern: string;
				path?: string;
				file_type?: string;
				case_sensitive?: boolean
			}, context: IToolContext) => {
				const searchPath = args.path || context.workspaceRoot || context.workingDirectory;

				// Use ripgrep for fast code searching
				const rgCommand = `rg --json "${args.pattern}" ${searchPath} ${args.file_type ? `--type ${args.file_type}` : ''} ${args.case_sensitive ? '--case-sensitive' : ''}`;

				const terminalTool = this.tools.get('run_terminal_command');
				if (!terminalTool) {
					throw new Error('Terminal tool not available');
				}

				const result = await terminalTool.execute({
					command: rgCommand,
					cwd: searchPath
				}, context);

				// Parse ripgrep JSON output
				const lines = result.stdout.split('\n').filter(line => line.trim());
				const matches = lines.map(line => {
					try {
						return JSON.parse(line);
					} catch {
						return null;
					}
				}).filter(match => match && match.type === 'match');

				return {
					pattern: args.pattern,
					matches: matches.map(match => ({
						file: match.data.path.text,
						line: match.data.line_number,
						content: match.data.lines.text.trim(),
						columns: match.data.submatches?.[0]?.start
					})),
					total: matches.length
				};
			}
		};
	}

	private createCodeAnalysisTool(): ITool {
		return {
			name: 'analyze_code',
			description: 'Analyze code for issues, complexity, and improvements',
			capabilities: ['code', 'analysis'],
			parameters: [
				{
					name: 'file_path',
					type: 'string',
					description: 'Path to the file to analyze',
					required: true
				},
				{
					name: 'analysis_type',
					type: 'string',
					description: 'Type of analysis (complexity, bugs, style, performance)',
					required: false
				}
			],
			execute: async (args: { file_path: string; analysis_type?: string }, context: IToolContext) => {
				const readTool = this.tools.get('read_file');
				if (!readTool) {
					throw new Error('File read tool not available');
				}

				const content = await readTool.execute({ path: args.file_path }, context);

				// Basic code analysis (this would be enhanced with actual analysis tools)
				const analysis = {
					file: args.file_path,
					lines: content.split('\n').length,
					characters: content.length,
					issues: [],
					suggestions: []
				};

				// Simple heuristics for demonstration
				if (content.includes('TODO')) {
					analysis.issues.push('Contains TODO comments');
				}

				if (content.includes('console.log')) {
					analysis.suggestions.push('Consider removing debug console.log statements');
				}

				const longLines = content.split('\n').filter(line => line.length > 120);
				if (longLines.length > 0) {
					analysis.suggestions.push(`Found ${longLines.length} lines longer than 120 characters`);
				}

				return analysis;
			}
		};
	}

	private createProjectAnalysisTool(): ITool {
		return {
			name: 'analyze_project',
			description: 'Analyze entire project structure and provide insights',
			capabilities: ['analysis', 'code'],
			parameters: [
				{
					name: 'path',
					type: 'string',
					description: 'Path to the project root',
					required: false
				},
				{
					name: 'include_patterns',
					type: 'array',
					description: 'File patterns to include in analysis',
					required: false
				}
			],
			execute: async (args: { path?: string; include_patterns?: string[] }, context: IToolContext) => {
				const projectPath = args.path || context.workspaceRoot || context.workingDirectory;

				const listTool = this.tools.get('list_directory');
				if (!listTool) {
					throw new Error('Directory listing tool not available');
				}

				const structure = await listTool.execute({ path: projectPath, recursive: true }, context);

				// Analyze project structure
				const analysis = {
					project_path: projectPath,
					total_files: structure.entries.filter(e => e.type === 'file').length,
					total_directories: structure.entries.filter(e => e.type === 'directory').length,
					file_types: {},
					largest_files: [],
					recommendations: []
				};

				// Count file types
				structure.entries.forEach(entry => {
					if (entry.type === 'file') {
						const ext = entry.name.split('.').pop() || 'no_extension';
						analysis.file_types[ext] = (analysis.file_types[ext] || 0) + 1;
					}
				});

				// Find largest files
				analysis.largest_files = structure.entries
					.filter(e => e.type === 'file')
					.sort((a, b) => (b.size || 0) - (a.size || 0))
					.slice(0, 10);

				// Generate recommendations
				const jsFiles = analysis.file_types.js || 0;
				const tsFiles = analysis.file_types.ts || 0;

				if (tsFiles > jsFiles * 2) {
					analysis.recommendations.push('Consider migrating JavaScript files to TypeScript');
				}

				if (analysis.total_files > 1000) {
					analysis.recommendations.push('Large codebase detected - consider modularization');
				}

				return analysis;
			}
		};
	}

	private createTestRunnerTool(): ITool {
		return {
			name: 'run_tests',
			description: 'Run project tests',
			capabilities: ['testing', 'terminal'],
			parameters: [
				{
					name: 'test_command',
					type: 'string',
					description: 'Test command to run (default: auto-detect)',
					required: false
				},
				{
					name: 'test_pattern',
					type: 'string',
					description: 'Test file pattern to run',
					required: false
				}
			],
			execute: async (args: { test_command?: string; test_pattern?: string }, context: IToolContext) => {
				let command = args.test_command;

				if (!command) {
					// Auto-detect test command based on project files
					const listTool = this.tools.get('list_directory');
					if (!listTool) {
						throw new Error('Directory listing tool not available');
					}

					const rootContents = await listTool.execute({ path: context.workspaceRoot || context.workingDirectory }, context);

					if (rootContents.entries.some(e => e.name === 'package.json')) {
						command = 'npm test';
					} else if (rootContents.entries.some(e => e.name === 'pytest.ini' || e.name === 'setup.py')) {
						command = 'python -m pytest';
					} else if (rootContents.entries.some(e => e.name === 'go.mod')) {
						command = 'go test ./...';
					} else {
						command = 'echo "No test framework detected"';
					}
				}

				const terminalTool = this.tools.get('run_terminal_command');
				if (!terminalTool) {
					throw new Error('Terminal tool not available');
				}

				return await terminalTool.execute({
					command,
					cwd: context.workspaceRoot || context.workingDirectory
				}, context);
			}
		};
	}

	private createTestGeneratorTool(): ITool {
		return {
			name: 'generate_tests',
			description: 'Generate unit tests for code',
			capabilities: ['testing', 'code'],
			parameters: [
				{
					name: 'file_path',
					type: 'string',
					description: 'Path to the file to generate tests for',
					required: true
				},
				{
					name: 'test_framework',
					type: 'string',
					description: 'Test framework to use (jest, pytest, etc.)',
					required: false
				}
			],
			execute: async (args: { file_path: string; test_framework?: string }, context: IToolContext) => {
				const readTool = this.tools.get('read_file');
				if (!readTool) {
					throw new Error('File read tool not available');
				}

				const content = await readTool.execute({ path: args.file_path }, context);

				// This is a simplified test generation
				// In a real implementation, this would use AI to generate comprehensive tests
				const fileName = args.file_path.split('/').pop() || '';
				const testFileName = fileName.replace(/\.(js|ts|py)$/, '.test.$1');

				const testContent = `// Generated tests for ${fileName}
// This is a basic test template - customize as needed

describe('${fileName}', () => {
  test('should work correctly', () => {
    // Add your test logic here
    expect(true).toBe(true);
  });
});`;

				return {
					test_file: testFileName,
					content: testContent,
					suggestion: 'Review and customize the generated tests before running them'
				};
			}
		};
	}

	private createWebSearchTool(): ITool {
		return {
			name: 'web_search',
			description: 'Search the web for information',
			capabilities: ['web', 'search'],
			parameters: [
				{
					name: 'query',
					type: 'string',
					description: 'Search query',
					required: true
				},
				{
					name: 'max_results',
					type: 'number',
					description: 'Maximum number of results to return',
					required: false
				}
			],
			execute: async (args: { query: string; max_results?: number }, context: IToolContext) => {
				// This would integrate with a search API
				// For now, return a placeholder
				return {
					query: args.query,
					results: [
						{
							title: 'Search Result 1',
							url: 'https://example.com/1',
							snippet: 'This is a search result snippet...'
						}
					],
					total: 1
				};
			}
		};
	}

	private createApiCallTool(): ITool {
		return {
			name: 'api_call',
			description: 'Make HTTP API calls',
			capabilities: ['web', 'api'],
			parameters: [
				{
					name: 'url',
					type: 'string',
					description: 'API endpoint URL',
					required: true
				},
				{
					name: 'method',
					type: 'string',
					description: 'HTTP method (GET, POST, PUT, DELETE)',
					required: false
				},
				{
					name: 'headers',
					type: 'object',
					description: 'HTTP headers',
					required: false
				},
				{
					name: 'body',
					type: 'string',
					description: 'Request body',
					required: false
				}
			],
			execute: async (args: {
				url: string;
				method?: string;
				headers?: Record<string, string>;
				body?: string
			}, context: IToolContext) => {
				const response = await fetch(args.url, {
					method: args.method || 'GET',
					headers: args.headers || {},
					body: args.body
				});

				const responseText = await response.text();

				return {
					url: args.url,
					method: args.method || 'GET',
					status: response.status,
					headers: Object.fromEntries(response.headers.entries()),
					body: responseText
				};
			}
		};
	}

	private createDatabaseQueryTool(): ITool {
		return {
			name: 'database_query',
			description: 'Execute database queries',
			capabilities: ['database'],
			parameters: [
				{
					name: 'connection_string',
					type: 'string',
					description: 'Database connection string',
					required: true
				},
				{
					name: 'query',
					type: 'string',
					description: 'SQL query to execute',
					required: true
				},
				{
					name: 'database_type',
					type: 'string',
					description: 'Database type (postgres, mysql, sqlite)',
					required: false
				}
			],
			execute: async (args: {
				connection_string: string;
				query: string;
				database_type?: string
			}, context: IToolContext) => {
				// This would integrate with database drivers
				// For now, return a placeholder
				return {
					query: args.query,
					result: 'Database integration not yet implemented',
					rows_affected: 0
				};
			}
		};
	}

	private createGrepSearchTool(): ITool {
		return {
			name: 'grep_search',
			description: 'Search for text patterns in files using grep',
			capabilities: ['search', 'general'],
			parameters: [
				{
					name: 'pattern',
					type: 'string',
					description: 'Pattern to search for',
					required: true
				},
				{
					name: 'path',
					type: 'string',
					description: 'Path to search in',
					required: false
				},
				{
					name: 'case_insensitive',
					type: 'boolean',
					description: 'Case insensitive search',
					required: false
				}
			],
			execute: async (args: {
				pattern: string;
				path?: string;
				case_insensitive?: boolean
			}, context: IToolContext) => {
				const searchPath = args.path || context.workspaceRoot || context.workingDirectory;
				const grepCommand = `grep -r${args.case_insensitive ? 'i' : ''} "${args.pattern}" ${searchPath}`;

				const terminalTool = this.tools.get('run_terminal_command');
				if (!terminalTool) {
					throw new Error('Terminal tool not available');
				}

				const result = await terminalTool.execute({ command: grepCommand }, context);

				return {
					pattern: args.pattern,
					output: result.stdout,
					error: result.stderr,
					success: result.success
				};
			}
		};
	}

	private createRunCommandTool(): ITool {
		return {
			name: 'run_command',
			description: 'Run arbitrary shell commands',
			capabilities: ['terminal', 'general'],
			parameters: [
				{
					name: 'command',
					type: 'string',
					description: 'Command to run',
					required: true
				},
				{
					name: 'working_directory',
					type: 'string',
					description: 'Working directory for the command',
					required: false
				}
			],
			execute: async (args: { command: string; working_directory?: string }, context: IToolContext) => {
				const terminalTool = this.tools.get('run_terminal_command');
				if (!terminalTool) {
					throw new Error('Terminal tool not available');
				}

				return await terminalTool.execute({
					command: args.command,
					cwd: args.working_directory || context.workingDirectory
				}, context);
			}
		};
	}
}

// Import missing types
import { URI } from '../../../base/common/uri.js';
import { VSBuffer } from '../../../base/common/buffer.js';