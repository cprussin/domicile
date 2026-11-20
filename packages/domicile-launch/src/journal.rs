//! Writes log entries to systemd's journal over its native protocol.
//!
//! An entry carries a priority and the name of the component that said it, so
//! `journalctl -p err` and `journalctl -t domicile-engine` work. A line on a
//! journal stream gets neither: every line is the same priority, under the
//! name of whatever started the desktop.
//!
//! Only used when stderr is the journal ([`stderr_is_the_journal`]). On a
//! terminal or in a file, lines are written as they were said.
//!
//! The protocol: <https://systemd.io/JOURNAL_NATIVE_PROTOCOL/>.

use std::os::fd::{AsFd, BorrowedFd};
use std::os::unix::net::UnixDatagram;
use std::path::Path;

/// Where journald listens for native entries.
pub const SOCKET: &str = "/run/systemd/journal/socket";

/// A syslog priority, as `PRIORITY` takes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Priority {
    Critical = 2,
    Error = 3,
    Warning = 4,
    Info = 6,
    Debug = 7,
}

/// One journal entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// `SYSLOG_IDENTIFIER`, which `journalctl -t` matches.
    pub identifier: &'static str,
    pub priority: Priority,
    pub message: String,
    /// More fields, after the message. Names are upper case, as journald
    /// requires.
    pub fields: Vec<(&'static str, String)>,
}

/// The datagram journald reads for `entry`.
pub fn encoded(entry: &Entry) -> Vec<u8> {
    let priority = (entry.priority as u8).to_string();
    let mut out = Vec::new();
    [
        ("PRIORITY", priority.as_str()),
        ("SYSLOG_IDENTIFIER", entry.identifier),
        ("MESSAGE", entry.message.as_str()),
    ]
    .into_iter()
    .chain(
        entry
            .fields
            .iter()
            .map(|(name, value)| (*name, value.as_str())),
    )
    .for_each(|(name, value)| field(&mut out, name, value));
    out
}

/// Appends one field. A value holding a newline is sent with its length, so
/// the newline is not read as the end of the field.
fn field(out: &mut Vec<u8>, name: &str, value: &str) {
    out.extend_from_slice(name.as_bytes());
    if value.contains('\n') {
        out.push(b'\n');
        out.extend_from_slice(&(value.len() as u64).to_le_bytes());
    } else {
        out.push(b'=');
    }
    out.extend_from_slice(value.as_bytes());
    out.push(b'\n');
}

/// Whether `JOURNAL_STREAM` names the stream with this device and inode.
///
/// systemd sets the variable to `<device>:<inode>` of the stream it gave a
/// service as stdout and stderr. A child whose stderr was redirected inherits
/// the variable, so it must be checked against the stream itself.
pub fn names(stream: Option<&str>, device: u64, inode: u64) -> bool {
    stream
        .and_then(|stream| stream.split_once(':'))
        .is_some_and(|(d, i)| d.parse() == Ok(device) && i.parse() == Ok(inode))
}

/// Whether `fd` is the journal stream `JOURNAL_STREAM` names.
pub fn is_the_journal(fd: BorrowedFd) -> bool {
    let stat = fstat(fd);
    names(
        std::env::var("JOURNAL_STREAM").ok().as_deref(),
        stat.st_dev,
        stat.st_ino,
    )
}

/// Whether this process's stderr is the journal.
pub fn stderr_is_the_journal() -> bool {
    is_the_journal(std::io::stderr().as_fd())
}

/// `fstat` on a descriptor this process holds open, which cannot fail.
fn fstat(fd: BorrowedFd) -> libc::stat {
    use std::os::fd::AsRawFd;
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: `fd` is open for the borrow, and `stat` has room for the result.
    let done = unsafe { libc::fstat(fd.as_raw_fd(), stat.as_mut_ptr()) };
    assert_eq!(
        done,
        0,
        "fstat on an open descriptor: {}",
        std::io::Error::last_os_error()
    );
    // SAFETY: `fstat` succeeded, so it filled `stat`.
    unsafe { stat.assume_init() }
}

/// A connection to journald's native socket.
pub struct Journal {
    socket: UnixDatagram,
}

impl Journal {
    /// Connects to the socket at `path`, usually [`SOCKET`].
    pub fn at(path: &Path) -> std::io::Result<Journal> {
        let socket = UnixDatagram::unbound()?;
        socket.connect(path)?;
        Ok(Journal { socket })
    }

    /// Sends one entry.
    ///
    /// An entry larger than a datagram fails with `EMSGSIZE`; the caller
    /// writes it to stderr instead.
    pub fn send(&self, entry: &Entry) -> std::io::Result<()> {
        self.socket.send(&encoded(entry)).map(|_| ())
    }
}
