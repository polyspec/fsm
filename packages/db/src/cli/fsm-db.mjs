#!/usr/bin/env node
// The command line of the DB store (docs/plans/fsm-v1/plan.md, C-6; docs/spec/fsm.md, B-2):
//   fsm-db install [--project <dir>]
//   fsm-db check [--project <dir>]
//   fsm-db lock  [--project <dir>] [--rename machine.old=new]...
//   fsm-db copy  --to json|mermaid   --root <dir> [--project <dir>]   (the database is the source)
//   fsm-db copy  --from json|mermaid --root <dir> [--project <dir>]   (the database is the target)
// --project is the project root, whose fsm.config.json must name the db store:
//   {"store":"db","dsnEnv":"FSM_DSN"}
// The DSN is the value of the environment variable that dsnEnv names; it is never read from anywhere else. The database
// schema is the one of packages/db/schema/fsm.dbs. `install` creates it through orm (`utils().schema().install`): on a database
// without the tables it creates them; on a database that already has all of them it changes nothing and exits 0; on a
// database that has only some of them orm rejects it with CONFIG, which is printed with its stack and exits 1 (verified by
// the install cases of tests/cli.test.mjs with orm v0.0.14). A finding prints as
// `[fsm-db] <code> <machine> <path>: <message>` on stderr and exits 1. A usage error exits 2. Otherwise the command exits 0
// with a one-line summary on stdout (`[fsm-db] install: ok` for install). An unexpected rejection (for example a missing
// table, or the CONFIG of a partial install) is printed with its stack and exits 1.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { baseOptions, readFlags, runCommandLine } from '../../../compiler/src/cli/command-line.mjs';
import { copy, run } from '../../../compiler/src/core/run.mjs';
import { jsonStore } from '../../../compiler/src/store-json/store.mjs';
import { mermaidStore } from '../../../compiler/src/store-mermaid/store.mjs';
import { dbStore } from '../db-store.mjs';
import { SCHEMA, connect } from '../models/models.ts';

const USAGE = 'usage: fsm-db check [--project <dir>]\n'
  + '       fsm-db install [--project <dir>]\n'
  + '       fsm-db lock [--project <dir>] [--rename machine.old=new]...\n'
  + '       fsm-db copy --to json|mermaid --root <dir> [--project <dir>]\n'
  + '       fsm-db copy --from json|mermaid --root <dir> [--project <dir>]';

const notConfigured = (at, message) => ({ code: 'E_STORE_NOT_CONFIGURED', machine: null, path: at, message });
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The options of the arguments, or { usage } with the reason when they are not a valid command line. */
function parse(argv) {
  const [command, ...rest] = argv;
  if (!['install', 'check', 'lock', 'copy'].includes(command)) return { usage: `unknown command ${command ?? '(none)'}` };
  const allowed = { install: ['--project'], check: ['--project'], lock: ['--project', '--rename'], copy: ['--project', '--root', '--to', '--from'] }[command];
  const options = { ...baseOptions(command), to: undefined, from: undefined };
  const bad = readFlags(options, command, rest, allowed, (flag, value) => {
    if (!['json', 'mermaid'].includes(value)) return { usage: `${flag} takes json or mermaid` };
    if (options.to !== undefined || options.from !== undefined) return { usage: 'copy takes one of --to and --from' };
    options[flag.slice(2)] = value;
    return undefined;
  });
  if (bad !== undefined) return bad;
  if (command === 'copy' && ((options.to === undefined && options.from === undefined) || options.root === undefined)) {
    return { usage: 'copy needs --to json|mermaid or --from json|mermaid, and --root <dir>' };
  }
  return options;
}

/** The DSN named by fsm.config.json of `project`, or the findings of why the db store cannot be used. */
function configuredDsn(project) {
  const file = path.join(project, 'fsm.config.json');
  if (!existsSync(file)) return { ok: false, findings: [notConfigured('$', `fsm.config.json is missing in ${project}`)] };
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { ok: false, findings: [notConfigured('$', `fsm.config.json is not valid JSON: ${error.message}`)] };
  }
  if (!isObject(config) || config.store !== 'db') {
    return { ok: false, findings: [notConfigured('$.store', `fsm-db handles the db store only; the configured store is ${JSON.stringify(config?.store)}`)] };
  }
  if (typeof config.dsnEnv !== 'string' || config.dsnEnv === '') {
    return { ok: false, findings: [notConfigured('$.dsnEnv', 'fsm.config.json must name the environment variable of the DSN in dsnEnv')] };
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
    if (command === 'install') {
      await db.utils().schema().install(SCHEMA);
      return [];
    }
    const store = dbStore(db);
    if (command === 'copy' && to !== undefined) return (await copy(store, fileStore(to, root))).findings;
    if (command === 'copy') return (await copy(fileStore(from, root), store)).findings;
    return (await run(command, store, { renames })).findings;
  } finally {
    await db.close();
  }
}

runCommandLine('fsm-db', process.argv.slice(2), { usage: USAGE, parse, execute });
