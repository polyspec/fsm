// The command line of the compiler (docs/plans/status-v1.md, C-5):
//   status-gen check [--project <dir>]
//   status-gen lock  [--project <dir>] [--rename machine.old=new]...
//   status-gen copy  --to json|mermaid --root <dir> [--project <dir>]
//   status-gen vectors --out <dir> [--project <dir>]
// --project is the project root, the directory whose status.config.json names the store (default: the current directory).
// For copy, the project store is the source and --root is the target directory, which is required. For vectors, --out is the
// directory that receives <machine>.json for every machine, and it is required. A finding prints as
// `[status-gen] <code> <machine> <path>: <message>` on stderr and exits 1. A usage error exits 2. Otherwise the command exits 0
// with a one-line summary on stdout. The json and mermaid stores are the ones this version handles (status.config.json).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeJson } from '../../../../scripts/kit/files.mjs';
import { copy, run } from '../core/run.mjs';
import { jsonStore } from '../store-json/store.mjs';
import { mermaidStore } from '../store-mermaid/store.mjs';

const USAGE = 'usage: status-gen check [--project <dir>]\n'
  + '       status-gen lock [--project <dir>] [--rename machine.old=new]...\n'
  + '       status-gen copy --to json|mermaid --root <dir> [--project <dir>]\n'
  + '       status-gen vectors --out <dir> [--project <dir>]';
const RENAME = /^([^.=]+)\.([^.=]+)=([^.=]+)$/;

const notConfigured = (path, message) => ({ code: 'E_STORE_NOT_CONFIGURED', machine: null, path, message });
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The options of the arguments, or { usage } with the reason when they are not a valid command line. */
function parse(argv) {
  const [command, ...rest] = argv;
  if (!['check', 'lock', 'copy', 'vectors'].includes(command)) return { usage: `unknown command ${command ?? '(none)'}` };
  const allowed = {
    check: ['--project'], lock: ['--project', '--rename'], copy: ['--project', '--root', '--to'], vectors: ['--project', '--out'],
  }[command];
  const options = { command, project: process.cwd(), renames: [], to: undefined, root: undefined, out: undefined };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!allowed.includes(flag)) return { usage: `${flag ?? 'argument'} is not an option of ${command}` };
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) return { usage: `${flag} needs a value` };
    index += 1;
    if (flag === '--project') {
      options.project = path.resolve(value);
    } else if (flag === '--root') {
      options.root = path.resolve(value);
    } else if (flag === '--out') {
      options.out = path.resolve(value);
    } else if (flag === '--to') {
      if (!['json', 'mermaid'].includes(value)) return { usage: '--to takes json or mermaid' };
      options.to = value;
    } else {
      const match = RENAME.exec(value);
      if (match === null) return { usage: '--rename takes machine.old=new' };
      options.renames.push({ machine: match[1], from: match[2], to: match[3] });
    }
  }
  if (command === 'copy' && (options.to === undefined || options.root === undefined)) {
    return { usage: 'copy needs --to json|mermaid and --root <dir>' };
  }
  if (command === 'vectors' && options.out === undefined) return { usage: 'vectors needs --out <dir>' };
  return options;
}

/** The store that <project>/status.config.json names, or the findings of why status-gen cannot use it. */
function configuredStore(project) {
  const file = path.join(project, 'status.config.json');
  if (!existsSync(file)) {
    return { ok: false, findings: [notConfigured('$', `status.config.json is missing in ${project}`)] };
  }
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { ok: false, findings: [notConfigured('$', `status.config.json is not valid JSON: ${error.message}`)] };
  }
  const store = isObject(config) ? config.store : undefined;
  if (store === 'json') return { ok: true, store: jsonStore(project) };
  if (store === 'mermaid') return { ok: true, store: mermaidStore(project) };
  return { ok: false, findings: [notConfigured('$.store', `status-gen handles the json and mermaid stores only; the configured store is ${JSON.stringify(store)}`)] };
}

/** The store of the kind `kind` (json or mermaid) under the root directory `root`. */
function storeOf(kind, root) {
  return kind === 'mermaid' ? mermaidStore(root) : jsonStore(root);
}

/** The findings of the command. vectors writes <out>/<machine>.json for every machine and no file when it has findings. */
function execute({ command, project, renames, to, root, out }) {
  const configured = configuredStore(project);
  if (!configured.ok) return configured.findings;
  if (command === 'copy') return copy(configured.store, storeOf(to, root)).findings;
  if (command === 'vectors') {
    const result = run('vectors', configured.store, {});
    if (result.findings.length > 0) return result.findings;
    for (const generated of result.vectors) writeJson(path.join(out, `${generated.machine}.json`), generated);
    return [];
  }
  return run(command, configured.store, { renames }).findings;
}

/** Runs the command line and returns its exit code. */
function main(argv) {
  const parsed = parse(argv);
  if ('usage' in parsed) {
    process.stderr.write(`[status-gen] usage: ${parsed.usage}\n${USAGE}\n`);
    return 2;
  }
  const findings = execute(parsed);
  if (findings.length > 0) {
    for (const { code, machine, path: at, message } of findings) {
      process.stderr.write(`[status-gen] ${code} ${machine ?? '-'} ${at}: ${message}\n`);
    }
    return 1;
  }
  process.stdout.write(`[status-gen] ${parsed.command}: ok\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
