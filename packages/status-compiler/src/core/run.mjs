// The commands of docs/spec/status.md, B-2: run(command, store, options) for check, lock and save, and copy(from, to), the
// migration between two stores. A store is { load() -> { definitions, lock, findings }, save({ definitions, lock }) }. Every
// command returns { findings }; it writes only when there are no findings. The core imports nothing from node:.

import { lockMismatch, nextLock } from './lock.mjs';
import { validate } from './validate.mjs';

const COMMANDS = ['check', 'lock', 'save'];

const finding = (code, machine, path, message) => ({ code, machine, path, message });

/**
 * Runs `command` on `store`. The load findings of the store stop every command. `check` validates the definitions and then
 * compares the lock with them. `lock` derives the lock from the stored definitions, and `save` from `options.definitions`;
 * both apply `options.renames` and call store.save once, when there are no findings.
 */
export function run(command, store, options = {}) {
  if (!COMMANDS.includes(command)) throw new Error(`unknown command ${command}`);
  const loaded = store.load();
  if (loaded.findings.length > 0) return { findings: loaded.findings };
  const { definitions, lock } = loaded;
  if (command === 'check') {
    const found = validate(definitions);
    return { findings: found.length > 0 ? found : lockMismatch(definitions, lock) };
  }
  if (command === 'save' && options.definitions === undefined) {
    throw new Error('save needs options.definitions, the new full set of definitions');
  }
  const source = command === 'save' ? options.definitions : definitions;
  const found = validate(source);
  if (found.length > 0) return { findings: found };
  const next = nextLock(source, lock, { renames: options.renames ?? [] });
  if (next.findings.length > 0) return { findings: next.findings };
  store.save({ definitions: next.definitions, lock: next.lock });
  return { findings: [] };
}

/**
 * Copies the definitions and the lock of `from` into `to`. The target must be empty (no definition, no lock machine and no
 * load finding), and the source must pass validate and lockMismatch; otherwise the findings are returned and nothing is written.
 */
export function copy(from, to) {
  const target = to.load();
  if (target.definitions.length > 0 || Object.keys(target.lock).length > 0 || target.findings.length > 0) {
    return { findings: [finding('E_STORE_NOT_EMPTY', null, '$', 'the target store is not empty, so copy writes nothing')] };
  }
  const source = from.load();
  if (source.findings.length > 0) return { findings: source.findings };
  const found = validate(source.definitions);
  if (found.length > 0) return { findings: found };
  const mismatch = lockMismatch(source.definitions, source.lock);
  if (mismatch.length > 0) return { findings: mismatch };
  to.save({ definitions: source.definitions, lock: source.lock });
  return { findings: [] };
}
