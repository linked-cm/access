/**
 * The grant store is an AUTHORIZATION INPUT: an unreadable one must raise, so a
 * caller can tell "policy unavailable" from "this actor holds no grants".
 * Before this, a failed read was caught and reported as an empty successful
 * result — which silently demoted the actor to whatever the caller's fallback
 * allowed (backlog-046, and the Serve /manage boundary that surfaced it).
 */
import { LinkedPolicyRepository } from './linkedPolicyRepository.js';
import { PolicyReadError } from '../evaluator/policyRepository.js';
import { AccessEvaluator } from '../evaluator/evaluator.js';
import { serializeGrant, type AccessGrant } from '../contracts/access.js';

const projectId = 'serve/serve-community';
const actor = 'https://webid.email/id/serve-user';
const membership = 'https://serve-community.id.create.now/id/membership-1';

const grant: AccessGrant = {
  id: 'urn:grant:management',
  effect: 'permit',
  assignee: membership,
  actions: ['data.read'],
  target: { kind: 'capability', projectId, capability: 'serve.management' },
  conditions: [],
  provenance: { grantedBy: actor, grantedAt: '2026-09-15T00:00:00.000Z' },
  policyVersion: 1,
};

/** Minimal IDataset stand-in: the repository only ever reaches selectQuery here. */
const dataset = (rows: unknown, version = '3'): any => ({
  async selectQuery(query: any) {
    if (typeof rows === 'function') return (rows as () => unknown)();
    const shape = String(query?.shape?.id ?? query?.shape ?? '');
    if (shape.includes('PolicyRegistry')) return [{ id: 'registry', version }];
    return rows;
  },
  async askQuery() {
    return false;
  },
});

describe('LinkedPolicyRepository grant reads', () => {
  it('returns the stored grants for an actor and their memberships', async () => {
    const repository = new LinkedPolicyRepository(
      dataset([{ id: grant.id, payload: serializeGrant(grant) }]),
    );
    const grants = await repository.grantsForActor(actor, [membership]);
    // One row per assignee queried (actor + membership); both resolve the payload.
    expect(grants.map(({ id }) => id)).toEqual([grant.id, grant.id]);
  });

  it('raises PolicyReadError instead of reporting an unreadable store as no grants', async () => {
    const repository = new LinkedPolicyRepository(
      dataset(() => {
        throw new Error('Fuseki unreachable');
      }),
    );
    await expect(repository.grantsForActor(actor, [membership])).rejects.toBeInstanceOf(PolicyReadError);
  });

  it('raises when the delegation parent lookup fails', async () => {
    const repository = new LinkedPolicyRepository(
      dataset(() => {
        throw new Error('Fuseki unreachable');
      }),
    );
    await expect(repository.grantById(grant.id)).rejects.toBeInstanceOf(PolicyReadError);
  });

  it('propagates the failure through the evaluator rather than deciding on it', async () => {
    const repository = new LinkedPolicyRepository(
      dataset(() => {
        throw new Error('Fuseki unreachable');
      }),
    );
    await expect(
      new AccessEvaluator(repository).evaluate({
        context: { actorWebId: actor, projectId, memberships: [], capabilityActivations: [] },
        action: 'data.read',
        target: { kind: 'capability', projectId, capability: 'serve.management' },
      }),
    ).rejects.toBeInstanceOf(PolicyReadError);
  });

  it('still tolerates an unreadable policy version — a counter is not a decision', async () => {
    const repository = new LinkedPolicyRepository(
      dataset(() => {
        throw new Error('Fuseki unreachable');
      }),
    );
    await expect(repository.policyVersion()).resolves.toBe(0);
  });
});
