//! Picks a profile directory no other running desktop is using.
//!
//! Chromium allows one browser per profile. A second engine on a busy
//! `--user-data-dir` forwards its command line to the first and exits. So each
//! desktop locks its profile, and one that finds it locked tries `profile-2`,
//! `profile-3` and so on. Numbered profiles persist between runs.
//!
//! The lock is a `flock` on a file beside the profile. The kernel releases it
//! when the process dies, so a killed desktop leaves no stale lock. The
//! supervisor holds it, not the engine, so the profile stays locked across
//! engine restarts.

use std::fs::{File, OpenOptions};
use std::io;
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};

/// A profile this process holds, for as long as this is alive.
pub struct Claimed {
    /// The directory the engine is handed as `--user-data-dir`.
    pub path: PathBuf,
    /// The lock. Dropping it closes the file and releases the profile.
    _held: File,
}

/// Locks the first of `kept`, `kept-2`, `kept-3`… that no other desktop holds.
///
/// Creates the parent directory of `kept` if needed.
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

/// Returns `kept` for 1 and `kept-<number>` after it.
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

/// Locks `profile`, or returns `None` when another desktop holds it.
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
