//! Finds the process on the other end of a client's connection.
//!
//! The log has `spawning client` when a client starts and `toplevel drew`
//! when it first commits a buffer. Logging the connection in between splits a
//! slow launch into client startup and the client's Wayland setup.
//!
//! The pid, uid and gid come from `SO_PEERCRED`, which the kernel records at
//! `connect(2)`, so the client cannot forge them. That lets a connection be
//! matched to its spawn when several clients launch at once, and gives the
//! shell each window's owner.
//!
//! Uses `libc` because `UnixStream::peer_cred` is still unstable
//! (`peer_credentials_unix_socket`).

use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::net::UnixStream;

use domicile_protocol::Owner;
use tracing::warn;

/// pidfs's `f_type`, from `<linux/magic.h>`. `libc` does not define it.
const PIDFS_MAGIC: i64 = 0x5049_4446;

/// The pid on the far end of `stream`, as the kernel recorded it.
///
/// `None` if the kernel refuses. That is logged, and only costs the log line
/// its pid; the connection carries on.
pub fn peer_pid(stream: &UnixStream) -> Option<i32> {
    match peer_owner(stream) {
        Ok(owner) => Some(owner.pid),
        Err(err) => {
            warn!(
                %err,
                "a client's credentials would not read; its arrival names no process"
            );
            None
        }
    }
}

/// The process on the far end of `stream`, as the kernel recorded it.
pub fn peer_owner(stream: &UnixStream) -> io::Result<Owner> {
    let mut credentials = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut length = size_of::<libc::ucred>() as libc::socklen_t;
    // SAFETY: the descriptor is the stream's and is borrowed only for this
    // call; the destination is this frame's `ucred` and the length beside it
    // is that struct's own, so the kernel writes nothing past it.
    let asked = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            std::ptr::addr_of_mut!(credentials).cast(),
            &mut length,
        )
    };
    match asked {
        0 => Ok(Owner {
            pid: credentials.pid,
            uid: credentials.uid,
            gid: credentials.gid,
            pidfd_inode: peer_pidfd_inode(stream)?,
            sandbox: None,
        }),
        _ => Err(io::Error::last_os_error()),
    }
}

/// The inode of the peer's pidfd, or `None` on a kernel without pidfs.
///
/// Before Linux 6.9 every pidfd shares one anonymous inode, and before 6.5
/// `SO_PEERPIDFD` does not exist.
fn peer_pidfd_inode(stream: &UnixStream) -> io::Result<Option<u64>> {
    let mut fd: libc::c_int = -1;
    let mut length = size_of::<libc::c_int>() as libc::socklen_t;
    // SAFETY: as in `peer_owner`, with a `c_int` destination.
    let asked = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERPIDFD,
            std::ptr::addr_of_mut!(fd).cast(),
            &mut length,
        )
    };
    if asked != 0 {
        let err = io::Error::last_os_error();
        return match err.raw_os_error() {
            Some(libc::ENOPROTOOPT) => Ok(None),
            _ => Err(err),
        };
    }
    // SAFETY: the kernel just opened `fd` for this process, and nothing else
    // owns it.
    let pidfd = unsafe { OwnedFd::from_raw_fd(fd) };
    // SAFETY: all-zero `statfs` and `stat` are valid values.
    let (mut filesystem, mut stats): (libc::statfs, libc::stat) =
        unsafe { (std::mem::zeroed(), std::mem::zeroed()) };
    // SAFETY: the descriptor is open, and each destination is this frame's.
    if unsafe { libc::fstatfs(pidfd.as_raw_fd(), &mut filesystem) } != 0 {
        return Err(io::Error::last_os_error());
    }
    if filesystem.f_type != PIDFS_MAGIC {
        return Ok(None);
    }
    // SAFETY: as for `fstatfs`.
    if unsafe { libc::fstat(pidfd.as_raw_fd(), &mut stats) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(Some(stats.st_ino))
}

#[cfg(test)]
mod tests {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::net::UnixStream;

    use super::{peer_owner, peer_pid, PIDFS_MAGIC};

    #[test]
    fn an_arrival_names_the_process_on_the_far_end() {
        // This process holds both ends of the pair, so it is the peer. The
        // test needs a real socket because `SO_PEERCRED` only works on one.
        let (client, compositor) = UnixStream::pair().expect("a socket pair");

        assert_eq!(
            peer_pid(&compositor),
            Some(std::process::id() as i32),
            "the far end of a socket pair is this very process"
        );

        drop(client);
    }

    #[test]
    fn an_arrival_names_the_user_and_group_on_the_far_end() {
        let (_client, compositor) = UnixStream::pair().expect("a socket pair");

        let owner = peer_owner(&compositor).expect("the credentials read");

        // SAFETY: `getuid` and `getgid` cannot fail and touch no memory.
        let (uid, gid) = unsafe { (libc::getuid(), libc::getgid()) };
        assert_eq!(
            (owner.pid, owner.uid, owner.gid),
            (std::process::id() as i32, uid, gid)
        );
    }

    #[test]
    fn an_arrival_names_its_process_beyond_its_pid() {
        // pidfs gives each process its own inode, so a reused pid has a
        // different one. Without pidfs every pidfd shares one inode, which
        // names nothing.
        let (_client, compositor) = UnixStream::pair().expect("a socket pair");

        let owner = peer_owner(&compositor).expect("the credentials read");

        let own = own_pidfd();
        let wanted = (filesystem(&own) == PIDFS_MAGIC).then(|| inode(&own));
        assert_eq!(owner.pidfd_inode, wanted);
    }

    /// A pidfd for this process.
    fn own_pidfd() -> OwnedFd {
        // SAFETY: `pidfd_open` takes a pid and flags and touches no memory.
        let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, std::process::id(), 0) };
        assert!(fd >= 0, "pidfd_open: {}", std::io::Error::last_os_error());
        // SAFETY: `fd` was just opened and nothing else owns it.
        unsafe { OwnedFd::from_raw_fd(fd as i32) }
    }

    fn filesystem(fd: &OwnedFd) -> i64 {
        // SAFETY: an all-zero `statfs` is a valid value.
        let mut stats: libc::statfs = unsafe { std::mem::zeroed() };
        // SAFETY: the descriptor is open and `stats` is this frame's.
        assert_eq!(unsafe { libc::fstatfs(fd.as_raw_fd(), &mut stats) }, 0);
        stats.f_type
    }

    fn inode(fd: &OwnedFd) -> u64 {
        // SAFETY: an all-zero `stat` is a valid value.
        let mut stats: libc::stat = unsafe { std::mem::zeroed() };
        // SAFETY: the descriptor is open and `stats` is this frame's.
        assert_eq!(unsafe { libc::fstat(fd.as_raw_fd(), &mut stats) }, 0);
        stats.st_ino
    }
}
