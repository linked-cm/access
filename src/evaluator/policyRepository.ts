/**
 * Policy repository port (plan-029 T8 task 6). The evaluator depends on THIS,
 * never on storage: CN, the EG and tests each bring an adapter. The in-memory
 * adapter below is both the test double and the EG's snapshot holder (the EG
 * receives `{ policyVersion, grants }` as serialized JSON — decision 2).
 */
import { type AccessGrant, assertAccessGrant, deserializeGrant } from '../contracts/access.js';

/**
 * A grant store that could not be read.
 *
 * Grants are an AUTHORIZATION INPUT. An adapter that cannot read them knows
 * nothing about the actor — which is not the same as knowing the actor holds
 * no grants, and must never be reported as the latter. Every adapter raises
 * this instead of returning `[]`, so the caller can render "policy
 * unavailable" rather than a successful denial (or, where a fallback exists,
 * an unintended permit).
 *
 * The policy VERSION is deliberately not covered by this: it is a
 * cache-invalidation counter that no decision depends on, and
 * `policyVersion()` stays tolerant of a failed read.
 */
export class PolicyReadError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'PolicyReadError';
  }
}

export interface PolicyRepository {
  /** Every grant that could bear on the actor (direct + membership-derived). */
  grantsForActor(actorWebId: string, membershipIds: string[]): Promise<AccessGrant[]>;
  /** Parent lookup for delegation-attenuation enforcement. */
  grantById(grantId: string): Promise<AccessGrant | undefined>;
  /** Monotonic dataset version (cache keys, decision records). */
  policyVersion(): Promise<number>;
}

/** A repository that also accepts writes (both shipped adapters do). */
export interface WritablePolicyRepository extends PolicyRepository {
  /** Every stored grant, revoked ones included — the management/audit view (T9c). */
  allGrants(): Promise<AccessGrant[]> | AccessGrant[];
  /** Idempotent upsert; bumps the policy version. */
  put(grant: AccessGrant): void | Promise<void>;
  /** Removes the grant if present; bumps the version only when it was. */
  revoke(grantId: string): void | Promise<void>;
}

export class InMemoryPolicyRepository implements WritablePolicyRepository {
  private readonly grants = new Map<string, AccessGrant>();
  private version = 0;

  static fromSnapshot(snapshot: { policyVersion: number; grants: string[] }): InMemoryPolicyRepository {
    const repository = new InMemoryPolicyRepository();
    for (const json of snapshot.grants) repository.put(deserializeGrant(json));
    repository.version = snapshot.policyVersion;
    return repository;
  }

  put(grant: AccessGrant): void {
    assertAccessGrant(grant);
    this.grants.set(grant.id, grant);
    this.version += 1;
  }

  revoke(grantId: string): void {
    if (this.grants.delete(grantId)) this.version += 1;
  }

  async grantsForActor(actorWebId: string, membershipIds: string[]): Promise<AccessGrant[]> {
    const assignees = new Set([actorWebId, ...membershipIds]);
    return [...this.grants.values()].filter((grant) => assignees.has(grant.assignee));
  }

  async grantById(grantId: string): Promise<AccessGrant | undefined> {
    return this.grants.get(grantId);
  }

  allGrants(): AccessGrant[] {
    return [...this.grants.values()];
  }

  async policyVersion(): Promise<number> {
    return this.version;
  }
}
