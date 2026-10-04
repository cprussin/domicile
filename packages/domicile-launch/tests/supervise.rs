//! Starting a run's components and reporting which one exited.
//!
//! These use real `/bin/sh` processes, because the behavior under test is which
//! child `wait` reports on.

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
    // The engine exits while the compositor keeps running. Both start orders
    // are tested so "the first in the list" cannot pass for "the one that
    // exited".
    let mut running = Running::new();
    running.start("engine", &sh("exit 4")).expect("it starts");
    running
        .start("compositor", &sh("sleep 30"))
        .expect("it starts");

    let exit = running.until_one_exits();
    assert_eq!(exit.what, "engine");
    assert!(exit.how.contains('4'), "{}", exit.how);
    // The message states only the exit. `domicile_launch::restart` decides what
    // follows.
    assert_eq!(exit.to_string(), "the engine exited (exit status: 4)");
}

#[test]
fn one_component_is_let_go_of_without_the_run_letting_go_of_the_other() {
    // An engine restarts under a compositor that is still serving. The dead
    // engine must leave the list, or `wait` would report it on every poll and
    // miss its replacement. The compositor stays untouched so its clients are
    // unaffected.
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
