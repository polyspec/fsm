//! The errors of the core: one variant per kind (docs/spec/fsm.md, B-4 to B-6), so a caller matches every kind without a
//! wildcard arm, and the kind interface that the generated bindings read (binding design E-1).

use std::fmt;

/// Why the core refused a call. [`Error::kind`] is the name of the kind, the same in every binding; the codes of a state or of
/// an event (the position of the event in the definition, from 1) are the fields that B-4 and B-6 name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// `apply`: the stored state is neither the expected state nor the state that the event leads to (E_CONFLICT, B-4).
    Conflict { machine: String, expected: i64, actual: i64, event: i64 },
    /// `target` and `apply`: the event has no edge from the expected state (E_INVALID_TRANSITION, B-4).
    InvalidTransition { machine: String, expected: i64, event: i64 },
    /// `key` and `from_code`: the code is no state and is not reserved (E_UNKNOWN_CODE, B-6).
    UnknownCode { machine: String, code: i64 },
    /// `key` and `from_code`: the code is reserved by the lock and is no state (E_RESERVED_CODE, B-6).
    ReservedCode { machine: String, code: i64 },
    /// A state key that is no state of the machine.
    UnknownState { machine: String, key: String },
    /// An event key that is no event of the machine.
    UnknownEvent { machine: String, key: String },
    /// `Machine::parse`: the definition is not a machine that the core can run (B-1).
    InvalidDefinition { message: String },
}

impl Error {
    /// The name of the kind, the same in every binding.
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::Conflict { .. } => "conflict",
            Self::InvalidTransition { .. } => "invalid_transition",
            Self::UnknownCode { .. } => "unknown_code",
            Self::ReservedCode { .. } => "reserved_code",
            Self::UnknownState { .. } => "unknown_state",
            Self::UnknownEvent { .. } => "unknown_event",
            Self::InvalidDefinition { .. } => "invalid_definition",
        }
    }

    /// The fields of B-4 and B-6 of the error: the code of the expected state, the code of the stored state and the number of
    /// the event (its place in the definition, from 1), each none where it does not apply (FSM-B7-5).
    const fn fields(&self) -> (Option<i64>, Option<i64>, Option<i64>) {
        match self {
            Self::Conflict { expected, actual, event, .. } => (Some(*expected), Some(*actual), Some(*event)),
            Self::InvalidTransition { expected, event, .. } => (Some(*expected), None, Some(*event)),
            Self::UnknownCode { .. }
            | Self::ReservedCode { .. }
            | Self::UnknownState { .. }
            | Self::UnknownEvent { .. }
            | Self::InvalidDefinition { .. } => (None, None, None),
        }
    }

    /// The code of the expected state, for `conflict` and `invalid_transition` (B-4; the property `expected` of the error
    /// class `machine_error`, FSM-B7-5), none for the other kinds.
    #[must_use]
    pub const fn expected(&self) -> Option<i64> {
        self.fields().0
    }

    /// The code of the stored state, for `conflict` (B-4; the property `actual` of `machine_error`, FSM-B7-5), none for the
    /// other kinds.
    #[must_use]
    pub const fn actual(&self) -> Option<i64> {
        self.fields().1
    }

    /// The number of the event, for `conflict` and `invalid_transition` (B-4; the property `event` of `machine_error`,
    /// FSM-B7-5), none for the other kinds.
    #[must_use]
    pub const fn event(&self) -> Option<i64> {
        self.fields().2
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Conflict { machine, expected, actual, event } => {
                write!(f, "{machine}: the stored state {actual} is neither {expected} nor the state that the event {event} leads to")
            }
            Self::InvalidTransition { machine, expected, event } => {
                write!(f, "{machine}: the event {event} has no edge from {expected}")
            }
            Self::UnknownCode { machine, code } => write!(f, "{machine}: {code} is not a state of {machine}"),
            Self::ReservedCode { machine, code } => write!(f, "{machine}: code {code} is reserved and is no state of {machine}"),
            Self::UnknownState { machine, key } => write!(f, "{machine}: {key} is not a state of {machine}"),
            Self::UnknownEvent { machine, key } => write!(f, "{machine}: {key} is not an event of {machine}"),
            Self::InvalidDefinition { message } => write!(f, "the definition is not a machine: {message}"),
        }
    }
}

impl std::error::Error for Error {}

impl binding_core::Kinds for Error {
    fn kind(&self) -> &'static str {
        Error::kind(self)
    }

    /// No kind of fsm is an HTTP failure.
    fn status(&self) -> Option<u16> {
        None
    }

    /// No kind of fsm is an I/O failure.
    fn errno(&self) -> Option<i32> {
        None
    }
}
