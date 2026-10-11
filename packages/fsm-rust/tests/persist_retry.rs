// The retry tests of the rust persistence example (docs/spec/fsm.md, B-4): a deadlock runs the transaction again, and another
// database error does not. They are a tool test with their own record (make rust-persist-test), not vector cases: the record of
// the rust kind (tests/conformance.rs) holds the vector cases alone for kit's parity check (docs/plans/fsm-v1.md, C-4).

// The example has more functions than these tests call (its transition is the one of conformance.rs).
#[allow(dead_code)]
#[path = "../examples/persist.rs"]
mod persist;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

/// Removes the directory of a persist case when the case ends, also when it panics.
struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A directory of this run that no other persist case uses.
fn scratch_directory() -> Scratch {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("the clock is after 1970")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "fsm-rust-persist-{}-{nanos}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).expect("create the directory of the persist case");
    Scratch(dir)
}

/// Asserts that the transaction runs the callback again after a deadlock, and that it does not after another database error
/// (docs/spec/fsm.md, B-4). The first attempt fails with a DEADLOCK error before the row is read; the second attempt changes it.
#[tokio::test]
async fn persist_runs_again_on_a_deadlock() {
    let scratch = scratch_directory();
    let dsn = format!("sqlite://{}/persist.db", scratch.0.display());
    let db = persist::open(&dsn).await.expect("open the persist database");
    persist::seed(&db, 1, 1).await.expect("seed the row");
    let attempts = std::cell::Cell::new(0u32);
    let outcome = persist::transition_with_fault(
        &db,
        1,
        |stored| Ok((i32::try_from(stored + 1).expect("a small code"), true)),
        || {
            let attempt = attempts.get();
            attempts.set(attempt + 1);
            if attempt == 0 {
                Err(polyspec_orm::tx::transaction_conflict("injected deadlock"))
            } else {
                Ok(())
            }
        },
    )
    .await;
    assert_eq!(attempts.get(), 2, "the callback runs again after a deadlock");
    assert_eq!(outcome.expect("the second attempt commits"), (2, true));
    assert_eq!(persist::status_of(&db, 1).await.expect("read the row"), 2);
    db.close().await;
}

/// Asserts that a database error other than a deadlock is returned after one attempt.
#[tokio::test]
async fn persist_does_not_run_again_on_another_error() {
    let scratch = scratch_directory();
    let dsn = format!("sqlite://{}/persist.db", scratch.0.display());
    let db = persist::open(&dsn).await.expect("open the persist database");
    persist::seed(&db, 1, 1).await.expect("seed the row");
    let attempts = std::cell::Cell::new(0u32);
    let outcome = persist::transition_with_fault(
        &db,
        1,
        |stored| Ok((i32::try_from(stored + 1).expect("a small code"), true)),
        || {
            attempts.set(attempts.get() + 1);
            Err(polyspec_orm::Error::Config("injected".into()))
        },
    )
    .await;
    assert_eq!(attempts.get(), 1, "a database error other than a deadlock is not run again");
    assert!(matches!(outcome, Err(persist::Failure::Database(_))), "the error is returned");
    db.close().await;
}
