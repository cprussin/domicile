//! Finds the process on the other end of a client's connection.
//!
//! The log has `spawning client` when a client starts and `toplevel mapped`
//! when it first commits a buffer. Logging the connection in between splits a
//! slow launch into client startup and the client's Wayland setup.
//!
//! The pid comes from `SO_PEERCRED`, which the kernel records at
//! `connect(2)`, so the client cannot forge it. That lets a connection be
//! matched to its spawn when several clients launch at once.
//!
//! Uses `libc` because `UnixStream::peer_cred` is still unstable
//! (`peer_credentials_unix_socket`).

use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;

use tracing::warn;

/// The pid on the far end of `stream`, as the kernel recorded it.
///
/// `None` if the kernel refuses. That is logged, and only costs the log line
/// its pid; the connection carries on.
pub fn peer_pid(stream: &UnixStream) -> Option<i32> {
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
        0 => Some(credentials.pid),
        _ => {
            warn!(
                err = %std::io::Error::last_os_error(),
                "a client's credentials would not read; its arrival names no process"
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::net::UnixStream;

    use super::peer_pid;

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
}
