"""The persistence tests of the python package beyond the vector cases (docs/spec/fsm.md, B-4).

Two transitions of one row that run at the same time, each in its own thread on its own connection, give the outcome that the
pattern promises, and a deadlock runs the transaction again while another database error does not. Each method is named by its
feature unit of config/parity.json. They run on the dialect of FSM_TEST_DIALECT (open_persist_database of test_conformance).
"""

import tempfile
import threading
import types
import unittest

import test_conformance as conformance
from polyspec_fsm_examples.persist import open_database, seed, status_of, transition
from polyspec.orm import OrmError
from polyspec_fsm import order
from polyspec_fsm.fsm import Code, Error


def faulty(fault):
    """The order machine whose apply runs `fault` before it applies the event, once per attempt of the transaction."""

    def apply(*args):
        fault()
        return order.apply(*args)

    return types.SimpleNamespace(
        apply=apply, from_code=order.from_code, code=order.code
    )


class PersistTest(unittest.TestCase):
    """The concurrency and retry promises of the persistence pattern."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="fsm-python-persist-")
        self.addCleanup(directory.cleanup)
        self.dsn, _ = conformance.persist_dsn(directory.name)
        self.first = conformance.open_persist_database(directory.name)
        self.addCleanup(self.first.close)
        seed(self.first, 1, order.code(order.State.DRAFT))

    def together(self, events):
        """Runs one transition from DRAFT per event at the same time, each in its own thread on its own connection, which the
        thread opens (a SQLite connection serves only the thread that made it); returns the Step or the error of each."""
        outcomes = [None] * len(events)

        def run(index, event):
            db = open_database(self.dsn)
            try:
                outcomes[index] = transition(db, order, 1, order.State.DRAFT, event)
            except Exception as error:  # noqa: BLE001 - the outcome of the run, asserted by the caller
                outcomes[index] = error
            finally:
                db.close()

        threads = [
            threading.Thread(target=run, args=(index, event))
            for index, event in enumerate(events)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        return outcomes

    def test_persist_concurrent_same_event(self):
        outcomes = self.together([order.Event.NEXT, order.Event.NEXT])
        for outcome in outcomes:
            self.assertIsInstance(
                outcome, order.Step, f"both transitions succeed: {outcomes}"
            )
            self.assertEqual(outcome.to, order.State.PAID)
        self.assertEqual(sorted(outcome.changed for outcome in outcomes), [False, True])
        self.assertEqual(status_of(self.first, 1), order.code(order.State.PAID))

    def test_persist_concurrent_conflict(self):
        outcomes = self.together([order.Event.NEXT, order.Event.CANCEL])
        changed = [outcome for outcome in outcomes if isinstance(outcome, order.Step)]
        failed = [
            outcome for outcome in outcomes if not isinstance(outcome, order.Step)
        ]
        self.assertEqual(len(changed), 1, f"one transition changes the row: {outcomes}")
        self.assertTrue(changed[0].changed)
        self.assertEqual(len(failed), 1, "the other transition fails")
        self.assertIsInstance(failed[0], Error)
        self.assertEqual(failed[0].code, Code.CONFLICT)
        self.assertEqual(status_of(self.first, 1), order.code(changed[0].to))

    def test_persist_retry_on_deadlock(self):
        attempts = []

        def fault():
            attempts.append(1)
            if len(attempts) == 1:
                raise OrmError("DEADLOCK", "injected deadlock")

        step = transition(
            self.first, faulty(fault), 1, order.State.DRAFT, order.Event.NEXT
        )
        self.assertEqual(
            len(attempts), 2, "the transaction runs again after a deadlock"
        )
        self.assertEqual(step, order.Step(to=order.State.PAID, changed=True))
        self.assertEqual(status_of(self.first, 1), order.code(order.State.PAID))

    def test_persist_no_retry_on_other_error(self):
        attempts = []

        def fault():
            attempts.append(1)
            raise OrmError("CONNECTION_LOST", "injected")

        with self.assertRaises(OrmError) as raised:
            transition(
                self.first, faulty(fault), 1, order.State.DRAFT, order.Event.NEXT
            )
        self.assertEqual(raised.exception.code, "CONNECTION_LOST")
        self.assertEqual(
            len(attempts), 1, "a database error other than a deadlock is not run again"
        )
        self.assertEqual(status_of(self.first, 1), order.code(order.State.DRAFT))


if __name__ == "__main__":
    unittest.main()
