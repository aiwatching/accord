// Accord A2A — Contract update validation
//
// Validates contract updates received via A2A artifacts:
// 1. JSON Patch operation validity (RFC 6902)
// 2. Contract status transition legality
// 3. Breaking change detection (path/method removal)

import type { ContractUpdatePayload, JSONPatchOperation } from './types.js';

// ── Contract status transitions ──────────────────────────────────────────────

/** Valid contract status values (from x-accord-status) */
export type ContractStatus = 'draft' | 'stable' | 'proposed' | 'deprecated';

/** Legal status transitions */
const VALID_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['stable', 'proposed', 'deprecated'],
  stable: ['proposed', 'deprecated'],
  proposed: ['stable', 'deprecated'],
  deprecated: [], // terminal state
};

// ── Validation result types ──────────────────────────────────────────────────

export interface ValidationError {
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

// ── Validators ───────────────────────────────────────────────────────────────

/** Validate a single JSON Patch operation (RFC 6902 structural check) */
function validateOperation(op: JSONPatchOperation, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const prefix = `operations[${index}]`;

  const validOps = ['add', 'remove', 'replace', 'move', 'copy', 'test'];
  if (!validOps.includes(op.op)) {
    errors.push({
      code: 'INVALID_OP',
      message: `${prefix}: invalid operation "${op.op}". Must be one of: ${validOps.join(', ')}`,
    });
  }

  if (!op.path || typeof op.path !== 'string') {
    errors.push({
      code: 'MISSING_PATH',
      message: `${prefix}: "path" is required and must be a string`,
    });
  } else if (!op.path.startsWith('/')) {
    errors.push({
      code: 'INVALID_PATH',
      message: `${prefix}: "path" must start with "/" (got "${op.path}")`,
    });
  }

  // 'add', 'replace', 'test' require a 'value'
  if (['add', 'replace', 'test'].includes(op.op) && op.value === undefined) {
    errors.push({
      code: 'MISSING_VALUE',
      message: `${prefix}: "${op.op}" operation requires a "value" field`,
    });
  }

  // 'move', 'copy' require a 'from'
  if (['move', 'copy'].includes(op.op) && !op.from) {
    errors.push({
      code: 'MISSING_FROM',
      message: `${prefix}: "${op.op}" operation requires a "from" field`,
    });
  }

  return errors;
}

/** Parse a status transition string like "stable -> proposed" */
function parseTransition(transition: string): { from: ContractStatus; to: ContractStatus } | null {
  const match = transition.match(/^\s*(\w+)\s*->\s*(\w+)\s*$/);
  if (!match) return null;

  const from = match[1] as ContractStatus;
  const to = match[2] as ContractStatus;

  if (!VALID_TRANSITIONS[from] || !VALID_TRANSITIONS[to] === undefined) return null;

  return { from, to };
}

/** Detect breaking changes: removal of paths or methods */
function detectBreakingChanges(operations: JSONPatchOperation[]): ValidationError[] {
  const warnings: ValidationError[] = [];

  for (const op of operations) {
    if (op.op === 'remove' && op.path) {
      // Removing a path (e.g. /paths/~1api~1v1~1users) is always breaking
      if (op.path.startsWith('/paths/')) {
        warnings.push({
          code: 'BREAKING_PATH_REMOVAL',
          message: `Breaking change: removing path "${decodePath(op.path)}"`,
          path: op.path,
        });
      }

      // Removing a schema component is potentially breaking
      if (op.path.startsWith('/components/schemas/')) {
        warnings.push({
          code: 'BREAKING_SCHEMA_REMOVAL',
          message: `Breaking change: removing schema "${op.path.split('/').pop()}"`,
          path: op.path,
        });
      }

      // Removing a required field
      if (op.path.includes('/required/')) {
        // This is actually non-breaking (removing a required constraint)
        // No warning needed
      }
    }

    // Replacing a path with something entirely different could be breaking
    if (op.op === 'replace' && op.path?.startsWith('/paths/')) {
      warnings.push({
        code: 'BREAKING_PATH_REPLACE',
        message: `Potentially breaking: replacing path "${decodePath(op.path)}"`,
        path: op.path,
      });
    }
  }

  return warnings;
}

/** Decode JSON Pointer path segments (RFC 6901: ~1 = /, ~0 = ~) */
function decodePath(jsonPointer: string): string {
  return jsonPointer.replace(/~1/g, '/').replace(/~0/g, '~');
}

// ── Main validation function ─────────────────────────────────────────────────

/**
 * Validate a ContractUpdatePayload.
 *
 * Checks:
 * 1. contract_path is non-empty
 * 2. operations are valid JSON Patch (RFC 6902)
 * 3. contract_status_transition is legal (if present)
 * 4. Breaking changes are flagged as warnings
 */
export function validateContractUpdate(update: ContractUpdatePayload): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // 1. Basic structure
  if (update.type !== 'openapi-patch') {
    errors.push({
      code: 'INVALID_TYPE',
      message: `Unsupported update type: "${update.type}". Only "openapi-patch" is supported.`,
    });
  }

  if (!update.contract_path || typeof update.contract_path !== 'string') {
    errors.push({
      code: 'MISSING_CONTRACT_PATH',
      message: 'contract_path is required and must be a non-empty string',
    });
  }

  if (!Array.isArray(update.operations)) {
    errors.push({
      code: 'MISSING_OPERATIONS',
      message: 'operations must be an array of JSON Patch operations',
    });
    return { valid: false, errors, warnings };
  }

  // 2. Validate each operation
  for (let i = 0; i < update.operations.length; i++) {
    errors.push(...validateOperation(update.operations[i], i));
  }

  // 3. Validate status transition
  if (update.contract_status_transition) {
    const transition = parseTransition(update.contract_status_transition);
    if (!transition) {
      errors.push({
        code: 'INVALID_TRANSITION_FORMAT',
        message: `Invalid transition format: "${update.contract_status_transition}". Expected "from -> to" (e.g. "stable -> proposed")`,
      });
    } else if (!VALID_TRANSITIONS[transition.from]?.includes(transition.to)) {
      errors.push({
        code: 'ILLEGAL_TRANSITION',
        message: `Illegal status transition: "${transition.from}" → "${transition.to}". Allowed from "${transition.from}": ${VALID_TRANSITIONS[transition.from].join(', ') || 'none'}`,
      });
    }
  }

  // 4. Breaking change detection (warnings only)
  warnings.push(...detectBreakingChanges(update.operations));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
