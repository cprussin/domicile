//! A netlink socket for kernel uevents, used to see battery and charger
//! changes as they happen instead of polling.
//!
//! - **Netlink, not libudev.** The crate links no C library beyond
//!   libxkbcommon, and libudev's monitor wraps this same socket.
//! - **Group 1, the kernel's.** udevd's group would make the battery readout
//!   depend on udevd, which a bare tty may not run (see
//!   `docs/architecture/A-DESKTOP-ON-A-TTY.md`).
//! - **No sender check.** A uevent only triggers a re-read of `/sys`, so a
//!   forged one cannot make the readout wrong. See
//!   `domicile_host::battery::announces_a_power_supply`.

use std::io;
use std::os::fd::{FromRawFd, OwnedFd};

/// The kernel's maximum uevent size.
///
/// A longer datagram is truncated and reads as "not a power supply". The
/// backstop timer covers that missed notification.
const BIGGEST_UEVENT: usize = 8192;

/// Subscribes to kernel uevents.
///
/// The descriptor is non-blocking so an event loop can drain it.
pub fn subscribe() -> io::Result<OwnedFd> {
    // SAFETY: a socket with no borrowed memory. The descriptor is wrapped in
    // an `OwnedFd` before anything can return early, so it is closed on every
    // path out of this function.
    let socket = unsafe {
        libc::socket(
            libc::AF_NETLINK,
            libc::SOCK_DGRAM | libc::SOCK_CLOEXEC | libc::SOCK_NONBLOCK,
            libc::NETLINK_KOBJECT_UEVENT,
        )
    };
    if socket < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: `socket` is a descriptor this call just made and nothing else
    // holds.
    let held = unsafe { OwnedFd::from_raw_fd(socket) };

    // SAFETY: zeroed is the documented way to build this, and every field that
    // matters is set below.
    let mut address: libc::sockaddr_nl = unsafe { std::mem::zeroed() };
    address.nl_family = libc::AF_NETLINK as libc::sa_family_t;
    // Zero lets the kernel pick the port, so it cannot collide with another
    // subscriber in this process.
    address.nl_pid = 0;
    // The kernel's group; see the module comment.
    address.nl_groups = 1;

    // SAFETY: the address is a `sockaddr_nl` this stack frame owns, and the
    // length is its own size.
    let bound = unsafe {
        libc::bind(
            socket,
            std::ptr::addr_of!(address).cast::<libc::sockaddr>(),
            std::mem::size_of::<libc::sockaddr_nl>() as libc::socklen_t,
        )
    };
    if bound < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(held)
    }
}

/// Drains the socket and returns whether any datagram was `interesting`.
///
/// Drains instead of reading one datagram because one plug sends events for
/// both charger and battery, and each would cost a `/sys` re-read.
///
/// Any failed read ends the drain. The source is level-triggered, so data left
/// after an interrupted read wakes the loop again.
pub fn drain(socket: &OwnedFd, mut interesting: impl FnMut(&[u8]) -> bool) -> bool {
    let mut buffer = [0_u8; BIGGEST_UEVENT];
    let mut worth_reading = false;
    loop {
        // SAFETY: the buffer is this frame's and the length is its own.
        let got = unsafe {
            libc::recv(
                std::os::fd::AsRawFd::as_raw_fd(socket),
                buffer.as_mut_ptr().cast::<libc::c_void>(),
                buffer.len(),
                0,
            )
        };
        match usize::try_from(got) {
            Ok(read) => worth_reading |= interesting(&buffer[..read]),
            Err(_) => return worth_reading,
        }
    }
}
