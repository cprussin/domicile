//! A component that died gets another one, up to a point — and which
//! component that is decides how much of the desktop goes with it.
//!
//! THE ENGINE IS REPLACED UNDER THE COMPOSITOR. THE COMPOSITOR TAKES THE
//! DESKTOP WITH IT. The two directions are not symmetrical, and the asymmetry
//! is in the engine rather than here:
//!
//! - **An engine can be started under a running compositor**, which is what
//!   [`keep_the_engine_up`] does. The compositor dials the broker socket the
//!   dead engine bound — `clear_the_last_engine` takes that socket away and
//!   the new engine creates its own at the same path — and re-states to it
//!   everything the old one knew: a frame sink per window, every client buffer
//!   imported again, and the frame each window had on screen submitted again
//!   so it is still the frame on screen. `EngineSession::reconnect` in
//!   `packages/domicile-compositor/src/engine_session.rs` is that half, and
//!   `which_engine` beside it is how a compositor with no disconnect callback
//!   finds out at all: the page a new engine serves says hello from a process
//!   that is not the one before it.
//!
//!   **The clients never hear about any of it.** They are connected to a
//!   `wl_display` the compositor still holds, so their windows, their
//!   surfaces and their state survive — which is the whole point, and the
//!   thing a whole-desktop restart could not do however quick it was.
//!
//!   ON A TTY THE ENGINE HOLDS DRM MASTER, so for the second or two between
//!   two engines there is no screen: the console is dark and the compositor is
//!   serving into nothing. That is a real consequence and it is not fixed
//!   here. What it is not is a lost desktop — the new engine modesets from the
//!   same `DisplaySnapshot`s, and the compositor states its connectors to it
//!   again as soon as it has joined.
//!
//! - **The compositor cannot be restarted under a running engine.** The page
//!   dials the compositor's control socket, and that channel "deletes itself
//!   when either end goes away"
//!   (`packages/domicile-engine/src/components/domicile/browser/control_channel.h:49`).
//!   Its retry is a bounded reach at startup (`kReachFor`), not a reconnect. A
//!   shell that outlived its compositor is a page holding a closed channel, and
//!   nothing this side of the engine can reopen it. Making that direction work
//!   is a C++ change in the fork, and until it is made, a compositor that dies
//!   takes the engine down with it — by dropping the
//!   [`crate::supervise::Running`] that holds them both, which signals each
//!   process group and waits, exactly as an ordinary exit does — and a whole
//!   new desktop is started in its place. The apps do not survive that: they
//!   were clients of a Wayland display that is gone, and their
//!   `WAYLAND_DISPLAY` names a socket the next compositor will not be called.
//!   Nothing here pretends otherwise.
//!
//! AN ENGINE THAT WILL NOT STAY UP IS EVENTUALLY A DESKTOP THAT IS NOT COMING
//! UP. [`keep_the_engine_up`] gives up on the same terms as
//! [`keep_a_desktop_up`], and what follows a give-up there is one failure of
//! the desktop's own row — a whole new desktop, which is a different thing to
//! try rather than the same thing again.
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
//!
//! ONE POLICY, TWO ROWS. An engine started again earns the same doubling wait
//! and the same give-up that a desktop does, because it is the same crash
//! loop — but it is counted on its own, because the compositor under it has
//! not failed at anything and a count shared between them would end a desk
//! that was working.

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

/// What is being started again, which is the only thing the two loops below
/// differ by — and the difference a person reading a tty needs, because an
/// engine that came back under the compositor it left running is not the same
/// event as a desktop that was stood up from nothing.
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

/// What a desktop — or an engine under a compositor that outlived it — that
/// has just failed earns.
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
    // WHERE THE REASON IS IS NOT SAID HERE ANY MORE. It used to end "Every one
    // of them said why above", which was true and was a pointer into two
    // hundred lines of Chromium's startup log -- from the last line of the
    // run, which is the one line anyone reads. `bin/domicile.rs` puts the
    // compositor's own words under this instead, because it is the half that
    // has them; see `crate::heard`.
    #[error(
        "{failures} {started}s in a row have failed, so this one is not being \
         started again."
    )]
    GiveUp { started: Started, failures: u32 },
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
    keep_it_up(policy, Started::Desktop, attempt, stopped, wait, say)
}

/// Start an engine, and start another whenever one dies under a compositor
/// that is still serving.
///
/// THE SAME POLICY, COUNTED ON ITS OWN. An engine that dies every few seconds
/// is the same crash loop a desktop that does is, and it earns the same
/// doubling wait and the same give-up — but it earns them out of its own row,
/// because the compositor under it has not failed at anything and a count
/// shared between them would end a desk that was working.
///
/// `attempt` is one engine, from the process starting to whatever ends the
/// wait. [`Attempt::Ended`] here is the COMPOSITOR going rather than the
/// engine: there is nothing left to put an engine under, so the run is over
/// and the caller reads why off the exit it kept. [`Ending::GaveUp`] is an
/// engine that will not stay up, which is not this loop's to fix — the caller
/// takes the desktop down and the one in `keep_a_desktop_up` stands a whole
/// new one up, which is a different thing to try rather than the same thing
/// again.
pub fn keep_the_engine_up(
    policy: &Policy,
    attempt: &mut dyn FnMut() -> Attempt,
    stopped: &dyn Fn() -> bool,
    wait: &mut dyn FnMut(Duration),
    say: &mut dyn FnMut(&Next),
) -> Ending {
    keep_it_up(policy, Started::Engine, attempt, stopped, wait, say)
}

/// The loop both of the above are, with `started` the one thing they differ
/// by: which row of failures is being counted, and what the sentence names.
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

/// What a desktop that failed after `failures` before it and `lived` that long
/// earns.
///
/// `failures` is how many in a row had already failed, so the first failure of
/// a run asks with `0`.
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

/// Take away everything the last desktop bound or published, so that the next
/// one is not started on top of it.
///
/// THE SESSION DOCUMENT IS THE ONE THAT WOULD NOT ANNOUNCE ITSELF. The
/// launcher waits for that file to appear and treats its existence as "the
/// compositor is serving" — see the milestone in `bin/domicile.rs` — so a
/// document left by the desktop that just died is the next desktop reported up
/// before its compositor has bound anything, and every failure after that
/// reads as something else. The two sockets are the loud version of the same
/// thing: a path that is already there is a bind that fails. The engine's
/// command socket is the loudest of the three — `StartCommandSocket` `CHECK`s
/// the bind, so a file the last engine left is the next desktop's browser
/// process ending on a line about a path rather than a desktop.
///
/// The engine's profile does NOT go: it is kept between desktops, and a
/// desktop that failed is not a reason to sign a person out of everything. The
/// singleton lock a Chromium killed with `SIGKILL` leaves in it names a
/// process that is gone, which the next engine sees and takes over itself.
///
/// The control socket does NOT go: it is this process's, it is still bound,
/// `DOMICILE_SOCK` still names it, and a `domicile which-shell` typed between
/// two desktops is answered by the same supervisor either way.
///
/// A path that is not there is the outcome being asked for rather than a
/// failure. Anything else is returned: a leftover this process cannot take
/// away is not something to start a desktop on top of and hope.
pub fn clear_the_last_one(runtime: &Runtime) -> Result<(), Leftover> {
    gone(
        &runtime.chrome_socket,
        std::fs::remove_file(&runtime.chrome_socket),
    )?;
    gone(&runtime.session, std::fs::remove_file(&runtime.session))?;
    clear_the_last_engine(runtime)
}

/// Take away what the last ENGINE bound, and nothing else, so that another can
/// be started under the compositor that is still serving.
///
/// THE TWO THAT ARE THE ENGINE'S. The broker socket is the one the next
/// engine creates and the compositor re-dials; the command socket is the
/// loudest leftover there is, because `StartCommandSocket` `CHECK`s its bind
/// and a path already there is a browser process ending on a line about a
/// file. Not the profile, for the reason [`clear_the_last_one`] gives.
///
/// THE TWO THAT ARE NOT GO NOWHERE NEAR THIS. The chrome socket is bound by a
/// compositor that is still listening on it, and the session document is that
/// same compositor's published statement that it is serving — which is still
/// true. Removing either would be this process deleting a live desktop's own
/// answer, and the session document in particular is what the launcher treats
/// as "the compositor is up".
pub fn clear_the_last_engine(runtime: &Runtime) -> Result<(), Leftover> {
    gone(&runtime.broker, std::fs::remove_file(&runtime.broker))?;
    gone(&runtime.command, std::fs::remove_file(&runtime.command))
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
