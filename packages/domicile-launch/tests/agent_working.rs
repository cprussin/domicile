//! Tests for `domicile agent-working`'s lifetime: listed while the process
//! it works in runs, and that process ended when the user stops it.

use std::os::unix::net::UnixStream;
use std::process::Command;

use domicile_launch::agent_working::{last, Ended, Worked};

#[test]
fn it_ends_when_its_command_exits() {
    let (held, _desktop) = UnixStream::pair().unwrap();
    let child = Command::new("sh").args(["-c", "exit 3"]).spawn().unwrap();

    assert_eq!(last(&held, Worked::Child(child)), Ended::Exited(3));
}

#[test]
fn it_ends_when_a_process_it_did_not_start_exits() {
    let (held, _desktop) = UnixStream::pair().unwrap();
    let mut other = Command::new("sleep").arg("0.2").spawn().unwrap();
    let pid = other.id() as i32;
    // Reaped here, as its own parent would, once `last` holds its pid fd.
    let reaping = std::thread::spawn(move || other.wait().unwrap());

    assert_eq!(last(&held, Worked::Pid(pid)), Ended::Exited(0));
    reaping.join().unwrap();
}

#[test]
fn the_user_stopping_it_ends_its_command() {
    let (held, desktop) = UnixStream::pair().unwrap();
    let child = Command::new("sleep").arg("60").spawn().unwrap();

    // The desktop hangs up when the shell stops it.
    desktop.shutdown(std::net::Shutdown::Both).unwrap();

    assert_eq!(last(&held, Worked::Child(child)), Ended::Stopped(128 + 15));
}

#[test]
fn the_user_stopping_it_ends_a_process_it_did_not_start() {
    let (held, desktop) = UnixStream::pair().unwrap();
    let mut other = Command::new("sleep").arg("60").spawn().unwrap();
    let pid = other.id() as i32;

    desktop.shutdown(std::net::Shutdown::Both).unwrap();

    assert_eq!(last(&held, Worked::Pid(pid)), Ended::Stopped(1));
    use std::os::unix::process::ExitStatusExt as _;
    assert_eq!(other.wait().unwrap().signal(), Some(libc::SIGTERM));
}

#[test]
fn a_process_that_is_gone_already_ends_it_at_once() {
    let (held, _desktop) = UnixStream::pair().unwrap();
    let mut gone = Command::new("true").spawn().unwrap();
    let pid = gone.id() as i32;
    gone.wait().unwrap();

    assert_eq!(last(&held, Worked::Pid(pid)), Ended::Gone);
}
