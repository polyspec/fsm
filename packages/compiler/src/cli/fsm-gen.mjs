#!/usr/bin/env node
// The command line of the compiler (docs/plans/fsm-v1/plan.md, C-5):
//   fsm-gen check [--project <dir>]
//   fsm-gen lock  [--project <dir>] [--rename machine.old=new]...
//   fsm-gen copy  --to json|mermaid --root <dir> [--project <dir>]
//   fsm-gen vectors --out <file> [--project <dir>]
//   fsm-gen vectors --kind <kind> --out <file> [--project <dir>] [--go-module <module path>] [--php-namespace <ns>]
//   fsm-gen gen --kind <kind> --out <dir> [--project <dir>] [--go-module <module path>] [--php-namespace <ns>] [--php-ext-name <name>]
//   (go only: --go-module, required for gen and for vectors --kind go; php and php-ext: --php-namespace <ns>, required, such as Polyspec\FsmTest, for gen and
//   vectors --kind php or php-ext; php-ext only: --php-ext-name <name>, required for gen, such as polyspec_fsm_test)
// --project is the project root, the directory whose fsm.config.json names the store (default: the current directory).
// For copy, the project store is the source and --root is the target directory, which is required. For vectors, --out is the
// file that receives { machines: [{ machine, cases }] } for every machine, one suite for the parity check, and it is required;
// with --kind it is the file of the kind's native vector module. For gen, --kind names a backend (backends/index.mjs) and --out is the directory of its generated files; the
// stale generated files there are removed, and a file without the generated header is a finding (write-generated.mjs). A finding
// prints as `[fsm-gen] <code> <machine> <path>: <message>` on stderr and exits 1. A usage error exits 2. Otherwise the command
// exits 0 with a one-line summary on stdout. The json and mermaid stores are the ones this version handles (fsm.config.json).
// --php-namespace is the namespace of the php and php-ext kinds (backends/php.mjs, backends/php-ext.mjs): it is required for them
// and refused for every other kind. --php-ext-name is the name of the php-ext extension and is an option of gen --kind php-ext.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { jsonText, writeAtomic } from '../io/files.mjs';
import { KINDS, backendOf } from '../backends/index.mjs';
import { copy, run } from '../core/run.mjs';
import { jsonStore } from '../store-json/store.mjs';
import { mermaidStore } from '../store-mermaid/store.mjs';
import { writeGenerated, writeGeneratedFile } from './write-generated.mjs';

const USAGE = 'usage: fsm-gen check [--project <dir>]\n'
  + '       fsm-gen lock [--project <dir>] [--rename machine.old=new]...\n'
  + '       fsm-gen copy --to json|mermaid --root <dir> [--project <dir>]\n'
  + '       fsm-gen vectors [--kind <kind>] --out <file> [--project <dir>] [--go-module <module path>] [--php-namespace <ns>]\n'
  + `       fsm-gen gen --kind <kind> --out <dir> [--project <dir>] [--go-module <module path>] [--php-namespace <ns>] [--php-ext-name <name>]   (kind: ${KINDS.join(', ')})`;
const RENAME = /^([^.=]+)\.([^.=]+)=([^.=]+)$/;
const PHP_NAMESPACE = /^[A-Za-z][A-Za-z0-9]*(\\[A-Za-z][A-Za-z0-9]*)*$/;
const PHP_EXTENSION = /^[a-z][a-z0-9_]*$/;
const PHP_KINDS = ['php', 'php-ext'];

const notConfigured = (path, message) => ({ code: 'E_STORE_NOT_CONFIGURED', machine: null, path, message });
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The options of the arguments, or { usage } with the reason when they are not a valid command line. */
function parse(argv) {
  const [command, ...rest] = argv;
  if (!['check', 'lock', 'copy', 'vectors', 'gen'].includes(command)) return { usage: `unknown command ${command ?? '(none)'}` };
  const allowed = {
    check: ['--project'],
    lock: ['--project', '--rename'],
    copy: ['--project', '--root', '--to'],
    vectors: ['--project', '--out', '--kind', '--go-module', '--php-namespace'],
    gen: ['--project', '--out', '--kind', '--go-module', '--php-namespace', '--php-ext-name'],
  }[command];
  const options = {
    command, project: process.cwd(), renames: [], to: undefined, root: undefined, out: undefined, kind: undefined, goModule: undefined, phpNamespace: undefined, phpExtName: undefined,
  };
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
    } else if (flag === '--kind') {
      if (!KINDS.includes(value)) return { usage: `--kind takes one of ${KINDS.join(', ')}` };
      options.kind = value;
    } else if (flag === '--go-module') {
      options.goModule = value;
    } else if (flag === '--php-namespace') {
      if (!PHP_NAMESPACE.test(value)) return { usage: '--php-namespace takes letters and digits separated by single backslashes, such as Polyspec\\FsmTest' };
      options.phpNamespace = value;
    } else if (flag === '--php-ext-name') {
      if (!PHP_EXTENSION.test(value)) return { usage: '--php-ext-name takes lowercase letters, digits and underscores, starting with a letter, such as polyspec_fsm_test' };
      options.phpExtName = value;
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
  if (command === 'vectors' && options.out === undefined) return { usage: 'vectors needs --out <file>' };
  if (command === 'gen' && (options.kind === undefined || options.out === undefined)) {
    return { usage: 'gen needs --kind <kind> and --out <dir>' };
  }
  if ((command === 'gen' || command === 'vectors') && options.kind === 'go' && options.goModule === undefined) {
    return { usage: `${command} --kind go needs --go-module <module path>, the module of the package` };
  }
  if (options.goModule !== undefined && options.kind !== 'go') return { usage: '--go-module is an option of gen and vectors --kind go' };
  if (command === 'gen' || command === 'vectors') {
    const usesNamespace = PHP_KINDS.includes(options.kind);
    if (usesNamespace && options.phpNamespace === undefined) return { usage: `${command} needs --php-namespace for the ${options.kind} kind` };
    if (!usesNamespace && options.phpNamespace !== undefined) return { usage: '--php-namespace is an option of the php and php-ext kinds' };
  }
  if (options.phpExtName !== undefined && options.kind !== 'php-ext') return { usage: '--php-ext-name is an option of gen --kind php-ext' };
  if (command === 'gen' && options.kind === 'php-ext' && options.phpExtName === undefined) {
    return { usage: 'gen --kind php-ext needs --php-ext-name <name>, the name of the extension, such as polyspec_fsm_test' };
  }
  return options;
}

/** The store that <project>/fsm.config.json names, or the findings of why fsm-gen cannot use it. */
function configuredStore(project) {
  const file = path.join(project, 'fsm.config.json');
  if (!existsSync(file)) {
    return { ok: false, findings: [notConfigured('$', `fsm.config.json is missing in ${project}`)] };
  }
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { ok: false, findings: [notConfigured('$', `fsm.config.json is not valid JSON: ${error.message}`)] };
  }
  const store = isObject(config) ? config.store : undefined;
  if (store === 'json') return { ok: true, store: jsonStore(project) };
  if (store === 'mermaid') return { ok: true, store: mermaidStore(project) };
  return { ok: false, findings: [notConfigured('$.store', `fsm-gen handles the json and mermaid stores only; the configured store is ${JSON.stringify(store)}`)] };
}

/** The store of the kind `kind` (json or mermaid) under the root directory `root`. */
function storeOf(kind, root) {
  return kind === 'mermaid' ? mermaidStore(root) : jsonStore(root);
}

/**
 * The findings of the command. vectors writes the vectors of every machine to the file <out>, or with --kind the native vector module
 * of the kind to <out>; gen writes the generated files of the kind under <out>. Nothing is written when there are findings.
 */
async function execute({ command, project, renames, to, root, out, kind, goModule, phpNamespace, phpExtName }) {
  const configured = configuredStore(project);
  if (!configured.ok) return configured.findings;
  if (command === 'copy') return (await copy(configured.store, storeOf(to, root))).findings;
  if (command === 'vectors') {
    const result = await run('vectors', configured.store, {});
    if (result.findings.length > 0) return result.findings;
    if (kind !== undefined) return writeGeneratedFile(out, backendOf(kind).vectorsFile(result.vectors, { phpNamespace, module: goModule }));
    writeAtomic(out, jsonText({ machines: result.vectors }));
    return [];
  }
  if (command === 'gen') {
    const result = await run('gen', configured.store, { kind, goModule, phpNamespace, phpExtName });
    if (result.findings.length > 0) return result.findings;
    return writeGenerated(out, result.files);
  }
  return (await run(command, configured.store, { renames })).findings;
}

/** Runs the command line and returns its exit code. */
async function main(argv) {
  const parsed = parse(argv);
  if ('usage' in parsed) {
    process.stderr.write(`[fsm-gen] usage: ${parsed.usage}\n${USAGE}\n`);
    return 2;
  }
  const findings = await execute(parsed);
  if (findings.length > 0) {
    for (const { code, machine, path: at, message } of findings) {
      process.stderr.write(`[fsm-gen] ${code} ${machine ?? '-'} ${at}: ${message}\n`);
    }
    return 1;
  }
  process.stdout.write(`[fsm-gen] ${parsed.command}: ok\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  code => {
    process.exitCode = code;
  },
  error => {
    // An unexpected rejection is never swallowed: it is printed and the command exits 1.
    process.stderr.write(`[fsm-gen] ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);
