// The database of the tests that run on every dialect the documents name (docs/plans/fsm-v1.md, C-6). FSM_TEST_DIALECT names
// the dialect: sqlite (the default, a new file of the caller's temporary directory), postgres or mysql. A server dialect takes its
// DSN from FSM_TEST_PG_DSN or FSM_TEST_MYSQL_DSN, and a missing DSN throws: the tests never skip a dialect.
import { Edge, Event, LockCode, LockReserved, Machine, SCHEMA, State, connect } from '../src/models/models.ts';

export const DIALECTS = ['sqlite', 'postgres', 'mysql'];

/** The dialect that FSM_TEST_DIALECT names; sqlite when it is unset. Another value throws. */
export function dialectOf(env = process.env) {
  const name = env.FSM_TEST_DIALECT ?? 'sqlite';
  if (!DIALECTS.includes(name)) throw new Error(`FSM_TEST_DIALECT must be one of ${DIALECTS.join(', ')}; it is ${name}`);
  return name;
}

/** The DSN of a server dialect. A missing or empty variable throws: the dialect is run or the run fails. */
export function serverDsn(dialect, env = process.env) {
  const variable = dialect === 'postgres' ? 'FSM_TEST_PG_DSN' : 'FSM_TEST_MYSQL_DSN';
  const dsn = env[variable];
  if (!dsn) throw new Error(`${variable} is not set: the ${dialect} tests need a database DSN and never skip (docs/plans/fsm-v1.md, C-6)`);
  return dsn;
}

/**
 * Opens the database of the dialect with the schema of schema/fsm.dbs installed and no fsm row. A SQLite database is the file
 * `sqliteFile`, which the caller makes new; a server database is the one of its DSN, and its six tables are cleared (child tables
 * first). install changes nothing on a database that holds the schema already, so the server database may hold other tables.
 */
export async function openDialectDb(sqliteFile, env = process.env) {
  const dialect = dialectOf(env);
  const db = await connect(dialect === 'sqlite' ? `sqlite://${sqliteFile}` : serverDsn(dialect, env));
  await db.utils().schema().install(SCHEMA);
  if (dialect !== 'sqlite') {
    for (const model of [Edge, Event, State, Machine, LockCode, LockReserved]) await (await new model().connect(db).gets()).delete();
  }
  return db;
}
