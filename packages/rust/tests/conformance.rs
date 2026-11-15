//! The common suite of the legacy tests, contracts/conformance/vectors.json, on the core, one trial per vector: the contract
//! test of the core beside the conformance tests of the five bindings. Each machine is `Machine::parse` of its file in
//! contracts/machines and the reserved codes of its entry in contracts/fsm.lock.json. A state and an event are their keys; a
//! raw code of a vector goes through `key` first, as the conformance tests of the bindings do. An error is compared by its
//! kind, the one that the mapping table contracts/conformance/changes.json gives for the vector (docs/spec/fsm.md, FSM-B7-6),
//! and by its fields expected, actual and event (FSM-B7-5). A from_code input that is no value of the contract int (the row
//! C-1) has no value of the parameter `i64` of the core: the trial checks that the input converts to no contract int. A persist
//! vector is the step that a store takes with `apply` on its stored state: the state after the step is the target of a
//! successful apply and the stored state after an error.

use std::path::{Path, PathBuf};

mod common;

use libtest_mimic::{Failed, Trial};
use polyspec_fsm::{Error, Machine};
use serde_json::{json, Map, Value};

/// The largest integer of the contract int: the same value in every target (docs/spec/fsm.md, B-7).
const INT_MAX: i64 = (1 << 53) - 1;

/// The folder contracts of the nearest parent folder of the crate that holds contracts/conformance/vectors.json.
fn contracts() -> Result<PathBuf, Failed> {
    let package = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    package
        .ancestors()
        .map(|directory| directory.join("contracts"))
        .find(|candidate| candidate.join("conformance/vectors.json").is_file())
        .ok_or_else(|| Failed::from(format!("no parent folder of {} holds contracts/conformance/vectors.json", package.display())))
}

/// The JSON document of the file `path`.
fn read(path: &Path) -> Result<Value, Failed> {
    let source = std::fs::read_to_string(path).map_err(|error| Failed::from(format!("{}: {error}", path.display())))?;
    serde_json::from_str(&source).map_err(|error| Failed::from(format!("{}: {error}", path.display())))
}

/// The string field `name` of a vector.
fn text<'a>(case: &'a Map<String, Value>, name: &str) -> Result<&'a str, Failed> {
    case.get(name).and_then(Value::as_str).ok_or_else(|| Failed::from(format!("the vector has no text {name}")))
}

/// The integer field `name` of a vector.
fn int(case: &Map<String, Value>, name: &str) -> Result<i64, Failed> {
    case.get(name).and_then(Value::as_i64).ok_or_else(|| Failed::from(format!("the vector has no int {name}")))
}

/// The contract int of a from_code input: none for an input of an input_type and for an integer outside ±INT_MAX.
fn contract_int(case: &Map<String, Value>) -> Result<Option<i64>, Failed> {
    if case.contains_key("input_type") {
        return Ok(None);
    }
    // An integer text that i64 does not hold is outside ±INT_MAX too, so its parse error means no contract int.
    match text(case, "input")?.parse::<i64>() {
        Ok(value) if value.abs() <= INT_MAX => Ok(Some(value)),
        Ok(_) | Err(_) => Ok(None),
    }
}

/// The kind of the core in the place of the legacy error of a vector: the first row of the mapping table that applies.
fn kind_of(rows: &[Value], case: &Map<String, Value>, legacy: &str) -> Result<String, Failed> {
    for row in rows {
        let from = row.get("from").ok_or_else(|| Failed::from("a row of the mapping table has no from"))?;
        if from.get("error").and_then(Value::as_str) != Some(legacy) {
            continue;
        }
        let applies = match from.get("when").and_then(Value::as_str) {
            None => true,
            Some("input_not_int") => case.contains_key("input") && contract_int(case)?.is_none(),
            Some(other) => return Err(Failed::from(format!("the predicate {other} of the mapping table is not known"))),
        };
        if applies {
            return row
                .pointer("/to/kind")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| Failed::from("a row of the mapping table has no to.kind"));
        }
    }
    Err(Failed::from(format!("no row of contracts/conformance/changes.json maps {legacy}")))
}

/// The state argument of a vector: the key of its raw code `value` when the vector gives one, which fails with the error of
/// `key` for a code that is no state, its key `key` otherwise.
fn state(machine: &Machine, case: &Map<String, Value>, key: &str, value: &str) -> Result<Result<String, Error>, Failed> {
    if case.contains_key(value) {
        Ok(machine.key(int(case, value)?))
    } else {
        Ok(Ok(text(case, key)?.to_owned()))
    }
}

/// The result of a vector on the machine, as the JSON value that its expectation compares: the value of a successful call or
/// the error of the core.
fn call(machine: &Machine, case: &Map<String, Value>) -> Result<Result<Value, Error>, Failed> {
    let step = |step: polyspec_fsm::Step| json!({ "to": step.to, "changed": step.changed });
    Ok(match text(case, "feature")? {
        "initial" => Ok(json!({ "state": machine.initial() })),
        "code" => state(machine, case, "state", "value")?.and_then(|state| machine.code(&state)).map(|code| json!(code)),
        "key" => machine.key(int(case, "code")?).map(|key| json!(key)),
        "from_code" => machine.from_code(contract_int(case)?.ok_or_else(|| Failed::from("the input is no contract int"))?).map(|key| json!({ "state": key })),
        "is_final" => state(machine, case, "state", "value")?.and_then(|state| machine.is_final(&state)).map(|flag| json!(flag)),
        "events_from" => machine.events_from(text(case, "state")?).map(|events| json!(events)),
        "target" => machine.target(text(case, "state")?, text(case, "event")?).map(|key| json!({ "state": key })),
        "apply" => {
            let (expected, actual) = (state(machine, case, "expected", "expected_value")?, state(machine, case, "actual", "actual_value")?);
            let event = text(case, "event")?;
            expected.and_then(|expected| actual.and_then(|actual| machine.apply(&expected, event, &actual))).map(step)
        }
        "persist" => {
            let stored = text(case, "stored")?;
            machine.apply(text(case, "expected")?, text(case, "event")?, stored).map(|step| json!({ "stored_after": step.to, "changed": step.changed }))
        }
        other => return Err(Failed::from(format!("no check for the feature {other}; the vectors and this file must agree"))),
    })
}

/// Runs one vector on its machine.
fn run(machine: &Machine, rows: &[Value], case: &Map<String, Value>) -> Result<(), Failed> {
    let expect = case.get("expect").ok_or_else(|| Failed::from("the vector has no expect"))?;
    let Some(legacy) = expect.get("error").and_then(Value::as_str) else {
        return match call(machine, case)? {
            Ok(value) if &value == expect => Ok(()),
            Ok(value) => Err(Failed::from(format!("returned {value}, expected {expect}"))),
            Err(error) => Err(Failed::from(format!("raised {} ({error}), expected {expect}", error.kind()))),
        };
    };
    let kind = kind_of(rows, case, legacy)?;
    if kind == "invalid_number" {
        // The row C-1: the binding refuses the input at its boundary; the core takes only an i64 within the contract int.
        return match contract_int(case)? {
            None => Ok(()),
            Some(value) => Err(Failed::from(format!("the input {value} is a contract int, but the mapping table gives invalid_number"))),
        };
    }
    match call(machine, case)? {
        Ok(value) => Err(Failed::from(format!("returned {value}, expected {legacy} ({kind})"))),
        Err(error) => {
            let actual = json!({ "kind": error.kind(), "expected": error.expected(), "actual": error.actual(), "event": error.event() });
            let wanted = json!({ "kind": kind, "expected": expect.get("expected"), "actual": expect.get("actual"), "event": expect.get("event") });
            if actual != wanted {
                return Err(Failed::from(format!("raised {actual} ({error}), expected {wanted}")));
            }
            // A store keeps its state when the step fails.
            match expect.get("stored_after") {
                Some(after) if after.as_str() != Some(text(case, "stored")?) => Err(Failed::from(format!("the stored state after the error is {after}, not the stored state"))),
                _ => Ok(()),
            }
        }
    }
}

/// The trials of every vector of every machine.
fn trials() -> Result<Vec<Trial>, Failed> {
    let contracts = contracts()?;
    let vectors = read(&contracts.join("conformance/vectors.json"))?;
    let lock = read(&contracts.join("fsm.lock.json"))?;
    let rows = read(&contracts.join("conformance/changes.json"))?
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| Failed::from("contracts/conformance/changes.json has no list rows"))?;
    let machines = vectors.get("machines").and_then(Value::as_array).ok_or_else(|| Failed::from("the vectors have no list machines"))?;
    let mut trials = Vec::new();
    for entry in machines {
        let name = entry.get("machine").and_then(Value::as_str).ok_or_else(|| Failed::from("a machine of the vectors has no name"))?;
        let path = contracts.join(format!("machines/{name}.fsm.json"));
        let definition = std::fs::read_to_string(&path).map_err(|error| Failed::from(format!("{}: {error}", path.display())))?;
        let reserved = lock
            .pointer(&format!("/{name}/reserved"))
            .and_then(Value::as_array)
            .ok_or_else(|| Failed::from(format!("contracts/fsm.lock.json has no reserved codes of {name}")))?
            .iter()
            .map(|code| code.as_i64().ok_or_else(|| Failed::from("a reserved code is not an int")))
            .collect::<Result<Vec<i64>, Failed>>()?;
        let machine = Machine::parse(&definition, &reserved).map_err(|error| Failed::from(format!("{name}: {error}")))?;
        let cases = entry.get("cases").and_then(Value::as_array).ok_or_else(|| Failed::from(format!("{name} has no list cases")))?;
        for case in cases {
            let case = case.as_object().ok_or_else(|| Failed::from(format!("a vector of {name} is not an object")))?.clone();
            let id = text(&case, "name")?.to_owned();
            let (machine, rows) = (machine.clone(), rows.clone());
            trials.push(Trial::test(format!("{name}::{id}"), move || run(&machine, &rows, &case)));
        }
    }
    if trials.is_empty() {
        return Err(Failed::from("contracts/conformance/vectors.json holds no vector"));
    }
    Ok(trials)
}

fn main() -> std::process::ExitCode {
    common::run_trials("the vectors", trials())
}
