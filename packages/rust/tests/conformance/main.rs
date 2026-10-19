// The conformance tests of the rust package (docs/plans/fsm-v1/plan.md, C-4), the crate root of the test target conformance.
// tests/conformance/vectors.rs, its module, is generated from the core oracle: one #[test] per vector case, named
// test_<feature>__<id>, which calls the check functions below with the values of its case. The persist cases run the B-4
// transaction through examples/persist.rs on the dialect of FSM_TEST_DIALECT (sqlite by default; docs/plans/fsm-v1/plan.md, C-6). The
// names follow docs/spec/fsm.md, B-6.

#[path = "../common/mod.rs"]
mod common;
#[path = "../../examples/persist.rs"]
mod persist;
mod vectors;

use fsm_rust::fsm::{Code, Error};
use common::{persist_dsn, scratch_directory, server_cases};
use std::fmt::Debug;

/// Asserts that a value of a feature is the expected value (initial, code, is_final).
pub fn check_value<T: PartialEq + Debug>(actual: T, expect: T) {
    assert_eq!(actual, expect);
}

/// Asserts that the states or events of a feature are the expected list, in order (events_from).
pub fn check_slice<T: PartialEq + Debug>(actual: &[T], expect: &[T]) {
    assert_eq!(actual, expect);
}

/// The error that a case expects: its code and the three fields of fsm.Error (docs/spec/fsm.md, B-4 and B-6). A field that does
/// not apply is None, which is null in the vectors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Expected {
    pub code: Code,
    pub expected: Option<i32>,
    pub actual: Option<i32>,
    pub event: Option<i32>,
}

impl Expected {
    /// The expectation that an error satisfies: its code and its three fields.
    fn of(error: &Error) -> Expected {
        Expected { code: error.code, expected: error.expected, actual: error.actual, event: error.event }
    }
}

/// Asserts a result: Ok with the expected value, or Err with the expected error code and fields (key, from_code, target and apply).
pub fn check_result<T: PartialEq + Debug>(actual: Result<T, Error>, expect: Result<T, Expected>) {
    match (actual, expect) {
        (Ok(actual), Ok(expect)) => assert_eq!(actual, expect),
        (Err(error), Err(expect)) => assert_eq!(Expected::of(&error), expect, "the error is {error}"),
        (actual, expect) => panic!("expected {expect:?}, got {actual:?}"),
    }
}

/// Asserts one persist case (docs/spec/fsm.md, B-4). The row starts with the code `stored`; one transition runs with `decide`,
/// the machine's step on the stored code; its outcome is `expect` (the code of the target and whether it changed, or the error
/// code); and the row then holds the code `stored_after`.
pub async fn check_persist(
    stored: i32,
    decide: impl Fn(i64) -> Result<(i32, bool), Error>,
    expect: Result<(i32, bool), Expected>,
    stored_after: i32,
) {
    let scratch = scratch_directory();
    let (dialect, dsn) = persist_dsn(&scratch);
    let _serial = server_cases(&dialect);
    let db = persist::open(&dsn)
        .await
        .expect("open the persist database");
    assert_eq!(db.driver(), dialect, "the database dialect");
    if dialect != "sqlite" {
        persist::clear(&db).await.expect("clear the persist table");
    }
    persist::seed(&db, 1, stored).await.expect("seed the row");
    let outcome = match persist::transition(&db, 1, decide).await {
        Ok(step) => Ok(step),
        Err(persist::Failure::Machine(error)) => Err(error),
        Err(other) => panic!("the transaction failed in the database: {other:?}"),
    };
    check_result(outcome, expect);
    let row = persist::status_of(&db, 1).await.expect("read the row");
    assert_eq!(row, stored_after, "the stored code after the run");
    db.close().await;
}
