/**
 * Server-side dispatch for the access management RPCs (plan-029 T9c). The
 * LinkedServer discovers this via `@_linked/access/backend` and routes
 * `Server.call(AccessGrantEntity, method, …)` here. The actor is ALWAYS the
 * session's WebID — caller input never chooses who is acting.
 */
import { ShapeProvider } from '@_linked/server-utils/utils/ShapeProvider';
import { accessManagementApi, AccessManagementError } from '../management.js';
import { AccessGrantEntity } from './AccessGrantEntity.js';

function actor(provider: any): string {
  const auth = provider.request?.linkedAuth;
  const webId = auth?.userAccount?.accountOf?.id ?? auth?.webId ?? auth?.userAccount?.id;
  if (!webId) throw new AccessManagementError('forbidden', 'Authentication is required.');
  return webId;
}

export class AccessManagementProvider extends ShapeProvider {
  public shape = AccessGrantEntity;

  async templates() {
    return accessManagementApi().templates();
  }

  async grantsForProject(input: { projectId: string }) {
    return accessManagementApi().grantsForProject({ actorWebId: actor(this), projectId: input.projectId });
  }

  async previewTemplate(input: any) {
    return accessManagementApi().previewTemplate({ ...input, actorWebId: actor(this) });
  }

  async applyTemplate(input: any) {
    return accessManagementApi().applyTemplate({ ...input, actorWebId: actor(this) });
  }

  async revokeGrant(input: { grantId: string; projectId: string }) {
    return accessManagementApi().revokeGrant({ ...input, actorWebId: actor(this) });
  }

  async effectiveForActor(input: { projectId: string; subjectWebId?: string }) {
    return accessManagementApi().effectiveForActor({ ...input, actorWebId: actor(this) });
  }

  async subjectsForTarget(input: { target: any }) {
    return accessManagementApi().subjectsForTarget({ target: input.target, actorWebId: actor(this) });
  }

  async resolveSubjects(input: { projectId: string; webIds: string[] }) {
    return accessManagementApi().resolveSubjects({ ...input, actorWebId: actor(this) });
  }
}
