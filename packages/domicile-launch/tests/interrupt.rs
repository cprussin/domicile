//! A stop request ends the wait for an exit.
//!
//! Its own test binary, since the interrupt is process-wide and would end
//! every other test's wait too.

use std::ffi::OsString;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use domicile_launch::spawn::Spawn;
use domicile_launch::supervise::{catch_interrupts, Running};

#[test]
fn a_stop_ends_the_wait_while_everything_is_running() {
    catch_interrupts();
    let mut running = Running::new();
    running
        .start(
            "engine",
            &Spawn {
                program: PathBuf::from("/bin/sh"),
                args: vec![OsString::from("-c"), OsString::from("sleep 30")],
                env: Vec::new(),
            },
        )
        .expect("it starts");
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(200));
        // SAFETY: signals this process, whose handler only notes it.
        unsafe { libc::kill(libc::getpid(), libc::SIGTERM) };
    });
    let asked = Instant::now();

    let exit = running.until_one_exits();

    assert_eq!((exit.what, exit.how.as_str()), ("desktop", "interrupted"));
    assert!(asked.elapsed() < Duration::from_secs(10));
}
