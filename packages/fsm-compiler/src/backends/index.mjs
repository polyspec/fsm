// The backends of the kinds (docs/plans/fsm-v1.md, C-2 and C-5): one module per kind, which returns the generated files of
// its package for the IRs and the lock. A kind that has no backend is an Error, so no command runs an unknown kind.
import * as go from './go.mjs';
import * as npm from './npm.mjs';
import * as php from './php.mjs';
import * as phpExt from './php-ext.mjs';
import * as python from './python.mjs';
import * as rust from './rust.mjs';

const BACKENDS = Object.freeze({ go, npm, php, 'php-ext': phpExt, python, rust });

/** The kinds that the compiler generates, in the order of this table. */
export const KINDS = Object.freeze(Object.keys(BACKENDS));

/** The backend of `kind`; an unknown kind is an Error. */
export function backendOf(kind) {
  if (!Object.hasOwn(BACKENDS, kind)) throw new Error(`unknown kind ${kind}; the compiler generates ${KINDS.join(', ')}`);
  return BACKENDS[kind];
}
