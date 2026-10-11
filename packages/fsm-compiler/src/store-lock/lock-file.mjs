// The lock file of the file stores (docs/spec/fsm.md, B-2 and B-3): fsm.lock.json under the root directory. The JSON
// store and the Mermaid store both read and write it here, so both stores write the same bytes. readLockFile never fails:
// a lock that cannot be read or does not have the shape { machine: { codes: { code: key }, reserved: [code] } } is a finding,
// and the lock it returns is then the empty lock or the parsed value. It does not validate: the core does (run and copy).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { jsonText, writeAtomic } from '../../../../scripts/kit/files.mjs';
import { canonicalLock } from '../core/lock.mjs';

/** The name of the lock file under the root directory. */
export const LOCK_FILE = 'fsm.lock.json';

const finding = (code, machine, path, message) => ({ code, machine, path, message });
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

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

/** The lock of the root directory `root` and the findings of reading it; the empty lock when the file does not exist. */
export function readLockFile(root) {
  const file = path.join(root, LOCK_FILE);
  if (!existsSync(file)) return { lock: {}, findings: [] };
  let value;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { lock: {}, findings: [finding('E_SCHEMA', null, '$', `fsm.lock.json is not valid JSON: ${error.message}`)] };
  }
  return { lock: isObject(value) ? value : {}, findings: lockShape(value) };
}

/** Writes the lock of the root directory `root` in canonical form (canonicalLock, two spaces, a final line break) atomically. */
export function writeLockFile(root, lock) {
  writeAtomic(path.join(root, LOCK_FILE), jsonText(canonicalLock(lock)));
}
