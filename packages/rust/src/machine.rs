//! A machine read from its definition (docs/spec/fsm.md, B-1) and its functions: initial, code, key, from_code, is_final,
//! events_from, target and apply (B-4, B-6).

use serde_json::{Map, Value};

use crate::{Error, Finding};

/// The largest code of a state (B-5, E_CODE_RANGE): codes are in the 32-bit range.
const CODE_MAX: i64 = 2_147_483_647;

/// The fields that a definition, a state, an event and an edge may hold (B-1).
const MACHINE_FIELDS: &[&str] = &["$schema", "machine", "states", "events"];
const STATE_FIELDS: &[&str] = &["key", "code", "initial", "final"];
const EVENT_FIELDS: &[&str] = &["key", "edges"];
const EDGE_FIELDS: &[&str] = &["from", "to"];

/// A state of a machine: its key, its code and whether it is final.
#[derive(Debug, Clone, PartialEq, Eq)]
struct State {
    key: String,
    code: i64,
    is_final: bool,
}

/// An event of a machine: its key, its number (its place in the definition, from 1; B-6) and its edges, each a pair of state
/// positions (from, to).
#[derive(Debug, Clone, PartialEq, Eq)]
struct Event {
    key: String,
    number: i64,
    edges: Vec<(usize, usize)>,
}

/// The result of `apply`: the state that the event leads to, and whether the stored state changed (B-4, B-6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
    /// The key of the state that the event leads to.
    pub to: String,
    /// Whether the stored state was the expected state, so that the caller writes `to`.
    pub changed: bool,
}

/// A state machine: its states, its events and the codes that its lock reserves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Machine {
    name: String,
    states: Vec<State>,
    events: Vec<Event>,
    initial: usize,
    reserved: Vec<i64>,
}

/// A refusal of the definition, with the JSON path of the part that the core cannot run.
fn refused(path: &str, message: &str) -> Error {
    Error::InvalidDefinition { message: format!("{path}: {message}") }
}

/// The object at `path`, whose fields are among `fields`.
fn object<'a>(value: &'a Value, path: &str, fields: &[&str]) -> Result<&'a Map<String, Value>, Error> {
    let Value::Object(map) = value else { return Err(refused(path, "it must be an object")) };
    if let Some(field) = map.keys().find(|field| !fields.contains(&field.as_str())) {
        return Err(refused(path, &format!("{field} is not a field")));
    }
    Ok(map)
}

/// The string field `name` of `map` at `path`.
fn text(map: &Map<String, Value>, path: &str, name: &str) -> Result<String, Error> {
    match map.get(name) {
        Some(Value::String(value)) => Ok(value.clone()),
        _ => Err(refused(&format!("{path}.{name}"), "it must be a string")),
    }
}

/// The array field `name` of `map` at `path`.
fn items<'a>(map: &'a Map<String, Value>, path: &str, name: &str) -> Result<&'a Vec<Value>, Error> {
    match map.get(name) {
        Some(Value::Array(values)) => Ok(values),
        _ => Err(refused(&format!("{path}.{name}"), "it must be an array")),
    }
}

/// The boolean field `name` of `map` at `path`; an absent field is false (B-1).
fn flag(map: &Map<String, Value>, path: &str, name: &str) -> Result<bool, Error> {
    match map.get(name) {
        None => Ok(false),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(refused(&format!("{path}.{name}"), "it must be a boolean")),
    }
}

impl Machine {
    /// Reads a machine from the JSON text of its definition (B-1) and the codes that its lock reserves. A definition that the
    /// core cannot run is `invalid_definition`: a missing or unknown field, a value of another type, a repeated state or event
    /// key, a repeated or reserved code, a code outside 1 to 2147483647, an edge to no state, not exactly one initial state, or
    /// two targets for one state and event. The other rules of B-5 are findings of the compiler.
    ///
    /// # Errors
    /// [`Error::InvalidDefinition`] names the JSON path of the refused part.
    pub fn parse(definition: &str, reserved: &[i64]) -> Result<Machine, Error> {
        let value: Value = serde_json::from_str(definition).map_err(|error| refused("$", &format!("it is not JSON: {error}")))?;
        let root = object(&value, "$", MACHINE_FIELDS)?;
        let name = text(root, "$", "machine")?;
        let mut states: Vec<State> = Vec::new();
        let mut initials = Vec::new();
        for (index, item) in items(root, "$", "states")?.iter().enumerate() {
            let path = format!("$.states[{index}]");
            let map = object(item, &path, STATE_FIELDS)?;
            let key = text(map, &path, "key")?;
            let code = match map.get("code").and_then(Value::as_i64) {
                Some(code) if (1..=CODE_MAX).contains(&code) => code,
                _ => return Err(refused(&format!("{path}.code"), "it must be an integer from 1 to 2147483647")),
            };
            if states.iter().any(|state| state.key == key) {
                return Err(refused(&format!("{path}.key"), &format!("the state key {key} is repeated")));
            }
            if states.iter().any(|state| state.code == code) || reserved.contains(&code) {
                return Err(refused(&format!("{path}.code"), &format!("the code {code} is repeated or reserved")));
            }
            if flag(map, &path, "initial")? {
                initials.push(index);
            }
            states.push(State { key, code, is_final: flag(map, &path, "final")? });
        }
        let [initial] = initials[..] else {
            return Err(refused("$.states", &format!("{} states are initial; exactly one must be", initials.len())));
        };
        let position = |path: &str, map: &Map<String, Value>, name: &str| -> Result<usize, Error> {
            let key = text(map, path, name)?;
            states
                .iter()
                .position(|state| state.key == key)
                .ok_or_else(|| refused(&format!("{path}.{name}"), &format!("{key} is not a state")))
        };
        let mut events: Vec<Event> = Vec::new();
        for (index, item) in items(root, "$", "events")?.iter().enumerate() {
            let path = format!("$.events[{index}]");
            let map = object(item, &path, EVENT_FIELDS)?;
            let key = text(map, &path, "key")?;
            if events.iter().any(|event| event.key == key) {
                return Err(refused(&format!("{path}.key"), &format!("the event key {key} is repeated")));
            }
            let mut edges: Vec<(usize, usize)> = Vec::new();
            for (number, edge) in items(map, &path, "edges")?.iter().enumerate() {
                let edge_path = format!("{path}.edges[{number}]");
                let edge_map = object(edge, &edge_path, EDGE_FIELDS)?;
                let from = position(&edge_path, edge_map, "from")?;
                let to = position(&edge_path, edge_map, "to")?;
                if edges.iter().any(|(other, target)| *other == from && *target != to) {
                    return Err(refused(&edge_path, "the event has two targets from one state"));
                }
                edges.push((from, to));
            }
            let number = i64::try_from(index + 1).map_err(|error| refused(&path, &format!("the event has no number: {error}")))?;
            events.push(Event { key, number, edges });
        }
        Ok(Machine { name, states, events, initial, reserved: reserved.to_vec() })
    }

    /// The key of the machine.
    #[must_use]
    pub fn name(&self) -> String {
        self.name.clone()
    }

    /// The key of the initial state.
    #[must_use]
    pub fn initial(&self) -> String {
        self.states[self.initial].key.clone()
    }

    /// The position of the state `key`.
    fn state(&self, key: &str) -> Result<usize, Error> {
        self.states
            .iter()
            .position(|state| state.key == key)
            .ok_or_else(|| Error::UnknownState { machine: self.name.clone(), key: key.to_owned() })
    }

    /// The position of the event `key`.
    fn event(&self, key: &str) -> Result<usize, Error> {
        self.events
            .iter()
            .position(|event| event.key == key)
            .ok_or_else(|| Error::UnknownEvent { machine: self.name.clone(), key: key.to_owned() })
    }

    /// The code of the state at `position`, a position that `parse` or `state` gave.
    fn code_at(&self, position: usize) -> i64 {
        self.states[position].code
    }

    /// The code of a state (B-6).
    ///
    /// # Errors
    /// [`Error::UnknownState`] for a key that is no state.
    pub fn code(&self, state: &str) -> Result<i64, Error> {
        self.state(state).map(|position| self.code_at(position))
    }

    /// The key of the state of a code: `from_code` under the name of the feature `key` (B-6).
    ///
    /// # Errors
    /// [`Error::ReservedCode`] for a reserved code and [`Error::UnknownCode`] for any other code that is no state.
    pub fn key(&self, code: i64) -> Result<String, Error> {
        self.from_code(code)
    }

    /// The state of a code (B-6): the only raw entry, which a caller that holds a stored code passes before any function that
    /// takes a state.
    ///
    /// # Errors
    /// [`Error::ReservedCode`] for a reserved code and [`Error::UnknownCode`] for any other code that is no state.
    pub fn from_code(&self, code: i64) -> Result<String, Error> {
        if let Some(state) = self.states.iter().find(|state| state.code == code) {
            return Ok(state.key.clone());
        }
        if self.reserved.contains(&code) {
            return Err(Error::ReservedCode { machine: self.name.clone(), code });
        }
        Err(Error::UnknownCode { machine: self.name.clone(), code })
    }

    /// Whether a state is final.
    ///
    /// # Errors
    /// [`Error::UnknownState`] for a key that is no state.
    pub fn is_final(&self, state: &str) -> Result<bool, Error> {
        let position = self.state(state)?;
        Ok(self.states[position].is_final)
    }

    /// The keys of the events that have an edge from a state, in declaration order.
    ///
    /// # Errors
    /// [`Error::UnknownState`] for a key that is no state.
    pub fn events_from(&self, state: &str) -> Result<Vec<String>, Error> {
        let position = self.state(state)?;
        Ok(self
            .events
            .iter()
            .filter(|event| event.edges.iter().any(|(from, _)| *from == position))
            .map(|event| event.key.clone())
            .collect())
    }

    /// The position of the target of the event at `event` from the state at `expected`, positions that `state` and `event`
    /// gave.
    fn target_at(&self, expected: usize, event: usize) -> Result<usize, Error> {
        let found = &self.events[event];
        found.edges.iter().find(|(from, _)| *from == expected).map(|(_, to)| *to).ok_or_else(|| Error::InvalidTransition {
            machine: self.name.clone(),
            expected: self.code_at(expected),
            event: found.number,
        })
    }

    /// The state that an event leads to from the expected state (B-4).
    ///
    /// # Errors
    /// [`Error::UnknownState`] and [`Error::UnknownEvent`] for a key that the machine lacks, and
    /// [`Error::InvalidTransition`] when the event has no edge from the state.
    pub fn target(&self, expected: &str, event: &str) -> Result<String, Error> {
        let to = self.target_at(self.state(expected)?, self.event(event)?)?;
        Ok(self.states[to].key.clone())
    }

    /// Applies an event that the observed state `expected` leads to, when the stored state is `actual` (B-4): changed when
    /// the stored state is the expected state, unchanged when it is already the target.
    ///
    /// # Errors
    /// [`Error::UnknownState`] and [`Error::UnknownEvent`] for a key that the machine lacks, [`Error::InvalidTransition`]
    /// when the event has no edge from the expected state, and [`Error::Conflict`] when the stored state is neither.
    pub fn apply(&self, expected: &str, event: &str, actual: &str) -> Result<Step, Error> {
        let expected = self.state(expected)?;
        let event = self.event(event)?;
        let actual = self.state(actual)?;
        let to = self.target_at(expected, event)?;
        let key = self.states[to].key.clone();
        if actual == expected {
            return Ok(Step { to: key, changed: true });
        }
        if actual == to {
            return Ok(Step { to: key, changed: false });
        }
        Err(Error::Conflict {
            machine: self.name.clone(),
            expected: self.code_at(expected),
            actual: self.code_at(actual),
            event: self.events[event].number,
        })
    }

    /// The findings of B-5 of every machine of `definitions`, the JSON text of a list of machine objects without `$schema`,
    /// in document order within a machine and in input order across machines (FSM-B7-4). An empty list means that the
    /// definitions are valid.
    ///
    /// # Errors
    /// [`Error::InvalidDefinition`] when `definitions` is not JSON.
    pub fn validate(definitions: &str) -> Result<Vec<Finding>, Error> {
        crate::validate::validate(definitions)
    }
}
