//! What is left running when a desktop ends.
//!
//! THE ENGINE IS NOT ONE PROCESS. Chromium forks a GPU process, a zygote and
//! whatever else it needs, and `Child::kill` reaches exactly one of them. On
//! 2026-09-15 the browser took SIGSEGV two hundred milliseconds into a tty run
//! and a sibling was still logging eight seconds later -- with DRM master on
//! the card, which is a console nobody can get back.
//!
//! So each component is started in a process group of its own and the group is
//! what gets signalled. These tests are the only place that is asserted: it
//! cannot be read off a `Command`, because std exposes no getter for it, and a
//! unit test over the decision would be a test that we wrote the line we wrote.
//! A grandchild that really outlives its parent is the thing being prevented.

use std::path::Path;
use std::time::{Duration, Instant};

use domicile_launch::spawn::Spawn;
use domicile_launch::supervise::Running;

/// Whether the kernel still knows about this pid. Signal 0 checks permission
/// and existence without delivering anything, which is exactly the question.
fn alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

/// A shell that starts a long sleep, writes the sleeper's pid where the test
/// can read it, and then waits -- so the group has two members and the one the
/// supervisor holds is not the one that has to die.
fn parent_of_a_sleeper(pidfile: &Path) -> Spawn {
    Spawn {
        program: "/bin/sh".into(),
        args: vec![
            "-c".into(),
            format!(
                "sleep 300 & printf '%s' \"$!\" > {} ; wait",
                pidfile.display()
            )
            .into(),
        ],
        env: Vec::new(),
    }
}

/// The pid the shell wrote, once it has written it.
fn sleeper(pidfile: &Path) -> i32 {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if let Ok(text) = std::fs::read_to_string(pidfile) {
            if let Ok(pid) = text.trim().parse::<i32>() {
                if pid > 0 && alive(pid) {
                    return pid;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("the test child never reported a grandchild; it did not start");
}

/// The kernel does not free a pid the instant it is signalled, so a single
/// read after `drop` is a race the test would lose about as often as it won.
fn gone_within(pid: i32, patience: Duration) -> bool {
    let deadline = Instant::now() + patience;
    while Instant::now() < deadline {
        if !alive(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    !alive(pid)
}

#[test]
fn a_grandchild_does_not_outlive_the_run() {
    let dir = tempfile::tempdir().expect("a temp dir");
    let pidfile = dir.path().join("sleeper.pid");

    let mut running = Running::new();
    running
        .start("test component", &parent_of_a_sleeper(&pidfile))
        .expect("the test component starts");
    let grandchild = sleeper(&pidfile);

    drop(running);

    assert!(
        gone_within(grandchild, Duration::from_secs(10)),
        "pid {grandchild} is still running after the run ended: a component's \
         own children outlived it, which on a tty is a GPU process still \
         holding DRM master"
    );
}

#[test]
fn a_component_that_goes_quietly_is_not_waited_out() {
    // The other half of `LAST_WORDS`, and the regression it invites: a grace
    // period that is always spent is three seconds on the end of every run,
    // including the ordinary Ctrl-C. The engine is asked to stop and given
    // time; a component that takes it should cost nothing.
    let dir = tempfile::tempdir().expect("a temp dir");
    let pidfile = dir.path().join("sleeper.pid");

    let mut running = Running::new();
    running
        .start("test component", &parent_of_a_sleeper(&pidfile))
        .expect("the test component starts");
    sleeper(&pidfile);

    let started = Instant::now();
    drop(running);
    let took = started.elapsed();

    assert!(
        took < Duration::from_secs(2),
        "tearing down a component that answers SIGTERM took {took:?}, so the \
         grace period is being spent rather than offered"
    );
}
