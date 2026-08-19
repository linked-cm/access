/**
 * The portable authorization evaluator (plan-029 T8). Pure: repository port in,
 * decision record out — no CN dependency, no side effects, deterministic for a
 * given `evaluatedAt`. CN, the EG and app-native enforcement all call THIS.
 *
 * Semantics, in evaluation order:
 *  1. Collect the actor's grants (direct + membership-derived, via the port).
 *  2. Drop grants outside their validity window (against `evaluatedAt`, so a
 *     decision is reproducible — the boundary instant is part of the record).
 *  3. Keep grants whose TARGET contains the requested target (selector
 *     hierarchy below) and whose actions include the requested action.
 *  4. Evaluate conditions FAIL-CLOSED: role/scope inline; resolver conditions
 *     consult the registered resolver — an unregistered or failing resolver
 *     leaves the grant UNRESOLVED, which never permits and is recorded on the
 *     decision (the caller can see exactly what could not be checked).
 *  5. Enforce delegation attenuation against the PARENT at evaluation time:
 *     a derived grant wider than its parent's bounds (action, scope, validity,
 *     depth) contributes nothing, even if it was stored.
 *  6. Explicit deny wins: any surviving `prohibit` defeats every permit.
 */
import {
  type AccessCondition, type AccessDecision, type AccessGrant, type AccessRequest,
  type AccessSelector, type AuthorizationEvaluationService, canonicalSelector,
} from '../contracts/access.js';
import type { PolicyRepository } from './policyRepository.js';

/** A condition resolver: true = satisfied, false = failed. Throw = unresolved. */
export type ConditionResolver = (
  config: Record<string, unknown>,
  request: AccessRequest,
) => Promise<boolean>;

/**
 * Does `container` contain `target`? Default hierarchy uses the CN IRI scheme
 * (`…/workspace/{ws}/project/{p}`): a workspace contains everything under its
 * IRI prefix; a project contains its capability/class/instance/property
 * selectors; a class contains its own property selectors. A CLASS does NOT
 * contain an INSTANCE — instance membership is data, not naming, and guessing
 * it here would permit by coincidence.
 */
export function selectorContains(container: AccessSelector, target: AccessSelector): boolean {
  if (canonicalSelector(container) === canonicalSelector(target)) return true;
  switch (container.kind) {
    case 'workspace': {
      const projectId = 'projectId' in target ? target.projectId : undefined;
      return Boolean(projectId && projectId.startsWith(`${container.workspaceId}/`));
    }
    case 'project':
      return 'projectId' in target && target.kind !== 'project' && target.projectId === container.projectId;
    case 'class':
      return target.kind === 'property' && target.projectId === container.projectId && target.classIri === container.classIri;
    default:
      return false;
  }
}

interface ConditionOutcome { satisfied: boolean; unresolved?: string }

export class AccessEvaluator implements AuthorizationEvaluationService {
  constructor(
    private readonly repository: PolicyRepository,
    private readonly resolvers: Record<string, ConditionResolver> = {},
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async evaluate(request: AccessRequest): Promise<AccessDecision> {
    const evaluatedAt = this.clock();
    const policyVersion = await this.repository.policyVersion();
    const membershipIds = request.context.memberships.map(({ id }) => id);
    const candidates = await this.repository.grantsForActor(request.context.actorWebId, membershipIds);

    const matched: AccessGrant[] = [];
    const unresolvedConditions: AccessDecision['unresolvedConditions'] = [];

    for (const grant of candidates) {
      if (!withinValidity(grant, evaluatedAt)) continue;
      if (!grant.actions.includes(request.action)) continue;
      if (!selectorContains(grant.target, request.target)) continue;
      if (!(await this.attenuationHolds(grant, evaluatedAt))) continue;

      let satisfied = true;
      for (const condition of grant.conditions) {
        const outcome = await this.evaluateCondition(condition, request);
        if (outcome.unresolved) {
          unresolvedConditions.push({ grantId: grant.id, resolver: outcome.unresolved });
          satisfied = false;
          break;
        }
        if (!outcome.satisfied) { satisfied = false; break; }
      }
      if (satisfied) matched.push(grant);
    }

    const prohibited = matched.some((grant) => grant.effect === 'prohibit');
    const permitted = matched.some((grant) => grant.effect === 'permit');
    return {
      allowed: permitted && !prohibited,
      action: request.action,
      target: request.target,
      matchedGrantIds: matched.map(({ id }) => id),
      unresolvedConditions,
      policyVersion,
      decidedAt: evaluatedAt,
    };
  }

  private async evaluateCondition(condition: AccessCondition, request: AccessRequest): Promise<ConditionOutcome> {
    switch (condition.kind) {
      case 'role': {
        const roles = new Set(request.context.memberships.map(({ role }) => role));
        // Role hierarchy: owner ⊇ admin ⊇ member ⊇ viewer.
        const order = ['viewer', 'member', 'admin', 'owner'];
        const required = order.indexOf(condition.role);
        return { satisfied: [...roles].some((role) => order.indexOf(role) >= required) };
      }
      case 'scope':
        // Subject-data restriction composition: the grant applies only where its
        // scope condition CONTAINS the requested target — an org-wide permit
        // with scope(project X) narrows to X.
        return { satisfied: selectorContains(condition.selector, request.target) };
      case 'resolver': {
        const resolver = this.resolvers[condition.resolver];
        if (!resolver) return { satisfied: false, unresolved: condition.resolver };
        try {
          return { satisfied: await resolver(condition.config, request) };
        } catch {
          return { satisfied: false, unresolved: condition.resolver };
        }
      }
    }
  }

  /** Fail-closed attenuation: a derived grant must sit inside its parent. */
  private async attenuationHolds(grant: AccessGrant, evaluatedAt: string): Promise<boolean> {
    if (!grant.derivedFrom) return true;
    const parent = await this.repository.grantById(grant.derivedFrom.grantId);
    if (!parent?.delegation?.delegable || !parent.delegation.attenuation) return false;
    const bounds = parent.delegation.attenuation;
    if (grant.derivedFrom.depth > bounds.maxDepth) return false;
    if (!grant.actions.every((action) => bounds.actions.includes(action))) return false;
    if (!selectorContains(parent.target, grant.target)) return false;
    // The child's validity may not OUTLIVE the parent's.
    if (parent.validity?.until && (!grant.validity?.until || grant.validity.until > parent.validity.until)) return false;
    if (!withinValidity(parent, evaluatedAt)) return false;
    return true;
  }
}

function withinValidity(grant: AccessGrant, at: string): boolean {
  // A revoked grant is dead at ANY instant — even one inside its validity
  // window and even for evaluations dated before the revocation: history is
  // for audit, not for retroactive decisions.
  if (grant.revocation) return false;
  if (grant.validity?.from && at < grant.validity.from) return false;
  if (grant.validity?.until && at >= grant.validity.until) return false;
  return true;
}
