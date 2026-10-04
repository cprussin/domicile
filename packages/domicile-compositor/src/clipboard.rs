//! Transfers clipboard data between a client and this process over a pipe.
//!
//! A Wayland selection is transferred through a pipe the client reads or
//! writes. Every wait here has a deadline, so a client that never reads or
//! writes cannot hang the compositor. Clipboard policy lives in
//! `domicile_host::clipboard`.

use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, BorrowedFd, FromRawFd, OwnedFd};
use std::os::unix::io::AsFd;
use std::time::{Duration, Instant};

/// How long a transfer may take before it is abandoned.
///
/// The client may be stuck or malicious. A local pipe moves a megabyte in
/// milliseconds, so two seconds is ample for a working client.
pub const PATIENCE: Duration = Duration::from_secs(2);

/// Creates a pipe, returning `(read end, write end)`.
///
/// Both ends are blocking, because the client's end must be. [`read_copy`] and
/// [`write_copy`] make this process's end non-blocking.
pub fn pipe() -> io::Result<(OwnedFd, OwnedFd)> {
    let mut ends = [0 as libc::c_int; 2];
    // SAFETY: `ends` is a two-element array of the type `pipe2` writes, and
    // the call borrows it only for its duration.
    let made = unsafe { libc::pipe2(ends.as_mut_ptr(), libc::O_CLOEXEC) };
    if made < 0 {
        Err(io::Error::last_os_error())
    } else {
        // SAFETY: `pipe2` just created both descriptors and nothing else
        // owns them.
        unsafe { Ok((OwnedFd::from_raw_fd(ends[0]), OwnedFd::from_raw_fd(ends[1]))) }
    }
}

/// Reads a selection from a client, up to `longest` bytes.
///
/// Finishes when the client closes its end. A selection longer than `longest`
/// is an error, not truncated, so a partial copy is never pasted back.
pub fn read_copy(from: OwnedFd, longest: usize, patience: Duration) -> io::Result<Vec<u8>> {
    let until = Instant::now() + patience;
    let mut reader = without_blocking(from)?;
    let mut copied = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match reader.read(&mut chunk) {
            // The client closed its end: the selection is complete.
            Ok(0) => return Ok(copied),
            Ok(read) => {
                copied.extend_from_slice(&chunk[..read]);
                if copied.len() > longest {
                    return Err(io::Error::other(format!(
                        "the copy is longer than the {longest} bytes worth keeping"
                    )));
                }
            }
            Err(again) if again.kind() == io::ErrorKind::WouldBlock => {
                ready(reader.as_fd(), libc::POLLIN, until)?;
            }
            Err(interrupted) if interrupted.kind() == io::ErrorKind::Interrupted => {}
            Err(failed) => return Err(failed),
        }
    }
}

/// Writes a selection to a client, then closes the pipe.
///
/// The client reads until end of file, so `into` is dropped on every return
/// path, including the timeout.
pub fn write_copy(into: OwnedFd, copy: &[u8], patience: Duration) -> io::Result<()> {
    let until = Instant::now() + patience;
    let mut writer = without_blocking(into)?;
    let mut written = 0;
    while written < copy.len() {
        match writer.write(&copy[written..]) {
            Ok(wrote) => written += wrote,
            Err(again) if again.kind() == io::ErrorKind::WouldBlock => {
                ready(writer.as_fd(), libc::POLLOUT, until)?;
            }
            Err(interrupted) if interrupted.kind() == io::ErrorKind::Interrupted => {}
            Err(failed) => return Err(failed),
        }
    }
    Ok(())
}

/// Makes `fd` non-blocking and wraps it in a `File` for `Read` and `Write`.
fn without_blocking(fd: OwnedFd) -> io::Result<std::fs::File> {
    // SAFETY: `fd` is owned here. A pipe's two ends are separate open file
    // descriptions, so this does not change the client's end.
    let flags = unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_GETFL) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: as above.
    let set = unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) };
    if set < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(std::fs::File::from(fd))
    }
}

/// Waits for `events` on `fd`, or fails at `until`.
///
/// Uses the time left before one deadline, so a client sending a byte at a
/// time cannot extend the transfer.
fn ready(fd: BorrowedFd, events: i16, until: Instant) -> io::Result<()> {
    let left = until.saturating_duration_since(Instant::now());
    if left.is_zero() {
        return Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "the client on the other end of the clipboard did not answer",
        ));
    }
    let mut watched = libc::pollfd {
        fd: fd.as_raw_fd(),
        events,
        revents: 0,
    };
    // SAFETY: one `pollfd` this call borrows for its duration, over a
    // descriptor borrowed for at least as long.
    let ready = unsafe { libc::poll(&mut watched, 1, left.as_millis() as libc::c_int) };
    match ready {
        0 => Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "the client on the other end of the clipboard did not answer",
        )),
        // Ready, or an error or hangup: the caller's next read or write says
        // which.
        _ if ready > 0 => Ok(()),
        _ => {
            let failed = io::Error::last_os_error();
            if failed.kind() == io::ErrorKind::Interrupted {
                Ok(())
            } else {
                Err(failed)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::thread;
    use std::time::Duration;

    use super::{pipe, read_copy, write_copy};

    /// Short, so tests that time out finish quickly.
    const IMPATIENT: Duration = Duration::from_millis(200);

    /// Reads what the client wrote, ending when it closes its end.
    #[test]
    fn a_copy_is_read_until_the_client_closes_its_end() {
        let (ours, theirs) = pipe().expect("a pipe");
        let writing = thread::spawn(move || {
            let mut end = std::fs::File::from(theirs);
            end.write_all(b"what was copied").expect("it writes");
        });

        let copied = read_copy(ours, 1024, IMPATIENT).expect("it reads");

        writing.join().expect("the writer finished");
        assert_eq!(copied, b"what was copied");
    }

    /// A selection over the limit is an error, not a truncated copy.
    #[test]
    fn a_copy_past_the_limit_is_an_error_rather_than_the_start_of_one() {
        let (ours, theirs) = pipe().expect("a pipe");
        thread::spawn(move || {
            let mut end = std::fs::File::from(theirs);
            // Ignored: the reader closes its end partway through.
            let _ = end.write_all(&vec![b'x'; 128 * 1024]);
        });

        let failed = read_copy(ours, 4096, IMPATIENT).expect_err("it refuses");

        assert!(
            failed.to_string().contains("longer than"),
            "it says why: {failed}"
        );
    }

    /// A client that never writes times out.
    #[test]
    fn a_client_that_never_writes_runs_out_of_patience() {
        let (ours, theirs) = pipe().expect("a pipe");

        let failed = read_copy(ours, 1024, IMPATIENT).expect_err("it gives up");

        assert_eq!(failed.kind(), std::io::ErrorKind::TimedOut);
        drop(theirs);
    }

    /// The client reads exactly what was written.
    #[test]
    fn a_copy_written_to_a_client_arrives_whole() {
        let (theirs, ours) = pipe().expect("a pipe");
        let reading = thread::spawn(move || {
            let mut end = std::fs::File::from(theirs);
            let mut read = Vec::new();
            std::io::Read::read_to_end(&mut end, &mut read).expect("it reads");
            read
        });

        write_copy(ours, b"handed back", IMPATIENT).expect("it writes");

        assert_eq!(reading.join().expect("the reader finished"), b"handed back");
    }

    /// A client that never reads times out.
    ///
    /// Writes more than the pipe buffer holds, so the write has to wait.
    #[test]
    fn a_client_that_never_reads_runs_out_of_patience() {
        let (theirs, ours) = pipe().expect("a pipe");

        let failed =
            write_copy(ours, &vec![b'y'; 4 * 1024 * 1024], IMPATIENT).expect_err("it gives up");

        assert_eq!(failed.kind(), std::io::ErrorKind::TimedOut);
        drop(theirs);
    }
}
