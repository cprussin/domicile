//! A desktop that died gets another one, up to a point.
//!
//! WHAT IS RESTARTED IS THE DESKTOP, NOT THE COMPONENT THAT DIED, and that is
//! a decision rather than a first cut. Neither component can be replaced under
//! the other:
//!
//! - **The engine cannot be restarted under a running compositor.** The engine
//!   creates the broker socket and the compositor dials it once, at startup —
//!   `Engine::load` in `packages/domicile-compositor/src/engine.rs:350`, which
//!   is the only call to `domicile_engine_connect` there is. Nothing in that
//!   crate reconnects, so a compositor whose engine went away holds a handle to
//!   a mojo graph that no longer exists, and every buffer it submits goes
//!   nowhere. It would also be a compositor with no window: on a tty the
//!   engine is what holds DRM master.
//! - **The compositor cannot be restarted under a running engine.** The page
//!   dials the compositor's control socket, and that channel "deletes itself
//!   when either end goes away"
//!   (`packages/domicile-engine/src/components/domicile/browser/control_channel.h:49`).
//!   Its retry is a bounded reach at startup (`kReachFor`), not a reconnect. A
//!   shell that outlived its compositor is a page holding a closed channel, and
//!   nothing this side of the engine can reopen it.
//!
//! So the death of either takes the other down deliberately, by dropping the
//! [`crate::supervise::Running`] that holds them both — which signals each
//! process group and waits, exactly as an ordinary exit does — and a whole new
//! desktop is started in its place. Within one desktop nothing is stale,
//! because nothing survives: a fresh engine, a fresh compositor, a fresh page
//! dialing a socket that was bound after it. What does not survive either is
//! the apps: they were clients of a Wayland display that is gone, and their
//! `WAYLAND_DISPLAY` names a socket the next compositor will not be called.
//! Nothing here pretends otherwise.
//!
//! WHAT IS NOT RESTARTED IS ANYTHING DECIDED BEFORE THE FIRST PROCESS. A
//! missing engine, a refused ozone platform, a control socket that could not be
//! taken: all of those are worked out once by `bin/domicile.rs` and are the
//! same answer every time they are asked. A desktop is started again; a
//! decision is not made again.
//!
//! THE BACKOFF IS WHAT KEEPS A LAPTOP'S FAN OFF. A component that dies three
//! milliseconds into startup and will do it forever — a compositor asserting
//! on a null pointer in the display handshake is the case this was written
//! for — would otherwise be a spin loop with a Chromium launch in it. So the
//! wait doubles, and the run gives up rather than flapping: [`Policy`]'s
//! defaults are four restarts over about fifteen seconds and then a stop,
//! which is systemd's `RestartSec`/`StartLimitBurst` shape with numbers picked
//! for a thing that takes seconds to start. A desktop that lived
//! [`Policy::long_enough`] is not part of a crash loop and starts the count
//! over.

use std::path::Path;
use std::time::Duration;

use crate::spawn::Runtime;

/// When a desktop that died is started again, and when it stops being.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    /// What the first failure in a row waits before the next desktop.
    pub first_wait: Duration,
    /// The longest any failure waits, however many there have been.
    pub longest_wait: Duration,
    /// How many failures in a row end the run.
    pub give_up_after: u32,
    /// How long a desktop has to have lived for its death to be an incident
    /// rather than a crash loop.
    pub long_enough: Duration,
}

impl Default for Policy {
    /// A SECOND, NOT A MILLISECOND, because there is nothing to gain by being
    /// quicker: the desktop being started again is a Chromium launch and a
    /// compositor that binds four sockets, so the wait is not what a user is
    /// waiting for. What it buys is that a component dying on contact cannot
    /// occupy a core.
    ///
    /// FIVE IN A ROW IS A DESKTOP THAT IS NOT COMING UP. The failures this
    /// restarts are the ones a second attempt fixes — a crash in a handshake,
    /// a socket that lost a race — and a fault that survives four fresh
    /// desktops is not one of them. Fifteen seconds of doubling is enough to
    /// find that out and short enough that a tty is handed back while somebody
    /// is still looking at it.
    fn default() -> Self {
        Policy {
            first_wait: Duration::from_secs(1),
            longest_wait: Duration::from_secs(8),
            give_up_after: 5,
            long_enough: Duration::from_secs(60),
        }
    }
}

/// What a desktop that has just failed earns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Next {
    #[error(
        "starting the desktop again in {after:?} — that is failure {failures} of {of} in a row."
    )]
    Again {
        after: Duration,
        failures: u32,
        of: u32,
    },
    // WHERE THE REASON IS IS NOT SAID HERE ANY MORE. It used to end "Every one
    // of them said why above", which was true and was a pointer into two
    // hundred lines of Chromium's startup log -- from the last line of the
    // run, which is the one line anyone reads. `bin/domicile.rs` puts the
    // compositor's own words under this instead, because it is the half that
    // has them; see `crate::heard`.
    #[error(
        "{failures} desktops in a row have failed, so this one is not being \
         started again."
    )]
    GiveUp { failures: u32 },
}

/// One desktop, from its first process to its last.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Attempt {
    /// It ended the way a desktop is meant to: a component exited cleanly, so
    /// there is nothing to restart and nothing to say.
    Ended,
    /// It stopped being a desktop and nobody asked it to. What failed is said
    /// where it failed — an exit and a milestone that was never reached each
    /// carry their own sentence — so what is left to report here is `lived`,
    /// how long this one lasted, which is what tells a crash loop from a
    /// desktop somebody used.
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

/// Something the last desktop left behind that this process cannot remove.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "{path} is what the last desktop left behind and it cannot be taken away \
     ({kind:?}), so there is nowhere to start another one"
)]
pub struct Leftover {
    pub path: String,
    pub kind: std::io::ErrorKind,
}

/// Start a desktop, and start another whenever one fails.
///
/// `attempt` is one whole desktop and blocks for as long as it is up;
/// `stopped` is whether a stop has been asked for; `wait` is the backoff, and
/// is the caller's so that this stays a policy rather than a sleep; `say` is
/// told what happens next, so that a user watching a tty reads a restart as it
/// happens rather than deducing it from a second Chromium starting. What
/// FAILED is not said here and is not carried here: an exit and a milestone
/// that was never reached each already carry their own sentence, said where it
/// happened, and repeating it would be one line of a tty spent twice.
///
/// `stopped` IS ASKED AFTER EVERY ATTEMPT AND AFTER EVERY WAIT, and a run that
/// asked only in one of those places could not be stopped. A Ctrl-C arrives as
/// a signal to this process, and the component it also ended looks from here
/// exactly like a component that crashed — so a failure that is not checked
/// against the flag is a desktop that starts itself again on the way out. The
/// gap between two desktops is the other place: nothing is running in it, so
/// the wait is the only thing that can notice.
pub fn keep_a_desktop_up(
    policy: &Policy,
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
                let next = next(policy, failures, lived);
                say(&next);
                match next {
                    Next::GiveUp { failures } => return Ending::GaveUp { failures },
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

/// What a desktop that failed after `failures` before it and `lived` that long
/// earns.
///
/// `failures` is how many in a row had already failed, so the first failure of
/// a run asks with `0`.
fn next(policy: &Policy, failures: u32, lived: Duration) -> Next {
    let failures = match lived >= policy.long_enough {
        true => 1,
        false => failures + 1,
    };
    match failures >= policy.give_up_after {
        true => Next::GiveUp { failures },
        false => Next::Again {
            after: doubling(policy, failures),
            failures,
            of: policy.give_up_after,
        },
    }
}

/// Take away everything the last desktop bound or published, so that the next
/// one is not started on top of it.
///
/// THE SESSION DOCUMENT IS THE ONE THAT WOULD NOT ANNOUNCE ITSELF. The
/// launcher waits for that file to appear and treats its existence as "the
/// compositor is serving" — see the milestone in `bin/domicile.rs` — so a
/// document left by the desktop that just died is the next desktop reported up
/// before its compositor has bound anything, and every failure after that
/// reads as something else. The two sockets are the loud version of the same
/// thing: a path that is already there is a bind that fails.
///
/// The profile goes too. It is this run's own temporary directory rather than
/// anybody's browser profile, and what a Chromium killed with `SIGKILL` leaves
/// in one is a singleton lock and a session to restore, neither of which
/// belongs to the desktop being started.
///
/// The control socket does NOT go: it is this process's, it is still bound,
/// `DOMICILE_SOCK` still names it, and a `domicile which-shell` typed between
/// two desktops is answered by the same supervisor either way.
///
/// A path that is not there is the outcome being asked for rather than a
/// failure. Anything else is returned: a leftover this process cannot take
/// away is not something to start a desktop on top of and hope.
pub fn clear_the_last_one(runtime: &Runtime) -> Result<(), Leftover> {
    for path in [&runtime.broker, &runtime.chrome_socket, &runtime.session] {
        gone(path, std::fs::remove_file(path))?;
    }
    gone(&runtime.profile, std::fs::remove_dir_all(&runtime.profile))
}

fn doubling(policy: &Policy, failures: u32) -> Duration {
    // `failures` is at least 1 — `next` counts this failure in before it asks
    // — and the shift is capped because a policy that never gives up would
    // otherwise overflow it before the duration saturated.
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
