# @linked.cm/access

Access contracts for LINKED apps: ODRL-based grants, selectors and conditions, a portable authorization
evaluator, and a Linked Query policy repository.

```ts
// Contracts, evaluator, resolvers, templates — no @_linked/core, no shape registration.
import { AccessEvaluator, assertActionName } from '@linked.cm/access';

// Server side: the grant shapes and the Linked Query policy repository.
import '@linked.cm/access/storage';
```

- The root entry stays dependency-light, so capability manifests and frontend bundles can import the contracts
  without pulling in core.
- `storage` registers the shapes (`shapes/index`) and exports the Linked Query policy repository.
- Grants are stored as `cnacl:AccessGrant` (`https://data.create.now/access#`). The shapes keep their
  `@_linked/access` package identity (`https://id.create.now/access/`), so data written by Create Now and Serve
  is read unchanged.

## Status

Extracted with its history from `Semantu/create-now` (`packages/access`) on 2026-09-30. Staged in linked-cm
(npm scope `@linked.cm`) pending René's review; it moves to linked-fw as `@_linked/access` once approved.

## Develop

```sh
npm install
npm run build
npm test
```
