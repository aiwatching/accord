// Accord A2A Extension URI + DataPart build/extract utilities

import type { Part, DataPart, Artifact, Message } from '@a2a-js/sdk';
import type { AccordRequestPayload, ContractUpdatePayload } from './types.js';

/** The accord-contracts extension URI */
export const ACCORD_EXTENSION_URI = 'https://accord-protocol.dev/ext/contracts/v1';

// ── DataPart builders ────────────────────────────────────────────────────

/** Build a DataPart carrying an accord_request */
export function buildAccordRequestPart(payload: AccordRequestPayload): DataPart {
  return {
    kind: 'data',
    data: { accord_request: payload },
    metadata: { extension: ACCORD_EXTENSION_URI },
  };
}

/** Build a contract-update Artifact */
export function buildContractUpdateArtifact(
  artifactId: string,
  update: ContractUpdatePayload,
  requestId: string,
): Artifact {
  return {
    artifactId,
    name: 'contract-update',
    parts: [
      {
        kind: 'data',
        data: update as unknown as Record<string, unknown>,
        metadata: {
          extension: ACCORD_EXTENSION_URI,
          request_id: requestId,
        },
      },
    ],
  };
}

// ── DataPart extractors ──────────────────────────────────────────────────

/** Check if a Part is an accord DataPart */
function isAccordDataPart(part: Part): part is DataPart {
  return (
    part.kind === 'data' &&
    part.metadata?.extension === ACCORD_EXTENSION_URI
  );
}

/** Extract AccordRequestPayload from a Message's parts. Returns undefined if not found. */
export function extractAccordRequest(message: Message): AccordRequestPayload | undefined {
  for (const part of message.parts) {
    if (part.kind === 'data') {
      const data = part.data as Record<string, unknown>;
      if (data.accord_request) {
        return data.accord_request as AccordRequestPayload;
      }
    }
  }
  return undefined;
}

/** Extract ContractUpdatePayload from an Artifact's parts. Returns undefined if not found. */
export function extractContractUpdate(artifact: Artifact): ContractUpdatePayload | undefined {
  for (const part of artifact.parts) {
    if (part.kind === 'data') {
      const data = part.data as Record<string, unknown>;
      if (data.type === 'openapi-patch' && data.contract_path && data.operations) {
        return data as unknown as ContractUpdatePayload;
      }
    }
  }
  return undefined;
}

/** Extract request_id from an Artifact's accord DataPart metadata */
export function extractArtifactRequestId(artifact: Artifact): string | undefined {
  for (const part of artifact.parts) {
    if (isAccordDataPart(part)) {
      return part.metadata?.request_id as string | undefined;
    }
  }
  return undefined;
}
