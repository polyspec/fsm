// Helpers of the store tests: temporary roots, the files of a checkout and the bytes of a checkout (docs/spec/status.md, B-2).
// A root made by tempRoot is removed by removeRoots, which the test file calls from its after hook.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const roots = [];

/** A new empty temporary directory. */
export function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'status-store-'));
  roots.push(root);
  return root;
}

/** Removes every root made by tempRoot. */
export function removeRoots() {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

/** Writes `text` to `relative` under `root`, creating the directories. */
export function write(root, relative, text) {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), text);
}

/** The bytes of a checkout: the files of machines/ in name order, then the lock file when it exists. */
export function bytesOf(root) {
  const parts = [];
  const machines = path.join(root, 'machines');
  if (existsSync(machines)) {
    for (const name of readdirSync(machines).sort()) parts.push(`${name}\n${readFileSync(path.join(machines, name), 'utf8')}`);
  }
  const lock = path.join(root, 'status.lock.json');
  if (existsSync(lock)) parts.push(`status.lock.json\n${readFileSync(lock, 'utf8')}`);
  return parts.join('---\n');
}

/** The files of a checkout as a map of relative path to text: the files of machines/ and the lock file. */
export function filesOf(root) {
  const out = {};
  const machines = path.join(root, 'machines');
  if (existsSync(machines)) {
    for (const name of readdirSync(machines).sort()) out[`machines/${name}`] = readFileSync(path.join(machines, name), 'utf8');
  }
  if (existsSync(path.join(root, 'status.lock.json'))) out['status.lock.json'] = readFileSync(path.join(root, 'status.lock.json'), 'utf8');
  return out;
}
