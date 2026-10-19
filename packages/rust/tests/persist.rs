// The persistence tests of the rust package beyond the vector cases (docs/spec/fsm.md, B-4): two transitions of one row that run
// at the same time, each on its own connection, give the outcome that the pattern promises, and a deadlock runs the transaction
// again while another database error does not. Each test is named by its feature unit of config/parity.json. They run on the
// dialect of FSM_TEST_DIALECT (tests/common/mod.rs).

mod common;
#[allow(dead_code, reason = "the example has more functions than these tests call; its transition is the one of conformance.rs")]
#[path = "../examples/persist.rs"]
mod persist;

use common::{persist_dsn, scratch_directory, server_cases, Scratch};
use fsm_rust::fsm::{Code, Error};
use fsm_rust::order::{self, Event, State};
use polyspec_orm::Db;
use std::sync::MutexGuard;

/// The step of the order machine from the observed state `expected` by `event` on the stored code.
fn decide(expected: State, event: Event) -> impl Fn(i64) -> Result<(i32, bool), Error> {
    move |stored| {
        let step = order::apply(expected, event, order::from_code(stored)?)?;
        Ok((order::code(step.to), step.changed))
    }
}

/// `count` connections to one persist database of the dialect, the rows cleared and row 1 seeded in draft, with the guard that
/// serializes the cases of a server dialect and the scratch directory that holds a sqlite file.
async fn connections(count: usize) -> (Option<MutexGuard<'static, ()>>, Scratch, Vec<Db>) {
    let scratch = scratch_directory();
    let (dialect, dsn) = persist_dsn(&scratch);
    let serial = server_cases(&dialect);
    let mut opened = Vec::with_capacity(count);
    for _ in 0..count {
        let db = persist::open(&dsn).await.expect("open the persist database");
        assert_eq!(db.driver(), dialect, "the database dialect");
        opened.push(db);
    }
    persist::clear(&opened[0]).await.expect("clear the persist table");
    persist::seed(&opened[0], 1, order::code(State::Draft)).await.expect("seed the row");
    (serial, scratch, opened)
}

/// Closes the connections of a test.
async fn close(dbs: Vec<Db>) {
    for db in dbs {
        db.close().await;
    }
}

#[tokio::test]
// FSM-B4-1: two transitions of one (expected, event) at the same time: one Changed, one Unchanged (the row lock).
async fn persist_concurrent_same_event() {
    let (_serial, _scratch, dbs) = connections(2).await;
    let (first, second) = tokio::join!(
        persist::transition(&dbs[0], 1, decide(State::Draft, Event::Next)),
        persist::transition(&dbs[1], 1, decide(State::Draft, Event::Next)),
    );
    let paid = order::code(State::Paid);
    let mut changed = Vec::new();
    for outcome in [first, second] {
        let (to, change) = outcome.expect("both transitions succeed");
        assert_eq!(to, paid);
        changed.push(change);
    }
    changed.sort_unstable();
    assert_eq!(changed, [false, true], "one Changed and one Unchanged");
    assert_eq!(persist::status_of(&dbs[0], 1).await.expect("read the row"), paid);
    close(dbs).await;
}

#[tokio::test]
// FSM-B4-2: two transitions from one expected state with different events at the same time: one Changed, one E_CONFLICT.
async fn persist_concurrent_conflict() {
    let (_serial, _scratch, dbs) = connections(2).await;
    let (first, second) = tokio::join!(
        persist::transition(&dbs[0], 1, decide(State::Draft, Event::Next)),
        persist::transition(&dbs[1], 1, decide(State::Draft, Event::Cancel)),
    );
    let (changed, failed): (Vec<_>, Vec<_>) = [first, second].into_iter().partition(Result::is_ok);
    assert_eq!((changed.len(), failed.len()), (1, 1), "one Changed and one error");
    let (to, change) = changed.into_iter().next().expect("one changed run").expect("an Ok outcome");
    assert!(change, "the successful transition changes the row");
    match failed.into_iter().next().expect("one failed run") {
        Err(persist::Failure::Machine(error)) => assert_eq!(error.code, Code::Conflict, "the error is {error}"),
        other => panic!("want E_CONFLICT, got {other:?}"),
    }
    assert_eq!(persist::status_of(&dbs[0], 1).await.expect("read the row"), to);
    close(dbs).await;
}

/// The first attempt fails with a DEADLOCK error before the row is read; the second attempt changes it.
#[tokio::test]
// FSM-B4-3: a deadlock inside the transaction runs the transaction again.
async fn persist_retry_on_deadlock() {
    let (_serial, _scratch, dbs) = connections(1).await;
    let attempts = std::cell::Cell::new(0u32);
    let outcome = persist::transition_with_fault(&dbs[0], 1, decide(State::Draft, Event::Next), || {
        let attempt = attempts.get();
        attempts.set(attempt + 1);
        if attempt == 0 {
            Err(polyspec_orm::tx::transaction_conflict("injected deadlock"))
        } else {
            Ok(())
        }
    })
    .await;
    assert_eq!(attempts.get(), 2, "the callback runs again after a deadlock");
    assert_eq!(outcome.expect("the second attempt commits"), (order::code(State::Paid), true));
    assert_eq!(persist::status_of(&dbs[0], 1).await.expect("read the row"), order::code(State::Paid));
    close(dbs).await;
}

/// A database error other than a deadlock is returned after one attempt, and the row keeps its state.
#[tokio::test]
// FSM-B4-4: another database error is returned after one attempt, with no second run.
async fn persist_no_retry_on_other_error() {
    let (_serial, _scratch, dbs) = connections(1).await;
    let attempts = std::cell::Cell::new(0u32);
    let outcome = persist::transition_with_fault(&dbs[0], 1, decide(State::Draft, Event::Next), || {
        attempts.set(attempts.get() + 1);
        Err(polyspec_orm::Error::Config("injected".into()))
    })
    .await;
    assert_eq!(attempts.get(), 1, "a database error other than a deadlock is not run again");
    assert!(matches!(outcome, Err(persist::Failure::Database(_))), "the error is returned");
    assert_eq!(persist::status_of(&dbs[0], 1).await.expect("read the row"), order::code(State::Draft));
    close(dbs).await;
}
