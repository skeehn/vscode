/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';

export enum TaskStatus {
	PENDING = 'pending',
	RUNNING = 'running',
	PAUSED = 'paused',
	COMPLETED = 'completed',
	FAILED = 'failed',
	CANCELLED = 'cancelled'
}

export enum TaskPriority {
	LOW = 0,
	MEDIUM = 1,
	HIGH = 2,
	CRITICAL = 3
}

export interface ITaskDependency {
	readonly taskId: string;
	readonly type: 'requires' | 'blocks' | 'enables';
}

export interface ITaskResource {
	readonly type: 'file' | 'url' | 'api' | 'memory';
	readonly uri: URI;
	readonly access: 'read' | 'write' | 'execute';
}

export interface ITaskStep {
	readonly id: string;
	readonly description: string;
	readonly action: ITaskAction;
	readonly dependencies: readonly string[];
	readonly estimatedDuration: number;
	readonly status: TaskStatus;
	readonly result?: any;
	readonly error?: string;
}

export interface ITaskAction {
	readonly type: 'edit_file' | 'run_command' | 'api_call' | 'search' | 'navigate' | 'reason';
	readonly parameters: Record<string, any>;
	readonly requiresConfirmation: boolean;
	readonly undoable: boolean;
}

export interface IAgentTask extends IDisposable {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly status: TaskStatus;
	readonly priority: TaskPriority;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly createdBy: string;
	readonly assignedTo?: string;

	readonly dependencies: readonly ITaskDependency[];
	readonly resources: readonly ITaskResource[];
	readonly steps: readonly ITaskStep[];

	readonly progress: number;
	readonly estimatedDuration: number;
	readonly actualDuration?: number;

	readonly context: ITaskContext;
	readonly metadata: Record<string, any>;

	readonly onStatusChange: Event<TaskStatus>;
	readonly onStepComplete: Event<ITaskStep>;
	readonly onProgress: Event<number>;

	execute(): Promise<void>;
	pause(): Promise<void>;
	resume(): Promise<void>;
	cancel(): Promise<void>;

	addStep(step: Omit<ITaskStep, 'id' | 'status'>): void;
	updateStep(stepId: string, updates: Partial<ITaskStep>): void;
	removeStep(stepId: string): void;

	addDependency(dependency: ITaskDependency): void;
	removeDependency(taskId: string): void;

	updateMetadata(key: string, value: any): void;
}

export interface ITaskContext {
	readonly workspace: URI;
	readonly activeFiles: readonly URI[];
	readonly gitRepository?: URI;
	readonly terminalSession?: string;
	readonly webviewPanels: readonly string[];
	readonly extensions: readonly string[];
}

export interface ITaskTemplate {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly category: string;
	readonly tags: readonly string[];
	readonly steps: readonly Omit<ITaskStep, 'id' | 'status' | 'result' | 'error'>[];
	readonly defaultPriority: TaskPriority;
	readonly estimatedDuration: number;
	readonly requiredCapabilities: readonly string[];
}

export interface ITaskPlanner {
	planTask(description: string, context: ITaskContext): Promise<IAgentTask>;
	refineTask(task: IAgentTask, feedback: string): Promise<IAgentTask>;
	breakDownTask(task: IAgentTask): Promise<readonly IAgentTask[]>;
	estimateTask(task: IAgentTask): Promise<{
		duration: number;
		complexity: 'low' | 'medium' | 'high' | 'critical';
		risks: readonly string[];
	}>;
}

export interface ITaskExecutor {
	executeTask(task: IAgentTask): Promise<void>;
	executeStep(task: IAgentTask, step: ITaskStep): Promise<any>;
	validateStep(step: ITaskStep): Promise<boolean>;
	rollbackStep(step: ITaskStep): Promise<void>;
}

export interface ITaskManager {
	readonly tasks: readonly IAgentTask[];
	readonly activeTasks: readonly IAgentTask[];
	readonly completedTasks: readonly IAgentTask[];

	readonly onTaskAdded: Event<IAgentTask>;
	readonly onTaskRemoved: Event<string>;
	readonly onTaskUpdated: Event<IAgentTask>;

	createTask(template: ITaskTemplate, context: ITaskContext): Promise<IAgentTask>;
	getTask(id: string): IAgentTask | undefined;
	updateTask(id: string, updates: Partial<IAgentTask>): Promise<void>;
	removeTask(id: string): Promise<void>;

	startTask(id: string): Promise<void>;
	stopTask(id: string): Promise<void>;
	pauseTask(id: string): Promise<void>;
	resumeTask(id: string): Promise<void>;

	getTaskHistory(userId: string): Promise<readonly IAgentTask[]>;
	getTaskTemplates(): Promise<readonly ITaskTemplate[]>;
	searchTasks(query: string): Promise<readonly IAgentTask[]>;
}

export const ITaskManager = Symbol('ITaskManager');
export const ITaskPlanner = Symbol('ITaskPlanner');
export const ITaskExecutor = Symbol('ITaskExecutor');
