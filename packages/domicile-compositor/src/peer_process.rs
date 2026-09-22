//! Which process is on the other end of a client's connection.
//!
//! **This is the half of "the app took forever to appear" the compositor
//! cannot otherwise see.** A launched client leaves two lines in the log — the
//! `spawning client` that starts it and the `toplevel mapped` when it first
//! commits a buffer — and the gap between them is two things stacked: the
//! client starting up, and then the client talking to us. A `kitty` that took
//! 3.6s to appear on a desktop that had been up and idle for four seconds
//! before it was asked for left nothing at all in between, so neither half
//! could be ruled out and the compositor was as good a suspect as the
//! terminal. An arrival logged between the two splits it, and every later
//! `kitty` in that same run took 150ms, which is the shape of a cost paid
//! once — but reading it that way is a guess until a line says where the time
//! went.
//!
//! **`SO_PEERCRED`, so the pid is the kernel's word and not the client's.**
//! It is stamped at `connect(2)`, which makes it the same kind of
//! discriminator the chrome's own socket is: the compositor knows which
//! process arrived rather than being told. That is what lets an arrival be
//! matched to the spawn that caused it when a launcher opens several at once,
//! which is exactly what a person impatiently pressing the key again does.
//!
//! A `libc` call rather than `UnixStream::peer_cred`, which is still unstable
//! (`peer_credentials_unix_socket`). `libc` is already in this crate's
//! manifest and is the libc every Rust binary links, so this adds nothing to
//! the tree — the same reasoning `uevents` opens its netlink socket with.

use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;

use tracing::warn;

/// The process on the far end of `stream`, as the kernel recorded it.
///
/// `None` is a credential the kernel would not give, which is said on the way
/// past and costs the caller nothing else: the connection is the desktop's
/// business and the line is only ours, so this is an operator losing one
/// attribution rather than a person losing their terminal.
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
        // Both ends of a pair are held by this process, so this process is
        // who the far end is. A real socket rather than a contrived
        // descriptor, because `SO_PEERCRED` is only answered for one: the
        // thing under test is the kernel's answer, not the call's spelling.
        let (client, compositor) = UnixStream::pair().expect("a socket pair");

        assert_eq!(
            peer_pid(&compositor),
            Some(std::process::id() as i32),
            "the far end of a socket pair is this very process"
        );

        drop(client);
    }
}
