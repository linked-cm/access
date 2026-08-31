/**
 * Linked Query policy repository (plan-029 T8 task 6, second half).
 *
 * DSL-only by contract — no raw SPARQL string appears anywhere in this file:
 * grants persist through AccessGrantEntity via the core query builders, so the
 * adapter works against ANY dataset the DSL can reach (CN's routed default, an
 * explicit FusekiStore in tests, the EG's store). The optional `ds` target
 * threads through every call, mirroring syncShapes' explicit-dataset pattern.
 *
 * Writes are delete→create on the grant IRI (idempotent re-puts, same pattern
 * as shape materialization) and every mutation bumps the per-dataset
 * PolicyRegistry version — the monotonic number cache keys and decisions carry.
 */
import { DeleteBuilder } from '@_linked/core/queries/DeleteBuilder';
import type { IDataset } from '@_linked/core/interfaces/IDataset';
import { type AccessGrant } from '../contracts/access.js';
import type { WritablePolicyRepository } from '../evaluator/policyRepository.js';
import { AccessGrantEntity, PolicyRegistryEntity } from '../shapes/AccessGrantEntity.js';
import { grantFromPayload, grantToValues } from './grantMapping.js';

const REGISTRY_ID = 'https://data.create.now/access#registry';

type ExecTarget = { exec: (target?: IDataset) => Promise<unknown> };

export class LinkedPolicyRepository implements WritablePolicyRepository {
  constructor(private readonly ds?: IDataset) {}

  async put(grant: AccessGrant): Promise<void> {
    const values = grantToValues(grant); // validates via serializeGrant
    await (DeleteBuilder.from(AccessGrantEntity, { id: grant.id }) as unknown as ExecTarget).exec(this.ds);
    await (AccessGrantEntity.create(values as never).withId(grant.id) as unknown as ExecTarget).exec(this.ds);
    await this.bumpVersion();
  }

  async revoke(grantId: string): Promise<void> {
    const existing = await this.grantById(grantId);
    if (!existing) return;
    await (DeleteBuilder.from(AccessGrantEntity, { id: grantId }) as unknown as ExecTarget).exec(this.ds);
    await this.bumpVersion();
  }

  async grantsForActor(actorWebId: string, membershipIds: string[]): Promise<AccessGrant[]> {
    const assignees = [...new Set([actorWebId, ...membershipIds])];
    const collected: AccessGrant[] = [];
    for (const assignee of assignees) {
      /**
       * Restored to the pre-fuseki-3 read behaviour, EXPLICITLY.
       *
       * This query is malformed too, a second instance of the same builder problem. Until 3.0.0 a
       * failed request returned an empty result set, so this has always yielded "no grants" and
       * the membership fallback has been doing the enforcing — the logs corroborate it: every
       * decision reads `policyVersion=0 matched=[]`. Catching restores what has been shipping; it
       * does not newly loosen anything.
       *
       * **But this IS an authorization input**, unlike the version counter: if grants ever exist,
       * an unreadable grant store must not silently demote an actor to whatever the fallback
       * allows. Hence the loud log, and hence the query needs fixing rather than guarding.
       */
      let rows: Array<{ payload?: string }> = [];
      try {
        rows = (await (AccessGrantEntity.select((item: any) => [item.payload])
          .where((item: any) => item.assignee.equals({ id: assignee })) as unknown as ExecTarget)
          .exec(this.ds)) as Array<{ payload?: string }>;
      } catch (cause) {
        console.warn(`[access] grant lookup failed for ${assignee}; falling back to memberships: ${cause instanceof Error ? cause.message : cause}`);
      }
      for (const row of rows ?? []) {
        if (row?.payload) collected.push(grantFromPayload(row.payload));
      }
    }
    return collected;
  }

  async grantById(grantId: string): Promise<AccessGrant | undefined> {
    const rows = (await (AccessGrantEntity.select((item: any) => [item.payload])
      .where((item: any) => item.equals({ id: grantId })) as unknown as ExecTarget)
      .exec(this.ds)) as Array<{ payload?: string }>;
    const payload = rows?.[0]?.payload;
    return payload ? grantFromPayload(payload) : undefined;
  }

  async allGrants(): Promise<AccessGrant[]> {
    const rows = (await (AccessGrantEntity.select((item: any) => [item.payload]) as unknown as ExecTarget)
      .exec(this.ds)) as Array<{ payload?: string }>;
    return (rows ?? []).filter((row) => row?.payload).map((row) => grantFromPayload(row.payload!));
  }

  /**
   * The policy version — a cache-invalidation counter, NOT an authorization input.
   *
   * Tolerant on purpose. `@_linked/fuseki` 3.0.0 makes a failed request throw where 2.x returned
   * an empty result, and this query has been malformed all along (the same builder pattern
   * `Shape.exists()` replaced, emitting a block Fuseki rejects with `Parse error`). The throw
   * then propagated out of `AccessGrantDocumentAuthorization.permissions()` BEFORE any
   * authorization logic ran, so the Documents route told people with access that they had none.
   *
   * Failing to read a counter is not a decision about anybody. No grant, role or condition
   * depends on this number, so an unreadable version degrades to "assume it moved", never to
   * "deny". A guard, not the fix — the query is still wrong, tracked in backlog-046.
   */
  async policyVersion(): Promise<number> {
    try {
      return await this.readVersion();
    } catch (cause) {
      console.warn(`[access] policy version unreadable, treating as 0: ${cause instanceof Error ? cause.message : cause}`);
      return 0;
    }
  }

  private async readVersion(): Promise<number> {
    const rows = (await (PolicyRegistryEntity.select((item: any) => [item.version])
      .where((item: any) => item.equals({ id: REGISTRY_ID })) as unknown as ExecTarget)
      .exec(this.ds)) as Array<{ version?: string }>;
    const version = rows?.[0]?.version;
    return version ? Number(version) : 0;
  }

  private async bumpVersion(): Promise<void> {
    /**
     * STRICT here, deliberately. A read failure that degraded to 0 would make the next bump
     * write 1 and walk the counter backwards — and clients treat an unchanged-or-lower version
     * as "decisions cannot have changed", so they would serve stale permissions after a revoke.
     */
    const current = await this.readVersion();
    await (DeleteBuilder.from(PolicyRegistryEntity, { id: REGISTRY_ID }) as unknown as ExecTarget).exec(this.ds);
    await (PolicyRegistryEntity.create({ version: String(current + 1) } as never).withId(REGISTRY_ID) as unknown as ExecTarget).exec(this.ds);
  }
}
