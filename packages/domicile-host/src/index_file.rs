//! Persists the file index between runs, so the launcher has a list before
//! the boot walk finishes. [`crate::file_index`] reconciles it with the walk.
//!
//! The file is an untrusted cache. Any problem with it is reported and the
//! home is walked; it never stops the desktop from starting.
//!
//! Format: a header line with the version, then one path per line, relative
//! to the home directory:
//!
//! ```text
//! domicile-file-index 1
//! Notes/today.org
//! src
//! ```

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The required first line.
///
/// Bump the version when a line's meaning changes. Other versions are
/// rejected, not migrated.
const HEADER: &str = "domicile-file-index 1";

/// Why the index file could not be used.
///
/// Separate variants let the compositor log a first boot differently from a
/// corrupt file.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum IndexFileError {
    /// No file, as on a first boot or after clearing the cache.
    #[error("nothing has been written down yet")]
    Missing,
    /// The file exists but could not be read.
    #[error("it could not be read: {0}")]
    Unreadable(String),
    /// The file is not a valid index from this build.
    #[error("it is not an index this build wrote")]
    Unrecognized,
}

/// Reads the paths the last run wrote.
///
/// Rejects the whole file if any line is absolute or contains `..`. Those
/// paths would be opened outside the home, and their presence means the file
/// was not written by this code.
pub fn read(path: &Path) -> Result<Vec<String>, IndexFileError> {
    let text = fs::read_to_string(path).map_err(|err| match err.kind() {
        io::ErrorKind::NotFound => IndexFileError::Missing,
        // Non-UTF-8 content, such as a truncated write.
        io::ErrorKind::InvalidData => IndexFileError::Unrecognized,
        _ => IndexFileError::Unreadable(err.to_string()),
    })?;

    let mut lines = text.lines();
    if lines.next() != Some(HEADER) {
        Err(IndexFileError::Unrecognized)
    } else {
        lines
            // Skip empty lines, such as after a trailing newline.
            .filter(|line| !line.is_empty())
            .map(|line| {
                under_home(line)
                    .then(|| line.to_string())
                    .ok_or(IndexFileError::Unrecognized)
            })
            .collect()
    }
}

/// Writes the index for the next run, creating the directory if needed.
///
/// Writes a sibling file and renames it into place, so a reader never sees a
/// partial file. [`read`] cannot detect a file truncated after the header.
pub fn write(path: &Path, files: &[String]) -> io::Result<()> {
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)?;
    }
    let beside = beside(path);
    fs::write(&beside, lines(files))?;
    fs::rename(&beside, path)
}

/// The file contents.
fn lines(files: &[String]) -> String {
    std::iter::once(HEADER)
        .chain(files.iter().map(String::as_str))
        .fold(String::new(), |mut text, line| {
            text.push_str(line);
            text.push('\n');
            text
        })
}

/// The temporary path to write before renaming.
///
/// Same directory, since a rename across filesystems is not atomic.
fn beside(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".writing");
    path.with_file_name(name)
}

/// Whether `line` is relative and has no `..`, so it stays inside the home.
fn under_home(line: &str) -> bool {
    let path = Path::new(line);
    path.is_relative()
        && path
            .components()
            .all(|part| !matches!(part, std::path::Component::ParentDir))
}
