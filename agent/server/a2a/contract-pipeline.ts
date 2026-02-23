// Accord A2A — Contract update pipeline
//
// End-to-end pipeline: receive A2A artifact → validate → apply patch → git commit → notify dependents
//
// This module subscribes to `a2a:artifact-update` events and processes
// contract-update artifacts through the validation/application pipeline.

import * as fs from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';
import { validateContractUpdate, type ValidationResult } from './contract-validator.js';
import type { ContractUpdatePayload, JSONPatchOperation } from './types.js';
import { eventBus, type A2AArtifactUpdateEvent } from '../event-bus.js';
import { gitCommit } from '../git-sync.js';
import { logger } from '../logger.js';

// ── JSON Patch application (RFC 6902) ────────────────────────────────────────

/**
 * Apply a single JSON Patch operation to a document.
 * Supports: add, remove, replace, move, copy, test
 */
function applyOperation(doc: Record<string, unknown>, op: JSONPatchOperation): void {
  const segments = parsePath(op.path);

  switch (op.op) {
    case 'add':
      setAtPath(doc, segments, op.value);
      break;

    case 'remove':
      removeAtPath(doc, segments);
      break;

    case 'replace':
      removeAtPath(doc, segments);
      setAtPath(doc, segments, op.value);
      break;

    case 'move': {
      const fromSegments = parsePath(op.from!);
      const value = getAtPath(doc, fromSegments);
      removeAtPath(doc, fromSegments);
      setAtPath(doc, segments, value);
      break;
    }

    case 'copy': {
      const fromSegments = parsePath(op.from!);
      const value = getAtPath(doc, fromSegments);
      setAtPath(doc, segments, structuredClone(value));
      break;
    }

    case 'test': {
      const actual = getAtPath(doc, segments);
      if (JSON.stringify(actual) !== JSON.stringify(op.value)) {
        throw new Error(`Test failed at "${op.path}": expected ${JSON.stringify(op.value)}, got ${JSON.stringify(actual)}`);
      }
      break;
    }
  }
}

/** Parse a JSON Pointer (RFC 6901) into path segments */
function parsePath(pointer: string): string[] {
  if (!pointer || pointer === '/') return [];
  return pointer.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** Get a value at a JSON Pointer path */
function getAtPath(doc: unknown, segments: string[]): unknown {
  let current: unknown = doc;
  for (const seg of segments) {
    if (current === null || current === undefined) {
      throw new Error(`Path not found: segment "${seg}" on null/undefined`);
    }
    if (Array.isArray(current)) {
      current = current[parseInt(seg, 10)];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[seg];
    } else {
      throw new Error(`Cannot traverse "${seg}" on non-object`);
    }
  }
  return current;
}

/** Set a value at a JSON Pointer path, creating intermediate objects as needed */
function setAtPath(doc: Record<string, unknown>, segments: string[], value: unknown): void {
  if (segments.length === 0) return;

  let current: Record<string, unknown> = doc;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!(seg in current) || current[seg] === null || typeof current[seg] !== 'object') {
      current[seg] = {};
    }
    current = current[seg] as Record<string, unknown>;
  }

  const lastSeg = segments[segments.length - 1];
  if (Array.isArray(current) && lastSeg === '-') {
    current.push(value);
  } else {
    current[lastSeg] = value;
  }
}

/** Remove a value at a JSON Pointer path */
function removeAtPath(doc: Record<string, unknown>, segments: string[]): void {
  if (segments.length === 0) return;

  let current: Record<string, unknown> = doc;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!(seg in current) || typeof current[seg] !== 'object') {
      return; // Path doesn't exist — nothing to remove
    }
    current = current[seg] as Record<string, unknown>;
  }

  const lastSeg = segments[segments.length - 1];
  if (Array.isArray(current)) {
    current.splice(parseInt(lastSeg, 10), 1);
  } else {
    delete current[lastSeg];
  }
}

// ── Pipeline processing ──────────────────────────────────────────────────────

export interface PipelineResult {
  requestId: string;
  service: string;
  validation: ValidationResult;
  applied: boolean;
  contractPath?: string;
  error?: string;
}

/**
 * Process a contract update: validate → apply patch → update status → git commit.
 *
 * @param update The contract update payload from an A2A artifact
 * @param requestId The accord request ID
 * @param service The service that produced the update
 * @param accordDir The accord directory (hub root or .accord/)
 * @returns Pipeline result with validation and application status
 */
export function processContractUpdate(
  update: ContractUpdatePayload,
  requestId: string,
  service: string,
  accordDir: string,
): PipelineResult {
  // Step 1: Validate
  const validation = validateContractUpdate(update);

  if (!validation.valid) {
    logger.warn(`Contract update for ${requestId} failed validation: ${validation.errors.map(e => e.message).join('; ')}`);
    return { requestId, service, validation, applied: false };
  }

  if (validation.warnings.length > 0) {
    for (const w of validation.warnings) {
      logger.warn(`Contract update warning (${requestId}): ${w.message}`);
    }
  }

  // Step 2: Locate and read the contract file
  const contractPath = path.resolve(accordDir, update.contract_path);
  if (!fs.existsSync(contractPath)) {
    // If contract doesn't exist yet and we have 'add' operations, create it
    if (update.operations.some(op => op.op === 'add')) {
      logger.info(`Contract file not found, creating: ${contractPath}`);
      fs.mkdirSync(path.dirname(contractPath), { recursive: true });
      fs.writeFileSync(contractPath, YAML.stringify({ openapi: '3.0.3', info: { title: service, version: '0.1.0' }, paths: {} }), 'utf-8');
    } else {
      return {
        requestId,
        service,
        validation,
        applied: false,
        error: `Contract file not found: ${update.contract_path}`,
      };
    }
  }

  // Step 3: Apply JSON Patch operations
  try {
    const raw = fs.readFileSync(contractPath, 'utf-8');
    const doc = YAML.parse(raw) as Record<string, unknown>;

    for (const op of update.operations) {
      applyOperation(doc, op);
    }

    // Step 4: Update x-accord-status if transition is specified
    if (update.contract_status_transition) {
      const match = update.contract_status_transition.match(/^\s*\w+\s*->\s*(\w+)\s*$/);
      if (match) {
        const info = doc.info as Record<string, unknown> | undefined;
        if (info) {
          info['x-accord-status'] = match[1];
        }
      }
    }

    // Step 5: Write back
    const yamlStr = YAML.stringify(doc, { lineWidth: 120 });
    fs.writeFileSync(contractPath, yamlStr, 'utf-8');

    logger.info(`Contract updated: ${update.contract_path} (request: ${requestId}, transition: ${update.contract_status_transition ?? 'none'})`);

    return {
      requestId,
      service,
      validation,
      applied: true,
      contractPath: update.contract_path,
    };
  } catch (err) {
    logger.error(`Failed to apply contract update for ${requestId}: ${err}`);
    return {
      requestId,
      service,
      validation,
      applied: false,
      error: `Patch application failed: ${err}`,
    };
  }
}

/**
 * Subscribe to `a2a:artifact-update` events and process contract updates.
 * Call this once during Hub startup to wire the pipeline.
 *
 * @param accordDir The accord directory for locating contract files
 * @param hubDir The hub directory for git operations
 */
export function startContractPipeline(accordDir: string, hubDir: string): void {
  eventBus.on('a2a:artifact-update', (event: A2AArtifactUpdateEvent) => {
    // Only process contract-update artifacts
    if (event.artifactName !== 'contract-update') return;

    const update = event.artifactData as ContractUpdatePayload;
    if (!update || update.type !== 'openapi-patch') return;

    const result = processContractUpdate(update, event.requestId, event.service, accordDir);

    if (result.applied) {
      // Commit the contract change to git
      gitCommit(hubDir, `accord: contract update for ${event.requestId} (${event.service}) — ${update.contract_status_transition ?? 'patch'}`);
      logger.info(`Contract pipeline: committed update for ${event.requestId}`);
    }
  });

  logger.info('Contract pipeline: listening for a2a:artifact-update events');
}
