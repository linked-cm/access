/** Pure mapping between the contract grant and the stored entity values. */
import { type AccessGrant, canonicalSelector, deserializeGrant, serializeGrant } from '../contracts/access.js';

export interface StoredGrantValues {
  assignee: { id: string };
  effect: string;
  actions: string[];
  targetKey: string;
  validFrom?: string;
  validUntil?: string;
  derivedFromGrant?: { id: string };
  payload: string;
}

export function grantToValues(grant: AccessGrant): StoredGrantValues {
  // serializeGrant validates — nothing malformed ever reaches storage.
  const payload = serializeGrant(grant);
  return {
    assignee: { id: grant.assignee },
    effect: grant.effect,
    actions: [...grant.actions],
    targetKey: canonicalSelector(grant.target),
    ...(grant.validity?.from ? { validFrom: grant.validity.from } : {}),
    ...(grant.validity?.until ? { validUntil: grant.validity.until } : {}),
    ...(grant.derivedFrom ? { derivedFromGrant: { id: grant.derivedFrom.grantId } } : {}),
    payload,
  };
}

/** The payload is the source of truth; validation re-runs on the way out. */
export function grantFromPayload(payload: string): AccessGrant {
  return deserializeGrant(payload);
}
