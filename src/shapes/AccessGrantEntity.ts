/**
 * Storage shapes for the policy repository (plan-029 T8 task 6).
 *
 * Storage model, deliberately: the fields enforcement QUERIES on (assignee,
 * effect, actions, validity, targetKey, delegation parent) are first-class
 * properties; the COMPLETE grant rides in `payload` as the contract's own
 * serialized JSON, so the round trip is lossless by construction — nested
 * selectors, conditions and provenance never need a lossy RDF projection and
 * the contract validator re-checks every grant on the way OUT. House
 * precedent: SourceDocument.renditionManifest.
 */
import { Shape } from '@_linked/core/shapes/Shape';
import { Server } from '@_linked/server-utils/utils/Server';
import { literalProperty, objectProperty } from '@_linked/core/shapes/SHACL';
import { cnacl } from '../ontologies/cnacl.js';
import { linkedShape } from '../package.js';

@linkedShape
export class AccessGrantEntity extends Shape {
  static targetClass = cnacl.AccessGrant;

  /** T9c management RPCs — served by AccessManagementProvider. */
  static templates(): Promise<any[]> { return Server.call(this, 'templates'); }
  static grantsForProject(input: { projectId: string }): Promise<any[]> { return Server.call(this, 'grantsForProject', input); }
  static previewTemplate(input: any): Promise<any[]> { return Server.call(this, 'previewTemplate', input); }
  static applyTemplate(input: any): Promise<any[]> { return Server.call(this, 'applyTemplate', input); }
  static revokeGrant(input: { grantId: string; projectId: string }): Promise<any> { return Server.call(this, 'revokeGrant', input); }
  static effectiveForActor(input: { projectId: string; subjectWebId?: string }): Promise<any[]> { return Server.call(this, 'effectiveForActor', input); }
  static subjectsForTarget(input: { target: any }): Promise<any[]> { return Server.call(this, 'subjectsForTarget', input); }
  static resolveSubjects(input: { projectId: string; webIds: string[] }): Promise<Record<string, { name?: string; email?: string }>> { return Server.call(this, 'resolveSubjects', input); }

  @objectProperty({ path: cnacl.assignee, maxCount: 1 }) get assignee(): string { return ''; }
  @literalProperty({ path: cnacl.effect, maxCount: 1 }) get effect(): string { return 'permit'; }
  @literalProperty({ path: cnacl.action }) get actions(): string[] { return []; }
  @literalProperty({ path: cnacl.targetKey, maxCount: 1 }) get targetKey(): string { return ''; }
  @literalProperty({ path: cnacl.validFrom, maxCount: 1 }) get validFrom(): string { return ''; }
  @literalProperty({ path: cnacl.validUntil, maxCount: 1 }) get validUntil(): string { return ''; }
  @objectProperty({ path: cnacl.derivedFromGrant, maxCount: 1 }) get derivedFromGrant(): string { return ''; }
  @literalProperty({ path: cnacl.payload, maxCount: 1 }) get payload(): string { return '{}'; }
}

@linkedShape
export class PolicyRegistryEntity extends Shape {
  static targetClass = cnacl.PolicyRegistry;
  @literalProperty({ path: cnacl.version, maxCount: 1 }) get version(): string { return '0'; }
}
