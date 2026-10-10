// The B-4 persistence pattern (docs/spec/status.md, B-4) with polyspec orm on SQLite (docs/plans/status-v1.md, C-2). A row
// keeps the status code. A transition runs in one transaction: the row is read under its lock (forUpdate), the event is
// applied to the state that the caller observed, and the row is updated only when the state changed. The caller passes the
// same observed state on a retry, so a retry is Unchanged and a stale request is E_CONFLICT. The model is generated from the
// root schema/persist.dbs into ./model.
import { Item, SCHEMA, connect } from './model/models.ts';

/** Opens the SQLite database of `dsn` (sqlite://<path>) and creates the persist tables in it. */
export async function open(dsn) {
  const db = await connect(dsn);
  await db.utils().schema().install(SCHEMA);
  return db;
}

/** Stores the status code `code` as the row `id`. */
export async function seed(db, id, code) {
  await new Item().connect(db).setId(id).setStatus(code).create();
}

/** The status code stored in the row `id`. */
export async function statusOf(db, id) {
  return (await new Item().connect(db).id(id).get()).getStatus();
}

/**
 * One attempt of the transition `event` from the observed state `expected` on the row `id`, with the generated functions of
 * `machine` (src/<machine>.js). It returns the Step of apply. An error of apply (E_CONFLICT, E_INVALID_TRANSITION or
 * E_UNKNOWN_CODE) is thrown, and the transaction rolls back, so the stored state stays as it was.
 */
export async function transition(db, machine, id, expected, event) {
  return db.transaction(async () => {
    const row = await new Item().connect(db).id(id).forUpdate().get();
    const step = machine.apply(expected, event, machine.fromCode(row.getStatus()));
    if (step.changed) await row.setStatus(machine.code(step.to)).update();
    return step;
  });
}
