// Accord A2A — Service AgentExecutor
// Real implementation that invokes AI agents via the existing adapter infrastructure.
//
// Flow:
// 1. Receives message → extracts accord_request DataPart
// 2. Sends "working" status
// 3. If type=api-addition + scope=external → sends "input-required" (approval)
// 4. Waits for follow-up message (approval) → resumes
// 5. Invokes AI agent via adapter (with streaming status updates)
// 6. Generates contract-update Artifact if applicable
// 7. Sends "completed" + final: true

import { v4 as uuidv4 } from 'uuid';
import type {
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Message,
} from '@a2a-js/sdk';
import type { AgentExecutor, RequestContext, ExecutionEventBus } from '@a2a-js/sdk/server';
import {
  extractAccordRequest,
  buildContractUpdateArtifact,
  ACCORD_EXTENSION_URI,
} from './extension.js';
import type { AccordRequestPayload, ContractUpdatePayload } from './types.js';
import { fromA2APayload } from './converter.js';
import { buildAgentPrompt } from '../prompt.js';
import type { AgentAdapter } from '../adapters/adapter.js';
import type { AccordConfig, DispatcherConfig } from '../types.js';
import { getServiceDir, getAccordDir } from '../config.js';
import { logger } from '../logger.js';

function makeMessage(taskId: string, contextId: string, text: string): Message {
  return {
    kind: 'message',
    role: 'agent',
    messageId: uuidv4(),
    parts: [{ kind: 'text', text }],
    taskId,
    contextId,
  };
}

export interface AccordExecutorOptions {
  serviceName: string;
  adapter: AgentAdapter;
  accordConfig: AccordConfig;
  dispatcherConfig: DispatcherConfig;
  hubDir: string;
}

export class AccordExecutor implements AgentExecutor {
  private serviceName: string;
  private adapter: AgentAdapter;
  private accordConfig: AccordConfig;
  private dispatcherConfig: DispatcherConfig;
  private hubDir: string;

  constructor(options: AccordExecutorOptions) {
    this.serviceName = options.serviceName;
    this.adapter = options.adapter;
    this.accordConfig = options.accordConfig;
    this.dispatcherConfig = options.dispatcherConfig;
    this.hubDir = options.hubDir;
  }

  async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId, userMessage, task } = ctx;

    // If this is a follow-up message (approval), handle resume
    if (task && task.status.state === 'input-required') {
      await this.handleApproval(taskId, contextId, task, bus);
      return;
    }

    // Publish initial Task object (required by SDK's ResultManager)
    if (!task) {
      const initialTask: Task = {
        kind: 'task',
        id: taskId,
        contextId,
        status: { state: 'submitted', timestamp: new Date().toISOString() },
        history: [userMessage],
      };
      bus.publish(initialTask);
    }

    // Extract accord_request from the incoming message
    const accordRequest = extractAccordRequest(userMessage);
    if (!accordRequest) {
      const status: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: 'completed',
          message: makeMessage(taskId, contextId, 'No accord_request found in message.'),
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      bus.publish(status);
      return;
    }

    // Publish "working" status
    bus.publish({
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: 'working',
        message: makeMessage(
          taskId,
          contextId,
          `Processing accord request ${accordRequest.id}: ${accordRequest.type} from ${accordRequest.from}`,
        ),
        timestamp: new Date().toISOString(),
      },
      final: false,
    } satisfies TaskStatusUpdateEvent);

    // If type=api-addition + scope=external → require approval
    if (accordRequest.type === 'api-addition' && accordRequest.scope === 'external') {
      const inputRequired: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: 'input-required',
          message: makeMessage(
            taskId,
            contextId,
            `Approval required: adding external API endpoint for request ${accordRequest.id}.`,
          ),
          timestamp: new Date().toISOString(),
        },
        final: true,
        metadata: {
          [ACCORD_EXTENSION_URI]: {
            reason: 'approval_needed',
            request_id: accordRequest.id,
            contract_diff_summary: `Add ${accordRequest.type} to ${accordRequest.to}`,
          },
        },
      };
      bus.publish(inputRequired);
      return;
    }

    // Execute via agent adapter
    await this.executeWithAgent(taskId, contextId, accordRequest, bus);
  }

  async cancelTask(taskId: string, bus: ExecutionEventBus): Promise<void> {
    const canceled: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId: taskId,
      status: { state: 'canceled', timestamp: new Date().toISOString() },
      final: true,
    };
    bus.publish(canceled);
  }

  private async handleApproval(
    taskId: string,
    contextId: string,
    existingTask: Task,
    bus: ExecutionEventBus,
  ): Promise<void> {
    // Resume after approval — publish "working" again
    bus.publish({
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: 'working',
        message: makeMessage(taskId, contextId, 'Approval received. Resuming execution...'),
        timestamp: new Date().toISOString(),
      },
      final: false,
    } satisfies TaskStatusUpdateEvent);

    // Extract the original request from task history
    let accordRequest: AccordRequestPayload | undefined;
    if (existingTask.history) {
      for (const msg of existingTask.history) {
        accordRequest = extractAccordRequest(msg);
        if (accordRequest) break;
      }
    }

    if (!accordRequest) {
      bus.publish({
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: 'failed',
          message: makeMessage(taskId, contextId, 'Could not recover original request from task history.'),
          timestamp: new Date().toISOString(),
        },
        final: true,
      } satisfies TaskStatusUpdateEvent);
      return;
    }

    await this.executeWithAgent(taskId, contextId, accordRequest, bus);
  }

  private async executeWithAgent(
    taskId: string,
    contextId: string,
    accordRequest: AccordRequestPayload,
    bus: ExecutionEventBus,
  ): Promise<void> {
    const serviceDir = getServiceDir(this.accordConfig, this.serviceName, this.hubDir);
    const accordDir = getAccordDir(serviceDir, this.accordConfig);

    // Build AccordRequest from payload for prompt building
    const request = fromA2APayload(accordRequest, `a2a-task-${taskId}`);

    // Build prompt using existing prompt builder
    const prompt = buildAgentPrompt({
      request,
      serviceName: this.serviceName,
      targetDir: serviceDir,
      accordDir,
    });

    logger.info(`A2A Executor: invoking agent for ${accordRequest.id} (service: ${this.serviceName})`);

    try {
      const result = await this.adapter.invoke({
        prompt,
        cwd: serviceDir,
        timeout: this.dispatcherConfig.request_timeout,
        model: this.dispatcherConfig.model,
        maxTurns: 50,
        maxBudgetUsd: this.dispatcherConfig.max_budget_usd,
        onOutput: (event) => {
          // Stream agent output as status updates
          if (event.type === 'text' || event.type === 'tool_use') {
            const text = event.type === 'text' ? event.text : `[${event.tool}] ${event.input}`;
            bus.publish({
              kind: 'status-update',
              taskId,
              contextId,
              status: {
                state: 'working',
                message: makeMessage(taskId, contextId, text),
                timestamp: new Date().toISOString(),
              },
              final: false,
            } satisfies TaskStatusUpdateEvent);
          }
        },
      });

      logger.info(`A2A Executor: agent completed for ${accordRequest.id} — ${result.numTurns} turns, $${result.costUsd?.toFixed(4)}`);

      // Generate contract-update artifact if there's a related contract
      if (accordRequest.related_contract) {
        await this.publishContractArtifact(taskId, contextId, accordRequest, bus);
      }

      // Publish completed status
      bus.publish({
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: 'completed',
          message: makeMessage(
            taskId,
            contextId,
            `Request ${accordRequest.id} completed. Turns: ${result.numTurns ?? '?'}, Cost: $${result.costUsd?.toFixed(4) ?? '?'}`,
          ),
          timestamp: new Date().toISOString(),
        },
        final: true,
      } satisfies TaskStatusUpdateEvent);
    } catch (err) {
      logger.error(`A2A Executor: agent failed for ${accordRequest.id}: ${err}`);

      bus.publish({
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: 'failed',
          message: makeMessage(taskId, contextId, `Agent execution failed: ${err}`),
          timestamp: new Date().toISOString(),
        },
        final: true,
      } satisfies TaskStatusUpdateEvent);
    }
  }

  private async publishContractArtifact(
    taskId: string,
    contextId: string,
    accordRequest: AccordRequestPayload,
    bus: ExecutionEventBus,
  ): Promise<void> {
    // Build a placeholder contract update artifact
    // In production, the agent itself would produce the actual contract changes,
    // and this would extract them from the agent's output or the modified files.
    const update: ContractUpdatePayload = {
      type: 'openapi-patch',
      contract_path: accordRequest.related_contract ?? '',
      operations: [],
      contract_status_transition: 'stable -> proposed',
    };

    const artifact = buildContractUpdateArtifact(
      `contract-update-${uuidv4().slice(0, 8)}`,
      update,
      accordRequest.id,
    );

    const artifactEvent: TaskArtifactUpdateEvent = {
      kind: 'artifact-update',
      taskId,
      contextId,
      artifact,
      lastChunk: true,
    };
    bus.publish(artifactEvent);
  }
}
