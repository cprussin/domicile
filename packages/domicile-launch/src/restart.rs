//! Restarts failed components with backoff.
//!
//! - An engine that dies is restarted under the running compositor
//!   ([`keep_the_engine_up`]). Wayland clients keep their windows. On a TTY
//!   the screen is dark between engines.
//! - A compositor that dies takes the engine with it, since the engine's
//!   control channel cannot reconnect, and a new desktop starts
//!   ([`keep_a_desktop_up`]). Apps lose their Wayland display.
//!
//! Both loops share [`Policy`] but count failures separately, so a crashing
//! engine does not use up the desktop's restarts. Startup checks in
//! `bin/domicile.rs` are not retried; they give the same answer each time.
//!
//! See "Engine crashes are recovered; compositor crashes restart the desktop"
//! in `docs/architecture/THE-DOMICILE-BINARY.md`.

use std::path::Path;
use std::time::Duration;

use crate::spawn::Runtime;

/// Backoff and give-up limits for restarts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    /// Wait after the first failure in a row.
    pub first_wait: Duration,
    /// Maximum wait between attempts.
    pub longest_wait: Duration,
    /// Consecutive failures that end the run.
    pub give_up_after: u32,
    /// Uptime after which a failure resets the count.
    pub long_enough: Duration,
}

impl Default for Policy {
    /// Four restarts over about 15 seconds, then stop.
    ///
    /// A 1 s first wait keeps a component that crashes on startup from
    /// spinning a core; startup takes longer than that anyway. Faults that
    /// survive several restarts won't be fixed by more, and stopping soon hands
    /// the tty back while someone is watching.
    fn default() -> Self {
        Policy {
            first_wait: Duration::from_secs(1),
            longest_wait: Duration::from_secs(8),
            give_up_after: 5,
            long_enough: Duration::from_secs(60),
        }
    }
}

/// What is being restarted, for the message the user sees.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Started {
    Desktop,
    Engine,
}

impl std::fmt::Display for Started {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        out.write_str(match self {
            Started::Desktop => "desktop",
            Started::Engine => "engine",
        })
    }
}

/// What happens after a failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Next {
    #[error(
        "starting the {started} again in {after:?} — that is failure {failures} of {of} in a row."
    )]
    Again {
        started: Started,
        after: Duration,
        failures: u32,
        of: u32,
    },
    // `bin/domicile.rs` prints the compositor's error under this message; see
    // `crate::heard`.
    #[error(
        "{failures} {started}s in a row have failed, so this one is not being \
         started again."
    )]
    GiveUp { started: Started, failures: u32 },
}

/// The outcome of one desktop or engine run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Attempt {
    /// A component exited cleanly. Nothing to restart.
    Ended,
    /// It stopped unexpectedly after running for `lived`. The cause is
    /// reported where it happened.
    Failed { lived: Duration },
}

/// How a run of desktops finished.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ending {
    /// A desktop ended cleanly.
    Over,
    /// A stop was asked for.
    Stopped,
    /// Enough failed in a row.
    GaveUp { failures: u32 },
}

/// A file from the last desktop that could not be removed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "{path} is what the last desktop left behind and it cannot be taken away \
     ({kind:?}), so there is nowhere to start another one"
)]
pub struct Leftover {
    pub path: String,
    pub kind: std::io::ErrorKind,
}

/// Runs desktops, starting a new one whenever one fails.
///
/// `attempt` runs one desktop and blocks while it is up. `wait` sleeps for the
/// backoff. `say` reports each restart.
///
/// `stopped` is checked after each attempt and after each wait. A Ctrl-C also
/// kills components, which looks like a crash, so the check after an attempt
/// prevents a restart on shutdown. The check after a wait catches a stop
/// requested while nothing was running.
pub fn keep_a_desktop_up(
    policy: &Policy,
    attempt: &mut dyn FnMut() -> Attempt,
    stopped: &dyn Fn() -> bool,
    wait: &mut dyn FnMut(Duration),
    say: &mut dyn FnMut(&Next),
) -> Ending {
    keep_it_up(policy, Started::Desktop, attempt, stopped, wait, say)
}

/// Runs engines under a live compositor, restarting each one that dies.
///
/// Failures are counted separately from desktop failures, since the
/// compositor is still working.
///
/// [`Attempt::Ended`] means the compositor exited, so there is nothing to run
/// an engine under. On [`Ending::GaveUp`] the caller tears down the desktop and
/// [`keep_a_desktop_up`] starts a new one.
pub fn keep_the_engine_up(
    policy: &Policy,
    attempt: &mut dyn FnMut() -> Attempt,
    stopped: &dyn Fn() -> bool,
    wait: &mut dyn FnMut(Duration),
    say: &mut dyn FnMut(&Next),
) -> Ending {
    keep_it_up(policy, Started::Engine, attempt, stopped, wait, say)
}

/// The restart loop shared by [`keep_a_desktop_up`] and
/// [`keep_the_engine_up`].
fn keep_it_up(
    policy: &Policy,
    started: Started,
    attempt: &mut dyn FnMut() -> Attempt,
    stopped: &dyn Fn() -> bool,
    wait: &mut dyn FnMut(Duration),
    say: &mut dyn FnMut(&Next),
) -> Ending {
    let mut failures = 0;
    loop {
        match attempt() {
            Attempt::Ended => return Ending::Over,
            Attempt::Failed { lived } => {
                if stopped() {
                    return Ending::Stopped;
                }
                let next = next(policy, started, failures, lived);
                say(&next);
                match next {
                    Next::GiveUp { failures, .. } => return Ending::GaveUp { failures },
                    Next::Again {
                        after,
                        failures: again,
                        ..
                    } => {
                        failures = again;
                        wait(after);
                        if stopped() {
                            return Ending::Stopped;
                        }
                    }
                }
            }
        }
    }
}

/// Decides the next step after a failure.
///
/// `failures` counts earlier consecutive failures, so the first is `0`.
fn next(policy: &Policy, started: Started, failures: u32, lived: Duration) -> Next {
    let failures = match lived >= policy.long_enough {
        true => 1,
        false => failures + 1,
    };
    match failures >= policy.give_up_after {
        true => Next::GiveUp { failures, started },
        false => Next::Again {
            after: doubling(policy, failures),
            failures,
            of: policy.give_up_after,
            started,
        },
    }
}

/// Removes the sockets and session file the last desktop left.
///
/// - A stale session file would make the launcher report the next compositor
///   as ready before it binds anything (see the milestone in
///   `bin/domicile.rs`).
/// - A stale socket makes the next bind fail. The engine `CHECK`s its command
///   socket bind, so it would crash.
///
/// The profile is kept so the user stays signed in. Chromium recovers its own
/// stale singleton lock. The control socket belongs to this process and stays.
///
/// A missing path is success. Any other error is returned.
pub fn clear_the_last_one(runtime: &Runtime) -> Result<(), Leftover> {
    gone(
        &runtime.chrome_socket,
        std::fs::remove_file(&runtime.chrome_socket),
    )?;
    gone(&runtime.session, std::fs::remove_file(&runtime.session))?;
    clear_the_last_engine(runtime)
}

/// Removes the last engine's broker and command sockets.
///
/// Leaves the chrome socket and session file, which belong to the compositor
/// that is still running.
pub fn clear_the_last_engine(runtime: &Runtime) -> Result<(), Leftover> {
    gone(&runtime.broker, std::fs::remove_file(&runtime.broker))?;
    gone(&runtime.command, std::fs::remove_file(&runtime.command))
}

fn doubling(policy: &Policy, failures: u32) -> Duration {
    // `failures` is at least 1. The shift is capped so a policy that never
    // gives up cannot overflow it.
    let doubled = policy
        .first_wait
        .saturating_mul(1u32 << (failures - 1).min(31));
    doubled.min(policy.longest_wait)
}

fn gone(path: &Path, removed: std::io::Result<()>) -> Result<(), Leftover> {
    match removed {
        Ok(()) => Ok(()),
        Err(why) => match why.kind() {
            std::io::ErrorKind::NotFound => Ok(()),
            kind => Err(Leftover {
                path: path.display().to_string(),
                kind,
            }),
        },
    }
}
