// The Mermaid store (docs/spec/fsm.md, B-1 and B-2): machines/<machine>.fsm.mmd and fsm.lock.json under a root
// directory. It reads and writes only the canonical form (parse.mjs and write.mjs), and it writes each file atomically. It
// does not validate: the core does (run and copy). A file that cannot be read as a machine is a finding, and the load of the
// other files goes on. A *.fsm.json in machines/ is a finding of the mixed stores (E_STORE_MIXED).

import { readFileSync } from 'node:fs';
import { finding, loadMachineFiles, saveMachineFiles } from '../store-common/machine-files.mjs';
import { parseMermaid } from './parse.mjs';
import { mermaidText } from './write.mjs';

const SUFFIX = '.fsm.mmd';


/** The Mermaid store of the root directory `root`: { load() -> Promise<{ definitions, lock, baseline, findings }>, save({ definitions, lock }) -> Promise }. */
export function mermaidStore(root) {
  /** The definition of the machine file `name` at `file`, or its findings. */
  function read(name, file) {
    const fileMachine = name.slice(0, -SUFFIX.length);
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      return { findings: [finding('E_SCHEMA', null, '$', `machines/${name} cannot be read: ${error.message}`)] };
    }
    const parsed = parseMermaid(text, fileMachine);
    if (parsed.findings.length > 0) return { findings: parsed.findings };
    const findings = [];
    if (parsed.definition.machine !== fileMachine) {
      findings.push(finding('E_SCHEMA', parsed.definition.machine, '$.machine', `machines/${name} must be named ${parsed.definition.machine}${SUFFIX}`));
    }
    return { definition: parsed.definition, findings };
  }

  async function load() {
    return loadMachineFiles(root, { name: 'mermaid', suffix: SUFFIX, other: { suffix: '.fsm.json', label: 'a JSON file' }, read });
  }

  /** Writes the definitions in canonical form, deletes the *.fsm.mmd files that are not defined, and writes the lock. */
  async function save({ definitions, lock }) {
    saveMachineFiles(root, SUFFIX, definitions.map(definition => [`${definition.machine}${SUFFIX}`, mermaidText(definition)]), lock);
  }

  return { load, save };
}
