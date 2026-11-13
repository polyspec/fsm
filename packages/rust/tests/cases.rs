//! The cases of contracts/cases.json on the core, one trial per case (binding G-5): each case reads its machine with
//! `Machine::parse` from the keys definition and reserved, calls the member of its group with the keys of its parameters, and
//! compares the result with returns or the kind of the error with raises.

use std::path::PathBuf;

use libtest_mimic::{Arguments, Failed, Trial};
use polyspec_fsm::{Error, Machine, Step};
use serde_json::{json, Map, Value};

/// The case file: contracts/cases.json of the nearest parent folder of the crate that holds it.
fn cases_file() -> Result<PathBuf, Failed> {
    let package = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    package
        .ancestors()
        .map(|directory| directory.join("contracts/cases.json"))
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| Failed::from(format!("no parent folder of {} holds contracts/cases.json", package.display())))
}

/// The string field `name` of a case.
fn text<'a>(case: &'a Map<String, Value>, name: &str) -> Result<&'a str, Failed> {
    case.get(name).and_then(Value::as_str).ok_or_else(|| Failed::from(format!("the case has no text {name}")))
}

/// The integer field `name` of a case.
fn int(case: &Map<String, Value>, name: &str) -> Result<i64, Failed> {
    case.get(name).and_then(Value::as_i64).ok_or_else(|| Failed::from(format!("the case has no int {name}")))
}

/// The machine of a case, from its keys definition and reserved.
fn machine(case: &Map<String, Value>) -> Result<Result<Machine, Error>, Failed> {
    let reserved = case
        .get("reserved")
        .and_then(Value::as_array)
        .ok_or_else(|| Failed::from("the case has no list reserved"))?
        .iter()
        .map(|code| code.as_i64().ok_or_else(|| Failed::from("a reserved code is not an int")))
        .collect::<Result<Vec<i64>, Failed>>()?;
    Ok(Machine::parse(text(case, "definition")?, &reserved))
}

/// The result of the member `member` on a case, as the JSON value that returns gives.
fn call(member: &str, case: &Map<String, Value>) -> Result<Result<Value, Error>, Failed> {
    let machine = match machine(case)? {
        Ok(machine) => machine,
        Err(error) => return Ok(Err(error)),
    };
    let step = |step: Step| json!({ "to": step.to, "changed": step.changed });
    Ok(match member {
        "parse" => Ok(Value::Null),
        "initial" => Ok(json!(machine.initial())),
        "code" => machine.code(text(case, "state")?).map(|code| json!(code)),
        "key" => machine.key(int(case, "code")?).map(|key| json!(key)),
        "from_code" => machine.from_code(int(case, "code")?).map(|key| json!(key)),
        "is_final" => machine.is_final(text(case, "state")?).map(|flag| json!(flag)),
        "events_from" => machine.events_from(text(case, "state")?).map(|events| json!(events)),
        "target" => machine.target(text(case, "expected")?, text(case, "event")?).map(|key| json!(key)),
        "apply" => machine.apply(text(case, "expected")?, text(case, "event")?, text(case, "actual")?).map(step),
        other => return Err(Failed::from(format!("{other} is not a member of machine"))),
    })
}

/// Runs one case of the member `member`.
fn run(member: &str, case: &Map<String, Value>) -> Result<(), Failed> {
    let result = call(member, case)?;
    match (case.get("raises"), result) {
        (Some(raises), Err(error)) => {
            let kind = raises.get("kind").and_then(Value::as_str).ok_or_else(|| Failed::from("raises has no kind"))?;
            if error.kind() == kind {
                Ok(())
            } else {
                Err(Failed::from(format!("raised {} ({error}), expected {kind}", error.kind())))
            }
        }
        (Some(raises), Ok(value)) => Err(Failed::from(format!("returned {value}, expected to raise {raises}"))),
        (None, Err(error)) => Err(Failed::from(format!("raised {} ({error})", error.kind()))),
        (None, Ok(value)) => {
            let expected = case.get("returns").ok_or_else(|| Failed::from("the case has neither returns nor raises"))?;
            if &value == expected {
                Ok(())
            } else {
                Err(Failed::from(format!("returned {value}, expected {expected}")))
            }
        }
    }
}

/// The trials of every case of the groups machine.<member>.
fn trials() -> Result<Vec<Trial>, Failed> {
    let path = cases_file()?;
    let source = std::fs::read_to_string(&path).map_err(|error| Failed::from(format!("{}: {error}", path.display())))?;
    let file: Map<String, Value> = serde_json::from_str(&source).map_err(|error| Failed::from(format!("{}: {error}", path.display())))?;
    let mut trials = Vec::new();
    for (group, cases) in &file {
        let Some(member) = group.strip_prefix("machine.") else { continue };
        let cases = cases.as_array().ok_or_else(|| Failed::from(format!("the group {group} is not a list")))?;
        for case in cases {
            let case = case.as_object().ok_or_else(|| Failed::from(format!("a case of {group} is not an object")))?.clone();
            let id = text(&case, "id")?.to_owned();
            let member = member.to_owned();
            trials.push(Trial::test(format!("{member}::{id}"), move || run(&member, &case)));
        }
    }
    Ok(trials)
}

fn main() -> std::process::ExitCode {
    let arguments = Arguments::from_args();
    match trials() {
        Ok(trials) => libtest_mimic::run(&arguments, trials).exit_code(),
        Err(error) => {
            eprintln!("the cases did not load: {error:?}");
            std::process::ExitCode::FAILURE
        }
    }
}
