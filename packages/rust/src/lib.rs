//! The core of fsm (docs/spec/fsm.md, B-1 to B-7): a state machine read from its definition, the codes and keys of its states,
//! and its transitions. A state and an event are named by their keys and a code is an `i64`, the types of the interface
//! contract `interface.json` from which binding generates the bindings.

mod error;
mod machine;

pub use error::Error;
pub use machine::{Machine, Step};
