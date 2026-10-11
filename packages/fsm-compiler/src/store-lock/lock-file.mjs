// The lock file of the file stores (docs/spec/fsm.md, B-2 and B-3): fsm.lock.json under the root directory. The JSON
// store and the Mermaid store both read and write it here, so both stores write the same bytes. readLockFile and
// committedLock never fail: a lock that cannot be read or does not have the shape { machine: { codes: { code: key },
// reserved: [code] } } is a finding, and the lock it returns is then the empty lock or the parsed value. They do not
// validate: the core does (run and copy). committedLock reads the lock of the committed state (git HEAD), which is the
// baseline of the lock rules (B-3); outside git, or with no commit or an untracked file, nothing is committed.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Stop } from '../../../../scripts/kit/process.mjs';
import { jsonText, writeAtomic } from '../../../../scripts/kit/files.mjs';
import { git, gitResult } from '../../../../scripts/kit/git.mjs';
import { canonicalLock } from '../core/lock.mjs';

/** The name of the lock file under the root directory. */
export const LOCK_FILE = 'fsm.lock.json';

const finding = (code, machine, path, message) => ({ code, machine, path, message });
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const EMPTY = { lock: {}, findings: [] };

/** The findings of a lock that does not have the shape { machine: { codes: { code: key }, reserved: [code] } }. */
function lockShape(lock) {
  if (!isObject(lock)) return [finding('E_SCHEMA', null, '$', 'fsm.lock.json is not a JSON object')];
  const found = [];
  for (const machine of Object.keys(lock)) {
    const entry = lock[machine];
    const at = `$.${machine}`;
    if (!isObject(entry) || Object.keys(entry).sort().join() !== 'codes,reserved') {
      found.push(finding('E_SCHEMA', machine, at, 'an entry of the lock has exactly the fields codes and reserved'));
      continue;
    }
    const codesOk = isObject(entry.codes)
      && Object.entries(entry.codes).every(([code, key]) => /^[1-9]\d*$/.test(code) && typeof key === 'string');
    if (!codesOk) found.push(finding('E_SCHEMA', machine, `${at}.codes`, 'codes must map canonical positive integers to keys'));
    if (!Array.isArray(entry.reserved) || !entry.reserved.every(code => Number.isInteger(code))) {
      found.push(finding('E_SCHEMA', machine, `${at}.reserved`, 'reserved must be an array of integers'));
    }
  }
  return found;
}

/** The lock and the findings of the text of a lock file; `what` names the file in a finding. */
function parseLock(text, what) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { lock: {}, findings: [finding('E_SCHEMA', null, '$', `${what} is not valid JSON: ${error.message}`)] };
  }
  return { lock: isObject(value) ? value : {}, findings: lockShape(value) };
}

/** The lock of the root directory `root` and the findings of reading it; the empty lock when the file does not exist. */
export function readLockFile(root) {
  const file = path.join(root, LOCK_FILE);
  if (!existsSync(file)) return EMPTY;
  return parseLock(readFileSync(file, 'utf8'), 'fsm.lock.json');
}

/**
 * The lock of the committed state of `root`: fsm.lock.json at git HEAD, the baseline of the lock rules (B-3). Nothing is committed,
 * and the empty lock is returned, when `root` is outside a git work tree, when the repository has no commit, or when the file is
 * not tracked at HEAD, or when the directory does not exist yet. A committed file that cannot be read is a finding. Any other failure of git is a Stop, never an empty lock.
 */
export function committedLock(root) {
  if (!existsSync(root)) return EMPTY;
  const probe = gitResult(root, 'rev-parse', '--is-inside-work-tree');
  if (probe.status !== 0) {
    if (/^fatal: not a git repository/m.test(probe.stderr)) return EMPTY;
    throw new Stop(`git rev-parse --is-inside-work-tree in ${root} failed: ${(probe.error?.message ?? probe.stderr).trim()}`);
  }
  if (probe.stdout.trim() !== 'true') return EMPTY;
  const head = gitResult(root, 'rev-parse', '--verify', '--quiet', 'HEAD');
  if (head.status === 1) return EMPTY;
  if (head.status !== 0) throw new Stop(`git rev-parse --verify HEAD in ${root} failed: ${(head.error?.message ?? head.stderr).trim()}`);
  if (git(root, 'ls-tree', 'HEAD', '--', `./${LOCK_FILE}`).trim() === '') return EMPTY;
  return parseLock(git(root, 'show', `HEAD:./${LOCK_FILE}`), `the committed ${LOCK_FILE}`);
}

/** Writes the lock of the root directory `root` in canonical form (canonicalLock, two spaces, a final line break) atomically. */
export function writeLockFile(root, lock) {
  writeAtomic(path.join(root, LOCK_FILE), jsonText(canonicalLock(lock)));
}
