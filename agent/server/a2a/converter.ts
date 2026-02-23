// Accord A2A converter — AccordRequest ↔ AccordRequestPayload

import type { AccordRequest } from '../types.js';
import type { AccordRequestPayload } from './types.js';

/** Convert AccordRequest (hub internal) → AccordRequestPayload (A2A transport) */
export function toA2APayload(request: AccordRequest): AccordRequestPayload {
  const fm = request.frontmatter;
  return {
    id: fm.id,
    from: fm.from,
    to: fm.to,
    scope: fm.scope,
    type: fm.type,
    priority: fm.priority,
    related_contract: fm.related_contract,
    directive: fm.directive,
    depends_on_requests: fm.depends_on_requests,
  };
}

/** Convert AccordRequestPayload (A2A transport) + metadata → AccordRequest (hub internal) */
export function fromA2APayload(payload: AccordRequestPayload, filePath: string): AccordRequest {
  const now = new Date().toISOString();
  return {
    frontmatter: {
      id: payload.id,
      from: payload.from,
      to: payload.to,
      scope: payload.scope,
      type: payload.type,
      priority: payload.priority,
      status: 'pending',
      created: now,
      updated: now,
      related_contract: payload.related_contract,
      directive: payload.directive,
      depends_on_requests: payload.depends_on_requests,
    },
    body: '',
    filePath,
    serviceName: payload.to,
  };
}
