/**
 * Registers every shape this package defines, and nothing else.
 *
 * A shape registers when its module is evaluated, so this module exists to be
 * imported for that side effect alone: `import '<package>/shapes/index';`
 * It has no exports and loads in plain node as well as in a bundle. The
 * storage entry imports it; the root barrel does not, so pure-contract
 * consumers still never register shapes or load core.
 */
import './AccessGrantEntity.js';
