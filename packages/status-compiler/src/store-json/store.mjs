// The JSON store (docs/spec/status.md, B-2): machines/<machine>.status.json and status.lock.json under a root directory. It
// converts between those files and the objects of the core, and it writes each file atomically. It does not validate: the
// core does (run and copy). A file that cannot be read as a machine is a finding, and the load of the other files goes on.

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { jsonText, writeAtomic } from '../../../../scripts/kit/files.mjs';
import { readLockFile, writeLockFile } from '../store-lock/lock-file.mjs';

/** The $schema of every machine file: the editor schema, relative to machines/. */
const SCHEMA = '../schema/status.schema.json';

const finding = (code, machine, path, message) => ({ code, machine, path, message });
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The JSON value of the file at `file`, or the message of the error that reading or parsing it gave. */
function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

/** The canonical object of a machine file: the key order of docs/spec/status.md, and initial and final only when true. */
function canonicalDefinition({ machine, states, events }) {
  return {
    $schema: SCHEMA,
    machine,
    states: states.map(state => {
      const out = { key: state.key, code: state.code };
      if (state.initial === true) out.initial = true;
      if (state.final === true) out.final = true;
      return out;
    }),
    events: events.map(event => ({
      key: event.key,
      edges: event.edges.map(edge => ({ from: edge.from, to: edge.to })),
    })),
  };
}

/** The JSON store of the root directory `root`: { load() -> Promise<{ definitions, lock, findings }>, save({ definitions, lock }) -> Promise }. */
export function jsonStore(root) {
  const machines = path.join(root, 'machines');

  async function load() {
    const findings = [];
    const definitions = [];
    if (existsSync(machines)) {
      const entries = readdirSync(machines, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name));
      for (const entry of entries) {
        const { name } = entry;
        if (name.endsWith('.status.mmd')) {
          findings.push(finding('E_STORE_MIXED', null, '$', `machines/${name} is a Mermaid file; the json store reads only *.status.json`));
          continue;
        }
        if (!entry.isFile() || !name.endsWith('.status.json')) {
          findings.push(finding('E_SCHEMA', null, '$', `machines/${name} is not a machine file <machine>.status.json`));
          continue;
        }
        const parsed = readJson(path.join(machines, name));
        if (!parsed.ok) {
          findings.push(finding('E_SCHEMA', null, '$', `machines/${name} is not valid JSON: ${parsed.message}`));
          continue;
        }
        if (!isObject(parsed.value)) {
          findings.push(finding('E_SCHEMA', null, '$', `machines/${name} is not a JSON object`));
          continue;
        }
        const definition = { ...parsed.value };
        delete definition.$schema;
        if (typeof definition.machine === 'string' && name !== `${definition.machine}.status.json`) {
          findings.push(finding('E_SCHEMA', definition.machine, '$.machine', `machines/${name} must be named ${definition.machine}.status.json`));
        }
        definitions.push(definition);
      }
    }
    const read = readLockFile(root);
    findings.push(...read.findings);
    return { definitions, lock: read.lock, findings };
  }

  async function save({ definitions, lock }) {
    const wanted = new Set(definitions.map(definition => `${definition.machine}.status.json`));
    if (existsSync(machines)) {
      for (const entry of readdirSync(machines, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.status.json') && !wanted.has(entry.name)) {
          rmSync(path.join(machines, entry.name));
        }
      }
    }
    for (const definition of definitions) {
      writeAtomic(path.join(machines, `${definition.machine}.status.json`), jsonText(canonicalDefinition(definition)));
    }
    writeLockFile(root, lock);
  }

  return { load, save };
}
