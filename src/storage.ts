/**
 * The STORAGE entry — everything that depends on @_linked/core (shape
 * registration, the Linked Query repository). Kept out of the root barrel so
 * pure-contract consumers (capability manifests, frontend bundles) never drag
 * core or shape registration in transitively; server-side consumers import
 * `@_linked/access/storage` (or the deep subpaths). This file is also a
 * compilation entry (tsconfig `files`), which is what keeps these modules in
 * `lib/` at all — the build prunes anything unreachable from an entry.
 */
import './shapes/index.js';
export * from './repository/grantMapping.js';
export * from './repository/linkedPolicyRepository.js';
export * from './shapes/AccessGrantEntity.js';
