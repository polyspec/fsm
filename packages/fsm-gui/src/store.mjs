// The store of a project for the GUI (docs/spec/fsm.md, B-2; docs/plans/fsm-v1.md, C-7): the store that the project's
// fsm.config.json names. The GUI owns no rule, so it only selects the store, and every command goes through core run.
// openStore returns { store, close } or { findings } with the reason in the same finding shape as the core (E_STORE_NOT_
// CONFIGURED), and it never falls back to another store. The db store is imported only when it is selected, because its
// orm package is installed with packages/fsm-db.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { jsonStore } from '../../fsm-compiler/src/store-json/store.mjs';
import { mermaidStore } from '../../fsm-compiler/src/store-mermaid/store.mjs';

const notConfigured = (at, message) => ({ code: 'E_STORE_NOT_CONFIGURED', machine: null, path: at, message });
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The store of the project directory `project`, selected by its fsm.config.json. `env` is the environment of the process,
 * which holds the DSN of the db store under the name that fsm.config.json gives in dsnEnv.
 */
export async function openStore(project, env) {
  const file = path.join(project, 'fsm.config.json');
  if (!existsSync(file)) return { findings: [notConfigured('$', `fsm.config.json is missing in ${project}`)] };
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { findings: [notConfigured('$', `fsm.config.json is not valid JSON: ${error.message}`)] };
  }
  if (!isObject(config)) return { findings: [notConfigured('$', 'fsm.config.json must be an object')] };
  if (config.store === 'json') return { store: jsonStore(project), close: async () => {} };
  if (config.store === 'mermaid') return { store: mermaidStore(project), close: async () => {} };
  if (config.store !== 'db') {
    return { findings: [notConfigured('$.store', `the configured store is ${JSON.stringify(config.store)}; the GUI handles json, mermaid and db`)] };
  }
  if (typeof config.dsnEnv !== 'string' || config.dsnEnv === '') {
    return { findings: [notConfigured('$.dsnEnv', 'fsm.config.json must name the environment variable of the DSN in dsnEnv')] };
  }
  const dsn = env[config.dsnEnv];
  if (dsn === undefined || dsn === '') {
    return { findings: [notConfigured('$.dsnEnv', `the environment variable ${config.dsnEnv} is not set`)] };
  }
  const { connect } = await import('../../fsm-db/src/models/models.ts');
  const { dbStore } = await import('../../fsm-db/src/db-store.mjs');
  const db = await connect(dsn);
  return { store: dbStore(db), close: async () => db.close() };
}
