//! What the compositor publishes once it is up.
//!
//! The shell picks the path (`--session PATH`) and waits for the file to
//! appear; the compositor writes it after everything is bound and before it
//! starts serving. Everything the shell cannot know in advance is in it: the
//! Wayland displays are named by the compositor, and whether it is compositing
//! is decided by whether it got a window.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// A running compositor, described to the shell that started it.
///
/// `PartialEq` so a test can assert a round trip; the field names are the wire
/// format, read by a TypeScript program on the other side.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    /// The host protocol version this compositor speaks. A shell built against
    /// another one has to say so rather than connect and misbehave.
    pub protocol: u32,
    /// The Unix socket the host protocol is served on.
    pub chrome_socket: PathBuf,
    /// The display applications connect to.
    pub wayland_display: String,
    /// The display the *chrome's own window* goes on, which is a different
    /// socket: which one a client arrived on is how the compositor tells the
    /// desktop from the things running on it.
    pub chrome_wayland_display: String,
    /// Whether the compositor draws client windows itself. When it does, the
    /// chrome's window must be transparent where an app shows through.
    pub composited: bool,
}

/// Could not write the session document.
///
/// Carries the path the caller asked for rather than the temporary the write
/// actually failed on: the temporary is this function's business, and naming it
/// in an error would send the reader looking for a file that never existed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("could not publish the session to {path}: {kind:?}")]
pub struct PublishError {
    pub path: String,
    pub kind: std::io::ErrorKind,
}

/// Write `session` to `path`, atomically.
///
/// By rename, because the reader is a shell polling for the file: a plain write
/// would let it open a document that is half a JSON object, and there is no
/// second chance to notice — a session is published once.
pub fn publish(session: &Session, path: &Path) -> Result<(), PublishError> {
    let document = serde_json::to_string_pretty(session)
        .expect("a session is plain data and always serialises");
    let staging = staging_path(path)?;
    // Both steps behind the same cleanup, not only the rename. `fs::write`
    // creates and truncates before it writes, so a failure part way through —
    // a full filesystem, a quota — leaves the staging file exactly as a failed
    // rename does: a file named almost right beside the one a shell is waiting
    // for, which the next run would inherit.
    through(&staging, path, || {
        std::fs::write(&staging, document)?;
        std::fs::rename(&staging, path)
    })
}

/// Run the two steps of a publish, taking the staging file with them if either
/// fails.
///
/// The error is captured before the removal so a filesystem that will not let
/// go of the staging file cannot replace the reason the publish failed.
fn through(
    staging: &Path,
    path: &Path,
    steps: impl FnOnce() -> std::io::Result<()>,
) -> Result<(), PublishError> {
    match steps() {
        Ok(()) => Ok(()),
        Err(err) => {
            let failure = at(path, &err);
            let _ = std::fs::remove_file(staging);
            Err(failure)
        }
    }
}

/// Where the document is written before it is renamed into place.
///
/// A sibling, because `rename` is only atomic within a filesystem and the one
/// place guaranteed to share `path`'s is `path`'s own directory.
///
/// A path with no file name — `/`, or one ending in `..` — is refused rather
/// than defaulted into a staging file called `.new`: it is a shell that named
/// a directory where a document goes, and answering that for it would write
/// somewhere nobody asked for.
fn staging_path(path: &Path) -> Result<PathBuf, PublishError> {
    let Some(name) = path.file_name() else {
        return Err(PublishError {
            path: path.display().to_string(),
            kind: std::io::ErrorKind::InvalidInput,
        });
    };
    let mut name = name.to_os_string();
    name.push(".new");
    Ok(path.with_file_name(name))
}

fn at(path: &Path, err: &std::io::Error) -> PublishError {
    PublishError {
        path: path.display().to_string(),
        kind: err.kind(),
    }
}
