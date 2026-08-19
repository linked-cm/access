/**
 * cnacl — the CN access-control vocabulary (plan-029 T7 decision 1: ODRL rules
 * + CN selector extensions live under this namespace). The namespace matches
 * `CNACL` in contracts/access.ts exactly; the two must never drift.
 */
import { createNameSpace } from '@_linked/core/utils/NameSpace';
import { linkedOntology } from '../package.js';
import * as _this from './cnacl.js';

export const loadData = () =>
  import('../data/cnacl.json', { with: { type: 'json' } }).then((data) => data.default);
export const ns = createNameSpace('https://data.create.now/access#');
export const _self = ns('');

// classes
export const AccessGrant = ns('AccessGrant');
export const PolicyRegistry = ns('PolicyRegistry');

// queryable grant fields (the rest of the grant rides in `payload`)
export const assignee = ns('assignee');
export const effect = ns('effect');
export const action = ns('action');
export const targetKey = ns('targetKey');
export const validFrom = ns('validFrom');
export const validUntil = ns('validUntil');
export const derivedFromGrant = ns('derivedFromGrant');
export const payload = ns('payload');

// registry
export const version = ns('version');

export const cnacl = {
  AccessGrant,
  PolicyRegistry,
  assignee,
  effect,
  action,
  targetKey,
  validFrom,
  validUntil,
  derivedFromGrant,
  payload,
  version,
};

linkedOntology(_this, ns, 'cnacl', loadData, '../data/cnacl.json');
