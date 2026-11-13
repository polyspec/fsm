"""The conformance tests of the python package (docs/plans/fsm-v1/plan.md, C-4).

Every vector case of contracts/conformance/vectors.json (written from the core oracle), read when the test runs, is one unittest
method named test_<feature>__<id>. It calls
the generated function of src/polyspec_fsm and asserts the expected value or the error code. The persist cases run the B-4
example (examples/persist.py) on the dialect of FSM_TEST_DIALECT (sqlite by default; docs/plans/fsm-v1/plan.md, C-6) and assert the
stored value after the run. The names follow docs/spec/fsm.md, B-6: a key becomes a member in upper case, so the state DRAFT of the
key draft.
"""

import json
import os
import tempfile
import unittest
from pathlib import Path

import polyspec_fsm
from polyspec_fsm_examples.persist import (
    clear,
    open_database,
    seed,
    status_of,
    transition,
)
from polyspec_fsm.fsm import Error


def vectors_file():
    """The vector file of the oracle: contracts/conformance/vectors.json, found in the nearest parent folder that holds it."""
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "contracts" / "conformance" / "vectors.json"
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        "no parent folder of the test holds contracts/conformance/vectors.json"
    )


with open(vectors_file(), encoding="utf-8") as handle:
    vectors = json.load(handle)["machines"]


def input_of(case):
    """The input of a from_code case as the python kind decodes it (docs/spec/fsm.md, B-6).

    The oracle gives it as a decimal string: an int, or a float, a string or a bool by the input_type of the case.
    """
    text = case["input"]
    kind = case.get("input_type")
    if kind is None:
        return int(text)
    if kind == "float":
        return float(text)
    if kind == "string":
        return text
    if kind == "bool":
        return text == "true"
    raise AssertionError(f"the input type {kind!r} of {case['id']} is not known")


def member(key):
    """The member of a key: its upper notation (docs/spec/fsm.md, B-6)."""
    return key.upper()


def state_of(machine, key):
    """The state member of a key of the machine module `machine`."""
    return getattr(machine.State, member(key))


def event_of(machine, key):
    """The event member of a key of the machine module `machine`."""
    return getattr(machine.Event, member(key))


def failed(expect):
    """Whether an expectation is an error: a dict with an error code; every other expectation is a plain value."""
    return isinstance(expect, dict) and "error" in expect


def state_arg(machine, case, key_field, value_field):
    """The state argument of a case: a raw code goes through from_code first (docs/spec/fsm.md, B-6), its member otherwise."""
    if value_field in case:
        return machine.from_code(case[value_field])
    return state_of(machine, case[key_field])


def assert_error(test, call, expect):
    """Asserts that `call` raises an Error with the code and the fields of `expect` (null where the field does not apply, B-6)."""
    with test.assertRaises(Error) as raised:
        call()
    error = raised.exception
    test.assertEqual(
        (error.code, error.expected, error.actual, error.event),
        (expect["error"], expect["expected"], expect["actual"], expect["event"]),
    )


def check(test, machine, case):
    """Runs the case `case` of the machine module `machine`, which is the generated module of the machine."""
    feature = case["feature"]
    expect = case["expect"]
    if feature == "initial":
        test.assertEqual(machine.initial(), state_of(machine, expect["state"]))
    elif feature == "code":
        if failed(expect):
            assert_error(
                test,
                lambda: machine.code(state_arg(machine, case, "state", "value")),
                expect,
            )
        else:
            test.assertEqual(machine.code(state_of(machine, case["state"])), expect)
    elif feature == "key":
        if failed(expect):
            assert_error(
                test, lambda: machine.key(machine.from_code(case["code"])), expect
            )
        else:
            test.assertEqual(machine.key(machine.from_code(case["code"])), expect)
    elif feature == "from_code":
        if failed(expect):
            assert_error(test, lambda: machine.from_code(input_of(case)), expect)
        else:
            test.assertEqual(
                machine.from_code(input_of(case)), state_of(machine, expect["state"])
            )
    elif feature == "is_final":
        if failed(expect):
            assert_error(
                test,
                lambda: machine.is_final(state_arg(machine, case, "state", "value")),
                expect,
            )
        else:
            test.assertEqual(machine.is_final(state_of(machine, case["state"])), expect)
    elif feature == "events_from":
        test.assertEqual(
            machine.events_from(state_of(machine, case["state"])),
            [event_of(machine, key) for key in expect],
        )
    elif feature == "target":
        state = state_of(machine, case["state"])
        event = event_of(machine, case["event"])
        if failed(expect):
            assert_error(test, lambda: machine.target(state, event), expect)
        else:
            test.assertEqual(
                machine.target(state, event), state_of(machine, expect["state"])
            )
    elif feature == "apply":
        event = event_of(machine, case["event"])

        def call():
            expected = state_arg(machine, case, "expected", "expected_value")
            actual = state_arg(machine, case, "actual", "actual_value")
            return machine.apply(expected, event, actual)

        if failed(expect):
            assert_error(test, call, expect)
        else:
            step = call()
            test.assertEqual(
                step,
                machine.Step(
                    to=state_of(machine, expect["to"]), changed=expect["changed"]
                ),
            )
    else:
        raise AssertionError(
            f"no check for the feature {feature}; the vectors and this file must agree"
        )


def persist_dsn(directory):
    """The DSN of the dialect that FSM_TEST_DIALECT names (docs/plans/fsm-v1/plan.md, C-6), and the dialect.

    sqlite, the default, is a new file of `directory`; postgres and mysql take their DSN from FSM_TEST_PG_DSN and FSM_TEST_MYSQL_DSN.
    A missing DSN fails the case, so no dialect is skipped.
    """
    dialect = os.environ.get("FSM_TEST_DIALECT") or "sqlite"
    if dialect == "sqlite":
        return f"sqlite:///{directory}/persist.db", dialect
    if dialect in ("postgres", "mysql"):
        variable = "FSM_TEST_PG_DSN" if dialect == "postgres" else "FSM_TEST_MYSQL_DSN"
        dsn = os.environ.get(variable, "")
        if not dsn:
            raise AssertionError(
                f"{variable} is not set: the {dialect} persist cases need a database DSN and never skip"
            )
        return dsn, dialect
    raise AssertionError(
        f"FSM_TEST_DIALECT must be sqlite, postgres or mysql, it is {dialect}"
    )


def open_persist_database(directory):
    """Opens the database of one persist case on the dialect of persist_dsn.

    The rows of the persist table are cleared, so a case reads only its row.
    """
    dsn, dialect = persist_dsn(directory)
    db = open_database(dsn)
    if db.driver != dialect:
        db.close()
        raise AssertionError(f"the database is {db.driver}, want {dialect}")
    if dialect != "sqlite":
        clear(db)
    return db


def persist_case(test, machine, case):
    """Runs the persist case `case` and asserts the stored state after the run."""
    expect = case["expect"]
    with tempfile.TemporaryDirectory(prefix="fsm-python-persist-") as directory:
        db = open_persist_database(directory)
        try:
            seed(db, 1, machine.code(state_of(machine, case["stored"])))
            expected = state_of(machine, case["expected"])
            event = event_of(machine, case["event"])
            if failed(expect):
                assert_error(
                    test, lambda: transition(db, machine, 1, expected, event), expect
                )
            else:
                step = transition(db, machine, 1, expected, event)
                test.assertEqual(
                    step,
                    machine.Step(
                        to=state_of(machine, expect["stored_after"]),
                        changed=expect["changed"],
                    ),
                )
            test.assertEqual(
                status_of(db, 1),
                machine.code(state_of(machine, expect["stored_after"])),
                "the stored state after the run",
            )
        finally:
            db.close()


# FSM-B4-5: every apply case of the vector file gives the result of the B-4 table.
class ConformanceTest(unittest.TestCase):
    """One method per vector case is added below: test_<feature>__<id>."""


def _case_test(machine_name, case):
    """The test method of one case: it finds the machine module and runs the case on it."""

    def test(self):
        machine = getattr(polyspec_fsm, machine_name, None)
        self.assertIsNotNone(
            machine, f"polyspec_fsm does not export the machine {machine_name}"
        )
        if case["feature"] == "persist":
            persist_case(self, machine, case)
        else:
            check(self, machine, case)

    return test


for entry in vectors:
    for case in entry["cases"]:
        setattr(
            ConformanceTest,
            f"test_{case['feature']}__{case['id']}",
            _case_test(entry["machine"], case),
        )


if __name__ == "__main__":
    unittest.main()
