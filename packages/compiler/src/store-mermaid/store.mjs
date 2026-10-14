// The Mermaid store (docs/spec/fsm.md, B-1 and B-2): machines/<machine>.fsm.mmd and fsm.lock.json under a root
// directory. It reads and writes only the canonical form (parse.mjs and write.mjs), and it writes each file atomically. It
// does not validate: the core does (run and copy). A file that cannot be read as a machine is a finding, and the load of the
// other files goes on. A *.fsm.json in machines/ is a finding of the mixed stores (E_STORE_MIXED).

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { writeAtomic } from '../io/files.mjs';
import { committedLock, readLockFile, writeLockFile } from '../store-lock/lock-file.mjs';
import { parseMermaid } from './parse.mjs';
import { mermaidText } from './write.mjs';

const SUFFIX = '.fsm.mmd';

const finding = (code, machine, path, message) => ({ code, machine, path, message });
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The Mermaid store of the root directory `root`: { load() -> Promise<{ definitions, lock, baseline, findings }>, save({ definitions, lock }) -> Promise }. */
export function mermaidStore(root) {
  const machines = path.join(root, 'machines');

  async function load() {
    const findings = [];
    const definitions = [];
    if (existsSync(machines)) {
      const entries = readdirSync(machines, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name));
      for (const entry of entries) {
        const { name } = entry;
        if (name.endsWith('.fsm.json')) {
          findings.push(finding('E_STORE_MIXED', null, '$', `machines/${name} is a JSON file; the mermaid store reads only *.fsm.mmd`));
          continue;
        }
        if (!entry.isFile() || !name.endsWith(SUFFIX)) {
          findings.push(finding('E_SCHEMA', null, '$', `machines/${name} is not a machine file <machine>.fsm.mmd`));
          continue;
        }
        const fileMachine = name.slice(0, -SUFFIX.length);
        let text;
        try {
          text = readFileSync(path.join(machines, name), 'utf8');
        } catch (error) {
          findings.push(finding('E_SCHEMA', null, '$', `machines/${name} cannot be read: ${error.message}`));
          continue;
        }
        const parsed = parseMermaid(text, fileMachine);
        if (parsed.findings.length > 0) {
          findings.push(...parsed.findings);
          continue;
        }
        if (parsed.definition.machine !== fileMachine) {
          findings.push(finding('E_SCHEMA', parsed.definition.machine, '$.machine', `machines/${name} must be named ${parsed.definition.machine}.fsm.mmd`));
        }
        definitions.push(parsed.definition);
      }
    }
    const read = readLockFile(root);
    const committed = committedLock(root);
    findings.push(...read.findings, ...committed.findings);
    return { definitions, lock: read.lock, baseline: committed.lock, findings };
  }

  /** Writes the definitions in canonical form, deletes the *.fsm.mmd files that are not defined, and writes the lock. */
  async function save({ definitions, lock }) {
    const files = definitions.map(definition => [`${definition.machine}${SUFFIX}`, mermaidText(definition)]);
    const wanted = new Set(files.map(([name]) => name));
    if (existsSync(machines)) {
      for (const entry of readdirSync(machines, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(SUFFIX) && !wanted.has(entry.name)) rmSync(path.join(machines, entry.name));
      }
    }
    for (const [name, text] of files) writeAtomic(path.join(machines, name), text);
    writeLockFile(root, lock);
  }

  return { load, save };
}
