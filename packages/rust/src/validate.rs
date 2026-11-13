//! The validation of definitions (docs/spec/fsm.md, B-5 and FSM-B7-4): `validate` returns every finding of the machines of
//! a list, each as a `Finding` with its code, machine, JSON path and message, in document order within a machine and in input
//! order across machines, as `legacy/packages/compiler/src/core/validate.mjs` gives them. An empty list means that the
//! definitions are valid. A machine with an `E_SCHEMA` finding gets no other finding.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};

use crate::Error;

/// The longest key of a machine, a state and an event (B-5, E_KEY_FORMAT).
const KEY_MAX: usize = 64;
/// The largest code of a state (B-5, E_CODE_RANGE).
const CODE_MAX: f64 = 2_147_483_647.0;

/// Machine keys of the generated files: `fsm` is the shared module, `index` the npm entry file, `lib` and `main` the rust
/// and go entries, `internal` a go package that tests cannot import, `init` a name go rejects for an imported package,
/// `testdata` and `vendor` the directories that go `./...` skips.
const MACHINE_FIXED: &[&str] = &["fsm", "index", "lib", "main", "internal", "init", "testdata", "vendor"];

/// The predeclared identifiers of Go 1.25 (Go specification, Predeclared identifiers); an import of the name would shadow them.
const GO_PREDECLARED: &[&str] = &[
    "any", "bool", "byte", "comparable", "complex64", "complex128", "error", "float32", "float64", "int", "int8", "int16", "int32",
    "int64", "rune", "string", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr", "true", "false", "iota", "nil", "append",
    "cap", "clear", "close", "complex", "copy", "delete", "imag", "len", "make", "max", "min", "new", "panic", "print", "println",
    "real", "recover",
];

/// The keywords of Go 1.25.
const GO_KEYWORDS: &[&str] = &[
    "break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough", "for", "func", "go", "goto", "if",
    "import", "interface", "map", "package", "range", "return", "select", "struct", "switch", "type", "var",
];

/// The keywords of Rust, 2024 edition: the strict keywords and the reserved keywords. The weak keywords (such as `union`) are
/// identifiers, so they are not listed.
const RUST_KEYWORDS: &[&str] = &[
    "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern", "false", "fn", "for", "if",
    "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct",
    "super", "trait", "true", "type", "unsafe", "use", "where", "while", "abstract", "become", "box", "do", "final", "gen",
    "macro", "override", "priv", "try", "typeof", "unsized", "virtual", "yield",
];

/// The keywords of Python 3.13 (keyword.kwlist); the soft keywords (`match`, `case`, `type`, `_`) are identifiers.
const PYTHON_KEYWORDS: &[&str] = &[
    "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else",
    "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise",
    "return", "try", "while", "with", "yield",
];

/// The reserved words of JavaScript (ECMAScript 2024) and the words reserved in strict mode.
const JS_KEYWORDS: &[&str] = &[
    "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum",
    "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null", "return",
    "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield", "implements",
    "interface", "let", "package", "private", "protected", "public", "static",
];

/// The literals of the canonical form, which a machine key may not be (the mermaid title and the JSON literals).
const MACHINE_LITERALS: &[&str] = &["null", "true", "false"];

/// State and event keys whose pascal form is rejected as an enum member: `self` (rust `Self`) and `class` (php `Class`).
const STATE_EVENT_KEYS: &[&str] = &["self", "class"];

/// The words that a Mermaid stateDiagram-v2 state key may not be, whatever the store.
const MERMAID_STATE_KEYS: &[&str] = &[
    "note", "class", "classdef", "style", "click", "href", "default", "state", "statediagram", "scale", "acctitle", "accdescr",
    "root_start", "root_end",
];

const MACHINE_FIELDS: &[&str] = &["machine", "states", "events"];
const STATE_FIELDS: &[&str] = &["key", "code", "initial", "final"];
const EVENT_FIELDS: &[&str] = &["key", "edges"];
const EDGE_FIELDS: &[&str] = &["from", "to"];

/// A finding of `validate` (B-5): its error code, the key of its machine (none when the definition has no string key), the
/// JSON path within the machine object and its message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    /// The error code of B-5, such as `E_SCHEMA`.
    pub code: String,
    /// The key of the machine, or none when the definition has no string key.
    pub machine: Option<String>,
    /// The JSON path within the machine object, such as `$.states[1].code`.
    pub path: String,
    /// The message that states the rule.
    pub message: String,
}

/// A finding of `code` at `path` of the machine `machine`.
fn finding(code: &str, machine: Option<&str>, path: &str, message: String) -> Finding {
    Finding { code: code.to_owned(), machine: machine.map(str::to_owned), path: path.to_owned(), message }
}

/// The kind of a JSON value, as the messages of validate.mjs name it (`a ${typeof value}`, so an object is `a object`).
fn kind_of(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Array(_) => "an array",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Object(_) => "a object",
    }
}

/// The JSON text of a value, as the messages quote it.
fn quoted(value: &Value) -> String {
    value.to_string()
}

/// Whether a JSON value is an integral number.
fn is_integer(value: &Value) -> bool {
    match value {
        Value::Number(number) => number.is_i64() || number.is_u64() || number.as_f64().is_some_and(|float| float.fract() == 0.0),
        _ => false,
    }
}

/// The key format of B-5: lower case letters and digits joined by single underscores, starting with a letter.
fn key_pattern(key: &str) -> bool {
    !key.is_empty()
        && key.split('_').all(|part| {
            let mut characters = part.chars();
            characters.next().is_some_and(|first| first.is_ascii_lowercase())
                && characters.all(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
        })
}

/// The E_KEY_FORMAT message of a key that breaks the pattern or the length bound, or none when the key is valid. A key that
/// breaks the pattern is reported by the pattern message alone.
fn key_format_fault(kind: &str, key: &str) -> Option<String> {
    if !key_pattern(key) {
        return Some(format!("{kind} key {key} is not lower case letters and digits joined by single underscores"));
    }
    let length = key.encode_utf16().count();
    (length > KEY_MAX).then(|| format!("{kind} key {key} is {length} characters; the maximum is {KEY_MAX}"))
}

/// The findings of one machine whose structure is checked; `fail` collects them.
struct Collector {
    machine: Option<String>,
    found: Vec<Finding>,
}

impl Collector {
    fn fail(&mut self, path: &str, message: String) {
        self.found.push(finding("E_SCHEMA", self.machine.as_deref(), path, message));
    }

    /// Reports the required fields that are missing at `path` and the fields that the object does not allow.
    fn fields(&mut self, value: &Map<String, Value>, path: &str, allowed: &[&str], required: &[&str], what: &str) {
        for key in required {
            if !value.contains_key(*key) {
                self.fail(path, format!("{what} lacks {key}; it is required"));
            }
        }
        for key in value.keys() {
            if !allowed.contains(&key.as_str()) {
                self.fail(&format!("{path}.{key}"), format!("{key} is not a field of {what}"));
            }
        }
    }

    /// Reports `initial` or `final` when it is present and not true: the canonical form omits a false flag.
    fn flag(&mut self, value: &Map<String, Value>, field: &str, path: &str) {
        if let Some(flag) = value.get(field) {
            if flag != &Value::Bool(true) {
                self.fail(
                    &format!("{path}.{field}"),
                    format!("{field} is {}; it must be true when present, because the canonical form omits it", quoted(flag)),
                );
            }
        }
    }

    /// The E_SCHEMA rules of one state at `path`.
    fn state(&mut self, state: &Value, path: &str) {
        let Value::Object(state) = state else {
            self.fail(path, format!("the state is {}; it must be an object", kind_of(state)));
            return;
        };
        self.fields(state, path, STATE_FIELDS, &["key", "code"], "a state");
        if let Some(key) = state.get("key").filter(|key| !key.is_string()) {
            self.fail(&format!("{path}.key"), format!("key is {}; it must be a string", kind_of(key)));
        }
        if let Some(code) = state.get("code").filter(|code| !is_integer(code)) {
            self.fail(&format!("{path}.code"), format!("code is {}; it must be an integer", quoted(code)));
        }
        self.flag(state, "initial", path);
        self.flag(state, "final", path);
    }

    /// The E_SCHEMA rules of one event at `path`, and of its edges.
    fn event(&mut self, event: &Value, path: &str) {
        let Value::Object(event) = event else {
            self.fail(path, format!("the event is {}; it must be an object", kind_of(event)));
            return;
        };
        self.fields(event, path, EVENT_FIELDS, &["key", "edges"], "an event");
        if let Some(key) = event.get("key").filter(|key| !key.is_string()) {
            self.fail(&format!("{path}.key"), format!("key is {}; it must be a string", kind_of(key)));
        }
        let Some(edges) = event.get("edges") else { return };
        let Value::Array(edges) = edges else {
            self.fail(&format!("{path}.edges"), format!("edges is {}; it must be an array", kind_of(edges)));
            return;
        };
        if edges.is_empty() {
            self.fail(&format!("{path}.edges"), "edges is empty; an event has at least one edge".to_owned());
        }
        for (index, edge) in edges.iter().enumerate() {
            let at = format!("{path}.edges[{index}]");
            let Value::Object(edge) = edge else {
                self.fail(&at, format!("the edge is {}; it must be an object with the fields from and to", kind_of(edge)));
                continue;
            };
            self.fields(edge, &at, EDGE_FIELDS, &["from", "to"], "an edge");
            for field in EDGE_FIELDS {
                if let Some(value) = edge.get(*field).filter(|value| !value.is_string()) {
                    self.fail(&format!("{at}.{field}"), format!("{field} is {}; it must be a string", kind_of(value)));
                }
            }
        }
    }
}

/// The findings of a definition that is not a valid structure (E_SCHEMA); its later rules are skipped.
fn structure(definition: &Value) -> Vec<Finding> {
    let machine = match definition {
        Value::Object(map) => map.get("machine").and_then(Value::as_str).map(str::to_owned),
        _ => None,
    };
    let mut collector = Collector { machine, found: Vec::new() };
    let Value::Object(map) = definition else {
        collector.fail("$", format!("the machine definition is {}; it must be an object", kind_of(definition)));
        return collector.found;
    };
    collector.fields(map, "$", MACHINE_FIELDS, MACHINE_FIELDS, "a machine");
    if let Some(name) = map.get("machine").filter(|name| !name.is_string()) {
        collector.fail("$.machine", format!("machine is {}; it must be a string", kind_of(name)));
    }
    if let Some(states) = map.get("states") {
        match states {
            Value::Array(states) => {
                for (index, state) in states.iter().enumerate() {
                    collector.state(state, &format!("$.states[{index}]"));
                }
            }
            other => collector.fail("$.states", format!("states is {}; it must be an array", kind_of(other))),
        }
    }
    if let Some(events) = map.get("events") {
        match events {
            Value::Array(events) => {
                for (index, event) in events.iter().enumerate() {
                    collector.event(event, &format!("$.events[{index}]"));
                }
            }
            other => collector.fail("$.events", format!("events is {}; it must be an array", kind_of(other))),
        }
    }
    collector.found
}

/// A state of a machine with a valid structure.
struct State<'a> {
    key: &'a str,
    code: f64,
    code_value: &'a Value,
    initial: bool,
    is_final: bool,
}

/// An event of a machine with a valid structure: its key and its edges (from, to).
struct Event<'a> {
    key: &'a str,
    edges: Vec<(&'a str, &'a str)>,
}

/// A machine with a valid structure.
struct Definition<'a> {
    machine: &'a str,
    states: Vec<State<'a>>,
    events: Vec<Event<'a>>,
}

/// The string field `name` of `map`.
fn field<'a>(map: &'a Map<String, Value>, name: &str) -> Option<&'a str> {
    map.get(name).and_then(Value::as_str)
}

/// The items of the array field `name` of `map`.
fn list<'a>(map: &'a Map<String, Value>, name: &str) -> Option<&'a [Value]> {
    map.get(name).and_then(Value::as_array).map(Vec::as_slice)
}

/// The machine of a definition whose structure is valid, or none when a part of it is not of the form that the structure
/// rules require.
fn definition(map: &Map<String, Value>) -> Option<Definition<'_>> {
    let states = list(map, "states")?
        .iter()
        .map(|state| {
            let state = state.as_object()?;
            let code_value = state.get("code")?;
            Some(State {
                key: field(state, "key")?,
                code: code_value.as_f64()?,
                code_value,
                initial: state.get("initial") == Some(&Value::Bool(true)),
                is_final: state.get("final") == Some(&Value::Bool(true)),
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let events = list(map, "events")?
        .iter()
        .map(|event| {
            let event = event.as_object()?;
            let edges = list(event, "edges")?
                .iter()
                .map(|edge| {
                    let edge = edge.as_object()?;
                    Some((field(edge, "from")?, field(edge, "to")?))
                })
                .collect::<Option<Vec<_>>>()?;
            Some(Event { key: field(event, "key")?, edges })
        })
        .collect::<Option<Vec<_>>>()?;
    Some(Definition { machine: field(map, "machine")?, states, events })
}

/// The graph rules of a machine whose structure is valid (B-5). An edge whose endpoint is not a state is reported and left
/// out of the reachability search. Reachability is checked only when there is exactly one initial state; otherwise
/// E_INITIAL_COUNT is the finding.
fn graph(definition: &Definition<'_>) -> Vec<Finding> {
    let mut found = Vec::new();
    let machine = Some(definition.machine);
    let mut report = |code: &str, path: &str, message: String| found.push(finding(code, machine, path, message));
    let keys: HashSet<&str> = definition.states.iter().map(|state| state.key).collect();
    let finals: HashSet<&str> = definition.states.iter().filter(|state| state.is_final).map(|state| state.key).collect();
    let initials: Vec<&str> = definition.states.iter().filter(|state| state.initial).map(|state| state.key).collect();
    let mut outgoing = HashSet::new();
    let mut edges = Vec::new();
    if initials.len() != 1 {
        report("E_INITIAL_COUNT", "$.states", format!("the machine has {} initial states; it needs exactly one", initials.len()));
    }
    for (event_index, event) in definition.events.iter().enumerate() {
        let mut targets: HashMap<&str, &str> = HashMap::new();
        let mut seen = HashSet::new();
        let mut nondeterministic = HashSet::new();
        for (edge_index, &(from, to)) in event.edges.iter().enumerate() {
            let at = format!("$.events[{event_index}].edges[{edge_index}]");
            if !keys.contains(from) {
                report("E_UNKNOWN_STATE_REF", &format!("{at}.from"), format!("{from} is not a state of the machine"));
            }
            if !keys.contains(to) {
                report("E_UNKNOWN_STATE_REF", &format!("{at}.to"), format!("{to} is not a state of the machine"));
            }
            if from == to {
                report("E_SELF_LOOP", &at, format!("the edge of {} leaves {from} and enters it; a self transition is not allowed", event.key));
            }
            if seen.contains(&(from, to)) {
                report("E_DUPLICATE_EDGE", &at, format!("the edge {from} -> {to} repeats an edge of event {}", event.key));
            } else if let Some(&first) = targets.get(from) {
                if first != to && nondeterministic.insert(from) {
                    report(
                        "E_NONDETERMINISTIC",
                        &at,
                        format!("event {} leaves {from} for {first} and for {to}; one state and event have one target", event.key),
                    );
                }
            } else {
                targets.insert(from, to);
            }
            seen.insert((from, to));
            if finals.contains(from) {
                report("E_FINAL_OUTGOING", &at, format!("final state {from} has an outgoing edge of event {}", event.key));
            }
            outgoing.insert(from);
            if keys.contains(from) && keys.contains(to) {
                edges.push((from, to));
            }
        }
    }
    if let [initial] = initials.as_slice() {
        let mut reached = HashSet::from([*initial]);
        let mut pending = vec![*initial];
        while let Some(current) = pending.pop() {
            for &(from, to) in &edges {
                if from == current && reached.insert(to) {
                    pending.push(to);
                }
            }
        }
        for (index, state) in definition.states.iter().enumerate() {
            if !reached.contains(state.key) {
                report("E_UNREACHABLE", &format!("$.states[{index}]"), format!("state {} is not reachable from the initial state", state.key));
            }
        }
    }
    for (index, state) in definition.states.iter().enumerate() {
        if !state.is_final && !outgoing.contains(state.key) {
            report("E_DEAD_END", &format!("$.states[{index}]"), format!("state {} is not final and has no outgoing edge", state.key));
        }
    }
    found
}

/// Whether `key` is on one of `lists`.
fn listed(lists: &[&[&str]], key: &str) -> bool {
    lists.iter().any(|list| list.contains(&key))
}

/// The name rules of a machine whose structure is valid (B-5): the key format, the reserved keys and the repeated keys.
fn names(definition: &Definition<'_>) -> Vec<Finding> {
    let mut found = Vec::new();
    let machine = definition.machine;
    let mut report = |code: &str, path: &str, message: String| found.push(finding(code, Some(machine), path, message));
    if let Some(fault) = key_format_fault("machine", machine) {
        report("E_KEY_FORMAT", "$.machine", fault);
    }
    let machine_lists = [MACHINE_FIXED, GO_PREDECLARED, GO_KEYWORDS, RUST_KEYWORDS, PYTHON_KEYWORDS, JS_KEYWORDS, MACHINE_LITERALS];
    if listed(&machine_lists, &machine.replace('_', "")) {
        report(
            "E_KEY_RESERVED",
            "$.machine",
            format!("machine key {machine} is reserved (docs/spec/fsm.md, B-5), after its underscores are removed"),
        );
    }
    let mut state_keys = HashSet::new();
    for (index, state) in definition.states.iter().enumerate() {
        let path = format!("$.states[{index}].key");
        if let Some(fault) = key_format_fault("state", state.key) {
            report("E_KEY_FORMAT", &path, fault);
        }
        if listed(&[STATE_EVENT_KEYS, MERMAID_STATE_KEYS], state.key) {
            report("E_KEY_RESERVED", &path, format!("state key {} is reserved (docs/spec/fsm.md, B-5)", state.key));
        }
        if !state_keys.insert(state.key) {
            report("E_DUPLICATE_KEY", &path, format!("state key {} repeats a state of the machine", state.key));
        }
    }
    let mut event_keys = HashSet::new();
    for (index, event) in definition.events.iter().enumerate() {
        let path = format!("$.events[{index}].key");
        if let Some(fault) = key_format_fault("event", event.key) {
            report("E_KEY_FORMAT", &path, fault);
        }
        if listed(&[STATE_EVENT_KEYS], event.key) {
            report("E_KEY_RESERVED", &path, format!("event key {} is reserved (docs/spec/fsm.md, B-5)", event.key));
        }
        if !event_keys.insert(event.key) {
            report("E_DUPLICATE_KEY", &path, format!("event key {} repeats an event of the machine", event.key));
        }
    }
    found
}

/// The code rules of a machine whose structure is valid (B-5): the range and the repeated codes.
fn codes(definition: &Definition<'_>) -> Vec<Finding> {
    let mut found = Vec::new();
    let mut seen: Vec<f64> = Vec::new();
    for (index, state) in definition.states.iter().enumerate() {
        let path = format!("$.states[{index}].code");
        let text = quoted(state.code_value);
        if state.code < 1.0 || state.code > CODE_MAX {
            found.push(finding("E_CODE_RANGE", Some(definition.machine), &path, format!("code {text} is outside 1 to 2147483647")));
        }
        if seen.contains(&state.code) {
            found.push(finding("E_DUPLICATE_CODE", Some(definition.machine), &path, format!("code {text} is used by another state of the machine")));
        }
        seen.push(state.code);
    }
    found
}

/// E_DUPLICATE_KEY of a machine whose key equals the key of an earlier machine with a valid structure, or equals it after its
/// underscores are removed. The earlier machines with a structural error are not compared (their keys are not valid).
fn repeated_machine(machine: &str, earlier: &[(String, usize)]) -> Option<Finding> {
    let compact = |key: &str| key.replace('_', "");
    let (first, index) = earlier.iter().find(|(key, _)| compact(key) == compact(machine))?;
    let message = if first == machine {
        format!("machine key {machine} repeats the machine at index {index}")
    } else {
        format!("machine key {machine} equals machine key {first} at index {index} after its underscores are removed")
    };
    Some(finding("E_DUPLICATE_KEY", Some(machine), "$.machine", message))
}

/// The position of every JSON path of `value` in document order (pre-order, keys in their order, indexes in order).
fn positions(value: &Value) -> HashMap<String, usize> {
    fn visit(node: &Value, path: String, found: &mut HashMap<String, usize>) {
        let position = found.len();
        found.insert(path.clone(), position);
        match node {
            Value::Array(items) => {
                for (index, item) in items.iter().enumerate() {
                    visit(item, format!("{path}[{index}]"), found);
                }
            }
            Value::Object(map) => {
                for (key, item) in map {
                    visit(item, format!("{path}.{key}"), found);
                }
            }
            _ => {}
        }
    }
    let mut found = HashMap::new();
    visit(value, "$".to_owned(), &mut found);
    found
}

/// The error of a rule that this module breaks: a finding that names no path of the definition, or a definition with a valid
/// structure that is not of the form that the structure rules require.
fn internal(message: String) -> Error {
    Error::InvalidDefinition { message: format!("internal: {message}") }
}

/// The findings of one machine in document order (a stable sort by the position of the path of each finding).
fn in_document_order(definition: &Value, found: Vec<Finding>) -> Result<Vec<Finding>, Error> {
    let order = positions(definition);
    let mut placed = found
        .into_iter()
        .map(|item| match order.get(&item.path) {
            Some(&position) => Ok((position, item)),
            None => Err(internal(format!("the finding {} names {}, which is not in the definition", item.code, item.path))),
        })
        .collect::<Result<Vec<_>, Error>>()?;
    placed.sort_by_key(|(position, _)| *position);
    Ok(placed.into_iter().map(|(_, item)| item).collect())
}

/// The findings of every machine of `definitions`, the JSON text of a list of machine objects without `$schema` (FSM-B7-4).
pub(crate) fn validate(definitions: &str) -> Result<Vec<Finding>, Error> {
    let definitions: Value =
        serde_json::from_str(definitions).map_err(|error| Error::InvalidDefinition { message: format!("$: {error}") })?;
    let Value::Array(definitions) = definitions else {
        return Ok(vec![finding(
            "E_SCHEMA",
            None,
            "$",
            format!("the definitions are {}; they must be an array of machines", kind_of(&definitions)),
        )]);
    };
    let mut found = Vec::new();
    let mut valid: Vec<(String, usize)> = Vec::new();
    for (index, value) in definitions.iter().enumerate() {
        let problems = structure(value);
        if !problems.is_empty() {
            found.extend(in_document_order(value, problems)?);
            continue;
        }
        let machine = value
            .as_object()
            .and_then(definition)
            .ok_or_else(|| internal(format!("the machine at index {index} has a valid structure and is not of its form")))?;
        let mut own: Vec<Finding> = repeated_machine(machine.machine, &valid).into_iter().collect();
        own.extend(names(&machine));
        own.extend(codes(&machine));
        own.extend(graph(&machine));
        valid.push((machine.machine.to_owned(), index));
        found.extend(in_document_order(value, own)?);
    }
    Ok(found)
}
