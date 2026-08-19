/**
 * plan-029 T9c task 4 — explainability queries.
 *
 * "What can this person reach?" and "Who can reach this?" — both computed
 * from the SAME grants the evaluator reads, so the views can never disagree
 * with enforcement. Each entry names its PATH (direct assignment vs which
 * membership carried it) and revoked grants are excluded from effective
 * access but remain available to history views via `allGrants`.
 */
import { selectorContains } from '../evaluator/evaluator.js';
import type { AccessGrant, AccessSelector } from '../contracts/access.js';
import type { WritablePolicyRepository } from '../evaluator/policyRepository.js';

export interface EffectiveGrantEntry {
  grant: AccessGrant;
  /** How the actor holds it: directly, or through which membership. */
  path: { via: 'direct' } | { via: 'membership'; membershipId: string };
}

/** Everything the actor effectively holds (revoked grants excluded). */
export async function effectiveAccessForActor(
  repository: WritablePolicyRepository,
  input: { actorWebId: string; membershipIds: string[] },
): Promise<EffectiveGrantEntry[]> {
  const grants = await repository.grantsForActor(input.actorWebId, input.membershipIds);
  const memberships = new Set(input.membershipIds);
  return grants
    .filter((grant) => !grant.revocation)
    .map((grant) => ({
      grant,
      path: grant.assignee === input.actorWebId
        ? { via: 'direct' as const }
        : { via: 'membership' as const, membershipId: memberships.has(grant.assignee) ? grant.assignee : grant.assignee },
    }));
}

export interface TargetSubjectEntry {
  grant: AccessGrant;
  /** Why this grant bears on the target: exact match or a containing scope. */
  reason: 'exact-target' | 'containing-scope';
}

/** Every subject whose grants reach the target (revoked excluded). */
export async function subjectsForTarget(
  repository: WritablePolicyRepository,
  target: AccessSelector,
): Promise<TargetSubjectEntry[]> {
  const grants = await repository.allGrants();
  const entries: TargetSubjectEntry[] = [];
  for (const grant of grants) {
    if (grant.revocation) continue;
    const exact = JSON.stringify(grant.target) === JSON.stringify(target);
    if (exact) entries.push({ grant, reason: 'exact-target' });
    else if (selectorContains(grant.target, target)) entries.push({ grant, reason: 'containing-scope' });
  }
  return entries;
}

/** History view: the full ledger for a scope, revoked entries included. */
export async function grantHistoryForProject(
  repository: WritablePolicyRepository,
  projectId: string,
): Promise<AccessGrant[]> {
  const grants = await repository.allGrants();
  return grants.filter((grant) =>
    ('projectId' in grant.target && grant.target.projectId === projectId) ||
    (grant.target.kind === 'workspace' && projectId.startsWith(grant.target.workspaceId)),
  );
}
