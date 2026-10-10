// The backends of the kinds (docs/plans/status-v1.md, C-2 and C-5): one module per kind, which returns the generated files of
// its package for the IRs and the lock. A kind that has no backend is an Error, so no command runs an unknown kind.
import * as go from './go.mjs';
import * as npm from './npm.mjs';

const BACKENDS = Object.freeze({ go, npm });

/** The kinds that the compiler generates, in the order of this table. */
export const KINDS = Object.freeze(Object.keys(BACKENDS));

/** The backend of `kind`; an unknown kind is an Error. */
export function backendOf(kind) {
  if (!Object.hasOwn(BACKENDS, kind)) throw new Error(`unknown kind ${kind}; the compiler generates ${KINDS.join(', ')}`);
  return BACKENDS[kind];
}
