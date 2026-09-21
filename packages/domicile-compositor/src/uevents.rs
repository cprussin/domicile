//! The kernel's own device notifications, as a file descriptor.
//!
//! **Why this exists at all: a battery has no other event.** The charge used
//! to be polled on a ten-second timer, which is the wrong mechanism twice
//! over — a lead going in is something the user is watching for and ten
//! seconds is a long time to stare at a bolt that has not lit, and between
//! those events the timer wakes a laptop's CPU to tell it nothing. The kernel
//! already announces the change: `power_supply_changed()` in the driver is a
//! `KOBJ_CHANGE` uevent, sent the moment the lead moves.
//!
//! **A socket, not libudev.** `domicile-compositor`'s manifest deliberately
//! takes neither Smithay's udev backend nor any C library beyond libxkbcommon,
//! and this keeps that promise: libudev's monitor is itself a thin wrapper
//! over `NETLINK_KOBJECT_UEVENT`, so opening that socket directly costs one
//! `libc` call and adds no crate to the tree.
//!
//! **Group 1, which is the kernel's own.** udevd re-broadcasts processed
//! events on another group in a format of its own, and subscribing there would
//! make the bar's charge depend on a daemon running. A desktop on a bare tty
//! is exactly the machine least likely to have one — see
//! `docs/architecture/A-DESKTOP-ON-A-TTY.md`, which is the same reasoning that
//! took the input path to logind rather than to a helper.
//!
//! **Nothing here is believed.** The datagram is a doorbell: the reading comes
//! from `/sys` afterwards, so an invented message costs one read of four small
//! files and can make the bar say nothing untrue. That is what makes a socket
//! anybody may write to safe to hang this on, and why there is no check on the
//! sender here — see `domicile_host::battery::announces_a_power_supply`.

use std::io;
use std::os::fd::{FromRawFd, OwnedFd};

/// The most a uevent can be, which is the kernel's own limit on one.
///
/// A datagram longer than the buffer is truncated rather than split, and a
/// truncated one only ever reads as "not a power supply" — so the cost of
/// being wrong here is a missed notification, and the backstop timer is what
/// covers that.
const BIGGEST_UEVENT: usize = 8192;

/// Subscribe to the kernel's device notifications.
///
/// The descriptor is non-blocking, so the caller can read it until it is empty
/// from an event loop that must not stop.
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
    // The kernel picks the port, which is what a zero here asks for: a
    // hard-coded one collides with any other subscriber in this process.
    address.nl_pid = 0;
    // Group 1 is the kernel's, as above.
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

/// Read what is waiting, and say whether any of it was a power supply.
///
/// Drains the socket rather than taking one datagram, because the source that
/// calls this is level-triggered and a single plug produces an event for the
/// charger and one for the battery — leaving the second queued would mean
/// re-reading `/sys` twice for one movement of one lead.
///
/// Any failed read ends the drain, an empty socket and an interrupted call
/// alike, and what has been seen so far is the answer. Nothing is lost by not
/// telling them apart: the source is level-triggered, so a socket that still
/// has something in it wakes the loop again straight away.
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
