/**
 * Contract tests (plan-029 T7): every consumer compiles against and round-trips
 * through this one contract; the validators reject exactly what the plan says
 * they must.
 */
import { describe, expect, it } from '@jest/globals';
import {
  ACTION_NAMES, type AccessGrant, AccessContractError, type AccessSelector,
  assertAccessGrant, canonicalSelector, decisionCacheKey, deserializeGrant, serializeGrant, cacheExpiry,
} from './access.js';

const base = (): AccessGrant => ({
  id: 'urn:grant:1',
  effect: 'permit',
  assignee: 'https://webid.email/id/u1',
  actions: ['documents.read'],
  target: { kind: 'project', projectId: 'urn:project:1' },
  conditions: [{ kind: 'role', role: 'member' }],
  provenance: { grantedBy: 'https://webid.email/id/owner', grantedAt: '2026-08-19T00:00:00.000Z', basis: 'urn:membership:1' },
  policyVersion: 3,
});

describe('selector serialization', () => {
  const selectors: AccessSelector[] = [
    { kind: 'workspace', workspaceId: 'urn:ws:1' },
    { kind: 'project', projectId: 'urn:project:1' },
    { kind: 'capability', projectId: 'urn:project:1', capability: 'documents' },
    { kind: 'class', projectId: 'urn:project:1', classIri: 'https://x/Product' },
    { kind: 'instance', projectId: 'urn:project:1', instanceIri: 'https://x/product/1' },
    { kind: 'property', projectId: 'urn:project:1', classIri: 'https://x/Product', propertyIri: 'https://x/sku' },
  ];

  it.each(selectors.map((selector) => [selector.kind, selector] as const))('round-trips a %s selector inside a grant', (_kind, selector) => {
    const grant = { ...base(), target: selector };
    expect(deserializeGrant(serializeGrant(grant))).toEqual(grant);
  });

  it('canonical form is stable and distinct per kind', () => {
    const keys = selectors.map(canonicalSelector);
    expect(new Set(keys).size).toBe(selectors.length);
  });

  it('rejects a selector missing its required field', () => {
    const grant = { ...base(), target: { kind: 'property', projectId: 'p', classIri: 'c' } as never };
    expect(() => assertAccessGrant(grant)).toThrow(AccessContractError);
  });
});

describe('delegation and validity', () => {
  it('rejects delegation without attenuation bounds', () => {
    const grant = { ...base(), delegation: { delegable: true } };
    expect(() => assertAccessGrant(grant)).toThrow(/attenuation bounds/);
  });

  it('rejects attenuation broader than the grant itself', () => {
    const grant = { ...base(), delegation: { delegable: true, attenuation: { actions: ['documents.commit'], maxDepth: 1 } } } as AccessGrant;
    expect(() => assertAccessGrant(grant)).toThrow(/exceeds the grant/);
  });

  it('accepts bounded delegation', () => {
    const grant = { ...base(), delegation: { delegable: true, attenuation: { actions: ['documents.read'], maxDepth: 2 } } } as AccessGrant;
    expect(() => assertAccessGrant(grant)).not.toThrow();
  });

  it('rejects an inverted validity window', () => {
    const grant = { ...base(), validity: { from: '2026-09-01T00:00:00.000Z', until: '2026-08-01T00:00:00.000Z' } };
    expect(() => assertAccessGrant(grant)).toThrow(/precede/);
  });

  it('rejects non-ISO validity bounds', () => {
    const grant = { ...base(), validity: { from: 'next tuesday' } };
    expect(() => assertAccessGrant(grant)).toThrow(/ISO/);
  });
});

describe('actions', () => {
  it('the vocabulary is closed', () => {
    const grant = { ...base(), actions: ['documents.hack'] as never };
    expect(() => assertAccessGrant(grant)).toThrow(/Unknown action/);
  });

  it('every declared action name validates', () => {
    for (const action of ACTION_NAMES) {
      expect(() => assertAccessGrant({ ...base(), actions: [action] })).not.toThrow();
    }
  });
});

describe('decision & cache contract', () => {
  it('cache keys carry actor, action, canonical target and policy version', () => {
    const key = decisionCacheKey({
      context: { actorWebId: 'https://webid.email/id/u1', memberships: [], capabilityActivations: [] },
      action: 'documents.read',
      target: { kind: 'project', projectId: 'urn:project:1' },
    }, 7);
    expect(key).toBe('https://webid.email/id/u1|documents.read|project:urn:project:1|7');
  });

  it('cache expiry is the earliest future validity bound', () => {
    const now = '2026-08-19T00:00:00.000Z';
    const grants = [
      { ...base(), validity: { until: '2026-08-21T00:00:00.000Z' } },
      { ...base(), id: 'urn:grant:2', validity: { until: '2026-08-20T00:00:00.000Z' } },
      { ...base(), id: 'urn:grant:3' },
    ];
    expect(cacheExpiry(grants, now)).toBe('2026-08-20T00:00:00.000Z');
  });
});

describe('provenance and policy version', () => {
  it('requires grantedBy/grantedAt', () => {
    const grant = { ...base(), provenance: { grantedAt: 'x' } as never };
    expect(() => assertAccessGrant(grant)).toThrow(/provenance/);
  });

  it('requires an integer policy version', () => {
    expect(() => assertAccessGrant({ ...base(), policyVersion: -1 })).toThrow(/policyVersion/);
  });
});
