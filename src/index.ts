export * from './contracts/access.js';
export * from './evaluator/policyRepository.js';
export * from './evaluator/evaluator.js';
export * from './resolvers/boundary.js';
// The storage layer (shapes + Linked Query repository) is deliberately NOT
// re-exported here: the root barrel stays dependency-light so pure-contract
// consumers (capability manifests, frontend bundles) never drag @_linked/core
// or shape registration in transitively. Storage consumers import subpaths:
//   @_linked/access/repository/linkedPolicyRepository
//   @_linked/access/repository/grantMapping
//   @_linked/access/shapes/AccessGrantEntity
