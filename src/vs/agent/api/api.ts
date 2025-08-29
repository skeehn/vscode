/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../base/common/cancellation.js';

export interface IAPIEndpoint {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly baseUrl: string;
	readonly version: string;
	readonly authentication: IAuthenticationConfig;
	readonly rateLimit?: IRateLimitConfig;
	readonly timeout: number;
	readonly retries: number;
}

export interface IAuthenticationConfig {
	readonly type: 'none' | 'basic' | 'bearer' | 'api_key' | 'oauth2' | 'custom';
	readonly credentials?: Record<string, string>;
	readonly headers?: Record<string, string>;
	readonly queryParams?: Record<string, string>;
}

export interface IRateLimitConfig {
	readonly requests: number;
	readonly period: number; // in milliseconds
	readonly strategy: 'fixed' | 'sliding';
}

export interface IAPIOperation {
	readonly id: string;
	readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
	readonly path: string;
	readonly description: string;
	readonly parameters: readonly IAPIParameter[];
	readonly requestBody?: IAPIBodySchema;
	readonly responses: Record<string, IAPIResponse>;
	readonly security: readonly string[];
	readonly deprecated?: boolean;
}

export interface IAPIParameter {
	readonly name: string;
	readonly in: 'query' | 'header' | 'path' | 'cookie';
	readonly description: string;
	readonly required: boolean;
	readonly schema: IAPISchema;
	readonly example?: any;
}

export interface IAPIBodySchema {
	readonly contentType: string;
	readonly schema: IAPISchema;
	readonly example?: any;
	readonly encoding?: Record<string, any>;
}

export interface IAPIResponse {
	readonly description: string;
	readonly content?: Record<string, IAPIBodySchema>;
	readonly headers?: Record<string, IAPIParameter>;
}

export interface IAPISchema {
	readonly type: string;
	readonly format?: string;
	readonly properties?: Record<string, IAPISchema>;
	readonly items?: IAPISchema;
	readonly required?: readonly string[];
	readonly enum?: readonly any[];
	readonly minimum?: number;
	readonly maximum?: number;
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly pattern?: string;
	readonly description?: string;
}

export interface IAPIRequest {
	readonly operationId: string;
	readonly parameters: Record<string, any>;
	readonly body?: any;
	readonly headers?: Record<string, string>;
	readonly timeout?: number;
}

export interface IAPIResponse {
	readonly status: number;
	readonly statusText: string;
	readonly headers: Record<string, string>;
	readonly data: any;
	readonly duration: number;
	readonly cached?: boolean;
}

export interface IAPICallResult {
	readonly success: boolean;
	readonly response?: IAPIResponse;
	readonly error?: IAPIError;
	readonly request: IAPIRequest;
}

export interface IAPIError {
	readonly code: string;
	readonly message: string;
	readonly details?: any;
	readonly retryable: boolean;
}

export interface IAPIClient extends IDisposable {
	readonly endpoint: IAPIEndpoint;

	readonly onRequest: Event<IAPIRequest>;
	readonly onResponse: Event<IAPICallResult>;
	readonly onError: Event<IAPIError>;

	call(operation: IAPIOperation, request: Omit<IAPIRequest, 'operationId'>): Promise<IAPICallResult>;
	batchCall(requests: readonly { operation: IAPIOperation; request: Omit<IAPIRequest, 'operationId'> }[]): Promise<readonly IAPICallResult[]>;

	validateRequest(operation: IAPIOperation, request: Omit<IAPIRequest, 'operationId'>): Promise<IAPIValidationResult>;
	validateResponse(operation: IAPIOperation, response: IAPIResponse): Promise<IAPIValidationResult>;

	getRateLimitStatus(): Promise<IRateLimitStatus>;
}

export interface IAPIValidationResult {
	readonly valid: boolean;
	readonly errors: readonly string[];
	readonly warnings: readonly string[];
}

export interface IRateLimitStatus {
	readonly remaining: number;
	readonly resetTime: Date;
	readonly limit: number;
}

export interface IAPIManager {
	readonly clients: readonly IAPIClient[];

	readonly onClientAdded: Event<IAPIClient>;
	readonly onClientRemoved: Event<string>;

	registerClient(client: IAPIClient): void;
	unregisterClient(id: string): void;

	getClient(id: string): IAPIClient | undefined;
	getClientsByEndpoint(endpointId: string): readonly IAPIClient[];

	callAPI(endpointId: string, operationId: string, request: Omit<IAPIRequest, 'operationId'>): Promise<IAPICallResult>;
	batchCallAPIs(requests: readonly { endpointId: string; operationId: string; request: Omit<IAPIRequest, 'operationId'> }[]): Promise<readonly IAPICallResult[]>;

	discoverAPIs(): Promise<readonly IAPIEndpoint[]>;
	loadAPISpec(spec: any, format: 'openapi' | 'swagger' | 'graphql'): Promise<IAPIEndpoint>;

	getRateLimitStatus(endpointId: string): Promise<IRateLimitStatus>;
}

export interface IWebhookEndpoint {
	readonly id: string;
	readonly url: string;
	readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
	readonly headers: Record<string, string>;
	readonly secret?: string;
	readonly events: readonly string[];
	readonly active: boolean;
}

export interface IWebhookManager {
	readonly endpoints: readonly IWebhookEndpoint[];

	readonly onWebhookReceived: Event<IWebhookEvent>;

	registerEndpoint(endpoint: Omit<IWebhookEndpoint, 'id'>): Promise<string>;
	unregisterEndpoint(id: string): Promise<void>;

	processWebhook(endpointId: string, payload: any, headers: Record<string, string>): Promise<void>;
	validateWebhook(endpointId: string, payload: any, signature: string): Promise<boolean>;
}

export interface IWebhookEvent {
	readonly endpointId: string;
	readonly eventType: string;
	readonly payload: any;
	readonly headers: Record<string, string>;
	readonly timestamp: Date;
}

export interface IStreamingAPIClient extends IAPIClient {
	connect(operation: IAPIOperation, request: Omit<IAPIRequest, 'operationId'>): Promise<IAPIStream>;

	readonly onMessage: Event<any>;
	readonly onConnection: Event<'connected' | 'disconnected' | 'error'>;
}

export interface IAPIStream extends IDisposable {
	readonly connected: boolean;

	send(data: any): Promise<void>;
	close(): Promise<void>;

	readonly onMessage: Event<any>;
	readonly onError: Event<Error>;
	readonly onClose: Event<void>;
}

export interface IAPICache {
	set(key: string, value: any, ttl?: number): Promise<void>;
	get<T = any>(key: string): Promise<T | undefined>;
	delete(key: string): Promise<void>;
	clear(): Promise<void>;
	has(key: string): Promise<boolean>;
}

export const IAPIManager = Symbol('IAPIManager');
export const IWebhookManager = Symbol('IWebhookManager');
export const IAPICache = Symbol('IAPICache');
