//! What a run has to reach before it is a desktop, and what it says when it
//! does not reach one.
//!
//! A desktop that fails to come up used to be a blank window and no sentence
//! anywhere. Four separate causes were diagnosed by hand behind that same
//! symptom, and each one cost hours that a line on the terminal would have
//! cost nothing: an engine that would not start, an engine that started and
//! served nothing, a compositor that could not take a display, a shell module
//! that was never loaded. None of them is guessed at here. What a milestone
//! carries is what was *observed* — a socket that is not there, a component
//! that is not running — and where to look next.
//!
//! ADDING ONE IS THE POINT. A milestone is a sentence, a patience and a
//! predicate, so anything a run can be asked about from the outside becomes a
//! reported failure by writing those three down and calling [`reach`] before
//! the next step. `bin/domicile.rs` holds the two this run has.
//!
//! What cannot be a milestone here is anything only the far end knows — that
//! nothing ever dialed the compositor's control socket, say. That one is
//! observed where it happens and said there; see [`crate::handshake`].

use std::time::Duration;

use crate::supervise::Exit;

/// One thing a run has to reach on its way to being a desktop.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Milestone {
    /// What is being waited for, as the subject of a sentence, with the path
    /// in it: "the engine's broker socket at /run/user/1000/domicile-7/broker".
    pub awaited: String,
    /// What to look at when it does not turn up.
    pub check: String,
    /// How long it gets.
    pub patience: Duration,
}

/// A desktop that is not coming up, and what was seen instead.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Stalled {
    /// A component stopped running before the milestone was reached. The exit
    /// is the story even when the milestone was reached anyway: a socket
    /// nothing is listening on is not progress.
    #[error("{exit}; {awaited} never turned up.\n{check}")]
    Exited {
        exit: Exit,
        awaited: String,
        check: String,
    },
    /// A stop was asked for before the desktop was up. There is nothing to
    /// check, because nothing went wrong: what was asked for is what
    /// happened, and the sentence says how far the run had got.
    #[error("stopped before {awaited} turned up.")]
    Stopped { awaited: String },
    /// Everything is still running and the thing still has not happened.
    #[error("{awaited} has not turned up after {seconds}s.\n{check}")]
    Waited {
        awaited: String,
        seconds: u64,
        check: String,
    },
}

/// Wait for one milestone, or say why the desktop is not coming up.
///
/// `observed` is asked whether the thing has happened, `exited` whether any
/// component has stopped, `stopped` whether a stop has been asked for, and
/// `tick` waits a moment and answers how long the wait has been going. All
/// four are the caller's so that a thirty-second patience is four calls in a
/// test — and so that what "the thing has happened" means stays with the
/// milestone rather than being fixed here.
///
/// `exited` is asked first, and before the clock: a component that is gone is
/// the answer to every question after it, and asking it first is what turns
/// thirty seconds of silence followed by a sentence about a socket into a
/// sentence about the process that died.
///
/// `stopped` IS ASKED BEFORE `observed`, AND A RUN THAT IGNORED IT COULD NOT
/// BE STOPPED AT ALL. A `SIGINT` or a `SIGTERM` that arrives while a
/// milestone is outstanding used to be noticed only once the desktop was up —
/// [`crate::supervise::Running::until_one_exits`] was the one reader of the
/// flag — so a Ctrl-C during startup did nothing for the whole of the
/// patience. Whatever sends that signal sends a `SIGKILL` after it, and the
/// launcher does its entire teardown in `Running::drop`: a launcher killed
/// before that runs leaves the engine alive on the tty holding logind's
/// session control, every keyboard and mouse logind handed it, and the
/// console in `K_OFF` and `KD_GRAPHICS`. Nothing takes any of that back
/// afterwards, because nothing is left that could, and the machine has no way
/// in. Reaching the milestone is not a reason to carry on either: the next
/// thing a reached milestone does is start another component.
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
