"""The B-4 persistence pattern (docs/spec/fsm.md, B-4) with polyspec orm on SQLite (docs/plans/fsm-v1.md, C-2).

A row keeps the status code. A transition runs in one transaction: the row is read under its lock (for_update), the event is
applied to the state that the caller observed, and the row is updated only when the state changed. The caller passes the same
observed state on a retry, so a retry is Unchanged and a stale request is E_CONFLICT. The model is generated from the root
schema/persist.dbs into ./model.
"""

from model.models import SCHEMA, Item, connect


def open_database(dsn):
    """Opens the SQLite database of `dsn` (sqlite:///<absolute path>) and creates the persist tables in it."""
    db = connect(dsn)
    db.utils().schema().install(SCHEMA)
    return db


def seed(db, row_id, code):
    """Stores the status code `code` as the row `row_id`."""
    Item().connect(db).set_id(row_id).set_status(code).create()


def status_of(db, row_id):
    """The status code stored in the row `row_id`."""
    return Item().connect(db).id(row_id).get().get_status()


def transition(db, machine, row_id, expected, event):
    """One attempt of the transition `event` from the observed state `expected` on the row `row_id`.

    `machine` is the generated module of the machine (src/polyspec_fsm/<machine>.py). It returns the Step of apply. An error
    of apply (E_CONFLICT, E_INVALID_TRANSITION or E_UNKNOWN_CODE) is raised, and the transaction rolls back, so the stored state
    stays as it was.
    """

    def attempt():
        row = Item().connect(db).id(row_id).for_update().get()
        step = machine.apply(expected, event, machine.from_code(row.get_status()))
        if step.changed:
            row.set_status(machine.code(step.to)).update()
        return step

    return db.transaction(attempt)
