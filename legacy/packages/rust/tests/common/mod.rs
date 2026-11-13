// The dialect of the persist tests (docs/plans/fsm-v1/plan.md, C-6), the shared module of the test crates tests/conformance/ and
// tests/persist.rs: the scratch directory of a case, the DSN of FSM_TEST_DIALECT and the guard that serializes the cases of a
// server dialect.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

/// Removes the directory of a persist case when the case ends, also when it panics.
pub struct Scratch(pub PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        // A failed removal is reported, not hidden, and does not panic: a panic while the case unwinds would abort the run.
        if let Err(error) = std::fs::remove_dir_all(&self.0) {
            eprintln!("remove the directory of the persist case {}: {error}", self.0.display());
        }
    }
}

/// A directory of this run that no other persist case uses.
pub fn scratch_directory() -> Scratch {
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

/// The database of the persist cases (docs/plans/fsm-v1/plan.md, C-6): FSM_TEST_DIALECT names the dialect, sqlite by default. sqlite is a new
/// file of the case's scratch directory; postgres and mysql take their DSN from FSM_TEST_PG_DSN or FSM_TEST_MYSQL_DSN, and a missing
/// DSN fails the case, so no dialect is skipped. The DSN of the dialect is returned with its name.
pub fn persist_dsn(scratch: &Scratch) -> (String, String) {
    let dialect = match std::env::var("FSM_TEST_DIALECT") {
        Ok(dialect) => dialect,
        Err(std::env::VarError::NotPresent) => "sqlite".to_string(),
        Err(error) => panic!("FSM_TEST_DIALECT cannot be read: {error}"),
    };
    let variable = match dialect.as_str() {
        "sqlite" => return (dialect, format!("sqlite://{}/persist.db", scratch.0.display())),
        "postgres" => "FSM_TEST_PG_DSN",
        "mysql" => "FSM_TEST_MYSQL_DSN",
        other => panic!("FSM_TEST_DIALECT must be sqlite, postgres or mysql, it is {other:?}"),
    };
    match std::env::var(variable) {
        Ok(dsn) if !dsn.is_empty() => (dialect, dsn),
        _ => panic!("{variable} is not set: the {dialect} persist cases need a database DSN and never skip"),
    }
}

/// Serializes the persist cases of a server dialect: they share one table, and each case clears it before it seeds its row.
static SERVER_CASES: Mutex<()> = Mutex::new(());

// The lock guards no data. A case that panics poisons it, and that case reports its own failure, so the next case takes the
// guard and runs instead of failing for the poison.
/// The guard that serializes a persist case on a server dialect while it lives; none on sqlite, whose case has its own file.
#[allow(clippy::disallowed_methods, reason = "the lock guards no data; poison is harmless")]
pub fn server_cases(dialect: &str) -> Option<MutexGuard<'static, ()>> {
    if dialect == "sqlite" {
        None
    } else {
        Some(SERVER_CASES.lock().unwrap_or_else(|poisoned| poisoned.into_inner()))
    }
}
