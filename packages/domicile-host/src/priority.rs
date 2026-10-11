//! Thread nice values: reading and setting them per thread, and starting a
//! process at a given one.
//!
//! Linux keeps a nice value per thread, and a new thread or process inherits
//! its creator's. See `docs/RUNNING-A-DESKTOP.md#thread-priorities`.

use std::io;
use std::os::unix::process::CommandExt;
use std::process::Command;

/// A thread's kernel id, as `gettid` returns it.
pub type Tid = libc::pid_t;

/// The calling thread's id.
pub fn this_thread() -> Tid {
    // SAFETY: no preconditions.
    unsafe { libc::gettid() }
}

/// Thread `tid`'s nice value.
pub fn nice(tid: Tid) -> io::Result<i32> {
    // `getpriority` returns -1 for both an error and nice -1, so errno is
    // what tells them apart.
    // SAFETY: errno is thread-local, and `getpriority` takes plain integers.
    unsafe { *libc::__errno_location() = 0 };
    let nice = unsafe { libc::getpriority(libc::PRIO_PROCESS, tid as libc::id_t) };
    match io::Error::last_os_error() {
        error if nice == -1 && error.raw_os_error() != Some(0) => Err(error),
        _ => Ok(nice),
    }
}

/// Sets thread `tid`'s nice value.
///
/// Lowering it below the caller's needs `RLIMIT_NICE` or `CAP_SYS_NICE`.
/// Raising it is always allowed.
pub fn set_nice(tid: Tid, nice: i32) -> io::Result<()> {
    // On Linux, `PRIO_PROCESS` with a thread id sets that thread alone.
    // SAFETY: plain integers.
    match unsafe { libc::setpriority(libc::PRIO_PROCESS, tid as libc::id_t, nice) } {
        0 => Ok(()),
        _ => Err(io::Error::last_os_error()),
    }
}

/// Makes `command`'s process start at `nice` instead of the spawning
/// thread's.
///
/// `nice` must be no lower than the spawning thread's, or the spawn fails
/// with `EACCES` where lowering is not allowed.
pub fn starting_at(command: &mut Command, nice: i32) -> &mut Command {
    // SAFETY: `setpriority` and `errno` are async-signal-safe, and nothing
    // here allocates.
    unsafe { command.pre_exec(move || set_nice(0, nice)) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;
    use std::thread;

    /// A nice value above any a test runner starts at, so setting it is
    /// always allowed.
    const LOWER: i32 = 15;

    #[test]
    fn a_thread_set_to_a_nice_value_reads_it_back_from_another() {
        let (told, heard) = channel();
        let (go_on, resumed) = channel::<()>();
        let set = thread::spawn(move || {
            let tid = this_thread();
            set_nice(tid, LOWER).expect("raising a nice value is allowed");
            told.send(tid).unwrap();
            resumed.recv().unwrap();
        });
        let tid = heard.recv().unwrap();

        assert_eq!(nice(tid).unwrap(), LOWER);
        assert_ne!(tid, this_thread());
        go_on.send(()).unwrap();
        set.join().unwrap();
    }

    #[test]
    fn a_process_starts_at_the_nice_value_it_was_given() {
        let ran = starting_at(&mut Command::new("nice"), LOWER)
            .output()
            .expect("`nice` runs");

        assert_eq!(String::from_utf8(ran.stdout).unwrap(), format!("{LOWER}\n"));
    }
}
