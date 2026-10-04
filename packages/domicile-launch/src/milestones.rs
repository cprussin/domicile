//! Startup milestones, and the error when one is not reached.
//!
//! A failed startup otherwise shows only a blank window. Each milestone
//! reports what was observed (a missing socket, an exited component) and what
//! to check. It does not guess the cause.
//!
//! A milestone is a description, a timeout and a predicate; call [`reach`]
//! before the next step. `bin/domicile.rs` defines them. Failures only the far
//! end can see are reported there; see [`crate::handshake`].

use std::time::Duration;

use crate::supervise::Exit;

/// A condition startup must reach.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Milestone {
    /// What is awaited, as a sentence subject including the path, e.g. "the
    /// engine's broker socket at /run/user/1000/domicile-7/broker".
    pub awaited: String,
    /// What to check if it is not reached.
    pub check: String,
    /// The timeout.
    pub patience: Duration,
}

/// Why startup did not reach a milestone.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Stalled {
    /// A component exited. Reported even if the milestone was also observed,
    /// since a socket with no listener is not progress.
    #[error("{exit}; {awaited} never turned up.\n{check}")]
    Exited {
        exit: Exit,
        awaited: String,
        check: String,
    },
    /// A stop was requested during startup.
    #[error("stopped before {awaited} turned up.")]
    Stopped { awaited: String },
    /// The timeout passed with everything still running.
    #[error("{awaited} has not turned up after {seconds}s.\n{check}")]
    Waited {
        awaited: String,
        seconds: u64,
        check: String,
    },
}

/// Waits for `milestone`, or says why startup stalled.
///
/// The callbacks are injected for testing: `observed` checks the milestone,
/// `exited` checks for an exited component, `stopped` checks for a stop
/// request, and `tick` sleeps and returns the elapsed time.
///
/// Check order matters:
/// - `exited` comes first, so a crash is reported as the cause instead of a
///   timeout.
/// - `stopped` comes before `observed`, so `SIGINT` or `SIGTERM` during
///   startup stops the run promptly. Otherwise the follow-up `SIGKILL` could
///   skip teardown in `Running::drop` and leave the engine holding the tty,
///   input devices and logind session control.
pub fn reach(
    milestone: &Milestone,
    observed: &dyn Fn() -> bool,
    exited: &mut dyn FnMut() -> Option<Exit>,
    stopped: &dyn Fn() -> bool,
    tick: &mut dyn FnMut() -> Duration,
) -> Result<(), Stalled> {
    loop {
        if let Some(exit) = exited() {
            return Err(Stalled::Exited {
                awaited: milestone.awaited.clone(),
                check: milestone.check.clone(),
                exit,
            });
        }
        if stopped() {
            return Err(Stalled::Stopped {
                awaited: milestone.awaited.clone(),
            });
        }
        if observed() {
            return Ok(());
        }
        if tick() >= milestone.patience {
            return Err(Stalled::Waited {
                awaited: milestone.awaited.clone(),
                check: milestone.check.clone(),
                seconds: milestone.patience.as_secs(),
            });
        }
    }
}
