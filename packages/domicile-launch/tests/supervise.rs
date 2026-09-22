//! The components of a run, and which one stopped being one.
//!
//! Real processes, because the thing being tested is which child `wait`
//! answers about — and that is exactly what a double would have to invent.
//! `/bin/sh` because it is the one program every machine that can run a
//! desktop has.

use std::ffi::OsString;
use std::path::PathBuf;

use domicile_launch::spawn::Spawn;
use domicile_launch::supervise::Running;

fn sh(script: &str) -> Spawn {
    Spawn {
        program: PathBuf::from("/bin/sh"),
        args: vec![OsString::from("-c"), OsString::from(script)],
        env: Vec::new(),
    }
}

#[test]
fn a_component_that_will_not_start_says_which_one_and_where_it_looked() {
    let mut running = Running::new();

    let failed = running
        .start(
            "engine",
            &Spawn {
                program: PathBuf::from("/nowhere/chrome"),
                args: Vec::new(),
                env: Vec::new(),
            },
        )
        .expect_err("there is no such program");

    let said = failed.to_string();
    assert!(said.contains("engine"), "{said}");
    assert!(said.contains("/nowhere/chrome"), "{said}");
}

#[test]
fn nothing_has_exited_while_everything_is_running() {
    let mut running = Running::new();
    running.start("engine", &sh("sleep 30")).expect("it starts");

    assert_eq!(running.exited(), None);
}

#[test]
fn the_component_that_exited_is_named_however_late_it_was_started() {
    // The one this replaces waited on the *last* child, which is the
    // compositor — so an engine that died left a desktop hanging on a window
    // that was never going to be drawn, with nothing said. Both orders are
    // asserted because "the first in the list" and "the one that exited" agree
    // on one of them.
    let mut running = Running::new();
    running.start("engine", &sh("exit 4")).expect("it starts");
    running
        .start("compositor", &sh("sleep 30"))
        .expect("it starts");

    let exit = running.until_one_exits();
    assert_eq!(exit.what, "engine");
    assert!(exit.how.contains('4'), "{}", exit.how);
    // NO LONGER "so the desktop is over": what a component that exited earns
    // is another desktop, up to the point `domicile_launch::restart` stops
    // giving them, so the sentence this carries is the observation alone and
    // what follows it is said by whatever decides.
    assert_eq!(exit.to_string(), "the engine exited (exit status: 4)");
}

#[test]
fn one_component_is_let_go_of_without_the_run_letting_go_of_the_other() {
    // An engine started again under a compositor that is still serving. The
    // dead one has to leave this list — a `wait` on it answers forever, so a
    // run that kept it would report the same corpse on every poll and never
    // notice the engine that replaced it — and the compositor has to be
    // exactly where it was, because the whole point is that its clients never
    // knew.
    let mut running = Running::new();
    running.start("engine", &sh("exit 4")).expect("it starts");
    running
        .start("compositor", &sh("sleep 30"))
        .expect("it starts");
    assert_eq!(running.until_one_exits().what, "engine");

    running.let_go_of("engine");

    assert_eq!(
        running.exited(),
        None,
        "the compositor is still running and the engine is no longer this run's to report"
    );
    running.start("engine", &sh("exit 7")).expect("it starts");
    let exit = running.until_one_exits();
    assert_eq!(exit.what, "engine");
    assert!(exit.how.contains('7'), "{}", exit.how);
}

#[test]
fn the_component_that_exited_is_named_however_early_it_was_started() {
    let mut running = Running::new();
    running.start("engine", &sh("sleep 30")).expect("it starts");
    running
        .start("compositor", &sh("exit 5"))
        .expect("it starts");

    let exit = running.until_one_exits();
    assert_eq!(exit.what, "compositor");
    assert!(exit.how.contains('5'), "{}", exit.how);
}
