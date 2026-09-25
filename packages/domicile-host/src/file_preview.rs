//! What a launcher is shown of the row it has reached.
//!
//! **The page names the path, and the index decides whether it is read.** A
//! page has no filesystem, and `preview_file` is not one: a path the index of
//! the home does not hold is answered [`FilePreview::Unreadable`] without
//! touching the disk, so a page learns nothing a search could not already have
//! named.

use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use domicile_protocol::FilePreview;

use crate::file_search::FileSearch;

/// How much of a file a preview is sent. A pane's worth, not a file's.
const PREVIEW_BYTES: usize = 8 * 1024;

/// How many of a directory's entries a preview is sent.
const PREVIEW_ENTRIES: usize = 200;

/// What `path`, relative to `home`, holds — if `search` offers it.
pub fn preview(home: &Path, path: &str, search: &FileSearch) -> FilePreview {
    let at = home.join(path);
    let read = if !search.holds(path) {
        Ok(FilePreview::Unreadable)
    } else if at.is_dir() {
        listed(&at)
    } else {
        front(&at)
    };
    // A path the walk found and the disk no longer has, or one it will not
    // open: the preview says there is nothing to show rather than a guess.
    read.unwrap_or(FilePreview::Unreadable)
}

/// The front of a directory: its names, sorted, a directory ending in `/`.
fn listed(at: &Path) -> std::io::Result<FilePreview> {
    let mut entries = fs::read_dir(at)?
        .map(|entry| {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            Ok(if entry.file_type()?.is_dir() {
                format!("{name}/")
            } else {
                name
            })
        })
        .collect::<std::io::Result<Vec<_>>>()?;
    entries.sort();
    entries.truncate(PREVIEW_ENTRIES);
    Ok(FilePreview::Directory { entries })
}

/// The front of a file, as text if it is text.
///
/// Binary is a NUL, or bytes that are not UTF-8 before the limit. A character
/// the limit cut in half is not either: it is left out.
fn front(at: &Path) -> std::io::Result<FilePreview> {
    let mut bytes = Vec::with_capacity(PREVIEW_BYTES);
    File::open(at)?
        .take(PREVIEW_BYTES as u64)
        .read_to_end(&mut bytes)?;
    Ok(match std::str::from_utf8(&bytes) {
        _ if bytes.contains(&0) => FilePreview::Binary,
        Ok(text) => FilePreview::Text { text: text.into() },
        Err(error) if error.error_len().is_none() => FilePreview::Text {
            text: String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned(),
        },
        Err(_) => FilePreview::Binary,
    })
}
