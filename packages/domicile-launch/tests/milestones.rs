//! How a run waits for its components to come up, and how it reports a stall.
//!
//! The clock is a counter and the components are closures, so a 30-second wait
//! takes a few calls.

use std::cell::Cell;
use std::time::Duration;

use domicile_launch::milestones::{reach, Milestone, Stalled};
use domicile_launch::supervise::Exit;

fn broker() -> Milestone {
    Milestone {
        awaited: "the engine's broker socket at /run/domicile/broker".to_string(),
        check: "The engine's own output is above.".to_string(),
        patience: Duration::from_secs(3),
    }
}

/// A clock that advances one second per call, as a real one does between polls.
fn ticking() -> impl FnMut() -> Duration {
    let elapsed = Cell::new(Duration::ZERO);
    move || {
        elapsed.set(elapsed.get() + Duration::from_secs(1));
        elapsed.get()
    }
}

/// Nothing has exited.
fn all_running() -> impl FnMut() -> Option<Exit> {
    || None
}

#[test]
fn something_already_there_is_not_waited_for() {
    let mut clock = ticking();
    reach(
        &broker(),
        &|| true,
        &mut all_running(),
        &|| false,
        &mut clock,
    )
    .expect("it is there");
    // The clock was never read.
    assert_eq!(clock(), Duration::from_secs(1));
}

#[test]
fn something_that_turns_up_while_there_is_still_time_is_reached() {
    let polls = Cell::new(0);
    reach(
        &broker(),
        &|| {
            polls.set(polls.get() + 1);
            polls.get() > 2
        },
        &mut all_running(),
        &|| false,
        &mut ticking(),
    )
    .expect("it turned up");
}

#[test]
fn something_that_never_turns_up_names_itself_and_what_to_check() {
    let stalled = reach(
        &broker(),
        &|| false,
        &mut all_running(),
        &|| false,
        &mut ticking(),
    )
    .expect_err("never turned up");

    assert_eq!(
        stalled,
        Stalled::Waited {
            awaited: "the engine's broker socket at /run/domicile/broker".to_string(),
            seconds: 3,
            check: "The engine's own output is above.".to_string(),
        }
    );
    assert_eq!(
        stalled.to_string(),
        "the engine's broker socket at /run/domicile/broker has not turned up \
         after 3s.\nThe engine's own output is above."
    );
}

#[test]
fn a_component_that_exits_first_is_the_answer_rather_than_the_wait() {
    // The children are watched while waiting, so an engine that dies at once is
    // reported as the failure instead of as a missing socket after the full
    // timeout.
    let stalled = reach(
        &broker(),
        &|| false,
        &mut || {
            Some(Exit {
                what: "engine",
                how: "exit status: 1".to_string(),
            })
        },
        &|| false,
        &mut ticking(),
    )
    .expect_err("the engine is gone");

    assert_eq!(
        stalled.to_string(),
        "the engine exited (exit status: 1); the engine's broker socket at \
         /run/domicile/broker never turned up.\nThe engine's own output is above."
    );
}

#[test]
fn a_component_that_exits_beats_a_milestone_that_was_reached_anyway() {
    // A component can create its socket and then die. The exit is the failure;
    // the socket has no listener.
    let stalled = reach(
        &broker(),
        &|| true,
        &mut || {
            Some(Exit {
                what: "engine",
                how: "signal: 11 (SIGSEGV)".to_string(),
            })
        },
        &|| false,
        &mut ticking(),
    )
    .expect_err("the engine is gone");

    assert!(stalled
        .to_string()
        .starts_with("the engine exited (signal: 11 (SIGSEGV))"));
}

#[test]
fn a_stop_asked_for_before_the_desktop_is_up_ends_the_wait() {
    // A launcher must never outlive its supervision. Whatever sends SIGINT or
    // SIGTERM follows up with SIGKILL. A launcher killed before `Running::drop`
    // runs leaves the engine on the tty holding logind's session control, the
    // input devices and the console in `K_OFF` and `KD_GRAPHICS`, with nothing
    // left to restore them. So a stop request ends the wait at once.
    let stalled = reach(
        &broker(),
        &|| false,
        &mut all_running(),
        &|| true,
        &mut ticking(),
    )
    .expect_err("the run was stopped");

    assert_eq!(
        stalled,
        Stalled::Stopped {
            awaited: "the engine's broker socket at /run/domicile/broker".to_string(),
        }
    );
    assert_eq!(
        stalled.to_string(),
        "stopped before the engine's broker socket at /run/domicile/broker \
         turned up."
    );
}
