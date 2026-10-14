// The commands of docs/spec/fsm.md, B-2: run(command, store, options) for check, lock, save, vectors and gen, and copy(from, to),
// the migration between two stores. A store is { load() -> Promise<{ definitions, lock, baseline, findings }>, save({ definitions, lock })
// -> Promise }. The stores are async, so run and copy are async and return a Promise of { findings }; the pure functions
// (validate, normalize, lock, vectors) stay synchronous. lock and save write only when there are no findings, and vectors
// writes nothing: it returns the vectors too. `baseline` is the committed lock (B-3): every command refuses a lock that loses
// or changes a committed code (E_LOCK_REGRESSED). The core imports nothing from node:.

import { backendOf } from '../backends/index.mjs';
import { lockMismatch, lockRegressed, nextLock } from './lock.mjs';
import { normalize } from './normalize.mjs';
import { validate } from './validate.mjs';
import { vectors } from './vectors.mjs';

const COMMANDS = ['check', 'lock', 'save', 'vectors', 'gen'];

const finding = (code, machine, path, message) => ({ code, machine, path, message });

/**
 * The findings of `definitions` with `lock` and the committed lock `baseline` (B-5 and B-3): the validation findings alone when
 * there are any, otherwise the lock mismatches and the committed codes that the lock loses or changes.
 */
const check = (definitions, lock, baseline) => {
  const found = validate(definitions);
  return found.length > 0 ? found : [...lockMismatch(definitions, lock), ...lockRegressed(baseline, lock)];
};

/**
 * Runs `command` on `store`. The load findings of the store stop every command. `check` validates the definitions and then
 * compares the lock with them. `lock` derives the lock from the stored definitions, and `save` from `options.definitions`;
 * both apply `options.renames` and call store.save once, when there are no findings. `vectors` stops on any check finding,
 * and otherwise returns { findings: [], vectors: [{ machine, cases }] } for the definitions in the order of the store.
 * `gen` takes `options.kind`, whose backend is looked up before the store is read (an unknown kind is an Error); it stops on
 * any check finding, and otherwise returns { findings: [], files: [{ path, content }] } from the backend. The backend takes
 * { module, phpNamespace, phpExtName } from options: the go kind requires the module path (`options.goModule`), the php and
 * php-ext kinds the namespace (`options.phpNamespace`), and php-ext also the extension name (`options.phpExtName`); the other
 * kinds ignore them.
 */
export async function run(command, store, options = {}) {
  if (!COMMANDS.includes(command)) throw new Error(`unknown command ${command}`);
  const backend = command === 'gen' ? backendOf(options.kind) : undefined;
  const loaded = await store.load();
  if (loaded.findings.length > 0) return { findings: loaded.findings };
  const { definitions, lock, baseline } = loaded;
  if (command === 'check') return { findings: check(definitions, lock, baseline) };
  if (command === 'vectors' || command === 'gen') {
    const found = check(definitions, lock, baseline);
    if (found.length > 0) return { findings: found };
    if (command === 'gen') return { findings: [], files: backend.files(definitions.map(normalize), lock, { module: options.goModule, phpNamespace: options.phpNamespace, phpExtName: options.phpExtName }) };
    return { findings: [], vectors: definitions.map(definition => vectors(normalize(definition), lock)) };
  }
  if (command === 'save' && options.definitions === undefined) {
    throw new Error('save needs options.definitions, the new full set of definitions');
  }
  const source = command === 'save' ? options.definitions : definitions;
  const found = validate(source);
  if (found.length > 0) return { findings: found };
  const next = nextLock(source, lock, { renames: options.renames ?? [] });
  if (next.findings.length > 0) return { findings: next.findings };
  const regressed = lockRegressed(baseline, next.lock);
  if (regressed.length > 0) return { findings: regressed };
  await store.save({ definitions: next.definitions, lock: next.lock });
  return { findings: [] };
}

/**
 * Copies the definitions and the lock of `from` into `to`. The target must be empty (no definition, no lock machine, no committed
 * lock code and no load finding), and the source must pass validate, lockMismatch and lockRegressed; otherwise the findings are
 * returned and nothing is written.
 */
export async function copy(from, to) {
  const target = await to.load();
  const committedTarget = Object.keys(target.baseline).length > 0;
  if (target.definitions.length > 0 || Object.keys(target.lock).length > 0 || committedTarget || target.findings.length > 0) {
    return { findings: [finding('E_STORE_NOT_EMPTY', null, '$', 'the target store is not empty, so copy writes nothing')] };
  }
  const source = await from.load();
  if (source.findings.length > 0) return { findings: source.findings };
  const found = validate(source.definitions);
  if (found.length > 0) return { findings: found };
  const mismatch = [...lockMismatch(source.definitions, source.lock), ...lockRegressed(source.baseline, source.lock)];
  if (mismatch.length > 0) return { findings: mismatch };
  await to.save({ definitions: source.definitions, lock: source.lock });
  return { findings: [] };
}
