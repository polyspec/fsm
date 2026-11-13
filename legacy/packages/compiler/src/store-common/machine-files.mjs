// What the json store and the mermaid store share (docs/spec/fsm.md, B-2): the load of the machine files of a root directory, with
// the findings of a file of the other store and of a file that is no machine file, the save of the machine files, and the canonical
// object of a state. A file that cannot be read as a machine is a finding, and the load of the other files goes on.

import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { writeAtomic } from '../io/files.mjs';
import { committedLock, readLockFile, writeLockFile } from '../store-lock/lock-file.mjs';

/** A finding of a store: its code, the machine (or null), the path in the definition and the message. */
export const finding = (code, machine, at, message) => ({ code, machine, path: at, message });

/** The order of file names: by code unit, so the load is the same on every platform. */
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The canonical object of a state: its key and code, and initial and final only when true (docs/spec/fsm.md, B-1 and B-2). */
export function canonicalState(state) {
  const out = { key: state.key, code: state.code };
  if (state.initial === true) out.initial = true;
  if (state.final === true) out.final = true;
  return out;
}

/**
 * Loads the machines of `root`. `store` describes the store: its `name`, the `suffix` of its machine files, the `other` store whose
 * files are a finding of the mixed stores (its `suffix` and a `label` such as "a Mermaid file"), and `read(name, file)`, which
 * gives { definition, findings } for one machine file. The result is { definitions, lock, baseline, findings }.
 */
export function loadMachineFiles(root, store) {
  const machines = path.join(root, 'machines');
  const findings = [];
  const definitions = [];
  if (existsSync(machines)) {
    const entries = readdirSync(machines, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name));
    for (const entry of entries) {
      const { name } = entry;
      if (name.endsWith(store.other.suffix)) {
        findings.push(finding('E_STORE_MIXED', null, '$', `machines/${name} is ${store.other.label}; the ${store.name} store reads only *${store.suffix}`));
        continue;
      }
      if (!entry.isFile() || !name.endsWith(store.suffix)) {
        findings.push(finding('E_SCHEMA', null, '$', `machines/${name} is not a machine file <machine>${store.suffix}`));
        continue;
      }
      const read = store.read(name, path.join(machines, name));
      findings.push(...read.findings);
      if (read.definition !== undefined) definitions.push(read.definition);
    }
  }
  const lock = readLockFile(root);
  const committed = committedLock(root);
  findings.push(...lock.findings, ...committed.findings);
  return { definitions, lock: lock.lock, baseline: committed.lock, findings };
}

/**
 * Saves the machine files of `root`: `files` are [name, text] pairs. The machine files of the store (`suffix`) that are not in
 * `files` are removed, every file is written atomically, and the lock is written.
 */
export function saveMachineFiles(root, suffix, files, lock) {
  const machines = path.join(root, 'machines');
  const wanted = new Set(files.map(([name]) => name));
  if (existsSync(machines)) {
    for (const entry of readdirSync(machines, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(suffix) && !wanted.has(entry.name)) rmSync(path.join(machines, entry.name));
    }
  }
  for (const [name, text] of files) writeAtomic(path.join(machines, name), text);
  writeLockFile(root, lock);
}
