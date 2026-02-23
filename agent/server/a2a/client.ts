// Accord A2A Client — wraps @a2a-js/sdk A2AClient for Hub integration

import { v4 as uuidv4 } from 'uuid';
import { A2AClient } from '@a2a-js/sdk/client';
import type {
  Task,
  Message,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  MessageSendParams,
} from '@a2a-js/sdk';
import {
  buildAccordRequestPart,
  extractContractUpdate,
  ACCORD_EXTENSION_URI,
} from './extension.js';
import type { AccordRequestPayload, ContractUpdatePayload } from './types.js';
import { toA2APayload } from './converter.js';
import type { AccordRequest } from '../types.js';
import { logger } from '../logger.js';

export type A2AStreamEvent = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

/** Extract result from JSON-RPC response, throwing on error */
function unwrapResult<T>(response: { result?: T; error?: { message: string; code: number } }): T {
  if ('error' in response && response.error) {
    throw new Error(`A2A error ${response.error.code}: ${response.error.message}`);
  }
  return response.result as T;
}

export class AccordA2AClient {
  /** Cached A2AClient instances keyed by service URL */
  private clients = new Map<string, A2AClient>();

  /** Get or create an A2AClient for a service URL */
  private async getClient(serviceUrl: string): Promise<A2AClient> {
    let client = this.clients.get(serviceUrl);
    if (!client) {
      const cardUrl = `${serviceUrl.replace(/\/$/, '')}/.well-known/agent-card.json`;
      logger.info(`A2A: Discovering agent card at ${cardUrl}`);
      client = await A2AClient.fromCardUrl(cardUrl);
      this.clients.set(serviceUrl, client);
    }
    return client;
  }

  /** Send an accord request in streaming mode, yielding SSE events */
  async *sendRequest(serviceUrl: string, request: AccordRequest): AsyncGenerator<A2AStreamEvent> {
    const client = await this.getClient(serviceUrl);
    const payload = toA2APayload(request);
    const contextId = uuidv4();
    const messageId = uuidv4();

    const params: MessageSendParams = {
      message: {
        kind: 'message',
        role: 'user',
        messageId,
        contextId,
        extensions: [ACCORD_EXTENSION_URI],
        parts: [
          ...(request.body ? [{ kind: 'text' as const, text: request.body }] : []),
          buildAccordRequestPart(payload),
        ],
      },
    };

    logger.info(`A2A: Sending request ${request.frontmatter.id} to ${serviceUrl} (stream mode)`);

    for await (const event of client.sendMessageStream(params)) {
      yield event;
    }
  }

  /** Send an approval message for a task in input-required state */
  async approve(serviceUrl: string, taskId: string, contextId: string): Promise<Task> {
    const client = await this.getClient(serviceUrl);
    const params: MessageSendParams = {
      message: {
        kind: 'message',
        role: 'user',
        messageId: uuidv4(),
        taskId,
        contextId,
        parts: [{ kind: 'text', text: 'Approved. Proceed with implementation.' }],
        metadata: {
          [ACCORD_EXTENSION_URI]: {
            approval: 'approved',
          },
        },
      },
      configuration: { blocking: true },
    };

    logger.info(`A2A: Sending approval for task ${taskId} to ${serviceUrl}`);
    const response = await client.sendMessage(params);
    return unwrapResult(response) as Task;
  }

  /** Get task by ID */
  async getTask(serviceUrl: string, taskId: string): Promise<Task> {
    const client = await this.getClient(serviceUrl);
    const response = await client.getTask({ id: taskId });
    return unwrapResult(response) as Task;
  }

  /** Invalidate a cached client (e.g. after connection failure) */
  invalidate(serviceUrl: string): void {
    this.clients.delete(serviceUrl);
  }

  /** Extract contract updates from a completed task's artifacts */
  extractContractUpdates(task: Task): ContractUpdatePayload[] {
    const updates: ContractUpdatePayload[] = [];
    if (!task.artifacts) return updates;

    for (const artifact of task.artifacts) {
      const update = extractContractUpdate(artifact);
      if (update) {
        updates.push(update);
      }
    }
    return updates;
  }
}
