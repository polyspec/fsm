//! The entry point that the test files of the core share: each loads its trials and runs them with libtest-mimic.

use libtest_mimic::{Arguments, Failed, Trial};

/// Runs `trials` with the arguments of the command line, or reports that `what` did not load.
pub fn run_trials(what: &str, trials: Result<Vec<Trial>, Failed>) -> std::process::ExitCode {
    let arguments = Arguments::from_args();
    match trials {
        Ok(trials) => libtest_mimic::run(&arguments, trials).exit_code(),
        Err(error) => {
            eprintln!("{what} did not load: {error:?}");
            std::process::ExitCode::FAILURE
        }
    }
}
