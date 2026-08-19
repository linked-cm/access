import { describe, expect, it } from '@jest/globals';
import { AccessEvaluator } from '../evaluator/evaluator.js';
import { InMemoryPolicyRepository } from '../evaluator/policyRepository.js';
import type { PermissionContext } from '../contracts/access.js';
import { effectiveAccessForActor, grantHistoryForProject, subjectsForTarget } from '../queries/effectiveAccess.js';
import {
  applyTemplate,
  GRANT_TEMPLATES,
  PINNED_BASIS,
  previewTemplateApplication,
  revokeGrantAsEvent,
  TEMPLATE_BASIS_PREFIX,
  templateGrantId,
} from './grantTemplates.js';

const PROJECT = 'https://create.now/data/ws1/project/p1';
const REVIEWER = 'https://webid.email/id/reviewer';
const ADMIN = 'https://webid.email/id/admin';
const TEAM = 'https://create.now/data/team/editors';
const NOW = '2026-08-19T10:00:00.000Z';
const scope = { kind: 'project', projectId: PROJECT } as const;

function context(actor: string, memberships: string[] = []): PermissionContext {
  return { actorWebId: actor, projectId: PROJECT, memberships: memberships.map((id) => ({ id, role: 'member', scope })), capabilityActivations: ['documents'] };
}

const applyInput = (overrides: Partial<Parameters<typeof applyTemplate>[1]> = {}) => ({
  template: 'reviewer' as const, assignee: REVIEWER, scope, grantedBy: ADMIN, now: NOW, policyVersion: 1, ...overrides,
});

describe('grant templates (plan T9c matrix)', () => {
  it('applying Reviewer writes the expected read/review grant with template provenance', async () => {
    const repo = new InMemoryPolicyRepository();
    const changes = await applyTemplate(repo, applyInput());
    expect(changes.map(({ kind }) => kind)).toEqual(['create']);

    const grant = await repo.grantById(templateGrantId(scope, REVIEWER));
    expect(grant?.actions).toEqual(GRANT_TEMPLATES.reviewer.actions);
    expect(grant?.provenance).toEqual({ grantedBy: ADMIN, grantedAt: NOW, basis: `${TEMPLATE_BASIS_PREFIX}reviewer` });

    // Evaluator parity: the preview's grants ARE what enforcement decides on.
    const evaluator = new AccessEvaluator(repo, {}, () => NOW);
    const target = { kind: 'capability', projectId: PROJECT, capability: 'documents' } as const;
    expect((await evaluator.evaluate({ context: context(REVIEWER), action: 'documents.review', target })).allowed).toBe(true);
    expect((await evaluator.evaluate({ context: context(REVIEWER), action: 'documents.commit', target })).allowed).toBe(false);
    expect((await evaluator.evaluate({ context: context(REVIEWER), action: 'documents.remove', target })).allowed).toBe(false);
  });

  it('a pinned property deny survives template reapplication and shows in the preview', async () => {
    const repo = new InMemoryPolicyRepository();
    const emailDeny = { effect: 'prohibit' as const, classIri: 'https://x/Person', propertyIri: 'https://x/email', actions: ['documents.read' as const, 'data.read' as const] };
    await applyTemplate(repo, applyInput({ refinements: [emailDeny] }));

    // Re-apply (template upgrade) WITHOUT carrying the refinement.
    const preview = await previewTemplateApplication(repo, applyInput({ template: 'mapper' }));
    const kinds = Object.fromEntries(preview.map((change) => [change.kind, change.grant.provenance.basis]));
    expect(kinds['replace']).toBe(`${TEMPLATE_BASIS_PREFIX}mapper`);
    expect(kinds['keep-pinned']).toBe(PINNED_BASIS);

    await applyTemplate(repo, applyInput({ template: 'mapper' }));
    // The pinned deny is still enforced: property read stays prohibited.
    const evaluator = new AccessEvaluator(repo, {}, () => NOW);
    const propertyTarget = { kind: 'property', projectId: PROJECT, classIri: 'https://x/Person', propertyIri: 'https://x/email' } as const;
    expect((await evaluator.evaluate({ context: context(REVIEWER), action: 'documents.read', target: propertyTarget })).allowed).toBe(false);
    // …while the upgraded template's commit right works.
    expect((await evaluator.evaluate({ context: context(REVIEWER), action: 'documents.commit', target: { kind: 'capability', projectId: PROJECT, capability: 'documents' } })).allowed).toBe(true);
  });

  it('effective-person view names direct and team paths; resource view lists both subjects', async () => {
    const repo = new InMemoryPolicyRepository();
    await applyTemplate(repo, applyInput());
    await applyTemplate(repo, applyInput({ template: 'mapper', assignee: TEAM }));

    const effective = await effectiveAccessForActor(repo, { actorWebId: REVIEWER, membershipIds: [TEAM] });
    expect(effective.map(({ path }) => path.via).sort()).toEqual(['direct', 'membership']);

    const subjects = await subjectsForTarget(repo, { kind: 'capability', projectId: PROJECT, capability: 'documents' });
    expect(subjects.map(({ grant }) => grant.assignee).sort()).toEqual([TEAM, REVIEWER].sort());
    expect(subjects.every(({ reason }) => reason === 'containing-scope')).toBe(true);
  });

  it('a revoked grant leaves effective access but stays in history with actor and time', async () => {
    const repo = new InMemoryPolicyRepository();
    await applyTemplate(repo, applyInput());
    const grantId = templateGrantId(scope, REVIEWER);

    const revoked = await revokeGrantAsEvent(repo, grantId, { revokedBy: ADMIN, revokedAt: NOW });
    expect(revoked?.revocation).toEqual({ revokedBy: ADMIN, revokedAt: NOW });

    // Gone from effective access AND from enforcement…
    expect(await effectiveAccessForActor(repo, { actorWebId: REVIEWER, membershipIds: [] })).toEqual([]);
    const evaluator = new AccessEvaluator(repo, {}, () => NOW);
    expect((await evaluator.evaluate({ context: context(REVIEWER), action: 'documents.read', target: scope })).allowed).toBe(false);

    // …but the ledger still shows who revoked it and when.
    const history = await grantHistoryForProject(repo, PROJECT);
    expect(history.find(({ id }) => id === grantId)?.revocation).toEqual({ revokedBy: ADMIN, revokedAt: NOW });

    // Idempotent: revoking again neither errors nor rewrites.
    const versionAfter = await repo.policyVersion();
    await revokeGrantAsEvent(repo, grantId, { revokedBy: ADMIN, revokedAt: '2026-08-20T00:00:00.000Z' });
    expect((await repo.grantById(grantId))?.revocation?.revokedAt).toBe(NOW);
    expect(await repo.policyVersion()).toBe(versionAfter);
  });

  it('reapplication is deterministic — same ids, replace not duplicate', async () => {
    const repo = new InMemoryPolicyRepository();
    await applyTemplate(repo, applyInput());
    const changes = await applyTemplate(repo, applyInput());
    expect(changes.map(({ kind }) => kind)).toEqual(['replace']);
    expect((await repo.allGrants()).length).toBe(1);
  });
});
