//! Moving a copy between a client and this process, over a pipe with an end
//! to it.
//!
//! **A Wayland selection is a file descriptor and a promise.** Reading one
//! means handing the offering client a pipe and waiting for it to write; being
//! the selection means being handed a pipe and writing into it. Both of those
//! are a client's work happening on the compositor's clock, which is what this
//! module is for: every wait has a deadline, so a client that offers the
//! clipboard and then never writes costs one abandoned descriptor rather than
//! the desktop.
//!
//! The policy — what is worth keeping, what a row looks like — is
//! `domicile_host::clipboard`, which needs none of this.

use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, BorrowedFd, FromRawFd, OwnedFd};
use std::os::unix::io::AsFd;
use std::time::{Duration, Instant};

/// How long either half of a transfer may take before it is abandoned.
///
/// **A bound on a stranger's work.** The client on the other end is not this
/// process and may be stopped, wedged or malicious, so the only honest
/// question is how long a transfer that is going to happen could take — and a
/// local pipe carrying at most a megabyte is answered in milliseconds. Two
/// seconds is orders of magnitude past that and still short enough that a
/// wedged client's descriptor does not outlive the copy that made it.
pub const PATIENCE: Duration = Duration::from_secs(2);

/// A pipe: the end to read, then the end to hand over.
///
/// Neither end is non-blocking here, and the end that leaves is why. It goes
/// to a client, which writes it with `write(2)` and is entitled to expect that
/// to block rather than to answer `EAGAIN`; the end this process keeps is put
/// into non-blocking mode by whichever of the two functions below owns it.
pub fn pipe() -> io::Result<(OwnedFd, OwnedFd)> {
    let mut ends = [0 as libc::c_int; 2];
    // SAFETY: `ends` is a two-element array of the type `pipe2` writes, and
    // the call borrows it only for its duration. The descriptors are wrapped
    // in `OwnedFd`s before anything can return early, so both are closed on
    // every path out of here.
    let made = unsafe { libc::pipe2(ends.as_mut_ptr(), libc::O_CLOEXEC) };
    if made < 0 {
        Err(io::Error::last_os_error())
    } else {
        // SAFETY: two descriptors `pipe2` has just made and nothing else
        // holds.
        unsafe { Ok((OwnedFd::from_raw_fd(ends[0]), OwnedFd::from_raw_fd(ends[1]))) }
    }
}

/// Read a copy out of a client, up to `longest` bytes.
///
/// Ends when the client closes its end, which is how a selection says it has
/// written all of it. A copy bigger than `longest` is an error rather than the
/// first `longest` bytes of one: half of what was copied is not what was
/// copied, and a manager that pasted it back would be a manager that corrupts
/// what it holds.
pub fn read_copy(from: OwnedFd, longest: usize, patience: Duration) -> io::Result<Vec<u8>> {
    let until = Instant::now() + patience;
    let mut reader = without_blocking(from)?;
    let mut copied = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match reader.read(&mut chunk) {
            // The client closed its end, which is the whole of how a selection
            // says it is done.
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

/// Write a copy into a client, and close the pipe behind it.
///
/// The close is the message: a client reads a selection until the end of the
/// file, so a transfer that wrote every byte and left the descriptor open
/// would be a paste that never finishes. Dropping the fd on every path out of
/// here — the deadline included — is what says so.
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

/// The same descriptor, answering `EAGAIN` instead of parking this thread.
///
/// As a `File` because that is the shape `read`/`write` are on: an `OwnedFd`
/// alone has neither, and this keeps the descriptor owned so it is still
/// closed exactly once.
fn without_blocking(fd: OwnedFd) -> io::Result<std::fs::File> {
    // SAFETY: `fd` is owned here and its flags are its own — a pipe's two ends
    // are two open file descriptions, so this cannot make a client's end
    // non-blocking underneath it.
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

/// Wait for `events` on `fd`, or give up at `until`.
///
/// The timeout is what is left of the deadline rather than a fresh interval,
/// so a client that dribbles a byte at a time cannot renew its own patience: a
/// transfer has one budget however many turns it takes.
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
        // Out of time, which is the deadline doing its job rather than a
        // failure to report as one.
        0 => Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "the client on the other end of the clipboard did not answer",
        )),
        // Interrupted, or ready. Either way the caller's next read or write is
        // what says which, and a spurious turn costs one syscall.
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

    /// Short, because every test below that waits is waiting for this.
    const IMPATIENT: Duration = Duration::from_millis(200);

    /// What a client writes is what comes back, and the close is the end of it.
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

    /// A copy bigger than what is worth keeping is an error, not a prefix.
    ///
    /// The prefix is the dangerous answer: it is a plausible-looking copy that
    /// is not the one that was made, and pasting it somewhere would be this
    /// desktop quietly corrupting what a person put on the clipboard.
    #[test]
    fn a_copy_past_the_limit_is_an_error_rather_than_the_start_of_one() {
        let (ours, theirs) = pipe().expect("a pipe");
        thread::spawn(move || {
            let mut end = std::fs::File::from(theirs);
            // Ignored: the reader gives up partway through a copy this size,
            // so the far end of this write goes away underneath it, which is
            // the behavior being asserted rather than a failure.
            let _ = end.write_all(&vec![b'x'; 128 * 1024]);
        });

        let failed = read_copy(ours, 4096, IMPATIENT).expect_err("it refuses");

        assert!(
            failed.to_string().contains("longer than"),
            "it says why: {failed}"
        );
    }

    /// A client that offers the clipboard and then says nothing costs a
    /// deadline, not a desktop.
    #[test]
    fn a_client_that_never_writes_runs_out_of_patience() {
        let (ours, theirs) = pipe().expect("a pipe");

        let failed = read_copy(ours, 1024, IMPATIENT).expect_err("it gives up");

        assert_eq!(failed.kind(), std::io::ErrorKind::TimedOut);
        drop(theirs);
    }

    /// And the other direction: what this process writes is what the client
    /// reads, ending where the write did.
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

    /// A client that asks for the clipboard and then never reads it is the
    /// same failure the other way round, and gets the same answer.
    ///
    /// More than a pipe will hold, because a short write is answered by the
    /// kernel's buffer and never waits for anybody.
    #[test]
    fn a_client_that_never_reads_runs_out_of_patience() {
        let (theirs, ours) = pipe().expect("a pipe");

        let failed =
            write_copy(ours, &vec![b'y'; 4 * 1024 * 1024], IMPATIENT).expect_err("it gives up");

        assert_eq!(failed.kind(), std::io::ErrorKind::TimedOut);
        drop(theirs);
    }
}
