"""The conformance tests of the python package (docs/plans/fsm-v1.md, C-4).

Every vector case of tests/vectors.py (generated from the core oracle) is one unittest method named test_<feature>__<id>. It calls
the generated function of src/polyspec_fsm and asserts the expected value or the error code. The persist cases run the B-4
example (examples/persist.py) on SQLite and assert the stored value after the run. The names follow docs/spec/fsm.md, B-6: a key
becomes a member in upper case, so the state DRAFT of the key draft.
"""

import sys
import tempfile
import unittest
from pathlib import Path

# No bytecode: a __pycache__ written into src/ is a file without the generated header, which make gen refuses.
sys.dont_write_bytecode = True
PACKAGE = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(PACKAGE / "src"), str(PACKAGE / "examples")]

import polyspec_fsm  # noqa: E402
from persist import open_database, seed, status_of, transition  # noqa: E402
from polyspec_fsm.fsm import Error  # noqa: E402
from vectors import vectors  # noqa: E402


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
    """The state argument of a case: its integer when the case gives one (an invalid state value), its member otherwise."""
    if value_field in case:
        return case[value_field]
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
            assert_error(test, lambda: machine.code(state_arg(machine, case, "state", "value")), expect)
        else:
            test.assertEqual(machine.code(state_of(machine, case["state"])), expect)
    elif feature == "key":
        if failed(expect):
            assert_error(test, lambda: machine.key(case["code"]), expect)
        else:
            test.assertEqual(machine.key(case["code"]), expect)
    elif feature == "from_code":
        if failed(expect):
            assert_error(test, lambda: machine.from_code(case["input"]), expect)
        else:
            test.assertEqual(machine.from_code(case["input"]), state_of(machine, expect["state"]))
    elif feature == "is_final":
        if failed(expect):
            assert_error(test, lambda: machine.is_final(state_arg(machine, case, "state", "value")), expect)
        else:
            test.assertEqual(machine.is_final(state_of(machine, case["state"])), expect)
    elif feature == "events_from":
        test.assertEqual(machine.events_from(state_of(machine, case["state"])), [event_of(machine, key) for key in expect])
    elif feature == "target":
        state = state_of(machine, case["state"])
        event = event_of(machine, case["event"])
        if failed(expect):
            assert_error(test, lambda: machine.target(state, event), expect)
        else:
            test.assertEqual(machine.target(state, event), state_of(machine, expect["state"]))
    elif feature == "apply":
        expected = state_arg(machine, case, "expected", "expected_value")
        event = event_of(machine, case["event"])
        actual = state_arg(machine, case, "actual", "actual_value")
        if failed(expect):
            assert_error(test, lambda: machine.apply(expected, event, actual), expect)
        else:
            step = machine.apply(expected, event, actual)
            test.assertEqual(step, machine.Step(to=state_of(machine, expect["to"]), changed=expect["changed"]))
    else:
        raise AssertionError(f"no check for the feature {feature}; the vectors and this file must agree")


def persist_case(test, machine, case):
    """Runs the persist case `case` on a new SQLite database, and asserts the stored state after the run."""
    expect = case["expect"]
    with tempfile.TemporaryDirectory(prefix="fsm-python-persist-") as directory:
        db = open_database(f"sqlite:///{directory}/persist.db")
        try:
            seed(db, 1, machine.code(state_of(machine, case["stored"])))
            expected = state_of(machine, case["expected"])
            event = event_of(machine, case["event"])
            if failed(expect):
                assert_error(test, lambda: transition(db, machine, 1, expected, event), expect)
            else:
                step = transition(db, machine, 1, expected, event)
                test.assertEqual(step, machine.Step(to=state_of(machine, expect["stored_after"]), changed=expect["changed"]))
            test.assertEqual(status_of(db, 1), machine.code(state_of(machine, expect["stored_after"])), "the stored state after the run")
        finally:
            db.close()


class ConformanceTest(unittest.TestCase):
    """One method per vector case is added below: test_<feature>__<id>."""


def _case_test(machine_name, case):
    """The test method of one case: it finds the machine module and runs the case on it."""

    def test(self):
        machine = getattr(polyspec_fsm, machine_name, None)
        self.assertIsNotNone(machine, f"polyspec_fsm does not export the machine {machine_name}")
        if case["feature"] == "persist":
            persist_case(self, machine, case)
        else:
            check(self, machine, case)

    return test


for entry in vectors:
    for case in entry["cases"]:
        setattr(ConformanceTest, f"test_{case['feature']}__{case['id']}", _case_test(entry["machine"], case))


if __name__ == "__main__":
    unittest.main()
