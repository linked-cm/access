/** T8b — boundary containment through the evaluator, end to end. */
import { describe, expect, it } from '@jest/globals';
import type { AccessGrant, AccessRequest } from '../contracts/access.js';
import { AccessEvaluator } from '../evaluator/evaluator.js';
import { InMemoryPolicyRepository } from '../evaluator/policyRepository.js';
import { createBoundaryResolver, type ContainmentOracle } from './boundary.js';

const PROJECT = 'https://create.now/data/workspace/acme/project/lego';
const FOLDER = 'https://x/folder/press-kit';
const actor = 'https://webid.email/id/u1';

const grant: AccessGrant = {
  id: 'urn:grant:boundary', effect: 'permit', assignee: actor, actions: ['data.read'],
  target: { kind: 'project', projectId: PROJECT },
  conditions: [{ kind: 'resolver', resolver: 'boundary', config: { within: FOLDER, via: ['https://x/inFolder'] } }],
  provenance: { grantedBy: 'urn:owner', grantedAt: '2026-08-01T00:00:00.000Z' }, policyVersion: 1,
};

const request = (target: AccessRequest['target']): AccessRequest => ({
  context: { actorWebId: actor, projectId: PROJECT, memberships: [], capabilityActivations: [] },
  action: 'data.read', target,
});

function harness(oracle: ContainmentOracle) {
  const repository = new InMemoryPolicyRepository();
  repository.put(grant);
  return new AccessEvaluator(repository, { boundary: createBoundaryResolver(oracle) }, () => '2026-08-19T12:00:00.000Z');
}

const mapOracle = (inside: string[]): ContainmentOracle => ({
  contains: async (boundary, instance) => boundary === FOLDER && inside.includes(instance),
});

describe('boundary containment (T8b)', () => {
  it('permits an instance inside the boundary and passes via to the oracle', async () => {
    let seenVia: string[] | undefined;
    const oracle: ContainmentOracle = { contains: async (_b, instance, via) => { seenVia = via; return instance === 'https://x/doc/1'; } };
    const decision = await harness(oracle).evaluate(request({ kind: 'instance', projectId: PROJECT, instanceIri: 'https://x/doc/1' }));
    expect(decision.allowed).toBe(true);
    expect(seenVia).toEqual(['https://x/inFolder']);
  });

  it('denies an instance outside the boundary', async () => {
    const decision = await harness(mapOracle(['https://x/doc/1'])).evaluate(request({ kind: 'instance', projectId: PROJECT, instanceIri: 'https://x/doc/2' }));
    expect(decision.allowed).toBe(false);
  });

  it('a boundary-scoped permit never widens into a blanket one (non-instance target fails, resolved)', async () => {
    const decision = await harness(mapOracle(['https://x/doc/1'])).evaluate(request({ kind: 'project', projectId: PROJECT }));
    expect(decision.allowed).toBe(false);
    expect(decision.unresolvedConditions).toEqual([]);
  });

  it('an oracle failure is UNRESOLVED and recorded — never a guess', async () => {
    const oracle: ContainmentOracle = { contains: async () => { throw new Error('dataset unreachable'); } };
    const decision = await harness(oracle).evaluate(request({ kind: 'instance', projectId: PROJECT, instanceIri: 'https://x/doc/1' }));
    expect(decision.allowed).toBe(false);
    expect(decision.unresolvedConditions).toEqual([expect.objectContaining({ grantId: 'urn:grant:boundary', resolver: 'boundary' })]);
  });

  it('malformed boundary config is UNRESOLVED, not a crash', async () => {
    const badGrant = { ...grant, id: 'urn:grant:bad', conditions: [{ kind: 'resolver' as const, resolver: 'boundary' as const, config: {} }] };
    const repository = new InMemoryPolicyRepository();
    repository.put(badGrant);
    const evaluator = new AccessEvaluator(repository, { boundary: createBoundaryResolver(mapOracle([])) }, () => '2026-08-19T12:00:00.000Z');
    const decision = await evaluator.evaluate(request({ kind: 'instance', projectId: PROJECT, instanceIri: 'https://x/doc/1' }));
    expect(decision.allowed).toBe(false);
    expect(decision.unresolvedConditions).toEqual([expect.objectContaining({ resolver: 'boundary' })]);
  });
});
