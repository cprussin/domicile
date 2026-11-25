//! `domicile agent-working <name>`: an agent listed in the bar as working on
//! this computer, reaching nothing on the desk, while a process runs. See
//! `docs/AGENTS.md`.
//!
//! The command holds a [`crate::control::Request::Agent`] with `working`
//! until the process it works in exits. The user stopping it from the bar
//! hangs up on the command, which sends that process `SIGTERM`.

use std::os::fd::{AsFd as _, AsRawFd as _, FromRawFd as _, OwnedFd};
use std::os::unix::net::UnixStream;
use std::process::Child;

use crate::idle_inhibit::exit_code;

/// The process an agent works in.
#[derive(Debug)]
pub enum Worked {
    /// One running already, such as the agent's own, which another process
    /// reaps.
    Pid(i32),
    /// One this command started.
    Child(Child),
}

/// How an agent's work ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ended {
    /// The process exited, with this code as a shell would give it: 0 for a
    /// process this command did not start, whose code it cannot read.
    Exited(u8),
    /// The user stopped it from the bar, which ended the process. The code to
    /// exit with: the command's, or 1.
    Stopped(u8),
    /// There was no such process to begin with.
    Gone,
}

/// Lists the agent `held` holds until `worked` exits, or ends `worked` once
/// the desktop hangs up on `held`, as it does when the user stops it.
pub fn last(held: &UnixStream, worked: Worked) -> Ended {
    let pid = match &worked {
        Worked::Pid(pid) => *pid,
        Worked::Child(child) => child.id() as i32,
    };
    let Some(process) = pid_fd(pid) else {
        assert!(
            matches!(worked, Worked::Pid(_)),
            "a child this command started and has not reaped has a pid fd"
        );
        return Ended::Gone;
    };
    let stopped = until_either(&process, held);
    if stopped {
        // SAFETY: `pidfd_send_signal` takes a live pid fd, a signal, no info
        // and no flags.
        let sent = unsafe {
            libc::syscall(
                libc::SYS_pidfd_send_signal,
                process.as_raw_fd(),
                libc::SIGTERM,
                std::ptr::null::<libc::siginfo_t>(),
                0,
            )
        };
        // ESRCH: it exited meanwhile, which ends it as well.
        assert!(
            sent == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH),
            "ending the agent's process failed: {}",
            std::io::Error::last_os_error()
        );
    }
    let code = match worked {
        Worked::Child(mut child) => Some(exit_code(
            child.wait().expect("a child this command started is waited on once"),
        )),
        Worked::Pid(_) => None,
    };
    match (stopped, code) {
        (false, code) => Ended::Exited(code.unwrap_or(0)),
        (true, code) => Ended::Stopped(code.unwrap_or(1)),
    }
}

/// A pid fd for `pid`, or `None` when no such process runs.
fn pid_fd(pid: i32) -> Option<OwnedFd> {
    // SAFETY: `pidfd_open` takes a pid and flags, and returns a new fd or -1.
    let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
    if fd < 0 {
        let why = std::io::Error::last_os_error();
        assert_eq!(
            why.raw_os_error(),
            Some(libc::ESRCH),
            "opening process {pid}'s pid fd failed: {why}"
        );
        return None;
    }
    // SAFETY: the kernel just opened `fd`, and nothing else owns it.
    Some(unsafe { OwnedFd::from_raw_fd(fd as i32) })
}

/// Waits until `process` exits or anything comes on `held`, a hang-up
/// included. True for the latter.
fn until_either(process: &OwnedFd, held: &UnixStream) -> bool {
    let mut polled = [
        libc::pollfd {
            fd: process.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        },
        libc::pollfd {
            fd: held.as_fd().as_raw_fd(),
            events: libc::POLLIN | libc::POLLRDHUP,
            revents: 0,
        },
    ];
    loop {
        // SAFETY: `polled` is a live array of `polled.len()` entries.
        let ready = unsafe { libc::poll(polled.as_mut_ptr(), polled.len() as libc::nfds_t, -1) };
        if ready > 0 {
            // The process exiting wins a tie: there is nothing left to stop.
            return polled[0].revents == 0;
        }
        let why = std::io::Error::last_os_error();
        assert_eq!(
            why.kind(),
            std::io::ErrorKind::Interrupted,
            "waiting on the agent's process failed: {why}"
        );
    }
}
