"""The common suite of the legacy tests, contracts/conformance/vectors.json, with its expectations on the Python binding of fsm.

Plan f6, step 7a-1 (docs/plans/fsm-v1/checklist.md, S-463): the checks of legacy/packages/python/tests/test_conformance.py on
the class polyspec.fsm.Machine of the binding. Each machine is Machine.parse of its file and the reserved codes of its lock
entry. A state and an event are their keys; a raw code of a vector goes through key first, as the legacy test sends it through
from_code. An error is compared by its kind, the one that the mapping table contracts/conformance/changes.json gives for the vector
(docs/spec/fsm.md, FSM-B7-6), and by the properties expected, actual and event of the error class machine_error (FSM-B7-5;
None where the field does not apply). The persist vectors are the cases of step 7p, which binds the store.
"""

import json
import pathlib
import unittest

from polyspec.fsm import Machine

INT_MAX = 2**53 - 1
"""The largest integer of the contract int: the same value in every target (docs/spec/fsm.md, B-7)."""

PREDICATES = {
    "input_not_int": lambda case: (
        "input_type" in case or abs(int(case["input"])) > INT_MAX
    ),
}
"""The predicates of the rows of contracts/conformance/changes.json, by name."""


def root() -> pathlib.Path:
    """The repository: the nearest parent folder of this file that holds contracts/conformance/vectors.json."""
    for directory in pathlib.Path(__file__).resolve().parents:
        if (directory / "contracts/conformance/vectors.json").is_file():
            return directory
    raise AssertionError(
        "no parent folder of the test holds contracts/conformance/vectors.json"
    )


def input_of(case: dict) -> object:
    """The input of a from_code vector as the legacy test passes it: the text of a string input, else the JSON value of the text.

    The vectors give an int, a float or a bool as its JSON text, so its JSON value is the int, the float or the bool that the
    legacy test decodes (legacy/packages/python/tests/test_conformance.py, input_of).
    """
    kind = case.get("input_type")
    if kind not in (None, "float", "string", "bool"):
        raise AssertionError(f"the input type {kind!r} of {case['id']} is not known")
    return case["input"] if kind == "string" else json.loads(case["input"])


def state(machine: Machine, case: dict, key: str, value: str) -> str:
    """The state argument of a vector: the key of its raw code when the vector gives one, its key otherwise."""
    return machine.key(case[value]) if value in case else case[key]


def kind_of(rows: list[dict], case: dict) -> str:
    """The kind of the binding in the place of the error of case: the first row of the mapping table that applies."""
    for row in rows:
        source = row["from"]
        if source["error"] == case["expect"]["error"] and (
            "when" not in source or PREDICATES[source["when"]](case)
        ):
            return row["to"]["kind"]
    raise AssertionError(
        f"no row of contracts/conformance/changes.json maps {case['expect']['error']} of {case['id']}"
    )


ROWS = json.loads(
    (root() / "contracts/conformance/changes.json").read_text(encoding="utf-8")
)["rows"]


class ConformanceTest(unittest.TestCase):
    """One test per vector of every machine but the persist vectors; the methods are set below."""

    def assert_error(self, case: dict, call) -> None:
        """Asserts that call raises an error with the kind that the mapping table gives for case and its expected fields."""
        expect = case["expect"]
        try:
            call()
        except Exception as error:  # noqa: BLE001 - every error of the call is compared by its kind and fields
            self.assertEqual(
                {
                    "kind": kind_of(ROWS, case),
                    "expected": expect["expected"],
                    "actual": expect["actual"],
                    "event": expect["event"],
                },
                {
                    "kind": getattr(error, "kind", type(error).__name__),
                    "expected": getattr(error, "expected", None),
                    "actual": getattr(error, "actual", None),
                    "event": getattr(error, "event", None),
                },
            )
            return
        self.fail(f"expected {expect['error']}, but nothing was raised")

    def check(self, machine: Machine, case: dict) -> None:
        """Runs one vector on machine."""
        expect = case["expect"]
        fails = isinstance(expect, dict) and "error" in expect

        def run(call, compare) -> None:
            if fails:
                self.assert_error(case, call)
            else:
                compare(call())

        feature = case["feature"]
        if feature == "initial":
            self.assertEqual(expect["state"], machine.initial())
        elif feature == "code":
            run(
                lambda: machine.code(state(machine, case, "state", "value")),
                lambda value: self.assertEqual(expect, value),
            )
        elif feature == "key":
            run(
                lambda: machine.key(case["code"]),
                lambda value: self.assertEqual(expect, value),
            )
        elif feature == "from_code":
            run(
                lambda: machine.from_code(input_of(case)),
                lambda value: self.assertEqual(expect["state"], value),
            )
        elif feature == "is_final":
            run(
                lambda: machine.is_final(state(machine, case, "state", "value")),
                lambda value: self.assertEqual(expect, value),
            )
        elif feature == "events_from":
            self.assertEqual(expect, machine.events_from(case["state"]))
        elif feature == "target":
            run(
                lambda: machine.target(case["state"], case["event"]),
                lambda value: self.assertEqual(expect["state"], value),
            )
        elif feature == "apply":
            run(
                lambda: machine.apply(
                    state(machine, case, "expected", "expected_value"),
                    case["event"],
                    state(machine, case, "actual", "actual_value"),
                ),
                lambda step: self.assertEqual(
                    {"to": expect["to"], "changed": expect["changed"]},
                    {"to": step.to, "changed": step.changed},
                ),
            )
        else:
            raise AssertionError(
                f"no check for the feature {feature}; the vectors and this file must agree"
            )


def vectors() -> list[tuple[str, str, list[int], dict]]:
    """The name, the machine file, the reserved codes and the vector of every vector but the persist vectors."""
    contracts = root() / "contracts"
    lock = json.loads((contracts / "fsm.lock.json").read_text(encoding="utf-8"))
    found = []
    for entry in json.loads(
        (contracts / "conformance/vectors.json").read_text(encoding="utf-8")
    )["machines"]:
        definition = (
            contracts / "machines" / f"{entry['machine']}.fsm.json"
        ).read_text(encoding="utf-8")
        for case in entry["cases"]:
            if case["feature"] != "persist":
                found.append(
                    (case["name"], definition, lock[entry["machine"]]["reserved"], case)
                )
    return found


def method(definition: str, reserved: list[int], case: dict):
    """The test method of one vector."""

    def test(self: ConformanceTest) -> None:
        self.check(Machine.parse(definition, reserved), case)

    return test


VECTORS = vectors()
assert VECTORS, "the vectors hold cases"
for name, definition, reserved, case in VECTORS:
    setattr(ConformanceTest, f"test_{name}", method(definition, reserved, case))


if __name__ == "__main__":
    unittest.main()
