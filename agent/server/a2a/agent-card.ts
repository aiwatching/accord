// Accord A2A — Dynamic AgentCard builder for service agents

import type { AgentCard } from '@a2a-js/sdk';
import type { ServiceConfig, RegistryYaml } from '../types.js';
import { ACCORD_EXTENSION_URI } from './extension.js';
import type { AccordExtensionParams } from './types.js';

export interface AgentCardOptions {
  service: ServiceConfig;
  registry?: RegistryYaml | null;
  port: number;
  hostname?: string;
}

/**
 * Build an A2A AgentCard for a service, using config and registry data.
 */
export function createServiceAgentCard(options: AgentCardOptions): AgentCard {
  const { service, registry, port, hostname = 'localhost' } = options;

  const extensionParams: AccordExtensionParams = {
    maintainer: registry?.maintainer ?? 'ai',
    owner: registry?.owner,
    language: service.language ?? registry?.language,
    contracts: registry?.contract
      ? { external: registry.contract }
      : undefined,
    dependencies: registry?.depends_on
      ?.filter((d): d is string => typeof d === 'string')
      ?? undefined,
  };

  return {
    name: service.name,
    description: registry?.description ?? `Accord service agent: ${service.name}`,
    url: `http://${hostname}:${port}/`,
    version: '1.0.0',
    protocolVersion: '0.2.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
      extensions: [
        {
          uri: ACCORD_EXTENSION_URI,
          description: 'Contract-first agent coordination for multi-service software projects',
          required: true,
          params: extensionParams as unknown as Record<string, unknown>,
        },
      ],
    },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'api-implementation',
        name: 'API Implementation',
        description: 'Implement API changes per contract specifications',
        tags: ['api', service.language ?? 'code'].filter(Boolean),
      },
      {
        id: 'contract-scan',
        name: 'Contract Scanning',
        description: 'Scan codebase and update API contracts',
        tags: ['scan', 'openapi'],
      },
    ],
  };
}
