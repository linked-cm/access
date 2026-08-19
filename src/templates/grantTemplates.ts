/**
 * plan-029 T9c — grant templates: template → scope → refine.
 *
 * A template is a NAMED bundle of actions applied to one assignee at one
 * scope. Templates are consulted ONLY at application time — the evaluator
 * never reads a template; what it evaluates are the ordinary grants the
 * application produced (provenance.basis records which template, so template
 * CHANGES can be previewed against live grants without ever silently
 * mutating them).
 *
 * Refinements are property-level permit/deny exceptions the admin PINS on
 * top of a template (e.g. "reviewer, but the email property stays hidden").
 * Pinned grants carry their own basis marker and SURVIVE template
 * reapplication — a template upgrade never quietly unhides a pinned deny.
 */
import {
  AccessContractError,
  canonicalSelector,
  type AccessGrant,
  type AccessSelector,
  type ActionName,
} from '../contracts/access.js';
import type { WritablePolicyRepository } from '../evaluator/policyRepository.js';

export type GrantTemplateId = 'viewer' | 'reviewer' | 'mapper' | 'admin';

export interface GrantTemplate {
  id: GrantTemplateId;
  label: string;
  description: string;
  actions: ActionName[];
}

export const GRANT_TEMPLATES: Record<GrantTemplateId, GrantTemplate> = {
  viewer: {
    id: 'viewer', label: 'Viewer',
    description: 'Read documents and data — no changes.',
    actions: ['documents.read', 'data.read', 'data.aggregate'],
  },
  reviewer: {
    id: 'reviewer', label: 'Reviewer',
    description: 'Read and review (accept/correct) proposed values — no commit, no delete.',
    actions: ['documents.read', 'documents.review', 'data.read', 'data.aggregate'],
  },
  mapper: {
    id: 'mapper', label: 'Mapper',
    description: 'Ingest, map and commit documents into Data — no delete.',
    actions: ['documents.read', 'documents.ingest', 'documents.review', 'documents.map', 'documents.commit', 'data.read', 'data.create', 'data.update', 'data.aggregate'],
  },
  admin: {
    id: 'admin', label: 'Admin',
    description: 'Everything in the capability, including delete and invites.',
    actions: ['documents.read', 'documents.ingest', 'documents.review', 'documents.map', 'documents.commit', 'documents.remove', 'documents.invite', 'data.read', 'data.create', 'data.update', 'data.delete', 'data.aggregate'],
  },
};

/** Basis markers — how a grant declares WHERE it came from. */
export const TEMPLATE_BASIS_PREFIX = 'urn:cn:access:template:';
export const PINNED_BASIS = 'urn:cn:access:pinned';

export interface PropertyRefinement {
  effect: 'permit' | 'prohibit';
  classIri: string;
  propertyIri: string;
  actions: ActionName[];
}

export interface ApplyTemplateInput {
  template: GrantTemplateId;
  assignee: string;
  /** Display hint recorded on provenance (e.g. the invite email) — see AccessProvenance.assigneeLabel. */
  assigneeLabel?: string;
  scope: AccessSelector;
  refinements?: PropertyRefinement[];
  grantedBy: string;
  now: string;
  policyVersion: number;
}

/** Deterministic ids: reapplication REPLACES, never duplicates. */
export function templateGrantId(scope: AccessSelector, assignee: string): string {
  return `urn:cn:access:grant:template:${encodeURIComponent(canonicalSelector(scope))}:${encodeURIComponent(assignee)}`;
}
export function refinementGrantId(scope: AccessSelector, assignee: string, refinement: PropertyRefinement): string {
  return `urn:cn:access:grant:pinned:${encodeURIComponent(canonicalSelector(scope))}:${encodeURIComponent(assignee)}:${encodeURIComponent(refinement.propertyIri)}`;
}

function projectIdOf(scope: AccessSelector): string {
  if ('projectId' in scope) return scope.projectId;
  throw new AccessContractError('property refinements need a project-scoped selector');
}

/** The grants a template application WOULD write (pure — no repository). */
export function templateGrants(input: ApplyTemplateInput): AccessGrant[] {
  const template = GRANT_TEMPLATES[input.template];
  if (!template) throw new AccessContractError(`unknown template: ${input.template}`);
  const base: AccessGrant = {
    id: templateGrantId(input.scope, input.assignee),
    effect: 'permit',
    assignee: input.assignee,
    actions: [...template.actions],
    target: input.scope,
    conditions: [],
    provenance: { grantedBy: input.grantedBy, grantedAt: input.now, basis: `${TEMPLATE_BASIS_PREFIX}${template.id}`, ...(input.assigneeLabel ? { assigneeLabel: input.assigneeLabel } : {}) },
    policyVersion: input.policyVersion,
  };
  const refinements = (input.refinements ?? []).map((refinement): AccessGrant => ({
    id: refinementGrantId(input.scope, input.assignee, refinement),
    effect: refinement.effect,
    assignee: input.assignee,
    actions: [...refinement.actions],
    target: { kind: 'property', projectId: projectIdOf(input.scope), classIri: refinement.classIri, propertyIri: refinement.propertyIri },
    conditions: [],
    provenance: { grantedBy: input.grantedBy, grantedAt: input.now, basis: PINNED_BASIS, ...(input.assigneeLabel ? { assigneeLabel: input.assigneeLabel } : {}) },
    policyVersion: input.policyVersion,
  }));
  return [base, ...refinements];
}

export interface TemplateChange {
  kind: 'create' | 'replace' | 'keep-pinned';
  grant: AccessGrant;
  /** For `replace`: what the grant looks like today. */
  previous?: AccessGrant;
}

/**
 * Preview what applying the template would change, against the live grants.
 * Pinned refinements already in the store are KEPT (listed so the admin sees
 * them in the preview), not overwritten — unless the application explicitly
 * carries a refinement for the same property.
 */
export async function previewTemplateApplication(
  repository: WritablePolicyRepository,
  input: ApplyTemplateInput,
): Promise<TemplateChange[]> {
  const wanted = templateGrants(input);
  const changes: TemplateChange[] = [];
  const wantedIds = new Set(wanted.map(({ id }) => id));
  for (const grant of wanted) {
    const previous = await repository.grantById(grant.id);
    changes.push(previous && !previous.revocation ? { kind: 'replace', grant, previous } : { kind: 'create', grant });
  }
  // Pinned edits for this assignee+scope that the application does NOT carry:
  // they survive, and the preview says so.
  const existing = await repository.allGrants();
  for (const grant of existing) {
    if (grant.revocation) continue;
    if (grant.assignee !== input.assignee) continue;
    if (grant.provenance.basis !== PINNED_BASIS) continue;
    if (wantedIds.has(grant.id)) continue;
    if (!('projectId' in grant.target) || grant.target.projectId !== projectIdOf(input.scope)) continue;
    changes.push({ kind: 'keep-pinned', grant });
  }
  return changes;
}

/** Apply = write exactly what the preview showed. Returns the changes applied. */
export async function applyTemplate(
  repository: WritablePolicyRepository,
  input: ApplyTemplateInput,
): Promise<TemplateChange[]> {
  const changes = await previewTemplateApplication(repository, input);
  for (const change of changes) {
    if (change.kind === 'keep-pinned') continue;
    await repository.put(change.grant);
  }
  return changes;
}

/**
 * T9c task 5 — revoke as a timestamped EVENT: the grant stays in the store
 * with `revocation` set (history keeps who/when) and stops evaluating.
 */
export async function revokeGrantAsEvent(
  repository: WritablePolicyRepository,
  grantId: string,
  revocation: { revokedBy: string; revokedAt: string },
): Promise<AccessGrant | undefined> {
  const grant = await repository.grantById(grantId);
  if (!grant || grant.revocation) return grant;
  const revoked: AccessGrant = { ...grant, revocation };
  await repository.put(revoked);
  return revoked;
}
