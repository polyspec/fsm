// The database of the tests that run on every dialect the documents name (docs/plans/fsm-v1/plan.md, C-6). FSM_TEST_DIALECT names
// the dialect: sqlite (the default, a new file of the caller's temporary directory), postgres or mysql. A server dialect takes its
// DSN from FSM_TEST_PG_DSN or FSM_TEST_MYSQL_DSN, and a missing DSN throws: the tests never skip a dialect. A test that needs a
// database with no table takes one from emptyDatabase, which creates it through the admin DSN of the dialect (S-37-2).
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import mysql from 'mysql2/promise';
import { Edge, Event, LockCode, LockReserved, Machine, SCHEMA, State, connect } from '../src/models/models.ts';

const DIALECTS = ['sqlite', 'postgres', 'mysql'];

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
  if (!dsn) throw new Error(`${variable} is not set: the ${dialect} tests need a database DSN and never skip (docs/plans/fsm-v1/plan.md, C-6)`);
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

/** The admin DSN of a server dialect: a user that creates and drops databases (FSM_TEST_PG_ADMIN_DSN, FSM_TEST_MYSQL_ADMIN_DSN). */
function adminDsnOf(dialect, env = process.env) {
  const variable = dialect === 'postgres' ? 'FSM_TEST_PG_ADMIN_DSN' : 'FSM_TEST_MYSQL_ADMIN_DSN';
  const dsn = env[variable];
  if (!dsn) throw new Error(`${variable} is not set: the ${dialect} CLI tests create their databases through it and never skip`);
  return dsn;
}

const SIMPLE_NAME = /^[A-Za-z0-9_.%-]+$/;

/**
 * A new database with no table on the server of `dialect`, named fsm_test_<pid>_<time>_<random>. The admin DSN creates it (PostgreSQL:
 * owned by the user of the dialect's DSN; MySQL: every privilege on it for each account of that user). The returned DSN is the
 * dialect's DSN with this database in its path. `drop` removes the database again, with its name and no other.
 */
async function createEmptyDatabase(dialect, env = process.env) {
  const base = new URL(serverDsn(dialect, env));
  const admin = adminDsnOf(dialect, env);
  const name = `fsm_test_${process.pid}_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  const user = decodeURIComponent(base.username);
  if (!SIMPLE_NAME.test(user)) throw new Error(`the user of the ${dialect} DSN must be a plain name to be granted; it is ${user}`);
  base.pathname = `/${name}`;
  if (dialect === 'postgres') {
    await withPg(admin, client => client.query(`CREATE DATABASE "${name}" OWNER "${user}"`));
  } else {
    await withMysql(admin, async conn => {
      await conn.query(`CREATE DATABASE \`${name}\``);
      const [accounts] = await conn.query('SELECT host FROM mysql.user WHERE user = ?', [user]);
      if (accounts.length === 0) throw new Error(`the MySQL server has no account named ${user}, so the new database cannot be granted`);
      for (const { host } of accounts) {
        if (!SIMPLE_NAME.test(host)) throw new Error(`the host of the account ${user} is not a plain name: ${host}`);
        await conn.query(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO '${user}'@'${host}'`);
      }
    });
  }
  const drop = async () => {
    if (dialect === 'postgres') {
      await withPg(admin, client => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    } else {
      await withMysql(admin, conn => conn.query(`DROP DATABASE IF EXISTS \`${name}\``));
    }
  };
  return { dsn: base.toString(), name, drop };
}

/**
 * A database for one test that needs no table: a new SQLite file in `dir` (the caller removes the directory), or a new database of
 * the server dialect that FSM_TEST_DIALECT names (createEmptyDatabase). `drop` is a no-op for SQLite.
 */
export async function emptyDatabase(dir, env = process.env) {
  const dialect = dialectOf(env);
  if (dialect === 'sqlite') return { dsn: `sqlite://${dir}/fsm.sqlite`, drop: async () => {} };
  return createEmptyDatabase(dialect, env);
}

/**
 * Runs one statement on the database of `dsn` through its own driver, outside the orm client: a sqlite://, postgres:// or mysql://
 * DSN. The CLI tests use it for the one statement that orm does not give (DROP TABLE of a partial schema).
 */
export async function runStatement(dsn, sql) {
  if (dsn.startsWith('sqlite://')) {
    const db = new DatabaseSync(dsn.slice('sqlite://'.length));
    try {
      db.exec(sql);
    } finally {
      db.close();
    }
  } else if (dsn.startsWith('postgres://')) {
    await withPg(dsn, client => client.query(sql));
  } else if (dsn.startsWith('mysql://')) {
    await withMysql(dsn, conn => conn.query(sql));
  } else {
    throw new Error(`runStatement: no driver for the DSN ${dsn.split('://')[0]}://`);
  }
}

/** Runs `fn` with a connected pg client of the DSN and ends the connection. */
async function withPg(dsn, fn) {
  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Runs `fn` with a connected mysql2 connection of the DSN and ends the connection. */
async function withMysql(dsn, fn) {
  const conn = await mysql.createConnection({ uri: dsn });
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}
