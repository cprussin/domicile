//! Which profile this desktop takes, when others may be running.
//!
//! **Chromium runs one browser per profile.** A second engine handed a
//! `--user-data-dir` another is running on does not start: it passes its
//! command line to the first over the profile's `SingletonSocket` and exits.
//! A second desktop on the kept profile is therefore an engine that never
//! reaches its compositor, and a window of the second shell opened on the
//! first desktop.
//!
//! So each running desktop holds its profile, and one that finds it held takes
//! the next: `profile`, then `profile-2`, `profile-3` — the way a second
//! compositor takes `wayland-2`. Kept between runs like the first, so a desktop
//! that is always run beside another keeps its sign-ins too.
//!
//! **Held with `flock` on a file beside the profile**, not inside it and not by
//! reading Chromium's `SingletonLock`: the kernel lets go of a `flock` when the
//! process holding it dies, however it dies, so a desktop that was killed
//! leaves nothing that has to be judged stale. The supervisor holds it rather
//! than the engine because the engine is started again under it, and a profile
//! that was free between two engines would be one another desktop could take.

use std::fs::{File, OpenOptions};
use std::io;
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};

/// A profile this process holds, for as long as this is alive.
pub struct Claimed {
    /// The directory the engine is handed as `--user-data-dir`.
    pub path: PathBuf,
    /// The lock. Never read: dropping it closes the file, which is what lets
    /// the profile go.
    _held: File,
}

/// The first of `kept`, `kept-2`, `kept-3`… that no other desktop holds.
///
/// Makes the directory `kept` is in, which on a first run nothing has yet.
pub fn claim(kept: &Path) -> io::Result<Claimed> {
    let parent = kept
        .parent()
        .expect("a profile directory is a path under a state home");
    std::fs::create_dir_all(parent)?;
    let mut number = 1;
    loop {
        let path = numbered(kept, number);
        if let Some(held) = hold(&path)? {
            return Ok(Claimed { path, _held: held });
        }
        number += 1;
    }
}

/// `kept` for the first, and `kept-<number>` after it.
fn numbered(kept: &Path, number: u32) -> PathBuf {
    match number {
        1 => kept.to_path_buf(),
        _ => {
            let mut name = kept.as_os_str().to_os_string();
            name.push(format!("-{number}"));
            PathBuf::from(name)
        }
    }
}

/// The lock on `profile`, or `None` when another desktop has it.
fn hold(profile: &Path) -> io::Result<Option<File>> {
    let mut name = profile.as_os_str().to_os_string();
    name.push(".lock");
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(PathBuf::from(name))?;
    // SAFETY: `flock` on a descriptor this function owns, which stays open for
    // the call.
    let taken = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    match taken {
        0 => Ok(Some(file)),
        _ => {
            let why = io::Error::last_os_error();
            match why.kind() {
                io::ErrorKind::WouldBlock => Ok(None),
                _ => Err(why),
            }
        }
    }
}
