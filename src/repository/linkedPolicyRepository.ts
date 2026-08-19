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
      const rows = (await (AccessGrantEntity.select((item: any) => [item.payload])
        .where((item: any) => item.assignee.equals({ id: assignee })) as unknown as ExecTarget)
        .exec(this.ds)) as Array<{ payload?: string }>;
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

  async policyVersion(): Promise<number> {
    const rows = (await (PolicyRegistryEntity.select((item: any) => [item.version])
      .where((item: any) => item.equals({ id: REGISTRY_ID })) as unknown as ExecTarget)
      .exec(this.ds)) as Array<{ version?: string }>;
    const version = rows?.[0]?.version;
    return version ? Number(version) : 0;
  }

  private async bumpVersion(): Promise<void> {
    const current = await this.policyVersion();
    await (DeleteBuilder.from(PolicyRegistryEntity, { id: REGISTRY_ID }) as unknown as ExecTarget).exec(this.ds);
    await (PolicyRegistryEntity.create({ version: String(current + 1) } as never).withId(REGISTRY_ID) as unknown as ExecTarget).exec(this.ds);
  }
}
