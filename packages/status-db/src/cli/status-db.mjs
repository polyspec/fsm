// The command line of the DB store (docs/plans/status-v1.md, C-6; docs/spec/status.md, B-2):
//   status-db check [--project <dir>]
//   status-db lock  [--project <dir>] [--rename machine.old=new]...
//   status-db copy  --to json|mermaid   --root <dir> [--project <dir>]   (the database is the source)
//   status-db copy  --from json|mermaid --root <dir> [--project <dir>]   (the database is the target)
// --project is the project root, whose status.config.json must name the db store:
//   {"store":"db","dsnEnv":"STATUS_DSN"}
// The DSN is the value of the environment variable that dsnEnv names; it is never read from anywhere else. The database
// schema is the one of schema/status.dbs, installed by the operator (the CLI does not install it). A finding prints as
// `[status-db] <code> <machine> <path>: <message>` on stderr and exits 1. A usage error exits 2. Otherwise the command exits 0
// with a one-line summary on stdout. An unexpected rejection (for example a missing table) is printed with its stack and exits 1.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { copy, run } from '../../../status-compiler/src/core/run.mjs';
import { jsonStore } from '../../../status-compiler/src/store-json/store.mjs';
import { mermaidStore } from '../../../status-compiler/src/store-mermaid/store.mjs';
import { dbStore } from '../db-store.mjs';
import { connect } from '../models/models.ts';

const USAGE = 'usage: status-db check [--project <dir>]\n'
  + '       status-db lock [--project <dir>] [--rename machine.old=new]...\n'
  + '       status-db copy --to json|mermaid --root <dir> [--project <dir>]\n'
  + '       status-db copy --from json|mermaid --root <dir> [--project <dir>]';
const RENAME = /^([^.=]+)\.([^.=]+)=([^.=]+)$/;

const notConfigured = (at, message) => ({ code: 'E_STORE_NOT_CONFIGURED', machine: null, path: at, message });
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The options of the arguments, or { usage } with the reason when they are not a valid command line. */
function parse(argv) {
  const [command, ...rest] = argv;
  if (!['check', 'lock', 'copy'].includes(command)) return { usage: `unknown command ${command ?? '(none)'}` };
  const allowed = { check: ['--project'], lock: ['--project', '--rename'], copy: ['--project', '--root', '--to', '--from'] }[command];
  const options = {
    command, project: process.cwd(), renames: [], to: undefined, from: undefined, root: undefined,
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
    } else if (flag === '--to' || flag === '--from') {
      if (!['json', 'mermaid'].includes(value)) return { usage: `${flag} takes json or mermaid` };
      if (options.to !== undefined || options.from !== undefined) return { usage: 'copy takes one of --to and --from' };
      options[flag.slice(2)] = value;
    } else {
      const match = RENAME.exec(value);
      if (match === null) return { usage: '--rename takes machine.old=new' };
      options.renames.push({ machine: match[1], from: match[2], to: match[3] });
    }
  }
  if (command === 'copy' && ((options.to === undefined && options.from === undefined) || options.root === undefined)) {
    return { usage: 'copy needs --to json|mermaid or --from json|mermaid, and --root <dir>' };
  }
  return options;
}

/** The DSN named by status.config.json of `project`, or the findings of why the db store cannot be used. */
function configuredDsn(project) {
  const file = path.join(project, 'status.config.json');
  if (!existsSync(file)) return { ok: false, findings: [notConfigured('$', `status.config.json is missing in ${project}`)] };
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { ok: false, findings: [notConfigured('$', `status.config.json is not valid JSON: ${error.message}`)] };
  }
  if (!isObject(config) || config.store !== 'db') {
    return { ok: false, findings: [notConfigured('$.store', `status-db handles the db store only; the configured store is ${JSON.stringify(config?.store)}`)] };
  }
  if (typeof config.dsnEnv !== 'string' || config.dsnEnv === '') {
    return { ok: false, findings: [notConfigured('$.dsnEnv', 'status.config.json must name the environment variable of the DSN in dsnEnv')] };
  }
  const dsn = process.env[config.dsnEnv];
  if (dsn === undefined || dsn === '') {
    return { ok: false, findings: [notConfigured('$.dsnEnv', `the environment variable ${config.dsnEnv} is not set`)] };
  }
  return { ok: true, dsn };
}

/** The file store of the kind `kind` under the root directory `root`. */
function fileStore(kind, root) {
  return kind === 'mermaid' ? mermaidStore(root) : jsonStore(root);
}

/** The findings of the command. */
async function execute({
  command, project, renames, to, from, root,
}) {
  const configured = configuredDsn(project);
  if (!configured.ok) return configured.findings;
  const db = await connect(configured.dsn);
  try {
    const store = dbStore(db);
    if (command === 'copy' && to !== undefined) return (await copy(store, fileStore(to, root))).findings;
    if (command === 'copy') return (await copy(fileStore(from, root), store)).findings;
    return (await run(command, store, { renames })).findings;
  } finally {
    await db.close();
  }
}

/** Runs the command line and returns its exit code. */
async function main(argv) {
  const parsed = parse(argv);
  if ('usage' in parsed) {
    process.stderr.write(`[status-db] usage: ${parsed.usage}\n${USAGE}\n`);
    return 2;
  }
  const findings = await execute(parsed);
  if (findings.length > 0) {
    for (const { code, machine, path: at, message } of findings) {
      process.stderr.write(`[status-db] ${code} ${machine ?? '-'} ${at}: ${message}\n`);
    }
    return 1;
  }
  process.stdout.write(`[status-db] ${parsed.command}: ok\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  code => {
    process.exitCode = code;
  },
  error => {
    // An unexpected rejection is never swallowed: it is printed and the command exits 1.
    process.stderr.write(`[status-db] ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);
