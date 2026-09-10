//! What a run has to reach before it is a desktop, and what it says when it
//! does not reach one.
//!
//! The clock is a counter and the components are a closure, so the thirty
//! seconds a real run spends waiting are four calls here.

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

/// A clock that moves one second every time it is asked, which is what a real
/// one does between polls.
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
    reach(&broker(), &|| true, &mut all_running(), &mut clock).expect("it is there");
    // The clock was never asked, which is what "not waited for" means.
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
        &mut ticking(),
    )
    .expect("it turned up");
}

#[test]
fn something_that_never_turns_up_names_itself_and_what_to_check() {
    let stalled = reach(&broker(), &|| false, &mut all_running(), &mut ticking())
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
    // The whole point of watching the children while waiting: an engine that
    // died at once used to be thirty seconds of nothing followed by a sentence
    // about a socket, which is the symptom and not the failure.
    let stalled = reach(
        &broker(),
        &|| false,
        &mut || {
            Some(Exit {
                what: "engine",
                how: "exit status: 1".to_string(),
            })
        },
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
    // Both are true at once when a component creates its socket and then dies.
    // The exit is the story; the socket is a file nothing is listening on.
    let stalled = reach(
        &broker(),
        &|| true,
        &mut || {
            Some(Exit {
                what: "engine",
                how: "signal: 11 (SIGSEGV)".to_string(),
            })
        },
        &mut ticking(),
    )
    .expect_err("the engine is gone");

    assert!(stalled
        .to_string()
        .starts_with("the engine exited (signal: 11 (SIGSEGV))"));
}
