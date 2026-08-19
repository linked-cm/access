/**
 * plan-029 T9c — the access MANAGEMENT surface (admin plane).
 *
 * Same composition rule as @_linked/documents' ingestion API: the portable
 * package defines the serializable API and an injectable slot; the HOST
 * (CN backend) installs the implementation wired to its policy repository
 * and membership model. Every input/output is plain JSON — grants cross the
 * boundary as the contract's own serialized form.
 *
 * Authorization contract: every method takes the ACTING WebID resolved by the
 * provider from the session (never from the caller's input) and the host
 * implementation gates management methods on `grants.manage`.
 */
import type { AccessGrant, AccessSelector } from './contracts/access.js';
import type { EffectiveGrantEntry, TargetSubjectEntry } from './queries/effectiveAccess.js';
import type { ApplyTemplateInput, GrantTemplate, TemplateChange } from './templates/grantTemplates.js';

export class AccessManagementError extends Error {
  constructor(public readonly code: 'not-configured' | 'forbidden' | 'invalid-input', message: string) {
    super(message);
  }
}

/** Host-implemented; `actorWebId` is always the SESSION actor. */
export interface AccessManagementApi {
  templates(): Promise<GrantTemplate[]>;
  /** Full grant ledger for a project — revoked entries included (history view). */
  grantsForProject(input: { actorWebId: string; projectId: string }): Promise<AccessGrant[]>;
  previewTemplate(input: Omit<ApplyTemplateInput, 'grantedBy' | 'now' | 'policyVersion'> & { actorWebId: string }): Promise<TemplateChange[]>;
  applyTemplate(input: Omit<ApplyTemplateInput, 'grantedBy' | 'now' | 'policyVersion'> & { actorWebId: string }): Promise<TemplateChange[]>;
  revokeGrant(input: { actorWebId: string; grantId: string; projectId: string }): Promise<AccessGrant | undefined>;
  /** subjectWebId omitted = the caller asks about THEMSELVES (always permitted). */
  effectiveForActor(input: { actorWebId: string; projectId: string; subjectWebId?: string }): Promise<EffectiveGrantEntry[]>;
  subjectsForTarget(input: { actorWebId: string; target: AccessSelector }): Promise<TargetSubjectEntry[]>;
  /**
   * WebID → human display data from the host's profile store (name, email).
   * Same gate as the grant views. Unknown WebIDs simply come back empty —
   * the UI falls back to the grant's assigneeLabel hint, then the WebID.
   */
  resolveSubjects(input: { actorWebId: string; projectId: string; webIds: string[] }): Promise<Record<string, { name?: string; email?: string }>>;
}

const API_SLOT = Symbol.for('@_linked/access.managementApi');
const carrier = globalThis as { [API_SLOT]?: AccessManagementApi };

export function configureAccessManagementApi(api?: AccessManagementApi): void {
  carrier[API_SLOT] = api;
}

export function accessManagementApi(): AccessManagementApi {
  const configured = carrier[API_SLOT];
  if (!configured) throw new AccessManagementError('not-configured', 'Access management is not configured.');
  return configured;
}
