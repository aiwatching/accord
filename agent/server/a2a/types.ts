// Accord A2A transport types
// Subset of agent/server/types.ts adapted for A2A transport

export type RequestScope = 'external' | 'internal' | 'cross-team';
export type RequestPriority = 'low' | 'medium' | 'high' | 'critical';
export type MaintainerType = 'ai' | 'human' | 'hybrid' | 'external';

/** Accord request payload carried in A2A DataPart */
export interface AccordRequestPayload {
  id: string;
  from: string;
  to: string;
  scope: RequestScope;
  type: string;
  priority: RequestPriority;
  related_contract?: string;
  directive?: string;
  depends_on_requests?: string[];
}

/** JSON Patch operation (RFC 6902) */
export interface JSONPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

/** Contract update payload carried in A2A Artifact DataPart */
export interface ContractUpdatePayload {
  type: 'openapi-patch';
  contract_path: string;
  operations: JSONPatchOperation[];
  contract_status_transition?: string;
}

/** Metadata attached to input-required status events for approval */
export interface ApprovalMetadata {
  reason: 'approval_needed';
  request_id: string;
  contract_diff_summary?: string;
}

/** Agent Card extension params for accord-contracts */
export interface AccordExtensionParams {
  maintainer: MaintainerType;
  owner?: string;
  language?: string;
  contracts?: {
    external?: string;
    internal?: string[];
  };
  dependencies?: string[];
}
