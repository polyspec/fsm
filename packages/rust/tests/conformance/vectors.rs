// The vector cases of contracts/conformance/vectors.json as libtest-mimic trials (docs/plans/fsm-v1/plan.md, C-4). The file is read
// when the test runs; a case is one trial named vectors::<feature>__<id>, run through the adapter of its machine.

use crate::{check_persist, check_result, check_slice, check_value, Expected};
use fsm_rust::fsm::Code;
use libtest_mimic::Trial;
use serde_json::Value;
use std::path::PathBuf;

/// The vector file of the oracle: contracts/conformance/vectors.json, found in the nearest parent folder of the package that holds it.
fn vectors_file() -> PathBuf {
    let package = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    package
        .ancestors()
        .map(|directory| directory.join("contracts/conformance/vectors.json"))
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| panic!("no parent folder of {} holds contracts/conformance/vectors.json", package.display()))
}

/// The expected error of an error case: its code and the fields of fsm.Error (null is None, docs/spec/fsm.md, B-6).
fn expected_of(expect: &Value) -> Expected {
    let name = expect["error"].as_str().expect("the error code of an error case");
    let code = [Code::Conflict, Code::InvalidTransition, Code::UnknownCode, Code::ReservedCode]
        .into_iter()
        .find(|code| code.as_str() == name)
        .unwrap_or_else(|| panic!("{name} is no error code"));
    let field = |key: &str| expect[key].as_i64().map(|value| i32::try_from(value).expect("a field of an error is an i32"));
    Expected { code, expected: field("expected"), actual: field("actual"), event: field("event") }
}

/// Whether an expectation is an error (an object with an error code); every other expectation is a plain value.
fn failed(expect: &Value) -> bool {
    expect.get("error").is_some()
}

/// The decoded value of a from_code input as the rust kind holds it (docs/spec/fsm.md, B-6): the oracle gives it as a decimal string,
/// which is the integer it names (an i64), a float, a string or a bool by the input_type of the case.
fn input_of(case: &Value) -> Value {
    let text = case["input"].as_str().expect("the input of a from_code case is a string");
    match case.get("input_type").and_then(Value::as_str) {
        None => Value::from(text.parse::<i64>().unwrap_or_else(|error| panic!("{text} is no i64: {error}"))),
        Some("float") => Value::from(text.parse::<f64>().unwrap_or_else(|error| panic!("{text} is no f64: {error}"))),
        Some("string") => Value::from(text),
        Some("bool") => Value::from(text.parse::<bool>().unwrap_or_else(|error| panic!("{text} is no bool: {error}"))),
        Some(other) => panic!("the input type {other} is not known"),
    }
}

/// The raw code of a state argument: the JSON integer of the case, which from_code rejects when it is no state.
fn raw_of(value: &Value) -> Value {
    Value::from(value.as_i64().expect("a raw code is an integer"))
}

/// The checks of the features that need no event (initial, code, key, from_code, is_final and events_from), on the functions of a
/// machine module: true when the case was one of them. A machine without events has no other case.
macro_rules! common_features {
    ($machine:ident, $state:ident, $event:expr, $case:expr, $expect:expr) => {
        match $case["feature"].as_str().expect("the feature of a case") {
            "initial" => {
                check_value($machine::initial(), $state(&$expect["state"]));
                true
            }
            "code" => {
                match $case.get("value") {
                    Some(value) => check_result($machine::from_code(raw_of(value)).map($machine::code), Err(expected_of($expect))),
                    None => check_value($machine::code($state(&$case["state"])), i32::try_from($expect.as_i64().expect("a code")).expect("an i32")),
                }
                true
            }
            "key" => {
                let actual = $machine::from_code(raw_of(&$case["code"])).map($machine::key);
                if failed($expect) {
                    check_result(actual, Err(expected_of($expect)));
                } else {
                    check_result(actual, Ok($expect.as_str().expect("a key")));
                }
                true
            }
            "from_code" => {
                let actual = $machine::from_code(input_of($case));
                if failed($expect) {
                    check_result(actual, Err(expected_of($expect)));
                } else {
                    check_result(actual, Ok($state(&$expect["state"])));
                }
                true
            }
            "is_final" => {
                match $case.get("value") {
                    Some(value) => check_result($machine::from_code(raw_of(value)).map($machine::is_final), Err(expected_of($expect))),
                    None => check_value($machine::is_final($state(&$case["state"])), $expect.as_bool().expect("a bool")),
                }
                true
            }
            "events_from" => {
                let events: Vec<_> = $expect.as_array().expect("a list of events").iter().map($event).collect();
                check_slice($machine::events_from($state(&$case["state"])), &events);
                true
            }
            _ => false,
        }
    };
}

/// The function state of an adapter module: the state of a key, by the table of the machine.
macro_rules! state_lookup {
    ($module:ident, $($skey:literal => $state:ident),*) => {
        fn state(key: &Value) -> State {
            match key.as_str().expect("a state is a key") {
                $($skey => State::$state,)*
                other => panic!("{other} is no state of {}", stringify!($module)),
            }
        }
    };
}

/// The adapter of one machine module: its states and events by key (docs/spec/fsm.md, B-6) and the checks of the features of a
/// case on its functions. The enums are closed, so a state argument that carries a raw code goes through from_code first.
macro_rules! adapter {
    ($module:ident, states: { $($skey:literal => $state:ident),* $(,)? }, events: { $($ekey:literal => $event:ident),+ $(,)? }) => {
        mod $module {
            use super::*;
            use fsm_rust::$module::{self as machine, Event, State, Step};

            state_lookup!($module, $($skey => $state),*);

            fn event(key: &Value) -> Event {
                match key.as_str().expect("an event is a key") {
                    $($ekey => Event::$event,)+
                    other => panic!("{other} is no event of {}", stringify!($module)),
                }
            }

            /// The state argument of a case: what from_code gives its raw code, or the state of its key.
            fn argument(case: &Value, key: &str, raw: &str) -> Result<State, fsm_rust::fsm::Error> {
                match case.get(raw) {
                    Some(value) => machine::from_code(raw_of(value)),
                    None => Ok(state(&case[key])),
                }
            }

            /// The decide function of a persist case: the machine's step on the stored code.
            fn decide(case: &Value) -> impl Fn(i64) -> Result<(i32, bool), fsm_rust::fsm::Error> {
                let expected = state(&case["expected"]);
                let event = event(&case["event"]);
                move |stored| {
                    let actual = machine::from_code(Value::from(stored))?;
                    let step = machine::apply(expected, event, actual)?;
                    Ok((machine::code(step.to), step.changed))
                }
            }

            pub fn run(case: &Value) {
                let expect = &case["expect"];
                if common_features!(machine, state, event, case, expect) {
                    return;
                }
                match case["feature"].as_str().expect("the feature of a case") {
                    "target" => {
                        let actual = machine::target(state(&case["state"]), event(&case["event"]));
                        if failed(expect) {
                            check_result(actual, Err(expected_of(expect)));
                        } else {
                            check_result(actual, Ok(state(&expect["state"])));
                        }
                    }
                    "apply" => {
                        let actual = argument(case, "expected", "expected_value").and_then(|expected| {
                            argument(case, "actual", "actual_value").and_then(|actual| machine::apply(expected, event(&case["event"]), actual))
                        });
                        if failed(expect) {
                            check_result(actual, Err(expected_of(expect)));
                        } else {
                            let to = state(&expect["to"]);
                            check_result(actual, Ok(Step { to, changed: expect["changed"].as_bool().expect("a bool") }));
                        }
                    }
                    "persist" => {
                        let stored = machine::code(state(&case["stored"]));
                        let stored_after = machine::code(state(&expect["stored_after"]));
                        let outcome = if failed(expect) {
                            Err(expected_of(expect))
                        } else {
                            Ok((stored_after, expect["changed"].as_bool().expect("a bool")))
                        };
                        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("the runtime of a persist case");
                        runtime.block_on(check_persist(stored, decide(case), outcome, stored_after));
                    }
                    other => panic!("no check for the feature {other}; the vectors and this file must agree"),
                }
            }
        }
    };
    // A machine without events has no event key, and its Event has no member: it has no target, apply or persist case.
    ($module:ident, states: { $($skey:literal => $state:ident),* $(,)? }, events: {}) => {
        mod $module {
            use super::*;
            use fsm_rust::$module::{self as machine, Event, State};

            state_lookup!($module, $($skey => $state),*);

            fn event(key: &Value) -> Event {
                panic!("{} is no event of {}: it has none", key, stringify!($module))
            }

            pub fn run(case: &Value) {
                let expect = &case["expect"];
                if !common_features!(machine, state, event, case, expect) {
                    panic!("{} has no event, so it has no case of the feature {}", stringify!($module), case["feature"]);
                }
            }
        }
    };
}

adapter!(in_review,
    states: { "to_do" => ToDo, "in_progress" => InProgress, "done_now" => DoneNow },
    events: { "start_work" => StartWork, "finish_work" => FinishWork, "reopen_work" => ReopenWork });
adapter!(limits,
    states: { "floor" => Floor, "ceiling" => Ceiling },
    events: { "rise" => Rise });
adapter!(order,
    states: { "draft" => Draft, "paid" => Paid, "shipped" => Shipped, "done" => Done, "canceled" => Canceled },
    events: { "next" => Next, "prev" => Prev, "cancel" => Cancel });
adapter!(standby,
    states: { "ready" => Ready },
    events: {});
adapter!(ticket,
    states: { "open" => Open, "review" => Review, "closed" => Closed },
    events: { "submit" => Submit, "approve" => Approve, "reject" => Reject });

/// The check of one case of a machine through its adapter; a machine that the vector file names and this file lacks is a failure.
fn run(machine: &str, case: &Value) {
    match machine {
        "in_review" => in_review::run(case),
        "limits" => limits::run(case),
        "order" => order::run(case),
        "standby" => standby::run(case),
        "ticket" => ticket::run(case),
        other => panic!("no adapter for the machine {other}; this file must hold one"),
    }
}

/// One trial per vector case of every machine, in the order of the vector file, named vectors::<feature>__<id>.
pub fn trials() -> Vec<Trial> {
    let file = vectors_file();
    let text = std::fs::read_to_string(&file).unwrap_or_else(|error| panic!("read {}: {error}", file.display()));
    let document: Value = serde_json::from_str(&text).unwrap_or_else(|error| panic!("parse {}: {error}", file.display()));
    document["machines"]
        .as_array()
        .expect("the machines of the vector file")
        .iter()
        .flat_map(|entry| {
            let machine = entry["machine"].as_str().expect("the machine key").to_string();
            entry["cases"].as_array().expect("the cases of a machine").iter().map(move |case| {
                let case = case.clone();
                let machine = machine.clone();
                Trial::test(format!("vectors::{}", case["name"].as_str().expect("the case name")), move || {
                    run(&machine, &case);
                    Ok(())
                })
            })
        })
        .collect()
}
