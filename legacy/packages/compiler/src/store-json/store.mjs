// The JSON store (docs/spec/fsm.md, B-2): machines/<machine>.fsm.json and fsm.lock.json under a root directory. It
// converts between those files and the objects of the core, and it writes each file atomically. It does not validate: the
// core does (run and copy). A file that cannot be read as a machine is a finding, and the load of the other files goes on.

import { readFileSync } from 'node:fs';
import { jsonText } from '../io/files.mjs';
import { canonicalState, finding, loadMachineFiles, saveMachineFiles } from '../store-common/machine-files.mjs';

/** The $schema of every machine file: the editor schema, relative to machines/. */
const SCHEMA = '../schema/fsm.schema.json';

const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The JSON value of the file at `file`, or the message of the error that reading or parsing it gave. */
function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

/** The canonical object of a machine file: the key order of docs/spec/fsm.md, and initial and final only when true. */
function canonicalDefinition({ machine, states, events }) {
  return {
    $schema: SCHEMA,
    machine,
    states: states.map(canonicalState),
    events: events.map(event => ({
      key: event.key,
      edges: event.edges.map(edge => ({ from: edge.from, to: edge.to })),
    })),
  };
}

/** The JSON store of the root directory `root`: { load() -> Promise<{ definitions, lock, baseline, findings }>, save({ definitions, lock }) -> Promise }. */
export function jsonStore(root) {
  const SUFFIX = '.fsm.json';

  /** The definition of the machine file `name` at `file`, or its findings. */
  function read(name, file) {
    const parsed = readJson(file);
    if (!parsed.ok) return { findings: [finding('E_SCHEMA', null, '$', `machines/${name} is not valid JSON: ${parsed.message}`)] };
    if (!isObject(parsed.value)) return { findings: [finding('E_SCHEMA', null, '$', `machines/${name} is not a JSON object`)] };
    const definition = { ...parsed.value };
    delete definition.$schema;
    const findings = [];
    if (typeof definition.machine === 'string' && name !== `${definition.machine}${SUFFIX}`) {
      findings.push(finding('E_SCHEMA', definition.machine, '$.machine', `machines/${name} must be named ${definition.machine}${SUFFIX}`));
    }
    return { definition, findings };
  }

  async function load() {
    return loadMachineFiles(root, { name: 'json', suffix: SUFFIX, other: { suffix: '.fsm.mmd', label: 'a Mermaid file' }, read });
  }

  async function save({ definitions, lock }) {
    saveMachineFiles(root, SUFFIX, definitions.map(definition => [`${definition.machine}${SUFFIX}`, jsonText(canonicalDefinition(definition))]), lock);
  }

  return { load, save };
}
