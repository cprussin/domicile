//! What a desktop that died earns, and how many times it earns it.
//!
//! No processes: a desktop is a closure that says how it ended, so the whole
//! policy — the backoff, the give-up, and the stop that overrules both — is a
//! unit test. The one part that touches a filesystem is what the last desktop
//! left in the run's directory, and a temp directory is enough for that.

use std::cell::Cell;
use std::time::Duration;

use domicile_launch::restart::{
    clear_the_last_engine, clear_the_last_one, keep_a_desktop_up, keep_the_engine_up, Attempt,
    Ending, Policy,
};
use domicile_launch::spawn::Runtime;

#[test]
fn a_desktop_that_ends_cleanly_is_not_started_again() {
    let attempts = Cell::new(0);

    let ending = keep_a_desktop_up(
        &Policy::default(),
        &mut || {
            attempts.set(attempts.get() + 1);
            Attempt::Ended
        },
        &|| false,
        &mut |_| panic!("nothing failed, so nothing is waited for"),
        &mut |_| panic!("nothing failed, so there is nothing to say"),
    );

    assert_eq!(ending, Ending::Over);
    assert_eq!(attempts.get(), 1);
}

#[test]
fn a_desktop_that_dies_is_started_again_until_it_is_given_up_on() {
    let policy = Policy::default();
    let attempts = Cell::new(0);
    let mut waited: Vec<Duration> = Vec::new();
    let mut said: Vec<String> = Vec::new();

    let ending = keep_a_desktop_up(
        &policy,
        &mut || {
            attempts.set(attempts.get() + 1);
            Attempt::Failed {
                lived: Duration::from_millis(3),
            }
        },
        &|| false,
        &mut |wait| waited.push(wait),
        &mut |next| said.push(next.to_string()),
    );

    // Five failures in a row, four of which were started again: the fifth is
    // the one nothing follows.
    assert_eq!(attempts.get(), policy.give_up_after);
    assert_eq!(
        waited,
        vec![
            Duration::from_secs(1),
            Duration::from_secs(2),
            Duration::from_secs(4),
            Duration::from_secs(8),
        ]
    );
    // Every failure is said, the last one included: a run that gave up
    // silently would be a desktop that stopped coming back with nothing on the
    // terminal about why.
    assert_eq!(said.len(), policy.give_up_after as usize);
    assert!(said[1].contains("2s"), "{}", said[1]);
    assert!(said[1].contains("failure 2 of 5"), "{}", said[1]);
    let last = said.last().expect("every failure was said");
    assert!(last.contains("5 desktops in a row"), "{last}");
    assert_eq!(
        ending,
        Ending::GaveUp {
            failures: policy.give_up_after,
        }
    );
}

#[test]
fn the_wait_stops_doubling_at_the_longest_one() {
    // A policy with small numbers, so the cap is reached where it can be read
    // rather than in an arithmetic coincidence, and one that gives up a
    // failure later than the default so there are waits past the cap to read.
    let policy = Policy {
        first_wait: Duration::from_secs(1),
        longest_wait: Duration::from_secs(4),
        give_up_after: 6,
        long_enough: Duration::from_secs(60),
    };
    let mut waited: Vec<Duration> = Vec::new();

    keep_a_desktop_up(
        &policy,
        &mut || Attempt::Failed {
            lived: Duration::ZERO,
        },
        &|| false,
        &mut |wait| waited.push(wait),
        &mut |_| {},
    );

    assert_eq!(
        waited,
        vec![
            Duration::from_secs(1),
            Duration::from_secs(2),
            Duration::from_secs(4),
            Duration::from_secs(4),
            Duration::from_secs(4),
        ]
    );
}

#[test]
fn a_desktop_that_lived_long_enough_starts_the_count_over() {
    // A desktop somebody used and then lost is an incident rather than a crash
    // loop: the one after it waits a second again rather than picking up where
    // the doubling left off, and the failures before it stop counting towards
    // the give-up.
    let policy = Policy::default();
    let attempts = Cell::new(0);
    let mut waited: Vec<Duration> = Vec::new();

    keep_a_desktop_up(
        &policy,
        &mut || {
            attempts.set(attempts.get() + 1);
            Attempt::Failed {
                lived: match attempts.get() {
                    3 => policy.long_enough,
                    _ => Duration::ZERO,
                },
            }
        },
        &|| false,
        &mut |wait| waited.push(wait),
        &mut |_| {},
    );

    assert_eq!(
        waited,
        vec![
            Duration::from_secs(1),
            Duration::from_secs(2),
            // The third desktop lived a minute, so it is the first failure of
            // a new row rather than the third of the old one.
            Duration::from_secs(1),
            Duration::from_secs(2),
            Duration::from_secs(4),
            Duration::from_secs(8),
        ]
    );
    assert_eq!(attempts.get(), 7);
}

#[test]
fn a_desktop_that_was_stopped_is_not_started_again() {
    let attempts = Cell::new(0);

    let ending = keep_a_desktop_up(
        &Policy::default(),
        &mut || {
            attempts.set(attempts.get() + 1);
            Attempt::Failed {
                lived: Duration::from_millis(3),
            }
        },
        &|| true,
        &mut |_| panic!("a stop was asked for, so nothing is waited for"),
        &mut |_| panic!("a stop was asked for, so there is nothing to say"),
    );

    assert_eq!(ending, Ending::Stopped);
    assert_eq!(attempts.get(), 1);
}

#[test]
fn a_stop_asked_for_while_the_next_one_is_waited_for_is_not_started_again() {
    // Ctrl-C in the gap between two desktops. The wait is what notices it —
    // the run is not in a component at that moment, so nothing else can.
    let attempts = Cell::new(0);
    let stopped = Cell::new(false);

    let ending = keep_a_desktop_up(
        &Policy::default(),
        &mut || {
            attempts.set(attempts.get() + 1);
            Attempt::Failed {
                lived: Duration::ZERO,
            }
        },
        &|| stopped.get(),
        &mut |_| stopped.set(true),
        &mut |_| {},
    );

    assert_eq!(ending, Ending::Stopped);
    assert_eq!(attempts.get(), 1);
}

#[test]
fn nothing_the_last_desktop_bound_or_published_outlives_it() {
    let directory = tempfile::tempdir().expect("a temp directory");
    let runtime = runtime(directory.path());
    for path in [
        &runtime.broker,
        &runtime.chrome_socket,
        &runtime.command,
        &runtime.session,
    ] {
        std::fs::write(path, "the last desktop's").expect("it is written");
    }
    std::fs::create_dir(&runtime.profile).expect("it is created");
    std::fs::write(runtime.profile.join("SingletonLock"), "stale").expect("it is written");
    std::fs::write(&runtime.control, "this process's own").expect("it is written");

    clear_the_last_one(&runtime).expect("it clears");

    assert!(!runtime.broker.exists(), "the broker socket is still there");
    assert!(
        !runtime.chrome_socket.exists(),
        "the chrome socket is still there"
    );
    // The engine binds this one, and binds it loudly: a path that is already
    // there is a `CHECK` in the browser process rather than a desktop that
    // comes up without a command socket. The engine the last desktop died with
    // left this file exactly where the next one is told to bind.
    assert!(
        !runtime.command.exists(),
        "the engine's command socket is still there"
    );
    // THE ONE THAT MATTERS MOST: the launcher waits for this file to appear,
    // so one left behind is a desktop reported up before its compositor has
    // bound anything.
    assert!(
        !runtime.session.exists(),
        "the session document is still there"
    );
    assert!(
        !runtime.profile.exists(),
        "the engine's profile is still there"
    );
    // Not the control socket: it is this process's, it is still bound, and
    // `DOMICILE_SOCK` still names it.
    assert!(runtime.control.exists(), "the control socket was cleared");
}

#[test]
fn a_desktop_that_left_nothing_behind_is_nothing_to_clear() {
    let directory = tempfile::tempdir().expect("a temp directory");

    clear_the_last_one(&runtime(directory.path())).expect("there was nothing to clear");
}

#[test]
fn what_cannot_be_cleared_is_said_rather_than_started_over() {
    let directory = tempfile::tempdir().expect("a temp directory");
    let runtime = runtime(directory.path());
    // A directory where the session document goes: `remove_file` refuses it,
    // which is the shape of any leftover this process cannot take away.
    std::fs::create_dir(&runtime.session).expect("it is created");

    let leftover = clear_the_last_one(&runtime).expect_err("it cannot be cleared");

    let said = leftover.to_string();
    assert!(said.contains("session.json"), "{said}");
}

#[test]
fn an_engine_that_dies_is_started_again_under_the_compositor_that_did_not() {
    // The same policy, counted on its own and said about the engine rather
    // than about the desktop: what is being started again is one component,
    // and a sentence that named the desktop would be describing a restart
    // nobody asked for and the windows did not survive.
    let policy = Policy::default();
    let attempts = Cell::new(0);
    let mut waited: Vec<Duration> = Vec::new();
    let mut said: Vec<String> = Vec::new();

    let ending = keep_the_engine_up(
        &policy,
        &mut || {
            attempts.set(attempts.get() + 1);
            Attempt::Failed {
                lived: Duration::from_millis(3),
            }
        },
        &|| false,
        &mut |wait| waited.push(wait),
        &mut |next| said.push(next.to_string()),
    );

    assert_eq!(attempts.get(), policy.give_up_after);
    assert_eq!(
        waited,
        vec![
            Duration::from_secs(1),
            Duration::from_secs(2),
            Duration::from_secs(4),
            Duration::from_secs(8),
        ]
    );
    assert!(
        said[0].contains("starting the engine again in 1s"),
        "{}",
        said[0]
    );
    let last = said.last().expect("every failure was said");
    assert!(last.contains("5 engines in a row have failed"), "{last}");
    assert_eq!(
        ending,
        Ending::GaveUp {
            failures: policy.give_up_after,
        }
    );
}

#[test]
fn a_compositor_that_outlives_its_engines_ends_the_run_rather_than_the_engine() {
    // `Attempt::Ended` on the engine's loop is the compositor going, which is
    // the desktop being over: there is nothing left to put an engine under.
    let attempts = Cell::new(0);

    let ending = keep_the_engine_up(
        &Policy::default(),
        &mut || {
            attempts.set(attempts.get() + 1);
            Attempt::Ended
        },
        &|| false,
        &mut |_| panic!("nothing failed, so nothing is waited for"),
        &mut |_| panic!("nothing failed, so there is nothing to say"),
    );

    assert_eq!(ending, Ending::Over);
    assert_eq!(attempts.get(), 1);
}

#[test]
fn what_the_last_engine_left_goes_and_what_the_compositor_bound_stays() {
    // An engine started again under a compositor that is still serving. The
    // engine's own paths are leftovers the next one cannot bind over; the
    // compositor's are a socket it is still listening on and a document that
    // is still true, and taking either away would be this run deleting a live
    // desktop's answer to "is it up".
    let directory = tempfile::tempdir().expect("a temp directory");
    let runtime = runtime(directory.path());
    for path in [
        &runtime.broker,
        &runtime.chrome_socket,
        &runtime.command,
        &runtime.session,
    ] {
        std::fs::write(path, "the desktop's").expect("it is written");
    }
    std::fs::create_dir(&runtime.profile).expect("it is created");

    clear_the_last_engine(&runtime).expect("it clears");

    assert!(!runtime.broker.exists(), "the broker socket is still there");
    assert!(
        !runtime.command.exists(),
        "the engine's command socket is still there"
    );
    assert!(
        !runtime.profile.exists(),
        "the engine's profile is still there"
    );
    assert!(
        runtime.chrome_socket.exists(),
        "the compositor is still listening on the chrome socket and this took it away"
    );
    assert!(
        runtime.session.exists(),
        "the compositor is still serving and this took away the document that says so"
    );
}

fn runtime(directory: &std::path::Path) -> Runtime {
    Runtime {
        broker: directory.join("broker"),
        chrome_socket: directory.join("chrome.sock"),
        command: directory.join("command.sock"),
        control: directory.join("domicile-ipc.1.sock"),
        profile: directory.join("profile"),
        session: directory.join("session.json"),
    }
}
