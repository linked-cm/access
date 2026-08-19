/**
 * Boundary containment resolver (plan-029 T8b — Stage-E decision 3: included in
 * v1, sequenced behind the same resolver interface as vc/chain so shipping it
 * changes NOTHING in the contract or the evaluator).
 *
 * A boundary condition means: this grant applies only where the requested
 * target sits INSIDE a data boundary — an instance reachable from a boundary
 * root (a collection, a folder tree, an org unit). That is a question about
 * DATA, not naming, which is exactly why the selector hierarchy refuses to
 * answer it (class ∌ instance) and why this resolver exists.
 *
 * The resolver is still portable: it asks a host-supplied ContainmentOracle.
 * CN backs it with a Linked Query; the EG backs it with its own dataset; tests
 * back it with a map. An oracle failure THROWS through, so the evaluator
 * records the condition as UNRESOLVED — which never permits (fail-closed).
 */
import type { AccessRequest } from '../contracts/access.js';
import type { ConditionResolver } from '../evaluator/evaluator.js';

export interface ContainmentOracle {
  /**
   * Is `instanceIri` inside the boundary rooted at `boundaryIri`?
   * `via` optionally names the property path IRIs the containment follows;
   * an oracle that cannot answer must THROW, never guess.
   */
  contains(boundaryIri: string, instanceIri: string, via?: string[]): Promise<boolean>;
}

export interface BoundaryConditionConfig {
  /** The boundary root IRI. */
  within: string;
  /** Property path IRIs containment follows (oracle-interpreted). */
  via?: string[];
}

export class BoundaryConfigError extends Error {}

function parseConfig(config: Record<string, unknown>): BoundaryConditionConfig {
  const within = config.within;
  if (typeof within !== 'string' || !within.trim()) {
    throw new BoundaryConfigError('boundary condition requires config.within (the boundary root IRI)');
  }
  const via = config.via;
  if (via !== undefined && (!Array.isArray(via) || via.some((entry) => typeof entry !== 'string' || !entry))) {
    throw new BoundaryConfigError('boundary condition config.via must be a list of property IRIs');
  }
  return { within: within.trim(), via: via as string[] | undefined };
}

/** The IRI a boundary question is asked about, per target kind. */
function targetInstanceIri(request: AccessRequest): string | undefined {
  const target = request.target;
  if (target.kind === 'instance') return target.instanceIri;
  return undefined;
}

export function createBoundaryResolver(oracle: ContainmentOracle): ConditionResolver {
  return async (config, request) => {
    const parsed = parseConfig(config); // malformed config throws → UNRESOLVED, recorded
    const instanceIri = targetInstanceIri(request);
    // A boundary condition on a non-instance target is NOT SATISFIED rather
    // than unresolved: the question is answerable and the answer is "this
    // grant does not cover class/project-wide requests" — a boundary-scoped
    // permit must never widen into a blanket one.
    if (!instanceIri) return false;
    return oracle.contains(parsed.within, instanceIri, parsed.via);
  };
}
