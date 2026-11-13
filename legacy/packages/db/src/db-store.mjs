// The DB store (docs/spec/fsm.md, B-2; docs/plans/fsm-v1/plan.md, C-6): the definitions and the lock in the six tables of
// schema/fsm.dbs, through the orm client. dbStore(db) converts between those rows and the objects of the core and writes
// them in one transaction. It does not validate: the core does (run and copy). Its load returns the same objects as the
// file stores, so every command gives the same result on every store.

import { Edge, Event, LockCode, LockReserved, Machine, State } from './models/models.ts';

const byPosition = (a, b) => a.position - b.position;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The rows of a model query, as plain objects keyed by column name. */
async function rowsOf(model) {
  return (await model.gets()).toArray();
}

/** Deletes every row of the model inside the active transaction. */
async function deleteAll(model) {
  await (await model.gets()).delete();
}

/**
 * The DB store of the orm connection `db`: { load() -> Promise<{ definitions, lock, baseline, findings }>, save({ definitions, lock })
 * -> Promise }. save replaces every row inside one transaction, so a failed write leaves the rows that were there.
 */
export function dbStore(db) {
  async function load() {
    const machineRows = await rowsOf(new Machine().connect(db));
    const stateRows = await rowsOf(new State().connect(db));
    const eventRows = await rowsOf(new Event().connect(db));
    const edgeRows = await rowsOf(new Edge().connect(db));
    const codeRows = await rowsOf(new LockCode().connect(db));
    const reservedRows = await rowsOf(new LockReserved().connect(db));

    const definitions = machineRows.map(row => row.name).sort(byText).map(machine => ({
      machine,
      states: stateRows.filter(row => row.machine === machine).sort(byPosition).map(row => {
        const state = { key: row.key, code: row.code };
        if (row.initial) state.initial = true;
        if (row.final) state.final = true;
        return state;
      }),
      events: eventRows.filter(row => row.machine === machine).sort(byPosition).map(event => ({
        key: event.key,
        edges: edgeRows
          .filter(row => row.machine === machine && row.event === event.key)
          .sort(byPosition)
          .map(row => ({ from: row.from, to: row.to })),
      })),
    }));

    const lock = {};
    const entryOf = machine => {
      lock[machine] ??= { codes: {}, reserved: [] };
      return lock[machine];
    };
    for (const row of codeRows) entryOf(row.machine).codes[row.code] = row.key;
    for (const row of reservedRows) entryOf(row.machine).reserved.push(row.code);
    for (const machine of Object.keys(lock)) lock[machine].reserved.sort((a, b) => a - b);

    // The rows that load reads are the committed state of the database: the baseline of the lock rules (B-3).
    return { definitions, lock, baseline: structuredClone(lock), findings: [] };
  }

  async function save({ definitions, lock }) {
    await db.transaction(async () => {
      // Child tables first, so no foreign key refers to a row that is gone.
      await deleteAll(new Edge());
      await deleteAll(new Event());
      await deleteAll(new State());
      await deleteAll(new Machine());
      await deleteAll(new LockCode());
      await deleteAll(new LockReserved());
      // Parent rows first, so every foreign key refers to a row that exists.
      for (const { machine, states, events } of definitions) {
        await new Machine().setName(machine).create();
        for (const [position, state] of states.entries()) {
          await new State().setMachine(machine).setKey(state.key).setCode(state.code).setPosition(position)
            .setInitial(state.initial === true).setFinal(state.final === true).create();
        }
        for (const [position, event] of events.entries()) {
          await new Event().setMachine(machine).setKey(event.key).setPosition(position).create();
        }
        for (const event of events) {
          for (const [edgePosition, edge] of event.edges.entries()) {
            await new Edge().setMachine(machine).setEvent(event.key).setFrom(edge.from).setTo(edge.to)
              .setPosition(edgePosition).create();
          }
        }
      }
      for (const [machine, entry] of Object.entries(lock)) {
        for (const [code, key] of Object.entries(entry.codes)) {
          await new LockCode().setMachine(machine).setCode(Number(code)).setKey(key).create();
        }
        for (const code of entry.reserved) {
          await new LockReserved().setMachine(machine).setCode(code).create();
        }
      }
    });
  }

  return { load, save };
}
