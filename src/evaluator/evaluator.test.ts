/** The T8 evaluator matrix — every case plan-029 names, deterministic. */
import { describe, expect, it } from '@jest/globals';
import type { AccessGrant, AccessRequest, PermissionContext } from '../contracts/access.js';
import { AccessEvaluator } from './evaluator.js';
import { InMemoryPolicyRepository } from './policyRepository.js';

const WS = 'https://create.now/data/workspace/acme';
const PROJECT = `${WS}/project/lego`;
const SIBLING = `${WS}/project/other`;
const NOW = '2026-08-19T12:00:00.000Z';

const actor = 'https://webid.email/id/u1';
const context = (overrides: Partial<PermissionContext> = {}): PermissionContext => ({
  actorWebId: actor, workspaceId: WS, projectId: PROJECT,
  memberships: [{ id: 'urn:membership:1', role: 'member', scope: { kind: 'project', projectId: PROJECT } }],
  capabilityActivations: ['documents'],
  ...overrides,
});
const request = (overrides: Partial<AccessRequest> = {}): AccessRequest => ({
  context: context(), action: 'documents.read', target: { kind: 'project', projectId: PROJECT }, ...overrides,
});
const grant = (overrides: Partial<AccessGrant>): AccessGrant => ({
  id: `urn:grant:${Math.abs(JSON.stringify(overrides).split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}`,
  effect: 'permit', assignee: actor, actions: ['documents.read'],
  target: { kind: 'project', projectId: PROJECT }, conditions: [],
  provenance: { grantedBy: 'urn:owner', grantedAt: '2026-08-01T00:00:00.000Z' }, policyVersion: 1,
  ...overrides,
});

function harness(grants: AccessGrant[], resolvers = {}) {
  const repository = new InMemoryPolicyRepository();
  for (const entry of grants) repository.put(entry);
  return new AccessEvaluator(repository, resolvers, () => NOW);
}

describe('AccessEvaluator', () => {
  it('no grants denies with an empty matched list', async () => {
    const decision = await harness([]).evaluate(request());
    expect(decision.allowed).toBe(false);
    expect(decision.matchedGrantIds).toEqual([]);
  });

  it('a project permit inherits to capability; a sibling project does not match', async () => {
    const evaluator = harness([grant({})]);
    const capability = await evaluator.evaluate(request({ target: { kind: 'capability', projectId: PROJECT, capability: 'documents' } }));
    expect(capability.allowed).toBe(true);
    const sibling = await evaluator.evaluate(request({ target: { kind: 'project', projectId: SIBLING } }));
    expect(sibling.allowed).toBe(false);
  });

  it('a project deny defeats a workspace permit', async () => {
    const evaluator = harness([
      grant({ id: 'urn:grant:ws-permit', target: { kind: 'workspace', workspaceId: WS } }),
      grant({ id: 'urn:grant:proj-deny', effect: 'prohibit' }),
    ]);
    const decision = await evaluator.evaluate(request());
    expect(decision.allowed).toBe(false);
    expect(decision.matchedGrantIds).toEqual(expect.arrayContaining(['urn:grant:ws-permit', 'urn:grant:proj-deny']));
  });

  it('direct and membership (team) grants both appear in the matched path', async () => {
    const evaluator = harness([
      grant({ id: 'urn:grant:direct' }),
      grant({ id: 'urn:grant:team', assignee: 'urn:membership:1' }),
    ]);
    const decision = await evaluator.evaluate(request());
    expect(decision.matchedGrantIds.sort()).toEqual(['urn:grant:direct', 'urn:grant:team']);
  });

  it('expired and not-yet-valid grants do not apply; the boundary is deterministic', async () => {
    const evaluator = harness([
      grant({ id: 'urn:grant:expired', validity: { until: '2026-08-19T12:00:00.000Z' } }),
      grant({ id: 'urn:grant:future', validity: { from: '2026-08-19T12:00:00.001Z' } }),
    ]);
    const decision = await evaluator.evaluate(request());
    // `until` is exclusive AT the boundary instant, `from` inclusive — evaluatedAt
    // equals the expiry here, so both fall outside. Reproducible: decidedAt is NOW.
    expect(decision.allowed).toBe(false);
    expect(decision.decidedAt).toBe(NOW);
  });

  it('a revoked grant no longer applies and the policy version moved', async () => {
    const repository = new InMemoryPolicyRepository();
    const entry = grant({ id: 'urn:grant:gone' });
    repository.put(entry);
    repository.revoke(entry.id);
    const decision = await new AccessEvaluator(repository, {}, () => NOW).evaluate(request());
    expect(decision.allowed).toBe(false);
    expect(decision.policyVersion).toBe(2);
  });

  it('an unresolved condition denies and records the resolver', async () => {
    const evaluator = harness([grant({ conditions: [{ kind: 'resolver', resolver: 'boundary', config: {} }] })]);
    const decision = await evaluator.evaluate(request());
    expect(decision.allowed).toBe(false);
    expect(decision.unresolvedConditions).toEqual([expect.objectContaining({ resolver: 'boundary' })]);
  });

  it('a delegated grant wider than its parent (action, scope, validity, depth) contributes nothing', async () => {
    const parent = grant({
      id: 'urn:grant:parent', actions: ['documents.read'],
      delegation: { delegable: true, attenuation: { actions: ['documents.read'], maxDepth: 1 } },
      validity: { until: '2026-09-01T00:00:00.000Z' },
    });
    const widerAction = grant({ id: 'urn:d1', actions: ['documents.read', 'documents.commit'], derivedFrom: { grantId: parent.id, depth: 1 } });
    const widerScope = grant({ id: 'urn:d2', target: { kind: 'workspace', workspaceId: WS }, derivedFrom: { grantId: parent.id, depth: 1 } });
    const longerLife = grant({ id: 'urn:d3', validity: { until: '2026-12-01T00:00:00.000Z' }, derivedFrom: { grantId: parent.id, depth: 1 } });
    const tooDeep = grant({ id: 'urn:d4', validity: { until: '2026-09-01T00:00:00.000Z' }, derivedFrom: { grantId: parent.id, depth: 2 } });
    const within = grant({ id: 'urn:d5', validity: { until: '2026-08-30T00:00:00.000Z' }, derivedFrom: { grantId: parent.id, depth: 1 } });
    for (const [derived, expected] of [[widerAction, false], [widerScope, false], [longerLife, false], [tooDeep, false], [within, true]] as const) {
      const evaluator = harness([parent, derived]);
      const decision = await evaluator.evaluate({ ...request(), context: context({ memberships: [] }), action: 'documents.read', target: derived.target });
      const contributed = decision.matchedGrantIds.includes(derived.id);
      expect(contributed).toBe(expected);
    }
  });

  it('a property deny removes email while other Person fields stay readable', async () => {
    const person = 'https://x/Person';
    const evaluator = harness([
      grant({ id: 'urn:grant:class-read', actions: ['data.read'], target: { kind: 'class', projectId: PROJECT, classIri: person } }),
      grant({ id: 'urn:grant:email-deny', effect: 'prohibit', actions: ['data.read'], target: { kind: 'property', projectId: PROJECT, classIri: person, propertyIri: 'https://x/email' } }),
    ]);
    const email = await evaluator.evaluate(request({ action: 'data.read', target: { kind: 'property', projectId: PROJECT, classIri: person, propertyIri: 'https://x/email' } }));
    const name = await evaluator.evaluate(request({ action: 'data.read', target: { kind: 'property', projectId: PROJECT, classIri: person, propertyIri: 'https://x/name' } }));
    expect(email.allowed).toBe(false);
    expect(name.allowed).toBe(true);
  });

  it('an aggregate grant permits aggregates but not instance reads', async () => {
    const person = 'https://x/Person';
    const evaluator = harness([grant({ actions: ['data.aggregate'], target: { kind: 'class', projectId: PROJECT, classIri: person } })]);
    const aggregate = await evaluator.evaluate(request({ action: 'data.aggregate', target: { kind: 'class', projectId: PROJECT, classIri: person } }));
    const instance = await evaluator.evaluate(request({ action: 'data.read', target: { kind: 'instance', projectId: PROJECT, instanceIri: 'https://x/person/1' } }));
    expect(aggregate.allowed).toBe(true);
    expect(instance.allowed).toBe(false);
  });

  it('a subject (scope) restriction narrows an organizational permit', async () => {
    const evaluator = harness([grant({
      target: { kind: 'workspace', workspaceId: WS },
      conditions: [{ kind: 'scope', selector: { kind: 'project', projectId: PROJECT } }],
    })]);
    const inside = await evaluator.evaluate(request());
    const outside = await evaluator.evaluate(request({ target: { kind: 'project', projectId: SIBLING } }));
    expect(inside.allowed).toBe(true);
    expect(outside.allowed).toBe(false);
  });

  it('role conditions honor the hierarchy (admin satisfies member)', async () => {
    const evaluator = harness([grant({ conditions: [{ kind: 'role', role: 'member' }] })]);
    const admin = await evaluator.evaluate(request({ context: context({ memberships: [{ id: 'urn:membership:1', role: 'admin', scope: { kind: 'project', projectId: PROJECT } }] }) }));
    const viewer = await evaluator.evaluate(request({ context: context({ memberships: [{ id: 'urn:membership:1', role: 'viewer', scope: { kind: 'project', projectId: PROJECT } }] }) }));
    expect(admin.allowed).toBe(true);
    expect(viewer.allowed).toBe(false);
  });

  it('a registered resolver decides; T8b boundary containment slots in here', async () => {
    const evaluator = harness(
      [grant({ conditions: [{ kind: 'resolver', resolver: 'boundary', config: { within: PROJECT } }] })],
      { boundary: async (config: Record<string, unknown>) => config.within === PROJECT },
    );
    const decision = await evaluator.evaluate(request());
    expect(decision.allowed).toBe(true);
    expect(decision.unresolvedConditions).toEqual([]);
  });
});
