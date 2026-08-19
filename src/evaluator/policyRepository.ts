/**
 * Policy repository port (plan-029 T8 task 6). The evaluator depends on THIS,
 * never on storage: CN, the EG and tests each bring an adapter. The in-memory
 * adapter below is both the test double and the EG's snapshot holder (the EG
 * receives `{ policyVersion, grants }` as serialized JSON — decision 2).
 */
import { type AccessGrant, assertAccessGrant, deserializeGrant } from '../contracts/access.js';

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

  async policyVersion(): Promise<number> {
    return this.version;
  }
}
