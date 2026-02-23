// Accord A2A — Service A2A Server factory
// Creates a standalone Express-based A2A server for a single service.

import express from 'express';
import { AGENT_CARD_PATH } from '@a2a-js/sdk';
import { InMemoryTaskStore, DefaultRequestHandler } from '@a2a-js/sdk/server';
import { agentCardHandler, jsonRpcHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import { createServiceAgentCard, type AgentCardOptions } from './agent-card.js';
import { AccordExecutor, type AccordExecutorOptions } from './executor.js';
import type { AgentCard } from '@a2a-js/sdk';
import { logger } from '../logger.js';

export interface A2AServiceOptions {
  /** Options for building the AgentCard */
  agentCard: AgentCardOptions;
  /** Options for the AccordExecutor */
  executor: AccordExecutorOptions;
}

export interface A2AService {
  app: express.Express;
  agentCard: AgentCard;
  port: number;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Create an A2A service server for a single Accord service.
 */
export function createA2AService(options: A2AServiceOptions): A2AService {
  const agentCard = createServiceAgentCard(options.agentCard);
  const taskStore = new InMemoryTaskStore();
  const executor = new AccordExecutor(options.executor);
  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, executor);
  const port = options.agentCard.port;

  const app = express();

  // Agent card discovery
  app.use(
    `/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler }),
  );

  // JSON-RPC handler (handles message/send, message/stream, tasks/get, etc.)
  app.use(
    jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  let server: ReturnType<typeof app.listen> | null = null;

  return {
    app,
    agentCard,
    port,

    async start() {
      return new Promise<void>((resolve) => {
        server = app.listen(port, () => {
          logger.info(`A2A Service "${agentCard.name}" listening on http://localhost:${port}`);
          logger.info(`Agent card: http://localhost:${port}/.well-known/agent-card.json`);
          resolve();
        });
      });
    },

    async stop() {
      if (server) {
        return new Promise<void>((resolve, reject) => {
          server!.close((err) => {
            if (err) reject(err);
            else {
              logger.info(`A2A Service "${agentCard.name}" stopped`);
              resolve();
            }
          });
          server = null;
        });
      }
    },
  };
}
