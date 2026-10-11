//! Raises the compositor's latency-critical threads to nice -8: the Wayland
//! thread and the engine library's IO thread, which every client frame and
//! input event goes through.
//!
//! See `docs/RUNNING-A-DESKTOP.md#thread-priorities`.

use std::fs;
use std::io;

use domicile_host::priority::{nice, set_nice, Tid};
use thiserror::Error;
use tracing::{info, warn};
use zbus::blocking::Connection;

/// The nice value Chromium gives the threads that draw and present frames
/// (`ThreadType::kDisplayCritical`).
pub const LATENCY_CRITICAL: i32 = -8;

/// The engine library's IO thread, named in `domicile_engine.cc`.
pub const ENGINE_THREAD: &str = "domicile-engine";

/// How [`raise`] got a thread to [`LATENCY_CRITICAL`].
#[derive(Debug, PartialEq, Eq)]
pub enum Raised {
    Directly,
    ThroughRtkit,
    /// The thread already ran at or below it, so it was left alone.
    AlreadyHigher,
}

/// Why [`raise`] could not.
#[derive(Debug, Error)]
#[error("setpriority: {direct}; rtkit: {rtkit}")]
pub struct Refused {
    direct: io::Error,
    rtkit: zbus::Error,
}

/// Raises thread `tid`, called `thread`, with [`raise`] and logs how it went.
///
/// A refusal is a warning: it is how a machine without the limits runs, and
/// the desktop still works.
pub fn raise_and_say(tid: Tid, thread: &str) {
    let current = nice(tid).expect("a thread of this process has a nice value");
    match raise(
        current,
        |nice| set_nice(tid, nice),
        |nice| through_rtkit(&Connection::system()?, tid, nice),
    ) {
        Ok(Raised::Directly) => info!(thread, nice = LATENCY_CRITICAL, "raised the thread"),
        Ok(Raised::ThroughRtkit) => info!(
            thread,
            nice = LATENCY_CRITICAL,
            "raised the thread through rtkit"
        ),
        Ok(Raised::AlreadyHigher) => info!(thread, nice = current, "the thread already runs high"),
        Err(refused) => warn!(
            thread,
            nice = current,
            %refused,
            "could not raise the thread to nice -8, so it competes with other work. See \
             docs/RUNNING-A-DESKTOP.md#thread-priorities"
        ),
    }
}

/// Raises the engine library's IO thread; see [`raise_and_say`].
///
/// Called after each join, since each join starts a new thread.
pub fn raise_the_engine_thread() {
    let tid = thread_named(ENGINE_THREAD)
        .expect("this process's threads can be listed")
        .expect("the engine library runs its IO thread once joined");
    raise_and_say(tid, ENGINE_THREAD);
}

/// Raises a thread at nice `current` to [`LATENCY_CRITICAL`] with `set`,
/// asking `rtkit` when `set` is refused, as it is without `RLIMIT_NICE`.
pub fn raise(
    current: i32,
    set: impl FnOnce(i32) -> io::Result<()>,
    rtkit: impl FnOnce(i32) -> zbus::Result<()>,
) -> Result<Raised, Refused> {
    if current <= LATENCY_CRITICAL {
        return Ok(Raised::AlreadyHigher);
    }
    match set(LATENCY_CRITICAL) {
        Ok(()) => Ok(Raised::Directly),
        Err(direct) => match rtkit(LATENCY_CRITICAL) {
            Ok(()) => Ok(Raised::ThroughRtkit),
            Err(rtkit) => Err(Refused { direct, rtkit }),
        },
    }
}

/// Asks rtkit on `bus` to set thread `tid` of this process to `nice`.
///
/// rtkit names the process by the caller's D-Bus credentials.
pub fn through_rtkit(bus: &Connection, tid: Tid, nice: i32) -> zbus::Result<()> {
    bus.call_method(
        Some("org.freedesktop.RealtimeKit1"),
        "/org/freedesktop/RealtimeKit1",
        Some("org.freedesktop.RealtimeKit1"),
        "MakeThreadHighPriority",
        &(tid as u64, nice),
    )?;
    Ok(())
}

/// The thread of this process named `name`, if there is one.
///
/// The kernel keeps 15 bytes of a name, so `name` must fit in them.
pub fn thread_named(name: &str) -> io::Result<Option<Tid>> {
    for task in fs::read_dir("/proc/self/task")? {
        let task = task?;
        let comm = match fs::read_to_string(task.path().join("comm")) {
            Ok(comm) => comm,
            // The thread ended after it was listed, so it is not the one.
            Err(gone)
                if gone.kind() == io::ErrorKind::NotFound
                    || gone.raw_os_error() == Some(libc::ESRCH) =>
            {
                continue
            }
            Err(error) => return Err(error),
        };
        if comm.trim_end_matches('\n') == name {
            let tid = task
                .file_name()
                .to_str()
                .and_then(|tid| tid.parse().ok())
                .expect("a task directory is named by its thread id");
            return Ok(Some(tid));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::portals::socket_pair;
    use domicile_host::priority::this_thread;
    use std::sync::mpsc::{channel, Sender};
    use std::sync::Mutex;
    use std::thread;

    fn refused() -> io::Result<()> {
        Err(io::Error::from_raw_os_error(libc::EACCES))
    }

    fn not_asked(_: i32) -> zbus::Result<()> {
        panic!("not asked")
    }

    #[test]
    fn a_thread_already_at_or_below_the_target_is_left_alone() {
        let raised = raise(-10, |_| panic!("not set"), not_asked).unwrap();

        assert_eq!(raised, Raised::AlreadyHigher);
    }

    #[test]
    fn a_permitted_raise_sets_the_target_directly() {
        let set = Mutex::new(None);
        let raised = raise(
            0,
            |nice| {
                *set.lock().unwrap() = Some(nice);
                Ok(())
            },
            not_asked,
        )
        .unwrap();

        assert_eq!(
            (raised, *set.lock().unwrap()),
            (Raised::Directly, Some(LATENCY_CRITICAL))
        );
    }

    #[test]
    fn a_refused_raise_asks_rtkit_for_the_target() {
        let asked = Mutex::new(None);
        let raised = raise(
            0,
            |_| refused(),
            |nice| {
                *asked.lock().unwrap() = Some(nice);
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(
            (raised, *asked.lock().unwrap()),
            (Raised::ThroughRtkit, Some(LATENCY_CRITICAL))
        );
    }

    #[test]
    fn a_raise_rtkit_refuses_too_names_both_reasons() {
        let said = raise(
            0,
            |_| refused(),
            |_| Err(zbus::Error::Failure("no rtkit here".into())),
        )
        .unwrap_err()
        .to_string();

        assert!(
            said.contains(&io::Error::from_raw_os_error(libc::EACCES).to_string()),
            "{said}"
        );
        assert!(said.contains("no rtkit here"), "{said}");
    }

    #[test]
    fn rtkit_is_asked_for_the_thread_and_the_nice_value() {
        struct Rtkit(Mutex<Sender<(u64, i32)>>);
        #[zbus::interface(name = "org.freedesktop.RealtimeKit1")]
        impl Rtkit {
            fn make_thread_high_priority(&self, thread: u64, priority: i32) {
                self.0.lock().unwrap().send((thread, priority)).unwrap();
            }
        }
        let (told, heard) = channel();
        let (_server, client) = socket_pair::connected(|server| {
            server
                .serve_at("/org/freedesktop/RealtimeKit1", Rtkit(Mutex::new(told)))
                .unwrap()
        });

        through_rtkit(&client, 4321, LATENCY_CRITICAL).unwrap();

        assert_eq!(heard.recv().unwrap(), (4321, LATENCY_CRITICAL));
    }

    #[test]
    fn a_named_thread_is_found_by_its_name() {
        let (told, heard) = channel();
        let (go_on, resumed) = channel::<()>();
        let named = thread::Builder::new()
            .name("prio-test-name".into())
            .spawn(move || {
                told.send(this_thread()).unwrap();
                resumed.recv().unwrap();
            })
            .unwrap();
        let tid = heard.recv().unwrap();

        assert_eq!(thread_named("prio-test-name").unwrap(), Some(tid));
        assert_eq!(thread_named("prio-test-none").unwrap(), None);
        go_on.send(()).unwrap();
        named.join().unwrap();
    }
}
