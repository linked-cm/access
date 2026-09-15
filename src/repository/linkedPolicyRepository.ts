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
import { PolicyReadError, type WritablePolicyRepository } from '../evaluator/policyRepository.js';
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
       * A grant read that fails RAISES. It does not degrade to "no grants".
       *
       * This is an authorization input: an unreadable grant store means the
       * adapter knows nothing about the actor, and reporting that as an empty
       * successful result silently demotes them to whatever a caller's
       * fallback allows — or, for a caller with no fallback, dresses a
       * malfunction up as a legitimate denial. Callers distinguish the two by
       * catching PolicyReadError.
       *
       * The query itself was malformed under @_linked/core 2.16 and earlier
       * (the builder emitted a block Fuseki rejected with `Parse error`), and
       * `@_linked/fuseki` 2.x turned that into an empty result set rather than
       * a throw — which is how "no grants" became the shipped behaviour. Both
       * halves are fixed upstream: core 2.18.1 emits a well-formed
       * `FILTER(?assignee = <iri>)` and fuseki 3.0.0 throws on a failed
       * request. Verified against a live Fuseki 5.5.0 on 2026-09-15.
       */
      let rows: Array<{ payload?: string }>;
      try {
        rows = (await (AccessGrantEntity.select((item: any) => [item.payload])
          .where((item: any) => item.assignee.equals({ id: assignee })) as unknown as ExecTarget)
          .exec(this.ds)) as Array<{ payload?: string }>;
      } catch (cause) {
        throw new PolicyReadError(
          `[access] grant lookup failed for ${assignee}: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        );
      }
      for (const row of rows ?? []) {
        if (row?.payload) collected.push(grantFromPayload(row.payload));
      }
    }
    return collected;
  }

  /** Parent lookup for delegation attenuation — also an authorization input, so it raises too. */
  async grantById(grantId: string): Promise<AccessGrant | undefined> {
    let rows: Array<{ payload?: string }>;
    try {
      rows = (await (AccessGrantEntity.select((item: any) => [item.payload])
        .where((item: any) => item.equals({ id: grantId })) as unknown as ExecTarget)
        .exec(this.ds)) as Array<{ payload?: string }>;
    } catch (cause) {
      throw new PolicyReadError(
        `[access] grant lookup failed for ${grantId}: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      );
    }
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
   * Tolerant on purpose, and it stays tolerant now that the query is correct. Failing to read a
   * counter is not a decision about anybody: no grant, role or condition depends on this number,
   * so an unreadable version degrades to "assume it moved", never to "deny". That is the whole
   * difference between this method and `grantsForActor`, which raises.
   *
   * History: under core 2.16 and earlier the builder emitted a block Fuseki rejected with
   * `Parse error`, and `@_linked/fuseki` 3.0.0 turned that rejection into a throw where 2.x had
   * returned an empty result. The throw propagated out of
   * `AccessGrantDocumentAuthorization.permissions()` BEFORE any authorization logic ran, so the
   * Documents route told people with access that they had none. Core 2.18.1 emits a well-formed
   * `FILTER(?s = <iri>)`; this guard now only covers a genuinely unreachable store.
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
