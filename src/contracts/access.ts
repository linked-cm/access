/**
 * @_linked/access — the shared permission contract (plan-029 T7).
 *
 * ONE plain-data contract that the evaluator (T8), CN/EG enforcement (T9a),
 * frontend (T9b) and grant UI (T9c) all compile against. Everything here is
 * serializable JSON — no live shapes ever cross the EG/CN/frontend boundary
 * (the same rule the document contracts follow).
 *
 * Locked Stage-E decisions (Carlen, 2026-08-19 — plan-029 §8):
 *  1. Vocabulary: ODRL rules + CN selector extensions. A grant is an
 *     `odrl:Permission`; CN terms extend under the `cnacl:` namespace.
 *  2. Placement: portable app grants live in the app control/data plane, CN
 *     governance grants in Workspace CN. The exact graph is PROPOSED in
 *     `POLICY_PLACEMENT` below and FLAGGED FOR RENÉ — T9a enforcement must not
 *     land until he confirms it.
 *  3. Conditions: role/scope/class/instance/property grants evaluate in v1;
 *     boundary containment ships immediately after behind the same resolver
 *     interface (T8b); VC and on-chain resolvers later, same interface.
 *  4. Identity: the current dev WebID flows through `PermissionContext`
 *     unchanged; real webid.email/JWT verification replaces how the context is
 *     BUILT (T9d), never the contract itself.
 */

// ── Namespaces (decision 1) ──────────────────────────────────────────────────

export const ODRL = 'http://www.w3.org/ns/odrl/2/';
export const CNACL = 'https://data.create.now/access#';

/** ODRL terms this contract maps onto (kept minimal and closed). */
export const ODRL_TERMS = {
  Permission: `${ODRL}Permission`,
  Prohibition: `${ODRL}Prohibition`,
  action: `${ODRL}action`,
  target: `${ODRL}target`,
  assignee: `${ODRL}assignee`,
  constraint: `${ODRL}constraint`,
} as const;

// ── Actions (closed vocabulary, task 3) ──────────────────────────────────────

/**
 * The CLOSED action vocabulary. Namespaced `<capability>.<verb>` for capability
 * actions plus the CN governance verbs. Adding an action is a contract change,
 * not a string: `assertActionName` rejects anything else at every boundary.
 */
export const ACTION_NAMES = [
  // generic data-plane verbs (`data.aggregate` permits counts/rollups WITHOUT
  // implying instance reads — the aggregate-not-instance rule in the evaluator)
  'data.read', 'data.create', 'data.update', 'data.delete', 'data.aggregate',
  // Documents capability (T9b wires these to the studio surfaces)
  'documents.read', 'documents.ingest', 'documents.review', 'documents.map',
  'documents.commit', 'documents.remove', 'documents.invite',
  // governance (Workspace CN plane)
  'project.manage', 'project.members', 'capability.activate', 'grants.manage',
] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

/** WAC/ODRL interop map — export/import only; internal code uses ActionName. */
export const ACTION_INTEROP: Partial<Record<ActionName, { odrl?: string; wac?: string }>> = {
  'data.read': { odrl: `${ODRL}read`, wac: 'http://www.w3.org/ns/auth/acl#Read' },
  'data.create': { odrl: `${ODRL}modify`, wac: 'http://www.w3.org/ns/auth/acl#Append' },
  'data.update': { odrl: `${ODRL}modify`, wac: 'http://www.w3.org/ns/auth/acl#Write' },
  'data.delete': { odrl: `${ODRL}delete`, wac: 'http://www.w3.org/ns/auth/acl#Write' },
  'documents.read': { odrl: `${ODRL}read` },
  'grants.manage': { wac: 'http://www.w3.org/ns/auth/acl#Control' },
};

export function assertActionName(value: string): asserts value is ActionName {
  if (!(ACTION_NAMES as readonly string[]).includes(value)) {
    throw new AccessContractError(`Unknown action name: ${value}`);
  }
}

// ── Selectors (what a grant targets) ─────────────────────────────────────────

export type AccessSelector =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'capability'; projectId: string; capability: string }
  | { kind: 'class'; projectId: string; classIri: string }
  | { kind: 'instance'; projectId: string; instanceIri: string }
  | { kind: 'property'; projectId: string; classIri: string; propertyIri: string };

const SELECTOR_KINDS = ['workspace', 'project', 'capability', 'class', 'instance', 'property'] as const;

// ── Conditions (decision 3) ──────────────────────────────────────────────────

/**
 * v1 evaluates `role` and `scope` inline. Everything else is addressed by a
 * RESOLVER ID behind one interface — `boundary` ships as T8b, `vc` and `chain`
 * later — so adding a condition kind never changes this contract.
 */
export type AccessCondition =
  | { kind: 'role'; role: 'owner' | 'admin' | 'member' | 'viewer' }
  | { kind: 'scope'; selector: AccessSelector }
  | { kind: 'resolver'; resolver: 'boundary' | 'vc' | 'chain'; config: Record<string, unknown> };

// ── Validity & delegation ────────────────────────────────────────────────────

export interface AccessValidity {
  /** ISO instants; open-ended sides omitted. `from` must precede `until`. */
  from?: string;
  until?: string;
}

export interface AccessDelegation {
  /** May the assignee re-grant? Attenuation bounds are REQUIRED when true. */
  delegable: boolean;
  /** The most a re-grant may carry — never more than the parent grant. */
  attenuation?: { actions: ActionName[]; maxDepth: number };
}

// ── Grants ───────────────────────────────────────────────────────────────────

/** Provenance mirrors the document activity model: who, when, on what basis. */
export interface AccessProvenance {
  grantedBy: string;
  grantedAt: string;
  /** e.g. a membership IRI (reified org:Membership is the membership model). */
  basis?: string;
}

export interface AccessGrant {
  id: string;
  /** odrl:Permission (allow) or odrl:Prohibition (deny; deny wins on tie). */
  effect: 'permit' | 'prohibit';
  assignee: string;
  actions: ActionName[];
  target: AccessSelector;
  conditions: AccessCondition[];
  validity?: AccessValidity;
  delegation?: AccessDelegation;
  provenance: AccessProvenance;
  /**
   * Present on RE-GRANTED (delegated) grants: the parent grant and this grant's
   * depth in the delegation chain (parent depth + 1). The evaluator enforces the
   * parent's attenuation bounds at EVALUATION time, so a stored-but-overbroad
   * delegation still never grants anything.
   */
  derivedFrom?: { grantId: string; depth: number };
  /**
   * T9c: revocation is an EVENT, not a hard delete — the grant stays in the
   * store (history keeps actor + time) but never evaluates again. Revoking a
   * delegation parent kills the chain the same way expiry does.
   */
  revocation?: { revokedBy: string; revokedAt: string };
  /** Monotonic per policy dataset; part of every cache key and decision. */
  policyVersion: number;
}

// ── PermissionContext & decisions (task 4) ───────────────────────────────────

/** Fully serializable — built by the host (dev identity now, JWT via T9d). */
export interface PermissionContext {
  actorWebId: string;
  workspaceId?: string;
  projectId?: string;
  branchId?: string;
  /** Reified org:Membership summaries the host already resolved. */
  memberships: Array<{ id: string; role: string; scope: AccessSelector }>;
  capabilityActivations: string[];
}

export interface AccessRequest {
  context: PermissionContext;
  action: ActionName;
  target: AccessSelector;
}

export interface AccessDecision {
  allowed: boolean;
  action: ActionName;
  target: AccessSelector;
  /** Every grant that matched, permit or prohibit — the audit trail. */
  matchedGrantIds: string[];
  /** Resolver conditions that could not be evaluated (kept, never guessed). */
  unresolvedConditions: Array<{ grantId: string; resolver: string }>;
  policyVersion: number;
  decidedAt: string;
}

export interface AuthorizationEvaluationService {
  evaluate(request: AccessRequest): Promise<AccessDecision>;
}

// ── Cache contract (task 6) ──────────────────────────────────────────────────

/**
 * Decisions cache under (actor, action, canonical target, policyVersion). Any
 * policy write bumps the dataset's version, invalidating every cached decision
 * at once; grant validity windows additionally bound each entry's TTL.
 */
export function decisionCacheKey(request: AccessRequest, policyVersion: number): string {
  return [request.context.actorWebId, request.action, canonicalSelector(request.target), policyVersion].join('|');
}

export function cacheExpiry(grants: AccessGrant[], now: string): string | undefined {
  const bounds = grants.map((grant) => grant.validity?.until).filter((until): until is string => Boolean(until) && (until as string) > now);
  return bounds.sort()[0];
}

// ── Serialization & validation ───────────────────────────────────────────────

export class AccessContractError extends Error {}

export function canonicalSelector(selector: AccessSelector): string {
  switch (selector.kind) {
    case 'workspace': return `workspace:${selector.workspaceId}`;
    case 'project': return `project:${selector.projectId}`;
    case 'capability': return `capability:${selector.projectId}#${selector.capability}`;
    case 'class': return `class:${selector.projectId}#${selector.classIri}`;
    case 'instance': return `instance:${selector.projectId}#${selector.instanceIri}`;
    case 'property': return `property:${selector.projectId}#${selector.classIri}#${selector.propertyIri}`;
  }
}

function assertSelector(value: unknown, path: string): asserts value is AccessSelector {
  const selector = value as AccessSelector;
  if (!selector || typeof selector !== 'object' || !(SELECTOR_KINDS as readonly string[]).includes((selector as { kind?: string }).kind ?? '')) {
    throw new AccessContractError(`${path}: unknown selector kind`);
  }
  const required: Record<AccessSelector['kind'], string[]> = {
    workspace: ['workspaceId'], project: ['projectId'], capability: ['projectId', 'capability'],
    class: ['projectId', 'classIri'], instance: ['projectId', 'instanceIri'], property: ['projectId', 'classIri', 'propertyIri'],
  };
  for (const field of required[selector.kind]) {
    if (typeof (selector as unknown as Record<string, unknown>)[field] !== 'string' || !(selector as unknown as Record<string, string>)[field]) {
      throw new AccessContractError(`${path}: selector '${selector.kind}' requires ${field}`);
    }
  }
}

export function assertAccessGrant(value: unknown): asserts value is AccessGrant {
  const grant = value as AccessGrant;
  if (!grant || typeof grant !== 'object') throw new AccessContractError('grant is not an object');
  if (!grant.id) throw new AccessContractError('grant.id is required');
  if (grant.effect !== 'permit' && grant.effect !== 'prohibit') throw new AccessContractError(`grant.effect must be permit|prohibit`);
  if (!grant.assignee) throw new AccessContractError('grant.assignee is required');
  if (!Array.isArray(grant.actions) || grant.actions.length === 0) throw new AccessContractError('grant.actions must be non-empty');
  for (const action of grant.actions) assertActionName(action);
  assertSelector(grant.target, 'grant.target');
  for (const [index, condition] of (grant.conditions ?? []).entries()) {
    if (condition.kind === 'scope') assertSelector(condition.selector, `grant.conditions[${index}].selector`);
    else if (condition.kind === 'role') { if (!['owner', 'admin', 'member', 'viewer'].includes(condition.role)) throw new AccessContractError(`grant.conditions[${index}]: unknown role`); }
    else if (condition.kind === 'resolver') { if (!['boundary', 'vc', 'chain'].includes(condition.resolver)) throw new AccessContractError(`grant.conditions[${index}]: unknown resolver`); }
    else throw new AccessContractError(`grant.conditions[${index}]: unknown condition kind`);
  }
  if (grant.revocation) {
    if (!grant.revocation.revokedBy || Number.isNaN(Date.parse(grant.revocation.revokedAt))) {
      throw new AccessContractError('grant.revocation requires revokedBy and an ISO revokedAt');
    }
  }
  if (grant.validity) {
    const { from, until } = grant.validity;
    for (const bound of [from, until]) if (bound !== undefined && Number.isNaN(Date.parse(bound))) throw new AccessContractError('grant.validity bounds must be ISO instants');
    if (from && until && from >= until) throw new AccessContractError('grant.validity.from must precede until');
  }
  if (grant.delegation?.delegable) {
    const attenuation = grant.delegation.attenuation;
    // Delegation without bounds is unbounded re-granting — never valid.
    if (!attenuation || attenuation.actions.length === 0 || attenuation.maxDepth < 1) {
      throw new AccessContractError('delegable grants require attenuation bounds (actions + maxDepth >= 1)');
    }
    for (const action of attenuation.actions) {
      assertActionName(action);
      if (!grant.actions.includes(action)) throw new AccessContractError(`attenuation action '${action}' exceeds the grant's own actions`);
    }
  }
  if (!grant.provenance?.grantedBy || !grant.provenance?.grantedAt) throw new AccessContractError('grant.provenance.grantedBy/grantedAt are required');
  if (!Number.isInteger(grant.policyVersion) || grant.policyVersion < 0) throw new AccessContractError('grant.policyVersion must be a non-negative integer');
}

export function serializeGrant(grant: AccessGrant): string {
  assertAccessGrant(grant);
  return JSON.stringify(grant);
}

export function deserializeGrant(json: string): AccessGrant {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new AccessContractError('grant JSON is malformed'); }
  assertAccessGrant(parsed);
  return parsed;
}

// ── Policy placement (decision 2 — PROPOSAL, flagged for René) ───────────────

/**
 * PROPOSED placement — NOT final until René confirms (Stage-E decision 2):
 *  - Portable app grants: `{appDataset}` graph `https://data.create.now/access`
 *    — travels with the app on eject, EG reads it directly.
 *  - CN governance grants: Workspace CN (cn-main) same graph IRI, so one
 *    reader; the EG snapshot is the UNION with app grants shadowing nothing
 *    (governance is additive, deny still wins).
 *  - The EG receives `{ policyVersion, grants }` as serialized JSON at spawn
 *    plus on every version bump — never live shapes.
 */
export const POLICY_PLACEMENT = {
  status: 'proposed-for-rene' as const,
  appGraph: 'https://data.create.now/access',
  governanceDataset: 'cn-main',
  egSnapshot: 'serialized-json-union',
};
