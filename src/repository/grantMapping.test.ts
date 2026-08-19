/** Pure mapping round-trip — the payload is the source of truth. */
import { describe, expect, it } from '@jest/globals';
import type { AccessGrant } from '../contracts/access.js';
import { grantFromPayload, grantToValues } from './grantMapping.js';

const grant: AccessGrant = {
  id: 'urn:grant:rt', effect: 'prohibit', assignee: 'https://webid.email/id/u1',
  actions: ['documents.read', 'documents.commit'],
  target: { kind: 'property', projectId: 'urn:p', classIri: 'https://x/Person', propertyIri: 'https://x/email' },
  conditions: [
    { kind: 'role', role: 'admin' },
    { kind: 'resolver', resolver: 'boundary', config: { within: 'https://x/folder/1', via: ['https://x/inFolder'] } },
  ],
  validity: { from: '2026-08-01T00:00:00.000Z', until: '2026-12-01T00:00:00.000Z' },
  delegation: { delegable: true, attenuation: { actions: ['documents.read'], maxDepth: 2 } },
  provenance: { grantedBy: 'urn:owner', grantedAt: '2026-08-19T00:00:00.000Z', basis: 'urn:membership:9' },
  derivedFrom: { grantId: 'urn:grant:parent', depth: 1 },
  policyVersion: 4,
};

describe('grant storage mapping', () => {
  it('round-trips the FULL grant through the stored payload', () => {
    const values = grantToValues(grant);
    expect(grantFromPayload(values.payload)).toEqual(grant);
  });

  it('projects the queryable fields enforcement filters on', () => {
    const values = grantToValues(grant);
    expect(values.assignee).toEqual({ id: grant.assignee });
    expect(values.effect).toBe('prohibit');
    expect(values.actions).toEqual(['documents.read', 'documents.commit']);
    expect(values.targetKey).toBe('property:urn:p#https://x/Person#https://x/email');
    expect(values.validUntil).toBe('2026-12-01T00:00:00.000Z');
    expect(values.derivedFromGrant).toEqual({ id: 'urn:grant:parent' });
  });

  it('rejects a malformed grant before storage and a corrupted payload after', () => {
    expect(() => grantToValues({ ...grant, actions: [] })).toThrow();
    expect(() => grantFromPayload('{"id":"x"}')).toThrow();
  });
});
