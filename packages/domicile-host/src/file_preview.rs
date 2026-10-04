//! Builds the launcher's preview of a selected file.
//!
//! Only paths in the file index are read. Any other path returns
//! [`FilePreview::Unreadable`] without touching the disk, so a page cannot use
//! previews to probe the filesystem.

use std::borrow::Cow;
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use domicile_protocol::FilePreview;
use lofty::picture::PictureType;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::Tag;

use crate::data_url::data_url;
use crate::file_search::FileSearch;

/// Bytes of a file sent in a preview.
const PREVIEW_BYTES: usize = 8 * 1024;

/// Directory entries sent in a preview.
const PREVIEW_ENTRIES: usize = 200;

/// Largest album cover sent in a preview, in bytes.
const COVER_BYTES: usize = 1024 * 1024;

/// Previews `path`, relative to `home`, if `search` holds it.
pub fn preview(home: &Path, path: &str, search: &FileSearch) -> FilePreview {
    let at = home.join(path);
    let read = if !search.holds(path) {
        Ok(FilePreview::Unreadable)
    } else if at.is_dir() {
        listed(&at)
    } else {
        heard(&at).map_or_else(|| front(&at), Ok)
    };
    // The path may be gone or unopenable.
    read.unwrap_or(FilePreview::Unreadable)
}

/// A directory's entry names, sorted, with directories ending in `/`.
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

/// Audio tags for `at`, or `None` if it does not parse as audio. Detects by
/// content, not extension.
fn heard(at: &Path) -> Option<FilePreview> {
    let song = Probe::open(at).ok()?.guess_file_type().ok()?.read().ok()?;
    let tag = song.primary_tag().or_else(|| song.first_tag());
    Some(FilePreview::Audio {
        title: tag.and_then(|tag| tag.title()).map(Cow::into_owned),
        artist: tag.and_then(|tag| tag.artist()).map(Cow::into_owned),
        album: tag.and_then(|tag| tag.album()).map(Cow::into_owned),
        duration: song.properties().duration().as_secs_f64(),
        cover: tag.and_then(cover),
    })
}

/// The front cover, else the first picture, as a `data:` URL. Skips pictures
/// over [`COVER_BYTES`] or without a MIME type.
fn cover(tag: &Tag) -> Option<String> {
    let picture = tag
        .get_picture_type(PictureType::CoverFront)
        .or_else(|| tag.pictures().first())
        .filter(|picture| picture.data().len() <= COVER_BYTES)?;
    Some(data_url(picture.mime_type()?.as_str(), picture.data()))
}

/// The start of a file, as text if it is text.
///
/// A NUL or invalid UTF-8 means binary. A character cut off by the limit is
/// dropped rather than treated as invalid.
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
