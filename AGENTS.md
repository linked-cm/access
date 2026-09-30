# AGENTS.md — @linked.cm/access

Staged in the **linked-cm** org (npm scope `@linked.cm`) pending René's review; moves to linked-fw (`@_linked/access`) only after approval. The first npm publish is approved manually by René (CI stages it; `npm stage approve <id>`).

Extracted from `Semantu/create-now` `packages/access` with its history. Consumers: Create Now, Serve (`serve-earth/serve-community`, vendored until it takes this package), `@linked.cm/access-templates`.

## Do not change without a migration

- The ontology namespace `https://data.create.now/access#` (`cnacl:`) — stored grants use it.
- `linkedPackage('@_linked/access', { baseUri: 'https://id.create.now/access/' })` in `src/package.ts` — it decides the shape IRIs. The npm name is independent of it.

## Rules

- The root barrel (`src/index.ts`) never imports core or shapes; storage lives behind `./storage`.
- Releases go through changesets: add one with every change that should publish (`npx changeset`).

## Agent docs (`docs/`)

Same convention as linked-fw packages: `docs/ideas`, `docs/plans`, `docs/reports`, each file numbered with a 3-digit prefix and starting with YAML frontmatter (`summary`, `packages`).
