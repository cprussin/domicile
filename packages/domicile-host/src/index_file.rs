//! The index on disk, so a launcher has a list before the walk has run.
//!
//! A boot walk of a real home takes seconds and a launcher is opened in the
//! first one, so the answer from the last run is written down and read back at
//! startup — see [`crate::file_index`], which holds it while the walk
//! reconciles it.
//!
//! # It is a cache, and it is treated like one
//!
//! Nothing here is authoritative and nothing here is trusted. The file lives
//! in a directory any process running as this user can write, it is left
//! behind by a desktop that can be killed in the middle of writing it, and it
//! is read before there is a desktop to report anything to. So every way it
//! can be wrong has the same answer — say what is wrong with it and walk the
//! home — and none of them is a desktop that will not start. A boot walk costs
//! seconds; a desktop a stray file can stop costs the machine.
//!
//! # The format
//!
//! A header line naming the format and its version, then one path per line,
//! relative to the home directory:
//!
//! ```text
//! domicile-file-index 1
//! Notes/today.org
//! src
//! ```
//!
//! Lines rather than JSON because of what is on them: a home of a hundred
//! thousand paths is a list of strings with no structure to describe, and
//! `read_to_string().lines()` is the whole of the parser. The header is what
//! makes a wrong file answerable at all — without it every text file in the
//! world is a valid index, and what the launcher would offer is its lines.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// What the first line says, and the whole of what makes a file ours.
///
/// The number moves when the meaning of a line does. Nothing migrates: a
/// version this build does not know is refused, which costs the boot walk this
/// file exists to skip and nothing else.
const HEADER: &str = "domicile-file-index 1";

/// Why an index on disk could not be used.
///
/// Every variant is ordinary rather than exceptional — this is a cache — which
/// is why they are told apart at all: the compositor says a different sentence
/// about each, and a first boot must not look like a corrupted one.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum IndexFileError {
    /// There is no file. A first boot, or a cleared cache.
    #[error("nothing has been written down yet")]
    Missing,
    /// There is a file and it could not be read.
    #[error("it could not be read: {0}")]
    Unreadable(String),
    /// There is a file and it is not one of ours.
    #[error("it is not an index this build wrote")]
    Unrecognized,
}

/// What the last run wrote down.
///
/// All or nothing, deliberately. A line that is not a path a launcher could
/// spend — absolute, or climbing out of the home with `..` — is not a row to
/// drop quietly: every path in here is handed back to the compositor to open,
/// so one of those is evidence that this file is not one we wrote. The answer
/// is the same as for a file with no header at all.
pub fn read(path: &Path) -> Result<Vec<String>, IndexFileError> {
    let text = fs::read_to_string(path).map_err(|err| match err.kind() {
        io::ErrorKind::NotFound => IndexFileError::Missing,
        // Which covers a file of bytes that are not text, because that is
        // `InvalidData` out of `read_to_string` — and a half-written file from
        // a desktop that was killed mid-write is exactly that.
        io::ErrorKind::InvalidData => IndexFileError::Unrecognized,
        _ => IndexFileError::Unreadable(err.to_string()),
    })?;

    let mut lines = text.lines();
    if lines.next() != Some(HEADER) {
        Err(IndexFileError::Unrecognized)
    } else {
        lines
            // A trailing newline leaves an empty last line, and an empty line
            // names nothing either way. Not corruption: the shape of a text
            // file.
            .filter(|line| !line.is_empty())
            .map(|line| {
                under_home(line)
                    .then(|| line.to_string())
                    .ok_or(IndexFileError::Unrecognized)
            })
            .collect()
    }
}

/// Write the index down for the next run.
///
/// Beside and renamed over, because a desktop can be killed in the middle of
/// this and a rename is the one write a reader cannot catch half of. The
/// alternative — truncate and write — leaves a reader that arrives at the
/// wrong moment with a file that has a header and half a home in it, which is
/// the one corruption [`read`] cannot recognize.
///
/// The directory is made rather than required: on a new machine nothing else
/// puts it there.
pub fn write(path: &Path, files: &[String]) -> io::Result<()> {
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)?;
    }
    let beside = beside(path);
    fs::write(&beside, lines(files))?;
    fs::rename(&beside, path)
}

/// The whole file, as text.
fn lines(files: &[String]) -> String {
    std::iter::once(HEADER)
        .chain(files.iter().map(String::as_str))
        .fold(String::new(), |mut text, line| {
            text.push_str(line);
            text.push('\n');
            text
        })
}

/// Where the file is built before it is renamed into place.
///
/// In the same directory, because a rename across filesystems is a copy and
/// therefore not atomic — and a cache directory is exactly the kind of place
/// that is its own mount.
fn beside(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".writing");
    path.with_file_name(name)
}

/// Whether `line` is a path that stays inside the home directory.
///
/// The launcher spends these by joining them onto the home and opening the
/// result, so what this rules out is a line that would name something else:
/// an absolute path, and one that climbs out with `..`.
fn under_home(line: &str) -> bool {
    let path = Path::new(line);
    path.is_relative()
        && path
            .components()
            .all(|part| !matches!(part, std::path::Component::ParentDir))
}
